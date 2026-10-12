import { normalizeShareFolderNameForCompare } from "./share-folder-naming";

/**
 * ============================================================================
 * 견적서 공유폴더의 **파일 이름에서 발행번호를 뽑는다** (순수 — 파일시스템 없음)
 * ============================================================================
 * 사내 공유폴더의 견적서 폴더 안은 평평하고, 파일 이름이 번호로 시작한다. 그 번호를
 * 뽑아 두면 「같은 장비의 지난 견적서」 줄에 **그 폴더가 어떤 번호들을 담고 있는지**를
 * 적어 줄 수 있다 — 폴더 이름 하나만 보면 가지 번호 · 개정본이 거기 들어 있는지 알 수 없다.
 *
 * ── 🔴 `quoteArchiveBaseNumber` 와 방향이 반대다 ──────────────────────────
 * 그 함수는 「번호 → 본 번호」(가지 번호 한 겹 떼기)이고 폴더를 **가르는** 데 쓴다.
 * 여기는 「파일 이름 → 번호」다. 둘은 서로를 대체하지 않는다 — 이 모듈은 그 함수를
 * 부르지도 않는다(뽑은 번호를 또 깎으면 `2026-001-1` 이 `2026-001` 로 보여 가지 번호가
 * 있다는 사실 자체가 사라진다).
 *
 * ── 받는 모양 (2026-10-06 실측, 2026 연도 폴더 파일 342 개) ────────────────
 *   DSS 2026-001 가나상사 ….xlsx       → 2026-001      (200 개)
 *   DSS 2026-001-1 가나상사 ….xls      → 2026-001-1    (가지, 55 개)
 *   DSS 2026-004R1 가나상사 ….pdf      → 2026-004R1    (개정, 27 개)
 *   DSS-2026-099 가나상사 ….xlsx       → 2026-099      (번호가 자유 입력이라 하이픈도 온다)
 *
 * ── 🔴 번호 **뒤에 공백**이 와야 한다 ────────────────────────────────────
 * 실측에 `DSS 2026-046- ICD …` 가 있었다 — 번호 뒤에 공백 대신 `-` 를 찍은 오타다. 그런
 * 이름에서 `2026-046` 을 뽑으면 **사람이 적지 않은 번호**를 우리가 지어내는 셈이다.
 * 뒤가 공백이 아니면 `null` 이고, 그 파일은 번호 없는 파일로 센다(실측에서 3 개).
 * 번호를 못 뽑은 나머지 둘도 `null` 이 맞다: `단가기재 참고용.XLS`(번호가 없다) ·
 * `RFK300FH-AD1_WN3769_1802083 검사보고서.pdf`(머리가 번호가 아니다).
 *
 * ── 왜 이름 **앞**에서만 보는가 ──────────────────────────────────────────
 * 사내 파일은 전부 번호로 시작한다. 이름 가운데를 뒤지면 모델명 · S/N 안의 숫자 뭉치가
 * 번호로 둔갑한다(`RFK300FH-AD1_WN3769_1802083` 같은 이름이 실제로 있다).
 * ============================================================================
 */

/**
 * `DSS` + 구분자 한 글자 + 번호 + **공백**.
 *
 * 번호는 `연도 네 자리-일련번호` 에 가지(`-1`) 나 개정(`R1`) 이 한 겹 붙는 모양까지다.
 * 대소문자를 접어 본다(`dss` · `r1` 로 적은 파일이 섞여 있어도 같은 번호로 센다).
 */
const ARCHIVE_FILE_NUMBER = /^DSS[ -](\d{4}-\d+(?:-\d+|R\d+)?)(?=\s)/i;

