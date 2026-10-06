/**
 * ============================================================================
 * 사내 공유폴더에 견적서를 저장할 때의 이름 규칙 (순수 — 파일시스템 없음)
 * ============================================================================
 * 공유폴더는 사람이 수년째 손으로 쓰는 폴더다. 앱이 그 모양을 그대로 따른다:
 *
 *   <루트>/
 *     21. 2026 내자견적서/                                  ← 연도 폴더
 *       DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량/      ← 견적서 폴더(본 번호)
 *         DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량.xls
 *         DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량 - 有印.pdf
 *         DSS 2026-089-1 가나상사 MODEL-X1 L123 S456 전원 불량(OH포함).xls
 *
 * ── 꼬리는 **신고증상**이다 (2026-10-06 실측으로 바로잡음) ────────────────
 * 사내 공유폴더의 2026 년 견적서 폴더 104 개를 실제로 읽어 보니 꼬리가 「수리 견적서」가
 * 아니라 그 건의 **신고증상**이었다(`REF Hunting 발생` · `탄내 발생` · `Water Shortage
 * 알람 발생`). 증상이 없는 건만 `수리 견적서` 로 끝난다 — 그래서 **증상이 비었을 때의
 * 꼬리로** 그 말을 그대로 남겨 둔다. 폴더 이름과 그 안의 파일 이름은 같은 줄기를
 * 쓰므로(사내 파일들이 그렇게 되어 있다) **파일 이름의 꼬리도 함께 바뀐다.**
 *
 * ── 「UUID 파일명」 규칙의 의도된 예외 ─────────────────────────────────────
 * 앱 저장소(UPLOADS_DIR)의 파일은 디스크 이름이 첨부 ID(UUID)다(attachment-path.ts).
 * 이 공유폴더는 **사람이 탐색기 · 엑셀로 여는 폴더**라 이름이 곧 목록이다 — 한글 ·
 * 공백이 든 사람이 읽는 이름을 쓴다. 대신 그 이름이 부르는 문제(금지 글자 · 경로
 * 벗어나기 · 같은 이름 덮어쓰기 · 너무 긴 경로)를 여기와 storage/quote-archive.ts 가 막는다.
 *
 * ── 비교할 때와 이을 때가 다르다 ─────────────────────────────────────────
 * 이미 있는 폴더 이름은 사람이 적은 것이라 공백이 두 칸이거나 한글이 풀어쓴(NFD)
 * 모양일 수 있다. **비교할 때만** NFC + 연속 공백 하나로 다듬고
 * (normalizeQuoteArchiveNameForCompare), 경로를 이을 때는 디스크의 실제 이름을 쓴다 —
 * 다듬은 이름으로 이으면 없는 폴더가 된다. 그 일은 저장 모듈이 한다.
 *
 * ── 원시 함수는 공용 모듈에 있다 (2026-10-05) ────────────────────────────
 * 금지 글자 다듬기 · 비교용 정규화 · 경계 일치 · 길이 줄이기는 연락서 폴더
 * (domain/contact-folder-naming.ts)도 **똑같이** 써야 한다. 금지 글자 표를 두 벌
 * 두면 반드시 갈라지므로 domain/share-folder-naming.ts 한 곳에 두고 가져다 쓴다.
 * 🔴 이 파일의 **공개 이름과 동작은 그대로다** — 아래 두 함수는 같은 것을 이름만
 * 바꿔 다시 내보내는 것이다.
 * ============================================================================
 */

import {
  buildShareFolderStem,
  matchesShareFolderPrefix,
  normalizeShareFolderNameForCompare,
  numberedShareFolderFileName,
  sanitizeShareFolderNamePiece,
  truncateShareFolderNamePiece,
} from "./share-folder-naming";

export {
  /** 이름 한 조각 다듬기(금지 글자 · 제어문자 → 공백, 공백 접기, 끝의 점 걷기, NFC). */
  sanitizeShareFolderNamePiece as sanitizeQuoteArchiveNamePiece,
  /** 디스크에 이미 있는 이름을 **비교할 때만** 쓰는 모양. */
  normalizeShareFolderNameForCompare as normalizeQuoteArchiveNameForCompare,
} from "./share-folder-naming";

