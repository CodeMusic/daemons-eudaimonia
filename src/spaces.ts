// E-10: the tickets in EUDAIMONIA -- every space PRAXIS holds, as a list, a board and a roadmap, a ticket's page with its
// whole history, and editing (companion docs/PROJECTS.md 10; the user, 2026-11-22: "a priority to build and integrate").
// Redmine is still the source of the mirrored spaces (T-, C-, E-) until the cut-over (E-11), so those read here and
// change in Redmine; a space made here is the site's own, and changes here: each change an event in PRAXIS, written as
// the account that made it (an agent by its key), then given to the always-on replica on roverbyteseer (replica.ts).
import { px, type Item, type Praxis, type Space } from "./praxis.ts";
import { Refused } from "./accounts.ts";
import { MIRROR } from "./mirror.ts";
import { closedStates, FORM_NAME, kindName, workForm } from "./work.ts";

/** the prefixes the mirror keeps for Redmine's three projects: a space of the site's own takes another */
export const MIRRORED_PREFIXES = new Set(["T", "C", "E"]);
/** what a space of the site's own is made from: the WORK form, with Redmine's trackers and statuses, so the cut-over
 *  (E-11) reads both kinds of space alike */
export function ownForm() {
  return workForm({
    trackers: ["Job", "Bug"],
    statuses: [{ name: "Ready", closed: false }, { name: "In progress", closed: false }, { name: "Blocked", closed: false },
               { name: "Needs decision", closed: false }, { name: "Deferred", closed: false }, { name: "Closed", closed: true },
               { name: "Superseded", closed: true }],
    fields: ["Order", "Blocked on", "See", "From", "Branch", "Commits"],
  });
}
/** the fields a person or an agent may set on a ticket of the site's own (the rest are the mirror's bookkeeping) */
export const EDITABLE = ["title", "description", "lane", "priority", "order", "blocked_on", "see", "from", "branch", "commits"] as const;
export const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const TITLE_MOST = 200, TEXT_MOST = 20_000;

export type Row = { id: string; title: string; kind: string; state: string; status: string; phase: string; closed: boolean;
                    lane: string | null; priority: string | null; order: number | null; updated: string; closedAt: string | null; by: string };
export type SpaceView = { id: string; prefix: string; title: string; mirrored: boolean; reach: string; made: string; by: string;
                          kinds: { name: string; title: string }[];
                          states: { name: string; title: string; phase: string; closed: boolean }[];
                          open: number; closed: number; working: number };

/** an actor as a page shows it: an account by its name, a lane by its own, the mirror as Redmine */
export function actorName(a: string): string {
  if (a.startsWith("person:") || a.startsWith("agent:")) return a.slice(a.indexOf(":") + 1);
  if (a.startsWith("lane:")) return a.slice(5);
  if (a === MIRROR) return "Redmine";
  if (a === "sessions") return "a session";
  if (a === "keeper") return "the keeper";
  return a.startsWith("redmine:") ? "a person" : a;
}
/** who an account writes as */
export const actorOf = (account: { kind: string; name: string }) => `${account.kind === "agent" ? "agent" : "person"}:${account.name}`;

const text = (v: unknown) => (v == null ? "" : String(v));

export class Spaces {
  readonly px: Praxis;
  /** called after every change made here: the change goes to the always-on replica */
  private readonly changed: () => void;
  constructor(p: Praxis, o: { changed?: () => void } = {}) { this.px = p; this.changed = o.changed ?? (() => {}); }

  mirrored(s: Space) { return s.maker === MIRROR && MIRRORED_PREFIXES.has(s.prefix); }

  /** every WORK space, the mirrored ones first; one of the site's own is shown to anyone only when it is public */
  list(signedIn: boolean): SpaceView[] {
    return this.px.spaces().filter((s) => !s.archived && s.form?.name === FORM_NAME && s.home === s.id)
      .filter((s) => this.mirrored(s) || signedIn || s.reach === "public")
      .sort((a, b) => Number(this.mirrored(b)) - Number(this.mirrored(a)) || a.made.localeCompare(b.made))
      .map((s) => this.view(s));
  }

