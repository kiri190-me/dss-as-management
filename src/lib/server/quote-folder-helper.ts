import "server-only";

import {
  QUOTE_FOLDER_FILE_LINK_PREFIX,
  QUOTE_FOLDER_OPENABLE_EXTENSIONS,
} from "@/lib/domain/quote-folder-file-link";
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
 *   (a) 루트(들) 아래의 **폴더**를 탐색기로 열고, 루트(들) 아래의 **허용 목록에 든 확장자의
 *       파일 하나**를 그 PC 의 연결 프로그램으로 연다. 그리고 2026-10-08 부터 루트(들) 아래의
 *       **`.xlsx` 한 장**을 그 PC 의 Excel 로 **같은 폴더에 PDF 로 바꿔 쓴다**. 주소의 접두어가
 *       어느 쪽인지를 가른다
 *       (`open/` → 폴더 · `openfile/` → 파일 · `xlsx2pdf/` → PDF 변환).
 *
 *       ── 🔴 2026-10-05 에 **무엇이 · 왜 바뀌었나** ──────────────────────
 *       예전 이 자리에는 「**폴더만** 연다 — 파일 · 프로그램은 열거나 실행하지 않는다」가
 *       적혀 있었다. [파일 관리] 탭의 공유폴더 목록에서 **파일 이름을 눌러 바로 열고 싶다**는
 *       것이 이 기능 전체에서 사용자가 가장 원한 것이었고, 사용자가 **아래 「남는 위험」을
 *       설명 듣고 「바로 열린다」를 골랐다**(2026-10-05). 파일을 「그 PC 의 프로그램으로」 여는
 *       것은 셸 연결 실행이다 — 그래서 없어진 「파일은 안 연다」 한 줄의 자리를 **검사 일곱**이
 *       메운다. 스크립트가 **하나도 건너뛰지 않고** 다시 한다(서버가 이미 했어도 다시 한다 —
 *       주소는 우리 화면이 아니라 아무 웹페이지나 만들 수 있다):
 *         1. 상대 경로 규칙 — domain/quote-folder-link.ts 와 **같은 규칙**(Test-RelativePath)
 *         2. 루트 담김 — 루트와 이어 GetFullPath 로 편 뒤 「루트 + \」 로 시작하는지(대소문자 무시)
 *         3. 마디마다 바로 가기(정션 · 심볼릭 링크 — 루트 밖을 가리킬 수 있다) 없음
 *            (Test-NoReparsePoint — 마지막 마디인 **파일 자신**까지 본다)
 *         4. 🔴 **확장자 허용 목록**(Test-OpenableFileName · $OpenableExtensions) — 거절 목록이
 *            아니다. 목록 밖은 전부 거절. `.exe` 류를 세는 방식은 Windows 가 실행하는 확장자를
 *            하나라도 빠뜨리면 끝난다(`.lnk` · `.scf` · `.pif` · PATHEXT 로 늘어나는 것들 …)
 *         5. 🔴 **폴더가 아니라 파일인지**([System.IO.File]::Exists · Directory::Exists 가 참이면
 *            거절) — 폴더에 `.pdf` 이름을 붙여 둔 함정
 *         6. 🔴 **확장자 없는 것 거절**(`문서` 처럼 점이 없는 이름 — 4번 함수 안)
 *         7. 실행 — `Start-Process -FilePath <전체경로>`. **인자는 그 경로 하나뿐**이고
 *            명령줄을 문자열로 조립하지 않는다(`-ArgumentList` 가 없다)
 *       폴더 쪽(`open/`)은 **한 글자도 바뀌지 않았다** — explorer.exe 에 그 폴더 경로만, 끝에
 *       `\` 를 붙여 넘긴다(폴더로만 읽힌다).
 *
 *       ── 🔴 남는 위험 — 숨기지 않는다 ───────────────────────────────────
 *       `dss-folder://` 는 **아무 웹페이지나 부를 수 있다.** 그러므로 악성 페이지가 이 주소를
 *       불러 **공유폴더 안의 문서를 열게 할 수 있다**(그 사람이 이미 열 수 있는 문서이고, 경로를
 *       알아맞혀야 하지만, 0 은 아니다). 막은 것은 **실행 파일 · 바로 가기 · 스크립트**(목록 밖)와
 *       **루트 밖 · 바로 가기를 지나는 경로**다. 막지 못한 것은 **허용 목록에 든 문서 형식 자체의
 *       위험**이다 — `.xlsm` 매크로, 문서 뷰어의 취약점은 이 도우미가 걸러 주지 않는다.
 *       (허용 목록에 `.xlsm` 을 일부러 넣은 까닭은 domain/quote-folder-file-link.ts 머리말.)
 *
 *       ── 🔴 2026-10-08 — 이 도우미가 **처음으로 파일을 쓴다**(`xlsx2pdf/`) ──
 *       지금까지 두 명령(`open/` · `openfile/`)은 **읽기만** 했다. 셋째 명령은 성질이 다르다:
 *       그 PC 의 Excel 로 `.xlsx` 한 장을 열어 **사내 서류함(공유폴더)에 PDF 를 쓴다.** 읽기의
 *       최악은 「보면 안 될 문서가 열린다」였지만, 쓰기의 최악은 「있던 것이 사라진다」다.
 *       그래서 울타리를 **좁혀서** 더한다 — 검사 일곱은 그대로 지나고, 그 위에 넷을 더 건다:
 *         8.  🔴 **원본이 `.xlsx` 일 때만**(Test-XlsxFileName). 허용 목록(열여덟 개)보다 훨씬
 *             좁다 — `.xlsm` · `.xls` 도 거절한다. 읽는 명령과 **다른 목록**이다(2026-10-08 결정).
 *         9.  🔴 **결과 경로를 받지 않는다.** 주소가 나르는 것은 원본 하나뿐이고, 쓰는 곳은
 *             **원본과 같은 폴더의 같은 이름 `.pdf` 하나**로 코드가 정한다(ChangeExtension 이
 *             아니라 `.xlsx` 다섯 글자를 떼고 `.pdf` 를 붙인 뒤, 폴더와 이름을 **다시 맞춰 본다**).
 *             결과 경로를 받는 순간 이 명령은 「아무 데나 쓰기」가 된다.
 *         10. 🔴 **루트 안 검사를 결과에도 건다** — 원본과 **같은 잣대**로 한 번 더(`$targetRoot`
 *             는 원본이 실제로 걸린 그 루트다). 같은 폴더이니 당연하지만, 당연한 것을 믿지 않는다.
 *         11. 🔴 **결과 자리가 바로 가기 · 폴더면 쓰지 않는다**(Test-WritableOutput). 원본 쪽
 *             Test-NoReparsePoint 는 **있는 것**만 볼 수 있어 「아직 없는 PDF」에 쓸 수 없다 —
 *             그래서 「없으면 괜찮다 · 보통 파일이면 괜찮다 · 그 밖은 전부 거절」로 따로 둔다.
 *             (바로 가기인 `연락서.pdf` 에 쓰면 그 바로 가기가 가리키는 **루트 밖**에 쓰인다.)
 *       🔵 **덮어쓴다**(사용자 결정 2026-10-08) — 같은 이름이 있으면 지우고 새로 쓴다. 지우는
 *          것은 **위에서 정한 그 한 경로**뿐이다(`[System.IO.File]::Delete($pdf)` 가 스크립트에
 *          딱 한 번 있고, 인자가 `$pdf` 다 — 시험이 센다).
 *       🔵 **Excel 창은 숨긴다**(사용자 결정) — `Visible = $false`. 🔴 **반드시 `finally` 로**
 *          통합문서를 닫고 Excel 을 끝내고 COM 을 놓는다. 안 그러면 Excel 유령 프로세스가 쌓여
 *          그 PC 가 느려지고, 다음 변환이 엉뚱한 창을 붙든다.
 *       🔴 **원본 `.xlsx` 는 바꾸지 않는다** — 읽기 전용으로 연다(`Workbooks.Open(…, 0, $true)`)
 *          고 닫을 때도 저장하지 않는다(`Close($false)`).
 *       🔴 **Excel 이 없는 PC 에서는 조용히 끝낸다**(`REJECT no-excel`, 끝냄 5) — 지금 거절들과
 *          같은 모양이다. **화면은 그것을 알 수 없다**(브라우저는 도우미가 무엇을 했는지 모른다).
 *          그래서 다음 조각에서 **서버가 폴더를 다시 읽어** PDF 가 생겼는지 확인한다.
 *
 *       🔴 루트가 여럿이어도 이 검사들은 **루트마다 따로** 한다 — 어느 루트 아래도 아닌 경로는
 *       어느 루트로도 열리지 않는다(requireRoots · 스크립트의 (e~f) 고리).
 *   (b) 주소가 명령줄로 삽입되지 않는다 — 레지스트리 명령은 `-File "…" "%1"` 이다. `-Command` 로
 *       주소를 이어 붙이지 않는다. `-File` 뒤의 것은 전부 스크립트 인자이고, 스크립트는 인자가
 *       **정확히 하나**가 아니면(따옴표를 깨고 인자를 늘린 주소) 끝낸다. 주소의 몸통은 base64url 이다.
 *   (c) 루트(UNC)는 저장소 · 빌드 결과에 남지 않는다 — 설치 파일 · 설치 명령 본문에만 들어가고,
 *       그 본문은 요청마다 환경변수(QUOTE_ARCHIVE_UNC_ROOT · CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT 와
 *       각각의 _ALT, 그리고 CONTACT_FOLDER_ARCHIVE_UNC_ROOT · REPAIR_DOCS_ARCHIVE_UNC_ROOT —
 *       resolveQuoteFolderHelperInstallRoots)로 만든다. 로그에도 찍지 않는다.
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
 * ── 🔴 설치가 **함께** 하는 일 — 「로컬 인트라넷」 영역 등록 (2026-10-05 사용자 결정) ──
 * 공유폴더의 파일을 [열기]로 열면 Windows 가 「이 파일이 신뢰할 수 있는 출처에서 온 것인가요?」
 * 확인창을 띄운다. 까닭은 코드가 아니다 — Windows 는 `\\<IP>\…` 처럼 **IP 주소로 된 네트워크
 * 위치**를 「인터넷 영역」으로 분류하고, 그 영역에서 온 파일을 열 때 저 창을 띄운다(탐색기에서
 * 더블클릭해도 똑같이 뜬다). 이름(`\\NAS이름\…`)으로 바꾸는 길은 막혀 있다 — 사내 DNS 가 없고
 * 개발 PC 와 NAS 가 다른 대역이라 NetBIOS 이름 조회도 안 된다(2026-10-05 조사 완료).
 *
 * 그래서 **도우미를 설치할 때 그 주소를 「로컬 인트라넷」 영역에 함께 등록한다.** 사용자가
 * 「바꾸는 범위는 그 주소 하나뿐이고, 그 NAS 에 악성 파일이 올라오면 경고 없이 열리게 된다」를
 * 듣고 골랐다.
 *
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Ranges\RangeN
 *     ":Range" = "<주소>"   (REG_SZ)
 *     "*"      = 1          (REG_DWORD — 1 = 로컬 인트라넷)
 *
 * 🔴 지키는 것 일곱 (QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS · quoteFolderHelperZoneHosts):
 *   1. **주소는 설정값에서 뽑는다.** 설치본에 심는 UNC 루트들의 호스트 부분을 꺼내 쓴다 —
 *      코드에도, 설치 명령의 날 글자에도 주소가 박히지 않는다(루트와 같은 규칙: base64 payload
 *      `ZONEHOSTS` 안에만 있다).
 *   2. **같은 호스트는 한 번만.** 견적서 · 현황표 · 연락서 루트가 같은 NAS 이면 하나로 줄인다.
 *   3. **이미 같은 `:Range` 가 있으면 그 키를 쓴다** — 새 `RangeN` 을 만들지 않는다.
 *   4. **다른 `RangeN` 은 건드리지 않는다** — 사람이 다른 사내 서버를 등록해 두었을 수 있다.
 *      새로 만들 때는 **안 쓰이는 번호**를 고른다(대소문자 무시).
 *   5. **HKCU 만.** HKLM 은 관리자 권한이 필요하고 그 PC 의 모든 계정에 영향을 준다.
 *   6. 🔴 **호스트가 IP 가 아니면(이름이면) 등록하지 않는다** — 점 없는 이름은 Windows 가 이미
 *      인트라넷으로 본다. 쓸데없이 건드리지 않는다.
 *   7. 🔴 **곁다리다.** 영역 등록이 실패해도 **도우미 설치는 끝난다**(자기 try/catch 안에서
 *      조용히 삼키고, 폴더 열기 등록이 **다 끝난 뒤에** 돈다). 사람이 보는 결과 문구에 무엇을
 *      했는지 한 줄 적는다(ZONE · ZONEFAIL payload).
 * 🔴 이 조각은 Windows 가 띄우는 **확인창**을 없애는 것이지 **우리 검사 일곱**(위 (a))을 한 뼘도
 *    느슨하게 하지 않는다 — 스크립트는 글자 하나 바뀌지 않았다.
 *
 * ── 🔴 영역 등록을 되돌리는 법 (실행하는 코드로 만들지 않는다) ──────────────
 * 지우는 기능을 넣으면 그것이 또 하나의 울타리가 된다. 사람이 PowerShell 창에 한 줄 친다
 * (`<주소>` 자리에 설정한 공유폴더 호스트를 적는다 — 그 주소의 RangeN 하나만 지운다):
 *
 *   Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Ranges' | Where-Object { $_.GetValue(':Range') -eq '<주소>' } | Remove-Item -Recurse -Force
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
/**
 * 🔴 **다른 폴더**의 루트 — 고객사 현황표 공유폴더(견적서 루트 아래가 아니다).
 * 도우미는 PC 마다 한 벌만 설치되므로(레지스트리 `dss-folder` · `%LOCALAPPDATA%\DSS\…ps1` 자리가
 * 하나뿐이다) 현황표용 도우미를 따로 설치할 수 없다 — 그러면 그 PC 의 견적서 [폴더 열기]가 죽는다.
 * 그래서 **한 벌에 루트를 여럿** 심고 차례로 시도한다. 불변식 (a) 는 루트마다 그대로 산다.
 * 없어도 된다 — 없으면 견적서 루트만 심는다(지금까지와 같다).
 */
