// E-15: run an agent in its sandbox (sandbox.ts has the walls). On this Mac, where the repositories are:
//
//   ./bindEudaimonia.sh sandbox scope --lane game --ticket T-604
//        which repositories the lane's sandbox would hold, and why (the tickets it holds)
//   ./bindEudaimonia.sh sandbox run --lane game --ticket T-604 [--pass ANTHROPIC_API_KEY] [--hours 2] [--keep]
//        [--dry-run] [--no-pr] [--remote-base URL] -- <the agent's command> [args...]
//
// A run: every repository the lane holds a ticket in (its open tickets in Redmine, and --ticket) is cloned --shared into
// data/sandbox/<run>/, on the branch agent/<lane>/<ticket> from what was last pushed; the command runs there under
// sandbox-exec, its only way out the proxy; when it stops, each repository it committed to is pushed -- that branch
// alone, from a clean copy, so nothing the agent wrote into its .git (a hook, a config) runs out here -- and a pull
// request opened for it. The run is logged in data/sandbox/runs.jsonl and its root removed (--keep keeps it).
// --dry-run pushes nothing; --remote-base pushes to <URL>/<repo>.git instead of GitHub (a test's bare repositories).
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { branchFor, ENGINE_LINKS, profile, proxy, reposFor, sandboxEnv } from "./sandbox.ts";
import { RedmineReader, redmineEnv } from "./redmine.ts";

const run = promisify(execFile);
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const PROJECTS = process.env.EUDAIMONIA_PROJECTS || dirname(ROOT);
const OWNER = "CodeMusic";
const DISK_LEAST = 3 * 1024 ** 3;   // the low-disk rule: no new clones under 3 GB free

const say = (l: string) => console.log("sandbox: " + l);
const git = async (args: string[], cwd?: string) => (await run("git", args, { cwd, maxBuffer: 1 << 24 })).stdout.trim();

type Args = { cmd: string; lane: string; ticket: string; pass: string[]; hours: number; keep: boolean; dry: boolean; pr: boolean;
              remoteBase: string | null; repos: string[] | null; command: string[] };

function parse(argv: string[]): Args {
  const dash = argv.indexOf("--");
  const own = dash >= 0 ? argv.slice(0, dash) : argv, command = dash >= 0 ? argv.slice(dash + 1) : [];
  const opt = (n: string) => { const i = own.indexOf(n); return i >= 0 ? own[i + 1] : undefined; };
  const all = (n: string) => own.flatMap((v, i) => (v === n && own[i + 1] ? [own[i + 1]] : []));
  const a: Args = { cmd: own[0] ?? "", lane: opt("--lane") ?? "", ticket: (opt("--ticket") ?? "").toUpperCase(), pass: all("--pass"),
                    hours: Number(opt("--hours") ?? 2), keep: own.includes("--keep"), dry: own.includes("--dry-run"),
                    pr: !own.includes("--no-pr"), remoteBase: opt("--remote-base") ?? null,
                    repos: opt("--repos") ? opt("--repos")!.split(",").filter(Boolean) : null, command };
  if (!["scope", "run"].includes(a.cmd) || !a.lane || !a.ticket) {
    console.error("usage: sandbox scope|run --lane L --ticket T-n [--pass VAR] [--hours N] [--keep] [--dry-run] [--no-pr] [--remote-base URL] [--repos a,b] -- command");
    process.exit(64);
  }
  branchFor(a.lane, a.ticket);   // a lane and a ticket that make a branch, or stop here
  if (a.cmd === "run" && !a.command.length) { console.error("sandbox: run needs the agent's command after --"); process.exit(64); }
  return a;
}

/** the tickets the lane holds: open in Redmine and its own (in progress, next, waiting), with this run's */
async function held(lane: string, ticket: string): Promise<string[]> {
  const envFile = process.env.REDMINE_ENV || join(homedir(), ".redmine.env");
  const env = existsSync(envFile) ? redmineEnv(readFileSync(envFile, "utf8"), "playground") : null;
  if (!env) { say("no Redmine key: the sandbox holds this ticket's repositories alone"); return [ticket]; }
  try {
    const l = await new RedmineReader(env.url, env.key).lane(lane);
    return [...new Set([ticket, ...(l ? [...l.working, ...l.next, ...l.waiting].map((t) => t.id) : [])])];
  } catch (e) {
    say(`Redmine can't be read (${(e as Error).message}): the sandbox holds this ticket's repositories alone`);
    return [ticket];
  }
}

