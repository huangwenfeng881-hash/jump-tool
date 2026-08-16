# server-core.ps1 — 静态服务器进程（由 start-server.ps1 启动，Stop-Process 停止即释放端口）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File server-core.ps1 -Port 8899
param([int]$Port = 8899)

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$errLog = Join-Path $rootDir 'server-error.log'
$mimeMap = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.task' = 'application/octet-stream'
  '.data' = 'application/octet-stream'
  '.mp4'  = 'video/mp4'
  '.webm' = 'video/webm'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.apk'  = 'application/vnd.android.package-archive'
}

# 优先绑定 127.0.0.1；部分系统对 127.0.0.1 需要管理员权限（http.sys URLACL），
# 此时回退到 localhost（系统默认回环豁免，普通用户可用）。
$srv = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:$Port/"
$srv.Prefixes.Add($prefix)
try {
  $srv.Start()
} catch {
  try {
    $srv = New-Object System.Net.HttpListener
    $prefix = "http://localhost:$Port/"
    $srv.Prefixes.Add($prefix)
    $srv.Start()
  } catch {
    $msg = "cannot bind $prefix : $($_.Exception.Message)"
    Write-Error $msg
    try {
      [System.IO.File]::WriteAllText($errLog, $msg + "`r`n" + $_.Exception.ToString(), [System.Text.Encoding]::UTF8)
    } catch {}
    exit 1
  }
}
Write-Host "Vertrise server: $prefix"

while ($true) {
  $ctx = $srv.GetContext()
  try {
    $req = $ctx.Request
    $res = $ctx.Response
    $path = $req.Url.AbsolutePath
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $rel = [System.Uri]::UnescapeDataString($path.TrimStart('/'))
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootDir $rel))
    $rootFull = [System.IO.Path]::GetFullPath($rootDir)
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $res.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.OutputStream.Write($msg, 0, $msg.Length)
      $res.Close()
      continue
    }
    $ext = [System.IO.Path]::GetExtension($full).ToLower()
    $ct = 'application/octet-stream'
    if ($mimeMap.ContainsKey($ext)) { $ct = $mimeMap[$ext] }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $res.ContentType = $ct
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
  }
}
