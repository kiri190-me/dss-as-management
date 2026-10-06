import {
  runContactFolderFileOpen,
  type ContactFolderFileOpenEnvironment,
} from "@/components/repair-cases/files/contact-folder-file-open";
import { quoteNumberFromArchiveFileName } from "@/lib/domain/quote-archive-file-number";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";
import { compareShareFolderNames } from "@/lib/domain/share-folder-naming";
import {
  QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT,
  loadQuoteArchiveFolderEntries,
  type QuoteArchiveFolderEntriesFetch,
  type QuoteArchiveFolderEntryView,
} from "./QuoteArchiveFolderSection";
import { QUOTE_FOLDER_DISABLED_TEXT } from "./quote-folder-open";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * 견적서 목록의 [Excel 보기] — 그 줄의 엑셀을 공유폴더에서 찾아 PC 의 엑셀로 연다 (2026-10-06)
 * ============================================================================
 * 사용자 지시: 「견적서 목록에서 [미리보기 · PDF] 옆에 [Excel 보기]를 만들어서 폴더에 있는
 * 해당 견적서를 바로 열 수 있도록 해줘. … 만약 해당 폴더에 저장된 파일이 없다면 **저장된
 * 파일이 없습니다.** 라고 안내가 뜨면 되는거야.」
 *
 * 누르면 세 걸음이다:
 *  1) 그 견적서의 폴더 **안 목록**을 통로에서 받는다(GET …/archive-folder/entries).
 *     🔴 **누를 때 받는다** — 목록을 그릴 때 미리 읽지 않는다. 줄이 열한 개면 화면을 여는
 *     것만으로 공유폴더를 열한 번 때리게 된다(NAS 가 느린 날 목록 자체가 늦어진다).
 *  2) 받은 줄에서 **그 줄의 발행번호와 맞는 엑셀**을 고른다(아래 고르는 규칙).
 *  3) 고른 파일 하나를 **이미 있는 여는 장치**에 넘긴다 — 연락서 · 견적서 공유폴더 구역이
 *     쓰는 runContactFolderFileOpen 그대로다. 숨은 iframe · 도우미 감지 · 「열리지 않으면
 *     도우미를 다시 설치해 주세요」가 전부 그쪽에 있고, 🔴 **그 안내를 끄지 않는다.**
 *
 * ── 🔴 아무것도 만들지 않는다 ─────────────────────────────────────────────
 * 이 모듈에는 파일 · 폴더를 만들거나 쓰거나 지우는 코드가 없다. 부르는 통로도 **목록 하나**뿐이고
 * (읽기 전용), 파일 바이트가 우리 출처로 흐르는 길도 없다 — 여는 일은 그 PC 의 도우미가 한다.
 *
 * ── 🔴 고르는 규칙 — 번호가 맞는 것만, 그중 가장 최근 것 ──────────────────
 * 한 폴더 안에 엑셀이 여럿이고, 두 가지가 섞여 있다(2026-10-06 실측):
 *   ① 번호가 다른 것 — **각각 다른 견적서다.** 목록의 다른 줄이 그것을 연다.
 *        DSS 2026-078 … 수리 견적서.xlsx
 *        DSS 2026-078-1 … (OH포함).xlsx          ← 가지 번호. 다른 줄의 것
 *        DSS 2026-078-3 … Bias Fwd Drop 발생.xlsx ← 또 다른 줄의 것
 *   ② 번호가 같고 이름이 다른 것 — **같은 견적서인데 두 장**이다(신고증상을 고치면 이름이
 *      바뀌어 덮어쓰이지 않고 쌓인다). 그때는 **수정 시각이 가장 최근**인 것이 지금 것이다.
 *      🔴 쌓이는 것 자체는 이번 조각에서 고치지 않는다 — 알려진 상태다.
 * 그래서 ①에서 **번호가 어긋나는 파일은 절대 열지 않는다** — 열면 남의 견적서를 여는 것이다.
 *
 * ── 🔴 번호를 견주는 방식 ─────────────────────────────────────────────────
 * 번호를 뽑는 함수는 **이미 있는 것 하나**를 양쪽에 쓴다
 * (domain/quote-archive-file-number.ts 의 quoteNumberFromArchiveFileName):
 *   · 파일 쪽 — `DSS 2026-078-3 가나상사 ….xlsx` → `2026-078-3`
 *   · 줄 쪽   — 발행번호 `DSS 2026-078-3` → `2026-078-3`
 * 그 함수는 **번호 뒤에 공백**을 요구한다(실측의 오타 `DSS 2026-046- ICD …` 에서 사람이 적지
 * 않은 번호를 지어내지 않으려는 규칙이다). 발행번호는 번호에서 끝나므로 뒤에 꼬리 한 조각을
 * 붙여 **같은 규칙에 태운다**(아래 NUMBER_PROBE_TAIL — 붙이는 글자는 번호 뽑기에 쓰이지 않는다).
 * 그래서 공백 · 대소문자 · `DSS` 뒤 하이픈을 **양쪽이 똑같이** 접는다:
 *   · `DSS 2026-099` 와 `DSS-2026-099` 가 같은 번호다(함수의 `DSS[ -]`).
 *   · 두 칸 띄어쓰기 · NFD 한글 · 앞뒤 공백은 비교 전에 다듬어진다.
 *   · `2026-004r1` 과 `2026-004R1` 이 한 번호다(돌려주는 값이 대문자로 맞춰진다).
 * 🔴 **번호를 못 뽑으면 아무것도 고르지 않는다.** 줄 쪽이 못 뽑혔는데 「못 뽑은 파일」과
 * 맞다고 보면 번호 없는 파일이 아무 줄에서나 열린다 — 그 길을 막는다.
 *
 * ── 🔴 엑셀만 연다 ───────────────────────────────────────────────────────
 * 같은 폴더에 결재 PDF(`… - 有印.pdf`)가 함께 있고, 번호도 같고, 나중에 저장돼 더 최근일 수
 * 있다. [Excel 보기]가 PDF 를 열면 안 되므로 **엑셀 확장자만** 본다. 그 위에 여는 쪽의
 * **허용 확장자 목록**(domain/quote-folder-file-link.ts)을 그대로 거친다 — 목록 밖 이름 ·
 * 끝에 점이나 공백이 붙은 이름은 여기서 이미 빠진다.
 *
 * ── 🔴 알림에 경로를 적지 않는다 ─────────────────────────────────────────
 * 이 모듈이 내는 줄에는 폴더 경로(`연도 폴더/견적서 폴더`)도 전체 공유폴더 주소도 들어가지
 * 않는다. 서버가 주는 실패 사유도 경로 없는 짧은 문장이다(storage/quote-archive.ts 의 규율).
 * 여는 장치가 내는 「파일을 엽니다: …」의 이름은 **그 폴더 안에서의 이름 하나**다 — 경로가 아니다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────
 * fetch 와 여는 장치를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 · DOM 없이 값으로 시험한다
 * (quote-archive-excel-open.test.ts).
 * ============================================================================
 */

