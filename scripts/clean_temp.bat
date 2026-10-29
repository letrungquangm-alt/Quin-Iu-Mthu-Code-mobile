@echo off
:: ========================================================
:: QuinloveRin Code - Fast System & Cache Cleaner
:: ========================================================

echo [Cleaner] Don dep cache tam thoi...
if exist "E:\MThu Mobile Code\incoming_photo.jpg" del /f /q "E:\MThu Mobile Code\incoming_photo.jpg"

:: Don dep file log tam trong thu muc brain cu neu co
for /d %%p in ("C:\Users\letru\.gemini\antigravity\brain\tmp*") do (
    rd /s /q "%%p" 2>nul
)

echo [Cleaner] Hoan tat dọn dep!
exit /b 0
