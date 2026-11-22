#!/usr/bin/env python3
"""Cut the characters out of the character sheet and turn them into sprites for the game.

    python3 tools/sprites.py

Reads art/source/characters.png (or .webp): six cards (Leila, Sami, Žofia / Kendrick, Kellyn, Alan), each with a row of five
big standing figures (front, three-quarter, side, back three-quarter, back), a row of four small action poses and
a row of five faces.

For each character it writes game/assets/sprites/<id>.png (the big figures, plus running frames made from the
side view) and <id>-faces.png, and it writes game/assets/sprites.js to say what is where.

The big figures are the base: they are the most detailed drawings on the sheet, about 45 game pixels tall.
The sheet is drawn in big square "pixels" (about 4.4 real pixels wide on a sheet 1536 wide), so each figure is
sampled back down onto that grid; nothing is redrawn. A sharper or larger sheet gives sharper sprites.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(HERE, 'art', 'source')
OUT = os.path.join(HERE, 'game', 'assets')
# Measured on a sheet 1536 pixels wide; K scales them to whatever size the sheet really is.
CARDS_X = [(14, 510), (518, 1016), (1024, 1524)]
CARDS_Y = [(48, 518), (540, 1022)]
K = 1.0
NAMES = [['leila', 'sami', 'zofia'], ['ken', 'kel', 'alan']]
PIXEL = 4.4                                    # roughly how wide one drawn "pixel" is on that sheet
VIEWS = ['front', 'three', 'side', 'back3', 'back']


def classes(a, whites=True):
    """Which pixels are the cream card, which are the soft grey shadows under the feet.
    With whites=False, pure white counts as paper too (the margin around the cards)."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3
    sat = a.max(axis=2) - a.min(axis=2)
    paper = (lum > 236) & (sat < 22)
    if whites:
        # cream only: a solid patch of pure white (a shoe sole, a T-shirt) is part of a figure. Thin white rims
        # around a figure are just the picture's compression, so a patch has to survive being worn down first.
        white = paper & (b > 246)
        i = Image.fromarray((white * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
        paper &= ~(np.asarray(i) > 127)
    shadow = (lum > 178) & (lum <= 236) & (sat < 40) & (r >= g + 3) & (g >= b + 3)      # a warm light grey
    return paper, shadow


def runs(v, minlen, mingap):
    out, s, gap = [], None, 0
    for i, x in enumerate(v):
        if x:
            if s is None: s = i
            gap = 0
        elif s is not None:
            gap += 1
            if gap >= mingap:
                if i - gap - s + 1 >= minlen: out.append((s, i - gap + 1))
                s = None
    if s is not None and len(v) - s >= minlen: out.append((s, len(v)))
    return out


def opening(m):
    i = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    return np.asarray(i) > 127


def grow(seed, allowed):
    """Everything in `allowed` that connects to `seed`."""
    cur = seed & allowed
    while True:
        nxt = cur.copy()
        nxt[1:] |= cur[:-1]; nxt[:-1] |= cur[1:]; nxt[:, 1:] |= cur[:, :-1]; nxt[:, :-1] |= cur[:, 1:]
        nxt &= allowed
        if (nxt == cur).all(): return cur
        cur = nxt


def split(cols, profile, n):
    """Make sure a row has n figures: cut the widest run at its thinnest point until it does."""
    cols = list(cols)
    while len(cols) < n:
        k = max(range(len(cols)), key=lambda i: cols[i][1] - cols[i][0])
        c0, c1 = cols[k]
        pad = (c1 - c0) // 5
        cut = c0 + pad + int(np.argmin(profile[c0 + pad:c1 - pad]))
        cols[k:k + 1] = [(c0, cut), (cut + 1, c1)]
    return cols


def layout(a):
    """Find every figure on the sheet: {name: {'turn': [boxes], 'act': [boxes], 'face': [boxes]}}, boxes as x0,y0,x1,y1."""
    paper, shadow = classes(a, whites=False)
    fg = ~paper & ~shadow
    found = {}
    k = lambda v: int(round(v * K))
    for j, (y0, y1) in enumerate(CARDS_Y):
        for i, (x0, x1) in enumerate(CARDS_X):
            x0, x1, y0, y1 = k(x0), k(x1), k(y0), k(y1)
            m = opening(fg[y0:y1, x0:x1])
            bands = [r for r in runs(m.sum(axis=1) > 2 * K, k(20), k(8)) if r[1] - r[0] >= 60 * K]
            assert len(bands) == 3, (NAMES[j][i], bands)
            rows = {}
            for key, (ra, rb), n in zip(('turn', 'act', 'face'), bands, (5, 4, 5)):
                prof = m[ra:rb].sum(axis=0)
                cols = split(runs(prof > K, k(8), k(5)), prof, n)
                assert len(cols) == n, (NAMES[j][i], key, cols)
                rows[key] = [(x0 + c0, y0 + ra, x0 + c1, y0 + rb) for c0, c1 in cols]
            found[NAMES[j][i]] = rows
    return found


def phase(profile, p):
    """Where the drawn pixel grid starts: the offset at which the strongest edges fall on cell borders."""
    x = np.arange(len(profile))
    z = (profile * np.exp(-2j * np.pi * x / p)).sum()
    return (np.angle(z) / (2 * np.pi) * p) % p


def cut(a, box, margin=None, fill_below=None, feet=True):
    """One figure as a small RGBA picture on the sheet's own pixel grid.
    fill_below: from this fraction of the height down, close gaps that have figure on both sides (white leggings
    that the cream paper would otherwise eat into). feet: clear the last traces of the ground shadow."""
    P = PIXEL * K
    if margin is None: margin = int(round(5 * K))
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = max(0, x0 - margin), max(0, y0 - margin), min(a.shape[1], x1 + margin), min(a.shape[0], y1 + margin)
    c = a[y0:y1, x0:x1]
    paper, shadow = classes(c)
    shadow[:int(c.shape[0] * 0.86)] = False            # shadows lie under the feet; higher up that grey is clothing
    passable = paper | shadow
    border = np.zeros_like(passable); border[0] = border[-1] = True; border[:, 0] = border[:, -1] = True
    solid = ~grow(border, passable)
    # keep the one figure: whatever is connected to the biggest blob (drops sparkles, dust puffs, a neighbour's elbow)
    h, w = solid.shape
    core = opening(solid)
    ys, xs = np.nonzero(core)
    seed = np.zeros_like(solid)
    cy, cx = int(np.median(ys)), int(np.median(xs))
    d = (ys - cy) ** 2 + (xs - cx) ** 2
    seed[ys[d.argmin()], xs[d.argmin()]] = True
    solid = grow(seed, solid)
    if fill_below is not None:
        top = int(h * fill_below)
        for y in range(top, h):
            xs_ = np.nonzero(solid[y])[0]
            if len(xs_) > 1: solid[y, xs_[0]:xs_[-1] + 1] = True
    # What counts towards a cell: the inside of the figure whatever its colour, and at the rim only pixels that
    # are clearly not paper. The rim is where the picture's compression leaves pale smudges.
    inside = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))) > 127
    far = np.abs(c - np.array([253, 247, 240])).sum(axis=2) > 60
    counted = solid & (inside | far)
    # onto the drawn grid
    gx = np.abs(np.diff(c, axis=1)).sum(axis=2).sum(axis=0).astype(float); gx -= gx.mean()
    gy = np.abs(np.diff(c, axis=0)).sum(axis=2).sum(axis=1).astype(float); gy -= gy.mean()
    ox, oy = (phase(gx, P) + 1) % P, (phase(gy, P) + 1) % P      # +1: an edge between x and x+1 is a border at x+1
    nx, ny = int((w - ox) // P), int((h - oy) // P)
    out = np.zeros((ny, nx, 4), np.uint8)
    for j in range(ny):
        ya, yb = int(round(oy + j * P)), int(round(oy + (j + 1) * P))
        for i in range(nx):
            xa, xb = int(round(ox + i * P)), int(round(ox + (i + 1) * P))
            cell = counted[ya:yb, xa:xb]
            if cell.size == 0 or cell.mean() < 0.5: continue
            core = np.zeros_like(cell); core[1:-1, 1:-1] = cell[1:-1, 1:-1]          # prefer the middle of the cell
            px = c[ya:yb, xa:xb][core if core.sum() >= 3 else cell]
            out[j, i, :3] = np.median(px, axis=0); out[j, i, 3] = 255
    ys, xs = np.nonzero(out[..., 3])
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    if feet:                                            # grey scraps of shadow left under the soles
        for j in (-1, -2):
            row = out[j].astype(int)
            grey = (row[:, 3] > 0) & ((row[:, :3].max(axis=1) - row[:, :3].min(axis=1)) < 30) & (row[:, :3].mean(axis=1) < 215)
            if j == -1 or not out[j + 1, :, 3].any(): out[j, grey] = 0
        ys, xs = np.nonzero(out[..., 3])
        out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return Image.fromarray(out, 'RGBA')


def feet_x(im):
    """The middle of the feet: where the figure is planted."""
    al = np.asarray(im)[..., 3] > 0
    xs = np.nonzero(al[-3:].any(axis=0))[0]
    return (xs.min() + xs.max() + 1) / 2


def stride(side, leg_top, reach=4):
    """Two running frames out of the one side view. The legs are sheared: one copy forward, a darker copy back,
    so the figure takes a stride; in the other frame the legs pass under the body and the body rises a pixel."""
    a = np.asarray(side).copy()
    h, w = a.shape[:2]
    top = int(h * leg_top)
    pad = reach + 1
    wide = np.zeros((h + 1, w + 2 * pad, 4), np.uint8)
    def legs(direction, dark):
        layer = np.zeros_like(wide)
        for y in range(top, h):
            dx = int(round(direction * reach * (y - top) / (h - 1 - top)))
            lift = 1 if (direction < 0 and y >= h - 3) else 0                    # the back foot comes off the ground
            row = a[y].copy()
            if dark: row[:, :3] = (row[:, :3] * 0.82).astype(np.uint8)
            layer[y + 1 - lift, pad + dx:pad + dx + w] = row
        return layer
    def over(base, layer):
        m = layer[..., 3] > 0; base[m] = layer[m]
    one = np.zeros_like(wide)
    over(one, legs(-1, True)); over(one, legs(+1, False))
    body = np.zeros_like(wide); body[1:top + 1, pad:pad + w] = a[:top]
    over(one, body)
    two = np.zeros_like(wide); two[0:h, pad:pad + w] = a                           # legs together, one pixel up
    return Image.fromarray(one, 'RGBA'), Image.fromarray(two, 'RGBA')


def sheet(frames, anchors):
    """Lay frames out in a row of equal cells, each figure planted at the bottom centre of its cell."""
    left = max(int(np.ceil(ax)) for ax in anchors)
    right = max(int(np.ceil(f.width - ax)) for f, ax in zip(frames, anchors))
    cw, ch = 2 * max(left, right) + 2, max(f.height for f in frames)
    out = Image.new('RGBA', (cw * len(frames), ch))
    for k, (f, ax) in enumerate(zip(frames, anchors)):
        out.paste(f, (k * cw + cw // 2 - int(round(ax)), ch - f.height))
    return out, cw, ch


LEG_TOP = {'ken': 0.66, 'kel': 0.60, 'leila': 0.62, 'sami': 0.58, 'zofia': 0.62, 'alan': 0.58}     # where the legs start, as a share of the height
FILL = {'kel': 0.55}                                                                                  # white leggings on cream paper
EXTRAS = {'alan': ('drum', 1), 'sami': ('moto', 3), 'zofia': ('cheer', 1), 'kel': ('cheer', 1)}   # a small action pose worth keeping


def main():
    global K
    sheet_file = next((os.path.join(SOURCE, n) for n in ('characters.png', 'characters.webp', 'characters.jpg') if os.path.exists(os.path.join(SOURCE, n))), None)
    if not sheet_file: return print('No character sheet in art/source (characters.png).')
    a = np.asarray(Image.open(sheet_file).convert('RGB')).astype(int)
    K = a.shape[1] / 1536
    found = layout(a)
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    info = {}
    for name in ('ken', 'kel', 'leila', 'alan', 'sami', 'zofia'):
        views = [cut(a, b, fill_below=FILL.get(name)) for b in found[name]['turn']]
        faces = [cut(a, b, feet=False) for b in found[name]['face']]
        extra = [cut(a, found[name]['act'][EXTRAS[name][1]])] if name in EXTRAS else []
        run = list(stride(views[2], LEG_TOP[name]))
        frames = views + run
        anchors = [feet_x(f) for f in views] + [feet_x(run[1])] * 2
        img, cw, ch = sheet(frames, anchors)
        img.save(os.path.join(OUT, 'sprites', f'{name}.png'), optimize=True)
        fimg, fw, fh = sheet(faces, [f.width / 2 for f in faces])
        fimg.save(os.path.join(OUT, 'sprites', f'{name}-faces.png'), optimize=True)
        info[name] = {'file': f'{name}.png', 'w': cw, 'h': ch, 'fps': 7,
                      'poses': {'front': [0], 'stand': [1], 'side': [2], 'back': [4], 'run': [5, 6], 'jump': [5], 'cheer': [0]},
                      'faces': {'file': f'{name}-faces.png', 'w': fw, 'h': fh, 'n': 5}}
        if extra:
            extra[0].save(os.path.join(OUT, 'sprites', f'{name}-{EXTRAS[name][0]}.png'), optimize=True)
            info[name]['extra'] = {'name': EXTRAS[name][0], 'file': f'{name}-{EXTRAS[name][0]}.png', 'w': extra[0].width, 'h': extra[0].height}
        print(name, 'cell', cw, 'x', ch, '| faces', fw, 'x', fh, '| extra', extra[0].size if extra else '-')
    # Kellyn's star: the bright yellow thing beside her last action pose
    x0, y0, x1, y1 = found['kel']['act'][3]
    m = int(8 * K)
    reg = a[y0 - m:y1 + m, x0 - m:x1 + 2 * m]
    ys, xs = np.nonzero((reg[..., 0] > 225) & (reg[..., 1] > 180) & (reg[..., 2] < 95))
    star = cut(a, (x0 - m + xs.min() - 2, y0 - m + ys.min() - 2, x0 - m + xs.max() + 3, y0 - m + ys.max() + 3), margin=int(4 * K), feet=False)
    star.save(os.path.join(OUT, 'sprites', 'star.png'), optimize=True)
    info['star'] = {'file': 'star.png', 'w': star.width, 'h': star.height}
    print('star', star.size)
    with open(os.path.join(OUT, 'sprites.js'), 'w') as f:
        f.write('// Written by tools/sprites.py: the characters cut from the character sheet.\n')
        f.write('window.SPRITES = ' + json.dumps(info, indent=2) + ';\n')


if __name__ == '__main__':
    sys.exit(main())
