// E-13: the eleven towns' palettes, as tools/towns.py writes them into web/towns.json -- each with the page's darks, an
// accent dark text reads on, and the colours it was read from. (The page's classifier is in web/settings.js.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { towns } = JSON.parse(readFileSync(new URL("../web/towns.json", import.meta.url), "utf8"));
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
                             return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("the game's eleven towns, each once", () => {
  assert.deepEqual(towns.map((t: { key: string }) => t.key), ["BLANCHE", "CALLOW", "SLATE", "DOLDRUM", "ARDOR", "HALFTONE",
    "VERDIGRIS", "LURID", "BRAZEN", "QUICKSILVER", "UMBRA"]);
});

test("each town's palette reads: dark text on its accent, the page's light text on its darks", () => {
  for (const t of towns) {
    for (const k of ["bg", "panel", "raised", "line", "accent", "second", "ground"]) assert.match(t[k], /^#[0-9a-f]{6}$/, `${t.key}.${k}`);
    assert.ok(contrast(t.accent, "#111111") >= 7, `${t.key}: dark text on its accent`);
    assert.ok(contrast(t.panel, "#e8e6e3") >= 12, `${t.key}: the page's text on its panel`);
    assert.ok(contrast(t.accent, t.bg) >= 4.5, `${t.key}: its accent on its ground`);
    assert.ok(lum(t.bg) < lum(t.panel) && lum(t.panel) < lum(t.raised) && lum(t.raised) < lum(t.line), `${t.key}: darks in order`);
  }
});

test("HALFTONE stays grey (the design bible)", () => {
  const h = towns.find((t: { key: string }) => t.key === "HALFTONE");
  const [r, g, b] = rgb(h.panel);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 3);
});
