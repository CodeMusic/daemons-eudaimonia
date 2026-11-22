// E-9: Redmine mirrored into PRAXIS, against a made-up Redmine: the tickets keep their ids, the journals their times
// and authors, finishing pays the lane once, a second run changes nothing, and another replica that pulls reads the
// same board. Nothing here reaches the real Redmine or roverbyteseer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { px, type Db } from "../src/praxis.ts";
import { Mirror, MIRROR, type Get, type Issue } from "../src/mirror.ts";
import { haveOf, missingFor, pull, remote } from "../src/replica.ts";
import { eitherTickets, PraxisTickets } from "../src/tickets.ts";
import { POINTS } from "../src/work.ts";

const PROJECTS: Record<string, { id: number; name: string }> = {
  daemons: { id: 2, name: "DAEMONS" }, companion: { id: 3, name: "daemons-companion" }, eudaimonia: { id: 4, name: "daemons-eudaimonia" },
};
let statuses = [{ name: "Ready" }, { name: "In progress" }, { name: "Blocked" }, { name: "Needs decision" }, { name: "Deferred" },
                { name: "Closed", is_closed: true }, { name: "Superseded", is_closed: true }];
let rid = 500;
function issue(project: string, ticket: string, status: string, o: { lane?: string; tracker?: string; updated?: string; closed?: string;
                                                                       blocked?: string; order?: number; notes?: [string, string, string][] } = {}): Issue {
  const id = rid++;
  return {
    id, subject: `${ticket} The title of ${ticket}`, description: `**${ticket}**: words.`, project: PROJECTS[project],
    tracker: { id: 1, name: o.tracker ?? "Job" }, status: { id: 1, name: status }, priority: { id: 2, name: "Normal" },
    author: { id: 1, name: "Claude sessions" }, ...(o.lane ? { assigned_to: { id: 10, name: `Lane ${o.lane}` } } : {}),
    custom_fields: [{ id: 1, name: "Ticket", value: ticket }, { id: 3, name: "Order", value: o.order == null ? "" : String(o.order) },
                    { id: 9, name: "Blocked on", value: o.blocked ?? "" }, { id: 12, name: "State", value: "(empty)" },
                    { id: 8, name: "From", value: "the user, 2026-11-22" }],
    created_on: "2026-11-01T00:00:00Z", updated_on: o.updated ?? "2026-11-21T10:00:00Z", closed_on: o.closed ?? null,
    journals: (o.notes ?? []).map(([at, who, text], k) => ({ id: id * 10 + k, created_on: at, notes: text,
                                                             user: who === "sessions" ? { id: 1, name: "Claude sessions" } : { id: 10, name: `Lane ${who}` } })),
    relations: [],
  };
}

function redmine(issues: Issue[]) {
  const calls: string[] = [];
  const get: Get = async <T>(path: string) => {
    calls.push(path);
    const u = new URL("http://redmine" + path);
    if (u.pathname === "/trackers.json") return { trackers: [{ name: "Job" }, { name: "Bug" }] } as T;
    if (u.pathname === "/issue_statuses.json") return { issue_statuses: statuses } as T;
    const one = /^\/issues\/(\d+)\.json$/.exec(u.pathname);
    if (one) return { issue: structuredClone(issues.find((i) => i.id === Number(one[1]))!) } as T;
    if (u.pathname === "/issues.json") {
      const since = u.searchParams.get("updated_on")?.replace(/^>=/, "") ?? null, offset = Number(u.searchParams.get("offset") ?? 0);
      const all = issues.filter((i) => i.project.id === PROJECTS[u.searchParams.get("project_id")!].id && (!since || i.updated_on >= since))
        .sort((a, b) => a.updated_on.localeCompare(b.updated_on) || a.id - b.id)
        .map(({ journals: _j, relations: _r, ...rest }) => structuredClone(rest));
      return { issues: all.slice(offset, offset + 100), total_count: all.length } as T;
    }
    throw new Error("no such path " + path);
  };
  return { get, calls };
}

const fresh = () => new px.Praxis(new DatabaseSync(":memory:") as unknown as Db, { actor: MIRROR });

