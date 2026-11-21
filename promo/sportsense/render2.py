# -*- coding: utf-8 -*-
"""v2：真实照片 + 骨骼绑定 + 数据标注 + 特效 + 音效（无音乐）"""
import json, math, pathlib, subprocess, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
TL = json.load(open(OUT / "timeline.json", encoding="utf-8"))
W, H, FPS = 1080, 1920, 30
ACCENT = (183, 242, 75)
WHITE = (245, 248, 255)
GREY = (150, 162, 182)
F_BOLD = r"C:/Windows/Fonts/msyhbd.ttc"
F_REG = r"C:/Windows/Fonts/msyh.ttc"

def font(sz, bold=True):
    return ImageFont.truetype(F_BOLD if bold else F_REG, sz)

def clamp01(x): return max(0.0, min(1.0, x))
def ease(x):
    x = clamp01(x); return x * x * (3 - 2 * x)
def easeout(x):
    x = clamp01(x); return 1 - (1 - x) ** 3

# ---------- 素材 ----------
HERO = Image.open(OUT / "assets/hero.png").convert("RGB")
HERO_W = W
HERO_H = int(HERO.size[1] * HERO_W / HERO.size[0])
HERO_Y = (H - HERO_H) // 2
SCALE = HERO_W / HERO.size[0]
KP = json.load(open(OUT / "assets/hero_kp.json", encoding="utf-8"))

def hp(x, y):
    """照片坐标 -> 画布坐标"""
    return (x * SCALE, y * SCALE + HERO_Y)

# 手工校正后的骨架（照片坐标）
NECK = (365, 588)
JOINTS = {
    "head": (335, 523),
    "neck": (350, 570),
    "shL": (331, 585), "shR": (378, 590),
    "elL": (400, 640), "elR": (430, 610),
    "wrL": (440, 690), "wrR": (478, 625),
    "hipC": (372, 700), "hipL": (356, 702), "hipR": (388, 698),
    "knL": (250, 800), "knR": (330, 840),
    "anL": (142, 890), "anR": (468, 905),
}
BONES = [("head", "neck", 0), ("neck", "shL", 1), ("neck", "shR", 2),
         ("shL", "elL", 3), ("shR", "elR", 4), ("elL", "wrL", 5), ("elR", "wrR", 6),
         ("neck", "hipC", 7), ("hipC", "hipL", 8), ("hipC", "hipR", 9),
         ("hipL", "knL", 10), ("hipR", "knR", 11), ("knL", "anL", 12), ("knR", "anR", 13)]

SCREENS = {}
for key, rel in {"analyze": "上架素材/screens/02_analyze.png",
                 "data": "上架素材/screens/05_data.png",
                 "dunk": "上架素材/screens/04_dunk_result.png",
                 "jump": "上架素材/screens/01_home.png"}.items():
    SCREENS[key] = Image.open(ROOT / rel).convert("RGB")

# ---------- 基础绘制 ----------
def make_bg():
    top = np.array([6, 8, 15], np.float32); bot = np.array([13, 18, 32], np.float32)
    col = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    arr = (top[None, None, :] * (1 - col) + bot[None, None, :] * col)
    img = Image.fromarray(np.repeat(arr, W, axis=1).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    for x in range(-H, W + H, 96):
        d.line([(x, 0), (x + H, H)], fill=(120, 160, 255, 11), width=1)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W//2-520, 380, W//2+520, 1420], fill=(70, 110, 255, 24))
    return Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(120)))

BG = make_bg()

def txt(d, xy, s, f, fill, anchor="mm", alpha=255):
    if alpha <= 0: return
    d.text(xy, s, font=f, fill=tuple(fill[:3]) + (int(alpha),), anchor=anchor)

def brand(img, alpha=1.0):
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([54, 70, 304, 124], 16, fill=(16, 22, 36, int(190*alpha)), outline=ACCENT + (int(120*alpha),), width=1)
    txt(d, (80, 97), "VERTRISE", font(25), ACCENT, "lm", int(240*alpha))
    txt(d, (204, 98), "跃升", font(24), WHITE, "lm", int(220*alpha))
    return img

