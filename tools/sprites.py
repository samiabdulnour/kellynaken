#!/usr/bin/env python3
"""Cut the characters out of the character sheet and turn them into sprites for the game.

    python3 tools/sprites.py

Reads art/source/characters.png (or .webp): six cards (Leila, Sami, Žofia / Kendrick, Kellyn, Alan), each with a row of five
big standing figures (front, three-quarter, side, back three-quarter, back), a row of four small action poses and
a row of five faces.

For each character it writes game/assets/sprites/<id>.png (the big figures, plus running frames made from the
side view) and <id>-faces.png, and it writes game/assets/sprites.js to say what is where.

It also reads art/source/poses/A1.png ... A6.png: rows of four drawn poses for the two heroes (running, jumping,
dizzy, cheering, surfing, shooting or throwing, drumming), already cut out and drawn much finer, about 105 pixels
tall. Those become <id>-poses.png and are what the game draws the heroes from; the game shows them at half size,
two of their pixels to one pixel of a background.

The big figures are the base: they are the most detailed drawings on the sheet, about 45 game pixels tall.
The sheet is drawn in big square "pixels" (about 4.4 real pixels wide on a sheet 1536 wide), so each figure is
sampled back down onto that grid; nothing is redrawn. A sharper or larger sheet gives sharper sprites.
"""
import colorsys, json, os, sys
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


# ---- the drawn poses: rows of four figures, already cut out, drawn about 105 game-art pixels tall ----
POSES = os.path.join(SOURCE, 'poses')
POSE_ROWS = {                                   # which row holds which frames, for each hero
    'ken': [('A1', ['run', 'run', 'run', 'run']), ('A2', ['jump', 'dizzy', 'cheer', 'surf']), ('A3', ['aim', 'shoot', 'drum', 'drum'])],
    'kel': [('A4', ['run', 'run', 'run', 'run']), ('A5', ['jump', 'dizzy', 'cheer', 'surf']), ('A6', ['aim', 'shoot', 'drum', 'drum'])],
}
POSE_PIXEL = 6.0                                # how wide one drawn "pixel" is in those rows


