import "server-only";

import {
  QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH,
  QUOTE_FOLDER_LINK_PREFIX,
  QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH,
  isQuoteFolderRelativePath,
} from "@/lib/domain/quote-folder-link";

/**
 * ============================================================================
 * 「견적서 폴더 열기」 도우미 — PC 에 설치할 스크립트와 설치 파일의 본문을 만든다 (견적서 ④a)
 * ============================================================================
 * 브라우저는 웹 페이지에서 탐색기를 열 수 없다. 그래서 PC 마다 한 번 **현재 사용자에게만**
 * (HKCU, 관리자 권한 없음) 작은 도우미를 설치한다:
 *
 *   install-dss-folder-helper.cmd  (요청마다 서버가 만든다 — api/quote-folder-helper/installer)
 *     ├─ %LOCALAPPDATA%\DSS\open-dss-folder.ps1 을 쓴다   ← buildQuoteFolderHelperScript 의 결과
 *     └─ HKCU\Software\Classes\dss-folder 에 주소 처리기를 등록한다
 *          shell\open\command = "<powershell.exe>" -NoProfile -NonInteractive -WindowStyle Hidden
 *                               -ExecutionPolicy Bypass -File "<open-dss-folder.ps1>" "%1"
 *
 * ── 🔴 불변식 넷 ─────────────────────────────────────────────────────────
 * 이 도우미는 **다른 웹사이트도 부를 수 있는 입구**다.
 *   (a) 루트 아래의 **폴더만** 연다 — 파일 · 프로그램은 열거나 실행하지 않는다.
 *       스크립트가 주소를 풀어 domain/quote-folder-link.ts 와 **같은 규칙**으로 상대 경로를 거절하고,
 *       루트와 이어 GetFullPath 로 편 뒤 「루트 + \」 로 시작하는지(대소문자 무시) 보고, 폴더인지
 *       (Test-Path -PathType Container) 보고, 루트 아래 마디 가운데 바로 가기 폴더(정션 · 심볼릭
 *       링크 — 루트 밖을 가리킬 수 있다)가 있으면 열지 않는다. explorer.exe 에는 그 폴더 경로만,
 *       끝에 `\` 를 붙여 넘긴다(폴더로만 읽힌다).
 *   (b) 주소가 명령줄로 삽입되지 않는다 — 레지스트리 명령은 `-File "…" "%1"` 이다. `-Command` 로
 *       주소를 이어 붙이지 않는다. `-File` 뒤의 것은 전부 스크립트 인자이고, 스크립트는 인자가
 *       **정확히 하나**가 아니면(따옴표를 깨고 인자를 늘린 주소) 끝낸다. 주소의 몸통은 base64url 이다.
 *   (c) 루트(UNC)는 저장소 · 빌드 결과에 남지 않는다 — 설치 파일 · 설치 명령 본문에만 들어가고,
 *       그 본문은 요청마다 환경변수 QUOTE_ARCHIVE_UNC_ROOT 로 만든다. 로그에도 찍지 않는다.
 *       (견적서 폴더의 전체 주소를 사람에게 복사해 주는 통로는 아래 「전체 주소」 절.)
 *   (d) 공유폴더 저장 동작은 이 모듈과 무관하다(storage/quote-archive.ts).
 *
 * ── 설치 파일(.cmd)이 스크립트를 옮기는 법 ─────────────────────────────────
 * cmd 는 `%` · `^` · `&` · `!` · 따옴표를 해석한다. 스크립트 본문을 cmd 줄에 그대로 두면 깨지거나
 * 삽입이 된다. 그래서:
 *   · .cmd 파일은 **ASCII 만** 담는다(코드 페이지와 무관하게 읽힌다). 한글(스크립트 · 안내 문장)은
 *     전부 base64 덩어리(payload) 안에 있다.
 *   · cmd 가 하는 일은 자기 경로(%~f0)를 환경변수에 담고 PowerShell 을 **전체 경로로** 한 번 부르는
 *     것뿐이다(내려받은 폴더에 심어 둔 가짜 powershell.exe 를 부르지 않게). 그 `-Command` 본문에는
 *     `"` · `%` · `!` · `^` · `&` · `|` · `<` · `>` 가 없다(시험이 지킨다) — 따옴표는 [char]34,
 *     퍼센트는 [char]37 로 만든다.
 *   · PowerShell 이 .cmd 파일을 **데이터로** 읽어 `DSS-PAYLOAD-<이름>-BEGIN/END` 줄 사이의 base64 를
 *     풀고 바이트 그대로 쓴다. 풀어서 **코드로 실행하는 것은 없다**. cmd 는 `exit /b` 에서 멈추므로
 *     payload 줄을 읽지 않는다.
 *   · 레지스트리는 reg.exe 가 아니라 .NET(Microsoft.Win32.Registry)으로 쓴다 — `"%1"` 을 cmd 와
 *     reg.exe 의 따옴표 규칙 두 겹에 통과시키지 않기 위해서다. 다시 실행하면 덮어써서 고친다.
 *
 * ── 스크립트 파일은 UTF-8 BOM 으로 ─────────────────────────────────────────
 * Windows PowerShell 5.1 은 BOM 없는 .ps1 을 ANSI(한국어 Windows 는 CP949)로 읽는다. 루트 · 안내
 * 문장에 한글이 있으므로 BOM 을 붙인다(quoteFolderHelperScriptBytes).
 *
 * ── 제거 ─────────────────────────────────────────────────────────────────
 * 설치 파일 머리 주석과 스크립트 머리 주석에 적는다:
 *   reg delete "HKCU\Software\Classes\dss-folder" /f
 *   del "%LOCALAPPDATA%\DSS\open-dss-folder.ps1"
 * ============================================================================
 */

