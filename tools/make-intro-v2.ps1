# Vertrise跃升 网站介绍视频 v2：真实页面截图 + 文字 + 中文朗读（约60秒）
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Drawing
$FFMPEG = 'C:\Program Files (x86)\ETS\ffmpeg\ffmpeg.exe'
$WORK = 'D:\jump app\intro_tmp'
$SHOTS = Join-Path $WORK 'shots'
$FINAL = 'D:\jump app\intro.mp4'

# 12 张幻灯片的页面截图 + 文字 + 旁白
$slides = @(
  @{ shot='index.png'; t='Vertrise跃升'; s='弹跳 · 力量 · 训练数据一站搞定'; b=@(); n='Vertrise跃升，把每次起跳，量成数据。' },
  @{ shot='jump.png'; t='弹跳测量'; s=''; b=@('上传训练视频，自动识别离地与落地','精准换算弹跳高度与腾空时间'); n='上传一段起跳视频，自动识别离地与落地，精准测出你的弹跳高度。' },
  @{ shot='barbell.png'; t='杠铃测速'; s=''; b=@('侧面拍杠铃，自动追踪运动轨迹','峰值速度、功率曲线一目了然'); n='杠铃测速，自动追踪杠铃轨迹，测出峰值速度与功率曲线。' },
  @{ shot='chart.png'; t='力量-速度图表'; s=''; b=@('双轴曲线：速度与负重同步对比','直观看到负重上涨时速度的变化'); n='力量与速度曲线联动，一眼看清负重和速度的关系。' },
  @{ shot='trainer.png'; t='AI 弹跳教练'; s=''; b=@('多轮对话，随时追问','结合身高、记录与打卡数据作答','定制计划、分析瓶颈、解答动作疑问'); n='AI弹跳教练，多轮对话，结合你的真实训练数据，定制计划、分析瓶颈。' },
  @{ shot='plans.png'; t='训练计划模板'; s=''; b=@('新手入门、爆发力进阶、力量基础','三套现成计划，一键复制照着练'); n='三套训练模板，从新手到进阶，一键复制照着练。' },
  @{ shot='checkin.png'; t='训练打卡日历'; s=''; b=@('点一下日历即打卡','连续天数与总天数自动统计'); n='训练打卡日历，每一次坚持都有记录。' },
  @{ shot='progress.png'; t='弹跳进步曲线'; s=''; b=@('原地、助跑、摸高三条折线','进步与否，一眼看清'); n='弹跳进步曲线，原地、助跑、摸高，进步一眼看清。' },
  @{ shot='leaderboard.png'; t='公开排行榜'; s=''; b=@('和球友比一比谁跳得更高','只显示昵称与成绩，隐私安全'); n='公开排行榜，和球友比一比，看谁跳得更高。' },
  @{ shot='profile.png'; t='扣篮差距计算'; s=''; b=@('填入站立摸高，立即算出差距','距扣标准篮筐，还差多少厘米'); n='填写站立摸高，马上算出你离扣篮还差多少。' },
  @{ shot='history.png'; t='免费 · 云端同步'; s=''; b=@('打开即用，无需注册','登录后训练记录自动同步'); n='全部免费，打开即用；登录后，训练记录自动同步到云端。' },
  @{ shot='index.png'; t='把汗水练成数据'; s='Vertrise跃升 · 助你越跳越高'; b=@(); n='今天起，把汗水练成数据。Vertrise跃升，助你越跳越高。' }
)

# ---------- 1) 逐段合成中文旁白 WAV（rate 6 → 旁白约 40s，整片约 60s） ----------
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$synth.Rate = 6
$i = 0
foreach ($sl in $slides) {
  $synth.SetOutputToWaveFile((Join-Path $WORK ("s" + $i + ".wav")))
  $synth.Speak($sl.n)
  $i++
}
$synth.Dispose()
Start-Sleep -Milliseconds 300

function Get-WavDur($path) {
  $fs = [System.IO.File]::OpenRead($path)
  $br = New-Object -TypeName System.IO.BinaryReader -ArgumentList $fs
  $fs.Position = 28; $byteRate = $br.ReadInt32()
  $fs.Position = 42; $dataSize = $br.ReadInt32()
  $br.Close(); $fs.Close()
  return $dataSize / $byteRate
}

