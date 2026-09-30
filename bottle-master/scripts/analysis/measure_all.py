import numpy as np, json
from PIL import Image, ImageDraw
im = np.asarray(Image.open('ref_panel.png').convert('RGB')).astype(float)
hue, sat, lum = np.load('hsl.npy')
H, W = lum.shape

def dark_run(y, x, thr=100, reach=45):
    if lum[y, x] >= thr: return None
    L = x
    while L > 0 and lum[y, L - 1] < thr and x - L < reach: L -= 1
    R = x
    while R < W - 1 and lum[y, R + 1] < thr and R - x < reach: R += 1
    sub = lambda xa, xb: xa + (thr - lum[y, xa]) / (lum[y, xb] - lum[y, xa]) * (xb - xa)
    return sub(L, L - 1), sub(R, R + 1)

def body_side(y, x0, side, is_body, reach=60):
    """bord extérieur d'un seul côté, sub-pixel par fraction de couleur"""
    x = x0
    step = -1 if side == 'L' else 1
    while is_body(y, x + step) and abs(x - x0) < reach: x += step
    cin, cout = im[y, x - step], im[y, x + 2 * step]
    fr = lambda c: np.linalg.norm(c - cout) / max(np.linalg.norm(c - cin) + np.linalg.norm(c - cout), 1e-6)
    a, b = fr(im[y, x]), fr(im[y, x + step])
    if a >= 0.5 > b: return x + step * (0.5 + (a - 0.5) / (a - b)) - step * 0.5 + step * 0.0
    return x + step * 0.5

def hue_pred(lo, hi, smin, lmin=8):
    def f(y, x):
        h = hue[y, x]
        ok = (lo <= h <= hi) if lo < hi else (h >= lo or h <= hi)
        return ok and sat[y, x] > smin and lum[y, x] > lmin
    return f
black_pred = lambda y, x: lum[y, x] < 90 and sat[y, x] < 0.45

B = {  # side = flanc(s) dégagé(s)
    'black':  dict(x0=56,  pred=black_pred,               sides='L'),
    'yellow': dict(x0=140, pred=hue_pred(38, 65, 0.35),    sides='L'),
    'blue':   dict(x0=217, pred=hue_pred(180, 230, 0.15),  sides='LR'),
    'orange': dict(x0=301, pred=hue_pred(0, 32, 0.45),     sides='R'),
    'olive':  dict(x0=390, pred=hue_pred(45, 120, 0.08),   sides='L'),
    'pink':   dict(x0=471, pred=hue_pred(325, 15, 0.18),   sides='LR'),
}
res = {}
for name, b in B.items():
    x0 = b['x0']
    # 1) centre de l'axe : milieu du bouchon sur les lignes pleines
    col = lum[:, x0]
    ys_dark = [y for y in range(5, 140) if col[y] < 100]
    # anse = premier bloc sombre ; bouchon = bloc suivant après un vide
    blocks = []
    for y in ys_dark:
        if blocks and y - blocks[-1][-1] <= 2: blocks[-1].append(y)
        else: blocks.append([y])
    handle_blk, cap_blk = blocks[0], blocks[1]
    cap_rows = [y for y in cap_blk if cap_blk[0] + 4 <= y <= cap_blk[0] + 8]
    cs = [sum(dark_run(y, x0)) / 2 for y in cap_rows]
    cx = float(np.median(cs))
    # 2) bague : lignes où la moyenne ±(largeur col*0.35) autour du centre est claire / métal
    # colonne à ~18 px de l'axe : bouchon sombre -> bague claire/métal -> corps
    xc = int(round(cx - 18))
    y = cap_blk[0] + 6
    while lum[y, xc] < 80: y += 1
    rtop = y
    if name == 'black':
        while lum[y, xc] >= 80: y += 1
    else:
        while not b['pred'](y, xc): y += 1
    rr = [rtop, y - 1]
    ring_top, ring_bot = rr[0] - 0.5, rr[-1] + 0.5
    # 3) bas du corps : dernière ligne corps à l'axe
    yb = max(y for y in range(150, H) if b['pred'](y, int(round(cx))))
    # 4) demi-largeurs corps côté(s) dégagé(s)
    def halfw(y):
        v = []
        for s in b['sides']:
            if not b['pred'](y, int(round(cx))): return None
            e = body_side(y, int(round(cx)), s, b['pred'])
            v.append(abs(e - cx))
        return float(max(v))  # un reflet ne peut que raccourcir un flanc
    prof = {y: halfw(y) for y in range(int(ring_bot + 0.5), yb + 1)}
    prof = {y: v for y, v in prof.items() if v}
    Hb = (yb + 0.5) - ring_bot
    mid = [v for y, v in prof.items() if ring_bot + 0.35 * Hb < y < ring_bot + 0.85 * Hb]
    neck = [v for y, v in prof.items() if ring_bot + 2 < y < ring_bot + 8]
    cap_w = [dark_run(y, x0) for y in range(int(ring_top) - 4, int(ring_top))]
    cap_half = float(np.median([(r - l) / 2 for l, r in [c for c in cap_w if c]] or [np.nan]))
    res[name] = dict(cx=cx, handle_top=handle_blk[0] - 0.5, cap_top=cap_blk[0] - 0.5, ring_top=ring_top, ring_bot=ring_bot,
                     bottom=yb + 0.5, H=Hb, body_half=float(np.median(mid)), neck_half=float(np.median(neck)), cap_half_low=cap_half,
                     profile={int(y): v for y, v in prof.items()})
    r = res[name]
    n = lambda v: v / Hb
    print(f"{name:7s} cx={cx:6.1f} H={Hb:6.1f} | W/H={2*n(r['body_half']):.4f} neck/body={r['neck_half']/r['body_half']:.4f} "
          f"ringH={n(ring_bot-ring_top):.4f} capTop={n(r['bottom']-r['cap_top']):.4f} handleTop={n(r['bottom']-r['handle_top']):.4f} capW/body={cap_half/r['body_half']:.4f}")
json.dump(res, open('measure_all.json', 'w'))
