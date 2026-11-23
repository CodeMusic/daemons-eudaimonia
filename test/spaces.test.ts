// E-10: the tickets in EUDAIMONIA -- every space as rows for its list, board and roadmap, a ticket's whole page, and
// changes: only to a space of the site's own (a mirrored one is Redmine's until the cut-over), each written as the
// account that made it, then given to the always-on replica, which refuses anything in a mirrored space.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { px, type Db } from "../src/praxis.ts";
import { MIRROR } from "../src/mirror.ts";
import { give, haveOf, missingFor, receiveFrom } from "../src/replica.ts";
import { Spaces, actorName } from "../src/spaces.ts";
import { workForm } from "../src/work.ts";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { makeServer } from "../src/server.ts";

const fresh = (actor = "eudaimonia") => new px.Praxis(new DatabaseSync(":memory:") as unknown as Db, { actor });

/** a replica holding a mirrored space (as the mirror makes it) with two tickets, one closed */
function mirrored() {
  const p = fresh(MIRROR);
  const form = workForm({ trackers: ["Job", "Bug"], statuses: [{ name: "Ready", closed: false }, { name: "In progress", closed: false },
    { name: "Closed", closed: true }], fields: ["Order"] });
  const T = p.makeSpace({ title: "DAEMONS", prefix: "T", form, reach: "home" });
  const a = p.make(T, "job", { title: "Open one", lane: "game", updated: "2026-11-21T10:00:00Z" }, { number: 10 });
  const b = p.make(T, "bug", { title: "Closed one", lane: "game", updated: "2026-11-20T10:00:00Z", closed: "2026-11-20T10:00:00Z" }, { number: 9 });
  p.state(b, "closed", { actor: "lane:game" });
  p.link(a, "follows", b);
  p.note(a, "Claimed by lane-game.", { at: "2026-11-21T09:00:00Z", actor: "lane:game" });
  return { p, T };
}

test("the spaces: a mirrored one for anyone, one of the site's own when signed in or made public", () => {
  const { p } = mirrored(), s = new Spaces(p);
  assert.deepEqual(s.list(false).map((v) => [v.prefix, v.mirrored, v.open, v.closed]), [["T", true, 1, 1]]);
  s.makeSpace("person:admin", { title: "The kitchen", prefix: "home" });
  s.makeSpace("person:admin", { title: "Open source", prefix: "OSS", reach: "public" });
  assert.deepEqual(s.list(false).map((v) => v.prefix), ["T", "OSS"]);
  assert.deepEqual(s.list(true).map((v) => v.prefix), ["T", "HOME", "OSS"]);
  assert.throws(() => s.space("HOME", false), /No space HOME/);
  for (const prefix of ["T", "C", "E", "HOME", "x", "TOOLONGX", "1A"])
    assert.throws(() => s.makeSpace("person:admin", { title: "Again", prefix }), /taken|prefix is/);
  assert.throws(() => s.makeSpace("person:admin", { title: "", prefix: "NEW" }), /needs a title/);
});

