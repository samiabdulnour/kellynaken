#!/usr/bin/env python3
"""Turn the scene pictures from ChatGPT into real pixel art for the game.

    python3 tools/pixelate.py

Reads art/scenes.json. For every scene whose picture is in art/source/ (named by its code: S3.png, S3.jpg ...)
it crops the picture to the game's shape and shrinks it to the game's true size: 192 x 288, 432 x 288 for the
ones that scroll, 384 x 192 for the planet's skin. Results go to game/assets/bg/, and game/assets/manifest.js
lists what exists. Scenes with no picture yet are simply left out; the game draws a stand-in for those.

How it shrinks: the pictures are drawn as big square "pixels" about six real pixels wide. Averaging them down
smears neighbouring colours together and loses the small bright ones (a red tram, a blue window). So each game
pixel instead takes the colour found at the middle of its patch of the picture (the median of the few pixels
right at the centre), which keeps every colour as it was painted and every edge hard.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image


def find(source, code):
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        for name in (code, code.lower()):
            path = os.path.join(source, f'{name}.{ext}')
            if os.path.exists(path):
                return path
    return None


def shrink(path, size, fit='crop'):
    """Centre-crop to the target shape (or, with fit 'stretch', keep every edge and squeeze: the planet's skin
    needs the whole map), then sample the middle of each patch."""
    im = Image.open(path).convert('RGB')
    tw, th = size
    w, h = im.size
    if fit != 'stretch':
        want = tw / th
        if w / h > want:
            nw = round(h * want); left = (w - nw) // 2; im = im.crop((left, 0, left + nw, h))
        else:
            nh = round(w / want); top = (h - nh) // 2; im = im.crop((0, top, w, top + nh))
    a = np.asarray(im)
    h, w = a.shape[:2]
    xs = ((np.arange(tw) + 0.5) * w / tw).astype(int)
    ys = ((np.arange(th) + 0.5) * h / th).astype(int)
    taps = [a[np.clip(ys + dy, 0, h - 1)][:, np.clip(xs + dx, 0, w - 1)] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    return Image.fromarray(np.median(np.stack(taps), axis=0).astype(np.uint8))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.path.join(here, 'art', 'source'))
    ap.add_argument('--out', default=os.path.join(here, 'game', 'assets'))
    args = ap.parse_args()
    scenes = json.load(open(os.path.join(here, 'art', 'scenes.json')))
    os.makedirs(os.path.join(args.out, 'bg'), exist_ok=True)

    done = []
    for sc in scenes:
        path = find(args.source, sc['code'])
        if path:
            # 256 colours are plenty for pixel art, and make the files less than half the size, so a phone loads them quickly
            img = shrink(path, sc['size'], sc.get('fit', 'crop')).convert('RGB').quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
            img.save(os.path.join(args.out, 'bg', f"{sc['id']}.png"), optimize=True)
            done.append(sc['id'])

    with open(os.path.join(args.out, 'manifest.js'), 'w') as f:
        f.write('// Written by tools/pixelate.py: the art that exists. Anything not listed is drawn as a stand-in.\n')
        drawn = [n[:-4] for n in os.listdir(os.path.join(args.out, 'bg')) if n.endswith('.png')]      # and pictures drawn by other tools (tools/czmap.py)
        f.write('window.ASSETS = ' + json.dumps({'bg': sorted(set(done) | set(drawn))}, indent=2) + ';\n')
    missing = [f"{sc['code']} {sc['id']}" for sc in scenes if sc['id'] not in done]
    print(f'{len(done)} of {len(scenes)} scenes ready.' + (' Still waiting for: ' + ', '.join(missing) if missing else ''))


if __name__ == '__main__':
    sys.exit(main())
