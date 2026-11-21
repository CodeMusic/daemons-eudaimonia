// THE EASTER EGG over HTTP (C-437): the door and its pass, the carts and their patches, and the release's own ROM --
// sent only with the pass and the backups ticked. Made-up releases, on a port of its own.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { Egg } from "../src/egg.ts";
import { makeServer } from "../src/server.ts";
import { applyBps } from "../web/bps.js";
import { releases } from "./fixtures.ts";

let server: Server, base = "", made: ReturnType<typeof releases>;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-egg-"));
  made = releases(join(dir, "ROM RELEASE"));
  const accounts = new Accounts(null, 1 << 10);
  await accounts.open();
  await accounts.seedEgg("a door in the wall", "the test");
  server = makeServer({ accounts, avatars: new Avatars(join(dir, "none.json"), dir), egg: new Egg(join(dir, "ROM RELEASE")),
                        player: 4999, web: join(import.meta.dirname, "..", "web"), log: () => {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(base + path, { method: "POST", body: JSON.stringify(body),
                       headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) } });

test("the front page may frame the playground's page, as the egg's player, and nothing else", async () => {
  const csp = (await fetch(base + "/")).headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-src http:\/\/\*:4999 https:\/\/\*:4999/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch((await fetch(base + "/api/egg/carts")).headers.get("content-security-policy") ?? "", /frame-src/);
});

test("the carts, their patches and the player's port; no pass yet", async () => {
  const r = await (await fetch(base + "/api/egg/carts")).json();
  assert.equal(r.release, "v11.411.1");
  assert.equal(r.pass, false);
  assert.equal(r.player, 4999);
  assert.deepEqual(r.carts.map((c: { edition: string; cart: string }) => [c.edition, c.cart]), [["content", "FIRERED"], ["context", "LEAFGREEN"]]);
});

test("a player's own cart: the patch is served, and makes our ROM from theirs", async () => {
  const r = await fetch(`${base}/egg/patch/v11.411.1/${encodeURIComponent("DAEMONS CONTENT for FireRed Rev 1.bps")}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") ?? "", /immutable/);
  assert.deepEqual(applyBps(made.firered, new Uint8Array(await r.arrayBuffer())), made.content);
  assert.equal((await fetch(`${base}/egg/patch/v11.411.1/notes.txt`)).status, 404);
  assert.equal((await fetch(`${base}/egg/patch/v11.411.1/..%2FdaemonsContent.gba`)).status, 404);
  assert.equal((await fetch(`${base}/egg/patch/v11.411.1/..%2F..%2Fv11.411.1%2FPATCHES%2Fx.bps`)).status, 404);
  assert.equal((await fetch(`${base}/egg/patch/v11.411.1/%E0%A4%A.bps`)).status, 404);   // not a name at all
});

test("the release's own ROM: the password first, then the backups ticked", async () => {
  assert.equal((await post("/api/egg/rom", { edition: "content", agreed: true })).status, 401);
  const wrong = await post("/api/egg/open", { password: "a door" });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "That isn't it.");
  const open = await post("/api/egg/open", { password: "a door in the wall" });
  assert.equal(open.status, 200);
  const cookie = (open.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^eudaimonia-egg=/);
  assert.match(open.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);
  assert.equal((await (await fetch(base + "/api/egg/carts", { headers: { Cookie: cookie } })).json()).pass, true);

  assert.equal((await post("/api/egg/rom", { edition: "content" }, cookie)).status, 400);           // not ticked
  assert.equal((await post("/api/egg/rom", { edition: "debug", agreed: true }, cookie)).status, 400);
  const rom = await post("/api/egg/rom", { edition: "context", agreed: true }, cookie);
  assert.equal(rom.status, 200);
  assert.equal(rom.headers.get("x-release"), "v11.411.1");
  assert.deepEqual(new Uint8Array(await rom.arrayBuffer()), made.context);

  // another site's page cannot ask for it with this browser's pass
  const forged = await fetch(base + "/api/egg/rom", { method: "POST", body: JSON.stringify({ edition: "content", agreed: true }),
    headers: { "Content-Type": "application/json", Origin: "http://evil.example.com", Cookie: cookie } });
  assert.equal(forged.status, 403);
});
