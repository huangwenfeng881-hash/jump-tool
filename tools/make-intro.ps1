# Vertrise跃升 网站介绍视频生成脚本（约1分钟：12张文字画面 + 中文朗读）
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Drawing

$FFMPEG = 'C:\Program Files (x86)\ETS\ffmpeg\ffmpeg.exe'
$WORK = 'D:\jump app\intro_tmp'
$FINAL = 'D:\jump app\intro.mp4'
if (Test-Path $WORK) { Remove-Item $WORK -Recurse -Force }
New-Item -ItemType Directory -Force -Path $WORK | Out-Null

# 幻灯片内容：标题 / 副标题 / 要点 / 旁白
$slides = @(
  @{ t='Vertrise跃升';  s='弹跳 · 力量 · 训练数据一站搞定'; b=@(); n='Vertrise跃升，把每次起跳，量成数据。' },
  @{ t='弹跳测量';      s=''; b=@('上传训练视频，自动识别离地与落地','精准换算弹跳高度与腾空时间','可对标尺校准，测得更准'); n='上传一段起跳视频，自动识别离地与落地，精准测出你的弹跳高度。' },
  @{ t='杠铃测速';      s=''; b=@('侧面拍杠铃，自动追踪运动轨迹','峰值速度、功率曲线一目了然'); n='杠铃测速，自动追踪杠铃轨迹，测出峰值速度与功率曲线。' },
  @{ t='力量-速度图表'; s=''; b=@('双轴曲线：速度与负重同步对比','直观看到负重上涨时速度的变化'); n='力量与速度曲线联动，一眼看清负重和速度的关系。' },
  @{ t='AI 弹跳教练';   s=''; b=@('多轮对话，随时追问','结合你的身高、记录与打卡数据作答','定制计划、分析瓶颈、解答动作疑问'); n='AI弹跳教练，多轮对话，结合你的真实训练数据，定制计划、分析瓶颈。' },
  @{ t='训练计划模板';  s=''; b=@('新手入门、爆发力进阶、力量基础','三套现成计划，一键复制照着练'); n='三套训练模板，从新手到进阶，一键复制照着练。' },
  @{ t='训练打卡日历';  s=''; b=@('点一下日历即打卡','连续天数与总天数自动统计'); n='训练打卡日历，每一次坚持都有记录。' },
  @{ t='弹跳进步曲线';  s=''; b=@('原地、助跑、摸高三条折线','进步与否，一眼看清'); n='弹跳进步曲线，原地、助跑、摸高，进步一眼看清。' },
  @{ t='公开排行榜';    s=''; b=@('和球友比一比谁跳得更高','只显示昵称与成绩，隐私安全'); n='公开排行榜，和球友比一比，看谁跳得更高。' },
  @{ t='扣篮差距计算';  s=''; b=@('填入站立摸高，立即算出差距','距扣标准篮筐，还差多少厘米'); n='填写站立摸高，马上算出你离扣篮还差多少。' },
  @{ t='免费 · 云端同步'; s=''; b=@('打开即用，无需注册','登录后训练记录自动同步'); n='全部免费，打开即用；登录后，训练记录自动同步到云端。' },
  @{ t='把汗水练成数据'; s='Vertrise跃升 · 助你越跳越高'; b=@(); n='今天起，把汗水练成数据。Vertrise跃升，助你越跳越高。' }
)

# ---------- 1) 逐段合成中文旁白 WAV ----------
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$synth.Rate = 7   # 加速到约 56s（1 分钟左右）
for ($i = 0; $i -lt $slides.Count; $i++) {
  $synth.SetOutputToWaveFile("$WORK\s$i.wav")
  $synth.Speak($slides[$i].n)
}
$synth.Dispose()

# 读 WAV 时长（秒）
function Get-WavDur($path) {
  $fs = [System.IO.File]::OpenRead($path)
  $br = New-Object System.IO.BinaryReader($fs)
  $fs.Position = 28; $byteRate = $br.ReadInt32()
  $fs.Position = 42; $dataSize = $br.ReadInt32()
  $br.Close(); $fs.Close()
  return $dataSize / $byteRate
}

# ---------- 2) 绘制幻灯片 PNG（1280x720 渐变 + 文字） ----------
function New-Slide($t, $s, $b, $path) {
  $W = 1280; $H = 720
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(13, 148, 136), [System.Drawing.Color]::FromArgb(2, 132, 199), 45)
  $g.FillRectangle($grad, $rect)

  # 装饰半透明圆（空间感）
  $d1 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 255, 255, 255))
  $g.FillEllipse($d1, -120, -120, 420, 420)
  $d2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 255, 255, 255))
  $g.FillEllipse($d2, 950, 460, 520, 520)
  $d1.Dispose(); $d2.Dispose()

  # 标题
  $titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 58, [System.Drawing.FontStyle]::Bold)
  $white = [System.Drawing.Brushes]::White
  $g.DrawString($t, $titleFont, $white, 80, 120)
  $titleFont.Dispose()

  # 标题下强调条
  $bar = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 220))
  $g.FillRectangle($bar, 84, 220, 120, 6)
  $bar.Dispose()

  # 副标题
  if ($s) {
    $subFont = New-Object System.Drawing.Font('Microsoft YaHei', 30, [System.Drawing.FontStyle]::Regular)
    $g.DrawString($s, $subFont, $white, 84, 250)
    $subFont.Dispose()
  }

  # 要点
  $bulletFont = New-Object System.Drawing.Font('Microsoft YaHei', 34, [System.Drawing.FontStyle]::Regular)
  $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 200))
  $y = 330
  foreach ($line in $b) {
    $g.FillEllipse($dot, 88, $y + 12, 14, 14)
    $g.DrawString($line, $bulletFont, $white, 124, $y)
    $y += 64
  }
  $bulletFont.Dispose(); $dot.Dispose()

  # 底部品牌
  $footFont = New-Object System.Drawing.Font('Microsoft YaHei', 22, [System.Drawing.FontStyle]::Regular)
  $foot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 255, 255, 255))
  $g.DrawString('Vertrise跃升 · 弹跳训练数据工具', $footFont, $foot, 80, 650)
  $footFont.Dispose(); $foot.Dispose()

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $grad.Dispose()
}

for ($i = 0; $i -lt $slides.Count; $i++) {
  New-Slide $slides[$i].t $slides[$i].s $slides[$i].b "$WORK\s$i.png"
}

# ---------- 3) ffmpeg：每张幻灯片 = 图片 + 对应旁白，淡入淡出，再拼接 ----------
$list = @()
for ($i = 0; $i -lt $slides.Count; $i++) {
  $dur = Get-WavDur "$WORK\s$i.wav"
  $fout = 0
  if ($dur - 0.4 -gt 0) { $fout = $dur - 0.4 }
  & $FFMPEG -y -loop 1 -i "$WORK\s$i.png" -i "$WORK\s$i.wav" `
    -vf "fade=t=in:st=0:d=0.35,fade=t=out:st=$($fout.ToString('0.00')):d=0.35" `
    -c:v libx264 -preset medium -tune stillimage -pix_fmt yuv420p `
    -c:a aac -b:a 160k -shortest "$WORK\clip$i.mp4" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg 生成 clip$i 失败" }
  $list += "file '$WORK\clip$i.mp4'"
}
Set-Content "$WORK\list.txt" -Value $list -Encoding Ascii
& $FFMPEG -y -f concat -safe 0 -i "$WORK\list.txt" -c copy $FINAL 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ffmpeg 拼接失败' }

Write-Output "FINISHED: $FINAL"
