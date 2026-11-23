"""Draw the maps the levels are picked on, in the game's colours (game/assets/bg/, 192 x 288 each):

    czech-map      Czechia, from the real border (Natural Earth, art/source/geo/borders.json), with forests on the
                   border hills, fields, the big rivers, and Prague under a magnifying glass.
    praha-map      Prague close up, drawn like a picture map for children rather than to scale: the Vltava and its
                   bend round Holešovice, the Castle, Petřín, the Strahov stadium, home and the salon in Praha 5,
                   the winter stadium in Praha 7. Every Prague level has its pin here.
    australia-map  Australia from the real coast (art/source/geo/australia.json): the red centre, the green coasts,
                   the Great Barrier Reef, and Sydney under a magnifying glass with the harbour and Bondi.

    python3 tools/maps.py            draw all three and list them with the rest of the art
    python3 tools/maps.py --spots    print where the pins go, for game/world.js
"""
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG = ROOT / 'game/assets/bg'
W, H = 192, 288

C = dict(paper='#F2E4BE', paper2='#E9D7A8', grid='#E4D09C', nb='#E2D3A2', nbline='#CBB57F',
         land='#9BD16B', land2='#8CC65F', field1='#B8DC74', field2='#D7DE84', field3='#C7E28F',
         wood='#5FA85A', wood2='#4A8F4E', hill='#7FBF63', edge='#3E7A3A', glow='#FFF8E7',
         river='#3E8EDC', river2='#7CC0F0', bank='#C9B48A', roof1='#D9774A', roof2='#E8A06A', roof3='#C95F3E', roof4='#F0D9B8', roof5='#E6BE96', roof6='#F3E4CC',
         street='#EADFCB', road='#CFC5B8', park='#86C766', park2='#6DB257', stone='#E8DCC4', stone2='#B9AE98',
         rim='#FFD43A', rim2='#C99A2E', rim3='#FFF1A8', handle='#8A5A2B', handle2='#6B4220', ink='#2B1F1A', soft='#7A6F6A',
         sea='#3E8EDC', sea2='#5AA6E6', foam='#BFE3F7', sand='#F0D9A0', red='#CC2233', white='#FFF8E7', spire='#5E8F6A', gold='#FFD43A',
         desert='#D9622B', desert2='#C9562A', ochre='#E8A94A', dune='#F0C46A', savanna='#B9C45F', tropic='#6DB257', reef='#5FD3C4')
C = {k: ImageColor.getrgb(v) for k, v in C.items()}


def save(img, name):
    img.save(BG / f'{name}.png')
    man = ROOT / 'game/assets/manifest.js'                                  # list it with the rest of the art
    text = man.read_text(); data = json.loads(text[text.index('{'):text.rindex('}') + 1])
    data['bg'] = sorted(set(data['bg']) | {name})
    man.write_text(text[:text.index('window.ASSETS')] + 'window.ASSETS = ' + json.dumps(data, indent=2) + ';\n')
    print('saved', f'game/assets/bg/{name}.png')


def roofs(px, box, seed=0, mix=('roof2', 'roof2', 'roof1', 'roof4', 'roof2', 'roof1', 'roof4', 'roof3'), ok=lambda x, y: True):
    """Blocks of roofs between light streets, filling a box (x1, y1, x2, y2)."""
    x1, y1, x2, y2 = box
    for y in range(max(0, y1), min(H, y2)):
        for x in range(max(0, x1), min(W, x2)):
            if not ok(x, y): continue
            col = (x + 200) // 5; row = (y + 200 + col % 2 * 2) // 4
            if (x + 200) % 5 < 4 and (y + 200 + col % 2 * 2) % 4 < 3:
                px[x, y] = C[random.Random(col * 977 + row * 131 + seed).choice(mix)]
            else: px[x, y] = C['street']


