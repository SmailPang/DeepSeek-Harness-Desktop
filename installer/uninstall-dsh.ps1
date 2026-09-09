# Removes the globally installed dsh CLI during uninstallation.
# Best effort: never blocks uninstallation. Exit codes: 0 ok, 30 failure.
$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$logPath = Join-Path $env:TEMP "dsh-desktop-setup.log"
try { Start-Transcript -Path $logPath -Append | Out-Null } catch {}

function Find-Command($name) {
  $found = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  return $null
}

$dsh = Join-Path (Join-Path $env:APPDATA "npm") "dsh.cmd"
if (-not (Test-Path $dsh)) {
  Write-Host "Global dsh not found, nothing to remove."
  try { Stop-Transcript | Out-Null } catch {}
  exit 0
}

$npm = Find-Command "npm.cmd"
if (-not $npm) { $npm = Find-Command "npm" }
if (-not $npm) {
  $candidate = Join-Path ${env:ProgramFiles} "nodejs\npm.cmd"
  if (Test-Path $candidate) { $npm = $candidate }
}
if (-not (Test-Path $npm)) {
  Write-Host "npm not found; cannot remove global dsh automatically."
  try { Stop-Transcript | Out-Null } catch {}
  exit 30
}

Write-Host "==> Uninstalling global @deepseek-ai/dsh ..."
& $npm uninstall -g "@deepseek-ai/dsh" --registry=https://registry.npmmirror.com 2>&1 | ForEach-Object { Write-Host $_ }
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "npmmirror failed, retrying with official npm registry ..."
  & $npm uninstall -g "@deepseek-ai/dsh" 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
}

if ($code -ne 0) {
  Write-Host "Failed to uninstall global dsh. See log: $logPath"
  try { Stop-Transcript | Out-Null } catch {}
  exit 30
}

Write-Host "Global dsh removed."
try { Stop-Transcript | Out-Null } catch {}
exit 0
