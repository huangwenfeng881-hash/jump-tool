# Vertrise local server launcher (no dependencies, PS 5.1+ compatible)
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File start-server.ps1 [-NoBrowser]
# 端口 8899 被占用时自动改用 8900-8999 的空闲端口；停止时结束服务器进程即释放端口。
param([switch]$NoBrowser)

$root = $PSScriptRoot

# ---------- 1. 清理本项目残留的旧服务器进程 ----------
# 防止重复双击 bat 后旧进程堆积、端口漂移到 89xx，始终只留一个最新服务器。
$stale = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'server-core\.ps1' -and $_.ProcessId -ne $PID })
if ($stale.Count -gt 0) {
  foreach ($p in $stale) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host ("已清理 " + $stale.Count + " 个残留的旧服务器进程") -ForegroundColor Yellow
  Start-Sleep -Milliseconds 800
}

# ---------- 2. 找空闲端口（8899 优先，被占用则顺延） ----------
$port = 8899
while ($port -lt 9000) {
  $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $inUse) { break }
  $port++
}
if ($port -ge 9000) {
  Write-Host '端口 8899-8999 均被占用，无法启动。请关闭占用这些端口的程序后重试。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

# ---------- 3. 启动服务器进程 ----------
# 注意：Windows PowerShell 5.1 的 Start-Process -ArgumentList 传数组会剥掉参数里的引号，
# 路径含空格（D:\jump app\...）时会被拆断，导致子进程报“-File D:\jump 不是 .ps1”。
# 必须把整条参数拼成单个字符串传入。
$core = Join-Path $root 'server-core.ps1'
$argsLine = '-NoProfile -ExecutionPolicy Bypass -File "' + $core + '" -Port ' + $port
$serverProc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsLine -WindowStyle Hidden -PassThru

# ---------- 4. 健康检查：服务器真正能响应后才开浏览器 ----------
$url = ''
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  if ($serverProc.HasExited) { break }
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $url = "http://127.0.0.1:$port/"; break } catch {}
  try { Invoke-WebRequest -Uri "http://localhost:$port/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $url = "http://localhost:$port/"; break } catch {}
}
if (-not $url) {
  Write-Host '服务器未能启动，原因如下：' -ForegroundColor Red
  $errLog = Join-Path $root 'server-error.log'
  if (Test-Path $errLog) {
    Get-Content $errLog | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Red }
  } else {
    Write-Host '  未知错误，请把本窗口内容截图反馈' -ForegroundColor Red
  }
  Read-Host '按回车退出'
  exit 1
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '  Vertrise 本地服务器已启动' -ForegroundColor Cyan
Write-Host ('  地址: ' + $url) -ForegroundColor Cyan
if ($port -ne 8899) { Write-Host '  （8899 被占用，已自动改用其他端口）' -ForegroundColor Yellow }
Write-Host '  请勿直接双击 HTML 打开（file:// 无法加载识别模型）' -ForegroundColor Yellow
Write-Host '  浏览器将自动打开 AI 弹跳分析页' -ForegroundColor Cyan
Write-Host '  按回车键停止服务器' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ''

if (-not $NoBrowser) {
  try { Start-Process ($url + 'ai-jump.html') } catch {}
}

# 等待回车停止；无交互控制台时保持运行直到进程被结束
try {
  while ($true) {
    if ([Console]::KeyAvailable) { [void][Console]::ReadKey($true); break }
    Start-Sleep -Milliseconds 300
  }
} catch {
  while ($true) { Start-Sleep -Seconds 60 }
}

# 停止服务器进程（独立进程，Stop-Process 即释放端口，无残留）
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Write-Host '服务器已停止。'
