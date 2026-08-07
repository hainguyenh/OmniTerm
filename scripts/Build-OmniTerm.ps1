[CmdletBinding()]
param(
  [switch]$Dev
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Artifacts = Join-Path $RepoRoot 'artifacts'
$Stage = Join-Path $RepoRoot '.omniterm-build'
$FullPlugin = Join-Path $RepoRoot 'plugins\full-connection-manager'
$LimitedPlugin = Join-Path $RepoRoot 'plugins\native-batch-connections'
$AlwaysAwakePlugin = Join-Path $RepoRoot 'plugins\always-awake'

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

function Remove-BuildTree([string]$Target, [string]$AllowedRoot) {
  $targetFull = [IO.Path]::GetFullPath($Target)
  $rootFull = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $targetFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove '$targetFull' because it is outside '$rootFull'."
  }
  if (Test-Path -LiteralPath $targetFull) {
    Remove-Item -LiteralPath $targetFull -Recurse -Force
  }
}

function Select-Plugin {
  Write-Host '    1. Full Remote Suite (metadata only; never stores passwords)'
  Write-Host '    2. Limited Connections (OS launch scripts; never stores passwords)'
  Write-Host '    3. Always Awake (Windows sleep prevention)'
  do { $choice = Read-Host '  Select plugin [1-3]' } until ($choice -in @('1', '2', '3'))
  if ($choice -eq '1') {
    return @{ Name = 'full'; Path = $FullPlugin }
  }
  if ($choice -eq '2') {
    return @{ Name = 'limited'; Path = $LimitedPlugin }
  }
  return @{ Name = 'always-awake'; Path = $AlwaysAwakePlugin }
}

function Copy-BundleArtifacts([string]$Destination, [string]$Profile) {
  $bundle = Join-Path $RepoRoot "src-tauri\target\$Profile\bundle"
  if (-not (Test-Path $bundle)) { throw "Tauri did not create $bundle." }
  Copy-Item -Path (Join-Path $bundle '*') -Destination $Destination -Recurse -Force
}

function Initialize-AppArtifacts([string]$Destination) {
  Remove-BuildTree $Destination $Artifacts
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
}

function Copy-PortableArtifacts([string]$Destination, $Plugin, [string]$Profile) {
  $buildRoot = Join-Path $RepoRoot "src-tauri\target\$Profile"
  $executable = Join-Path $buildRoot 'omniterm.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Tauri did not create $executable."
  }

  $portable = Join-Path $Destination 'portable'
  New-Item -ItemType Directory -Force -Path $portable | Out-Null
  Copy-Item -LiteralPath $executable -Destination (Join-Path $portable 'OmniTerm.exe') -Force

  foreach ($resourceName in @('builtinThemes', 'sidecar')) {
    $resource = Join-Path $buildRoot $resourceName
    if (-not (Test-Path -LiteralPath $resource -PathType Container)) {
      $resource = Join-Path $RepoRoot "src-tauri\$resourceName"
      if (-not (Test-Path -LiteralPath $resource -PathType Container)) {
        throw "Could not find resource directory $resourceName."
      }
    }
    Copy-Item -LiteralPath $resource -Destination $portable -Recurse -Force
  }

  if ($null -ne $Plugin) {
    # Copy from the selected staging source, not target/release/plugins. That release directory may
    # contain resources from an earlier build and Tauri flattens glob destinations, which made a
    # Limited portable package indistinguishable from Basic or from the previously built variant.
    $pluginTarget = Join-Path $portable "plugins\$($Plugin.Name)"
    New-Item -ItemType Directory -Force -Path $pluginTarget | Out-Null
    Copy-Item -LiteralPath (Join-Path $Plugin.Path 'package.json') -Destination $pluginTarget -Force
    Copy-Item -LiteralPath (Join-Path $Plugin.Path 'dist') -Destination $pluginTarget -Recurse -Force
  }

  @'
OmniTerm portable package

Run OmniTerm.exe directly; no installer is required. Keep the executable and its
resource folders together. Microsoft Edge WebView2 Runtime is still required.

This is an install-free build, not a zero-footprint build. OmniTerm continues to
store settings and application data in the normal Windows user profile.
'@ | Set-Content -LiteralPath (Join-Path $portable 'README-PORTABLE.txt') -Encoding UTF8

  $archive = Join-Path $Destination 'OmniTerm-portable.zip'
  Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $archive -Force
  (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash |
    Set-Content -LiteralPath "$archive.sha256" -Encoding ASCII

  $manifests = @(Get-ChildItem (Join-Path $portable 'plugins') -Filter package.json -Recurse -ErrorAction SilentlyContinue)
  if ($null -eq $Plugin) {
    if ($manifests.Count -ne 0) { throw 'Basic portable package unexpectedly contains a plugin.' }
  } else {
    $expected = (Get-Content (Join-Path $Plugin.Path 'package.json') -Raw | ConvertFrom-Json).name
    if ($manifests.Count -ne 1) {
      throw "Portable package must contain exactly one plugin; found $($manifests.Count)."
    }
    $actual = (Get-Content $manifests[0].FullName -Raw | ConvertFrom-Json).name
    if ($actual -ne $expected) {
      throw "Portable package contains '$actual' instead of '$expected'."
    }
    Write-Host "  [OK] Portable contains exactly $expected" -ForegroundColor Green
  }
}

function Build-PluginPackage($Plugin, [string]$Destination) {
  Invoke-Step "Build $($Plugin.Name) plugin" 'pnpm' @('build:plugin', $Plugin.Path)
  $package = Get-Content (Join-Path $Plugin.Path 'package.json') -Raw | ConvertFrom-Json
  $temp = Join-Path $Stage ('package-' + $Plugin.Name)
  Remove-BuildTree $temp $Stage
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Copy-Item (Join-Path $Plugin.Path 'package.json') $temp
  Copy-Item (Join-Path $Plugin.Path 'README.md') $temp
  Copy-Item (Join-Path $Plugin.Path 'dist') $temp -Recurse
  Remove-BuildTree $Destination $Artifacts
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $zip = Join-Path $Destination "$($Plugin.Name)-$($package.version).zip"
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $zip
  (Get-FileHash $zip -Algorithm SHA256).Hash | Set-Content "$zip.sha256"
  Copy-Item (Join-Path $Plugin.Path 'package.json') (Join-Path $Destination 'manifest.json') -Force
  Copy-Item (Join-Path $Plugin.Path 'README.md') (Join-Path $Destination 'README.md') -Force
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
  $buildRoot = Join-Path $RepoRoot "src-tauri\target\$BuildProfile"
  Remove-BuildTree (Join-Path $buildRoot 'plugins') $buildRoot
  if ($Mode -eq '3') {
    Invoke-Step "Build $($Plugin.Name) plugin" 'pnpm' @('build:plugin', $Plugin.Path)
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
    Copy-PortableArtifacts $destination $(if ($Mode -eq '3') { $Plugin } else { $null }) $BuildProfile
  }
}

Write-Title 'Build Complete'
Write-Host "  Artifacts: $Artifacts" -ForegroundColor Green
# Start-Process explorer.exe -ArgumentList $Artifacts
