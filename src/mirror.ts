// E-9: Redmine mirrored into PRAXIS, read-only (companion docs/PROJECTS.md 10; the user, 2026-11-22, by multiple choice:
// a mirror, then one cut-over, with no bridge both ways). Each of our three projects is a SPACE made from the WORK form
// (work.ts); each ticket an item that keeps its id as its handle (T-581 is item 581 of the space whose prefix is T); each
// journal's words a note that keeps its own time and author; each relation a link. Finishing a ticket pays its lane the
// kind's ARETE, once, as PRAXIS pays anything (the award's actor is the lane it was assigned to).
//
// It only reads Redmine and only writes PRAXIS, and it is the only writer of these spaces: one replica runs it (on
// roverbyteseer, beside Redmine) and the rest receive what it made. A run asks Redmine only for what changed since the
// newest ticket the spaces hold, and writes only what differs, so running it twice changes nothing the second time.
import { type Item, type Praxis, type Space } from "./praxis.ts";
import { PROJECTS } from "./redmine.ts";
import { FORM_NAME, fieldName, kindName, sameForm, stateName, workForm, type Lists } from "./work.ts";

type User = { id: number; name: string };
type Journal = { id: number; user: User; notes?: string | null; created_on: string };
type Relation = { id: number; issue_id: number; issue_to_id: number; relation_type: string };
export type Issue = {
  id: number; subject: string; description?: string | null; project: { id: number; name: string };
  tracker: { id: number; name: string }; status: { id: number; name: string }; priority?: { id: number; name: string };
  author?: User; assigned_to?: User; custom_fields?: { id: number; name: string; value: unknown }[];
  created_on: string; updated_on: string; closed_on?: string | null; journals?: Journal[]; relations?: Relation[];
};
/** a GET of Redmine's API, answering its JSON */
export type Get = <T>(path: string) => Promise<T>;
export type Ran = { at: string; listed: number; made: number; changed: number; notes: number; links: number; skipped: string[] };

/** who wrote what the mirror itself writes */
export const MIRROR = "mirror";
const FETCH_AT_ONCE = 6;

