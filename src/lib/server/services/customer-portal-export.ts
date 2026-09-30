import "server-only";

import { listActiveLinks, listPortalItemsForCustomer } from "@/lib/db/queries/customer-portal";
import {
  buildPortalExportRows,
  findPortalExportSpec,
  nextPortalExportFileName,
  portalExportStamp,
  type CustomerPortalExportSpec,
} from "@/lib/domain/customer-portal-export";
import {
  findPortalFormForCustomerName,
  type CustomerPortalForm,
} from "@/lib/domain/customer-portal-forms";
import { buildQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import {
  buildCustomerPortalExportWorkbook,
  CustomerPortalExportError,
} from "@/lib/xlsx/customer-portal-export-workbook";
import { readSheetPrintGrid, type SheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";
import {
  findLatestPortalExportFile,
  resolveCustomerPortalArchiveRoot,
  savePortalExportFile,
} from "@/lib/storage/customer-portal-archive";

/**
 * ============================================================================
 * 「고객 안내 현황」의 고객사 양식 표를 엑셀로 — 미리보기 · 공유폴더 저장 · 폴더 열기
 * ============================================================================
 * 한 번의 일이 지나는 길:
 *
 *   고객사 → 양식(customer-portal-forms) → 내보내기 규칙(customer-portal-export)
 *        → 줄 자료(listPortalItemsForCustomer)
 *        → 공유폴더의 **직전 파일**(storage/customer-portal-archive)
 *        → 통합문서 만들기(xlsx/customer-portal-export-workbook)
 *        → 미리보기(sheet-print-grid) 또는 새 이름으로 저장
 *
 * ── 🔴 미리보기와 저장은 **같은 바이트**에서 나온다 ────────────────────────
 * 둘 다 `prepareCustomerPortalExport` 가 만든 통합문서 하나를 쓴다. 미리보기용으로
 * 따로 그리면 「본 것」과 「저장된 것」이 언젠가 달라진다(견적서 미리보기가 같은
 * 자리에서 한 판단이다 — quote-excel-preview.ts 머리말).
 *
 * ── 🔴 직전 파일이 없으면 만들지 않는다 ──────────────────────────────────
 * `NO_PREVIOUS_FILE` 로 끝내고 사람에게 「기준 파일을 폴더에 넣어 주세요」라고 알린다.
 * 없는 서식을 지어내면 그 파일이 고객사로 나간다(사용자 결정 2026-09-30).
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 갈래가 `{ ok: false, code, message }` 로 돌아간다. 사유에 경로 · 설정값이
 * 들어가지 않는다(storage 가 이미 걸러 준다).
 * ============================================================================
 */

export type CustomerPortalExportFailureCode =
  /** 공유폴더 설정이 비어 있다 — 이 기능만 꺼진 상태다. */
  | "DISABLED"
  /** 그 고객사에는 양식이 없다(기본 9열 표만 쓴다). */
  | "NO_FORM"
  /** 이름 규칙에 맞는 직전 파일이 폴더에 없다. */
  | "NO_PREVIOUS_FILE"
  /** 폴더를 읽지 못했다. */
  | "READ_FAILED"
  /** 직전 파일의 모양이 지금 양식과 맞지 않는다 · 통합문서를 만들지 못했다. */
  | "BUILD_FAILED"
  /** 미리보기를 그리지 못했다(저장은 여전히 할 수 있다). */
  | "PREVIEW_FAILED";

export type CustomerPortalExportFailure = {
  ok: false;
  code: CustomerPortalExportFailureCode;
  message: string;
};

export type CustomerPortalExportPlan = {
  form: CustomerPortalForm;
  spec: CustomerPortalExportSpec;
  /** 만든 통합문서 바이트 — 미리보기와 저장이 **같은 것**을 쓴다. */
  bytes: Buffer;
  /** 값이 들어간 탭 이름. */
  sheetName: string;
  /** 본으로 삼은 탭 이름. */
  modelSheetName: string;
  /** 공유폴더에서 읽은 직전 파일 이름. */
  previousFileName: string;
  /** 저장할 새 이름(만든 날짜가 붙는다). */
  fileName: string;
  /** 이번에 적은 줄 수. */
  rowCount: number;
  /** 직전 파일의 표에 있던 줄 수. */
  previousRowCount: number;
};

const NO_FORM_MESSAGE = "이 고객사는 고객사 양식이 없어 엑셀로 내보낼 수 없습니다.";
const DISABLED_MESSAGE = "공유폴더 저장이 꺼져 있습니다 — 관리자에게 문의해 주세요.";
const NO_PREVIOUS_FILE_MESSAGE =
  "공유폴더에 이 고객사의 직전 파일이 없습니다 — 기준이 될 현황표 파일을 폴더에 넣어 주세요. 양식을 새로 만들지는 않습니다.";

function failure(code: CustomerPortalExportFailureCode, message: string): CustomerPortalExportFailure {
  return { ok: false, code, message };
}

/**
 * 고객사 하나의 현황표 통합문서를 만든다(디스크에 쓰지 않는다).
 *
 * `today` 를 받는 것은 시험이 날짜를 고정하기 위해서다 — 안 주면 그 서버의 지금 날짜다.
 */
export async function prepareCustomerPortalExport(
  customerId: string,
  options: { today?: Date } = {}
): Promise<{ ok: true; plan: CustomerPortalExportPlan } | CustomerPortalExportFailure> {
  if (typeof customerId !== "string" || customerId === "") {
    return failure("NO_FORM", "고객사를 확인할 수 없습니다.");
  }

  // 🔴 양식은 **서버가 고른다.** 화면이 보낸 양식 id 를 믿지 않는다(설정 액션과 같은 규칙).
  const links = await listActiveLinks();
  const link = links.find((candidate) => candidate.customerId === customerId);
  if (!link) return failure("NO_FORM", "고객 안내 주소가 발급된 고객사가 아닙니다.");

  const form = findPortalFormForCustomerName(link.customerName);
  if (form === null) return failure("NO_FORM", NO_FORM_MESSAGE);
  const spec = findPortalExportSpec(form.id);
  if (spec === null) return failure("NO_FORM", NO_FORM_MESSAGE);

  const root = resolveCustomerPortalArchiveRoot();
  if (root === null) return failure("DISABLED", DISABLED_MESSAGE);

  const previous = await findLatestPortalExportFile({ root, spec });
  if (previous.status === "not-found") return failure("NO_PREVIOUS_FILE", NO_PREVIOUS_FILE_MESSAGE);
  if (previous.status === "failed") {
    return failure("READ_FAILED", `공유폴더를 읽지 못했습니다 — ${previous.reason}`);
  }

  const items = await listPortalItemsForCustomer(customerId);
  const rows = buildPortalExportRows(form, items);
  const today = options.today ?? new Date();

  try {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: previous.bytes,
      form,
      spec,
      rows,
      stamp: portalExportStamp(today),
      today,
    });
    return {
      ok: true,
      plan: {
        form,
        spec,
        bytes: built.bytes,
        sheetName: built.sheetName,
        modelSheetName: built.modelSheetName,
        previousFileName: previous.fileName,
        fileName: nextPortalExportFileName(previous.parsed, portalExportStamp(today)),
        rowCount: built.rowCount,
        previousRowCount: built.previousRowCount,
      },
    };
  } catch (error) {
    return failure(
      "BUILD_FAILED",
      error instanceof CustomerPortalExportError
        ? error.message
        : "직전 파일을 바탕으로 현황표를 만들지 못했습니다."
    );
  }
}

