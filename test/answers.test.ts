// E-1's second slice: answering a ticket that waits on the user. The one write -- a note and back to Ready, only on a
// ticket of ours that waits on the user -- against a made-up Redmine; then over HTTP, only for a signed-in admin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Accounts, Refused } from "../src/accounts.ts";
import { Answers, answersEnv, choicesOf, ticketChoices } from "../src/answers.ts";
import { Avatars } from "../src/avatars.ts";
import type { Detail, RedmineReader } from "../src/redmine.ts";
import { makeServer } from "../src/server.ts";

const NOW = Date.parse("2026-11-21T15:00:00Z");
const refused = (status: number) => (e: unknown) => e instanceof Refused && e.status === status;

function fakeRedmine() {
  const issues = [
    { id: 11, ticket: "T-465", project: 2, status: { id: 4, name: "Needs decision" }, blocked: null },
    { id: 12, ticket: "T-500", project: 2, status: { id: 3, name: "Blocked" }, blocked: "the user's pick" },
    { id: 13, ticket: "T-501", project: 2, status: { id: 3, name: "Blocked" }, blocked: "T-465" },
    { id: 14, ticket: "T-502", project: 2, status: { id: 1, name: "Ready" }, blocked: null },
    { id: 15, ticket: "X-1", project: 99, status: { id: 4, name: "Needs decision" }, blocked: null },
  ];
  const calls: { method: string; path: string; body: unknown; headers: Headers }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", headers = new Headers(init?.headers);
    calls.push({ method, path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : null, headers });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    const proj = /^\/projects\/(\w+)\.json$/.exec(url.pathname);
    if (proj) return ok({ project: { id: { daemons: 2, companion: 3, eudaimonia: 4 }[proj[1]] } });
    if (url.pathname === "/issue_statuses.json") return ok({ issue_statuses: [{ id: 1, name: "Ready" }, { id: 4, name: "Needs decision" }] });
    if (url.pathname === "/issues.json") {
      const want = url.searchParams.get("cf_1");
      return ok({ issues: issues.filter((i) => i.ticket === want || (want === "T-465" && i.ticket === "X-1")).map((i) => ({
        id: i.id, project: { id: i.project }, status: i.status,
        custom_fields: [{ name: "Ticket", value: i.ticket === "X-1" ? "T-465" : i.ticket }, { name: "Blocked on", value: i.blocked }] })) });
    }
    if (method === "PUT" && /^\/issues\/\d+\.json$/.test(url.pathname)) return new Response(null, { status: 204 });   // as Redmine answers a PUT
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

test("a ticket's choices: the list under its last Choices: line, from its newest note that has one", () => {
  const asked = "**A question for the user** (*lane game, 2026-11-21*): Which?\n\nChoices:\n- One way\n- *Another* way\n\nAfter.";
  assert.deepEqual(choicesOf(asked), ["One way", "*Another* way"]);
  assert.deepEqual(choicesOf("**Choices:**\n1. First\n2. Second"), ["First", "Second"]);
  assert.deepEqual(choicesOf("Steps: (1) this, (2) that"), []);   // steps are not choices
  assert.deepEqual(choicesOf("Choices:\n\n- after a blank line"), ["after a blank line"]);
  assert.deepEqual(ticketChoices({ description: "Choices:\n- old", notes: [{ text: "no list" }, { text: "Choices:\n- newer" }] }), ["newer"]);
  assert.deepEqual(ticketChoices({ description: "Choices:\n- from the description", notes: [] }), ["from the description"]);
});

test("an answer: a note in the project's way of quoting the user, and back to Ready", async () => {
  const { f, calls } = fakeRedmine();
  const a = new Answers("http://redmine.test", "the-key", { fetch: f, now: () => NOW });
  assert.deepEqual(await a.answer("T-465", { text: "Because it fits.", choice: "One way", keep: false }), { ticket: "T-465", status: "Ready" });
  const put = calls.find((c) => c.method === "PUT")!;
  assert.equal(put.path, "/issues/11.json");                   // ours, never the other project's twin
  assert.deepEqual(put.body, { issue: { status_id: 1,
    notes: "**The user's answer** (*the user, 2026-11-21, on THE DASHBOARD*): **One way** -- Because it fits." } });
  assert.ok(calls.every((c) => c.headers.get("X-Redmine-API-Key") === "the-key" && !c.headers.has("X-Redmine-Switch-User")));
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);   // one write, nothing else
});

