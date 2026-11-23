#requires -Version 5.1
<#
Install the canonical Visual Explainer skill for the current Windows user.
Usage: install.bat [-NoPause] [-NoOpen] [-AgentHome "C:\path to\.agents"]
NoPause is consumed by install.bat; the helper itself never pauses.
All messages are ASCII so Windows PowerShell 5.1 can read this UTF-8 file.
#>
[CmdletBinding()]
param(
    [switch]$NoPause,
    [switch]$NoOpen,
    [string]$AgentHome
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:LogPath = $null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$repoPath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$installLock = $null
$stagePath = $null
$targetPath = $null
$backupPath = $null
$oldMoved = $false
$activated = $false
$exitCode = 1
$result = [ordered]@{
    schemaVersion = 1
    installer = 'visual-explainer/windows/v1'
    status = 'failed'
    repoPath = $repoPath
    targetPath = $null
    backupPath = $null
    outputDirectory = $null
    demoPath = $null
    checksPath = $null
    logPath = $null
    nodeVersion = $null
    previousInstallationRestored = $false
    error = $null
}

function Write-InstallMessage([string]$Message) {
    Write-Host $Message
    if ($script:LogPath) {
        [IO.File]::AppendAllText($script:LogPath, $Message + [Environment]::NewLine, $utf8)
    }
}

function Get-Entry([string]$Path) {
    Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

function Assert-PlainDirectory([string]$Path) {
    $entry = Get-Entry $Path
    if ($entry) {
        if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Use a regular directory for the installer workspace: $Path"
        }
    }
}

function Test-Within([string]$Child, [string]$Parent) {
    $prefix = $Parent.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
    $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Copy-SkillTree([string]$Source, [string]$Destination) {
    [void][IO.Directory]::CreateDirectory($Destination)
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        # Reinstall generated dependencies instead of copying a local npm tree.
        if ($item.Name -eq 'node_modules') { continue }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "The canonical skill contains a filesystem link. Use a regular checkout: $($item.FullName)"
        }
        $dest = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) {
            Copy-SkillTree $item.FullName $dest
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $dest
        }
    }
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments, [string]$Label, [switch]$Quiet)
    Write-InstallMessage "[RUN] $Label"
    $savedPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 wraps native stderr as ErrorRecord. npm and
        # Chromium download progress may use stderr even when exit code is 0.
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            [IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine, $utf8)
            if (-not $Quiet) { Write-Host $line }
        }
        $nativeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
    }
    if ($nativeExit -ne 0) {
        throw "$Label failed (exit $nativeExit). Details: $script:LogPath"
    }
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'This installer requires native Windows.' }
    $sourcePath = Join-Path $repoPath 'plugins\visual-explainer'
    foreach ($relative in @('SKILL.md', 'software-design\cli.mjs', 'templates\software-design.json', 'kit\render.mjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $relative) -PathType Leaf)) {
            throw "Missing plugins\visual-explainer\$relative. Update the complete feat/software-design-rules checkout in GitHub Desktop, then rerun install.bat."
        }
    }
    Assert-PlainDirectory $sourcePath
    if ([string]::IsNullOrWhiteSpace($AgentHome)) {
        if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) { throw 'USERPROFILE is not set. Run as your normal Windows user.' }
        $AgentHome = Join-Path $env:USERPROFILE '.agents'
    }
    $AgentHome = [IO.Path]::GetFullPath($AgentHome)
    if ($AgentHome.TrimEnd([char[]]'\/').Equals([IO.Path]::GetPathRoot($AgentHome).TrimEnd([char[]]'\/'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'AgentHome must be a dedicated directory, not a drive or network-share root.'
    }
    $AgentHome = $AgentHome.TrimEnd([char[]]'\/')
    if (Test-Within $repoPath $AgentHome) { throw 'AgentHome must be outside the repository and its parent directories.' }
    if (Test-Within $AgentHome $repoPath) { throw 'AgentHome must be outside the repository.' }
    $skillsPath = Join-Path $AgentHome 'skills'
    $stagingRoot = Join-Path $AgentHome 'install-staging'
    $backupRoot = Join-Path $AgentHome 'skill-backups'
    $outputRoot = Join-Path $AgentHome 'visual-explainer-output'
    foreach ($directory in @($AgentHome, $skillsPath, $stagingRoot, $backupRoot, $outputRoot)) {
        Assert-PlainDirectory $directory
        [void][IO.Directory]::CreateDirectory($directory)
    }
    $lockPath = Join-Path $AgentHome '.visual-explainer-install.lock'
    $lockEntry = Get-Entry $lockPath
    if ($lockEntry -and ($lockEntry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Installer lock is a filesystem link: $lockPath" }
    try {
        # The empty lock file may remain after a run. Exclusivity is held by the
        # open handle, so a crash cannot leave a stale lock blocking future runs.
        $installLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch {
        throw "Another installer is running, or the lock is not writable: $lockPath"
    }
    $targetPath = Join-Path $skillsPath 'visual-explainer'
    $stagePath = Join-Path $stagingRoot "visual-explainer-$runId"
    $backupPath = Join-Path $backupRoot "visual-explainer-$runId"
    $outputDirectory = Join-Path $outputRoot $runId
    [void][IO.Directory]::CreateDirectory($outputDirectory)
    $script:LogPath = Join-Path $outputDirectory 'install.log'
    $demoJson = Join-Path $outputDirectory 'demo.design.json'
    $demoHtml = Join-Path $outputDirectory 'demo.html'
    $result.targetPath = $targetPath
    $result.outputDirectory = $outputDirectory
    $result.demoPath = $demoHtml
    $result.checksPath = "$demoHtml.checks.json"
    $result.logPath = $script:LogPath
    Write-InstallMessage 'Visual Explainer - Windows installer'
    Write-InstallMessage "Source: $repoPath"
    Write-InstallMessage "Skill:  $targetPath"
    Write-InstallMessage "Log:    $script:LogPath"

    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nodeCommand -or -not $npmCommand) {
        throw 'Install Node.js LTS 22 or newer (including npm) from https://nodejs.org/en/download, reopen the terminal, then run install.bat again.'
    }
    $node = $nodeCommand.Source
    # Calling npm.cmd would pass the semver range through cmd.exe, where ^, <
    # and > have shell meanings. Use npm's JavaScript entry point with node so
    # the range from package.json reaches npm unchanged.
    $npmCandidates = @(
        (Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules\npm\bin\npm-cli.js'),
        (Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js')
    )
    $npmCli = $npmCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $npmCli) {
        throw 'Cannot locate npm/bin/npm-cli.js beside npm.cmd or node.exe. Repair the official Node.js LTS installation (including npm), then rerun install.bat.'
    }
    $nodeVersion = (& $node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw 'Unable to determine the installed Node.js version.' }
    if ([int]$Matches[1] -lt 22) { throw "Node.js $nodeVersion is too old. Install Node.js LTS 22 or newer from https://nodejs.org/en/download and rerun." }
    $result.nodeVersion = $nodeVersion
    Write-InstallMessage "Node:   $nodeVersion"
    $package = Get-Content -LiteralPath (Join-Path $repoPath 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $playwrightRange = $package.devDependencies.'playwright-core'
    if ([string]::IsNullOrWhiteSpace($playwrightRange) -or $playwrightRange -notmatch '^[0-9xX*.^~<>=| -]+$') {
        throw 'package.json must declare a semver range for devDependencies.playwright-core.'
    }
    $existing = Get-Entry $targetPath
    if ($existing -and -not $existing.PSIsContainer) { throw "The skill destination is a file. Move it aside manually before installing: $targetPath" }
    if (Get-Entry $stagePath) { throw "Staging path already exists: $stagePath" }
    if (Get-Entry $backupPath) { throw "Backup path already exists: $backupPath" }

    Write-InstallMessage '[1/5] Copying the complete canonical skill into staging...'
    Copy-SkillTree $sourcePath $stagePath
    Push-Location -LiteralPath $repoPath
    try {
        Write-InstallMessage '[2/5] Installing the browser dependency and matching Chromium (internet required)...'
        Invoke-Checked -Command $node -Arguments @($npmCli, 'install', '--prefix', $stagePath, '--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund', "playwright-core@$playwrightRange") -Label 'Install playwright-core'
        $browserCli = Join-Path $stagePath 'node_modules\playwright-core\cli.js'
        if (-not (Test-Path -LiteralPath $browserCli -PathType Leaf)) { throw 'npm completed without installing the required playwright-core CLI.' }
        Invoke-Checked -Command $node -Arguments @($browserCli, 'install', 'chromium') -Label 'Install matching Chromium'

        Write-InstallMessage '[3/5] Generating and checking the Chinese example before activation...'
        $stagedCli = Join-Path $stagePath 'software-design\cli.mjs'
        Invoke-Checked -Command $node -Arguments @($stagedCli, 'init', $demoJson) -Label 'Create example design' -Quiet
        Invoke-Checked -Command $node -Arguments @($stagedCli, 'render', $demoJson, '--out', $demoHtml, '--require-browser') -Label 'Validate model, HTML and Chromium layout' -Quiet
        $checks = Get-Content -LiteralPath $result.checksPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $checks.ok -or $checks.design.status -ne 'passed' -or $checks.static.status -ne 'passed' -or $checks.browser.status -ne 'passed') {
            throw "The generated example did not pass all installation checks: $($result.checksPath)"
        }

        Write-InstallMessage '[4/5] Activating the validated skill and retaining the previous installation...'
        if (Get-Entry $targetPath) {
            # Rename the directory entry on the same volume. A target junction
            # or symlink is preserved as a link; its contents are never deleted.
            [IO.Directory]::Move($targetPath, $backupPath)
            $oldMoved = $true
            $result.backupPath = $backupPath
        }
        [IO.Directory]::Move($stagePath, $targetPath)
        $activated = $true
        Write-InstallMessage '[5/5] Verifying the installed entry point and browser resolution...'
        $installedCli = Join-Path $targetPath 'software-design\cli.mjs'
        Invoke-Checked -Command $node -Arguments @($installedCli, 'inspect', $demoHtml, '--spec', $demoJson, '--require-browser') -Label 'Check the active installation' -Quiet
    } finally {
        Pop-Location
    }
    $result.status = 'passed'
    $exitCode = 0
} catch {
    $result.error = $_.Exception.Message
    # Never recursively delete an existing skill or a link target. On failure,
    # move a newly activated copy aside and rename the backup back into place.
    try {
        if ($activated) {
            $failedPath = "$stagePath-failed"
            [IO.Directory]::Move($targetPath, $failedPath)
            $activated = $false
        }
        if ($oldMoved) {
            [IO.Directory]::Move($backupPath, $targetPath)
            $oldMoved = $false
            $result.backupPath = $null
            $result.previousInstallationRestored = $true
        }
    } catch {
        $result.error += " Rollback needs manual recovery: $($_.Exception.Message). Previous installation: $backupPath"
    }
    Write-Host "[ERROR] $($result.error)" -ForegroundColor Red
    if ($script:LogPath) {
        try { [IO.File]::AppendAllText($script:LogPath, "[ERROR] $($result.error)" + [Environment]::NewLine, $utf8) } catch {}
    }
} finally {
    if ($result.outputDirectory) {
        try {
            $resultFile = Join-Path $result.outputDirectory 'install-result.json'
            [IO.File]::WriteAllText($resultFile, ($result | ConvertTo-Json -Depth 6) + [Environment]::NewLine, $utf8)
        } catch {
            Write-Host "[WARNING] Could not save the installation result: $($_.Exception.Message)"
        }
    }
    if ($installLock) { $installLock.Dispose() }
}

if ($exitCode -eq 0) {
    Write-InstallMessage ''
    Write-InstallMessage '[SUCCESS] Visual Explainer installed. Design, static HTML and Chromium checks passed.'
    Write-InstallMessage "Skill:   $targetPath"
    Write-InstallMessage "Example: $($result.demoPath)"
    Write-InstallMessage "Checks:  $($result.checksPath)"
    if ($result.backupPath) { Write-InstallMessage "Backup:  $($result.backupPath)" }
    Write-InstallMessage 'The example business acceptance tests remain not-run. Replace the example with your project requirements.'
    Write-InstallMessage 'In Codex, start a new conversation and ask it to use $visual-explainer for a Chinese software design HTML page.'
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $legacyPath = Join-Path $env:USERPROFILE '.codex\skills\visual-explainer'
        if (Get-Entry $legacyPath) { Write-InstallMessage "[NOTICE] An older skill copy also exists at $legacyPath. Review it if duplicate skill entries appear." }
    }
    if (-not $NoOpen) {
        try { Start-Process -FilePath $result.demoPath | Out-Null } catch { Write-Host "[NOTICE] Open the example manually: $($result.demoPath)" }
    }
} elseif ($result.outputDirectory) {
    Write-Host "Details: $($result.outputDirectory)"
    Write-Host 'Resolve the reported error and run install.bat again.'
}
exit $exitCode
