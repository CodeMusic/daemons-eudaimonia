// THE SPACES (E-10): every space PRAXIS holds, as a LIST, a BOARD and a ROADMAP, each in a modal with FULL VIEW for a
// new tab (/#space=T&view=board). The mirrored spaces (T-, C-, E-) are Redmine's until the cut-over (E-11), so they read
// here; a space of your own -- made here, signed in -- takes new tickets here, and a ticket's page (dashboard.js) changes
// it. Opening a ticket is the dashboard's: this asks for it with the event "open-ticket". Every word DRAFT.
import { $, ago, api, bar, day, el } from "./ui.js";
import { inline } from "./md.js";

const VIEWS = ["list", "board", "roadmap"];
const LIST_MOST = 150, DONE_MOST = 12, NEXT_MOST = 5;
const ROLES = ["game", "story", "audio", "art", "app", "hub", "esp32", "pi-zero", "playground", "docs", "ops"];
let spaces = [], canMake = false, why = "";
let current = null;   // { prefix, view, data: { space, rows, canEdit }, filter: { q, lane, closed }, making }

const openTicket = (id) => document.dispatchEvent(new CustomEvent("open-ticket", { detail: id }));
const stateTag = (r) => el("span", { class: `tag st-${r.state}` }, r.status.toUpperCase());
const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || b.updated.localeCompare(a.updated);
const byClosed = (a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "");

// ---- the panel on the front page ------------------------------------------------------------------------------------

async function load() {
  try { ({ spaces, canMake, why = "" } = await api("GET", "/api/spaces")); }
  catch (e) { why = e.message; }
  drawPanel();
}

function drawPanel() {
  const box = $("spaces");
  const list = spaces.length ? el("ul", { class: "spaces" }, spaces.map((s) => el("li", { class: "space-row" },
    el("button", { class: "space-name link", onclick: () => openSpace(s.prefix, "list") }, el("b", {}, s.title),
      el("small", { class: "dim" }, ` ${s.prefix}-`)),
    el("span", { class: `tag ${s.mirrored ? "" : "warn"}` }, s.mirrored ? "FROM REDMINE" : s.reach === "public" ? "PUBLIC" : "YOURS"),
    bar(s.closed, s.open + s.closed),
    el("small", { class: "dim space-counts" }, `${s.closed} closed · ${s.open} open${s.working ? ` · ${s.working} at work` : ""}`),
    el("span", { class: "space-views" }, VIEWS.map((v) => el("button", { class: "link", onclick: () => openSpace(s.prefix, v) }, v.toUpperCase()))))))
    : el("p", { class: "dim" }, why || "No spaces yet.");
  box.replaceChildren(list, canMake ? el("button", { class: "link make-space", onclick: openMakeSpace }, "+ A SPACE OF YOUR OWN")
    : el("p", { class: "dim small" }, "Signed in, you can make a space of your own."));
}

// ---- the modal ------------------------------------------------------------------------------------------------------

function showSpace(hash) {
  const d = $("space");
  d.classList.toggle("full", location.hash === hash);
  $("space-full").href = "/" + hash;
  if (!d.open) d.showModal();
}
$("space").addEventListener("close", () => {
  if (location.hash.startsWith("#space")) history.replaceState(null, "", location.pathname);
  $("space").classList.remove("full");
  current = null;
});

async function openSpace(prefix, view = "list") {
  if (!current || current.prefix !== prefix) current = { prefix, view, data: null, filter: { q: "", lane: "", closed: false }, making: false };
  $("space-full").hidden = false;
  current.view = view;
  if (!current.data) {
    $("space-title").textContent = `${prefix}-`;
    $("space-line").textContent = "";
    $("space-tabs").replaceChildren();
    $("space-tools").replaceChildren();
    $("space-body").replaceChildren(el("p", { class: "dim" }, "Reading it…"));
  }
  showSpace(`#space=${prefix}&view=${view}`);
  try { current.data = await api("GET", `/api/space/${encodeURIComponent(prefix)}`); }
  catch (e) { $("space-body").replaceChildren(el("p", { class: "error" }, e.message)); return; }
  drawSpace();
}

function drawSpace() {
  if (!current?.data) return;
  const { space: s, rows, canEdit } = current.data, f = current.filter;
  $("space-title").textContent = `${s.title} · ${s.prefix}-`;
  $("space-line").textContent = [s.mirrored ? "Mirrored from Redmine: read here, changed there until the cut-over"
    : `${s.reach === "public" ? "Public" : "Yours"}, made by ${s.by} ${day(s.made)}`, `${s.open} open`, `${s.closed} closed`].join(" · ");
  $("space-full").href = `/#space=${s.prefix}&view=${current.view}`;
  $("space-tabs").replaceChildren(...VIEWS.map((v) => el("button", { role: "tab", "aria-selected": String(v === current.view),
    class: v === current.view ? "tab on" : "tab", onclick: () => { current.view = v; if ($("space").classList.contains("full"))
      history.replaceState(null, "", `#space=${s.prefix}&view=${v}`); drawSpace(); } }, v.toUpperCase())));
  const lanes = [...new Set(rows.map((r) => r.lane).filter(Boolean))].sort();
  const search = el("input", { type: "search", placeholder: "Find a ticket", value: f.q, "aria-label": "Find a ticket" });
  search.addEventListener("input", () => { f.q = search.value; drawBody(); });
  const lane = el("select", { "aria-label": "Lane" }, el("option", { value: "" }, "every lane"),
    lanes.map((l) => el("option", { value: l, selected: l === f.lane }, `lane ${l}`)));
  lane.addEventListener("change", () => { f.lane = lane.value; drawBody(); });
  $("space-tools").replaceChildren(...[search, lane,
    current.view === "list" && el("label", { class: "check" }, el("input", { type: "checkbox", checked: f.closed,
      onchange: (e) => { f.closed = e.target.checked; drawBody(); } }), "closed too"),
    canEdit && el("button", { class: "primary", onclick: () => { current.making = !current.making; drawBody(); } }, "+ A TICKET")].filter(Boolean));
  drawBody();
}

