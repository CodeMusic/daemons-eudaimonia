// C-437's server half: finding the release and its patches in DAEMONS' ROM RELEASE/, the first password from the
// private note, and the patcher the egg's page runs (web/bps.js) -- on patches made here, never a real cart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Egg, firstEggPassword } from "../src/egg.ts";
import { applyBps, crc32Hex } from "../web/bps.js";
import { makeBps, releases } from "./fixtures.ts";

test("the newest release with both editions, and its patches read from their own last bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "eudaimonia-releases-"));
  const r = releases(root), egg = new Egg(root);
  assert.equal(egg.latest()?.name, "v11.411.1");
  assert.deepEqual(egg.all().map((x) => x.name), ["v11.411.x", "v11.411.2", "v11.411.1", "v11.410.x"]);   // a group folder too
  const p = egg.patches();
  assert.deepEqual(p.map((x) => [x.edition, x.fits]), [["content", "FireRed Rev 1"], ["context", "LeafGreen 1.0"]]);
  assert.equal(p[0].source, crc32Hex(r.firered));
  assert.equal(p[0].target, crc32Hex(r.content));
  const carts = egg.carts();
  assert.equal(carts.release, "v11.411.1");
  assert.deepEqual(carts.carts.map((c) => [c.name, c.cart, c.patches.length]), [["CONTENT", "FIRERED", 1], ["CONTEXT", "LEAFGREEN", 1]]);
  assert.ok(egg.patch("v11.411.1", "DAEMONS CONTENT for FireRed Rev 1.bps"));
  assert.equal(egg.patch("v11.411.1", "notes.txt"), null);
  assert.equal(egg.patch("v11.411.1", "../daemonsContent.gba"), null);
  assert.equal(egg.patch("v9.9.9", "DAEMONS CONTENT for FireRed Rev 1.bps"), null);
  assert.equal(new Egg(join(root, "nowhere")).latest(), null);
});

test("the patcher makes our ROM from the player's own, and refuses anything else", () => {
  const root = mkdtempSync(join(tmpdir(), "eudaimonia-releases-"));
  const r = releases(root);
  const patch = makeBps(r.firered, r.content);
  assert.deepEqual(applyBps(r.firered, patch), r.content);
  assert.throws(() => applyBps(r.leafgreen, patch), /not the ROM the patch was made for/);
  const damaged = patch.slice(); damaged[40] ^= 1;
  assert.throws(() => applyBps(r.firered, damaged), /damaged/);
  assert.throws(() => applyBps(r.firered, new Uint8Array(20)), /not a BPS patch/);
});

test("the first password is read from the private note's own line, and nothing shorter", () => {
  assert.equal(firstEggPassword("- **The password's first value: `door-in-the-wall`** (someone, 2026)"), "door-in-the-wall");
  assert.equal(firstEggPassword("first value: `abc`"), null);
  assert.equal(firstEggPassword("no such line"), null);
});
