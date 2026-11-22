// E-12: WORKING MEMORY for the agents (the user, 2026-11-22: "there should be a project which represents the working
// memory of daemon"; by multiple choice, every daemon, one form). Each lane's daemon keeps what it has in mind now --
// what a session's handoff holds (in flight, waiting on the user, next) -- in a space of the form daemons-praxis carries
// (WORKING_MEMORY, C-469): about seven things, each about one thing and rewritten when it changes, the least rehearsed let
// go when a new one comes. tools/tickets.py writes it as the lane (`tickets.py mind`), proving the lane with its own
// Redmine key; the lane's page (E-6) and its tile on THE DASHBOARD show it, to someone signed in only.
//
// Never public: a handoff carries private material, so the space's reach is HOME and stays so -- it goes to the always-on
// replica with the site's own spaces (replica.ts) and is never offered to anything public.
import { px, type Praxis, type Space } from "./praxis.ts";
import { LANES } from "./redmine.ts";

export type Held = { id: string; words: string; about: string; from: string | null; at: string };
/** a lane's space is known by this title */
export const titleOf = (lane: string) => `Working memory: ${lane}`;
const PREFIX = "HELD", ABOUT_MOST = 120, WORDS_MOST = 400;
export const isLane = (s: string): boolean => (LANES as readonly string[]).includes(s);

export class Minds {
  private readonly p: Praxis;
  private readonly o: { changed?: () => void };
  constructor(p: Praxis, o: { changed?: () => void } = {}) { this.p = p; this.o = o; }

  private spaceOf(lane: string): Space | null {
    return this.p.spaces().find((s) => s.title === titleOf(lane) && s.form?.name === px.WORKING_MEMORY.name && !s.archived) ?? null;
  }
  /** every lane's space, by id (the always-on replica is given them, replica.ts) */
  ids(): string[] { return this.p.spaces().filter((s) => s.form?.name === px.WORKING_MEMORY.name && !s.archived).map((s) => s.id); }

  /** what a lane has in mind, the most lately rehearsed first */
  held(lane: string): Held[] {
    const s = this.spaceOf(lane);
    return s ? px.inMind(this.p, s.id).map((it) => ({ id: it.id, words: it.title, about: String(it.fields.about ?? ""),
      from: typeof it.fields.from === "string" ? it.fields.from : null, at: String(it.fields.rehearsed ?? it.made) })) : [];
  }

  /** a thing held for a lane, written as the lane: rewritten if it is about something held already */
  hold(lane: string, words: string, o: { about?: string; from?: string } = {}): Held[] {
    const w = String(words).replace(/\s+/g, " ").trim().slice(0, WORDS_MOST);
    if (!w) throw new Error("nothing to hold");
    const actor = `lane:${lane}`;
    let s = this.spaceOf(lane);
    if (!s) s = this.p.space(this.p.makeSpace({ title: titleOf(lane), prefix: PREFIX, form: px.WORKING_MEMORY, reach: "home", actor }))!;
    px.hold(this.p, s.id, w, { about: o.about ? String(o.about).slice(0, ABOUT_MOST) : undefined,
                               from: o.from ? String(o.from).slice(0, 40) : undefined, actor });
    this.o.changed?.();
    return this.held(lane);
  }

  /** let go: one thing, by what it is about, or (none named) everything the lane holds */
  letGo(lane: string, about?: string): Held[] {
    const s = this.spaceOf(lane);
    if (s) {
      const going = about === undefined ? undefined : this.held(lane).find((h) => h.about === about)?.id;
      if (about === undefined || going) px.letGo(this.p, s.id, going, { actor: `lane:${lane}` });
      this.o.changed?.();
    }
    return this.held(lane);
  }
}

/** E-12: which lane a Redmine key is -- its user named "Lane <lane>" -- asked of Redmine once and kept a while, so a
 *  session writes as its lane with the key it already holds, and no other */
export function laneKeys(url: string, o: { fetch?: typeof fetch; ttl?: number; now?: () => number } = {}) {
  const f = o.fetch ?? fetch, ttl = o.ttl ?? 10 * 60_000, now = o.now ?? Date.now;
  const known = new Map<string, { lane: string | null; at: number }>();
  return async (key: string): Promise<string | null> => {
    if (!/^[A-Za-z0-9]{20,64}$/.test(key)) return null;
    const had = known.get(key);
    if (had && now() - had.at < ttl) return had.lane;
    let lane: string | null = null;
    try {
      const r = await f(url.replace(/\/+$/, "") + "/users/current.json", { headers: { "X-Redmine-API-Key": key }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const login = String(((await r.json()) as { user?: { login?: string } }).user?.login ?? "");   // lane-app
        const m = /^lane-([a-z0-9-]{1,20})$/.exec(login);
        lane = m && isLane(m[1]) ? m[1] : null;
      }
      known.set(key, { lane, at: now() });          // Redmine's answer kept; a Redmine away is asked again next time
    } catch { /* Redmine away: not known */ }
    return lane;
  };
}
