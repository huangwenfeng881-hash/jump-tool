# -*- coding: utf-8 -*-
import pathlib
from PIL import Image
d = pathlib.Path(r"D:/jump app/ref_sportsense")
files = sorted(d.glob("f*.png"))
cols, tw = 5, 300
im0 = Image.open(files[0]); th = int(tw * im0.size[1] / im0.size[0])
rows = (len(files) + cols - 1)//cols
sheet = Image.new("RGB", (cols*tw, rows*th), (8,8,12))
for i,f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((tw,th), Image.LANCZOS)
    sheet.paste(im, ((i%cols)*tw, (i//cols)*th))
sheet.save(r"D:/jump app/ref_sportsense/_sheet.png")
print(sheet.size, len(files))
