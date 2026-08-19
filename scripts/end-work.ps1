#Requires -Version 5.1
<#
.SYNOPSIS
    작업 종료 — DB를 백업하고, 서버와 컨테이너를 끄고, 안 올린 것이 있으면 알린다.

.DESCRIPTION
    start-work.ps1과 짝이다.

    ── 왜 백업이 먼저인가 ──────────────────────────────────────────────────
    코드는 깃허브에 있으니 이 PC가 사라져도 돌아온다. **DB는 아니다.**
    DB는 이 PC의 Docker 가상 디스크 안에만 있고, 깃허브에 올라가지 않는다.
    A/S 접수 건, 고객사, 사용자 계정은 여기서만 존재한다. 그래서 끄기 전에
    통째로 파일 하나로 떠 둔다. 하루 한 번이면 잃어도 하루치다.

    ── 안 하는 일 ──────────────────────────────────────────────────────────
    커밋도 푸시도 하지 않는다. 알려만 준다 — 무엇을 남길지는 사람이 정한다.
    컨테이너는 stop만 하고 지우지 않는다. `docker compose down -v`는 볼륨을
    지워 DB를 통째로 날리므로 이 스크립트는 그 명령을 쓰지 않는다.

    ── 대신 멈춘다 ─────────────────────────────────────────────────────────
    경고는 읽히지 않는다. 창이 닫히면 더더욱. 그래서 안 올린 것이 있으면
    알리는 데서 그치지 않고 **끄는 것을 멈춘다.** 백업은 이미 마친 뒤라
    DB는 그날치가 남고, 서버와 DB는 켜진 채여서 그 자리에서 바로 커밋하면
    된다. 알고도 그대로 끄려면 -Force.

.PARAMETER BackupOnly
    백업만 뜨고 서버와 컨테이너는 그대로 둔다. 작업 중간에 한 번 떠 두고 싶을 때.

.PARAMETER Force
    안 올린 것이 있어도 멈추지 않고 끝까지 끈다. 오늘 남긴 것을 알고 있고
    그대로 두기로 정했을 때만.

.PARAMETER DryRun
    무엇을 할지 보여 주기만 하고 실제로는 아무것도 끄거나 만들지 않는다.

.EXAMPLE
    .\scripts\end-work.ps1 -DryRun
    .\scripts\end-work.ps1
    .\scripts\end-work.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$BackupOnly,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$Container  = 'dss-as-postgres-dev'
$Database   = 'dss_as_dev'
# 이 프로젝트는 이미 자료 폴더 규약을 갖고 있다 — .env의 BACKUPS_DIR이 가리키는
# C:\DSS-AS-DATA 아래에 backups\postgres, backups\uploads, logs, uploads가
# 미리 잡혀 있고 2026-08-18 백업도 거기 들어 있다. 새 자리를 만들면 백업이 두 곳으로
# 갈라져 "어느 쪽이 최신인가"를 매번 따져야 한다.
$DataRoot   = if ($env:DSS_AS_DATA_ROOT) { $env:DSS_AS_DATA_ROOT } else { 'C:\DSS-AS-DATA' }
$BackupDir  = Join-Path $DataRoot 'backups\postgres'
$WarnAfter  = 20   # 백업 파일이 이보다 많아지면 알린다(지우지는 않는다)

function Invoke-Native([string]$CommandLine) {
    $out = & cmd.exe /c "$CommandLine 2>&1"
    [pscustomobject]@{ Output = ($out -join "`n").Trim(); ExitCode = $LASTEXITCODE }
}

