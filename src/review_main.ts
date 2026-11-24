// E-16: THE CHANGES' pull requests reviewed by the lanes' daemons. On the Mac that holds the repositories:
//
//   ./bindEudaimonia.sh review --all [--dry-run]          every open pull request that names a ticket with a lane
//   ./bindEudaimonia.sh review --repo R --pr N [--lane L --ticket T-n] [--dry-run] [--force]
//   ./bindEudaimonia.sh review always|never               every quarter of an hour, as a login agent (bindEudaimonia.sh)
//
// For each pull request: the reviewer is the lane of the first ticket it names (its title or its branch); a pull request
// already reviewed at its head is left alone (--force reviews it again). Out here, with this machine's own sign-ins:
// its diff (gh), its ticket (Redmine), the lane's daemon's name (THE DASHBOARD). In the lane's sandbox (E-15), at the pull
// request's head: review_agent.ts asks the model -- the house's LiteLLM on roverbyteseer, a local model, its key read
// over ssh and passed in by name -- and leaves its review. Out here again: the review posted on GitHub as a comment
// review (gh pr review --comment), headed with the daemon's name and ending in a hidden marker THE CHANGES reads back
// (changes.ts). --dry-run prints it instead. Each review is logged in data/sandbox/reviews.jsonl.
import { execFile, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { REPOS_OF } from "./sandbox.ts";
import { marker, MARKER, ticketsIn } from "./changes.ts";
import { RedmineReader, redmineEnv } from "./redmine.ts";

const run = promisify(execFile);
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OWNER = "CodeMusic";
const MODEL_URL = process.env.REVIEW_MODEL_URL || "http://roverbyteseer:4000/v1";
const MODEL = process.env.REVIEW_MODEL || "tiiny-35b";
const BOARD = process.env.EUDAIMONIA_BOARD || "http://roverbyteseer:4741/api/board";
const REVIEW_MOST = 200_000;
const say = (l: string) => console.log("review: " + l);

/** a model's words made safe to post: no @-mention that would call someone, no HTML comment that could forge a marker,
 *  and the project's one rule about a word (DAEMONS is said DAY-mons) */
export function tame(text: string): string {
  return text.replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/@(?=[A-Za-z0-9-])/g, "@​").replace(/\bdemon(s?)\b/gi, "daemon$1");
}

