@echo off
chcp 65001 > nul
title SKCT AI Auto Solver Server v2.0
echo ========================================================
echo   [SKCT AI 초고속 문제 풀이 모바일 웹앱 v2.0 서버]
echo ========================================================
echo.

cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python server.py
) else (
    echo [오류] Python이 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
    pause
)

pause
