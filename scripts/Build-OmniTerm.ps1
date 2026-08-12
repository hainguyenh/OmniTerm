[CmdletBinding()]
param(
  [switch]$Dev
)

$ErrorActionPreference = 'Stop'
# Portable and plugin packaging is shared with .github/workflows/build-release.yml so the package a
# release ships is byte-for-byte the one this wizard builds.
. (Join-Path $PSScriptRoot 'ReleasePackaging.ps1')
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Artifacts = Join-Path $RepoRoot 'artifacts'
$Stage = Join-Path $RepoRoot '.omniterm-build'
$FullPlugin = Join-Path $RepoRoot 'plugins\full-connection-manager'
$LimitedPlugin = Join-Path $RepoRoot 'plugins\native-batch-connections'
$AlwaysAwakePlugin = Join-Path $RepoRoot 'plugins\always-awake'
$BlurPlugin = Join-Path $RepoRoot 'plugins\blur'

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

function Select-Plugin {
  Write-Host '    1. Full Remote Suite (metadata only; never stores passwords)'
  Write-Host '    2. Limited Connections (OS launch scripts; never stores passwords)'
  Write-Host '    3. Always Awake (Windows sleep prevention)'
  Write-Host '    4. Blur (inactive-window privacy filter)'
  do { $choice = Read-Host '  Select plugin [1-4]' } until ($choice -in @('1', '2', '3', '4'))
  if ($choice -eq '1') {
    return @{ Name = 'full'; Path = $FullPlugin }
  }
  if ($choice -eq '2') {
    return @{ Name = 'limited'; Path = $LimitedPlugin }
  }
  if ($choice -eq '3') {
    return @{ Name = 'always-awake'; Path = $AlwaysAwakePlugin }
  }
  return @{ Name = 'blur'; Path = $BlurPlugin }
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

function Copy-PortableArtifacts([string]$Destination, $Plugin, [string]$Profile, [object[]]$Plugins = @()) {
  New-PortablePackage -RepoRoot $RepoRoot -Destination $Destination -BuildProfile $Profile -Plugin $Plugin -Plugins $Plugins | Out-Null
}

function Build-PluginPackage($Plugin, [string]$Destination) {
  Invoke-Step "Build $($Plugin.Name) plugin" 'pnpm' @('build:plugin', $Plugin.Path)
  New-PluginPackage -PluginPath $Plugin.Path -Destination $Destination -StageRoot $Stage -Name $Plugin.Name | Out-Null
}

Set-Location $RepoRoot
Write-Title 'OmniTerm Build Wizard'
Write-Host '    1. Build Basic App (no bundled plugin)'
Write-Host '    2. Build Plugin Package'
Write-Host '    3. Build App with Plugin'
do { $Mode = Read-Host '  Select build target [1-3]' } until ($Mode -in @('1', '2', '3'))

$Plugin = $null
if ($Mode -in @('2', '3')) { $Plugin = Select-Plugin }

$OutputFormat = $null
if ($Mode -in @('1', '3')) {
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
}
$PortablePlugins = @()
if ($OutputFormat -in @('portable', 'installer and portable')) {
  $PortablePlugins = @(Get-DefaultPortablePlugins -RepoRoot $RepoRoot)
  if ($null -ne $Plugin -and @($PortablePlugins | Where-Object { $_.Name -eq $Plugin.Name }).Count -eq 0) {
    $PortablePlugins += $Plugin
  }
}

$BuildProfile = 'release'
if ($Mode -in @('1', '3')) {
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
}

$Summary = switch ($Mode) {
  '1' { "Basic Tauri app; no plugin will be bundled. Profile: $BuildProfile. Output: $OutputFormat." }
  '2' { "Plugin package only: $($Plugin.Name)." }
  '3' { "Tauri app bundled with exactly one plugin: $($Plugin.Name). Profile: $BuildProfile. Output: $OutputFormat." }
}
Write-Title 'Build Summary'
Write-Host "  $Summary"
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

New-Item -ItemType Directory -Force -Path $Artifacts, $Stage | Out-Null
Invoke-Step 'Install dependencies' 'pnpm' @('install', '--frozen-lockfile=false')
Invoke-Step 'Frontend and plugin tests' 'pnpm' @('test')
Invoke-Step 'Frontend lint' 'pnpm' @('lint')
Invoke-Step 'Rust tests' 'pnpm' @('test:tauri')

if ($Mode -eq '2') {
  Build-PluginPackage $Plugin (Join-Path $Artifacts "plugins\$($Plugin.Name)")
} else {
  $configArgs = @('tauri', 'build')
  if ($BuildProfile -eq 'debug') { $configArgs += '--debug' }
  $buildRoot = Join-Path $RepoRoot "target\$BuildProfile"
  Remove-BuildTree (Join-Path $buildRoot 'plugins') $buildRoot
  $pluginsToBuild = @()
  if ($Mode -eq '3') { $pluginsToBuild += $Plugin }
  $pluginsToBuild += $PortablePlugins
  $builtPluginNames = @{}
  foreach ($pluginToBuild in $pluginsToBuild) {
    if ($builtPluginNames.ContainsKey($pluginToBuild.Name)) { continue }
    Invoke-Step "Build $($pluginToBuild.Name) plugin" 'pnpm' @('build:plugin', $pluginToBuild.Path)
    $builtPluginNames[$pluginToBuild.Name] = $true
  }
  if ($Mode -eq '3') {
    $pluginsStageRoot = Join-Path $Stage 'plugins'
    Remove-BuildTree $pluginsStageRoot $Stage
    $pluginStage = Join-Path $Stage "plugins\$($Plugin.Name)"
    New-Item -ItemType Directory -Force -Path $pluginStage | Out-Null
    Copy-Item (Join-Path $Plugin.Path 'package.json') $pluginStage
    Copy-Item (Join-Path $Plugin.Path 'dist') $pluginStage -Recurse
    $pluginResourceRoot = "../.omniterm-build/plugins/$($Plugin.Name)"
    $config = @{
      bundle = @{
        resources = @{
          'builtinThemes/*' = 'builtinThemes/'
          'sidecar/*.cjs' = 'sidecar/'
          "$pluginResourceRoot/package.json" = "plugins/$($Plugin.Name)/package.json"
          "$pluginResourceRoot/dist/*" = "plugins/$($Plugin.Name)/dist/"
        }
      }
    }
    $configPath = Join-Path $Stage 'tauri.bundle-plugin.json'
    $config | ConvertTo-Json -Depth 8 | Set-Content $configPath
    $configArgs += @('--config', $configPath)
  }
  if ($OutputFormat -eq 'portable') {
    $configArgs += '--no-bundle'
  }
  $buildLabel = if ($OutputFormat -eq 'portable') {
    if ($BuildProfile -eq 'debug') { 'Build portable development Tauri app' } else { 'Build portable Tauri app' }
  } elseif ($BuildProfile -eq 'debug') {
    'Build development Tauri app with Trace logging'
  } else {
    'Build Tauri app'
  }
  Invoke-Step $buildLabel 'pnpm' $configArgs
  $artifactPrefix = if ($BuildProfile -eq 'debug') { 'debug-' } else { '' }
  $destination = if ($Mode -eq '1') {
    Join-Path $Artifacts "${artifactPrefix}basic"
  } else {
    Join-Path $Artifacts "${artifactPrefix}app-with-$($Plugin.Name)"
  }
  Initialize-AppArtifacts $destination
  if ($OutputFormat -in @('installer', 'installer and portable')) {
    Copy-BundleArtifacts $destination $BuildProfile
  }
  if ($OutputFormat -in @('portable', 'installer and portable')) {
    Copy-PortableArtifacts $destination $null $BuildProfile $PortablePlugins
  }
}

Write-Title 'Build Complete'
Write-Host "  Artifacts: $Artifacts" -ForegroundColor Green
# Start-Process explorer.exe -ArgumentList $Artifacts
