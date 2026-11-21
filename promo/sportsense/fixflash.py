# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/promo/sportsense/render2.py")
s = P.read_text(encoding="utf-8")
old = '''def flash(img, a):
    if a <= 0: return img
    return Image.blend(img, Image.new("RGB", img.size, (255, 255, 255)), min(0.55, a))'''
new = '''def flash(img, a):
    if a <= 0: return img
    base = img.convert("RGBA")
    white = Image.new("RGBA", base.size, (255, 255, 255, 255))
    return Image.blend(base, white, min(0.55, a)).convert("RGBA")'''
assert old in s
s = s.replace(old, new)
P.write_text(s, encoding="utf-8")
print("flash fixed")
