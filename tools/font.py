#!/usr/bin/env python3
"""Make the game's font, Kellyn Pixel: Pixelify Sans with a C that is open and a Z that is not a 2.

    python3 tools/font.py [path/to/PixelifySans[wght].ttf]

Pixelify Sans (Stefie Justprince, SIL Open Font License 1.1) is a good pixel font for the game, but two of its
capitals are hard for a child to read: its C is an O with a sliver cut out of the right side (at the bold weight
the gap is a third of a pixel, so CELÝ reads OELÝ) and its Z is drawn like the digit 2, with a rounded top
(ZNOVU reads 2NOVU). The small c has the same closed-up opening; the small z is fine and stays.

This takes the variable font from google/fonts (ofl/pixelifysans; downloaded when no path is given), makes the
two weights the game uses (400 and 700) and draws C, Z and c again on the font's own pixel grid. Every letter of
Pixelify Sans is a set of cells on a 5 x 7 grid, each cell a square "pixel" a little bigger than the grid step,
so neighbouring cells overlap (that is what makes the strokes heavier at 700). The grid is read off the font
itself and checked by redrawing O, N, X, z and the old C, Z, c from their cells and comparing the shapes.
Advance widths and side bearings stay as they were, so no text in the game moves. Č Ć Ž Ź Ż č ć are made of
C, Z, c plus an accent in the font, so they follow.

The changed fonts have a name of their own, Kellyn Pixel. The licence reserves no font name, so this is not a
must, but it keeps them from being taken for the real Pixelify Sans (a trademark of its author). The copyright
and licence notices stay in the fonts, and the licence goes next to them. Writes game/assets/fonts/
KellynPixel-Regular.woff2, KellynPixel-Bold.woff2 and OFL.txt, the same bytes every time for the same source.
Needs fontTools, brotli and skia-pathops (pip install fonttools brotli skia-pathops).
"""
import hashlib, io, os, sys, tempfile, urllib.request

import pathops
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'game', 'assets', 'fonts')
FAMILY = 'Kellyn Pixel'
SOURCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/pixelifysans/'
FONT_FILE, LICENCE_FILE = 'PixelifySans[wght].ttf', 'OFL.txt'
FONT_SHA = '9ba86cd010a4de309d263ceff8e8044092c9db7efda869620cb9ff1c4389e8a5'   # the version the game was made with
WEIGHTS = {400: 'Regular', 700: 'Bold'}

# Cells drawn top row first; the bottom row sits on the baseline. Capitals use seven rows, small letters five.
OLD = {   # how Pixelify Sans draws them: used to check that the grid is read right
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'N': ['#...#', '##..#', '#.#.#', '#.#.#', '#.#.#', '#..##', '#...#'],
    'X': ['#...#', '.#.#.', '.#.#.', '..#..', '.#.#.', '.#.#.', '#...#'],
    'z': ['#####', '...#.', '..#..', '.#...', '#####'],
    'C': ['.###.', '#...#', '#...#', '#....', '#...#', '#...#', '.###.'],   # one cell open, less than a pixel once drawn
    'Z': ['####.', '#...#', '....#', '.###.', '#....', '#...#', '.####'],   # a 2 with square corners
    'c': ['.###.', '#...#', '#....', '#...#', '.###.'],
}
NEW = {
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],   # open three cells, like every pixel C
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],   # straight bar, straight diagonal, straight bar
    'c': ['.###.', '#...#', '#....', '#....', '.###.'],                     # open two cells below the curl, like e upside down
}


def static(src, weight):
    """One weight of the variable font, saved and read back so that its points are whole numbers, as in the file."""
    buf = io.BytesIO()
    instancer.instantiateVariableFont(TTFont(src, recalcTimestamp=False), {'wght': weight}).save(buf)
    buf.seek(0)
    return TTFont(buf, recalcTimestamp=False)   # keeps the source's date, so a rerun writes the same files


def fetch():
    folder = tempfile.mkdtemp(prefix='pixelify-')
    for name in (FONT_FILE, LICENCE_FILE):
        url = SOURCE + name.replace('[', '%5B').replace(']', '%5D')
        print('downloading', url)
        urllib.request.urlretrieve(url, os.path.join(folder, name))
    return os.path.join(folder, FONT_FILE)


def outline(font, name):
    """A glyph as a pathops path, accents and all."""
    gs = font.getGlyphSet()
    rec = DecomposingRecordingPen(gs)
    gs[name].draw(rec)
    path = pathops.Path()
    rec.replay(path.getPen())
    return path


