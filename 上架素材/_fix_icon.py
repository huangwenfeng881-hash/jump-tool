# -*- coding: utf-8 -*-
import os
import numpy as np
from PIL import Image, ImageDraw
SRC = r'D:\jump app\img\logo.png'
OUT = r'D:\jump app\上架素材'
im = Image.open(SRC).convert('RGB')
arr = np.asarray(im).astype(int)
h, w = im.height, im.width
# 只在上半区域、且排除 40px 边框内测非白像素
sub = arr[:int(h*0.60), :, :]
mask = (sub.sum(axis=2) < 700)
mask[:40, :] = False; mask[:, :40] = False; mask[:, -40:] = False
ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print('bbox', x0, y0, x1, y1)
pad = 26
mark = im.crop((max(0,x0-pad), max(0,y0-pad), min(w,x1+pad), min(h,y1+pad)))
for size, name in ((512, 'icon-512.png'), (1024, 'icon-1024.png')):
    canvas = Image.new('RGB', (size, size), (255,255,255))
    inner = int(size*0.80)
    mw, mh = mark.size
    s = min(inner/mw, inner/mh)
    m = mark.resize((int(mw*s), int(mh*s)), Image.LANCZOS)
    canvas.paste(m, ((size-m.width)//2, (size-m.height)//2))
    canvas.save(os.path.join(OUT, name))
base = Image.open(os.path.join(OUT, 'icon-512.png'))
mask2 = Image.new('L', (512,512), 0)
ImageDraw.Draw(mask2).rounded_rectangle([0,0,511,511], radius=112, fill=255)
out = Image.new('RGB', (512,512), (255,255,255))
out.paste(base, (0,0), mask2)
out.save(os.path.join(OUT, 'icon-512-rounded.png'))
print('ok')