test("a ticket of the site's own: made, numbered, changed as its account, and its whole history kept", () => {
  const { p } = mirrored();
  let changed = 0;
  const s = new Spaces(p, { changed: () => changed++ });
  s.makeSpace("person:admin", { title: "The kitchen", prefix: "HOME" });
  const h = s.make("person:admin", "HOME", { title: "  Mop   the floor ", lane: "Game", priority: "High", order: "2", description: "**wet**" });
  assert.equal(h, "HOME-1");
  let it = s.item(h, true);
  assert.deepEqual([it.title, it.lane, it.priority, it.order, it.status, it.description, it.by], ["Mop the floor", "game", "High", 2, "Ready", "**wet**", "admin"]);
  it = s.change("agent:game", h, { action: "state", state: "in-progress" });
  it = s.change("agent:game", h, { action: "note", text: "Started with the corners." });
  it = s.change("person:admin", h, { action: "set", field: "priority", value: "Urgent" });
  it = s.change("person:admin", h, { action: "state", state: "closed" });
  assert.equal(it.status, "Closed");
  assert.ok(it.closed && it.closedAt);
  assert.equal(it.arete, 5, "a Job finished pays its points once");
  assert.deepEqual(it.notes.map((n) => [n.by, n.text]), [["game", "Started with the corners."]]);
  assert.deepEqual(it.history.map((x) => [x.by, x.what]), [["admin", "made it"], ["game", "moved it to In progress"],
    ["admin", "set priority to Urgent"], ["admin", "moved it to Closed"], ["admin", "paid 5 ARETE"]]);
  assert.equal(changed, 6);
  assert.throws(() => s.change("person:admin", h, { action: "set", field: "redmine", value: 1 }), /can't be set/);
  assert.throws(() => s.change("person:admin", h, { action: "set", field: "priority", value: "Soon" }), /priority is/);
  assert.throws(() => s.change("person:admin", h, { action: "state", state: "lost" }), /No such state/);
  assert.throws(() => s.make("person:admin", "HOME", { title: "" }), /needs a title/);
});

test("a mirrored ticket reads here and changes only in Redmine", () => {
  const { p } = mirrored(), s = new Spaces(p);
  const it = s.item("T-10", false);
  assert.equal(it.mirrored, true);
  assert.equal(it.updated, "2026-11-21T10:00:00Z", "Redmine's own time, not the mirror's");
  assert.deepEqual(it.notes, [{ at: "2026-11-21T09:00:00Z", by: "game", text: "Claimed by lane-game." }]);
  assert.deepEqual(it.links, [{ type: "follows", to: "T-9", toward: true }]);
  assert.deepEqual(s.item("T-9", false).links, [{ type: "follows", to: "T-10", toward: false }]);
  assert.throws(() => s.change("person:admin", "T-10", { action: "note", text: "hi" }), /Redmine's until the cut-over/);
  assert.throws(() => s.make("person:admin", "T", { title: "New" }), /Redmine's until the cut-over/);
  const rows = s.rows(s.space("T", false));
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.closed, r.closedAt]).sort(),
                   [["T-10", "Ready", false, null], ["T-9", "Closed", true, "2026-11-20T10:00:00Z"]]);
  assert.equal(actorName("mirror"), "Redmine");
  assert.equal(actorName("redmine:7"), "a person", "nobody named but a lane or an account");
});

test("the site gives its own spaces to the always-on replica, which refuses anything in a mirrored one", async () => {
  const rover = mirrored(), site = fresh();
  // the site has taken the mirror's space, then made one of its own
  site.receive(rover.p.missing({}, {}));
  const s = new Spaces(site);
  s.makeSpace("person:admin", { title: "The kitchen", prefix: "HOME" });
  s.make("person:admin", "HOME", { title: "Mop the floor" });
  const mirroredIds = new Set([rover.T]);
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body ?? "{}"));
    const v = path === "/px/have" ? haveOf(rover.p) : path === "/px/missing" ? missingFor(rover.p, body) : receiveFrom(rover.p, body, mirroredIds);
    return new Response(JSON.stringify(v), { status: 200 });
  }) as typeof fetch;
  const own = s.list(true).filter((v) => !v.mirrored).map((v) => v.id);
  const r = await give(site, "http://roverbyteseer:4742", own, { fetch: f });
  assert.ok(r.sent >= 3);
  assert.equal(new Spaces(rover.p).item("HOME-1", true).title, "Mop the floor");
  assert.equal((await give(site, "http://roverbyteseer:4742", own, { fetch: f })).sent, 0, "nothing twice");
  // a change to a mirrored ticket, or a space under Redmine's prefixes, is refused there whatever the site sends
  const sneaky = fresh("intruder");
  sneaky.receive(rover.p.missing({}, {}));
  sneaky.note(sneaky.numbered(rover.T, 10)!.id, "not from Redmine");
  sneaky.makeSpace({ title: "Fake", prefix: "C", form: workForm({ trackers: ["Job"], statuses: [{ name: "Ready", closed: false }], fields: [] }) });
  const events = sneaky.missing(rover.p.have(), {});
  const got = receiveFrom(rover.p, { events }, mirroredIds);
  assert.equal(got.applied, 0);
  assert.equal(got.rejected, events.length);
});

const servers: Server[] = [];
after(() => Promise.all(servers.map((x) => new Promise<void>((r) => { x.closeAllConnections(); x.close(() => r()); }))));

