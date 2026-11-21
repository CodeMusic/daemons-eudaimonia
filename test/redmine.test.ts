// THE DASHBOARD's reader (E-1), against a made-up Redmine: what the board makes of the tickets, that it only ever GETs,
// that it keeps a minute, and that it says so when Redmine is away. Nothing here reaches the real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RedmineReader, redmineEnv, waitsOnUser } from "../src/redmine.ts";
import { Refused } from "../src/accounts.ts";

const PROJECT_IDS: Record<string, number> = { daemons: 2, companion: 3, eudaimonia: 4 };
const NAMES: Record<number, string> = { 2: "DAEMONS", 3: "daemons-companion", 4: "daemons-eudaimonia" };
let n = 100;
function issue(project: string, id: string, status: string, o: { lane?: string; order?: number; blocked?: string; updated?: string; closed?: string } = {}) {
  const pid = PROJECT_IDS[project];
  return {
    id: n++, subject: `${id} A title for ${id}`, project: { id: pid, name: NAMES[pid] }, status: { id: 1, name: status },
    ...(o.lane ? { assigned_to: { id: 6, name: `Lane ${o.lane}` } } : {}),
    custom_fields: [{ id: 1, name: "Ticket", value: id }, { id: 3, name: "Order", value: o.order == null ? "" : String(o.order) },
                    { id: 9, name: "Blocked on", value: o.blocked ?? null }, { id: 12, name: "State", value: "(empty)" },
                    { id: 13, name: "See", value: "T-1" }],
    updated_on: o.updated ?? "2026-11-21T10:00:00Z", created_on: "2026-11-01T00:00:00Z", closed_on: o.closed ?? null,
    description: `**${id}** (*the user*): words.`,
  };
}

const OPEN: Record<string, ReturnType<typeof issue>[]> = {
  daemons: [issue("daemons", "T-10", "In progress", { lane: "game", updated: "2026-11-21T09:00:00Z" }),
            issue("daemons", "T-11", "Ready", { lane: "game", order: 2 }), issue("daemons", "T-12", "Ready", { lane: "game", order: 1 }),
            issue("daemons", "T-13", "Needs decision"), issue("daemons", "T-14", "Blocked", { blocked: "the user's pick of three" }),
            issue("daemons", "T-15", "Blocked", { lane: "art", blocked: "T-14" })],
  companion: Array.from({ length: 150 }, (_, i) => issue("companion", `C-${i + 1}`, "Ready", i % 3 ? {} : { lane: "app", order: i })),
  eudaimonia: [issue("eudaimonia", "E-1", "In progress", { lane: "playground" })],
};
const CLOSED: Record<string, ReturnType<typeof issue>[]> = {
  daemons: [issue("daemons", "T-9", "Closed", { lane: "game", closed: "2026-11-20T12:00:00Z" })],
  companion: [], eudaimonia: [issue("eudaimonia", "E-5", "Closed", { lane: "playground", closed: "2026-11-21T08:00:00Z" })],
};