def woods(px, mask, rnd, light='wood', dark='wood2', base='hill'):
    """Trees over every pixel of a mask: dots of two greens on a lighter ground."""
    M = mask.load()
    for y in range(H):
        for x in range(W):
            if M[x, y]: px[x, y] = C[light if (x + y) % 2 else dark] if (x + 2 * y) % 3 != 0 and rnd.random() < 0.75 else C[base]


def glass(img, inside, centre, r, towards, handle=(1, 1)):
    """A magnifying glass: `inside` (a picture the size of the screen) shown in a gold-rimmed circle, with two
    dotted lines from the spot it shows (`towards`) and a wooden handle going off in the direction `handle`."""
    d, px = ImageDraw.Draw(img), img.load()
    cx, cy = centre
    p = towards
    for side in (-1, 1):
        dx, dy = cx - p[0], cy - p[1]; dist = math.hypot(dx, dy); ang = math.atan2(dy, dx) + side * math.asin(r / dist) * 0.97
        L = math.sqrt(dist * dist - r * r)
        ex, ey = p[0] + math.cos(ang) * L, p[1] + math.sin(ang) * L
        n = int(L)
        for i in range(2, n):
            if i % 3 != 2: px[round(p[0] + (ex - p[0]) * i / n), round(p[1] + (ey - p[1]) * i / n)] = C['soft']
    hx, hy = cx + r * 0.72 * handle[0], cy + r * 0.72 * handle[1]
    ex, ey = hx + 22 * handle[0], hy + 22 * handle[1]
    d.line([(hx, hy), (ex, ey)], fill=C['handle2'], width=9)
    d.line([(hx, hy), (ex - handle[0], ey - handle[1])], fill=C['handle'], width=7)
    d.line([(hx + 1, hy - 1), (ex - 1, ey - 3)], fill=(168, 116, 63), width=1)
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    img.paste(inside, (0, 0), m)
    d.ellipse([cx - r - 4, cy - r - 4, cx + r + 4, cy + r + 4], outline=C['rim2'], width=2)       # the rim: gold, lit from the top left
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], outline=C['rim'], width=3)
    d.arc([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], 200, 250, fill=C['rim3'], width=1)
    d.arc([cx - r + 4, cy - r + 4, cx + r - 4, cy + r - 4], 205, 235, fill=(255, 255, 255), width=1)   # a glint on the glass


