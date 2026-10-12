import { buildQuoteFolderXlsx2PdfLink } from "@/lib/domain/quote-folder-xlsx2pdf-link";
import { openLinkInHiddenFrame } from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";
import {
  QUOTE_SAVE_PDF_CHECK_DELAYS_MS,
  QUOTE_SAVE_PDF_DONE_POPUP_TEXT,
  QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT,
  QUOTE_SAVE_PDF_TOTAL_WAIT_MS,
  isFreshQuoteSavePdf,
} from "@/components/quotes/quote-save-pdf-convert";

/**
 * ============================================================================
 * 보고서 [저장] 뒤 — **연락서 폴더에 엑셀을 넣고, 그 엑셀을 PDF 로** (2026-10-12)
 * ============================================================================
 * 사용자 요구(2026-10-12): 「보고서 탭에서 [저장]을 누르면 그 건의 연락서 폴더 안 분류
 * 폴더에 엑셀을 쓰고, 그 엑셀을 PDF 로 바꿔 같은 자리에 둔다.」
 *
 * 🔴 **견적서 쪽 흐름(components/quotes/quote-save-pdf-convert.ts)을 그대로 본떴다.** 그래서
 * 간격 · 상한 · 「방금 생겼는가」 판정 · 팝업 문구는 **베끼지 않고 그 모듈에서 가져다 쓴다** —
 * 베껴 적으면 한쪽만 고쳐지는 날이 온다. 🔴 **견적서 쪽은 한 글자도 바뀌지 않았다**(가져다
 * 쓰기만 한다).
 *
 * 차례는 다섯이다:
 *  1) 🔴 **엑셀을 먼저 꽂는다**(POST …/service-report/contact-folder?id=…). 견적서는 저장
 *     액션이 서버에서 이미 꽂아 두지만, 보고서는 저장(DB)을 **한 글자도 건드리지 않기 위해**
 *     그 일을 별도 통로로 뺐다 — 그래서 공유폴더가 꺼져 있든 느리든 실패하든 **보고서는
 *     저장된 채**다(이 모듈에 서버 액션이 하나도 없다 — 시험이 못 박는다).
 *  2) 통로에 묻는다(GET …/contact-folder/pdf) — 🔴 **주소를 열기 전에 한 번.** 이것이
 *     「전에도 있었다」를 가르는 **기준**이다.
 *  3) `dss-folder://xlsx2pdf/?p=…` 를 **숨은 iframe** 으로 연다 — 견적서와 **같은 함수**다.
 *  4) 🔴 **서버가 폴더를 다시 읽어 확인한다** — 도우미는 답을 주지 않는다. 같은 통로에
 *     몇 번 더 묻고 **상한에서 멈춘다**(간격 넷 · 합계 10초 — 견적서의 그 값 그대로).
 *  5) 결과를 사람이 읽을 줄로 돌려준다.
 *
 * ── 🔴 어느 폴더인가는 **서버가 정한다** ─────────────────────────────────
 * 검사 보고서는 「검사 보고서」, 수리 보고서는 「수리 보고서」 — 그 표는
 * domain/service-report-contact-folder.ts 한 자리에 있고, **저장된 장의 종류**로 고른다.
 * 이 모듈은 종류를 알지도, 보내지도 않는다(화면이 고른 값으로 자리가 정해지지 않게).
 *
 * ── 🔴 「방금 쓴 그 한 장」을 들고 다닌다 ───────────────────────────────
 * 연락서 폴더는 **덮어쓰지 않고 번호로 비켜 간다**(`… (2).xlsx`). 그래서 꽂기 통로가
 * 돌려준 **그 이름 · 그 자리**를 PDF 확인에도 변환 주소에도 그대로 쓴다 — 「엑셀처럼
 * 보이는 것 가운데 하나」를 고르지 않는다.
 *
 * ── 🔴 저장을 막지 않는다 · 되돌리지 않는다 ─────────────────────────────
 * 이 모듈은 **저장이 끝난 뒤에** 불린다. 저장 액션을 부르지도, 기다리게 하지도 않는다.
 * 어떤 결과에도 저장은 되돌아가지 않는다 — 돌려주는 것은 사람이 읽을 줄뿐이다.
 *
 * ── 🔴 줄에 경로가 한 글자도 없다 ────────────────────────────────────────
 * 연락서 폴더 이름에는 고객사명 · 모델 · S/N 이 들어 있다. 이 모듈이 내는 줄에는 폴더
 * 경로도 파일 이름도 들어가지 않는다 — 서버가 주는 실패 사유도 경로 없는 짧은 문장이다.
 * 시험이 이름을 심어 놓고 **한 글자도 새지 않는지** 본다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────
 * fetch · 주소 열기 · 시계를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 · DOM 없이 값으로
 * 시험한다(service-report-save-pdf-convert.test.ts).
 * ============================================================================
 */

