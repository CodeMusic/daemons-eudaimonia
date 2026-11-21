// E-1: THE DASHBOARD's tickets, read from Redmine -- read-only, and for now (the user, 2026-11-21, by multiple choice:
// "sure we can do this now... but very soon I want all our stack"). The bible has the dashboard draw from PRAXIS, with
// Redmine reaching it through the bridge's read-only mirror (companion C-434, E-4); when that is built, this one file is
// what it replaces. Everything else on the page reads the Board below, never Redmine.
//
// It only ever GETs, with the playground lane's key (~/.redmine.env, read by main.ts and never sent to a page or a log).
// What a page is shown is what the TODO mirrors already publish: each ticket's id, title, status, lane, its fields and
// its notes. A minute's cache stands between the page and Redmine, and callers at the same moment share one request.
import { Refused } from "./accounts.ts";

export const PROJECTS = [
  { ident: "daemons", name: "DAEMONS", prefix: "T" },
  { ident: "companion", name: "THE COMPANION", prefix: "C" },
  { ident: "eudaimonia", name: "EUDAIMONIA", prefix: "E" },
] as const;
export const LANES = ["game", "story", "audio", "art", "app", "hub", "esp32", "pi-zero", "playground", "docs", "ops"] as const;
/** The fields a ticket's modal shows, in this order (tools/tickets.py's FIELD_NAMES, less its bookkeeping). */
const SHOWN = ["State", "Blocked on", "Why not yet", "See", "Where", "From", "Commits", "Branch", "Closed by"];
export const TICKET_ID = /^[TCE]-\d{1,5}$/;
const TTL_MS = 60 * 1000, TIMEOUT_MS = 15 * 1000, CLOSED_RECENT = 100, NEXT_MOST = 5, DONE_MOST = 3;

type Field = { id: number; name: string; value: string | null };
type Issue = {
  id: number; subject: string; description?: string | null; project: { id: number; name: string };
  status: { id: number; name: string }; assigned_to?: { id: number; name: string };
  custom_fields?: Field[]; updated_on: string; closed_on?: string | null; created_on: string;
  journals?: { user: { name: string }; notes?: string | null; created_on: string }[];
};

export type Ticket = { id: string; project: string; title: string; status: string; lane: string | null; order: number | null;
                       updated: string; closed: string | null };
export type Detail = Ticket & { description: string; fields: { name: string; value: string }[];
                                notes: { at: string; by: string; text: string }[] };
export type LaneView = { lane: string; working: Ticket[]; next: Ticket[]; done: Ticket[]; open: number; last: string | null };
export type Board = {
  at: string; stale: boolean;
  projects: { ident: string; name: string; open: number; closed: number; working: number }[];
  lanes: LaneView[]; waiting: Ticket[];
};

