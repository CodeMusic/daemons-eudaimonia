// EUDAIMONIA: the site where the companion's PRAXIS and ARETE are to be used together. Today, its first pieces: the
// front page's frame (C-439), the accounts (C-436) and THE EASTER EGG (C-437). Run by ./bindEudaimonia.sh beside the
// playground, whose player the egg's carts play in.
//
//   node src/main.ts                  on port 4741
//   node src/main.ts --port 4751      another port (a test copy)
//   node src/main.ts --data DIR       keep the accounts in DIR (default data/eudaimonia)
//
// DAEMONS beside this repository (../DAEMONS, or $DAEMONS_ROOT) gives the daemons' sprites and the releases (its ROM
// RELEASE/, or $DAEMONS_RELEASES); the companion (DAEMONS/companion, or $COMPANION_ROOT) its INDEX cards, which name
// the daemons and their types. The playground's port is $PLAYGROUND_PORT, or 4740. THE EASTER EGG's first password is
// $EUDAIMONIA_EGG, or the one in DAEMONS' private note on it (docs/private/, in no repository), kept only as a hash
// and read again at every start until the admin sets their own in ACCOUNTS. THE DASHBOARD (E-1) reads the tickets from
// Redmine with the playground lane's key, from ~/.redmine.env (or $REDMINE_ENV): never logged, never sent to a page.
// An admin answers a ticket that waits on the user with the user's own Redmine key there, REDMINE_KEY_USER, or until
// the user adds it, the sessions' REDMINE_API_KEY (E-1). E-9: once this site's PRAXIS replica (praxis.sqlite, beside the
// accounts) has pulled the mirrored tickets from the always-on one ($PRAXIS_REPLICA, or http://roverbyteseer:4742; "off"
// for none), the dashboard reads them there, and Redmine only until then.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Accounts } from "./accounts.ts";
import { Avatars } from "./avatars.ts";
import { Egg, firstEggPassword } from "./egg.ts";
import { RedmineReader, redmineEnv } from "./redmine.ts";
import { Answers, answersEnv } from "./answers.ts";
import { Releases } from "./releases.ts";
import { makeServer } from "./server.ts";
import { px, type Db } from "./praxis.ts";
import { give, pull } from "./replica.ts";
import { Spaces } from "./spaces.ts";
import { Changes, reposBeside } from "./changes.ts";
import { laneKeys, Minds } from "./mind.ts";
import { eitherTickets, PraxisTickets } from "./tickets.ts";

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };

const port = Number(opt("--port", process.env.EUDAIMONIA_PORT || "4741"));
const data = opt("--data", join(ROOT, "data", "eudaimonia"));
const DAEMONS = process.env.DAEMONS_ROOT || join(dirname(ROOT), "DAEMONS");
const COMPANION = process.env.COMPANION_ROOT || join(DAEMONS, "companion");
const RELEASES = process.env.DAEMONS_RELEASES || join(DAEMONS, "ROM RELEASE");
const PLAYER = Number(process.env.PLAYGROUND_PORT || 4740);

const say = (l: string) => console.log("eudaimonia: " + l);
const name = (cmd: string, a: string[], pick: (out: string) => string | null) => {
  try { return pick(execFileSync(cmd, a, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })); } catch { return null; }
};

const accounts = new Accounts(join(data, "accounts.json"));
const avatars = new Avatars(join(COMPANION, "server", "data", "index_cards.json"), DAEMONS);
if (await accounts.open()) say("the first account is admin, its password admin: sign in from this Mac or the tailnet and change it");
if (!avatars.count) say(`no daemons to pick from: the companion's INDEX cards are not at ${COMPANION}/server/data/index_cards.json`);

const egg = new Egg(RELEASES);
{
  const note = join(DAEMONS, "docs", "private", "eudaimonia-easter-egg.md");
  const [first, from] = process.env.EUDAIMONIA_EGG ? [process.env.EUDAIMONIA_EGG, "$EUDAIMONIA_EGG"]
    : [existsSync(note) ? firstEggPassword(readFileSync(note, "utf8")) : null, "DAEMONS' private note"];
  const seeded = first ? await accounts.seedEgg(first, from) : false;
  if (seeded) say(`THE EASTER EGG's password is set${seeded === "again" ? " again (a new value)" : ""}, from ${from}: the admin changes it in ACCOUNTS`);
  else if (!accounts.egg().set) say("THE EASTER EGG has no password, so it stays shut: the admin sets one in ACCOUNTS");
}
const envFile = process.env.REDMINE_ENV || join(homedir(), ".redmine.env");
const rm = existsSync(envFile) ? redmineEnv(readFileSync(envFile, "utf8")) : null;
const redmine = rm ? new RedmineReader(rm.url, rm.key) : null;
say(redmine ? `THE DASHBOARD reads the tickets from PRAXIS once its replica holds them, and from ${rm!.url} until then (read-only, as the playground lane)`
            : `THE DASHBOARD has no tickets: no REDMINE_URL and REDMINE_KEY_PLAYGROUND in ${envFile}`);
