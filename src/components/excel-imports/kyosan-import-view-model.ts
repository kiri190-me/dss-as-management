import type {
  KyosanChunkRowResult,
  KyosanImportFailureCode,
  KyosanPreviewRow,
  KyosanPreviewStatus,
} from "@/lib/server/services/kyosan-intake-import";
import type { KyosanHeaderMismatch, KyosanParseFailureCode } from "@/lib/domain/kyosan-intake-import/types";
import type { RepairCaseXlsxSafetyCode } from "@/lib/xlsx/xlsx-upload-safety";
import { toKstDateOnly } from "@/lib/domain/date-only";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 화면의 판단 (순수 함수만)
 * ============================================================================
 * 화면(KyosanIntakeImportScreen.tsx)은 서버 액션을 부르므로 `server-only` 사슬 때문에
 * 시험에서 그릴 수 없다. 그래서 판단은 전부 여기 두고 Node 시험으로 돌린다 —
 * 거르기 · 쪽 나누기 · 조각 나누기 · 진행 상태 · 결과 합계 · 실패 문장.
 *
 * 🔴 서버 모듈에서는 **타입만** 가져온다(`import type`). 값을 가져오면 클라이언트 묶음에
 * 서버 코드가 딸려 들어가거나 빌드가 깨진다. 조각 크기(25)도 그래서 상수를 가져오지 않고
 * 미리보기 결과의 `chunkSize` 를 쓴다.
 * ============================================================================
 */

// ── 올리기 ────────────────────────────────────────────────────────────────

/**
 * 올릴 수 있는 파일 크기의 상한 — 서버의 xlsx 안전 검사 한도(REPAIR_CASE_XLSX_SAFETY_LIMITS
 * .maxCompressedBytes)와 같아야 한다. 그 모듈은 node:path 를 불러 화면에서 가져올 수 없어
 * 여기 다시 적고, 두 값이 같은지는 시험이 본다.
 */
export const KYOSAN_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** 고른 파일을 서버에 보내기 전에 화면에서 먼저 본다. 괜찮으면 null. */
export function checkKyosanUploadFile(file: { name: string; size: number }): string | null {
  if (!/\.xlsx$/i.test(file.name)) return ".xlsx 파일만 올릴 수 있습니다.";
  if (file.size === 0) return "빈 파일입니다.";
  if (file.size > KYOSAN_UPLOAD_MAX_BYTES) {
    return `${Math.round(KYOSAN_UPLOAD_MAX_BYTES / (1024 * 1024))}MB 이하의 .xlsx 파일만 올릴 수 있습니다.`;
  }
  return null;
}

// ── 이름표 ────────────────────────────────────────────────────────────────

export const KYOSAN_STATUS_LABELS: Record<KyosanPreviewStatus, string> = {
  IMPORTABLE: "가져올 것",
  ALREADY_EXISTS: "이미 있음",
  ALREADY_EXISTS_TRASHED: "이미 있음(휴지통)",
  EXCLUDED: "제외",
  NEEDS_REVIEW: "확인 필요",
};

export const KYOSAN_OUTCOME_LABELS: Record<KyosanChunkRowResult["outcome"], string> = {
  CREATED: "만듦",
  ALREADY_EXISTS: "이미 있음",
  SKIPPED: "건너뜀",
  FAILED: "실패",
};

/** 수리 건 휴지통은 따로 된 주소가 없다 — A/S 현황 화면의 「휴지통」 탭이다. */
export const REPAIR_CASE_TRASH_HREF = "/repair-cases";
export const REPAIR_CASE_TRASH_LABEL = "A/S 현황 › 휴지통 탭";

export function repairCaseHref(repairCaseId: string): string {
  return `/repair-cases/${repairCaseId}`;
}

/** 행 번호 목록 — 길면 앞의 몇 개만 적고 「외 N줄」. */
export function formatKyosanRowNumbers(rowNumbers: readonly number[], max = 10): string {
  const shown = rowNumbers.slice(0, max).join(", ");
  const rest = rowNumbers.length - max;
  return rest > 0 ? `${shown} 외 ${rest}줄` : shown;
}

/** ISO 시각 → 한국 날짜(YYYY-MM-DD). 읽을 수 없으면 받은 글자 그대로. */
export function formatKstDate(iso: string): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso : toKstDateOnly(instant);
}

