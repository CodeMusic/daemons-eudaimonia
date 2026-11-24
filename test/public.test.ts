// E-19: the site by a public name, through the house's proxy (dashboard.daemons.codemusic.ca). A person signs in there;
// the first password never works through it; a look-alike name, or the public name without the proxy's hops, is refused;
// the session cookie is Secure; failed sign-ins are counted per visitor, not against the proxy's one address.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { makeServer } from "../src/server.ts";
import { forwardedFor, publicName } from "../src/reach.ts";

const NAME = "dashboard.example.test";
let server: Server, port = 0, accounts: Accounts;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-public-"));
  writeFileSync(join(dir, "cards.json"), JSON.stringify({ type_colours: {}, cards: {} }));
  accounts = new Accounts(join(dir, "data", "accounts.json"), 1 << 10);
  await accounts.open();
  server = makeServer({ accounts, avatars: new Avatars(join(dir, "cards.json"), dir), web: join(import.meta.dirname, "..", "web"),
                        log: () => {}, publicHosts: [NAME] });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

type R = { status: number; body: any; cookie: string };
function call(method: string, path: string, body: unknown, headers: Record<string, string>): Promise<R> {
  return new Promise((resolve) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ host: "127.0.0.1", port, method, path,
      headers: { ...headers, ...(data ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(data)) } : {}) } },
      (res) => {
        let s = "";
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          let b: any = s;
          try { b = JSON.parse(s); } catch { /* text */ }
          resolve({ status: res.statusCode ?? 0, body: b, cookie: String(res.headers["set-cookie"] ?? "") });
        });
      });
    req.on("error", () => resolve({ status: 0, body: null, cookie: "" }));   // refused: written 403, then the socket closed
    req.end(data);
  });
}
const viaProxy = (visitor = "203.0.113.7") => ({ Host: NAME, Origin: `https://${NAME}`, "X-Forwarded-For": visitor, "X-Forwarded-Proto": "https" });

test("the public name is matched by host only, and a look-alike is not", () => {
  assert.equal(publicName(NAME, [NAME]), true);
  assert.equal(publicName(`https://${NAME}`, [NAME]), true);
  assert.equal(publicName(`${NAME}.evil.test`, [NAME]), false);
  assert.equal(publicName(NAME, []), false);
  assert.equal(forwardedFor({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }), "203.0.113.7");
});

test("the public name without the proxy's hops is refused, and so is any other name", async () => {
  const refused = (s: number) => s === 403 || s === 0;
  assert.ok(refused((await call("GET", "/api/me", undefined, { Host: NAME })).status));
  assert.ok(refused((await call("GET", "/api/me", undefined, { ...viaProxy(), Host: "elsewhere.example.test" })).status));
  assert.equal((await call("GET", "/api/me", undefined, viaProxy())).status, 200);
});

test("the first password never works through the public name", async () => {
  const r = await call("POST", "/api/signin", { name: "admin", password: "admin" }, viaProxy());
  assert.equal(r.status, 403);
  assert.match(String(r.body.error), /home or the tailnet/);
});

test("a person signs in by the public name, with a Secure cookie; another site's page cannot", async () => {
  // the admin's own password, changed from home first (no hops: this is the house)
  const home = { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` };
  const first = await call("POST", "/api/signin", { name: "admin", password: "admin" }, home);
  assert.equal(first.status, 200);
  const c = first.cookie.split(";")[0];
  assert.equal((await call("POST", "/api/password", { old: "admin", new: "a long new password" }, { ...home, Cookie: c })).status, 200);

  const r = await call("POST", "/api/signin", { name: "admin", password: "a long new password" }, viaProxy());
  assert.equal(r.status, 200);
  assert.match(r.cookie, /; Secure/);
  assert.equal((await call("GET", "/api/accounts", undefined, { ...viaProxy(), Cookie: r.cookie.split(";")[0] })).status, 200);

  const evil = await call("POST", "/api/signin", { name: "admin", password: "a long new password" },
                          { ...viaProxy(), Origin: "https://evil.example.test" });
  assert.equal(evil.status, 403);
});

test("failed sign-ins through the proxy are counted per visitor", async () => {
  for (let i = 0; i < 12; i++) await call("POST", "/api/signin", { name: "admin", password: "wrong" }, viaProxy("198.51.100.1"));
  assert.equal((await call("POST", "/api/signin", { name: "admin", password: "wrong" }, viaProxy("198.51.100.1"))).status, 429);
  // a different visitor through the same proxy is not locked out by the first one's tries
  assert.notEqual((await call("POST", "/api/signin", { name: "admin", password: "wrong" }, viaProxy("198.51.100.2"))).status, 429);
});