const aw = existsSync(envFile) ? answersEnv(readFileSync(envFile, "utf8")) : null;
const answers = aw ? new Answers(aw.url, aw.key, { as: aw.as }) : null;
say(!answers ? `nobody can answer from THE DASHBOARD: neither REDMINE_KEY_USER nor REDMINE_API_KEY in ${envFile}`
    : aw!.whose === "user" ? `an admin answers what waits on the user in the user's own Redmine account (REDMINE_KEY_USER)`
    : `an admin answers what waits on the user as Claude sessions, the note naming the user, until REDMINE_KEY_USER is added`);
const latest = egg.latest();
say(latest ? `THE EASTER EGG's carts play ${latest.name}, in the playground's player on port ${PLAYER}` : `no release in ${RELEASES}: the egg's carts have nothing to play`);

// E-9: PRAXIS -- this site's replica, taking from the always-on one every minute (replica.ts)
const REPLICA = process.env.PRAXIS_REPLICA || "http://roverbyteseer:4742";
let pulledAt: number | null = null, pullSaid = "";
mkdirSync(data, { recursive: true });
const pxdb = new DatabaseSync(join(data, "praxis.sqlite"));
pxdb.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
const local = new px.Praxis(pxdb as unknown as Db, { actor: "eudaimonia" });
const takeFromReplica = async () => {
  if (REPLICA === "off") return;
  try {
    const r = await pull(local, REPLICA);
    pulledAt = Date.now();
    if (r.sent || pullSaid) say(`PRAXIS: took ${r.sent} events from ${REPLICA}`);
    pullSaid = "";
  } catch (e) {
    const why = (e as Error).message;
    if (why !== pullSaid) say(`PRAXIS: ${REPLICA} can't be reached (${why}); the dashboard shows the last pull${local.spaces().length ? "" : ", and Redmine until there is one"}`);
    pullSaid = why;
  }
};
// after an answer: the always-on replica mirrors at once and this one takes it, before the page loads the board again
const refresh = async () => {
  if (REPLICA === "off") return;
  await fetch(REPLICA + "/px/mirror", { method: "POST", signal: AbortSignal.timeout(15_000) }).catch(() => {});
  await takeFromReplica();
};
const praxisTickets = new PraxisTickets(local, { pulled: () => (REPLICA === "off" ? null : pulledAt ?? 0), refresh });
const tickets = eitherTickets(praxisTickets, redmine);
// E-10: the spaces of the site's own go to the always-on replica: a second after a change, and every minute after a pull
let giveSaid = "", giving: ReturnType<typeof setTimeout> | null = null;
const giveToReplica = async () => {
  if (REPLICA === "off") return;
  const own = [...spaces.list(true).filter((s) => !s.mirrored).map((s) => s.id), ...minds.ids()];   // E-12: the lanes' minds too
  try {
    const r = await give(local, REPLICA, own);
    if (r.sent) say(`PRAXIS: gave ${r.sent} events of the site's own spaces to ${REPLICA}`);
    giveSaid = "";
  } catch (e) {
    const why = (e as Error).message;
    if (why !== giveSaid) say(`PRAXIS: the site's own spaces can't reach ${REPLICA} (${why}); they wait here and go at the next minute`);
    giveSaid = why;
  }
};
const soon = () => { if (giving) clearTimeout(giving); giving = setTimeout(() => void giveToReplica(), 1000); };
const spaces = new Spaces(local, { changed: soon });
// E-12: each lane's WORKING MEMORY, written by tools/tickets.py as the lane -- its Redmine key asked of Redmine
const minds = new Minds(local, { changed: soon });
const laneOf = rm ? laneKeys(rm.url) : null;
const exchange = async () => { await takeFromReplica(); await giveToReplica(); };
void exchange();
setInterval(() => void exchange(), 60_000);

// E-1's last slice: THE CHANGES -- what was pushed lately in the clones beside this one, and GitHub's open pull requests
const changes = new Changes({ repos: reposBeside(DAEMONS, COMPANION, ROOT, dirname(ROOT)), tickets });

const server = makeServer({ accounts, avatars, egg, player: PLAYER, web: join(ROOT, "web"), log: say,
                           redmine: tickets, answers, spaces, minds, laneOf, changes, releases: new Releases(egg), art: join(COMPANION, "server", "data", "art"),
                           // E-19: the public name the house's web server proxies here (comma-separated; "" for none)
                           publicHosts: (process.env.EUDAIMONIA_PUBLIC_HOSTS ?? "dashboard.daemons.codemusic.ca").split(","),
                           // E-20: where the egg's player is from away ("" for none)
                           publicPlayer: (process.env.EUDAIMONIA_PUBLIC_PLAYER ?? "https://play.daemons.codemusic.ca") || null });
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(`eudaimonia: ${e.code === "EADDRINUSE" ? `port ${port} is in use (is it running already?)` : e.message}`);
  process.exit(1);
});
server.listen(port, "::", () => {
  say(`${avatars.count} daemons to pick from, accounts in ${data}${existsSync(join(data, "accounts.json")) ? "" : " (none yet)"}`);
  say(`http://localhost:${port}/`);
  const tail = name("tailscale", ["status", "--json"], (o) => JSON.parse(o).Self.DNSName.replace(/\.$/, ""));
  if (tail) say(`http://${tail}:${port}/   (the tailnet)`);
  const local = name("scutil", ["--get", "LocalHostName"], (o) => (o.trim() ? o.trim() + ".local" : null));
  if (local) say(`http://${local}:${port}/   (this network)`);
  say("answering this machine, private addresses and the tailnet only. Ctrl-C stops it.");
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
