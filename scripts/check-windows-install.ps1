#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$TestRoot = (Join-Path ([System.IO.Path]::GetTempPath()) ('visual-explainer-install-check-' + [guid]::NewGuid().ToString('N')))
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Read-Json {
    param([string]$Path)
    Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-LatestResult {
    param([string]$AgentHome)
    $results = @(Get-ChildItem -LiteralPath (Join-Path $AgentHome 'visual-explainer-output') -Directory |
        ForEach-Object { Join-Path $_.FullName 'install-result.json' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Sort-Object)
    Assert-True ($results.Count -gt 0) 'The installer did not create a result manifest.'
    Read-Json $results[-1]
}

function Invoke-Installer {
    param([string]$SourceRoot, [string]$AgentHome, [bool]$ShouldSucceed)
    # The launcher's directory, not the caller's working directory, locates its source.
    Push-Location -LiteralPath $TestRoot
    try {
        & (Join-Path $SourceRoot 'install.bat') -NoPause -NoOpen -AgentHome $AgentHome | Out-Host
        $installerExitCode = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($ShouldSucceed) {
        Assert-True ($installerExitCode -eq 0) "Installation exited with code $installerExitCode."
    }
    else {
        Assert-True ($installerExitCode -ne 0) 'Installation of an invalid example unexpectedly succeeded.'
    }
    Get-LatestResult $AgentHome
}

function Assert-VerifiedExample {
    param($Result)
    Assert-True ($Result.status -eq 'passed') 'The installer did not report success.'
    Assert-True (Test-Path -LiteralPath $Result.demoPath -PathType Leaf) 'The HTML example is missing.'
    $checks = Read-Json $Result.checksPath
    Assert-True ($checks.ok -eq $true) 'The generated example failed its checks.'
    foreach ($check in @('design', 'static', 'browser')) {
        Assert-True ($checks.$check.status -eq 'passed') "The $check check did not pass."
    }
    $acceptance = @($checks.business.PSObject.Properties)
    Assert-True ($acceptance.Count -gt 0) 'The example has no business acceptance entries.'
    foreach ($item in $acceptance) {
        Assert-True ($item.Value -eq 'not-run') 'An installer smoke test must not claim business acceptance passed.'
    }
    foreach ($width in @(390, 1280)) {
        $screenshot = Join-Path ($Result.demoPath + '.screenshots') "software-design-$width.png"
        Assert-True (Test-Path -LiteralPath $screenshot -PathType Leaf) "The $width px browser screenshot is missing."
    }
}

function Get-TreeFingerprint {
    param([string]$Path)
    # Compare actual installed bytes, including the browser dependency and user files.
    $entries = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($Path.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
    $entries -join "`n"
}

Assert-True ($env:OS -eq 'Windows_NT') 'This smoke check runs on Windows.'
Assert-True (-not (Test-Path -LiteralPath $TestRoot)) 'TestRoot already exists; choose a fresh test directory.'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $TestRoot 'source tree with spaces'
$agentHome = Join-Path $TestRoot 'agent home with spaces'
New-Item -ItemType Directory -Path (Join-Path $sourceRoot 'plugins'), (Join-Path $sourceRoot 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'install.bat'), (Join-Path $repoRoot 'package.json') -Destination $sourceRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/install-windows.ps1') -Destination (Join-Path $sourceRoot 'scripts')
Copy-Item -LiteralPath (Join-Path $repoRoot 'plugins/visual-explainer') -Destination (Join-Path $sourceRoot 'plugins') -Recurse

Write-Host 'Checking a first install from a source path containing spaces...'
$first = Invoke-Installer $sourceRoot $agentHome $true
Assert-VerifiedExample $first
Assert-True ([string]::IsNullOrEmpty($first.backupPath)) 'A first install unexpectedly reported an old installation.'
$target = Join-Path $agentHome 'skills/visual-explainer'
Assert-True ([System.IO.Path]::GetFullPath($first.targetPath) -eq [System.IO.Path]::GetFullPath($target)) 'The installation used an unexpected destination.'
foreach ($relative in @('SKILL.md', 'kit/render.mjs', 'software-design/cli.mjs', 'templates/software-design.json', 'node_modules/playwright-core/cli.js')) {
    Assert-True (Test-Path -LiteralPath (Join-Path $target $relative) -PathType Leaf) "The complete skill installation is missing $relative."
}

Write-Host 'Checking a repeated install and preservation of the previous installation...'
$sentinelName = 'local-user-note.txt'
$sentinel = 'Preserve this local customization in the old installation backup.'
[System.IO.File]::WriteAllText((Join-Path $target $sentinelName), $sentinel)
$second = Invoke-Installer $sourceRoot $agentHome $true
Assert-VerifiedExample $second
Assert-True (-not [string]::IsNullOrEmpty($second.backupPath)) 'A repeated install did not report its backup.'
$backupFile = Join-Path $second.backupPath $sentinelName
Assert-True (Test-Path -LiteralPath $backupFile -PathType Leaf) 'The old installation backup lost its user file.'
Assert-True ([System.IO.File]::ReadAllText($backupFile) -eq $sentinel) 'The old installation backup changed its user file.'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $target $sentinelName))) 'The new installation was merged into the previous directory.'
Assert-True (-not $second.backupPath.StartsWith((Join-Path $agentHome 'skills') + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) 'The backup is inside the skill discovery directory.'

Write-Host 'Checking upgrade of an existing directory junction preserves its external target...'
$legacyTarget = Join-Path $TestRoot 'linked legacy installation'
[System.IO.File]::WriteAllText((Join-Path $target $sentinelName), $sentinel)
[System.IO.Directory]::Move($target, $legacyTarget)
$legacyFingerprint = Get-TreeFingerprint $legacyTarget
New-Item -ItemType Junction -Path $target -Target $legacyTarget | Out-Null
$junctionUpgrade = Invoke-Installer $sourceRoot $agentHome $true
Assert-VerifiedExample $junctionUpgrade
$savedLink = Get-Item -LiteralPath $junctionUpgrade.backupPath -Force
$activeEntry = Get-Item -LiteralPath $target -Force
Assert-True (($savedLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) 'The previous directory junction was not preserved as a link.'
Assert-True (($activeEntry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) 'The new active installation is still a filesystem link.'
Assert-True ((Get-TreeFingerprint $legacyTarget) -ceq $legacyFingerprint) 'Upgrading a junction changed the external target contents.'
Assert-True ([System.IO.File]::ReadAllText((Join-Path $junctionUpgrade.backupPath $sentinelName)) -eq $sentinel) 'The saved junction no longer reaches the external installation.'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $target $sentinelName))) 'Upgrading a junction reused its external target directory.'

Write-Host 'Checking a failed installation leaves the active installation byte-for-byte intact...'
[System.IO.File]::WriteAllText((Join-Path $target $sentinelName), $sentinel)
$beforeFailure = Get-TreeFingerprint $target
$backupCount = @(Get-ChildItem -LiteralPath (Join-Path $agentHome 'skill-backups') -Directory).Count
# Mutate only the disposable source. A real render must reject this unsupported schema.
[System.IO.File]::WriteAllText((Join-Path $sourceRoot 'plugins/visual-explainer/templates/software-design.json'), '{"schemaVersion":999}')
$failed = Invoke-Installer $sourceRoot $agentHome $false
Assert-True ($failed.status -eq 'failed') 'The failed install did not report failure.'
Assert-True ($failed.outputDirectory -ne $junctionUpgrade.outputDirectory) 'The failed install did not create its own diagnostic output.'
Assert-True ((Get-TreeFingerprint $target) -ceq $beforeFailure) 'A failed installation changed the active installation.'
Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $agentHome 'skill-backups') -Directory).Count -eq $backupCount) 'A failed staged installation moved the active installation to a backup.'
Assert-True ([System.IO.File]::ReadAllText($backupFile) -eq $sentinel) 'A failed install changed a previous backup.'

$summary = [ordered]@{
    status = 'passed'
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    sourcePathWithSpaces = $sourceRoot
    firstInstall = $first.outputDirectory
    repeatedInstall = $second.outputDirectory
    junctionUpgrade = $junctionUpgrade.outputDirectory
    rejectedInstall = $failed.outputDirectory
    checks = @('first install and actual Chromium checks', 'repeat install and preserved backup', 'junction upgrade preserves link and external target', 'failed render preserves active installation bytes')
}
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $TestRoot 'test-result.json') -Encoding UTF8
Write-Host 'Windows installer checks passed.'
exit 0