  /** a space by its prefix, if this reader may see it */
  space(prefix: string, signedIn: boolean): Space {
    const s = this.px.spaces().find((x) => x.prefix === prefix && x.form?.name === FORM_NAME && !x.archived);
    if (!s || !(this.mirrored(s) || signedIn || s.reach === "public")) throw new Refused(`No space ${prefix} here.`, 404);
    return s;
  }

  view(s: Space): SpaceView {
    const rows = this.rows(s), closed = closedStates(s.form);
    const states = new Map<string, { name: string; title: string; phase: string; closed: boolean }>();
    for (const k of Object.values(s.form?.kinds ?? {})) for (const st of k.states)
      if (!states.has(st.name)) states.set(st.name, { name: st.name, title: st.title ?? st.name, phase: st.phase, closed: closed.has(st.name) });
    return {
      id: s.id, prefix: s.prefix, title: s.title, mirrored: this.mirrored(s), reach: s.reach, made: s.made, by: actorName(s.maker),
      kinds: Object.entries(s.form?.kinds ?? {}).map(([name, k]) => ({ name, title: k.title })), states: [...states.values()],
      open: rows.filter((r) => !r.closed).length, closed: rows.filter((r) => r.closed).length,
      working: rows.filter((r) => !r.closed && r.state === "in-progress").length,
    };
  }

  /** a space's tickets as rows: what the list, the board and the roadmap are drawn from */
  rows(s: Space): Row[] {
    const closed = closedStates(s.form);
    // the last time each ticket moved, and each one's last move of state, from the log (the mirror's carry Redmine's own)
    const last = new Map<string, string>(), moved = new Map<string, string>();
    for (const r of this.px.db.prepare("SELECT item, MAX(hlc) AS h FROM px_events WHERE space = ? GROUP BY item").all(s.id) as { item: string; h: string }[])
      last.set(r.item, r.h);
    for (const r of this.px.db.prepare("SELECT item, MAX(hlc) AS h FROM px_events WHERE space = ? AND op = 'state' GROUP BY item").all(s.id) as { item: string; h: string }[])
      moved.set(r.item, r.h);
    return this.px.items(s.id, { archived: false }).map((it) => this.row(s, it, closed, last.get(it.id), moved.get(it.id)));
  }

  private row(s: Space, it: Item, closed: Set<string>, last?: string, moved?: string): Row {
    const st = s.form?.kinds[it.kind]?.states.find((x) => x.name === it.state);
    const isClosed = closed.has(it.state ?? "");
    const order = it.fields.order;
    return {
      id: it.handle, title: it.title, kind: it.kind, state: it.state ?? "", status: st?.title ?? it.state ?? "", phase: it.phase ?? "open",
      closed: isClosed, lane: typeof it.fields.lane === "string" && it.fields.lane ? it.fields.lane : null,
      priority: typeof it.fields.priority === "string" ? it.fields.priority : null,
      order: typeof order === "number" && Number.isFinite(order) ? order : null,
      updated: typeof it.fields.updated === "string" ? it.fields.updated : last ? px.hlcIso(last) : it.made,
      closedAt: !isClosed ? null : typeof it.fields.closed === "string" ? it.fields.closed : moved ? px.hlcIso(moved) : null,
      by: actorName(text(it.fields.author) || it.maker),
    };
  }

