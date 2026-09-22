# 보건실 서버 자동 시작 등록
# LAN 운영은 TLS 인증서와 개인 키가 필수입니다.
#
# LAN HTTPS 예시:
# powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -CertPath "C:\HealthCenter\certs\server.crt" -KeyPath "C:\HealthCenter\certs\server.key"
#
# 서버 PC 로컬 전용 예시:
# powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -LocalOnly
param(
  [switch]$Remove,
  [switch]$LocalOnly,
  [int]$Port = 8080,
  [string]$HostAddress = "0.0.0.0",
  [string]$CertPath = "",
  [string]$KeyPath = "",
  [string]$TaskName = "건강진료센터 접수 서버"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "자동 시작 등록을 지웠습니다: $TaskName"
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js를 찾지 못했습니다. Node.js 24 이상을 먼저 설치해 주세요." }

$version = (& $node --version)
if ($version -notmatch '^v(2[4-9]|[3-9]\d)\.') {
  throw "Node.js 24 이상이 필요합니다. 지금 설치된 버전: $version"
}
if (-not (Test-Path (Join-Path $root "dist"))) {
  throw "화면 파일(dist)이 없습니다. 먼저 이 폴더에서 npm ci; npm run build 를 실행해 주세요."
}

if ($LocalOnly) {
  $HostAddress = "127.0.0.1"
  $CertPath = ""
  $KeyPath = ""
} else {
  if (-not $CertPath -or -not $KeyPath) {
    throw "LAN 자동 시작에는 -CertPath와 -KeyPath가 모두 필요합니다. 로컬 전용이면 -LocalOnly를 사용하세요."
  }
  if (-not (Test-Path $CertPath)) { throw "TLS 인증서 파일을 찾을 수 없습니다: $CertPath" }
  if (-not (Test-Path $KeyPath)) { throw "TLS 개인 키 파일을 찾을 수 없습니다: $KeyPath" }
}

$envParts = @(
  "`$env:HC_HOST='$HostAddress'",
  "`$env:HC_PORT='$Port'"
)
if (-not $LocalOnly) {
  $escapedCert = $CertPath.Replace("'", "''")
  $escapedKey = $KeyPath.Replace("'", "''")
  $envParts += "`$env:HC_TLS_CERT='$escapedCert'"
  $envParts += "`$env:HC_TLS_KEY='$escapedKey'"
}
$envCommand = ($envParts -join "; ")
$serverCommand = "& '$node' --no-warnings=ExperimentalWarning server\index.js"
$command = "$envCommand; Set-Location '$root'; $serverCommand"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$command`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "자동 시작을 등록했습니다: $TaskName"
Write-Host "지금 바로 시작하려면: Start-ScheduledTask -TaskName '$TaskName'"
if (-not $LocalOnly) {
  Write-Host "HTTPS LAN 모드로 등록했습니다. 인증서와 개인 키 경로도 작업에 포함되었습니다."
}