// ── 문장 ─────────────────────────────────────────────────────────────────

/**
 * 🔴 **사용자가 직접 말한 문장이다**(2026-10-06) — 마침표까지 그대로 쓴다.
 * 폴더는 찾았는데 그 번호의 엑셀이 없을 때.
 */
export const QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT = "저장된 파일이 없습니다.";

/**
 * 폴더는 찾았는데 통로가 폴더 자리를 주지 않았다 — 주소를 지어내지 않고 사실대로 짧게.
 * 정상 경로로는 오지 않는다(통로가 `found` 에 늘 상대 경로를 싣는다).
 */
export const QUOTE_ARCHIVE_EXCEL_NO_FOLDER_PLACE_TEXT = "폴더 자리를 알 수 없습니다";

/**
 * 🔴 통로는 한 폴더에서 **맨 위 100 줄까지만** 낸다(storage/quote-archive-entries.ts). 실측상
 * 견적서 폴더 하나에 그만큼 쌓이는 일은 없지만, 잘린 목록에서 못 찾았으면 「없다」고 단언할 수
 * 없다 — 「저장된 파일이 없습니다.」 아래에 이 줄을 곁들여 사실을 그대로 말한다.
 */
export const QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT =
  "폴더에 파일이 너무 많아 앞의 일부만 읽었습니다 — 공유폴더에서 직접 찾아 주세요";

/** 단추에 마우스를 올리면 보이는 설명 — 공유폴더 줄의 [열기]와 같은 결로 적는다. */
export const QUOTE_ARCHIVE_EXCEL_OPEN_BUTTON_TITLE =
  "이 견적서의 엑셀을 공유폴더에서 찾아 이 PC 의 엑셀로 엽니다 — 열리지 않으면 폴더 열기 도우미를 다시 설치해 주세요";

