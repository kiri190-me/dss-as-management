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

    다만 HANDOFF.md가 낡은 것은 알리기만 하고 지나간다 — 문서는 잃어버릴 수
    있는 자산이 아니라서 문을 잠글 이유가 없다.

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
# HANDOFF.md를 손대지 않은 채 이보다 많이 커밋했으면 낡은 것으로 본다. 10개는
# 하루 이틀치 작업량이다 — 그보다 오래 방치되면 다음 세션이 읽는 맥락이 지금
# 코드와 어긋나기 시작한다.
$HandoffStaleAfter = 10

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

# HANDOFF.md는 gitignore 대상이라 위의 `git status --porcelain`에 아예 잡히지
# 않는다. 그래서 여기까지 전부 초록불이어도 다음 세션이 이어받을 문서만 몇 주째
# 옛날 그대로일 수 있다 — 실제로 6일, 커밋 수십 개 동안 아무 말도 없었다.
#
# 커밋 이력 대신 파일 수정 시각을 기준으로 센다: untracked라
# `git log -- HANDOFF.md`가 아무것도 돌려주지 않기 때문이다. 고친 시각 이후로
# 커밋이 몇 개 쌓였는지가 곧 "문서가 얼마나 뒤처졌는가"다.
$handoffFile = Join-Path $RepoRoot 'HANDOFF.md'
if (Test-Path $handoffFile) {
    $handoffTime  = (Get-Item $handoffFile).LastWriteTime
    $sinceHandoff = (Invoke-Native "git rev-list --count --since=`"$($handoffTime.ToString('yyyy-MM-ddTHH:mm:ss'))`" HEAD").Output

    # 숫자가 아니면(저장소가 아니거나 git이 투덜댔거나) 조용히 넘어간다. 셀 수
    # 없는 것을 경고로 만들면 헛경보만 늘고, 그러다 진짜 경고까지 같이 흘린다.
    # 0개일 때도 마찬가지 — 그 뒤로 커밋이 없으면 뒤처질 일 자체가 없다.
    if ($sinceHandoff -match '^\d+$' -and [int]$sinceHandoff -gt 0) {
        if ([int]$sinceHandoff -gt $HandoffStaleAfter) {
            # 일부러 $blockers에 넣지 않는다. 낡은 문서는 되돌릴 수 없는 손실이
            # 아니다 — 코드도 DB도 멀쩡하고, 문서는 내일 고쳐도 늦지 않다.
            # 게다가 이런 걸로 문을 잠그면 -Force가 손버릇이 되어, 정작 코드를
            # 못 올린 날의 경고까지 같은 손짓으로 넘겨 버리게 된다.
            Write-Warn2 "HANDOFF.md를 고친 뒤로 커밋이 $($sinceHandoff)개 — 다음 세션이 옛날 맥락을 읽게 됩니다"
            Write-Info "마지막 수정: $($handoffTime.ToString('yyyy-MM-dd HH:mm'))"
        } else {
            Write-Ok "HANDOFF.md는 최근 것입니다 (그 뒤 커밋 $($sinceHandoff)개)"
        }
    }
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

# ── 2.1 사진 백업 ─────────────────────────────────────────────────────────
# 사진은 DB와 **한 쌍이라야** 쓸모가 있다. 디스크에 놓인 파일 이름은 첨부
# ID(UUID)라 그 자체로는 어느 건의 무슨 사진인지 말해 주지 않는다 — 원본
# 파일명·분류·설명·올린 사람은 전부 attachments 표에만 있다. 그래서 DB를 뜬
# 날에만 사진을 뜬다. 한쪽만 있는 백업은 되살릴 때 쓸 수가 없다.
#
# 순서가 DB 먼저인 것도 같은 이유다. 업로드는 파일을 **먼저** 최종 자리에
# 놓고 DB 기록을 나중에 남긴다. 그래서 먼저 뜬 덤프에 적힌 사진은 이미
# 디스크에 있어 반드시 복사된다. 반대로 하면 "목록에는 있는데 파일이 없는"
# 사진이 생긴다.
#
# 실제 일은 scripts/backup-attachments.ts가 한다 — run-nightly-purge.ps1과
# 같은 구조다. 이 시스템은 사내 NAS(컨테이너 안은 Linux)로 옮기는 것을 전제로
# 설계돼 있어서, 옮긴 뒤에도 그대로 도는 쪽에 판단을 둔다.
Write-Step "사진 백업"
Write-Warn2 "같은 디스크(C:)에 둡니다 — 실수로 지운 것은 되살리지만, 디스크가 고장 나면 사진도 함께 잃습니다."

# 연습 모드에서는 위에서 덤프를 실제로 뜨지 않으므로 $backupMade가 늘 거짓이다.
# 그것을 "DB 백업 실패"로 읽으면 연습 모드에서는 이 단계가 영영 화면에 나타나지
# 않아 무엇이 도는지 확인할 수가 없다 — DB가 켜져 있었는지로 대신 가른다.
$photosPaired = $backupMade -or ($DryRun -and $running -eq $Container)

if (-not $photosPaired) {
    Write-Warn2 "DB 백업을 건너뛰어 사진도 건너뜁니다 — DB 없이 뜬 사진은 되살릴 수 없습니다."
} else {
    $photoCmd = 'npm run backup:attachments'
    if ($DryRun) { $photoCmd = 'npm run backup:attachments -- --dry-run' }

    $photo = Invoke-Native $photoCmd
    if ($photo.Output) {
        # npm과 dotenv가 앞에 붙이는 머리말은 걷어 낸다. 걷어 내는 것은 그 두
        # 줄뿐이라, 실패했을 때의 어긋난 목록은 그대로 흘러나온다.
        $photo.Output -split "`n" |
            Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\s*>' -and $_ -notmatch 'injected env' } |
            ForEach-Object { Write-Info $_.TrimEnd() }
    }

    if ($photo.ExitCode -eq 0) {
        if ($DryRun) {
            Write-Ok "연습 모드 — 복사 계획만 확인했고 아무것도 쓰지 않았습니다"
        } else {
            Write-Ok "사진 백업 완료 — DB에 적힌 첨부가 전부 있고 지문도 맞습니다"
        }
    } else {
        # DB 백업 실패와 똑같이 다룬다: 알리고, 아무것도 끄지 않고, 멈춘다.
        Write-Warn2 "사진 백업에 실패했습니다 — 컨테이너를 끄지 않고 멈춥니다."
        exit 1
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