// ── 상한 · 팝업 문구 (🔴 견적서 쪽 그대로 — 베끼지 않는다) ────────────────

/** 🔴 주소를 연 **뒤** 확인하기까지의 간격(ms). 길이가 곧 확인 횟수이고 합이 곧 상한이다. */
export const SERVICE_REPORT_SAVE_PDF_CHECK_DELAYS_MS = QUOTE_SAVE_PDF_CHECK_DELAYS_MS;
/** 🔴 모두 합친 기다림의 상한(ms). */
export const SERVICE_REPORT_SAVE_PDF_TOTAL_WAIT_MS = QUOTE_SAVE_PDF_TOTAL_WAIT_MS;

/**
 * 🔴 **진행 중 팝업**의 한 줄 — 사용자가 적어 준 글자 그대로다(2026-10-12).
 * 이 팝업은 저절로 닫히지 않는다 — 아래 완료 문구로 바뀌어야 0.5초를 센다.
 */
export const SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT = QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT;
/** 🔴 끝났을 때 **같은 팝업**이 바뀌는 글자(2026-10-12, 사용자가 적어 준 그대로). */
export const SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT = QUOTE_SAVE_PDF_DONE_POPUP_TEXT;

// ── 문장 (🔴 경로 · 파일 이름을 적지 않는다) ──────────────────────────────

/** 🔴 **모든 결과의 첫 줄** — PDF 가 안 돼도 보고서는 저장됐다는 것이 분명해야 한다. */
export const SERVICE_REPORT_SAVE_PDF_SAVED_TEXT = "보고서는 저장되었습니다.";

export const SERVICE_REPORT_SAVE_PDF_CREATED_TEXT =
  "연락서 폴더에 엑셀을 넣고 PDF 로 바꿔 같은 자리에 두었습니다.";

export const SERVICE_REPORT_SAVE_PDF_NOT_VISIBLE_TEXT =
  "PDF 가 아직 보이지 않습니다 — 이 PC 에 Excel 이 없거나 폴더 열기 도우미가 예전 것일 수 있습니다";

/** 🔴 「끝」이 아니라 「늦을 수 있다」가 사실이다 — 변환이 끝나면 폴더에 나타난다. */
export const SERVICE_REPORT_SAVE_PDF_NOT_VISIBLE_HINT_TEXT =
  "변환이 늦게 끝나면 잠시 뒤 공유폴더에 나타납니다 — 계속 안 보이면 [설치 명령 복사]로 도우미를 다시 설치해 주세요";

/** 🔴 전에도 있던 PDF 가 그대로다 — 「만들었다」고 말하지 않는다. */
export const SERVICE_REPORT_SAVE_PDF_STALE_TEXT =
  "전에 만든 PDF 가 그대로입니다 — 이번 변환은 아직 보이지 않습니다";

export const SERVICE_REPORT_SAVE_PDF_DISABLED_TEXT =
  "공유폴더 저장이 꺼져 있어 엑셀 · PDF 를 만들지 않았습니다";

export const SERVICE_REPORT_SAVE_PDF_NO_FOLDER_TEXT =
  "이 수리 건의 연락서 폴더가 아직 없어 엑셀을 넣지 못했습니다 — 「기본 정보」의 [폴더 만들고 열기]로 먼저 만들어 주세요";

export const SERVICE_REPORT_SAVE_PDF_MULTIPLE_TEXT =
  "맞는 연락서 폴더가 여럿이라 어느 폴더인지 알 수 없어 엑셀을 넣지 않았습니다 — 폴더를 확인해 주세요";

export const SERVICE_REPORT_SAVE_PDF_ARCHIVE_FAILED_TEXT = "연락서 폴더에 엑셀을 넣지 못했습니다";

export const SERVICE_REPORT_SAVE_PDF_FOLDER_FAILED_TEXT = "공유폴더를 읽지 못해 PDF 를 만들지 못했습니다";

export const SERVICE_REPORT_SAVE_PDF_NO_SOURCE_TEXT =
  "연락서 폴더에서 방금 넣은 엑셀을 찾지 못해 PDF 를 만들지 못했습니다";

export const SERVICE_REPORT_SAVE_PDF_LINK_FAILED_TEXT =
  "이 보고서 엑셀은 PDF 변환 주소로 만들 수 없습니다 — 공유폴더에서 직접 바꿔 주세요";

export const SERVICE_REPORT_SAVE_PDF_OPEN_FAILED_TEXT = "브라우저가 PDF 변환 주소를 열지 못했습니다";

/** 🔴 분류 폴더 자리를 같은 이름의 **파일**이 막고 있었다 — 그 파일을 지우지 않았다. */
export const SERVICE_REPORT_SAVE_PDF_CATEGORY_BLOCKED_TEXT =
  "같은 이름의 파일이 분류 폴더 자리를 막고 있어 연락서 폴더 바로 아래에 넣었습니다";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

// ── 통로 ─────────────────────────────────────────────────────────────────

export function serviceReportContactFolderUrl(repairCaseId: string, serviceReportId: string): string {
  return `/api/repair-cases/${encodeURIComponent(repairCaseId)}/service-report/contact-folder?id=${encodeURIComponent(
    serviceReportId
  )}`;
}

export function serviceReportContactFolderPdfUrl(
  repairCaseId: string,
  insidePath: string,
  fileName: string
): string {
  return `/api/repair-cases/${encodeURIComponent(
    repairCaseId
  )}/service-report/contact-folder/pdf?path=${encodeURIComponent(insidePath)}&name=${encodeURIComponent(fileName)}`;
}

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 줄까지 오지 않는다. */
type ArchiveAnswer =
  | {
      status: "copied" | "unchanged";
      fileName: string;
      categoryFolderName: string | null;
      categoryFolderBlockedByFile: boolean;
      /** 도우미 주소를 만들 재료. 서버가 못 내면 null 이다 — 주소를 지어내지 않는다. */
      relativePath: string | null;
    }
  | { status: "no-folder" }
  | { status: "multiple" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

type PdfAnswer =
  | {
      status: "found";
      /** 지금 그 자리에 그 PDF 가 있는가. */
      pdfExists: boolean;
      /** 수정 시각(에포크 ms). 칸이 없거나 읽히지 않으면 null — **단언하지 않는다.** */
      pdfModifiedAtMs: number | null;
    }
  | { status: "no-source" }
  | { status: "multiple" }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modifiedAtMsOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

function failedAnswer(payload: Record<string, unknown>): { status: "failed"; reason: string } {
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  return { status: "failed", reason: reason === "" ? UNKNOWN_REASON : reason };
}

function readArchiveAnswer(payload: unknown): ArchiveAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "copied":
    case "unchanged": {
      if (typeof payload.fileName !== "string" || payload.fileName.length === 0) return null;
      return {
        status: payload.status,
        fileName: payload.fileName,
        categoryFolderName: typeof payload.categoryFolderName === "string" ? payload.categoryFolderName : null,
        categoryFolderBlockedByFile: payload.categoryFolderBlockedByFile === true,
        relativePath: typeof payload.relativePath === "string" ? payload.relativePath : null,
      };
    }
    case "no-folder":
      return { status: "no-folder" };
    case "multiple":
      return { status: "multiple" };
    case "disabled":
      return { status: "disabled" };
    case "failed":
      return failedAnswer(payload);
    default:
      return null;
  }
}

