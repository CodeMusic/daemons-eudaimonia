// EUDAIMONIA's front page: who is signed in, SIGN IN, the forced first password change, YOUR ACCOUNT (a daemon for an
// avatar) and the admin's ACCOUNTS -- all in modals over THE DASHBOARD's frame (C-439, C-436). No library.
const $ = (id) => document.getElementById(id);
const LANES = ["game", "story", "audio", "art", "app", "hub", "esp32", "pi-zero", "playground", "docs", "ops"];
let me = null, limited = false, groups = null;

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {},
                                body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(v.error || `The server said ${r.status}.`);
  return v;
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const sprite = (id, size = 40) => (id == null ? el("span", { class: "blank", "aria-hidden": "true" })
  : el("img", { src: `/sprite/${id}.png`, width: size, height: size, alt: "", loading: "lazy" }));
const daemonName = (id) => groups?.flatMap((g) => g.daemons).find((d) => d.id === id)?.name ?? null;
const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

function error(form, e) { form.querySelector(".error").textContent = e ? e.message || String(e) : ""; }
async function busy(form, fn) {
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  error(form, null);
  try { await fn(); } catch (e) { error(form, e); } finally { buttons.forEach((b) => (b.disabled = false)); }
}

// ---- who is here ---------------------------------------------------------------------------------------------------

async function refresh() {
  const r = await api("GET", "/api/me");
  me = r.account; limited = r.limited;
  $("signin-open").hidden = !!me;
  $("me").hidden = !me;
  if (me) {
    const img = $("me-avatar");
    img.hidden = me.avatar == null;
    if (me.avatar != null) img.src = `/sprite/${me.avatar}.png`;
    $("me-name").textContent = me.name.toUpperCase();
    $("admin-item").hidden = !me.admin;
  }
  if (me && limited) openChange(me.first);
}

$("signin-open").addEventListener("click", () => { $("signin-form").reset(); error($("signin-form"), null); $("signin").showModal(); });
$("signin-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f, async () => {
    await api("POST", "/api/signin", { name: f.name.value, password: f.password.value });
    $("signin").close();
    await refresh();
  });
});

$("me-open").addEventListener("click", (ev) => { ev.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
document.addEventListener("click", () => ($("menu").hidden = true));
$("signout").addEventListener("click", async () => { await api("POST", "/api/signout"); await refresh(); });
for (const b of document.querySelectorAll("[data-open]")) b.addEventListener("click", () => (b.dataset.open === "admin" ? openAdmin() : openAccount()));
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => b.closest("dialog").close());

// ---- a new password ------------------------------------------------------------------------------------------------

function openChange(first) {
  const d = $("change"), f = $("change-form");
  f.reset(); error(f, null);
  $("change-why").textContent = limited
    ? first ? "This is the first password, the one every new site starts with. Choose your own before anything else."
            : "This password was chosen for you. Choose your own before anything else."
    : "Choose a new password. Every other place you are signed in is signed out.";
  $("change-out").hidden = !limited;
  d.oncancel = (ev) => { if (limited) ev.preventDefault(); };   // a limited session can do nothing else
  if (!d.open) d.showModal();
}
$("change-out").addEventListener("click", async () => { await api("POST", "/api/signout"); $("change").close(); await refresh(); });
$("change-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f, async () => {
    if (f.new.value !== f.again.value) throw new Error("The two new passwords are not the same.");
    await api("POST", "/api/password", { old: f.old.value, new: f.new.value });
    $("change").close();
    await refresh();
  });
});

// ---- the daemons, grouped by type ----------------------------------------------------------------------------------

async function loadGroups() { if (!groups) groups = (await api("GET", "/api/avatars")).groups; return groups; }

function picker(box, chosen, onPick) {
  box.replaceChildren();
  const search = el("input", { type: "search", placeholder: "Find a daemon by name", "aria-label": "Find a daemon by name" });
  // a pick moves the mark and nothing else: the search and the scroll stay where they are
  const pick = async (id) => {
    try { await onPick(id); } catch (e) { alert(e.message); return; }
    for (const b of box.querySelectorAll("[data-id]")) b.setAttribute("aria-pressed", String(Number(b.dataset.id) === id));
    none.setAttribute("aria-pressed", String(id == null));
  };
  const none = el("button", { class: "none", "aria-pressed": String(chosen == null), onclick: () => pick(null) }, "NO DAEMON");
  box.append(search, none);
  const sections = groups.map((g) => {
    const grid = el("div", { class: "grid" }, g.daemons.map((d) =>
      el("button", { class: "daemon", title: `${d.name} · ${d.types.join(" / ")} · ${d.category}`, "aria-pressed": String(d.id === chosen),
                     "data-name": d.name.toLowerCase(), "data-id": d.id, onclick: () => pick(d.id) },
         el("img", { src: `/sprite/${d.id}.png`, width: 64, height: 64, alt: "", loading: "lazy" }), el("span", {}, d.name))));
    const s = el("section", { class: "group" }, el("h4", {}, `${g.type} · ${g.daemons.length}`), grid);
    s.style.setProperty("--type", g.colour);
    return s;
  });
  box.append(...sections);
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const s of sections) {
      let any = false;
      for (const b of s.querySelectorAll(".daemon")) { const hit = !q || b.dataset.name.includes(q); b.hidden = !hit; any ||= hit; }
      s.hidden = !any;
    }
  });
}

