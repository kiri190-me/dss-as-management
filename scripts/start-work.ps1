#Requires -Version 5.1
<#
.SYNOPSIS
    작업 시작 — Docker와 DB를 켜고, 떠날 때의 상태를 그대로 확인한 뒤 개발 서버를 띄운다.

.DESCRIPTION
    end-work.ps1과 짝이다. 저쪽이 "덮고 나가기"라면 이쪽은 "펴고 앉기"다.

    순서에 이유가 있다. 서버부터 띄우면 DB가 아직 안 올라와서 화면이 에러로 뜨고,
    사람은 그게 코드 문제인지 DB 문제인지 구분하지 못한 채 디버깅을 시작한다.
    그래서 엔진 → DB → 상태 확인 → 서버 순으로 하나씩 확인하며 올라간다.

    ── 마이그레이션을 자동으로 적용하지 않는 이유 ─────────────────────────
    적용 대기가 있으면 알려만 주고 멈추지 않는다. 자동 적용은 하지 않는다 —
    마이그레이션은 자료를 지울 수 있고, 그 판단은 사람이 db:preflight를 보고
    내려야 한다. 아침에 창을 하나 열었을 뿐인데 표가 사라져 있으면 안 된다.

    ── DB가 이 저장소의 것이 아닌 이유 ─────────────────────────────────────
    2026-09-03부터 이 PC의 DB는 NAS와 같은 모양의 공용 인스턴스 둘이다.
    A/S는 계측기와 dss-pg-app 하나를 나눠 쓴다. 그래서 이 스크립트는 저장소의
    docker-compose.yml(db-dev)을 켜지 않고, dss-deploy가 만든 컨테이너를 켠다.
    자세한 것은 dss-deploy\runbook\01-postgres-통합.md 9절 부록.

.PARAMETER WithClaude
    개발 서버와 함께 Claude Code를 별도 창으로 띄운다. 바탕화면 단축어는 이걸 켜서 부른다.

.PARAMETER NoServer
    개발 서버는 띄우지 않고 상태 확인까지만 한다.

.EXAMPLE
    .\scripts\start-work.ps1
