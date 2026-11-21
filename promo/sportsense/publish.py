# -*- coding: utf-8 -*-
import pathlib, shutil, subprocess
ROOT = pathlib.Path(r"D:/jump app")
OUT = ROOT / "promo/sportsense"
FF = r"C:/Users/86134/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe"

src = OUT / "Vertrise跃升-60s-科技风.mp4"
dst1 = ROOT / "promo/Vertrise跃升-60s-科技风.mp4"
dst2 = ROOT / "发布包/Vertrise跃升-60s-科技风.mp4"
shutil.copyfile(src, dst1)
dst2.parent.mkdir(exist_ok=True)
shutil.copyfile(src, dst2)

# 封面：取 2.2s 的钩子画面
cover = ROOT / "发布包/封面-60s科技风.png"
subprocess.run([FF, "-y", "-v", "error", "-ss", "2.2", "-i", str(src), "-frames:v", "1", str(cover)], check=True)

# 清理中间帧
for p in OUT.glob("_*.png"):
    p.unlink()
print("done", dst1.stat().st_size // 1024 // 1024, "MB")
