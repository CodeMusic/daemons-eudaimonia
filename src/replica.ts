// E-9: PRAXIS between machines. The always-on replica runs on roverbyteseer (the user, 2026-11-22), mirroring Redmine
// (mirror.ts); EUDAIMONIA on the laptop keeps a replica of its own and pulls what it lacks, so the dashboard still shows
// the tickets when the laptop is away from home, as they stood at the last pull. The exchange is PRAXIS's own (have,
// then missing): this file only carries it over HTTP. The mirrored spaces have one writer, the mirror, so the laptop
// only takes theirs; E-10: a space made on the site is the site's own, and the laptop gives its changes back, so the
// always-on replica holds them too. It refuses anything in a mirrored space, or a new space under Redmine's prefixes.
import { px, type Have, type Peer, type Praxis, type PxEvent, type Reach, type Received } from "./praxis.ts";

/** what a replica answers another: what it has seen, and what the other lacks (never a space kept on one phone) */
export const SENT: readonly Reach[] = ["home", "shared", "public"];
const BATCH_MOST = 2000;

/** the answer to GET /px/have */
export const haveOf = (p: Praxis): Have => p.have();
/** the answer to POST /px/missing, { have, limit? } */
export function missingFor(p: Praxis, body: unknown): PxEvent[] {
  const b = (body ?? {}) as { have?: unknown; limit?: unknown };
  const have = b.have && typeof b.have === "object" ? (b.have as Have) : {};
  const limit = typeof b.limit === "number" && b.limit > 0 ? Math.min(b.limit, BATCH_MOST) : 500;
  return p.missing(have, { limit, reaches: SENT });
}

/** the answer to POST /px/receive, { events }: what the asker gives -- never an event in a space `mirrored` names, nor
 *  one making a space under Redmine's prefixes (T, C, E), which only the mirror writes */
export function receiveFrom(p: Praxis, body: unknown, mirrored: Set<string>): Received {
  const events = Array.isArray((body as { events?: unknown })?.events) ? (body as { events: PxEvent[] }).events.slice(0, BATCH_MOST) : [];
  const ours = (e: PxEvent) => {
    if (!e || typeof e !== "object" || mirrored.has(e.space)) return false;
    const v = e.value as { kind?: unknown; prefix?: unknown } | undefined;
    if (e.op === "make" && e.item === e.space && v?.kind === "space" && ["T", "C", "E"].includes(String(v.prefix))) return false;
    if (e.op === "set" && e.item === e.space && e.field === "prefix" && ["T", "C", "E"].includes(String(e.value))) return false;
    return true;
  };
  const kept = events.filter(ours);
  const r = p.receive(kept);
  return { ...r, rejected: r.rejected + events.length - kept.length };
}

/** another replica, over HTTP, as one side of an exchange */
export function remote(url: string, o: { fetch?: typeof fetch; timeout?: number } = {}): Peer {
  const base = url.replace(/\/+$/, ""), f = o.fetch ?? fetch, timeout = o.timeout ?? 30_000;
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const r = await f(base + path, body === undefined
      ? { method: "GET", signal: AbortSignal.timeout(timeout) }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`${base} answered ${r.status} to ${path}`);
    return (await r.json()) as T;
  };
  return {
    have: () => call<Have>("/px/have"),
    missing: (have, m) => call<PxEvent[]>("/px/missing", { have, limit: m?.limit }),
    receive: (events) => call<Received>("/px/receive", { events }),
  };
}

/** what `local` lacks of the replica at `url`, taken: how many events, and how many wait for the clock (AHEAD) */
export async function pull(local: Praxis, url: string, o: { fetch?: typeof fetch } = {}) {
  return px.push(remote(url, o), px.local(local), { batch: 1000, reaches: SENT, blobs: false });
}

/** E-10: what the replica at `url` lacks of these spaces of the site's own, given to it */
export async function give(local: Praxis, url: string, spaces: string[], o: { fetch?: typeof fetch } = {}) {
  if (!spaces.length) return { sent: 0, ahead: 0 };
  return px.push(px.local(local), remote(url, o), { batch: 500, reaches: SENT, blobs: false, spaces });
}
