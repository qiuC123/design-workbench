param(
    [string]$BindAddress,
    [ValidateRange(1, 65535)][int]$Port = 4175,
    [switch]$RestartExisting,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

# Listen on one private interface, not every interface or a public address.
$candidates = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object {
    $_.IPv4Address.IPAddress
} | Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } | Select-Object -Unique)
if (!$BindAddress) {
    if ($candidates.Count -ne 1) {
        throw "Cannot select one LAN address. Available: $($candidates -join ', '). Run with -BindAddress <LAN-IP>."
    }
    $BindAddress = $candidates[0]
}
if ($BindAddress -notin $candidates) { throw 'BindAddress must be a private IPv4 address on a connected gateway interface.' }

$websiteUrl = "http://${BindAddress}:${Port}"
if (!(Test-Path -LiteralPath 'dist-website\index.html')) { throw 'Run npm run build:website first.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    if (@($listeners | Where-Object { $_.LocalAddress -eq $BindAddress }).Count -gt 0) {
        $health = Invoke-RestMethod -Uri "$websiteUrl/healthz" -TimeoutSec 4
        if ($health.ok -and $health.mode -eq 'website' -and $health.sharedData) {
            Write-Host "Website already running: $websiteUrl/"
            exit 0
        }
    }
    $recordPath = Join-Path $projectRoot 'work\website-lan\switch-from.json'
    if (!$RestartExisting -or !(Test-Path -LiteralPath $recordPath)) {
        throw "Port $Port is in use. Stop the existing website before starting LAN mode."
    }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $ownerIds = @($listeners.OwningProcess | Select-Object -Unique)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)"
    if ($ownerIds.Count -ne 1 -or $ownerIds[0] -ne [int]$record.pid -or !$existing -or
        $existing.CommandLine -ne $record.commandLine -or
        $existing.ExecutablePath -ne $nodePath -or
        "$($existing.CreationDate.ToUniversalTime().Ticks)" -ne "$($record.creationUtcTicks)") {
        throw 'Existing process does not match the recorded website. Nothing was stopped.'
    }
    if ($CheckOnly) { Write-Output "Validated switch of website PID $($existing.ProcessId) to $websiteUrl/"; exit 0 }
    $oldProcess = Get-Process -Id $existing.ProcessId -ErrorAction Stop
    Stop-Process -Id $oldProcess.Id -ErrorAction Stop
    if (!$oldProcess.WaitForExit(5000)) { throw 'Existing website has not stopped yet.' }
}
if ($CheckOnly) { Write-Output $websiteUrl; exit 0 }

# Process-level overrides leave .env and the existing SQLite data untouched.
$savedEnvironment = @{}
$lanEnvironment = @{
    SJ_HOST = $BindAddress
    SJ_PORT = "$Port"
    SJ_ALLOWED_ORIGINS = $websiteUrl
    SJ_COOKIE_SECURE = 'false'
    SJ_TRUST_PROXY = ''
}
try {
    foreach ($name in $lanEnvironment.Keys) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $lanEnvironment[$name], 'Process')
    }
    Write-Host "Website: $websiteUrl/"
    Write-Host 'Connect the phone/computer to the same LAN. Keep this window open.'
    Write-Host 'First account setup: read .data\setup-token.txt on this computer.'
    Write-Host 'Press Ctrl+C to stop the website.'
    & $nodePath --env-file-if-exists=.env --import tsx server/main.ts
    $websiteExitCode = $LASTEXITCODE
} finally {
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
}
exit $websiteExitCode
