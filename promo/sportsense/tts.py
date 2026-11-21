# -*- coding: utf-8 -*-
"""生成旁白 + 计算每个镜头的时长，输出 timeline.json"""
import asyncio, json, pathlib, subprocess
import edge_tts

OUT = pathlib.Path(r"D:/jump app/promo/sportsense/voice")
OUT.mkdir(parents=True, exist_ok=True)

FFPROBE = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe"

SCENES = [
    ("s1", "你知道自己每一跳，到底差在哪里吗？"),
    ("s2", "不用穿戴设备，手机拍一段助跑起跳的视频就够了。"),
    ("s3", "AI 会自动识别你身上的三十三个关键点，逐帧追踪每一个动作细节。"),
    ("s4", "弹跳高度、屈膝深度、起跳角度、摆臂速度、最后两步节奏、落地稳定性，六项指标全部量化。"),
    ("s5", "再判断你是力量型、速度型还是弹性型，指出最该改的短板，给出能直接照做的训练计划。"),
    ("s6", "每一次弹跳自动存档，进步曲线一眼看清；还能顺手测一测，你离扣篮还差几厘米。"),
    ("s7", "Vertrise 跃升，安卓已经上线，现在就试。"),
]

VOICE = "zh-CN-YunxiNeural"   # 男声，偏科技感
RATE = "-4%"

async def speak(name, text):
    out = OUT / (name + ".mp3")
    tts = edge_tts.Communicate(text, VOICE, rate=RATE)
    await tts.save(str(out))
    return out

def dur(p):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(p)],
                       capture_output=True, text=True)
    return float(r.stdout.strip())

async def main():
    info = []
    for name, text in SCENES:
        f = await speak(name, text)
        d = dur(f)
        info.append({"name": name, "text": text, "audio": str(f), "dur": d})
        print(name, round(d, 2), "s")
    # 镜头时长 = 语音 + 余量，首尾各留一点
    pad = {"s1": 0.8, "s2": 0.5, "s3": 0.5, "s4": 0.6, "s5": 0.5, "s6": 0.6, "s7": 1.2}
    t = 0.0
    for it in info:
        it["start"] = round(t, 3)
        it["len"] = round(it["dur"] + pad[it["name"]], 3)
        t += it["len"]
    total = round(t, 3)
    json.dump({"total": total, "scenes": info}, open(pathlib.Path(r"D:/jump app/promo/sportsense/timeline.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("TOTAL", round(total, 2), "s")

asyncio.run(main())
