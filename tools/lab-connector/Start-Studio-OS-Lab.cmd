@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy RemoteSigned -File "%~dp0StudioOsLab.ps1"
if errorlevel 1 (
  echo.
  echo The test helper stopped safely. Nothing was printed.
  echo If Windows blocked the downloaded ZIP, review its source and use the
  echo ZIP file Properties - Unblock before extracting it to a local folder.
  echo Do not change your computer-wide execution policy.
  pause
)
