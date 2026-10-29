@echo off
:: ========================================================
:: QuinloveRin Code - Create & Launch Project Window
:: Syntax: create_project.bat <DriveLetter> <ProjectName>
:: Example: create_project.bat E App-Ban-Hang
:: ========================================================

set "DRIVE=%~1"
set "NAME=%~2"

if "%DRIVE%"=="" set "DRIVE=E"
if "%NAME%"=="" set "NAME=New-Project"

set "TARGET=%DRIVE%:\%NAME%"

echo [Project Spawner] Dang khoi tao thu muc: %TARGET%
if not exist "%TARGET%" (
    mkdir "%TARGET%"
)

if not exist "%TARGET%\GEMINI.md" (
    (
        echo # Du An: %NAME%
        echo - Khoi tao tu dong boi QuinloveRin Code
        echo - Vi tri luu tru: %TARGET%
        echo - Ngay tao: %DATE% %TIME%
        echo.
        echo ## Tien Trinh Du An:
        echo - [x] Khoi tao thu muc va Passport GEMINI.md
        echo - [ ] Trien khai ma nguon
    ) > "%TARGET%\GEMINI.md"
)

:: Khoi chay Antigravity IDE trong background tach roi hoan toan
set "AGY_EXE=C:\Users\letru\AppData\Local\Programs\antigravity\Antigravity.exe"
if exist "%AGY_EXE%" (
    echo [Project Spawner] Dang bat Cua so Antigravity IDE moi...
    start "" "%AGY_EXE%" "%TARGET%"
)

exit /b 0