def shrink(a, p=POSE_PIXEL):
    """An RGBA cut-out sampled down onto its own pixel grid: the middle of each patch, as for the scenes."""
    h, w = a.shape[:2]
    nx, ny = int(w // p), int(h // p)
    xs = ((np.arange(nx) + 0.5) * p).astype(int); ys = ((np.arange(ny) + 0.5) * p).astype(int)
    taps = [a[np.clip(ys + dy, 0, h - 1)][:, np.clip(xs + dx, 0, w - 1)] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    out = np.median(np.stack(taps).astype(int), axis=0).astype(np.uint8)
    out[..., 3] = np.where(out[..., 3] > 127, 255, 0)
    return out


def soften(img):
    """No black outlines: the dark ring round a figure becomes a darker shade of the colour just inside it,
    as on the character sheets. Dark clothes stay dark: only the outer one or two pixels are touched, and the
    second only where the colour inside is clearly lighter."""
    a = np.asarray(img).astype(int).copy()
    op = a[..., 3] > 0
    lum = a[..., :3].mean(axis=2)
    h, w = op.shape
    def shift(m, dy, dx):
        out = np.zeros_like(m)
        out[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = m[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
        return out
    N4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    outside = ~op
    edge = op & np.any([shift(outside, dy, dx) for dy, dx in N4], axis=0)
    ring1 = edge & (lum < 72)
    near1 = np.any([shift(ring1, dy, dx) for dy, dx in N4], axis=0)
    ring2 = op & ~ring1 & near1 & (lum < 72)
    ring = ring1 | ring2
    keep = op & ~ring
    ys, xs = np.nonzero(ring)
    for y, x in zip(ys, xs):
        for r in (1, 2, 3):
            y0, y1, x0, x1 = max(0, y - r), min(h, y + r + 1), max(0, x - r), min(w, x + r + 1)
            m = keep[y0:y1, x0:x1]
            if m.any():
                c = np.median(a[y0:y1, x0:x1, :3][m], axis=0)
                if ring2[y, x] and c.mean() - lum[y, x] < 45:                       # dark clothes, not an outline
                    break
                a[y, x, :3] = (c * 0.6).astype(int)
                break
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def pose_frames(name):
    """Every drawn pose of one hero as (pose, picture, where the body's middle is, how far the feet are off the ground)."""
    frames = []
    for code, poses in POSE_ROWS[name]:
        path = os.path.join(POSES, code + '.png')
        if not os.path.exists(path): return None
        a = np.asarray(Image.open(path).convert('RGBA'))
        al = a[..., 3] > 0
        cols = runs(al.sum(axis=0) > 0, 40, 12)
        assert len(cols) == len(poses), (code, cols)
        ground = max(np.nonzero(al[:, c0:c1].any(axis=1))[0].max() for c0, c1 in cols) + 1     # the line they all stand on
        for pose, (c0, c1) in zip(poses, cols):
            rows = np.nonzero(al[:, c0:c1].any(axis=1))[0]
            small = shrink(a[rows.min():rows.max() + 1, c0:c1])
            op = small[..., 3] > 0
            h = small.shape[0]
            band = op[int(h * 0.15):int(h * 0.5)]                        # the head and shoulders: steadier than hands, feet or a hockey stick
            xs = np.nonzero(band)[1]
            lift = 0 if pose == 'jump' else int(round((ground - 1 - rows.max()) / POSE_PIXEL))
            frames.append((pose, soften(Image.fromarray(small, 'RGBA')), float(np.median(xs)) + 0.5, lift))
    return frames


def pose_sheet(name):
    """One row of equal cells with every drawn pose of a hero, each planted at the bottom centre of its cell."""
    frames = pose_frames(name)
    if not frames: return None
    left = max(int(np.ceil(ax)) for _, f, ax, _ in frames)
    right = max(int(np.ceil(f.width - ax)) for _, f, ax, _ in frames)
    cw, ch = 2 * max(left, right) + 2, max(f.height + lift for _, f, _, lift in frames)
    # Standing still: no drawn pose for it yet, so the mid-step running frame, set down on the ground.
    step = [fr for fr in frames if fr[0] == 'run'][1]
    frames.append(('stand', step[1], step[2], 0))
    out = Image.new('RGBA', (cw * len(frames), ch))
    poses = {}
    for k, (pose, f, ax, lift) in enumerate(frames):
        out.paste(f, (k * cw + cw // 2 - int(round(ax)), ch - f.height - lift))
        poses.setdefault(pose, []).append(k)
    out.save(os.path.join(OUT, 'sprites', f'{name}-poses.png'), optimize=True)
    # faces for the speech box, the buttons and the turn sign: the head of the first running frame, drawn as finely as the poses
    run0 = np.asarray([fr for fr in frames if fr[0] == 'run'][0][1])
    top = run0[:int(run0.shape[0] * HEAD_SHARE.get(name, 0.46))].copy()
    biggest = max(pieces(top[..., 3] > 0, 1), key=len, default=[])                 # just the head: no stray fist or sleeve
    keep = np.zeros(top.shape[:2], bool)
    for y, x in biggest: keep[y, x] = True
    top[~keep] = 0
    ys, xs = np.nonzero(top[..., 3])
    head = Image.fromarray(top[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
    fimg = Image.new('RGBA', (head.width * 5, head.height))
    for k in range(5): fimg.paste(head, (k * head.width, 0))
    fimg.save(os.path.join(OUT, 'sprites', f'{name}-heads.png'), optimize=True)
    return {'file': f'{name}-poses.png', 'w': cw, 'h': ch, 'scale': 0.5, 'fps': 9, 'poses': poses,
            'faces': {'file': f'{name}-heads.png', 'w': head.width, 'h': head.height, 'n': 5, 'scale': 0.36}}


HEAD_SHARE = {'ken': 0.47, 'kel': 0.45}         # how much of a running frame, from the top, is the head (hair included)


def bunny():
    """Kellyn's bunny, lifted out of her wind-up pose where it hangs from her hand: the white and pink thing behind her."""
    frames = pose_frames('kel')
    if not frames: return None
    pose, f, ax, _ = next(fr for fr in frames if fr[0] == 'aim')
    a = np.asarray(f).astype(int)
    h, w = a.shape[:2]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    light = (a[..., 3] > 0) & (r > 190) & (g > 110) & (b > 155)                 # white fur and pink bow; not hair, not skin
    zone = np.zeros_like(light); zone[int(h * 0.24):int(h * 0.74), :int(ax - 8)] = True
    m = light & zone                                                            # nothing else of hers is that pale back there
    # keep the one big piece (corners count as touching); a loose ear tip behind her hair is dropped
    ys, xs = np.nonzero(m)
    cur = np.zeros_like(m); cur[int(np.median(ys)):, :] = m[int(np.median(ys)):, :] & (np.arange(w) == int(np.median(xs)))[None, :]
    while True:
        nxt = cur.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                sh = np.zeros_like(cur)
                sh[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = cur[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
                nxt |= sh
        nxt &= m
        if (nxt == cur).all(): break
        cur = nxt
    m = cur
    # its eyes and nose are dark: fill what the fur surrounds on all four sides
    left = np.maximum.accumulate(m, axis=1); right = np.maximum.accumulate(m[:, ::-1], axis=1)[:, ::-1]
    up = np.maximum.accumulate(m, axis=0); down = np.maximum.accumulate(m[::-1], axis=0)[::-1]
    m = m | (left & right & up & down & zone & (a[..., 3] > 0))
    ys, xs = np.nonzero(m)
    out = np.zeros((h, w, 4), np.uint8); out[m] = a[m].astype(np.uint8)
    out = Image.fromarray(out[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
    out.save(os.path.join(OUT, 'sprites', 'bunny.png'), optimize=True)
    return {'file': 'bunny.png', 'w': out.width, 'h': out.height, 'scale': 0.5}


# ---- objects: rows of separate things on a transparent background, from art/source/objects/<code>.png ----
OBJECTS = os.path.join(SOURCE, 'objects')
OBJECT_ROWS = {                                  # code: (name in the game, what each drawing is: row by row, left to right)
    'P8': ('koalas', ['peek', 'side', 'branch', 'wave', 'happy', 'leaves']),
    'P7': ('things', ['stick', 'puck', 'puckfly', 'flash', 'bunny', 'bunnyfly', 'bunnyflip', 'fluff']),
    'P1': ('prague', ['pigeon', 'pigeonfly', 'puddle', 'padlock', 'key', 'scissors', 'dryer', 'comb']),
    'P3': ('aussie', ['fin', 'fin2', 'boomerang', 'boomerang2', 'surfboard', 'roo', 'roohop', 'palm']),
    'P5': ('strahov', ['bassdrum', 'snare', 'cymbal', 'sticks', 'note', 'amp', 'cone', 'crow']),
    'P9': ('stations', ['wash', 'cut', 'dye', 'dry', 'pay']),
    'P10': ('customers', ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5']),
    'P16': ('parrot', ['parrot1', 'parrot2']),                                      # a rainbow lorikeet, the danger to duck under at sea
    'P17': ('street', ['car1', 'car2', 'bench', 'bin', 'wall', 'salon', 'coin', 'heart']),   # the walk down the street: things to climb, the salon's door
    'P18': ('hill', ['stones', 'boulder', 'logs', 'spruce', 'gatel', 'gater']),
    'P19': ('furniture', ['sofa', 'armchair', 'lamp', 'table', 'chair', 'shelf', 'rugroll', 'plant']),   # second-hand furniture on a Sydney kerb
    'P20': ('kerb', ['bed', 'rug', 'tv', 'box', 'ibis', 'ibisfly', 'magpie1', 'magpie2']),               # the bed and the rug laid flat, junk, and the street's birds                # the walk up the hill: stone walls, a boulder, logs, the cones' spruce, the stadium gate
    'P11': ('beach', ['bottle', 'paper', 'shell', 'star', 'crab', 'jelly', 'buoy', 'raft']),
    'P12': ('salonkit', ['scissors', 'comb', 'brush', 'dryer', 'spray', 'dye', 'curlers', 'clip', 'mirror', 'shampoo']),
    'P13': ('dog', ['stand', 'trot1', 'trot2', 'sit', 'bark', 'sniff']),          # praděda Václav's Yorkshire terrier
    'P14': ('voyage', ['ship', 'smoke', 'gull1', 'gull2']),                        # the intro to Australia: the refugee ship
    'P23': ('bondi', ['castle', 'castle2', 'rocks', 'esky', 'boards', 'chair', 'umbrella', 'boat']),       # the walk along Bondi Beach: things to climb (a big and a small sandcastle, a lifeguard's high chair, a beach umbrella to bounce on, a washed-up boat)
    'P22': ('bondilife', ['crab1', 'crab2', 'crabhide', 'scrap', 'wave', 'gull', 'gullup', 'gulldown', 'gulldive', 'gullpaper']),   # its crabs (walking, hiding in the sand), a scrap of the message, a wave washing in, and silver gulls
}


def grid(a):
    """How wide one drawn "pixel" is: the spacing at which the colour edges down the picture line up best."""
    d = np.abs(np.diff(a[..., :3].astype(int), axis=0)).sum(axis=2)
    prof = d.sum(axis=1).astype(float); prof -= prof.mean(); x = np.arange(len(prof))
    best = max((abs((prof * np.exp(2j * np.pi * x / p)).sum()), p) for p in np.arange(3.5, 9, 0.02))
    return best[1]


def pieces(mask, least):
    """The separate things in a picture: groups of touching pixels (corners count), smallest scraps joined to the
    nearest bigger group. Returned left to right, as lists of (y, x)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    groups = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]: continue
        stack, got = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop(); got.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    v, u = y + dy, x + dx
                    if 0 <= v < h and 0 <= u < w and mask[v, u] and not seen[v, u]: seen[v, u] = True; stack.append((v, u))
        groups.append(got)
    big = [g for g in groups if len(g) >= least]
    for g in groups:
        if len(g) >= least: continue
        cy, cx = np.mean(g, axis=0)
        near = min(big, key=lambda b: min((y - cy) ** 2 + (x - cx) ** 2 for y, x in b[::7]))
        near.extend(g)
    # row by row, then left to right: a group belongs to the row of whichever earlier group its middle lines up with
    big.sort(key=lambda g: np.mean([y for y, _ in g]))
    rows = []
    for g in big:
        cy = np.mean([y for y, _ in g]); top, bottom = min(y for y, _ in g), max(y for y, _ in g)
        row = next((r for r in rows if r['top'] <= cy <= r['bottom']), None)
        if row: row['groups'].append(g); row['top'] = min(row['top'], top); row['bottom'] = max(row['bottom'], bottom)
        else: rows.append({'top': top, 'bottom': bottom, 'groups': [g]})
    return [g for r in rows for g in sorted(r['groups'], key=lambda g: min(x for _, x in g))]


def object_sheet(code):
    """Cut a row of objects apart, bring them down to their own pixel grid and lay them out in equal cells, each
    standing on the bottom middle of its cell."""
    path = os.path.join(OBJECTS, code + '.png')
    if not os.path.exists(path): return None
    name, parts = OBJECT_ROWS[code]
    a = np.asarray(Image.open(path).convert('RGBA')).copy()
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    a[((r + b) / 2 - g > 70) & (r > 140) & (b > 140) & (abs(r - b) < 90)] = 0          # a magenta background, where there is one
    a[a[..., 3] < 128] = 0                              # these come with soft, faint edges: keep only what is clearly there
    p = grid(a)
    small = shrink(a, p)                                # the whole row at once, so every thing keeps the same grid
    sizes = sorted(len(g) for g in pieces(small[..., 3] > 0, 1))
    groups = pieces(small[..., 3] > 0, max(40, int(np.median(sizes[-len(parts):]) * 0.12)))   # scraps (a jellyfish's tentacles) join the nearest thing
    assert len(groups) == len(parts), (code, [len(g) for g in groups])
    frames = []
    for g in groups:
        ys, xs = np.array([y for y, _ in g]), np.array([x for _, x in g])
        if len(ys) < 1: continue
        f = np.zeros((ys.max() - ys.min() + 1, xs.max() - xs.min() + 1, 4), np.uint8)
        f[ys - ys.min(), xs - xs.min()] = small[ys, xs]
        frame = soften(Image.fromarray(f, 'RGBA')) if name == 'customers' else Image.fromarray(f, 'RGBA')
        frames.append(scale2x(frame) if name in OBJECT_FINER else frame)
    if name in OBJECT_FIX: frames = OBJECT_FIX[name](frames, parts)
    cw, ch = max(f.width for f in frames), max(f.height for f in frames)
    out = Image.new('RGBA', (cw * len(frames), ch))
    for k, f in enumerate(frames): out.paste(f, (k * cw + (cw - f.width) // 2, ch - f.height))
    out.save(os.path.join(OUT, 'sprites', f'{name}.png'), optimize=True)
    print(name, 'from', code, '| drawn pixel', round(p, 2), '| cell', cw, 'x', ch, '|', [f.size for f in frames])
    poses = {part: [k] for k, part in enumerate(parts)}; poses.setdefault('stand', [0])      # drawn like a character, one pose per drawing
    sizes = {part: [f.width, f.height] for part, f in zip(parts, frames)}                  # each drawing's own size within its cell
    return name, {'file': f'{name}.png', 'w': cw, 'h': ch, 'scale': OBJECT_SCALE.get(name, 0.5), 'fps': 1, 'poses': poses, 'sizes': sizes}


def czech_flag(frames, parts):
    """The stadium gate's flag came out white over red: give it the Czech flag's blue wedge at the pole."""
    f = frames[parts.index('gater')]
    a = np.asarray(f).copy()
    top = a[: a.shape[0] // 3]
    r, g, b, al = (top[..., i].astype(int) for i in range(4))
    flag = (al > 0) & (((r > 150) & (g < 100)) | ((r > 200) & (g > 200) & (b > 200)))
    ys, xs = np.nonzero(flag)
    if not len(ys): return frames
    y0, y1, x0, length = ys.min(), ys.max(), xs.min(), xs.max() - xs.min() + 1
    mid, half = (y0 + y1) / 2, max(1, (y1 - y0) / 2)
    for y, x in zip(ys, xs):
        if x - x0 < length * 0.5 * (1 - abs(y - mid) / (half + 0.5)): a[y, x] = (31, 78, 156, 255)
    frames[parts.index('gater')] = Image.fromarray(a, 'RGBA')
    return frames


def unfringe(frames, parts):
    """The magenta background bleeds into a few edge pixels (pink dots on a white wing or a red claw, purple on a
    dark wing tip): each takes the commonest colour of its clean neighbours, or goes if it has none."""
    out = []
    for f in frames:
        a = np.asarray(f).astype(int).copy()
        for _ in range(3):
            r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
            mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
            hue = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
            bad = (al > 0) & (r - g > 12) & (b - g > 6) & (mx - mn > 12) & (hue > 275) & (hue < 352)
            if not bad.any(): break
            h, w = bad.shape
            for y, x in zip(*np.nonzero(bad)):
                near = [tuple(a[v, u, :3]) for v in range(max(0, y - 1), min(h, y + 2)) for u in range(max(0, x - 1), min(w, x + 2))
                        if (v, u) != (y, x) and a[v, u, 3] and not bad[v, u]]
                if near: a[y, x, :3] = max(set(near), key=near.count)
                else: a[y, x] = 0
        out.append(Image.fromarray(a.astype(np.uint8), 'RGBA'))
    return out


OBJECT_FIX = {'hill': czech_flag, 'bondi': unfringe, 'bondilife': unfringe}
OBJECT_SCALE = {'dog': 0.3, 'customers': 0.25}
# Sheets drawn on a coarser grid than the people, made twice as fine with Scale2x (which rounds off diagonal edges
# rather than just making the pixels bigger), so they can stand as tall as the grown-ups without looking blocky.
OBJECT_FINER = {'customers'}


def scale2x(img):
    """Scale2x (EPX): every pixel becomes four, each taking a neighbour's colour where two neighbours agree."""
    a = np.asarray(img.convert('RGBA')).astype(np.int64)
    key = (a[..., 0] << 24) | (a[..., 1] << 16) | (a[..., 2] << 8) | a[..., 3]
    p = np.pad(key, 1, mode='edge')
    P, A, B, C, D = p[1:-1, 1:-1], p[:-2, 1:-1], p[1:-1, 2:], p[1:-1, :-2], p[2:, 1:-1]          # self, up, right, left, down
    e0 = np.where((C == A) & (C != D) & (A != B), A, P); e1 = np.where((A == B) & (A != C) & (B != D), B, P)
    e2 = np.where((D == C) & (D != B) & (C != A), C, P); e3 = np.where((B == D) & (B != A) & (D != C), D, P)
    h, w = key.shape
    out = np.zeros((h * 2, w * 2), np.int64)
    out[0::2, 0::2], out[0::2, 1::2], out[1::2, 0::2], out[1::2, 1::2] = e0, e1, e2, e3
    rgba = np.stack([(out >> 24) & 255, (out >> 16) & 255, (out >> 8) & 255, out & 255], -1).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')                       # how big a sheet is shown, when not at half size: a Yorkie comes up to the kids' knees


# ---- the grown-ups: a sheet each of eight figures on a transparent background, from art/source/people/<id>.webp ----
PEOPLE = os.path.join(SOURCE, 'people')
PEOPLE_POSES = ['front', 'three', 'side', 'back', 'walk', 'run', 'cheer', 'act']    # top row: from four sides; bottom row: walking, running, a jump for joy, their own thing
PEOPLE_HEIGHT = {'sami': 146, 'alan': 146, 'vaclav': 138, 'leila': 131, 'zofia': 131}   # standing height in sprite pixels: Sami and Alan the biggest, then Václav, then Mamka and Žofia; all well above the heroes
GRADE = set()                                    # sheets whose colours need lifting to the heroes' (the first, darker sheets did)


def box_shrink(a, step):
    """A smooth shrink: each new pixel is the average of the area it covers (transparent parts left out), so
    the sheet's big uneven blocks turn into even, fine pixels like the heroes'."""
    h, w = a.shape[:2]; size = (int(w / step), int(h / step))
    rgb = np.asarray(Image.fromarray((a[..., :3] * (a[..., 3:4] / 255)).astype(np.uint8)).resize(size, Image.BOX)).astype(float)
    al = np.asarray(Image.fromarray(a[..., 3]).resize(size, Image.BOX)).astype(float)
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    keep = al > 140
    out[keep, :3] = np.clip(rgb[keep] * 255 / al[keep, None], 0, 255); out[keep, 3] = 255
    return out


def palette(a, n=48):
    """One small palette for a whole sheet, so flat areas are flat and every pose has the same colours."""
    q = np.asarray(Image.fromarray(a, 'RGBA').convert('RGB').quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB'))
    return np.dstack([q, a[..., 3]]).astype(np.uint8)


def tidy(a):
    """A single stray pixel takes the colour that most of its eight neighbours share."""
    out = a.copy(); h, w = a.shape[:2]
    key = (a[..., 0].astype(int) << 16) | (a[..., 1].astype(int) << 8) | a[..., 2]
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if not a[y, x, 3]: continue
            nb, na = key[y - 1:y + 2, x - 1:x + 2].ravel(), a[y - 1:y + 2, x - 1:x + 2, 3].ravel()
            others = [k for i, k in enumerate(nb) if i != 4 and na[i]]
            if len(others) < 8 or key[y, x] in others: continue
            vals, cnt = np.unique(others, return_counts=True)
            if cnt.max() >= 5: out[y, x, :3] = [(vals[cnt.argmax()] >> 16) & 255, (vals[cnt.argmax()] >> 8) & 255, vals[cnt.argmax()] & 255]
    return out


def grade(img, lift=0.17, gamma=0.86, sat=1.12, head=0.3):
    """The heroes' colours: blacks and shadows lifted to a soft charcoal, a little more colour. In the head the
    darkest pixels (eyes, brows) stay as they are."""
    a = np.asarray(img).astype(float).copy(); op = a[..., 3] > 0; h = a.shape[0]
    top = np.zeros_like(op); top[:int(h * head)] = True
    for y, x in zip(*np.nonzero(op)):
        hh, ss, vv = colorsys.rgb_to_hsv(*(a[y, x, :3] / 255))
        if top[y, x] and vv < 0.3: continue
        vv = lift + (1 - lift) * vv ** gamma; ss = min(1, ss * sat)
        a[y, x, :3] = np.array(colorsys.hsv_to_rgb(hh, ss, vv)) * 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def lift_blacks(img, head=0.3):
    """Black clothes become the heroes' soft charcoal (Kendrick's T-shirt): only the darkest colours are lifted,
    and in the head the eyes and brows stay as they are."""
    a = np.asarray(img).astype(float).copy(); h = a.shape[0]
    for y, x in zip(*np.nonzero(a[..., 3])):
        hh, ss, vv = colorsys.rgb_to_hsv(*(a[y, x, :3] / 255))
        if vv >= 0.33 or y < h * head: continue
        a[y, x, :3] = np.array(colorsys.hsv_to_rgb(hh, ss * 0.9, 0.14 + 0.62 * vv)) * 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def unline(img, head=0.3):
    """Thin dark lines inside the body (below the head, where the eyes are) become a darker shade of the colour
    on either side of them, like the outer edge."""
    a = np.asarray(img).astype(int); out = a.copy(); op = a[..., 3] > 0; h, w = op.shape
    lum = a[..., :3].mean(axis=2)
    for y in range(int(h * head), h - 1):
        for x in range(1, w - 1):
            if not op[y, x] or lum[y, x] > 80: continue
            for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
                p, q = (y - dy, x - dx), (y + dy, x + dx)
                if op[p] and op[q] and lum[p] - lum[y, x] > 55 and lum[q] - lum[y, x] > 55:
                    out[y, x, :3] = ((a[p][:3] + a[q][:3]) / 2 * 0.62).astype(int); break
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def people_figures(name, path, rows):
    """The figures of one sheet as (picture, where the body's middle is, how far the feet are off the ground),
    row by row. `rows` says how many figures each row holds; the first row stands, and sets the size."""
    a = np.asarray(Image.open(path).convert('RGBA')).copy()
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    a[((r + b) / 2 - g > 70) & (r > 140) & (b > 140) & (abs(r - b) < 90)] = 0     # a magenta background, where there is one
    a[a[..., 3] < 128] = 0
    a[..., 3] = np.where(a[..., 3] > 0, 255, 0)
    rough = shrink(a, 4.0); first = pieces(rough[..., 3] > 0, 150)[:rows[0]]
    tall = max(max(y for y, _ in g) - min(y for y, _ in g) + 1 for g in first) * 4.0
    small = tidy(palette(box_shrink(a, tall / PEOPLE_HEIGHT[name]), 80))     # even fine pixels and flat colours, like the heroes'
    groups = pieces(small[..., 3] > 0, 150)
    assert len(groups) == sum(rows), (name, path, [len(g) for g in groups])
    frames, k = [], 0
    for n in rows:
        row = groups[k:k + n]; k += n
        ground = max(max(y for y, _ in g) for g in row) + 1
        for g in row:
            ys, xs = np.array([y for y, _ in g]), np.array([x for _, x in g])
            f = np.zeros((ys.max() - ys.min() + 1, xs.max() - xs.min() + 1, 4), np.uint8)
            f[ys - ys.min(), xs - xs.min()] = small[ys, xs]
            h = f.shape[0]
            band = f[int(h * 0.15):int(h * 0.5), :, 3] > 0                     # head and shoulders: where the body is, whatever the arms do
            ax = float(np.median(np.nonzero(band)[1])) + 0.5
            fig = Image.fromarray(f, 'RGBA')
            fig = grade(fig) if name in GRADE else lift_blacks(fig)
            frames.append((unline(soften(fig)), ax, int(ground - 1 - ys.max())))
    return frames


def people_sheet(name):
    """Cut the figures of one grown-up and lay them out like the heroes' poses, shown at half size like them.
    Their sheets are brought to the heroes' look: shrunk smoothly into even fine pixels, given flat colours,
    blacks lifted to soft charcoal, and every dark outline, outside and in, turned into a darker shade of its
    own colour.

    <name>.webp holds eight figures in two rows (front, three-quarter, side, back; walking, running, a jump for
    joy, their own thing). <name>-stand.webp, where there is one, holds five standing figures in one row (front,
    three-quarter, side, back three-quarter, back), drawn closer to the heroes: they take over the standing views
    and the face, and the first sheet keeps the moving poses."""
    find = lambda stem: next((os.path.join(PEOPLE, f'{stem}.{ext}') for ext in ('png', 'webp') if os.path.exists(os.path.join(PEOPLE, f'{stem}.{ext}'))), None)
    path, stand = find(name), find(name + '-stand')
    if not path and not stand: return None
    if stand:
        st = people_figures(name, stand, [5])
        moving = people_figures(name, path, [4, 4])[4:] if path else [st[0], st[1], st[0], st[0]]   # with no moving poses, standing ones stand in
        frames = [st[0], st[1], st[2], st[4]] + moving
    else:
        frames = people_figures(name, path, [4, 4])
    left = max(int(np.ceil(ax)) for _, ax, _ in frames)
    right = max(int(np.ceil(f.width - ax)) for f, ax, _ in frames)
    cw, ch = int(2 * max(left, right) + 2), int(max(f.height + lift for f, _, lift in frames))
    out = Image.new('RGBA', (cw * len(frames), ch))
    for k, (f, ax, lift) in enumerate(frames): out.paste(f, (k * cw + cw // 2 - int(round(ax)), ch - f.height - lift))
    out.save(os.path.join(OUT, 'sprites', f'{name}-poses.png'), optimize=True)
    poses = {p: [k] for k, p in enumerate(PEOPLE_POSES)}
    poses.update(stand=[1], run=[4, 5])
    if stand: poses.update(cheer=[0], joy=[6])        # the old jump for joy looks different now: they cheer with the new front view (the game makes it hop)
    # faces for the speech box and the album: the head of the front view, and of the jump for joy for laughing
    def head(f):
        a = np.asarray(f); h = a.shape[0]
        rows = a[:int(h * 0.42)]
        xs = np.nonzero(rows[..., 3].any(axis=0))[0]
        return Image.fromarray(rows[:, xs.min():xs.max() + 1], 'RGBA')
    front, joy = head(frames[0][0]), head(frames[6][0])
    heads = [front] * 5                                                            # one face for every mood: the jump for joy has fists in the way
    fw, fh = max(i.width for i in heads), max(i.height for i in heads)
    fimg = Image.new('RGBA', (fw * len(heads), fh))
    for k, i in enumerate(heads): fimg.paste(i, (k * fw + (fw - i.width) // 2, fh - i.height))
    fimg.save(os.path.join(OUT, 'sprites', f'{name}-heads.png'), optimize=True)
    print('   drawn figures:', name, 'cell', cw, 'x', ch, '| heights', [f.height for f, _, _ in frames])
    return {'file': f'{name}-poses.png', 'w': cw, 'h': ch, 'scale': 0.5, 'fps': 6, 'poses': poses,
            'faces': {'file': f'{name}-heads.png', 'w': fw, 'h': fh, 'n': len(heads), 'scale': 0.36}}


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
        drawn = pose_sheet(name) if name in POSE_ROWS else people_sheet(name)
        if drawn:                                       # the drawn poses take over; the sheet's figures stay as `still`
            info[name] = dict(drawn, faces=drawn.get('faces') or info[name]['faces'], still={k: info[name][k] for k in ('file', 'w', 'h', 'fps', 'poses')})
            print('   drawn poses:', {k: len(v) for k, v in drawn['poses'].items()}, 'cell', drawn['w'], 'x', drawn['h'])
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
    b = bunny()
    if b: info['bunny'] = b; print('bunny', b['w'], 'x', b['h'])
    for name in ('vaclav',):                          # people who are only on sheets of their own
        p = people_sheet(name)
        if p: info[name] = p
    for code in OBJECT_ROWS:
        got = object_sheet(code)
        if got: info[got[0]] = got[1]
    import storeys                                    # Sami's tower in Sydney: drawn in code, so every storey stacks exactly
    info['storeys'] = storeys.sheet(os.path.join(OUT, 'sprites'))
    import seated                                     # the salon's customers sitting down, made from their standing sheet
    if 'customers' in info: info['seated'] = seated.sheet(os.path.join(OUT, 'sprites'))
    with open(os.path.join(OUT, 'sprites.js'), 'w') as f:
        f.write('// Written by tools/sprites.py: the characters cut from the character sheet.\n')
        f.write('window.SPRITES = ' + json.dumps(info, indent=2) + ';\n')


if __name__ == '__main__':
    sys.exit(main())