export const CUSTOMER_PORTAL_FOLDER_HELPER_ROOT_ENV = "CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT";
/** 위 현황표 루트를 가리키는 **다른 주소**(이름 ↔ IP). 없어도 된다 — 까닭은 견적서 _ALT 와 같다. */
export const CUSTOMER_PORTAL_FOLDER_HELPER_ROOT_ALT_ENV = "CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT_ALT";
/**
 * 🔴 또 하나의 **다른 폴더** — A/S 수리 건의 **연락서** 공유폴더(견적서 루트 아래가 아니다).
 * 까닭은 바로 위 현황표 루트와 같다: 도우미는 PC 마다 한 벌뿐이라(레지스트리 `dss-folder`)
 * 연락서용을 따로 설치하면 그 PC 의 견적서 [폴더 열기]가 죽는다. 그래서 한 벌에 함께 심는다.
 * 없어도 된다 — 없으면 지금까지와 같다. 불변식 (a) 는 루트마다 그대로 산다.
 */
export const CONTACT_FOLDER_HELPER_ROOT_ENV = "CONTACT_FOLDER_ARCHIVE_UNC_ROOT";
/**
 * 🔴 또 하나의 **다른 폴더** — 사내 「수리 관련」 서류 공유폴더(견적서 루트 아래가 아니다).
 * 제품 종류마다 **같은 서류를 돌려 쓰는** 곳이다(인수시 체크시트 · 작업 수순 · 통전 체크시트 …).
 * 그 서류를 앱에 올리는 대신 **공유폴더의 자리만 가리킬** 것이므로(2026-10-07 사용자 결정) 도우미가
 * 그 아래를 열 수 있어야 한다. 까닭은 바로 위 연락서 · 현황표 루트와 같다: 도우미는 PC 마다
 * 한 벌뿐이라(레지스트리 `dss-folder`) 따로 설치하면 그 PC 의 견적서 [폴더 열기]가 죽는다.
 * 그래서 한 벌에 함께 심고, 🔴 **목록 맨 뒤**에 둔다(resolveQuoteFolderHelperInstallRoots) —
 * 앞에 끼워 넣으면 이미 설치된 PC 의 루트 차례가 통째로 밀린다.
 * 없어도 된다 — 없으면 지금까지와 같다. 불변식 (a) 는 루트마다 그대로 산다.
 * 🔴 **이 루트 아래 전부가 열린다** — 될 수 있는 대로 좁게 적는다(공유 뿌리가 아니라
 * 수리 관련 서류가 모여 있는 바로 그 폴더까지).
 */
