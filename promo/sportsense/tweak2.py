# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/promo/sportsense/render2.py")
s = P.read_text(encoding="utf-8")

# 1) 关节微调：手臂往身体内收，避免画到背景人群上
s = s.replace('''    "elL": (428, 652), "elR": (486, 640),
    "wrL": (452, 720), "wrR": (528, 662),''',
'''    "elL": (402, 668), "elR": (452, 628),
    "wrL": (430, 712), "wrR": (492, 606),''')

# 2) 头部画圆
s = s.replace('''    for i, key in enumerate(JOINTS):
        kk = clamp01(prog * len(BONES) - 0.5 - i * 0.35)
        if kk <= 0: continue
        x, y = pts[key]
        r = int(10 * kk)''',
'''    for i, key in enumerate(JOINTS):
        kk = clamp01(prog * len(BONES) - 0.5 - i * 0.35)
        if kk <= 0: continue
        x, y = pts[key]
        if key == "head":
            rr = int(44 * kk)
            d.ellipse([x-rr, y-rr-4, x+rr, y+rr-4], outline=ACCENT + (int(240*kk*jalpha),), width=5)
            continue
        r = int(10 * kk)''')

# 3) 标注气泡限制在画面内
s = s.replace('''    x0 = bx if side == "r" else bx - bw
    y0 = by - bh / 2''',
'''    x0 = bx if side == "r" else bx - bw
    x0 = max(24, min(x0, W - bw - 24))
    y0 = max(150, min(by - bh / 2, H - 320))''')

# 4) 场景2：标题上移、数据卡下移成两列三行、加遮罩
old2 = '''    k0 = ease(clamp01(t / 0.5))
    txt(d, (W/2, 250), "六项指标，一次测量", font(64), WHITE, "mm", int(245*k0))
    # 左右数据条
    for i, (label, val, unit) in enumerate(METRIC_ROWS):
        k = ease(clamp01((t - 0.4 - i * 0.55) / 0.5))
        if k <= 0: continue
        right = (i % 2 == 0)
        bw, bh = 380, 96
        x = (W - 120 - bw) if right else 120
        y = 1180 + (i // 2) * 118 + 30 * (1 - k)'''
new2 = '''    k0 = ease(clamp01(t / 0.5))
    # 底部遮罩，保证数据卡清晰
    ve = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ve).rectangle([0, 1180, W, H], fill=(6, 8, 15, 205))
    img.alpha_composite(ve.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(img, "RGBA")
    txt(d, (W/2, 210), "六项指标，一次测量", font(64), WHITE, "mm", int(245*k0))
    # 两列三行数据卡（在遮罩上）
    for i, (label, val, unit) in enumerate(METRIC_ROWS):
        k = ease(clamp01((t - 0.4 - i * 0.55) / 0.5))
        if k <= 0: continue
        col = i % 2
        row = i // 2
        bw, bh = 450, 104
        x = 74 + col * (bw + 32)
        y = 1265 + row * 124 + 26 * (1 - k)'''
assert old2 in s
s = s.replace(old2, new2)
P.write_text(s, encoding="utf-8")
print("patched scene1+2")
