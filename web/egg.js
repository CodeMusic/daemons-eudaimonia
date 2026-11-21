// THE EASTER EGG (C-437, the user 2026-11-20): your cart becomes a DAEMONS cart. Every word here is a DRAFT.
//
// A dim cart in THE RELEASES' corner opens it. Before the first cart choice, it asks for its password (the door). Then:
// which cart do you own? FIRERED, LEAFGREEN or BOTH, drawn as carts. The others leave and the chosen turn into CONTENT
// and CONTEXT; a cookie remembers them, so the next visit opens on your carts, with a line to forget them and start
// again. A cart plays in the playground's mGBA player, framed over this page, made one of two ways:
//   YOUR OWN CART  -- your FireRed or LeafGreen file, patched here by the release's BPS patch: nothing of it is sent.
//   THE RELEASE'S  -- the release's own ROM, with the password and a tick that these are backups of carts you own.
// Either way the ROM reaches the player by postMessage, to the playground's page on this same host (site/index.html),
// framed here rather than in a new tab: a webview or a pop-up blocker opens a new tab in this one's place, or not at all.
import { $, api, el } from "./ui.js";
import { applyBps, crc32Hex } from "./bps.js";

const CARTS = "eudaimonia-carts", YEAR = 400 * 24 * 60 * 60;   // a browser keeps a cookie 400 days at most
const ROM_MOST = 32 * 1024 * 1024;
const SVG = "http://www.w3.org/2000/svg";
const quick = matchMedia("(prefers-reduced-motion: reduce)");
const wait = (ms) => new Promise((r) => setTimeout(r, quick.matches ? 0 : ms));
const breathe = () => new Promise((r) => setTimeout(r, 30));   // lets the page draw its status line; a hidden tab still runs a timer
let state = null;      // GET /api/egg/carts: the release, the carts and their patches, the pass, the player's port
let made = {};         // edition -> { bytes, how }: a ROM made ready this visit

// ---- the cookie ----------------------------------------------------------------------------------------------------
function remembered() {
  const v = document.cookie.split("; ").find((c) => c.startsWith(CARTS + "="))?.slice(CARTS.length + 1) ?? "";
  return v.split(".").filter((e) => e === "content" || e === "context");
}
const remember = (eds) => (document.cookie = `${CARTS}=${eds.join(".")}; Max-Age=${YEAR}; Path=/; SameSite=Strict`);
const forget = () => (document.cookie = `${CARTS}=; Max-Age=0; Path=/; SameSite=Strict`);

// ---- a cart, drawn: a shell, its notch and grip, a label that turns from the retail cart's to ours -----------------
const WAS = { content: "firered", context: "leafgreen" };
function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
function cart(edition, turned) {
  const word = (y, size, text, cls = "", fit = 0) => svg("text", { x: 80, y, class: `word ${cls}`, "font-size": size,
    ...(fit ? { textLength: fit, lengthAdjust: "spacingAndGlyphs" } : {}) }, text);
  const motif = edition === "content"
    // a flame with two tips, and its heart
    ? svg("g", { class: "ink" }, svg("path", { d: "M80 57 c-9 0 -14 -6 -12 -13 c1 -4 4 -6 5 -11 c2 3 3 5 5 6 c0 -6 3 -11 8 -14 c-1 7 7 11 7 19 c0 8 -6 13 -13 13 z" }),
        svg("path", { class: "heart", d: "M80 55 c-4 0 -6 -3 -5 -6 c1 -2 2 -3 3 -6 c2 3 6 5 6 8 c0 3 -2 4 -4 4 z" }))
    // a leaf, and its vein
    : svg("g", { class: "ink" }, svg("path", { d: "M62 56 C64 34 86 26 100 28 C98 44 84 58 62 56 Z" }),
        svg("path", { class: "vein", d: "M64 54 L96 31" }));
  const face = svg("g", { class: "face" },
    svg("rect", { class: "label", x: 14, y: 16, width: 132, height: 76, rx: 5 }),
    svg("g", { class: "was" }, motif, word(80, 17, edition === "content" ? "FIRERED" : "LEAFGREEN", "ink")),
    svg("g", { class: "is" }, word(52, 25, "DAEMONS", "heavy", 112), svg("rect", { class: "rule", x: 34, y: 59, width: 92, height: 2 }),
        word(78, 13, edition === "content" ? "CONTENT" : "CONTEXT", "spaced")));
  return svg("svg", { viewBox: "0 0 160 112", class: `cart ${turned ? edition + " turned" : WAS[edition]}`, "aria-hidden": "true",
                      "data-edition": edition },
    svg("rect", { class: "shell", x: 4, y: 4, width: 152, height: 104, rx: 10 }),
    svg("rect", { class: "notch", x: 58, y: 4, width: 44, height: 7, rx: 2 }),
    ...[0, 1, 2, 3, 4].map((i) => svg("rect", { class: "notch", x: 54 + i * 11, y: 98, width: 7, height: 4, rx: 1.5 })),
    face);
}
/** The label flips edge-on, comes back as ours; the shell's colour goes with it. */
async function turn(svgEl) {
  svgEl.classList.add("flipping");
  await wait(320);
  svgEl.classList.remove(WAS[svgEl.dataset.edition]);
  svgEl.classList.add(svgEl.dataset.edition, "turned");
  svgEl.classList.remove("flipping");
  await wait(420);
}

