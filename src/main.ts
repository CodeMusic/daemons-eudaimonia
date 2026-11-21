// EUDAIMONIA: the site where the companion's PRAXIS and ARETE are to be used together. Today, its first pieces: the
// front page's frame (C-439) and the accounts (C-436). Run by ./bindEudaimonia.sh beside the playground.
//
//   node src/main.ts                  on port 4741 (the playground keeps 4740 until THE EASTER EGG carries the game)
//   node src/main.ts --port 4751      another port (a test copy)
//   node src/main.ts --data DIR       keep the accounts in DIR (default data/eudaimonia)
//
// DAEMONS beside this repository (../DAEMONS, or $DAEMONS_ROOT) gives the daemons' sprites; the companion
// (DAEMONS/companion, or $COMPANION_ROOT) its INDEX cards, which name them and their types.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Accounts } from "./accounts.ts";
import { Avatars } from "./avatars.ts";
import { makeServer } from "./server.ts";

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };

const port = Number(opt("--port", process.env.EUDAIMONIA_PORT || "4741"));
const data = opt("--data", join(ROOT, "data", "eudaimonia"));
const DAEMONS = process.env.DAEMONS_ROOT || join(dirname(ROOT), "DAEMONS");
const COMPANION = process.env.COMPANION_ROOT || join(DAEMONS, "companion");

const say = (l: string) => console.log("eudaimonia: " + l);
const name = (cmd: string, a: string[], pick: (out: string) => string | null) => {
  try { return pick(execFileSync(cmd, a, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })); } catch { return null; }
};

const accounts = new Accounts(join(data, "accounts.json"));
const avatars = new Avatars(join(COMPANION, "server", "data", "index_cards.json"), DAEMONS);
if (await accounts.open()) say("the first account is admin, its password admin: sign in from this Mac or the tailnet and change it");
if (!avatars.count) say(`no daemons to pick from: the companion's INDEX cards are not at ${COMPANION}/server/data/index_cards.json`);

const server = makeServer({ accounts, avatars, web: join(ROOT, "web"), log: say });
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
