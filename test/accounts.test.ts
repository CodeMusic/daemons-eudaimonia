// C-436's rules, held by the store itself: the first password, who may do what, people apart from agents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts, Refused } from "../src/accounts.ts";

const CHEAP = 1 << 10;   // scrypt's N, small for the tests
const fresh = async () => { const a = new Accounts(null, CHEAP); await a.open(); return a; };
const refused = (status: number) => (e: unknown) => e instanceof Refused && e.status === status;

test("the first run makes admin / admin, once", async () => {
  const a = new Accounts(null, CHEAP);
  assert.equal(await a.open(), true);
  assert.equal(await a.open(), false);
  const [admin] = a.list();
  assert.equal(admin.name, "admin");
  assert.equal(admin.admin, true);
  assert.equal(admin.first, true);
  assert.equal(admin.mustChange, true);
});

test("the first password is taken only from home, and opens a limited session", async () => {
  const a = await fresh();
  await assert.rejects(a.signIn("admin", "admin", false), refused(403));
  const r = await a.signIn("admin", "admin", true);
  const who = a.who(r.session, null);
  assert.equal(who?.account.name, "admin");
  assert.equal(who?.limited, true);
});

test("a wrong password and an unknown name are refused alike", async () => {
  const a = await fresh();
  await assert.rejects(a.signIn("admin", "nope", true), refused(401));
  await assert.rejects(a.signIn("nobody", "admin", true), refused(401));
});

test("changing the password ends the old sessions and lifts the limit; the first password is gone", async () => {
  const a = await fresh();
  const first = await a.signIn("admin", "admin", true);
  const admin = a.byName("admin")!;
  await assert.rejects(a.changePassword(admin, "admin", "short"), refused(400));
  await assert.rejects(a.changePassword(admin, "admin", "admin-is-long-enough"), refused(400));   // holds its name
  await assert.rejects(a.changePassword(admin, "wrong", "a good long password"), refused(401));
  const r = await a.changePassword(admin, "admin", "a good long password");
  assert.equal(a.who(first.session, null), null);
  assert.equal(a.who(r.session, null)?.limited, false);
  await assert.rejects(a.signIn("admin", "admin", true), refused(401));
  const again = await a.signIn("admin", "a good long password", false);   // a chosen password works from anywhere
  assert.equal(a.who(again.session, null)?.limited, false);
});

test("the admin makes a person with a one-time password, changed at the first sign-in", async () => {
  const a = await fresh();
  const admin = a.byName("admin")!;
  const { account, secret } = await a.make(admin, "Ana", "person");
  assert.equal(account.name, "ana");
  assert.equal(account.mustChange, true);
  assert.equal(account.first, false);
  const s = await a.signIn("ana", secret, false);
  assert.equal(a.who(s.session, null)?.limited, true);
  await assert.rejects(a.make(admin, "ana", "person"), refused(409));
  await assert.rejects(a.make(admin, "-x", "person"), refused(400));
});

test("an agent has a key, never a password, and is never an admin", async () => {
  const a = await fresh();
  const admin = a.byName("admin")!;
  await assert.rejects(a.make(admin, "game", "agent", true), refused(400));
  const { account, secret } = await a.make(admin, "game", "agent");
  assert.match(secret, /^eud_/);
  assert.equal(account.key, secret.slice(0, 8));
  assert.equal(a.who(null, secret)?.account.name, "game");
  await assert.rejects(a.signIn("game", secret, true), refused(401));
  const renewed = await a.reset(admin, account.id);
  assert.equal(a.who(null, secret), null);
  assert.equal(a.who(null, renewed.secret)?.account.name, "game");
  assert.throws(() => a.setAdmin(admin, account.id, true), refused(400));
});

test("only an admin does the admin's work, and there is always an admin", async () => {
  const a = await fresh();
  const admin = a.byName("admin")!;
  const { account } = await a.make(admin, "ben", "person");
  const ben = a.get(account.id)!;
  await assert.rejects(a.make(ben, "cal", "person"), refused(403));
  assert.throws(() => a.setDisabled(ben, admin.id, true), refused(403));
  assert.throws(() => a.setDisabled(admin, admin.id, true), refused(400));
  assert.throws(() => a.setAdmin(admin, admin.id, false), refused(400));
  a.setAdmin(admin, ben.id, true);
  a.setAdmin(ben, admin.id, false);   // ben is the admin now
  assert.equal(a.get(admin.id)!.admin, false);
});

test("a closed account opens nothing", async () => {
  const a = await fresh();
  const admin = a.byName("admin")!;
  const { account, secret } = await a.make(admin, "ops", "agent");
  a.setDisabled(admin, account.id, true);
  assert.equal(a.who(null, secret), null);
  a.setDisabled(admin, account.id, false);
  assert.equal(a.who(null, secret)?.account.name, "ops");
});

