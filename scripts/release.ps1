[CmdletBinding()]
param([string]$Prepackaged)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $Prepackaged) {
        & npm.cmd run build:win
        if ($LASTEXITCODE -ne 0) { throw 'Windows application packaging failed' }
        $Prepackaged = Join-Path $projectRoot 'dist\OverwatchTime-win32-x64'
    }
    $Prepackaged = (Resolve-Path -LiteralPath $Prepackaged).Path
    & node 'node_modules/electron-builder/cli.js' --win nsis --x64 --prepackaged $Prepackaged --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed' }
    $releaseDir = Join-Path $projectRoot 'release'
    $zipName = "OverwatchShowtime-$($package.version)-Windows-x64.zip"
    Compress-Archive -LiteralPath $Prepackaged -DestinationPath (Join-Path $releaseDir $zipName) -Force
    Copy-Item -LiteralPath 'scripts\install.ps1' -Destination (Join-Path $releaseDir 'install.ps1')
    $files = @(Get-ChildItem -LiteralPath $releaseDir -File | Where-Object { $_.Name -in @($zipName, "OverwatchShowtime-$($package.version)-Setup-x64.exe", 'install.ps1') })
    if ($files.Count -ne 3) { throw 'Release assets are incomplete' }
    $sums = $files | Sort-Object Name | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
    [IO.File]::WriteAllLines((Join-Path $releaseDir 'SHA256SUMS.txt'), $sums, (New-Object Text.UTF8Encoding($false)))
    Write-Output "Release $($package.version) ready: $releaseDir"
} finally { Pop-Location }
