import numpy as np, json
hue, sat, lum = np.load('hsl.npy')
m = json.load(open('measure_all.json')); prof = json.load(open('body_profile.json'))
b = m['blue']; H = b['H']; bot = b['bottom']; cx = 218.0
Z = lambda y: (bot - y) / H
N = lambda px: px / H
# ---- anse (bouteille bleue, anse de face) : bords extérieur / intérieur par ligne
def runs(y, x0=178, x1=259, thr=100):
    row = lum[y, x0:x1] < thr; out = []; x = 0
    while x < len(row):
        if row[x]:
            s = x
            while x < len(row) and row[x]: x += 1
            out.append((s + x0 - 0.5, x - 1 + x0 + 0.5))
        x += 1
    return out
outer, inner = [], []
for y in range(26, 76):
    rr = runs(y)
    if not rr: continue
    if len(rr) == 1 and y < 34:
        outer.append((Z(y), N(max(cx - rr[0][0], rr[0][1] - cx))))
    elif len(rr) >= 2:
        l, r = rr[0], rr[-1]
        outer.append((Z(y), N(max(cx - l[0], r[1] - cx))))
        if y >= 33: inner.append((Z(y), N(min(cx - l[1], r[0] - cx))))
# sommet : z de la première ligne sombre au centre (sub-pixel)
apex_outer = Z(26.6); apex_inner = Z(33.0)
params = {
  "_units": "BODY_HEIGHT = 1.000 (fond -> bas de la bague). Aucune cote en mm : TO_DEFINE_FACTORY.",
  "source": "Encart 6 bouteilles de la planche '3D PRODUCT REFERENCE' (images/4.webp, x160-740 y0-350). Pas la photo originale.",
  "body_profile": {"z": prof['z'], "r": prof['r'], "spread": prof['spread']},
  "body_radius": float(np.nanmedian(np.array(prof['r'])[(np.array(prof['z']) > 0.1) & (np.array(prof['z']) < 0.8)])),
  "neck_radius": float(np.nanmedian(np.array(prof['r'])[(np.array(prof['z']) > 0.955) & (np.array(prof['z']) < 0.995)])),
  "ring": {"z0": 1.0, "z1": 1.0 + float(np.median([m[n]['ring_bot'] - m[n]['ring_top'] for n in ('black', 'blue', 'pink')] and [ (m[n]['ring_bot'] - m[n]['ring_top']) / m[n]['H'] for n in ('black', 'blue', 'pink')]))},
  "cap": {"top": float(np.median([(m[n]['bottom'] - m[n]['cap_top']) / m[n]['H'] for n in ('black', 'blue', 'pink')])),
          "radius": float(np.median([m[n]['cap_half_low'] / m[n]['H'] for n in ('black', 'blue', 'pink')])),
          "radius_upper_blue": N(61.5 / 2), "top_fillet": N(3.0)},
  "hinge": {"z": Z(84.5), "radius": N(8.0), "outer_x": N(255.15 - cx)},
  "handle": {"apex_outer": float(np.median([(m[n]['bottom'] - m[n]['handle_top']) / m[n]['H'] for n in ('black', 'blue', 'pink')])),
             "apex_inner": apex_inner, "outer": outer, "inner": inner,
             "arm_outer": N(36.5), "arm_inner": N(32.0), "depth_LOW": 0.067},
}
json.dump(params, open('params.json', 'w'), indent=1)
for k in ('body_radius', 'neck_radius'): print(k, round(params[k], 4))
print('ring', params['ring']); print('cap', {k: round(v, 4) for k, v in params['cap'].items()}); print('hinge', {k: round(v, 4) for k, v in params['hinge'].items()})
print('handle apex', round(params['handle']['apex_outer'], 4), round(apex_inner, 4))
print('outer pts', [(round(a, 3), round(c, 4)) for a, c in outer[::4]])
print('inner pts', [(round(a, 3), round(c, 4)) for a, c in inner[::4]])
