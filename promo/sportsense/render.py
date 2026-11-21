# -*- coding: utf-8 -*-
"""SportSense 风格宣传片渲染器（1080x1920 / 30fps / ~60s）
深色科技风：深蓝黑背景 + 青柠色强调 + 手机样机 + 骨架识别 + 单行字幕
"""
import json, math, pathlib, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
W, H, FPS = 1080, 1920, 30
TL = json.load(open(OUT / "timeline.json", encoding="utf-8"))

ACCENT = (183, 242, 75)
BLUE = (96, 132, 255)
WHITE = (245, 248, 255)
GREY = (150, 160, 180)

F_BOLD = r"C:/Windows/Fonts/msyhbd.ttc"
F_REG = r"C:/Windows/Fonts/msyh.ttc"

def font(size, bold=True):
    return ImageFont.truetype(F_BOLD if bold else F_REG, size)

def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

def clamp01(x):
    return max(0.0, min(1.0, x))

# ---------------- 背景 ----------------
def make_bg():
    top = np.array([6, 8, 15], dtype=np.float32)
    bot = np.array([13, 18, 32], dtype=np.float32)
    col = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    arr = (top[None, None, :] * (1 - col) + bot[None, None, :] * col)
    arr = np.repeat(arr, W, axis=1).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    # 斜向网格
    step = 96
    for x in range(-H, W + H, step):
        d.line([(x, 0), (x + H, H)], fill=(120, 160, 255, 12), width=1)
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=(120, 160, 255, 8), width=1)
    # 中心光晕
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W // 2 - 520, 380, W // 2 + 520, 1420], fill=(70, 110, 255, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    return img

BG = make_bg()

def base_frame(t):
    img = BG.copy()
    # 缓慢扫光
    sweep_x = int(((t * 0.08) % 1.0) * (W + 700)) - 350
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    od.polygon([(sweep_x, 0), (sweep_x + 220, 0), (sweep_x + 220 - 260, H), (sweep_x - 260, H)],
               fill=(140, 190, 255, 10))
    ov = ov.filter(ImageFilter.GaussianBlur(40))
    return Image.alpha_composite(img.convert("RGBA"), ov)

# ---------------- 文本 ----------------
def text_c(draw, xy, s, f, fill, anchor="mm", alpha=255):
    if alpha <= 0:
        return
    fill = tuple(fill[:3]) + (int(alpha),)
    draw.text(xy, s, font=f, fill=fill, anchor=anchor)

def caption(img, s, alpha, y=1690):
    if alpha <= 0:
        return img
    d = ImageDraw.Draw(img, "RGBA")
    f = font(38, True)
    tw = d.textlength(s, font=f)
    bar_w = 46
    d.rounded_rectangle([(W - tw) / 2 - 34, y - 46, (W + tw) / 2 + 34, y + 34], 18,
                        fill=(10, 14, 24, int(150 * alpha)))
    d.rounded_rectangle([(W - tw) / 2 - 34, y - 46, (W - tw) / 2 - 34 + bar_w, y - 43], 2,
                        fill=ACCENT + (int(230 * alpha),))
    text_c(d, (W / 2, y), s, f, WHITE, alpha=int(235 * alpha))
    return img

def brand(img, alpha=1.0):
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([54, 70, 54 + 250, 70 + 54], 16, fill=(16, 22, 36, int(190 * alpha)),
                        outline=ACCENT + (int(120 * alpha),), width=1)
    text_c(d, (54 + 26, 70 + 27), "VERTRISE", font(25, True), ACCENT, anchor="lm", alpha=int(240 * alpha))
    text_c(d, (54 + 150, 70 + 28), "跃升", font(24, True), WHITE, anchor="lm", alpha=int(220 * alpha))
    return img

# ---------------- 手机样机 ----------------
SCREENS = {}
_LOGO = None
for key, rel in {
    "analyze": "上架素材/screens/02_analyze.png",
    "data": "上架素材/screens/05_data.png",
    "dunk": "上架素材/screens/04_dunk_result.png",
    "home": "上架素材/screens/01_home.png",
}.items():
    SCREENS[key] = Image.open(ROOT / rel).convert("RGB")

