// SETTINGS: what this browser chooses for itself, kept in it (localStorage), for anyone, signed in or not. Every word DRAFT.
//   TOWN COLOURS (E-13): the full project view wears a town's palette -- the game's eleven towns, each read from its own
//     tileset (web/towns.json, written by tools/towns.py). Each space's town is picked by itself (townAuto: a mapping
//     for the three mirrored projects, then the words of its title, then its prefix), or chosen here instead.
//   THE EASTER EGG (E-14): its made cart played in the page, or downloaded to play in your own emulator.
import { $, api, el } from "./ui.js";

const KEY = "eudaimonia-settings";
let towns = [];
const ready = fetch("/towns.json").then((r) => (r.ok ? r.json() : { towns: [] })).then((d) => { towns = d.towns ?? []; }).catch(() => {});

function load() { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") || {}; } catch { return {}; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* a private window keeps nothing */ } }
export const setting = (name) => load()[name];
export function setSetting(name, value) {
  const v = load();
  if (value == null) delete v[name]; else v[name] = value;
  save(v);
  document.dispatchEvent(new CustomEvent("settings-changed", { detail: name }));
}

// ---- TOWN COLOURS (E-13) --------------------------------------------------------------------------------------------

/** the three projects mirrored from Redmine, each in the town that suits it (DRAFT): the game in the town it begins
 *  in, the companion in the SCHOOL's city, EUDAIMONIA in LURID, whose WALLED GARDEN is a platform */
const MAPPED = { T: "BLANCHE", C: "CALLOW", E: "LURID" };
/** a space's words, each pointing at a town (DRAFT): what the town is in the game */
const WORDS = [
  ["SLATE", /\b(journal|diary|log|record|notes?|archive|history|minutes)\b/],          // a record that reads the same twice
  ["DOLDRUM", /\b(dreams?|sleep|rest|calm|sea|sail|boat|holiday|vacation)\b/],
  ["CALLOW", /\b(learn(ing)?|school|study|course|class|lessons?|reading|books?|language)\b/],   // the SCHOOL's city
  ["QUICKSILVER", /\b(recipes?|food|cook(ing)?|kitchen|bak(e|ing)|chem(istry)?|science|lab|experiments?)\b/],
  ["ARDOR", /\b(fitness|health|run(ning)?|gym|sport|love|passion|training|body)\b/],
  ["HALFTONE", /\b(memor(y|ies|ial)|grief|quiet|meditat(e|ion)|spirit|faith|mindful(ness)?)\b/],
  ["VERDIGRIS", /\b(shop(ping)?|money|budget|financ(e|es)|store|buy|bills|accounts)\b/],    // its DEPT. STORE
  ["LURID", /\b(garden|play|games?|sandbox|hobb(y|ies)|art|music|craft)\b/],              // the WALLED GARDEN
  ["BRAZEN", /\b(work|job|office|business|company|career|clients?|corp(orate)?)\b/],       // CORPUS's tower
  ["UMBRA", /\b(goals?|ambitions?|challenges?|climb|travel|trips?|quest|summit)\b/],
  ["BLANCHE", /\b(life|home|house|family|chores|everyday|personal)\b/],
];

/** the town a space wears unless one is chosen: its mapping, its words, else its prefix (always the same one) */
export function townAuto(space) {
  if (space.mirrored && MAPPED[space.prefix]) return MAPPED[space.prefix];
  const words = String(space.title ?? "").toLowerCase();
  for (const [town, re] of WORDS) if (re.test(words)) return town;
  let h = 0;
  for (const ch of String(space.prefix ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const keys = towns.length ? towns.map((t) => t.key) : WORDS.map(([t]) => t);
  return keys[h % keys.length];
}
const chosen = () => setting("towns") ?? {};
export const townChosen = (prefix) => chosen()[prefix] ?? null;
export const townOf = (space) => towns.find((t) => t.key === (townChosen(space.prefix) ?? townAuto(space))) ?? null;

const VARS = ["bg", "panel", "raised", "line", "accent"];
/** a dialog dressed in a town's palette, or undressed (null) */
export function wear(node, town) {
  for (const v of VARS) {
    if (town) node.style.setProperty(`--${v}`, town[v]); else node.style.removeProperty(`--${v}`);
  }
  node.dataset.town = town?.key ?? "";
}
export const townsReady = ready;

function swatch(town) {
  return el("span", { class: "swatch", "aria-hidden": "true" },
    ...[town.bg, town.panel, town.accent, town.second].map((c) => { const s = el("i", {}); s.style.background = c; return s; }));
}

// ---- the dialog ---------------------------------------------------------------------------------------------------

async function drawTowns() {
  await ready;
  const box = $("settings-towns");
  let spaces = [];
  try { ({ spaces } = await api("GET", "/api/spaces")); } catch (e) { box.replaceChildren(el("p", { class: "error" }, e.message)); return; }
  if (!towns.length) { box.replaceChildren(el("p", { class: "dim" }, "No towns here: web/towns.json is missing.")); return; }
  box.replaceChildren(el("ul", { class: "town-picks" }, spaces.map((s) => {
    const auto = townAuto(s), pick = el("select", { "aria-label": `${s.title}'s town` },
      el("option", { value: "" }, `BY ITSELF: ${auto}`),
      towns.map((t) => el("option", { value: t.key, selected: townChosen(s.prefix) === t.key }, t.name)));
    const shown = el("span", {}, swatch(townOf(s)));
    pick.addEventListener("change", () => {
      const v = { ...chosen() };
      if (pick.value) v[s.prefix] = pick.value; else delete v[s.prefix];
      setSetting("towns", Object.keys(v).length ? v : null);
      shown.replaceChildren(swatch(townOf(s)));
    });
    return el("li", {}, el("span", { class: "town-space" }, el("b", {}, s.title), el("small", { class: "dim" }, ` ${s.prefix}-`)), shown, pick);
  })));
}

function drawEgg() {
  const box = $("settings-egg"), now = setting("eggPlay") ?? "page";
  const choice = (value, title, line) => el("label", { class: "play-way" },
    el("input", { type: "radio", name: "egg-play", value, checked: now === value,
                  onchange: () => setSetting("eggPlay", value === "page" ? null : value) }),
    el("span", {}, el("b", {}, title), el("small", { class: "dim" }, line)));
  box.replaceChildren(
    choice("page", "PLAY IT HERE", "In this page, in the playground's player, its saves kept in this browser."),
    choice("download", "DOWNLOAD IT", "As a .gba file, to play in your own emulator on your own computer."));
}

export async function openSettings(section) {
  drawEgg();
  $("settings").showModal();
  await drawTowns();
  if (section) $(`settings-${section}`)?.closest("section")?.scrollIntoView({ block: "start" });
}
$("settings-open").addEventListener("click", () => openSettings());
document.addEventListener("open-settings", (e) => openSettings(e.detail));
