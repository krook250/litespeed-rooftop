@echo off
REM Rooftop Auto - pull real vehicle photos into site\demo\img\veh
REM Needs internet. No npm install, no API key.
cd /d "%~dp0"
node mock\photos\fetch-photos.mjs
echo.
pause
