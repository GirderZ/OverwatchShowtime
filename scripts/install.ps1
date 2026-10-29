# Installs an official release for the current Windows user. No administrator rights required.
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string]$Repository = 'GirderDog/OverwatchShowtime',
    [ValidatePattern('^v\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\OverwatchShowtime'),
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management') -ErrorAction Stop
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Windows x64 is required.' }
if ($InstallDir.Contains('"') -or $InstallDir.Contains("`n") -or $InstallDir.Contains("`r")) { throw 'Invalid installation path.' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'OverwatchShowtime-Installer'; Accept = 'application/vnd.github+json' }
$endpoint = if ($Version) { "tags/$Version" } else { 'latest' }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/$endpoint" -Headers $headers
if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v\d+\.\d+\.\d+$') { throw 'A published stable release is required.' }
$assetName = 'OverwatchShowtime-{0}-Setup-x64.exe' -f $release.tag_name.Substring(1)
$asset = @($release.assets | Where-Object { $_.name -eq $assetName })
$checksums = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' })
if ($asset.Count -ne 1 -or $checksums.Count -ne 1) { throw 'Release installer or checksums are missing.' }
$downloadPrefix = "https://github.com/$Repository/releases/download/$($release.tag_name)/"
foreach ($item in @($asset[0], $checksums[0])) {
    if (-not $item.browser_download_url.StartsWith($downloadPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected download source.' }
}
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('OverwatchShowtime-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
    $installer = Join-Path $tempDir $assetName
    $sumFile = Join-Path $tempDir 'SHA256SUMS.txt'
    Invoke-WebRequest -UseBasicParsing -Uri $checksums[0].browser_download_url -OutFile $sumFile -Headers $headers
    $pattern = '^([a-fA-F0-9]{64})  ' + [regex]::Escape($assetName) + '$'
    $matchesFound = @(Get-Content -LiteralPath $sumFile | Where-Object { $_ -match $pattern })
    if ($matchesFound.Count -ne 1) { throw 'Installer checksum not found.' }
    $expected = $matchesFound[0].Substring(0, 64)
    Invoke-WebRequest -UseBasicParsing -Uri $asset[0].browser_download_url -OutFile $installer -Headers $headers
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $expected) { throw 'Installer checksum mismatch; installation cancelled.' }
    # NSIS requires /D to be last and its path to be unquoted, including when it contains spaces.
    $process = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$InstallDir" -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -notin @(0, 3010)) { throw "Installer failed with exit code $($process.ExitCode)" }
    $executable = Join-Path $InstallDir 'OverwatchTime.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Installed application was not found.' }
    Write-Output "Installed $($release.tag_name): $executable"
    if ($Launch) { Start-Process -FilePath $executable }
} finally {
    # Only remove the uniquely created staging directory under the system temp directory.
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedTemp = [IO.Path]::GetFullPath($tempDir)
    if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemp) -match '^OverwatchShowtime-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
