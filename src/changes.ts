// THE CHANGES (E-1's last slice): what the lanes pushed lately, across the project's public repositories, and the pull
// requests open on GitHub, each with the lane whose ticket it names as the daemon to review it. The commits are read
// from this machine's own clones (each one's upstream branch: what was pushed, never a working tree), so they cost no
// network; the pull requests from GitHub's public API, a quarter of an hour at a time (an unsigned reader has sixty
// calls an hour). The reviews themselves wait on E-15: a lane's daemon reviews only once agents work in their sandbox.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { Tickets } from "./tickets.ts";

const run = promisify(execFile);
export const OWNER = "CodeMusic";
/** a ticket's id in a commit's subject or a pull request's title: T-581, C-437, E-1 */
const IDS = /\b([TCE]-[0-9]{1,5})\b/g;
const COMMITS_EACH = 12, COMMITS_MOST = 30, COMMITS_MS = 2 * 60 * 1000, PULLS_MS = 15 * 60 * 1000;

export type Repo = { name: string; dir: string; title: string };
export type Change = { repo: string; title: string; sha: string; subject: string; at: string; tickets: string[]; url: string };
export type Pull = { repo: string; title: string; number: number; subject: string; at: string; author: string; draft: boolean;
                     url: string; tickets: string[]; reviewer: string | null;
                     /** E-16: its daemon's newest review, and whether it was of the head the pull request has now */
                     review: Review | null };
export type ChangesView = { at: string; commits: Change[]; pulls: Pull[]; pullsWhy: string | null };

/** E-16: the marker a daemon's review ends in -- which lane, at which head, its verdict -- written by review_main.ts */
export const marker = (lane: string, sha: string, verdict: string) =>
  `<!-- eudaimonia-review lane=${lane} sha=${sha} verdict=${verdict.replace(/\s+/g, "-")} -->`;
export const MARKER = /<!-- eudaimonia-review lane=([a-z0-9-]{1,20}) sha=([0-9a-f]{7,40}) verdict=([A-Z-]{1,20}) -->/;
export type Review = { lane: string; sha: string; verdict: string; url: string; at: string; current: boolean };

export const ticketsIn = (s: string) => [...new Set([...s.matchAll(IDS)].map((m) => m[1]))];

/** the repositories THE CHANGES reads, where they sit beside this one; a clone that is not here is left out */
export function reposBeside(daemons: string, companion: string, root: string, projects: string): Repo[] {
  return [
    { name: "DAEMONS", dir: daemons, title: "DAEMONS" },
    { name: "pokefirered-daemons", dir: `${daemons}/engineGba`, title: "THE GAME" },
    { name: "daemons-companion", dir: companion, title: "THE COMPANION" },
    { name: "daemons-praxis", dir: `${projects}/daemons-praxis`, title: "PRAXIS" },
    { name: "daemons-eudaimonia", dir: root, title: "EUDAIMONIA" },
  ].filter((r) => existsSync(r.dir));
}

