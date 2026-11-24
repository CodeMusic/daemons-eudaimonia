// C-436: EUDAIMONIA's accounts -- the admin first, then people and AI agents, each one a daemon (the user, 2026-11-20).
//
//   * The first sign-in is admin / admin, and it is changed at once: until it is, that password is taken only from home
//     (reach.ts), and the session it opens can do nothing but change it.
//   * The admin makes the rest. A PERSON signs in with a name and a password (the admin's is a one-time one, changed at
//     the first sign-in); an AGENT -- a lane, a model at work -- never has a password: it carries a key, shown once.
//     The two are kept apart, as the companion keeps its mind and its machine apart (C-387): a person is never given a
//     key, an agent never a password, and the admin's lists show them as two.
//   * Every account picks a daemon as its avatar (avatars.ts): its sprite is the account's picture, and later its lane's
//     group on the dashboard (C-411).
//   * The admin sets THE EASTER EGG's password (C-437), kept here hashed like every other; its door gives a browser a
//     pass, kept as a hash too, to play the release's own ROM (egg.ts). Its answer is taken in any case (E-7, the user
//     2026-11-21: "any case"), so it is folded to small letters before it is hashed or checked. Until the admin sets
//     one, DAEMONS' private note on it is its source: a new value there replaces the old at the next start.
//   * A lane's daemon on THE DASHBOARD (E-1) is its agent account's avatar: an agent named for the lane.
//
// Passwords are kept as scrypt hashes, sessions and keys as SHA-256 hashes of 32 random bytes: nothing here can be read
// back. The file is data/eudaimonia/accounts.json, written whole through a temporary file and renamed (mode 0600).
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Kind = "person" | "agent";
type Hashed = { salt: string; hash: string; n: number };
export type Account = {
  id: string; name: string; kind: Kind; admin: boolean; avatar: number | null;
  password?: Hashed;          // a person's
  firstPassword?: boolean;    // admin / admin, not yet changed: taken from home only
  mustChange?: boolean;       // a password someone else chose: changed at the next sign-in
  key?: { hash: string; shown: string };   // an agent's: the hash, and its first characters to tell keys apart
  disabled?: boolean; made: string; madeBy: string | null; seen?: string;
};
type Session = { hash: string; account: string; until: string; limited: boolean };
type Data = { accounts: Account[]; sessions: Session[];
              egg?: Hashed & { changed: string; by: string | null; seeded?: string; folded?: boolean };
              passes?: { hash: string; until: string }[] };

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000, LIMITED_MS = 15 * 60 * 1000, EGG_PASS_MS = 30 * 24 * 60 * 60 * 1000;
export const EGG_LEAST = 6;
export const NAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const PASSWORD_LEAST = 10;

export class Refused extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** The egg's answer, in any case: Example, EXAMPLE and example are one. */
export const fold = (pw: string) => String(pw || "").normalize("NFKC").toLowerCase();
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
const token = (prefix = "") => prefix + randomBytes(32).toString("base64url");
const scrypt = (pw: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw.normalize("NFKC"), salt, 32, { N: n, r: 8, p: 1, maxmem: 256 * n * 8 + 1024 * 1024 },
    (e, k) => (e ? rej(e) : res(k))));

/** What an account shows to the page: never a hash. */
export function shown(a: Account) {
  return { id: a.id, name: a.name, kind: a.kind, admin: a.admin, avatar: a.avatar, mustChange: !!(a.mustChange || a.firstPassword),
           first: !!a.firstPassword,
           key: a.key?.shown ?? null, disabled: !!a.disabled, made: a.made, seen: a.seen ?? null };
}

