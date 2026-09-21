<#
================================================================================
 교산 연락서 옛 형식(`.xls`) → `.xlsm` 변환 — 사본만 만드는 도구
================================================================================
 앞으로 연락서를 읽어 수리 건을 자동으로 채우는 **판독기**를 만든다. 이 스크립트는
 그 준비다 — 판독기가 **읽을 수조차 없는 파일**을 읽을 수 있는 형식으로 바꿔 둔다.

 ── 왜 바꿔야 하는가 ──────────────────────────────────────────────────────
 `.xls` 는 OLE2 바이너리 복합 문서다. 이 저장소의 `src/lib/xlsx/zip-reader.ts` 는
 ZIP 항목을 풀어 XML 을 읽으므로 `.xls` 는 한 장도 못 연다. `.xlsm` 은 확장자만
 다를 뿐 속이 ZIP+XML 이라 이미 있는 도구가 그대로 읽는다. 그래서 **형식만** 바꾼다.

 ── 🔴 NAS 원본은 한 글자도 건드리지 않는다 ───────────────────────────────
 이 스크립트가 NAS 에 하는 일은 `Copy-Item` **읽기 한 번**이 전부다. NAS 에 쓰거나
 옮기거나 지우는 명령은 이 파일 어디에도 없다. 변환은 전부 로컬 사본에서 한다.

 그리고 **엑셀에게 NAS 경로를 주지 않는 것**이 이 설계의 핵심이다. 엑셀은 문서를
 열 때 그 문서 **옆에** `~$이름.xls` 잠금 파일을 만든다. 읽기 전용으로 열어도
 만들 수 있다. NAS 파일을 직접 열게 했다면 남의 업무 폴더 143곳에 쓰레기 파일이
 생긴다(실제로 NAS 에는 그렇게 남겨진 `~$` 파일이 31개 있다). 그래서
 **① 로컬로 먼저 복사하고 ② 사본만 연다.** 잠금 파일이 생겨도 `%TEMP%` 에 생긴다.

 ── 번호 이름을 쓰는 까닭 ─────────────────────────────────────────────────
 연락서 파일 이름에는 고객사·모델·L/N·S/N 이 그대로 들어 있다
 (`Repair_Report_<모델>_<S/N>.xls` 꼴). 사본을 `0001.xls` 처럼 번호로만 부르면
 로그·보고서·화면 어디에도 고객 정보가 새지 않는다. 원본이 무엇이었는지는
 매핑 파일(`kyosan-xls-map.tsv`)에만 적어 로컬에 둔다. 이미 만들어진 `.xlsm`
 쪽(`kyosan-xlsm-map.tsv`)과 같은 방식이다.

 ── 🔴 엑셀 자동화에서 반드시 지키는 것 ───────────────────────────────────
  · `Visible = $false`            — 창을 띄우지 않는다.
  · `DisplayAlerts = $false`      — 대화상자가 하나라도 뜨면 143장이 통째로 멈춘다.
  · `AutomationSecurity = 3`      — msoAutomationSecurityForceDisable. **매크로를
    실행하지 않는다.** 연락서에 매크로가 들어 있을 수 있고, 사람이 보지 않는 중에
    남의 매크로가 도는 것은 그 자체로 사고다. 매크로 **코드는 그대로 옮겨 담긴다**
    (형식 52 가 VBA 를 품는다) — 실행만 막는 설정이다.
  · `EnableEvents = $false`       — 문서를 여는 순간 도는 `Workbook_Open` 류를 막는다.
    AutomationSecurity 와 겹쳐 보이지만 막는 길이 다르다. 둘 다 건다.
  · `AskToUpdateLinks = $false`   — 바깥 파일을 참조하는 연락서에서 뜨는 물음을 막는다.
  · `Open(..., ReadOnly = $true)` — 사본조차 고치지 않는다. 연 파일은 늘 `Close($false)`.
  · 비밀번호 자리에 **아무 말이나 넣는다** — 비밀번호 걸린 파일을 만나면 암호 창이
    뜨는데, 그 창은 `DisplayAlerts` 로 막히지 않아 자동화가 영영 멈춘다. 틀린
    비밀번호를 미리 주면 창 대신 **오류**가 나고, 오류는 아래에서 잡아 넘어간다.
    🔴 단, **쓰기 예약 비밀번호 자리는 15자를 넘기면 안 된다** — 넘기면 멀쩡한
    파일까지 전부 열리지 않는다. 이 덫에 한 번 걸렸다(아래 상수 주석 참조).
  · 끝나면 `Quit()` 하고 COM 객체를 `ReleaseComObject` 로 놓아준다. 안 놓으면
    `EXCEL.EXE` 가 프로세스 목록에 쌓인 채 남는다. 그래도 남으면 **우리가 띄운
    것만** 골라 정리한다(시작 전 PID 를 찍어 두고 견준다 — 사용자가 따로 열어 둔
    엑셀을 죽이면 그 사람의 작업이 날아간다).

 ── 한 장이 실패해도 멈추지 않는다 ────────────────────────────────────────
 143장 중 몇 장은 깨져 있거나 비밀번호가 걸려 있을 수 있다. 한 장 때문에 전체가
 멈추면 두 시간이 날아간다. 그래서 파일마다 `try/catch` 로 감싸고, 실패는 **번호와
 사유만** 모아 마지막에 적는다(파일 이름은 적지 않는다 — 위 "번호 이름" 참조).

 ── 쓰는 법 ───────────────────────────────────────────────────────────────
   powershell -ExecutionPolicy Bypass -File scripts/convert-kyosan-xls-to-xlsm.ps1
   powershell -ExecutionPolicy Bypass -File scripts/convert-kyosan-xls-to-xlsm.ps1 -Limit 3
   powershell -ExecutionPolicy Bypass -File scripts/convert-kyosan-xls-to-xlsm.ps1 -SkipCopy

 `-Limit` 은 앞에서 N장만 해 보는 시험용이다(번호는 그대로라 나중에 전체를 돌려도
 같은 파일이 같은 번호를 받는다). `-SkipCopy` 는 복사는 이미 끝났고 변환만 다시
 할 때 쓴다. 이미 변환된 장은 건너뛰므로 중간에 끊겨도 이어서 돌리면 된다.
