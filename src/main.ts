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
// $EUDAIMONIA_EGG, or the one in DAEMONS' private note on it (docs/private/, in no repository), taken once, at the
// first run, and kept only as a hash: the admin changes it in ACCOUNTS.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Accounts } from "./accounts.ts";
import { Avatars } from "./avatars.ts";
import { Egg, firstEggPassword } from "./egg.ts";
import { makeServer } from "./server.ts";

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
if (!accounts.egg().set) {
  const note = join(DAEMONS, "docs", "private", "eudaimonia-easter-egg.md");
  const [first, from] = process.env.EUDAIMONIA_EGG ? [process.env.EUDAIMONIA_EGG, "$EUDAIMONIA_EGG"]
    : [existsSync(note) ? firstEggPassword(readFileSync(note, "utf8")) : null, "DAEMONS' private note"];
  if (first && await accounts.seedEgg(first, from)) say(`THE EASTER EGG's first password is set, from ${from}: the admin changes it in ACCOUNTS`);
  else say("THE EASTER EGG has no password, so it stays shut: the admin sets one in ACCOUNTS");
}
const latest = egg.latest();
say(latest ? `THE EASTER EGG's carts play ${latest.name}, in the playground's player on port ${PLAYER}` : `no release in ${RELEASES}: the egg's carts have nothing to play`);

const server = makeServer({ accounts, avatars, egg, player: PLAYER, web: join(ROOT, "web"), log: say });
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
