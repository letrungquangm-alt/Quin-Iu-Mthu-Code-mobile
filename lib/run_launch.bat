@echo off
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%launch_interactive.ps1" -Target "%~1" -Browser "%~2" -Profile "%~3"