export const REPAIR_DOCS_FOLDER_HELPER_ROOT_ENV = "REPAIR_DOCS_ARCHIVE_UNC_ROOT";
/**
 * ============================================================================
 * 🔴 셋째 명령의 접두어 — `dss-folder://xlsx2pdf/?p=<base64url(상대 .xlsx 경로)>` (2026-10-08)
 * ============================================================================
 * 새 스킴을 만들지 않는다 — 레지스트리 자리가 `HKCU\Software\Classes\dss-folder` 하나뿐이라
 * 스킴을 늘리면 설치가 한 벌 더 는다(domain/quote-folder-file-link.ts 머리말과 같은 까닭).
 * 접두어만 더하면 **같은 스크립트 · 같은 설치 한 번**으로 끝난다.
 *
 * 🔴 **이 접두어가 여기(server)에 있는 까닭** — 이 조각은 **도우미 쪽만** 만든다. 주소를
 * **만드는** 쪽(서버 통로 · 화면)은 다음 조각의 일이고, 그때 domain/ 에 폴더 · 파일 주소와
 * 같은 모양의 모듈(규칙 검사 · base64url 싸기)이 생긴다. 지금 domain/ 에 반쪽을 만들어 두면
 * 쓰는 곳 없는 코드가 남는다. 다음 조각이 domain/ 으로 옮기고 여기서는 그것을 읽어 쓰면 된다.
 * ============================================================================
 */
export const QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX = "dss-folder://xlsx2pdf/?p=";

/**
 * 🔴 PDF 로 바꿀 수 있는 **원본 확장자 — 이것 하나뿐이다**(사용자 결정 2026-10-08).
 * 읽기 허용 목록(QUOTE_FOLDER_OPENABLE_EXTENSIONS · 열여덟 개)과 **일부러 다르다** — 쓰는
 * 명령이라 좁힌다. `.xlsm` 도 `.xls` 도 여기서는 거절이다.
 */
export const QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION = "xlsx";
/** 🔴 결과 확장자. 결과 경로는 **받지 않는다** — 원본 이름의 확장자만 이것으로 바꾼다. */
export const QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION = "pdf";

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

/**
 * 🔴 영역 등록까지 끝났을 때 사람이 보는 한 줄. **주소는 적지 않는다** — 설정값이다.
 * (등록할 주소가 하나도 없으면 이 줄도, 아래 실패 줄도 나오지 않는다.)
 */
export const QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE =
  "공유폴더 주소를 「로컬 인트라넷」 영역에 함께 등록했습니다 — 파일을 열 때 뜨던 확인창이 없어집니다.";
/** 🔴 영역 등록만 못 했을 때 — 도우미 설치 자체는 끝났다는 것을 분명히 말한다. */
export const QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE =
  "영역 등록은 하지 못했습니다 — 폴더 열기는 설치되었습니다. 파일을 열 때 확인창이 뜨면 [계속 열기]를 눌러 주세요.";

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
 * 도우미를 만드는 함수들이 함께 받는 것. 도우미는 여기 적힌 차례 그대로 시도한다.
 *  · `uncRoot`    — 반드시 있어야 한다.
 *  · `uncRootAlt` — **같은 공유폴더를 가리키는 다른 주소**(이름 ↔ IP). 없어도 된다.
 *  · `extraRoots` — 🔴 **다른 폴더**의 루트들(현황표 공유폴더처럼 견적서 루트 아래가 아닌 곳).
 *                   없어도 된다. 담김 검사는 여기 것들도 **루트마다 따로** 한다.
 */
export type QuoteFolderHelperRootsInput = {
  uncRoot: string;
  uncRootAlt?: string;
  extraRoots?: readonly string[];
};

/**
 * 환경변수 QUOTE_ARCHIVE_UNC_ROOT(와 _ALT)를 **부르는 시점에** 읽는다. 값 자체는 로그로 찍지
 * 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 *
 * 이것은 **견적서 루트 한 벌**이다 — 「전체 주소」(resolveQuoteFolderHelperUncPath)가 이 루트로
 * 견적서 폴더의 주소를 만든다. 설치 파일에 심을 **루트 전부**는 아래
 * resolveQuoteFolderHelperInstallRoots 가 모은다.
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

export type QuoteFolderHelperInstallRootsResolution =
  | { status: "unset" }
  | { status: "invalid" }
  | { status: "ok"; roots: readonly [string, ...string[]] };

/**
 * ============================================================================
 * 설치 파일 · 설치 명령에 심을 **루트 전부** — 부르는 시점에 읽는다
 * ============================================================================
 * 차례: 견적서 루트 → 견적서 다른 주소 → 현황표 루트 → 현황표 다른 주소 → 연락서 루트 →
 * 수리 관련 서류 루트.
 * 견적서를 먼저 두는 것은 **지금까지 설치된 것과 같은 차례**를 지키기 위해서다 — 설정이 예전
 * 그대로인 PC 에서는 목록이 예전과 글자 하나 다르지 않다. 연락서 · 수리 관련 서류를 **맨 뒤에**
 * 더하는 것도 같은 까닭이다(먼저 끼워 넣으면 이미 설치된 PC 의 목록 차례가 통째로 밀린다).
 * 🔴 **앞으로 더할 루트도 반드시 맨 뒤다.**
 *
 * ── 일부만 설정됐을 때 ────────────────────────────────────────────────────
 *  · 견적서 루트가 **틀리면** invalid — 지금까지와 같다. 첫째 루트의 오타는 크게 울어야 한다.
 *  · 나머지(견적서 _ALT · 현황표 · 현황표 _ALT · 연락서 · 수리 관련 서류)가 틀리면 **없는 셈**
 *    친다. 곁다리 설정 하나 때문에 [폴더 열기]가 통째로 죽으면 안 된다(견적서 _ALT 가 이미
 *    그렇게 정해져 있다).
 *    🔴 특히 현황표 · 연락서 · 수리 관련 서류 루트의 오타로 **견적서 [폴더 열기]가 죽는 일이
 *    없어야 한다.**
 *  · 하나도 설정되지 않으면 unset — 설치 파일을 받을 수 없다(지금까지와 같다).
 *  · 견적서 루트가 비고 현황표 루트만 있으면 현황표 루트 하나로 만든다. 도우미는 자기 루트
 *    아래만 여는 물건이라, 루트가 하나든 둘이든 규칙은 같다.
 *
 * 값은 돌려주기만 하고 로그 · 오류에 싣지 않는다.
 * ============================================================================
 */