/**
 * 견적서 종류. schema/quotes.ts 의 quote_kind 와 같은 값들이다.
 *
 * 🔴 **`CABLE` 은 이름에 아무 표시도 붙이지 않는다**(2026-09-16). 이 종류가 이름
 * 규칙에서 하는 일은 `(OH포함)` 을 붙일지 하나뿐이고(아래 fileStem), 케이블은 OH 가
 * 아니라 안 붙는다. 케이블 견적서의 **받기 통로가 아직 없어**(양식 채우기는 뒤 조각)
 * 이 이름으로 실제 파일이 만들어지는 길도 아직 없다 — 그때 「수리 견적서」라는 꼬리말이
 * 그 종류에도 맞는지 사람이 정하면 된다.
 */
export type QuoteArchiveKind = "DOMESTIC" | "OVERHAUL" | "CABLE";

/** 이름을 만드는 데 쓰는 견적서 칸. DB 의 빈 칸(null)을 그대로 넘겨도 된다. */
export type QuoteArchiveNamingInput = {
  /** 사람이 적는 발행번호. OH 견적서는 가지 번호가 붙는다(`DSS 2026-089-1`). */
  quoteNumber: string;
  kind: QuoteArchiveKind;
  /** 공급처. 견적서에서는 필수지만 다듬은 뒤 비면 그 조각만 뺀다. */
  customerName: string;
  modelName?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  /**
   * 신고증상(quotes.fault_description_text) — **폴더 · 파일 이름의 꼬리**다.
   *
   * 🔴 비었으면(null · 빈 글자 · 공백뿐 · 다듬고 나서 빈 조각) 꼬리가 「수리 견적서」다.
   * 사내 공유폴더에도 그렇게 끝나는 폴더가 실제로 있다(증상을 안 적은 건).
   *
   * 🔴 **자유 입력이라 제 상한에서 먼저 잘린다** — 아래 QUOTE_ARCHIVE_MAX_SYMPTOM_LENGTH.
   */
  faultDescription?: string | null;
};

/** 이름을 만들 수 없는 입력(번호가 비었다 · 연도가 범위 밖 · 확장자가 이상하다). */
export class QuoteArchiveNamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteArchiveNamingError";
  }
}

/**
 * 폴더 이름 · 파일 이름의 **줄기**(번호 + 공급처 · 모델 · L/N · S/N + 신고증상)의
 * 상한, 글자 수(UTF-16 단위 — Windows 경로 한도가 세는 단위).
 *
 * 근거 둘:
 *   1. **엑셀은 전체 경로 218 자를 넘는 파일을 열지 못한다.** 경로에는 줄기가 두 번
 *      들어간다(견적서 폴더 · 파일). 가장 긴 꼬리 `(OH포함) - 有印 (99).xlsx` 가 21 자,
 *      연도 폴더 `21. 2026 내자견적서` 가 14 자, 구분자 셋 — 루트 + 14 + 72 + 72 + 21 + 3
 *      = 루트 + 182 라, 루트(탐색기에서 보이는 공유폴더 경로)가 36 자까지면 최악의
 *      경우에도 엑셀이 연다. Windows 탐색기의 260 자 한도는 이보다 넉넉하다.
 *      (사람이 이미 만든 폴더 이름은 이 상한과 무관하게 디스크의 이름 그대로 쓴다.)
 *   2. **NAS(Linux) 파일 이름 한도는 UTF-8 255 바이트다.** 줄기가 모두 한글이어도
 *      72 × 3 = 216 바이트, 가장 긴 꼬리가 29 바이트 — 245 바이트로 들어간다.
 *
 * 줄이는 것은 공급처 · 모델 · L/N · S/N · 신고증상 조각뿐이다. 번호 · 「수리 견적서」 ·
 * `(OH포함)` · ` - 有印` · 번호 붙인 꼬리 · 확장자는 절대 자르지 않는다 — 그래서 번호가
 * 비정상적으로 길면 이 상한을 넘는 이름이 나올 수 있다(그때는 디스크가 거절하고 저장
 * 모듈이 `failed` 로 돌려준다).
 *
 * 🔴 **값은 2026-10-06 꼬리 바꾸기에서도 그대로다.** 꼬리가 「수리 견적서」(6 자)에서
 * 신고증상으로 바뀌었지만 위 두 근거(엑셀 218 자 · NAS 255 바이트)는 꼬리의 길이를 쓰지
 * 않는다 — 가장 긴 파일 꼬리 `(OH포함) - 有印 (99).xlsx` 와 연도 폴더만 쓴다.
 */