/** 도우미 루트를 담는 환경변수 — 사람이 Windows 탐색기에서 보는 공유폴더 루트(UNC). */
export const QUOTE_FOLDER_HELPER_ROOT_ENV = "QUOTE_ARCHIVE_UNC_ROOT";
/**
 * 같은 공유폴더를 가리키는 **다른 주소**(이름 ↔ IP). 없어도 된다.
 * 도우미가 첫째로 못 열면 이것으로 한 번 더 해 본다 — 이름 풀이가 안 되는 PC 가 있기 때문이다.
 */
export const QUOTE_FOLDER_HELPER_ROOT_ALT_ENV = "QUOTE_ARCHIVE_UNC_ROOT_ALT";
export const QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME = "open-dss-folder.ps1";
export const QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME = "install-dss-folder-helper.cmd";
/** 이 값이 "1" 이면 스크립트가 탐색기를 여는 대신 결과를 표준출력에 적고 끝낸다(시험용). */
export const QUOTE_FOLDER_HELPER_DRY_RUN_ENV = "DSS_FOLDER_DRY_RUN";
/** 설치 파일이 자기 경로를 PowerShell 에 넘기는 환경변수. */
export const QUOTE_FOLDER_HELPER_INSTALLER_PATH_ENV = "DSS_HELPER_INSTALLER";
/** 루트 값의 길이 상한 — 엑셀 경로 한도 계산(domain/quote-archive-naming.ts)이 가정하는 루트보다 넉넉하다. */
export const QUOTE_FOLDER_HELPER_ROOT_MAX_LENGTH = 240;

/** 설치를 마친 뒤 · 실패했을 때 사람에게 보이는 문장(payload 로 옮겨져 PowerShell 이 띄운다). */
export const QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE = [
  "설치했습니다 — 브라우저로 돌아가 [폴더 열기]를 다시 눌러 주세요.",
  "(지우는 방법은 이 설치 파일을 메모장으로 열면 맨 위에 있습니다.)",
].join("\r\n");
export const QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE = "설치하지 못했습니다 — 아래 내용을 관리자에게 알려 주세요.";

export class QuoteFolderHelperRootError extends Error {
  constructor() {
    // 값은 싣지 않는다 — 설정값이 오류 메시지 · 로그로 새지 않게.
    super("공유폴더 주소(QUOTE_ARCHIVE_UNC_ROOT)가 올바른 UNC · 드라이브 경로가 아닙니다.");
    this.name = "QuoteFolderHelperRootError";
  }
}