def phone(img, key, cx, cy, width, alpha=1.0, rot=0.0, badge=None):
    scr = SCREENS[key]
    ratio = scr.size[1] / scr.size[0]
    sw = int(width - 26)
    sh = int(sw * ratio)
    ph_w, ph_h = width, sh + 26
    bez = Image.new("RGBA", (ph_w, ph_h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bez)
    bd.rounded_rectangle([0, 0, ph_w - 1, ph_h - 1], 52, fill=(16, 18, 26, 255),
                         outline=(60, 70, 95, 255), width=2)
    bd.rounded_rectangle([8, 8, ph_w - 9, ph_h - 9], 46, fill=(8, 10, 16, 255))
    screen = scr.resize((sw, sh), Image.LANCZOS)
    bez.paste(screen, (13, 13))
    # 顶部听筒
    bd.rounded_rectangle([ph_w / 2 - 52, 22, ph_w / 2 + 52, 34], 6, fill=(30, 34, 46, 255))
    if rot:
        bez = bez.rotate(rot, expand=True, resample=Image.BICUBIC)
    if alpha < 1:
        a = bez.split()[3].point(lambda v: int(v * alpha))
        bez.putalpha(a)
    img.alpha_composite(bez, (int(cx - bez.size[0] / 2), int(cy - bez.size[1] / 2)))
    if badge:
        d = ImageDraw.Draw(img, "RGBA")
        f = font(26, True)
        tw = d.textlength(badge, font=f)
        bx = cx - bez.size[0] / 2 - 18
        by = cy + bez.size[1] / 2 - 40
        d.rounded_rectangle([bx - 20, by - 22, bx + tw + 20, by + 26], 22,
                            fill=(20, 28, 18, 220), outline=ACCENT + (160,), width=1)
        text_c(d, (bx, by + 2), badge, f, ACCENT, anchor="lm")
    return img

# ---------------- 骨架 ----------------
JOINTS = ["head", "neck", "sh_l", "sh_r", "el_l", "el_r", "wr_l", "wr_r",
          "hip", "hip_l", "hip_r", "kn_l", "kn_r", "an_l", "an_r"]
BASE = {
    "head": (0, -0.92), "neck": (0, -0.72), "sh_l": (-0.16, -0.70), "sh_r": (0.16, -0.70),
    "el_l": (-0.26, -0.46), "el_r": (0.26, -0.46), "wr_l": (-0.30, -0.22), "wr_r": (0.30, -0.22),
    "hip": (0, -0.30), "hip_l": (-0.10, -0.30), "hip_r": (0.10, -0.30),
    "kn_l": (-0.12, -0.02), "kn_r": (0.12, -0.02), "an_l": (-0.13, 0.26), "an_r": (0.13, 0.26),
}
BONES = [("head", "neck"), ("neck", "sh_l"), ("neck", "sh_r"), ("sh_l", "el_l"), ("sh_r", "el_r"),
         ("el_l", "wr_l"), ("el_r", "wr_r"), ("neck", "hip"), ("hip", "hip_l"), ("hip", "hip_r"),
         ("hip_l", "kn_l"), ("hip_r", "kn_r"), ("kn_l", "an_l"), ("kn_r", "an_r")]

def draw_skeleton(img, cx, cy, scale, phase, alpha=1.0, glow=True):
    d = ImageDraw.Draw(img, "RGBA")
    pts = {}
    for name, (x, y) in BASE.items():
        swing = math.sin(phase * 2 * math.pi) * 0.03
        pts[name] = (cx + (x + (swing if name in ("wr_l", "wr_r", "el_l", "el_r") else 0)) * scale,
                     cy + y * scale)
    if glow:
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        for a, b in BONES:
            od.line([pts[a], pts[b]], fill=ACCENT + (110,), width=14)
        ov = ov.filter(ImageFilter.GaussianBlur(12))
        img.alpha_composite(ov)
        d = ImageDraw.Draw(img, "RGBA")
    for a, b in BONES:
        d.line([pts[a], pts[b]], fill=ACCENT + (int(235 * alpha),), width=7)
    for name, p in pts.items():
        r = 9 if name in ("head",) else 6
        if name == "head":
            d.ellipse([p[0] - 24, p[1] - 26, p[0] + 24, p[1] + 26], outline=ACCENT + (int(235 * alpha),), width=6)
        else:
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=ACCENT + (int(240 * alpha),))
    return img

