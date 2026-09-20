@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Soymilk Job Hub - PDF import

set "PYTHONIOENCODING=utf-8"
set "PY=C:\Python313\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" sync_pdf.py --menu

echo.
pause
