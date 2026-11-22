// E-9: PRAXIS between machines. The always-on replica runs on roverbyteseer (the user, 2026-11-22), mirroring Redmine
// (mirror.ts); EUDAIMONIA on the laptop keeps a replica of its own and pulls what it lacks, so the dashboard still shows
// the tickets when the laptop is away from home, as they stood at the last pull. The exchange is PRAXIS's own (have,
// then missing): this file only carries it over HTTP. For now it carries one way -- the laptop takes, never gives --
// because the mirrored spaces have one writer; giving back comes with E-10, for spaces of the site's own.
import { px, type Have, type Peer, type Praxis, type PxEvent, type Reach } from "./praxis.ts";

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

/** another replica, over HTTP, as one side of an exchange that only takes from it */
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
    receive: () => { throw new Error("this replica takes from that one and never gives to it (E-9)"); },
  };
}

/** what `local` lacks of the replica at `url`, taken: how many events, and how many wait for the clock (AHEAD) */
export async function pull(local: Praxis, url: string, o: { fetch?: typeof fetch } = {}) {
  return px.push(remote(url, o), px.local(local), { batch: 1000, reaches: SENT, blobs: false });
}
