// E-15: EUDAIMONIA's agents run in a sandbox (the user, 2026-11-23, by multiple choice: MIDDLE). An agent -- a lane's
// daemon employee -- works in its own copy of every repository it holds a ticket in, DAEMONS and the engines included,
// never docs/private/; it reaches only the tailnet, GitHub, npm and the model's API; and what it makes goes out as a
// branch and a pull request, pushed by the runner (sandbox_main.ts) outside the sandbox, so it never holds a credential.
//
// Three walls, each one the kernel's or this machine's, none the agent's good manners:
//   FILES    macOS's sandbox (sandbox-exec, a profile written here): it reads nothing under the home folder but its own
//            root and the repositories' object stores, and writes nothing outside its root. Each repository is a
//            `git clone --shared` in that root -- its own .git, borrowing the objects read-only -- so a commit there can
//            never move a branch of the real repository. docs/private/ is refused by name wherever it appears.
//   NETWORK  it may open no connection but one, to the runner's proxy on this machine (proxy()), which forwards only to
//            the hosts allowed() names; HTTPS_PROXY tells its tools so, and a tool that ignores it reaches nothing.
//   OUT      a branch, agent/<lane>/<ticket>, and a pull request, both made by the runner after the agent stops.
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** the repositories a ticket's project lives in: T- is DAEMONS and its engines, C- the companion and PRAXIS's engine
 *  (C-435), E- EUDAIMONIA. The Game Boy engine (pokered-daemons) is a reference, no longer worked in. */
export const REPOS_OF: Record<string, string[]> = {
  T: ["DAEMONS", "pokefirered-daemons", "gpt-play-pokemon-firered-daemons"],
  C: ["daemons-companion", "daemons-praxis"],
  E: ["daemons-eudaimonia"],
};
/** inside DAEMONS, where each engine is reached (CLAUDE.md's symlinks), made relative to the sandbox's root */
export const ENGINE_LINKS: Record<string, string> = { engineGba: "pokefirered-daemons", engineAi: "gpt-play-pokemon-firered-daemons",
                                                       eudaimonia: "daemons-eudaimonia", companion: "daemons-companion" };

/** every repository the agent holds a ticket in, in a steady order */
export function reposFor(tickets: string[]): string[] {
  const out = new Set<string>();
  for (const t of tickets) for (const r of REPOS_OF[t[0]] ?? []) out.add(r);
  return Object.values(REPOS_OF).flat().filter((r) => out.has(r));
}

/** the branch an agent's work goes out on: agent/<lane>/<ticket>, never main */
export function branchFor(lane: string, ticket: string): string {
  if (!/^[a-z0-9-]{1,20}$/.test(lane) || !/^[TCE]-\d{1,5}$/.test(ticket)) throw new Error(`no branch for ${lane} ${ticket}`);
  return `agent/${lane}/${ticket.toLowerCase()}`;
}

// ---- the network: who it may reach ---------------------------------------------------------------------------------

/** the hosts outside the tailnet: GitHub (and its downloads), npm, and the model's API */
export const HOSTS = ["github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com",
                      "raw.githubusercontent.com", "registry.npmjs.org", "api.anthropic.com"];
/** the tailnet's own names: MagicDNS, and a machine called by its plain name (roverbyteseer) */
const TAILNET_NAME = /^([a-z0-9-]+\.)*[a-z0-9-]+\.ts\.net$/i;
const BARE_NAME = /^[a-z0-9-]{1,63}$/i;

/** a tailnet address: 100.64.0.0/10 (CGNAT, Tailscale's own), or its IPv6 fd7a:115c:a1e0::/48 */
export function tailnetIp(host: string): boolean {
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 100 && b >= 64 && b <= 127;
  }
  return isIP(host) === 6 && /^fd7a:115c:a1e0:/i.test(host);
}

/** may the sandbox reach this host, before any name is looked up? A tailnet name (a plain machine name, or *.ts.net)
 *  is only a candidate: where() looks it up and takes it only if it lands on the tailnet. */
export function allowed(host: string, port: number, extra: string[] = []): "yes" | "if-tailnet" | "no" {
  const h = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!(port > 0 && port < 65536)) return "no";
  if (tailnetIp(h)) return "yes";
  if ([...HOSTS, ...extra].includes(h)) return port === 443 || port === 80 ? "yes" : "no";
  if (TAILNET_NAME.test(h) || (BARE_NAME.test(h) && h !== "localhost")) return "if-tailnet";
  return "no";
}

type Lookup = (host: string) => Promise<string>;
/** where to connect for this host: itself, or a tailnet name's tailnet address (looked up once, and connected to by
 *  that address, so a second answer can't send it elsewhere); null when it may not be reached */
export async function where(host: string, port: number, o: { extra?: string[]; lookup?: Lookup } = {}): Promise<string | null> {
  const a = allowed(host, port, o.extra);
  if (a === "yes") return host.replace(/^\[|\]$/g, "");
  if (a === "no") return null;
  try {
    const ip = await (o.lookup ?? (async (h: string) => (await lookup(h)).address))(host);
    return tailnetIp(ip) ? ip : null;
  } catch { return null; }
}

/** The proxy the sandbox speaks through: CONNECT for HTTPS, absolute URLs for plain HTTP (the tailnet's Redmine, the
 *  site), each refused with 403 unless allowed(). Every connection, allowed or not, is told to `log`. */
export function proxy(o: { log?: (line: string) => void; extra?: string[]; lookup?: Lookup } = {}): Server {
  const log = o.log ?? (() => {});
  const server = createServer(async (req, res) => {
    req.on("error", () => res.destroy());
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { res.writeHead(400).end("a proxy wants an absolute URL\n"); return; }
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const to = url.protocol === "http:" ? await where(url.hostname, port, o) : null;
    if (!to) {
      log(`refused ${req.method} ${url.hostname}:${port}`);
      res.writeHead(403, { "Content-Type": "text/plain" }).end(`the sandbox may not reach ${url.hostname}\n`);
      return;
    }
    log(`${req.method} ${url.hostname}:${port}`);
    const headers = { ...req.headers };
    delete headers["proxy-connection"]; delete headers["proxy-authorization"];
    headers.host = url.host;
    const up = httpRequest({ host: to, port, path: url.pathname + url.search, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { if (!res.headersSent) res.writeHead(502).end(`${e.message}\n`); else res.destroy(); });
    req.pipe(up);
  });
  server.on("connect", async (req, socket, head) => {
    socket.on("error", () => socket.destroy());   // a client that hangs up is no reason to stop
    const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url ?? "");
    const host = m?.[1] ?? "", port = Number(m?.[2] ?? 0);
    const to = m ? await where(host, port, o) : null;
    if (!to) {
      log(`refused CONNECT ${req.url}`);
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nthe sandbox may not reach that\n");
      return;
    }
    log(`CONNECT ${host}:${port}`);
    const up = connect(port, to, () => {
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      if (head.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
    socket.on("close", () => up.destroy());
  });
  server.on("clientError", (_e, socket) => socket.destroy());
  return server;
}

// ---- the files: the profile ---------------------------------------------------------------------------------------

/** a path as the sandbox's profile language writes a string */
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The sandbox's profile (macOS's Seatbelt language): everything as usual outside the home folder, nothing under it
 *  but the root and what `reads` names; writes only in the root; one connection, to the proxy; and no way to start a
 *  program outside the sandbox (launchctl, open, osascript). `home` is the user's home folder; `reads` the real
 *  repositories' object stores (a shared clone borrows them) and the tools' own folders (pyenv). */
export function profile(o: { root: string; home: string; proxyPort: number; reads: string[] }): string {
  if (!o.root.startsWith("/") || !o.home.startsWith("/")) throw new Error("the sandbox's paths must be absolute");
  return [
    "(version 1)",
    ";; E-15: an agent's sandbox (daemons-eudaimonia src/sandbox.ts). Written for one run; never edited by hand.",
    "(allow default)",
    ";; FILES -- under the home folder, only its root and what it borrows",
    `(deny file-read* (subpath ${q(o.home)}))`,
    // a path's metadata (stat, realpath), never a file's contents nor a folder's listing: git normalizes the borrowed
    // objects' path through the folders above them
    `(allow file-read-metadata (subpath ${q(o.home)}))`,
    `(allow file-read* (subpath ${q(o.root)}))`,
    ...o.reads.map((r) => `(allow file-read* (subpath ${q(r)}))`),
    '(deny file-read* (regex #"/docs/private(/|$)"))',
    "(deny file-write*)",
    `(allow file-write* (subpath ${q(o.root)}))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/") (literal "/dev/dtracehelper"))',
    ";; NETWORK -- one way out, the runner's proxy",
    "(deny network-outbound)",
    `(allow network-outbound (remote ip ${q(`localhost:${o.proxyPort}`)}))`,
    "(allow network-outbound (remote unix-socket))",
    ";; no program started outside the sandbox",
    '(deny process-exec (literal "/bin/launchctl") (literal "/usr/bin/open") (literal "/usr/bin/osascript") (literal "/usr/bin/ssh"))',
    "",
  ].join("\n");
}

/** the environment the agent starts with: nothing of the runner's but PATH, its own home and temp in the root, the
 *  proxy, and the variables the run passes on by name (the model's key) */
export function sandboxEnv(o: { root: string; proxyPort: number; path: string; pass?: Record<string, string>;
                                lane: string; ticket: string; branch: string }): Record<string, string> {
  const p = `http://localhost:${o.proxyPort}`;
  return {
    PATH: o.path, HOME: `${o.root}/home`, TMPDIR: `${o.root}/tmp`, LANG: "en_US.UTF-8",
    HTTPS_PROXY: p, HTTP_PROXY: p, https_proxy: p, http_proxy: p, ALL_PROXY: p, NO_PROXY: "", no_proxy: "",
    npm_config_cache: `${o.root}/home/.npm`, GIT_CONFIG_NOSYSTEM: "1",
    EUDAIMONIA_LANE: o.lane, EUDAIMONIA_TICKET: o.ticket, EUDAIMONIA_BRANCH: o.branch, EUDAIMONIA_SANDBOX: o.root,
    ...(o.pass ?? {}),
  };
}
