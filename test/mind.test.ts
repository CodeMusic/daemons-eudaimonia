// E-12: WORKING MEMORY for the agents -- each lane's daemon keeps what it has in mind, written as the lane (its own
// Redmine key), never public, and given to the always-on replica with the site's own spaces.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { px, type Db } from "../src/praxis.ts";
import { laneKeys, Minds, titleOf } from "../src/mind.ts";
import { receiveFrom } from "../src/replica.ts";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { makeServer } from "../src/server.ts";

const fresh = () => new px.Praxis(new DatabaseSync(":memory:") as unknown as Db, { actor: "eudaimonia" });
const servers: Server[] = [];
after(() => { for (const s of servers) { s.close(); s.closeAllConnections(); } });

test("a lane holds about seven, each about one thing, written as the lane and never public", () => {
  const p = fresh();
  let changed = 0;
  const m = new Minds(p, { changed: () => changed++ });
  assert.deepEqual(m.held("app"), []);
  assert.deepEqual(m.ids(), []);
  m.hold("app", "In flight: C-469's form", { about: "in-flight", from: "handoff" });
  m.hold("app", "In flight: C-469 on the hub", { about: "in-flight", from: "handoff" });
  m.hold("app", "Waiting on the user: C-406");
  assert.deepEqual(m.held("app").map((h) => h.words).sort(), ["In flight: C-469 on the hub", "Waiting on the user: C-406"]);
  for (let i = 0; i < 9; i++) m.hold("app", `next ${i}`);
  assert.equal(m.held("app").length, px.SPAN);
  const s = p.spaces().find((x) => x.title === titleOf("app"))!;
  assert.equal(s.reach, "home");
  assert.equal(p.item(m.held("app")[0].id)!.maker, "lane:app");
  assert.deepEqual(m.held("game"), [], "each lane its own");
  assert.equal(m.letGo("app", "next 8").length, px.SPAN - 1);
  assert.deepEqual(m.letGo("app"), []);
  assert.ok(changed >= 13);
  assert.deepEqual(m.ids(), [s.id]);
  assert.throws(() => m.hold("app", "   "), /nothing/);
});

test("the always-on replica takes a lane's mind, as it takes the site's own spaces", () => {
  const p = fresh(), m = new Minds(p);
  m.hold("docs", "Next: the wiki");
  const there = fresh();
  const r = receiveFrom(there, { events: p.missing({}, { reaches: ["home"] }) }, new Set());
  assert.equal(r.rejected, 0);
  assert.deepEqual(new Minds(there).held("docs").map((h) => h.words), ["Next: the wiki"]);
});

test("a Redmine key is its lane, asked once; another's key or none is no lane", async () => {
  let asked = 0;
  const users: Record<string, string> = { ["a".repeat(40)]: "lane-app", ["b".repeat(40)]: "admin", ["c".repeat(40)]: "lane-nowhere" };
  const f = (async (_u: string, init: { headers: Record<string, string> }) => {
    asked++;
    const login = users[init.headers["X-Redmine-API-Key"]];
    return login ? new Response(JSON.stringify({ user: { login } })) : new Response("", { status: 401 });
  }) as unknown as typeof fetch;
  const laneOf = laneKeys("http://redmine", { fetch: f });
  assert.equal(await laneOf("a".repeat(40)), "app");
  assert.equal(await laneOf("a".repeat(40)), "app");
  assert.equal(asked, 1, "kept a while");
  assert.equal(await laneOf("b".repeat(40)), null);
  assert.equal(await laneOf("c".repeat(40)), null, "not one of the lanes");
  assert.equal(await laneOf("d".repeat(40)), null);
  assert.equal(await laneOf("short"), null);
});

test("the API: only the lane itself writes or reads its mind, with its own key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eud-mind-"));
  writeFileSync(join(dir, "cards.json"), JSON.stringify({ type_colours: {}, cards: {} }));
  const accounts = new Accounts(null, 1 << 10);
  await accounts.open();
  const minds = new Minds(fresh());
  const APP = "k".repeat(40), GAME = "g".repeat(40);
  const server = makeServer({ accounts, avatars: new Avatars(join(dir, "cards.json"), dir), web: join(import.meta.dirname, "..", "web"),
                              log: () => {}, minds, laneOf: async (k) => (k === APP ? "app" : k === GAME ? "game" : null) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const as = (key: string) => ({ "X-Redmine-Key": key, "Content-Type": "application/json" });

  const held = await fetch(base + "/api/mind/app", { method: "POST", headers: as(APP), body: JSON.stringify({ hold: "Next: E-12", about: "next", from: "handoff" }) });
  assert.equal(held.status, 200);
  assert.deepEqual((await held.json()).held.map((h: { words: string }) => h.words), ["Next: E-12"]);
  assert.equal((await (await fetch(base + "/api/mind/app", { headers: as(APP) })).json()).held[0].about, "next");
  assert.equal((await fetch(base + "/api/mind/app", { method: "POST", headers: as(GAME), body: JSON.stringify({ hold: "x" }) })).status, 403, "another lane");
  assert.equal((await fetch(base + "/api/mind/app")).status, 403, "no key");
  assert.equal((await fetch(base + "/api/mind/app", { method: "POST", headers: as(APP), body: JSON.stringify({}) })).status, 400);
  const gone = await (await fetch(base + "/api/mind/app", { method: "POST", headers: as(APP), body: JSON.stringify({ letGo: true }) })).json();
  assert.deepEqual(gone.held, []);
});
