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
// THE EASTER EGG (C-437, egg.ts), for anyone who finds it -- no sign-in:
//   POST /api/egg/open {password}             its door: a pass for this browser, as the cookie eudaimonia-egg
//   GET  /api/egg/carts                       the release, the two carts and the patches that make them, the player's port
//   GET  /egg/patch/<release>/<file>.bps      a release's BPS patch, for a player's own cart (published anyway)
//   POST /api/egg/rom {edition, agreed}       the release's own ROM: with the pass, and the backups ticked
//
// THE DASHBOARD (E-1), for anyone who reaches the site (the user, 2026-11-21, by multiple choice) -- read-only:
//   GET  /api/lane/<lane>            one lane's page: a daemon employee's work, ARETE and history (E-6, redmine.ts)
//   GET  /api/board                  the lanes at work, what waits on the user, each project's progress (redmine.ts)
//   GET  /api/ticket/<T-n|C-n|E-n>   one ticket: its words, fields and last notes, for its modal
//   GET  /api/releases               every release, newest first   GET /api/release/<name>   one release's notes
//   POST /api/ticket/<id>/answer {text, choice?, keep?}   (an admin) answer a ticket that waits on the user (answers.ts)
//   GET  /release/<group>/notes.pdf  a sealed group's notes          GET /art/player.png       the player, the monkey
//
// An agent calls the API with `Authorization: Bearer <its key>`; a person's browser with the session cookie. A POST
// from a browser must come from a page of this site (its Origin is this Host), as JSON -- another site's page cannot
// sign anyone in, out or anywhere else.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { type Account, type Accounts, type Kind, Refused, shown } from "./accounts.ts";
import type { Avatars } from "./avatars.ts";
import { type Egg, isEdition } from "./egg.ts";
import { TICKET_ID, waitsOnUser } from "./redmine.ts";
import type { Tickets } from "./tickets.ts";
import { type Answers, ticketChoices } from "./answers.ts";
import type { Releases } from "./releases.ts";
import { allowed, home, ourHost } from "./reach.ts";

export const COOKIE = "eudaimonia", EGG_COOKIE = "eudaimonia-egg";
const BODY_MOST = 16 * 1024, FAILS_MOST = 8, FAILS_WINDOW_MS = 15 * 60 * 1000;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                                        ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};

export type Options = { accounts: Accounts; avatars: Avatars; web: string; log?: (line: string) => void; now?: () => number;
                        egg?: Egg; player?: number;
                        /** E-1: the tickets (null: no key to read them with) -- PRAXIS's replica once it holds them (E-9),
                         *  Redmine until then -- the releases, the companion's art folder */
                        redmine?: Tickets | null; releases?: Releases; art?: string;
                        /** E-1's second slice: the one write, answering a ticket that waits on the user (null: no key) */
                        answers?: Answers | null };

type Who = { account: Account; limited: boolean } | null;

