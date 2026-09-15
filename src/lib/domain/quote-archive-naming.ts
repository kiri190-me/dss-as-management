/**
 * ============================================================================
 * 사내 공유폴더에 견적서를 저장할 때의 이름 규칙 (순수 — 파일시스템 없음)
 * ============================================================================
 * 공유폴더는 사람이 수년째 손으로 쓰는 폴더다. 앱이 그 모양을 그대로 따른다:
 *
 *   <루트>/
 *     21. 2026 내자견적서/                                  ← 연도 폴더
 *       DSS 2026-089 가나상사 MODEL-X1 L123 S456 수리 견적서/    ← 견적서 폴더(본 번호)
 *         DSS 2026-089 가나상사 MODEL-X1 L123 S456 수리 견적서.xls
 *         DSS 2026-089 가나상사 MODEL-X1 L123 S456 수리 견적서 - 有印.pdf
 *         DSS 2026-089-1 가나상사 MODEL-X1 L123 S456 수리 견적서(OH포함).xls
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
 * ============================================================================
 */

/** 견적서 종류. schema/quotes.ts 의 quote_kind 와 같은 두 값이다. */
export type QuoteArchiveKind = "DOMESTIC" | "OVERHAUL";

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
};

/** 이름을 만들 수 없는 입력(번호가 비었다 · 연도가 범위 밖 · 확장자가 이상하다). */
export class QuoteArchiveNamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteArchiveNamingError";
  }
}

/**
 * 폴더 이름 · 파일 이름의 **줄기**(번호 + 공급처 · 모델 · L/N · S/N + 「수리 견적서」)의
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
 * 줄이는 것은 공급처 · 모델 · L/N · S/N 조각뿐이다. 번호 · 「수리 견적서」 ·
 * `(OH포함)` · ` - 有印` · 번호 붙인 꼬리 · 확장자는 절대 자르지 않는다 — 그래서 번호가
 * 비정상적으로 길면 이 상한을 넘는 이름이 나올 수 있다(그때는 디스크가 거절하고 저장
 * 모듈이 `failed` 로 돌려준다).
 */
export const QUOTE_ARCHIVE_MAX_STEM_LENGTH = 72;

const REPAIR_QUOTE_LABEL = "수리 견적서";
const OVERHAUL_MARK = "(OH포함)";
const SIGNED_PDF_MARK = " - 有印";
const YEAR_FOLDER_LABEL = "내자견적서";

/** 연도 폴더 앞 번호 NN = 연도 − 2005 (2006 → 01, 2026 → 21). */
const YEAR_FOLDER_BASE = 2005;
const MIN_ARCHIVE_YEAR = YEAR_FOLDER_BASE + 1; // 01
const MAX_ARCHIVE_YEAR = YEAR_FOLDER_BASE + 99; // 99 — 앞 번호가 두 자리를 넘지 않는 데까지

/**
 * Windows 가 이름에 허용하지 않는 글자 `\ / : * ? " < > |` 와 제어문자(C0 · DEL · C1),
 * 그리고 보이지 않는 방향 제어문자(RLO 등 — 탐색기에서 확장자를 뒤집어 보이게 한다).
 */
const FORBIDDEN_IN_NAME = /[\\/:*?"<>|\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * 이름 한 조각을 다듬는다: NFC → 금지 글자 · 제어문자를 공백으로 → 연속 공백 하나로 →
 * 앞뒤 공백과 **끝의 점** 걷기. 점만 있던 조각(`.` · `..`)은 빈 문자열이 되어 빠진다 —
 * 경로를 거슬러 오르는 이름이 여기서 사라진다.
 */
export function sanitizeQuoteArchiveNamePiece(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(FORBIDDEN_IN_NAME, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
    .normalize("NFC");
}

/** 디스크에 이미 있는 이름을 **비교할 때만** 쓰는 모양: NFC + 연속 공백 하나 + 앞뒤 공백 걷기. */
export function normalizeQuoteArchiveNameForCompare(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

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
  const normalized = normalizeQuoteArchiveNameForCompare(name);
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
  const number = sanitizeQuoteArchiveNamePiece(quoteNumber);
  const match = /^(.*\d{4}-\d+)-\d+$/.exec(number);
  return match ? match[1] : number;
}

function requireNumber(quoteNumber: string): string {
  const number = sanitizeQuoteArchiveNamePiece(quoteNumber);
  if (number.length === 0) {
    throw new QuoteArchiveNamingError("발행번호가 비어 있어 이름을 만들 수 없습니다.");
  }
  return number;
}

/** 조각을 자른 자리에 남은 공백 · 점을 걷는다(끝의 점 규칙을 자른 뒤에도 지킨다). */
function trimPieceEnd(value: string): string {
  return value.replace(/[.\s]+$/, "").trim();
}

/**
 * 번호 + 조각들 + 「수리 견적서」. 상한을 넘으면 **가장 긴 조각부터 한 글자씩** 줄인다
 * (길이가 같으면 뒤의 조각 — S/N 쪽부터). 번호와 「수리 견적서」는 자르지 않는다.
 */
function buildStem(number: string, input: QuoteArchiveNamingInput): string {
  const pieces = [input.customerName, input.modelName, input.lotNumber, input.serialNumber]
    .map(sanitizeQuoteArchiveNamePiece)
    .filter((piece) => piece.length > 0)
    // 코드 포인트 단위로 자른다 — UTF-16 한 쌍을 반으로 가르지 않게.
    .map((piece) => Array.from(piece));

  const assemble = (parts: string[][]) =>
    [number, ...parts.map((part) => part.join("")).filter((part) => part.length > 0), REPAIR_QUOTE_LABEL].join(
      " "
    );

  while (assemble(pieces).length > QUOTE_ARCHIVE_MAX_STEM_LENGTH) {
    let longest = -1;
    let longestLength = 0;
    pieces.forEach((part, index) => {
      const length = part.join("").length;
      if (length > 0 && length >= longestLength) {
        longest = index;
        longestLength = length;
      }
    });
    if (longest < 0) break; // 줄일 조각이 없다 — 번호가 길다. 번호는 자르지 않는다.
    pieces[longest].pop();
  }

  const kept = pieces.map((part) => trimPieceEnd(part.join(""))).filter((part) => part.length > 0);
  return [number, ...kept, REPAIR_QUOTE_LABEL].join(" ").normalize("NFC");
}

/**
 * 새로 만드는 견적서 폴더 이름: `{본 번호} {공급처} {모델} {L/N} {S/N} 수리 견적서`
 * (빈 조각은 뺀다). 가지 번호 견적서도 본 번호 폴더에 들어가므로 번호는 본 번호다.
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
  const baseNumber = quoteArchiveBaseNumber(quoteNumber);
  if (baseNumber.length === 0) return false;
  const normalized = normalizeQuoteArchiveNameForCompare(existingName);
  return normalized === baseNumber || normalized.startsWith(`${baseNumber} `);
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
 * 견적서 파일 이름: `{번호} {공급처} {모델} {L/N} {S/N} 수리 견적서` + (OH 면 `(OH포함)`,
 * 앞에 공백 없음) + `.확장자`. 번호는 이 견적서 번호 그대로다.
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
 */
export function numberedQuoteArchiveName(name: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new QuoteArchiveNamingError("번호는 1 이상의 정수여야 합니다.");
  }
  if (n === 1) return name;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}
