$ErrorActionPreference = 'Stop'
$requestedPort = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$port = $requestedPort
$model = if ($env:OPENROUTER_MODEL) { $env:OPENROUTER_MODEL } else { 'qwen/qwen3.8-27b:free' }
$modelCandidates = @(
  $model,
  'nex-agi/nex-n2.5-mini:free',
  'liquid/lfm-2.5-2.6b:free'
) | Select-Object -Unique
$apiKey = $env:OPENROUTER_API_KEY

# Las claves de OpenRouter son ASCII; elimina saltos de linea o caracteres invisibles pegados accidentalmente.
$apiKey = (($apiKey -replace '[^\x20-\x7E]', '')).Trim()
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw 'Falta OPENROUTER_API_KEY. Copia la key y ejecuta: $env:OPENROUTER_API_KEY = (Get-Clipboard).Trim()'
}
if ($apiKey -notmatch '^sk-or-v1-') {
  throw 'La OPENROUTER_API_KEY no parece valida. Copia la key completa desde OpenRouter.'
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = $null
$maxPort = $requestedPort + 10
for ($candidatePort = $requestedPort; $candidatePort -le $maxPort; $candidatePort++) {
  $candidateListener = New-Object System.Net.HttpListener
  $candidateListener.Prefixes.Add("http://127.0.0.1:$candidatePort/")
  try {
    $candidateListener.Start()
    $listener = $candidateListener
    $port = $candidatePort
    break
  } catch [System.Net.HttpListenerException] {
    $candidateListener.Close()
  }
}

if (-not $listener) {
  throw "No hay ningún puerto disponible entre $requestedPort y $maxPort."
}

function Send-Json($context, $status, $body) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  $context.Response.StatusCode = $status
  $context.Response.ContentType = 'application/json; charset=utf-8'
  $context.Response.ContentEncoding = [Text.Encoding]::UTF8
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

function Send-File($context) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $root 'index.html'))
  $context.Response.StatusCode = 200
  $context.Response.ContentType = 'text/html; charset=utf-8'
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

Write-Host "rebrandyourbrand disponible en http://127.0.0.1:$port"
Write-Host "Modelo OpenRouter: $model"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.AbsolutePath
      if ($context.Request.HttpMethod -eq 'GET' -and $path -eq '/api/brand-assistant/status') {
        Send-Json $context 200 @{ ready = [bool]$apiKey; model = $model }
        continue
      }

      if ($context.Request.HttpMethod -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
        Send-File $context
        continue
      }

      if ($context.Request.HttpMethod -ne 'POST' -or $path -ne '/api/brand-assistant') {
        Send-Json $context 404 @{ error = 'Ruta no encontrada.' }
        continue
      }

      if (-not $apiKey) {
        Send-Json $context 503 @{ error = 'Falta OPENROUTER_API_KEY en el servidor.' }
        continue
      }

      $reader = New-Object IO.StreamReader($context.Request.InputStream)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $prompt = [string]$payload.prompt
      if ([string]::IsNullOrWhiteSpace($prompt)) {
        Send-Json $context 400 @{ error = 'Escribe una pregunta.' }
        continue
      }

      $messages = @(
        @{ role = 'system'; content = 'Eres el asistente de rebrandyourbrand, un estudio de rebranding y diseno visual. La marca ayuda a empresas a construir identidades visuales, packaging, direccion de arte y sistemas de marca claros, tecnicos y con criterio artistico. Responde en espanol, con acentos correctos, de forma breve y concreta. Si te preguntan de que trata rebrandyourbrand, explica este contexto y no lo confundas con una plataforma generica de marketing. No inventes servicios que no esten descritos aqui.' },
        @{ role = 'user'; content = $prompt.Trim() }
      )
      $headers = @{
        Authorization = "Bearer $apiKey"
        'HTTP-Referer' = "http://localhost:$port"
        'X-Title' = 'rebrandyourbrand'
      }
      $answered = $false
      $lastError = 'Todos los modelos gratuitos estan temporalmente ocupados.'
      foreach ($candidate in $modelCandidates) {
        try {
          $requestBody = @{ model = $candidate; messages = $messages; temperature = 0.7 } | ConvertTo-Json -Depth 5
          $result = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/chat/completions' -Method Post -Headers $headers -ContentType 'application/json' -Body $requestBody -TimeoutSec 60
          Send-Json $context 200 @{ response = [string]$result.choices[0].message.content; model = $candidate }
          $answered = $true
          break
        } catch {
          $lastError = $_.Exception.Message
          $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
          if ($statusCode -notin @(408, 429, 500, 502, 503, 504)) { break }
        }
      }
      if (-not $answered) {
        Send-Json $context 502 @{ error = "OpenRouter: $lastError" }
      }
    } catch {
      if ($context.Response.OutputStream.CanWrite) {
        $message = $_.Exception.Message
        Send-Json $context 502 @{ error = "OpenRouter: $message" }
      }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
