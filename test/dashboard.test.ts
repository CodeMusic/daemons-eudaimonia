// THE DASHBOARD over HTTP (E-1): the board with each lane's daemon, a ticket, the releases and their notes, the
// player's sprite -- for anyone, read-only. A stand-in for Redmine (redmine.test.ts tries the reader itself) and
// made-up releases, on a port of its own.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { Egg } from "../src/egg.ts";
import { Releases } from "../src/releases.ts";
import type { Board, Detail, RedmineReader } from "../src/redmine.ts";
import { makeServer } from "../src/server.ts";
import { releases } from "./fixtures.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da6364f8ffbf1e000502027fa1d4c7d70000000049454e44ae426082", "hex");
const t = (id: string, status: string, lane: string | null) =>
  ({ id, project: "daemons", title: `the ${id}`, status, lane, order: 1, updated: "2026-11-21T10:00:00Z", closed: null });
const lane = (name: string, working = 0) =>
  ({ lane: name, working: working ? [t("T-1", "In progress", name)] : [], next: [], done: [], open: working, last: null });
const BOARD: Board = {
  at: "2026-11-21T10:00:00Z", stale: false, projects: [{ ident: "daemons", name: "DAEMONS", open: 2, closed: 9, working: 1 }],
  lanes: [lane("game", 1), lane("art"), lane("ops")], waiting: [t("T-2", "Needs decision", null)],
};
const stub = { board: async () => BOARD,
  ticket: async (id: string): Promise<Detail | null> => (id === "T-2" ? { ...t("T-2", "Needs decision", null), description: "**T-2**", fields: [], notes: [] } : null),
} as unknown as RedmineReader;

let base = "", servers: Server[] = [], bare = "";

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-dash-"));
  releases(join(dir, "ROM RELEASE"));
  writeFileSync(join(dir, "ROM RELEASE", "v11.410.x", "ReleaseNotes_v11.410.x.pdf"), "%PDF-1.4 made up");
  mkdirSync(join(dir, "DAEMONS", "gfx", "daemons"), { recursive: true });
  writeFileSync(join(dir, "DAEMONS", "gfx", "daemons", "one_front.png"), PNG);
  writeFileSync(join(dir, "cards.json"), JSON.stringify({ type_colours: { GROWTH: "#315231" },
    cards: { "1": { number: "001", name: "ONE", types: ["GROWTH"], category: "FIRST", art: { front: "gfx/daemons/one_front.png" } } } }));
  mkdirSync(join(dir, "art"));
  writeFileSync(join(dir, "art", "player_instinct.png"), PNG);

  const accounts = new Accounts(null, 1 << 10);
  await accounts.open();
  const admin = accounts.byName("admin")!;
  await accounts.make(admin, "game", "agent", false, 1);    // the game lane's daemon is ONE
  await accounts.make(admin, "art", "agent");                // the art lane has an account and no daemon yet
  const egg = new Egg(join(dir, "ROM RELEASE"));
  const avatars = new Avatars(join(dir, "cards.json"), join(dir, "DAEMONS"));
  const web = join(import.meta.dirname, "..", "web");
  const listen = async (s: Server) => { servers.push(s); await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
                                         return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };
  base = await listen(makeServer({ accounts, avatars, egg, web, log: () => {}, redmine: stub, releases: new Releases(egg), art: join(dir, "art") }));
  bare = await listen(makeServer({ accounts, avatars, egg, web, log: () => {} }));   // no key, no releases
});
after(() => Promise.all(servers.map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }))));

test("the board, for anyone: each lane with its agent account's daemon", async () => {
  const r = await fetch(base + "/api/board");
  assert.equal(r.status, 200);
  const { board } = await r.json();
  assert.deepEqual(board.lanes.map((l: { lane: string; account: boolean; daemon: number | null; daemonName: string | null }) =>
    [l.lane, l.account, l.daemon, l.daemonName]), [["game", true, 1, "ONE"], ["art", true, null, null], ["ops", false, null, null]]);
  assert.deepEqual(board.waiting.map((x: { id: string }) => x.id), ["T-2"]);
  const none = await (await fetch(bare + "/api/board")).json();
  assert.equal(none.board, null);
  assert.match(none.why, /no key/);
});

test("a ticket, by its id only", async () => {
  assert.equal((await (await fetch(base + "/api/ticket/T-2")).json()).ticket.description, "**T-2**");
  assert.equal((await fetch(base + "/api/ticket/T-404")).status, 404);
  assert.ok((await fetch(base + "/api/ticket/..%2Fusers")).status >= 400);   // not an id: never reaches the reader
  assert.equal((await fetch(bare + "/api/ticket/T-2")).status, 503);
});

test("the releases, newest first, and each one's notes; a sealed group's PDF", async () => {
  const { releases: list } = await (await fetch(base + "/api/releases")).json();
  assert.deepEqual(list.map((r: { name: string; sealed: boolean; notes: boolean; pdf: boolean }) => [r.name, r.sealed, r.notes, r.pdf]),
                   [["v11.411.2", false, false, false], ["v11.411.1", false, true, false], ["v11.410.x", true, false, true]]);
  const one = await (await fetch(base + "/api/release/v11.411.1")).json();
  assert.equal(one.text, "# v11.411.1\n");
  assert.equal((await fetch(base + "/api/release/v11.999.1")).status, 404);
  const pdf = await fetch(base + "/release/v11.410.x/notes.pdf");
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(await pdf.text(), "%PDF-1.4 made up");
  assert.equal((await fetch(base + "/release/v11.411.1/notes.pdf")).status, 404);   // only a sealed group's
  assert.equal((await fetch(base + "/release/..%2F..%2Fv11.410.x/notes.pdf")).status, 404);
  assert.deepEqual((await (await fetch(bare + "/api/releases")).json()).releases, []);
});

test("the player's sprite, from the companion's art", async () => {
  const r = await fetch(base + "/art/player.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal((await fetch(bare + "/art/player.png")).status, 404);
  assert.equal((await fetch(base + "/art/../accounts.json")).status, 404);
});
