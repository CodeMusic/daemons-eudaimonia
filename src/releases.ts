// E-1: THE DASHBOARD's releases -- each one, and what it changed. Read from DAEMONS' ROM RELEASE/ at the moment it is
// asked, through the same walk THE EASTER EGG makes (egg.ts): the current group's releases, each with its
// RELEASE_NOTES.md, and every sealed group, whose notes are one PDF (CLAUDE.md, "Releasing ROMs"). Only names that walk
// finds are ever read, and only their notes: never a ROM, never anything else in the folder.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EDITIONS, type Egg } from "./egg.ts";

export type Release = { name: string; sealed: boolean; date: string | null; notes: boolean; pdf: boolean; editions: string[] };

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

export class Releases {
  private readonly egg: Egg;
  constructor(egg: Egg) { this.egg = egg; }

  /** Every release, newest first; a sealed group stands for the last release under its bible version. */
  list(): Release[] {
    const out: Release[] = [];
    for (const r of this.egg.all()) {
      const sealed = r.name.endsWith(".x");
      const notes = join(r.dir, "RELEASE_NOTES.md"), pdf = join(r.dir, `ReleaseNotes_${r.name}.pdf`);
      const roms = Object.values(EDITIONS).filter((e) => isFile(join(r.dir, e.rom + ".gba")));
      const has = { notes: isFile(notes), pdf: sealed && isFile(pdf) };
      if (!has.notes && !has.pdf && !roms.length) continue;   // the current group, before it is sealed: its releases list themselves
      let date: string | null = null;
      if (has.notes) date = /\*Released (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/.exec(readFileSync(notes, "utf8").slice(0, 400))?.slice(1).filter(Boolean).join(" ") ?? null;
      if (!date && roms.length) date = statSync(join(r.dir, roms[0].rom + ".gba")).mtime.toISOString().slice(0, 10);
      out.push({ name: r.name, sealed, date, ...has, editions: roms.map((e) => e.name) });
    }
    return out;
  }

  /** A release's notes as written (Markdown), or null; and whether a sealed group's PDF is there instead. */
  notes(name: string): { release: Release; text: string | null } | null {
    const release = this.list().find((r) => r.name === name);
    if (!release) return null;
    const dir = this.egg.all().find((r) => r.name === name)!.dir;
    return { release, text: release.notes ? readFileSync(join(dir, "RELEASE_NOTES.md"), "utf8") : null };
  }

  /** A sealed group's notes PDF, by the group's name, or null. */
  pdf(name: string): string | null {
    const r = this.egg.all().find((x) => x.name === name && x.name.endsWith(".x"));
    const p = r && join(r.dir, `ReleaseNotes_${r.name}.pdf`);
    return p && existsSync(p) && isFile(p) ? p : null;
  }
}