// ── 실패 문장 ──────────────────────────────────────────────────────────────

const SAFETY_CODE_LABELS: Record<RepairCaseXlsxSafetyCode, string> = {
  UNSUPPORTED_FILE_EXTENSION: ".xlsx 파일이 아닙니다.",
  COMPRESSED_UPLOAD_SIZE_LIMIT_EXCEEDED: "파일이 20MB 를 넘습니다.",
  INVALID_ZIP_SIGNATURE: "엑셀(.xlsx) 파일 형식이 아닙니다.",
  INVALID_OOXML_PACKAGE: "엑셀 파일의 내부 구조가 올바르지 않습니다.",
  MACRO_CONTENT_DETECTED: "매크로가 들어 있습니다.",
  ACTIVEX_CONTENT_DETECTED: "ActiveX 개체가 들어 있습니다.",
  OLE_EMBEDDED_CONTENT_DETECTED: "포함된 개체(OLE)가 들어 있습니다.",
  EXTERNAL_WORKBOOK_LINK_DETECTED: "다른 통합 문서를 가리키는 외부 연결이 있습니다.",
  DDE_FORMULA_DETECTED: "DDE 수식이 들어 있습니다.",
  ZIP_PATH_TRAVERSAL_DETECTED: "파일 내부 경로가 올바르지 않습니다.",
  DUPLICATE_ZIP_ENTRY_DETECTED: "파일 내부에 같은 이름의 항목이 겹칩니다.",
  ZIP_ENTRY_LIMIT_EXCEEDED: "파일 내부 항목이 너무 많습니다.",
  ZIP_ENTRY_SIZE_LIMIT_EXCEEDED: "파일 내부 항목 하나가 너무 큽니다.",
  ZIP_TOTAL_UNCOMPRESSED_LIMIT_EXCEEDED: "압축을 푼 전체 크기가 너무 큽니다.",
  ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED: "압축률이 비정상적으로 높습니다.",
  WORKSHEET_ROW_LIMIT_EXCEEDED: "시트의 줄이 너무 많습니다.",
  WORKSHEET_CELL_LIMIT_EXCEEDED: "시트의 칸이 너무 많습니다.",
  CELL_TEXT_LIMIT_EXCEEDED: "칸 하나의 글자가 너무 깁니다.",
  HYPERLINK_PRESENT: "하이퍼링크가 들어 있습니다.",
};

const PARSE_FAILURE_HINTS: Record<KyosanParseFailureCode, string> = {
  UNSAFE_FILE: "안전 검사에 걸렸습니다. 엑셀에서 아래 항목을 없애고 .xlsx 로 다시 저장해 올려 주세요.",
  SHEET_NOT_FOUND: "「リスト」 시트가 있는 교산 인수품 리스트인지 확인해 주세요.",
  HEADER_NOT_FOUND: "C열에 「引取番号」 머리글이 있는 줄을 찾지 못했습니다. 교산 인수품 리스트인지 확인해 주세요.",
  HEADER_MISMATCH: "열 순서가 바뀌었거나 머리글이 다릅니다. 엑셀을 원래 양식대로 고쳐 다시 올려 주세요.",
};

/** 서버 액션 · 서비스가 돌려주는 실패의 공통 모양(두 실패 타입의 합). */
export type KyosanFailureInput = {
  ok: false;
  code: KyosanImportFailureCode | "UNAUTHORIZED" | "DATABASE_UNAVAILABLE";
  message: string;
  parseFailureCode?: KyosanParseFailureCode;
  mismatches?: KyosanHeaderMismatch[];
  safetyCodes?: RepairCaseXlsxSafetyCode[];
};

export type KyosanFailureText = {
  title: string;
  /** 서버가 준 문구 등 한 줄 설명. */
  detail: string | null;
  /** 머리글 불일치 · 안전 검사 항목처럼 늘어놓을 것. */
  lines: string[];
  /** [다시 시도] 로 같은 조각을 다시 보내도 되는가(네트워크 · DB 일시 오류). */
  retryable: boolean;
};