# ---------------- 场景 ----------------
def scene_hook(img, t, T):
    a1 = ease(clamp01(t / 0.6))
    a2 = ease(clamp01((t - 0.5) / 0.6))
    d = ImageDraw.Draw(img, "RGBA")
    text_c(d, (W / 2, 780 - 28 * (1 - a1)), "想知道你每一跳", font(88, True), WHITE, alpha=int(255 * a1))
    col = ACCENT if a2 > 0 else WHITE
    text_c(d, (W / 2, 900 - 28 * (1 - a2)), "到底差在哪？", font(88, True), col, alpha=int(255 * a2))
    # 底部细线 + 小字
    if a2 > 0.2:
        d.rounded_rectangle([W / 2 - 150, 1010, W / 2 + 150, 1013], 2, fill=ACCENT + (int(200 * a2),))
        text_c(d, (W / 2, 1080), "手机录像 · AI 逐帧分析", font(34, False), GREY, alpha=int(230 * a2))
    return caption(img, "一分钟，看清你的起跳问题", ease(clamp01((t - 1.6) / 0.6)))

def scene_record(img, t, T):
    a = ease(clamp01(t / 0.7))
    bounce = math.sin(t * 2.2) * 0.02
    phone(img, "analyze", W / 2, 930, 560, alpha=a * 0.96)
    # 扫描线
    y = 640 + (t / max(T, 0.1)) * 560
    d = ImageDraw.Draw(img, "RGBA")
    d.line([(W / 2 - 260, y), (W / 2 + 260, y)], fill=ACCENT + (140,), width=3)
    return caption(img, "不用穿戴设备，手机拍一段就够", ease(clamp01((t - 0.8) / 0.6)))

def scene_track(img, t, T):
    a = ease(clamp01(t / 0.6))
    # 竞技场地面线
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(6):
        yy = 1240 + i * 46
        d.line([(0, yy), (W, yy)], fill=(90, 120, 200, 18), width=1)
    draw_skeleton(img, W / 2, 1170, 400, phase=t * 0.45, alpha=a)
    # 关键点计数（放在骨架上方，避免压住头部）
    n = int(min(33, 33 * ease(clamp01(t / 1.6))))
    text_c(d, (W / 2, 520), str(n), font(150, True), ACCENT, alpha=int(245 * a))
    text_c(d, (W / 2, 640), "个关键点逐帧追踪", font(42, True), WHITE, alpha=int(235 * a))
    return caption(img, "AI 自动识别骨架，动作细节全量化", ease(clamp01((t - 1.2) / 0.6)))

METRICS = [("弹跳高度", "62.4", "cm"), ("屈膝深度", "118", "°"),
           ("起跳角度", "14", "°"), ("摆臂速度", "726", "°/s"),
           ("两步节奏", "0.92", ""), ("落地摆动", "4.1", "%")]

def scene_metrics(img, t, T):
    d = ImageDraw.Draw(img, "RGBA")
    text_c(d, (W / 2, 300), "六项指标，全部量化", font(62, True), WHITE, alpha=int(240 * ease(clamp01(t / 0.5))))
    x0, y0, cw, ch, gap = 92, 470, 440, 300, 26
    for i, (label, val, unit) in enumerate(METRICS):
        k = ease(clamp01((t - 0.5 - i * 0.55) / 0.5))
        if k <= 0:
            continue
        col = i % 2
        row = i // 2
        x = x0 + col * (cw + gap)
        y = y0 + row * (ch + gap) + 40 * (1 - k)
        d.rounded_rectangle([x, y, x + cw, y + ch], 26, fill=(18, 24, 38, int(215 * k)),
                            outline=(70, 96, 160, int(150 * k)), width=2)
        d.rounded_rectangle([x + 30, y + 30, x + 100, y + 34], 2, fill=ACCENT + (int(230 * k),))
        text_c(d, (x + 34, y + 74), label, font(34, False), GREY, anchor="lm", alpha=int(230 * k))
        shown = val if isinstance(val, str) else val
        text_c(d, (x + 34, y + 170), shown, font(84, True), WHITE, anchor="lm", alpha=int(250 * k))
        if unit:
            tw = d.textlength(shown, font=font(84, True))
            text_c(d, (x + 34 + tw + 10, y + 196), unit, font(34, False), ACCENT, anchor="lm", alpha=int(230 * k))
    return caption(img, "每一项都有数字，不再靠感觉", ease(clamp01((t - 3.6) / 0.6)))

CHIPS5 = ["弹跳类型：速度型", "短板：摆臂 / 两步节奏", "计划：4 周可直接照做"]

