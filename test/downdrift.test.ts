// C-507: THE DOWNDRIFT STUDIO through this site -- only to someone signed in, only the studio's own calls relayed, the
// hub's key added here and never sent to the browser. A made-up hub on a port of its own.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { hubEnv, relayed, throughRelay } from "../src/downdrift.ts";
import { makeServer } from "../src/server.ts";

let hub: Server, site: Server, base = "", cookie = "";
const heard: { method: string; path: string; auth: string; body: string }[] = [];

before(async () => {
  hub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      heard.push({ method: req.method ?? "", path: req.url ?? "", auth: String(req.headers.authorization ?? ""), body });
      if (req.url === "/downdrift/") return res.writeHead(200, { "content-type": "text/html" }).end('<meta name="downdrift-api" content="/api"><p>studio</p>');
      if (req.url === "/downdrift/studio.js") return res.writeHead(200, { "content-type": "text/javascript" }).end("// studio");
      if (req.url === "/api/drifts") return res.writeHead(200, { "content-type": "application/json" }).end('{"drifts":[],"chosen":"the-long-fall"}');
      if (req.url === "/api/drifts/save") return res.writeHead(200, { "content-type": "application/json" }).end('{"id":"made-1","name":"X"}');
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-downdrift-"));
  const accounts = new Accounts(null, 1 << 10);
  await accounts.open();
  await accounts.signIn("admin", "admin", true);
  const r = await accounts.changePassword(accounts.byName("admin")!, "admin", "a good long password");
  cookie = `eudaimonia=${encodeURIComponent(r.session)}`;
  site = makeServer({ accounts, avatars: new Avatars(join(dir, "none.json"), dir), web: join(import.meta.dirname, "..", "web"), log: () => {},
                      hub: { url: `http://127.0.0.1:${(hub.address() as AddressInfo).port}`, key: "the-hub-key" } });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});
after(async () => {
  for (const s of [site, hub]) await new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });
});

test("signed out: sent to sign in, and nothing relayed", async () => {
  const page = await fetch(base + "/downdrift/", { redirect: "manual" });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/");
  assert.equal((await fetch(base + "/downdrift/hub/api/drifts")).status, 401);
  assert.equal(heard.length, 0);
});

test("signed in: the studio, told to use the relay; its calls carry the hub's key, which never reaches the browser", async () => {
  const page = await fetch(base + "/downdrift/", { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /content="\/downdrift\/hub\/api"/);
  assert.match(page.headers.get("content-security-policy") ?? "", /media-src 'self' blob:/);
  const drifts = await fetch(base + "/downdrift/hub/api/drifts", { headers: { Cookie: cookie } });
  assert.equal(drifts.status, 200);
  assert.deepEqual(await drifts.json(), { drifts: [], chosen: "the-long-fall" });
  assert.ok(!JSON.stringify([...drifts.headers]).includes("the-hub-key"));
  assert.equal(heard.at(-1)?.auth, "Bearer the-hub-key");
});

test("a save is relayed as JSON from the site's own page; anything else of the hub is not reachable", async () => {
  const save = await fetch(base + "/downdrift/hub/api/drifts/save", { method: "POST", body: JSON.stringify({ drift: { kind: "sleep" } }),
                                                                       headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" } });
  assert.equal(save.status, 200);
  assert.deepEqual(JSON.parse(heard.at(-1)!.body), { drift: { kind: "sleep" } });
  const before = heard.length;
  for (const p of ["/downdrift/hub/api/settings", "/downdrift/hub/api/pair/code", "/downdrift/hub/api/drifts/../../settings"])
    assert.equal((await fetch(base + p, { headers: { Cookie: cookie } })).status, 404, p);
  assert.equal((await fetch(base + "/downdrift/hub/api/drifts/save", { method: "POST", body: "{}", headers: { Cookie: cookie } })).status, 403);   // no Origin
  assert.equal(heard.length, before);
});

test("the relay's rules and the env file", () => {
  assert.equal(relayed("GET", "/downdrift/hub/api/drifts/earths-hum"), "/api/drifts/earths-hum");
  assert.equal(relayed("POST", "/downdrift/hub/api/drifts"), null);
  assert.equal(relayed("GET", "/downdrift/hub/api/sleep/track/abcdef12/phone.m4a"), "/api/sleep/track/abcdef12/phone.m4a");
  assert.equal(relayed("GET", "/downdrift/hub/api/sleep/track/abcdef12/watch.wav"), null);
  assert.equal(relayed("POST", "/downdrift/hub/api/reverie/render"), "/api/reverie/render");
  assert.equal(relayed("GET", "/downdrift/hub/api/reverie/renders"), "/api/reverie/renders");
  assert.equal(relayed("GET", `/downdrift/hub/api/reverie/render/first-rain--${"a".repeat(32)}.mp3`), `/api/reverie/render/first-rain--${"a".repeat(32)}.mp3`);
  assert.equal(relayed("GET", "/downdrift/hub/api/reverie/render/../settings.mp3"), null);
  assert.deepEqual(hubEnv('REDMINE_URL=x\nDAEMONS_HUB_URL="http://daemons-hearth:4730/"\nexport DAEMONS_HUB_KEY=k1'), { url: "http://daemons-hearth:4730", key: "k1" });
  assert.equal(hubEnv("DAEMONS_HUB_URL=x"), null);
  assert.equal(throughRelay('<meta name="downdrift-api" content="/api">'), '<meta name="downdrift-api" content="/downdrift/hub/api">');
});