export class Accounts {
  private data: Data;
  private readonly file: string | null;
  private readonly cost: number;
  private readonly now: () => number;
  /** `file` null keeps them in memory (the tests); `cost` is scrypt's N. */
  constructor(file: string | null, cost = 1 << 15, now = () => Date.now()) {
    this.file = file; this.cost = cost; this.now = now;
    let data: Data | null = null;
    if (file) {
      try { data = JSON.parse(readFileSync(file, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    this.data = data ?? { accounts: [], sessions: [] };
  }

  /** The first run: no account yet, so admin / admin, to be changed at once. */
  async open(): Promise<boolean> {
    if (this.data.accounts.length) return false;
    this.data.accounts.push({ id: randomUUID(), name: "admin", kind: "person", admin: true, avatar: null,
                              password: await this.hash("admin"), firstPassword: true, made: this.iso(), madeBy: null });
    this.save();
    return true;
  }

  list() { return this.data.accounts.map(shown); }
  /** THE DASHBOARD's lanes (E-1): each agent account that is open, by its name, with its daemon. Nothing else of it. */
  agents(): Map<string, number | null> {
    return new Map(this.data.accounts.filter((a) => a.kind === "agent" && !a.disabled).map((a) => [a.name, a.avatar]));
  }
  get(id: string) { return this.data.accounts.find((a) => a.id === id) ?? null; }
  byName(name: string) { return this.data.accounts.find((a) => a.name === name.trim().toLowerCase()) ?? null; }

  /** A person's sign-in. `home` is whether the request came from home with no proxy between (reach.ts). */
  async signIn(name: string, password: string, home: boolean) {
    const a = this.byName(String(name || ""));
    // the same work whether or not the name exists, so the time taken does not tell
    const ok = a?.password ? await this.check(password, a.password) : (await this.hash(String(password || "")), false);
    if (!a || !ok || a.kind !== "person" || a.disabled) throw new Refused("That name and password don't match.", 401);
    if (a.firstPassword && !home)
      throw new Refused("The first password works only from home or the tailnet, until it is changed.", 403);
    const limited = !!(a.firstPassword || a.mustChange);
    return { session: this.session(a, limited), account: shown(a) };
  }

  /** The account a session cookie or an agent's key opens, or null. */
  who(cookie: string | null, bearer: string | null): { account: Account; limited: boolean; session: string | null } | null {
    this.sweep();
    if (bearer) {
      const h = sha(bearer), a = this.data.accounts.find((x) => x.kind === "agent" && x.key?.hash === h && !x.disabled);
      if (a) { this.seen(a); return { account: a, limited: false, session: null }; }
      return null;
    }
    if (!cookie) return null;
    const h = sha(cookie), s = this.data.sessions.find((x) => x.hash === h);
    const a = s && this.get(s.account);
    if (!s || !a || a.disabled) return null;
    this.seen(a);
    return { account: a, limited: s.limited, session: h };
  }

  signOut(cookie: string | null) {
    if (!cookie) return;
    const h = sha(cookie);
    this.data.sessions = this.data.sessions.filter((s) => s.hash !== h);
    this.save();
  }

  /** A person changes their own password; every other session of theirs ends, and this one is no longer limited. */
  async changePassword(a: Account, old: string, next: string) {
    if (a.kind !== "person" || !a.password) throw new Refused("An agent has a key, not a password.");
    if (!(await this.check(old, a.password))) throw new Refused("The present password is not that.", 401);
    this.strong(next, a.name);
    if (await this.check(next, a.password)) throw new Refused("Choose a new password, not the same one.");
    a.password = await this.hash(next);
    delete a.firstPassword;
    delete a.mustChange;
    this.data.sessions = this.data.sessions.filter((s) => s.account !== a.id);
    const session = this.session(a, false);
    return { session, account: shown(a) };
  }

  setAvatar(a: Account, species: number | null) {
    a.avatar = species;
    this.save();
    return shown(a);
  }

  // ---- the admin's ---------------------------------------------------------------------------------------------------

  /** A new account: a person gets a one-time password, an agent its key; either is shown this once. */
  async make(by: Account, name: string, kind: Kind, admin = false, avatar: number | null = null) {
    this.mustBeAdmin(by);
    name = String(name || "").trim().toLowerCase();
    if (!NAME.test(name)) throw new Refused("A name is 2 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit.");
    if (this.byName(name)) throw new Refused(`There is already an account called ${name}.`, 409);
    if (kind !== "person" && kind !== "agent") throw new Refused("An account is a person or an agent.");
    if (kind === "agent" && admin) throw new Refused("An agent is never an admin.");
    const a: Account = { id: randomUUID(), name, kind, admin: kind === "person" && !!admin, avatar, made: this.iso(), madeBy: by.id };
    const secret = await this.renew(a);
    this.data.accounts.push(a);
    this.save();
    return { account: shown(a), secret };
  }

  /** A new one-time password for a person, or a new key for an agent; the old one stops working. */
  async reset(by: Account, id: string) {
    this.mustBeAdmin(by);
    const a = this.mustGet(id);
    const secret = await this.renew(a);
    this.data.sessions = this.data.sessions.filter((s) => s.account !== a.id);
    this.save();
    return { account: shown(a), secret };
  }

  setDisabled(by: Account, id: string, disabled: boolean) {
    this.mustBeAdmin(by);
    const a = this.mustGet(id);
    if (a.id === by.id) throw new Refused("You can't close your own account.");
    if (disabled && a.admin && this.data.accounts.filter((x) => x.admin && !x.disabled).length === 1)
      throw new Refused("There must always be an admin.");
    a.disabled = disabled;
    if (disabled) this.data.sessions = this.data.sessions.filter((s) => s.account !== a.id);
    this.save();
    return shown(a);
  }

  setAdmin(by: Account, id: string, admin: boolean) {
    this.mustBeAdmin(by);
    const a = this.mustGet(id);
    if (a.kind !== "person") throw new Refused("An agent is never an admin.");
    if (!admin && a.admin && this.data.accounts.filter((x) => x.admin && !x.disabled).length === 1)
      throw new Refused("There must always be an admin.");
    a.admin = admin;
    this.save();
    return shown(a);
  }

  /** A lane's daemon, from Redmine (lanedaemons.ts): its agent account's avatar, the account made if there is none. Its key
   *  is made and not kept anywhere -- the admin makes a NEW KEY in ACCOUNTS when the lane needs one. */
  async laneDaemon(lane: string, species: number): Promise<"made" | "changed" | "same"> {
    const a = this.byName(lane);
    if (a && a.kind !== "agent") throw new Refused(`${lane} is a person's account, not a lane's.`, 409);
    if (a) {
      if (a.avatar === species) return "same";
      a.avatar = species; this.save(); return "changed";
    }
    const made: Account = { id: randomUUID(), name: lane, kind: "agent", admin: false, avatar: species, made: this.iso(), madeBy: null };
    await this.renew(made);
    this.data.accounts.push(made);
    this.save();
    return "made";
  }

  adminAvatar(by: Account, id: string, species: number | null) {
    this.mustBeAdmin(by);
    return this.setAvatar(this.mustGet(id), species);
  }

  /** THE EASTER EGG's password (C-437): set by the admin, kept hashed. A new one closes every pass the old one gave. */
  async setEgg(by: Account, password: string) {
    this.mustBeAdmin(by);
    if (String(password || "").length < EGG_LEAST) throw new Refused(`The easter egg's password is at least ${EGG_LEAST} characters.`);
    this.data.egg = { ...(await this.hash(fold(password))), changed: this.iso(), by: by.id, folded: true };
    this.data.passes = [];
    this.save();
    return this.egg();
  }
  /** Its value from DAEMONS' private note (main.ts, at every start): the first one, or a new one there, until the admin
   *  sets their own in ACCOUNTS -- after that the note is never read again. A new value closes every pass. */
  async seedEgg(password: string, from: string): Promise<false | "first" | "again"> {
    if (String(password || "").length < EGG_LEAST) return false;
    const e = this.data.egg;
    // an old seeded hash, made before the fold, is made again even when the note has not changed: so it takes any case
    if (e && (e.by !== null || !e.seeded || (e.folded && (await this.eggOpens(password))))) return false;
    this.data.egg = { ...(await this.hash(fold(password))), changed: this.iso(), by: null, seeded: from, folded: true };
    if (e) this.data.passes = [];
    this.save();
    return e ? "again" : "first";
  }
  egg() { return { set: !!this.data.egg, changed: this.data.egg?.changed ?? null, seeded: this.data.egg?.seeded ?? null }; }
  async eggOpens(password: string) {
    const e = this.data.egg;
    return !!e && this.check(e.folded ? fold(password) : password, e);
  }

  /** The egg's door: the password opens it, and gives this browser a pass (a cookie) to play the release's own ROM. */
  async eggPass(password: string) {
    if (!this.data.egg) throw new Refused("It is shut: no password is set yet.", 403);
    if (!(await this.eggOpens(password))) throw new Refused("That isn't it.", 401);
    const t = token(), now = this.iso();
    this.data.passes = (this.data.passes ?? []).filter((p) => p.until > now);
    this.data.passes.push({ hash: sha(t), until: new Date(this.now() + EGG_PASS_MS).toISOString() });
    this.save();
    return t;
  }
  hasEggPass(t: string | null) {
    if (!t) return false;
    const h = sha(t), now = this.iso();
    return (this.data.passes ?? []).some((p) => p.hash === h && p.until > now);
  }

  // ---- inside ---------------------------------------------------------------------------------------------------------

  private async renew(a: Account) {
    if (a.kind === "agent") {
      const key = token("eud_");
      a.key = { hash: sha(key), shown: key.slice(0, 8) };
      delete a.password;
      return key;
    }
    const pw = randomBytes(9).toString("base64url");   // twelve characters, used once
    a.password = await this.hash(pw);
    a.mustChange = true;
    delete a.firstPassword;
    delete a.key;
    return pw;
  }

  private strong(pw: string, name: string) {
    const p = String(pw || "");
    if (p.length < PASSWORD_LEAST) throw new Refused(`A password is at least ${PASSWORD_LEAST} characters.`);
    if (p.toLowerCase() === "admin" || p.toLowerCase().includes(name)) throw new Refused("A password can't be or hold the account's name.");
  }

  private session(a: Account, limited: boolean) {
    const t = token();
    this.data.sessions.push({ hash: sha(t), account: a.id, limited,
                              until: new Date(this.now() + (limited ? LIMITED_MS : SESSION_MS)).toISOString() });
    this.seen(a, true);
    this.save();
    return t;
  }

  private seen(a: Account, force = false) {
    const day = this.iso().slice(0, 10);
    if (force || a.seen?.slice(0, 10) !== day) { a.seen = this.iso(); if (!force) this.save(); }
  }

  private sweep() {
    const now = this.iso(), before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.until > now);
    if (this.data.sessions.length !== before) this.save();
  }

  private mustBeAdmin(a: Account) { if (!a.admin || a.kind !== "person") throw new Refused("Only an admin can do that.", 403); }
  private mustGet(id: string) { const a = this.get(id); if (!a) throw new Refused("No such account.", 404); return a; }
  private iso() { return new Date(this.now()).toISOString(); }

  private async hash(pw: string): Promise<Hashed> {
    const salt = randomBytes(16);
    return { salt: salt.toString("base64url"), hash: (await scrypt(pw, salt, this.cost)).toString("base64url"), n: this.cost };
  }
  private async check(pw: string, h: Hashed) {
    const k = await scrypt(String(pw || ""), Buffer.from(h.salt, "base64url"), h.n);
    const want = Buffer.from(h.hash, "base64url");
    return k.length === want.length && timingSafeEqual(k, want);
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + ".writing";
    writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
