[CmdletBinding()]
param(
  [switch]$Dev
)

$ErrorActionPreference = 'Stop'
# Portable packaging is shared with .github/workflows/build-release.yml so the package a release
# ships is byte-for-byte the one this wizard builds.
. (Join-Path $PSScriptRoot 'ReleasePackaging.ps1')
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Artifacts = Join-Path $RepoRoot 'artifacts'

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host ('  ' + $Text) -ForegroundColor Cyan
  Write-Host ('  ' + ('-' * $Text.Length)) -ForegroundColor DarkCyan
}

function Require-Tool([string]$Name, [string]$Install) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. Install it from $Install and run this wizard again."
  }
  Write-Host "  [OK] $Name" -ForegroundColor Green
}

function Invoke-Step([string]$Label, [string]$File, [string[]]$Arguments) {
  Write-Host "`n  > $Label" -ForegroundColor Yellow
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Copy-BundleArtifacts([string]$Destination, [string]$Profile) {
  $bundle = Join-Path $RepoRoot "target\$Profile\bundle"
  if (-not (Test-Path $bundle)) { throw "Tauri did not create $bundle." }
  Copy-Item -Path (Join-Path $bundle '*') -Destination $Destination -Recurse -Force
}

function Initialize-AppArtifacts([string]$Destination) {
  Remove-BuildTree $Destination $Artifacts
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
}

Set-Location $RepoRoot
Write-Title 'OmniTerm Build Wizard'
Write-Host '  Builds the OmniTerm app. Agent Quota and Always Awake are built in, and the built-in IDE'
Write-Host '  plugins (src-tauri/builtin-plugins) are bundled as app resources.'
Write-Host ''
Write-Host '    1. Installer'
Write-Host '    2. Portable (no installer)'
Write-Host '    3. Installer and Portable'
do { $outputChoice = Read-Host '  Select output format [1-3]' } until ($outputChoice -in @('1', '2', '3'))
$OutputFormat = @{
  '1' = 'installer'
  '2' = 'portable'
  '3' = 'installer and portable'
}[$outputChoice]

if ($Dev) {
  $BuildProfile = 'debug'
  Write-Host '  Development build selected by -Dev: debug assertions and Trace logging enabled.' -ForegroundColor DarkYellow
} else {
  Write-Host ''
  Write-Host '    1. Release (production)'
  Write-Host '    2. Development (debug + full Trace logging)'
  do { $profileChoice = Read-Host '  Select build profile [1-2]' } until ($profileChoice -in @('1', '2'))
  $BuildProfile = if ($profileChoice -eq '2') { 'debug' } else { 'release' }
}

Write-Title 'Build Summary'
Write-Host "  OmniTerm Tauri app. Profile: $BuildProfile. Output: $OutputFormat."
Write-Host ''
Write-Host '    1. Run Build'
Write-Host '    0. Cancel'
if ((Read-Host '  Select [0-1]') -ne '1') { Write-Host 'Cancelled.'; exit 0 }

Write-Title 'Prerequisites'
Require-Tool 'node' 'https://nodejs.org/'
Require-Tool 'pnpm' 'https://pnpm.io/installation'
Require-Tool 'cargo' 'https://rustup.rs/'
if (-not (Get-Command 'cl.exe' -ErrorAction SilentlyContinue)) {
  Write-Host '  [INFO] MSVC is not on PATH. If packaging fails, install "Desktop development with C++":' -ForegroundColor DarkYellow
  Write-Host '         https://visualstudio.microsoft.com/visual-cpp-build-tools/' -ForegroundColor DarkYellow
}
$WebView2 = Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients' -ErrorAction SilentlyContinue |
  Get-ItemProperty -ErrorAction SilentlyContinue |
  Where-Object { $_.name -like '*WebView2*' } |
  Select-Object -First 1
if (-not $WebView2) {
  Write-Host '  [INFO] WebView2 was not detected. Install the Evergreen Runtime if Tauri requests it:' -ForegroundColor DarkYellow
  Write-Host '         https://developer.microsoft.com/microsoft-edge/webview2/' -ForegroundColor DarkYellow
}

New-Item -ItemType Directory -Force -Path $Artifacts | Out-Null
Invoke-Step 'Install dependencies' 'pnpm' @('install', '--frozen-lockfile=false')
Invoke-Step 'Frontend tests' 'pnpm' @('test')
Invoke-Step 'Frontend lint' 'pnpm' @('lint')
Invoke-Step 'Rust tests' 'pnpm' @('test:tauri')

# tauri:build stages the built-in IDE plugins before `tauri build`, so the bundle and the portable
# package both carry the current src-tauri/builtin-plugins.
$buildArgs = @('tauri:build')
if ($BuildProfile -eq 'debug') { $buildArgs += '--debug' }
if ($OutputFormat -eq 'portable') { $buildArgs += '--no-bundle' }
$buildLabel = if ($OutputFormat -eq 'portable') {
  if ($BuildProfile -eq 'debug') { 'Build portable development Tauri app' } else { 'Build portable Tauri app' }
} elseif ($BuildProfile -eq 'debug') {
  'Build development Tauri app with Trace logging'
} else {
  'Build Tauri app'
}
Invoke-Step $buildLabel 'pnpm' $buildArgs

$artifactPrefix = if ($BuildProfile -eq 'debug') { 'debug-' } else { '' }
$destination = Join-Path $Artifacts "${artifactPrefix}app"
Initialize-AppArtifacts $destination
if ($OutputFormat -in @('installer', 'installer and portable')) {
  Copy-BundleArtifacts $destination $BuildProfile
}
if ($OutputFormat -in @('portable', 'installer and portable')) {
  New-PortablePackage -RepoRoot $RepoRoot -Destination $destination -BuildProfile $BuildProfile | Out-Null
}

Write-Title 'Build Complete'
Write-Host "  Artifacts: $destination" -ForegroundColor Green