def scene_ai(img, t, T):
    d = ImageDraw.Draw(img, "RGBA")
    phone(img, "analyze", W / 2 + 205, 1030, 420, alpha=ease(clamp01(t / 0.6)))
    text_c(d, (72, 650), "AI 报告", font(64, True), WHITE, anchor="lm", alpha=int(240 * ease(clamp01(t / 0.5))))
    for i, s in enumerate(CHIPS5):
        k = ease(clamp01((t - 0.8 - i * 0.7) / 0.5))
        if k <= 0:
            continue
        f = font(27, False)
        tw = d.textlength(s, font=f)
        y = 760 + i * 86
        x = 72 - 20 * (1 - k)
        d.rounded_rectangle([x, y - 30, x + tw + 40, y + 30], 18, fill=(20, 28, 44, int(220 * k)),
                            outline=ACCENT + (int(120 * k),), width=1)
        text_c(d, (x + 20, y), s, f, WHITE, anchor="lm", alpha=int(235 * k))
    return caption(img, "不只是打分，还告诉你下一步怎么练", ease(clamp01((t - 3.2) / 0.6)))

def scene_data(img, t, T):
    a = ease(clamp01(t / 0.7))
    phone(img, "data", W / 2 - 180, 980, 440, alpha=a, rot=6, badge="进步曲线")
    phone(img, "dunk", W / 2 + 190, 1040, 400, alpha=a, rot=-7, badge="扣篮潜力")
    return caption(img, "每一跳自动存档，换个手机也带得走", ease(clamp01((t - 1.4) / 0.6)))

def scene_cta(img, t, T):
    a = ease(clamp01(t / 0.6))
    try:
        global _LOGO
        if _LOGO is None:
            lg = Image.open(ROOT / "img/logo.png").convert("RGBA")
            px = lg.load()
            w0, h0 = lg.size
            for yy in range(h0):
                for xx in range(w0):
                    r, g, b, _ = px[xx, yy]
                    if r > 232 and g > 232 and b > 232:
                        px[xx, yy] = (r, g, b, 0)
            _LOGO = lg
        logo = _LOGO.resize((240, 240), Image.LANCZOS)
        if a < 1:
            logo.putalpha(logo.split()[3].point(lambda v: int(v * a)))
        img.alpha_composite(logo, (W // 2 - 120, 540))
    except Exception:
        pass
    d = ImageDraw.Draw(img, "RGBA")
    text_c(d, (W / 2, 880), "Vertrise 跃升", font(84, True), WHITE, alpha=int(250 * a))
    text_c(d, (W / 2, 970), "弹跳 / 起跳 / 扣篮潜力，一次拍清", font(36, False), GREY, alpha=int(230 * a))
    k = ease(clamp01((t - 0.8) / 0.6))
    d.rounded_rectangle([W / 2 - 260, 1080, W / 2 + 260, 1200], 60, fill=ACCENT + (int(235 * k),))
    text_c(d, (W / 2, 1140), "安卓已上线 · 免费下载", font(38, True), (10, 14, 10), alpha=int(255 * k))
    if k > 0.4:
        text_c(d, (W / 2, 1300), "jumptool.netlify.app", font(34, False), ACCENT, alpha=int(220 * k))
    return caption(img, "现在就去测你的第一跳", ease(clamp01((t - 1.6) / 0.6)))

SCENES = {"s1": scene_hook, "s2": scene_record, "s3": scene_track, "s4": scene_metrics,
          "s5": scene_ai, "s6": scene_data, "s7": scene_cta}

def main():
    total = TL["total"]
    n = int(round(total * FPS))
    ff = subprocess.Popen([
        r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe",
        "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", str(W) + "x" + str(H), "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
        str(OUT / "video_silent.mp4")
    ], stdin=subprocess.PIPE)
    scenes = TL["scenes"]
    for i in range(n):
        t = i / FPS
        cur = scenes[-1]
        for s in scenes:
            if s["start"] <= t < s["start"] + s["len"]:
                cur = s
                break
        img = base_frame(t).convert("RGBA")
        lt = t - cur["start"]
        img = SCENES[cur["name"]](img, lt, cur["len"])
        img = brand(img)
        ff.stdin.write(img.convert("RGB").tobytes())
        if i % 150 == 0:
            print("frame", i, "/", n, flush=True)
    ff.stdin.close()
    ff.wait()
    print("video done")

main()