def caption(img, s, alpha, y=1700):
    if alpha <= 0: return img
    d = ImageDraw.Draw(img, "RGBA")
    f = font(38)
    tw = d.textlength(s, font=f)
    d.rounded_rectangle([(W-tw)/2-34, y-46, (W+tw)/2+34, y+34], 18, fill=(10, 14, 24, int(160*alpha)))
    d.rounded_rectangle([(W-tw)/2-34, y-46, (W-tw)/2-34+46, y-43], 2, fill=ACCENT + (int(230*alpha),))
    txt(d, (W/2, y), s, f, WHITE, "mm", int(238*alpha))
    return img

def hud_corners(img, k, alpha=1.0):
    d = ImageDraw.Draw(img, "RGBA")
    m, L = 54, int(120 * k)
    for (x, y, dx, dy) in [(m, m, 1, 1), (W-m, m, -1, 1), (m, H-m, 1, -1), (W-m, H-m, -1, -1)]:
        d.line([(x, y), (x + dx*L, y)], fill=ACCENT + (int(150*alpha),), width=3)
        d.line([(x, y), (x, y + dy*L)], fill=ACCENT + (int(150*alpha),), width=3)
    return img

def live_chip(img, t, alpha=1.0):
    d = ImageDraw.Draw(img, "RGBA")
    x, y = W - 300, 88
    d.rounded_rectangle([x, y-26, x+230, y+26], 26, fill=(30, 10, 10, int(170*alpha)), outline=(255, 90, 90, int(180*alpha)))
    blink = 0.5 + 0.5 * math.sin(t * 6)
    d.ellipse([x+18, y-7, x+32, y+7], fill=(255, 80, 80, int((120 + 120*blink) * alpha)))
    txt(d, (x+44, y+1), "REC · AI 分析中", font(22), (255, 210, 210), "lm", int(230*alpha))
    return img