/** a Redmine user as PRAXIS's actor: a lane by its name (lane:app), the sessions as such, anyone else by number only */
export function actorOf(u: User | null | undefined): string {
  if (!u) return MIRROR;
  if (/^Lane /.test(u.name)) return `lane:${u.name.slice(5)}`;
  return u.name === "Claude sessions" ? "sessions" : `redmine:${u.id}`;
}
const laneOf = (u: User | undefined) => (u && /^Lane /.test(u.name) ? u.name.slice(5) : null);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class Mirror {
  readonly px: Praxis;
  private readonly get: Get;
  private readonly log: (line: string) => void;
  /** the tickets it could not bring in, at the update it saw them at: not read again until they move */
  private readonly passed = new Map<number, string>();
  constructor(px: Praxis, get: Get, o: { log?: (line: string) => void } = {}) {
    this.px = px; this.get = get; this.log = o.log ?? (() => {});
  }

  /** the mirrored spaces, by project (daemons, companion, eudaimonia) -- those that exist yet */
  spaces(): Map<string, Space> {
    const out = new Map<string, Space>();
    for (const p of PROJECTS) {
      const s = this.px.spaces().find((x) => x.prefix === p.prefix && x.form?.name === FORM_NAME);
      if (s) out.set(p.ident, s);
    }
    return out;
  }

  /** One run: what changed in Redmine since the last, brought in. */
  async run(): Promise<Ran> {
    const ran: Ran = { at: new Date().toISOString(), listed: 0, made: 0, changed: 0, notes: 0, links: 0, skipped: [] };
    const had = this.spaces();
    // what changed, per project: the newest ticket a space holds says where the last run reached
    const changed = new Map<string, Issue[]>();
    for (const p of PROJECTS) {
      const s = had.get(p.ident), since = s ? this.since(s.id) : null;
      changed.set(p.ident, await this.list(p.ident, since));
      ran.listed += changed.get(p.ident)!.length;
    }
    // the form, from Redmine's lists and every field a changed ticket carries (and every one the form had)
    const fields = new Set<string>();
    for (const s of had.values()) for (const k of Object.values(s.form?.kinds ?? {})) for (const f of Object.values(k.fields ?? {})) fields.add(f.title ?? "");
    for (const list of changed.values()) for (const i of list) for (const f of i.custom_fields ?? []) fields.add(f.name);
    const form = workForm({ ...(await this.lists()), fields: [...fields].filter((f) => f && !OWN_TITLES.has(f)) });
    const spaces = new Map<string, Space>();
    for (const p of PROJECTS) {
      let s = had.get(p.ident);
      if (!s) {
        s = this.px.space(this.px.makeSpace({ title: p.name, prefix: p.prefix, form, reach: "home", actor: MIRROR }))!;
        this.log(`made the space ${p.name} (${p.prefix}-)`);
      } else if (!sameForm(s.form, form)) {
        this.px.adopt(s.id, { ...form, version: (s.form?.version ?? 0) + 1 }, { actor: MIRROR });
        s = this.px.space(s.id)!;
        this.log(`${p.name} takes the WORK form's version ${s.form?.version}`);
      }
      spaces.set(p.ident, s);
    }
    const byId = this.byRedmineId(spaces);
    const full: Issue[] = [];
    for (const p of PROJECTS) {
      // a ticket listed again only because it sits at the edge of the last run (its update is the newest one held) is
      // the same ticket: its journals cannot have moved without its update moving too, so it is not read again
      const list = changed.get(p.ident)!.filter((i) => byId.get(i.id)?.fields.updated !== i.updated_on && this.passed.get(i.id) !== i.updated_on);
      for (let at = 0; at < list.length; at += 100) {
        const page = await this.fetchAll(list.slice(at, at + 100).map((i) => i.id));
        this.px.transaction(() => { for (const i of page) this.apply(i, p, spaces.get(p.ident)!, byId, ran); });
        full.push(...page);
      }
    }
    this.px.transaction(() => { for (const i of full) this.relate(i, byId, ran); });
    return ran;
  }

  // ---- inside ---------------------------------------------------------------------------------------------------------

  /** the newest Redmine update a space holds, or null when it holds none */
  private since(space: string): string | null {
    let at: string | null = null;
    for (const it of this.px.items(space)) { const u = it.fields.updated; if (typeof u === "string" && (!at || u > at)) at = u; }
    return at;
  }

  private byRedmineId(spaces: Map<string, Space>) {
    const m = new Map<number, Item>();
    for (const s of spaces.values()) for (const it of this.px.items(s.id, { archived: false }))
      if (typeof it.fields.redmine === "number") m.set(it.fields.redmine, it);
    return m;
  }

  /** every ticket of a project updated at or after `since` (all of them, without), with its custom fields */
  private async list(project: string, since: string | null): Promise<Issue[]> {
    const out: Issue[] = [];
    const when = since ? `&updated_on=${encodeURIComponent(">=" + since)}` : "";
    for (let offset = 0; ; offset += 100) {
      const r = await this.get<{ issues: Issue[]; total_count: number }>(
        `/issues.json?project_id=${project}&subproject_id=!*&status_id=*&sort=updated_on,id&limit=100&offset=${offset}${when}`);
      out.push(...r.issues);
      if (offset + 100 >= r.total_count || !r.issues.length) break;
    }
    return out;
  }

  /** each ticket whole, with its journals and relations, a few at a time, in the order asked */
  private async fetchAll(ids: number[]): Promise<Issue[]> {
    const out: Issue[] = new Array(ids.length);
    let next = 0;
    const worker = async () => {
      for (let k = next++; k < ids.length; k = next++)
        out[k] = (await this.get<{ issue: Issue }>(`/issues/${ids[k]}.json?include=journals,relations`)).issue;
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_AT_ONCE, ids.length) }, worker));
    return out;
  }

  private async lists(): Promise<Omit<Lists, "fields">> {
    const t = await this.get<{ trackers: { name: string }[] }>("/trackers.json");
    const s = await this.get<{ issue_statuses: { name: string; is_closed?: boolean }[] }>("/issue_statuses.json");
    return { trackers: t.trackers.map((x) => x.name), statuses: s.issue_statuses.map((x) => ({ name: x.name, closed: !!x.is_closed })) };
  }

  /** what a ticket says, as the WORK form's fields */
  private wanted(i: Issue): Record<string, unknown> {
    const want: Record<string, unknown> = {
      description: i.description ?? "", priority: i.priority?.name ?? null, lane: laneOf(i.assigned_to),
      author: actorOf(i.author), tracker: i.tracker.name, redmine: i.id,
      opened: i.created_on, updated: i.updated_on, closed: i.closed_on ?? null,
    };
    for (const f of i.custom_fields ?? []) {
      const k = fieldName(f.name);
      let v: unknown = Array.isArray(f.value) ? f.value.join(", ") : f.value;
      if (v === "" || v === undefined) v = null;
      if (k === "order") v = v == null || !Number.isFinite(Number(v)) ? null : Number(v);
      want[k] = v;
    }
    return want;
  }

  private apply(i: Issue, p: (typeof PROJECTS)[number], space: Space, byId: Map<number, Item>, ran: Ran) {
    const ticket = i.custom_fields?.find((f) => f.name === "Ticket")?.value;
    const m = typeof ticket === "string" ? /^([A-Z]+)-(\d+)$/.exec(ticket) : null;
    if (!m || m[1] !== p.prefix) { this.pass(i, ran, `#${i.id} (${ticket ?? "no Ticket field"})`); return; }
    const kind = kindName(i.tracker.name), state = stateName(i.status.name);
    const title = i.subject.startsWith(ticket + " ") ? i.subject.slice(String(ticket).length + 1) : i.subject;
    const want = this.wanted(i);
    const finisher = actorOf(i.assigned_to);
    const k = space.form?.kinds[kind];
    if (!k || !k.states.some((s) => s.name === state)) { this.pass(i, ran, `${ticket} (a ${i.tracker.name} ${i.status.name})`); return; }

    let it = byId.get(i.id) ?? null;
    if (it && it.home !== space.id) {                // moved to another project: the old one archived, a new one made
      this.px.archive(it.id, true, { actor: MIRROR });
      byId.delete(i.id);
      it = null;
    }
    if (!it) {
      const made: Record<string, unknown> = { title };
      for (const [f, v] of Object.entries(want)) if (v !== null) made[f] = v;
      let id: string;
      try { id = this.px.make(space.id, kind, made as { title: string }, { number: Number(m[2]), actor: MIRROR }); }
      catch (e) { this.pass(i, ran, `${ticket} (${(e as Error).message})`); return; }
      if (state !== k.states[0].name) this.px.state(id, state, { actor: this.phase(space, kind, state) === "done" ? finisher : MIRROR });
      it = this.px.item(id)!;
      byId.set(i.id, it);
      ran.made++;
    } else {
      let moved = false;
      if (it.title !== title) { this.px.set(it.id, "title", title, { actor: MIRROR }); moved = true; }
      for (const [f, v] of Object.entries(want))
        if (!same(it.fields[f], v)) { this.px.set(it.id, f, v, { actor: MIRROR }); moved = true; }
      if (it.state !== state) {
        this.px.state(it.id, state, { actor: this.phase(space, kind, state) === "done" ? finisher : MIRROR });
        moved = true;
      }
      if (moved) { it = this.px.item(it.id)!; byId.set(i.id, it); ran.changed++; }
    }
    // the journals' words, each once, with its own time and author
    const kept = new Set(this.px.notes(it.id).map((n) => `${n.at}\u0000${n.text}`));
    for (const j of i.journals ?? []) {
      if (!j.notes?.trim()) continue;
      const key = `${j.created_on}\u0000${j.notes}`;
      if (kept.has(key)) continue;
      this.px.note(it.id, j.notes, { at: j.created_on, actor: actorOf(j.user) });
      kept.add(key);
      ran.notes++;
    }
  }

  private pass(i: Issue, ran: Ran, why: string) { ran.skipped.push(why); this.passed.set(i.id, i.updated_on); }

  private phase(space: Space, kind: string, state: string) {
    return space.form?.kinds[kind]?.states.find((s) => s.name === state)?.phase ?? null;
  }

  /** Redmine's relations as links, each once, from the side PRAXIS reads it from: "A precedes B" is B follows A */
  private relate(i: Issue, byId: Map<number, Item>, ran: Ran) {
    for (const r of i.relations ?? []) {
      const a = byId.get(r.issue_id), b = byId.get(r.issue_to_id);
      if (!a || !b) continue;
      const [from, type, to] =
        r.relation_type === "blocks" ? [a, "blocks", b] as const
        : r.relation_type === "precedes" ? [b, "follows", a] as const
        : r.relation_type === "copied_to" ? [b, "made-from", a] as const
        : [a, "relates", b] as const;                // relates, duplicates
      if (this.px.links(from.id, type).some((l) => l.to === to.id)) continue;
      this.px.link(from.id, type, to.id, { actor: MIRROR });
      ran.links++;
    }
  }
}

/** Redmine's API, read with a lane's key -- a GET, and only a GET */
export function redmineGet(url: string, key: string, o: { fetch?: typeof fetch; timeout?: number } = {}): Get {
  const base = url.replace(/\/+$/, ""), f = o.fetch ?? fetch;
  return async <T>(path: string): Promise<T> => {
    const r = await f(base + path, { method: "GET", headers: { "X-Redmine-API-Key": key, Accept: "application/json" },
                                     signal: AbortSignal.timeout(o.timeout ?? 30_000) });
    if (!r.ok) throw new Error(`Redmine answered ${r.status} to ${path.split("?")[0]}`);
    return (await r.json()) as T;
  };
}

/** the titles of the fields every ticket has (work.ts), which are not custom fields */
const OWN_TITLES = new Set(["Description", "Priority", "Lane", "Author", "Tracker", "Redmine's id", "Opened", "Updated", "Closed"]);
