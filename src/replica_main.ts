// E-9: the always-on PRAXIS replica, on roverbyteseer beside Redmine (the user, 2026-11-22). It mirrors Redmine into
// PRAXIS every two minutes (mirror.ts) and answers other replicas -- EUDAIMONIA on the laptop, later the hub -- with
// what they lack (replica.ts). It serves no pages and holds no accounts: it is where the tickets live between pulls.
//
//   node src/replica_main.ts                  on port 4742, the database in data/praxis
//   node src/replica_main.ts --port 4752 --data DIR --every 60
//
// Redmine's address and the playground lane's key come from ~/.redmine.env (or $REDMINE_ENV), as EUDAIMONIA's do:
// never logged, never sent. It answers this machine, private addresses and the tailnet only (reach.ts).
//
//   GET  /px/status     when the mirror last ran and what it did; each space's count of tickets
//   GET  /px/have       what this replica has seen (PRAXIS's exchange)
//   POST /px/missing    { have, limit? }: the events the asker lacks
//   POST /px/mirror     run the mirror now (after an answer, so the dashboard sees it at once), and say what it did
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { px, type Db } from "./praxis.ts";
import { MIRROR, Mirror, redmineGet, type Ran } from "./mirror.ts";
import { haveOf, missingFor } from "./replica.ts";
import { allowed } from "./reach.ts";
import { redmineEnv } from "./redmine.ts";

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const port = Number(opt("--port", process.env.PRAXIS_PORT || "4742"));
const data = opt("--data", join(ROOT, "data", "praxis"));
const every = Math.max(15, Number(opt("--every", "120"))) * 1000;
const BODY_MOST = 1024 * 1024;
const say = (l: string) => console.log(`praxis: ${new Date().toISOString().slice(0, 19)} ${l}`);

const envFile = process.env.REDMINE_ENV || join(homedir(), ".redmine.env");
const rm = existsSync(envFile) ? redmineEnv(readFileSync(envFile, "utf8")) : null;
if (!rm) { console.error(`praxis: no REDMINE_URL and REDMINE_KEY_PLAYGROUND in ${envFile}, so there is nothing to mirror`); process.exit(78); }

mkdirSync(data, { recursive: true });
const db = new DatabaseSync(join(data, "praxis.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
const praxis = new px.Praxis(db as unknown as Db, { actor: MIRROR });
const mirror = new Mirror(praxis, redmineGet(rm.url, rm.key), { log: say });

type Last = { at: string; ok: boolean; ran?: Ran; error?: string; ms: number };
let last: Last | null = null;
let running: Promise<Last | null> | null = null;
let skippedSaid = "";
function runOnce() {
  running ??= (async (): Promise<Last | null> => {
    const t = Date.now();
    try {
      const ran = await mirror.run();
      last = { at: ran.at, ok: true, ran, ms: Date.now() - t };
      if (ran.made || ran.changed || ran.notes || ran.links)
        say(`mirrored: ${ran.made} new, ${ran.changed} changed, ${ran.notes} notes, ${ran.links} links (${last.ms} ms)`);
      const skipped = ran.skipped.join(", ");
      if (skipped && skipped !== skippedSaid) say(`not mirrored (no plain number for a handle): ${skipped}`);
      skippedSaid = skipped || skippedSaid;
    } catch (e) {
      const error = (e as Error).message;
      if (last?.error !== error) say(`the mirror could not run: ${error}`);
      last = { at: new Date().toISOString(), ok: false, error, ms: Date.now() - t, ran: last?.ran };
    }
    return last;
  })().finally(() => { running = null; });
  return running;
}

const json = (res: import("node:http").ServerResponse, code: number, v: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(v));
};
const server = createServer(async (req, res) => {
  try {
    if (!allowed(req.socket.remoteAddress)) return json(res, 403, { error: "This replica answers its own network only." });
    const path = (req.url ?? "/").split("?")[0], method = req.method ?? "GET";
    let body: unknown = null;
    if (method === "POST") {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > BODY_MOST) return json(res, 413, { error: "Too much." }); }
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: "Not JSON." }); }
    }
    if (path === "/px/have" && method === "GET") return json(res, 200, haveOf(praxis));
    if (path === "/px/missing" && method === "POST") return json(res, 200, missingFor(praxis, body));
    if (path === "/px/mirror" && method === "POST") return json(res, 200, await runOnce());
    if (path === "/px/status" && method === "GET")
      return json(res, 200, { replica: praxis.replica, last, spaces: mirror.spaces().size,
                              tickets: Object.fromEntries([...mirror.spaces()].map(([k, s]) => [k, praxis.items(s.id).length])) });
    return json(res, 404, { error: "Nothing here." });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(`praxis: ${e.code === "EADDRINUSE" ? `port ${port} is in use (is it running already?)` : e.message}`);
  process.exit(1);
});
server.listen(port, "::", () => {
  say(`replica ${praxis.replica}, its database in ${data}; mirroring ${rm.url} every ${every / 1000} s, as the playground lane`);
  say(`answering this machine, private addresses and the tailnet on port ${port}`);
  void runOnce();
  setInterval(() => void runOnce(), every);
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => { server.close(); server.closeAllConnections(); db.close(); process.exit(0); });