/**
 * 파일 이름 하나에서 발행번호를 뽑는다. 못 뽑으면 `null`. **던지지 않는다.**
 *
 * 비교 전에 다듬는 일(NFC · 연속 공백 하나 · 앞뒤 공백 걷기)은 공유폴더 공용 함수가
 * 한다 — 사람이 적은 이름이라 공백이 두 칸이거나 한글이 풀어쓴 모양일 수 있다.
 * 돌려주는 번호는 **대문자로 맞춘다**(`2026-004r1` 과 `2026-004R1` 이 한 번호로 묶이게).
 */
export function quoteNumberFromArchiveFileName(fileName: string): string | null {
  if (typeof fileName !== "string") return null;
  const match = ARCHIVE_FILE_NUMBER.exec(normalizeShareFolderNameForCompare(fileName));
  return match === null ? null : match[1].toLocaleUpperCase("en-US");
}

/**
 * 위 규칙의 「번호 **뒤에 공백**」에 맞추려고 발행번호 뒤에 붙이는 꼬리. 사내 파일 이름의
 * 기본 꼬리와 같은 글자라 붙여 놓으면 실제 파일 이름처럼 읽힌다 — 붙이는 글자 자체는 번호
 * 뽑기에 쓰이지 않는다.
 */
const NUMBER_PROBE_TAIL = " 수리 견적서";

/**
 * **발행번호**(`DSS 2026-078-3`)에서 견줄 키를 뽑는다. 못 뽑으면 `null`. **던지지 않는다.**
 *
 * 🔴 **파일 이름 쪽과 같은 규칙에 태운다** — 발행번호는 번호에서 끝나므로 꼬리 한 조각을
 * 붙여 위 함수를 그대로 지난다. 그래서 공백 · 대소문자 · `DSS` 뒤 하이픈을 **양쪽이
 * 똑같이** 접는다(실측 2026-10-06 에 `DSS-2026-099` · `dss 2026-001` · `2026-004r1` 이
 * 실제로 있다). 두 쪽을 따로 짜면 같은 번호가 한쪽에서만 맞는 날이 온다.
 *
 * 🔴 **이 셈은 한 곳에만 있다.** 견적서 목록의 [Excel 보기](components/quotes/
 * quote-archive-excel-open.ts)와 결재 탭의 공유폴더 거르기(components/quotes/
 * quote-archive-folder-number-filter.ts)가 **이 함수 하나**를 부른다 — 한때 [Excel 보기]
 * 안에만 있었고(이름도 Excel 에 묶여 있었다), 둘째 쓰는 곳이 생기면서 여기로 올렸다
 * (2026-10-12). 두 벌이 되면 **같은 화면 안에서 두 규칙이 싸운다**: [Excel 보기]는 찾아
 * 여는 파일을 바로 옆 공유폴더 구역은 숨기는 식으로.
 */
export function quoteArchiveNumberKey(quoteNumber: unknown): string | null {
  if (typeof quoteNumber !== "string") return null;
  return quoteNumberFromArchiveFileName(`${quoteNumber}${NUMBER_PROBE_TAIL}`);
}

/**
 * 번호 차례. 모양이 `연도-일련번호` 로 **자리수가 고정**(사내 실측상 세 자리)이라 글자
 * 그대로 견주면 그것이 곧 연도 · 일련번호 차례다. 로케일 비교를 쓰지 않는 까닭도 그것이다 —
 * 같은 값이 PC 설정에 따라 다른 차례로 보이면 안 된다.
 */
function compareArchiveFileNumbers(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 폴더 하나의 파일 이름들에서 번호를 뽑아 **중복을 없애고 차례대로** 돌려준다.
 * 번호가 하나도 없으면 빈 배열이다(사람이 넣은 참고 자료만 든 폴더가 실제로 있다).
 */
export function quoteNumbersFromArchiveFileNames(fileNames: readonly string[]): string[] {
  const found = new Set<string>();
  for (const fileName of fileNames) {
    const number = quoteNumberFromArchiveFileName(fileName);
    if (number !== null) found.add(number);
  }
  return [...found].sort(compareArchiveFileNumbers);
}