function readPdfAnswer(payload: unknown): PdfAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found":
      return {
        status: "found",
        pdfExists: payload.pdfExists === true,
        pdfModifiedAtMs: modifiedAtMsOf(payload.pdfModifiedAt),
      };
    case "no-source":
      return { status: "no-source" };
    case "multiple":
      return { status: "multiple" };
    case "not-found":
      return { status: "not-found" };
    case "disabled":
      return { status: "disabled" };
    case "failed":
      return failedAnswer(payload);
    default:
      return null;
  }
}

// ── 바꿔 끼울 수 있는 것 ──────────────────────────────────────────────────

export type ServiceReportSaveFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** 🔴 `init` 이 있는 것은 꽂기가 **POST** 이기 때문이다(견적서 쪽은 읽기뿐이라 없다). */
export type ServiceReportSaveFetch = (
  url: string,
  init?: { method: string }
) => Promise<ServiceReportSaveFetchResponse>;

export type ServiceReportSavePdfEnvironment = {
  fetchImpl: ServiceReportSaveFetch;
  /** 도우미 주소를 페이지를 떠나지 않고 연다. 🔴 기본은 **견적서가 쓰는 그 숨은 iframe** 이다. */
  openLink: (link: string) => void;
  delay: (ms: number) => Promise<void>;
};