type Git = (dir: string, args: string[]) => Promise<string>;
type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class Changes {
  private readonly repos: Repo[];
  private readonly git: Git;
  private readonly fetch: Fetch;
  private readonly now: () => number;
  private readonly tickets: Tickets | null;
  private commits: { at: number; v: Change[] } | null = null;
  private pulls: { at: number; v: Pull[]; why: string | null } | null = null;

  constructor(o: { repos: Repo[]; git?: Git; fetch?: Fetch; now?: () => number; tickets?: Tickets | null }) {
    this.repos = o.repos;
    this.git = o.git ?? (async (dir, args) => (await run("git", ["-C", dir, ...args], { timeout: 10_000, maxBuffer: 1 << 20 })).stdout);
    this.fetch = o.fetch ?? ((url, init) => fetch(url, init));
    this.now = o.now ?? (() => Date.now());
    this.tickets = o.tickets ?? null;
  }

  async view(): Promise<ChangesView> {
    const [commits, pulls] = await Promise.all([this.readCommits(), this.readPulls()]);
    return { at: new Date(this.now()).toISOString(), commits, pulls: pulls.v, pullsWhy: pulls.why };
  }

  private async readCommits(): Promise<Change[]> {
    if (this.commits && this.now() - this.commits.at < COMMITS_MS) return this.commits.v;
    const all: Change[] = [];
    for (const r of this.repos) {
      let out = "";
      // what was pushed: the branch's upstream; a clone with none shows its own HEAD
      for (const ref of ["@{upstream}", "HEAD"]) {
        try { out = await this.git(r.dir, ["log", ref, `-n${COMMITS_EACH}`, "--no-merges", "--format=%H%x1f%cI%x1f%s"]); break; }
        catch { /* the next ref */ }
      }
      for (const line of out.split("\n")) {
        const [sha, at, subject] = line.split("\x1f");
        if (!sha || !at || subject === undefined) continue;
        all.push({ repo: r.name, title: r.title, sha: sha.slice(0, 9), subject, at: new Date(at).toISOString(),
                   tickets: ticketsIn(subject), url: `https://github.com/${OWNER}/${r.name}/commit/${sha}` });
      }
    }
    all.sort((a, b) => b.at.localeCompare(a.at));
    this.commits = { at: this.now(), v: all.slice(0, COMMITS_MOST) };
    return this.commits.v;
  }

  private async readPulls(): Promise<{ v: Pull[]; why: string | null }> {
    if (this.pulls && this.now() - this.pulls.at < PULLS_MS) return this.pulls;
    const v: Pull[] = [];
    let why: string | null = null;
    for (const r of this.repos) {
      try {
        const res = await this.fetch(`https://api.github.com/repos/${OWNER}/${r.name}/pulls?state=open&per_page=20`,
                                     { headers: { Accept: "application/vnd.github+json", "User-Agent": "eudaimonia-dashboard" } });
        if (!res.ok) { why = `GitHub said ${res.status}`; continue; }
        for (const p of (await res.json()) as { number: number; title: string; html_url: string; updated_at: string;
                                                  draft?: boolean; user?: { login?: string }; head?: { ref?: string; sha?: string } }[]) {
          const tickets = ticketsIn(`${p.title} ${p.head?.ref ?? ""}`);
          v.push({ repo: r.name, title: r.title, number: p.number, subject: p.title, at: p.updated_at, author: p.user?.login ?? "",
                   draft: !!p.draft, url: p.html_url, tickets, reviewer: await this.laneOf(tickets),
                   review: await this.reviewOf(r.name, p.number, p.head?.sha ?? "") });
        }
      } catch (e) { why = `GitHub can't be reached (${(e as Error).message})`; }
    }
    v.sort((a, b) => b.at.localeCompare(a.at));
    // a failure keeps what was read before, rather than showing nothing
    if (why && this.pulls && !v.length) return { ...this.pulls, why };
    this.pulls = { at: this.now(), v, why };
    return this.pulls;
  }

  /** E-16: a daemon's newest review of it, read back by its marker (none: null) */
  private async reviewOf(repo: string, n: number, head: string): Promise<Review | null> {
    try {
      const res = await this.fetch(`https://api.github.com/repos/${OWNER}/${repo}/pulls/${n}/reviews?per_page=100`,
                                   { headers: { Accept: "application/vnd.github+json", "User-Agent": "eudaimonia-dashboard" } });
      if (!res.ok) return null;
      let out: Review | null = null;
      for (const r of (await res.json()) as { body?: string; html_url?: string; submitted_at?: string }[]) {
        const m = MARKER.exec(r.body ?? "");
        if (m && (!out || (r.submitted_at ?? "") >= out.at))
          out = { lane: m[1], sha: m[2], verdict: m[3].replace(/-/g, " "), url: r.html_url ?? "", at: r.submitted_at ?? "", current: m[2] === head };
      }
      return out;
    } catch { return null; }
  }

  /** the daemon to review it: the lane of the first ticket it names that has one */
  private async laneOf(ids: string[]): Promise<string | null> {
    for (const id of ids) {
      try { const t = await this.tickets?.ticket(id); if (t?.lane) return t.lane; } catch { /* the next */ }
    }
    return null;
  }
}
