# Post-install setup for DeepSeek Harness desktop shell installer.
# Exit codes: 0 ok, 10 node/npm missing (when install was requested),
#              11 dsh install failed, 12 plugin store failed,
#              20 optional whale plugin failed.
param(
  [int]$InstallDsh = 0,
  [int]$InstallMarket = 0,
  [int]$InstallWhale = 0
)

$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$logPath = Join-Path $env:TEMP "dsh-desktop-setup.log"
try { Start-Transcript -Path $logPath -Append | Out-Null } catch {}

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg"
}

$script:lastOutput = ""

function Invoke-Tool {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [hashtable]$Environment = @{}
  )
  $previous = @{}
  foreach ($name in $Environment.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $Environment[$name], "Process")
  }
  $lines = @()
  try {
    & $File @Arguments 2>&1 | ForEach-Object {
      $text = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
      $lines += $text
      Write-Host $text
    }
    $code = $LASTEXITCODE
  } finally {
    foreach ($name in $previous.Keys) {
      if ($null -eq $previous[$name]) {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
      } else {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
      }
    }
  }
  $script:lastOutput = ($lines -join "`n")
  return $code
}

function Find-Command($name) {
  $found = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  return $null
}

function Resolve-Npm {
  $npm = Find-Command "npm.cmd"
  if (-not $npm) { $npm = Find-Command "npm" }
  $node = Find-Command "node"
  if ((-not $node -or -not $npm)) {
    $candidate = Join-Path ${env:ProgramFiles} "nodejs\npm.cmd"
    if (Test-Path $candidate) {
      $env:Path = "$(Split-Path $candidate);$env:Path"
      $npm = $candidate
      $node = Join-Path (Split-Path $candidate) "node.exe"
    }
  }
  if (-not (Test-Path $node) -or -not (Test-Path $npm)) {
    return $null
  }
  return $npm
}

$npmGlobal = Join-Path $env:APPDATA "npm"
$dsh = Join-Path $npmGlobal "dsh.cmd"

# Plugins require the dsh CLI; if dsh is missing but a plugin was requested,
# install dsh first as a dependency even when the dsh checkbox was left off.
$needDshCli = ($InstallMarket -eq 1 -or $InstallWhale -eq 1)
$nothingToDo = ($InstallDsh -eq 0 -and -not $needDshCli)

if ($nothingToDo) {
  Write-Host "No CLI/plugin components selected; desktop shell only. Skipping post-install setup."
  try { Stop-Transcript | Out-Null } catch {}
  exit 0
}

Write-Step "Checking Node.js / npm ..."
$npm = Resolve-Npm
if (-not $npm) {
  Write-Host "Node.js / npm not found. Please install Node.js LTS first."
  try { Stop-Transcript | Out-Null } catch {}
  exit 10
}
Write-Host "npm: $npm"

$dshPresent = $false
if (Test-Path $dsh) {
  Write-Step "Detected existing dsh, verifying ..."
  $code = Invoke-Tool $dsh @("--version")
  if ($code -eq 0) { $dshPresent = $true }
}

if (-not $dshPresent) {
  Write-Step "Installing dsh via npmmirror (this may take a few minutes) ..."
  $code = Invoke-Tool $npm @("install", "-g", "@deepseek-ai/dsh", "--registry=https://registry.npmmirror.com")
  if ($code -ne 0) {
    Write-Step "npmmirror failed, retrying with official npm registry ..."
    $code = Invoke-Tool $npm @("install", "-g", "@deepseek-ai/dsh")
  }
  if ($code -ne 0 -or -not (Test-Path $dsh)) {
    Write-Host "Failed to install dsh. See log: $logPath"
    try { Stop-Transcript | Out-Null } catch {}
    exit 11
  }
  if ($env:Path -notlike "*$npmGlobal*") { $env:Path = "$npmGlobal;$env:Path" }
  Write-Host "dsh installed."
}

function Test-AlreadyInstalled {
  return ($script:lastOutput -match "already|already exists|already installed|exist|EEXIST|ERR_PNPM_ALREADY|conflict")
}

function Add-DshPlugin {
  param(
    [Parameter(Mandatory = $true)][string]$Spec,
    [hashtable]$ExtraEnvironment = @{}
  )
  $envMap = @{ "npm_config_registry" = "https://registry.npmmirror.com" }
  foreach ($key in $ExtraEnvironment.Keys) { $envMap[$key] = $ExtraEnvironment[$key] }
  $code = Invoke-Tool $dsh @("plugin", "--profile", "web", "add", $Spec) $envMap
  if ($code -ne 0 -and (Test-AlreadyInstalled)) {
    Write-Host "Plugin already present, treated as success."
    $code = 0
  }
  return $code
}

if ($InstallMarket -eq 1) {
  Write-Step "Installing plugin store: dshmarket ..."
  $code = Add-DshPlugin "dshmarket"
  if ($code -ne 0) {
    Write-Step "Retrying dshmarket with official registry ..."
    $retryEnv = @{ "npm_config_registry" = "https://registry.npmjs.org" }
    $code = Invoke-Tool $dsh @("plugin", "--profile", "web", "add", "dshmarket") $retryEnv
  }
  if ($code -ne 0) {
    Write-Host "Failed to install dshmarket. See log: $logPath"
    try { Stop-Transcript | Out-Null } catch {}
    exit 12
  }
  Write-Host "dshmarket installed."
}

if ($InstallWhale -eq 1) {
  $whaleSpec = "github:MeteorNOX/DeepSeek-Balance-Whale-Widget"
  Write-Step "Installing DeepSeek Balance Whale Widget from GitHub ..."
  $code = Add-DshPlugin $whaleSpec
  if ($code -ne 0) {
    Write-Step "GitHub failed, retrying via gh-proxy.com mirror ..."
    $gitMirrorEnv = @{
      "GIT_CONFIG_COUNT" = "1"
      "GIT_CONFIG_KEY_0" = "url.https://gh-proxy.com/https://github.com/.insteadOf"
      "GIT_CONFIG_VALUE_0" = "https://github.com/"
    }
    $code = Add-DshPlugin $whaleSpec $gitMirrorEnv
  }
  if ($code -ne 0) {
    Write-Host "Failed to install the Whale widget. See log: $logPath"
    try { Stop-Transcript | Out-Null } catch {}
    exit 20
  }
  Write-Host "Whale widget installed."
}

Write-Host ""
Write-Host "All requested components are ready."
try { Stop-Transcript | Out-Null } catch {}
exit 0