/** a repository's default branch, as last pushed: origin/HEAD, else the branch it is on */
async function base(src: string): Promise<{ name: string; sha: string }> {
  let name = "";
  try { name = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], src)).replace(/^origin\//, ""); } catch { /* none */ }
  if (!name) name = await git(["rev-parse", "--abbrev-ref", "HEAD"], src);
  let sha = "";
  try { sha = await git(["rev-parse", `refs/remotes/origin/${name}`], src); } catch { sha = await git(["rev-parse", name], src); }
  return { name, sha };
}

async function main() {
  const a = parse(process.argv.slice(2));
  const tickets = await held(a.lane, a.ticket);
  const repos = (a.repos ?? reposFor(tickets)).filter((r) => existsSync(join(PROJECTS, r, ".git")));
  say(`lane ${a.lane}, holding ${tickets.join(" ")}: ${repos.length ? repos.join(", ") : "no repository here"}`);
  if (a.cmd === "scope" || !repos.length) return;

  if (statfsSync(ROOT).bavail * statfsSync(ROOT).bsize < DISK_LEAST) { say("under 3 GB free: no sandbox until there is room"); process.exit(75); }
  const branch = branchFor(a.lane, a.ticket), stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const runs = process.env.EUDAIMONIA_SANDBOX_DATA || join(ROOT, "data", "sandbox"), root = join(runs, `${a.lane}-${a.ticket.toLowerCase()}-${stamp}`);
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  const sb = `${root}.sb`;
  // the root goes when the run ends, however it ends (--keep keeps it)
  process.on("exit", () => { if (!a.keep) { rmSync(root, { recursive: true, force: true }); rmSync(sb, { force: true }); } });

  // the clones: each its own .git, borrowing the real one's objects; on the branch, from what was last pushed
  const bases: Record<string, { name: string; sha: string }> = {}, reads: string[] = [];
  for (const r of repos) {
    const src = join(PROJECTS, r), dst = join(root, r);
    bases[r] = await base(src);
    await git(["clone", "--quiet", "--shared", "--no-checkout", src, dst]);
    await git(["checkout", "--quiet", "-b", branch, bases[r].sha], dst);
    await git(["remote", "remove", "origin"], dst);
    await git(["config", "user.name", `Lane ${a.lane}`], dst);   // its commits are the lane's own
    await git(["config", "user.email", `lane-${a.lane}@agents.daemons.codemusic.ca`], dst);
    reads.push(join(src, ".git", "objects"));
    say(`${r}: ${branch} from ${bases[r].name} (${bases[r].sha.slice(0, 9)})`);
  }
  if (repos.includes("DAEMONS"))   // CLAUDE.md's symlinks, to the clones beside it
    for (const [link, repo] of Object.entries(ENGINE_LINKS))
      if (repos.includes(repo) && !existsSync(join(root, "DAEMONS", link))) symlinkSync(`../${repo}`, join(root, "DAEMONS", link));
  for (const tool of [join(homedir(), ".pyenv")]) if (existsSync(tool)) reads.push(tool);

  // the network: the proxy, on this machine only
  const refused: string[] = [];
  const px = proxy({ log: (l) => { if (l.startsWith("refused")) refused.push(l.slice(8)); } });
  await new Promise<void>((ok) => px.listen(0, "127.0.0.1", ok));
  const port = (px.address() as AddressInfo).port;
  writeFileSync(sb, profile({ root, home: homedir(), proxyPort: port, reads }));

  const pass: Record<string, string> = {};
  for (const v of a.pass) if (process.env[v] !== undefined) pass[v] = process.env[v]!; else say(`--pass ${v}: not set here, not passed`);
  const env = sandboxEnv({ root, proxyPort: port, path: process.env.PATH ?? "/usr/bin:/bin", pass, lane: a.lane, ticket: a.ticket, branch });
  const started = new Date().toISOString();
  say(`running ${JSON.stringify(a.command.join(" "))} in ${root}, its way out 127.0.0.1:${port}`);
  const code = await new Promise<number>((done) => {
    const child = spawn("sandbox-exec", ["-f", sb, ...a.command], { cwd: join(root, repos[0]), env, stdio: "inherit" });
    const timer = setTimeout(() => { say(`${a.hours} h: stopped`); child.kill("SIGTERM"); }, a.hours * 3600_000);
    child.on("exit", (c, sig) => { clearTimeout(timer); done(c ?? (sig ? 128 : 1)); });
    child.on("error", (e) => { clearTimeout(timer); say(e.message); done(127); });
  });
  px.close();
  say(`the agent stopped (${code})${refused.length ? `; refused ${refused.length}: ${[...new Set(refused)].slice(0, 6).join(", ")}` : ""}`);

  // OUT: each repository with commits on its branch, pushed from a clean copy, and a pull request
  const out: { repo: string; commits: number; pushed: boolean; pr: string | null }[] = [];
  for (const r of repos) {
    const dst = join(root, r);
    let commits = 0;
    try { commits = Number(await git(["rev-list", "--count", `${bases[r].sha}..refs/heads/${branch}`], dst)); } catch { /* the branch is gone */ }
    if (!commits) continue;
    const item = { repo: r, commits, pushed: false, pr: null as string | null };
    out.push(item);
    if (a.dry) { say(`${r}: ${commits} commit(s) on ${branch} -- not pushed (--dry-run)`); continue; }
    const clean = join(runs, `${stamp}-${r}.git`);
    try {
      await git(["init", "--quiet", "--bare", clean]);
      await git(["fetch", "--quiet", "--no-tags", dst, `+refs/heads/${branch}:refs/heads/${branch}`], clean);
      const url = a.remoteBase ? `${a.remoteBase.replace(/\/+$/, "")}/${r}.git` : `https://github.com/${OWNER}/${r}.git`;
      await git(["-c", "core.hooksPath=/dev/null", "push", "--quiet", url, `refs/heads/${branch}:refs/heads/${branch}`], clean);
      item.pushed = true;
      say(`${r}: pushed ${commits} commit(s) to ${branch}`);
      if (a.pr && !a.remoteBase) item.pr = await pullRequest(r, branch, bases[r].name, a);
    } catch (e) { say(`${r}: not pushed -- ${(e as Error).message.split("\n")[0]}`); }
    finally { rmSync(clean, { recursive: true, force: true }); }
  }

  mkdirSync(runs, { recursive: true });
  appendFileSync(join(runs, "runs.jsonl"), JSON.stringify({ lane: a.lane, ticket: a.ticket, branch, repos, started,
    ended: new Date().toISOString(), exit: code, refused: refused.length, out, kept: a.keep ? root : null }) + "\n");
  if (a.keep) say(`kept: ${root}`);
  process.exitCode = code;
}

