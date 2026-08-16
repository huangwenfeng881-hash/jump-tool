# Vertrise跃升 介绍视频 v3：edge-tts 神经语音配音（替换原 SAPI 音色）
$ErrorActionPreference = 'Continue'
$FFMPEG = 'C:\Program Files (x86)\ETS\ffmpeg\ffmpeg.exe'
$WORK = 'D:\jump app\intro_tmp'
$TTS = Join-Path $WORK 'tts'
$FINAL = 'D:\jump app\intro.mp4'

$PAD = 1.0
$MIN = 4.0

function Get-Mp3Dur($path) {
  $line = & $FFMPEG -i $path -f null NUL 2>&1 | Select-String -Pattern 'Duration: (\d+):(\d+):(\d+\.\d+)' | Select-Object -First 1
  if (-not $line) { return 0.0 }
  $m = [regex]::Match($line.Line, 'Duration: (\d+):(\d+):(\d+\.\d+)')
  return [int]$m.Groups[1].Value * 3600 + [int]$m.Groups[2].Value * 60 + [double]$m.Groups[3].Value
}

$list = @()
for ($k = 0; $k -lt 12; $k++) {
  $src = Join-Path $TTS ("x30_" + $k + ".mp3")
  $dur = Get-Mp3Dur $src
  $clip = [Math]::Max($dur + $PAD, $MIN)
  $clipStr = $clip.ToString('0.00')
  $fout = [Math]::Max($clip - 0.45, 0.05).ToString('0.00')
  $vf = 'fade=t=in:st=0:d=0.4,fade=t=out:st=' + $fout + ':d=0.4'
  & $FFMPEG -y -loop 1 -i (Join-Path $WORK ("s" + $k + ".png")) -i $src -vf $vf -t $clipStr -c:v libx264 -preset medium -tune stillimage -pix_fmt yuv420p -r 25 -af "apad=whole_dur=$clipStr,atrim=0:$clipStr,volume=1.6" -c:a aac -b:a 192k -ar 44100 -loglevel error (Join-Path $WORK ("clip" + $k + ".mp4")) 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Output ("ffmpeg 生成 clip" + $k + " 失败"); continue }
  $list += "file '" + (Join-Path $WORK ("clip" + $k + ".mp4")) + "'"
  '{0}  clip={1}s  wav={2}s' -f $k, $clipStr, ([Math]::Round($dur, 2))
}
Set-Content (Join-Path $WORK 'list.txt') -Value $list -Encoding Ascii
& $FFMPEG -y -f concat -safe 0 -i (Join-Path $WORK 'list.txt') -c copy -loglevel error $FINAL 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ffmpeg 拼接失败' }
Write-Output ('FINISHED: ' + $FINAL)