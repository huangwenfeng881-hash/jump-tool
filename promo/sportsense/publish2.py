# -*- coding: utf-8 -*-
import pathlib, shutil, subprocess
ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
src = OUT / "Vertrise跃升-60s-实测版.mp4"
dst1 = ROOT / "promo/Vertrise跃升-60s-实测版.mp4"
dst2 = ROOT / "发布包/Vertrise跃升-60s-实测版.mp4"
shutil.copyfile(src, dst1)
dst2.parent.mkdir(exist_ok=True)
shutil.copyfile(src, dst2)
FF = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe"
subprocess.run([FF, "-y", "-v", "error", "-ss", "4.6", "-i", str(src), "-frames:v", "1",
                str(ROOT / "发布包/封面-实测版.png")], check=True)
for p in OUT.glob("_*.png"):
    p.unlink()
print("published", round(dst1.stat().st_size/1048576, 2), "MB")
