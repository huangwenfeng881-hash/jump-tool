# -*- coding: utf-8 -*-
import json, pathlib
p = pathlib.Path(r"D:/jump app/promo/sportsense/timeline.json")
d = json.load(open(p, encoding="utf-8"))
extra = {"s1": 1.8, "s2": 1.3, "s3": 0.7, "s4": 0.7, "s5": 0.7, "s6": 0.6, "s7": 0.6}
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
