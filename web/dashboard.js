// THE DASHBOARD (E-1): the work under way, drawn as the daemons doing it -- for anyone who reaches the site (the user,
// 2026-11-21, by multiple choice). Each lane is drawn with its daemon (its agent account's avatar), at a keyboard while
// it has a ticket in progress and asleep when it has none; what waits on the user is drawn with the player, the
// monkey; and the releases, each opening what it changed. Nothing leaves the page: a lane, a ticket or a release opens
// in a modal, with FULL VIEW for a new tab (/#ticket=T-465, /#release=v11.411.1, /#lane=game). Read-only: answering a
// waiting ticket is the next slice. Every word DRAFT.
import { $, api, el } from "./ui.js";
import { md, inline } from "./md.js";
import { whoami as me, pickDaemon, showSecret } from "./app.js";

let board = null, releases = [], why = "";
const REFRESH_MS = 60 * 1000;

const ago = (iso) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago`
    : `${Math.round(s / 86400)} days ago`;
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A small keyboard, drawn: three rows of keys that light in turn while its lane is at work. */
function keyboard() {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 72 22"); svg.setAttribute("class", "keyboard"); svg.setAttribute("aria-hidden", "true");
  const rect = (x, y, w, h, cls) => { const r = document.createElementNS(ns, "rect");
    Object.entries({ x, y, width: w, height: h, rx: 1.4, class: cls }).forEach(([k, v]) => r.setAttribute(k, v)); svg.append(r); };
  rect(0, 0, 72, 22, "base");
  let n = 0;
  for (const [row, y, count, x0] of [[0, 3, 10, 3], [1, 8.5, 9, 5.5], [2, 14, 8, 8]]) {
    for (let k = 0; k < count; k++) rect(x0 + k * 6.6, y, 5.4, 4.4, `key k${(n++ * 7) % 12}`);
    void row;
  }
  rect(22, 18.6, 28, 2.2, "key space");
  return svg;
}

function sprite(id, size = 64, cls = "sprite") {
  return id == null ? el("span", { class: `${cls} nobody`, "aria-hidden": "true" }, "?")
    : el("img", { class: cls, src: `/sprite/${id}.png`, width: size, height: size, alt: "", loading: "lazy" });
}

function ticketRow(t, extra) {
  return el("li", {}, el("button", { class: "ticket", onclick: () => openTicket(t.id) },
    el("span", { class: "tid" }, t.id), el("span", { class: "ttl" }, inline(t.title)),
    extra ?? el("span", { class: `tag st-${t.status.toLowerCase().replace(/\s+/g, "-")}` }, t.status.toUpperCase())));
}

// ---- the panels ----------------------------------------------------------------------------------------------------

function draw() {
  if (!board) {
    $("progress").replaceChildren();
    $("lanes").replaceChildren(el("p", { class: "dim" }, why || "Reading the tickets…"));
    $("waiting").replaceChildren();
    $("dash-line").textContent = "The work under way, drawn as the daemons doing it.";
  } else {
    $("dash-line").textContent = board.stale ? `The tickets can't be reached just now: this is how they stood ${ago(board.at)}.`
      : `The work under way, drawn as the daemons doing it. Read ${ago(board.at)}.`;
    $("progress").replaceChildren(...board.projects.map((p) => {
      const all = p.open + p.closed, pc = all ? Math.round((100 * p.closed) / all) : 0;
      const bar = el("span", { class: "bar", role: "img", "aria-label": `${pc}% closed` }, el("span", {}));
      bar.firstChild.style.width = `${pc}%`;
      return el("div", { class: "project" }, el("b", {}, p.name), bar,
        el("small", { class: "dim" }, `${p.closed} closed · ${p.open} open${p.working ? ` · ${p.working} at work` : ""}`));
    }));
    $("lanes").replaceChildren(...board.lanes.map(laneTile));
    drawWaiting();
  }
  drawReleases();
}

