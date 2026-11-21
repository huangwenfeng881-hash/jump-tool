# -*- coding: utf-8 -*-
import pathlib
from PIL import Image
root = pathlib.Path(r"D:/jump app")
for sub in ["上架素材", "promo", "preview", "img"]:
    d = root / sub
    if not d.exists(): continue
    print("==", sub)
    for f in sorted(d.rglob("*.png"))[:14]:
        try:
            im = Image.open(f)
            print("  ", f.relative_to(root), im.size)
        except Exception as e:
            print("  ERR", f.name, e)