def grid(font):
    """Where the cells are. Each column k covers x from xs[k] to xe[k], each row j covers y from ys[j] to ye[j].
    Cells are bigger than the step between them, so in sorted order the edges go
    start0 start1 end0 start2 end1 ... start(n-1) end(n-2) end(n-1)."""
    xs, ys = set(), set()
    for name in ('O', 'N', 'X'):
        for contour in outline(font, name).contours:
            for verb, pts in contour.segments:
                for x, y in pts:
                    xs.add(x); ys.add(y)
    def split(edges, n):
        edges = sorted(edges)
        if len(edges) != 2 * n:
            raise SystemExit(f'expected {2 * n} distinct edges on the grid, found {edges}')
        starts = [edges[0]] + [edges[2 * k - 1] for k in range(1, n)]
        ends = [edges[2 * k] for k in range(1, n)] + [edges[-1]]
        return starts, ends
    return split(xs, 5), split(ys, 7)


def cells_path(rows, cols_rows_grid):
    (xs, xe), (ys, ye) = cols_rows_grid
    path = pathops.Path()
    pen = path.getPen()
    for i, row in enumerate(rows):
        j = len(rows) - 1 - i
        for k, ch in enumerate(row):
            if ch == '#':
                pen.moveTo((xs[k], ys[j])); pen.lineTo((xs[k], ye[j])); pen.lineTo((xe[k], ye[j])); pen.lineTo((xe[k], ys[j])); pen.closePath()
    path.simplify(fix_winding=True, keep_starting_points=False, clockwise=True)
    return path


def same(a, b):
    return pathops.op(a, b, pathops.PathOp.XOR).area == 0


def rename(font, style, weight):
    full, ps = f'{FAMILY} {style}', f'{FAMILY.replace(" ", "")}-{style}'
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (3, 16, 17, 21, 22, 25) or rec.nameID > 255:   # 256 and up named the weights of the variable font
            name.removeNames(nameID=rec.nameID)
    if 'STAT' in font:
        del font['STAT']
    for nid, text in {
        1: FAMILY, 2: style, 3: f'1.000;{ps}', 4: full, 6: ps,
        5: 'Version 1.000; Pixelify Sans 1.000 with C, c and Z drawn again',
        10: 'Pixelify Sans by Stefie Justprince, with the letters C, c and Z drawn again so that they cannot be '
            'taken for O, o and 2. Made for the game Kellyn a Ken (tools/font.py).',
    }.items():
        name.setName(text, nid, 3, 1, 0x409)
    os2 = font['OS/2']
    os2.usWeightClass = weight
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if weight == 700 else 0b1000000)
    font['head'].macStyle = 1 if weight == 700 else 0


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else fetch()
    with open(src, 'rb') as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    if sha != FONT_SHA:
        print(f'note: {src} is not the version the game was made with ({sha[:12]} instead of {FONT_SHA[:12]}); checking it anyway')
    licence = os.path.join(os.path.dirname(src), LICENCE_FILE)
    if not os.path.exists(licence):
        raise SystemExit(f'the licence, {LICENCE_FILE}, must sit next to the font')
    os.makedirs(OUT, exist_ok=True)
    for weight, style in WEIGHTS.items():
        font = static(src, weight)
        g = grid(font)
        for name, rows in OLD.items():
            if not same(cells_path(rows, g), outline(font, name)):
                raise SystemExit(f'{name} at {weight} is not where the grid says it is; the font has changed, look again')
        glyf, hmtx = font['glyf'], font['hmtx']
        for name, rows in NEW.items():
            pen = TTGlyphPen(None)
            cells_path(rows, g).draw(pen)
            glyph = pen.glyph()
            glyph.recalcBounds(glyf)
            old = glyf[name]
            if (glyph.xMin, glyph.xMax) != (old.xMin, old.xMax) or hmtx[name][1] != glyph.xMin:
                raise SystemExit(f'the new {name} would not sit where the old one did')
            glyf[name] = glyph   # the advance and side bearings in hmtx stay as they are
        rename(font, style, weight)
        font.flavor = 'woff2'
        out = os.path.join(OUT, f'{FAMILY.replace(" ", "")}-{style}.woff2')
        font.save(out)
        print('wrote', os.path.relpath(out, HERE), os.path.getsize(out), 'bytes; grid', g)
    with open(licence, 'rb') as fh, open(os.path.join(OUT, LICENCE_FILE), 'wb') as out:
        out.write(fh.read())
    print('wrote', os.path.relpath(os.path.join(OUT, LICENCE_FILE), HERE))


if __name__ == '__main__':
    main()
