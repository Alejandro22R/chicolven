@echo off
REM Inicia el servidor de Chicolven Vitrina (Windows).
REM Para autoarranque: cree un acceso directo a este archivo en shell:startup
REM o instálelo como servicio con NSSM (ver README).
cd /d "%~dp0.."
title Chicolven Vitrina
if not exist "apps\server\dist\server.mjs" (
  echo Compilando por primera vez...
  call npm run build || goto :error
)
:loop
node apps\server\dist\server.mjs
echo El servidor se detuvo. Reiniciando en 5 segundos...
timeout /t 5 /nobreak >nul
goto loop
:error
echo No se pudo compilar. Ejecute "npm install" primero.
pause
