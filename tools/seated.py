"""The salon's customers sitting down (game/assets/sprites/seated.png), made from their standing pictures.

Every customer on the standing sheet (customers.png: c0-c5 before, d0-d5 with the new hairdo) is cut at the hip and
at the knee: the body above the hip stays as it is, the thigh is turned to point forward (they face right), and
the shin and shoe hang down from the knee, still standing on the same floor line. So they stay exactly the
people they were, only sitting: in the basin chair and on the stool under the dryer.

    python3 tools/seated.py     make the sheet and update its entry in game/assets/sprites.js
(tools/sprites.py calls this too, after it has made the standing sheet.)
"""
import json
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FW, FH, OUT_W = 52, 118, 80                     # a standing frame, and a sitting one (wider: the thighs reach forward)
# Where each of the six bodies has its hip (the bottom of the top or the cardigan) and its knee (the bottom of the
# skirt or the dress, or halfway down the trousers), in rows of the standing frame.
HIP_KNEE = [(86, 103), (86, 99), (83, 97), (84, 96), (91, 100), (88, 100)]
THICK = 14                                      # a thigh seen from the side
SEAT_X = 26                                     # where the back sits, across the sitting frame (as in the standing one)


def box(img):
    """The columns that are drawn in, left and right."""
    b = img.getbbox()
    return (b[0], b[2]) if b else (0, img.width)


def sit(frame, hip, knee):
    out = Image.new('RGBA', (OUT_W, FH), (0, 0, 0, 0))
    band = frame.crop((0, hip, FW, knee))
    x0, x1 = box(band)
    leg = band.crop((x0, 0, x1, knee - hip))
    reach = (x1 - x0) + (knee - hip)                                       # from the back of the seat to the knee
    thigh = leg.rotate(90, expand=True).resize((reach, THICK), Image.NEAREST)   # the front of the leg is now its top
    shin = frame.crop((0, knee, FW, FH))
    s0, s1 = box(shin)
    shin = shin.crop((s0, 0, s1, FH - knee))
    front = x0 + reach                                                     # the knee
    out.alpha_composite(shin, (max(0, front - shin.width + 2), knee))     # the shin hangs from the knee, onto the floor
    out.alpha_composite(thigh, (x0, knee - THICK + 2))
    torso = frame.crop((0, 0, FW, hip))
    out.alpha_composite(torso, (0, knee - hip - THICK // 2 + 2))           # sat down: the body comes down onto the thigh
    return out


def sheet(out_dir):
    """Make out_dir/seated.png from out_dir/customers.png and return its entry for sprites.js."""
    stand = Image.open(os.path.join(out_dir, 'customers.png')).convert('RGBA')
    n = stand.width // FW
    out = Image.new('RGBA', (OUT_W * n, FH), (0, 0, 0, 0))
    for f in range(n):
        hip, knee = HIP_KNEE[f % 6]
        out.paste(sit(stand.crop((f * FW, 0, f * FW + FW, FH)), hip, knee), (f * OUT_W, 0))
    out.save(os.path.join(out_dir, 'seated.png'), optimize=True)
    names = [f'c{k}' for k in range(6)] + [f'd{k}' for k in range(6)]
    poses = {name: [i] for i, name in enumerate(names[:n])}; poses['stand'] = [0]
    return {'file': 'seated.png', 'w': OUT_W, 'h': FH, 'scale': 0.25, 'fps': 1, 'poses': poses, 'seat': SEAT_X}


if __name__ == '__main__':
    entry = sheet(ROOT / 'game/assets/sprites')
    js = ROOT / 'game/assets/sprites.js'
    text = js.read_text(); head = text[:text.index('window.SPRITES')]
    info = json.loads(text[text.index('{'):text.rindex('}') + 1]); info['seated'] = entry
    js.write_text(head + 'window.SPRITES = ' + json.dumps(info, indent=2) + ';\n')
    print('seated', OUT_W, 'x', FH)
    sys.exit(0)
