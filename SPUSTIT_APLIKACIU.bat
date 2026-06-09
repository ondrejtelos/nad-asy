@echo off
setlocal
title Nadcasova praca ucitelov

set "NODE_EXE="

where node.exe >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node.exe"

if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE_EXE=C:\Program Files\nodejs\node.exe"
)

if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
)

if not defined NODE_EXE (
  echo.
  echo Aplikaciu sa nepodarilo spustit, pretoze chyba Node.js.
  echo Nainstalujte Node.js LTS z https://nodejs.org/
  echo a potom tento subor spustite znova.
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0"
start "" http://127.0.0.1:8787/
echo.
echo Aplikacia bezi na adrese http://127.0.0.1:8787/
echo Toto okno nechajte otvorene pocas pouzivania aplikacie.
echo Na ukoncenie stlacte Ctrl+C alebo zatvorte toto okno.
echo.
"%NODE_EXE%" server.js

if errorlevel 1 (
  echo.
  echo Server sa zastavil s chybou.
  pause
)
