# -*- coding: utf-8 -*-
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC_LOGO = r'D:\jump app\img\logo.png'
SCREENS = r'D:\jump app\上架素材\screens'
OUT = r'D:\jump app\上架素材'
FB = r'C:\Windows\Fonts\msyhbd.ttc'
FR = r'C:\Windows\Fonts\msyh.ttc'
def f(sz, bold=True): return ImageFont.truetype(FB if bold else FR, sz)

# ---------- 图标 ----------
logo = Image.open(SRC_LOGO).convert('RGB')
# 取 V + 篮球 区域
mark = logo.crop((250, 60, 950, 650))
# 白底方形画布，留出安全边距
for size, name in ((512, 'icon-512.png'), (1024, 'icon-1024.png')):
    canvas = Image.new('RGB', (size, size), (255, 255, 255))
    inner = int(size * 0.78)
    w, h = mark.size
    s = min(inner / w, inner / h)
    m = mark.resize((int(w*s), int(h*s)), Image.LANCZOS)
    canvas.paste(m, ((size - m.width)//2, (size - m.height)//2))
    canvas.save(os.path.join(OUT, name))
print('icon ok')

# ---------- 商店截图（1080x1920 营销版） ----------
SHOTS = [
    ('01_home.png',   '训练数据，一眼看清', '本周进度 · 最新弹跳 · 历史最佳'),
    ('02_analyze.png','AI 弹跳分析',       '手机拍一段，本机逐帧算出弹跳高度'),
    ('03_dunk_empty.png','3 个指标自测扣篮潜力', '立定跳远 · 摸高差 · 站立摸高'),
    ('04_dunk_result.png','中 2 个，就是起飞线', '自动找出短板，给出训练方案'),
    ('05_data.png',   '长期趋势，看得见',   '进步曲线 · 排行榜 · 训练记录'),
]
W, H = 1080, 1920
os.makedirs(os.path.join(OUT, 'store-screens'), exist_ok=True)
for i, (fn, title, sub) in enumerate(SHOTS, 1):
    # 背景渐变
    bg = Image.new('RGB', (W, H), (11, 11, 16))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        c = (int(11 + 12*t), int(11 + 14*t), int(16 + 30*t))
        d.line([(0, y), (W, y)], fill=c)
    # 顶部光晕
    glow = Image.new('RGB', (W, W), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W*0.1, -W*0.45, W*0.9, W*0.55], fill=(40, 56, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    bg.paste(Image.blend(bg.crop((0, 0, W, W)), glow, 0.55), (0, 0))

    d = ImageDraw.Draw(bg)
    tw = d.textlength(title, font=f(56))
    d.text(((W - tw)/2 + 2, 122), title, font=f(56), fill=(0, 0, 0))
    d.text(((W - tw)/2, 120), title, font=f(56), fill=(255, 255, 255))
    sw = d.textlength(sub, font=f(30, False))
    d.text(((W - sw)/2, 208), sub, font=f(30, False), fill=(160, 168, 190))

    shot = Image.open(os.path.join(SCREENS, fn)).convert('RGB')
    target_h = 1330
    s = target_h / shot.height
    shot = shot.resize((int(shot.width * s), target_h), Image.LANCZOS)
    x = (W - shot.width)//2
    y = 320
    # 阴影
    sh = Image.new('RGBA', (shot.width + 80, shot.height + 80), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([40, 40, 40 + shot.width, 40 + shot.height], radius=40, fill=(0, 0, 0, 190))
    sh = sh.filter(ImageFilter.GaussianBlur(28))
    bg.paste(sh, (x - 40, y - 40), sh)
    # 圆角裁切
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width, shot.height], radius=34, fill=255)
    bg.paste(shot, (x, y), mask)
    # 描边
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([x, y, x + shot.width, y + shot.height], radius=34, outline=(70, 76, 102), width=3)

    brand = 'Vertrise跃升'
    bw = d.textlength(brand, font=f(34, False))
    d.text(((W - bw)/2, 1710), brand, font=f(34, False), fill=(120, 128, 150))
    bg.save(os.path.join(OUT, 'store-screens', '%02d.png' % i), quality=95)
print('screens ok')