  /** one ticket by its handle (T-581, W-3): every field, every note, its links and its history */
  item(handle: string, signedIn: boolean) {
    const m = /^([A-Z][A-Z0-9]{0,9})-(\d{1,6})$/.exec(handle);
    if (!m) throw new Refused(`No ticket ${handle} here.`, 404);
    const s = this.space(m[1], signedIn), it = this.px.numbered(s.id, Number(m[2]));
    if (!it || it.archived) throw new Refused(`No ticket ${handle} here.`, 404);
    const kind = s.form?.kinds[it.kind];
    const row = this.rows(s).find((r) => r.id === it.handle)!;
    const handleOf = (id: string) => this.px.item(id)?.handle ?? null;
    const fields = Object.entries(kind?.fields ?? {})
      // what the head shows already, and the TODO mirror's bookkeeping, are not shown again
      .filter(([k]) => !["description", "redmine", "opened", "updated", "closed", "author", "tracker", "lane", "priority", "order",
                         "ticket", "run", "shown_as", "extra_cells", "row_tail", "cf_state"].includes(k))
      .map(([k, f]) => ({ key: k, name: f.title ?? k, value: text(it.fields[k]) }));
    return {
      ...row, space: s.prefix, spaceTitle: s.title, mirrored: this.mirrored(s), description: text(it.fields.description),
      redmine: typeof it.fields.redmine === "number" ? it.fields.redmine : null,
      opened: text(it.fields.opened) || it.made,
      fields, states: kind?.states.map((x) => ({ name: x.name, title: x.title ?? x.name })) ?? [],
      notes: this.px.notes(it.id).map((n) => ({ at: n.at ?? px.hlcIso(n.hlc), by: actorName(n.actor), text: n.text })),
      links: [...this.px.links(it.id).filter((l) => l.type !== "check" && l.type !== "tag")
                .map((l) => ({ type: l.type, to: handleOf(l.to), toward: true })),
              ...this.px.linksTo(it.id).map((l) => ({ type: l.type, to: handleOf(l.item), toward: false }))]
        .filter((l) => l.to),
      history: this.px.log(it.id).filter((e) => e.op !== "note").map((e) => ({ at: px.hlcIso(e.hlc), by: actorName(e.actor), what: this.said(s, e) }))
        .filter((h) => h.what),
      arete: this.px.ledger(s.id).filter((e) => e.item === it.id && !e.back).reduce((a, e) => a + (e.op === "award" ? e.points : -e.points), 0),
    };
  }

  /** one event in words, for a ticket's history (DRAFT) */
  private said(s: Space, e: { op: string; field?: string; value?: unknown }): string {
    const v = e.value as Record<string, unknown> | string | number | null | undefined;
    const titleOf = (f: string) => Object.values(s.form?.kinds ?? {}).map((k) => k.fields?.[f]?.title).find(Boolean) ?? f;
    switch (e.op) {
      case "make": return "made it";
      case "state": return `moved it to ${Object.values(s.form?.kinds ?? {}).flatMap((k) => k.states).find((x) => x.name === v)?.title ?? v}`;
      case "set": {
        if (!e.field || e.field.startsWith("handle") || ["updated", "redmine", "opened", "author", "tracker"].includes(e.field)) return "";
        const val = v && typeof v === "object" && "text" in v ? String(v.text) : v == null || v === "" ? "nothing" : String(v);
        return e.field === "description" ? "rewrote its description" : `set ${titleOf(e.field).toLowerCase()} to ${val.length > 80 ? val.slice(0, 80) + "…" : val}`;
      }
      case "link": return `linked it (${(v as { type?: string })?.type ?? "a link"})`;
      case "unlink": return "took a link away";
      case "award": return (v as { back?: boolean })?.back ? "its ARETE taken back" : `paid ${(v as { points?: number })?.points ?? 0} ARETE`;
      case "archive": return v ? "archived it" : "brought it back";
      default: return "";
    }
  }

  // ---- changes: only to a space of the site's own --------------------------------------------------------------------

  private own(prefix: string): Space {
    const s = this.space(prefix, true);
    if (this.mirrored(s)) throw new Refused(`${s.title} is Redmine's until the cut-over (E-11): change its tickets there.`, 409);
    return s;
  }

