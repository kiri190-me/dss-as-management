import {
  QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT,
  QUOTE_ARCHIVE_EXCEL_NO_FOLDER_PLACE_TEXT,
  QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT,
  isQuoteArchiveExcelFileName,
} from "@/components/quotes/quote-archive-excel-open";
import { QUOTE_FOLDER_DISABLED_TEXT } from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";
import {
  CONTACT_FOLDER_SECTION_FAILED_TEXT,
  CONTACT_FOLDER_SECTION_MULTIPLE_TEXT,
  CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT,
  loadContactFolderEntries,
  type ContactFolderEntriesFetch,
  type ContactFolderEntryView,
} from "@/components/repair-cases/files/ContactFolderSection";
import {
  runContactFolderFileOpen,
  type ContactFolderFileOpenEnvironment,
} from "@/components/repair-cases/files/contact-folder-file-open";
import {
  CONTACT_FOLDER_MAX_NUMBERED_COPIES,
  numberedContactFolderFileName,
} from "@/lib/domain/contact-folder-naming";
import { serviceReportContactFolderRelativePath } from "@/lib/domain/service-report-contact-folder";
import { compareShareFolderNames, normalizeShareFolderNameForCompare } from "@/lib/domain/share-folder-naming";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";
import {
  findServiceReportCategoryFolderName,
  serviceReportFolderCategoryName,
} from "./ServiceReportFolderSection";