export function makeServer(o: Options): Server {
  const log = o.log ?? ((l: string) => console.log("eudaimonia: " + l));
  const now = o.now ?? (() => Date.now());
  const fails = new Map<string, number[]>();
  // the front page frames the playground's page, on this same host, as THE EASTER EGG's player (egg.js)
  const port = o.player ?? 4740;
  const page = { "Content-Security-Policy": HEADERS["Content-Security-Policy"] + `; frame-src http://*:${port} https://*:${port}` };

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
      if (path === "/" || path === "/index.html") return file(res, join(o.web, "index.html"), "no-cache", page);
      const m = /^\/sprite\/(\d+)\.png$/.exec(path);
      if (m) {
        const p = o.avatars.sprite(Number(m[1]));
        return p ? file(res, p, "public, max-age=86400") : notFound(res);
      }
      if (/^\/[a-z0-9_-]+\.(js|css|svg|png)$/.test(path)) return file(res, join(o.web, path.slice(1)), "no-cache");
      // the player as the game draws them, from the companion's art: ours, never Nintendo's. INSTINCT, the striding one
      // (E-8, the user 2026-11-22: "INSTINCT for E-8")
      if (path === "/art/player.png") return o.art ? file(res, join(o.art, "player_instinct.png"), "public, max-age=86400") : notFound(res);
      const sealed = /^\/release\/(v[0-9]+\.[0-9]+\.x)\/notes\.pdf$/.exec(path);
      if (sealed) {
        const p = o.releases?.pdf(sealed[1]);
        return p ? stream(res, p, "application/pdf", "public, max-age=3600",
                          { "Content-Security-Policy": "frame-ancestors 'none'", "Content-Disposition": `inline; filename="ReleaseNotes_${sealed[1]}.pdf"` })
                 : notFound(res);
      }
      const bps = /^\/egg\/patch\/(v[0-9.x]+)\/([^/]+\.bps)$/.exec(path);
      if (bps) {
        let name = "";
        try { name = decodeURIComponent(bps[2]); } catch { /* not a name */ }
        const p = name && o.egg?.patch(bps[1], name);   // only a name its PATCHES/ lists
        return p ? stream(res, p, "application/octet-stream", "public, max-age=31536000, immutable") : notFound(res);
      }
    }

    if (!path.startsWith("/api/")) return notFound(res);
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;
    if (method !== "GET" && method !== "HEAD" && !bearer) {
      // a browser's POST: from this site's own page, as JSON
      const origin = req.headers.origin;
      if (!origin || !sameSite(origin, req.headers.host)) throw new Refused("Not from a page of this site's.", 403);
      if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) throw new Refused("Send JSON.", 415);
    }
    const who: Who = o.accounts.who(cookie(req, COOKIE), bearer);
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
      o.accounts.signOut(cookie(req, COOKIE));
      res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, { ok: true });
    }

    if (path === "/api/avatars" && method === "GET") return json(res, { groups: o.avatars.groups });

    // ---- THE DASHBOARD: read-only, for anyone --------------------------------------------------------------------------
    if (path === "/api/board" && method === "GET") {
      if (!o.redmine) return json(res, { board: null, why: "This site has no key to read the tickets with." });
      const board = await o.redmine.board(), agents = o.accounts.agents();
      return json(res, { board: { ...board, lanes: board.lanes.map((l) => {
        const daemon = agents.get(l.lane) ?? null;
        return { ...l, account: agents.has(l.lane), daemon, daemonName: daemon == null ? null : o.avatars.daemon(daemon)?.name ?? null };
      }) } });
    }
    const ticket = /^\/api\/ticket\/([A-Z]-[0-9]+)$/.exec(path);
    if (ticket && method === "GET") {
      if (!o.redmine) throw new Refused("This site has no key to read the tickets with.", 503);
      const t = TICKET_ID.test(ticket[1]) ? await o.redmine.ticket(ticket[1]) : null;
      if (!t) throw new Refused(`No ticket ${ticket[1]} here.`, 404);
      const waiting = waitsOnUser(t.status, t.fields.find((f) => f.name === "Blocked on")?.value ?? null);
      return json(res, { ticket: { ...t, waiting, choices: waiting ? ticketChoices(t) : [], answerable: !!o.answers } });
    }
    const lane = /^\/api\/lane\/([a-z0-9-]{1,20})$/.exec(path);
    if (lane && method === "GET") {
      if (!o.redmine) throw new Refused("This site has no key to read the tickets with.", 503);
      const l = await o.redmine.lane(lane[1]);
      if (!l) throw new Refused(`No lane ${lane[1]} here.`, 404);
      const agents = o.accounts.agents(), daemon = agents.get(l.lane) ?? null;
      return json(res, { lane: { ...l, account: agents.has(l.lane), daemon,
                                 daemonName: daemon == null ? null : o.avatars.daemon(daemon)?.name ?? null } });
    }
    if (path === "/api/releases" && method === "GET") return json(res, { releases: o.releases?.list() ?? [] });
    const release = /^\/api\/release\/(v[0-9]+\.[0-9]+\.(?:[0-9]+|x))$/.exec(path);
    if (release && method === "GET") {
      const r = o.releases?.notes(release[1]);
      if (!r) throw new Refused(`No release ${release[1]} here.`, 404);
      return json(res, r);
    }

    // ---- THE EASTER EGG: no sign-in, its own password ----------------------------------------------------------------
    if (path === "/api/egg/carts" && method === "GET") {
      if (!o.egg) throw new Refused("No releases here.", 404);
      return json(res, { ...o.egg.carts(), pass: o.accounts.hasEggPass(cookie(req, EGG_COOKIE)), player: o.player ?? 4740 });
    }
    if (path === "/api/egg/open" && method === "POST") {
      if (throttled(addr)) throw new Refused("Too many tries. Wait a quarter of an hour and try again.", 429);
      try {
        const t = await o.accounts.eggPass(String(body.password ?? ""));
        log(`${addr} opened THE EASTER EGG`);
        res.setHeader("Set-Cookie", `${EGG_COOKIE}=${encodeURIComponent(t)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`);
        return json(res, { pass: true });
      } catch (e) {
        if (e instanceof Refused && e.status === 401) failed(addr);
        throw e;
      }
    }
    if (path === "/api/egg/rom" && method === "POST") {
      if (!o.egg) throw new Refused("No releases here.", 404);
      if (!o.accounts.hasEggPass(cookie(req, EGG_COOKIE))) throw new Refused("The password first.", 401);
      if (body.agreed !== true) throw new Refused("Tick that these are backups of carts you own.");
      if (!isEdition(body.edition)) throw new Refused("No such cart.");
      const rom = o.egg.rom(body.edition);
      if (!rom || !existsSync(rom.path)) throw new Refused("No release has that cart yet.", 404);
      log(`${addr} played ${body.edition} from the release, ${rom.release}, its backup ticked`);
      res.setHeader("X-Release", rom.release);
      return stream(res, rom.path, "application/octet-stream", "no-store");
    }

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

    const answer = /^\/api\/ticket\/([A-Z]-[0-9]+)\/answer$/.exec(path);
    if (answer && method === "POST") {
      if (!me.admin || me.kind !== "person") throw new Refused("Only an admin can answer a ticket.", 403);
      if (!o.answers) throw new Refused("This site has no key to answer with.", 503);
      const r = await o.answers.answer(answer[1], { text: String(body.text ?? ""), keep: body.keep === true,
                                                     choice: body.choice == null ? null : String(body.choice) });
      await o.redmine?.forget(answer[1]);   // E-9: PRAXIS takes the answer before the page loads the board again
      log(`${addr} ${me.name} answered ${r.ticket}${body.keep === true ? ", which still waits on the user" : `: back to ${r.status}`}`);
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

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name && v.length) { try { return decodeURIComponent(v.join("=")); } catch { return null; } }
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

function file(res: ServerResponse, p: string, cache: string, extra: Record<string, string> = {}) {
  if (!existsSync(p)) return notFound(res);
  const data = readFileSync(p);
  res.writeHead(200, { "Content-Type": TYPES[extname(p)] ?? "application/octet-stream", "Content-Length": data.length,
                       "Cache-Control": cache, ...HEADERS, ...extra }).end(res.req.method === "HEAD" ? undefined : data);
}

function stream(res: ServerResponse, p: string, type: string, cache: string, extra: Record<string, string> = {}) {
  res.writeHead(200, { "Content-Type": type, "Content-Length": statSync(p).size, "Cache-Control": cache, ...HEADERS, ...extra });
  if (res.req.method === "HEAD") return res.end();
  createReadStream(p).on("error", () => res.destroy()).pipe(res);
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain", ...HEADERS }).end("nothing here\n");
}