function world() {
  rid = 500;
  statuses = statuses.filter((s) => s.name !== "Parked");
  const issues = [
    issue("daemons", "T-10", "In progress", { lane: "game", updated: "2026-11-21T09:00:00Z",
                                              notes: [["2026-11-20T08:00:00Z", "game", "Claimed by lane-game on main."]] }),
    issue("daemons", "T-11", "Ready", { lane: "game", order: 2 }),
    issue("daemons", "T-12", "Needs decision", { notes: [["2026-11-21T11:00:00Z", "sessions", "**A question for the user**"]] }),
    issue("daemons", "T-9", "Closed", { lane: "game", closed: "2026-11-20T12:00:00Z", updated: "2026-11-20T12:00:00Z" }),
    issue("daemons", "T-184a", "Closed", { closed: "2026-09-01T00:00:00Z" }),
    ...Array.from({ length: 130 }, (_, k) => issue("companion", `C-${k + 1}`, "Ready", k % 3 ? {} : { lane: "app", tracker: "Bug" })),
    issue("eudaimonia", "E-1", "In progress", { lane: "playground" }),
    issue("eudaimonia", "E-5", "Superseded", { lane: "playground", closed: "2026-11-21T08:00:00Z" }),
  ];
  issues.find((i) => i.custom_fields![0].value === "T-11")!.relations =
    [{ id: 1, issue_id: issues[0].id, issue_to_id: issues[1].id, relation_type: "blocks" }];
  return issues;
}

test("the first run brings every ticket in, keeping its id, its journals' times and authors", async () => {
  const issues = world(), r = redmine(issues), p = fresh();
  const ran = await new Mirror(p, r.get).run();
  assert.equal(ran.made, 136);
  assert.deepEqual(ran.skipped, [`#${issues[4].id} (T-184a)`]);
  assert.equal(ran.links, 1);
  const spaces = new Map(p.spaces().map((s) => [s.prefix, s]));
  assert.deepEqual([...spaces.keys()].sort(), ["C", "E", "T"]);
  for (const s of spaces.values()) assert.equal(s.reach, "home");
  const t10 = p.numbered(spaces.get("T")!.id, 10)!;
  assert.equal(t10.handle, "T-10");
  assert.equal(t10.title, "The title of T-10");
  assert.equal(t10.state, "in-progress");
  assert.equal(t10.fields.lane, "game");
  assert.equal(t10.fields.blocked_on, undefined, "an empty field is not written");
  assert.equal(t10.fields.cf_state, "(empty)", "Redmine's State column, beside the item's own state");
  assert.deepEqual(p.notes(t10.id).map((n) => [n.at, n.actor, n.text]), [["2026-11-20T08:00:00Z", "lane:game", "Claimed by lane-game on main."]]);
  const t11 = p.numbered(spaces.get("T")!.id, 11)!;
  assert.deepEqual(p.links(t10.id, "blocks").map((l) => l.to), [t11.id]);
  // a closed Job paid its lane once; a superseded one is set aside and paid nothing
  const paid = p.ledger().filter((e) => e.op === "award" && !e.back).map((e) => [p.item(e.item)!.handle, e.actor, e.points]);
  assert.deepEqual(paid, [["T-9", "lane:game", POINTS.job]]);
  assert.equal(p.item(p.numbered(spaces.get("E")!.id, 5)!.id)!.phase, "aside");
});

test("a second run asks only for what changed, and changes nothing", async () => {
  const issues = world(), r = redmine(issues), p = fresh(), m = new Mirror(p, r.get);
  await m.run();
  const before = JSON.stringify(p.have());
  r.calls.length = 0;
  const ran = await m.run();
  assert.equal(ran.made + ran.changed + ran.notes + ran.links, 0);
  assert.equal(JSON.stringify(p.have()), before, "no new events");
  assert.equal(r.calls.filter((c) => c.startsWith("/issues/")).length, 0, "a ticket that has not moved is not read again");
  assert.ok(r.calls.some((c) => c.includes("updated_on=%3E%3D2026-11-21T10%3A00%3A00Z")), "it asks only from the newest update it holds");
});

