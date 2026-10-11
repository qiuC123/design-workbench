@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0scripts\start-website-lan.ps1" -RestartExisting
pause