  /** a space of the site's own: its title, its prefix (two to six capitals, none of Redmine's), whether it is public */
  makeSpace(by: string, o: Record<string, unknown>): SpaceView {
    const title = text(o.title).trim(), prefix = text(o.prefix).trim().toUpperCase();
    if (!title || title.length > 60) throw new Refused("A space needs a title, at most sixty letters.");
    if (!/^[A-Z][A-Z0-9]{1,5}$/.test(prefix)) throw new Refused("A prefix is two to six capitals or digits, starting with a capital (WORK, LIFE, H2).");
    if (MIRRORED_PREFIXES.has(prefix) || this.px.spaces().some((s) => s.prefix === prefix)) throw new Refused(`${prefix} is taken.`, 409);
    const reach = o.reach === "public" ? "public" : "home";
    const id = this.px.makeSpace({ title, prefix, form: ownForm(), reach, actor: by });
    this.changed();
    return this.view(this.px.space(id)!);
  }

  /** a new ticket in a space of the site's own, numbered at once (this replica keeps the space) */
  make(by: string, prefix: string, o: Record<string, unknown>): string {
    const s = this.own(prefix);
    const kind = kindName(text(o.kind) || "Job");
    if (!s.form?.kinds[kind]) throw new Refused("A ticket is a Job or a Bug.");
    const fields: Record<string, unknown> = { title: this.title(o.title) };
    for (const f of EDITABLE) if (f !== "title" && o[f] != null && o[f] !== "") fields[f] = this.value(f, o[f]);
    const id = this.px.make(s.id, kind, fields as { title: string }, { actor: by });
    this.changed();
    return this.px.item(id)!.handle;
  }

  /** a change to a ticket of the site's own: a field set, a state moved into, or a note written */
  change(by: string, handle: string, o: Record<string, unknown>) {
    const m = /^([A-Z][A-Z0-9]{0,9})-(\d{1,6})$/.exec(handle);
    if (!m) throw new Refused(`No ticket ${handle} here.`, 404);
    const s = this.own(m[1]), it = this.px.numbered(s.id, Number(m[2]));
    if (!it || it.archived) throw new Refused(`No ticket ${handle} here.`, 404);
    const action = text(o.action);
    if (action === "set") {
      const f = text(o.field);
      if (!(EDITABLE as readonly string[]).includes(f)) throw new Refused("That field can't be set here.");
      this.px.set(it.id, f, f === "title" ? this.title(o.value) : o.value == null || o.value === "" ? null : this.value(f, o.value), { actor: by });
    } else if (action === "state") {
      const st = text(o.state);
      if (!s.form?.kinds[it.kind]?.states.some((x) => x.name === st)) throw new Refused("No such state.");
      if (st !== it.state) this.px.state(it.id, st, { actor: by });
    } else if (action === "note") {
      const t = text(o.text).trim();
      if (!t) throw new Refused("A note needs words.");
      if (t.length > TEXT_MOST) throw new Refused("That note is too long.");
      this.px.note(it.id, t, { actor: by });
    } else throw new Refused("No such change.");
    this.changed();
    return this.item(handle, true);
  }

  private title(v: unknown) {
    const t = text(v).trim().replace(/\s+/g, " ");
    if (!t) throw new Refused("A ticket needs a title.");
    if (t.length > TITLE_MOST) throw new Refused("That title is too long.");
    return t;
  }
  private value(f: string, v: unknown): unknown {
    if (f === "order") { const n = Number(v); if (!Number.isFinite(n)) throw new Refused("An order is a number."); return n; }
    if (f === "priority") { const p = text(v); if (!PRIORITIES.includes(p)) throw new Refused(`A priority is ${PRIORITIES.join(", ")}.`); return p; }
    const t = text(v);
    if (t.length > TEXT_MOST) throw new Refused("That is too long.");
    return f === "lane" ? t.trim().toLowerCase() : t;
  }
}

