// The site over HTTP: the first sign-in from start to finish, what a browser's POST must carry, an agent's key, and
// the sprites. On a port of its own, with a handful of made-up daemons -- never the companion's own data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { makeServer } from "../src/server.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da6364f8ffbf1e000502027fa1d4c7d70000000049454e44ae426082", "hex");
let server: Server, base = "", host = "";

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-site-"));
  mkdirSync(join(dir, "DAEMONS", "gfx", "daemons"), { recursive: true });
  writeFileSync(join(dir, "DAEMONS", "gfx", "daemons", "one_front.png"), PNG);
  writeFileSync(join(dir, "cards.json"), JSON.stringify({
    type_colours: { GROWTH: "#315231", FLOW: "#20395a" },
    cards: {
      "1": { number: "001", name: "ONE", types: ["GROWTH"], category: "FIRST", art: { front: "gfx/daemons/one_front.png" } },
      "2": { number: "002", name: "TWO", types: ["FLOW", "GROWTH"], category: "SECOND", art: { front: "gfx/daemons/missing.png" } },
      "3": { number: "003", name: "ESCAPE", types: ["FLOW"], category: "THIRD", art: { front: "../../etc/passwd" } },
    },
  }));
  const accounts = new Accounts(join(dir, "data", "accounts.json"), 1 << 10);
  await accounts.open();
  server = makeServer({ accounts, avatars: new Avatars(join(dir, "cards.json"), join(dir, "DAEMONS")), web: join(import.meta.dirname, "..", "web"), log: () => {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  host = `127.0.0.1:${port}`;
  base = `http://${host}`;
});
after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

type Opts = { cookie?: string; origin?: string | null; bearer?: string; headers?: Record<string, string> };
async function call(method: string, path: string, body?: unknown, o: Opts = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && o.origin !== null) headers.Origin = o.origin ?? base;
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.bearer) headers.Authorization = `Bearer ${o.bearer}`;
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] || undefined;
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, cookie, body: ct.includes("json") ? await r.json() : await r.text(), headers: r.headers };
}

test("the front page is served with a strict content policy", async () => {
  const r = await call("GET", "/");
  assert.equal(r.status, 200);
  assert.match(String(r.body), /EUDAIMONIA/);
  assert.match(r.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.equal((await call("GET", "/app.js")).status, 200);
  assert.equal((await call("GET", "/../src/accounts.ts")).status, 404);
});

test("a look-alike Host is refused before anything else", async () => {
  // fetch will not send a forged Host, so plain HTTP: a name pointed here by someone else's DNS (rebinding)
  const status = await new Promise<number>((res, rej) => {
    const [h, port] = host.split(":");
    request({ host: h, port: Number(port), path: "/api/me", headers: { Host: "evil.example.com" } }, (r) => { r.resume(); res(r.statusCode ?? 0); })
      .on("error", rej).end();
  });
  assert.equal(status, 403);
});

test("the first sign-in: admin / admin from home, then the password, then the rest", async () => {
  assert.equal((await call("GET", "/api/me")).body.account, null);
  const proxied = await call("POST", "/api/signin", { name: "admin", password: "admin" }, { headers: { "X-Forwarded-For": "8.8.8.8" } });
  assert.equal(proxied.status, 403);
  const s = await call("POST", "/api/signin", { name: "admin", password: "admin" });
  assert.equal(s.status, 200);
  assert.equal(s.body.limited, true);
  assert.ok(s.cookie?.startsWith("eudaimonia="));
  assert.equal((await call("GET", "/api/accounts", undefined, { cookie: s.cookie })).status, 403);
  const c = await call("POST", "/api/password", { old: "admin", new: "the long way home" }, { cookie: s.cookie });
  assert.equal(c.status, 200);
  assert.equal(c.body.limited, false);
  assert.equal((await call("GET", "/api/me", undefined, { cookie: s.cookie })).body.account, null);   // the old session ended
  const list = await call("GET", "/api/accounts", undefined, { cookie: c.cookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.accounts.map((a: { name: string }) => a.name), ["admin"]);

  // an agent, and its key
  const made = await call("POST", "/api/accounts", { name: "hub", kind: "agent", avatar: 1 }, { cookie: c.cookie });
  assert.equal(made.status, 201);
  const me = await call("GET", "/api/me", undefined, { bearer: made.body.secret });
  assert.equal(me.body.account.name, "hub");
  assert.equal(me.body.account.kind, "agent");
  assert.equal((await call("POST", "/api/avatar", { avatar: 2 }, { bearer: made.body.secret, origin: null })).status, 200);
  assert.equal((await call("GET", "/api/accounts", undefined, { bearer: made.body.secret })).status, 403);
  assert.equal((await call("GET", "/api/me", undefined, { bearer: "eud_not-a-key" })).status, 401);

  // a browser's POST must come from this site's page, as JSON
  assert.equal((await call("POST", "/api/avatar", { avatar: 1 }, { cookie: c.cookie, origin: null })).status, 403);
  assert.equal((await call("POST", "/api/avatar", { avatar: 1 }, { cookie: c.cookie, origin: "http://evil.example.com" })).status, 403);
  const plain = await fetch(base + "/api/avatar", { method: "POST", headers: { Cookie: c.cookie!, Origin: base, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(plain.status, 415);
  assert.equal((await call("POST", "/api/avatar", { avatar: 99 }, { cookie: c.cookie })).status, 400);

  // THE EASTER EGG's password
  assert.equal((await call("GET", "/api/egg", undefined, { cookie: c.cookie })).body.set, false);
  assert.equal((await call("POST", "/api/egg", { password: "open sesame" }, { cookie: c.cookie })).body.set, true);
});

test("the daemons are grouped by type, and only the INDEX's own sprites are served", async () => {
  const r = await call("GET", "/api/avatars");
  assert.deepEqual(r.body.groups.map((g: { type: string }) => g.type), ["GROWTH", "FLOW"]);
  assert.equal(r.body.groups[0].daemons[0].name, "ONE");
  assert.equal(r.body.groups[0].daemons[0].front, undefined);
  const png = await fetch(base + "/sprite/1.png");
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal((await fetch(base + "/sprite/2.png")).status, 404);   // its file is missing
  assert.equal((await fetch(base + "/sprite/3.png")).status, 404);   // its path leaves gfx/daemons
});

test("too many wrong passwords and the door waits", async () => {
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await call("POST", "/api/signin", { name: "admin", password: "wrong " + i })).status;
  assert.equal(last, 429);
});
