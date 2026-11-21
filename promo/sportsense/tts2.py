# -*- coding: utf-8 -*-
import asyncio, json, pathlib, subprocess
import edge_tts

OUT = pathlib.Path(r"D:/jump app/promo/sportsense/voice")
OUT.mkdir(parents=True, exist_ok=True)
FFPROBE = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe"

SCENES = [
    ("s1", "先看这一跳。起跳前的最后两步，决定了你这一跳能飞多高。"),
    ("s2", "AI 会把这一跳拆成六项指标：弹跳高度、屈膝深度、起跳角度、摆臂速度，还有最后两步节奏和落地稳定性。"),
    ("s3", "你在球馆里，用手机拍一段助跑起跳的视频就够了。"),
    ("s4", "系统自动识别三十三个关键点，逐帧追踪你的身体。"),
    ("s5", "再判断你是力量型还是速度型，指出最该改的短板，给出四周训练计划。"),
    ("s6", "每一跳自动存档，还能测一测，你离扣篮还差几厘米。"),
    ("s7", "Vertrise 跃升，安卓已经上线，现在就试。"),
]
VOICE = "zh-CN-YunxiNeural"
RATE = "-3%"
PAD = {"s1": 1.4, "s2": 0.9, "s3": 0.9, "s4": 0.8, "s5": 0.9, "s6": 1.0, "s7": 1.6}

async def speak(name, text):
    out = OUT / (name + ".mp3")
    await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(out))
    return out

def dur(p):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(p)], capture_output=True, text=True)
    return float(r.stdout.strip())

async def main():
    info = []
    for name, text in SCENES:
        f = await speak(name, text)
        info.append({"name": name, "text": text, "audio": str(f), "dur": round(dur(f), 3)})
        print(name, info[-1]["dur"])
    t = 0.0
    for it in info:
        it["start"] = round(t, 3)
        it["len"] = round(it["dur"] + PAD[it["name"]], 3)
        t += it["len"]
    total = round(t, 3)
    json.dump({"total": total, "scenes": info},
              open(r"D:/jump app/promo/sportsense/timeline.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("TOTAL", total)

asyncio.run(main())
