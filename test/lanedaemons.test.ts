// Each lane's daemon kept in Redmine: Redmine's Daemon field is followed here, its sprite written from it, and the
// admin's choice here written back -- against a pretend Redmine, never the real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "../src/accounts.ts";
import { Avatars } from "../src/avatars.ts";
import { LaneDaemons, laneKeysFrom } from "../src/lanedaemons.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-lanes-"));
  mkdirSync(join(dir, "gfx"), { recursive: true });
  writeFileSync(join(dir, "cards.json"), JSON.stringify({ type_colours: {}, cards: {
    "1": { number: "001", name: "ONE", types: ["GROWTH"], category: "A", art: { front: "gfx/one.png" } },
    "3": { number: "003", name: "THREE", types: ["SIGNAL"], category: "B", art: { front: "gfx/three.png" } } } }));
  const users: Record<string, { Daemon: string | null; "Daemon sprite": string | null }> = {
    "key-hub": { Daemon: "THREE", "Daemon sprite": null }, "key-art": { Daemon: "nobody-at-all", "Daemon sprite": null } };
  const puts: unknown[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)["X-Redmine-API-Key"];
    const u = users[key];
    if (!u) return new Response("", { status: 401 });
    if (url.endsWith("/users/current.json"))
      return Response.json({ user: { custom_fields: [{ id: 16, name: "Daemon", value: u.Daemon }, { id: 17, name: "Daemon sprite", value: u["Daemon sprite"] }] } });
    if (url.endsWith("/my/account.json") && init?.method === "PUT") {
      const b = JSON.parse(String(init.body));
      puts.push(b);
      for (const f of b.user.custom_fields) (u as any)[f.id === 16 ? "Daemon" : "Daemon sprite"] = f.value;
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const accounts = new Accounts(null, 1 << 10);
  const avatars = new Avatars(join(dir, "cards.json"), dir);
  const lanes = new LaneDaemons({ url: "http://redmine", keys: { hub: "key-hub", art: "key-art", game: "key-gone" }, accounts, avatars,
                                  spriteBase: "https://dash.example.test/", fetch: fake, log: () => {} });
  return { users, puts, accounts, lanes };
}

test("the lane keys are read from the env file, a person's key left out", () => {
  assert.deepEqual(laneKeysFrom("REDMINE_URL=x\nREDMINE_KEY_PI_ZERO=abc\nREDMINE_KEY_USER=me\nREDMINE_KEY_HUB=\"def\"\n"),
                   { "pi-zero": "abc", hub: "def" });
});

test("Redmine's Daemon is followed here, and its sprite written from it", async () => {
  const { users, accounts, lanes } = setup();
  assert.deepEqual(await lanes.pull(), ["hub: THREE"]);
  assert.equal(accounts.agents().get("hub"), 3);
  assert.equal(users["key-hub"]["Daemon sprite"], "![THREE](https://dash.example.test/sprite/3.png)");
  assert.equal(accounts.agents().has("art"), false, "a name that is no daemon changes nothing");
  assert.deepEqual(await lanes.pull(), [], "nothing new the second time");
  users["key-hub"].Daemon = "ONE";                       // changed in Redmine
  assert.deepEqual(await lanes.pull(), ["hub: ONE"]);
  assert.equal(accounts.agents().get("hub"), 1);
});

test("the admin's choice here is written back to Redmine", async () => {
  const { users, lanes } = setup();
  assert.equal(await lanes.push("hub", 1), true);
  assert.equal(users["key-hub"].Daemon, "ONE");
  assert.equal(users["key-hub"]["Daemon sprite"], "![ONE](https://dash.example.test/sprite/1.png)");
  assert.equal(await lanes.push("not-a-lane", 1), false);
});
