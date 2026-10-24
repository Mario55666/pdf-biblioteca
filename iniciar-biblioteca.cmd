@echo off
rem Enciende la Biblioteca PDF con doble clic (lo mismo que "npm start" en esta carpeta).
rem La primera vez instala las dependencias y prepara pdf2json. Cierra la ventana para apagarla.
chcp 65001 >nul
cd /d "%~dp0"
title Biblioteca PDF
where node >nul 2>nul || (echo No se encontró Node.js. Instálalo desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b 1)
if not exist node_modules (echo Primera vez: instalando dependencias... & call npm install || (pause & exit /b 1))
if not exist vendor\pdf2json (echo Primera vez: preparando pdf2json... & call npm run preparar || (pause & exit /b 1))
echo.
echo Biblioteca PDF encendida en http://localhost:8780/
echo El Atlas y la landing ya pueden convertir PDF. Cierra esta ventana para apagarla.
echo.
node src/servidor.js
pause
