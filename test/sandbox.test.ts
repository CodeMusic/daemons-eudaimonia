// E-15: an agent's sandbox (MIDDLE, the user 2026-11-23) -- which repositories it holds, the branch it goes out on,
// who its proxy lets it reach, the profile's walls, and (on a Mac) a real run: its commit goes out as the branch alone,
// pushed from a clean copy, while a hook it planted never runs and the real repository is left as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { allowed, branchFor, profile, proxy, reposFor, sandboxEnv, tailnetIp, where } from "../src/sandbox.ts";

test("the repositories a lane holds tickets in: T- DAEMONS and the engines, C- the companion and PRAXIS, E- EUDAIMONIA", () => {
  assert.deepEqual(reposFor(["E-15"]), ["daemons-eudaimonia"]);
  assert.deepEqual(reposFor(["C-1", "E-2", "C-3"]), ["daemons-companion", "daemons-praxis", "daemons-eudaimonia"]);
  assert.deepEqual(reposFor(["T-604"]), ["DAEMONS", "pokefirered-daemons", "gpt-play-pokemon-firered-daemons"]);
  assert.deepEqual(reposFor([]), []);
});

test("its branch is agent/<lane>/<ticket>, and nothing else makes one", () => {
  assert.equal(branchFor("pi-zero", "C-481"), "agent/pi-zero/c-481");
  for (const [l, t] of [["Game", "T-1"], ["game", "main"], ["game", "T-1; rm"], ["../x", "E-1"]]) assert.throws(() => branchFor(l, t));
});

test("who it may reach: GitHub, npm and the model's API on the web's ports; the tailnet; nothing else", () => {
  assert.equal(allowed("github.com", 443), "yes");
  assert.equal(allowed("registry.npmjs.org", 443), "yes");
  assert.equal(allowed("api.anthropic.com", 443), "yes");
  assert.equal(allowed("github.com", 22), "no", "no ssh: the runner pushes, not the agent");
  assert.equal(allowed("example.com", 443), "no");
  assert.equal(allowed("evil.github.com.example", 443), "no");
  assert.equal(allowed("100.101.102.103", 3333), "yes");
  assert.equal(allowed("localhost", 4741), "no");
  assert.equal(allowed("127.0.0.1", 4741), "no");
  assert.equal(allowed("10.0.0.150", 80), "no", "the home network is not the tailnet");
  assert.equal(allowed("roverbyteseer", 3333), "if-tailnet");
  assert.equal(allowed("roverbyteseer.tail1234.ts.net", 4742), "if-tailnet");
  assert.ok(tailnetIp("100.64.0.1") && tailnetIp("100.127.255.254") && !tailnetIp("100.128.0.1") && !tailnetIp("100.63.0.1"));
  assert.ok(tailnetIp("fd7a:115c:a1e0::1") && !tailnetIp("fd00::1"));
});

test("a tailnet name is taken only when it is looked up to a tailnet address, and reached by that address", async () => {
  const lookup = async (h: string) => ({ roverbyteseer: "100.90.1.2", sneaky: "10.0.0.150", "m.tail1.ts.net": "100.70.0.9" } as Record<string, string>)[h] ?? "1.2.3.4";
  assert.equal(await where("roverbyteseer", 3333, { lookup }), "100.90.1.2");
  assert.equal(await where("m.tail1.ts.net", 22, { lookup }), "100.70.0.9");
  assert.equal(await where("sneaky", 80, { lookup }), null);
  assert.equal(await where("github.com", 443, { lookup }), "github.com");
  assert.equal(await where("example.com", 443, { lookup }), null);
});

test("the profile: nothing under the home folder but its root and what it borrows, no docs/private, one way out", () => {
  const p = profile({ root: "/Users/x/run/r1", home: "/Users/x", proxyPort: 51234, reads: ["/Users/x/Projects/A/.git/objects"] });
  assert.match(p, /\(deny file-read\* \(subpath "\/Users\/x"\)\)/);
  assert.match(p, /\(allow file-read\* \(subpath "\/Users\/x\/run\/r1"\)\)/);
  assert.match(p, /\(allow file-read\* \(subpath "\/Users\/x\/Projects\/A\/\.git\/objects"\)\)/);
  assert.match(p, /docs\/private/);
  assert.ok(p.indexOf("docs/private") > p.indexOf("Projects/A/.git/objects"), "refused after every allowance, so it wins");
  assert.match(p, /\(deny file-write\*\)\n\(allow file-write\* \(subpath "\/Users\/x\/run\/r1"\)\)/);
  assert.match(p, /\(deny network-outbound\)\n\(allow network-outbound \(remote ip "localhost:51234"\)\)/);
  assert.match(p, /launchctl/);
  assert.throws(() => profile({ root: "run", home: "/Users/x", proxyPort: 1, reads: [] }));
  assert.equal(profile({ root: '/a"b', home: "/h", proxyPort: 1, reads: [] }).includes('"/a\\"b"'), true, "a quote can't end a string");
});

