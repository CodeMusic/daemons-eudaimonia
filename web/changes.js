// THE CHANGES (E-1's last slice): what the lanes pushed lately, in every repository, and the pull requests open on
// GitHub, each with the lane whose daemon is to review it. A ticket's id opens its modal (dashboard.js, "open-ticket");
// a commit or a pull request opens on GitHub. Every word DRAFT.
import { $, ago, api, el } from "./ui.js";

const SHOWN = 8;
let changes = null, why = "", all = false;

const openTicket = (id) => document.dispatchEvent(new CustomEvent("open-ticket", { detail: id }));
const chips = (ids) => ids.map((id) => el("button", { class: "link tid", onclick: () => openTicket(id) }, id));
const repoTag = (c) => el("span", { class: "tag repo" }, c.title);

async function load() {
  try { ({ changes, why = "" } = await api("GET", "/api/changes")); }
  catch (e) { why = e.message; }
  draw();
}

function pull(p) {
  const who = p.reviewer ? (p.daemonName ?? `lane ${p.reviewer}`).toUpperCase() : null;
  return el("li", { class: "pull" },
    p.daemon != null ? el("img", { class: "sprite small", src: `/sprite/${p.daemon}.png`, width: 32, height: 32, alt: "" })
      : el("span", { class: "sprite small nobody", "aria-hidden": "true" }, "?"),
    el("span", { class: "pull-body" },
      el("a", { href: p.url, target: "_blank", rel: "noopener" }, `#${p.number} ${p.subject}`),
      el("small", { class: "dim" }, [p.title, p.draft && "a draft", ago(p.at),
        p.review ? null : who ? `for ${who} to review` : "no ticket named, so no lane to review it"]
        .filter(Boolean).join(" · ")),
      p.review && el("a", { class: `review v-${p.review.verdict.toLowerCase().replace(/\s+/g, "-")}`, href: p.review.url, target: "_blank",
        rel: "noopener" }, `${who ?? p.review.lane.toUpperCase()} REVIEWED IT: ${p.review.verdict}`,
        el("small", { class: "dim" }, p.review.current ? ` · ${ago(p.review.at)}` : " · before its last change")),
      el("span", {}, chips(p.tickets))));
}

function commit(c) {
  return el("li", { class: "change" }, repoTag(c),
    el("span", { class: "change-body" }, el("a", { href: c.url, target: "_blank", rel: "noopener", class: "subject" }, c.subject),
      el("small", { class: "dim" }, `${c.sha} · ${ago(c.at)} `, chips(c.tickets))));
}

function draw() {
  const box = $("changes");
  if (!box) return;
  if (!changes) { box.replaceChildren(el("p", { class: "dim" }, why || "Reading the repositories…")); return; }
  const shown = all ? changes.commits : changes.commits.slice(0, SHOWN);
  box.replaceChildren(
    el("h4", {}, "PULL REQUESTS"),
    changes.pulls.length ? el("ul", { class: "pulls" }, changes.pulls.map(pull))
      : el("p", { class: "dim small" }, changes.pullsWhy ? `None read: ${changes.pullsWhy}.` : "None open: the lanes push to main."),
    el("h4", {}, "PUSHED LATELY"),
    shown.length ? el("ul", { class: "changes" }, shown.map(commit)) : el("p", { class: "dim small" }, "Nothing pushed yet."),
    changes.commits.length > SHOWN && el("button", { class: "link", onclick: () => { all = !all; draw(); } },
      all ? "Fewer" : `${changes.commits.length - SHOWN} more`));
}

await load();
setInterval(() => { if (document.visibilityState === "visible") load().catch(() => {}); }, 2 * 60 * 1000);