export function resolveQuoteFolderHelperInstallRoots(): QuoteFolderHelperInstallRootsResolution {
  const quote = resolveQuoteFolderHelperRoot();
  if (quote.status === "invalid") return { status: "invalid" };

  const roots: string[] = [];
  if (quote.status === "ok") {
    roots.push(quote.root);
    if (quote.alt !== undefined) roots.push(quote.alt);
  }
  // 곁다리 루트 — 비었거나 규칙 밖이면 없는 셈 친다(위 머리말).
  // 🔴 **새 루트는 이 배열의 맨 뒤에만** 더한다(위 머리말) — 앞에 끼우면 이미 설치된 PC 의
  // 루트 차례가 통째로 밀린다.
  for (const configured of [
    process.env.CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT,
    process.env.CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT_ALT,
    process.env.CONTACT_FOLDER_ARCHIVE_UNC_ROOT,
    process.env.REPAIR_DOCS_ARCHIVE_UNC_ROOT,
  ]) {
    if (!configured || configured.trim().length === 0) continue;
    const normalized = normalizeQuoteFolderHelperRoot(configured);
    if (normalized !== null) roots.push(normalized);
  }

  if (roots.length === 0) return { status: "unset" };
  const [first, ...rest] = roots;
  return { status: "ok", roots: [first, ...rest] };
}

/**
 * 모은 루트 목록을 도우미를 만드는 함수들의 입력으로 바꾼다 — 첫째가 `uncRoot`, 나머지가
 * `extraRoots` 다(중복은 requireRoots 가 줄인다). 부르는 쪽(통로)이 루트 값을 여러 자리에서
 * 만지지 않게 하려고 한 함수로 둔다.
 */
export function quoteFolderHelperRootsInput(roots: readonly [string, ...string[]]): QuoteFolderHelperRootsInput {
  return { uncRoot: roots[0], extraRoots: roots.slice(1) };
}

/**
 * ============================================================================
 * 🔴 설치 파일 · 설치 명령을 **받을 수 있는 사람** (2026-09-30 · 2026-10-07 사용자 결정)
 * ============================================================================
 * [폴더 열기]가 있는 화면이 둘이 되었다 — 견적서 편집 화면과 고객사 현황표 패널
 * (components/customer-portal/CustomerFormExportPanel.tsx). 사용자가 「[폴더 열기] 버튼이 있는
 * 곳 어디서든 설치할 수 있도록」이라고 정했으므로, 설치 통로는 **이 목록 가운데 하나의 READ**
 * 로 연다(2026-09-30 에는 둘이었고, 2026-10-07 에 셋이 되었다 — 아래).
 *
 * ── 왜 넓혀야 했나 ───────────────────────────────────────────────────────
 * 기본 정책에서는 `quotes` 를 볼 수 있는 역할과 `customerPortal` 을 볼 수 있는 역할이 같은
 * 집합이라(SUPER_ADMIN · ADMIN · SALES · AS_ENGINEER — auth/permission-baseline.ts) 지금은
 * 공백이 없다. 하지만 관리자가 [역할별 접근 권한]에서 어떤 역할의 `quotes` 를 NONE 으로 낮추고
 * `customerPortal` 은 READ 로 두면, 그 역할은 **현황표를 보면서도 설치 파일을 못 받는다.**
 * 그 구멍을 막는 것이 이 함수다.
 *
 * ── 🔴 2026-10-07 — 제품 모델 화면이 셋째가 되었다 ────────────────────────
 * 제품 종류마다 **같은 서류를 돌려 쓰는** 「수리 관련」 공유폴더를 가리키는 기능이 제품 모델
 * 화면에 들어온다(위 REPAIR_DOCS_FOLDER_HELPER_ROOT_ENV). 그 화면에서도 [폴더 열기]를 누르므로
 * 거기서도 설치 명령을 받을 수 있어야 한다 — **2026-09-30 과 같은 결정의 같은 까닭**이다.
 *
 * 🔴 **고른 열쇠는 `productModels.view`(제품 모델 조회)다 — `productModels.files`(사진·도면)가
 * 아니다.** 까닭 셋:
 *  · 이 문은 「**그 화면을 볼 수 있는 사람**」의 문이다. 앞의 둘도 그렇다(견적서 보기 · 현황표
 *    보기). 파일 관리(WRITE)로 잠그면 **버튼은 보이는데 설치 파일은 못 받는 사람**이 생긴다 —
 *    그것이 2026-09-30 에 막은 바로 그 구멍이다.
 *  · 묻는 수준은 **READ 그대로**다(통로가 WRITE 로 올리지 않는다). `productModels.files` 는
 *    읽기가 없는 노드라(auth/permission-baseline.ts 의 `read: false`) READ 로 물으면 「파일을
 *    관리할 수 있는가」를 에둘러 묻는 꼴이 된다 — 묻는 말과 뜻하는 말이 어긋난다.
 *  · 메뉴 열쇠 `productModels` 가 아니라 **잎** `productModels.view` 인 까닭: 메뉴 열쇠는 잎들의
 *    최대값이라(auth/permission-resolver.ts) 보기가 NONE 이고 삭제·복원만 열린 역할도 통과한다 —
 *    화면 자체를 못 보는 사람이다.
 *
 * ── 🔴 무엇이 넓어지고 무엇이 안 넓어지는가 ───────────────────────────────
 * 넓어지는 것은 **누가 설치 파일 · 설치 명령을 받을 수 있나**뿐이다.
 * 🔴 도우미가 **열 수 있는 폴더는 한 뼘도 넓어지지 않는다** — 루트는 설치할 때 본문에 박히고
 * (resolveQuoteFolderHelperInstallRoots), 도우미는 그 루트 아래의 폴더만 연다(머리말 불변식 (a)).
 * 설치 파일을 더 많은 사람이 받아도 그 사람의 PC 가 열 수 있는 폴더 목록은 똑같다.
 * 🔴 2026-10-07 에 루트가 하나 늘어난 것(수리 관련 서류)은 **이 상수와 무관하다** — 그 루트는
 * 환경변수를 채우는 순간 늘어나고, 이 목록에 제품 모델을 더하지 않아도 똑같이 늘어난다. 두
 * 변화는 한 조각에 함께 들어왔을 뿐 서로를 키우지 않는다.
 * 🔴 **기본 정책에서는 받을 수 있는 사람이 한 명도 늘지 않는다** — `productModels.view` 가 READ
 * 인 네 역할(SUPER_ADMIN · ADMIN · AS_ENGINEER · SALES)은 `quotes` READ 로 이미 받을 수 있다
 * (auth/permission-baseline.ts). 달라지는 경우는 관리자가 [역할별 접근 권한]에서 `quotes` 와
 * `customerPortal` 을 NONE 으로 낮추고 제품 모델 조회만 남겨 둔 역할이 있을 때뿐이다 — 실제로
 * 무엇이 달라지는지는 **저장된 값**이 정한다(코드가 아니다).
 *
 * ── 🔴 「누구나」가 되지 않는다 ───────────────────────────────────────────
 * 셋 **다** NONE 인 사람은 여전히 거절이다(403). 이 함수는 목록을 돌며 하나라도 통과하면
 * 참이고, 하나도 통과하지 못하면 거짓이다 — 빈 목록이 될 수 없게 상수를 튜플로 못 박는다.
 * 저장 모드 · 세션 · 살아 있는 계정 · 승인은 이 앞에서 이미 걸렀다(통로의 순서).
 * ============================================================================
 */
export const QUOTE_FOLDER_HELPER_INSTALL_AREA_KEYS: readonly [string, ...string[]] = [
  "quotes",
  "customerPortal",
  // 🔴 보기(READ)다 — 파일 관리(WRITE)가 아니다. 까닭은 위 머리말 「2026-10-07」.
  "productModels.view",
];

/**
 * 이 사람이 설치 파일 · 설치 명령을 받을 수 있는가. 권한을 **묻는 방법**은 부르는 쪽이 준다
 * (`canRead`) — 이 모듈이 세션 · DB 를 끌어들이지 않게, 그리고 시험이 값으로 볼 수 있게.
 * 하나라도 참이면 참, 하나도 없으면 **거짓**이다.
 */
