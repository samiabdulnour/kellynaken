"""Draw the map of Czechia the places at home are picked on (game/assets/bg/czech-map.png, 192 x 288).

The outline is the real border (Natural Earth, art/source/geo/borders.json), so the country looks like itself;
everything on it is drawn here, in the game's colours: forests on the hills along the border, fields in the
lowlands, the big rivers, and Prague under a magnifying glass, close enough to tell its places apart.

    python3 tools/czmap.py

Where a place sits on this picture is worked out by `spot()`: run with --spots to print the pins for world.js.
"""
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'game/assets/bg/czech-map.png'
W, H = 192, 288

# The country: longitude and latitude to the picture, flat, squeezed east-west as it is at 49.8 degrees north.
LON0, LAT1, K, X0, Y0 = 12.09, 51.06, 40.7, 7, 34
COS = math.cos(math.radians(49.8))
def cz(lon, lat): return (X0 + (lon - LON0) * COS * K, Y0 + (LAT1 - lat) * K)

# Prague, under the glass: centre on the picture, radius, and the bit of the city it shows.
LENS, LR = (96, 202), 52
PLON, PLAT, PK = 14.405, 50.084, 1240
PCOS = math.cos(math.radians(50.08))
def pr(lon, lat): return (LENS[0] + (lon - PLON) * PCOS * PK, LENS[1] + (PLAT - lat) * PK)

C = dict(paper='#F2E4BE', paper2='#E9D7A8', grid='#E4D09C', nb='#E2D3A2', nbline='#CBB57F',
         land='#9BD16B', land2='#8CC65F', field1='#B8DC74', field2='#D7DE84', field3='#C7E28F',
         wood='#5FA85A', wood2='#4A8F4E', hill='#7FBF63', edge='#3E7A3A', glow='#FFF8E7',
         river='#3E8EDC', river2='#7CC0F0', roof1='#D9774A', roof2='#E8A06A', roof3='#C95F3E', roof4='#F0D9B8',
         street='#EADFCB', park='#86C766', park2='#6DB257', stone='#E8DCC4', rim='#FFD43A', rim2='#C99A2E', rim3='#FFF1A8',
         handle='#8A5A2B', handle2='#6B4220', ink='#2B1F1A', soft='#7A6F6A')
C = {k: ImageColor.getrgb(v) for k, v in C.items()}

RIVERS = {   # lon, lat along the big rivers, from their springs down
    'vltava': [(13.58, 49.02), (13.80, 48.92), (13.95, 48.74), (14.10, 48.67), (14.23, 48.63), (14.31, 48.62), (14.32, 48.81), (14.47, 48.97),
               (14.44, 49.05), (14.42, 49.22), (14.30, 49.35), (14.17, 49.51), (14.30, 49.70), (14.39, 49.82), (14.40, 49.89), (14.395, 49.975),
               (14.413, 50.087), (14.42, 50.118), (14.40, 50.16), (14.31, 50.24), (14.33, 50.27), (14.47, 50.35)],
    'labe': [(15.61, 50.73), (15.61, 50.63), (15.81, 50.43), (15.92, 50.36), (15.83, 50.21), (15.78, 50.04), (15.56, 50.04), (15.20, 50.03),
             (15.12, 50.14), (15.04, 50.19), (14.75, 50.16), (14.66, 50.19), (14.47, 50.35), (14.26, 50.43), (14.13, 50.53), (14.04, 50.66),
             (14.21, 50.78), (14.24, 50.89)],
    'ohre': [(12.10, 50.05), (12.37, 50.08), (12.64, 50.18), (12.75, 50.19), (12.87, 50.23), (13.27, 50.38), (13.55, 50.33), (13.80, 50.36),
             (14.04, 50.41), (14.15, 50.51), (14.13, 50.53)],
    'berounka': [(13.38, 49.75), (13.55, 49.92), (13.87, 50.04), (14.07, 49.96), (14.32, 49.96), (14.40, 49.99)],
    'sazava': [(15.28, 49.69), (14.90, 49.87), (14.60, 49.86), (14.40, 49.89)],
    'morava': [(16.85, 50.20), (16.94, 50.07), (16.87, 49.88), (17.08, 49.70), (17.25, 49.59), (17.45, 49.45), (17.39, 49.30), (17.53, 49.21),
               (17.46, 49.07), (17.38, 48.95), (17.13, 48.85), (16.97, 48.72), (16.94, 48.62)],
    'dyje': [(15.81, 48.90), (16.05, 48.86), (16.35, 48.80), (16.60, 48.88), (16.88, 48.76), (16.94, 48.62)],
    'odra': [(17.83, 49.66), (18.05, 49.72), (18.29, 49.84), (18.35, 49.92), (18.33, 50.00)],
}
# The Vltava through Prague, finer: past Vyšehrad, the Old Town, round Holešovice and away north past Troja.
PRAGUE_RIVER = [(14.396, 49.990), (14.400, 50.010), (14.405, 50.033), (14.414, 50.055), (14.416, 50.064), (14.413, 50.075), (14.411, 50.0865),
                (14.414, 50.093), (14.424, 50.096), (14.437, 50.097), (14.455, 50.1005), (14.470, 50.104), (14.474, 50.110), (14.462, 50.115),
                (14.437, 50.1155), (14.418, 50.119), (14.402, 50.118), (14.395, 50.125), (14.398, 50.140), (14.400, 50.160)]
