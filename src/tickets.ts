// E-9: THE DASHBOARD's tickets, read from PRAXIS (companion docs/PROJECTS.md 10, E-4's rule: the dashboard draws from
// PRAXIS, and Redmine reaches it through the mirror). It answers in redmine.ts's shapes, so nothing on the page changes;
// what changes is where it comes from: this site's own replica, which keeps the last pull when roverbyteseer is away.
// A lane's ARETE is PRAXIS's ledger now -- what the mirror paid it as it closed each ticket -- not counted here.
import { px, type Item, type Praxis, type Space } from "./praxis.ts";
import { DONE_MOST, DONE_PAGE, HISTORY_MOST, HISTORY_TICKETS, LANES, LEDGER_MOST, NEXT_MOST, PROJECTS, SHOWN, TICKET_ID,
         WEEK_MS, waitsOnUser, type Board, type Detail, type LaneDetail, type LaneView, type RedmineReader,
         type Ticket } from "./redmine.ts";
import { closedStates, fieldName, FORM_NAME } from "./work.ts";

/** what the server reads the tickets through: Redmine's reader, or this one. `forget` is awaited after an answer, so
 *  the board the page loads next already shows it. */
export type Tickets = Pick<RedmineReader, "board" | "ticket" | "lane"> & { forget(id: string): void | Promise<void> };
/** a pull older than this marks the board stale */
export const STALE_MS = 5 * 60 * 1000;

type Row = { t: Ticket; it: Item; closed: boolean };

