// E-6: a lane's own page (a daemon employee's), against a made-up Redmine: its work, its ARETE counted from what it
// closed, its own notes and nobody else's, and only GETs. Nothing here reaches the real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARETE_DRAFT, RedmineReader } from "../src/redmine.ts";

const PIDS: Record<string, number> = { daemons: 2, companion: 3, eudaimonia: 4 };
let n = 500;
function issue(project: string, id: string, status: string, lane: string, o: { tracker?: string; closed?: string; updated?: string; order?: number } = {}) {
  return {
    id: n++, subject: `${id} Work for ${id}`, project: { id: PIDS[project], name: project }, status: { id: 1, name: status },
    tracker: { id: 1, name: o.tracker ?? "Job" }, assigned_to: { id: lane === "game" ? 6 : 7, name: `Lane ${lane}` },
    custom_fields: [{ id: 1, name: "Ticket", value: id }, { id: 3, name: "Order", value: o.order == null ? "" : String(o.order) }],
    updated_on: o.updated ?? "2026-11-21T10:00:00Z", created_on: id === "T-1" ? "2026-11-17T00:00:00Z" : "2026-11-19T00:00:00Z",
    closed_on: o.closed ?? null,
  };
}
const NOW = Date.parse("2026-11-21T12:00:00Z");
const ISSUES = [
  issue("daemons", "T-5", "In progress", "game", { updated: "2026-11-21T11:00:00Z" }),
  issue("daemons", "T-6", "Ready", "game", { order: 3 }), issue("companion", "C-7", "Ready", "game", { order: 1 }),
  issue("daemons", "T-8", "Blocked", "game"),
  issue("daemons", "T-1", "Closed", "game", { closed: "2026-11-10T00:00:00Z", updated: "2026-11-10T00:00:00Z" }),
  issue("daemons", "T-2", "Closed", "game", { tracker: "Bug", closed: "2026-11-20T00:00:00Z", updated: "2026-11-20T00:00:00Z" }),
  issue("daemons", "T-3", "Closed", "story", { closed: "2026-11-20T00:00:00Z" }),
  { ...issue("daemons", "X-1", "Closed", "game"), project: { id: 99, name: "someone else's" } },
];

function fake() {
  const calls: string[] = [];
  let down = false;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (down) throw new TypeError("fetch failed");
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    const proj = /^\/projects\/(\w+)\.json$/.exec(url.pathname);
    if (proj) return ok({ project: { id: PIDS[proj[1]] } });
    if (url.pathname === "/projects/daemons/memberships.json")
      return ok({ memberships: [{ user: { id: 5, name: "Claude sessions" } }, { user: { id: 6, name: "Lane game" } }, { user: { id: 7, name: "Lane story" } }] });
    if (url.pathname === "/issues.json") {
      const q = url.searchParams, who = Number(q.get("assigned_to_id")), closed = q.get("status_id") === "closed";
      const hits = ISSUES.filter((i) => i.assigned_to.id === who && (i.status.name === "Closed") === closed);
      return ok({ issues: hits.slice(Number(q.get("offset")), Number(q.get("offset")) + 100), total_count: hits.length });
    }
    const one = /^\/issues\/(\d+)\.json$/.exec(url.pathname);
    if (one) {
      const i = ISSUES.find((x) => x.id === Number(one[1]))!;
      return ok({ issue: { ...i, journals: [
        { user: { name: "Lane game" }, notes: `Claimed ${i.custom_fields[0].value}.`, created_on: i.updated_on },
        { user: { name: "A Real Person" }, notes: "Their own words.", created_on: i.updated_on },
        { user: { name: "Lane game" }, notes: "", created_on: i.updated_on }] } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls, down: () => { down = true; } };
}

test("a lane's page: its work sorted, its ARETE from what it closed, its own notes only", async () => {
  let now = NOW;
  const r = fake(), reader = new RedmineReader("http://redmine.test", "k", { fetch: r.f, now: () => now });
  const l = (await reader.lane("game"))!;
  assert.deepEqual(l.working.map((t) => t.id), ["T-5"]);
  assert.deepEqual(l.next.map((t) => t.id), ["C-7", "T-6"]);
  assert.deepEqual(l.waiting.map((t) => t.id), ["T-8"]);
  assert.deepEqual(l.done.map((t) => t.id), ["T-2", "T-1"]);                // newest closed first; X-1 is no project of ours
  assert.equal(l.arete.total, ARETE_DRAFT.Job + ARETE_DRAFT.Bug);
  assert.equal(l.arete.week, ARETE_DRAFT.Bug);                                // T-1 closed eleven days before
  assert.deepEqual(l.arete.ledger.map((x) => [x.id, x.kind, x.points]), [["T-2", "Bug", 3], ["T-1", "Job", 5]]);
  assert.deepEqual(l.projects.map((p) => [p.ident, p.open, p.working, p.closed]), [["daemons", 3, 1, 2], ["companion", 1, 0, 0]]);
  assert.equal(l.since, "2026-11-17T00:00:00Z");
  assert.ok(l.history.length > 0 && l.history.every((h) => h.text.startsWith("Claimed")));
  assert.equal(l.history[0].ticket, "T-5");
  assert.ok(!JSON.stringify(l).includes("Real Person"));
  assert.ok(r.calls.every((c) => c.startsWith("GET ")));
  const before = r.calls.length;
  await reader.lane("game");
  assert.equal(r.calls.length, before, "a minute's cache");
  now += 61 * 1000; r.down();
  assert.equal((await reader.lane("game"))!.stale, true, "Redmine away: the last page, marked stale");
});

test("a lane that is not ours is no page, and asks Redmine nothing", async () => {
  const r = fake(), reader = new RedmineReader("http://redmine.test", "k", { fetch: r.f, now: () => NOW });
  assert.equal(await reader.lane("nobody"), null);
  assert.equal(await reader.lane("../issues"), null);
  assert.equal(r.calls.length, 0);
});
