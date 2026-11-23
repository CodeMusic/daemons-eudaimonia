#!/usr/bin/env python3
"""E-13: each of the game's eleven towns as a palette, for the full project view (the user, 2026-11-22).

Read from the town's own tileset in DAEMONS' engine (engineGba/data/tilesets/secondary/<town>/) -- redrawn by DAEMONS,
not Nintendo's -- weighted by how much of the town each colour covers: every metatile's tiles that belong to the town's
tileset, each pixel counted in the palette its metatile names. From that: the GROUND (the colour that covers most, whose
hue tints the page's darks), the ACCENT (the most-covering vivid colour, lifted until dark text reads on it) and a
SECOND (the next vivid colour of another hue). Only these few colours are written, never a tile.

    python3 tools/towns.py            report what would change in web/towns.json
    python3 tools/towns.py --write    write it

DAEMONS is beside this repository (../DAEMONS, or $DAEMONS_ROOT); its engine is engineGba there.
"""
import colorsys
import collections
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAEMONS = Path(os.environ.get("DAEMONS_ROOT") or ROOT.parent / "DAEMONS")
SECONDARY = DAEMONS / "engineGba" / "data" / "tilesets" / "secondary"
OUT = ROOT / "web" / "towns.json"

# the tileset each town is drawn from, and its name in the game (DAEMONS' regions.json), in the order the game meets them
TOWNS = [
    ("BLANCHE", "BLANCHE TOWN", "pallet_town"), ("CALLOW", "CALLOW CITY", "viridian_city"),
    ("SLATE", "SLATE CITY", "pewter_city"), ("DOLDRUM", "DOLDRUM CITY", "cerulean_city"),
    ("ARDOR", "ARDOR CITY", "vermilion_city"), ("HALFTONE", "HALFTONE TOWN", "lavender_town"),
    ("VERDIGRIS", "VERDIGRIS CITY", "celadon_city"), ("LURID", "LURID CITY", "fuchsia_city"),
    ("BRAZEN", "BRAZEN CITY", "saffron_city"), ("QUICKSILVER", "QUICKSILVER IS.", "cinnabar_island"),
    ("UMBRA", "UMBRA PLATEAU", "indigo_plateau"),
]
PRIMARY_TILES = 640           # FireRed's primary tileset holds tiles 0-639; a secondary one's begin here
SECONDARY_PALS = range(7, 13)  # and palettes 7-12 are the secondary tileset's


def hexed(c):
    return "#%02x%02x%02x" % tuple(round(max(0, min(255, v))) for v in c)


def hsv(c):
    return colorsys.rgb_to_hsv(*(v / 255 for v in c))


def from_hsv(h, s, v):
    return tuple(x * 255 for x in colorsys.hsv_to_rgb(h, s, v))


def luminance(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def palette(p):
    return [tuple(map(int, line.split())) for line in p.read_text().split("\n")[3:19] if line.strip()]


def coverage(tileset):
    """every colour of the town's own tiles, by how many pixels of its metatiles it covers"""
    tiles = (tileset / "tiles.4bpp").read_bytes()
    pals = {i: palette(tileset / "palettes" / f"{i:02d}.pal") for i in SECONDARY_PALS
            if (tileset / "palettes" / f"{i:02d}.pal").exists()}
    hist = collections.Counter()
    for (entry,) in struct.iter_unpack("<H", (tileset / "metatiles.bin").read_bytes()):
        tile, pal = entry & 0x3FF, entry >> 12
        off = (tile - PRIMARY_TILES) * 32
        if tile < PRIMARY_TILES or pal not in pals or off + 32 > len(tiles):
            continue
        for byte in tiles[off:off + 32]:
            for ix in (byte & 15, byte >> 4):
                if ix and ix < len(pals[pal]):   # index 0 is see-through
                    hist[pals[pal][ix]] += 1
    return hist


def hue_apart(a, b):
    d = abs(a - b)
    return min(d, 1 - d)


def scheme(hist):
    total = sum(hist.values())
    ranked = hist.most_common()
    ground = ranked[0][0]
    # vivid: saturated and bright enough to be a colour, weighted by how much of the town it covers
    vivid = sorted(((n * (0.4 + hsv(c)[1]), c) for c, n in ranked if hsv(c)[1] >= 0.22 and hsv(c)[2] >= 0.45), reverse=True)
    accent = vivid[0][1] if vivid else max(ranked[:6], key=lambda x: hsv(x[0])[2])[0]
    second = next((c for _, c in vivid[1:] if hue_apart(hsv(c)[0], hsv(accent)[0]) > 0.08), None)
    if second is None:
        second = next((c for c, _ in ranked if c != accent and abs(hsv(c)[2] - hsv(accent)[2]) > 0.15), accent)
    # the page's darks take the ground's hue, a little of its saturation: a grey town stays grey (HALFTONE)
    h, s, _ = hsv(ground)
    tint = min(s, 0.6) * 0.85
    darks = {k: hexed(from_hsv(h, tint, v)) for k, v in (("bg", 0.085), ("panel", 0.13), ("raised", 0.175), ("line", 0.28))}
    # the accent carries dark text on it (a primary button): lift it until that reads
    ah, as_, av = hsv(accent)
    lifted = accent
    while contrast(lifted, (17, 17, 17)) < 7 and av < 1:
        av = min(1, av + 0.04)
        as_ = max(0, as_ - 0.02)
        lifted = from_hsv(ah, as_, av)
    shares = [{"colour": hexed(c), "share": round(n / total, 3)} for c, n in ranked[:8]]
    return {**darks, "accent": hexed(lifted), "second": hexed(second), "ground": hexed(ground), "colours": shares}


def build():
    towns = []
    for key, name, tileset in TOWNS:
        t = SECONDARY / tileset
        if not (t / "metatiles.bin").exists():
            raise SystemExit(f"towns: no tileset at {t} (is DAEMONS' engine at {DAEMONS / 'engineGba'}?)")
        towns.append({"key": key, "name": name, **scheme(coverage(t))})
    return {"_": "E-13: each town's palette, read from its own tileset in DAEMONS' engine by tools/towns.py -- never "
                 "edited by hand. bg, panel, raised and line are the page's darks in the ground's hue; accent carries "
                 "dark text; colours are the town's most-covering, with their share of it.",
            "towns": towns}


def main():
    want = json.dumps(build(), indent=1, ensure_ascii=False) + "\n"
    have = OUT.read_text() if OUT.exists() else ""
    if want == have:
        print("towns: web/towns.json is current")
        return 0
    if "--write" in sys.argv:
        OUT.write_text(want)
        print(f"towns: wrote {OUT.relative_to(ROOT)}")
        return 0
    print("towns: web/towns.json would change (run with --write)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
