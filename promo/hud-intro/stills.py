# -*- coding: utf-8 -*-
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("r", r"D:/jump app/promo/hud-intro/render.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
shots = [2.0, 11.0, 19.0, 28.0, 37.0, 46.0, 54.0]
for i, t in enumerate(shots):
    m.frame(t).save(rf"D:/jump app/promo/hud-intro/_s{i+1}.png")
print("stills", shots)