================================================================================
#>

[CmdletBinding()]
param(
    # 메인 세션이 미리 뽑아 둔 대상 목록. 한 줄에 파일 하나의 전체 경로.
    [string] $ListPath = (Join-Path $env:TEMP 'kyosan-since-D21.txt'),

    # NAS 원본을 번호 이름으로 받아 둘 로컬 폴더.
    [string] $SrcDir = (Join-Path $env:TEMP 'kyosan-xls-src'),

    # 사본이름 <탭> 원본전체경로.
    [string] $MapPath = (Join-Path $env:TEMP 'kyosan-xls-map.tsv'),

    # 변환 결과(`.xlsm`)가 쌓일 폴더.
    [string] $OutDir = (Join-Path $env:TEMP 'kyosan-xls-converted'),

    # 진행 기록. 명령이 시간 초과로 배경에 넘어가도 이 파일로 진행을 볼 수 있다.
    [string] $LogPath = (Join-Path $env:TEMP 'kyosan-xls-convert.log'),

    # 실패한 장의 번호와 사유.
    [string] $FailPath = (Join-Path $env:TEMP 'kyosan-xls-failures.tsv'),

    # 0 이면 전부. 시험 삼아 몇 장만 돌릴 때 쓴다.
    [int] $Limit = 0,

    # 복사 단계를 건너뛴다(이미 `-SrcDir` 에 사본이 있을 때).
    [switch] $SkipCopy
)

$ErrorActionPreference = 'Stop'