function laneTile(l) {
  const working = l.working.length > 0;
  const scene = el("span", { class: "scene" }, sprite(l.daemon), keyboard(),
    !working && el("span", { class: "zz", "aria-hidden": "true" }, el("i", {}, "z"), el("i", {}, "z"), el("i", {}, "z")));
  const what = working ? `${plural(l.working.length, "at work", "at work")}${l.next.length ? ` · ${l.open - l.working.length} more` : ""}`
    : l.open ? `asleep · ${l.open} waiting for it` : "asleep";
  return el("button", { class: `lane ${working ? "working" : "asleep"}`, onclick: () => openLane(l.lane),
                        "aria-label": `${l.daemonName ?? l.lane}, the ${l.lane} lane: ${what}` },
    scene,
    el("span", { class: "who" }, el("b", {}, (l.daemonName ?? l.lane).toUpperCase()), el("small", {}, `lane ${l.lane}`)),
    el("span", { class: "what" }, working ? inline(`${l.working[0].id} ${l.working[0].title}`) : what));
}

function drawWaiting() {
  const w = board.waiting;
  $("waiting").replaceChildren(...[
    el("div", { class: "player" }, el("img", { src: "/art/player.png", width: 64, height: 64, alt: "", class: "sprite" }),
      el("p", {}, w.length ? el("b", {}, plural(w.length, "ticket waits", "tickets wait"), " on you.") : "Nothing waits on you.")),
    w.length && el("ul", { class: "tickets" }, w.map((t) => ticketRow(t)))].filter(Boolean));
}

function drawReleases() {
  const list = $("releases");
  if (!releases.length) { list.replaceChildren(el("li", { class: "dim" }, "No release found.")); return; }
  list.replaceChildren(...releases.slice(0, 5).map((r) => el("li", {}, el("button", { class: "release", onclick: () => openRelease(r.name) },
    el("b", {}, r.name), el("small", { class: "dim" }, `${r.date ?? ""}${r.sealed ? " · sealed" : ""}`)))));
  if (releases.length > 5)
    list.append(el("li", {}, el("button", { class: "link", onclick: openAllReleases }, `Every release (${releases.length})`)));
}

// ---- the modals ----------------------------------------------------------------------------------------------------

function show(id, hash) {
  const d = $(id);
  d.classList.toggle("full", location.hash === hash);
  $(`${id}-full`).href = "/" + hash;
  if (!d.open) d.showModal();
}
for (const id of ["lane", "ticket", "release"])
  $(id).addEventListener("close", () => { if (location.hash) history.replaceState(null, "", location.pathname); $(id).classList.remove("full"); });

function openLane(name) {
  const l = board?.lanes.find((x) => x.lane === name);
  if (!l) return;
  $("lane-scene").replaceChildren(el("span", { class: `scene ${l.working.length ? "working" : "asleep"}` }, sprite(l.daemon), keyboard()));
  $("lane-title").textContent = (l.daemonName ?? l.lane).toUpperCase();
  $("lane-line").textContent = `The ${l.lane} lane${l.last ? ` · last moved ${ago(l.last)}` : ""}`;
  const section = (title, list, empty) => [el("h3", {}, title),
    list.length ? el("ul", { class: "tickets" }, list.map((t) => ticketRow(t))) : el("p", { class: "dim" }, empty)];
  $("lane-body").replaceChildren(
    ...section("AT WORK", l.working, "Nothing in progress: it is asleep."),
    ...section("NEXT", l.next, "Nothing ready for it."),
    ...section("LATELY DONE", l.done.map((t) => ({ ...t, status: `closed ${day(t.closed)}` })), "Nothing closed lately."));
  const admin = me()?.admin && !me()?.mustChange;
  $("lane-admin").hidden = !admin;
  if (admin) {
    $("lane-admin").replaceChildren(el("button", { onclick: () => giveDaemon(l) }, l.account ? "ANOTHER DAEMON FOR IT" : "GIVE IT A DAEMON"),
      el("small", { class: "dim" }, l.account ? ` Its agent account, ${l.lane}, carries it.` : ` An agent account called ${l.lane} is made to carry it.`));
  }
  show("lane", `#lane=${l.lane}`);
}

/** The admin picks a lane's daemon: its agent account's avatar, the account made if there is none yet. */
async function giveDaemon(l) {
  await pickDaemon(`A DAEMON FOR THE ${l.lane.toUpperCase()} LANE`, l.daemon, async (id) => {
    if (l.account) {
      const { accounts } = await api("GET", "/api/accounts");
      const a = accounts.find((x) => x.kind === "agent" && x.name === l.lane);
      if (!a) throw new Error(`No agent account called ${l.lane}.`);
      await api("POST", `/api/accounts/${a.id}`, { action: "avatar", avatar: id });
    } else {
      const r = await api("POST", "/api/accounts", { name: l.lane, kind: "agent", avatar: id });
      showSecret(r.account, r.secret);
    }
  });
  await load();
  openLane(l.lane);
}