def outline_of(rings_, proj):
    mask = Image.new('L', (W, H), 0)
    for r in rings_: ImageDraw.Draw(mask).polygon([proj(*p) for p in r], fill=255)
    M = mask.load()
    inside = lambda x, y: 0 <= x < W and 0 <= y < H and M[x, y]
    edge = [(x, y) for y in range(H) for x in range(W) if inside(x, y) and not all(inside(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    far = {}
    for y in range(H):
        for x in range(W):
            if inside(x, y): far[x, y] = min(abs(x - a) + abs(y - b) for a, b in edge)
    return inside, edge, far


# ---------------------------------------------------------------- Czechia ----
LON0, LAT1, K, X0, Y0 = 12.09, 51.06, 40.7, 7, 34
COS = math.cos(math.radians(49.8))
def cz(lon, lat): return (X0 + (lon - LON0) * COS * K, Y0 + (LAT1 - lat) * K)

LENS, LR = (96, 202), 52                                                    # Prague under the glass
PLON, PLAT, PK = 14.405, 50.084, 1240
PCOS = math.cos(math.radians(50.08))
def pr(lon, lat): return (LENS[0] + (lon - PLON) * PCOS * PK, LENS[1] + (PLAT - lat) * PK)

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
PRAGUE_RIVER = [(14.396, 49.990), (14.400, 50.010), (14.405, 50.033), (14.414, 50.055), (14.416, 50.064), (14.413, 50.075), (14.411, 50.0865),
                (14.414, 50.093), (14.424, 50.096), (14.437, 50.097), (14.455, 50.1005), (14.470, 50.104), (14.474, 50.110), (14.462, 50.115),
                (14.437, 50.1155), (14.418, 50.119), (14.402, 50.118), (14.395, 50.125), (14.398, 50.140), (14.400, 50.160)]
PARKS = [(14.386, 14.404, 50.076, 50.088), (14.408, 14.432, 50.094, 50.099), (14.404, 14.432, 50.1035, 50.110), (14.368, 14.386, 50.064, 50.074),
         (14.330, 14.360, 50.080, 50.090), (14.405, 14.428, 50.114, 50.126), (14.414, 14.421, 50.0625, 50.066), (14.420, 14.440, 50.020, 50.040)]


def czech():
    rnd = random.Random(7)
    img = Image.new('RGB', (W, H), C['paper'])
    d, px = ImageDraw.Draw(img), img.load()
    for x in range(-4, W, 16): d.line([(x, 22), (x, H)], fill=C['grid'])              # the atlas' lines of longitude and latitude
    for y in range(26, H, 16): d.line([(0, y), (W, y)], fill=C['grid'])
    borders = json.load(open(ROOT / 'art/source/geo/borders.json'))
    for nb in ('germany', 'poland', 'austria', 'slovakia'):
        for r in borders[nb]: d.polygon([cz(*p) for p in r], fill=C['nb'], outline=C['nbline'])
    inside, edge, far = outline_of(borders['czechia'], cz)
    plots = {}
    for (x, y) in far:                                                     # fields: a patchwork of small plots
        key = (x // 7 + (y // 5) % 2 * 3, y // 5)
        if key not in plots: plots[key] = rnd.choice([C['land'], C['land'], C['land'], C['land2'], C['field1'], C['field3'], C['field2'] if rnd.random() < 0.3 else C['land']])
        px[x, y] = plots[key]
    blobs = [(rnd.uniform(10, 185), rnd.uniform(36, 136), rnd.uniform(2, 5)) for _ in range(26)]
    for (x, y), dist in far.items():                                       # woods on the hills by the border, and here and there
        woody = dist < 5 + 3 * math.sin(x * 0.21) * math.sin(y * 0.17 + 1) or any((x - bx) ** 2 + (y - by) ** 2 < br * br for bx, by, br in blobs)
        if woody and (x + 2 * y) % 3 != 0 and rnd.random() < 0.8: px[x, y] = C['wood'] if (x + y) % 2 else C['wood2']
        elif woody: px[x, y] = C['hill']
    for name, line in RIVERS.items():
        d.line([cz(*p) for p in line], fill=C['river'], width=2 if name in ('vltava', 'labe') else 1)
    for x, y in edge: px[x, y] = C['edge']
    for y in range(H):
        for x in range(W):
            if not inside(x, y) and any(inside(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))): px[x, y] = C['glow']
    p = tuple(round(v) for v in cz(14.42, 50.08))
    for a, b, col in ((0, 0, 'roof3'), (1, 0, 'roof1'), (-1, 0, 'roof2'), (0, 1, 'roof1'), (0, -1, 'roof2'), (1, 1, 'roof4'), (-1, -1, 'roof1'), (1, -1, 'roof3'), (-1, 1, 'roof2')):
        px[p[0] + a, p[1] + b] = C[col]
    lens = Image.new('RGB', (W, H), C['street'])
    ld, lp = ImageDraw.Draw(lens), lens.load()
    roofs(lp, (LENS[0] - LR, LENS[1] - LR, LENS[0] + LR + 1, LENS[1] + LR + 1))
    for w_, e_, s_, n_ in PARKS:
        (x1, y1), (x2, y2) = pr(w_, n_), pr(e_, s_)
        ld.rounded_rectangle([x1, y1, x2, y2], radius=3, fill=C['park'])
        for y in range(int(y1) + 1, int(y2)):
            for x in range(int(x1) + 1, int(x2)):
                if (x * 7 + y * 3) % 5 == 0: lp[x, y] = C['park2']
    pts = [pr(*q) for q in PRAGUE_RIVER]
    ld.line(pts, fill=C['river'], width=6, joint='curve')
    ld.line(pts, fill=C['river2'], width=1)
    for lat in (50.073, 50.081, 50.0865, 50.0895):
        x = min(pts, key=lambda q: abs(q[1] - pr(14.41, lat)[1]))[0]; y = pr(14.41, lat)[1]
        ld.line([(x - 5, y), (x + 5, y)], fill=C['stone'], width=1)
    kx, ky = (round(v) for v in pr(14.400, 50.0905))                       # Prague Castle above the river
    ld.rectangle([kx - 7, ky - 1, kx + 6, ky + 2], fill=C['stone'])
    ld.rectangle([kx - 1, ky - 7, kx, ky - 1], fill=C['spire']); ld.rectangle([kx + 2, ky - 6, kx + 3, ky - 1], fill=C['spire'])
    ld.rectangle([kx - 3, ky - 4, kx + 4, ky - 1], fill=(216, 203, 176))
    lp[kx - 1, ky - 8] = lp[kx + 2, ky - 7] = C['gold']
    glass(img, lens, LENS, LR, p)
    save(img, 'czech-map')


# ----------------------------------------------------------------- Prague ----
# A picture map, not to scale: everything sits where it is in Prague, only closer together and bigger.
VLTAVA = [(136, 292), (131, 266), (125, 240), (121, 214), (119, 190), (120, 168), (124, 148), (131, 132), (144, 122), (162, 118),
          (178, 112), (186, 98), (181, 84), (166, 76), (146, 72), (130, 66), (119, 54), (113, 38), (111, 18)]
STADIUM = (42, 132, 30, 19)                                                 # Strahov: centre, half width, half height
HOME, SALON, ARENA, CASTLE, TOWER = (30, 234), (100, 204), (156, 94), (104, 106), (88, 140)


def praha():
    rnd = random.Random(3)
    img = Image.new('RGB', (W, H), C['street'])
    d, px = ImageDraw.Draw(img), img.load()
    roofs(px, (0, 0, W, H), seed=5, mix=('roof4', 'roof5', 'roof6', 'roof4', 'roof2', 'roof5', 'roof6', 'roof1'))
    # Green: the hill of Petřín and Strahov, the Castle's gardens, Letná, Stromovka, Troja, Vyšehrad, parks in Praha 5 and 6.
    green = Image.new('L', (W, H), 0); g = ImageDraw.Draw(green)
    g.polygon([(10, 104), (40, 100), (72, 104), (96, 112), (110, 122), (114, 144), (110, 166), (98, 180), (80, 178), (70, 164), (56, 160), (24, 158), (6, 150), (4, 120)], fill=255)
    g.ellipse([126, 98, 162, 116], fill=255)                               # Letná
    g.ellipse([128, 80, 150, 96], fill=255)                                # Stromovka
    g.polygon([(120, 22), (192, 22), (192, 62), (170, 70), (146, 64), (128, 58), (118, 44)], fill=255)   # Troja and the zoo
    g.ellipse([140, 232, 164, 254], fill=255)                              # Vyšehrad
    g.ellipse([86, 94, 124, 120], fill=255)                                # the Castle's gardens
    g.ellipse([12, 192, 44, 210], fill=255)                                # Klamovka, Praha 5
    g.ellipse([8, 52, 40, 82], fill=255)                                   # Hvězda, Praha 6
    woods(px, green, rnd)
    # The streets of Praha 5: from home along the tram line to the salon, and the path up the hill to Strahov.
    d.line([(HOME[0] + 6, HOME[1] + 2), (66, 236), (84, 224), (SALON[0] - 2, SALON[1] + 6)], fill=C['road'], width=5, joint='curve')
    d.line([(HOME[0] + 6, HOME[1] + 2), (66, 236), (84, 224), (SALON[0] - 2, SALON[1] + 6)], fill=C['stone2'], width=1, joint='curve')
    path = [(26, 214), (40, 204), (32, 192), (48, 182), (40, 170), (56, 162), (62, 152)]
    for (a, b), (c, e) in zip(path, path[1:]):                            # a dotted path up the hill
        n = int(math.hypot(c - a, e - b))
        for i in range(n):
            if i % 3 != 2: px[round(a + (c - a) * i / n), round(b + (e - b) * i / n)] = (168, 116, 63)
    # The river, its stone banks, a light streak down the middle, bridges and a little boat.
    d.line(VLTAVA, fill=C['bank'], width=14, joint='curve')
    d.line(VLTAVA, fill=C['river'], width=11, joint='curve')
    d.line([(x + 2, y) for x, y in VLTAVA], fill=C['river2'], width=1)
    for y in (186, 214, 240):                                              # plain bridges
        x = min(VLTAVA, key=lambda q: abs(q[1] - y))[0]
        d.rectangle([x - 9, y - 1, x + 9, y + 1], fill=C['stone']); d.line([(x - 9, y + 2), (x + 9, y + 2)], fill=C['stone2'])
    for (x, y) in ((150, 120), (171, 79)):
        d.rectangle([x - 1, y - 9, x + 1, y + 9], fill=C['stone'])
    by = 156; bx = 122                                                     # Charles Bridge, with a tower at each end
    d.rectangle([bx - 11, by - 1, bx + 11, by + 1], fill=(214, 198, 170)); d.line([(bx - 11, by + 2), (bx + 11, by + 2)], fill=C['stone2'])
    for tx in (bx - 13, bx + 11):
        d.rectangle([tx, by - 5, tx + 2, by + 2], fill=(110, 96, 86)); d.rectangle([tx, by - 6, tx + 2, by - 6], fill=(80, 70, 64))
    d.rectangle([127, 196, 133, 197], fill=C['white']); d.rectangle([129, 194, 131, 195], fill=C['red'])   # a boat
    # The Strahov stadium: a long oval of stands round a green pitch, with a stage at the north end.
    cx, cy, rx, ry = STADIUM
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(185, 178, 166))
    d.ellipse([cx - rx + 1, cy - ry + 1, cx + rx - 1, cy + ry - 1], fill=(216, 210, 200))
    for k in range(3, 9, 2): d.ellipse([cx - rx + k, cy - ry + k, cx + rx - k, cy + ry - k], outline=(201, 194, 182))
    d.ellipse([cx - rx + 9, cy - ry + 8, cx + rx - 9, cy + ry - 8], fill=(93, 177, 78))
    for x in range(cx - rx + 11, cx + rx - 9, 4): d.line([(x, cy - ry + 9), (x, cy + ry - 9)], fill=(104, 189, 88))
    d.line([(cx, cy - ry + 9), (cx, cy + ry - 9)], fill=C['white'])
    d.rectangle([cx - 6, cy - ry + 9, cx + 6, cy - ry + 12], fill=(74, 58, 92)); d.line([(cx - 6, cy - ry + 9), (cx + 6, cy - ry + 9)], fill=C['gold'])
    d.rectangle([cx + rx - 12, cy + ry - 6, cx + rx - 8, cy + ry - 1], fill=(120, 110, 100))       # the gate, south-east
    # Prague Castle: the long palace and St Vitus' two green spires.
    kx, ky = CASTLE
    d.rectangle([kx - 14, ky, kx + 12, ky + 6], fill=C['stone']); d.rectangle([kx - 14, ky, kx + 12, ky + 1], fill=C['roof3'])
    for x in range(kx - 12, kx + 12, 3): d.point((x, ky + 3), fill=(120, 108, 96))
    d.rectangle([kx - 4, ky - 6, kx + 5, ky + 2], fill=(216, 203, 176))
    d.rectangle([kx - 3, ky - 14, kx - 1, ky - 6], fill=C['spire']); d.rectangle([kx + 2, ky - 13, kx + 4, ky - 6], fill=C['spire'])
    px[kx - 2, ky - 15] = px[kx + 3, ky - 14] = C['gold']
    # The Petřín lookout tower.
    tx, ty = TOWER
    for k in range(14): d.line([(tx - 2 + k // 6, ty - k), (tx + 2 - k // 6, ty - k)], fill=(122, 74, 34) if k % 3 else (168, 116, 63))
    px[tx, ty - 14] = C['red']
    # Home: a block of flats in bright colours.
    hx, hy = HOME
    d.rectangle([hx - 8, hy - 12, hx + 8, hy + 2], fill=(156, 199, 232)); d.rectangle([hx - 8, hy - 13, hx + 8, hy - 12], fill=(140, 130, 124))
    for row in range(4):
        for col in range(5): d.rectangle([hx - 7 + col * 3, hy - 10 + row * 3, hx - 6 + col * 3, hy - 9 + row * 3], fill=C['white'])
    d.rectangle([hx + 9, hy - 9, hx + 15, hy + 2], fill=(240, 160, 180))
    for row in range(3): d.rectangle([hx + 10, hy - 7 + row * 3, hx + 14, hy - 7 + row * 3], fill=C['white'])
    # The salon: a light house with a striped pink awning.
    sx, sy = SALON
    d.rectangle([sx - 8, sy - 6, sx + 8, sy + 6], fill=(244, 238, 228)); d.rectangle([sx - 8, sy - 7, sx + 8, sy - 6], fill=(90, 84, 80))
    for k in range(-8, 9, 2): d.rectangle([sx + k, sy - 3, sx + k, sy - 1], fill=C['red'] if k % 4 else C['white'])
    d.rectangle([sx - 2, sy + 1, sx + 1, sy + 6], fill=(74, 58, 52)); d.rectangle([sx + 4, sy + 1, sx + 6, sy + 3], fill=(255, 220, 140))
    # The winter stadium in Praha 7: a silver roof with a red band.
    ax, ay = ARENA
    d.ellipse([ax - 13, ay - 7, ax + 13, ay + 7], fill=(143, 150, 163)); d.ellipse([ax - 12, ay - 6, ax + 12, ay + 6], fill=(201, 206, 214))
    d.line([(ax - 11, ay), (ax + 11, ay)], fill=C['red'], width=2)
    # Vyšehrad's church, two dark spires on the green hill, and a red tram on the line in Praha 5.
    d.rectangle([148, 238, 156, 246], fill=(206, 196, 178)); d.rectangle([148, 230, 149, 238], fill=(70, 74, 70)); d.rectangle([155, 230, 156, 238], fill=(70, 74, 70))
    d.rectangle([54, 233, 64, 237], fill=C['red']); d.rectangle([54, 235, 64, 235], fill=C['white']); d.rectangle([55, 234, 56, 234], fill=(200, 230, 255))
    save(img, 'praha-map')


# -------------------------------------------------------------- Australia ----
AX0, ALON0, ALAT0, AK = 16, 112.5, -10, 4.2
ACOS = math.cos(math.radians(27))
def au(lon, lat): return (AX0 + (lon - ALON0) * ACOS * AK, 28 + (ALAT0 - lat) * AK)
SLENS, SR = (104, 226), 44                                                  # Sydney under the glass
SYDNEY = (151.21, -33.87)
MURRAY = [(148.2, -36.8), (146.9, -36.1), (144.6, -35.6), (142.2, -34.2), (140.7, -34.0), (139.6, -34.4), (139.3, -35.4)]


def australia():
    rnd = random.Random(11)
    img = Image.new('RGB', (W, H), C['sea'])
    d, px = ImageDraw.Draw(img), img.load()
    for y in range(26, H, 7):                                              # little waves all over the sea
        for x in range((y * 13) % 17, W, 17): d.line([(x, y), (x + 3, y)], fill=C['sea2'])
    inside, edge, far = outline_of(json.load(open(ROOT / 'art/source/geo/australia.json'))['australia'], au)
    for (x, y), dist in far.items():
        lon = ALON0 + (x - AX0) / (ACOS * AK); lat = ALAT0 - (y - 28) / AK
        wet = (lat > -19) or (lon > 145 and lat > -39) or (lon < 119 and lat < -31) or (lat < -37)    # the tropical north, the east, the south-west, Tasmania
        r = rnd.random()
        if dist > 13: col = 'desert2' if r < 0.18 else 'ochre' if r < 0.24 else 'desert'
        elif dist > 8: col = 'desert' if r < 0.2 else 'dune' if r < 0.3 else 'ochre'
        elif dist > 4 or not wet: col = 'dune' if not wet else 'savanna'
        else: col = ('tropic' if lat > -19 else 'land2') if (x + 2 * y) % 4 else 'wood'
        px[x, y] = C[col]
    d.line([au(*p) for p in MURRAY], fill=C['river'], width=1)
    ux, uy = (round(v) for v in au(131.04, -25.34))                        # Uluru
    d.ellipse([ux - 5, uy - 2, ux + 5, uy + 3], fill=(160, 64, 30)); d.line([(ux - 3, uy - 1), (ux + 3, uy - 1)], fill=(210, 110, 60))
    for x, y in edge: px[x, y] = (201, 154, 74)
    for y in range(H):
        for x in range(W):
            if not inside(x, y) and any(inside(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))): px[x, y] = C['foam']
    for i in range(46):                                                    # the Great Barrier Reef, off the Queensland coast
        lat = -11 - i * 0.29; lon = 143.6 + (i * 0.2 if i < 30 else 6 + (i - 30) * 0.1)
        x, y = au(lon + 1.0 + (i % 3) * 0.25, lat)
        px[round(x), round(y)] = C['reef']
        if i % 2: px[round(x) + 1, round(y)] = (140, 230, 220)
    sx, sy = (round(v) for v in au(*SYDNEY))
    d.rectangle([sx - 1, sy - 1, sx + 1, sy + 1], fill=C['red'])
    # Sydney, close up: the harbour cutting in from the sea, the bridge, the Opera House, the city's towers, Bondi.
    cx, cy = SLENS
    lens = Image.new('RGB', (W, H), C['sea'])
    ld, lp = ImageDraw.Draw(lens), lens.load()
    for y in range(cy - SR, cy + SR + 1, 6):
        for x in range(cx - SR + (y * 7) % 11, cx + SR, 11): ld.line([(x, y), (x + 3, y)], fill=C['sea2'])
    coast = [(cx + 16, cy - SR - 2), (cx + 20, cy - 26), (cx + 14, cy - 16), (cx + 18, cy - 8), (cx + 22, cy + 2), (cx + 18, cy + 12),
             (cx + 24, cy + 20), (cx + 18, cy + 30), (cx + 20, cy + SR + 2), (cx - SR - 2, cy + SR + 2), (cx - SR - 2, cy - SR - 2)]
    land = Image.new('L', (W, H), 0); ImageDraw.Draw(land).polygon(coast, fill=255)
    LM = land.load()
    roofs(lp, (cx - SR, cy - SR, cx + SR + 1, cy + SR + 1), seed=9, mix=('roof4', 'roof6', 'park', 'roof5', 'roof6', 'park2', 'roof4'), ok=lambda x, y: LM[x, y])
    parks = Image.new('L', (W, H), 0); pg = ImageDraw.Draw(parks)
    pg.ellipse([cx - 40, cy + 14, cx - 20, cy + 32], fill=255); pg.ellipse([cx + 4, cy - 40, cx + 16, cy - 26], fill=255)
    PM = parks.load()
    for y in range(H):
        for x in range(W):
            if PM[x, y] and LM[x, y]: px_ = lp; px_[x, y] = C['park'] if (x * 7 + y * 3) % 5 else C['park2']
    harbour = [(cx + 18, cy - 12), (cx + 6, cy - 10), (cx - 6, cy - 8), (cx - 16, cy - 10), (cx - 26, cy - 6), (cx - SR - 2, cy - 8)]
    ld.line(harbour, fill=C['sea'], width=8, joint='curve'); ld.line([(cx + 10, cy - 11), (cx + 2, cy - 18)], fill=C['sea'], width=5)
    ld.line([(cx - 20, cy - 9), (cx - 28, cy - 18)], fill=C['sea'], width=4)
    bx = cx - 14                                                           # the Harbour Bridge: a grey steel arch over the water
    ld.arc([bx - 10, cy - 20, bx + 10, cy - 2], 180, 360, fill=(96, 104, 118), width=2)
    ld.line([(bx - 11, cy - 9), (bx + 11, cy - 9)], fill=(150, 158, 170), width=2)
    for k in (-6, -2, 2, 6): ld.line([(bx + k, cy - 9), (bx + k, cy - 12 - (3 if abs(k) < 4 else 1))], fill=(120, 128, 140))
    ox, oy = cx - 1, cy - 3                                                # the Opera House: white sails on the point
    ld.rectangle([ox - 1, oy, ox + 13, oy + 2], fill=C['stone'])
    for k, h_ in ((0, 6), (4, 8), (8, 6), (11, 4)): ld.polygon([(ox + k, oy), (ox + k + 4, oy), (ox + k + 1, oy - h_)], fill=C['white'], outline=(200, 205, 214))
    for i, (tx, th) in enumerate(((cx - 26, 12), (cx - 22, 18), (cx - 17, 14), (cx - 13, 20), (cx - 30, 9))):   # the city's towers
        ld.rectangle([tx, cy + 10 - th, tx + 3, cy + 10], fill=(58, 104, 170) if i % 2 else (96, 128, 168))
        for y in range(cy + 12 - th, cy + 9, 2): lp[tx + 1, y] = lp[tx + 2, y] = (200, 226, 250)
    ld.line([(cx - 7, cy + 10), (cx - 7, cy - 6)], fill=C['gold']); ld.line([(cx - 12, cy - 6), (cx + 2, cy - 6)], fill=C['gold'])   # and a crane
    ld.line([(cx - 1, cy - 6), (cx - 1, cy - 2)], fill=(120, 110, 100)); ld.rectangle([cx - 3, cy - 2, cx + 1, cy], fill=C['roof1'])
    bay = [(cx + 18, cy + 12), (cx + 14, cy + 16), (cx + 14, cy + 21), (cx + 19, cy + 25)]   # Bondi: a curve of sand and surf
    ld.line(bay, fill=C['sand'], width=5, joint='curve')
    for k in range(3): ld.arc([cx + 16 + k * 3, cy + 10, cx + 26 + k * 3, cy + 28], 120, 240, fill=C['white'], width=1)
    glass(img, lens, SLENS, SR, (sx, sy), handle=(-1, 1))
    save(img, 'australia-map')


# Where the pins go, for game/world.js.
SPOTS = {
    'czech-map': {'praha': (LENS[0], LENS[1] + 6), 'ostrov': tuple(round(v) for v in cz(12.94, 50.306))},
    'praha-map': {'doma': (HOME[0] - 4, HOME[1] - 12), 'ulice': (64, 232), 'pred-salonem': (SALON[0] - 6, SALON[1] + 8), 'v-salonu': (SALON[0] + 6, SALON[1] - 6),
                  'do-kopce': (40, 186), 'brana': (STADIUM[0] + STADIUM[2] - 10, STADIUM[1] + STADIUM[3] - 2), 'zkusebna': (STADIUM[0] - STADIUM[2] + 6, STADIUM[1] + 4),
                  'koncert': (STADIUM[0], STADIUM[1] - STADIUM[3] + 12), 'zimni': ARENA},
    'australia-map': {'bondi': (SLENS[0] + 16, SLENS[1] + 18), 'vlna': (SLENS[0] + 32, SLENS[1] + 4), 'bus': tuple(round(v) for v in au(148.5, -27.5)),
                      'utes': tuple(round(v) for v in au(147.6, -18.4)), 'sydney': (SLENS[0] - 6, SLENS[1] + 2)},
}

if __name__ == '__main__':
    if '--spots' in sys.argv:
        for pic, spots in SPOTS.items(): print(pic, {k: [round(v) for v in p] for k, p in spots.items()})
    else:
        czech(); praha(); australia()
