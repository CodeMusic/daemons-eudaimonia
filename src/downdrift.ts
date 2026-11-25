// C-507 (the user, 2026-11-25: "yes -- behind sign-in"): THE DOWNDRIFT STUDIO from away, at downdrift.daemons.codemusic.ca
// (and /downdrift/ on any name of this site's). The studio itself lives on the companion hub (its server/downdrift/,
// served at the hub's /downdrift/); this site serves it to someone signed in and relays only the few calls it makes --
// reading the drifts and the hub's pieces, saving and choosing a drift -- adding the hub's key itself, so the key never
// reaches a browser and nothing else of the hub is reachable through here. The hub's address and key are in the same
// env file as the Redmine keys: DAEMONS_HUB_URL, DAEMONS_HUB_KEY (a key the hub paired for "EUDAIMONIA").
export type Hub = { url: string; key: string };

/** The hub's address and key from the env file's lines, or null when either is missing. */
export function hubEnv(text: string): Hub | null {
  const v: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) v[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return v.DAEMONS_HUB_URL && v.DAEMONS_HUB_KEY ? { url: v.DAEMONS_HUB_URL.replace(/\/+$/, ""), key: v.DAEMONS_HUB_KEY } : null;
}

// what the studio may ask the hub for, and nothing else (the studio's own studio.js)
const CALLS: [string, RegExp][] = [
  ["GET", /^\/api\/drifts$/],
  ["GET", /^\/api\/drifts\/[a-z0-9-]{1,80}$/],
  ["POST", /^\/api\/drifts\/(save|choose)$/],
  ["GET", /^\/api\/sleep\/tracks$/],
  ["GET", /^\/api\/sleep\/track\/[0-9a-f]{8,64}\/phone\.m4a$/],
  ["POST", /^\/api\/reverie\/render$/],                              // C-508: a drift over a piece, as one MP3
  ["GET", /^\/api\/reverie\/renders$/],
  ["GET", /^\/api\/reverie\/render\/[a-z0-9-]{1,90}--[0-9a-f]{32}\.mp3$/],
];
/** The hub path a relayed request stands for (/downdrift/hub/api/... -> /api/...), or null when it is not one the studio makes. */
export function relayed(method: string, path: string): string | null {
  const m = /^\/downdrift\/hub(\/api\/.*)$/.exec(path);
  return m && CALLS.some(([verb, re]) => verb === method && re.test(m[1])) ? m[1] : null;
}
// the studio's own files, by their names on the hub
export const STUDIO_FILES = new Set(["/downdrift/", "/downdrift/index.html", "/downdrift/studio.js", "/downdrift/studio.css"]);
/** The studio's page, told to use the relay for its API. */
export const throughRelay = (html: string) =>
  html.replace(/<meta name="downdrift-api" content="[^"]*">/, '<meta name="downdrift-api" content="/downdrift/hub/api">');
// as the site's own pages (server.ts HEADERS), and a piece from the hub may play (an <audio> of a blob: URL)
export const STUDIO_CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; " +
                          "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** Ask the hub, with its key. */
export async function askHub(hub: Hub, method: string, path: string, body?: string): Promise<Response> {
  return fetch(hub.url + path, {
    method, body: method === "POST" ? body ?? "{}" : undefined, signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${hub.key}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
  });
}