# 한글이 콘솔에서 깨지지 않게. 로그 파일은 어차피 UTF-8 로 따로 쓴다.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

# xlOpenXMLWorkbookMacroEnabled. `.xlsm` — 매크로를 **품을 수 있는** ZIP 형식이다.
$XL_OPEN_XML_MACRO_ENABLED = 52

# msoAutomationSecurityForceDisable. 매크로를 묻지도 않고 끈다.
$MSO_AUTOMATION_SECURITY_FORCE_DISABLE = 3

# 비밀번호 창을 오류로 바꾸기 위한 헛 비밀번호. 맞을 리 없는 값이어야 한다.
$DUMMY_PASSWORD = 'dss-no-password-on-purpose'

# 🔴 **쓰기 예약 비밀번호는 15자까지다.** 16자를 넘기면 파일이 멀쩡해도 Open 이
# `0x800A03EC`("Workbooks 클래스 중 Open 속성을 구할 수 없습니다")로 죽는다 —
# 파일 탓처럼 보이지만 인자 탓이다. 실측으로 확인했다(14·15자 성공, 16·17자 실패).
# 읽기 비밀번호(위)는 255자까지라 길어도 되지만, 이 자리는 반드시 짧아야 한다.
$DUMMY_WRITE_PASSWORD = 'dss-no-write'

# 진행을 몇 장마다 찍을지.
$PROGRESS_EVERY = 10