export async function mayInstallQuoteFolderHelper(
  canRead: (areaKey: string) => Promise<boolean>
): Promise<boolean> {
  for (const areaKey of QUOTE_FOLDER_HELPER_INSTALL_AREA_KEYS) {
    if ((await canRead(areaKey)) === true) return true;
  }
  return false;
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
 * 도우미가 **차례로 시도할** 루트들. 첫째는 반드시 있어야 하고, 나머지(`uncRootAlt` ·
 * `extraRoots`)는 없어도 된다.
 *
 * 왜 여럿인가 — 두 가지 까닭이 겹쳐 있다.
 *  1) **같은 폴더의 다른 주소**(`uncRootAlt`): 같은 공유폴더를 가리키는 주소가 PC 마다 다르게
 *     닿는다. 이름(`\\DSS-NAS\…`)은 이름 풀이가 되는 PC 에서만 열리고, IP(`\\192.168.0.222\…`)는
 *     이름 풀이와 무관하지만 NAS 주소가 바뀌면 죽는다. 하나만 두면 그 하나가 안 되는 PC 에서는
 *     [폴더 열기]가 통째로 먹통이 된다.
 *  2) **다른 폴더**(`extraRoots`): 고객사 현황표 공유폴더는 견적서 루트 아래가 아니다(실측
 *     2026-09-30). 도우미는 PC 당 한 벌이라 따로 설치할 수 없으므로 한 벌에 함께 심는다.
 *
 * 🔴 불변식 (a) 는 그대로다 — 루트는 **설치 때 정해지고** 웹 페이지가 바꿀 수 없으며, 열 수 있는
 *    것은 그 루트들 **아래의 폴더**뿐이다. 담김 검사는 시도하는 루트마다 따로 한다(스크립트 (e)).
 * 같은 값이 둘 들어오면 하나로 줄인다(대소문자 무시) — 없는 서버를 두 번 기다리지 않게.
 */
function requireRoots(input: QuoteFolderHelperRootsInput): string[] {
  const roots = [requireRoot(input.uncRoot)];
  const seen = new Set([roots[0].toLowerCase()]);
  for (const candidate of [input.uncRootAlt, ...(input.extraRoots ?? [])]) {
    const trimmed = candidate?.trim();
    if (trimmed === undefined || trimmed.length === 0) continue;
    // 🔴 여기서도 루트 검사를 그대로 거친다 — 규칙 밖 값은 스크립트에 박히지 않는다.
    const normalized = requireRoot(trimmed);
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    roots.push(normalized);
  }
  return roots;
}

/**
 * 🔴 IPv4 주소 그대로인가 — `192.168.0.222` 처럼 **네 토막 모두 숫자**여야 참이다.
 * 앞의 0(`010.1.1.1`)은 거짓으로 본다 — Windows 가 다르게 읽을 수 있는 모양은 등록하지 않는다.
 * 이름(`DSS-NAS` · `nas.example.com`)은 전부 거짓이다.
 */
