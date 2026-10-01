"""Compare un rendu silhouette (REF_CAMERA) au contour mesuré de la bouteille bleue.
Sorties : erreurs par zone (en pixels de la référence), overlay 50/50, carte des contours."""
import numpy as np, json, os, sys, argparse
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
EDGES = json.load(open(os.environ.get('BOTTLE_EDGES', os.path.join(ROOT, 'data', 'ref_edges_blue.json'))))
REF = np.asarray(Image.open(os.path.join(ROOT, EDGES.get('image', 'reference/ref_panel.png'))).convert('RGB')).astype(float)

def ref_rows():
    return {int(y): v for y, v in EDGES['rows'].items()}

def alpha_edges(a, y, thr=0.5):
    row = a[y]
    idx = np.where(row > thr)[0]
    if len(idx) == 0: return None
    def sub(i0, i1):  # interpolation du passage au seuil
        v0, v1 = row[i0], row[i1]
        return i0 + (thr - v0) / (v1 - v0) * (i1 - i0) if v1 != v0 else (i0 + i1) / 2
    L = sub(idx[0] - 1, idx[0]) + 0.5; R = sub(idx[-1], idx[-1] + 1) + 0.5
    # trous intérieurs (anse)
    gaps = []
    d = np.diff(idx)
    for k in np.where(d > 1)[0]:
        gaps.append((sub(idx[k], idx[k] + 1) + 0.5, sub(idx[k + 1] - 1, idx[k + 1]) + 0.5))
    return L, R, gaps

