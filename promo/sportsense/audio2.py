# -*- coding: utf-8 -*-
import json, pathlib, subprocess
ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
TL = json.load(open(OUT / "timeline.json", encoding="utf-8"))
total = TL["total"]
FF = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe"
music = pathlib.Path((OUT / "music_path.txt").read_text(encoding="utf-8").strip())

# 音乐：截取 total 长度，淡入淡出，压到很轻，再用旁白做侧链闪避
fc = (
    "[1:a]atrim=0:%f,asetpts=PTS-STARTPTS,volume=0.30,"
    "afade=t=in:st=0:d=1.2,afade=t=out:st=%f:d=1.6[bed];"
    "[0:a]asplit=2[vo][side];"
    "[bed][side]sidechaincompress=threshold=0.03:ratio=8:attack=8:release=320[duck];"
    "[duck][vo]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]"
) % (total, total - 1.6)
subprocess.run([FF, "-y", "-v", "error", "-i", str(OUT / "voice.wav"), "-i", str(music),
                "-filter_complex", fc, "-map", "[out]", "-t", str(total),
                "-c:a", "aac", "-b:a", "192k", str(OUT / "audio_mix.m4a")], check=True)
print("audio mixed")

subprocess.run([FF, "-y", "-v", "error", "-i", str(OUT / "video_silent.mp4"), "-i", str(OUT / "audio_mix.m4a"),
                "-c:v", "copy", "-c:a", "copy", "-shortest",
                str(OUT / "Vertrise跃升-60s-科技风.mp4")], check=True)
print("muxed")
print(subprocess.run([FF.replace("ffmpeg.exe", "ffprobe.exe"), "-v", "error", "-show_entries",
                      "format=duration,size", "-of", "default=noprint_wrappers=1",
                      str(OUT / "Vertrise跃升-60s-科技风.mp4")], capture_output=True, text=True).stdout)
