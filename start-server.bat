@echo off
title selectphoto Server (http://127.0.0.1:5500)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\server.ps1"
pause
