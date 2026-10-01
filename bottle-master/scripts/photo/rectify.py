"""Redresse chaque bouteille avant sur son axe (rotation autour du milieu du corps)."""
import numpy as np, json, os, math
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
hue, sat, lum = np.load(os.path.join(HERE, 'hsl.npy'))
IMG = os.path.join(HERE, '..', '..', 'reference', 'original', 'photo_originale.jpg')
BOT = {
  'blue':  lambda h, s, l: (h > 185) & (h < 220) & (s > 0.25),
  'pink':  lambda h, s, l: ((h > 325) | (h < 12)) & (s > 0.2) & (l > 80),
  'black': lambda h, s, l: (l < 55),
}
SEED = {'blue': 620, 'pink': 905, 'black': 390}
out = {}
for name, pred in BOT.items():
    ys, cs = [], []
    for y in range(650, 1101, 10):
        m = pred(hue[y], sat[y], lum[y]); x = SEED[name]
        if not m[x]: continue
        L = x
        while m[L - 1]: L -= 1
        R = x
        while m[R + 1]: R += 1
        ys.append(y); cs.append((L + R) / 2)
    b, a = np.polyfit(ys, cs, 1)
    ang = math.degrees(math.atan(b))
    cy = 900; cx = a + b * cy
    img = Image.open(IMG).convert('RGB')
    # rotation dans le sens qui rend l'axe vertical (PIL : angle positif = anti-horaire)
    rot = img.rotate(-ang, resample=Image.BICUBIC, center=(cx, cy))
    x0 = int(round(cx)) - 190
    crop = rot.crop((x0, 0, x0 + 380, 1280))
    path = os.path.join(HERE, '..', '..', 'reference', 'original', f'rect_{name}.png')
    crop.save(path)
    out[name] = dict(angle_deg=round(ang, 3), axis_x_at_900=round(cx, 2), crop_x0=x0, cx_in_crop=round(cx - x0, 2))
    print(name, out[name])
json.dump(out, open(os.path.join(HERE, 'rectify.json'), 'w'), indent=1)
