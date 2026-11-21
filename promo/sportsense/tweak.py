# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/promo/sportsense/render.py")
s = P.read_text(encoding="utf-8")

# --- 场景3：数字与骨架错开 ---
old3 = '''    draw_skeleton(img, W / 2, 1010, 430, phase=t * 0.45, alpha=a)
    # 关键点计数
    n = int(min(33, 33 * ease(clamp01(t / 1.6))))
    text_c(d, (W / 2, 640), str(n), font(120, True), ACCENT, alpha=int(240 * a))
    text_c(d, (W / 2, 730), "个关键点逐帧追踪", font(40, True), WHITE, alpha=int(230 * a))'''
new3 = '''    draw_skeleton(img, W / 2, 1170, 400, phase=t * 0.45, alpha=a)
    # 关键点计数（放在骨架上方，避免压住头部）
    n = int(min(33, 33 * ease(clamp01(t / 1.6))))
    text_c(d, (W / 2, 520), str(n), font(150, True), ACCENT, alpha=int(245 * a))
    text_c(d, (W / 2, 640), "个关键点逐帧追踪", font(42, True), WHITE, alpha=int(235 * a))'''
assert old3 in s
s = s.replace(old3, new3)

# --- 场景5：手机右移缩小，说明卡不压字 ---
s = s.replace('phone(img, "analyze", W / 2 + 150, 1000, 470, alpha=ease(clamp01(t / 0.6)))',
              'phone(img, "analyze", W / 2 + 205, 1030, 420, alpha=ease(clamp01(t / 0.6)))')
s = s.replace('CHIPS5 = ["弹跳类型：速度型", "短板排序：摆臂 / 两步节奏", "训练计划：4 周，可直接照做"]',
              'CHIPS5 = ["弹跳类型：速度型", "短板：摆臂 / 两步节奏", "计划：4 周可直接照做"]')
s = s.replace('text_c(d, (110, 700), "AI 报告", font(70, True), WHITE, anchor="lm", alpha=int(240 * ease(clamp01(t / 0.5))))',
              'text_c(d, (72, 650), "AI 报告", font(64, True), WHITE, anchor="lm", alpha=int(240 * ease(clamp01(t / 0.5))))')
s = s.replace('        f = font(30, False)', '        f = font(27, False)')
s = s.replace('        y = 810 + i * 92', '        y = 760 + i * 86')
s = s.replace('        x = 110 - 20 * (1 - k)', '        x = 72 - 20 * (1 - k)')

# --- CTA：logo 去白底 ---
oldlogo = '''    try:
        logo = Image.open(ROOT / "img/logo.png").convert("RGBA").resize((220, 220), Image.LANCZOS)
        if a < 1:
            logo.putalpha(logo.split()[3].point(lambda v: int(v * a)))
        img.alpha_composite(logo, (W // 2 - 110, 560))
    except Exception:
        pass'''
newlogo = '''    try:
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
        pass'''
assert oldlogo in s
s = s.replace(oldlogo, newlogo)
s = s.replace("SCREENS = {}", "SCREENS = {}\n_LOGO = None")
P.write_text(s, encoding="utf-8")
print("render tweaks applied")