async function openTicket(id) {
  $("ticket-title").textContent = id;
  $("ticket-body").replaceChildren(el("p", { class: "dim" }, "Reading it…"));
  show("ticket", `#ticket=${id}`);
  try {
    const { ticket: t } = await api("GET", `/api/ticket/${encodeURIComponent(id)}`);
    $("ticket-title").textContent = `${t.id} · ${t.status.toUpperCase()}`;
    $("ticket-body").replaceChildren(...[
      el("h2", { class: "ticket-title" }, inline(t.title)),
      el("p", { class: "dim small" }, [t.lane ? `lane ${t.lane}` : "no lane", `updated ${ago(t.updated)}`, t.closed && `closed ${day(t.closed)}`]
        .filter(Boolean).join(" · ")),
      el("div", { class: "md" }, md(t.description)),
      t.fields.length ? el("dl", { class: "fields" }, t.fields.flatMap((f) => [el("dt", {}, f.name.toUpperCase()), el("dd", {}, md(f.value))])) : null,
      t.notes.length ? el("h3", {}, "LATEST NOTES") : null,
      ...t.notes.map((n) => el("article", { class: "note" }, el("small", { class: "dim" }, `${n.by} · ${ago(n.at)}`), el("div", { class: "md" }, md(n.text))))]
      .filter(Boolean));
  } catch (e) {
    $("ticket-body").replaceChildren(el("p", { class: "error" }, e.message));
  }
}

async function openRelease(name) {
  $("release-title").textContent = name;
  $("release-body").replaceChildren(el("p", { class: "dim" }, "Reading it…"));
  show("release", `#release=${name}`);
  try {
    const { release: r, text } = await api("GET", `/api/release/${encodeURIComponent(name)}`);
    $("release-title").textContent = `${r.name}${r.sealed ? " · SEALED" : ""}`;
    $("release-body").replaceChildren(
      el("p", { class: "dim small" }, [r.date, r.editions.join(" and ")].filter(Boolean).join(" · ")),
      text ? el("div", { class: "md notes" }, md(text))
        : r.pdf ? el("p", {}, "Its group is sealed: every release under it is in one PDF. ",
                     el("a", { href: `/release/${encodeURIComponent(r.name)}/notes.pdf`, target: "_blank", rel: "noopener" }, "Open the notes ↗"))
        : el("p", { class: "dim" }, "It has no notes."));
  } catch (e) {
    $("release-body").replaceChildren(el("p", { class: "error" }, e.message));
  }
}

function openAllReleases() {
  $("release-title").textContent = "EVERY RELEASE";
  $("release-body").replaceChildren(el("ul", { class: "tickets" }, releases.map((r) => el("li", {},
    el("button", { class: "ticket", onclick: () => openRelease(r.name) }, el("span", { class: "tid" }, r.name),
      el("span", { class: "ttl dim" }, `${r.date ?? ""}${r.sealed ? " · sealed" : ""}`))))));
  show("release", "#releases");
}

// ---- reading, now and every minute ---------------------------------------------------------------------------------

async function load() {
  const [b, r] = await Promise.allSettled([api("GET", "/api/board"), api("GET", "/api/releases")]);
  if (b.status === "fulfilled") { board = b.value.board; why = b.value.why ?? ""; }
  else if (!board) why = b.reason.message;
  if (r.status === "fulfilled") releases = r.value.releases;
  draw();
}

function fromHash() {
  const m = /^#(ticket|release|lane)=(.+)$/.exec(location.hash);
  if (!m) { if (location.hash === "#releases") openAllReleases(); return; }
  const v = decodeURIComponent(m[2]);
  if (m[1] === "ticket") openTicket(v); else if (m[1] === "release") openRelease(v); else openLane(v);
}

draw();   // "Reading the tickets…" while the first read (a few seconds of Redmine) is under way
await load();
fromHash();
addEventListener("hashchange", fromHash);
setInterval(() => { if (document.visibilityState === "visible") load().catch(() => {}); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && board && Date.now() - new Date(board.at) > REFRESH_MS) load(); });
document.addEventListener("me", () => draw());