async function openAccount() {
  await loadGroups();
  const line = () => {
    const name = daemonName(me.avatar);
    $("account-line").textContent = `${me.name.toUpperCase()} · ${me.kind === "agent" ? "AN AGENT" : "A PERSON"}${me.admin ? " · AN ADMIN" : ""}`
      + (name ? ` · ${name}` : " · no daemon yet");
  };
  line();
  picker($("account-picker"), me.avatar, async (id) => {
    me = (await api("POST", "/api/avatar", { avatar: id })).account;
    await refresh(); line();
  });
  $("account-password").hidden = me.kind !== "person";
  $("account").showModal();
}
$("account-change").addEventListener("click", () => openChange(false));

// ---- the admin's ACCOUNTS ------------------------------------------------------------------------------------------

async function openAdmin() {
  await loadGroups();
  $("lanes-list").replaceChildren(...LANES.map((l) => el("option", { value: l })));
  await drawAccounts();
  await drawEgg();
  $("admin").showModal();
}

async function drawAccounts() {
  const { accounts } = await api("GET", "/api/accounts");
  const row = (a) => {
    const act = (action, extra) => async () => {
      try {
        const r = await api("POST", `/api/accounts/${a.id}`, { action, ...extra });
        if (r.secret) showSecret(a, r.secret);
        await drawAccounts();
        if (a.id === me.id) await refresh();
      } catch (e) { alert(e.message); }
    };
    const tags = [a.admin && el("span", { class: "tag" }, "ADMIN"), a.mustChange && el("span", { class: "tag warn" }, "PASSWORD TO CHANGE"),
                  a.disabled && el("span", { class: "tag off" }, "CLOSED"), a.id === me.id && el("span", { class: "tag" }, "YOU")];
    const line = [daemonName(a.avatar) ?? "no daemon", a.kind === "agent" && a.key ? `key ${a.key}…` : null, `seen ${when(a.seen)}`]
      .filter(Boolean).join(" · ");
    return el("li", { class: "row" }, sprite(a.avatar),
      el("div", { class: "grow" }, el("b", {}, a.name.toUpperCase()), ...tags, el("small", {}, line)),
      el("button", { onclick: () => openPick(a) }, "DAEMON"),
      el("button", { onclick: act("reset") }, a.kind === "agent" ? "NEW KEY" : "NEW PASSWORD"),
      a.kind === "person" && a.id !== me.id && el("button", { onclick: act(a.admin ? "member" : "admin") }, a.admin ? "NOT ADMIN" : "MAKE ADMIN"),
      a.id !== me.id && el("button", { onclick: act(a.disabled ? "enable" : "disable") }, a.disabled ? "OPEN" : "CLOSE"));
  };
  $("people").replaceChildren(...accounts.filter((a) => a.kind === "person").map(row));
  const agents = accounts.filter((a) => a.kind === "agent");
  $("agents").replaceChildren(...(agents.length ? agents.map(row) : [el("li", { class: "dim" }, "None yet.")]));
}

function openPick(a) {
  $("pick-title").textContent = `A DAEMON FOR ${a.name.toUpperCase()}`;
  picker($("pick-picker"), a.avatar, async (id) => {
    await api("POST", `/api/accounts/${a.id}`, { action: "avatar", avatar: id });
    $("pick").close();
    await drawAccounts();
    if (a.id === me.id) await refresh();
  });
  $("pick").showModal();
}

const makeForm = $("make-form");
makeForm.addEventListener("change", () => { $("make-admin").hidden = makeForm.kind.value !== "person"; });
makeForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  busy(makeForm, async () => {
    const kind = makeForm.kind.value;
    const r = await api("POST", "/api/accounts", { name: makeForm.name.value, kind, admin: kind === "person" && makeForm.admin.checked });
    makeForm.reset(); $("make-admin").hidden = false;
    showSecret(r.account, r.secret);
    await drawAccounts();
  });
});

async function drawEgg() {
  const e = await api("GET", "/api/egg");
  $("egg-line").textContent = e.set ? `Its password was last set ${when(e.changed)}. Set a new one here.`
                                    : "No password is set, so the easter egg stays shut. Set one here.";
}
$("egg-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f, async () => { await api("POST", "/api/egg", { password: f.password.value }); f.reset(); await drawEgg(); });
});

function showSecret(a, secret) {
  $("secret-line").textContent = a.kind === "agent"
    ? `${a.name.toUpperCase()}'s key. The agent sends it as: Authorization: Bearer <key>`
    : `${a.name.toUpperCase()}'s one-time password. They choose their own the first time they sign in.`;
  $("secret-value").textContent = secret;
  $("secret-copy").textContent = "COPY";
  $("secret").showModal();
}
$("secret-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("secret-value").textContent); $("secret-copy").textContent = "COPIED"; }
  catch { getSelection().selectAllChildren($("secret-value")); $("secret-copy").textContent = "SELECTED: COPY IT"; }
});

refresh().catch((e) => console.error(e));
