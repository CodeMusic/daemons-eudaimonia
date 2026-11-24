// E-16: a lane's daemon reviews a pull request -- the agent itself, run INSIDE its sandbox (sandbox.ts) by review_main.ts,
// which copies this file in as input/review_agent.ts beside input/pr.json. It reads the pull request (its diff, its
// ticket, the files it changed as they stand at its head, in the clone it runs in), asks the model through the
// sandbox's proxy, and leaves output/review.json. It reaches nothing else and posts nothing: the runner does that.
// Self-contained on purpose (Node's own modules only): nothing outside the sandbox's root can be read from in here.
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

type Pr = { repo: string; number: number; title: string; body: string; head: string; base: string; url: string;
            lane: string; daemon: string | null; ticket: { id: string; title: string; description: string } | null; diff: string };
type Finding = { file?: string; line?: number; severity?: string; text: string };

const DIFF_MOST = 50_000, FILES_MOST = 30_000, FILE_MOST = 8_000;
const pr: Pr = JSON.parse(readFileSync("../input/pr.json", "utf8"));
const url = (process.env.REVIEW_MODEL_URL ?? "").replace(/\/+$/, ""), model = process.env.REVIEW_MODEL ?? "";
if (!url || !model) { console.error("review: no model (REVIEW_MODEL_URL, REVIEW_MODEL)"); process.exit(2); }

/** the files the diff changed, as they stand at the head (the clone this runs in), each cut short */
function changedFiles(): string {
  const names = [...new Set([...pr.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]))];
  let out = "", left = FILES_MOST;
  for (const n of names) {
    if (left <= 0 || n.includes("..") || !existsSync(n) || !statSync(n).isFile() || statSync(n).size > 400_000) continue;
    const text = readFileSync(n, "utf8");
    if (text.includes("\u0000")) continue;   // not text
    const piece = text.length > FILE_MOST ? text.slice(0, FILE_MOST) + "\n[... cut ...]" : text;
    out += `\n--- ${n} (at the head) ---\n${piece.slice(0, left)}\n`;
    left -= piece.length;
  }
  return out;
}

const who = pr.daemon ? `${pr.daemon}, the daemon of the ${pr.lane} lane` : `the ${pr.lane} lane's daemon`;
const system = [
  `You are ${who} in the DAEMONS project (a Pokémon FireRed total conversion, its companion app and its site,`,
  `EUDAIMONIA). You are reviewing a pull request as a careful senior engineer would.`,
  "Look for real defects only: bugs, regressions, things the ticket asks for that are missing or wrong, security or",
  "privacy problems (a secret, a private file, a personal detail), and build breaks. Do not comment on style or naming.",
  "If it looks right, say so briefly. Write in plain English; never write the word 'demon'.",
  'Answer with JSON alone: {"verdict": "LOOKS RIGHT" | "NEEDS CHANGES" | "QUESTIONS", "summary": "two or three sentences",',
  '"findings": [{"file": "path", "line": 12, "severity": "bug" | "risk" | "question", "text": "what and why"}]}',
].join("\n");
const diff = pr.diff.length > DIFF_MOST ? pr.diff.slice(0, DIFF_MOST) + "\n[... the diff goes on ...]" : pr.diff;
const user = [
  `PULL REQUEST ${pr.repo}#${pr.number}: ${pr.title}`, pr.body ? `\nIts description:\n${pr.body.slice(0, 4000)}` : "",
  pr.ticket ? `\nITS TICKET ${pr.ticket.id}: ${pr.ticket.title}\n${pr.ticket.description.slice(0, 6000)}` : "\nIt names no ticket.",
  `\nTHE DIFF:\n${diff}`, `\nTHE FILES IT CHANGED:${changedFiles()}`,
].join("\n");

const res = await fetch(`${url}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.REVIEW_MODEL_KEY ?? ""}` },
  body: JSON.stringify({ model, temperature: 0.2, max_tokens: 8000,
                         messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  signal: AbortSignal.timeout(30 * 60_000),
});
if (!res.ok) { console.error(`review: the model said ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(3); }
const content: string = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";

/** the model's JSON, wherever it put it; else its words as the summary */
function read(text: string): { verdict: string; summary: string; findings: Finding[] } {
  const m = /\{[\s\S]*\}/.exec(text.replace(/^```(json)?|```$/gm, ""));
  try {
    const v = JSON.parse(m?.[0] ?? "");
    const verdict = ["LOOKS RIGHT", "NEEDS CHANGES", "QUESTIONS"].includes(String(v.verdict).toUpperCase()) ? String(v.verdict).toUpperCase() : "QUESTIONS";
    const findings = Array.isArray(v.findings) ? v.findings.filter((f: Finding) => f && typeof f.text === "string").slice(0, 20) : [];
    return { verdict, summary: String(v.summary ?? "").slice(0, 2000), findings };
  } catch { return { verdict: "QUESTIONS", summary: text.trim().slice(0, 3000) || "The model gave no review.", findings: [] }; }
}
const review = { ...read(content), model, at: new Date().toISOString() };
writeFileSync("../output/review.json", JSON.stringify(review, null, 1));
console.log(`review: ${review.verdict}, ${review.findings.length} finding(s)`);