/** 머리글 한 칸의 불일치 → 「어느 열이 무엇이어야 하는데 무엇이었다」. */
export function describeHeaderMismatch(mismatch: KyosanHeaderMismatch): string {
  const actual = mismatch.actual === null ? "비어 있었습니다" : `「${mismatch.actual}」였습니다`;
  return `${mismatch.column}열 머리글은 「${mismatch.expected}」이어야 하는데 ${actual}.`;
}

export function describeKyosanFailure(failure: KyosanFailureInput): KyosanFailureText {
  switch (failure.code) {
    case "UNAUTHORIZED":
      return {
        title: "로그인이 필요합니다.",
        detail: "다시 로그인한 뒤 미리보기부터 다시 해 주세요.",
        lines: [],
        retryable: false,
      };
    case "FORBIDDEN":
      return { title: "가져올 수 없습니다.", detail: failure.message, lines: [], retryable: false };
    case "VALIDATION_ERROR":
      return { title: "요청을 처리할 수 없습니다.", detail: failure.message, lines: [], retryable: false };
    case "INVALID_FILE": {
      const lines = [
        ...(failure.mismatches ?? []).map(describeHeaderMismatch),
        ...(failure.safetyCodes ?? []).map((code) => SAFETY_CODE_LABELS[code] ?? code),
      ];
      const hint = failure.parseFailureCode ? PARSE_FAILURE_HINTS[failure.parseFailureCode] : null;
      return {
        title: "파일을 읽을 수 없습니다.",
        detail: [failure.message, hint].filter((part) => part).join(" "),
        lines,
        retryable: false,
      };
    }
    case "FILE_CHANGED":
      return {
        title: "올린 파일이 미리보기 때의 파일과 다릅니다.",
        detail: "같은 파일로 미리보기부터 다시 해 주세요.",
        lines: [],
        retryable: false,
      };
    case "TOO_MANY_ROWS":
      return { title: "한 번에 보낸 줄이 너무 많습니다.", detail: failure.message, lines: [], retryable: false };
    case "DATABASE_UNAVAILABLE":
      return {
        title: "일시적으로 처리할 수 없습니다.",
        detail: "잠시 후 [다시 시도]를 눌러 주세요. 같은 줄을 다시 보내도 같은 건이 돌아옵니다(두 번 만들지 않습니다).",
        lines: [],
        retryable: true,
      };
    default:
      return { title: "처리하지 못했습니다.", detail: (failure as { message?: string }).message ?? null, lines: [], retryable: false };
  }
}

/** 액션 호출 자체가 던졌을 때(네트워크 끊김 등). */
export function describeKyosanNetworkFailure(): KyosanFailureText {
  return {
    title: "서버와 연결이 끊겼습니다.",
    detail: "네트워크를 확인하고 [다시 시도]를 눌러 주세요. 같은 줄을 다시 보내도 같은 건이 돌아옵니다(두 번 만들지 않습니다).",
    lines: [],
    retryable: true,
  };
}

// ── 미리보기: 건수 · 거르기 · 쪽 나누기 ──────────────────────────────────────

export type KyosanBillingFlagCounts = { billingReview: number; billingAdjusted: number };

/** 가져올 줄 가운데 「유/무상 확인 필요」 · 「일부 유상으로 바뀜」 수. */
export function countKyosanBillingFlags(rows: readonly KyosanPreviewRow[]): KyosanBillingFlagCounts {
  let billingReview = 0;
  let billingAdjusted = 0;
  for (const row of rows) {
    if (row.status !== "IMPORTABLE" || row.plan === null) continue;
    if (row.plan.billingReview) billingReview += 1;
    if (row.plan.billingAdjustment !== null) billingAdjusted += 1;
  }
  return { billingReview, billingAdjusted };
}

export type KyosanRowFilter = "ALL" | KyosanPreviewStatus | "BILLING_REVIEW" | "BILLING_ADJUSTED";

export const DEFAULT_KYOSAN_ROW_FILTER: KyosanRowFilter = "ALL";

/** 「전체」의 줄 순서 — 사람이 볼 것이 위로. 같은 상태 안에서는 행 번호 순. */
const STATUS_ORDER: Record<KyosanPreviewStatus, number> = {
  NEEDS_REVIEW: 0,
  ALREADY_EXISTS: 1,
  ALREADY_EXISTS_TRASHED: 2,
  IMPORTABLE: 3,
  EXCLUDED: 4,
};