function Write-Log {
    param([string] $Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
    Write-Host $line
    # Add-Content 는 인코딩을 매번 지정해야 한다 — 안 하면 PS 5.1 이 ANSI 로 적어
    # 나중에 로그를 읽는 쪽에서 한글이 깨진다.
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

# BOM 없는 UTF-8 로 적는다. `Set-Content -Encoding UTF8` 은 PS 5.1 에서 BOM 을 붙이고,
# 그 BOM 이 TSV 첫 줄 첫 칸에 보이지 않는 글자로 붙어 대조를 어긋나게 한다.
function Write-Utf8Lines {
    param([string] $Path, [string[]] $Lines)
    [System.IO.File]::WriteAllLines($Path, $Lines, (New-Object System.Text.UTF8Encoding $false))
}

# ── 0. 대상 고르기 ────────────────────────────────────────────────────────────

if (-not (Test-Path -LiteralPath $ListPath)) {
    throw "대상 목록을 찾지 못했습니다: $ListPath"
}

$allLines = Get-Content -LiteralPath $ListPath -Encoding UTF8

$targets = @(
    $allLines |
        Where-Object { $_.Trim().Length -gt 0 } |
        Where-Object {
            $name = [System.IO.Path]::GetFileName($_)
            # 🔴 `~$…` 는 연락서가 아니라 엑셀이 남긴 잠금 파일이다(165바이트, 안에
            # 연 사람 이름만 있다). 목록에 31개 섞여 있다. 반드시 뺀다.
            if ($name.StartsWith('~$')) { return $false }
            # `.xlsx`·`.xlsm` 이 아니라 **정확히 `.xls`** 인 것만. 접미사 비교
            # (`EndsWith('.xls')`)로는 안 된다 — 여기서는 확장자를 잘라 견준다.
            [System.IO.Path]::GetExtension($name).ToLowerInvariant() -eq '.xls'
        } |
        # 경로 오름차순으로 못 박는다. 이러면 몇 번을 돌려도 같은 파일이 같은
        # 번호를 받는다 — 번호가 흔들리면 매핑 파일이 거짓말이 된다.
        Sort-Object -Culture ([System.Globalization.CultureInfo]::InvariantCulture)
)

if ($targets.Count -eq 0) { throw "목록에서 .xls 를 하나도 찾지 못했습니다: $ListPath" }

# 번호는 **전체 목록 기준**으로 먼저 매기고, `-Limit` 은 그 뒤에 자른다.
$jobs = @()
for ($i = 0; $i -lt $targets.Count; $i++) {
    $jobs += [pscustomobject]@{
        Number = $i + 1
        Stem   = '{0:d4}' -f ($i + 1)
        Source = $targets[$i]
    }
}

# 매핑 파일은 **언제나 전체**를 적는다. `-Limit` 으로 3장만 돌렸다고 매핑이 3줄로
# 줄어들면, 다음 사람이 그 파일을 보고 "143장 중 3장만 있었다" 고 잘못 읽는다.
Write-Utf8Lines -Path $MapPath -Lines @($jobs | ForEach-Object { "$($_.Stem).xls`t$($_.Source)" })

if ($Limit -gt 0 -and $Limit -lt $jobs.Count) { $jobs = $jobs[0..($Limit - 1)] }

New-Item -ItemType Directory -Force -Path $SrcDir  | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir  | Out-Null

'' | Out-File -LiteralPath $LogPath -Encoding UTF8   # 이번 실행분으로 새로 시작
Write-Log ("대상 {0}장 (목록 {1}줄 중 .xls 만) · 이번 실행 {2}장" -f $targets.Count, $allLines.Count, $jobs.Count)
Write-Log "매핑: $MapPath"

# ── 1. NAS → 로컬 복사 (🔴 읽기만) ────────────────────────────────────────────

$failures = New-Object System.Collections.Generic.List[object]

if ($SkipCopy) {
    Write-Log '복사 단계를 건너뜁니다(-SkipCopy).'
} else {
    $copied = 0
    foreach ($job in $jobs) {
        $dest = Join-Path $SrcDir "$($job.Stem).xls"
        try {
            if (-not (Test-Path -LiteralPath $job.Source)) { throw '원본을 찾지 못함' }
            # 🔴 NAS 에 닿는 유일한 줄. 방향은 NAS → 로컬 한쪽뿐이다.
            Copy-Item -LiteralPath $job.Source -Destination $dest -Force
            $copied++
        } catch {
            $failures.Add([pscustomobject]@{ Number = $job.Number; Stage = '복사'; Reason = $_.Exception.Message })
        }
        if ($copied % 50 -eq 0 -and $copied -gt 0) { Write-Log "복사 $copied / $($jobs.Count)" }
    }
    Write-Log "복사 끝 — 성공 $copied / $($jobs.Count)"
}

# ── 2. 엑셀로 변환 ────────────────────────────────────────────────────────────

# 우리가 띄우기 **전에** 이미 돌던 엑셀. 마지막 정리에서 이 PID 들은 건드리지 않는다
# — 사용자가 열어 둔 문서를 죽이면 저장 안 된 작업이 날아간다.
$priorExcelPids = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
Write-Log "시작 전 EXCEL.EXE: $($priorExcelPids.Count)개"

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AutomationSecurity = $MSO_AUTOMATION_SECURITY_FORCE_DISABLE
$excel.EnableEvents = $false
$excel.AskToUpdateLinks = $false
$excel.ScreenUpdating = $false

$converted = 0
$skipped = 0
$done = 0

try {
    foreach ($job in $jobs) {
        $done++
        $src = Join-Path $SrcDir "$($job.Stem).xls"
        $dst = Join-Path $OutDir "$($job.Stem).xlsm"

        if (-not (Test-Path -LiteralPath $src)) {
            $failures.Add([pscustomobject]@{ Number = $job.Number; Stage = '변환'; Reason = '사본이 없음(복사 실패)' })
            continue
        }
        # 이미 만들어 둔 것은 다시 하지 않는다 — 중간에 끊겨도 이어서 돌릴 수 있다.
        if (Test-Path -LiteralPath $dst) { $skipped++; continue }

        $wb = $null
        try {
            # 인자 차례: Filename, UpdateLinks(0=안 함), ReadOnly, Format, Password,
            # WriteResPassword, IgnoreReadOnlyRecommended, Origin, Delimiter,
            # Editable, Notify(=$false: 못 열면 알림 대신 오류), Converter, AddToMru.
            $wb = $excel.Workbooks.Open(
                $src, 0, $true, [Type]::Missing, $DUMMY_PASSWORD, $DUMMY_WRITE_PASSWORD, $true,
                [Type]::Missing, [Type]::Missing, $false, $false, [Type]::Missing, $false)

            # 형식을 낮은 쪽으로 맞추는지 묻는 검사기를 끈다. DisplayAlerts 로도
            # 대개 막히지만, 이쪽이 막는 자리가 더 앞이다.
            try { $wb.CheckCompatibility = $false } catch { }

            $wb.SaveAs($dst, $XL_OPEN_XML_MACRO_ENABLED)
            $converted++
        } catch {
            # 사유에 파일 이름이 섞여 들어오는 수가 있다(엑셀이 경로를 오류문에
            # 넣는다). 사본 경로만 나오게 원본 경로는 애초에 주지 않았으므로
            # 여기 남는 이름은 `0001.xls` 뿐이다.
            $failures.Add([pscustomobject]@{ Number = $job.Number; Stage = '변환'; Reason = $_.Exception.Message })
        } finally {
            if ($wb -ne $null) {
                # 🔴 저장 안 함. SaveAs 로 이미 새 파일을 냈고, 사본조차 고치지 않는다.
                try { $wb.Close($false) } catch { }
                try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) } catch { }
                $wb = $null
            }
        }

        if ($done % $PROGRESS_EVERY -eq 0) {
            Write-Log "진행 $done / $($jobs.Count) — 변환 $converted · 건너뜀 $skipped · 실패 $($failures.Count)"
        }
    }
} finally {
    try { $excel.Quit() } catch { }
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch { }
    $excel = $null
    # COM 래퍼가 정말로 놓였는지 확인하려면 GC 를 돌려야 한다. 두 번 도는 것은
    # 관례다 — 첫 수거에서 finalizer 가 걸리고, 그 finalizer 가 놓은 것을 두 번째가 걷는다.
    [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
    [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
}

Write-Log "변환 끝 — 성공 $converted · 건너뜀(이미 있음) $skipped · 실패 $($failures.Count)"

# ── 3. 뒷정리 — 남은 EXCEL.EXE ───────────────────────────────────────────────

# `Quit()` 가 돌아왔다고 프로세스가 곧바로 사라지지는 않는다 — 잠깐 기다려 스스로
# 나가게 둔다. 그래도 남으면 아래에서 끊는다(열어 둔 문서가 없으니 잃을 것은 없다).
Start-Sleep -Seconds 5
$leftover = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue |
    Where-Object { $priorExcelPids -notcontains $_.Id })

if ($leftover.Count -gt 0) {
    Write-Log "우리가 띄운 EXCEL.EXE 가 $($leftover.Count)개 남아 정리합니다."
    foreach ($process in $leftover) {
        try { Stop-Process -Id $process.Id -Force } catch { Write-Log "정리 실패 PID $($process.Id)" }
    }
    Start-Sleep -Seconds 1
}

$stillThere = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)
Write-Log "남은 EXCEL.EXE: $($stillThere.Count)개 (시작 전 $($priorExcelPids.Count)개)"

# ── 4. 실패 목록 ──────────────────────────────────────────────────────────────

$failLines = @('번호' + "`t" + '단계' + "`t" + '사유')
foreach ($failure in $failures) {
    $failLines += ('{0:d4}' -f $failure.Number) + "`t" + $failure.Stage + "`t" + ($failure.Reason -replace '\s+', ' ')
}
Write-Utf8Lines -Path $FailPath -Lines $failLines
Write-Log "실패 목록: $FailPath ($($failures.Count)건)"

$outCount = @(Get-ChildItem -LiteralPath $OutDir -Filter '*.xlsm' -File).Count
Write-Log "결과 폴더의 .xlsm: $outCount 장 — $OutDir"