/**
 * 미리보기 격자 — 보고서 · 수기 견적서 미리보기와 **같은 조각**(sheet-print-grid)이다.
 *
 * `fallback-to-used-range` 를 쓴다: 이 고객사 파일들에는 인쇄 영역이 잡혀 있지 않다
 * (실측). 엑셀도 인쇄 영역이 없으면 쓰인 범위를 인쇄한다.
 *
 * 🔴 그림은 싣지 않는다. 세 파일 다 그림 파트가 없고(실측), 없는 것을 위해 그림을
 * 꺼내 나르는 길을 여는 것은 미리보기가 짊어질 일이 아니다.
 */
export type CustomerPortalExportGrid = Omit<SheetPrintGrid, "pictures"> & { pictures: [] };

export function buildCustomerPortalExportGrid(
  plan: CustomerPortalExportPlan
): { ok: true; grid: CustomerPortalExportGrid } | CustomerPortalExportFailure {
  try {
    const grid = readSheetPrintGrid(plan.bytes, plan.sheetName, { printArea: "fallback-to-used-range" });
    return { ok: true, grid: { ...grid, pictures: [] } };
  } catch {
    return failure(
      "PREVIEW_FAILED",
      "현황표의 모양을 그리지 못했습니다 — [공유폴더에 저장]은 그대로 쓸 수 있습니다."
    );
  }
}