def analyse(path, stage, outdir, tag=''):
    im = np.asarray(Image.open(path).convert('RGBA')).astype(float) / 255
    a = im[..., 3]; rgb = im[..., :3]
    Hr, Wr = a.shape; cxr = Wr / 2
    # repères rendu : fond à l'axe, bas de la bague (transition rouge -> vert/bleu) à ~18 px réf de l'axe
    col = a[:, int(cxr)]
    yb = np.where(col > 0.5)[0][-1]
    bot_r = yb + (col[yb] - 0.5) / max(col[yb] - col[yb + 1], 1e-6) + 0.5
    red = (rgb[..., 0] > 0.5) & (rgb[..., 1] < 0.5) & (rgb[..., 2] < 0.5) & (a > 0.5)
    # hauteur provisoire pour convertir l'offset de 18 px
    top_red = np.where(red[:, int(cxr)])[0][0]
    k0 = EDGES['H'] / (bot_r - top_red)
    xoff = int(round(cxr - EDGES.get('ring_probe_dx', 18) / k0))
    ring_bot_r = np.where(red[:, xoff])[0][0] - 0.0 if stage != 'A' else top_red
    if stage == 'A':  # sans bague : le haut du col (z = 1) fait office de repère
        colr = a[:, xoff]; yt = np.where(colr > 0.5)[0][0]
        ring_bot_r = yt - (colr[yt] - 0.5) / max(colr[yt] - colr[yt - 1], 1e-6) + 0.5
    # repère bas robuste : ligne où la largeur tombe à 50 % du corps (sub-pixel), réf et rendu
    rows0 = ref_rows()
    Hq = EDGES['H']; bq = EDGES['bottom']
    wref = {y: v['R'] - v['L'] for y, v in rows0.items() if y > bq - 0.2 * Hq}
    wb = np.median([w for y, w in wref.items() if y < bq - 0.07 * Hq]); half = wb / 2
    ys_ = sorted(wref)
    bot = next(y + (wref[y] - half) / (wref[y] - wref[y + 1]) + 0.5 for y in ys_[:-1] if (y + 1) in wref and wref[y] >= half > wref[y + 1])
    wr = (a > 0.5).sum(1).astype(float)
    hb = bot_r - np.where(a.max(1) > 0.5)[0][0]; hbody = hb / 1.4
    wbr = np.median(wr[int(bot_r - 0.2 * hbody):int(bot_r - 0.07 * hbody)]); hr = wbr / 2
    yy = int(bot_r - 0.07 * hbody)
    while not (wr[yy] >= hr > wr[yy + 1]): yy += 1
    bot_r = yy + (wr[yy] - hr) / (wr[yy] - wr[yy + 1]) + 0.5
    k = (bot - EDGES['ring_bot']) / (bot_r - ring_bot_r)
    cx = EDGES['cx']
    to_r_y = lambda y: bot_r - (bot - y) / k
    to_ref_x = lambda x: cx + (x - cxr) * k
    rows = ref_rows()
    zones = EDGES['zones']
    active = {'A': ('neck', 'shoulder', 'body', 'bottom'), 'B': ('ring', 'cap_skirt', 'neck', 'shoulder', 'body', 'bottom')}.get(stage, tuple(zones))
    err = {z: [] for z in zones}; per_row = []
    for y, v in sorted(rows.items()):
        zname = next((z for z, (y0, y1) in zones.items() if y0 <= y <= y1), None)
        if zname not in active: continue
        yr = to_r_y(y + 0.5)  # centre de la ligne de référence
        yi = int(np.floor(yr))
        if yi < 0 or yi >= Hr: continue
        e = alpha_edges(a, yi)
        if not e: per_row.append((y, zname, dict(y=y, zone=zname, missing=True))); continue
        L, R = to_ref_x(e[0]), to_ref_x(e[1])
        dl, dr = L - v['L'], R - v['R']
        ent = dict(y=y, zone=zname, dL=round(-dl, 2), dR=round(dr, 2))  # >0 : rendu plus large
        if 'iL' in v and e[2]:
            g = max(e[2], key=lambda t: t[1] - t[0]); iL, iR = to_ref_x(g[0]), to_ref_x(g[1])
            ent.update(diL=round(iL - v['iL'], 2), diR=round(-(iR - v['iR']), 2))  # >0 : bras plus épais vers l'intérieur
        per_row.append((y, zname, ent))
        err[zname] += [abs(dl), abs(dr)] + ([abs(ent['diL']), abs(ent['diR'])] if 'diL' in ent else [])
    hs = [r[2] for r in per_row if r[2] and r[2].get('zone') == 'handle' and 'dL' in r[2]]
    if hs:
        sym = [abs(r['dL'] + r['dR']) / 2 for r in hs] + [abs(r['diL'] + r['diR']) / 2 for r in hs if 'diL' in r and abs(r['diR']) < 20]
        off = [(r['dL'] - r['dR']) / 2 for r in hs]
    missing = {z: sum(1 for r in per_row if r[1] == z and r[2] and r[2].get('missing')) for z in zones}
    summary = {z: dict(missing=missing[z], mean=round(float(np.mean(v)), 2), p90=round(float(np.percentile(v, 90)), 2), max=round(float(np.max(v)), 2), n=len(v) // 2) for z, v in err.items() if v}
    # ---- overlay 50/50 + contours, zone de la bouteille bleue, x4
    x0, x1, y0, y1 = EDGES.get('overlay_box', [165, 272, 20, 350]); S = EDGES.get('overlay_scale', 4)
    crop = Image.fromarray(REF[y0:y1, x0:x1].astype(np.uint8)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS)
    # rééchantillonnage du rendu dans le repère référence
    ys, xs = np.mgrid[y0 * S:y1 * S, x0 * S:x1 * S] / S
    ry = np.clip(np.round(bot_r - (bot - ys) / k).astype(int), 0, Hr - 1)
    rx = np.clip(np.round(cxr + (xs - cx) / k).astype(int), 0, Wr - 1)
    ra = a[ry, rx]; rrgb = rgb[ry, rx]
    gray = np.full_like(rrgb, 0.55)
    ov = np.asarray(crop).astype(float) / 255
    blend = ov * (1 - 0.5 * ra[..., None]) + gray * 0.5 * ra[..., None]
    Image.fromarray((blend * 255).astype(np.uint8)).save(os.path.join(outdir, f'overlay_50_{stage}{tag}.png'))
    # contours : référence (cyan) / rendu (rouge)
    cont = Image.fromarray((ov * 0.55 * 255 + 0.45 * 255).astype(np.uint8)); d = ImageDraw.Draw(cont)
    edge = (np.abs(np.diff(ra > 0.5, axis=1, prepend=0)) > 0) | (np.abs(np.diff(ra > 0.5, axis=0, prepend=0)) > 0)
    cont_np = np.asarray(cont).copy()
    for y, v in rows.items():
        zname = next((z for z, (a0, a1) in zones.items() if a0 <= y <= a1), None)
        if zname not in active: continue
        for key in ('L', 'R', 'iL', 'iR'):
            if key in v:
                X = int(round((v[key] - x0) * S)); Y0 = (y - y0) * S
                if 0 <= X < cont_np.shape[1]: cont_np[Y0:Y0 + S, max(X - 1, 0):X + 1] = (0, 170, 255)
    cont_np[edge] = (230, 30, 30)
    Image.fromarray(cont_np).save(os.path.join(outdir, f'contours_{stage}{tag}.png'))
    # contrôles verticaux sur l'axe : haut du bouchon / haut de l'anse
    colax = a[:, int(cxr)]
    blue_ax = np.where((rgb[:, int(cxr), 2] > 0.5) & (rgb[:, int(cxr), 0] < 0.5) & (colax > 0.5))[0]
    def ref_y(yr): return bot - (bot_r - yr) * k
    marks = EDGES.get('axis_marks', {})
    if stage != 'A' and len(blue_ax):
        summary['cap_top_dy'] = round(float(ref_y(blue_ax[0]) - marks['cap_top']), 2)  # <0 : rendu plus haut
    if stage in ('C', 'FULL') and hs:
        summary['handle_width_err'] = round(float(np.mean(sym)), 2); summary['handle_offset'] = round(float(np.mean(off)), 2)
    if stage in ('C', 'FULL'):
        ya = np.where(colax > 0.5)[0][0]
        summary['handle_top_dy'] = round(float(ref_y(ya) - marks['handle_top']), 2)
    json.dump(dict(summary=summary, rows=[r[2] for r in per_row if r[2]]), open(os.path.join(outdir, f'errors_{stage}{tag}.json'), 'w'), indent=1)
    return summary, per_row

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('render'); ap.add_argument('stage'); ap.add_argument('--out', default='.'); ap.add_argument('--tag', default='')
    x = ap.parse_args()
    s, rows = analyse(x.render, x.stage, x.out, x.tag)
    for z, v in s.items():
        if isinstance(v, dict): print(f'{z:9s} mean={v["mean"]:5.2f}px p90={v["p90"]:5.2f} max={v["max"]:5.2f} rows={v["n"]}')
        else: print(f'{z:9s} {v:+.2f}px')
