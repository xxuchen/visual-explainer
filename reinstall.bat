@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "VE_EXIT=1"
set "VE_PAUSE=1"
for %%A in (%*) do if /I "%%~A"=="-NoPause" set "VE_PAUSE=0"
if not exist "%~dp0scripts\manage-windows.mjs" (
  echo [ERROR] Missing scripts\manage-windows.mjs. Update the complete repository.
  goto finish
)
where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Install Node.js LTS 22 or newer first: https://nodejs.org/en/download
  goto finish
)
node.exe "%~dp0scripts\manage-windows.mjs" reinstall %*
set "VE_EXIT=%ERRORLEVEL%"
goto finish

:finish
if "%VE_PAUSE%"=="1" pause
exit /b %VE_EXIT%
