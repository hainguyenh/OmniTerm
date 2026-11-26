# Packaging shared by the local build wizard and the release workflow.
#
# Dot-source it:  . "$PSScriptRoot\ReleasePackaging.ps1"
#
# The portable package used to exist only inside Build-OmniTerm.ps1, which is interactive and so cannot
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
Assemble the install-free package: the executable and the resource folders it loads at runtime.

.DESCRIPTION
Emits <Destination>\<ArchiveName> plus a .sha256 sidecar, staged through <Destination>\portable.
The resource folders mirror `bundle.resources` in src-tauri/tauri.conf.json: an unbundled build
resolves its resource directory next to the executable, so the portable layout must match it.
Returns the archive path.
#>
function New-PortablePackage {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$Destination,
    [string]$BuildProfile = 'release',
    [string]$ArchiveName = 'OmniTerm-portable.zip'
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

  # Copy from the source tree, not target/<profile>: the build directory may hold resources from an
  # earlier build, and the source folders are exactly what the installer bundles.
  foreach ($resourceName in @('builtinThemes', 'builtin-plugins')) {
    $resource = Join-Path $RepoRoot "src-tauri\$resourceName"
    if (-not (Test-Path -LiteralPath $resource -PathType Container)) {
      throw "Could not find resource directory $resourceName."
    }
    Copy-Item -LiteralPath $resource -Destination $portable -Recurse -Force
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

  $exeName = $ArchiveName -replace '\.zip$', '.exe'
  if ($exeName -ne $ArchiveName) {
    $portableExe = Join-Path $Destination $exeName
    Copy-Item -LiteralPath (Join-Path $portable 'OmniTerm.exe') -Destination $portableExe -Force
    Write-Sha256Sidecar $portableExe
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $entryNames = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    if ($entryNames -notcontains 'OmniTerm.exe') {
      throw "Portable archive is missing required entry 'OmniTerm.exe'."
    }
    foreach ($resourceName in @('builtinThemes', 'builtin-plugins')) {
      if (@($entryNames | Where-Object { $_.StartsWith("$resourceName/") }).Count -eq 0) {
        throw "Portable archive is missing resource folder '$resourceName'."
      }
    }
  } finally {
    $zip.Dispose()
  }

  return $archive
}
