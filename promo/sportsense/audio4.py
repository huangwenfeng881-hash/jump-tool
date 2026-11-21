# -*- coding: utf-8 -*-
"""无音乐版：旁白 + 音效（按事件时间线混音）"""
import json, pathlib, subprocess, wave
import numpy as np

ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
SFX = OUT / "assets/sfx"
TL = json.load(open(OUT / "timeline.json", encoding="utf-8"))
FF = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe"
SR = 44100
total = TL["total"]
N = int(total * SR) + SR

def load_wav(p):
    with wave.open(str(p), "rb") as w:
        n = w.getnframes(); ch = w.getnchannels()
        data = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1: data = data.reshape(-1, ch).mean(axis=1)
    return data

def add(buf, clip, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(clip))
    buf[i:j] += clip[:j-i] * gain

# ---- 旁白 ----
VOICE = np.zeros(N, dtype=np.float32)
for s in TL["scenes"]:
    mp3 = pathlib.Path(s["audio"])
    wav = mp3.with_suffix(".conv.wav")
    subprocess.run([FF, "-y", "-v", "error", "-i", str(mp3), "-ar", str(SR), "-ac", "1", str(wav)], check=True)
    add(VOICE, load_wav(wav), s["start"], 1.0)
print("voice placed")

# ---- 音效 ----
BONES_N = 14
JOINTS_N = 15
def build_events():
    ev = []
    for s in TL["scenes"]:
        st, ln, nm = s["start"], s["len"], s["name"]
        ev.append((st, "whoosh", 0.55))
        if nm in ("s1", "s7"): ev.append((st, "impact", 0.75))
        if nm == "s1":
            for i in range(JOINTS_N):
                ev.append((st + 1.8 + 2.6 * ((i * 0.35 + 0.5) / BONES_N), "pop", 0.42))
            for i in range(4): ev.append((st + 5.0 + i * 0.9, "ui", 0.5))
            ev.append((st + 8.2, "scan", 0.42))
        if nm == "s2":
            for i in range(6): ev.append((st + 0.5 + i * 0.55, "ui", 0.45))
            for i in range(50): ev.append((st + 0.6 + i * 0.09, "tick", 0.12))
        if nm in ("s3", "s4"):
            ev.append((st + 0.15, "scan", 0.4))
            for i in range(7): ev.append((st + 0.3 + i * 0.22, "tick", 0.16))
        if nm == "s5":
            for i in range(3): ev.append((st + 0.7 + i * 0.6, "ui", 0.5))
        if nm == "s6":
            ev.append((st + 0.2, "ui", 0.42))
        ev.append((st + ln - 0.5, "riser", 0.4))
    return ev

SFXBUF = np.zeros(N, dtype=np.float32)
for t, name, g in build_events():
    p = SFX / (name + ".wav")
    if p.exists():
        add(SFXBUF, load_wav(p), t, g)
print("sfx placed")

mix = VOICE * 0.95 + SFXBUF
peak = float(np.max(np.abs(mix))) or 1.0
if peak > 0.98: mix *= 0.98 / peak
out = OUT / "audio2.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix[:int(total*SR)] * 32767).astype(np.int16).tobytes())
print("mixed", round(total, 2), "s")

subprocess.run([FF, "-y", "-v", "error", "-i", str(out), "-i", str(OUT / "video2_silent.mp4"),
                "-filter_complex", "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]",
                "-map", "1:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-t", str(total), str(OUT / "Vertrise跃升-60s-实测版.mp4")], check=True)
print(subprocess.run([FF.replace("ffmpeg.exe","ffprobe.exe"), "-v", "error", "-show_entries",
                      "format=duration,size", "-of", "default=noprint_wrappers=1",
                      str(OUT / "Vertrise跃升-60s-实测版.mp4")], capture_output=True, text=True).stdout)