export function filterKyosanPreviewRows(rows: readonly KyosanPreviewRow[], filter: KyosanRowFilter): KyosanPreviewRow[] {
  const byRow = (a: KyosanPreviewRow, b: KyosanPreviewRow) => a.rowNumber - b.rowNumber;
  switch (filter) {
    case "ALL":
      return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byRow(a, b));
    case "BILLING_REVIEW":
      return rows.filter((row) => row.status === "IMPORTABLE" && row.plan?.billingReview === true).sort(byRow);
    case "BILLING_ADJUSTED":
      return rows
        .filter((row) => row.status === "IMPORTABLE" && row.plan !== null && row.plan.billingAdjustment !== null)
        .sort(byRow);
    default:
      return rows.filter((row) => row.status === filter).sort(byRow);
  }
}

export const KYOSAN_DEFAULT_PAGE_SIZE = 50;

export function paginateKyosanRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number
): { rows: T[]; page: number; totalPages: number } {
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : KYOSAN_DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), totalPages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, totalPages };
}

// ── 가져오기: 조각 · 진행 ────────────────────────────────────────────────────

/** 서버가 한 번에 받는 줄 수의 상한(KYOSAN_IMPORT_MAX_ROWS_PER_CHUNK)과 같다. */
const MAX_ROWS_PER_CHUNK = 50;
const FALLBACK_CHUNK_SIZE = 25;

/** 가져올 줄의 행 번호 — 행 번호 순. */
export function importableKyosanRowNumbers(rows: readonly KyosanPreviewRow[]): number[] {
  return rows
    .filter((row) => row.status === "IMPORTABLE")
    .map((row) => row.rowNumber)
    .sort((a, b) => a - b);
}

export function splitKyosanChunks(rowNumbers: readonly number[], chunkSize: number): number[][] {
  const size =
    Number.isInteger(chunkSize) && chunkSize > 0 ? Math.min(chunkSize, MAX_ROWS_PER_CHUNK) : FALLBACK_CHUNK_SIZE;
  const chunks: number[][] = [];
  for (let start = 0; start < rowNumbers.length; start += size) {
    chunks.push(rowNumbers.slice(start, start + size));
  }
  return chunks;
}

export function kyosanImportConfirmLines(count: number, chunkSize: number): string[] {
  return [
    `수리 건 ${count}건을 새로 만듭니다.`,
    `${chunkSize}줄씩 차례로 보내며, 도중에 [멈춤]으로 멈출 수 있습니다.`,
    "되돌리려면 만든 건을 하나씩 휴지통으로 옮겨야 합니다(한꺼번에 되돌리는 기능은 없습니다).",
  ];
}

/**
 * running — 조각을 보내는 중 · pausing — 지금 조각이 끝나면 멈춘다 · paused — 멈춤 ·
 * failed — 조각이 실패해 멈춤 · done — 모든 조각을 보냈다.
 */
export type KyosanRunPhase = "running" | "pausing" | "paused" | "failed" | "done";

export type KyosanRunState = {
  chunks: readonly (readonly number[])[];
  totalRows: number;
  /** 다음에 보낼 조각의 차례. 실패하면 그대로 두어 [다시 시도]가 같은 조각을 보낸다. */
  nextChunkIndex: number;
  results: KyosanChunkRowResult[];
  phase: KyosanRunPhase;
  failure: KyosanFailureText | null;
};

export function startKyosanRun(rowNumbers: readonly number[], chunkSize: number): KyosanRunState {
  const chunks = splitKyosanChunks(rowNumbers, chunkSize);
  return {
    chunks,
    totalRows: rowNumbers.length,
    nextChunkIndex: 0,
    results: [],
    phase: chunks.length === 0 ? "done" : "running",
    failure: null,
  };
}

/** 다음에 보낼 조각. 더 없으면 null. */
export function nextKyosanChunk(state: KyosanRunState): readonly number[] | null {
  return state.chunks[state.nextChunkIndex] ?? null;
}

