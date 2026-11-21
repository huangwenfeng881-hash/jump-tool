# -*- coding: utf-8 -*-
import json, pathlib, subprocess
ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
TL = json.load(open(OUT / "timeline.json", encoding="utf-8"))
FF = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe"

scenes = TL["scenes"]
total = TL["total"]

# ---- 1) 旁白轨：按起点对齐 ----
inputs = []
filters = []
for i, s in enumerate(scenes):
    inputs += ["-i", s["audio"]]
    delay = int(round(s["start"] * 1000))
    filters.append("[%d:a]adelay=%d|%d,volume=1.0[a%d]" % (i, delay, delay, i))
mix = "".join("[a%d]" % i for i in range(len(scenes))) + "amix=inputs=%d:normalize=0[vo]" % len(scenes)
fc = ";".join(filters + [mix])
subprocess.run([FF, "-y", "-v", "error"] + inputs + ["-filter_complex", fc, "-map", "[vo]",
               "-c:a", "pcm_s16le", str(OUT / "voice.wav")], check=True)
print("voice.wav done")

# ---- 2) 背景音乐选一首 ----
cands = [p for p in pathlib.Path(r"E:/Users/86134/Music").glob("*.MP3")]
cands.sort(key=lambda p: p.stat().st_size)
music = None
for p in cands:
    if "9" in p.name and "25" in p.name:
        music = p; break
if music is None and cands:
    music = cands[len(cands)//2]
print("music:", music.name if music else "none")
(OUT / "music_path.txt").write_text(str(music), encoding="utf-8")
