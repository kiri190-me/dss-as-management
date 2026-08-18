import "server-only";

import { asc, eq } from "drizzle-orm";
import { excelImportIssueDisplay, type ExcelImportIssueDisplayKind } from "@/lib/domain/excel-import-issue-messages";
import type { ExcelImportIssueDto, ExcelImportRawCellInput } from "@/lib/domain/excel-import-preview";
import type { ExcelImportPreflightReason } from "@/lib/domain/excel-import-execution";
import {
  matchesExcelImportPreviewFilter,
  parseExcelImportPreviewFilter,
  type ExcelImportPreviewClassification,
  type ExcelImportPreviewFilter,
} from "@/lib/domain/excel-import-preview-filter";
import { db } from "../client";
import { excelImportRows } from "../schema";
import { getExcelImportPreflightPlan, type ExcelImportPreflightPlan } from "./excel-import-preflight";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const COLUMN_LABELS: Readonly<Record<string, string>> = { B: "인수번호", C: "인수일", D: "고객사", E: "End-User", F: "제품 종류", G: "Model", H: "L/N", J: "S/N", L: "유·무상", S: "고장 증상", U: "현재 상태", X: "담당자" };
const PREFLIGHT_REASON_LABELS: Record<string, { title: string; reason: string; action: string }> = {
  INTAKE_NUMBER_DUPLICATE_IN_BATCH: { title: "파일 내 인수번호 중복", reason: "같은 인수번호가 이 파일에 두 번 이상 있습니다.", action: "중복 행을 확인한 뒤 하나만 이관하세요." },
  INTAKE_NUMBER_DUPLICATE_IN_DATABASE: { title: "기존 인수번호와 중복", reason: "이미 시스템에 같은 인수번호가 있습니다.", action: "기존 접수 건을 확인하세요." },
  INTAKE_RECEIVED_MONTH_MISMATCH: { title: "인수번호와 인수일 연월 다름", reason: "인수번호의 YYMM과 인수일 연월이 다릅니다. 이관은 가능합니다.", action: "원본이 맞는지 참고로 확인하세요." },
  CUSTOMER_MULTIPLE_MATCHES: { title: "고객사 후보 충돌", reason: "정규화 이름이 같은 기존 고객사가 여러 개입니다.", action: "사용할 고객사를 확정하세요." },
  END_USER_MULTIPLE_MATCHES: { title: "End-User 후보 충돌", reason: "해당 고객사 안에서 같은 이름의 End-User가 여러 개입니다.", action: "사용할 End-User를 확정하세요." },
  PRODUCT_MODEL_MULTIPLE_MATCHES: { title: "Product Model 후보 충돌", reason: "정규화 이름이 같은 기존 Model이 여러 개입니다.", action: "사용할 Model을 확정하세요." },
  PRODUCT_IDENTITY_CONFLICT: { title: "Product 식별정보 충돌", reason: "Model + L/N + S/N이 기존 Product 연결과 충돌합니다.", action: "기존 Product 정보를 확인하세요." },
  ASSIGNEE_MULTIPLE_MATCHES: { title: "담당자 후보 충돌", reason: "같은 이름으로 정확히 일치하는 담당자가 여러 명입니다.", action: "담당자를 확정하거나 미배정으로 처리하세요." },
  WORKFLOW_KIND_UNRESOLVED: { title: "워크플로 종류 확인 필요", reason: "F열 제품 종류를 기존 접수 종류 하나로 결정할 수 없습니다.", action: "매쳐 또는 제너레이터를 확인하세요." },
  WORKFLOW_NOT_AVAILABLE: { title: "사용 가능한 워크플로 없음", reason: "판정된 종류의 현재 접수 워크플로를 사용할 수 없습니다.", action: "현재 게시된 워크플로를 확인하세요." },
  POST_IMPORT_STATUS_REVIEW_REQUIRED: { title: "접수 후 상태 확인 필요", reason: "과거 상태 원문이 서로 충돌합니다. 기본 접수는 최초 단계로 생성됩니다.", action: "접수 후 별도 상태 반영 단계에서 확인하세요." },
  PENDING_COMPLETED_REQUIRES_BILLING: { title: "완료 건 유·무상 결정 필요", reason: "완료 상태인 과거 건은 추후결정 워크플로의 완료 단계로 우회할 수 없습니다.", action: "Import 전에 유상·일부유상·무상 중 하나로 확정하세요." },
  LEGACY_STATUS_NOT_APPLIED: { title: "과거 상태 자동 적용 안 됨", reason: "판정된 현재 상태와 정확히 일치하는 단계가 대상 워크플로에 없습니다.", action: "최초 접수 단계로 이관되며 U열 문구는 비고에 보존됩니다." },
};
const REQUIRED_FIELD_LABELS: Record<string, string> = { intakeNumber: "인수번호", receivedAt: "인수일", customer: "고객사", workflowKind: "제품 종류", modelName: "Model", lotNumber: "L/N", serialNumber: "S/N", billingType: "유·무상" };

