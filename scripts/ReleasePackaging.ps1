# Packaging shared by the local build wizard and the release workflow.
#
# Dot-source it:  . "$PSScriptRoot\ReleasePackaging.ps1"
#
# These two packages used to exist only inside Build-OmniTerm.ps1, which is interactive and so cannot
# run in CI. Copying the logic into the workflow would have left two definitions of what a portable
# package contains, and the one CI publishes is the one nobody runs locally — so the definition lives
# here and both callers share it.

function Remove-BuildTree {
  param(
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string]$AllowedRoot
  )
  $targetFull = [IO.Path]::GetFullPath($Target)
  $rootFull = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $targetFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove '$targetFull' because it is outside '$rootFull'."
  }
  if (Test-Path -LiteralPath $targetFull) {
    Remove-Item -LiteralPath $targetFull -Recurse -Force
  }
}

function Write-Sha256Sidecar {
  param([Parameter(Mandatory)][string]$Path)
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash |
    Set-Content -LiteralPath "$Path.sha256" -Encoding ASCII
}

<#
.SYNOPSIS
Assemble the install-free package: the executable, its resource folders, and optionally one plugin.

.DESCRIPTION
Emits <Destination>\<ArchiveName> plus a .sha256 sidecar, staged through <Destination>\portable.
Returns the archive path.
#>
function New-PortablePackage {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$Destination,
    [string]$BuildProfile = 'release',
    [string]$ArchiveName = 'OmniTerm-portable.zip',
    $Plugin = $null
  )

  $buildRoot = Join-Path $RepoRoot "target\$BuildProfile"
  $executable = Join-Path $buildRoot 'omniterm.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Tauri did not create $executable."
  }

  $portable = Join-Path $Destination 'portable'
  Remove-BuildTree $portable $Destination
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

  $archive = Join-Path $Destination $ArchiveName
  Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $archive -Force
  Write-Sha256Sidecar $archive

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

  return $archive
}

<#
.SYNOPSIS
Zip one already-built plugin into a package the host can install.

.DESCRIPTION
Requires <PluginPath>\dist to exist — build it first with `pnpm build:plugin <PluginPath>`. Emits
<Destination>\<dirname>-<version>.zip with a .sha256 sidecar, alongside the manifest and README so
the release page can describe the plugin without unpacking it. Returns the archive path.
#>
function New-PluginPackage {
  param(
    [Parameter(Mandatory)][string]$PluginPath,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$StageRoot,
    # The wizard's short label ('full') rather than the directory ('full-connection-manager'), so the
    # archive keeps the name it has always had.
    [string]$Name = (Split-Path -Leaf $PluginPath)
  )

  $dist = Join-Path $PluginPath 'dist'
  if (-not (Test-Path -LiteralPath $dist -PathType Container)) {
    throw "Plugin at $PluginPath has no dist/. Run 'pnpm build:plugin $PluginPath' first."
  }

  $package = Get-Content (Join-Path $PluginPath 'package.json') -Raw | ConvertFrom-Json

  $temp = Join-Path $StageRoot ('package-' + $Name)
  Remove-BuildTree $temp $StageRoot
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Copy-Item (Join-Path $PluginPath 'package.json') $temp
  Copy-Item (Join-Path $PluginPath 'README.md') $temp
  Copy-Item $dist $temp -Recurse

  Remove-BuildTree $Destination (Split-Path -Parent $Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  $archive = Join-Path $Destination "$Name-$($package.version).zip"
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $archive
  Write-Sha256Sidecar $archive

  Copy-Item (Join-Path $PluginPath 'package.json') (Join-Path $Destination 'manifest.json') -Force
  Copy-Item (Join-Path $PluginPath 'README.md') (Join-Path $Destination 'README.md') -Force

  return $archive
}
