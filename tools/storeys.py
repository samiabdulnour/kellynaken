"""Sami's house in Sydney, one storey at a time: a contemporary glass tower (game/assets/sprites/storeys.png).

Drawn here rather than cut from a picture, so every storey is exactly as wide as the next and they stack cleanly.
They are drawn at the characters' fine detail, two drawn pixels to a game pixel: a storey is 80 x 50 here and
shows as 40 x 25 in the game, the size the tower game stacks. No black lines: edges are darker colours.

    lobby   a tall glass entrance hall with a white canopy over the revolving door, and two little trees
    floor   a glass curtain wall with slim mullions and the sky's light sliding across it
    plants  a sky garden: a terrace behind a glass railing, overflowing with green, with two small trees
    lights  offices lit warm behind vertical timber fins
    roof    the crown: a slanted glass top with a spire and a red light

    python3 tools/storeys.py     draw the sheet and update its entry in game/assets/sprites.js
(tools/sprites.py calls this too, when it writes the whole sprite list.)
"""
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SW, SH, CW, CH = 80, 50, 86, 92                 # a storey, and the cell each drawing sits in (the crown is taller)
POSES = ['lobby', 'floor', 'plants', 'lights', 'roof']
C = {k: ImageColor.getrgb(v) + (255,) for k, v in dict(
    steel='#4F5D6A', steel2='#6C7B88', mull='#35495A', slab='#E9EEF2', slab2='#F7FAFC', shade='#AEB9C3',
    g0='#2B5E86', g1='#3A79A8', g2='#4E93C4', g3='#7EC0E6', g4='#B4E0F5', g5='#E2F5FF',
    warm0='#E8A33C', warm1='#F6C35E', warm2='#FFE29A', warm3='#FFF3C4', desk='#B07A3A', desk2='#8C5A2B',
    fin='#C98B4E', fin2='#A66B36', leaf0='#2F7D3A', leaf1='#3F9A45', leaf2='#5DB85A', leaf3='#8AD26E', trunk='#7A4A22',
    pot='#D9D2C8', pot2='#B8AFA3', granite='#8E979F', granite2='#737C85', red='#FF4D4D', white='#FFFFFF').items()}


def glass(px, x0, y0, x1, y1, ox, oy, panes=6, transom=None):
    """A curtain wall between (x0, y0) and (x1, y1): darker at the top, a diagonal band of light sliding across,
    slim mullions between the panes. (ox, oy) is where this storey sits in the tower, so the light lines up."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            t = (y - y0) / max(1, y1 - y0)
            col = C['g1'] if t < 0.35 else C['g2']
            band = (x + ox + (y + oy) * 0.9) % 46
            if band < 6: col = C['g3']
            if band < 2: col = C['g4']
            if 30 < band < 32: col = C['g3']
            px[x, y] = col
    step = (x1 - x0 + 1) / panes
    for k in range(1, panes):
        x = round(x0 + k * step)
        for y in range(y0, y1 + 1): px[x, y] = C['mull']
    if transom is not None:
        for x in range(x0, x1 + 1): px[x, y0 + transom] = C['mull']


def slab(d, x0, y, x1):
    """The floor slab's white edge along the bottom of a storey."""
    d.rectangle([x0, y, x1, y + 5], fill=C['slab'])
    d.line([(x0, y), (x1, y)], fill=C['slab2'])
    d.line([(x0, y + 5), (x1, y + 5)], fill=C['shade'])


def sides(d, x0, y0, x1, y1):
    d.rectangle([x0, y0, x0 + 1, y1], fill=C['steel']); d.rectangle([x1 - 1, y0, x1, y1], fill=C['steel2'])


def tree(d, x, foot, h=14, r=6):
    d.rectangle([x - 4, foot - 4, x + 4, foot], fill=C['pot']); d.line([(x - 4, foot), (x + 4, foot)], fill=C['pot2'])
    d.line([(x, foot - 4), (x, foot - h + r)], fill=C['trunk'], width=2)
    cy = foot - h
    d.ellipse([x - r, cy - r, x + r, cy + r], fill=C['leaf1'])
    d.ellipse([x - r + 2, cy - r + 1, x + r - 3, cy + r - 4], fill=C['leaf2'])
    d.ellipse([x - r + 3, cy - r + 2, x - 1, cy - 1], fill=C['leaf3'])