export type ExcelImportIssueSourceView = { column: string; label: string; cellAddress: string; value: string | null };
export type ExcelImportReviewItemView = { kind: ExcelImportIssueDisplayKind | "EXCLUSION" | "CONFLICT"; title: string; reason: string; action: string; code: string; sources: ExcelImportIssueSourceView[] };
export type ExcelImportPreviewRowView = { sourceRowNumber: number; classification: ExcelImportPreviewClassification; candidate: ExcelImportPreflightPlan["rows"][number]["candidate"]; hasReportedSymptom: boolean; rawValues: Record<string, string | null>; reviewItems: ExcelImportReviewItemView[]; plan: ExcelImportPreflightPlan["rows"][number]["plan"]; legacyState: ExcelImportPreflightPlan["rows"][number]["legacyState"] };
export type ExcelImportPreviewPage = { batch: ExcelImportPreflightPlan["batch"] & { counts: ExcelImportPreflightPlan["counts"]; entities: ExcelImportPreflightPlan["entities"] }; filter: ExcelImportPreviewFilter; rows: ExcelImportPreviewRowView[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
export type GetExcelImportPreviewResult = { ok: true; value: ExcelImportPreviewPage } | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_PAGE" | "DATABASE_UNAVAILABLE" };

function rawColumns(value: unknown): Record<string, ExcelImportRawCellInput> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return ["repair-case-list-raw-row-v1", "repair-case-list-raw-row-v2", "repair-case-list-raw-row-v3"].includes(row.schemaVersion as string)
    && row.columns
    && typeof row.columns === "object"
    ? row.columns as Record<string, ExcelImportRawCellInput>
    : null;
}
function issues(value: unknown): ExcelImportIssueDto[] { return Array.isArray(value) ? value.filter((item): item is ExcelImportIssueDto => !!item && typeof item === "object" && typeof (item as ExcelImportIssueDto).code === "string") : []; }
function issueSources(issue: ExcelImportIssueDto, raw: Record<string, ExcelImportRawCellInput>): ExcelImportIssueSourceView[] {
  if (!issue.cellAddress) return [];
  return issue.cellAddress.split(":").flatMap((cellAddress) => { const column = cellAddress.replace(/\d+$/, ""); return column === "I" || !raw[column] ? [] : [{ column, label: COLUMN_LABELS[column] ?? column, cellAddress, value: raw[column].value }]; });
}
function preflightItem(reason: ExcelImportPreflightReason): ExcelImportReviewItemView {
  if (reason.code.startsWith("REQUIRED_") && reason.field) { const label = REQUIRED_FIELD_LABELS[reason.field] ?? reason.field; return { kind: reason.kind === "EXCLUSION" ? "EXCLUSION" : "CONFLICT", title: `${label} 없음`, reason: `${label}이 없어 자동으로 제외됩니다.`, action: "원본을 보완한 뒤 다시 분석하면 이관할 수 있습니다.", code: reason.code, sources: [] }; }
  const display = PREFLIGHT_REASON_LABELS[reason.code] ?? { title: "확인 필요", reason: "자동 접수 조건을 확인할 수 없습니다.", action: "원본과 기존 데이터를 확인하세요." };
  return { kind: reason.kind === "EXCLUSION" ? "EXCLUSION" : reason.kind === "CONFLICT" ? "CONFLICT" : "NOTICE", ...display, code: reason.code, sources: [] };
}

export async function getExcelImportPreviewPage(input: { batchId: string; actorUserId: string; page?: number; pageSize?: number; filter?: string }): Promise<GetExcelImportPreviewResult> {
  const page = input.page ?? 1; const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const filter = parseExcelImportPreviewFilter(input.filter);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) return { ok: false, code: "INVALID_PAGE" };
  const preflight = await getExcelImportPreflightPlan({ batchId: input.batchId, actorUserId: input.actorUserId });
  if (!preflight.ok) return { ok: false, code: preflight.code === "INVALID_DATA" ? "DATABASE_UNAVAILABLE" : preflight.code };
  try {
    const stored = await db.select({ sourceRowNumber: excelImportRows.sourceRowNumber, rawData: excelImportRows.rawData, issues: excelImportRows.issues }).from(excelImportRows).where(eq(excelImportRows.batchId, input.batchId)).orderBy(asc(excelImportRows.sourceRowNumber));
    const storedByRow = new Map(stored.map((row) => [row.sourceRowNumber, row]));
    const allRows = preflight.value.rows.map((row): ExcelImportPreviewRowView => {
      const source = storedByRow.get(row.sourceRowNumber); const raw = rawColumns(source?.rawData) ?? {};
      const parserItems = issues(source?.issues).filter((issue) => !issue.code.endsWith("_MAPPING_PENDING") && !issue.code.endsWith("_AUTO_MATCHED") && issue.code !== "ASSIGNEE_MAPPING_PENDING" && issue.code !== "STATUS_MAPPING_PENDING").map((issue) => ({ ...excelImportIssueDisplay(issue.code), code: issue.code, sources: issueSources(issue, raw) }));
      const deduped = [...parserItems, ...row.reasons.map(preflightItem)].filter((item, index, values) => values.findIndex((candidate) => candidate.code === item.code) === index);
      return { sourceRowNumber: row.sourceRowNumber, classification: row.disposition, candidate: row.candidate, hasReportedSymptom: !!raw.S?.value?.trim(), rawValues: Object.fromEntries(Object.entries(raw).map(([column, cell]) => [column, cell.value])), reviewItems: deduped, plan: row.plan, legacyState: row.legacyState };
    });
    const filteredRows = allRows.filter((row) => matchesExcelImportPreviewFilter(row.classification, filter));
    const totalItems = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (page > totalPages) return { ok: false, code: "INVALID_PAGE" };
    return { ok: true, value: { batch: { ...preflight.value.batch, counts: preflight.value.counts, entities: preflight.value.entities }, filter, rows: filteredRows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, totalItems, totalPages } } };
  } catch { return { ok: false, code: "DATABASE_UNAVAILABLE" }; }
}