/**
 * ============================================================================
 * 보고서 목록의 [Excel 보기] — 그 줄의 엑셀을 연락서 폴더에서 찾아 PC 의 Excel 로 연다
 * (2026-10-12)
 * ============================================================================
 * 사용자 요구 2026-10-12: 보고서 탭 「저장된 보고서」 줄의 [엑셀 받기]를 **[Excel 보기]**
 * 로 바꾼다. 🔴 **글자만 바꾸는 일이 아니다** — 받기는 내려받기 통로(`…/service-report/
 * xlsx?id=`)로 가는 `<a href>` 였고, 보기는 **사내 공유폴더에 이미 들어가 있는 그 엑셀**을
 * 그 PC 의 Excel 로 여는 것이다. 들어가 있는 자리는 바로 앞 두 조각이 깔았다:
 *
 *   D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청/
 *     ├─ 검사 보고서/   └─ 검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx
 *     └─ 수리 보고서/   └─ 수리보고서_….xlsx
 *
 * 🔴 **본보기는 견적서의 [Excel 보기]**(components/quotes/quote-archive-excel-open.ts)다.
 * 걸음 셋도, 「못 고르면 열지 않는다」도 그쪽과 같다. 🔴 **견적서 쪽은 한 글자도 바뀌지
 * 않았다** — 공통으로 쓸 것(문장 셋 · 엑셀 확장자 거르기)은 그 모듈에서 **가져다 쓴다**
 * (앞 조각 service-report-save-pdf-convert.ts 와 같은 방식).
 *
 * ── 누르면 두 번 읽고 한 번 연다 ────────────────────────────────────────────
 *  1) 연락서 폴더의 **맨 위 칸**을 읽어 그 종류의 **분류 폴더가 실제로 서 있는지** 본다.
 *     🔴 없는 자리를 바로 읽으러 가면 서버가 「하위 폴더를 찾을 수 없습니다」로 끝나,
 *     **아직 한 번도 저장 안 한 보고서**가 빨간 글씨가 된다(앞 조각 공유폴더 구역의 판단).
 *  2) 그 분류 폴더 **안**을 읽어 **그 보고서의 엑셀 한 장**을 고른다(아래 고르는 규칙).
 *  3) 고른 파일 하나를 **이미 있는 여는 장치**에 넘긴다 — 연락서 · 견적서 공유폴더 구역의
 *     줄 [열기]가 쓰는 runContactFolderFileOpen 그대로다. 숨은 iframe · 도우미 감지 ·
 *     「열리지 않으면 도우미를 다시 설치해 주세요」가 전부 그쪽에 있고, 🔴 **끄지 않는다.**
 *
 * 🔴 **누를 때 읽는다.** 목록을 그릴 때 미리 읽지 않는다 — 줄이 다섯이면 화면을 여는 것만
 * 으로 공유폴더를 열 번 때리게 된다(견적서 [Excel 보기]와 같은 판단).
 *
 * ── 🔴 어느 이름을 찾는가 — 이름 규칙을 **새로 적지 않는다** ────────────────
 * 디스크에 앉은 이름은 쓰는 길이 정한 그것이다:
 *
 *   numberedContactFolderFileName( contactFolderCopyFileName( 내려받기 이름 ), n )
 *
 * 그래서 이 모듈은 **이름을 짓지 않는다** — 부르는 쪽(보고서 탭 페이지)이 그 두 함수로
 * 지어 넘기고, 여기서는 받은 이름과 **그 번호 붙은 사본들**만 후보로 본다. 번호 붙이는
 * 규칙도 `numberedContactFolderFileName` 그대로다(상한 999 도 그 모듈의 값이다).
 *
 * ── ⚠️ `… (2).xlsx` 가 있을 수 있다 ─────────────────────────────────────────
 * 연락서 폴더 모듈은 **덮어쓰지 않고 번호로 비켜 간다**(견적서는 덮어쓴다). 보고서를 고쳐
 * 다시 저장하면 `검사보고서_… (2).xlsx` 가 생긴다. 여럿이면 **수정 시각이 가장 최근**인
 * 것이 지금 것이고, 시각이 같거나 둘 다 없으면 **이름순 첫째**다 — 견적서와 같은 잣대다.
 *
 * ── 🔴 검사와 수리를 섞지 않는다 ────────────────────────────────────────────
 * 종류가 분류 폴더를 정한다(domain/service-report-contact-folder.ts 의 표). 🔴 「검사
 * 보고서」를 글자로 적지 않는다 — 앞 조각이 내보인 `serviceReportFolderCategoryName` 이
 * 정한다. 한 건에 검사 한 장 + 수리 한 장이 보통이라, 섞이면 **다른 보고서를 연다.**
 *
 * ── 🔴 못 찾으면 열지 않는다 ────────────────────────────────────────────────
 * 아직 저장 안 한 보고서 · 공유폴더가 꺼진 경우 · 폴더를 못 읽는 경우 — 각각 **사람이
 * 읽을 수 있는 한 줄**로 끝난다. 조용히 아무 일도 안 하지 않고, 아무거나 열지도 않는다.
 *
 * ── 🔴 읽고 여는 것뿐이다 ───────────────────────────────────────────────────
 * 만들기 · 쓰기 · 지우기가 한 글자도 없다(`mkdir`·`writeFile`·`unlink`·`rm`·`rename` ·
 * `node:fs`). 부르는 통로는 **목록 하나**(GET …/contact-folder/entries)뿐이고, 파일
 * 바이트가 우리 출처로 흐르는 길이 없다 — 여는 일은 그 PC 의 도우미가 한다.
 *
 * ── 🔴 알림에 경로를 적지 않는다 ────────────────────────────────────────────
 * 이 모듈이 내는 줄에는 공유폴더 주소도 연락서 폴더 이름도 들어가지 않는다. 여는 장치가
 * 내는 「파일을 엽니다: …」의 이름은 **그 폴더 안에서의 이름 하나**다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 와 여는 장치를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 · DOM 없이 값으로 시험한다
 * (service-report-excel-open.test.ts).
 * ============================================================================
 */

// ── 문장 ─────────────────────────────────────────────────────────────────

/**
 * 🔴 네 문장 모두 **이미 있는 것**이다 — 같은 폴더를 두 창이 다르게 부르지 않게.
 *  · 꺼짐 · 못 찾음(사용자가 직접 말한 문장) · 폴더 자리 모름 · 잘림 → 견적서 [Excel 보기]
 *  · 폴더 없음 · 여럿 · 읽기 실패 → 연락서 공유폴더 구역(보고서 탭의 구역도 그것을 쓴다)
 * 🔴 **여기서 새로 적지 않는다.**
 */
