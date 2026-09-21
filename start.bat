@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=

if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" "."
) else if exist "..\openmct-tutorial\node_modules\electron\dist\electron.exe" (
    start "" "..\openmct-tutorial\node_modules\electron\dist\electron.exe" "."
) else (
    echo [ERROR] Pre-bundled Electron binary not found in node_modules.
    pause
)

