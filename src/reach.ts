// Who may reach EUDAIMONIA, as the playground's server decides it (server/playground.py, allowed and our_host): this
// machine, the private ranges a home network uses and the tailnet. Anything else is refused before a byte is read.
//
// HOME is narrower and outlives the day the site goes public (C-436): the first password, admin / admin, is taken only
// from home -- a request whose socket is home and which no proxy carried. A proxy in front (C-408's Apache) makes
// every visitor look like a private address, so a request naming another hop (Forwarded, X-Forwarded-For, X-Real-IP)
// is never home, whatever address it arrives from.
import { isIP } from "node:net";

function v4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

function v6Words(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const words = (s: string) => (s ? s.split(":") : []);
  const head = words(halves[0]), tail = halves.length === 2 ? words(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  const out = all.map((w) => (/^[0-9a-f]{1,4}$/i.test(w) ? parseInt(w, 16) : NaN));
  return out.length === 8 && out.every((x) => !Number.isNaN(x)) ? out : null;
}

/** This machine, a home network's private ranges, or the tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48). */
export function allowed(address: string | undefined): boolean {
  let a = (address || "").split("%")[0].toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  const kind = isIP(a);
  if (kind === 4) {
    const [x, y] = v4(a) as number[];
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)
      || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  if (kind === 6) {
    const w = v6Words(a);
    if (!w) return false;
    if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true;        // ::1
    return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80;            // fc00::/7 (the tailnet's fd7a:: too), fe80::/10
  }
  return false;
}

/** A Host or an Origin that is this machine's kind of name -- an address, localhost, .local, .ts.net or a bare name:
 * a look-alike name pointed here (DNS rebinding) is refused, and so is another site's page posting to this one. */
export function ourHost(hostOrUrl: string | undefined): boolean {
  let name = (hostOrUrl || "").trim().toLowerCase();
  if (!name) return true;
  if (name === "null") return false;
  try {
    name = new URL(name.includes("://") ? name : "http://" + name).hostname;
  } catch {
    return false;
  }
  if (name.startsWith("[") && name.endsWith("]")) return true;
  if (/^[0-9.]+$/.test(name)) return true;
  return name === "localhost" || name.endsWith(".local") || name.endsWith(".ts.net") || !name.includes(".");
}

const HOPS = ["forwarded", "x-forwarded-for", "x-real-ip"];

/** Home: a socket address that is allowed, and no proxy between it and this server. */
/** E-19: a public name this site was given (EUDAIMONIA_PUBLIC_HOSTS), e.g. dashboard.daemons.codemusic.ca behind the
 * home web server's proxy. Only ever accepted with a proxy's hop headers on a request from an allowed address -- the
 * proxy in the house -- and such a request is never home(), so the first password still never works through it. */
export function publicName(hostOrUrl: string | undefined, names: readonly string[]): boolean {
  if (!names.length || !hostOrUrl) return false;
  try {
    const s = hostOrUrl.trim().toLowerCase();
    return names.includes(new URL(s.includes("://") ? s : "https://" + s).hostname);
  } catch { return false; }
}

/** The client a proxy says it is serving: the last address in X-Forwarded-For (the one our own proxy appended). */
export function forwardedFor(headers: Record<string, string | string[] | undefined>): string | null {
  const v = headers["x-forwarded-for"];
  const last = (Array.isArray(v) ? v.join(",") : v ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || null;
}

export function proxied(headers: Record<string, string | string[] | undefined>): boolean {
  return HOPS.some((h) => headers[h] !== undefined);
}

export function home(address: string | undefined, headers: Record<string, string | string[] | undefined>): boolean {
  return allowed(address) && !HOPS.some((h) => headers[h] !== undefined);
}