export const SERVICE_REPORT_EXCEL_NOT_SAVED_TEXT = QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT;

/** 단추에 마우스를 올리면 보이는 설명 — 공유폴더 줄의 [열기]와 같은 결로 적는다. */
export const SERVICE_REPORT_EXCEL_OPEN_BUTTON_TITLE =
  "이 보고서의 엑셀을 공유폴더에서 찾아 이 PC 의 엑셀로 엽니다 — 열리지 않으면 폴더 열기 도우미를 다시 설치해 주세요";

// ── 고르는 규칙 (순수) ───────────────────────────────────────────────────

/**
 * 수정 시각(ISO) → 견줄 수 있는 수. 칸이 없거나 읽히지 않으면 **가장 오래된 것**으로 본다.
 * 🔴 견적서 [Excel 보기]의 같은 이름 함수와 **같은 잣대**다(그쪽은 내보이지 않는 안쪽
 * 함수라 가져다 쓸 수 없었다 — 🔴 그 파일을 고치지 않기로 한 자리다).
 */
function modifiedAtValue(entry: ContactFolderEntryView): number {
  if (typeof entry.modifiedAt !== "string") return Number.NEGATIVE_INFINITY;
  const at = Date.parse(entry.modifiedAt);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/**
 * 그 보고서의 엑셀이 가질 수 있는 **모든 이름**(번호 붙은 사본까지)을 견줄 모양으로 모은다.
 * 🔴 번호 붙이는 규칙도 상한도 **연락서 폴더 모듈의 것 그대로**다 — 여기서 ` (2)` 를
 * 글자로 적지 않는다. 디스크에 NFD 로 앉은 한글을 접어 보려고 비교용으로 다듬는다.
 */
function numberedNameKeys(fileName: string): Set<string> {
  const keys = new Set<string>();
  for (let n = 1; n <= CONTACT_FOLDER_MAX_NUMBERED_COPIES; n += 1) {
    keys.add(normalizeShareFolderNameForCompare(numberedContactFolderFileName(fileName, n)));
  }
  return keys;
}

/**
 * 분류 폴더 안의 줄들에서 **이 보고서의 엑셀 한 장**을 고른다. 없으면 null. 던지지 않는다.
 *
 *  · 폴더 줄은 뺀다 · 엑셀이 아닌 줄은 뺀다(같은 자리에 **PDF 가 함께 있다** — 앞 조각이
 *    엑셀을 넣고 그 자리에서 PDF 로 바꾼다. [Excel 보기]가 PDF 를 열면 안 된다)
 *  · 🔴 **이름이 그 보고서의 것이 아니면 뺀다** — 한 분류 폴더에 검사 보고서가 여러 장
 *    (장비가 다른 건) 들어 있을 수 있다. 남의 장을 열면 안 된다.
 *  · 남은 것 가운데 **수정 시각이 가장 최근**인 것. 시각이 같거나 둘 다 없으면 **이름순
 *    첫째**다(늘 같은 하나를 고르기 위한 것 — 견적서와 같은 결).
 */
export function pickServiceReportExcelEntry(
  entries: readonly ContactFolderEntryView[],
  fileName: unknown
): ContactFolderEntryView | null {
  // 🔴 찾는 이름 자체가 엑셀이 아니면 아무것도 고르지 않는다 — 지어내지 않는다.
  if (typeof fileName !== "string" || !isQuoteArchiveExcelFileName(fileName)) return null;
  const wanted = numberedNameKeys(fileName);

  let best: ContactFolderEntryView | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || entry.isDirectory) continue;
    if (!isQuoteArchiveExcelFileName(entry.name)) continue;
    if (!wanted.has(normalizeShareFolderNameForCompare(entry.name))) continue;

    const at = modifiedAtValue(entry);
    if (best === null || at > bestAt || (at === bestAt && compareShareFolderNames(entry.name, best.name) < 0)) {
      best = entry;
      bestAt = at;
    }
  }
  return best;
}