/** 조각 하나가 성공했다. 결과는 행 번호로 합친다 — 같은 줄이 다시 오면 나중 것이 이긴다. */
export function recordKyosanChunkSuccess(
  state: KyosanRunState,
  results: readonly KyosanChunkRowResult[]
): KyosanRunState {
  const merged = new Map(state.results.map((result) => [result.rowNumber, result]));
  for (const result of results) merged.set(result.rowNumber, result);
  const nextChunkIndex = state.nextChunkIndex + 1;
  const phase: KyosanRunPhase =
    nextChunkIndex >= state.chunks.length ? "done" : state.phase === "pausing" ? "paused" : state.phase;
  return {
    ...state,
    nextChunkIndex,
    results: [...merged.values()].sort((a, b) => a.rowNumber - b.rowNumber),
    phase,
    failure: null,
  };
}

/** 조각이 실패했다(서버의 ok:false 또는 네트워크). 차례는 그대로 — 같은 조각을 다시 보낼 수 있게. */
export function recordKyosanChunkFailure(state: KyosanRunState, failure: KyosanFailureText): KyosanRunState {
  return { ...state, phase: "failed", failure };
}

/** [멈춤] — 보내는 중인 조각은 끝까지 가고, 다음 조각 전에 멈춘다. */
export function pauseKyosanRun(state: KyosanRunState): KyosanRunState {
  return state.phase === "running" ? { ...state, phase: "pausing" } : state;
}

/** [이어서 가져오기] — 멈춘 다음 조각부터. 멈추는 중이면 멈춤을 거둔다. */
export function resumeKyosanRun(state: KyosanRunState): KyosanRunState {
  return state.phase === "paused" || state.phase === "pausing" ? { ...state, phase: "running" } : state;
}

/** 조각과 조각 사이에서 「멈추는 중」을 만나면 멈춤으로 굳힌다(보내는 조각이 없으므로). */
export function settleKyosanPause(state: KyosanRunState): KyosanRunState {
  return state.phase === "pausing" ? { ...state, phase: "paused" } : state;
}

/** [다시 시도] — 다시 보내도 되는 실패일 때만 같은 조각부터. */
export function retryKyosanRun(state: KyosanRunState): KyosanRunState {
  return state.phase === "failed" && state.failure?.retryable ? { ...state, phase: "running", failure: null } : state;
}

/** 조각을 보내고 있는가 — 단추를 잠그고 페이지를 떠날 때 경고한다. */
export function isKyosanRunActive(state: KyosanRunState | null): boolean {
  return state !== null && (state.phase === "running" || state.phase === "pausing");
}

export type KyosanRunProgress = {
  sentRows: number;
  totalRows: number;
  /** 0–100 정수(내림). 줄이 없으면 100. */
  percent: number;
  sentChunks: number;
  totalChunks: number;
};

export function kyosanRunProgress(state: KyosanRunState): KyosanRunProgress {
  let sentRows = 0;
  for (let index = 0; index < state.nextChunkIndex && index < state.chunks.length; index += 1) {
    sentRows += state.chunks[index].length;
  }
  return {
    sentRows,
    totalRows: state.totalRows,
    percent: state.totalRows === 0 ? 100 : Math.floor((sentRows / state.totalRows) * 100),
    sentChunks: Math.min(state.nextChunkIndex, state.chunks.length),
    totalChunks: state.chunks.length,
  };
}

// ── 결과 ──────────────────────────────────────────────────────────────────

export type KyosanResultSummary = {
  created: KyosanChunkRowResult[];
  alreadyExists: KyosanChunkRowResult[];
  skipped: KyosanChunkRowResult[];
  failed: KyosanChunkRowResult[];
  total: number;
};

export function summarizeKyosanResults(results: readonly KyosanChunkRowResult[]): KyosanResultSummary {
  const sorted = [...results].sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    created: sorted.filter((result) => result.outcome === "CREATED"),
    alreadyExists: sorted.filter((result) => result.outcome === "ALREADY_EXISTS"),
    skipped: sorted.filter((result) => result.outcome === "SKIPPED"),
    failed: sorted.filter((result) => result.outcome === "FAILED"),
    total: sorted.length,
  };
}

/** 가져오기가 끝났을 때 팝업에 적을 한 줄. */
export function kyosanRunDoneMessage(summary: KyosanResultSummary): string {
  const rest = summary.total - summary.created.length;
  return rest > 0
    ? `수리 건 ${summary.created.length}건을 만들었습니다(나머지 ${rest}건은 결과를 확인해 주세요).`
    : `수리 건 ${summary.created.length}건을 만들었습니다.`;
}
