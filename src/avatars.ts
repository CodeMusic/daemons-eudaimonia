// C-436: an account's avatar is a daemon, picked from a list grouped by type -- the seventeen types of the chart, each
// in its own colour, as a daemon is coloured by its type (DAEMONS' vision.md 9.4). The INDEX's categories are nearly
// one to a daemon (386 for 398), so they do not group; the types do. Read from the companion's INDEX cards
// (daemons-companion server/data/index_cards.json, written by DAEMONS' companion_export.py), the sprites from DAEMONS'
// own gfx/daemons -- ours, never Nintendo's. Nothing is copied into this repository.
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

export type Daemon = { id: number; number: string; name: string; types: string[]; category: string; front: string };
export type Group = { type: string; colour: string; daemons: Omit<Daemon, "front">[] };

type Card = { number: string; name: string; types: string[]; category: string; art: { front: string } };

export class Avatars {
  readonly groups: Group[];
  private readonly byId = new Map<number, Daemon>();
  private readonly daemonsRoot: string;

  /** `cards` is index_cards.json; `daemonsRoot` the DAEMONS checkout its art paths are relative to. */
  constructor(cards: string, daemonsRoot: string) {
    this.daemonsRoot = daemonsRoot;
    const data = existsSync(cards) ? JSON.parse(readFileSync(cards, "utf8")) : { cards: {}, type_colours: {} };
    const colours: Record<string, string> = data.type_colours ?? {};
    const grouped = new Map<string, Daemon[]>();
    for (const [key, c] of Object.entries(data.cards ?? {}) as [string, Card][]) {
      if (!c?.name || !c.art?.front || !c.types?.length) continue;
      const d: Daemon = { id: Number(key), number: c.number, name: c.name, types: c.types, category: c.category, front: c.art.front };
      this.byId.set(d.id, d);
      const t = c.types[0];
      grouped.set(t, [...(grouped.get(t) ?? []), d]);
    }
    // the chart's order (type_colours lists the types as the game does), then any it does not name
    const order = [...Object.keys(colours), ...[...grouped.keys()].filter((t) => !(t in colours))];
    this.groups = order.filter((t) => grouped.has(t)).map((t) => ({
      type: t, colour: colours[t] ?? "#4a4a4a",
      daemons: (grouped.get(t) ?? []).sort((a, b) => a.number.localeCompare(b.number))
        .map(({ front: _front, ...rest }) => rest),
    }));
  }

  get count() { return this.byId.size; }
  has(id: number) { return this.byId.has(id); }
  daemon(id: number) { return this.byId.get(id) ?? null; }

  /** The front sprite's file, or null: only a path the INDEX names, inside DAEMONS' gfx/daemons. */
  sprite(id: number): string | null {
    const d = this.byId.get(id);
    if (!d) return null;
    const p = normalize(join(this.daemonsRoot, d.front));
    return p.startsWith(normalize(join(this.daemonsRoot, "gfx", "daemons")) + "/") && existsSync(p) ? p : null;
  }
}
