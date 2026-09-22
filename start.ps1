<#
  start.ps1 - Lanzador local de rebrandyourbrand

  - Cierra cualquier server.ps1 anterior.
  - Fija el modelo gratuito de OpenRouter.
  - Usa OPENROUTER_API_KEY del entorno o del portapapeles.
  - No arranca el servidor si la key falta o no parece valida.
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$oldProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'server\.ps1'
}
foreach ($process in $oldProcesses) {
  Write-Host "Cerrando proceso anterior (PID $($process.ProcessId))..."
  taskkill /PID $process.ProcessId /F | Out-Null
}

$env:OPENROUTER_MODEL = 'qwen/qwen3.8-27b:free'

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
  $clipboardKey = Get-Clipboard -Raw -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace($clipboardKey)) {
    $env:OPENROUTER_API_KEY = $clipboardKey.Trim()
    Write-Host 'OPENROUTER_API_KEY tomada del portapapeles.'
  }
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
  throw 'Falta OPENROUTER_API_KEY. Copia la key y vuelve a ejecutar start.ps1.'
}

$env:OPENROUTER_API_KEY = ($env:OPENROUTER_API_KEY -replace '[^\x20-\x7E]', '').Trim()
if ($env:OPENROUTER_API_KEY -notmatch '^sk-or-v1-') {
  throw 'OPENROUTER_API_KEY no parece una key valida de OpenRouter.'
}

Write-Host 'Iniciando rebrandyourbrand con OpenRouter...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'server.ps1')
