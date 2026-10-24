@echo off
rem Enciende la Biblioteca PDF con doble clic (lo mismo que "npm start" en esta carpeta).
rem La primera vez instala las dependencias y prepara pdf2json. Cierra la ventana para apagarla.
chcp 65001 >nul
cd /d "%~dp0"
title Biblioteca PDF
if not defined PUERTO set PUERTO=8780
curl -s -o nul --max-time 2 http://127.0.0.1:%PUERTO%/icono.svg && (echo La Biblioteca PDF ya estaba encendida en http://localhost:%PUERTO%/ & timeout /t 5 >nul & exit /b 0)
where node >nul 2>nul || (echo No se encontró Node.js. Instálalo desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b 1)
if not exist node_modules (echo Primera vez: instalando dependencias... & call npm install || (pause & exit /b 1))
if not exist vendor\pdf2json (echo Primera vez: preparando pdf2json... & call npm run preparar || (pause & exit /b 1))
echo.
echo Biblioteca PDF encendida en http://localhost:%PUERTO%/
echo El Atlas y la landing ya pueden convertir PDF. Cierra esta ventana para apagarla.
echo.
node src/servidor.js
pause
