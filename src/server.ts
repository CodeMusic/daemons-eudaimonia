// EUDAIMONIA's server: the front page's frame (C-439), sign-in and the accounts (C-436). No framework, no package at
// run time -- Node 24 runs this TypeScript as it is. It answers only this machine, a home network and the tailnet
// (reach.ts) until the site goes public (C-408), and keeps that rule for the first password after it does.
//
//   GET  /                       the front page (web/)        GET  /sprite/<id>.png   a daemon's front sprite
//   GET  /api/me                 who is signed in, or no one  GET  /api/avatars       the daemons, grouped by type
//   POST /api/signin  {name, password}                        POST /api/signout
//   POST /api/password {old, new}                             POST /api/avatar  {avatar}
//   GET  /api/accounts           (admin) every account        POST /api/accounts {name, kind, admin?, avatar?}
//   POST /api/accounts/<id>      (admin) {action: reset | disable | enable | admin | member | avatar, avatar?}
//   GET  /api/egg  POST /api/egg {password}   (admin) THE EASTER EGG's password: set or not, and when
//
// An agent calls the API with `Authorization: Bearer <its key>`; a person's browser with the session cookie. A POST
// from a browser must come from a page of this site (its Origin is this Host), as JSON -- another site's page cannot
// sign anyone in, out or anywhere else.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { type Account, type Accounts, type Kind, Refused, shown } from "./accounts.ts";
import type { Avatars } from "./avatars.ts";
import { allowed, home, ourHost } from "./reach.ts";

export const COOKIE = "eudaimonia";
const BODY_MOST = 16 * 1024, FAILS_MOST = 8, FAILS_WINDOW_MS = 15 * 60 * 1000;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                                        ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};

export type Options = { accounts: Accounts; avatars: Avatars; web: string; log?: (line: string) => void; now?: () => number };

type Who = { account: Account; limited: boolean } | null;

