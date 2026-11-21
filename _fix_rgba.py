# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/promo/hud-intro/render.py")
s = P.read_text(encoding="utf-8")

# grains 支持 RGBA
s = s.replace("""def grains(img, seed):
    rng = np.random.default_rng(seed % 100000)
    n = rng.normal(0, 0.028 * 255, (H // 2, W // 2)).astype(np.float32)
    n = np.repeat(np.repeat(n, 2, axis=0), 2, axis=1)[:H, :W]
    arr = np.asarray(img, dtype=np.float32) + n[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))""",
"""def grains(img, seed):
    rng = np.random.default_rng(seed % 100000)
    n = rng.normal(0, 0.028 * 255, (H // 2, W // 2)).astype(np.float32)
    n = np.repeat(np.repeat(n, 2, axis=0), 2, axis=1)[:H, :W]
    arr = np.asarray(img, dtype=np.float32)
    if arr.ndim == 3 and arr.shape[2] == 4:
        arr[..., :3] = np.clip(arr[..., :3] + n[..., None], 0, 255)
    else:
        arr = np.clip(arr + n[..., None], 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA" if arr.shape[2] == 4 else "RGB")""")

# frame：全程 RGBA
s = s.replace("""    lt = t - cur["start"]
    img = BASE.copy()
    img = SCENES[cur["name"]](img, lt, cur["len"])
    img = Image.alpha_composite(img.convert("RGBA"), scan_overlay()).convert("RGB")
    img = grains(img, int(t * 30))""",
"""    lt = t - cur["start"]
    img = BASE.convert("RGBA")
    img = SCENES[cur["name"]](img, lt, cur["len"]).convert("RGBA")
    img = Image.alpha_composite(img, scan_overlay())
    img = grains(img, int(t * 30)).convert("RGBA")""")

s = s.replace("""            img = Image.blend(img, Image.new("RGB", (W, H), (220, 250, 255)), a)""",
"""            img = Image.blend(img, Image.new("RGBA", (W, H), (220, 250, 255, 255)), a)""")

s = s.replace("""        img = glitch(img, t, int(t * 30))
    return img""",
"""        img = glitch(img, t, int(t * 30))
    return img.convert("RGB")""")

s = s.replace("""        img = Image.blend(img.convert("RGB"), Image.new("RGB", (W, H), BG), 0.85 * f_)""",
"""        img = Image.blend(img.convert("RGBA"), Image.new("RGBA", (W, H), BG + (255,)), 0.85 * f_)""")
P.write_text(s, encoding="utf-8")
print("rgba patched")
