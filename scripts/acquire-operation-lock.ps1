#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$StateDirectory,
    [Parameter(Mandatory=$true)][int]$OwnerProcessId,
    [Parameter(Mandatory=$true)][string]$Token
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$guard = $null
$stream = $null
$created = $false
$exitCode = 1
$lockPath = Join-Path $StateDirectory 'operation.lock'
$guardPath = Join-Path $StateDirectory 'operation.acquire.guard'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Assert-RegularFile([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))) {
        throw "Refusing non-regular lock entry: $Path"
    }
}
try {
    $directory = Get-Item -LiteralPath $StateDirectory -Force
    if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid manager state directory.' }
    if ($OwnerProcessId -le 0 -or $Token -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid lock owner.' }
    # This is an OS-held exclusive handle, not an existence-based lock.
    # It serializes recovery and creation across new managers, and is
    # automatically released even if this short-lived helper is killed.
    Assert-RegularFile $guardPath
    try {
        $guard = [IO.File]::Open($guardPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    } catch {
        throw 'Another manager is checking the lifecycle lock. Retry shortly.'
    }
    Assert-RegularFile $lockPath
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        try {
            $prior = [IO.File]::ReadAllText($lockPath,[Text.Encoding]::UTF8) | ConvertFrom-Json
            if ($null -eq $prior -or $null -eq $prior.PSObject.Properties['pid'] -or
                $prior.pid -isnot [ValueType] -or [string]$prior.pid -notmatch '^[1-9][0-9]{0,9}$' -or
                [long]$prior.pid -gt [int]::MaxValue) { throw 'Invalid PID.' }
            $oldPid = [int]$prior.pid
        } catch {
            throw "Cannot establish ownership of an unreadable or incomplete lock. Verify that no installer is running before removing: $lockPath"
        }
        $owner = $null
        $alive = $true
        try {
            $owner = [Diagnostics.Process]::GetProcessById($oldPid)
            # A process object can also represent a process that has just exited.
            $alive = -not $owner.HasExited
        } catch {
            # Only 'no such PID' is proof of staleness. Access errors and PID
            # reuse remain fail-closed; do not terminate any process.
            $e = $_.Exception
            if ($e -is [ArgumentException] -or $e.InnerException -is [ArgumentException]) {
                $alive = $false
            } else { throw "Cannot verify the previous lock owner PID $oldPid. Leave the lock intact." }
        } finally {
            if ($owner) { $owner.Dispose() }
        }
        if ($alive) { throw "Another lifecycle operation may be running (PID $oldPid). Lock kept: $lockPath" }
        # All new managers serialize this remove/create pair. Older managers
        # use create-new and cannot remove the stale file themselves.
        [IO.File]::Delete($lockPath)
        [Console]::WriteLine("[RECOVERED] Removed stale lifecycle lock for exited PID $oldPid.")
    }
    $payload = @{pid=$OwnerProcessId;startedAt=[DateTime]::UtcNow.ToString('o');token=$Token} | ConvertTo-Json -Compress
    $bytes = $utf8.GetBytes($payload)
    $stream = [IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $created = $true
    $stream.Write($bytes,0,$bytes.Length)
    $stream.Flush()
    $stream.Dispose()
    $stream = $null
    $exitCode = 0
} catch {
    if ($stream) { $stream.Dispose(); $stream = $null }
    if ($created) {
        try { [IO.File]::Delete($lockPath) } catch {}
    }
    [Console]::Error.WriteLine($_.Exception.Message)
} finally {
    if ($stream) { $stream.Dispose() }
    if ($guard) { $guard.Dispose() }
}
exit $exitCode