test("the API: anyone reads, a signed-in account or an agent's key changes, and only the site's own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eud-spaces-"));
  writeFileSync(join(dir, "cards.json"), JSON.stringify({ type_colours: {}, cards: {} }));
  const accounts = new Accounts(null, 1 << 10);
  await accounts.open();
  const admin = accounts.byName("admin")!;
  const { secret: key } = await accounts.make(admin, "game", "agent") as { secret: string };
  const { p } = mirrored(), spaces = new Spaces(p);
  spaces.makeSpace("person:admin", { title: "The kitchen", prefix: "HOME" });
  const server = makeServer({ accounts, avatars: new Avatars(join(dir, "cards.json"), dir), web: join(import.meta.dirname, "..", "web"),
                              log: () => {}, spaces });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const agent = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const anyone = await (await fetch(base + "/api/spaces")).json();
  assert.deepEqual(anyone.spaces.map((v: { prefix: string }) => v.prefix), ["T"]);
  assert.equal(anyone.canMake, false);
  const T = await (await fetch(base + "/api/space/T")).json();
  assert.equal(T.rows.length, 2);
  assert.equal(T.canEdit, false);
  assert.equal((await fetch(base + "/api/space/HOME")).status, 404, "not for anyone");
  assert.equal((await (await fetch(base + "/api/item/T-10")).json()).item.title, "Open one");

  assert.equal((await fetch(base + "/api/space/HOME/items", { method: "POST", headers: { "Content-Type": "application/json", Origin: base },
                                                              body: JSON.stringify({ title: "x" }) })).status, 401);
  const made = await fetch(base + "/api/space/HOME/items", { method: "POST", headers: agent, body: JSON.stringify({ title: "Mop the floor", kind: "Bug" }) });
  assert.equal(made.status, 201);
  const { item } = await made.json();
  assert.deepEqual([item.id, item.kind, item.by], ["HOME-1", "bug", "game"]);
  const moved = await (await fetch(base + "/api/item/HOME-1", { method: "POST", headers: agent, body: JSON.stringify({ action: "state", state: "in-progress" }) })).json();
  assert.equal(moved.item.status, "In progress");
  const refused = await fetch(base + "/api/item/T-10", { method: "POST", headers: agent, body: JSON.stringify({ action: "note", text: "hi" }) });
  assert.equal(refused.status, 409);
  const signedIn = await (await fetch(base + "/api/spaces", { headers: { Authorization: `Bearer ${key}` } })).json();
  assert.deepEqual(signedIn.spaces.map((v: { prefix: string }) => v.prefix), ["T", "HOME"]);
  assert.equal(signedIn.canMake, true);
});

test("E-4: a space of the site's own is private until its maker or an admin makes it public, and private again", () => {
  const { p } = mirrored();
  let changed = 0;
  const s = new Spaces(p, { changed: () => changed++ });
  s.makeSpace("person:ada", { title: "Recipes", prefix: "FOOD" });
  assert.equal(s.list(false).some((v) => v.prefix === "FOOD"), false, "off unless chosen");
  const own = s.space("FOOD", true), t = s.space("T", true);
  assert.equal(s.canReach(own, "person:ada", false), true);
  assert.equal(s.canReach(own, "person:bob", false), false);
  assert.equal(s.canReach(own, "person:bob", true), true, "an admin may");
  assert.equal(s.canReach(t, "person:bob", true), false, "a mirrored space is THE DASHBOARD's");
  assert.throws(() => s.setReach("person:bob", "FOOD", true, false), /maker or an admin/);
  assert.throws(() => s.setReach("person:admin", "T", true, true), /Redmine's/);
  const before = changed;
  assert.equal(s.setReach("person:ada", "FOOD", true, false).reach, "public");
  assert.ok(s.list(false).some((v) => v.prefix === "FOOD"));
  assert.doesNotThrow(() => s.space("FOOD", false));
  s.setReach("person:ada", "FOOD", true, false);
  assert.equal(changed, before + 1, "the same choice again writes nothing");
  assert.equal(s.setReach("person:admin", "FOOD", false, true).reach, "home");
  assert.throws(() => s.space("FOOD", false), /No space FOOD/);
});
