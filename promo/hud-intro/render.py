# -*- coding: utf-8 -*-
"""Vertrise 跃升 · 60s 介绍片（赛博 HUD / FUI 风格，参考 1.drawai 画布）
画布给出的三件事：整片风格 22-hud（#020A0D + 青 #00E5FF）、四张镜头卡（行倒卡/级联/卡堆/花式）、
以及 60.03s 的音乐轨（1.drawai.media/audio-*/audio.wav）——本片严格按 60s / 120BPM / 0.5s 网格排布。
"""
import json, math, pathlib, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/hud-intro"
TL = json.loads((OUT / "timeline.json").read_text(encoding="utf-8"))
W, H, FPS, TOTAL = TL["w"], TL["h"], TL["fps"], TL["total"]

BG      = (2, 10, 13)
CYAN    = (0, 229, 255)
TEXT    = (232, 254, 255)
MUTED   = (107, 140, 147)
SURF    = (14, 58, 66)
RED     = (255, 42, 31)
PINK    = (255, 42, 138)
ORANGE  = (255, 102, 0)

FB = r"C:/Windows/Fonts/msyhbd.ttc"
FR = r"C:/Windows/Fonts/msyh.ttc"
FM = r"C:/Windows/Fonts/consola.ttf"
FMB = r"C:/Windows/Fonts/consolab.ttf"

def f(sz, kind="mono"):
    if kind == "bold": return ImageFont.truetype(FB, sz)
    if kind == "reg":  return ImageFont.truetype(FR, sz)
    if kind == "monob": return ImageFont.truetype(FMB, sz)
    return ImageFont.truetype(FM, sz)

def clamp01(x): return max(0.0, min(1.0, x))
def ease(x):
    x = clamp01(x); return x * x * (3 - 2 * x)
def easeout(x):
    x = clamp01(x); return 1 - (1 - x) ** 3
def lerp(a, b, k): return a + (b - a) * k
def seg(t, a, b): return clamp01((t - a) / max(1e-6, b - a))

# ---------- 底 ----------
def make_base():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img, "RGBA")
    for x in range(0, W + 1, 60):
        d.line([(x, 0), (x, H)], fill=CYAN + (10,), width=1)
    for y in range(0, H + 1, 60):
        d.line([(0, y), (W, y)], fill=CYAN + (8,), width=1)
    # 中心辉光
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W//2-420, H//2-420, W//2+420, H//2+420], fill=(0, 120, 150, 16))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(160))).convert("RGB")
    return img

BASE = make_base()
SCAN = None

def scan_overlay():
    global SCAN
    if SCAN is None:
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        for y in range(0, H, 3):
            d.line([(0, y), (W, y)], fill=(0, 0, 0, 60))
        SCAN = ov
    return SCAN

