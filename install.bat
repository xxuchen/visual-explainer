@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "VE_EXIT=1"
set "VE_PAUSE=1"
for %%A in (%*) do if /I "%%~A"=="-NoPause" set "VE_PAUSE=0"
rem Backward-compatible advanced single-agent mode (not tracked by the manager).
for %%A in (%*) do if /I "%%~A"=="-AgentHome" goto legacy
if not exist "%~dp0scripts\manage-windows.mjs" (
  echo [ERROR] Missing scripts\manage-windows.mjs. Update the complete repository.
  goto finish
)
where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Install Node.js LTS 22 or newer first: https://nodejs.org/en/download
  goto finish
)
node.exe "%~dp0scripts\manage-windows.mjs" install %*
set "VE_EXIT=%ERRORLEVEL%"
goto finish

:legacy
if not exist "%~dp0scripts\install-windows.ps1" (
  echo [ERROR] Missing scripts\install-windows.ps1.
  goto finish
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1" %*
set "VE_EXIT=%ERRORLEVEL%"

:finish
if "%VE_PAUSE%"=="1" pause
exit /b %VE_EXIT%