// PowerShell 이 작은따옴표로 치는 글자(') 와 그 닮은꼴 ‘ ’ ‚ ‛, 큰따옴표와 닮은꼴 " “ ” „, 백틱.
const SINGLE_QUOTE_LIKE = new Set([0x27, 0x2018, 0x2019, 0x201a, 0x201b]);
const QUOTE_LIKE = new Set([...SINGLE_QUOTE_LIKE, 0x22, 0x201c, 0x201d, 0x201e, 0x60]);
// 줄바꿈으로 읽힐 수 있는 글자(C0 · C1 은 제어문자 검사가 막는다).
const LINE_SEPARATOR_LIKE = new Set([0x2028, 0x2029]);
const ROOT_FORBIDDEN_CHARACTERS = ["/", "*", "?", "<", ">", "|"];

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * 도우미 루트를 다듬고 검사한다 — `\\서버\공유[\하위…]`(UNC) 또는 `X:\폴더[\…]`. 아니면 null.
 * 이 값은 스크립트의 작은따옴표 문자열에 박히므로 따옴표 · 줄바꿈 · 제어문자가 든 값은 받지 않는다.
 * `\\?\` · `\\.\` 장치 경로, `.` · `..` 마디, 빈 마디, 끝이 점 · 공백인 마디도 받지 않는다.
 * 끝의 `\` 하나는 뗀다.
 */
export function normalizeQuoteFolderHelperRoot(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > QUOTE_FOLDER_HELPER_ROOT_MAX_LENGTH) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isControlCodePoint(code) || QUOTE_LIKE.has(code) || LINE_SEPARATOR_LIKE.has(code)) return null;
  }
  if (ROOT_FORBIDDEN_CHARACTERS.some((character) => value.includes(character))) return null;

  let prefix: string;
  let rest: string;
  if (value.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = value.slice(2);
  } else if (/^[A-Za-z]:\\/.test(value)) {
    prefix = value.slice(0, 3);
    rest = value.slice(3);
  } else {
    return null;
  }
  if (rest.endsWith("\\")) rest = rest.slice(0, -1);
  const segments = rest.split("\\");
  // UNC 는 서버 · 공유 두 마디가 있어야 하고, 드라이브 경로는 드라이브 뿌리 자체가 아니어야 한다.
  if (prefix === "\\\\" ? segments.length < 2 : segments.length < 1) return null;
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes(":") ||
      segment.endsWith(".") ||
      segment.endsWith(" ")
    ) {
      return null;
    }
  }
  return `${prefix}${segments.join("\\")}`;
}

export type QuoteFolderHelperRootResolution =
  | { status: "unset" }
  | { status: "invalid" }
  | { status: "ok"; root: string; alt?: string };

/**
 * 도우미를 만드는 함수들이 함께 받는 것. `uncRootAlt` 는 **같은 공유폴더를 가리키는 다른 주소**다
 * (이름 ↔ IP). 도우미가 첫째로 못 열면 둘째로 한 번 더 해 본다.
 */
export type QuoteFolderHelperRootsInput = { uncRoot: string; uncRootAlt?: string };

/**
 * 환경변수 QUOTE_ARCHIVE_UNC_ROOT 를 **부르는 시점에** 읽는다. 값 자체는 로그로 찍지 않는다
 * (보안 규칙: .env 내용은 출력하지 않는다).
 */
export function resolveQuoteFolderHelperRoot(): QuoteFolderHelperRootResolution {
  const configured = process.env.QUOTE_ARCHIVE_UNC_ROOT;
  if (!configured || configured.trim().length === 0) return { status: "unset" };
  const root = normalizeQuoteFolderHelperRoot(configured);
  if (root === null) return { status: "invalid" };
  // 둘째 루트는 **없어도 되고, 틀리면 없는 셈 친다.** 여기서 invalid 로 끊으면 곁다리 설정
  // 하나 때문에 [폴더 열기]가 통째로 죽는다 — 첫째가 멀쩡하면 그것으로 연다.
  const configuredAlt = process.env.QUOTE_ARCHIVE_UNC_ROOT_ALT;
  const alt =
    configuredAlt && configuredAlt.trim().length > 0
      ? (normalizeQuoteFolderHelperRoot(configuredAlt) ?? undefined)
      : undefined;
  return alt === undefined ? { status: "ok", root } : { status: "ok", root, alt };
}

/** PowerShell 작은따옴표 문자열 — 작은따옴표(와 닮은꼴)는 두 번. 루트 검사가 이미 막지만 한 겹 더. */
function powerShellSingleQuoted(value: string): string {
  let out = "";
  for (const character of value) {
    out += SINGLE_QUOTE_LIKE.has(character.charCodeAt(0)) ? character + character : character;
  }
  return `'${out}'`;
}

function requireRoot(uncRoot: string): string {
  const root = normalizeQuoteFolderHelperRoot(uncRoot);
  if (root === null) throw new QuoteFolderHelperRootError();
  return root;
}

/**
 * 도우미가 **차례로 시도할** 루트들. 첫째는 반드시 있어야 하고, 둘째(`uncRootAlt`)는 없어도 된다.
 *
 * 왜 둘인가 — 같은 공유폴더를 가리키는 주소가 PC 마다 다르게 닿는다. 이름(`\\DSS-NAS\…`)은
 * 이름 풀이가 되는 PC 에서만 열리고, IP(`\\192.168.0.222\…`)는 이름 풀이와 무관하지만 NAS 주소가
 * 바뀌면 죽는다. 하나만 두면 그 하나가 안 되는 PC 에서는 [폴더 열기]가 통째로 먹통이 된다.
 *
 * 🔴 불변식 (a) 는 그대로다 — 루트는 **설치 때 정해지고** 웹 페이지가 바꿀 수 없으며, 열 수 있는
 *    것은 그 루트들 **아래의 폴더**뿐이다. 담김 검사는 시도하는 루트마다 따로 한다.
 * 같은 값이 둘 들어오면 하나로 줄인다 — 없는 서버를 두 번 기다리지 않게.
 */
function requireRoots(input: QuoteFolderHelperRootsInput): string[] {
  const roots = [requireRoot(input.uncRoot)];
  const alt = input.uncRootAlt?.trim();
  if (alt !== undefined && alt.length > 0) {
    const normalized = requireRoot(alt);
    if (normalized.toLowerCase() !== roots[0].toLowerCase()) roots.push(normalized);
  }
  return roots;
}

/**
 * open-dss-folder.ps1 의 본문(줄 끝 CRLF). 할 일과 거절 규칙은 머리말 (a) · (b).
 *
 * 표준출력 형식(DSS_FOLDER_DRY_RUN=1 일 때만): `OPEN <폴더 전체 경로>` · `NOT-FOUND` ·
 * `REJECT <까닭>`. 끝남 코드: 0 열었음 · 2 주소 모양 · 3 경로 규칙 · 루트 밖 · 바로 가기 폴더 ·
 * 4 폴더 없음 · 9 그 밖의 오류.
 */
export function buildQuoteFolderHelperScript(input: QuoteFolderHelperRootsInput): string {
  const roots = requireRoots(input);
  const script = String.raw`# ============================================================================