// ---- the views -----------------------------------------------------------------------------------------------------
function view(name, title) {
  for (const v of ["door", "stage", "play"]) $(`egg-${v}`).hidden = v !== name;
  $("egg-title").textContent = title;
}

async function openEgg() {
  try { state = await api("GET", "/api/egg/carts"); }
  catch (e) { state = { release: null, carts: [], pass: false, player: 4740 }; console.error(e); }
  const mine = remembered();
  if (mine.length) shelf(mine);
  else if (state.pass) ask();
  else door();
  if (!$("egg").open) $("egg").showModal();
}

function door() {
  view("door", "SOMETHING IS HERE");
  const f = $("egg-door-form");
  f.reset(); f.querySelector(".error").textContent = "";
}
$("egg-door-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, b = f.querySelector("button");
  b.disabled = true; f.querySelector(".error").textContent = "";
  try { await api("POST", "/api/egg/open", { password: f.password.value }); state.pass = true; ask(); }
  catch (e) { f.querySelector(".error").textContent = e.message; }
  finally { b.disabled = false; }
});

function ask() {
  view("stage", "WHICH CART DO YOU OWN?");
  $("egg-stage-line").textContent = "Choose, and see what it becomes.";
  $("egg-again-line").hidden = true;
  const choice = (eds, label) => el("button", { class: `choice${eds.length > 1 ? " both" : ""}`, "data-eds": eds.join("."), onclick: () => chose(eds) },
    el("span", { class: "carts" }, eds.map((e) => cart(e, false))), el("span", { class: "caption" }, label));
  $("egg-stage-carts").replaceChildren(choice(["content"], "FIRERED"), choice(["context"], "LEAFGREEN"),
                                       choice(["content", "context"], "BOTH"));
}

async function chose(eds) {
  const stage = $("egg-stage-carts"), choices = [...stage.children];
  choices.forEach((c) => (c.disabled = true));
  remember(eds);
  const kept = choices.find((c) => c.dataset.eds === eds.join("."));
  for (const c of choices) if (c !== kept) c.classList.add("leaving");
  $("egg-stage-line").textContent = "";
  await wait(520);
  for (const c of choices) if (c !== kept) c.hidden = true;
  kept.classList.add("kept");
  kept.querySelector(".caption").textContent = "";
  await wait(200);
  for (const s of kept.querySelectorAll(".cart")) await turn(s);
  await wait(500);
  shelf(eds);
}