function filtered() {
  const { rows } = current.data, f = current.filter, q = f.q.trim().toLowerCase();
  return rows.filter((r) => (!f.lane || r.lane === f.lane) && (!q || r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
}

function drawBody() {
  const rows = filtered();
  const body = current.view === "board" ? board(rows) : current.view === "roadmap" ? roadmap(rows) : list(rows);
  $("space-body").replaceChildren(current.making ? newTicket() : "", body);
}

function row(r, extra) {
  return el("li", {}, el("button", { class: "ticket", onclick: () => openTicket(r.id) },
    el("span", { class: "tid" }, r.id), el("span", { class: "ttl" }, inline(r.title)),
    r.lane && el("span", { class: "lane-chip dim" }, r.lane), extra ?? stateTag(r)));
}

function list(rows) {
  const open = rows.filter((r) => !r.closed).sort(byOrder), closed = current.filter.closed ? rows.filter((r) => r.closed).sort(byClosed) : [];
  const all = [...open, ...closed];
  if (!all.length) return el("p", { class: "dim" }, rows.length ? "Every one is closed: tick \"closed too\" to see them."
    : current.data.rows.length ? "No tickets match." : current.data.canEdit ? "No tickets yet: + A TICKET makes the first." : "No tickets yet.");
  return el("div", {}, el("ul", { class: "tickets" }, all.slice(0, LIST_MOST).map((r) => row(r))),
    all.length > LIST_MOST && el("p", { class: "dim small" }, `${all.length - LIST_MOST} more: find one by its words or its lane.`));
}

function board(rows) {
  const { space: s } = current.data;
  const cols = s.states.map((st) => ({ st, items: rows.filter((r) => r.state === st.name) }))
    .filter((c) => c.items.length || c.st.phase === "open" && c.st.name === "ready" || c.st.phase === "doing");
  return el("div", { class: "board" }, cols.map(({ st, items }) => {
    const sorted = st.closed ? items.sort(byClosed) : items.sort(byOrder), shown = st.closed ? sorted.slice(0, DONE_MOST) : sorted;
    return el("section", { class: `column ph-${st.phase}` },
      el("h4", {}, st.title.toUpperCase(), el("small", { class: "dim" }, ` ${items.length}`)),
      el("ul", { class: "cards" }, shown.map((r) => el("li", {}, el("button", { class: "card", onclick: () => openTicket(r.id) },
        el("span", { class: "tid" }, r.id), el("span", { class: "ttl" }, inline(r.title)),
        el("small", { class: "dim" }, [r.lane && `lane ${r.lane}`, r.priority && r.priority !== "Normal" && r.priority,
          st.closed ? day(r.closedAt) : ago(r.updated)].filter(Boolean).join(" · ")))))),
      st.closed && items.length > shown.length && el("p", { class: "dim small" }, `and ${items.length - shown.length} before`));
  }));
}

function roadmap(rows) {
  const open = rows.filter((r) => !r.closed), done = rows.filter((r) => r.closed).sort(byClosed);
  const working = open.filter((r) => r.phase === "doing").sort((a, b) => b.updated.localeCompare(a.updated));
  const ready = open.filter((r) => r.state === "ready");
  const waiting = open.filter((r) => r.phase !== "doing" && r.state !== "ready");
  const lanes = [...new Set(ready.map((r) => r.lane ?? ""))].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
  const section = (title, items, empty) => [el("h3", {}, title), items.length ? el("ul", { class: "tickets" }, items.map((r) => row(r))) : el("p", { class: "dim" }, empty)];
  return el("div", { class: "roadmap" },
    el("div", { class: "project" }, el("b", {}, "SO FAR"), bar(done.length, rows.length),
      el("small", { class: "dim" }, `${done.length} of ${rows.length} closed${done[0] ? ` · the last ${ago(done[0].closedAt)}` : ""}`)),
    ...section("AT WORK", working, "Nothing in progress."),
    el("h3", {}, "NEXT, LANE BY LANE"),
    lanes.length ? el("div", { class: "next-lanes" }, lanes.map((l) => {
      const its = ready.filter((r) => (r.lane ?? "") === l).sort(byOrder);
      return el("section", {}, el("h4", {}, l ? `LANE ${l.toUpperCase()}` : "NO LANE YET", el("small", { class: "dim" }, ` ${its.length}`)),
        el("ul", { class: "tickets" }, its.slice(0, NEXT_MOST).map((r) => row(r, el("span", { class: "tag" }, r.order == null ? "–" : `#${r.order}`)))),
        its.length > NEXT_MOST && el("p", { class: "dim small" }, `and ${its.length - NEXT_MOST} after`));
    })) : el("p", { class: "dim" }, "Nothing ready."),
    ...section("WAITING", waiting.sort(byOrder), "Nothing waits."),
    ...section("LATELY DONE", done.slice(0, DONE_MOST), "Nothing closed yet."));
}

// ---- making: a ticket in a space of your own, and a space of your own ----------------------------------------------

function newTicket() {
  const { space: s } = current.data;
  const form = el("form", { class: "make-ticket" },
    el("h3", {}, `A NEW TICKET IN ${s.title.toUpperCase()}`),
    el("div", { class: "row-fields" },
      el("label", {}, "Kind ", el("select", { name: "kind" }, s.kinds.map((k) => el("option", { value: k.title }, k.title)))),
      el("label", {}, "Lane ", el("input", { name: "lane", list: "space-lanes", autocomplete: "off" })),
      el("label", {}, "Priority ", el("select", { name: "priority" }, ["Low", "Normal", "High", "Urgent"].map((p) => el("option", { value: p, selected: p === "Normal" }, p)))),
      el("label", {}, "Order ", el("input", { name: "order", type: "number", step: "any" }))),
    el("label", {}, "Title", el("input", { name: "title", required: true, maxlength: 200 })),
    el("label", {}, "What it is", el("textarea", { name: "description", rows: 5 })),
    el("datalist", { id: "space-lanes" }, ROLES.map((l) => el("option", { value: l }))),
    el("p", { class: "error", role: "alert" }),
    el("div", { class: "actions" }, el("button", { type: "button", onclick: () => { current.making = false; drawBody(); } }, "NOT NOW"),
      el("button", { class: "primary" }, "MAKE IT")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = form.querySelector("button.primary"), err = form.querySelector(".error");
    b.disabled = true; err.textContent = "";
    const v = Object.fromEntries(new FormData(form));
    try {
      const { item } = await api("POST", `/api/space/${encodeURIComponent(s.prefix)}/items`, v);
      current.making = false;
      await refresh();
      openTicket(item.id);
    } catch (x) { err.textContent = x.message; b.disabled = false; }
  });
  setTimeout(() => form.elements.title.focus(), 0);
  return form;
}

function openMakeSpace() {
  current = null;
  $("space-title").textContent = "A SPACE OF YOUR OWN";
  $("space-line").textContent = "A project, a part of your life, anything with tickets. Its tickets live in PRAXIS, here and on the always-on replica.";
  $("space-tabs").replaceChildren();
  $("space-tools").replaceChildren();
  $("space-full").hidden = true;   // nothing to open alone yet
  const form = el("form", { class: "make-space-form" },
    el("label", {}, "Its name", el("input", { name: "title", required: true, maxlength: 60, autocomplete: "off" })),
    el("label", {}, "Its prefix: two to six capitals, its tickets' ids begin with it (HOME-1)",
      el("input", { name: "prefix", required: true, maxlength: 6, autocomplete: "off", pattern: "[A-Za-z][A-Za-z0-9]{1,5}" })),
    el("label", { class: "check" }, el("input", { type: "checkbox", name: "public" }), "Public: anyone who reaches the site can read it"),
    el("p", { class: "error", role: "alert" }),
    el("div", { class: "actions" }, el("button", { class: "primary" }, "MAKE IT")));
  const f = form.elements;   // by name: a form's own .title and .prefix are something else
  f.title.addEventListener("input", () => {
    if (f.prefix.dataset.touched) return;
    // "The kitchen" -> KITC, "Open source work" -> OSW: a word's first letters, or each word's first
    const words = f.title.value.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(THE|A|AN|MY|OUR)$/.test(w));
    f.prefix.value = (words.length > 1 ? words.map((w) => w[0]).join("") : words[0] ?? "").replace(/^[0-9]+/, "").slice(0, 4);
  });
  f.prefix.addEventListener("input", () => { f.prefix.dataset.touched = "1"; f.prefix.value = f.prefix.value.toUpperCase(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = form.querySelector("button.primary"), err = form.querySelector(".error");
    b.disabled = true; err.textContent = "";
    try {
      const { space } = await api("POST", "/api/spaces", { title: f.title.value, prefix: f.prefix.value, reach: f.public.checked ? "public" : "home" });
      await load();
      openSpace(space.prefix, "list");
    } catch (x) { err.textContent = x.message; b.disabled = false; }
  });
  $("space-body").replaceChildren(form);
  showSpace("#space=new");
  setTimeout(() => f.title.focus(), 0);
}

/** a change was made (here, or on a ticket's page): read the spaces again, and the space open in the modal */
async function refresh() {
  await load();
  if (current?.prefix && $("space").open) {
    try { current.data = await api("GET", `/api/space/${encodeURIComponent(current.prefix)}`); drawSpace(); } catch { /* the modal keeps what it had */ }
  }
}

function fromHash() {
  const m = /^#space=([A-Z][A-Z0-9]{0,9})(?:&view=(list|board|roadmap))?$/.exec(location.hash);
  if (m) openSpace(m[1], m[2] ?? "list");
}

document.addEventListener("spaces-changed", refresh);
document.addEventListener("me", () => { load(); if (current?.prefix && $("space").open) openSpace(current.prefix, current.view); });
await load();
fromHash();
addEventListener("hashchange", fromHash);
setInterval(() => { if (document.visibilityState === "visible") load().catch(() => {}); }, 60 * 1000);
