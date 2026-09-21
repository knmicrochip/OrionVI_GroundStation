$env:ELECTRON_RUN_AS_NODE = $null
$root = $PSScriptRoot
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
$app = $root

if (-not (Test-Path $electron)) {
    $electron = Join-Path $root "..\openmct-tutorial\node_modules\electron\dist\electron.exe"
}

if (Test-Path $electron) {
    Start-Process -FilePath $electron -ArgumentList "`"$app`""
} else {
    Write-Error "[ERROR] Pre-bundled Electron binary not found in node_modules."
}

