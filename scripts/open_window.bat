@echo off
:: ========================================================
:: QuinloveRin Code - Open Existing Project Window
:: Syntax: open_window.bat <FullFolderPath>
:: Example: open_window.bat "E:\MyProject"
:: ========================================================

set "TARGET=%~1"
if "%TARGET%"=="" exit /b 1

set "AGY_EXE=C:\Users\letru\AppData\Local\Programs\antigravity\Antigravity.exe"
if exist "%AGY_EXE%" (
    echo [Launcher] Dang mo Cua so Antigravity cho: %TARGET%
    start "" "%AGY_EXE%" "%TARGET%"
)

exit /b 0
