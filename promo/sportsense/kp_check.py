# -*- coding: utf-8 -*-
import json, pathlib
from PIL import Image, ImageDraw, ImageFont
ROOT = pathlib.Path(r"D:/jump app/promo/sportsense")
d = json.load(open(ROOT / "assets/hero_kp.json", encoding="utf-8"))
img = Image.open(ROOT / "assets/hero.png").convert("RGB")
dr = ImageDraw.Draw(img)
f = ImageFont.truetype(r"C:/Windows/Fonts/msyh.ttc", 18)
NAMES = ["nose","leye","reye","lear","rear","lsho","rsho","lelb","relb","lwri","rwri","lhip","rhip","lkne","rkne","lank","rank"]
for i, n in enumerate(NAMES):
    x, y = d[n]
    sc = d["_scores"][i]
    col = (0,255,120) if sc > 0.6 else (255,80,80)
    dr.ellipse([x-5, y-5, x+5, y+5], fill=col)
    dr.text((x+7, y-8), n, font=f, fill=col)
img.save(ROOT / "assets/_kpcheck.png")
print("saved", img.size)
print("scores", d["_scores"])