function fake() {
  const calls: { method: string; url: string; key: string | null }[] = [];
  let down = false;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    calls.push({ method, url: url.pathname + url.search, key: new Headers(init?.headers).get("X-Redmine-API-Key") });
    if (down) throw new TypeError("fetch failed");
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
    const proj = /^\/projects\/(\w+)\.json$/.exec(url.pathname);
    if (proj) return ok({ project: { id: PROJECT_IDS[proj[1]] } });
    if (url.pathname === "/issues.json") {
      const q = url.searchParams, cf = q.get("cf_1");
      if (cf) return ok({ issues: [...Object.values(OPEN), ...Object.values(CLOSED)].flat().filter((i) => i.custom_fields[0].value === cf), total_count: 1 });
      const p = q.get("project_id")!, closed = q.get("status_id") === "closed";
      const all = (closed ? CLOSED : OPEN)[p], off = Number(q.get("offset") ?? 0), lim = Number(q.get("limit"));
      return ok({ issues: all.slice(off, off + lim), total_count: closed ? all.length + 40 : all.length });
    }
    const one = /^\/issues\/(\d+)\.json$/.exec(url.pathname);
    if (one) {
      const i = [...Object.values(OPEN), ...Object.values(CLOSED)].flat().find((x) => x.id === Number(one[1]))!;
      return ok({ issue: { ...i, journals: [
        { user: { name: "Lane game" }, notes: "Claimed.", created_on: "2026-11-21T08:00:00Z" },
        { user: { name: "Someone Real" }, notes: "A word.", created_on: "2026-11-21T09:00:00Z" },
        { user: { name: "Claude sessions" }, notes: "", created_on: "2026-11-21T09:30:00Z" }] } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls, setDown: (v: boolean) => { down = v; } };
}

test("the board: each lane at work or asleep, what waits on the user, each project's progress", async () => {
  const { f, calls } = fake();
  const b = await new RedmineReader("http://redmine.test/", "the-key", { fetch: f }).board();
  const game = b.lanes.find((l) => l.lane === "game")!;
  assert.deepEqual(game.working.map((t) => t.id), ["T-10"]);
  assert.deepEqual(game.next.map((t) => t.id), ["T-12", "T-11"]);   // by Order
  assert.deepEqual(game.done.map((t) => t.id), ["T-9"]);
  assert.equal(game.working[0].title, "A title for T-10");          // the id is not said twice
  assert.equal(b.lanes.find((l) => l.lane === "art")!.working.length, 0);
  assert.equal(b.lanes.length, 11);
  assert.deepEqual(b.waiting.map((t) => t.id).sort(), ["T-13", "T-14"]);   // T-15 is blocked on a ticket, not the user
  assert.deepEqual(b.projects.map((p) => [p.ident, p.open, p.closed, p.working]),
                   [["daemons", 6, 41, 1], ["companion", 150, 40, 0], ["eudaimonia", 1, 41, 1]]);
  assert.equal(b.lanes.find((l) => l.lane === "app")!.next.length, 5);
  assert.ok(calls.every((c) => c.method === "GET" && c.key === "the-key"));
  assert.ok(calls.some((c) => c.url.includes("offset=100")), "the second hundred of a project's tickets is read too");
});

test("a minute's cache, shared by callers at the same moment; the last board, marked stale, when Redmine is away", async () => {
  let t = Date.parse("2026-11-21T10:00:00Z");
  const { f, calls, setDown } = fake();
  const r = new RedmineReader("http://redmine.test", "k", { fetch: f, now: () => t });
  const [a, b] = await Promise.all([r.board(), r.board()]);
  assert.equal(a, b);
  const first = calls.length;
  await r.board();
  assert.equal(calls.length, first);
  t += 61 * 1000;
  setDown(true);
  const stale = await r.board();
  assert.equal(stale.stale, true);
  assert.equal(stale.lanes.length, 11);
  const cold = new RedmineReader("http://redmine.test", "k", { fetch: f });
  await assert.rejects(cold.board(), (e: unknown) => e instanceof Refused && e.status === 503);
});

test("one ticket, for its modal: its fields and its notes, authors never named unless a lane", async () => {
  const { f } = fake();
  const r = new RedmineReader("http://redmine.test", "k", { fetch: f });
  const t = (await r.ticket("T-10"))!;
  assert.equal(t.title, "A title for T-10");
  assert.equal(t.description, "**T-10** (*the user*): words.");
  assert.deepEqual(t.fields, [{ name: "See", value: "T-1" }]);   // "(empty)" and nulls left out
  assert.deepEqual(t.notes.map((x) => [x.by, x.text]), [["a person", "A word."], ["game", "Claimed."]]);
  assert.equal(await r.ticket("T-404"), null);
  assert.equal(await r.ticket("../../users"), null);
});

test("~/.redmine.env: the address and the playground lane's key, nothing else", () => {
  assert.deepEqual(redmineEnv("# a comment\nREDMINE_URL=http://rm:3333\nREDMINE_API_KEY=admin\nREDMINE_KEY_PLAYGROUND='abc'\n"),
                   { url: "http://rm:3333", key: "abc" });
  assert.equal(redmineEnv("REDMINE_URL=http://rm:3333\n"), null);
  assert.deepEqual(redmineEnv("export REDMINE_URL=u\nREDMINE_KEY_PI_ZERO=z", "pi-zero"), { url: "u", key: "z" });
});

test("waiting on the user: a decision, or blocked on them by name", () => {
  assert.equal(waitsOnUser("Needs decision", null), true);
  assert.equal(waitsOnUser("Blocked", "the user, by multiple choice"), true);
  assert.equal(waitsOnUser("Blocked", "T-14"), false);
  assert.equal(waitsOnUser("Ready", "the user"), false);
});