PARKS = [   # west, east, south, north
    (14.386, 14.404, 50.076, 50.088),      # Petřín and the Strahov hill
    (14.408, 14.432, 50.094, 50.099),      # Letná
    (14.404, 14.432, 50.1035, 50.110),     # Stromovka
    (14.368, 14.386, 50.064, 50.074),      # Klamovka and Košíře's slopes
    (14.330, 14.360, 50.080, 50.090),      # Hvězda
    (14.405, 14.428, 50.114, 50.126),      # Troja
    (14.414, 14.421, 50.0625, 50.066),     # Vyšehrad
    (14.420, 14.440, 50.020, 50.040),      # Krč forest
]
CASTLE = (14.400, 50.0905)

# Where each place is: the pins for world.js. Prague ones are inside the glass.
PLACES = {
    'domov': ('praha', 14.374, 50.061), 'kadernictvi': ('praha', 14.401, 50.068), 'praha6': ('praha', 14.387, 50.080),
    'zimni': ('praha', 14.432, 50.1065), 'ostrov': ('cz', 12.94, 50.306),
}
def spot(name):
    where, lon, lat = PLACES[name]
    x, y = (pr if where == 'praha' else cz)(lon, lat)
    return [round(x), round(y)]


def rings(name):
    return json.load(open(ROOT / 'art/source/geo/borders.json'))[name]


