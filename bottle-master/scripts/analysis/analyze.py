import numpy as np, colorsys
from PIL import Image, ImageDraw
im = np.asarray(Image.open('ref_panel.png').convert('RGB')).astype(float)
H, W, _ = im.shape
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mx = im.max(-1); mn = im.min(-1)
lum = 0.2126*r + 0.7152*g + 0.0722*b
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
# teinte en degrés
hue = np.zeros_like(r)
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
np.save('hsl.npy', np.stack([hue, sat, lum]))
# échantillons
for name, (x, y) in {'bg_top': (300, 10), 'bg_mid': (560, 150), 'blue': (217, 250), 'blue_cap': (217, 85), 'blue_ring': (217, 107), 'black': (55, 250), 'pink': (470, 250), 'floor': (300, 345)}.items():
    print(f'{name:10s} rgb={im[y,x].astype(int)} hue={hue[y,x]:.0f} sat={sat[y,x]:.2f} lum={lum[y,x]:.0f}')