/** a pull request for the branch, unless one is open already; its title from the ticket */
async function pullRequest(repo: string, branch: string, into: string, a: Args): Promise<string | null> {
  const r = `${OWNER}/${repo}`;
  try {
    const open = (await run("gh", ["pr", "list", "--repo", r, "--head", branch, "--json", "url", "-q", ".[0].url"])).stdout.trim();
    if (open) { say(`${repo}: its pull request is open already, ${open}`); return open; }
    const body = `Work on ${a.ticket} by lane ${a.lane}'s daemon, made in its sandbox (EUDAIMONIA E-15): its own copy of the ` +
                 `repositories it holds tickets in, the tailnet, GitHub, npm and the model's API, and nothing else.\n\n` +
                 `To be reviewed before it is merged (DRAFT).`;
    const url = (await run("gh", ["pr", "create", "--repo", r, "--head", branch, "--base", into,
                                  "--title", `${a.ticket}: lane ${a.lane}'s daemon, from its sandbox`, "--body", body])).stdout.trim();
    say(`${repo}: pull request ${url}`);
    return url;
  } catch (e) { say(`${repo}: no pull request -- ${(e as Error).message.split("\n")[0]}`); return null; }
}

main().catch((e) => { say(`stopped: ${(e as Error).message.split("\n")[0]}`); process.exit(1); });