export function makeServer(o: Options): Server {
  const log = o.log ?? ((l: string) => console.log("eudaimonia: " + l));
  const now = o.now ?? (() => Date.now());
  const fails = new Map<string, number[]>();

  const failed = (addr: string) => {
    const t = now(), recent = (fails.get(addr) ?? []).filter((x) => t - x < FAILS_WINDOW_MS);
    recent.push(t);
    fails.set(addr, recent);
  };
  const throttled = (addr: string) => (fails.get(addr) ?? []).filter((x) => now() - x < FAILS_WINDOW_MS).length >= FAILS_MOST;

  return createServer(async (req, res) => {
    const addr = req.socket.remoteAddress ?? "";
    if (!allowed(addr) || !ourHost(req.headers.host)) {
      res.writeHead(403, { "Content-Type": "text/plain", ...HEADERS }).end("not an address of this site's\n");
      req.destroy();
      return;
    }
    try {
      await route(req, res, addr);
    } catch (e) {
      if (e instanceof Refused) return json(res, { error: e.message }, e.status);
      log(`${addr} ${req.method} ${req.url}: ${(e as Error).stack ?? e}`);
      json(res, { error: "Something went wrong on the server." }, 500);
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse, addr: string) {
    const url = new URL(req.url ?? "/", "http://site");
    const path = url.pathname, method = req.method ?? "GET";

    if (method === "GET" || method === "HEAD") {
      if (path === "/" || path === "/index.html") return file(res, join(o.web, "index.html"), "no-cache");
      const m = /^\/sprite\/(\d+)\.png$/.exec(path);
      if (m) {
        const p = o.avatars.sprite(Number(m[1]));
        return p ? file(res, p, "public, max-age=86400") : notFound(res);
      }
      if (/^\/[a-z0-9_-]+\.(js|css|svg|png)$/.test(path)) return file(res, join(o.web, path.slice(1)), "no-cache");
    }

    if (!path.startsWith("/api/")) return notFound(res);
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;
    if (method !== "GET" && method !== "HEAD" && !bearer) {
      // a browser's POST: from this site's own page, as JSON
      const origin = req.headers.origin;
      if (!origin || !sameSite(origin, req.headers.host)) throw new Refused("Not from a page of this site's.", 403);
      if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) throw new Refused("Send JSON.", 415);
    }
    const who: Who = o.accounts.who(cookie(req), bearer);
    if (bearer && !who) throw new Refused("That key opens no account.", 401);
    const body = method === "POST" ? await read(req) : {};

    if (path === "/api/me" && method === "GET")
      return json(res, { account: who ? shown(who.account) : null, limited: !!who?.limited, avatars: o.avatars.count });

    if (path === "/api/signin" && method === "POST") {
      if (throttled(addr)) throw new Refused("Too many tries. Wait a quarter of an hour and try again.", 429);
      try {
        const r = await o.accounts.signIn(String(body.name ?? ""), String(body.password ?? ""), home(addr, req.headers));
        log(`${addr} signed in as ${r.account.name}${r.account.mustChange ? " (its password to be changed)" : ""}`);
        setCookie(res, r.session, r.account.mustChange);
        return json(res, { account: r.account, limited: r.account.mustChange });
      } catch (e) {
        if (e instanceof Refused && e.status === 401) failed(addr);
        if (e instanceof Refused) log(`${addr} sign-in refused for ${JSON.stringify(String(body.name ?? "").slice(0, 32))}: ${e.message}`);
        throw e;
      }
    }

    if (path === "/api/signout" && method === "POST") {
      o.accounts.signOut(cookie(req));
      res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, { ok: true });
    }

    if (path === "/api/avatars" && method === "GET") return json(res, { groups: o.avatars.groups });

    if (!who) throw new Refused("Sign in first.", 401);
    const me = who.account;

    if (path === "/api/password" && method === "POST") {
      const r = await o.accounts.changePassword(me, String(body.old ?? ""), String(body.new ?? ""));
      log(`${addr} ${me.name} changed their password`);
      setCookie(res, r.session, false);
      return json(res, { account: r.account, limited: false });
    }
    if (who.limited) throw new Refused("Change the password first.", 403);

    if (path === "/api/avatar" && method === "POST") return json(res, { account: o.accounts.setAvatar(me, avatar(body.avatar)) });

    if (path === "/api/accounts" && method === "GET") {
      if (!me.admin) throw new Refused("Only an admin can do that.", 403);
      return json(res, { accounts: o.accounts.list() });
    }
    if (path === "/api/accounts" && method === "POST") {
      const r = await o.accounts.make(me, String(body.name ?? ""), String(body.kind ?? "") as Kind, !!body.admin,
                                       body.avatar == null ? null : avatar(body.avatar));
      log(`${addr} ${me.name} made ${r.account.kind} ${r.account.name}`);
      return json(res, r, 201);
    }
    const one = /^\/api\/accounts\/([0-9a-f-]{36})$/.exec(path);
    if (one && method === "POST") {
      const id = one[1], action = String(body.action ?? "");
      let r: unknown;
      if (action === "reset") r = await o.accounts.reset(me, id);
      else if (action === "disable" || action === "enable") r = { account: o.accounts.setDisabled(me, id, action === "disable") };
      else if (action === "admin" || action === "member") r = { account: o.accounts.setAdmin(me, id, action === "admin") };
      else if (action === "avatar") r = { account: o.accounts.adminAvatar(me, id, avatar(body.avatar)) };
      else throw new Refused("No such action.");
      log(`${addr} ${me.name}: ${action} ${o.accounts.get(id)?.name}`);
      return json(res, r);
    }

    if (path === "/api/egg") {
      if (!me.admin) throw new Refused("Only an admin can do that.", 403);
      if (method === "GET") return json(res, o.accounts.egg());
      if (method === "POST") {
        const r = await o.accounts.setEgg(me, String(body.password ?? ""));
        log(`${addr} ${me.name} set THE EASTER EGG's password`);
        return json(res, r);
      }
    }
    return notFound(res);
  }

  function avatar(v: unknown): number | null {
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || !o.avatars.has(n)) throw new Refused("No such daemon.");
    return n;
  }
}

function sameSite(origin: string, host: string | undefined) {
  try { return new URL(origin).host === (host ?? "").toLowerCase() && ourHost(origin); } catch { return false; }
}

function cookie(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE && v.length) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setCookie(res: ServerResponse, token: string, limited: boolean) {
  const age = limited ? 15 * 60 : 30 * 24 * 60 * 60;
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`);
}

function read(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_MOST) { reject(new Refused("Too much.", 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!size) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
      } catch { reject(new Refused("That is not JSON.")); }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, v: unknown, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADERS })
     .end(JSON.stringify(v));
}

function file(res: ServerResponse, p: string, cache: string) {
  if (!existsSync(p)) return notFound(res);
  const data = readFileSync(p);
  res.writeHead(200, { "Content-Type": TYPES[extname(p)] ?? "application/octet-stream", "Content-Length": data.length,
                       "Cache-Control": cache, ...HEADERS }).end(res.req.method === "HEAD" ? undefined : data);
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain", ...HEADERS }).end("nothing here\n");
}
