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
 *   DSS 2026-095-1R1 가나상사 ….xls    → 2026-095-1R1  (가지 + 개정 — 🔴 바로 아래)
 *   DSS-2026-099 가나상사 ….xlsx       → 2026-099      (번호가 자유 입력이라 하이픈도 온다)
 *
 * ── 🔴 가지 + 개정이 함께 오는 모양 — 2026-10-12 에 늘었다 ────────────────
 * 위 실측(2026-10-06, 342 개)에는 `-1R1` 꼴이 **하나도 없었다** — 가지 55 개 · 개정 27 개가
 * 전부 한 겹씩이었다. 그 뒤 **가지 견적서를 개정하는 일**이 생겨 운영 공유폴더에 실제 폴더가
 * 만들어졌고, 2026-10-12 에 사용자가 [고객 안내 현황]에서 찾았다:
 *   DSS 2026-095 … 수리 견적서.xls
 *   DSS 2026-095-1 … 수리 견적서(OH포함).xls
 *   DSS 2026-095-1R1 … 수리 견적서….xls      ← 이것이 `null` 이었다
 * 한 겹만 받던 옛 규칙(`(?:-\d+|R\d+)?`)은 `-1` 을 먹은 뒤 `R` 앞에서 「번호 뒤 공백」에 걸려
 * **통째로** `null` 이 됐다. 그래서 화면의 `2026-095-1` 은 그 파일이 아니라 **옆의 `-1`
 * 파일**에서 온 번호였고, `-1R1` 이 안 뽑혔으니 아래 **개정본 가리기도 안 걸렸다.**
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
 *
 * ── 뽑은 **번호들을 고르는 일**도 여기다 (2026-10-12) ─────────────────────
 * 「고객 안내 현황」과 「주간보고」의 견적서 번호 칸이 번호를 두 번 추린다 —
 * `latestArchiveFileNumber` 로 **그 장비의 최신 견적서 폴더**를 고르고,
 * `hideSupersededArchiveFileNumbers` 로 **개정본이 원본을 가린다**. 둘 다 디스크를 모르는
 * 순수한 셈이라 번호를 다루는 이 모듈에 둔다 — 🔴 공유폴더를 읽는 쪽
 * (storage/quote-archive-case-numbers.ts)에 적으면 차례 규칙과 번호 모양이 두 벌이 된다.
 * ============================================================================
 */

/**
 * `DSS` + 구분자 한 글자 + 번호 + **공백**.
 *
 * 번호는 `연도 네 자리-일련번호` 에 가지(`-1`) 한 겹과 개정(`R1`) 한 겹이 **그 차례로** 붙는
 * 모양까지다 — 넷 다 받는다: `2026-095` · `2026-095-1` · `2026-004R1` · `2026-095-1R1`.
 * 대소문자를 접어 본다(`dss` · `r1` 로 적은 파일이 섞여 있어도 같은 번호로 센다).
 *
 * 🔴 **개정이 가지보다 앞에 오는 꼴**(`2026-095R1-1`)은 **받지 않는다** — 사내에 그런 이름이
 * 있는지 모른다(2026-10-06 실측 342 개에도, 2026-10-12 에 사용자가 찾은 폴더에도 없다).
 * 모르는 차례까지 미리 받아 두면 그 이름이 처음 들어오는 날 **사람이 뜻한 것과 다른 번호**를
 * 우리가 지어낸다 — 머리말의 「번호 뒤에 공백」과 같은 까닭이다. 지금은 `null` 이고, 실물이
 * 나타나면 그때 그 이름을 보고 늘린다.
 */
const ARCHIVE_FILE_NUMBER = /^DSS[ -](\d{4}-\d+(?:-\d+)?(?:R\d+)?)(?=\s)/i;

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