def hero_photo(img, zoom=1.0, dy=0, alpha=1.0, blur_bg=True):
    w = int(HERO_W * zoom); h = int(HERO_H * zoom)
    x = (W - w) // 2; y = HERO_Y + dy - (h - HERO_H) // 2
    if blur_bg:
        b = HERO.resize((W//2, HERO_H//2)).filter(ImageFilter.GaussianBlur(26)).resize((W, HERO_H * 2), Image.BICUBIC)
        b = b.crop((0, max(0, (b.size[1]-H)//2), W, max(0, (b.size[1]-H)//2) + H))
        if alpha < 1:
            b.putalpha(b.convert("RGBA").split()[3].point(lambda v: int(v*alpha)))
        img.alpha_composite(b.convert("RGBA"), (0, 0))
    ph = HERO.resize((w, h), Image.LANCZOS).convert("RGBA")
    if alpha < 1:
        ph.putalpha(ph.split()[3].point(lambda v: int(v * alpha)))
    img.alpha_composite(ph, (x, y))
    return img

def gradient_scrims(img):
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(260):
        a = int(200 * (1 - i / 260) ** 1.6)
        d.line([(0, i), (W, i)], fill=(6, 8, 15, a))
        d.line([(0, H-1-i), (W, H-1-i)], fill=(6, 8, 15, a))
    return img

def skeleton(img, prog, jalpha=1.0, glow=True):
    d = ImageDraw.Draw(img, "RGBA")
    pts = {k: hp(*v) for k, v in JOINTS.items()}
    n = prog * len(BONES)
    if glow:
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
        for i, (a, b, _) in enumerate(BONES):
            if i + 1 <= n + 0.001:
                kk = clamp01(n - i)
                p1 = pts[a]; q1 = pts[b]
                od.line([p1, (p1[0] + (q1[0]-p1[0])*kk, p1[1] + (q1[1]-p1[1])*kk)], fill=ACCENT + (120,), width=16)
        img.alpha_composite(ov.filter(ImageFilter.GaussianBlur(14)))
        d = ImageDraw.Draw(img, "RGBA")
    for i, (a, b, idx) in enumerate(BONES):
        kk = clamp01(n - i)
        if kk <= 0: continue
        p1, q1 = pts[a], pts[b]
        p2 = (p1[0] + (q1[0]-p1[0])*kk, p1[1] + (q1[1]-p1[1])*kk)
        d.line([p1, p2], fill=ACCENT + (int(240*jalpha),), width=7)
    for i, key in enumerate(JOINTS):
        kk = clamp01(prog * len(BONES) - 0.5 - i * 0.35)
        if kk <= 0: continue
        x, y = pts[key]
        if key == "head":
            rr = int(44 * kk)
            d.ellipse([x-rr, y-rr-4, x+rr, y+rr-4], outline=ACCENT + (int(240*kk*jalpha),), width=5)
            continue
        r = int(10 * kk)
        d.ellipse([x-r-2, y-r-2, x+r+2, y+r+2], outline=ACCENT + (int(180*kk*jalpha),), width=2)
        d.ellipse([x-r, y-r, x+r, y+r], fill=ACCENT + (int(250*kk*jalpha),))
    return img

def callout(img, ax, ay, bx, by, label, value, k, side="r"):
    """从骨架点引出标注"""
    if k <= 0: return img
    d = ImageDraw.Draw(img, "RGBA")
    ex = ax + (bx - ax) * k
    ey = ay + (by - ay) * k
    d.line([(ax, ay), (ex, ey)], fill=ACCENT + (int(220*clamp01(k*1.4)),), width=2)
    d.ellipse([ex-5, ey-5, ex+5, ey+5], fill=ACCENT + (int(240*clamp01(k*1.4)),))
    if k < 0.85: return img
    a = clamp01((k - 0.85) / 0.15)
    f1, f2 = font(24), font(46)
    wv = d.textlength(value, font=f2)
    wl = d.textlength(label, font=f1)
    pad = 18
    bw = max(wv, wl) + pad * 2
    bh = 100
    x0 = bx if side == "r" else bx - bw
    x0 = max(24, min(x0, W - bw - 24))
    y0 = max(150, min(by - bh / 2, H - 320))
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], 16, fill=(14, 20, 32, int(225*a)), outline=ACCENT + (int(150*a),), width=1)
    txt(d, (x0 + pad, y0 + 28), label, f1, GREY, "lm", int(235*a))
    txt(d, (x0 + pad, y0 + 68), value, f2, WHITE, "lm", int(250*a))
    return img

def phone(img, key, cx, cy, width, alpha=1.0, rot=0.0, badge=None):
    scr = SCREENS[key]
    ratio = scr.size[1] / scr.size[0]
    sw = int(width - 26); sh = int(sw * ratio)
    pw, phh = width, sh + 26
    bez = Image.new("RGBA", (pw, phh), (0, 0, 0, 0)); bd = ImageDraw.Draw(bez)
    bd.rounded_rectangle([0, 0, pw-1, phh-1], 52, fill=(16, 18, 26, 255), outline=(60, 70, 95, 255), width=2)
    bd.rounded_rectangle([8, 8, pw-9, phh-9], 46, fill=(8, 10, 16, 255))
    bez.paste(scr.resize((sw, sh), Image.LANCZOS), (13, 13))
    bd.rounded_rectangle([pw/2-52, 22, pw/2+52, 34], 6, fill=(30, 34, 46, 255))
    if rot: bez = bez.rotate(rot, expand=True, resample=Image.BICUBIC)
    if alpha < 1: bez.putalpha(bez.split()[3].point(lambda v: int(v*alpha)))
    img.alpha_composite(bez, (int(cx-bez.size[0]/2), int(cy-bez.size[1]/2)))
    if badge:
        d = ImageDraw.Draw(img, "RGBA"); f = font(26)
        tw = d.textlength(badge, font=f)
        bx = cx - bez.size[0]/2 - 10; by = cy + bez.size[1]/2 - 34
        d.rounded_rectangle([bx-18, by-22, bx+tw+18, by+24], 22, fill=(18, 26, 16, 225), outline=ACCENT + (170,))
        txt(d, (bx, by+1), badge, f, ACCENT, "lm")
    return img

def flash(img, a):
    if a <= 0: return img
    base = img.convert("RGBA")
    white = Image.new("RGBA", base.size, (255, 255, 255, 255))
    return Image.blend(base, white, min(0.55, a)).convert("RGBA")

def sparks(img, cx, cy, t, seed, count=10, radius=90):
    if t <= 0: return img
    d = ImageDraw.Draw(img, "RGBA")
    rnd = random.Random(seed)
    for i in range(count):
        ang = rnd.uniform(0, math.tau)
        sp = rnd.uniform(60, 220)
        life = 0.55
        age = min(t, life)
        r = 8 + sp * age
        a = int(220 * (1 - age/life))
        x = cx + math.cos(ang) * r
        y = cy + math.sin(ang) * r + 40 * age * age
        d.ellipse([x-2, y-2, x+2, y+2], fill=ACCENT + (a,))
    return img

# ---------------- 场景 ----------------
def s_hero(img, t, T):
    """真实照片 + 骨骼绑定 + 数据标注"""
    zoom = 1.0 + 0.03 * (t / T)
    a = ease(clamp01(t / 0.7))
    img = hero_photo(img, zoom=zoom, dy=0, alpha=a)
    img = gradient_scrims(img)
    if t < 0.9:
        img = flash(img, 0.5 * (1 - t / 0.9) ** 2)
    # 标题
    k1 = ease(clamp01(t / 0.6))
    d = ImageDraw.Draw(img, "RGBA")
    if t < 3.4:
        fade = 1 - ease(clamp01((t - 2.4) / 1.0))
        txt(d, (70, 280 - 20*(1-k1)), "先看这一跳", font(84), WHITE, "lm", int(250*k1*fade))
        txt(d, (72, 360), "DUNKADEMICS · 实测片段", font(26), ACCENT, "lm", int(220*k1*fade))
    # HUD
    hk = ease(clamp01((t - 1.0) / 0.8))
    img = hud_corners(img, hk, 1.0)
    if t > 1.2:
        img = live_chip(img, t, clamp01((t - 1.2) / 0.5))
    # 骨架进度
    prog = clamp01((t - 1.8) / 2.6)
    if prog > 0:
        img = skeleton(img, prog)
        # 关节弹出火花
        for i, key in enumerate(JOINTS):
            born = 1.8 + 2.6 * ((i * 0.35 + 0.5) / len(BONES))
            if 0 < t - born < 0.5:
                pt = hp(*JOINTS[key])
                img = sparks(img, pt[0], pt[1], t - born, seed=i, count=8, radius=70)
    # 数据标注
    if t > 5.0:
        kk = clamp01((t - 5.0) / 1.0)
        head = hp(*JOINTS["head"]); anL = hp(*JOINTS["anL"]); knL = hp(*JOINTS["knL"])
        callout(img, head[0], head[1], head[0] + 210, head[1] - 120, "弹跳高度", "78.2 cm", kk, "r")
        callout(img, knL[0], knL[1], knL[0] - 190, knL[1] - 60, "屈膝角", "118°", clamp01((t - 5.6) / 1.0), "l")
    if t > 6.6:
        k2 = clamp01((t - 6.6) / 1.0)
        wrR = hp(*JOINTS["wrR"])
        callout(img, wrR[0], wrR[1], wrR[0] + 150, wrR[1] - 90, "摆臂角速度", "726°/s", k2, "r")
    # 离地标注（从脚到头）
    if t > 8.2:
        k3 = clamp01((t - 8.2) / 0.9)
        anL = hp(*JOINTS["anL"]); head = hp(*JOINTS["head"])
        x = anL[0] - 60
        y_bot = anL[1] + 20
        y_top = y_bot + (head[1] - 90 - y_bot) * easeout(k3)
        d = ImageDraw.Draw(img, "RGBA")
        d.line([(x, y_bot), (x, y_top)], fill=ACCENT + (200,), width=3)
        for yy in (y_bot, y_top):
            d.line([(x-10, yy), (x+10, yy)], fill=ACCENT + (220,), width=3)
        if k3 > 0.8:
            txt(d, (x - 16, (y_bot + y_top)/2), "离地 78.2", font(24), ACCENT, "rm", int(230*clamp01((k3-0.8)/0.2)))
    return caption(img, "手机拍一段，AI 把这一跳拆开", ease(clamp01((t - 2.0) / 0.7)))

METRIC_ROWS = [("弹跳高度", "78.2", "cm"), ("屈膝深度", "118", "°"), ("起跳角度", "14", "°"),
               ("摆臂速度", "726", "°/s"), ("两步节奏", "0.92", ""), ("落地摆动", "4.1", "%")]

def s_measure(img, t, T):
    zoom = 1.0 + 0.02 * (t / T)
    img = hero_photo(img, zoom=zoom, dy=0)
    img = gradient_scrims(img)
    img = skeleton(img, 1.0, jalpha=0.85)
    d = ImageDraw.Draw(img, "RGBA")
    k0 = ease(clamp01(t / 0.5))
    # 底部遮罩，保证数据卡清晰
    ve = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ve).rectangle([0, 1180, W, H], fill=(6, 8, 15, 205))
    img.alpha_composite(ve.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([W/2-330, 168, W/2+330, 268], 24, fill=(6, 8, 15, int(190*k0)))
    txt(d, (W/2, 218), "六项指标，一次测量", font(64), WHITE, "mm", int(245*k0))
    # 两列三行数据卡（在遮罩上）
    for i, (label, val, unit) in enumerate(METRIC_ROWS):
        k = ease(clamp01((t - 0.4 - i * 0.55) / 0.5))
        if k <= 0: continue
        col = i % 2
        row = i // 2
        bw, bh = 450, 104
        x = 74 + col * (bw + 32)
        y = 1265 + row * 124 + 26 * (1 - k)
        d.rounded_rectangle([x, y, x+bw, y+bh], 18, fill=(14, 20, 32, int(228*k)), outline=ACCENT + (int(120*k),), width=1)
        d.rounded_rectangle([x+18, y+bh/2-18, x+22, y+bh/2+18], 2, fill=ACCENT + (int(220*k),))
        txt(d, (x+38, y+30), label, font(26), GREY, "lm", int(230*k))
        txt(d, (x+38, y+66), val + (" " + unit if unit else ""), font(42), WHITE, "lm", int(250*k))
    return caption(img, "每一项都有数字，不再靠感觉", ease(clamp01((t - 3.6) / 0.6)))

def s_record(img, t, T):
    d = ImageDraw.Draw(img, "RGBA")
    k0 = ease(clamp01(t / 0.5))
    txt(d, (W/2, 300), "手机拍一段就够", font(62), WHITE, "mm", int(245*k0))
    txt(d, (W/2, 380), "不用穿戴设备 · 不用去实验室", font(30), GREY, "mm", int(220*k0))
    phone(img, "jump", W/2, 1010, 540, alpha=ease(clamp01(t / 0.6)))
    # 扫描线
    y = 640 + (clamp01(t / T) * 700)
    d.line([(W/2-250, y), (W/2+250, y)], fill=ACCENT + (150,), width=3)
    d.line([(W/2-250, y-18), (W/2+250, y-18)], fill=ACCENT + (60,), width=1)
    return caption(img, "录好视频，剩下的交给 AI", ease(clamp01((t - 1.2) / 0.6)))

def s_track(img, t, T):
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(7):
        yy = 1300 + i * 44
        d.line([(0, yy), (W, yy)], fill=(90, 120, 200, 16), width=1)
    # 深色骨架（复用 hero 关键点比例）
    a = ease(clamp01(t / 0.5))
    n = int(min(33, 33 * ease(clamp01(t / 1.5))))
    txt(d, (W/2, 520), str(n), font(150), ACCENT, "mm", int(245*a))
    txt(d, (W/2, 640), "个关键点逐帧追踪", font(42), WHITE, "mm", int(235*a))
    draw_stylized(img, t, a)
    return caption(img, "AI 自动识别骨架，动作细节全量化", ease(clamp01((t - 1.0) / 0.6)))

STICK = {
    "head": (0, -0.92), "neck": (0, -0.72), "shL": (-0.17, -0.70), "shR": (0.17, -0.70),
    "elL": (-0.28, -0.46), "elR": (0.28, -0.46), "wrL": (-0.32, -0.22), "wrR": (0.32, -0.22),
    "hipC": (0, -0.30), "hipL": (-0.10, -0.30), "hipR": (0.10, -0.30),
    "knL": (-0.13, -0.02), "knR": (0.13, -0.02), "anL": (-0.14, 0.26), "anR": (0.14, 0.26),
}
STICK_BONES = [("head","neck"),("neck","shL"),("neck","shR"),("shL","elL"),("shR","elR"),
               ("elL","wrL"),("elR","wrR"),("neck","hipC"),("hipC","hipL"),("hipC","hipR"),
               ("hipL","knL"),("hipR","knR"),("knL","anL"),("knR","anR")]

def draw_stylized(img, t, alpha=1.0):
    d = ImageDraw.Draw(img, "RGBA")
    cx, cy, sc = W/2, 1150, 430
    pts = {k: (cx + x*sc, cy + y*sc + math.sin(t*2)*4) for k, (x, y) in STICK.items()}
    ov = Image.new("RGBA", img.size, (0,0,0,0)); od = ImageDraw.Draw(ov)
    for a, b in STICK_BONES:
        od.line([pts[a], pts[b]], fill=ACCENT + (110,), width=14)
    img.alpha_composite(ov.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(img, "RGBA")
    for a, b in STICK_BONES:
        d.line([pts[a], pts[b]], fill=ACCENT + (int(240*alpha),), width=7)
    for k, p in pts.items():
        if k == "head":
            d.ellipse([p[0]-26, p[1]-28, p[0]+26, p[1]+28], outline=ACCENT + (int(240*alpha),), width=6)
        else:
            d.ellipse([p[0]-6, p[1]-6, p[0]+6, p[1]+6], fill=ACCENT + (int(245*alpha),))
    return img

CHIPS5 = ["弹跳类型：速度型", "短板：摆臂 / 两步节奏", "计划：4 周可直接照做"]

def s_ai(img, t, T):
    d = ImageDraw.Draw(img, "RGBA")
    phone(img, "analyze", W/2 + 205, 1030, 420, alpha=ease(clamp01(t / 0.6)))
    txt(d, (72, 650), "AI 报告", font(64), WHITE, "lm", int(240*ease(clamp01(t / 0.5))))
    for i, s in enumerate(CHIPS5):
        k = ease(clamp01((t - 0.7 - i * 0.6) / 0.5))
        if k <= 0: continue
        f = font(27); tw = d.textlength(s, font=f)
        y = 760 + i * 86; x = 72 - 20*(1-k)
        d.rounded_rectangle([x, y-30, x+tw+40, y+30], 18, fill=(20, 28, 44, int(225*k)), outline=ACCENT + (int(130*k),), width=1)
        txt(d, (x+20, y), s, f, WHITE, "lm", int(238*k))
    return caption(img, "不只是打分，还告诉你下一步怎么练", ease(clamp01((t - 2.8) / 0.6)))

def s_data(img, t, T):
    a = ease(clamp01(t / 0.7))
    phone(img, "data", W/2 - 180, 980, 440, alpha=a, rot=6, badge="进步曲线")
    phone(img, "dunk", W/2 + 190, 1040, 400, alpha=a, rot=-7, badge="扣篮潜力")
    return caption(img, "每一跳自动存档，换个手机也带得走", ease(clamp01((t - 1.2) / 0.6)))

def s_cta(img, t, T):
    a = ease(clamp01(t / 0.6))
    d = ImageDraw.Draw(img, "RGBA")
    if t < 0.5:
        img = flash(img, 0.35 * (1 - t/0.5))
    # 冲击波
    if t < 1.2:
        r = 120 + 900 * easeout(t / 1.2)
        d.ellipse([W/2-r, 900-r, W/2+r, 900+r], outline=ACCENT + (int(120*(1-t/1.2)),), width=3)
    txt(d, (W/2, 800), "Vertrise 跃升", font(88), WHITE, "mm", int(250*a))
    txt(d, (W/2, 900), "弹跳 / 起跳 / 扣篮潜力，一次拍清", font(34), GREY, "mm", int(230*a))
    k = ease(clamp01((t - 0.7) / 0.6))
    d.rounded_rectangle([W/2-270, 1010, W/2+270, 1130], 60, fill=ACCENT + (int(238*k),))
    txt(d, (W/2, 1070), "安卓已上线 · 免费下载", font(38), (10, 14, 10), "mm", int(255*k))
    if k > 0.4:
        txt(d, (W/2, 1230), "jumptool.netlify.app", font(32), ACCENT, "mm", int(225*k))
    return caption(img, "现在就去测你的第一跳", ease(clamp01((t - 1.4) / 0.6)))

SCENES = {"s1": s_hero, "s2": s_measure, "s3": s_record, "s4": s_track,
          "s5": s_ai, "s6": s_data, "s7": s_cta}

# ---------------- 音效事件 ----------------
def build_events():
    ev = []
    for s in TL["scenes"]:
        st, ln, nm = s["start"], s["len"], s["name"]
        ev.append((st, "whoosh", 0.7))
        if nm in ("s1", "s7"):
            ev.append((st, "impact", 0.9))
        if nm == "s1":
            for i in range(len(JOINTS)):
                t0 = st + 1.8 + 2.6 * ((i * 0.35 + 0.5) / len(BONES))
                ev.append((t0, "pop", 0.5))
            for i in range(4):
                ev.append((st + 5.0 + i * 0.9, "ui", 0.6))
            ev.append((st + 8.2, "scan", 0.5))
        if nm == "s2":
            for i in range(6):
                ev.append((st + 0.5 + i * 0.55, "ui", 0.5))
            for i in range(40):
                ev.append((st + 0.6 + i * 0.08, "tick", 0.16))
        if nm in ("s3", "s4"):
            ev.append((st + 0.2, "scan", 0.5))
            for i in range(6):
                ev.append((st + 0.3 + i * 0.25, "tick", 0.2))
        if nm == "s5":
            for i in range(3):
                ev.append((st + 0.7 + i * 0.6, "ui", 0.6))
        if nm == "s6":
            ev.append((st + 0.2, "ui", 0.5))
        ev.append((st + ln - 0.45, "riser", 0.5))
    return ev

def render():
    total = TL["total"]; n = int(round(total * FPS))
    ff = subprocess.Popen([
        r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe",
        "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", str(W) + "x" + str(H),
        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
        "-pix_fmt", "yuv420p", str(OUT / "video2_silent.mp4")], stdin=subprocess.PIPE)
    scenes = TL["scenes"]
    for i in range(n):
        t = i / FPS
        cur = scenes[-1]
        for s in scenes:
            if s["start"] <= t < s["start"] + s["len"]:
                cur = s; break
        img = base_frame_for(cur["name"], t)
        lt = t - cur["start"]
        img = SCENES[cur["name"]](img, lt, cur["len"])
        img = brand(img)
        # 转场闪白
        for s in scenes:
            if 0 <= t - (s["start"] - 0.06) < 0.14:
                img = flash(img, 0.22 * (1 - abs(t - (s["start"] - 0.06)) / 0.07))
        ff.stdin.write(img.convert("RGB").tobytes())
        if i % 200 == 0: print("frame", i, "/", n, flush=True)
    ff.stdin.close(); ff.wait()
    print("video2 done")

def base_frame_for(name, t):
    if name in ("s1", "s2"):
        return Image.new("RGBA", (W, H), (0, 0, 0, 255))
    return BG.copy()

render()
