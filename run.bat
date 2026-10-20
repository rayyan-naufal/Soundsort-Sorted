@echo off
title SoundSort AI
echo Starting SoundSort AI...
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" start.py
) else (
    python start.py
)
pause