test("a change in Redmine arrives as a change: a close pays the lane, a new journal is one note, a new status a newer form", async () => {
  const issues = world(), r = redmine(issues), p = fresh(), m = new Mirror(p, r.get);
  await m.run();
  const t11 = issues.find((i) => i.custom_fields![0].value === "T-11")!;
  t11.status = { id: 6, name: "Closed" }; t11.closed_on = "2026-11-22T05:00:00Z"; t11.updated_on = "2026-11-22T05:00:00Z";
  t11.journals = [{ id: 1, user: { id: 10, name: "Lane game" }, notes: "Closed by lane-game: engineGba@abc.", created_on: "2026-11-22T05:00:00Z" }];
  statuses = [...statuses, { name: "Parked" }];
  const ran = await m.run();
  assert.equal(ran.changed, 1);
  assert.equal(ran.notes, 1);
  const T = p.spaces().find((s) => s.prefix === "T")!;
  assert.equal(T.form!.version, 2, "the newer form, with PARKED in it");
  assert.ok(T.form!.kinds.job.states.some((s) => s.name === "parked"));
  const item = p.numbered(T.id, 11)!;
  assert.equal(item.state, "closed");
  assert.deepEqual(p.ledger().filter((e) => e.item === item.id && !e.back).map((e) => [e.actor, e.points]), [["lane:game", POINTS.job]]);
  const again = await m.run();
  assert.equal(again.changed + again.notes, 0, "and only once");
});

test("the dashboard reads PRAXIS as it read Redmine", async () => {
  const p = fresh();
  await new Mirror(p, redmine(world()).get).run();
  const t = new PraxisTickets(p, { now: () => Date.parse("2026-11-22T06:00:00Z") });
  assert.ok(t.ready());
  const b = await t.board();
  assert.equal(b.stale, false);
  assert.deepEqual(b.projects.map((x) => [x.ident, x.open, x.closed, x.working]),
                   [["daemons", 3, 1, 1], ["companion", 130, 0, 0], ["eudaimonia", 1, 1, 1]]);
  assert.deepEqual(b.waiting.map((x) => x.id), ["T-12"]);
  const game = b.lanes.find((l) => l.lane === "game")!;
  assert.deepEqual([game.working.map((x) => x.id), game.next.map((x) => x.id), game.done.map((x) => x.id)], [["T-10"], ["T-11"], ["T-9"]]);
  const d = (await t.ticket("T-12"))!;
  assert.equal(d.status, "Needs decision");
  assert.deepEqual(d.notes, [{ at: "2026-11-21T11:00:00Z", by: "a session", text: "**A question for the user**" }]);
  assert.ok(d.fields.some((f) => f.name === "From" && f.value === "the user, 2026-11-22"));
  assert.ok(!d.fields.some((f) => f.name === "State"), "(empty) is not shown");
  assert.equal(await t.ticket("T-999"), null);
  const lane = (await t.lane("game"))!;
  assert.deepEqual([lane.arete.total, lane.arete.tickets, lane.arete.week], [POINTS.job, 1, POINTS.job]);
  assert.deepEqual(lane.history.map((h) => h.ticket), ["T-10"]);
  assert.equal((await t.lane("nobody")), null);
});

test("another replica pulls what it lacks and reads the same board; it never gives back", async () => {
  const a = fresh(), b = new px.Praxis(new DatabaseSync(":memory:") as unknown as Db, { actor: "eudaimonia" });
  await new Mirror(a, redmine(world()).get).run();
  const asked: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    asked.push(`${init?.method ?? "GET"} ${path}`);
    const body = path === "/px/have" ? haveOf(a) : missingFor(a, JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const before = new PraxisTickets(b), via = eitherTickets(before, null)!;
  assert.equal(before.ready(), false);
  const r = await pull(b, "http://roverbyteseer:4742", { fetch: f });
  assert.ok(r.sent > 136);
  assert.ok(asked.every((x) => x === "POST /px/missing"), "it asks only for what it lacks");
  assert.deepEqual((await via.board()).projects, (await new PraxisTickets(a).board()).projects);
  assert.equal((await pull(b, "http://roverbyteseer:4742", { fetch: f })).sent, 0, "a second pull takes nothing");
  assert.throws(() => remote("http://roverbyteseer:4742", { fetch: f }).receive([]), /never gives/);
  // after an answer, forgetting waits for the pull it asks for
  let refreshed = false;
  const waits = new PraxisTickets(b, { refresh: async () => { await new Promise((r) => setTimeout(r, 5)); refreshed = true; } });
  await eitherTickets(waits, null)!.forget("T-12");
  assert.equal(refreshed, true);
  // a pull an hour old marks the board stale
  const old = new PraxisTickets(b, { now: () => 3_600_000 + 1, pulled: () => 1 });
  assert.equal((await old.board()).stale, true);
});