test("its environment: its own home and temp, the proxy, and only what is passed by name", () => {
  const e = sandboxEnv({ root: "/r", proxyPort: 9, path: "/usr/bin", lane: "game", ticket: "T-1", branch: "agent/game/t-1",
                         pass: { ANTHROPIC_API_KEY: "k" } });
  assert.equal(e.HOME, "/r/home");
  assert.equal(e.HTTPS_PROXY, "http://localhost:9");
  assert.equal(e.ANTHROPIC_API_KEY, "k");
  assert.equal(e.SSH_AUTH_SOCK, undefined);
});

async function listening(s: Server) { await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok)); return (s.address() as AddressInfo).port; }

test("the proxy refuses a host it may not reach, both ways in", async () => {
  const seen: string[] = [];
  const s = proxy({ log: (l) => seen.push(l) });
  const port = await listening(s);
  const plain = await new Promise<number>((ok) => request({ host: "127.0.0.1", port, path: "http://example.com/", method: "GET" },
    (r) => { r.resume(); ok(r.statusCode ?? 0); }).end());
  assert.equal(plain, 403);
  const tunnel = await new Promise<number>((ok) => request({ host: "127.0.0.1", port, method: "CONNECT", path: "example.com:443" })
    .on("connect", (r, sock) => { sock.destroy(); ok(r.statusCode ?? 0); }).end());
  assert.equal(tunnel, 403);
  assert.deepEqual(seen, ["refused GET example.com:80", "refused CONNECT example.com:443"]);
  s.close();
});

const mac = process.platform === "darwin" && spawnSync("which", ["sandbox-exec"]).status === 0;
test("a real run: its commit goes out as its branch alone; a hook it planted never runs; the repository is untouched",
     { skip: !mac && "needs macOS's sandbox-exec" }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "eudaimonia-sbx-")));
  const projects = join(dir, "projects"), repo = join(projects, "daemons-eudaimonia"), fake = join(dir, "github");
  mkdirSync(repo, { recursive: true }); mkdirSync(fake);
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "t"); git(repo, "config", "user.email", "t@t");
  writeFileSync(join(repo, "README.md"), "hello\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "first");
  git(fake, "init", "-q", "--bare", "daemons-eudaimonia.git");
  const trap = join(dir, "HOOK_RAN");
  const agent = `echo more >> README.md && git commit -qam "E-99: from the sandbox" && ` +
    `printf '#!/bin/sh\\ntouch ${trap}\\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push && ` +
    `git branch -f main HEAD && (echo x > ${join(repo, "LEAK")} 2>/dev/null; true)`;
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "src", "sandbox_main.ts"), "run", "--lane", "playground",
    "--ticket", "E-99", "--remote-base", fake, "--", "/bin/sh", "-c", agent],
    { env: { ...process.env, EUDAIMONIA_PROJECTS: projects, REDMINE_ENV: join(dir, "none"), EUDAIMONIA_SANDBOX_DATA: join(dir, "runs") },
      encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const bare = join(fake, "daemons-eudaimonia.git");
  assert.equal(git(bare, "for-each-ref", "--format=%(refname)"), "refs/heads/agent/playground/e-99", "the branch alone, never main");
  assert.equal(git(bare, "log", "-1", "--format=%s %an", "agent/playground/e-99"), "E-99: from the sandbox Lane playground");
  assert.equal(existsSync(trap), false, "its hook never ran out here");
  assert.equal(existsSync(join(repo, "LEAK")), false, "it wrote nothing in the real repository");
  assert.equal(git(repo, "log", "--oneline", "main").split("\n").length, 1, "the real main never moved");
  assert.deepEqual(readdirSync(join(dir, "runs")), ["runs.jsonl"], "its root is gone, its run logged");
});