type Finding = { file?: string; line?: number; severity?: string; text: string };
/** the review as it is posted (DRAFT words) */
export function body(o: { daemon: string | null; lane: string; sha: string; model: string; verdict: string; summary: string;
                          findings: Finding[] }): string {
  const who = o.daemon ? `**${o.daemon.toUpperCase()}**, the ${o.lane} lane's daemon,` : `**The ${o.lane} lane's daemon**`;
  const lines = [
    `${who} reviewed this at \`${o.sha.slice(0, 7)}\`: **${o.verdict}**`,
    `*DRAFT: a local model (${o.model}) in the lane's sandbox, EUDAIMONIA E-16. A person decides.*`, "",
    tame(o.summary),
  ];
  if (o.findings.length) {
    lines.push("");
    for (const f of o.findings) {
      const where = f.file ? ` \`${tame(String(f.file)).replace(/`/g, "")}${f.line ? `:${Number(f.line) || ""}` : ""}\`` : "";
      lines.push(`- **${tame(String(f.severity ?? "note")).replace(/[*_`]/g, "")}**${where} ${tame(f.text)}`);
    }
  }
  lines.push("", marker(o.lane, o.sha, o.verdict));
  return lines.join("\n");
}

type Pr = { repo: string; number: number; title: string; body: string; headRefName: string; headRefOid: string; baseRefName: string; url: string };
const FIELDS = "number,title,body,headRefName,headRefOid,baseRefName,url";
const gh = async (args: string[]) => (await run("gh", args, { maxBuffer: 1 << 26 })).stdout;

async function reader(): Promise<RedmineReader | null> {
  const f = process.env.REDMINE_ENV || join(homedir(), ".redmine.env");
  const env = existsSync(f) ? redmineEnv(readFileSync(f, "utf8"), "playground") : null;
  return env ? new RedmineReader(env.url, env.key) : null;
}

async function daemonOf(lane: string): Promise<string | null> {
  try {
    const r = await fetch(BOARD, { signal: AbortSignal.timeout(8000) });
    const v = (await r.json()) as { board?: { lanes?: { lane: string; daemonName: string | null }[] } };
    return v.board?.lanes?.find((l) => l.lane === lane)?.daemonName ?? null;
  } catch { return null; }
}

async function modelKey(): Promise<string> {
  if (process.env.LITELLM_KEY) return process.env.LITELLM_KEY;
  const { stdout } = await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "roverbyte@roverbyteseer",
                                       'sed -n "s/^LITELLM_MASTER_KEY=//p" ~/.litellm.env']);
  return stdout.trim().replace(/^["']|["']$/g, "");
}

async function reviewedAt(pr: Pr): Promise<boolean> {
  const all = JSON.parse(await gh(["api", `repos/${OWNER}/${pr.repo}/pulls/${pr.number}/reviews`, "--paginate"])) as { body: string }[];
  return all.some((r) => MARKER.exec(r.body ?? "")?.[2] === pr.headRefOid);
}

async function review(pr: Pr, o: { lane?: string; ticket?: string; dry: boolean; force: boolean; rm: RedmineReader | null }) {
  const named = ticketsIn(`${pr.title} ${pr.headRefName}`);
  let ticket = o.ticket ?? named[0] ?? null, lane = o.lane ?? null, detail = null as Awaited<ReturnType<RedmineReader["ticket"]>>;
  for (const id of o.ticket ? [o.ticket] : named) {
    try { detail = (await o.rm?.ticket(id)) ?? null; } catch { detail = null; }
    if (detail?.lane) { ticket = id; lane ??= detail.lane; break; }
  }
  if (!lane || !ticket) return say(`${pr.repo}#${pr.number}: it names no ticket with a lane, so no daemon reviews it`);
  if (!o.force && await reviewedAt(pr)) return say(`${pr.repo}#${pr.number}: ${lane}'s daemon reviewed it at this head already`);

  const work = mkdtempSync(join(ROOT, "data", "sandbox", `review-`)), input = join(work, "input"), output = join(work, "output");
  mkdirSync(input); mkdirSync(output);
  try {
    const daemon = await daemonOf(lane);
    const diff = await gh(["pr", "diff", String(pr.number), "--repo", `${OWNER}/${pr.repo}`]);
    writeFileSync(join(input, "pr.json"), JSON.stringify({
      repo: pr.repo, number: pr.number, title: pr.title, body: pr.body ?? "", head: pr.headRefOid, base: pr.baseRefName, url: pr.url,
      lane, daemon, diff, ticket: detail ? { id: ticket, title: detail.title, description: detail.description } : null }));
    copyFileSync(join(ROOT, "src", "review_agent.ts"), join(input, "review_agent.ts"));
    // the files it changed, the only ones checked out in its sandbox (DAEMONS whole would be 3 GB)
    writeFileSync(join(work, "paths"), [...new Set([...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]))].join("\n") + "\n");
    say(`${pr.repo}#${pr.number}: ${daemon ?? `the ${lane} lane's daemon`} reads it (${ticket}, ${MODEL})`);

    const env = { ...process.env, REVIEW_MODEL_URL: MODEL_URL, REVIEW_MODEL: MODEL, REVIEW_MODEL_KEY: await modelKey() };
    const code = await new Promise<number>((done) => {
      const c = spawn(process.execPath, [join(ROOT, "src", "sandbox_main.ts"), "run", "--lane", lane!, "--ticket", ticket!,
        "--repos", pr.repo, "--pr", String(pr.number), "--input", input, "--output", output, "--no-push", "--hours", "1", "--sparse", join(work, "paths"),
        "--pass", "REVIEW_MODEL_URL", "--pass", "REVIEW_MODEL", "--pass", "REVIEW_MODEL_KEY",
        "--", process.execPath, "../input/review_agent.ts"], { env, stdio: "inherit" });
      c.on("exit", (n) => done(n ?? 1));
    });
    const file = join(output, "review.json");
    // only a plain file it wrote: a link it left (to a key, say) is never followed out here
    if (code !== 0 || !existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).size > REVIEW_MOST)
      return say(`${pr.repo}#${pr.number}: no review came out (${code})`);
    const v = JSON.parse(readFileSync(file, "utf8")) as { verdict: string; summary: string; findings: Finding[]; model: string };
    const text = body({ daemon, lane, sha: pr.headRefOid, model: String(v.model ?? MODEL), verdict: String(v.verdict ?? "QUESTIONS"),
                        summary: String(v.summary ?? ""), findings: Array.isArray(v.findings) ? v.findings : [] });
    if (o.dry) { say(`${pr.repo}#${pr.number}: --dry-run, not posted:\n\n${text}\n`); }
    else {
      const bf = join(work, "body.md");
      writeFileSync(bf, text);
      await gh(["pr", "review", String(pr.number), "--repo", `${OWNER}/${pr.repo}`, "--comment", "--body-file", bf]);
      say(`${pr.repo}#${pr.number}: posted, ${v.verdict}`);
    }
    appendFileSync(join(ROOT, "data", "sandbox", "reviews.jsonl"), JSON.stringify({ repo: pr.repo, pr: pr.number, sha: pr.headRefOid,
      lane, ticket, verdict: v.verdict, findings: v.findings?.length ?? 0, posted: !o.dry, at: new Date().toISOString() }) + "\n");
  } finally { rmSync(work, { recursive: true, force: true }); }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const dry = argv.includes("--dry-run"), force = argv.includes("--force"), rm = await reader();
  mkdirSync(join(ROOT, "data", "sandbox"), { recursive: true });
  const repos = [...new Set(Object.values(REPOS_OF).flat())];
  if (opt("--repo") && opt("--pr")) {
    const repo = opt("--repo")!;
    if (!repos.includes(repo)) throw new Error(`${repo} is not one of the project's repositories`);
    const pr = { repo, ...JSON.parse(await gh(["pr", "view", opt("--pr")!, "--repo", `${OWNER}/${repo}`, "--json", FIELDS])) } as Pr;
    return review(pr, { lane: opt("--lane"), ticket: opt("--ticket")?.toUpperCase(), dry, force, rm });
  }
  if (!argv.includes("--all")) {
    console.error("usage: review --all [--dry-run] | review --repo R --pr N [--lane L --ticket T-n] [--dry-run] [--force]");
    process.exit(64);
  }
  for (const repo of repos) {
    let open: Pr[] = [];
    try { open = (JSON.parse(await gh(["pr", "list", "--repo", `${OWNER}/${repo}`, "--state", "open", "--json", FIELDS])) as Pr[]).map((p) => ({ ...p, repo })); }
    catch (e) { say(`${repo}: can't list its pull requests (${(e as Error).message.split("\n")[0]})`); }
    for (const pr of open) {
      try { await review(pr, { dry, force, rm }); } catch (e) { say(`${repo}#${pr.number}: ${(e as Error).message.split("\n")[0]}`); }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { say(`stopped: ${(e as Error).message.split("\n")[0]}`); process.exit(1); });
