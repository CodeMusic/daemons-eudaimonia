// THE CHANGES (E-1's last slice): the commits pushed in each clone, newest first with their tickets, and GitHub's open
// pull requests, each with the lane of the ticket it names to review it -- with a made-up git and a made-up GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Changes, ticketsIn } from "../src/changes.ts";

const log = (rows: [string, string, string][]) => rows.map((r) => r.join("\x1f")).join("\n") + "\n";
const repos = [{ name: "DAEMONS", dir: "/d", title: "DAEMONS" }, { name: "daemons-praxis", dir: "/p", title: "PRAXIS" }];

function make(o: { pulls?: unknown; status?: number; throws?: boolean; noUpstream?: boolean } = {}) {
  let t = 1_000_000, fetched = 0, gitted = 0;
  const git = async (dir: string, args: string[]) => {
    gitted++;
    if (o.noUpstream && args[1] === "@{upstream}") throw new Error("no upstream");
    return dir === "/d" ? log([["a".repeat(40), "2026-11-22T10:00:00Z", "T-604: fifteen forms (DRAFT)"],
                               ["b".repeat(40), "2026-11-20T10:00:00Z", "README and wiki"]])
                        : log([["c".repeat(40), "2026-11-21T10:00:00Z", "C-435 and E-9: the engine, its own repo"]]);
  };
  const fetch = async (url: string) => {
    fetched++;
    if (o.throws) throw new Error("offline");
    return { ok: (o.status ?? 200) === 200, status: o.status ?? 200,
             json: async () => (url.includes("DAEMONS") ? o.pulls ?? [] : []) };
  };
  const tickets = { ticket: async (id: string) => (id === "E-15" ? { lane: "playground" } : null) } as never;
  const c = new Changes({ repos, git, fetch, now: () => t, tickets });
  return { c, tick: (ms: number) => { t += ms; }, counts: () => ({ fetched, gitted }) };
}

test("a subject's tickets, once each", () => {
  assert.deepEqual(ticketsIn("C-435 and E-9, E-9 again; not XT-4 or T-"), ["C-435", "E-9"]);
});

test("the commits pushed, newest first across repositories, with their tickets and GitHub links", async () => {
  const { c } = make();
  const v = await c.view();
  assert.deepEqual(v.commits.map((x) => x.subject), ["T-604: fifteen forms (DRAFT)", "C-435 and E-9: the engine, its own repo", "README and wiki"]);
  assert.deepEqual(v.commits[1].tickets, ["C-435", "E-9"]);
  assert.equal(v.commits[0].sha, "aaaaaaaaa");
  assert.equal(v.commits[1].url, `https://github.com/CodeMusic/daemons-praxis/commit/${"c".repeat(40)}`);
  assert.equal(v.pullsWhy, null);
});

test("a clone with no upstream shows its own HEAD", async () => {
  const { c } = make({ noUpstream: true });
  assert.equal((await c.view()).commits.length, 3);
});

test("a pull request names its reviewer: the lane of its ticket", async () => {
  const pulls = [{ number: 7, title: "E-15: the sandbox", html_url: "https://github.com/CodeMusic/DAEMONS/pull/7",
                   updated_at: "2026-11-23T10:00:00Z", user: { login: "someone" }, head: { ref: "e15" } },
                 { number: 8, title: "A typo", html_url: "u", updated_at: "2026-11-22T10:00:00Z", draft: true }];
  const { c } = make({ pulls });
  const v = await c.view();
  assert.equal(v.pulls.length, 2);
  assert.deepEqual([v.pulls[0].number, v.pulls[0].reviewer, v.pulls[0].tickets], [7, "playground", ["E-15"]]);
  assert.deepEqual([v.pulls[1].reviewer, v.pulls[1].draft], [null, true]);
});

test("GitHub is asked a quarter of an hour at a time, git every two minutes", async () => {
  const { c, tick, counts } = make();
  await c.view(); await c.view();
  assert.deepEqual(counts(), { fetched: 2, gitted: 2 });
  tick(3 * 60 * 1000); await c.view();
  assert.deepEqual(counts(), { fetched: 2, gitted: 4 });
  tick(13 * 60 * 1000); await c.view();
  assert.equal(counts().fetched, 4);
});

test("GitHub away or refusing: the commits still show, and why the pull requests don't", async () => {
  const off = await make({ throws: true }).c.view();
  assert.equal(off.commits.length, 3);
  assert.match(off.pullsWhy ?? "", /can't be reached/);
  assert.match((await make({ status: 403 }).c.view()).pullsWhy ?? "", /403/);
});
