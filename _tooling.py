# -*- coding: utf-8 -*-
import importlib, pathlib
for m in ["edge_tts", "PIL", "numpy", "librosa"]:
    try:
        mod = importlib.import_module(m); print(m, "OK", getattr(mod, "__version__", ""))
    except Exception as e:
        print(m, "MISSING", e)
for f in [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\Deng.ttf", r"C:\Windows\Fonts\simhei.ttf"]:
    p = pathlib.Path(f); print(p.name, p.exists())
mus = sorted(pathlib.Path(r"E:/Users/86134/Music").glob("*.MP3"))[:8]
print("music:", [m.name for m in mus])