// ── 고르는 규칙 (순수) ───────────────────────────────────────────────────

/**
 * 🔴 **엑셀로 보는 확장자.** 여는 쪽 허용 목록(QUOTE_FOLDER_OPENABLE_EXTENSIONS)의 **부분집합**
 * 이어야 한다 — 시험이 그것을 못 박는다. 소문자로 적고 접어서 본다.
 */
export const QUOTE_ARCHIVE_EXCEL_EXTENSIONS: readonly string[] = ["xlsx", "xls", "xlsm"];

/**
 * 뽑는 함수의 「번호 뒤에 공백」 규칙에 맞추려고 발행번호 뒤에 붙이는 꼬리.
 * 사내 파일 이름의 기본 꼬리와 같은 글자라 붙여 놓으면 실제 파일 이름처럼 읽힌다.
 */
const NUMBER_PROBE_TAIL = " 수리 견적서";

/**
 * 그 줄의 발행번호에서 **견줄 번호**를 뽑는다. 못 뽑으면 null — 그때는 아무 파일도 고르지 않는다.
 * 🔴 파일 쪽과 **같은 함수**를 쓴다(머리말 「번호를 견주는 방식」).
 */
export function quoteArchiveExcelNumberKey(quoteNumber: unknown): string | null {
  if (typeof quoteNumber !== "string") return null;
  return quoteNumberFromArchiveFileName(`${quoteNumber}${NUMBER_PROBE_TAIL}`);
}

/** 이름의 확장자를 접어서 돌려준다. 점이 없거나 맨 앞 · 맨 뒤면 null. */
function foldedExtensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 1 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 이 이름을 [Excel 보기]로 열 수 있는가 — 🔴 **여는 쪽 허용 목록을 먼저 거치고**, 그 안에서
 * 엑셀 확장자만 받는다. 허용 목록 검사가 끝의 점 · 공백, 금지 글자, 마디 늘리기까지 함께 막는다.
 */
export function isQuoteArchiveExcelFileName(name: unknown): boolean {
  if (!isOpenableQuoteFolderFileName(name)) return false;
  const extension = foldedExtensionOf(name as string);
  return extension !== null && QUOTE_ARCHIVE_EXCEL_EXTENSIONS.includes(extension);
}

/** 수정 시각(ISO) → 견줄 수 있는 수. 칸이 없거나 읽히지 않으면 **가장 오래된 것**으로 본다. */
function modifiedAtValue(entry: QuoteArchiveFolderEntryView): number {
  if (typeof entry.modifiedAt !== "string") return Number.NEGATIVE_INFINITY;
  const at = Date.parse(entry.modifiedAt);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/**
 * 폴더 안의 줄들에서 **이 견적서의 엑셀 한 장**을 고른다. 없으면 null. 던지지 않는다.
 *
 *  · 폴더 줄은 뺀다 · 엑셀이 아닌 줄은 뺀다 · 번호가 어긋나는 줄은 뺀다(🔴 남의 견적서다)
 *  · 남은 것 가운데 **수정 시각이 가장 최근**인 것. 시각이 같거나 둘 다 없으면 **이름순 첫째**다
 *    (맞는 폴더가 여럿일 때 이름순 첫째를 고르는 저장 쪽 규칙과 같은 결 — 늘 같은 하나를 고른다).
 */
export function pickQuoteArchiveExcelEntry(
  entries: readonly QuoteArchiveFolderEntryView[],
  quoteNumber: unknown
): QuoteArchiveFolderEntryView | null {
  const wanted = quoteArchiveExcelNumberKey(quoteNumber);
  if (wanted === null) return null;

  let best: QuoteArchiveFolderEntryView | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || entry.isDirectory) continue;
    if (!isQuoteArchiveExcelFileName(entry.name)) continue;
    if (quoteNumberFromArchiveFileName(entry.name) !== wanted) continue;

    const at = modifiedAtValue(entry);
    if (best === null || at > bestAt || (at === bestAt && compareShareFolderNames(entry.name, best.name) < 0)) {
      best = entry;
      bestAt = at;
    }
  }
  return best;
}

// ── 누른 뒤의 흐름 ───────────────────────────────────────────────────────