function isIpv4Literal(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

/**
 * ============================================================================
 * 🔴 「로컬 인트라넷」 영역에 등록할 주소들 — 설치본에 심는 루트들에서 뽑는다 (2026-10-05)
 * ============================================================================
 * 까닭 · 지키는 것 일곱은 머리말 「설치가 함께 하는 일」. 여기서 하는 일은 셋뿐이다:
 *  · UNC 루트(`\\<호스트>\공유\…`)의 **호스트 토막**만 꺼낸다. 드라이브 경로(`Z:\…`)는 호스트가
 *    없으므로 건너뛴다.
 *  · 🔴 **IP 가 아니면 버린다** — 이름은 Windows 가 이미 인트라넷으로 보므로 건드리지 않는다.
 *  · 🔴 **같은 호스트는 한 번만** 남긴다(견적서 · 현황표 · 연락서가 같은 NAS 인 경우).
 * 루트 검사(requireRoots)를 그대로 거치므로 규칙 밖 루트는 여기서도 던진다.
 * 돌려주는 값은 payload(base64) 안으로만 간다 — 설치 명령의 날 글자에는 나오지 않는다.
 * ============================================================================
 */
export function quoteFolderHelperZoneHosts(input: QuoteFolderHelperRootsInput): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const root of requireRoots(input)) {
    if (!root.startsWith("\\\\")) continue;
    const host = root.slice(2).split("\\")[0];
    if (!isIpv4Literal(host)) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

/**
 * open-dss-folder.ps1 의 본문(줄 끝 CRLF). 할 일과 거절 규칙은 머리말 (a) · (b).
 *
 * 표준출력 형식(DSS_FOLDER_DRY_RUN=1 일 때만): `OPEN <폴더 전체 경로>` ·
 * `OPEN-FILE <파일 전체 경로>` · `XLSX2PDF <원본 전체 경로> -> <결과 전체 경로>` · `NOT-FOUND` ·
 * `REJECT <까닭>`. 끝남 코드: 0 열었음(바꿨음) · 2 주소 모양 · 3 경로 규칙 · 루트 밖 · 바로 가기 ·
 * 확장자 · 파일 아님 · 쓸 곳이 규칙 밖 · 4 없음 · 🔴 5 이 PC 에 Excel 이 없음 · 9 그 밖의 오류.
 *
 * 🔴 DRY_RUN 에서는 **Excel 을 부르지 않고 쓰지도 않는다** — 「어디에 쓸 것인가」까지만 적고
 * 끝낸다. 그래서 시험이 **쓰지 않고도** 결과 경로 규칙을 값으로 확인할 수 있다.
 */
export function buildQuoteFolderHelperScript(input: QuoteFolderHelperRootsInput): string {
  const roots = requireRoots(input);
  const script = String.raw`# ============================================================================
# DSS 견적서 폴더 열기 도우미 (${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME})
# ============================================================================
# 설치 파일(${QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME})이 이 PC 의 현재 사용자에게 만든 파일입니다.
# 손으로 고치지 마세요. 공유폴더 주소가 바뀌면 설치 파일을 새로 받아 다시 실행하면 됩니다.
#
# 브라우저의 dss-folder:// 주소를 받아, 아래 루트 아래의 것만 엽니다.
#   dss-folder://open/?p=...     폴더를 Windows 탐색기로
#   dss-folder://openfile/?p=... 파일 하나를 이 PC 의 연결 프로그램으로(아래 허용 목록의 확장자만)
#   dss-folder://xlsx2pdf/?p=... .xlsx 한 장을 이 PC 의 Excel 로 PDF 로 바꿔 같은 폴더에 씁니다
# 허용 목록 밖 확장자 · 확장자 없는 이름 · 폴더에 파일 이름을 붙인 것 · 바로 가기(정션 · 심볼릭)를
# 지나는 경로 · 루트 밖은 열지 않습니다. 기록(로그) · 네트워크가 없습니다.
# 🔴 쓰는 곳은 원본과 같은 폴더의 같은 이름 .pdf 하나뿐입니다(주소가 고르지 못합니다).
#
# 지우려면:
#   reg delete "HKCU\Software\Classes\dss-folder" /f
#   del "%LOCALAPPDATA%\DSS\${QUOTE_FOLDER_HELPER_SCRIPT_FILE_NAME}"
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# 공유폴더 루트 — 설치 때 정해졌습니다. 웹 페이지(주소)는 이 값을 바꿀 수 없습니다.
# 여럿이면 차례로 해 보고, 처음으로 실제 있는 폴더를 엽니다. 여럿인 까닭은 둘입니다:
#  · 같은 폴더를 가리키는 주소가 여럿(이름으로 안 닿는 PC 에서는 IP 로, 그 반대도).
#  · 서로 다른 공유폴더가 여럿(견적서 · 고객사 현황표).
# 어느 루트로 시도하든 「그 루트 아래인가」는 아래 (e) 에서 **루트마다 따로** 봅니다.
$Roots = @(${roots.map((r) => powerShellSingleQuoted(r)).join(", ")})
$Prefix = '${QUOTE_FOLDER_LINK_PREFIX}'
$FilePrefix = '${QUOTE_FOLDER_FILE_LINK_PREFIX}'
# 🔴 셋째 — 쓰는 명령. 원본 확장자는 이것 하나뿐입니다.
$ConvertPrefix = '${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}'
$ConvertSourceSuffix = '.${QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION}'
$ConvertOutputSuffix = '.${QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION}'

# 🔴 열 수 있는 확장자 — **허용 목록**입니다. 여기 없는 것은 전부 거절합니다(거절 목록이
# 아닙니다). 서버의 domain/quote-folder-file-link.ts 와 글자 그대로 같은 한 벌입니다.
$OpenableExtensions = @(${QUOTE_FOLDER_OPENABLE_EXTENSIONS.map((e) => `'${e}'`).join(", ")})
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

# 🔴 (검사 5) 파일이 있나 — 'found' · 'directory' · 'missing' · 'unreachable'.
# 'directory' 는 **폴더에 .pdf 같은 이름을 붙여 둔 함정**입니다. File::Exists 는 폴더에 $false 를
# 주지만, 「없다」와 섞어 버리면 다음 루트로 넘어가 조용히 끝납니다 — 따로 가려 거절합니다.
# try/catch 가 있는 까닭은 Test-FolderState 와 같습니다(못 닿는 서버 이름은 던진다).
function Test-FileState([string]$Path) {
  try {
    if ([System.IO.Directory]::Exists($Path)) { return 'directory' }
    if ([System.IO.File]::Exists($Path)) { return 'found' }
    return 'missing'
  } catch {
    return 'unreachable'
  }
}

# 🔴 (검사 4 · 6) 이 이름을 열어도 되는가 — 허용 목록에 든 확장자인가.
#  · 점이 없으면(「문서」) 거절합니다. 점이 맨 앞이어도(「.pdf」) 거절합니다 — 확장자가 없는
#    것으로 봅니다(검사 6).
#  · 확장자는 접어서 봅니다(「.PDF」도 같은 것, 「.EXE」도 당연히 거절). ToLowerInvariant 로
#    접고 -ceq 로 맞춥니다 — 지역 설정이 비교를 바꾸지 못하게.
#  · 끝에 점 · 공백이 붙은 이름(「보고서.pdf.」 · 「보고서.pdf 」— Windows 가 조용히 뗍니다)은
#    Test-RelativePath 가 **먼저** 막습니다.
function Test-OpenableFileName([string]$Name) {
  $dot = $Name.LastIndexOf([char]'.')
  if ($dot -lt 1) { return $false }
  if ($dot -ge ($Name.Length - 1)) { return $false }
  $extension = $Name.Substring($dot + 1).ToLowerInvariant()
  foreach ($allowed in $OpenableExtensions) {
    if ($extension -ceq $allowed) { return $true }
  }
  return $false
}

# 🔴 (검사 8) .xlsx 하나뿐입니다 — 쓰는 명령이라 위 허용 목록보다 좁습니다.
function Test-XlsxFileName([string]$Name) {
  $dot = $Name.LastIndexOf([char]'.')
  if ($dot -lt 1) { return $false }
  if ($dot -ge ($Name.Length - 1)) { return $false }
  return ($Name.Substring($dot).ToLowerInvariant() -ceq $ConvertSourceSuffix)
}

# 🔴 (검사 11) 결과 자리에 써도 되는가 — 없으면 참(아직 안 만든 PDF) · 보통 파일이면 참
# (덮어씁니다) · 바로 가기면 거짓(루트 밖에 쓰입니다) · 폴더면 거짓 · 확인 못 해도 거짓.
function Test-WritableOutput([string]$Path) {
  $attributes = $null
  try {
    $attributes = [System.IO.File]::GetAttributes($Path)
  } catch [System.IO.FileNotFoundException] {
    return $true
  } catch {
    return $false
  }
  if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) { return $false }
  return $true
}

# 루트부터 그 폴더(또는 파일)까지 마디마다 바로 가기(정션 · 심볼릭 링크)가 없는가.
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

  # (b) dss-folder://open/?p= (폴더) · dss-folder://openfile/?p= (파일) 모양이 아니면 끝.
  #     🔴 접두어가 **동작을 가릅니다.** 폴더 쪽은 예전과 한 글자도 다르지 않습니다.
  #     xlsx2pdf/ (🔴 쓰는 명령)가 더해졌고 앞의 둘은 바뀌지 않았습니다.
  $Mode = 'folder'
  $NotAFile = $false
  if ($link.StartsWith($Prefix, [System.StringComparison]::Ordinal)) {
    if ($link.Length -gt ($Prefix.Length + $MaxEncodedLength)) { Stop-Helper 'REJECT not-a-folder-link' 2 }
    $encoded = $link.Substring($Prefix.Length)
  } elseif ($link.StartsWith($FilePrefix, [System.StringComparison]::Ordinal)) {
    if ($link.Length -gt ($FilePrefix.Length + $MaxEncodedLength)) { Stop-Helper 'REJECT not-a-folder-link' 2 }
    $Mode = 'file'
    $encoded = $link.Substring($FilePrefix.Length)
  } elseif ($link.StartsWith($ConvertPrefix, [System.StringComparison]::Ordinal)) {
    if ($link.Length -gt ($ConvertPrefix.Length + $MaxEncodedLength)) { Stop-Helper 'REJECT not-a-folder-link' 2 }
    $Mode = 'xlsx2pdf'
    $encoded = $link.Substring($ConvertPrefix.Length)
  } else {
    Stop-Helper 'REJECT not-a-folder-link' 2
  }
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

  # (d) 상대 경로 규칙 — 🔴 검사 1. 폴더든 파일이든 **같은 규칙**이다.
  if (-not (Test-RelativePath $relative)) { Stop-Helper 'REJECT bad-path' 3 }

  # (d-2) 🔴 검사 4 · 6 — 파일일 때만. 허용 목록 밖 · 확장자 없는 이름은 여기서 끝난다.
  #       맨 뒤 마디(파일 이름)만 본다 — 가운데 폴더 이름에는 확장자 규칙이 없다.
  if ($Mode -ceq 'file') {
    $segments = $relative.Split([char]'/')
    if (-not (Test-OpenableFileName $segments[$segments.Length - 1])) { Stop-Helper 'REJECT bad-extension' 3 }
  }

  # (d-3) 🔴 검사 8 — .xlsx 밖은 여기서 끝납니다.
  if ($Mode -ceq 'xlsx2pdf') {
    $segments = $relative.Split([char]'/')
    if (-not (Test-XlsxFileName $segments[$segments.Length - 1])) { Stop-Helper 'REJECT bad-extension' 3 }
  }

  # (e~f) 루트를 차례로 — 담김 검사는 **루트마다 따로** 하고, 처음으로 실제 있는 것을 고른다.
  $target = $null
  $contained = $false
  $reparse = $false
  # 🔴 고른 것이 어느 루트 아래였나 — 결과 경로에도 같은 담김 검사를 겁니다.
  $targetRoot = ''
  foreach ($candidateRoot in $Roots) {
    # (e) 🔴 검사 2 — 루트와 이어 편 뒤, 루트 + '\' 로 시작하는지(대소문자 무시).
    $rootFull = [System.IO.Path]::GetFullPath($candidateRoot).TrimEnd('\')
    $full = [System.IO.Path]::GetFullPath($rootFull + '\' + $relative.Replace('/', '\'))
    if (-not $full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    $contained = $true

    if ($Mode -ceq 'file') {
      # (f-2) 🔴 검사 5 — 파일인가. 폴더에 파일 이름을 붙여 둔 것이면 다음 루트로 넘기지 않고
      #       여기서 멈춘다(안전한 쪽) — 수상한 것을 봤으면 열지 않는다.
      $state = Test-FileState $full
      if ($state -ceq 'directory') { $NotAFile = $true; break }
      if ($state -cne 'found') { continue }
    } elseif ($Mode -ceq 'xlsx2pdf') {
      # (f-3) 🔴 원본이 실제 파일일 때만 — (f-2) 와 같은 모양입니다.
      $state = Test-FileState $full
      if ($state -ceq 'directory') { $NotAFile = $true; break }
      if ($state -cne 'found') { continue }
    } else {
      # (f) 폴더가 아니면(없음 · 파일 · 서버에 못 닿음) 다음 루트로.
      if ((Test-FolderState $full) -ne 'found') { continue }
    }

    # 🔴 검사 3 — 루트 아래 마디 가운데 바로 가기(정션 · 심볼릭 링크)는 루트 밖을 가리킬 수 있다.
    # 파일일 때는 **마지막 마디(파일 자신)까지** 본다. 열지 않는다.
    # 다음 루트로 넘기지 않고 여기서 멈춘다(안전한 쪽). 같은 폴더를 다른 주소로 열어도 같은 바로
    # 가기이고, 루트가 서로 다른 폴더일 때도 «수상한 것을 봤으면 열지 않는다»가 낫다.
    if (-not (Test-NoReparsePoint $rootFull $relative)) { $reparse = $true; break }

    $target = $full
    $targetRoot = $rootFull
    break
  }

  if ($reparse) {
    # 🔴 폴더 쪽 문구는 예전 그대로다 — 파일 쪽만 따로 적는다.
    if ($Mode -ceq 'file') { Show-Message '이 파일은 바로 가기라 열 수 없습니다.' }
    elseif ($Mode -ceq 'xlsx2pdf') { Show-Message '이 파일은 바로 가기라 PDF 로 바꿀 수 없습니다.' }
    else { Show-Message '이 폴더는 바로 가기 폴더라 열 수 없습니다.' }
    Stop-Helper 'REJECT reparse-point' 3
  }

  if ($NotAFile) {
    Show-Message '이것은 파일이 아니라 폴더입니다 — 열지 않았습니다.'
    Stop-Helper 'REJECT not-a-file' 3
  }

  # 어느 루트 아래에도 들지 않는 경로 — 규칙 위반이다(없는 폴더와 구별한다).
  if (-not $contained) { Stop-Helper 'REJECT outside-root' 3 }

  if ($null -eq $target) {
    # 🔴 폴더 쪽 문구는 예전 그대로다 — 파일 쪽만 따로 적는다.
    if ($Mode -ceq 'file') { Show-Message ('파일을 찾을 수 없습니다.' + [System.Environment]::NewLine + '공유폴더 연결을 확인하거나, 파일이 옮겨졌는지 확인해 주세요.') }
    elseif ($Mode -ceq 'xlsx2pdf') { Show-Message ('파일을 찾을 수 없습니다.' + [System.Environment]::NewLine + '공유폴더 연결을 확인하거나, 파일이 옮겨졌는지 확인해 주세요.') }
    else { Show-Message ('폴더를 찾을 수 없습니다.' + [System.Environment]::NewLine + '공유폴더 연결을 확인하거나, 견적서 폴더가 옮겨졌는지 확인해 주세요.') }
    Stop-Helper 'NOT-FOUND' 4
  }
  $full = $target

  # (g-3a) 🔴 검사 9 · 10 · 11 — 쓸 곳은 여기서 정합니다(주소가 고르지 못합니다): '.xlsx' 를
  #        '.pdf' 로 바꾼 뒤, 같은 폴더 · 같은 이름인지 · 루트 안인지 · 써도 되는 자리인지.
  $pdf = ''
  if ($Mode -ceq 'xlsx2pdf') {
    if ($full.EndsWith($ConvertSourceSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $pdf = $full.Substring(0, $full.Length - $ConvertSourceSuffix.Length) + $ConvertOutputSuffix
    }
    if ($pdf.Length -eq 0) { Stop-Helper 'REJECT bad-output' 3 }
    if ([System.IO.Path]::GetDirectoryName($pdf) -cne [System.IO.Path]::GetDirectoryName($full)) { Stop-Helper 'REJECT bad-output' 3 }
    if ([System.IO.Path]::GetFileName($pdf) -cne ([System.IO.Path]::GetFileNameWithoutExtension($full) + $ConvertOutputSuffix)) { Stop-Helper 'REJECT bad-output' 3 }
    if (-not $pdf.StartsWith($targetRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Helper 'REJECT outside-root' 3 }
    if (-not (Test-WritableOutput $pdf)) { Stop-Helper 'REJECT bad-output' 3 }
  }

  if ($DryRun -and ($Mode -ceq 'file')) { Stop-Helper ('OPEN-FILE ' + $full) 0 }
  if ($DryRun -and ($Mode -ceq 'xlsx2pdf')) { Stop-Helper ('XLSX2PDF ' + $full + ' -> ' + $pdf) 0 }
  if ($DryRun) { Stop-Helper ('OPEN ' + $full) 0 }

  # (g-3) 🔴 파일을 쓰는 곳은 여기 하나뿐입니다. 창은 띄우지 않고 원본은 읽기 전용으로 엽니다.
  #       🔴 성공이든 실패든 finally 에서 닫습니다. Excel 이 없으면 조용히 끝냅니다(5).
  if ($Mode -ceq 'xlsx2pdf') {
    if ([System.IO.Directory]::Exists($full)) { Stop-Helper 'REJECT not-a-file' 3 }
    if (-not [System.IO.File]::Exists($full)) { Stop-Helper 'NOT-FOUND' 4 }
    $excel = $null
    $book = $null
    $failed = ''
    try {
      try { $excel = New-Object -ComObject Excel.Application } catch { $excel = $null }
      if ($null -eq $excel) {
        $failed = 'no-excel'
      } else {
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $book = $excel.Workbooks.Open($full, 0, $true)
        # 🔵 덮어씁니다 — 지우는 것은 위에서 정한 이 한 경로뿐입니다.
        if ([System.IO.File]::Exists($pdf)) { [System.IO.File]::Delete($pdf) }
        # 0 = xlTypePDF
        $book.ExportAsFixedFormat(0, $pdf)
      }
    } catch {
      $failed = 'convert'
    } finally {
      if ($null -ne $book) { try { $book.Close($false) } catch { } }
      if ($null -ne $excel) { try { $excel.Quit() } catch { } }
      if ($null -ne $book) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book) } catch { } }
      if ($null -ne $excel) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch { } }
      $book = $null
      $excel = $null
      [System.GC]::Collect()
      [System.GC]::WaitForPendingFinalizers()
    }
    if ($failed -ceq 'no-excel') { Stop-Helper 'REJECT no-excel' 5 }
    if ($failed -cne '') { Show-Message 'PDF 로 바꾸지 못했습니다.'; Stop-Helper 'REJECT convert-failed' 9 }
    exit 0
  }

  # (g-2) 🔴 검사 7 — 이 PC 의 연결 프로그램으로 **그 파일 하나**를 연다.
  #       인자는 그 전체 경로 하나뿐입니다 — 인자 목록을 따로 넘기지 않고, 명령줄을 문자열로
  #       조립하지도 않습니다.
  #       여기까지 오려면 검사 1~6 을 모두 지났다. 마지막으로 한 번 더 「파일인가」를 본다.
  if ($Mode -ceq 'file') {
    if ([System.IO.Directory]::Exists($full)) { Stop-Helper 'REJECT not-a-file' 3 }
    if (-not [System.IO.File]::Exists($full)) { Stop-Helper 'NOT-FOUND' 4 }
    Start-Process -FilePath $full
    exit 0
  }

  # (g) 탐색기에 그 폴더 경로만 넘긴다. 끝의 '\' 는 폴더로만 읽히게 한다.
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
 * 🔴 영역 지정이 들어 있는 레지스트리 자리 — **HKCU 아래** 경로다(HKLM 이 아니다).
 * 시험은 이 값을 쓰지 않고 `$zoneRangesPath` 에 임시 키를 넣어 돌린다 — 그래야 진짜 영역 설정을
 * 건드리지 않는다.
 */
export const QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\ZoneMap\\Ranges";

/**
 * ============================================================================
 * 🔴 영역 등록 알맹이 (한 줄) — 앞에서 `$zoneHostText` · `$zoneRangesPath` 가 정해져 있어야 한다
 * ============================================================================
 * 끝나면 `$zoneWanted`(등록해야 할 주소 수)와 `$zoneCount`(실제로 등록한 수)가 든다.
 * 🔴 **던지지 않는다** — 통째로 try/catch 안이고 catch 는 비어 있다. 영역 등록은 곁다리라서,
 * 여기서 막혀 폴더 열기가 안 깔리면 안 된다(머리말 7).
 *
 * 하는 일:
 *  · `$zoneHostText` 를 줄 단위로 끊어 빈 줄을 버린다(payload `ZONEHOSTS`).
 *  · `Ranges` 키를 **HKCU 에서** 연다(없으면 만든다).
 *  · 주소마다 — 이미 같은 `:Range` 가 있는 `RangeN` 을 찾으면 **그 키를 쓰고**, 없으면
 *    **안 쓰이는 번호**(Range1, Range2 … 대소문자 무시)를 골라 새로 만든다.
 *    🔴 다른 `RangeN` 은 읽기만 한다 — 값을 쓰는 것은 고른 키 하나뿐이다.
 *  · 그 키에 `:Range`(REG_SZ)와 `*` = 1(REG_DWORD — 로컬 인트라넷)을 적는다.
 *
 * 🔴 cmd 줄 안에 들어가므로 `"` · `%` · `!` · `^` · `&` · `|` · `<` · `>` 가 하나도 없다
 * (시험이 지킨다). 그래서 파이프(Where-Object)를 쓰지 않고 foreach 로만 돈다.
 * 되돌리는 법은 머리말 「영역 등록을 되돌리는 법」 — 지우는 코드는 **만들지 않는다.**
 * ============================================================================
 */
export const QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS = String.raw`$zoneWanted = 0; $zoneCount = 0; try { $zoneHosts = @(); foreach ($zoneLine in $zoneHostText.Split([char]10)) { $zoneTrimmed = $zoneLine.Trim(); if ($zoneTrimmed.Length -ne 0) { $zoneHosts = $zoneHosts + $zoneTrimmed } }; $zoneWanted = $zoneHosts.Count; if ($zoneWanted -ne 0) { $zoneRanges = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($zoneRangesPath); try { foreach ($zoneHost in $zoneHosts) { $zoneNames = $zoneRanges.GetSubKeyNames(); $zoneName = ''; foreach ($zoneCandidate in $zoneNames) { if ($zoneName -eq '') { $zoneExisting = $zoneRanges.OpenSubKey($zoneCandidate); if ($null -ne $zoneExisting) { $zoneRange = $zoneExisting.GetValue(':Range'); $zoneExisting.Close(); if ($zoneRange -is [string]) { if ([string]::Equals($zoneRange, $zoneHost, [System.StringComparison]::OrdinalIgnoreCase)) { $zoneName = $zoneCandidate } } } } }; if ($zoneName -eq '') { $zoneNumber = 1; $zoneTaken = $true; while ($zoneTaken) { $zoneTaken = $false; foreach ($zoneCandidate in $zoneNames) { if ([string]::Equals($zoneCandidate, 'Range' + $zoneNumber, [System.StringComparison]::OrdinalIgnoreCase)) { $zoneTaken = $true } }; if ($zoneTaken) { $zoneNumber = $zoneNumber + 1 } }; $zoneName = 'Range' + $zoneNumber }; $zoneKey = $zoneRanges.CreateSubKey($zoneName); $zoneKey.SetValue(':Range', $zoneHost, [Microsoft.Win32.RegistryValueKind]::String); $zoneKey.SetValue('*', 1, [Microsoft.Win32.RegistryValueKind]::DWord); $zoneKey.Close(); $zoneCount = $zoneCount + 1 } } finally { $zoneRanges.Close() } } } catch { }`;

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
  // ── 🔴 여기부터는 곁다리다 — 폴더 열기 등록은 **위에서 이미 끝났다**(머리말 7). ──
  //    payload 를 못 읽어도, 영역 등록이 실패해도 아래 「설치했습니다」까지 간다.
  String.raw`$zoneHostText = ''`,
  String.raw`try { $zoneHostText = [System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'ZONEHOSTS')) } catch { $zoneHostText = '' }`,
  String.raw`$zoneRangesPath = '${QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH}'`,
  QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS,
  String.raw`Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'DONE')))`,
  // 사람이 보는 결과 문구에 **무엇을 했는지** 한 줄. 등록할 주소가 없으면 아무 줄도 내지 않는다.
  String.raw`if ($zoneWanted -ne 0) { if ($zoneCount -eq $zoneWanted) { Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'ZONE'))) } else { Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'ZONEFAIL'))) } } } catch { Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'FAILED'))); Write-Host $_.Exception.Message; exit 1 }`,
];

/** cmd 줄에 들어가는 PowerShell `-Command` 본문. */
export function quoteFolderHelperInstallCommand(): string {
  return INSTALL_STATEMENTS.join("; ");
}

/**
 * 🔴 영역 등록할 주소 목록을 payload 바이트로 — 한 줄에 하나, 끝에도 줄바꿈.
 * 비어 있어도 **빈 payload 를 만들지 않는다**(읽개가 「덩어리가 없다」로 보고 던진다) —
 * 등록할 주소가 없으면 줄바꿈 하나만 들어가고, PowerShell 쪽에서 빈 줄은 버린다.
 */
function quoteFolderHelperZoneHostsBytes(input: QuoteFolderHelperRootsInput): Uint8Array {
  return new Uint8Array(Buffer.from(`${quoteFolderHelperZoneHosts(input).join("\n")}\n`, "utf8"));
}

/**
 * 설치가 PC 로 옮기는 것 — 도우미 스크립트 · 설치 완료 문구 · 실패 문구, 그리고 🔴 영역 등록 셋
 * (등록할 주소 목록 · 등록했다는 문구 · 등록만 실패했다는 문구).
 * 🔴 설치 파일(base64 덩어리)과 붙여넣는 설치 명령(base64 문자열)이 **이 한 벌**을 함께 쓴다.
 * 🔴 **차례는 뒤에만 더한다** — 앞의 셋은 글자 하나 움직이지 않는다(이미 설치된 PC 와 비교하기 쉽게).
 */
function quoteFolderHelperPayloads(input: QuoteFolderHelperRootsInput): ReadonlyArray<{ name: string; bytes: Uint8Array }> {
  return [
    { name: "HELPER", bytes: quoteFolderHelperScriptBytes(input) },
    { name: "DONE", bytes: new Uint8Array(Buffer.from(QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE, "utf8")) },
    { name: "FAILED", bytes: new Uint8Array(Buffer.from(QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE, "utf8")) },
    { name: "ZONEHOSTS", bytes: quoteFolderHelperZoneHostsBytes(input) },
    { name: "ZONE", bytes: new Uint8Array(Buffer.from(QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE, "utf8")) },
    { name: "ZONEFAIL", bytes: new Uint8Array(Buffer.from(QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE, "utf8")) },
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
    "rem    3. Adds the share host to the Local intranet zone for this user, so that",
    "rem       Windows stops asking about every file opened from that share:",
    "rem         HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    "rem           \\ZoneMap\\Ranges\\RangeN  [ :Range = host, * = 1 ]",
    "rem       Only IP hosts are added, each one once, and existing ranges are kept.",
    "rem       This step is optional - the helper is installed even if it fails.",
    "rem       Removing that zone entry is not automated - see the server source.",
    "rem  The helper only works under the share roots fixed at install time:",
    "rem    - dss-folder://open/...     opens a folder in Windows Explorer",
    "rem    - dss-folder://openfile/... opens ONE file with its associated program,",
    "rem      and only when its extension is on the allow list inside the helper.",
    "rem    - dss-folder://xlsx2pdf/... turns ONE .xlsx into a PDF with the Excel",
    "rem      on this PC. This is the ONLY thing the helper ever writes, and the link",
    "rem      cannot choose where it goes: the PDF is written next to the source,",
    "rem      with the same name. An existing PDF of that name is replaced. The",
    "rem      source .xlsx is opened read-only and is never changed. Excel stays",
    "rem      hidden and is always closed again.",
    "rem  It never runs programs, scripts or shortcuts.",
    "rem  Run this file again to repair the helper or to apply a new share root.",
    "rem  Older helpers do not know openfile or xlsx2pdf - run this again to add them.",
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
