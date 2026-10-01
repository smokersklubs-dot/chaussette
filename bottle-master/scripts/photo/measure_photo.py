"""Mesure au sub-pixel des trois bouteilles du premier rang (images redressées)."""
import numpy as np, json, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); REFD = os.path.join(HERE, '..', '..', 'reference', 'original')
RECT = json.load(open(os.path.join(HERE, 'rectify.json')))

def maps(img):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx = img.max(-1); mn = img.min(-1); d = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0); lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return hue, sat, lum
PRED = {
  'blue':  lambda h, s, l: (185 < h < 222) and s > 0.2 and l > 40,
  'pink':  lambda h, s, l: (h > 320 or h < 15) and s > 0.18 and l > 60,
  'black': lambda h, s, l: l < 58 and s < 0.5,
}
DARK = {'blue': 70, 'pink': 55, 'black': 70}   # seuil sombre (anse / bouchon) selon le fond derrière

res = {}
for name in ('blue', 'black', 'pink'):
    img = np.asarray(Image.open(os.path.join(REFD, f'rect_{name}.png')).convert('RGB')).astype(float)
    hue, sat, lum = maps(img); H_, W_ = lum.shape; cx0 = int(round(RECT[name]['cx_in_crop']))
    P = lambda y, x: PRED[name](hue[y, x], sat[y, x], lum[y, x])
    def refine(y, xin, xout):
        st = 1 if xout > xin else -1
        cin, cout = img[y, xin - st], img[y, xout + st]
        fr = lambda c: np.linalg.norm(c - cout) / max(np.linalg.norm(c - cin) + np.linalg.norm(c - cout), 1e-6)
        a, b = fr(img[y, xin]), fr(img[y, xout])
        if a >= 0.5 > b: return xin + st * ((a - 0.5) / (a - b)) + 0.5
        return (xin + xout) / 2 + 0.5
    def body_edges(y):
        if not P(y, cx0): return None
        L = cx0
        while L > 2 and P(y, L - 1): L -= 1
        R = cx0
        while R < W_ - 3 and P(y, R + 1): R += 1
        return refine(y, L, L - 1), refine(y, R, R + 1)
    # --- axe : premières zones sombres (anse, bouchon)
    thr = DARK[name]
    col = lum[:, cx0 - 3:cx0 + 4].mean(1)
    dark_rows = [y for y in range(150, 700) if col[y] < thr]
    blocks = []
    for y in dark_rows:
        if blocks and y - blocks[-1][-1] <= 3: blocks[-1].append(y)
        else: blocks.append([y])
    blocks = [b for b in blocks if len(b) >= 3]
    if name == 'black':
        cap_blk = next(b for b in blocks if b[0] > 400)
        cap_blk = [y for y in cap_blk]
        hb = [b for b in blocks if b[-1] < cap_blk[0]]
        handle_blk = hb[-1] if hb else None
    else:
        y_body = next(y for y in range(400, 800) if all(P(y + k, cx0) for k in range(6)))
        before = [b for b in blocks if b[0] < y_body]
        cap_blk, handle_blk = before[-1], before[-2]
    sub_top = lambda y: y - (col[y] - thr) / (col[y] - col[y - 1]) + 0.5 if col[y - 1] != col[y] else y
    handle_top = (float(y0 := handle_blk[0]) - (thr - col[y0]) / max(col[y0 - 1] - col[y0], 1e-6) + 0.5) if handle_blk else None
    cap_top = float(cap_blk[0]) - (thr - col[cap_blk[0]]) / max(col[cap_blk[0] - 1] - col[cap_blk[0]], 1e-6) + 0.5
    # --- corps
    rows = {}
    for y in range(cap_blk[0], H_ - 2):
        e = body_edges(y)
        if e: rows[y] = dict(L=e[0], R=e[1])
    ys = sorted(rows); wid = {y: rows[y]['R'] - rows[y]['L'] for y in ys}
    bodyW = float(np.median([wid[y] for y in ys if 700 < y < 1050]))
    # bloc continu principal
    y_first = next(y for y in ys if wid[y] > 0.5 * bodyW and all((y + k) in rows for k in range(1, 6)))
    y_last = max(y for y in ys if wid[y] > 0.3 * bodyW)
    # --- bouchon (lignes sombres à l'axe) puis sonde de bague à 40 % du rayon du bouchon
    def dark_edges0(y, t):
        if lum[y, cx0] >= t: return None
        L = cx0
        while lum[y, L - 1] < t and cx0 - L < 170: L -= 1
        R = cx0
        while lum[y, R + 1] < t and R - cx0 < 170: R += 1
        return L, R
    capw = [dark_edges0(y, thr) for y in range(cap_blk[0] + 8, cap_blk[0] + 15)]
    capHalf = float(np.median([(r - l) / 2 for l, r in capw if l is not None]))
    dx = int(round(0.3 * capHalf))
    xs = cx0 - dx
    band = lum[:, cx0 - 40:cx0 + 41]; bstd = band.std(1)
    yy = cap_blk[0] + 20
    while bstd[yy] <= 20: yy += 1
    ring_top_probe = yy
    while bstd[yy] > 20 or bstd[yy + 1] > 20: yy += 1
    ring_bot = float(yy)
    H_est = y_last - ring_bot
    for y in [k for k in list(rows) if k < ring_bot]: rows.pop(y)
    # --- bouchon + bague : bords par seuil sombre / gradient
    def dark_edges(y, t):
        if lum[y, cx0] >= t: return None
        L = cx0
        while lum[y, L - 1] < t and cx0 - L < 170: L -= 1
        R = cx0
        while lum[y, R + 1] < t and R - cx0 < 170: R += 1
        s = lambda a, b: a + (t - lum[y, a]) / (lum[y, b] - lum[y, a]) * (b - a) + 0.5 if lum[y, b] != lum[y, a] else a + 0.5
        return s(L, L - 1), s(R, R + 1)
    for y in range(cap_blk[0], ring_top_probe):
        e = dark_edges(y, thr)
        if e: rows[y] = dict(L=e[0], R=e[1])
    # bague : bord = gradient horizontal maximal près des bords du bouchon, médian sur les lignes de bague
    capL = np.median([rows[y]['L'] for y in range(ring_top_probe - 8, ring_top_probe - 2) if y in rows])
    capR = np.median([rows[y]['R'] for y in range(ring_top_probe - 8, ring_top_probe - 2) if y in rows])
    gx = np.abs(np.diff(lum, axis=1))
    rr = range(ring_top_probe + 3, int(ring_bot) - 3)
    def edge_near(x0):
        xs_ = np.arange(int(x0) - 14, int(x0) + 15)
        prof = np.mean([gx[y, xs_] for y in rr], 0)
        return float(xs_[np.argmax(prof)] + 1.0)
    ringL, ringR = edge_near(capL), edge_near(capR)
    for y in range(ring_top_probe, int(ring_bot)):
        rows[y] = dict(L=ringL, R=ringR)
    # --- anse : runs sombres au-dessus du bouchon
    for y in (range(handle_blk[0] - 2, cap_blk[0]) if handle_blk else []):
        m = lum[y, cx0 - 175:cx0 + 176] < thr
        rs = []; x = 0
        while x < len(m):
            if m[x]:
                s0 = x
                while x < len(m) and m[x]: x += 1
                rs.append((s0 + cx0 - 175, x - 1 + cx0 - 175))
            x += 1
        rs = [r for r in rs if r[1] - r[0] >= 2]
        if not rs: continue
        v = dict(L=rs[0][0] + 0.0, R=rs[-1][1] + 1.0)
        if len(rs) >= 2: v.update(iL=rs[0][1] + 1.0, iR=rs[-1][0] + 0.0)
        rows[y] = v
    print(name, "blocks", [(b[0], b[-1]) for b in blocks][:4], "capHalf", capHalf, "dx", dx, "ring_top", ring_top_probe, "ring_bot", ring_bot, "y_first", y_first, "y_last", y_last)
    H = (y_last + 1) - ring_bot
    res[name] = dict(image=f'reference/original/rect_{name}.png', cx=float(np.median([(rows[y]['L'] + rows[y]['R']) / 2 for y in ys if 700 < y < 1050])),
        H=float(H), bottom=float(y_last + 1), ring_bot=float(ring_bot), ring_top=float(ring_top_probe), ring_probe_dx=dx,
        cap_top=cap_top, handle_top=handle_top, bodyW=bodyW, ring=[ringL, ringR], cap_low=[float(capL), float(capR)],
        rows={str(k): {kk: round(float(vv), 3) for kk, vv in v.items()} for k, v in sorted(rows.items())})
    r = res[name]; n = lambda v: v / H
    print(f"{name:6s} H={H:.1f}px W/H={bodyW / H:.4f} ringH={n(r['ring_bot'] - r['ring_top']):.4f} capTop={n(r['bottom'] - cap_top):.4f} handleTop={(n(r['bottom'] - handle_top) if handle_top else float('nan')):.4f} "
          f"ringW/W={(ringR - ringL) / bodyW:.4f} capW/W={(capR - capL) / bodyW:.4f} cx={r['cx']:.1f}")
json.dump(res, open(os.path.join(HERE, 'measure_photo.json'), 'w'))
