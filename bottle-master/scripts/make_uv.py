"""Gabarit UV du corps (déroulé) avec zones d'impression. Usage : BOTTLE_PARAMS=... python3 scripts/make_uv.py <dims.json> <sortie.png>"""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont
P = json.load(open(os.environ['BOTTLE_PARAMS'])); D = json.load(open(sys.argv[1]))
R = D['bounds']['BODY']['xmax']; rf = P['body_bottom_fillet']; z_sh0 = D['z_shoulder_start']
C = 2 * math.pi * R; z0p, z1p = rf + 0.035, z_sh0 - 0.02
S = 2000; W, H = int(C * S), S; pad = 140
img = Image.new('RGB', (W + 2 * pad, H + 2 * pad), 'white'); d = ImageDraw.Draw(img)
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 30); Fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 24)
X = lambda u: pad + u * W; Y = lambda v: pad + (1 - v) * H
d.rectangle([X(0), Y(1), X(1), Y(z_sh0)], fill=(236, 236, 233)); d.rectangle([X(0), Y(rf), X(1), Y(0)], fill=(236, 236, 233))
d.rectangle([X(0), Y(1), X(1), Y(0)], outline=(17, 17, 17), width=4)
d.text((X(0.01), Y(0.985)), f'EPAULEMENT + COL (z > {z_sh0:.2f}) : surface non cylindrique, hors impression', fill=(120, 120, 115), font=Fs)
d.text((X(0.01), Y(0.025)), 'CONGE DU FOND', fill=(120, 120, 115), font=Fs)
d.rectangle([X(0), Y(z1p), X(1), Y(z0p)], outline=(255, 107, 0), width=4)
d.text((X(0.005), Y(z1p) + 8), 'PRINT_WRAP_360', fill=(255, 107, 0), font=F)
w = 120 / 360
d.rectangle([X(0.5 - w / 2), Y(z1p) + 50, X(0.5 + w / 2), Y(z0p) - 10], outline=(17, 17, 17), width=3)
d.text((X(0.5 - w / 2) + 12, Y(z1p) + 60), 'PRINT_FRONT (120 deg)', fill=(17, 17, 17), font=F)
d.rectangle([X(0), Y(z1p) + 50, X(w / 2), Y(z0p) - 10], outline=(17, 17, 17), width=3)
d.rectangle([X(1 - w / 2), Y(z1p) + 50, X(1), Y(z0p) - 10], outline=(17, 17, 17), width=3)
d.text((X(1 - w / 2) + 12, Y(z1p) + 60), 'PRINT_BACK', fill=(17, 17, 17), font=F); d.text((X(0) + 12, Y(z1p) + 60), 'PRINT_BACK', fill=(17, 17, 17), font=F)
for u, lab, col in ((0.5, 'AXE FACE (u = 0.5)', (0, 150, 255)), (0.0, 'COUTURE / DOS', (200, 0, 0)), (1.0, '', (200, 0, 0))):
    for yy in range(int(Y(1)), int(Y(0)), 30): d.line([X(u), yy, X(u), yy + 15], fill=col, width=3)
    if lab: d.text((X(u) + 8, Y(0.5)), lab, fill=col, font=Fs)
d.text((pad, 30), f'SKLUBS BOTTLE - UV_BODY_MASTER (deroule)   largeur = 2.pi.R = {C:.4f}   hauteur = 1.0000   unites BODY_HEIGHT (mm : TO_DEFINE_FACTORY)', fill=(17, 17, 17), font=F)
d.text((pad, H + pad + 40), f'Zone imprimable proposee : z {z0p:.3f} -> {z1p:.3f} (hauteur {z1p - z0p:.3f}). Face / dos : 120 deg chacune. Marges et fond perdu : TO_DEFINE_FACTORY.', fill=(17, 17, 17), font=Fs)
img.save(sys.argv[2]); print(img.size, 'zone', round(z0p, 3), round(z1p, 3))
