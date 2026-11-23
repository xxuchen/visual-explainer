@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Run from this checkout, independent of the caller's current directory.
rem Use Windows PowerShell 5.1, which is included with Windows 10 and 11.
set "VE_INSTALL_EXIT=1"
set "VE_INSTALL_PAUSE=1"
for %%A in (%*) do if /I "%%~A"=="-NoPause" set "VE_INSTALL_PAUSE=0"

if not exist "%~dp0scripts\install-windows.ps1" (
  echo [ERROR] Missing scripts\install-windows.ps1. Update the complete repository first.
  goto finish
)
if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  echo [ERROR] Windows PowerShell 5.1 is required.
  goto finish
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1" %*
set "VE_INSTALL_EXIT=%ERRORLEVEL%"

:finish
if "%VE_INSTALL_PAUSE%"=="1" pause
exit /b %VE_INSTALL_EXIT%
