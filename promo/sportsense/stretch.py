# -*- coding: utf-8 -*-
"""把渲染时长拉到 ~58 秒（不改旁白，只加镜头余量）"""
import json, pathlib
p = pathlib.Path(r"D:/jump app/promo/sportsense/timeline.json")
d = json.load(open(p, encoding="utf-8"))
extra = {"s1": 0.4, "s2": 0.5, "s3": 0.6, "s4": 1.2, "s5": 1.2, "s6": 1.2, "s7": 1.6}
t = 0.0
for it in d["scenes"]:
    it["len"] = round(it["len"] + extra[it["name"]], 3)
    it["start"] = round(t, 3)
    t += it["len"]
d["total"] = round(t, 3)
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("total", d["total"])
for it in d["scenes"]:
    print(it["name"], it["start"], it["len"])