def grains(img, seed):
    rng = np.random.default_rng(seed % 100000)
    n = rng.normal(0, 0.013 * 255, (H // 2, W // 2)).astype(np.float32)
    n = np.repeat(np.repeat(n, 2, axis=0), 2, axis=1)[:H, :W]
    arr = np.asarray(img, dtype=np.float32)
    if arr.ndim == 3 and arr.shape[2] == 4:
        arr[..., :3] = np.clip(arr[..., :3] + n[..., None], 0, 255)
    else:
        arr = np.clip(arr + n[..., None], 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA" if arr.shape[2] == 4 else "RGB")

def glitch(img, t, seed):
    """偶发切片错位（画布风格里的 54 条切片）"""
    rng = random.Random(seed)
    out = img.copy()
    for _ in range(rng.randint(1, 3)):
        y = rng.randint(0, H - 80)
        h = rng.randint(6, 46)
        dx = rng.randint(-40, 40)
        band = img.crop((0, y, W, y + h))
        out.paste(band, (dx, y))
    return out

# ---------- HUD 元素 ----------
def txt(d, xy, s, font, fill, anchor="lm", alpha=255):
    if alpha <= 0: return
    d.text(xy, s, font=font, fill=tuple(fill[:3]) + (int(alpha),), anchor=anchor)

def corners(img, x, y, w, h, size=34, color=CYAN, alpha=170, wdt=2):
    d = ImageDraw.Draw(img, "RGBA"); c = color + (alpha,)
    for (px, py, sx, sy) in [(x, y, 1, 1), (x+w, y, -1, 1), (x, y+h, 1, -1), (x+w, y+h, -1, -1)]:
        d.line([(px, py), (px + sx*size, py)], fill=c, width=wdt)
        d.line([(px, py), (px, py + sy*size)], fill=c, width=wdt)

def scan_ring(img, cx, cy, r, t, alpha=255, segs=40):
    if r <= 2: return
    d = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(7)
    ang = -90.0
    for i in range(segs):
        span = rng.uniform(4, 34); gap = rng.uniform(3, 13)
        a = math.radians(ang + t * (8 + (i % 5) * 3) * (1 if i % 2 else -1))
        b = math.radians(ang + span + t * (8 + (i % 5) * 3) * (1 if i % 2 else -1))
        col = CYAN if i % 7 else RED
        d.arc([cx-r, cy-r, cx+r, cy+r], math.degrees(a), math.degrees(b), fill=col + (int(alpha*0.85),), width=2 if i % 3 else 3)
        ang += span + gap
    d.ellipse([cx-r*0.62, cy-r*0.62, cx+r*0.62, cy+r*0.62], outline=CYAN + (int(alpha*0.25),), width=1)

def glyphs(seed, n):
    pool = "01#%&/\\<>[]{}+=*ABCDEFGHIJKLMNOPQRSTUVWXYZ$@"
    rng = random.Random(seed)
    return "".join(rng.choice(pool) for _ in range(n))

def scramble(img, xy, text, font, t, settle, color=TEXT, anchor="mm", alpha=255, seed=0):
    """先乱码后定值：settle 秒后才稳定"""
    d = ImageDraw.Draw(img, "RGBA")
    if t < settle * 0.55:
        shown = glyphs(seed + int(t * 30), len(text))
    elif t < settle * 0.85:
        shown = "".join(c if random.Random(seed + i + int(t*20)).random() > 0.55 else random.Random(seed+i*7+int(t*20)).choice("0123456789") for i, c in enumerate(text))
    else:
        shown = text
    d.text(xy, shown, font=font, fill=color + (alpha,), anchor=anchor)

def panel(img, x, y, w, h, title, rows, a=1.0, accent=CYAN):
    if a <= 0: return
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([x, y, x+w, y+h], fill=(6, 20, 26, int(210*a)), outline=accent + (int(150*a),), width=1)
    d.rectangle([x, y, x+3, y+h], fill=accent + (int(220*a),))
    txt(d, (x+18, y+22), title, f(20, "reg"), accent, "lm", int(230*a))
    yy = y + 52
    for r in rows:
        d.line([(x+18, yy+60), (x+w-18, yy+60)], fill=accent + (int(40*a),), width=1)
        txt(d, (x+18, yy+18), r[0], f(18, "reg"), MUTED, "lm", int(200*a))
        txt(d, (x+w-18, yy+18), r[1], f(21, "reg"), TEXT, "rm", int(230*a))
        yy += 62

def check(img, x, y, s, a=1.0, color=CYAN):
    d = ImageDraw.Draw(img, "RGBA")
    d.line([(x, y), (x+s*0.38, y+s*0.42), (x+s, y-s*0.42)], fill=color + (int(240*a),), width=max(2, int(s*0.16)))

def circle_glow(img, cx, cy, r, color, alpha=90):
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).ellipse([cx-r, cy-r, cx+r, cy+r], fill=color + (alpha,))
    img.alpha_composite(ov.filter(ImageFilter.GaussianBlur(40)))

def chip(img, x, y, text, color=CYAN, a=1.0, size=18):
    if a <= 0: return
    d = ImageDraw.Draw(img, "RGBA")
    ft = f(size, "reg")
    tw = d.textlength(text, font=ft)
    d.rectangle([x, y, x+tw+24, y+34], outline=color + (int(170*a),), width=1)
    txt(d, (x+12, y+17), text, ft, color, "lm", int(235*a))
# ---------- 通用 chrome ----------
def chrome(img, t, tl_global):
    d = ImageDraw.Draw(img, "RGBA")
    # 顶部
    d.line([(48, 96), (W-48, 96)], fill=CYAN + (40,), width=1)
    txt(d, (48, 74), "VT-SYS // VERTRISE", f(18, "mono"), CYAN, "lm", 200)
    txt(d, (W-48, 74), "1920·1080 / 30FPS", f(16, "mono"), MUTED, "rm", 180)
    # 时间码
    tc = "00:%05.2f" % t
    txt(d, (48, H-64), "TC " + tc, f(18, "mono"), MUTED, "lm", 190)
    txt(d, (W-48, H-64), "JUMPTOOL.NETLIFY.APP", f(16, "mono"), MUTED, "rm", 170)
    # REC
    if int(t * 2) % 2 == 0:
        d.ellipse([W-196, H-78, W-184, H-66], fill=RED + (230,))
    txt(d, (W-176, H-71), "REC", f(16, "mono"), RED, "lm", 210)
    # 底部进度
    d.line([(48, H-40), (W-48, H-40)], fill=CYAN + (35,), width=1)
    p = clamp01(t / TOTAL)
    d.line([(48, H-40), (48 + (W-96) * p, H-40)], fill=CYAN + (200,), width=2)
    corners(img, 36, 36, W-72, H-72, 34, CYAN, 120, 2)

# ---------- 场景 ----------
def s_boot(img, t, L):
    cx, cy = W // 2, 880
    r = 200 * easeout(seg(t, 0.0, 1.1))
    circle_glow(img, cx, cy, r + 60, CYAN, 50)
    scan_ring(img, cx, cy, r, t, 255)
    d = ImageDraw.Draw(img, "RGBA")
    if t < 0.9:
        scramble(img, (cx, cy), "VERTRISE", f(96, "monob"), t, 1.6, TEXT, "mm", 255, 11)
    else:
        scramble(img, (cx, cy - 30), "VERTRISE", f(96, "monob"), t, 1.6, TEXT, "mm", 255, 11)
        scramble(img, (cx, cy + 86), "跃 升", f(84, "bold"), t - 0.9, 1.4, CYAN, "mm", 255, 23)
        if t > 2.6:
            k = ease(seg(t, 2.6, 3.3))
            txt(d, (cx, cy + 210), "把每一次起跳，变成一个数字", f(30, "reg"), MUTED, "mm", int(235 * k))
    # 侧边读数
    if t > 1.0:
        k = ease(seg(t, 1.0, 1.7))
        for i, (label, val) in enumerate([("PWR", "98.4"), ("BPM", "120"), ("SYS", "OK")]):
            yy = 420 + i * 54
            txt(d, (110, yy), label, f(18, "mono"), MUTED, "lm", int(200 * k))
            txt(d, (170, yy), val, f(22, "monob"), CYAN, "lm", int(230 * k))
            d.line([(110, yy + 22), (250, yy + 22)], fill=CYAN + (int(60 * k),), width=1)
    if t > 4.2:
        k = ease(seg(t, 4.2, 5.0))
        chip(img, W // 2 - 170, cy + 300, "13 项体测 → 6 步判定", CYAN, k, 20)
    return img

PANELS = [("基本信息", [("身高", "181 cm"), ("体重", "72 kg")]),
          ("弹跳", [("原地", "78 cm"), ("助跑", "86 cm")]),
          ("素质", [("RSI", "1.62"), ("100m", "13.2s")]),
          ("力量", [("深蹲", "120 kg"), ("硬拉", "150 kg")]),
          ("力量", [("高翻", "75 kg"), ("摸高", "232 cm")]),
          ("恢复", [("感冒", "1 次/月"), ("睡眠", "7.8 h")])]

def s_rows(img, t, L):
    """panel-to-canvas：面板一行行倒下，拼成一张画布"""
    d = ImageDraw.Draw(img, "RGBA")
    cols, rows = 2, 3
    pw, ph = 430, 190
    gx, gy = 90, 560
    gapx, gapy = 60, 54
    for i in range(cols * rows):
        c, r = i % cols, i // cols
        born = 0.25 + (r * 0.42 + c * 0.16)
        k = ease(seg(t, born, born + 0.5))
        if k <= 0: continue
        x = gx + c * (pw + gapx)
        y = gy + r * (ph + gapy)
        drop = (1 - easeout(k)) * -320
        sq = 1 - 0.10 * math.sin(math.pi * clamp01(k))      # 落地压扁
        hh = int(ph * sq)
        panel(img, x, y + drop, pw, hh, PANELS[i][0], PANELS[i][1], k)
        circle_glow(img, x + pw / 2, y + drop + hh / 2, 120, CYAN, int(26 * k))
    if t > 3.2:
        k = ease(seg(t, 3.2, 3.9))
        cy = 640 + 3 * (ph + gapy) + 20
        d.line([(gx, cy), (gx + 2 * pw + gapx, cy)], fill=CYAN + (int(150 * k),), width=2)
        for c in range(cols):
            x = gx + c * (pw + gapx) + pw / 2
            d.line([(x, cy - 18), (x, cy)], fill=CYAN + (int(180 * k),), width=2)
        txt(d, (W // 2, cy + 54), "13 项体测 · 6 步判定", f(40, "bold"), TEXT, "mm", int(240 * k))
        txt(d, (W // 2, cy + 106), "全部在手机里完成", f(24, "reg"), MUTED, "mm", int(200 * k))
    return img

def s_measure(img, t, L):
    d = ImageDraw.Draw(img, "RGBA")
    # 左：垂直弹跳示意
    bx, by = 300, 1180
    k = ease(seg(t, 0.2, 0.9))
    d.line([(bx, by), (bx, by - 520 * k)], fill=CYAN + (200,), width=2)
    for i in range(6):
        yy = by - i * 104 * k
        d.line([(bx - 12, yy), (bx + 12, yy)], fill=CYAN + (150,), width=2)
        txt(d, (bx - 22, yy), str(i * 20), f(14, "mono"), MUTED, "rm", int(170 * k))
    if t > 1.2:
        kk = ease(seg(t, 1.2, 1.9))
        y = by - 520 * kk
        d.rectangle([bx - 34, y - 26, bx + 120, y + 26], fill=(6, 26, 30, int(230 * kk)), outline=CYAN + (int(220 * kk),))
        scramble(img, (bx - 22, y), "78.2", f(38, "monob"), t - 1.2, 0.7, CYAN, "lm", int(255 * kk), 5)
        txt(d, (bx + 92, y), "CM", f(18, "mono"), MUTED, "lm", int(220 * kk))
    # 右：杠铃测速 gauge
    cx, cy, R = 780, 980, 150
    k2 = ease(seg(t, 1.0, 1.8))
    if k2 > 0:
        d.arc([cx - R, cy - R, cx + R, cy + R], 200, 340, fill=CYAN + (int(180 * k2),), width=3)
        for i in range(11):
            a = math.radians(200 + i * 14)
            r1, r2 = R - 14, R - (34 if i % 5 == 0 else 24)
            d.line([(cx + r1 * math.cos(a), cy + r1 * math.sin(a)),
                    (cx + r2 * math.cos(a), cy + r2 * math.sin(a))],
                   fill=CYAN + (int(140 * k2),), width=2)
        kk = ease(seg(t, 1.8, 2.6))
        ang = math.radians(200 + 112 * kk)
        d.line([(cx, cy), (cx + (R - 40) * math.cos(ang), cy + (R - 40) * math.sin(ang))],
               fill=RED + (int(240 * kk),), width=3)
        txt(d, (cx, cy + 40), "1.42", f(46, "monob"), TEXT, "mm", int(240 * k2))
        txt(d, (cx, cy + 88), "M/S 峰值速度", f(16, "reg"), MUTED, "mm", int(200 * k2))
    # AI 报告
    if t > 3.4:
        k3 = ease(seg(t, 3.4, 4.0))
        x, y = 560, 1290 + (1 - k3) * 40
        panel(img, x, y, 460, 230, "AI 分析", [("弹跳高度", "78.2 cm"), ("屈膝角", "118°")], k3)
    if t > 6.0:
        k4 = ease(seg(t, 6.0, 6.6))
        txt(d, (W // 2, 1660), "拍一段视频 · 六项指标自动拆开", f(34, "bold"), TEXT, "mm", int(235 * k4))
    return img

STEP_NODES = [("01", "BMI", "体成分"), ("02", "RSI", "反应力量"), ("03", "POWER", "爆发力"),
              ("04", "STR", "力量水平"), ("05", "TECH", "起跳技术"), ("06", "LOAD", "恢复强度")]

def s_cascade(img, t, L):
    """diagram-cascade：节点自上而下级联生成"""
    d = ImageDraw.Draw(img, "RGBA")
    n = len(STEP_NODES)
    x = W // 2
    y0, dy = 560, 178
    bw, bh = 560, 108
    pts = []
    for i in range(n):
        born = 0.35 + i * 0.92
        k = ease(seg(t, born, born + 0.45))
        if k <= 0:
            break
        y = y0 + i * dy
        pts.append((x, y))
        dx = (1 - easeout(k)) * -60
        d.rectangle([x - bw/2 + dx, y - bh/2, x + bw/2 + dx, y + bh/2],
                    fill=(6, 22, 28, int(215 * k)), outline=CYAN + (int(200 * k),), width=1)
        d.rectangle([x - bw/2 + dx, y - bh/2, x - bw/2 + dx + 4, y + bh/2], fill=CYAN + (int(240 * k),))
        txt(d, (x - bw/2 + 24 + dx, y), STEP_NODES[i][0], f(26, "monob"), MUTED, "lm", int(210 * k))
        txt(d, (x - bw/2 + 96 + dx, y), STEP_NODES[i][1], f(30, "monob"), CYAN, "lm", int(240 * k))
        txt(d, (x + bw/2 - 24 + dx, y), STEP_NODES[i][2], f(24, "reg"), TEXT, "rm", int(230 * k))
        if i > 0 and len(pts) > i - 1:
            py = pts[i-1][1] + bh/2
            kk = ease(seg(t, born - 0.15, born + 0.2))
            d.line([(x - 250, py), (x - 250, y - bh/2 - 0 * dy)][:1] + [(x - 250, y - bh/2)],
                   fill=CYAN + (int(150 * kk),), width=2)
            d.line([(x - 250, y), (x - bw/2 + dx, y)], fill=CYAN + (int(120 * kk),), width=2)
            d.ellipse([x - 254, y - 4, x - 246, y + 4], fill=CYAN + (int(230 * kk),))
    if t > 6.6:
        k = ease(seg(t, 6.6, 7.4))
        y = y0 + n * dy - 20
        d.rectangle([x - 320, y - 46, x + 320, y + 46], fill=(30, 16, 4, int(220 * k)), outline=ORANGE + (int(220 * k),), width=2)
        txt(d, (x, y), "判定：力量爆发型 · 平均 3.5/5", f(30, "bold"), ORANGE, "mm", int(245 * k))
    if t > 1.0:
        txt(d, (x, 440), "六步判定，短板一眼看清", f(38, "bold"), TEXT, "mm", int(230 * ease(seg(t, 1.0, 1.6))))
    return img

WEEK = ["周一 · 下肢力量", "周二 · 起跳技术", "周三 · 主动恢复", "周四 · 爆发力", "周五 · 弹性反应"]

def s_cards(img, t, L):
    """card-stack → magician-card-flourish：卡片堆叠后扇形展开，再逐条打勾"""
    d = ImageDraw.Draw(img, "RGBA")
    cx, cy = W // 2, 980
    cw, ch = 620, 300
    fan = ease(seg(t, 3.2, 5.0))
    for i in range(len(WEEK)):
        born = 0.3 + i * 0.35
        k = ease(seg(t, born, born + 0.4))
        if k <= 0: continue
        stack_dy = -(i * 9) - (1 - k) * 120
        angle = lerp(0, (i - 2) * 7.5, fan)
        dx = lerp(0, (i - 2) * 24, fan)
        dy = lerp(stack_dy, abs(i - 2) * 34 - 10, fan)
        # 用矩形近似旋转卡片
        card = Image.new("RGBA", (cw + 40, ch + 40), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rectangle([20, 20, 20 + cw, 20 + ch], fill=(6, 22, 28, int(230 * k)), outline=CYAN + (int(190 * k),), width=1)
        cd.rectangle([20, 20, 24, 20 + ch], fill=CYAN + (int(240 * k),))
        cd.text((60, 70), "D0" + str(i + 1), font=f(22, "monob"), fill=MUTED + (int(210 * k),))
        cd.text((60, 120), WEEK[i], font=f(38, "bold"), fill=TEXT + (int(245 * k),))
        cd.text((60, 200), ["深蹲 5×5 · 75%", "助跑起跳 6×1 · 全力", "拉伸 2×45s/侧",
                            "跳箱 5×3 · 80cm", "跳深 4×3 · 45cm"][i], font=f(24, "reg"), fill=MUTED + (int(220 * k),))
        if t > 5.2 + i * 0.45:
            ck = ease(seg(t, 5.2 + i * 0.45, 5.6 + i * 0.45))
            check(card, cw - 40, 70, 34 * ck, ck)
        card = card.rotate(angle, resample=Image.BICUBIC, center=(20 + cw/2, 20 + ch/2))
        img.alpha_composite(card, (int(cx - cw/2 - 20 + dx), int(cy - ch/2 - 20 + dy)))
    if t > 1.0:
        txt(d, (cx, 520), "一周训练 · 自动生成", f(38, "bold"), TEXT, "mm", int(230 * ease(seg(t, 1.0, 1.6))))
    if t > 6.6:
        k = ease(seg(t, 6.6, 7.3))
        txt(d, (cx, 1580), "练完一组打勾 · 吃力和轻松会实时调整", f(30, "reg"), MUTED, "mm", int(225 * k))
    return img

def s_data(img, t, L):
    d = ImageDraw.Draw(img, "RGBA")
    txt(d, (W // 2, 470), "每一次训练，都存进曲线", f(40, "bold"), TEXT, "mm", int(235 * ease(seg(t, 0.3, 1.0))))
    # 曲线
    gx, gy, gw, gh = 120, 1180, W - 240, 380
    d.line([(gx, gy), (gx + gw, gy)], fill=CYAN + (90,), width=1)
    d.line([(gx, gy), (gx, gy - gh)], fill=CYAN + (90,), width=1)
    n = 9
    pts = []
    for i in range(n):
        x = gx + gw * i / (n - 1)
        v = 0.18 + 0.62 * (i / (n - 1)) ** 1.25 + 0.06 * math.sin(i * 1.7)
        y = gy - gh * v
        pts.append((x, y))
    k = ease(seg(t, 0.6, 3.6))
    for i in range(len(pts) - 1):
        a = pts[i]; b = pts[i+1]
        kk = clamp01(k * (len(pts) - 1) - i)
        if kk <= 0: break
        xe = lerp(a[0], b[0], kk); ye = lerp(a[1], b[1], kk)
        d.line([a, (xe, ye)], fill=CYAN + (230,), width=3)
        if kk > 0.95: d.ellipse([b[0]-5, b[1]-5, b[0]+5, b[1]+5], fill=CYAN + (240,))
    # 计数器
    if t > 3.6:
        kk = ease(seg(t, 3.6, 4.2))
        for i, (label, val) in enumerate([("累计记录", "128"), ("弹跳提升", "+6.2"), ("连续训练", "12")]):
            x = 120 + i * 300
            txt(d, (x, 640), val, f(72, "monob"), CYAN, "lm", int(245 * kk))
            txt(d, (x, 730), label, f(22, "reg"), MUTED, "lm", int(210 * kk))
            d.line([(x, 760), (x + 220, 760)], fill=CYAN + (int(70 * kk),), width=1)
    # 公开视频卡片
    if t > 5.4:
        kk = ease(seg(t, 5.4, 6.1))
        for i in range(3):
            x = 130 + i * 290
            d.rectangle([x, 1330 + (1-kk)*30, x + 250, 1560 + (1-kk)*30], fill=(6, 22, 28, int(225*kk)), outline=CYAN + (int(160*kk),))
            d.rectangle([x + 16, 1346 + (1-kk)*30, x + 234, 1450 + (1-kk)*30], fill=(0, 40, 50, int(220*kk)))
            txt(d, (x + 125, 1398 + (1-kk)*30), "▶", f(34, "mono"), CYAN, "mm", int(220*kk))
            txt(d, (x + 16, 1480 + (1-kk)*30), ["起跳节奏", "摆臂要点", "落地缓冲"][i], f(22, "reg"), TEXT, "lm", int(230*kk))
            txt(d, (x + 16, 1520 + (1-kk)*30), "弹跳知识 · 公开", f(17), MUTED, "lm", int(200*kk))
    return img

def s_lock(img, t, L):
    d = ImageDraw.Draw(img, "RGBA")
    # 橙调压屏
    k = ease(seg(t, 0.5, 1.6))
    ov = Image.new("RGBA", (W, H), (255, 102, 0, int(9 * k)))
    img.alpha_composite(ov)
    circle_glow(img, W // 2, 760, 360, ORANGE, int(18 * k))
    cx, cy = W // 2, 760
    scan_ring(img, cx, cy, 190 * easeout(seg(t, 0.2, 1.2)), t * 1.6, 230)
    scramble(img, (cx, cy), "LOCK", f(120, "monob"), t, 0.9, ORANGE, "mm", 255, 91)
    if t > 1.4:
        k2 = ease(seg(t, 1.4, 2.1))
        txt(d, (cx, cy + 150), "VERTRISE 跃升", f(78, "bold"), TEXT, "mm", int(250 * k2))
        txt(d, (cx, cy + 236), "把每一次起跳，变成一个数字", f(30, "reg"), MUTED, "mm", int(225 * k2))
    if t > 2.8:
        k3 = ease(seg(t, 2.8, 3.5))
        chip(img, cx - 300, cy + 330, "安卓已上线 · 免费下载", CYAN, k3, 22)
        txt(d, (cx, cy + 430), "jumptool.netlify.app", f(30, "mono"), CYAN, "mm", int(235 * k3))
    if t > 4.4:
        k4 = ease(seg(t, 4.4, 5.2))
        txt(d, (cx, cy + 540), "现在就去测你的第一跳", f(38, "bold"), TEXT, "mm", int(240 * k4))
    if t > 7.6:
        f_ = ease(seg(t, 7.6, 9.0))
        img = Image.blend(img.convert("RGBA"), Image.new("RGBA", (W, H), BG + (255,)), 0.85 * f_)
    return img

SCENES = {"s1": s_boot, "s2": s_rows, "s3": s_measure, "s4": s_cascade, "s5": s_cards,
          "s6": s_data, "s7": s_lock}

def frame(t):
    cur = TL["scenes"][-1]
    for s in TL["scenes"]:
        if s["start"] <= t < s["start"] + s["len"]:
            cur = s; break
    lt = t - cur["start"]
    img = BASE.convert("RGBA")
    img = SCENES[cur["name"]](img, lt, cur["len"]).convert("RGBA")
    img = Image.alpha_composite(img, scan_overlay())
    img = grains(img, int(t * 30)).convert("RGBA")
    chrome(img, t, TOTAL)
    # 转场闪白
    for s in TL["scenes"]:
        dt = t - s["start"]
        if 0 <= dt < 0.12:
            a = 0.30 * (1 - dt / 0.12)
            img = Image.blend(img, Image.new("RGBA", (W, H), (220, 250, 255, 255)), a)
    # 偶发 glitch
    if int(t * 30) % 97 < 3:
        img = glitch(img, t, int(t * 30))
    return img.convert("RGB")

def main():
    n = int(TOTAL * FPS)
    ff = subprocess.Popen([
        r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe",
        "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", str(OUT / "silent.mp4")], stdin=subprocess.PIPE)
    for i in range(n):
        ff.stdin.write(frame(i / FPS).tobytes())
        if i % 200 == 0: print("frame", i, "/", n, flush=True)
    ff.stdin.close(); ff.wait()
    print("silent done")

if __name__ == "__main__":
    main()