def main():
    rnd = random.Random(7)
    img = Image.new('RGB', (W, H), C['paper'])
    d = ImageDraw.Draw(img)
    for x in range(-4, W, 16): d.line([(x, 22), (x, H)], fill=C['grid'])              # the atlas' lines of longitude and latitude
    for y in range(26, H, 16): d.line([(0, y), (W, y)], fill=C['grid'])

    # The neighbours, quietly, then the country itself.
    for nb in ('germany', 'poland', 'austria', 'slovakia'):
        for r in rings(nb): d.polygon([cz(*p) for p in r], fill=C['nb'], outline=C['nbline'])
    mask = Image.new('L', (W, H), 0)
    for r in rings('czechia'): ImageDraw.Draw(mask).polygon([cz(*p) for p in r], fill=255)
    M = mask.load()
    inside = lambda x, y: 0 <= x < W and 0 <= y < H and M[x, y]
    # How far each pixel of the country is from its border, to put the forested hills along it.
    far = {}
    edge = [(x, y) for y in range(H) for x in range(W) if inside(x, y) and not all(inside(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for y in range(H):
        for x in range(W):
            if inside(x, y): far[x, y] = min(abs(x - a) + abs(y - b) for a, b in edge)
    px = img.load()
    # Fields: a patchwork of small plots in the lowlands; woods in the hills by the border and here and there inside.
    plots = {}
    for (x, y), dist in far.items():
        key = (x // 7 + (y // 5) % 2 * 3, y // 5)
        if key not in plots: plots[key] = rnd.choice([C['land'], C['land'], C['land'], C['land2'], C['field1'], C['field3'], C['field2'] if rnd.random() < 0.3 else C['land']])
        px[x, y] = plots[key]
    blobs = [(rnd.uniform(10, 185), rnd.uniform(36, 136), rnd.uniform(2, 5)) for _ in range(26)]
    for (x, y), dist in far.items():
        woody = dist < 5 + 3 * math.sin(x * 0.21) * math.sin(y * 0.17 + 1) or any((x - bx) ** 2 + (y - by) ** 2 < br * br for bx, by, br in blobs)
        if woody and (x + 2 * y) % 3 != 0 and rnd.random() < 0.8:
            px[x, y] = C['wood'] if (x + y) % 2 else C['wood2']
        elif woody: px[x, y] = C['hill']
    for name, line in RIVERS.items():
        pts = [cz(*p) for p in line]
        d.line(pts, fill=C['river'], width=2 if name in ('vltava', 'labe') else 1)
    # The border: a dark green edge with a light rim outside, no black.
    for x, y in edge: px[x, y] = C['edge']
    for y in range(H):
        for x in range(W):
            if not inside(x, y) and any(inside(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))): px[x, y] = C['glow']

    # Prague on the country map, and the glass that shows it close up.
    p = tuple(round(v) for v in cz(14.42, 50.08))
    for a, b, col in ((0, 0, 'roof3'), (1, 0, 'roof1'), (-1, 0, 'roof2'), (0, 1, 'roof1'), (0, -1, 'roof2'), (1, 1, 'roof4'), (-1, -1, 'roof1'), (1, -1, 'roof3'), (-1, 1, 'roof2')):
        px[p[0] + a, p[1] + b] = C[col]
    cx, cy = LENS
    for side in (-1, 1):                                                   # two lines from the city to the edge of the glass
        dx, dy = cx - p[0], cy - p[1]; dist = math.hypot(dx, dy); ang = math.atan2(dy, dx) + side * math.asin(LR / dist) * 0.97
        L = math.sqrt(dist * dist - LR * LR)
        ex, ey = p[0] + math.cos(ang) * L, p[1] + math.sin(ang) * L
        n = int(L)
        for i in range(2, n):
            if i % 3 != 2: px[round(p[0] + (ex - p[0]) * i / n), round(p[1] + (ey - p[1]) * i / n)] = C['soft']
    # The handle, down and to the right.
    hx, hy = cx + LR * 0.72, cy + LR * 0.72
    d.line([(hx, hy), (hx + 22, hy + 22)], fill=C['handle2'], width=9)
    d.line([(hx, hy), (hx + 21, hy + 21)], fill=C['handle'], width=7)
    d.line([(hx + 1, hy - 1), (hx + 20, hy + 18)], fill=(168, 116, 63), width=1)

    lens = Image.new('RGB', (W, H), C['street'])
    ld = ImageDraw.Draw(lens)
    lp = lens.load()
    for y in range(cy - LR, cy + LR + 1):                                  # the city: blocks of roofs between light streets
        for x in range(cx - LR, cx + LR + 1):
            col = (x - cx + 200) // 5; row = (y - cy + 200 + col % 2 * 2) // 4
            if (x - cx + 200) % 5 < 4 and (y - cy + 200 + col % 2 * 2) % 4 < 3:
                r = random.Random(col * 977 + row * 131)
                lp[x, y] = C[r.choice(['roof2', 'roof2', 'roof1', 'roof4', 'roof2', 'roof1', 'roof4', 'roof3'])]
    for w_, e_, s_, n_ in PARKS:
        (x1, y1), (x2, y2) = pr(w_, n_), pr(e_, s_)
        ld.rounded_rectangle([x1, y1, x2, y2], radius=3, fill=C['park'])
        for y in range(int(y1) + 1, int(y2)):
            for x in range(int(x1) + 1, int(x2)):
                if (x * 7 + y * 3) % 5 == 0: lp[x, y] = C['park2']
    pts = [pr(*q) for q in PRAGUE_RIVER]
    ld.line(pts, fill=C['river'], width=6, joint='curve')
    ld.line(pts, fill=C['river2'], width=1)
    for lat in (50.073, 50.081, 50.0865, 50.0895):                         # bridges in the middle of town
        x = min(pts, key=lambda q: abs(q[1] - pr(14.41, lat)[1]))[0]; y = pr(14.41, lat)[1]
        ld.line([(x - 5, y), (x + 5, y)], fill=C['stone'], width=1)
    # Prague Castle above the river: the cathedral's two towers and the long palace.
    kx, ky = (round(v) for v in pr(*CASTLE))
    ld.rectangle([kx - 7, ky - 1, kx + 6, ky + 2], fill=C['stone'])
    ld.rectangle([kx - 1, ky - 7, kx, ky - 1], fill=(94, 143, 106)); ld.rectangle([kx + 2, ky - 6, kx + 3, ky - 1], fill=(94, 143, 106))
    ld.rectangle([kx - 3, ky - 4, kx + 4, ky - 1], fill=(216, 203, 176))
    lp[kx - 1, ky - 8] = lp[kx + 2, ky - 7] = (255, 212, 58)
    lm = Image.new('L', (W, H), 0)
    ImageDraw.Draw(lm).ellipse([cx - LR, cy - LR, cx + LR, cy + LR], fill=255)
    img.paste(lens, (0, 0), lm)
    d.ellipse([cx - LR - 4, cy - LR - 4, cx + LR + 4, cy + LR + 4], outline=C['rim2'], width=2)       # the rim: gold, lit from the top left
    d.ellipse([cx - LR - 3, cy - LR - 3, cx + LR + 3, cy + LR + 3], outline=C['rim'], width=3)
    d.arc([cx - LR - 3, cy - LR - 3, cx + LR + 3, cy + LR + 3], 200, 250, fill=C['rim3'], width=1)
    d.arc([cx - LR + 4, cy - LR + 4, cx + LR - 4, cy + LR - 4], 205, 235, fill=(255, 255, 255), width=1)   # a glint on the glass
    img.save(OUT)
    man = ROOT / 'game/assets/manifest.js'                                  # list it with the rest of the art
    text = man.read_text(); data = json.loads(text[text.index('{'):text.rindex('}') + 1])
    data['bg'] = sorted(set(data['bg']) | {OUT.stem})
    man.write_text(text[:text.index('window.ASSETS')] + 'window.ASSETS = ' + json.dumps(data, indent=2) + ';\n')
    print('saved', OUT.relative_to(ROOT))


if __name__ == '__main__':
    if '--spots' in sys.argv:
        for k in PLACES: print(k, spot(k))
    else:
        main()
