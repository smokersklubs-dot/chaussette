"""reference_match.png (photo | rendu, même cadrage) et overlay_50.png (photo + rendu couleur à 50 %)."""
import numpy as np, json, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
E = json.load(open(os.environ.get('BOTTLE_EDGES', os.path.join(ROOT, 'data', 'ref_edges_blue.json'))))
REF = np.asarray(Image.open(os.path.join(ROOT, E.get('image', 'reference/ref_panel.png'))).convert('RGB')).astype(float)
sil = np.asarray(Image.open(os.path.join(ROOT, 'renders', os.environ.get('BOTTLE_CKDIR', 'checkpoints'), 'sil_C.png')).convert('RGBA')).astype(float) / 255
col = np.asarray(Image.open(os.path.join(ROOT, 'renders', 'reference_camera.png')).convert('RGB')).astype(float)
a = sil[..., 3]; rgb = sil[..., :3]; Hr, Wr = a.shape; cxr = Wr / 2
# mêmes repères que compare.py
rows = {int(y): v for y, v in E['rows'].items()}
Hq, bq = E['H'], E['bottom']
wref = {y: v['R'] - v['L'] for y, v in rows.items() if y > bq - 0.2 * Hq}
half = np.median([w for y, w in wref.items() if y < bq - 0.07 * Hq]) / 2
ys = sorted(wref)
bot = next(y + (wref[y] - half) / (wref[y] - wref[y + 1]) + 0.5 for y in ys[:-1] if (y + 1) in wref and wref[y] >= half > wref[y + 1])
colax = a[:, int(cxr)]; yb = np.where(colax > 0.5)[0][-1]
bot_r0 = yb + 0.5
wr = (a > 0.5).sum(1).astype(float); hbody = (bot_r0 - np.where(a.max(1) > 0.5)[0][0]) / 1.4
hr = np.median(wr[int(bot_r0 - 0.2 * hbody):int(bot_r0 - 0.07 * hbody)]) / 2
yy = int(bot_r0 - 0.07 * hbody)
while not (wr[yy] >= hr > wr[yy + 1]): yy += 1
bot_r = yy + (wr[yy] - hr) / (wr[yy] - wr[yy + 1]) + 0.5
red = (rgb[..., 0] > 0.5) & (rgb[..., 1] < 0.5) & (rgb[..., 2] < 0.5) & (a > 0.5)
top_red = np.where(red[:, int(cxr)])[0][0]; k0 = E['H'] / (bot_r - top_red)
ring_bot_r = np.where(red[:, int(round(cxr - E.get('ring_probe_dx', 18) / k0))])[0][0]
k = (bot - E['ring_bot']) / (bot_r - ring_bot_r); cx = E['cx']
x0, x1, y0, y1 = E.get('overlay_box', [150, 285, 10, 352]); S = E.get('overlay_scale', 4)
yy_, xx_ = np.mgrid[y0 * S:y1 * S, x0 * S:x1 * S] / S
ry = np.clip(np.round(bot_r - (bot - yy_) / k).astype(int), 0, Hr - 1)
rx = np.clip(np.round(cxr + (xx_ - cx) / k).astype(int), 0, Wr - 1)
rend = col[ry, rx]
ref = np.asarray(Image.fromarray(REF[y0:y1, x0:x1].astype(np.uint8)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS)).astype(float)
Image.fromarray(((ref + rend) / 2).astype(np.uint8)).save(os.path.join(ROOT, 'renders', 'overlay_50.png'))
gap = np.full((ref.shape[0], 24, 3), 255.0)
Image.fromarray(np.concatenate([ref, gap, rend], 1).astype(np.uint8)).save(os.path.join(ROOT, 'renders', 'reference_match.png'))
print('ok', ref.shape)