# DSS 견적서 폴더 열기 도우미 (${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME})
# ============================================================================
# 설치 파일(${QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME})이 이 PC 의 현재 사용자에게 만든 파일입니다.
# 손으로 고치지 마세요. 공유폴더 주소가 바뀌면 설치 파일을 새로 받아 다시 실행하면 됩니다.
#
# 브라우저의 dss-folder:// 주소를 받아, 아래 루트 아래의 폴더만 Windows 탐색기로 엽니다.
# 파일 · 프로그램은 열거나 실행하지 않습니다. 기록(로그) · 네트워크 · 다른 명령이 없습니다.
#
# 지우려면:
#   reg delete "HKCU\Software\Classes\dss-folder" /f
#   del "%LOCALAPPDATA%\DSS\${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME}"
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# 공유폴더 루트 — 설치 때 정해졌습니다. 웹 페이지(주소)는 이 값을 바꿀 수 없습니다.
# 같은 폴더를 가리키는 주소가 여럿이면 차례로 해 보고, 처음으로 실제 있는 것을 엽니다
# (이름으로 안 닿는 PC 에서는 IP 로, 그 반대도 마찬가지).
$Roots = @(${roots.map((r) => powerShellSingleQuoted(r)).join(", ")})
$Prefix = '${QUOTE_FOLDER_LINK_PREFIX}'
$MaxRelativeLength = ${QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH}
$MaxEncodedLength = ${QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH}
$DryRun = ($env:${QUOTE_FOLDER_HELPER_DRY_RUN_ENV} -eq '1')

# 시험용 — 콘솔 코드 페이지와 무관하게 UTF-8 바이트를 그대로 표준출력에 쓴다.
function Write-DryRun([string]$Line) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Line + [System.Environment]::NewLine)
  $stdout = [System.Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

function Show-Message([string]$Text) {
  if ($DryRun) { return }
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($Text, 0, 'DSS 견적서 폴더', 48)
  } catch { }
}

function Stop-Helper([string]$Outcome, [int]$Code) {
  if ($DryRun) { Write-DryRun $Outcome }
  exit $Code
}

# 폴더가 있나 — 'found' · 'missing' · 'unreachable'.
#
# 🔴 try/catch 가 여기 있는 까닭 (2026-09-16 실측). 이 스크립트는 맨 위에서
# $ErrorActionPreference = 'Stop' 을 걸어 둔다. 그래서 **풀리지 않는 서버 이름**
# (\\없는이름\공유)에 Test-Path 를 하면 $false 가 돌아오는 것이 아니라 **던진다** —
# 바깥 catch 로 빠져 'REJECT error' 로 끝나고, 둘째 주소는 시도조차 못 한다.
# 없는 로컬 폴더는 얌전히 $false 라서 이 차이가 잘 드러나지 않는다.
# 못 닿는 것과 없는 것을 여기서 함께 삼켜 **다음 주소로 넘긴다**.
function Test-FolderState([string]$Path) {
  try {
    if (Test-Path -LiteralPath $Path -PathType Container) { return 'found' }
    return 'missing'
  } catch {
    return 'unreachable'
  }
}

# 루트부터 그 폴더까지 마디마다 바로 가기(정션 · 심볼릭 링크)가 없는가.
# 읽다가 실패하면 $false — 확인하지 못한 것은 열지 않는다(안전한 쪽으로).
function Test-NoReparsePoint([string]$RootFull, [string]$Relative) {
  try {
    $current = $RootFull
    foreach ($segment in $Relative.Split([char]'/')) {
      $current = $current + '\' + $segment
      $attributes = [System.IO.File]::GetAttributes($current)
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    }
    return $true
  } catch {
    return $false
  }
}