const BROWSER_ENVIRONMENT: ServiceReportSavePdfEnvironment = {
  fetchImpl: (url, init) => fetch(url, init),
  openLink: openLinkInHiddenFrame,
  delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

async function askJson(
  url: string,
  fetchImpl: ServiceReportSaveFetch,
  init?: { method: string }
): Promise<{ ok: true; payload: unknown } | { ok: false; reason: string }> {
  let response: ServiceReportSaveFetchResponse;
  try {
    response = await fetchImpl(url, init);
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
    return { ok: false, reason: error !== "" ? error : rejectedReason(response.status) };
  }
  return { ok: true, payload: await response.json().catch(() => null) };
}

async function askArchive(
  repairCaseId: string,
  serviceReportId: string,
  fetchImpl: ServiceReportSaveFetch
): Promise<ArchiveAnswer> {
  const asked = await askJson(serviceReportContactFolderUrl(repairCaseId, serviceReportId), fetchImpl, {
    method: "POST",
  });
  if (!asked.ok) return { status: "failed", reason: asked.reason };
  const answer = readArchiveAnswer(asked.payload);
  return answer === null ? { status: "failed", reason: UNREADABLE_RESPONSE_REASON } : answer;
}

async function askPdf(
  repairCaseId: string,
  insidePath: string,
  fileName: string,
  fetchImpl: ServiceReportSaveFetch
): Promise<PdfAnswer> {
  const asked = await askJson(
    serviceReportContactFolderPdfUrl(repairCaseId, insidePath, fileName),
    fetchImpl
  );
  if (!asked.ok) return { status: "failed", reason: asked.reason };
  const answer = readPdfAnswer(asked.payload);
  return answer === null ? { status: "failed", reason: UNREADABLE_RESPONSE_REASON } : answer;
}

// ── 결과 ─────────────────────────────────────────────────────────────────

export type ServiceReportSavePdfOutcomeKind =
  /** 공유폴더 저장이 꺼져 있다 — 🔴 엑셀도 PDF 도 만들지 않았다. */
  | "DISABLED"
  /** 🔴 연락서 폴더가 아직 없다 — **만들지 않았다.** */
  | "NO_FOLDER"
  | "MULTIPLE"
  /** 엑셀을 꽂지 못했다(느림 · 권한 · 이름). */
  | "ARCHIVE_FAILED"
  /** 꽂긴 했는데 그 뒤 공유폴더를 읽지 못했다. */
  | "FOLDER_FAILED"
  /** 꽂은 자리에서 그 엑셀을 다시 찾지 못했다. */
  | "NO_SOURCE"
  /** 이름이 규칙 밖이라 변환 주소를 만들지 못했다 — 주소를 지어내지 않는다. */
  | "LINK_FAILED"
  | "OPEN_FAILED"
  /** 🔴 **방금 생겼다** — 기준과 견주어 확인했다. */
  | "CREATED"
  /** 상한까지 봤는데 PDF 가 보이지 않는다. */
  | "NOT_VISIBLE"
  /** 🔴 PDF 는 있는데 **전에 있던 그것**이다(또는 새것인지 잴 수 없다). */
  | "STALE";

export type ServiceReportSavePdfOutcome = {
  kind: ServiceReportSavePdfOutcomeKind;
  /** 🔴 사람이 읽는 줄. 경로 · 파일 이름이 한 글자도 들어가지 않는다. */
  lines: QuoteIssueNoticeLine[];
  /** 주소를 연 **뒤** 폴더를 다시 읽어 본 횟수. 0 이면 열지 않았다. */
  checks: number;
};

/**
 * 🔴 **넘어가도 되는 결과인가.** 사람이 읽어야 할 말이 없는 것만 참이다 — 꺼져 있었거나,
 * PDF 가 실제로 생겼거나. 나머지는 화면에 남아 사람이 읽는다(0.5초 팝업으로 전할 수 없다).
 */
export function canLeaveAfterServiceReportSavePdf(kind: ServiceReportSavePdfOutcomeKind): boolean {
  return kind === "DISABLED" || kind === "CREATED";
}

function notice(
  kind: ServiceReportSavePdfOutcomeKind,
  lines: QuoteIssueNoticeLine[],
  checks = 0
): ServiceReportSavePdfOutcome {
  return { kind, lines, checks };
}

/** 🔴 결과마다 첫 줄은 「저장됐다」다. */
function savedFirst(...lines: QuoteIssueNoticeLine[]): QuoteIssueNoticeLine[] {
  return [{ text: SERVICE_REPORT_SAVE_PDF_SAVED_TEXT, tone: "normal" }, ...lines];
}

// ── 부르는 곳 ────────────────────────────────────────────────────────────

/**
 * 보고서 [저장]이 끝난 뒤 한 번. **던지지 않는다** — 무슨 일이 나도 결과 하나로 끝나고,
 * 저장은 되돌아가지 않는다. `env` 에 준 것만 바꿔 끼우고 나머지는 브라우저 기본값이다.
 */
export async function runServiceReportSavePdfConvert({
  repairCaseId,
  serviceReportId,
  onConvertStart,
  env: overrides = {},
}: {
  repairCaseId: string;
  /** 방금 저장된 장. 🔴 **그 장을 서버가 다시 읽어** 엑셀을 만든다(화면 값을 보내지 않는다). */
  serviceReportId: string;
  /**
   * 🔴 **변환이 진짜 시작된 그때** 한 번 불린다 — 도우미 주소를 연 뒤다. 부르는 화면이
   * 「바꾸는 중입니다…」를 띄우는 자리다. 없으면 아무 일도 없다.
   */
  onConvertStart?: () => void;
  env?: Partial<ServiceReportSavePdfEnvironment>;
}): Promise<ServiceReportSavePdfOutcome> {
  const env: ServiceReportSavePdfEnvironment = { ...BROWSER_ENVIRONMENT, ...overrides };

  // ── 1) 엑셀을 꽂는다 — 🔴 연락서 폴더는 **만들지 않는다** ───────────────
  const archived = await askArchive(repairCaseId, serviceReportId, env.fetchImpl);
  switch (archived.status) {
    case "disabled":
      return notice("DISABLED", savedFirst({ text: SERVICE_REPORT_SAVE_PDF_DISABLED_TEXT, tone: "muted" }));
    case "no-folder":
      return notice("NO_FOLDER", savedFirst({ text: SERVICE_REPORT_SAVE_PDF_NO_FOLDER_TEXT, tone: "warning" }));
    case "multiple":
      return notice("MULTIPLE", savedFirst({ text: SERVICE_REPORT_SAVE_PDF_MULTIPLE_TEXT, tone: "warning" }));
    case "failed":
      return notice(
        "ARCHIVE_FAILED",
        savedFirst(
          { text: SERVICE_REPORT_SAVE_PDF_ARCHIVE_FAILED_TEXT, tone: "warning" },
          { text: archived.reason, tone: "muted" }
        )
      );
    case "copied":
    case "unchanged":
      break;
  }

  // 🔴 분류 폴더 자리를 파일이 막아 바로 아래로 비켜 갔으면 그 사실을 함께 알린다.
  const blockedLines: QuoteIssueNoticeLine[] = archived.categoryFolderBlockedByFile
    ? [{ text: SERVICE_REPORT_SAVE_PDF_CATEGORY_BLOCKED_TEXT, tone: "warning" }]
    : [];
  // 통로가 쓰는 자리 — 분류 폴더 이름이거나(보통) 연락서 폴더 맨 위(비켜 갔을 때)다.
  const insidePath = archived.categoryFolderName ?? "";

  // ── 2) 주소를 만든다 — 🔴 못 만들면 지어내지 않는다 ────────────────────
  const link =
    archived.relativePath === null
      ? null
      : buildQuoteFolderXlsx2PdfLink(`${archived.relativePath}/${archived.fileName}`);
  if (link === null) {
    return notice(
      "LINK_FAILED",
      savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_LINK_FAILED_TEXT, tone: "warning" })
    );
  }

  // ── 3) 주소를 열기 **전에** 한 번 — 「전에도 있었다」를 가르는 기준 ──────
  const baseline = await askPdf(repairCaseId, insidePath, archived.fileName, env.fetchImpl);
  switch (baseline.status) {
    case "disabled":
      return notice(
        "DISABLED",
        savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_DISABLED_TEXT, tone: "muted" })
      );
    case "not-found":
      return notice(
        "NO_FOLDER",
        savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_NO_FOLDER_TEXT, tone: "warning" })
      );
    case "multiple":
      return notice(
        "MULTIPLE",
        savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_MULTIPLE_TEXT, tone: "warning" })
      );
    case "no-source":
      return notice(
        "NO_SOURCE",
        savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_NO_SOURCE_TEXT, tone: "warning" })
      );
    case "failed":
      return notice(
        "FOLDER_FAILED",
        savedFirst(
          ...blockedLines,
          { text: SERVICE_REPORT_SAVE_PDF_FOLDER_FAILED_TEXT, tone: "warning" },
          { text: baseline.reason, tone: "muted" }
        )
      );
    case "found":
      break;
  }

  // ── 4) 연다 ────────────────────────────────────────────────────────────
  try {
    env.openLink(link);
  } catch {
    return notice(
      "OPEN_FAILED",
      savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_OPEN_FAILED_TEXT, tone: "warning" })
    );
  }

  // 🔴 여기부터가 **기다리는 시간**이다 — 사람에게 「도는 중」을 보일 자리.
  onConvertStart?.();

  // ── 5) 서버가 폴더를 다시 읽어 확인한다 — 몇 번 보고 **상한에서 멈춘다** ──
  let checks = 0;
  let lastFound: { pdfExists: boolean; pdfModifiedAtMs: number | null } = baseline;
  for (const waitMs of SERVICE_REPORT_SAVE_PDF_CHECK_DELAYS_MS) {
    await env.delay(waitMs);
    checks += 1;
    const answer = await askPdf(repairCaseId, insidePath, archived.fileName, env.fetchImpl);
    // 한 번 못 읽었다고 그만두지 않는다 — 다음 차례에 다시 본다(상한이 막아 준다).
    if (answer.status !== "found") continue;
    lastFound = answer;
    // 🔴 「방금 생겼는가」 판정은 견적서 쪽 그 함수다 — 잴 수 없으면 **거짓**이다.
    if (isFreshQuoteSavePdf(baseline, answer)) {
      return notice(
        "CREATED",
        savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_CREATED_TEXT, tone: "normal" }),
        checks
      );
    }
  }

  // 🔴 상한에 닿았다. PDF 가 보이긴 하는데 새것이라고 **잴 수 없으면** 그렇게 말한다.
  if (lastFound.pdfExists) {
    return notice(
      "STALE",
      savedFirst(...blockedLines, { text: SERVICE_REPORT_SAVE_PDF_STALE_TEXT, tone: "warning" }),
      checks
    );
  }
  return notice(
    "NOT_VISIBLE",
    savedFirst(
      ...blockedLines,
      { text: SERVICE_REPORT_SAVE_PDF_NOT_VISIBLE_TEXT, tone: "warning" },
      { text: SERVICE_REPORT_SAVE_PDF_NOT_VISIBLE_HINT_TEXT, tone: "muted" }
    ),
    checks
  );
}