export type CustomerPortalExportSaveOutcome =
  | { ok: true; status: "saved" | "unchanged"; fileName: string }
  | CustomerPortalExportFailure;

/** 만든 통합문서를 공유폴더에 **새 이름으로** 저장한다. 덮어쓰지 않는다. */
export async function saveCustomerPortalExport(
  plan: CustomerPortalExportPlan
): Promise<CustomerPortalExportSaveOutcome> {
  const root = resolveCustomerPortalArchiveRoot();
  if (root === null) return failure("DISABLED", DISABLED_MESSAGE);

  const saved = await savePortalExportFile({ root, fileName: plan.fileName, bytes: plan.bytes });
  if (saved.status === "failed") return failure("READ_FAILED", saved.reason);
  return { ok: true, status: saved.status, fileName: saved.fileName };
}

// ── 폴더 열기 ────────────────────────────────────────────────────────────

/**
 * ============================================================================
 * [폴더 열기] — 이미 설치된 도우미에게 «이 폴더» 하나를 가리킨다
 * ============================================================================
 * 브라우저는 탐색기를 열 수 없다. 이 저장소에는 그 일을 하는 도우미가 이미 있고
 * (견적서 ④ — server/quote-folder-helper.ts), PC 마다 한 번 설치하면
 * `dss-folder://open/?p=<상대 경로>` 주소를 받아 **자기 루트 아래의 폴더만** 연다.
 *
 * 🔴 그래서 여기서 새 도우미를 만들지 않는다. 도우미는 설치될 때 루트가 박히고,
 * 등록되는 자리(레지스트리 `dss-folder` · `%LOCALAPPDATA%\DSS\open-dss-folder.ps1`)가
 * **하나뿐이다.** 현황표용 도우미를 따로 설치하면 견적서 [폴더 열기]가 그 PC 에서
 * 죽는다. 그래서 이 기능은 **이미 설치된 그 도우미**에게 상대 경로 하나를 건넨다.
 *
 * ── 설정은 견적서 것을 쓰지 않는다 ───────────────────────────────────────
 * 견적서 환경변수를 읽지 않는다. 현황표 폴더가 도우미 루트 아래 어디인지는
 * `CUSTOMER_PORTAL_ARCHIVE_FOLDER_PATH` 로 **따로** 적는다. 비어 있으면 [폴더 열기]가
 * 그 안내만 내고 끝난다(저장 · 미리보기는 그대로 돈다).
 *
 * ── 전체 주소는 **설정이 있을 때만** 나간다 ───────────────────────────────
 * `CUSTOMER_PORTAL_ARCHIVE_UNC_PATH` 를 적어 두면 [위치 복사]로 쓸 전체 주소가 응답에
 * 붙는다(도우미 설치가 막힌 PC 를 위한 우회로 — 견적서 ④c 와 같은 갈래). 비워 두면
 * 응답에 아예 담기지 않는다.
 * ============================================================================
 */

export type CustomerPortalFolderTarget =
  | { status: "disabled" }
  | { status: "found"; link: string; relativePath: string; uncPath?: string };

/**
 * 현황표 폴더를 여는 데 필요한 것. 환경변수를 **부르는 시점에** 읽는다.
 * 경로가 도우미 규칙에 안 맞으면(절대 경로 · `..` · 금지 글자) `disabled` 다 —
 * 지어낸 주소를 내보내지 않는다.
 */
export function resolveCustomerPortalFolderTarget(): CustomerPortalFolderTarget {
  const configured = process.env.CUSTOMER_PORTAL_ARCHIVE_FOLDER_PATH;
  const relativePath = typeof configured === "string" ? configured.trim().replace(/\\/g, "/") : "";
  if (relativePath === "") return { status: "disabled" };

  const link = buildQuoteFolderLink(relativePath);
  if (link === null) return { status: "disabled" };

  const uncConfigured = process.env.CUSTOMER_PORTAL_ARCHIVE_UNC_PATH;
  const uncPath = typeof uncConfigured === "string" ? uncConfigured.trim() : "";
  return {
    status: "found",
    link,
    relativePath,
    ...(uncPath === "" ? {} : { uncPath }),
  };
}