#>
[CmdletBinding()]
param(
    [switch]$WithClaude,
    [switch]$NoServer
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$RepoRoot      = Split-Path -Parent $PSScriptRoot
$DevRoot       = Split-Path -Parent $RepoRoot
$DevUrl        = 'http://localhost:3000'
$DockerDesktop = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'

# ── DB는 저장소마다 하나가 아니라 공용 인스턴스다 (2026-09-03) ──────────────
# NAS 이식 2단계 리허설 뒤로 이 PC의 DB는 dss-pg-app(A/S·계측기 공용)과
# dss-pg-auth(포털) 둘뿐이다. NAS에 세울 것과 같은 모양이라, 여기서 검증된 것이
# 그대로 NAS로 간다. 정의는 dss-deploy\nas\docker-compose.rehearsal.yml 한 곳에만
# 있고, 이 스크립트는 그 파일로 만든 컨테이너를 켜고 기다릴 뿐 자기 compose
# (docker-compose.yml의 db-dev)는 더 쓰지 않는다. 옛 dss-as-postgres-dev는
# 정지된 채 2026-09-17까지 되돌리기용으로만 남는다.
$DbContainer   = 'dss-pg-app'
$DbService     = 'db-app'      # 리허설 compose 안의 서비스 이름
$DbPort        = 5442
$Database      = 'dss_as'
$DbCompose     = Join-Path $DevRoot 'dss-deploy\nas\docker-compose.rehearsal.yml'
$DbEnvFile     = Join-Path $DevRoot 'dss-deploy\nas\.env.nas'

# 네이티브 명령은 cmd를 거쳐 부른다. Windows PowerShell 5.1은 exe의 stderr를
# ErrorRecord로 감싸면서 성공한 명령도 실패로 보이게 만들기 때문이다.
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
Write-Host "════ 작업 시작 ════" -ForegroundColor White
Write-Host "  $RepoRoot" -ForegroundColor DarkGray

# ── 1. Docker 엔진 ────────────────────────────────────────────────────────
Write-Step "Docker 엔진 확인"
if ((Invoke-Native 'docker info --format "{{.ServerVersion}}"').ExitCode -ne 0) {
    if (-not (Test-Path $DockerDesktop)) {
        Write-Warn2 "Docker Desktop을 찾을 수 없습니다: $DockerDesktop"
        Write-Info "직접 실행한 뒤 이 스크립트를 다시 돌려 주세요."
        exit 1
    }
    Write-Info "꺼져 있습니다. Docker Desktop을 실행합니다 (최대 3분 대기)…"
    Start-Process $DockerDesktop | Out-Null

    $ready = $false
    foreach ($i in 1..90) {
        Start-Sleep -Seconds 2
        if ((Invoke-Native 'docker info --format "{{.ServerVersion}}"').ExitCode -eq 0) { $ready = $true; break }
        if ($i % 10 -eq 0) { Write-Info "아직 준비 중… ($($i*2)초)" }
    }
    if (-not $ready) {
        Write-Warn2 "3분 안에 준비되지 않았습니다. Docker Desktop 창을 확인해 주세요."
        exit 1
    }
}
Write-Ok "엔진 준비됨"

# ── 2. DB 인스턴스 (공용) ─────────────────────────────────────────────────
Write-Step "DB 인스턴스 확인 ($DbContainer)"
$exists = (Invoke-Native "docker ps -a --filter name=^/$DbContainer`$ --format `"{{.Names}}`"").Output
if ($exists -ne $DbContainer) {
    # 처음 한 번만 여기로 온다. 만드는 파일은 dss-deploy에 있고, 비밀번호는
    # 그 옆의 .env.nas에서 온다 — 없으면 빈 값으로 만들어져 재시작 루프에 빠지므로
    # 미리 막는다.
    if (-not (Test-Path $DbCompose)) {
        Write-Warn2 "공용 DB 인스턴스가 없고 만들 파일도 없습니다: $DbCompose"
        Write-Info "dss-deploy 저장소를 Development\ 아래에 받아 온 뒤 다시 시작하세요."
        exit 1
    }
    if (-not (Test-Path $DbEnvFile)) {
        Write-Warn2 "비밀번호 파일이 없습니다: $DbEnvFile"
        Write-Info "dss-deploy\README.md 1단계 2번대로 .env.nas 를 채운 뒤 다시 시작하세요."
        exit 1
    }
    Write-Info "컨테이너가 없습니다. dss-deploy 의 리허설 compose 로 새로 만듭니다."
    $up = Invoke-Native "docker compose -f `"$DbCompose`" --env-file `"$DbEnvFile`" up -d $DbService"
    if ($up.ExitCode -ne 0) {
        Write-Warn2 "생성 실패:"; Write-Host $up.Output
        exit 1
    }
} else {
    # 이미 만들어진 컨테이너는 start로 켠다 — 비밀번호 파일이 필요 없고,
    # 볼륨(=자료)이 그대로 다시 붙는다. 계측기 쪽이 먼저 켜 두었으면 그냥 지나간다.
    Invoke-Native "docker start $DbContainer" | Out-Null
}

$healthy = $false
foreach ($i in 1..30) {
    $state = (Invoke-Native "docker inspect -f `"{{.State.Health.Status}}`" $DbContainer").Output
    if ($state -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    Write-Warn2 "DB가 60초 안에 준비되지 않았습니다."
    Write-Info "docker logs $DbContainer --tail 30 으로 원인을 볼 수 있습니다."
    exit 1
}
Write-Ok "DB 준비됨 (127.0.0.1:$DbPort · $Database)"

# ── 3. 떠날 때의 상태 그대로인지 ──────────────────────────────────────────
Write-Step "지난 작업 상태"
$commit = (Invoke-Native 'git log -1 --format="%h  %ad  %s" --date=format:"%Y-%m-%d %H:%M"').Output
Write-Info "마지막 커밋  $commit"

$branch  = (Invoke-Native 'git branch --show-current').Output
$unpushed = (Invoke-Native 'git rev-list --count "@{u}..HEAD"').Output
$dirty    = @((Invoke-Native 'git status --porcelain').Output -split "`n" | Where-Object { $_ -ne '' }).Count
Write-Info "브랜치       $branch"
if ($unpushed -match '^\d+$' -and [int]$unpushed -gt 0) { Write-Warn2 "깃허브에 안 올린 커밋 $($unpushed)개" }
if ($dirty -gt 0) { Write-Warn2 "커밋 안 된 파일 $($dirty)개" }
if ($dirty -eq 0 -and $unpushed -eq '0') { Write-Ok "깃허브와 같음 — 정리된 상태" }

$counts = (Invoke-Native "docker exec $DbContainer psql -U dss_app -d $Database -At -c ""select 'A/S 접수 '||count(*)||'건' from repair_cases""").Output
if ($counts) { Write-Info "DB 내용     $counts" }

# ── 4. 적용 대기 마이그레이션 (알림만) ────────────────────────────────────
Write-Step "DB 구조 점검"
$pf = Invoke-Native 'npm run --silent db:preflight'
$pf.Output -split "`n" | Where-Object { $_ -match '\S' } | ForEach-Object { Write-Info $_ }
if ($pf.ExitCode -eq 1) {
    Write-Warn2 "적용하면 사라지는 자료가 있습니다. 적용은 자동으로 하지 않았습니다."
    Write-Info "확인 후 직접: npm run db:migrate"
}

if ($NoServer) {
    Write-Host ""
    Write-Host "준비 완료 (서버는 띄우지 않음). 띄우려면: npm run dev" -ForegroundColor White
    exit 0
}

# ── 5. Claude Code (선택) ────────────────────────────────────────────────
if ($WithClaude) {
    Write-Step "Claude Code 실행"
    $claude = (Get-Command claude -ErrorAction SilentlyContinue)
    if (-not $claude) {
        Write-Warn2 "claude 명령을 찾을 수 없어 건너뜁니다."
        Write-Info "설치: npm install -g @anthropic-ai/claude-code"
    } else {
        # 개발 서버는 이 창을 계속 쓰므로 Claude는 별도 창으로 띄운다.
        # 한 창에 둘을 넣으면 서버 로그와 대화가 뒤섞여 둘 다 읽기 어려워진다.
        Start-Process cmd -ArgumentList '/c', "title Claude - RF_Service_System && cd /d `"$RepoRoot`" && claude" | Out-Null
        Write-Ok "별도 창에서 실행 중"
    }
}

# ── 6. 개발 서버 ──────────────────────────────────────────────────────────
Write-Step "개발 서버 시작"
Write-Info "$DevUrl — 이 창을 닫으면 서버도 꺼집니다."
Write-Host ""

# 서버가 실제로 응답하면 그때 브라우저를 연다. 컴파일 전에 열면 빈 화면을 보게 된다.
$waiter = @"
foreach (`$i in 1..120) {
    Start-Sleep -Seconds 1
    try {
        Invoke-WebRequest -Uri '$DevUrl' -UseBasicParsing -TimeoutSec 2 | Out-Null
        Start-Process '$DevUrl'
        break
    } catch {}
}
"@
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $waiter | Out-Null

& npm run dev