# 상대 경로 규칙 — 서버의 domain/quote-folder-link.ts 와 같다.
function Test-RelativePath([string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return $false }
  if ($Value.Length -gt $MaxRelativeLength) { return $false }
  foreach ($character in $Value.ToCharArray()) {
    $code = [int]$character
    if ($code -le 31 -or ($code -ge 127 -and $code -le 159)) { return $false }
  }
  if ($Value.StartsWith('/', [System.StringComparison]::Ordinal)) { return $false }
  if ($Value -match '^[A-Za-z]:') { return $false }
  if ($Value.IndexOfAny([char[]]@('\', ':', '*', '?', '"', '<', '>', '|')) -ge 0) { return $false }
  foreach ($segment in $Value.Split([char]'/')) {
    if ($segment.Length -eq 0) { return $false }
    if ($segment -ceq '.' -or $segment -ceq '..') { return $false }
    if ($segment.EndsWith('.', [System.StringComparison]::Ordinal)) { return $false }
    if ($segment.EndsWith(' ', [System.StringComparison]::Ordinal)) { return $false }
  }
  return $true
}

try {
  # (a) 인자는 정확히 하나 — 주소 전체. 둘 이상이면 따옴표를 깨고 끼워 넣은 것이다.
  if ($args.Count -ne 1) { Stop-Helper 'REJECT argument-count' 2 }
  $link = [string]$args[0]

  # (b) dss-folder://open/?p= 모양이 아니면 끝.
  if ($link.Length -gt ($Prefix.Length + $MaxEncodedLength)) { Stop-Helper 'REJECT not-a-folder-link' 2 }
  if (-not $link.StartsWith($Prefix, [System.StringComparison]::Ordinal)) { Stop-Helper 'REJECT not-a-folder-link' 2 }
  $encoded = $link.Substring($Prefix.Length)
  if ($encoded.Length -eq 0 -or ($encoded.Length % 4) -eq 1) { Stop-Helper 'REJECT bad-encoding' 2 }
  if ($encoded -cnotmatch '^[A-Za-z0-9_-]+\z') { Stop-Helper 'REJECT bad-encoding' 2 }

  # (c) base64url 을 풀어 UTF-8 로 읽는다. 표준 모양(다시 싸면 같은 글자)만 받는다.
  $standard = $encoded.Replace('-', '+').Replace('_', '/')
  $standard = $standard + ('=' * ((4 - ($standard.Length % 4)) % 4))
  $bytes = [System.Convert]::FromBase64String($standard)
  $canonical = [System.Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  if ($canonical -cne $encoded) { Stop-Helper 'REJECT bad-encoding' 2 }
  $strictUtf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false, $true
  try { $relative = $strictUtf8.GetString($bytes) } catch { Stop-Helper 'REJECT bad-encoding' 2 }

  # (d) 상대 경로 규칙.
  if (-not (Test-RelativePath $relative)) { Stop-Helper 'REJECT bad-path' 3 }

  # (e~f) 루트를 차례로 — 담김 검사는 **루트마다 따로** 하고, 처음으로 실제 있는 폴더를 고른다.
  $target = $null
  $contained = $false
  $reparse = $false
  foreach ($candidateRoot in $Roots) {
    # (e) 루트와 이어 편 뒤, 루트 + '\' 로 시작하는지(대소문자 무시).
    $rootFull = [System.IO.Path]::GetFullPath($candidateRoot).TrimEnd('\')
    $full = [System.IO.Path]::GetFullPath($rootFull + '\' + $relative.Replace('/', '\'))
    if (-not $full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    $contained = $true

    # (f) 폴더가 아니면(없음 · 파일 · 서버에 못 닿음) 다음 루트로.
    if ((Test-FolderState $full) -ne 'found') { continue }

    # 루트 아래 마디 가운데 바로 가기 폴더(정션 · 심볼릭 링크)는 루트 밖을 가리킬 수 있다 — 열지 않는다.
    # 다음 루트로 넘기지 않는다: 같은 폴더를 다른 주소로 열어도 같은 바로 가기다.
    if (-not (Test-NoReparsePoint $rootFull $relative)) { $reparse = $true; break }

    $target = $full
    break
  }

  if ($reparse) {
    Show-Message '이 폴더는 바로 가기 폴더라 열 수 없습니다.'
    Stop-Helper 'REJECT reparse-point' 3
  }

  # 어느 루트 아래에도 들지 않는 경로 — 규칙 위반이다(없는 폴더와 구별한다).
  if (-not $contained) { Stop-Helper 'REJECT outside-root' 3 }

  if ($null -eq $target) {
    Show-Message ('폴더를 찾을 수 없습니다.' + [System.Environment]::NewLine + '공유폴더 연결을 확인하거나, 견적서 폴더가 옮겨졌는지 확인해 주세요.')
    Stop-Helper 'NOT-FOUND' 4
  }
  $full = $target

  if ($DryRun) { Stop-Helper ('OPEN ' + $full) 0 }

  # (g) 탐색기에 그 폴더 경로만 넘긴다. 끝의 '\' 는 폴더로만 읽히게 한다. 파일 · 프로그램은 열지 않는다.
  if (-not [System.IO.Directory]::Exists($full)) { Stop-Helper 'NOT-FOUND' 4 }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path $env:SystemRoot 'explorer.exe'
  $start.Arguments = '"' + $full + '\"'
  $start.UseShellExecute = $false
  [void][System.Diagnostics.Process]::Start($start)
  exit 0
} catch {
  # 경로가 Windows 한도를 넘는 등 — 열지 않고 알린다.
  Show-Message '폴더를 열 수 없습니다.'
  Stop-Helper 'REJECT error' 9
}
`;
  return script.replace(/\r?\n/g, "\r\n");
}

/** 설치 파일이 PC 에 쓰는 바이트 그대로 — UTF-8 BOM + 본문(머리말 「스크립트 파일은 UTF-8 BOM 으로」). */
export function quoteFolderHelperScriptBytes(input: QuoteFolderHelperRootsInput): Uint8Array {
  const body = Buffer.from(buildQuoteFolderHelperScript(input), "utf8");
  return new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]));
}

/**
 * 설치 파일 속 PowerShell 이 쓰는 payload 읽개 — .cmd 파일을 **데이터로** 읽어 이름 붙은 덩어리의
 * base64 를 바이트로 푼다. 한 줄이고 cmd 가 해석하는 글자가 없다. 시험이 이 글자 그대로를 돌린다.
 */
export const QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS = String.raw`function Read-DssPayload([string]$Name) { $lines = [System.IO.File]::ReadAllLines($env:${QUOTE_FOLDER_HELPER_INSTALLER_PATH_ENV}); $begin = [System.Array]::IndexOf($lines, 'DSS-PAYLOAD-' + $Name + '-BEGIN'); $end = [System.Array]::IndexOf($lines, 'DSS-PAYLOAD-' + $Name + '-END'); if ($begin -lt 0 -or $end -le $begin + 1) { throw ('payload missing: ' + $Name) }; [System.Convert]::FromBase64String([string]::Join('', $lines[($begin + 1)..($end - 1)])) }`;

/**
 * 레지스트리에 적을 명령을 만드는 한 줄 — `$powershell`(powershell.exe 전체 경로) · `$script`(도우미
 * 경로)가 앞에서 정해져 있어야 한다. 결과 `$command`:
 *   "<powershell.exe>" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "<script>" "%1"
 * 따옴표 · 퍼센트는 [char]34 · [char]37 로 만든다(cmd 줄 안이다). 시험이 이 글자 그대로를 돌린다.
 */
export const QUOTE_FOLDER_HELPER_COMMAND_BUILDER_PS = String.raw`$q = [string][char]34; $percent = [string][char]37; $command = $q + $powershell + $q + ' -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + $q + $script + $q + ' ' + $q + $percent + '1' + $q`;

/**
 * 설치가 실패했을 때의 끝냄 — 설치 파일(.cmd)에서는 이 코드가 %ERRORLEVEL% 로 이어져야 한다.
 * 창에 붙여넣는 명령에서는 이 조각만 덜어낸다(아래 「파일 없이 도는 설치 명령」 절). 아래
 * INSTALL_STATEMENTS 의 마지막 문장에 **정확히 한 번** 들어 있고, 못 찾으면 명령을 만들지 않는다.
 */
export const QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS = "; exit 1";

/** 설치 파일 속 PowerShell 이 하는 일 전부(한 줄로 이어 붙인다). 레지스트리는 HKCU 만. */
const INSTALL_STATEMENTS = [
  String.raw`$ErrorActionPreference = 'Stop'`,
  QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS,
  String.raw`try { $dir = Join-Path $env:LOCALAPPDATA 'DSS'`,
  String.raw`$script = Join-Path $dir '${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME}'`,
  String.raw`[void][System.IO.Directory]::CreateDirectory($dir)`,
  String.raw`[System.IO.File]::WriteAllBytes($script, (Read-DssPayload 'HELPER'))`,
  String.raw`$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'`,
  QUOTE_FOLDER_HELPER_COMMAND_BUILDER_PS,
  String.raw`$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\dss-folder')`,
  String.raw`$key.SetValue('', 'URL:DSS Folder')`,
  String.raw`$key.SetValue('URL Protocol', '')`,
  String.raw`$commandKey = $key.CreateSubKey('shell\open\command')`,
  String.raw`$commandKey.SetValue('', $command)`,
  String.raw`$commandKey.Close()`,
  String.raw`$key.Close()`,
  String.raw`Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'DONE'))) } catch { Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'FAILED'))); Write-Host $_.Exception.Message; exit 1 }`,
];

/** cmd 줄에 들어가는 PowerShell `-Command` 본문. */
export function quoteFolderHelperInstallCommand(): string {
  return INSTALL_STATEMENTS.join("; ");
}

/**
 * 설치가 PC 로 옮기는 것 셋 — 도우미 스크립트 · 설치 완료 문구 · 실패 문구.
 * 🔴 설치 파일(base64 덩어리)과 붙여넣는 설치 명령(base64 문자열)이 **이 한 벌**을 함께 쓴다.
 */
function quoteFolderHelperPayloads(input: QuoteFolderHelperRootsInput): ReadonlyArray<{ name: string; bytes: Uint8Array }> {
  return [
    { name: "HELPER", bytes: quoteFolderHelperScriptBytes(input) },
    { name: "DONE", bytes: new Uint8Array(Buffer.from(QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE, "utf8")) },
    { name: "FAILED", bytes: new Uint8Array(Buffer.from(QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE, "utf8")) },
  ];
}

function payloadBlock(name: string, bytes: Uint8Array): string[] {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines: string[] = [`DSS-PAYLOAD-${name}-BEGIN`];
  for (let index = 0; index < base64.length; index += 76) lines.push(base64.slice(index, index + 76));
  lines.push(`DSS-PAYLOAD-${name}-END`);
  return lines;
}

/**
 * 설치 파일(install-dss-folder-helper.cmd)의 본문 — ASCII 만, 줄 끝 CRLF. 루트(UNC)는 base64 로
 * 싼 스크립트 안에만 있다. **요청마다 만든다**(루트가 저장소 · 빌드 결과에 남지 않게).
 */
export function buildQuoteFolderHelperInstaller(input: QuoteFolderHelperRootsInput): string {
  const lines = [
    "@echo off",
    "rem ==========================================================================",
    "rem  DSS quote folder helper - installer",
    "rem  Installs for the current Windows user only (HKCU). No administrator rights.",
    "rem ==========================================================================",
    "rem  What it does:",
    `rem    1. Writes %LOCALAPPDATA%\\DSS\\${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME} (the helper, payload below).`,
    "rem    2. Registers the dss-folder: link for this user:",
    "rem         HKCU\\Software\\Classes\\dss-folder\\shell\\open\\command =",
    "rem         powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden",
    // rem 줄에도 cmd 가 해석할 수 있는 글자(< > | &)를 두지 않는다.
    `rem           -ExecutionPolicy Bypass -File "[helper]" "[link]"`,
    "rem  The helper opens ONLY folders under the share root fixed at install time,",
    "rem  in Windows Explorer. It never opens or runs files.",
    "rem  Run this file again to repair the helper or to apply a new share root.",
    "rem",
    "rem  Uninstall (Command Prompt):",
    'rem    reg delete "HKCU\\Software\\Classes\\dss-folder" /f',
    `rem    del "%LOCALAPPDATA%\\DSS\\${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME}"`,
    "rem ==========================================================================",
    "setlocal DisableDelayedExpansion",
    `set "${QUOTE_FOLDER_HELPER_INSTALLER_PATH_ENV}=%~f0"`,
    `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${quoteFolderHelperInstallCommand()}"`,
    'set "DSS_HELPER_EXIT=%ERRORLEVEL%"',
    "echo.",
    "pause",
    "exit /b %DSS_HELPER_EXIT%",
    "",
    "rem Data below is read by the PowerShell line above. cmd never reaches it.",
    ...quoteFolderHelperPayloads(input).flatMap(({ name, bytes }) => payloadBlock(name, bytes)),
    "",
  ];
  return lines.join("\r\n");
}

/**
 * ============================================================================
 * 파일 없이 도는 설치 명령 — PowerShell 창에 붙여넣는 한 줄 (견적서 ④c)
 * ============================================================================
 * Windows 스마트 앱 컨트롤이 보는 기준은 「위험한가」가 아니라 「스크립트 파일인가」다.
 * 내려받은 설치 파일(.cmd)은 [차단 해제] 없이는 더블클릭이 막히고(사내 공유폴더에 두어도,
 * 바탕화면에 복사해도 막힌다), 확장자를 .bat · .ps1 로 바꿔도 같은 목록에 있다. 그래서
 * **파일을 아예 주지 않는 길**을 하나 더 연다 — 사람이 PowerShell 창에 한 줄을 붙여넣는다.
 *
 * ── 🔴 설치 절차는 한 벌뿐이다 ────────────────────────────────────────────
 * 아래 함수는 INSTALL_STATEMENTS(설치 파일이 쓰는 그 문장들)를 **글자 그대로** 쓰고,
 * **매체가 달라서 다른 두 자리만** 갈아 끼운다(quoteFolderHelperInteractiveStatements):
 *   · payload 읽개 — 파일(.cmd)에서는 자기 자신을 읽어 base64 덩어리를 꺼내지만, 창에는 읽을
 *     파일이 없다. 그래서 **같은 이름 · 같은 반환값(byte[])** 의 읽개가 명령이 품은 base64 를 푼다.
 *   · 마지막 `; exit 1` — 파일(.cmd)에서는 이 끝냄 코드가 %ERRORLEVEL% 로 이어져야 하지만,
 *     대화형 창에서는 `exit` 가 **창을 닫아** 사람이 실패 문구를 읽지 못한다. 창에서는 끝냄 코드를
 *     받아 갈 곳이 없으므로 그냥 덜어낸다(대신할 것을 새로 만들지 않는다).
 * 실패 문구(FAILED payload)와 예외 메시지 출력은 양쪽에 그대로 있다. 설치 파일 방식도 그대로
 * 살아 있다(차단 해제로 쓰는 사람이 있다).
 *
 * 루트(UNC)는 여기서도 base64 안에만 있다 — 명령의 날 글자에는 없다.
 * ============================================================================
 */

/**
 * 붙여넣는 명령 속 payload 읽개 — 파일을 읽는 대신 명령이 품은 base64 문자열을 바이트로 푼다.
 * 이름 · 인자 · 반환값이 파일 읽개와 같아서 그 뒤 설치 문장들이 그대로 돈다. base64 에는
 * 따옴표 · `$` 가 없으므로 작은따옴표 문자열에 그대로 담긴다.
 */
export function quoteFolderHelperInlinePayloadReaderPs(input: QuoteFolderHelperRootsInput): string {
  const cases = quoteFolderHelperPayloads(input)
    .map(({ name, bytes }) => `'${name}' { '${Buffer.from(bytes).toString("base64")}' }`)
    .join(" ");
  return `function Read-DssPayload([string]$Name) { $text = switch -CaseSensitive ($Name) { ${cases} default { throw ('payload missing: ' + $Name) } }; [System.Convert]::FromBase64String($text) }`;
}

/**
 * 설치 문장을 **창에 붙여넣는 것**으로 옮긴다 — 매체가 달라서 다른 두 자리만 바꾼다(위 머리말):
 * 읽을 파일이 없으니 읽개를, 돌아갈 곳이 없으니 끝냄(`; exit 1`)을.
 *
 * 🔴 두 자리를 **정확히 한 번씩** 찾지 못하면 던진다 — 설치 절차가 바뀌었는데 이쪽만 옛 모양으로
 * 남거나, `exit` 가 남은 채(창이 닫히는) 명령이 조용히 나가는 일이 없게. 시험이 이 함수를 직접 돌린다.
 */
export function quoteFolderHelperInteractiveStatements(
  statements: readonly string[],
  payloadReader: string
): string[] {
  let readers = 0;
  let exits = 0;
  const moved = statements.map((statement) => {
    if (statement === QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS) {
      readers += 1;
      return payloadReader;
    }
    const parts = statement.split(QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS);
    exits += parts.length - 1;
    return parts.join("");
  });
  if (readers !== 1) throw new Error("설치 문장에서 payload 읽개를 한 자리로 찾지 못했습니다.");
  if (exits !== 1) throw new Error("설치 문장에서 끝냄(exit) 자리를 한 자리로 찾지 못했습니다.");
  return moved;
}

/**
 * PowerShell 창에 붙여넣는 설치 명령 한 줄 — 설치 파일과 **같은 절차 · 같은 payload**.
 * 요청마다 만든다(루트가 저장소 · 이미지에 남지 않게).
 */
export function buildQuoteFolderHelperInlineInstallCommand(input: QuoteFolderHelperRootsInput): string {
  const reader = quoteFolderHelperInlinePayloadReaderPs(input);
  return quoteFolderHelperInteractiveStatements(INSTALL_STATEMENTS, reader).join("; ");
}

/**
 * ============================================================================
 * 전체 주소 — 사람이 탐색기 주소창에 붙여넣는 `\\서버\공유\연도 폴더\견적서 폴더`
 * ============================================================================
 * 도우미를 설치하지 않은(또는 설치가 막힌) 사람도 폴더를 열 수 있는 우회로다. 견적서를 볼 수
 * 있는 사람에게, 그 견적서 폴더의 주소만 준다. 서버(컨테이너) 안 경로(QUOTE_ARCHIVE_DIR)는
 * 여기에도 응답에도 싣지 않는다 — 이어 붙이는 루트는 QUOTE_ARCHIVE_UNC_ROOT 쪽이다.
 * ============================================================================
 */

/** 루트 + 상대 경로 → 전체 주소. 루트 · 경로가 규칙 밖이면 null — 주소를 지어내지 않는다. */
export function buildQuoteFolderHelperUncPath(input: { uncRoot: string; relativePath: string }): string | null {
  const root = normalizeQuoteFolderHelperRoot(input.uncRoot);
  if (root === null) return null;
  if (!isQuoteFolderRelativePath(input.relativePath)) return null;
  // 다듬은 루트는 끝에 `\` 가 없다(normalizeQuoteFolderHelperRoot) — 구분자는 여기서 붙이는 하나뿐이다.
  return `${root}\\${input.relativePath.split("/").join("\\")}`;
}

/**
 * 환경변수를 **부르는 시점에** 읽어 전체 주소를 만든다. 설정이 비었거나(unset) 틀리면(invalid)
 * null — 부르는 쪽은 그 칸만 빼고 나머지 응답을 그대로 낸다(폴더 열기가 죽지 않게).
 */
export function resolveQuoteFolderHelperUncPath(relativePath: string): string | null {
  const resolution = resolveQuoteFolderHelperRoot();
  if (resolution.status !== "ok") return null;
  return buildQuoteFolderHelperUncPath({ uncRoot: resolution.root, relativePath });
}