function shelf(eds) {
  view("stage", eds.length > 1 ? "YOUR CARTS" : "YOUR CART");
  $("egg-stage-line").textContent = eds.length > 1 ? "Choose one to play." : "Choose it to play.";
  $("egg-again-line").hidden = false;
  $("egg-stage-carts").replaceChildren(...eds.map((e) => {
    const c = state.carts.find((x) => x.edition === e) ?? { name: e.toUpperCase(), cart: WAS[e].toUpperCase() };
    return el("button", { class: "choice mine", onclick: () => play(e) },
      el("span", { class: "carts" }, cart(e, true)), el("span", { class: "caption" }, c.name, el("small", {}, `your ${c.cart}`)));
  }));
}
$("egg-again").addEventListener("click", () => { forget(); made = {}; state.pass ? ask() : door(); });

// ---- playing a cart ------------------------------------------------------------------------------------------------
let playing = null;
function play(edition) {
  playing = state.carts.find((c) => c.edition === edition);
  if (!playing || !state.release) {
    view("play", "NOT YET");
    $("egg-play-line").textContent = "There is no release here to play yet.";
    $("egg-ways").hidden = true;
    return;
  }
  view("play", playing.name);
  $("egg-ways").hidden = false;
  $("egg-play-cart").replaceChildren(cart(edition, true));
  $("egg-play-line").textContent = `${playing.name}, as of ${state.release}. Made from your ${playing.cart}, one of two ways.`;
  const fits = playing.patches.map((p) => p.fits).join(" or ") || "no cart yet: this release has no patches";
  $("egg-own-line").textContent = `The file of your ${playing.cart}, as dumped from the cart. It is checked and made into ` +
    `${playing.name} here, in this browser: nothing of it is sent anywhere. It fits ${fits}.`;
  $("egg-own-pick").querySelector("span").textContent = `Choose your ${playing.cart}'s file`;
  $("egg-file").value = "";
  const ready = made[edition]?.how === "own";
  $("egg-own-status").textContent = ready ? made[edition].said : "";
  $("egg-own-play").disabled = !ready;
  const f = $("egg-release-form");
  f.reset(); f.querySelector(".error").textContent = "";
  $("egg-release-line").textContent = `${state.release}'s own ${playing.name}, sent from this machine.`;
  $("egg-release-pw").hidden = state.pass;
  f.password.required = !state.pass;
}
$("egg-back").addEventListener("click", () => shelf(remembered()));

$("egg-file").addEventListener("change", async (ev) => {
  const file = ev.target.files[0], ed = playing.edition, say = (t) => ($("egg-own-status").textContent = t);
  $("egg-own-play").disabled = true;
  delete made[ed];
  if (!file) return say("");
  try {
    const size = file.size < 1048576 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1048576).toFixed(1)} MB`;
    if (file.size > ROM_MOST || file.size < 1048576) throw new Error(`That file is ${size}: a cart's is 16 MB.`);
    say("Reading it…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await breathe();
    const crc = crc32Hex(bytes);
    const already = playing.patches.find((p) => p.target === crc);
    if (already) {
      made[ed] = { bytes, how: "own", said: `This is ${playing.name} already, as ${state.release} made it: it plays as it is.` };
    } else {
      const fit = playing.patches.find((p) => p.source === crc);
      if (!fit) {
        const other = state.carts.find((c) => c.edition !== ed && c.patches.some((p) => p.source === crc));
        throw new Error(other ? `That is your ${other.cart}'s file: ${playing.name} is made from your ${playing.cart}, and your ${other.cart} becomes ${other.name}.`
          : `That isn't a ${playing.game} this patch knows. It fits ${playing.patches.map((p) => p.fits).join(" or ")}, as dumped from the cart and unchanged.`);
      }
      say(`Your ${fit.fits}. Fetching the patch…`);
      const r = await fetch(`/egg/patch/${encodeURIComponent(state.release)}/${encodeURIComponent(fit.file)}`);
      if (!r.ok) throw new Error(`The patch didn't come (${r.status}).`);
      const patch = new Uint8Array(await r.arrayBuffer());
      say(`Your ${fit.fits}. Making it into ${playing.name}…`);
      await breathe();
      made[ed] = { bytes: applyBps(bytes, patch), how: "own", said: `Ready: your ${fit.fits}, made into ${playing.name} (${state.release}).` };
    }
    say(made[ed].said);
    $("egg-own-play").disabled = false;
  } catch (e) {
    say(e.message.replace(/^[a-z]/, (c) => c.toUpperCase()));
  }
});
$("egg-own-play").addEventListener("click", () => {
  const m = made[playing.edition];
  if (m) playIn(playing, Promise.resolve(m.bytes), "own", (e) => ($("egg-own-status").textContent = e));
});

