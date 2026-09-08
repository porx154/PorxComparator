@echo off
setlocal
cd /d "%~dp0"
if not defined PORT set "PORT=4317"
if not exist "node_modules" (
  echo Instalando dependencias la primera vez...
  call npm install
  if errorlevel 1 goto :error
)
call npm run build
if errorlevel 1 goto :error
start "" http://127.0.0.1:4317
echo.
echo FolderLens esta disponible en http://127.0.0.1:4317
echo Cierra esta ventana para detener la aplicacion.
echo.
call npm start
goto :eof
:error
echo.
echo No se pudo iniciar FolderLens. Revisa el mensaje anterior.
pause
