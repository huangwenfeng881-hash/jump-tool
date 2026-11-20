@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Vertrise - rebuild Supabase backend (one click)
echo ============================================
echo.
if not exist ".supabase-token" (
  echo [!] token not found.
  echo     1^) open https://supabase.com/dashboard and sign up
  echo     2^) avatar - Account - Access Tokens - Generate new token
  echo     3^) paste the sbp_... token into .supabase-token in this folder
  echo.
  pause
  exit /b 1
)
echo Creating project and writing config (2-4 min, do not close)...
echo.
node tools\setup-supabase.mjs
echo.
pause