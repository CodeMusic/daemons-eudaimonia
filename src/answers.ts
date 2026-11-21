// E-1's second slice: ANSWER a ticket that waits on the user, from its modal on THE DASHBOARD (the user, 2026-11-18:
// "the answer is added to the ticket as a note in the user's name and its status moves back ... so its lane's agent
// picks it up again. Multiple-choice questions shown as choices where the ticket gives them").
//
// This is the site's only write to Redmine, and it does exactly one thing: on a ticket of our three projects that is
// waiting on the user (Needs decision, or Blocked on them), it adds the user's answer as a note and, unless they say it
// still waits on them, moves it back to Ready. Only a signed-in admin of EUDAIMONIA can ask for it (server.ts). Its key
// is its own (main.ts, from ~/.redmine.env), never the reader's, never logged, never sent to a page.
//
// A ticket gives its choices the way `tools/tickets.py ask` writes them (DAEMONS): a line "Choices:" and a list under
// it, in the ticket's newest note that has one, or else its description.
import { Refused } from "./accounts.ts";
import { PROJECTS, TICKET_ID, waitsOnUser } from "./redmine.ts";

const TIMEOUT_MS = 15 * 1000, TEXT_MOST = 4000, CHOICE_MOST = 300, CHOICES_MOST = 8;

/** A question's choices: the list under the last "Choices:" line of a text (bold or not), at most eight. */
export function choicesOf(text: string): string[] {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  let at = -1;
  lines.forEach((l, i) => { if (/^\s*(?:\*\*)?choices(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i.test(l)) at = i; });
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*(?:[-*]|\d+[.)]|\(?[a-z]\))\s+(.+?)\s*$/i.exec(l);
    if (m) out.push(m[1]);
    else if (l.trim()) break;
    else if (out.length) break;
  }
  return out.slice(0, CHOICES_MOST);
}

/** The choices a ticket gives: its newest note that lists some, else its description. */
export function ticketChoices(t: { description: string; notes: { text: string }[] }): string[] {
  for (const n of t.notes) { const c = choicesOf(n.text); if (c.length) return c; }   // notes come newest first
  return choicesOf(t.description);
}

type Issue = { id: number; project: { id: number }; status: { id: number; name: string };
               custom_fields?: { name: string; value: string | null }[] };

export type Answer = { text: string; choice: string | null; keep: boolean };

export class Answers {
  private readonly url: string;
  private readonly key: string;
  private readonly as: string | null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  /** `as`: a Redmine login to write as (Redmine's X-Redmine-Switch-User), when the key is an admin's; else the key's own. */
  constructor(url: string, key: string, o: { as?: string | null; fetch?: typeof fetch; now?: () => number } = {}) {
    this.url = url.replace(/\/+$/, ""); this.key = key; this.as = o.as ?? null;
    this.fetch = o.fetch ?? fetch; this.now = o.now ?? (() => Date.now());
  }

  /** The note an answer becomes, in the project's own way of quoting the user. */
  note(a: Answer, day = this.today()) {
    const head = `**The user's answer** (*the user, ${day}, on THE DASHBOARD*)`;
    const body = [a.choice ? `**${a.choice}**` : "", a.text.trim()].filter(Boolean).join(a.text.includes("\n") ? "\n\n" : " -- ");
    return `${head}: ${body}${a.keep ? "\n\n*It still waits on the user.*" : ""}`;
  }

  /** Answer one ticket: a note, and back to Ready unless `keep`. Refused unless it is ours and waiting on the user. */
  async answer(id: string, a: Answer): Promise<{ ticket: string; status: string }> {
    const text = String(a.text ?? ""), choice = a.choice == null ? null : String(a.choice).trim() || null;
    if (!TICKET_ID.test(id)) throw new Refused("No such ticket.", 404);
    if (!text.trim() && !choice) throw new Refused("Choose, or write your answer.");
    if (text.length > TEXT_MOST || (choice?.length ?? 0) > CHOICE_MOST) throw new Refused("That is too long for a note.");
    const ids = new Set<number>();
    for (const p of PROJECTS) ids.add((await this.call<{ project: { id: number } }>("GET", `/projects/${p.ident}.json`)).project.id);
    const found = (await this.call<{ issues: Issue[] }>("GET", `/issues.json?status_id=*&cf_1=${encodeURIComponent(id)}&limit=5`))
      .issues.find((i) => ids.has(i.project.id) && i.custom_fields?.find((f) => f.name === "Ticket")?.value === id);
    if (!found) throw new Refused(`No ticket ${id} here.`, 404);
    const blocked = found.custom_fields?.find((f) => f.name === "Blocked on")?.value ?? null;
    if (!waitsOnUser(found.status.name, blocked)) throw new Refused(`${id} is not waiting on you: it is ${found.status.name}.`, 409);
    const statuses = (await this.call<{ issue_statuses: { id: number; name: string }[] }>("GET", "/issue_statuses.json")).issue_statuses;
    const ready = statuses.find((s) => s.name === "Ready");
    if (!ready) throw new Refused("Redmine has no Ready status.", 502);
    const issue: Record<string, unknown> = { notes: this.note({ text, choice, keep: !!a.keep }) };
    if (!a.keep) issue.status_id = ready.id;
    await this.call("PUT", `/issues/${found.id}.json`, { issue });
    return { ticket: id, status: a.keep ? found.status.name : "Ready" };
  }

  private today() {
    const d = new Date(this.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  private async call<T>(method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "X-Redmine-API-Key": this.key, Accept: "application/json" };
    if (this.as) headers["X-Redmine-Switch-User"] = this.as;
    if (body) headers["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await this.fetch(this.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined,
                                               signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Refused("The tickets can't be reached just now.", 503);
    }
    if (!r.ok) throw new Refused(`The tickets answered ${r.status}.`, 502);
    const raw = await r.text();
    return (raw.trim() ? JSON.parse(raw) : {}) as T;
  }
}

/** The answering key from ~/.redmine.env (the user, 2026-11-21, by multiple choice: "sessions now, mine later"): the
 *  user's own Redmine account's key, REDMINE_KEY_USER, once they add it; until then the sessions' own, REDMINE_API_KEY
 *  (Claude sessions), the note naming the user either way. */
export function answersEnv(text: string): { url: string; key: string; as: string | null; whose: "user" | "sessions" } | null {
  const env = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) env.set(m[1], m[2].replace(/^(['"])(.*)\1$/, "$2"));
  }
  const url = env.get("REDMINE_URL"), own = env.get("REDMINE_KEY_USER"), sessions = env.get("REDMINE_API_KEY");
  if (!url || !(own || sessions)) return null;
  return own ? { url, key: own, as: env.get("REDMINE_USER_AS") || null, whose: "user" } : { url, key: sessions!, as: null, whose: "sessions" };
}