export const QUOTE_ARCHIVE_MAX_STEM_LENGTH = 72;

/**
 * **신고증상 조각 혼자** 쓸 수 있는 글자 수 상한.
 *
 * 🔴 신고증상은 자유 입력이라(화면의 여러 줄 입력칸) 줄바꿈 · 수백 자가 그대로 들어온다.
 * 전체 상한만 두면 「가장 긴 조각부터 줄인다」 규칙에 걸려 **증상이 이름을 혼자 다 차지하고**
 * 공급처 · 모델 · L/N · S/N 이 한 글자씩 남는다 — 사람이 탐색기 목록에서 못 알아본다.
 * 연락서 폴더가 같은 문제를 같은 방식으로 이미 풀었다(CONTACT_FOLDER_MAX_SYMPTOM_LENGTH).
 *
 * ── 왜 20 자인가 (🔴 위 72 자 안에서 뽑는다 — 상한을 새로 만들지 않는다) ──
 *   줄기 = 번호 + 공백 다섯 + 다섯 조각(공급처 · 모델 · L/N · S/N · 신고증상)
 *   사내 2026 년 폴더의 번호는 모두 `DSS 2026-001` 꼴 **12 자**다.
 *   → 다섯 조각이 나눠 쓸 자리 = 72 − 12 − 5 = **55 자**
 *   → 신고증상에 20 자를 주면 나머지 넷에 **35 자**가 남는다.
 *
 * 실제 사내 폴더에서 그 넷이 가장 길었던 건이 `INVENIA`(7) · `RFK300FH-AD1`(12) ·
 * `WU8159`(6) · `1701056`(7) = **32 자**라 세 자가 남는다. 증상 쪽은 `REF Hunting 발생`
 * (16) · `탄내 발생`(5) 이 그대로 들어가고, `Water Shortage 알람 발생`(22) 처럼 긴 것만
 * 끝이 잘린다 — 잘려도 **어느 건인지 가리는 넷은 멀쩡하다**, 그것이 이 상한의 목적이다.
 *
 * 🔴 **연락서의 20 과 숫자가 같지만 계산은 다르다.** 연락서는 머리가 인수번호 7 자라 넷에
 * 40 자가 남는다(견적서는 번호가 다섯 자 길다). 한쪽을 고칠 일이 있어도 다른 쪽을 따라
 * 고치지 말 것.
 */
export const QUOTE_ARCHIVE_MAX_SYMPTOM_LENGTH = 20;

/** 신고증상이 **빈 장**의 꼬리. 사내 공유폴더에도 이렇게 끝나는 폴더가 실제로 있다. */
const REPAIR_QUOTE_LABEL = "수리 견적서";
const OVERHAUL_MARK = "(OH포함)";
const SIGNED_PDF_MARK = " - 有印";
const YEAR_FOLDER_LABEL = "내자견적서";

/** 연도 폴더 앞 번호 NN = 연도 − 2005 (2006 → 01, 2026 → 21). */
const YEAR_FOLDER_BASE = 2005;
const MIN_ARCHIVE_YEAR = YEAR_FOLDER_BASE + 1; // 01
const MAX_ARCHIVE_YEAR = YEAR_FOLDER_BASE + 99; // 99 — 앞 번호가 두 자리를 넘지 않는 데까지

function isArchiveYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_ARCHIVE_YEAR && year <= MAX_ARCHIVE_YEAR;
}

/**
 * 발행일자(`"YYYY-MM-DD"` — Drizzle 이 date 칸을 읽는 모양)에서 연도 폴더의 연도를 꺼낸다.
 * 모양이 아니거나 달력에 없는 날이거나 연도가 범위(2006~2104) 밖이면 null.
 * Date 로 바꾸지 않고 글자에서 바로 읽는다 — 시간대 때문에 연말 · 연초가 넘어가지 않게.
 */
