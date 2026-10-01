"""Paramètres du master v2 depuis la photo originale (bouteille bleue, premier rang, centrée)."""
import json, os, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..')
m = json.load(open(os.path.join(HERE, 'measure_photo.json'))); b = m['blue']
rows = {int(k): v for k, v in b['rows'].items()}
H, bot = b['H'], b['bottom']; cx = 190.5
Z = lambda y: (bot - y) / H
# ---- profil du corps (sous la bague)
zs, rs = [], []
for y in range(int(b['ring_bot']) + 1, int(bot)):
    v = rows.get(y)
    if v and 'L' in v: zs.append(Z(y + 0.5)); rs.append((v['R'] - v['L']) / 2 / H)
zs, rs = np.array(zs[::-1]), np.array(rs[::-1])
body_r = float(np.median(rs[(zs > 0.1) & (zs < 0.7)])); neck_r = float(np.median(rs[(zs > 0.945) & (zs < 0.995)]))
grid = np.round(np.arange(0, 1.0001, 0.0025), 4)
prof = np.interp(grid, zs, rs, left=np.nan, right=neck_r)
# ---- anse : runs sombres filtrés à ±100 px de l'axe (exclut les bouteilles voisines)
img = np.asarray(Image.open(os.path.join(ROOT, b['image'])).convert('RGB')).astype(float)
lum = 0.2126 * img[..., 0] + 0.7152 * img[..., 1] + 0.0722 * img[..., 2]
outer, inner = [], []
for y in range(int(b['handle_top']) - 1, int(b['cap_top']) - 1):
    mrow = lum[y, int(cx) - 100:int(cx) + 101] < 70
    rr = []; x = 0
    while x < len(mrow):
        if mrow[x]:
            s0 = x
            while x < len(mrow) and mrow[x]: x += 1
            rr.append((s0 + int(cx) - 100, x - 1 + int(cx) - 100))
        x += 1
    rr = [r for r in rr if r[1] - r[0] >= 2]
    if not rr: continue
    zo = Z(y + 0.5)
    if len(rr) == 1:
        outer.append((zo, ((cx - rr[0][0] + 0.5) + (rr[0][1] + 0.5 - cx)) / 2 / H))
    else:
        l, r = rr[0], rr[-1]
        outer.append((zo, ((cx - l[0] + 0.5) + (r[1] + 0.5 - cx)) / 2 / H))
        inner.append((zo, ((cx - l[1] - 0.5) + (r[0] - 0.5 - cx)) / 2 / H))
arm_outer = float(np.median([(rows[y]['R'] - rows[y]['L']) / 2 / H for y in range(462, 472)]))
P = {
  "_units": "BODY_HEIGHT = 1.000 (fond -> bas de la bague). Aucune cote en mm : TO_DEFINE_FACTORY.",
  "source": "Photo originale (reference/original/photo_originale.jpg), bouteille bleue du premier rang, image redressée de -1.75°.",
  "body_profile": {"z": grid.tolist(), "r": [None if np.isnan(v) else float(v) for v in prof]},
  "body_radius": body_r, "neck_radius": neck_r,
  "ring": {"z0": 1.0, "z1": Z(b['ring_top']), "r": neck_r + 0.0015},
  "cap": {"top": Z(b['cap_top']), "r_lower": 152.0 / 2 / H, "r_upper": 146.7 / 2 / H, "top_fillet": 3.0 / H,
          "taper_z0": Z(500), "taper_z1": Z(455), "radius": 152.0 / 2 / H},
  "hinge": {"z": Z(477.5), "radius": 7.5 / H, "outer_x": 90.5 / H},
  "handle": {"apex_outer": Z(b['handle_top']), "apex_inner": None, "outer": [[z, x] for z, x in outer], "inner": [[z, x] for z, x in inner],
             "arm_outer": arm_outer, "arm_inner": 152.0 / 2 / H + 0.002, "arm_z": None, "depth": 0.055, "adj_dz": 0.0, "adj_sx": 1.0},
  "top_scale_x": 1.0, "zmap_a": 1.0, "body_bottom_fillet": 0.035,
  "camera": {"h": 1.6, "d": 7.0, "zt": 0.65},
  "colors": {"_note": "Teintes échantillonnées sur la photo originale (zones éclairées). Indicatives.", "BLACK": "#232323", "YELLOW": "#E6C21A", "BLUE": "#80C0E6", "ORANGE": "#D8692A", "OLIVE": "#4F5A40", "PINK": "#F08AA2"},
  "photo_ref": dict(H_px=H, bottom_px=bot, cx_px=cx),
}
# sommet intérieur : première ligne sous l'apex où deux bras sont séparés
P['handle']['apex_inner'] = max(z for z, x in inner) if inner else Z(b['handle_top'] + 9)
P['handle']['arm_z'] = min((z for z, x in outer if x >= arm_outer - 0.003), default=Z(430))
os.makedirs(os.path.join(ROOT, 'data', 'photo'), exist_ok=True)
json.dump(P, open(os.path.join(ROOT, 'data', 'photo', 'params.json'), 'w'), indent=1)
print('body_r', round(body_r, 4), 'neck_r', round(neck_r, 4), 'ring z1', round(P['ring']['z1'], 4), 'cap top', round(P['cap']['top'], 4),
      'hinge z', round(P['hinge']['z'], 4), 'apex', round(P['handle']['apex_outer'], 4), 'apex_in', round(P['handle']['apex_inner'], 4), 'arm_outer', round(arm_outer, 4), 'arm_z', round(P['handle']['arm_z'], 4))
print('outer', [(round(z, 3), round(x, 4)) for z, x in outer[::8]]); print('inner', [(round(z, 3), round(x, 4)) for z, x in inner[::8]])