// ── 누른 뒤의 흐름 ───────────────────────────────────────────────────────

export type ServiceReportExcelOpenOutcomeKind =
  /** 공유폴더 저장 설정이 꺼져 있다 — 누르기 전에는 알 수 없다. */
  | "DISABLED"
  /** 아직 이 건의 연락서 폴더가 없다. */
  | "FOLDER_NOT_FOUND"
  /** 🔴 맞는 폴더가 여럿이라 통로가 목록을 내지 않았다 — 어느 폴더인지 모른다. */
  | "FOLDER_MULTIPLE"
  /** 공유폴더를 읽지 못했다(통로 실패 · 네트워크 · 권한). */
  | "FOLDER_FAILED"
  /**
   * 🔴 **그 보고서의 엑셀이 없다** — 분류 폴더가 아직 안 섰거나(한 번도 저장 안 한 장),
   * 폴더는 섰는데 그 이름의 엑셀이 없다. 둘을 가르지 않는다: 사람이 할 일이 같다.
   */
  | "FILE_NOT_FOUND"
  /** 여는 장치에 넘겼다 — 그 결과 줄이 그대로 들어 있다(열렸든 아니든). */
  | "OPENED";

export type ServiceReportExcelOpenOutcome = {
  kind: ServiceReportExcelOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /** [설치 명령 복사]를 곁에 낼 것인가 — 여는 장치가 정한 값을 그대로 따른다. */
  offerHelperInstall: boolean;
};

/** 바꿔 끼울 수 있는 「파일 하나 열기」 — 기본은 공유폴더 구역 · 연락서가 쓰는 그 흐름이다. */
export type ServiceReportExcelFileOpen = (input: {
  folderName: string;
  fileName: string;
  env?: Partial<ContactFolderFileOpenEnvironment>;
}) => Promise<{ lines: QuoteIssueNoticeLine[]; offerHelperInstall: boolean }>;

function notice(
  kind: ServiceReportExcelOpenOutcomeKind,
  lines: QuoteIssueNoticeLine[]
): ServiceReportExcelOpenOutcome {
  return { kind, lines, offerHelperInstall: false };
}

/** 「그 보고서의 엑셀이 없다」 — 잘린 목록이었으면 그 사실을 한 줄 곁들인다. */
function notSaved(truncated: boolean): ServiceReportExcelOpenOutcome {
  const tail: QuoteIssueNoticeLine[] = truncated
    ? [{ text: QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT, tone: "muted" }]
    : [];
  return notice("FILE_NOT_FOUND", [{ text: SERVICE_REPORT_EXCEL_NOT_SAVED_TEXT, tone: "warning" }, ...tail]);
}

/** 공유폴더를 못 읽었다 — 서버가 준 짧은 사유를 그대로 곁들인다(경로가 없는 문장이다). */
function folderFailed(reason: string): ServiceReportExcelOpenOutcome {
  const tail: QuoteIssueNoticeLine[] = reason === "" ? [] : [{ text: reason, tone: "muted" }];
  return notice("FOLDER_FAILED", [{ text: CONTACT_FOLDER_SECTION_FAILED_TEXT, tone: "warning" }, ...tail]);
}

/**
 * 통로의 답 가운데 **읽을 목록이 없는 것들**을 결과 줄로 옮긴다. `found` 면 null —
 * 그때는 부르는 쪽이 이어서 간다.
 */
