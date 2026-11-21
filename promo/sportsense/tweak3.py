# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/promo/sportsense/render2.py")
s = P.read_text(encoding="utf-8")

# 重新标定骨架（按画面逐点目测，换算回照片坐标）
old = '''JOINTS = {
    "head": (315, 556),
    "neck": NECK,
    "shL": (336, 606), "shR": (394, 612),
    "elL": (402, 668), "elR": (452, 628),
    "wrL": (430, 712), "wrR": (492, 606),
    "hipC": (372, 766), "hipL": (362, 768), "hipR": (382, 764),
    "knL": (250, 846), "knR": (330, 884),
    "anL": (146, 932), "anR": (468, 952),
}'''
new = '''JOINTS = {
    "head": (335, 523),
    "neck": (350, 570),
    "shL": (331, 585), "shR": (378, 590),
    "elL": (400, 640), "elR": (430, 610),
    "wrL": (440, 690), "wrR": (478, 625),
    "hipC": (372, 700), "hipL": (356, 702), "hipR": (388, 698),
    "knL": (250, 800), "knR": (330, 840),
    "anL": (142, 890), "anR": (468, 905),
}'''
assert old in s
s = s.replace(old, new)

# 场景2：不要再放大裁掉身体，恢复完整照片，标题加底
s = s.replace('    zoom = 1.18 + 0.05 * (t / T)\n    img = hero_photo(img, zoom=zoom, dy=60)',
              '    zoom = 1.0 + 0.02 * (t / T)\n    img = hero_photo(img, zoom=zoom, dy=0)')
s = s.replace('    txt(d, (W/2, 210), "六项指标，一次测量", font(64), WHITE, "mm", int(245*k0))',
              '''    d.rounded_rectangle([W/2-330, 168, W/2+330, 268], 24, fill=(6, 8, 15, int(190*k0)))
    txt(d, (W/2, 218), "六项指标，一次测量", font(64), WHITE, "mm", int(245*k0))''')
P.write_text(s, encoding="utf-8")
print("recalibrated")
