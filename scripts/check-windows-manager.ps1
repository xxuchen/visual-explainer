#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ProfileRoot)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath $ProfileRoot) { throw 'Choose a fresh isolated profile directory.' }
[void][IO.Directory]::CreateDirectory($ProfileRoot)
$state = Join-Path $ProfileRoot '.visual-explainer-manager'
$registry = Join-Path $state 'installations.json'
$codex = Join-Path $ProfileRoot '.agents/skills/visual-explainer'
$dsh = Join-Path $ProfileRoot '.dsh/skills/visual-explainer'
$other = Join-Path $ProfileRoot '.cursor/skills/other-skill'
[void][IO.Directory]::CreateDirectory($other)
[IO.File]::WriteAllText((Join-Path $other 'SKILL.md'), 'unrelated skill')
function Run-Batch([string]$Name, [string[]]$Arguments) {
    & (Join-Path $repo ($Name + '.bat')) @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name.bat failed ($LASTEXITCODE)" }
}
function Read-Registry {
    Get-Content -LiteralPath $registry -Raw -Encoding UTF8 | ConvertFrom-Json
}
$common = @('-NoPause','-NoOpen','-ProfileRoot',$ProfileRoot)
Run-Batch 'install' ($common + @('-Agents','codex,dsh'))
$first = Read-Registry
if (@($first.installations).Count -ne 2) { throw 'Expected two registered installs.' }
foreach ($target in @($codex,$dsh)) {
    if (-not (Test-Path -LiteralPath (Join-Path $target 'software-design/compact.mjs'))) { throw "Missing enhanced skill at $target" }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'node_modules/playwright-core/cli.js'))) { throw "Missing browser dependency at $target" }
}
if (Test-Path -LiteralPath (Join-Path $ProfileRoot '.cursor/skills/visual-explainer')) { throw 'An unselected agent was installed.' }
Run-Batch 'reinstall' $common
$second = Read-Registry
foreach ($item in $second.installations) {
    $old = $first.installations | Where-Object { $_.id -eq $item.id }
    if ($item.installId -eq $old.installId) { throw 'Reinstall did not replace the prior installation.' }
}
Run-Batch 'uninstall' ($common + @('-Yes'))
if (@((Read-Registry).installations).Count -ne 0 -or (Test-Path -LiteralPath $codex) -or (Test-Path -LiteralPath $dsh)) { throw 'Uninstall left managed skills or registry entries.' }
if ([IO.File]::ReadAllText((Join-Path $other 'SKILL.md')) -ne 'unrelated skill') { throw 'Uninstall modified an unrelated skill.' }
if (Test-Path -LiteralPath (Join-Path $state 'runs')) { throw 'Managed staging files were not removed.' }
Write-Host 'Multi-agent Windows install / reinstall / uninstall passed.'
