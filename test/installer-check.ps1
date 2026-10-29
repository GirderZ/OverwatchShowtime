$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ow-installer-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$global:owTestScenario = 'success'
$global:owTestStarted = 0
$global:owTestTarget = Join-Path $testRoot 'installed app'
function Invoke-RestMethod {
    param($Uri, $Headers)
    $base = 'https://github.com/GirderDog/OverwatchShowtime/releases/download/v0.2.1/'
    @{ tag_name='v0.2.1'; draft=$false; prerelease=$false; assets=@(
        @{ name='OverwatchShowtime-0.2.1-Setup-x64.exe'; browser_download_url=($base + 'OverwatchShowtime-0.2.1-Setup-x64.exe') },
        @{ name='SHA256SUMS.txt'; browser_download_url=($base + 'SHA256SUMS.txt') }
    ) }
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri, $OutFile, $Headers)
    if ($Uri.EndsWith('SHA256SUMS.txt')) {
        $bytes = [Text.Encoding]::UTF8.GetBytes('test installer')
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $digest = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($global:owTestScenario -eq 'bad-hash') { $digest = '0' * 64 }
        [IO.File]::WriteAllText($OutFile, "$digest  OverwatchShowtime-0.2.1-Setup-x64.exe")
    } else { [IO.File]::WriteAllText($OutFile, 'test installer', (New-Object Text.UTF8Encoding($false))) }
}
function Start-Process {
    param($FilePath, $ArgumentList, [switch]$PassThru, [switch]$Wait, $WindowStyle)
    $global:owTestStarted++
    if ($ArgumentList -ne "/S /currentuser /D=$global:owTestTarget") { throw 'Unexpected installer arguments' }
    if ($global:owTestScenario -eq 'bad-exit') { return @{ ExitCode=2 } }
    New-Item -ItemType Directory -Path $global:owTestTarget -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $global:owTestTarget 'OverwatchTime.exe'), 'installed fixture')
    @{ ExitCode=0 }
}
try {
    $installerScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\install.ps1'
    & $installerScript -Version v0.2.1 -InstallDir $global:owTestTarget
    if ($global:owTestStarted -ne 1) { throw 'Valid installer was not started' }
    $global:owTestScenario = 'bad-hash'
    $rejected = $false
    try { & $installerScript -InstallDir $global:owTestTarget } catch { if ($_.Exception.Message -notlike '*checksum mismatch*') { throw }; $rejected=$true }
    if (-not $rejected -or $global:owTestStarted -ne 1) { throw 'Corrupted installer was executed' }
    $global:owTestScenario = 'bad-exit'
    $rejected = $false
    try { & $installerScript -InstallDir $global:owTestTarget } catch { if ($_.Exception.Message -notlike '*exit code 2*') { throw }; $rejected=$true }
    if (-not $rejected) { throw 'Installer failure was not propagated' }
    'Installer integration checks passed'
} finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^ow-installer-test-[a-f0-9]{32}$') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