test("THE EASTER EGG's password is set by the admin and kept hashed", async () => {
  const a = await fresh();
  const admin = a.byName("admin")!;
  assert.equal(a.egg().set, false);
  assert.equal(await a.eggOpens("anything"), false);
  await a.setEgg(admin, "a door in the wall");
  assert.equal(a.egg().set, true);
  assert.equal(await a.eggOpens("a door in the wall"), true);
  assert.equal(await a.eggOpens("a door"), false);
});

test("sessions run out", async () => {
  let t = Date.parse("2026-11-20T12:00:00Z");
  const a = new Accounts(null, CHEAP, () => t);
  await a.open();
  const s = await a.signIn("admin", "admin", true);
  t += 16 * 60 * 1000;   // a limited session lasts a quarter of an hour
  assert.equal(a.who(s.session, null), null);
});

test("the file holds hashes only, and only its owner may read it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-"));
  const file = join(dir, "eudaimonia", "accounts.json");
  const a = new Accounts(file, CHEAP);
  await a.open();
  const s = await a.signIn("admin", "admin", true);
  const { secret } = await a.make(a.byName("admin")!, "app", "agent");
  const text = readFileSync(file, "utf8");
  assert.ok(!text.includes(s.session) && !text.includes(secret));
  const kept = JSON.parse(text);
  assert.deepEqual(Object.keys(kept.accounts[0].password).sort(), ["hash", "n", "salt"]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const b = new Accounts(file, CHEAP);   // read back
  assert.equal(b.who(null, secret)?.account.name, "app");
});

test("THE EASTER EGG's password comes from the private note until the admin sets their own", async () => {
  const a = await fresh();
  assert.equal(await a.seedEgg("first-door", "the private note"), "first");
  assert.deepEqual([a.egg().set, a.egg().seeded], [true, "the private note"]);
  assert.equal(await a.seedEgg("first-door", "the private note"), false);    // the same value: nothing to do
  const pass = await a.eggPass("first-door");
  assert.equal(await a.seedEgg("A-New-Door", "the private note"), "again");  // a new value there replaces it
  assert.equal(a.hasEggPass(pass), false);                                     // and closes the old passes
  assert.equal(await a.eggOpens("first-door"), false);
  assert.equal(await a.eggOpens("a-new-door"), true);
  await a.setEgg(a.byName("admin")!, "the admin's own");
  assert.equal(a.egg().seeded, null);
  assert.equal(await a.seedEgg("yet another", "the private note"), false);   // the admin's stands
  assert.equal(await a.eggOpens("the admin's own"), true);
});

test("the egg's answer is taken in any case (E-7)", async () => {
  const a = await fresh();
  await a.setEgg(a.byName("admin")!, "CodeWord");
  for (const w of ["CodeWord", "codeword", "CODEWORD", "cOdEwOrD"]) assert.equal(await a.eggOpens(w), true, w);
  assert.equal(await a.eggOpens("codewor"), false);
  assert.equal(await a.eggOpens("code word"), false);
});

test("an egg seeded before the fold is seeded again, so it takes any case", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eudaimonia-"));
  const file = join(dir, "accounts.json");
  await new Accounts(file, CHEAP).open();
  const salt = randomBytes(16), data = JSON.parse(readFileSync(file, "utf8"));
  data.egg = { salt: salt.toString("base64url"), hash: scryptSync("Old-Door", salt, 32, { N: CHEAP, r: 8, p: 1 }).toString("base64url"),
               n: CHEAP, changed: "2026-11-20T00:00:00.000Z", by: null, seeded: "the private note" };
  writeFileSync(file, JSON.stringify(data));
  const b = new Accounts(file, CHEAP);
  assert.deepEqual([await b.eggOpens("Old-Door"), await b.eggOpens("old-door")], [true, false]);   // as it was
  assert.equal(await b.seedEgg("Old-Door", "the private note"), "again");
  assert.deepEqual([await b.eggOpens("Old-Door"), await b.eggOpens("old-door")], [true, true]);
  assert.equal(await b.seedEgg("Old-Door", "the private note"), false);   // once
});

test("the egg's door gives a pass; a new password closes every pass the old one gave", async () => {
  let t = Date.parse("2026-11-20T12:00:00Z");
  const a = new Accounts(null, CHEAP, () => t);
  await a.open();
  await assert.rejects(a.eggPass("anything"), refused(403));   // shut: no password yet
  await a.setEgg(a.byName("admin")!, "a door in the wall");
  await assert.rejects(a.eggPass("a door"), refused(401));
  const pass = await a.eggPass("a door in the wall");
  assert.equal(a.hasEggPass(pass), true);
  assert.equal(a.hasEggPass("not a pass"), false);
  assert.equal(a.hasEggPass(null), false);
  t += 31 * 24 * 60 * 60 * 1000;
  assert.equal(a.hasEggPass(pass), false);   // a pass lasts thirty days
  const again = await a.eggPass("a door in the wall");
  await a.setEgg(a.byName("admin")!, "a new door");
  assert.equal(a.hasEggPass(again), false);
});