const field = (i: Issue, name: string) => i.custom_fields?.find((f) => f.name === name)?.value ?? null;
/** "Lane hub" -> hub; anyone else (a session, a person) -> null. */
const laneOf = (name: string | undefined) => (name && /^Lane /.test(name) ? name.slice(5) : null);
/** A journal's author as a page may show it: a lane by its name, the sessions as such, anyone else unnamed. */
const author = (name: string) => laneOf(name) ?? (name === "Claude sessions" ? "a session" : "a person");
const newest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Waiting on the user: a decision only they can make, or a ticket blocked on them. */
export const waitsOnUser = (status: string, blockedOn: string | null) =>
  status === "Needs decision" || (status === "Blocked" && /\bthe user\b|\buser's\b/i.test(blockedOn ?? ""));

export class RedmineReader {
  private readonly url: string;
  private readonly key: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private projectIds: Map<number, string> | null = null;
  private board_: { at: number; v: Board } | null = null;
  private pending: Promise<Board> | null = null;
  private details = new Map<string, { at: number; v: Detail | null }>();

  constructor(url: string, key: string, o: { fetch?: typeof fetch; now?: () => number } = {}) {
    this.url = url.replace(/\/+$/, ""); this.key = key;
    this.fetch = o.fetch ?? fetch; this.now = o.now ?? (() => Date.now());
  }

  /** Everything the dashboard draws: a minute old at most; when Redmine is away, the last one marked stale. */
  async board(): Promise<Board> {
    if (this.board_ && this.now() - this.board_.at < TTL_MS) return this.board_.v;
    this.pending ??= this.read().then((v) => { this.board_ = { at: this.now(), v }; return v; })
      .catch((e) => {
        if (this.board_) return { ...this.board_.v, stale: true };
        throw e instanceof Refused ? e : new Refused("The tickets can't be read just now.", 503);
      })
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  /** One ticket, by its id (T-465), with its fields and its last notes; null when no project of ours holds it. */
  async ticket(id: string): Promise<Detail | null> {
    if (!TICKET_ID.test(id)) return null;
    const hit = this.details.get(id);
    if (hit && this.now() - hit.at < TTL_MS) return hit.v;
    const ids = await this.projects();
    const found = (await this.get<{ issues: Issue[] }>(`/issues.json?status_id=*&cf_1=${encodeURIComponent(id)}&limit=5`))
      .issues.find((i) => ids.has(i.project.id) && field(i, "Ticket") === id);
    let v: Detail | null = null;
    if (found) {
      const i = (await this.get<{ issue: Issue }>(`/issues/${found.id}.json?include=journals`)).issue;
      v = {
        ...this.ticketOf(i, ids),
        description: i.description ?? "",
        fields: SHOWN.map((name) => ({ name, value: field(i, name) ?? "" })).filter((f) => f.value.trim() && f.value !== "(empty)"),
        notes: (i.journals ?? []).filter((j) => j.notes?.trim()).slice(-5).reverse()
          .map((j) => ({ at: j.created_on, by: author(j.user.name), text: j.notes ?? "" })),
      };
    }
    this.details.set(id, { at: this.now(), v });
    return v;
  }

  // ---- inside ---------------------------------------------------------------------------------------------------------

  private async read(): Promise<Board> {
    const ids = await this.projects();
    const projects: Board["projects"] = [];
    const open: Ticket[] = [], closed: Ticket[] = [];
    const blockedOn = new Map<string, string | null>();
    for (const p of PROJECTS) {
      const mine: Ticket[] = [];
      for (let offset = 0; ; offset += 100) {
        const r = await this.get<{ issues: Issue[]; total_count: number }>(
          `/issues.json?project_id=${p.ident}&status_id=open&limit=100&offset=${offset}&sort=id`);
        for (const i of r.issues) { const t = this.ticketOf(i, ids); mine.push(t); blockedOn.set(t.id, field(i, "Blocked on")); }
        if (offset + 100 >= r.total_count || !r.issues.length) break;
      }
      const done = await this.get<{ issues: Issue[]; total_count: number }>(
        `/issues.json?project_id=${p.ident}&status_id=closed&sort=closed_on:desc&limit=${CLOSED_RECENT}`);
      closed.push(...done.issues.map((i) => this.ticketOf(i, ids)));
      open.push(...mine);
      projects.push({ ident: p.ident, name: p.name, open: mine.length, closed: done.total_count,
                      working: mine.filter((t) => t.status === "In progress").length });
    }
    closed.sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
    const byOrder = (a: Ticket, b: Ticket) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id, "en", { numeric: true });
    const lanes = LANES.map((lane): LaneView => {
      const its = open.filter((t) => t.lane === lane), done = closed.filter((t) => t.lane === lane).slice(0, DONE_MOST);
      return {
        lane,
        working: its.filter((t) => t.status === "In progress").sort((a, b) => b.updated.localeCompare(a.updated)),
        next: its.filter((t) => t.status === "Ready").sort(byOrder).slice(0, NEXT_MOST),
        done, open: its.length,
        last: [...its.map((t) => t.updated), ...done.map((t) => t.closed)].reduce<string | null>((a, b) => newest(a, b ?? null), null),
      };
    });
    const waiting = open.filter((t) => waitsOnUser(t.status, blockedOn.get(t.id) ?? null))
      .sort((a, b) => b.updated.localeCompare(a.updated));
    return { at: new Date(this.now()).toISOString(), stale: false, projects, lanes, waiting };
  }

  private ticketOf(i: Issue, ids: Map<number, string>): Ticket {
    const id = field(i, "Ticket") ?? `#${i.id}`, order = Number(field(i, "Order"));
    return {
      id, project: ids.get(i.project.id) ?? "", title: i.subject.startsWith(id + " ") ? i.subject.slice(id.length + 1) : i.subject,
      status: i.status.name, lane: laneOf(i.assigned_to?.name), order: Number.isFinite(order) && field(i, "Order") ? order : null,
      updated: i.updated_on, closed: i.closed_on ?? null,
    };
  }

  /** Redmine's own ids for our three projects, read once. */
  private async projects() {
    if (!this.projectIds) {
      const m = new Map<number, string>();
      for (const p of PROJECTS) m.set((await this.get<{ project: { id: number } }>(`/projects/${p.ident}.json`)).project.id, p.ident);
      this.projectIds = m;
    }
    return this.projectIds;
  }

  /** A GET, and only a GET: there is no other verb in this file. */
  private async get<T>(path: string): Promise<T> {
    let r: Response;
    try {
      r = await this.fetch(this.url + path, { method: "GET", headers: { "X-Redmine-API-Key": this.key, Accept: "application/json" },
                                               signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Refused("The tickets can't be reached just now.", 503);
    }
    if (!r.ok) throw new Refused(`The tickets answered ${r.status}.`, 502);
    return (await r.json()) as T;
  }
}

/** The address and the playground lane's key, from ~/.redmine.env's lines (KEY=value); null when either is missing. */
export function redmineEnv(text: string, lane = "playground"): { url: string; key: string } | null {
  const env = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) env.set(m[1], m[2].replace(/^(['"])(.*)\1$/, "$2"));
  }
  const url = env.get("REDMINE_URL"), key = env.get(`REDMINE_KEY_${lane.toUpperCase().replace(/-/g, "_")}`);
  return url && key ? { url, key } : null;
}