/** a note's author as a page may show it (redmine.ts's rule): a lane by its name, the sessions as such, anyone else unnamed */
const authorOf = (actor: string) => (actor.startsWith("lane:") ? actor.slice(5) : actor === "sessions" ? "a session" : "a person");
const text = (v: unknown) => (v == null ? "" : String(v));
const byOrder = (a: Ticket, b: Ticket) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id, "en", { numeric: true });
const newest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export class PraxisTickets implements Tickets {
  private readonly px: Praxis;
  private readonly now: () => number;
  private readonly pulled: () => number | null;
  private readonly refresh: () => void | Promise<void>;

  /** `pulled`: when this replica last took from the one that mirrors Redmine (null: it is that one, or there is none);
   *  `refresh`: ask for what changed now, rather than at the next minute (after an answer) */
  constructor(p: Praxis, o: { now?: () => number; pulled?: () => number | null; refresh?: () => void | Promise<void> } = {}) {
    this.px = p; this.now = o.now ?? (() => Date.now()); this.pulled = o.pulled ?? (() => null); this.refresh = o.refresh ?? (() => {});
  }

  /** the mirrored spaces, by project -- the reader has nothing to show until all three have arrived */
  spaces(): Map<string, Space> {
    const out = new Map<string, Space>();
    for (const p of PROJECTS) {
      const s = this.px.spaces().find((x) => x.prefix === p.prefix && x.form?.name === FORM_NAME);
      if (s) out.set(p.ident, s);
    }
    return out;
  }
  ready() { return this.spaces().size === PROJECTS.length; }

  private stale() { const at = this.pulled(); return at !== null && this.now() - at > STALE_MS; }

  private rows(space: Space, ident: string): Row[] {
    const closed = closedStates(space.form);
    return this.px.items(space.id, { archived: false }).filter((it) => it.number !== null).map((it) => {
      const order = it.fields.order;
      return {
        it, closed: closed.has(it.state ?? ""),
        t: { id: it.handle, project: ident, title: it.title,
             status: space.form?.kinds[it.kind]?.states.find((s) => s.name === it.state)?.title ?? it.state ?? "",
             lane: typeof it.fields.lane === "string" ? it.fields.lane : null,
             order: typeof order === "number" && Number.isFinite(order) ? order : null,
             updated: text(it.fields.updated), closed: typeof it.fields.closed === "string" ? it.fields.closed : null },
      };
    });
  }

  private all() {
    const out: { ident: string; name: string; space: Space; rows: Row[] }[] = [];
    for (const p of PROJECTS) { const s = this.spaces().get(p.ident); if (s) out.push({ ident: p.ident, name: p.name, space: s, rows: this.rows(s, p.ident) }); }
    return out;
  }

  async board(): Promise<Board> {
    const all = this.all();
    const open = all.flatMap((p) => p.rows.filter((r) => !r.closed));
    const closed = all.flatMap((p) => p.rows.filter((r) => r.closed).map((r) => r.t))
      .sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
    const projects = all.map((p) => ({
      ident: p.ident, name: p.name, open: p.rows.filter((r) => !r.closed).length, closed: p.rows.filter((r) => r.closed).length,
      working: p.rows.filter((r) => !r.closed && r.t.status === "In progress").length,
    }));
    const lanes = LANES.map((lane): LaneView => {
      const its = open.filter((r) => r.t.lane === lane).map((r) => r.t), done = closed.filter((t) => t.lane === lane).slice(0, DONE_MOST);
      return {
        lane,
        working: its.filter((t) => t.status === "In progress").sort((a, b) => b.updated.localeCompare(a.updated)),
        next: its.filter((t) => t.status === "Ready").sort(byOrder).slice(0, NEXT_MOST),
        done, open: its.length,
        last: [...its.map((t) => t.updated), ...done.map((t) => t.closed)].reduce<string | null>((a, b) => newest(a, b ?? null), null),
      };
    });
    const waiting = open.filter((r) => waitsOnUser(r.t.status, text(r.it.fields.blocked_on) || null)).map((r) => r.t)
      .sort((a, b) => b.updated.localeCompare(a.updated));
    return { at: new Date(this.now()).toISOString(), stale: this.stale(), projects, lanes, waiting };
  }

  async ticket(id: string): Promise<Detail | null> {
    if (!TICKET_ID.test(id)) return null;
    const [prefix, n] = id.split("-");
    const p = PROJECTS.find((x) => x.prefix === prefix), s = p ? this.spaces().get(p.ident) : undefined;
    const found = s ? this.px.numbered(s.id, Number(n)) : null;
    if (!p || !s || !found) return null;
    const row = this.rows(s, p.ident).find((r) => r.it.id === found.id);
    if (!row) return null;
    return {
      ...row.t,
      description: text(row.it.fields.description),
      fields: SHOWN.map((name) => ({ name, value: text(row.it.fields[fieldName(name)]) }))
        .filter((f) => f.value.trim() && f.value !== "(empty)"),
      notes: this.px.notes(row.it.id).slice(-5).reverse()
        .map((x) => ({ at: x.at ?? px.hlcIso(x.hlc), by: authorOf(x.actor), text: x.text })),
    };
  }

  /** the mirror is the only writer, so there is nothing to forget: an answer arrives with a pull, which this asks for
   *  at once and waits on (a second or two: the always-on replica mirrors, this one takes it) */
  async forget(_id: string) { await this.refresh(); }

  async lane(name: string): Promise<LaneDetail | null> {
    if (!(LANES as readonly string[]).includes(name)) return null;
    const all = this.all();
    const mine = all.flatMap((p) => p.rows.filter((r) => r.t.lane === name).map((r) => ({ ...r, space: p.space })));
    const open = mine.filter((r) => !r.closed).sort((a, b) => b.t.updated.localeCompare(a.t.updated));
    const closed = mine.filter((r) => r.closed).sort((a, b) => (b.t.closed ?? "").localeCompare(a.t.closed ?? ""));
    // what the ledger paid this lane, by item: each award it was given and not taken back
    const paid = new Map<string, number>();
    for (const p of all) for (const e of this.px.ledger(p.space.id))
      if (e.op === "award" && !e.back && e.actor === `lane:${name}`) paid.set(e.item, (paid.get(e.item) ?? 0) + e.points);
    const ledger = closed.filter((r) => paid.has(r.it.id))
      .map((r) => ({ ...r.t, kind: text(r.it.fields.tracker) || r.it.kind, points: paid.get(r.it.id)! }));
    const weekAgo = new Date(this.now() - WEEK_MS).toISOString();
    const history: LaneDetail["history"] = [];
    for (const r of [...open, ...closed].sort((a, b) => b.t.updated.localeCompare(a.t.updated)).slice(0, HISTORY_TICKETS))
      for (const x of this.px.notes(r.it.id))
        if (x.actor === `lane:${name}`) history.push({ at: x.at ?? px.hlcIso(x.hlc), ticket: r.t.id, title: r.t.title, text: x.text });
    history.sort((a, b) => b.at.localeCompare(a.at));
    return {
      lane: name, at: new Date(this.now()).toISOString(), stale: this.stale(),
      since: mine.map((r) => text(r.it.fields.opened)).filter(Boolean).sort()[0] ?? null,
      projects: all.map((p) => {
        const its = mine.filter((r) => r.t.project === p.ident);
        return { ident: p.ident, name: p.name, open: its.filter((r) => !r.closed).length, closed: its.filter((r) => r.closed).length,
                 working: its.filter((r) => !r.closed && r.t.status === "In progress").length };
      }).filter((p) => p.open + p.closed),
      working: open.filter((r) => r.t.status === "In progress").map((r) => r.t),
      next: open.filter((r) => r.t.status === "Ready").map((r) => r.t).sort(byOrder),
      waiting: open.filter((r) => r.t.status !== "In progress" && r.t.status !== "Ready").map((r) => r.t),
      done: closed.slice(0, DONE_PAGE).map((r) => r.t),
      arete: { total: ledger.reduce((a, l) => a + l.points, 0), tickets: ledger.length,
               week: ledger.filter((l) => (l.closed ?? "") >= weekAgo).reduce((a, l) => a + l.points, 0),
               ledger: ledger.slice(0, LEDGER_MOST) },
      history: history.slice(0, HISTORY_MOST),
    };
  }
}

/** PRAXIS once its replica holds the three spaces, Redmine until then (or when there is no replica at all) */
export function eitherTickets(praxis: PraxisTickets | null, redmine: Tickets | null): Tickets | null {
  if (!praxis) return redmine;
  const pick = () => (praxis.ready() || !redmine ? praxis : redmine);
  return {
    board: () => pick().board(),
    ticket: (id) => pick().ticket(id),
    lane: (name) => pick().lane(name),
    forget: async (id) => { redmine?.forget(id); await praxis.forget(id); },
  };
}
