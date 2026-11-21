// C-437: THE EASTER EGG -- your cart becomes a DAEMONS cart (the user, 2026-11-20). Every word it shows is a DRAFT.
//
// A hidden spot on THE DASHBOARD asks for a password (accounts.ts keeps it hashed; its first value is seeded at the
// first run from DAEMONS' private notes or $EUDAIMONIA_EGG, never from a repository). Then: which cart do you own?
// FIRERED, LEAFGREEN or BOTH. The others leave, the chosen become CONTENT and CONTEXT, and a cookie remembers them.
// A cart plays in the playground's mGBA player, made one of two ways:
//
//   * YOUR OWN CART: the player's own FireRed or LeafGreen file, patched in the browser by the release's BPS patch.
//     No game is sent, only the patch, which is published with every release anyway. The way for anyone.
//   * THE RELEASE: the release's own ROM, for whoever holds the password and ticks that these are backups of carts
//     they own (the user: "THE password is more for my ease of use"). Sent only with the egg's pass.
//
// This reads DAEMONS' ROM RELEASE/ at the moment it is asked -- the newest release that has both editions, as the
// playground does (server/playground.py) -- and keeps nothing of it.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export type Edition = "content" | "context";
export const EDITIONS: Record<Edition, { rom: string; name: string; cart: string; game: string }> = {
  content: { rom: "daemonsContent", name: "CONTENT", cart: "FIRERED", game: "FireRed" },
  context: { rom: "daemonsContext", name: "CONTEXT", cart: "LEAFGREEN", game: "LeafGreen" },
};
export const isEdition = (v: unknown): v is Edition => v === "content" || v === "context";

/** A release's BPS patch: what it fits, and the CRC32s it checks (its last twelve bytes: source, target, itself). */
export type Patch = { edition: Edition; file: string; fits: string; source: string; target: string; size: number };

/** v11.306.3 -> [11, 306, 3]; a sealed group, v11.305.x, holds that bible's last release: after all its numbers. */
function versionKey(name: string): number[] | null {
  const m = /^v(\d+)\.(\d+)\.(\d+|x)$/.exec(name);
  return m ? [Number(m[1]), Number(m[2]), m[3] === "x" ? 1e6 : Number(m[3])] : null;
}
const newer = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");

export class Egg {
  readonly releases: string;
  constructor(releases: string) { this.releases = releases; }

  /** Every release folder, newest first: a group's own (a sealed one, its ROMs flattened) and each release in it. */
  all(): { name: string; dir: string }[] {
    const found: { name: string; dir: string; key: number[] }[] = [];
    for (const group of isDir(this.releases) ? readdirSync(this.releases) : []) {
      const gdir = join(this.releases, group);
      if (!isDir(gdir)) continue;
      for (const [name, dir] of [[group, gdir], ...readdirSync(gdir).map((r) => [r, join(gdir, r)])]) {
        const key = versionKey(name);
        if (key && isDir(dir)) found.push({ name, dir, key });
      }
    }
    return found.sort((a, b) => newer(b.key, a.key)).map(({ name, dir }) => ({ name, dir }));
  }

  /** The newest release that has both editions' ROMs. */
  latest() {
    return this.all().find((r) => Object.values(EDITIONS).every((e) => isFile(join(r.dir, e.rom + ".gba")))) ?? null;
  }

  rom(edition: Edition) {
    const r = this.latest();
    return r ? { release: r.name, path: join(r.dir, EDITIONS[edition].rom + ".gba") } : null;
  }

  /** The latest release's patches, read from its PATCHES/ (DAEMONS CONTENT for FireRed Rev 1.bps and its kind). */
  patches(release = this.latest()): Patch[] {
    if (!release) return [];
    const dir = join(release.dir, "PATCHES");
    const out: Patch[] = [];
    for (const file of isDir(dir) ? readdirSync(dir).sort() : []) {
      // "DAEMONS CONTENT for FireRed Rev 1.bps" here; GitHub's copy has dots for the spaces
      const m = /^DAEMONS[. ](CONTENT|CONTEXT)[. ]for[. ]([A-Za-z]+)[. ](.+)\.bps$/.exec(file);
      if (!m) continue;
      const path = join(dir, file), size = statSync(path).size;
      if (size < 16) continue;
      const tail = Buffer.alloc(12), fd = openSync(path, "r");
      try { readSync(fd, tail, 0, 12, size - 12); } finally { closeSync(fd); }
      out.push({ edition: m[1].toLowerCase() as Edition, file, fits: `${m[2]} ${m[3].replace(/^Rev\./, "Rev ")}`,
                 source: hex(tail.readUInt32LE(0)), target: hex(tail.readUInt32LE(4)), size });
    }
    return out;
  }

  /** A patch's file, by its release's name and its own: only names this finds listed, so nothing else can be read. */
  patch(release: string, file: string): string | null {
    const r = this.all().find((x) => x.name === release);
    if (!r) return null;
    const dir = join(r.dir, "PATCHES");
    return isDir(dir) && readdirSync(dir).includes(file) && file.endsWith(".bps") && existsSync(join(dir, file)) ? join(dir, file) : null;
  }

  /** What the egg's page is told: the release, and each cart with the patches that make it. */
  carts() {
    const r = this.latest(), patches = this.patches(r);
    return {
      release: r?.name ?? null,
      carts: (Object.keys(EDITIONS) as Edition[]).map((edition) => ({
        edition, name: EDITIONS[edition].name, cart: EDITIONS[edition].cart, game: EDITIONS[edition].game,
        patches: patches.filter((p) => p.edition === edition).map(({ file, fits, source, target, size }) => ({ file, fits, source, target, size })),
      })),
    };
  }
}

/** The egg's first password, from DAEMONS' private note on it: the first `value` on its "first value" line. */
export function firstEggPassword(note: string): string | null {
  return /first value:?\**\s*`([^`\n]{6,})`/i.exec(note)?.[1] ?? null;
}
