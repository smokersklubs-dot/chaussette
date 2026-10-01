import numpy as np
from PIL import Image
import os
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', '..', 'reference', 'original', 'photo_originale.jpg')
im = np.asarray(Image.open(IMG).convert('RGB')).astype(float)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mx = im.max(-1); mn = im.min(-1); d = np.maximum(mx - mn, 1e-6)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
np.save(os.path.join(HERE, 'hsl.npy'), np.stack([hue, sat, lum])); np.save(os.path.join(HERE, 'rgb.npy'), im)