export function quoteArchiveYearFromDate(quoteDate: string): number | null {
  if (typeof quoteDate !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(quoteDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return isArchiveYear(year) ? year : null;
}

/** 새로 만드는 연도 폴더 이름: `NN. YYYY 내자견적서` (2026 → `21. 2026 내자견적서`). */
export function quoteArchiveYearFolderName(year: number): string {
  if (!isArchiveYear(year)) {
    throw new QuoteArchiveNamingError("연도 폴더를 정할 수 없는 연도입니다.");
  }
  const prefix = String(year - YEAR_FOLDER_BASE).padStart(2, "0");
  return `${prefix}. ${year} ${YEAR_FOLDER_LABEL}`;
}

/**
 * 이미 있는 폴더가 그 연도의 연도 폴더인가 — `YYYY 내자견적서` 로 끝나면 앞 번호가
 * 달라도 같은 연도로 인정한다(`20. 2026 내자견적서` 도 2026). 연도 바로 앞이 숫자면
 * 아니다(`12026 내자견적서` 는 2026 이 아니다).
 */
export function isQuoteArchiveYearFolder(name: string, year: number): boolean {
  if (!isArchiveYear(year)) return false;
  const normalized = normalizeShareFolderNameForCompare(name);
  const suffix = `${year} ${YEAR_FOLDER_LABEL}`;
  if (!normalized.endsWith(suffix)) return false;
  const before = normalized.slice(0, normalized.length - suffix.length);
  return !/\d$/.test(before);
}

/**
 * 견적서 폴더를 가르는 **본 번호**. 번호가 「연도 네 자리-일련번호-가지 번호」 모양일 때만
 * 끝의 가지 번호 한 겹을 뗀다 — 정규식 `^(.*\d{4}-\d+)-\d+$`, 곧 뗀 뒤의 끝이
 * 「네 자리 숫자-숫자」여야 한다.
 *
 *   DSS 2026-089     → DSS 2026-089      가지 번호가 없다(무조건 떼면 `DSS 2026` — 그해 모든 폴더와 겹친다)
 *   DSS 2026-089-1   → DSS 2026-089
 *   DSS 2026-089-12  → DSS 2026-089
 *   DSS2026-089-1    → DSS2026-089       사람이 공백을 빠뜨린 번호(개발 DB 에 실제로 있다)
 *   Q-7              → Q-7
 *   Q-2026-0001      → Q-2026-0001       「연도-일련번호」 모양 — 일련번호를 가지 번호로 떼면
 *   QT-2024-115      → QT-2024-115        `Q-2026` 이 되어 그해 견적서가 모두 한 폴더로 모인다
 *   DEMO-QT-2026-001 → DEMO-QT-2026-001
 *
 * 좁게 잡은 까닭은 **틀릴 때의 방향**이다. 모양이 다른 번호의 가지 번호는 자기 폴더를 따로
 * 갖게 될 뿐이지만(폴더가 하나 더 생긴다), 넓게 떼면 다른 견적서끼리 한 폴더에 섞인다.
 * 한 겹만 뗀다. 돌려주는 값은 다듬은(sanitize) 번호다.
 */
export function quoteArchiveBaseNumber(quoteNumber: string): string {
  const number = sanitizeShareFolderNamePiece(quoteNumber);
  const match = /^(.*\d{4}-\d+)-\d+$/.exec(number);
  return match ? match[1] : number;
}

function requireNumber(quoteNumber: string): string {
  const number = sanitizeShareFolderNamePiece(quoteNumber);
  if (number.length === 0) {
    throw new QuoteArchiveNamingError("발행번호가 비어 있어 이름을 만들 수 없습니다.");
  }
  return number;
}

/**
 * 번호 + 조각들 + 꼬리. 상한을 넘으면 **가장 긴 조각부터 한 글자씩** 줄인다(길이가 같으면
 * 뒤의 조각 — 신고증상 쪽부터). 번호는 자르지 않는다. 줄이는 규칙 자체는 공용 모듈
 * (buildShareFolderStem)에 있다 — 연락서 폴더도 같은 규칙이다.
 *
 * 🔴 **꼬리는 신고증상이다.** 증상이 있으면 그것이 **마지막 조각**으로 들어가고(전체 상한에
 * 닿기 전에 제 상한에서 먼저 잘린다), 비어 있을 때만 「수리 견적서」가 꼬리로 붙는다 —
 * 그 꼬리는 자르지 않는다.
 */
function buildStem(number: string, input: QuoteArchiveNamingInput): string {
  const symptom = truncateShareFolderNamePiece(input.faultDescription, QUOTE_ARCHIVE_MAX_SYMPTOM_LENGTH);
  return buildShareFolderStem({
    head: number,
    pieces: [input.customerName, input.modelName, input.lotNumber, input.serialNumber, symptom],
    tail: symptom.length === 0 ? REPAIR_QUOTE_LABEL : null,
    maxLength: QUOTE_ARCHIVE_MAX_STEM_LENGTH,
  });
}

/**
 * 새로 만드는 견적서 폴더 이름: `{본 번호} {공급처} {모델} {L/N} {S/N} {신고증상}`
 * (빈 조각은 뺀다 — 신고증상이 비면 그 자리에 「수리 견적서」가 온다). 가지 번호
 * 견적서도 본 번호 폴더에 들어가므로 번호는 본 번호다.
 */
export function quoteArchiveFolderName(input: QuoteArchiveNamingInput): string {
  const baseNumber = quoteArchiveBaseNumber(requireNumber(input.quoteNumber));
  return buildStem(baseNumber, input);
}

/**
 * 이미 있는 폴더가 이 견적서의 폴더인가 — 다듬은 이름이 **본 번호로 시작하고 바로 뒤가
 * 공백**이면 맞다(`DSS 2026-0891 …` 은 `DSS 2026-089` 가 아니다). 이름이 본 번호 그 자체인
 * 폴더도 맞는 것으로 본다 — 뒤에 아무것도 없으니 다른 번호일 수 없다.
 */
export function matchesQuoteArchiveFolder(existingName: string, quoteNumber: string): boolean {
  // 🔴 견적서 번호는 **대소문자를 접지 않는다** — 지금 동작 그대로다(연락서 쪽은 접는다).
  return matchesShareFolderPrefix(existingName, quoteArchiveBaseNumber(quoteNumber));
}

/** 확장자: 앞의 점을 떼고 소문자로. 영숫자 1~10 자가 아니면 던진다. */
function normalizeExtension(extension: string): string {
  const normalized = (typeof extension === "string" ? extension : "").trim().replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(normalized)) {
    throw new QuoteArchiveNamingError("파일 확장자가 올바르지 않습니다.");
  }
  return normalized;
}

/** 파일 이름에서 확장자를 뗀 부분 — 번호는 **이 견적서 번호 그대로**(가지 번호 포함) + OH 표시. */
function fileStem(input: QuoteArchiveNamingInput): string {
  const stem = buildStem(requireNumber(input.quoteNumber), input);
  return input.kind === "OVERHAUL" ? `${stem}${OVERHAUL_MARK}` : stem;
}

/**
 * 견적서 파일 이름: `{번호} {공급처} {모델} {L/N} {S/N} {신고증상}` + (OH 면 `(OH포함)`,
 * 앞에 공백 없음) + `.확장자`. 번호는 이 견적서 번호 그대로다.
 *
 * 🔴 **폴더 이름과 같은 줄기를 쓴다** — 그래서 꼬리를 신고증상으로 바꾸면 파일 이름도 함께
 * 바뀐다(사내 파일들이 폴더 이름과 같은 줄기를 쓰고 있다). 🔴 폴더를 **찾는** 일은 꼬리를
 * 보지 않으므로(matchesQuoteArchiveFolder) 전에 만든 파일 · 폴더는 그대로 찾힌다.
 */
export function quoteArchiveFileName(input: QuoteArchiveNamingInput, options: { extension: string }): string {
  return `${fileStem(input)}.${normalizeExtension(options.extension)}`;
}

/** 결재 PDF 이름: 견적서 파일 이름에서 확장자를 떼고 ` - 有印.pdf`. */
export function quoteArchiveSignedPdfFileName(input: QuoteArchiveNamingInput): string {
  return `${fileStem(input)}${SIGNED_PDF_MARK}.pdf`;
}

/**
 * 같은 이름이 있을 때의 후보: n = 1 이면 그대로, 2 이상이면 확장자 앞에 ` (n)`.
 *   `…수리 견적서.xlsx` → `…수리 견적서 (2).xlsx`
 *   `…수리 견적서 - 有印.pdf` → `…수리 견적서 - 有印 (2).pdf`
 *
 * 🔴 **규칙 자체는 share-folder-naming.ts 에 한 벌로 있다**(2026-10-05 연락서 조각 6 —
 * 연락서 폴더도 같은 번호 모양을 쓴다). 여기 남은 것은 **견적서의 입력 검사**뿐이고,
 * 거절하는 값 · 던지는 오류 종류는 한 글자도 바뀌지 않았다.
 */
export function numberedQuoteArchiveName(name: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new QuoteArchiveNamingError("번호는 1 이상의 정수여야 합니다.");
  }
  return numberedShareFolderFileName(name, n);
}
