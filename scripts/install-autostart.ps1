# 보건실 서버를 PC 부팅 시 자동으로 켜지게 등록합니다.
# 관리자 권한 PowerShell에서 저장소 폴더로 이동한 뒤 실행하세요.
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# 등록을 지우려면:
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
param(
  [switch]$Remove,
  [int]$Port = 8080,
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
if (-not $node) { throw "Node.js를 찾지 못했습니다. https://nodejs.org 에서 24 LTS를 먼저 설치해 주세요." }

$version = (& $node --version)
if ($version -notmatch '^v(2[4-9]|[3-9]\d)\.') { throw "Node.js 24 이상이 필요합니다. 지금 설치된 버전: $version" }
if (-not (Test-Path (Join-Path $root "dist"))) {
  throw "화면 파일(dist)이 없습니다. 먼저 이 폴더에서 npm ci; npm run build 를 실행해 주세요."
}

$action = New-ScheduledTaskAction -Execute $node `
  -Argument "--no-warnings=ExperimentalWarning server\index.js" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "자동 시작을 등록했습니다: $TaskName"
Write-Host "지금 바로 시작하려면: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "방화벽 규칙도 아직 없다면 아래를 한 번 실행해 주세요:"
Write-Host "  New-NetFirewallRule -DisplayName '건강진료센터 접수' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow -Profile Private"