function withoutEntries(
  state: Awaited<ReturnType<typeof loadContactFolderEntries>>
): ServiceReportExcelOpenOutcome | null {
  switch (state.kind) {
    case "disabled":
      return notice("DISABLED", [{ text: QUOTE_FOLDER_DISABLED_TEXT, tone: "muted" }]);
    case "not-found":
      return notice("FOLDER_NOT_FOUND", [{ text: CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT, tone: "warning" }]);
    case "multiple":
      return notice("FOLDER_MULTIPLE", [{ text: CONTACT_FOLDER_SECTION_MULTIPLE_TEXT, tone: "warning" }]);
    case "failed":
      return folderFailed(state.reason);
    case "loading":
      // 불러오는 흐름은 이 상태를 돌려주지 않는다 — 상태가 하나 늘면 컴파일러가 짚게 둔다.
      return folderFailed("");
    case "found":
      return null;
  }
}

/**
 * [Excel 보기] 한 번. **던지지 않는다** — 무슨 일이 나도 결과 줄 하나로 끝난다.
 * 🔴 두 번 눌러 두 번 열리지 않게 막는 일은 **부르는 쪽(단추)**이 한다 — 여기는 상태가 없다.
 */
export async function runServiceReportExcelOpen({
  repairCaseId,
  reportKind,
  fileName,
  env = {},
}: {
  repairCaseId: string;
  /** 🔴 분류 폴더를 정하는 값 — 검사와 수리를 섞지 않는 유일한 재료다. */
  reportKind: ServiceReportKind;
  /**
   * 그 보고서의 엑셀이 연락서 폴더에 들어간 이름. 🔴 **부르는 쪽이 이름 규칙 두 함수로
   * 지어 넘긴다** — 지을 수 없었으면 빈 글자가 오고, 그때는 아무것도 열지 않는다.
   */
  fileName: string;
  env?: {
    fetchImpl?: ContactFolderEntriesFetch;
    openFile?: ServiceReportExcelFileOpen;
  };
}): Promise<ServiceReportExcelOpenOutcome> {
  // ── 1) 맨 위 칸 — 그 종류의 분류 폴더가 실제로 서 있는가 ────────────────
  const top = await loadContactFolderEntries(repairCaseId, env.fetchImpl, "");
  const plain = withoutEntries(top);
  if (plain !== null) return plain;
  if (top.kind !== "found") return folderFailed("");

  const categoryFolderName = serviceReportFolderCategoryName(reportKind);
  // 🔴 분류 폴더가 없으면 **읽으러 가지 않는다** — 아직 한 번도 저장 안 한 보고서다.
  const onDisk =
    categoryFolderName === null ? null : findServiceReportCategoryFolderName(top.entries, categoryFolderName);
  if (onDisk === null) return notSaved(false);

  // 🔴 도우미가 받을 수 없는 모양이면 주소를 지어내지 않는다(앞 조각의 규칙).
  const relativePath = serviceReportContactFolderRelativePath(top.folderName, onDisk);
  if (relativePath === null) {
    return notice("FOLDER_FAILED", [
      { text: CONTACT_FOLDER_SECTION_FAILED_TEXT, tone: "warning" },
      { text: QUOTE_ARCHIVE_EXCEL_NO_FOLDER_PLACE_TEXT, tone: "muted" },
    ]);
  }

  // ── 2) 분류 폴더 안 — 그 보고서의 엑셀 한 장 ───────────────────────────
  const inside = await loadContactFolderEntries(repairCaseId, env.fetchImpl, onDisk);
  const insidePlain = withoutEntries(inside);
  if (insidePlain !== null) return insidePlain;
  if (inside.kind !== "found") return folderFailed("");

  const entry = pickServiceReportExcelEntry(inside.entries, fileName);
  if (entry === null) return notSaved(inside.truncated);

  // ── 3) 여는 장치에 넘긴다 — 이 모듈은 주소를 만들지 않는다 ─────────────
  const openFile = env.openFile ?? runContactFolderFileOpen;
  const opened = await openFile({ folderName: relativePath, fileName: entry.name });
  return { kind: "OPENED", lines: opened.lines, offerHelperInstall: opened.offerHelperInstall };
}
