import numpy as np, json
from PIL import Image
im = np.asarray(Image.open('ref_panel.png').convert('RGB')).astype(float)
hue, sat, lum = np.load('hsl.npy')
H, W = lum.shape

def in_hue(y, x, lo, hi, smin):
    h = hue[y, x]
    ok = (lo <= h <= hi) if lo < hi else (h >= lo or h <= hi)
    return ok and sat[y, x] > smin and lum[y, x] > 12

def refine(y, xin, xout):
    """bord sub-pixel entre un pixel intérieur xin et extérieur xout (voisins proches)"""
    step = 1 if xout > xin else -1
    cin = im[y, xin - step]  # 1 px plus à l'intérieur
    cout = im[y, xout + step]
    best = None
    xs = list(range(xin - step, xout + 2 * step, step))
    fr = []
    for x in xs:
        c = im[y, x]
        d_in = np.linalg.norm(c - cin); d_out = np.linalg.norm(c - cout)
        fr.append(d_out / max(d_in + d_out, 1e-6))  # 1 = intérieur, 0 = extérieur
    for i in range(len(xs) - 1):
        if fr[i] >= 0.5 > fr[i + 1]:
            t = (fr[i] - 0.5) / (fr[i] - fr[i + 1])
            return xs[i] + step * t + step * 0.5 - step * 0.5
    return (xin + xout) / 2

def body_edges(y, cx, lo, hi, smin):
    if not in_hue(y, cx, lo, hi, smin): return None
    L = cx
    while in_hue(y, L - 1, lo, hi, smin) and cx - L < 70: L -= 1
    R = cx
    while in_hue(y, R + 1, lo, hi, smin) and R - cx < 70: R += 1
    return refine(y, L, L - 1), refine(y, R, R + 1)

def dark_edges(y, cx, thr=110, reach=60):
    if lum[y, cx] >= thr: return None
    L = cx
    while lum[y, L - 1] < thr and cx - L < reach: L -= 1
    R = cx
    while lum[y, R + 1] < thr and R - cx < reach: R += 1
    # interpolation de luminance au seuil
    def sub(xa, xb):
        a, b = lum[y, xa], lum[y, xb]
        return xa + (thr - a) / (b - a) * (xb - xa) if b != a else (xa + xb) / 2
    return sub(L, L - 1), sub(R, R + 1)

B = {
    'blue': dict(cx=217, hue=(180, 230, 0.15)),
    'pink': dict(cx=471, hue=(325, 15, 0.18)),
}
out = {}
for name, b in B.items():
    lo, hi, smin = b['hue']
    rows = {}
    for y in range(90, H):
        e = body_edges(y, b['cx'], lo, hi, smin)
        if e: rows[y] = e
    out[name] = {'body': {y: e for y, e in rows.items()}}
    darks = {}
    for y in range(10, 100):
        e = dark_edges(y, b['cx'])
        if e: darks[y] = e
    out[name]['dark_center'] = darks
json.dump(out, open('edges2.json', 'w'))
for name in B:
    rows = out[name]['body']
    ys = sorted(rows)
    w = {y: rows[y][1] - rows[y][0] for y in ys}
    print(name, 'first body row', ys[0], 'last', ys[-1])
    for y in ys[:40:1]: print(f'  {y} L={rows[y][0]:.2f} R={rows[y][1]:.2f} w={w[y]:.2f}')
    mid = [w[y] for y in ys if ys[0] + 60 < y < ys[-1] - 20]
    print('  body width median', np.median(mid), 'min', min(mid), 'max', max(mid))
    for y in ys[-12:]: print(f'  {y} L={rows[y][0]:.2f} R={rows[y][1]:.2f} w={w[y]:.2f}')
