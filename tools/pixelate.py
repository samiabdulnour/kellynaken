#!/usr/bin/env python3
"""Turn the scene pictures from ChatGPT into real pixel art for the game.

    python3 tools/pixelate.py

Reads art/scenes.json. For every scene whose picture is in art/source/ (named by its code: S3.png, S3.jpg ...)
it crops the picture to the game's shape, shrinks it to the game's true size (192 x 288, 432 x 288 for the
ones that scroll, 384 x 192 for the planet's skin), and repaints it with one small palette shared by all scenes, so pictures made at different
times still look like one game. Results go to game/assets/bg/, and game/assets/manifest.js lists what exists.
Scenes with no picture yet are simply left out; the game draws a stand-in for those.
"""
import argparse, json, os, sys
from PIL import Image

COLOURS = 48


def find(source, code):
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        for name in (code, code.lower()):
            path = os.path.join(source, f'{name}.{ext}')
            if os.path.exists(path):
                return path
    return None


def shrink(path, size, fit='crop'):
    """Centre-crop to the target shape, then average each block of source pixels down to one game pixel.
    With fit 'stretch' nothing is cut off: the whole picture is squeezed to the shape (the planet's skin needs
    every edge of the map)."""
    im = Image.open(path).convert('RGB')
    tw, th = size
    if fit == 'stretch':
        return im.resize((tw, th), Image.BOX)
    want = tw / th
    w, h = im.size
    if w / h > want:
        nw = round(h * want); left = (w - nw) // 2; im = im.crop((left, 0, left + nw, h))
    else:
        nh = round(w / want); top = (h - nh) // 2; im = im.crop((0, top, w, top + nh))
    return im.resize((tw, th), Image.BOX)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.path.join(here, 'art', 'source'))
    ap.add_argument('--out', default=os.path.join(here, 'game', 'assets'))
    args = ap.parse_args()
    scenes = json.load(open(os.path.join(here, 'art', 'scenes.json')))
    os.makedirs(os.path.join(args.out, 'bg'), exist_ok=True)

    small = {}
    for sc in scenes:
        path = find(args.source, sc['code'])
        if path:
            small[sc['id']] = shrink(path, sc['size'], sc.get('fit', 'crop'))

    done = []
    if small:
        # one palette for everything: lay all the scenes side by side and let them vote on the colours
        sheet = Image.new('RGB', (sum(i.width for i in small.values()), max(i.height for i in small.values())))
        x = 0
        for im in small.values():
            sheet.paste(im, (x, 0)); x += im.width
        palette = sheet.quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        for sid, im in small.items():
            im.quantize(palette=palette, dither=Image.Dither.NONE).save(os.path.join(args.out, 'bg', f'{sid}.png'), optimize=True)
            done.append(sid)

    with open(os.path.join(args.out, 'manifest.js'), 'w') as f:
        f.write('// Written by tools/pixelate.py: the art that exists. Anything not listed is drawn as a stand-in.\n')
        f.write('window.ASSETS = ' + json.dumps({'bg': sorted(done), 'sprites': {}}, indent=2) + ';\n')
    missing = [f"{sc['code']} {sc['id']}" for sc in scenes if sc['id'] not in done]
    print(f'{len(done)} of {len(scenes)} scenes ready.' + (' Still waiting for: ' + ', '.join(missing) if missing else ''))


if __name__ == '__main__':
    sys.exit(main())
