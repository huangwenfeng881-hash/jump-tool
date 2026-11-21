# -*- coding: utf-8 -*-
"""HUD 介绍片音轨：画布音乐 + 旁白 + 合成 HUD 音效（无第三方素材）"""
import json, pathlib, subprocess, wave
import numpy as np

ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/hud-intro"
TL = json.loads((OUT / "timeline.json").read_text(encoding="utf-8"))
MUSIC = ROOT / "1.drawai.media/audio-f4f29d47-6a5d-48e2-ac0a-ca3c577676ff/audio.wav"
FF = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe"
SR = 48000
TOTAL = TL["total"]
N = int(TOTAL * SR) + SR

def load(p, target_sr=SR):
    tmp = pathlib.Path(str(p) + ".48k.wav")
    subprocess.run([FF, "-y", "-v", "error", "-i", str(p), "-ar", str(target_sr), "-ac", "2", str(tmp)], check=True)
    with wave.open(str(tmp), "rb") as w:
        n = w.getnframes(); ch = w.getnchannels()
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch == 2: a = a.reshape(-1, 2)
    else: a = np.stack([a, a], axis=1)
    return a

def put(buf, clip, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(clip))
    buf[i:j] += clip[: j - i] * gain

def beep(dur=0.05, f=1400):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 55)
    s = np.sin(2 * np.pi * f * t) * env * 0.25
    return np.stack([s, s], axis=1)

def tick(f=2200):
    return beep(0.03, f)

def whoosh(dur=0.5):
    t = np.arange(int(dur * SR)) / SR
    noise = np.random.default_rng(3).normal(0, 1, len(t)).astype(np.float32)
    # 简单带通：差分 + 平滑
    b = np.diff(noise, prepend=0.0)
    k = np.exp(-t * 7)
    s = (b * k * 0.4).astype(np.float32)
    s /= max(1e-6, np.max(np.abs(s)))
    s *= 0.5
    return np.stack([s, s], axis=1)

def impact():
    t = np.arange(int(0.6 * SR)) / SR
    s = np.sin(2 * np.pi * 62 * t) * np.exp(-t * 9) * 0.9
    return np.stack([s, s], axis=1)

# 音乐（60.03s，正好）
music = load(MUSIC)[:N]
if len(music) < N:
    pad = np.zeros((N - len(music), 2), dtype=np.float32)
    music = np.concatenate([music, pad])

# 旁白
VO = np.zeros((N, 2), dtype=np.float32)
for s in TL["scenes"]:
    clip = load(s["audio"])
    put(VO, clip, s["start"] + 0.55, 1.0)

# 旁白包络 → 音乐闪避（sidechain）
mono = np.abs(VO).mean(axis=1)
win = int(0.12 * SR)
env = np.convolve(mono, np.ones(win) / win, mode="same")
env = np.clip(env / (np.percentile(env[env > 0], 85) if np.any(env > 0) else 1), 0, 1)
duck = 1.0 - 0.62 * env            # 有人声时音乐压到 ~38%
music_ducked = music * duck[..., None]

# 音效
SFX = np.zeros((N, 2), dtype=np.float32)
for s in TL["scenes"]:
    put(SFX, whoosh(), max(0, s["start"] - 0.22), 0.55)
    put(SFX, beep(0.05, 1600), s["start"] + 0.15, 0.35)
# 级联节点滴答
for i in range(6):
    put(SFX, tick(2100 + i * 90), 24.35 + i * 0.92, 0.30)
# 打勾
for i in range(5):
    put(SFX, tick(2600), 38.2 + i * 0.45, 0.28)
# LOCK 冲击
put(SFX, impact(), 51.4, 0.55)
put(SFX, whoosh(), 51.2, 0.6)

mix = music_ducked * 0.55 + VO * 1.0 + SFX * 0.5
peak = float(np.max(np.abs(mix))) or 1.0
if peak > 0.97: mix *= 0.97 / peak

raw = OUT / "audio_raw.wav"
with wave.open(str(raw), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix[: int(TOTAL * SR)] * 32767).astype(np.int16).tobytes())
print("mixed", round(TOTAL, 2), "s")

final = OUT / "Vertrise跃升-60s-HUD介绍.mp4"
subprocess.run([FF, "-y", "-v", "error", "-i", str(OUT / "silent.mp4"), "-i", str(raw),
                "-filter_complex", "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]",
                "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-t", str(TOTAL), str(final)], check=True)
print("muxed", final.name)