test("it still waits on the user: a note only; blocked on the user counts, blocked on a ticket does not", async () => {
  const { f, calls } = fakeRedmine();
  const a = new Answers("http://redmine.test", "k", { fetch: f, now: () => NOW, as: "codeuser" });
  assert.equal((await a.answer("T-500", { text: "Not yet.", choice: null, keep: true })).status, "Blocked");
  const put = calls.find((c) => c.method === "PUT")!;
  assert.deepEqual(put.body, { issue: { notes: "**The user's answer** (*the user, 2026-11-21, on THE DASHBOARD*): Not yet.\n\n*It still waits on the user.*" } });
  assert.equal(put.headers.get("X-Redmine-Switch-User"), "codeuser");
  await assert.rejects(a.answer("T-501", { text: "x", choice: null, keep: false }), refused(409));
  await assert.rejects(a.answer("T-502", { text: "x", choice: null, keep: false }), refused(409));
  await assert.rejects(a.answer("T-404", { text: "x", choice: null, keep: false }), refused(404));
  await assert.rejects(a.answer("../users", { text: "x", choice: null, keep: false }), refused(404));
  await assert.rejects(a.answer("T-465", { text: "  ", choice: null, keep: false }), refused(400));
  await assert.rejects(a.answer("T-465", { text: "x".repeat(4001), choice: null, keep: false }), refused(400));
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
});

test("the answering key: the user's own once added, the sessions' until then", () => {
  assert.deepEqual(answersEnv("REDMINE_URL=http://rm\nREDMINE_API_KEY=sessions\n"), { url: "http://rm", key: "sessions", as: null, whose: "sessions" });
  assert.deepEqual(answersEnv("REDMINE_URL=http://rm\nREDMINE_API_KEY=sessions\nREDMINE_KEY_USER=mine\n"), { url: "http://rm", key: "mine", as: null, whose: "user" });
  assert.equal(answersEnv("REDMINE_URL=http://rm\nREDMINE_KEY_GAME=g\n"), null);
});

// ---- over HTTP ---------------------------------------------------------------------------------------------------------

let server: Server, base = "";
const answered: { id: string; text: string; choice: string | null; keep: boolean }[] = [];
const detail = (status: string): Detail => ({ id: "T-465", project: "daemons", title: "a question", status, lane: "game", order: 1,
  updated: "2026-11-21T10:00:00Z", closed: null, description: "Which?\n\nChoices:\n- One\n- Two", fields: [], notes: [] });
let status = "Needs decision", forgot = 0;
const reader = { ticket: async (id: string) => (id === "T-465" ? detail(status) : null), forget: () => { forgot++; } } as unknown as RedmineReader;
const writer = { answer: async (id: string, a: { text: string; choice: string | null; keep: boolean }) => {
  answered.push({ id, ...a }); return { ticket: id, status: a.keep ? status : "Ready" }; } } as unknown as Answers;

before(async () => {
  const accounts = new Accounts(null, 1 << 10);
  await accounts.open();
  const admin = accounts.byName("admin")!;
  await accounts.make(admin, "ada", "person");
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-answers-"));
  server = makeServer({ accounts, avatars: new Avatars(join(dir, "none.json"), dir), web: join(import.meta.dirname, "..", "web"),
                        log: () => {}, redmine: reader, answers: writer });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

const post = (path: string, body: unknown, cookie?: string) => fetch(base + path, { method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) } });
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

test("a waiting ticket shows its choices; only a signed-in admin, past the first password, may answer it", async () => {
  const t = (await (await fetch(base + "/api/ticket/T-465")).json()).ticket;
  assert.deepEqual([t.waiting, t.choices, t.answerable], [true, ["One", "Two"], true]);

  assert.equal((await post("/api/ticket/T-465/answer", { choice: "One" })).status, 401);          // no one signed in
  const first = cookieOf(await post("/api/signin", { name: "admin", password: "admin" }));
  assert.equal((await post("/api/ticket/T-465/answer", { choice: "One" }, first)).status, 403);   // its password first
  const changed = await post("/api/password", { old: "admin", new: "a longer one now" }, first);
  const admin = cookieOf(changed);
  const forged = await fetch(base + "/api/ticket/T-465/answer", { method: "POST", body: JSON.stringify({ choice: "One" }),
    headers: { "Content-Type": "application/json", Origin: "http://evil.example.com", Cookie: admin } });
  assert.equal(forged.status, 403);                                                                // another site's page

  const r = await post("/api/ticket/T-465/answer", { choice: "One", text: "Yes.", keep: false }, admin);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ticket: "T-465", status: "Ready" });
  assert.deepEqual(answered, [{ id: "T-465", text: "Yes.", choice: "One", keep: false }]);
  assert.equal(forgot, 1);                                                                         // the next look is fresh

  status = "Ready";
  const after = (await (await fetch(base + "/api/ticket/T-465")).json()).ticket;
  assert.deepEqual([after.waiting, after.choices], [false, []]);
});
