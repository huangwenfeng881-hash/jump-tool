# -*- coding: utf-8 -*-
"""HUD 介绍片：旁白合成 + 时间轴（60s，120BPM，0.5s 对齐）"""
import asyncio, json, pathlib, subprocess
import edge_tts

OUT = pathlib.Path(r"D:/jump app/promo/hud-intro")
VOICE = OUT / "voice"
VOICE.mkdir(parents=True, exist_ok=True)
FFPROBE = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe"

SCRIPT = [
    ("s1", 0.0,  7.0, "起跳高度不是玄学，是可以被量化的数据。"),
    ("s2", 7.0,  8.0, "跃升把十三项体测收进手机，六步判定你的训练者类型。"),
    ("s3", 15.0, 9.0, "拍一段视频，弹跳、屈膝角、摆臂速度，AI 自动拆开。"),
    ("s4", 24.0, 9.0, "BMI、反应力量、爆发力、力量、技术、恢复，短板一眼看清。"),
    ("s5", 33.0, 9.0, "一周训练自动生成，练完一组打勾，状态会实时调整后面的重量。"),
    ("s6", 42.0, 9.0, "每次训练都存进曲线，进步看得见；弹跳知识视频随时补课。"),
    ("s7", 51.0, 9.0, "现在就去测你的第一跳。"),
]
RATE = "+6%"

def dur(p):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(p)],
                       capture_output=True, text=True)
    return float(r.stdout.strip())

async def speak(name, text):
    out = VOICE / (name + ".mp3")
    await edge_tts.Communicate(text, "zh-CN-YunxiNeural", rate=RATE).save(str(out))
    return out

async def main():
    scenes = []
    for name, start, length, text in SCRIPT:
        p = await speak(name, text)
        d = dur(p)
        print(name, "voice", round(d, 2), "slot", length, "OK" if d < length - 0.5 else "TOO LONG")
        scenes.append({"name": name, "start": start, "len": length, "audio": str(p), "text": text, "vo": round(d, 2)})
    tl = {"total": 60.0, "fps": 30, "w": 1080, "h": 1920, "bpm": 120, "scenes": scenes}
    (OUT / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=2), encoding="utf-8")
    print("total", sum(s["len"] for s in scenes))

asyncio.run(main())
