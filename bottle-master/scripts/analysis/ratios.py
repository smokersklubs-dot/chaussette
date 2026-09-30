import numpy as np, json
m = json.load(open('measure_all.json'))
e2 = json.load(open('edges2.json'))
use = ['black', 'blue', 'pink']
# ---- profil moyen du corps (z : 0 = fond, 1 = bas de la bague ; r normalisé par BODY_HEIGHT)
grid = np.round(np.arange(0.0, 1.0001, 0.0025), 4)
curves = {}
for n in use:
    b = m[n]; H = b['H']; bot = b['bottom']
    pts = sorted(((bot - int(y)) / H, v / H) for y, v in b['profile'].items())
    z = np.array([p[0] for p in pts]); r = np.array([p[1] for p in pts])
    # filtre max ±2 lignes : supprime les creux dus aux reflets spéculaires
    rf = np.array([r[max(0, i - 2):i + 3].max() for i in range(len(r))])
    curves[n] = np.interp(grid, z, rf, left=np.nan, right=np.nan)
stack = np.vstack([curves[n] for n in use])
mean = np.nanmedian(stack, 0); spread = np.nanmax(stack, 0) - np.nanmin(stack, 0)
json.dump({'z': grid.tolist(), 'r': mean.tolist(), 'spread': spread.tolist(), 'per_bottle': {n: curves[n].tolist() for n in use}}, open('body_profile.json', 'w'))
for z in (0.01, 0.02, 0.03, 0.05, 0.1, 0.5, 0.85, 0.88, 0.9, 0.92, 0.94, 0.95, 0.96, 0.98, 0.995):
    i = int(round(z / 0.0025))
    print(f'z={z:.3f} r={mean[i]:.4f} ' + ' '.join(f'{n}={curves[n][i]:.4f}' for n in use) + f' spread={spread[i]:.4f}')
