@echo off
REM Abre una pantalla (TV) en modo kiosko a pantalla completa.
REM Uso: kiosko.bat <numero_de_pantalla> [posicion_x]
REM   kiosko.bat 1            -> TV 1 en el monitor principal
REM   kiosko.bat 2 1920       -> TV 2 en el segundo monitor (a la derecha, 1920 px)
REM Usa Microsoft Edge (incluido en Windows). Cambie BROWSER si prefiere Chrome.
setlocal
set SCREEN=%1
if "%SCREEN%"=="" set SCREEN=1
set POSX=%2
if "%POSX%"=="" set POSX=0
set SERVER=http://localhost:3000
set BROWSER="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %BROWSER% set BROWSER="C:\Program Files\Google\Chrome\Application\chrome.exe"
REM Cada pantalla necesita su propio perfil para poder abrir varias ventanas en kiosko.
start "" %BROWSER% --kiosk "%SERVER%/tv/%SCREEN%" --edge-kiosk-type=fullscreen ^
  --user-data-dir="%LOCALAPPDATA%\ChicolvenKiosko\tv%SCREEN%" ^
  --window-position=%POSX%,0 --no-first-run --disable-extensions --disable-translate ^
  --disable-features=Translate --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble
