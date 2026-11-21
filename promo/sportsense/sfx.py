# -*- coding: utf-8 -*-
"""合成音效（无需外部素材）"""
import numpy as np, pathlib, wave
SR = 44100
OUT = pathlib.Path(r"D:/jump app/promo/sportsense/assets/sfx")
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

def save(name, x, gain=1.0):
    x = np.asarray(x, dtype=np.float32)
    x = np.clip(x * gain, -1, 1)
    pcm = (x * 32767).astype(np.int16)
    with wave.open(str(OUT / (name + ".wav")), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(name, round(len(x)/SR, 2), "s")

def env(n, a=0.01, d=0.2, curve=2.0):
    t = np.linspace(0, 1, n)
    at = np.clip(t / max(a, 1e-4), 0, 1)
    return at * np.power(np.clip(1 - t, 0, 1), curve)

def lowpass(x, k):
    y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)):
        acc += k * (x[i] - acc); y[i] = acc
    return y

# 1. whoosh：带通噪声扫频
n = int(SR * 0.55)
noise = rng.normal(0, 1, n)
sweep = np.linspace(0.02, 0.45, n)
y = np.zeros(n); acc = 0.0
for i in range(n):
    acc += sweep[i] * (noise[i] - acc); y[i] = acc
y *= np.hanning(n) ** 1.2
save("whoosh", y, 0.55)

# 2. tick：短促点击
n = int(SR * 0.05)
x = np.zeros(n); x[0] = 1.0
x += rng.normal(0, 0.25, n) * np.exp(-np.linspace(0, 18, n))
x = lowpass(x, 0.65)
save("tick", x, 0.7)

# 3. pop：关节弹入
n = int(SR * 0.12)
t = np.arange(n) / SR
x = np.sin(2 * np.pi * (900 * np.exp(-t * 14) + 180) * t) * np.exp(-t * 26)
save("pop", x, 0.5)

# 4. riser：上升噪声（场景切换前）
n = int(SR * 0.9)
noise = rng.normal(0, 1, n)
y = np.zeros(n); acc = 0.0
for i in range(n):
    acc += (0.01 + 0.35 * (i / n) ** 2) * (noise[i] - acc); y[i] = acc
y *= np.linspace(0.1, 1.0, n) ** 1.6
save("riser", y, 0.45)

# 5. impact：低频重击
n = int(SR * 0.5)
t = np.arange(n) / SR
x = np.sin(2 * np.pi * (110 * np.exp(-t * 3.2)) * t) * np.exp(-t * 6)
x += rng.normal(0, 0.4, n) * np.exp(-t * 30)
save("impact", x, 0.75)

# 6. ui：界面提示音
n = int(SR * 0.14)
t = np.arange(n) / SR
x = (np.sin(2 * np.pi * 1180 * t) + 0.5 * np.sin(2 * np.pi * 1760 * t)) * np.exp(-t * 30)
save("ui", x, 0.38)

# 7. scan：扫描音（持续）
n = int(SR * 0.7)
t = np.arange(n) / SR
x = np.sin(2 * np.pi * (420 + 260 * t / 0.7) * t) * np.hanning(n)
save("scan", x, 0.28)