$("egg-release-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, err = (t) => (f.querySelector(".error").textContent = t);
  err("");
  const cartNow = playing;
  playIn(cartNow, (async () => {
    if (!state.pass) { await api("POST", "/api/egg/open", { password: f.password.value }); state.pass = true; $("egg-release-pw").hidden = true; }
    const r = await fetch("/api/egg/rom", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
                                            body: JSON.stringify({ edition: cartNow.edition, agreed: f.agreed.checked }) });
    if (!r.ok) {
      const v = await r.json().catch(() => ({}));
      if (r.status === 401) { state.pass = false; $("egg-release-pw").hidden = false; f.password.required = true; }
      throw new Error(v.error || `The server said ${r.status}.`);
    }
    return new Uint8Array(await r.arrayBuffer());
  })(), "release", err);
});

// ---- the player: the playground's page, framed over this one ------------------------------------------------------
let player = null;     // { origin, frame, closing } while it is open
const playerOrigin = () => `${location.protocol}//${location.hostname.includes(":") ? `[${location.hostname}]` : location.hostname}:${state.player}`;

/** Frames the playground's page and hands it the ROM once it says it is ready -- to its origin alone. */
function playIn(c, bytes, how, err) {
  const origin = playerOrigin();
  const frame = el("iframe", { title: "The playground's player", src: `${origin}/#from=${encodeURIComponent(location.origin)}`,
    allow: "fullscreen; gamepad; autoplay",
    sandbox: "allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox" });
  $("egg-player-what").textContent = `${c.name} · ${how === "own" ? "your own cart" : "your cart's backup"}`;
  $("egg-player-wait").textContent = how === "own" ? "Opening the player…" : `Fetching ${c.name} and opening the player…`;
  $("egg-player-wait").hidden = false;
  $("egg-player-frame").replaceChildren(frame);
  player = { origin, frame, closing: false };
  let ready = false, rom = null, sent = false;
  const send = () => {
    if (sent || !ready || !rom || player?.frame !== frame) return;
    sent = true;
    frame.contentWindow.postMessage({ eudaimonia: "cart", edition: c.edition, release: state.release, own: how === "own", rom }, origin);
    $("egg-player-wait").hidden = true;
  };
  player.heard = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin) return;
    if (e.data?.eudaimonia === "ready") { ready = true; send(); }
    if (e.data?.eudaimonia === "close") closePlayer(true);
    if (e.data?.eudaimonia === "kept") player.kept?.();
  };
  addEventListener("message", player.heard);
  player.give = setTimeout(() => { if (!ready) $("egg-player-wait").textContent = `The playground didn't answer at ${origin}: is it running?`; }, 20000);
  $("egg-player").showModal();
  bytes.then((b) => { rom = b; send(); }, (e) => { closePlayer(true); err(e.message); });
}

/** Asks the player to keep the game's save first (it keeps it every five seconds anyway), then closes it. */
async function closePlayer(now = false) {
  if (!player || player.closing) return;
  player.closing = true;
  if (!now) await new Promise((r) => { player.kept = r; player.frame.contentWindow?.postMessage({ eudaimonia: "keep" }, player.origin); setTimeout(r, 3000); });
  removeEventListener("message", player.heard);
  clearTimeout(player.give);
  $("egg-player-frame").replaceChildren();
  player = null;
  $("egg-player").close();
}
$("egg-player-close").addEventListener("click", () => closePlayer());
$("egg-player").addEventListener("cancel", (ev) => { ev.preventDefault(); closePlayer(); });

$("egg-spot").addEventListener("click", openEgg);
