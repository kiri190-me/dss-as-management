<#
.SYNOPSIS
    Nightly maintenance wrapper — runs every purge CLI (repair cases, then
    flowcharts, then master data) sequentially, logs each to its own
    timestamped file, and exits nonzero if any job failed.

.DESCRIPTION
    Design approved in the "production purge scheduler design" checkpoint:
    one Task Scheduler task runs this one script, which in turn runs the
    `npm run purge:*` commands one after another (never in parallel). A
    failure in one job must never prevent the next from running —
    each job's outcome is captured independently via Start-Process's own
    $process.ExitCode (not $LASTEXITCODE after a pipeline, and not PowerShell
    2>&1 redirection, which in Windows PowerShell 5.1 wraps a native
    command's stderr lines in NativeCommandError objects and can corrupt
    exit-code detection — Start-Process -RedirectStandardOutput/
    -RedirectStandardError instead captures each stream as raw bytes
    written directly by the OS, exactly like a normal console redirect).

    .env.local is loaded by scripts/load-env.ts relative to
    process.cwd() (not the script's own file location) — this wrapper
    Set-Location's to the project root before running anything, precisely
    so that resolution is never dependent on wherever the wrapper happens
    to be launched from (interactive shell vs. Task Scheduler).

    Never touches application code, schema, or production data itself —
    it only invokes the two already-implemented, already-tested purge CLIs
    exactly as `npm run purge:repair-cases` / `npm run purge:flowcharts`
    would run them by hand.
#>

# Deliberately no reliance on a PowerShell profile — every cmdlet below is
# called by its full name (no profile-defined alias/function assumed), and
# the profile itself is skipped at invocation time via -NoProfile (see the
# recommended Task Scheduler Arguments in this checkpoint's report).

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -Path $ProjectRoot

$LogDir = Join-Path $ProjectRoot "logs\purge"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# One shared timestamp for this run — both jobs' log filenames carry it, so
# a single night's pair of logs is trivially correlated by filename alone.
$RunTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Invoke-PurgeJob {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$NpmScript,
        [Parameter(Mandatory = $true)][string]$LogFile
    )

    $startTime = Get-Date -Format "o"
    "===== $Name started at $startTime =====" | Out-File -FilePath $LogFile -Encoding utf8

    $stdoutTemp = "$LogFile.stdout.tmp"
    $stderrTemp = "$LogFile.stderr.tmp"
    $exitCode = 1

    try {
        # cmd.exe is the target (not npm.cmd directly) — npm on Windows is
        # itself a .cmd shim, and Start-Process launches real executables
        # most reliably through cmd.exe /c rather than depending on
        # PATHEXT/shim resolution inside Start-Process itself.
        $process = Start-Process -FilePath "cmd.exe" `
            -ArgumentList "/c", "npm run $NpmScript" `
            -WorkingDirectory $ProjectRoot `
            -NoNewWindow -PassThru -Wait `
            -RedirectStandardOutput $stdoutTemp `
            -RedirectStandardError $stderrTemp

        $exitCode = $process.ExitCode
    } catch {
        # An unexpected failure to even LAUNCH this job (e.g. cmd.exe
        # missing) must not stop the other job from running — recorded as a
        # failure for this job only, never re-thrown past this function.
        "Failed to launch ${Name}: $($_.Exception.Message)" | Out-File -FilePath $LogFile -Append -Encoding utf8
        $exitCode = 1
    }

    if (Test-Path $stdoutTemp) {
        Get-Content -Path $stdoutTemp -Raw -Encoding UTF8 -ErrorAction SilentlyContinue |
            Out-File -FilePath $LogFile -Append -Encoding utf8
        Remove-Item -Path $stdoutTemp -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $stderrTemp) {
        $stderrContent = Get-Content -Path $stderrTemp -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($stderrContent) {
            "----- stderr -----" | Out-File -FilePath $LogFile -Append -Encoding utf8
            $stderrContent | Out-File -FilePath $LogFile -Append -Encoding utf8
        }
        Remove-Item -Path $stderrTemp -Force -ErrorAction SilentlyContinue
    }

    $endTime = Get-Date -Format "o"
    "===== $Name finished at $endTime with exit code $exitCode =====" | Out-File -FilePath $LogFile -Append -Encoding utf8

    return $exitCode
}

$RepairCasesLog = Join-Path $LogDir "purge-repair-cases-$RunTimestamp.log"
$FlowchartsLog = Join-Path $LogDir "purge-flowcharts-$RunTimestamp.log"
$MasterDataLog = Join-Path $LogDir "purge-master-data-$RunTimestamp.log"

# Sequential, never parallel — repair-cases first (it force-purges its own
# attached flowcharts as part of that job), flowcharts second, master data
# (customers and everything cascading from them) last. Order is not
# safety-critical either way (each job independently re-verifies live state
# under its own row lock), just tidier logs — though master-data last is
# also the tidiest reading of the same day's logs: a customer can only ever
# be purged once no repair case references it, so whatever the earlier jobs
# removed is already reflected in the reference count this job sees. Every
# call always runs regardless of an earlier job's outcome — nothing above
# this point can abort the script before all three Invoke-PurgeJob calls
# have run.
$RepairCasesExitCode = Invoke-PurgeJob -Name "purge:repair-cases" -NpmScript "purge:repair-cases" -LogFile $RepairCasesLog
$FlowchartsExitCode = Invoke-PurgeJob -Name "purge:flowcharts" -NpmScript "purge:flowcharts" -LogFile $FlowchartsLog
$MasterDataExitCode = Invoke-PurgeJob -Name "purge:master-data" -NpmScript "purge:master-data" -LogFile $MasterDataLog

Write-Host "purge:repair-cases exit code: $RepairCasesExitCode (log: $RepairCasesLog)"
Write-Host "purge:flowcharts exit code: $FlowchartsExitCode (log: $FlowchartsLog)"
Write-Host "purge:master-data exit code: $MasterDataExitCode (log: $MasterDataLog)"

if ($RepairCasesExitCode -ne 0 -or $FlowchartsExitCode -ne 0 -or $MasterDataExitCode -ne 0) {
    Write-Error "Nightly purge had failures: purge:repair-cases=$RepairCasesExitCode purge:flowcharts=$FlowchartsExitCode purge:master-data=$MasterDataExitCode"
    exit 1
}

exit 0