function Write-Step([string]$Text)  { Write-Host ""; Write-Host "▶ $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)    { Write-Host "  ✔ $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  ⚠ $Text" -ForegroundColor Yellow }
function Write-Info([string]$Text)  { Write-Host "    $Text" -ForegroundColor DarkGray }

Set-Location $RepoRoot
Write-Host ""
Write-Host "════ 작업 종료 ════" -ForegroundColor White
if ($DryRun) { Write-Host "  [연습 모드] 실제로는 아무것도 끄지 않습니다." -ForegroundColor Magenta }

# ── 1. 남긴 것 확인 (먼저 보여 준다 — 끄고 나서 알면 늦다) ────────────────
Write-Step "안 올린 작업 확인"
$dirtyLines = @((Invoke-Native 'git status --porcelain').Output -split "`n" | Where-Object { $_ -ne '' })
$unpushed   = (Invoke-Native 'git rev-list --count "@{u}..HEAD"').Output
$blockers   = @()   # 하나라도 차면 3단계로 넘어가지 않는다

if ($dirtyLines.Count -gt 0) {
    Write-Warn2 "커밋하지 않은 파일 $($dirtyLines.Count)개 — 이 PC에만 있습니다"
    $dirtyLines | Select-Object -First 8 | ForEach-Object { Write-Info $_ }
    if ($dirtyLines.Count -gt 8) { Write-Info "… 외 $($dirtyLines.Count - 8)개" }
    $blockers += "커밋하지 않은 파일 $($dirtyLines.Count)개"
}
if ($unpushed -match '^\d+$') {
    if ([int]$unpushed -gt 0) {
        Write-Warn2 "깃허브에 안 올린 커밋 $($unpushed)개 — 이 PC에만 있습니다"
        $blockers += "푸시하지 않은 커밋 $($unpushed)개"
    }
} else {
    # 업스트림이 없으면 몇 개가 안 올라갔는지 셀 수가 없다. 셀 수 없는 것을
    # 위반으로 처리하면 새로 딴 브랜치에서는 매번 문이 잠긴다 — 알리고 통과.
    Write-Warn2 "업스트림이 없어 푸시 여부를 확인하지 못했습니다 (종료는 막지 않습니다)"
}
if ($dirtyLines.Count -eq 0 -and $unpushed -eq '0') {
    Write-Ok "전부 깃허브에 올라가 있습니다"
}

# ── 2. DB 백업 ────────────────────────────────────────────────────────────
Write-Step "DB 백업"
$running    = (Invoke-Native "docker ps --filter name=^/$Container`$ --format `"{{.Names}}`"").Output
$backupMade = $false

if ($running -ne $Container) {
    Write-Warn2 "DB가 이미 꺼져 있어 백업을 건너뜁니다."
} else {
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $file  = Join-Path $BackupDir "${Database}_$stamp.sql"

    if ($DryRun) {
        Write-Info "만들 파일: $file"
    } else {
        if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }

        # cmd로 리다이렉트한다 — pg_dump가 내보내는 바이트를 PowerShell이
        # 문자열로 해석해 인코딩을 바꿔 버리지 않도록.
        $dump = Invoke-Native "docker exec $Container pg_dump -U dss_app -d $Database > `"$file`""

        $ok = $false
        if ($dump.ExitCode -eq 0 -and (Test-Path $file)) {
            # pg_dump가 끝까지 갔을 때만 이 표시가 붙는다. 크기만 보면 중간에
            # 끊긴 파일을 성공으로 착각한다.
            #
            # 12줄을 보는 이유: 이 표시는 파일의 마지막 줄이 아니다. Postgres
            # 16.14는 그 뒤에 빈 줄과 \unrestrict <토큰>을 더 붙인다 — 끝을
            # 3줄만 보면 정상 백업이 실패로 판정된다(실제로 겪었다). 판 올림으로
            # 꼬리가 더 길어져도 견디도록 여유를 뒀다.
            $tail = Get-Content $file -Tail 12 -ErrorAction SilentlyContinue
            $ok = ($tail -join "`n") -match 'PostgreSQL database dump complete'
        }

        if ($ok) {
            $backupMade = $true
            $mb = [math]::Round((Get-Item $file).Length / 1MB, 1)
            Write-Ok "$([IO.Path]::GetFileName($file))  (${mb} MB)"
            Write-Info $BackupDir
        } else {
            Write-Warn2 "백업에 실패했습니다 — 컨테이너를 끄지 않고 멈춥니다."
            if ($dump.Output) { Write-Host $dump.Output }
            if (Test-Path $file) { Rename-Item $file "$([IO.Path]::GetFileName($file)).실패" }
            exit 1
        }

        $kept = @(Get-ChildItem $BackupDir -Filter '*.sql' -ErrorAction SilentlyContinue)
        if ($kept.Count -gt $WarnAfter) {
            $totalMb = [math]::Round(($kept | Measure-Object Length -Sum).Sum / 1MB, 0)
            Write-Warn2 "백업이 $($kept.Count)개 (${totalMb} MB) 쌓였습니다. 오래된 것은 지워도 됩니다."
        }
    }
}

