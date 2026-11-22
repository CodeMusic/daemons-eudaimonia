// E-9: the WORK form (companion docs/PROJECTS.md 8 and 10), made from what Redmine holds: a tracker is a KIND, a status
// a STATE, a custom field a FIELD. It is made again from Redmine's lists at every run of the mirror, so a new status or
// field arrives as a newer version of the form (an event, like any other). The engine's names cannot hold spaces, so
// "In progress" is the state in-progress and "Blocked on" the field blocked_on; each keeps Redmine's words as its title.
import { px, type Form, type KindDef, type StateDef } from "./praxis.ts";

export const FORM_NAME = "WORK";
/** E-6's numbers, DRAFT: the ARETE a finished ticket pays, by its tracker (companion docs/PROJECTS.md 6) */
export const POINTS: Record<string, number> = { job: 5, bug: 3 };
export const POINTS_OTHER = 2;

/** where each of Redmine's statuses sits among the engine's four phases (a state is never "failed") */
const PHASE: Record<string, StateDef["phase"]> = {
  "ready": "open", "in-progress": "doing", "blocked": "open", "needs-decision": "open",
  "deferred": "aside", "closed": "done", "superseded": "aside",
};
/** the fields every ticket has besides its custom ones */
const OWN: Record<string, { type: "text" | "long" | "number" | "date"; title: string }> = {
  description: { type: "long", title: "Description" }, priority: { type: "text", title: "Priority" },
  lane: { type: "text", title: "Lane" }, author: { type: "text", title: "Author" }, tracker: { type: "text", title: "Tracker" },
  redmine: { type: "number", title: "Redmine's id" }, opened: { type: "date", title: "Opened" },
  updated: { type: "date", title: "Updated" }, closed: { type: "date", title: "Closed" },
};
/** custom fields that are not text */
const TYPED: Record<string, "number" | "long"> = { order: "number", commits: "long", extra_cells: "long" };

/** "In progress" -> in-progress, "Needs decision" -> needs-decision */
export const stateName = (status: string) => status.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** "Blocked on" -> blocked_on, "Why not yet" -> why_not_yet; a name the engine keeps for itself (Redmine's "State" is
 *  the TODO table's column, not the item's state) is cf_state */
export function fieldName(custom: string) {
  const k = custom.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return (px.CORE as readonly string[]).includes(k) || k === "kind" ? "cf_" + k : k;
}
/** "Job" -> job */
export const kindName = (tracker: string) => stateName(tracker) || "ticket";

export type Lists = { trackers: string[]; statuses: { name: string; closed: boolean }[]; fields: string[] };

/** The form for these lists. `closed` (in its rules) names the states Redmine counts as closed, since phases alone do
 *  not say it: SUPERSEDED is set aside and closed, DEFERRED set aside and open. */
export function workForm(l: Lists, version = 1): Form {
  const states: StateDef[] = l.statuses.map((s) => ({ name: stateName(s.name), title: s.name,
                                                      phase: PHASE[stateName(s.name)] ?? (s.closed ? "aside" : "open") }));
  const fields: KindDef["fields"] = {};
  for (const [k, f] of Object.entries(OWN)) fields[k] = { ...f };
  for (const name of l.fields) { const k = fieldName(name); if (k && !(k in fields)) fields[k] = { type: TYPED[k] ?? "text", title: name }; }
  const kinds: Form["kinds"] = {};
  for (const t of l.trackers) kinds[kindName(t)] = { title: t, points: POINTS[kindName(t)] ?? POINTS_OTHER, states, fields };
  return { name: FORM_NAME, version, kinds, rules: [{ closed: l.statuses.filter((s) => s.closed).map((s) => stateName(s.name)) }] };
}

/** the states a WORK form counts as closed */
export function closedStates(f: Form | null): Set<string> {
  const rule = (f?.rules ?? []).find((r): r is { closed: string[] } => !!r && Array.isArray((r as { closed?: unknown }).closed));
  return new Set(rule?.closed ?? ["closed", "superseded"]);
}

/** true when two forms say the same thing, whatever their versions */
export function sameForm(a: Form | null, b: Form): boolean {
  if (!a) return false;
  const body = (f: Form) => JSON.stringify({ ...f, version: 0 });
  return body(a) === body(b);
}