def storey(kind, n):
    """One drawing in a cell of its own, standing on the bottom middle of the cell."""
    img = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    d, px = ImageDraw.Draw(img), img.load()
    x0, x1, base = (CW - SW) // 2, (CW - SW) // 2 + SW - 1, CH - 1
    top = base - SH + 1
    ox, oy = 0, n * 13                                                     # where the band of light sits on this storey
    if kind == 'lobby':
        glass(px, x0 + 2, top + 2, x1 - 2, base - 5, ox, oy, panes=5, transom=12)
        for y in range(top + 14, base - 4):                                # a warm hall behind the glass, lower down
            for x in range(x0 + 3, x1 - 2):
                if px[x, y] != C['mull']: px[x, y] = C['warm3'] if y < top + 18 else C['warm2'] if y < base - 12 else C['warm1']
        d.rectangle([x0 + 14, base - 12, x0 + 24, base - 9], fill=C['desk']); d.rectangle([x1 - 24, base - 12, x1 - 14, base - 9], fill=C['desk'])
        d.rectangle([x0, top, x1, top + 1], fill=C['slab'])
        sides(d, x0, top, x1, base - 4)
        d.rectangle([x0 - 2, base - 3, x1 + 2, base], fill=C['granite']); d.line([(x0 - 2, base - 3), (x1 + 2, base - 3)], fill=C['shade'])
        cx = (x0 + x1) // 2                                                # the revolving door, under a white canopy
        d.rectangle([cx - 7, top + 26, cx + 7, base - 4], fill=C['mull'])
        d.rectangle([cx - 6, top + 27, cx + 6, base - 4], fill=C['g4'])
        d.line([(cx, top + 27), (cx, base - 4)], fill=C['mull']); d.line([(cx - 6, top + 36), (cx + 6, top + 36)], fill=C['steel2'])
        d.rectangle([cx - 16, top + 21, cx + 16, top + 23], fill=C['white']); d.line([(cx - 16, top + 24), (cx + 16, top + 24)], fill=C['shade'])
        tree(d, x0 + 7, base - 4); tree(d, x1 - 7, base - 4)
    elif kind in ('floor', 'roof'):
        glass(px, x0 + 2, top, x1 - 2, base - 6, ox, oy, transom=14)
        sides(d, x0, top, x1, base - 6); slab(d, x0, base - 5, x1)
    elif kind == 'plants':
        for y in range(top, base - 5):                                     # the terrace's back wall: glass, lit inside
            for x in range(x0 + 2, x1 - 1):
                px[x, y] = C['g0'] if (x // 13) % 2 or y < top + 6 else C['g1']
                if top + 6 < y < top + 9: px[x, y] = C['warm2']
        for x in range(x0 + 2, x1 - 1, 13):
            for y in range(top, base - 5): px[x, y] = C['mull']
        sides(d, x0, top, x1, base - 6); slab(d, x0, base - 5, x1)
        for y in range(base - 17, base - 5):                               # the glass railing, behind the plants
            for x in range(x0 + 2, x1 - 1):
                r, g, b, _ = px[x, y]
                px[x, y] = (min(255, r + 40), min(255, g + 50), min(255, b + 55), 255)
        d.line([(x0 + 2, base - 17), (x1 - 2, base - 17)], fill=C['g5'])
        tree(d, x0 + 12, base - 6, h=26, r=8); tree(d, x1 - 14, base - 6, h=22, r=7)
        for k in range(14):                                                # greenery spilling over the planters
            bx = x0 + 3 + k * 5.6; by = base - 9 - (k * 7) % 4
            d.ellipse([bx - 4, by - 4, bx + 4, by + 3], fill=C['leaf1' if k % 2 else 'leaf0'])
            d.ellipse([bx - 2, by - 3, bx + 2, by], fill=C['leaf2'])
            if k % 3 == 0: px[round(bx) - 1, by - 2] = C['leaf3']
        for k in range(1, 14, 4): d.ellipse([x0 + 4 + k * 5.6, base - 6, x0 + 8 + k * 5.6, base - 2], fill=C['leaf1'])   # spilling over the slab
    elif kind == 'lights':
        for y in range(top, base - 5):                                     # offices, lit warm
            for x in range(x0 + 2, x1 - 1):
                px[x, y] = C['warm1'] if y > top + 4 else C['warm3']
                if y > top + 27 and (x // 9) % 2: px[x, y] = C['warm0']
        for k in range(5):                                                 # desks and people
            dx = x0 + 6 + k * 15
            d.rectangle([dx, base - 13, dx + 9, base - 11], fill=C['desk']); d.line([(dx + 1, base - 10), (dx + 1, base - 6)], fill=C['desk2'])
            if k % 2: d.ellipse([dx + 3, base - 24, dx + 7, base - 20], fill=C['desk2']); d.rectangle([dx + 3, base - 20, dx + 7, base - 13], fill=C['desk2'])
        for x in range(x0 + 5, x1 - 2, 8):                                 # vertical timber fins in front
            d.rectangle([x, top, x + 1, base - 6], fill=C['fin']); d.line([(x + 2, top), (x + 2, base - 6)], fill=C['fin2'])
        sides(d, x0, top, x1, base - 6); slab(d, x0, base - 5, x1)
    if kind == 'roof':                                                     # the crown: a glass wedge rising to the right, and a spire
        hi, lo = top - 22, top - 6
        for x in range(x0 + 2, x1 - 1):
            ytop = round(lo + (hi - lo) * (x - x0) / SW)
            for y in range(ytop, top):
                band = (x + ox + (y + oy) * 0.9) % 46
                px[x, y] = C['g4'] if band < 3 else C['g3'] if band < 8 else C['g2'] if (x // 13) % 2 else C['g1']
            px[x, ytop] = C['slab2']; px[x, ytop + 1] = C['white']
        for k in range(1, 6):
            x = round(x0 + 2 + k * (SW - 4) / 6)
            for y in range(round(lo + (hi - lo) * (x - x0) / SW) + 2, top): px[x, y] = C['mull']
        d.rectangle([x0, top - 1, x1, top], fill=C['slab'])
        sx = x1 - 10; foot = round(lo + (hi - lo) * (sx - x0) / SW) + 1      # the spire stands on the glass
        d.line([(sx, foot), (sx, foot - 18)], fill=C['steel2'], width=2); d.line([(sx + 1, foot), (sx + 1, foot - 18)], fill=C['steel'])
        d.rectangle([sx - 1, foot - 21, sx + 1, foot - 19], fill=C['red']); px[sx, foot - 20] = C['white']
    return img


def sheet(out_dir):
    """Draw the whole sheet into out_dir/storeys.png and return its entry for sprites.js."""
    out = Image.new('RGBA', (CW * len(POSES), CH))
    for k, kind in enumerate(POSES): out.paste(storey(kind, k), (k * CW, 0))
    out.save(os.path.join(out_dir, 'storeys.png'), optimize=True)
    poses = {p: [k] for k, p in enumerate(POSES)}; poses['stand'] = [0]
    return {'file': 'storeys.png', 'w': CW, 'h': CH, 'scale': 0.5, 'fps': 1, 'poses': poses}


if __name__ == '__main__':
    entry = sheet(ROOT / 'game/assets/sprites')
    js = ROOT / 'game/assets/sprites.js'
    text = js.read_text(); head, body = text[:text.index('window.SPRITES')], text[text.index('{'):text.rindex('}') + 1]
    info = json.loads(body); info['storeys'] = entry
    js.write_text(head + 'window.SPRITES = ' + json.dumps(info, indent=2) + ';\n')
    print('storeys', CW, 'x', CH, POSES)
    sys.exit(0)