# ---------- 2) 合成幻灯片：真实截图 + 暗色渐变 + 标题/要点 ----------
function New-Slide($shot, $t, $s, $b, $path) {
  $W = 1280; $H = 720
  $bg = New-Object System.Drawing.Bitmap((Join-Path $SHOTS $shot))
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bg, 0, 0, $W, $H)
  $dim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(110, 0, 0, 0))
  $g.FillRectangle($dim, 0, 0, $W, $H)
  $gh = $H - 300
  $gradRect = New-Object System.Drawing.Rectangle(0, 300, $W, $gh)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($gradRect, [System.Drawing.Color]::FromArgb(0, 10, 18, 30), [System.Drawing.Color]::FromArgb(210, 8, 14, 24), 90)
  $g.FillRectangle($grad, $gradRect)
  $grad.Dispose()
  $titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 52, [System.Drawing.FontStyle]::Bold)
  $white = [System.Drawing.Brushes]::White
  $g.DrawString($t, $titleFont, $white, 80, 96)
  $titleFont.Dispose()
  $bar = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 45, 212, 191))
  $g.FillRectangle($bar, 84, 196, 130, 6)
  $bar.Dispose()
  if ($s) {
    $subFont = New-Object System.Drawing.Font('Microsoft YaHei', 28, [System.Drawing.FontStyle]::Regular)
    $g.DrawString($s, $subFont, $white, 84, 224)
    $subFont.Dispose()
  }
  $bulletFont = New-Object System.Drawing.Font('Microsoft YaHei', 30, [System.Drawing.FontStyle]::Regular)
  $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 45, 212, 191))
  $y = 330
  foreach ($line in $b) {
    $g.FillEllipse($dot, 88, $y + 10, 12, 12)
    $g.DrawString($line, $bulletFont, $white, 124, $y)
    $y += 56
  }
  $bulletFont.Dispose(); $dot.Dispose()
  $footFont = New-Object System.Drawing.Font('Microsoft YaHei', 20, [System.Drawing.FontStyle]::Regular)
  $foot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(170, 255, 255, 255))
  $g.DrawString('Vertrise跃升 · 弹跳训练数据工具', $footFont, $foot, 80, 668)
  $footFont.Dispose(); $foot.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $bg.Dispose(); $dim.Dispose()
}
for ($k = 0; $k -lt $slides.Count; $k++) {
  $sl = $slides[$k]
  New-Slide $sl.shot $sl.t $sl.s $sl.b (Join-Path $WORK ("s" + $k + ".png"))
}

# ---------- 3) ffmpeg：图片 + 旁白（补足静音到目标时长），淡入淡出，再拼接 ----------
$PAD = 1.7
$MIN = 4.2
$list = @(); for ($k = 0; $k -lt $slides.Count; $k++) {
  $dur = Get-WavDur (Join-Path $WORK ("s" + $k + ".wav"))
  $clip = [Math]::Max($dur + $PAD, $MIN)
  $clipStr = $clip.ToString('0.00')
  $fout = [Math]::Max($clip - 0.45, 0.05).ToString('0.00')
  & $FFMPEG -y -loop 1 -i (Join-Path $WORK ("s" + $k + ".png")) -i (Join-Path $WORK ("s" + $k + ".wav")) `
    -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=${fout}:d=0.4" -t $clipStr `
    -c:v libx264 -preset medium -tune stillimage -pix_fmt yuv420p -r 25 `
    -af "apad=whole_dur=$clipStr,atrim=0:$clipStr" -c:a aac -b:a 160k -ar 44100 -loglevel error (Join-Path $WORK ("clip" + $k + ".mp4")) 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ("ffmpeg 生成 clip" + $k + " 失败") }
  $list += "file '" + (Join-Path $WORK ("clip" + $k + ".mp4")) + "'"
  '{0}  clip={1}s  wav={2}s' -f $k, $clipStr, ([Math]::Round($dur, 2))
}
Set-Content (Join-Path $WORK 'list.txt') -Value $list -Encoding Ascii
& $FFMPEG -y -f concat -safe 0 -i (Join-Path $WORK 'list.txt') -c copy -loglevel error $FINAL 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ffmpeg 拼接失败' }
Write-Output ('FINISHED: ' + $FINAL)