/**
 * 번호 여럿 가운데 **가장 큰 것**. 못 뽑은 자리(`null`)는 빼고 보고, 하나도 없으면 `null`.
 *
 * 🔴 차례는 바로 위 `compareArchiveFileNumbers` 그대로다 — **글자 그대로** 견준다. 쓰는 쪽
 * (storage/quote-archive-case-numbers.ts 가 「그 장비의 **최신 견적서 폴더**」를 고른다)이
 * 제 손으로 견주면 차례 규칙이 두 벌이 되고, 로케일 비교를 쓰지 않는 까닭(위 머리말)도 그
 * 자리에서 조용히 사라진다.
 *
 * 🔴 **`null` 을 받는 것이 이 함수의 일**이다. 폴더 이름에서 번호를 못 뽑는 폴더가 실제로
 * 섞여 있고(사람이 `DSS` 없이 적은 이름 · 번호 뒤 오타), 부르는 쪽은 「뽑힌 것들 가운데
 * 최신」과 「하나도 못 뽑았다」를 **갈라서** 다뤄야 한다.
 */
export function latestArchiveFileNumber(numbers: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  for (const number of numbers) {
    if (number === null) continue;
    if (latest === null || compareArchiveFileNumbers(number, latest) > 0) latest = number;
  }
  return latest;
}

/**
 * 번호 끝의 **개정 꼬리**(`R1`)를 떼어 줄기와 개정 번호로 가른다. 꼬리가 없으면 개정 `0` 이다.
 *
 * 🔴 **가지 번호(`-1`)는 꼬리가 아니다** — `2026-104-1` 의 줄기는 `2026-104-1` 이다. 가지는
 * 「같은 장의 새 판」이 아니라 **별도로 나간 견적서**라 원본과 나란히 살아 있는 번호다
 * (사용자 결정 2026-10-12).
 *
 * 🔴 **가지와 개정은 한 번호에 함께 온다** — `2026-095-1R1` 의 줄기는 `2026-095-1` 이고 개정은
 * `1` 이다(2026-10-12 운영에서 찾은 모양. 그전에는 「함께 오는 모양은 없다」고 적혀 있었다).
 * 꼬리를 떼면 **가지 원본만** 가려진다 — 가지끼리의 새 판이니 그것이 맞고, 본 번호
 * `2026-095` 는 줄기가 달라 그대로 남는다.
 */
function archiveFileNumberRevision(number: string): { stem: string; revision: number } {
  const match = /R(\d+)$/i.exec(number);
  if (match === null) return { stem: number, revision: 0 };
  return { stem: number.slice(0, match.index), revision: Number(match[1]) };
}

/**
 * **개정본이 원본을 가린다** — 줄기가 같은 번호끼리 묶어 개정 번호가 **가장 큰 것만** 남긴다
 * (사용자 요구 2026-10-12). 들어온 차례를 그대로 지킨다.
 *
 *   `2026-104` · `2026-104R1`   → `2026-104R1`      (원본은 개정 0 이다)
 *   `2026-104R1` · `2026-104R2` → `2026-104R2`
 *   `2026-104` · `2026-104-1`   → 🔴 **둘 다** (가지는 줄기가 다르다)
 *   `2026-104R1` · `2026-104-1` → 🔴 **둘 다**
 *   `2026-095-1` · `2026-095-1R1` → `2026-095-1R1`  (가지의 개정 — 줄기가 `2026-095-1` 이다)
 *
 * 🔴 `quoteNumbersFromArchiveFileNames` 안에 넣지 않았다. 그 함수는 「같은 장비의 지난
 * 견적서」 줄에서 **그 폴더가 담은 번호를 전부** 적는 데도 쓰인다
 * (storage/quote-archive-product-folders.ts) — 거기서 원본이 사라지면 폴더 안에 무엇이
 * 들어 있는지를 못 보게 된다. 가리는 일은 **부르는 쪽이 골라서** 한다.
 *
 * 🔴 `DSS ` 머리말을 **붙이기 전**에 지난다 — 붙인 뒤에 하면 글자 다루기가 두 겹이 된다.
 */
export function hideSupersededArchiveFileNumbers(numbers: readonly string[]): string[] {
  const latestByStem = new Map<string, number>();
  for (const number of numbers) {
    const { stem, revision } = archiveFileNumberRevision(number);
    const found = latestByStem.get(stem);
    if (found === undefined || revision > found) latestByStem.set(stem, revision);
  }
  return numbers.filter((number) => {
    const { stem, revision } = archiveFileNumberRevision(number);
    return latestByStem.get(stem) === revision;
  });
}
