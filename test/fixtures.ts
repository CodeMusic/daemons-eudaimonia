// What the egg's tests are given: a ROM RELEASE/ of made-up releases, and BPS patches made here -- never a real cart.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "../web/bps.js";

/** A BPS1 patch, as tools/bps.py writes one: the bytes both share read from the source, the rest given. */
export function makeBps(source: Uint8Array, target: Uint8Array): Uint8Array {
  const out: number[] = [];
  const varint = (n: number) => { for (;;) { const x = n & 0x7f; n = Math.floor(n / 128); if (!n) { out.push(0x80 | x); return; } out.push(x); n -= 1; } };
  const word = (n: number) => out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  out.push(..."BPS1".split("").map((c) => c.charCodeAt(0)));
  varint(source.length); varint(target.length); varint(0);
  let same = 0;
  while (same < target.length && same < source.length && source[same] === target[same]) same++;
  if (same) varint(((same - 1) << 2) | 0);
  if (same < target.length) { varint(((target.length - same - 1) << 2) | 1); out.push(...target.subarray(same)); }
  word(crc32(source)); word(crc32(target));
  word(crc32(Uint8Array.from(out)));
  return Uint8Array.from(out);
}

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

export function releases(root: string) {
  const firered = bytes(4096, 1), leafgreen = bytes(4096, 2);
  const content = Uint8Array.from(firered, (b, i) => (i > 2000 ? b ^ 0x5a : b)), context = Uint8Array.from(leafgreen, (b, i) => (i > 1000 ? b ^ 0x33 : b));
  const put = (dir: string, files: Record<string, Uint8Array | string>) => {
    mkdirSync(join(dir, "PATCHES"), { recursive: true });
    for (const [name, v] of Object.entries(files)) writeFileSync(join(dir, name), v);
  };
  put(join(root, "v11.410.x"), { "daemonsContent.gba": "old", "daemonsContext.gba": "old" });             // sealed
  put(join(root, "v11.411.x", "v11.411.1"), {
    "daemonsContent.gba": content, "daemonsContext.gba": context, "RELEASE_NOTES.md": "# v11.411.1\n",
    "PATCHES/DAEMONS CONTENT for FireRed Rev 1.bps": makeBps(firered, content),
    "PATCHES/DAEMONS.CONTEXT.for.LeafGreen.1.0.bps": makeBps(leafgreen, context),
    "PATCHES/notes.txt": "not a patch",
  });
  put(join(root, "v11.411.x", "v11.411.2"), { "daemonsContent.gba": "half a release" });                  // no CONTEXT yet
  return { firered, leafgreen, content, context };
}