if ($BackupOnly) {
    Write-Host ""
    Write-Host "백업만 했습니다 — 서버와 DB는 켜져 있습니다." -ForegroundColor White
    Write-Host ""
    exit 0
}

# ── 2.5 안 올린 것이 있으면 여기서 멈춘다 ──────────────────────────────────
# 백업 뒤에 놓은 이유: 되돌릴 수 없는 손실은 DB 쪽이다. 커밋 안 한 코드는
# 작업 폴더에 그대로 있으니 지금 커밋하면 되지만, 백업을 거른 날은 되돌릴
# 방법이 없다. 그래서 백업은 마치고, 되돌릴 수 있는 '끄는 일'만 막는다.
if ($blockers.Count -gt 0) {
    if ($Force) {
        Write-Warn2 "-Force — 안 올린 것이 있지만 그대로 종료합니다 ($($blockers -join ', '))"
    } else {
        Write-Host ""
        Write-Host "════ 종료를 멈췄습니다 ════" -ForegroundColor Yellow
        foreach ($b in $blockers) { Write-Host "  $($b)가 남아 있습니다." -ForegroundColor Yellow }
        if ($DryRun) {
            Write-Host "  [연습 모드] 백업도 뜨지 않았고, 아무것도 끄지 않았습니다." -ForegroundColor Gray
        } elseif ($backupMade) {
            Write-Host "  DB 백업은 마쳤고, 서버와 DB는 켜둔 채입니다." -ForegroundColor Gray
        } else {
            Write-Host "  DB가 꺼져 있어 백업은 건너뛰었고, 서버는 켜둔 채입니다." -ForegroundColor Gray
        }
        Write-Host "  커밋 후 다시 실행하거나, 그대로 끄려면:" -ForegroundColor Gray
        Write-Host "    npm run work:end -- -Force" -ForegroundColor DarkGray
        Write-Host "    (또는) powershell -File .\scripts\end-work.ps1 -Force" -ForegroundColor DarkGray
        Write-Host ""
        exit 1
    }
}

# ── 3. 개발 서버 ──────────────────────────────────────────────────────────
Write-Step "개발 서버 종료"
$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
    Write-Ok "이미 꺼져 있음"
} else {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -notin @('node', 'next-server')) {
        # 3000번을 쓰는 것이 우리 서버가 아니면 건드리지 않는다.
        Write-Warn2 "3000번 포트를 '$($proc.ProcessName)'이 쓰고 있어 그대로 둡니다."
    } elseif ($DryRun) {
        Write-Info "종료할 프로세스: $($proc.ProcessName) (PID $($proc.Id))"
    } else {
        Stop-Process -Id $proc.Id -Force
        Write-Ok "종료됨 (PID $($proc.Id))"
    }
}

# ── 4. 컨테이너 정지 (자료는 그대로 남는다) ───────────────────────────────
Write-Step "DB 컨테이너 정지"
if ($running -ne $Container) {
    Write-Ok "이미 꺼져 있음"
} elseif ($DryRun) {
    Write-Info "실행할 명령: docker stop $Container"
} else {
    $stop = Invoke-Native "docker stop $Container"
    if ($stop.ExitCode -eq 0) {
        Write-Ok "정지됨 — 자료는 볼륨에 그대로 남아 있습니다"
    } else {
        Write-Warn2 "정지 실패:"; Write-Host $stop.Output
    }
}

Write-Host ""
Write-Host "════ 정리 끝 ════" -ForegroundColor White
Write-Host "  다시 시작할 때: 바탕화면의 '작업 시작'" -ForegroundColor DarkGray
Write-Host ""