export type QuoteArchiveExcelOpenOutcomeKind =
  /** 공유폴더 저장 설정이 꺼져 있다 — 누르기 전에는 알 수 없다. */
  | "DISABLED"
  /** 아직 이 견적서의 폴더가 없다. */
  | "FOLDER_NOT_FOUND"
  /** 🔴 맞는 폴더가 여럿이라 통로가 목록을 내지 않았다 — 어느 폴더인지 모른다. */
  | "FOLDER_MULTIPLE"
  /** 공유폴더를 읽지 못했다(통로 실패 · 네트워크 · 권한). */
  | "FOLDER_FAILED"
  /** 🔴 폴더는 찾았는데 **그 번호의 엑셀이 없다** — 사용자가 직접 말한 문장을 낸다. */
  | "FILE_NOT_FOUND"
  /** 여는 장치에 넘겼다 — 그 결과 줄이 그대로 들어 있다(열렸든 아니든). */
  | "OPENED";

export type QuoteArchiveExcelOpenOutcome = {
  kind: QuoteArchiveExcelOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /** [설치 명령 복사]를 곁에 낼 것인가 — 여는 장치가 정한 값을 그대로 따른다. */
  offerHelperInstall: boolean;
};

/** 바꿔 끼울 수 있는 「파일 하나 열기」 — 기본은 공유폴더 구역 · 연락서가 쓰는 그 흐름이다. */
export type QuoteArchiveExcelFileOpen = (input: {
  folderName: string;
  fileName: string;
  env?: Partial<ContactFolderFileOpenEnvironment>;
}) => Promise<{ lines: QuoteIssueNoticeLine[]; offerHelperInstall: boolean }>;

function notice(kind: QuoteArchiveExcelOpenOutcomeKind, lines: QuoteIssueNoticeLine[]): QuoteArchiveExcelOpenOutcome {
  return { kind, lines, offerHelperInstall: false };
}

/**
 * [Excel 보기] 한 번. **던지지 않는다** — 무슨 일이 나도 결과 줄 하나로 끝난다.
 * 🔴 두 번 눌러 두 번 열리지 않게 막는 일은 **부르는 쪽(단추)**이 한다 — 여기는 상태가 없다.
 */
export async function runQuoteArchiveExcelOpen({
  quoteId,
  quoteNumber,
  env = {},
}: {
  quoteId: string;
  quoteNumber: string;
  env?: {
    fetchImpl?: QuoteArchiveFolderEntriesFetch;
    openFile?: QuoteArchiveExcelFileOpen;
  };
}): Promise<QuoteArchiveExcelOpenOutcome> {
  const state = await loadQuoteArchiveFolderEntries(quoteId, env.fetchImpl);

  switch (state.kind) {
    case "disabled":
      return notice("DISABLED", [{ text: QUOTE_FOLDER_DISABLED_TEXT, tone: "muted" }]);
    case "not-found":
      return notice("FOLDER_NOT_FOUND", [{ text: QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT, tone: "warning" }]);
    case "multiple":
      return notice("FOLDER_MULTIPLE", [{ text: QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT, tone: "warning" }]);
    case "failed":
      return notice("FOLDER_FAILED", [
        { text: QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT, tone: "warning" },
        { text: state.reason, tone: "muted" },
      ]);
    case "loading":
      // 불러오는 흐름은 이 상태를 돌려주지 않는다 — 상태가 하나 늘면 컴파일러가 짚게 둔다.
      return notice("FOLDER_FAILED", [{ text: QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT, tone: "warning" }]);
    case "found":
      break;
  }

  if (state.relativePath === "") {
    return notice("FOLDER_FAILED", [
      { text: QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT, tone: "warning" },
      { text: QUOTE_ARCHIVE_EXCEL_NO_FOLDER_PLACE_TEXT, tone: "muted" },
    ]);
  }

  const entry = pickQuoteArchiveExcelEntry(state.entries, quoteNumber);
  if (entry === null) {
    const truncated: QuoteIssueNoticeLine[] = state.truncated
      ? [{ text: QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT, tone: "muted" }]
      : [];
    return notice("FILE_NOT_FOUND", [{ text: QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT, tone: "warning" }, ...truncated]);
  }

  const openFile = env.openFile ?? runContactFolderFileOpen;
  const opened = await openFile({ folderName: state.relativePath, fileName: entry.name });
  return { kind: "OPENED", lines: opened.lines, offerHelperInstall: opened.offerHelperInstall };
}
