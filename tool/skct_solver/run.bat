@echo off
chcp 65001 > nul
title SKCT AI Auto Solver Server
echo ========================================================
echo   [SKCT AI 자동 문제 풀이 모바일 웹앱 서버]
echo ========================================================
echo.

cd /d "%~dp0"

"C:\Users\richm\AppData\Local\Programs\Python\Python312\python.exe" server.py

pause
