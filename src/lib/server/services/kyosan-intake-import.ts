import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { actorMay } from "@/lib/auth/developer-promotion";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { canEditProductModels } from "@/lib/auth/product-model-authorization";
import type { LegacyImportMetadata } from "@/lib/db/mutations/repair-cases";
import {
  KYOSAN_INTAKE_LIST_SOURCE,
  findSucceededKyosanImports,
  loadExistingCasesByIntakeNumber,
  loadImportLookups,
  loadKyosanMasterLookups,
  type KyosanExistingCase,
  type KyosanImportLookups,
} from "@/lib/db/queries/kyosan-intake-import";
import { columnCaption, type KyosanColumnField } from "@/lib/domain/kyosan-intake-import/columns";
import { nfkcNameKey, suggestSimilarNames } from "@/lib/domain/kyosan-intake-import/name-suggestions";
import { parseKyosanIntakeWorkbook } from "@/lib/domain/kyosan-intake-import/parse";
import { translateReportedSymptom } from "@/lib/domain/kyosan-intake-import/symptom-translation";
import type {
  KyosanBillingAdjustment,
  KyosanClassifiedRow,
  KyosanHeaderMismatch,
  KyosanImportableOutcome,
  KyosanParseFailureCode,
  KyosanParseResult,
  KyosanRawRow,
} from "@/lib/domain/kyosan-intake-import/types";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { workflowTypeLabels, type NewIntakeWorkflowType } from "@/lib/domain/types";
import { workflowKindLabels, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type { CreateRepairCaseResult } from "@/lib/validation/repair-case-input";
import type { RepairCaseXlsxSafetyCode } from "@/lib/xlsx/xlsx-upload-safety";
import { createRepairCaseWithIdempotency, type RepairCaseCreator } from "./create-repair-case";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 미리보기와 조각 실행 (S2, 2026-09-15)
 * ============================================================================
 * 교산 인수품 리스트(xlsx)로 과거 수리 건을 한꺼번에 만든다. **새 표가 없고 상태를 두지
 * 않는다** — 미리보기가 무엇을 보여 줬든, 실행은 매번 올린 파일을 **다시 읽고 다시 대조한다.**
 *
 *  1. buildKyosanImportPreview — 파일을 읽어(S1 의 parseKyosanIntakeWorkbook) DB 와 맞춰 본다.
 *     **DB 에 쓰지 않는다.** 줄마다 최종 분류(IMPORTABLE · ALREADY_EXISTS ·
 *     ALREADY_EXISTS_TRASHED · EXCLUDED · NEEDS_REVIEW)와, 새로 생길 이름, 새 batchId 를 준다.
 *  2. executeKyosanImportChunk — 같은 파일 · batchId · fileSha256 과 행 번호(최대 50개,
 *     화면은 25개씩)를 받아 줄마다 **차례로** createRepairCaseWithIdempotency(EXCEL_IMPORT)를
 *     부른다. 파일 sha 가 다르면 거절한다.
 *
 * ── 멱등 ─────────────────────────────────────────────────────────────────
 * 줄마다 멱등 키 = sha256(`kyosan:${batchId}:${fileSha256}:${row}:${intakeNumber}`) 를 UUID
 * 모양으로. 같은 조각을 다시 실행하면(네트워크가 끊겨 화면이 결과를 못 받았을 때 등) 같은 건이
 * 돌아온다 — 새로 만들지 않는다.
 *
 * ── 절대 덮어쓰지 않는다 ─────────────────────────────────────────────────
 * 같은 인수번호가 이미 있으면(휴지통 포함) 그 줄은 가져오지 않는다. 실행 중에 누가 먼저
 * 만들어 INTAKE_NUMBER_DUPLICATE 가 나도 「이미 있음」으로 돌려준다.
 *
 * ── 이름 맞추기 ──────────────────────────────────────────────────────────
 * 기존 resolveOrCreate*ByName 은 NFKC 를 하지 않아 전각으로 적힌 고객사가 새 고객사가 된다.
 * 그래서 여기서 nfkcNameKey 로 기존 고객사 · (그 고객사의) End-User · 모델과 맞춰 **기존 id** 를
 * 넘기고, 진짜 새 이름만 new*Name 으로 넘긴다. 키가 같은 기존 행이 둘 이상이면 고를 수 없으니
 * 확인 필요다. 실행 중 새 이름을 만들면 목록을 다시 읽는다 — 파일의 다음 줄이 같은 이름을
 * (전각으로) 적어 두었어도 방금 만든 것에 붙는다.
 *
 * ── 권한 ─────────────────────────────────────────────────────────────────
 * 영역 `kyosanIntakeImport` 의 관리(MANAGE). 서버 액션이 보고, 여기서 한 번 더 본다.
 * 새 모델을 만드는 줄은 A/S 접수와 같이 canEditProductModels 도 필요하다 — 없으면 미리보기가
 * 그 줄을 확인 필요로 알린다(실행 때 거절되기 전에).
 * ============================================================================
 */

export const KYOSAN_IMPORT_PERMISSION_AREA = "kyosanIntakeImport";
/** 화면이 한 번에 보내는 줄 수. */
export const KYOSAN_IMPORT_CHUNK_SIZE = 25;
/** 한 번에 받는 줄 수의 상한 — 넘으면 거절한다. */
export const KYOSAN_IMPORT_MAX_ROWS_PER_CHUNK = 50;

/** 이력 metadata · 메모에 싣는 원문 글자의 한도. */
const SOURCE_TEXT_MAX = 50;
/** validateCreateRepairCaseInput 과 같은 한도(짧은 글 200 · 긴 글 4000). */
const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 4000;
const IMPORT_NOTE_PREFIX = "[과거 인수품 가져오기]";
/** create-repair-case.ts 의 validLegacyImportState 가 받는 batchId 모양과 같다. */
const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** 사유 문구에 늘어놓는 이름은 이만큼까지. */
const MAX_LISTED_NAMES = 5;

// ── 모양 ──────────────────────────────────────────────────────────────────

export type KyosanImportActor = RepairCaseCreator;

export type KyosanPreviewStatus =
  | "IMPORTABLE"
  | "ALREADY_EXISTS"
  | "ALREADY_EXISTS_TRASHED"
  | "EXCLUDED"
  | "NEEDS_REVIEW";

export const KYOSAN_PREVIEW_STATUSES: readonly KyosanPreviewStatus[] = [
  "IMPORTABLE",
  "ALREADY_EXISTS",
  "ALREADY_EXISTS_TRASHED",
  "EXCLUDED",
  "NEEDS_REVIEW",
];

/** 기존 행에 붙는가(id), 새로 만드는가(이름). */
export type KyosanNameResolution = { kind: "EXISTING"; id: string; name: string } | { kind: "NEW"; name: string };

/** 가져올 줄이 무엇이 되는가. */
export type KyosanRowPlan = {
  workflowKind: WorkflowKind;
  billingType: KyosanImportableOutcome["billingType"];
  workflowType: NewIntakeWorkflowType;
  targetStepKey: string;
  actualShipmentDate: string | null;
  billingReview: boolean;
  billingAdjustment: KyosanBillingAdjustment | null;
  sourceBilling: string | null;
  /**
   * 신고증상 — **일본어 낱말을 한글로 바꾼 뒤**의 글자(symptom-translation.ts). 원문은
   * `raw.reportedSymptom` 에 그대로 있고, 가져오기 흔적 metadata 의 `sourceReportedSymptom`
   * 으로도 남는다. 미리보기와 실행이 **이 한 값**을 함께 보게 하려고 계획에 담는다 —
   * 두 길에서 따로 번역하면 한쪽만 고쳐지는 날이 온다.
   */
  reportedSymptom: string | null;
  customer: KyosanNameResolution;
  /** END-USER 칸이 비었으면 null. */
  endUser: KyosanNameResolution | null;
  productModel: KyosanNameResolution;
};

export type KyosanExistingCaseView = {
  repairCaseId: string;
  intakeNumber: string;
  trashed: boolean;
  customerName: string | null;
  modelName: string | null;
  serialNumber: string | null;
  /** 고객사 · 모델 · S/N 가운데 하나라도 파일과 다르다 — 화면이 「다른 건으로 보임」을 칠한다. */
  looksDifferent: boolean;
};

export type KyosanPreviewRow = {
  rowNumber: number;
  raw: KyosanRawRow;
  status: KyosanPreviewStatus;
  /** 확인 필요 · 제외 · 이미 있음의 사유. 가져올 줄이면 빈 배열. */
  reasons: string[];
  /** 가져오긴 하지만 사람이 한 번 볼 만한 것. */
  warnings: string[];
  /** IMPORTABLE 일 때만. */
  plan: KyosanRowPlan | null;
  /** ALREADY_EXISTS(_TRASHED) 일 때만. */
  existing: KyosanExistingCaseView | null;
};

export type KyosanNameSuggestion = { id: string; name: string };

export type KyosanNewNames = {
  customers: { name: string; rowNumbers: number[]; suggestions: KyosanNameSuggestion[] }[];
  endUsers: {
    /** 붙을 고객사 — 기존이면 그 이름, 새 고객사면 파일의 이름. */
    customerName: string;
    /** 기존 고객사면 id, 새 고객사면 null. */
    customerId: string | null;
    name: string;
    rowNumbers: number[];
    suggestions: KyosanNameSuggestion[];
  }[];
  productModels: { name: string; kind: WorkflowKind; rowNumbers: number[]; suggestions: KyosanNameSuggestion[] }[];
};

export type KyosanPreviewCounts = Record<KyosanPreviewStatus, number> & { total: number };

export type KyosanImportFailureCode =
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "INVALID_FILE"
  | "FILE_CHANGED"
  | "TOO_MANY_ROWS";

export type KyosanImportFailure = {
  ok: false;
  code: KyosanImportFailureCode;
  message: string;
  /** INVALID_FILE 일 때 읽개가 준 까닭. */
  parseFailureCode?: KyosanParseFailureCode;
  mismatches?: KyosanHeaderMismatch[];
  safetyCodes?: RepairCaseXlsxSafetyCode[];
};

export type KyosanPreviewResult =
  | {
      ok: true;
      batchId: string;
      fileName: string;
      fileSha256: string;
      headerRow: number;
      chunkSize: number;
      rows: KyosanPreviewRow[];
      counts: KyosanPreviewCounts;
      newNames: KyosanNewNames;
    }
  | KyosanImportFailure;

export type KyosanChunkRowOutcome = "CREATED" | "ALREADY_EXISTS" | "SKIPPED" | "FAILED";

export type KyosanChunkRowResult = {
  rowNumber: number;
  outcome: KyosanChunkRowOutcome;
  repairCaseId?: string;
  intakeNumber: string | null;
  message?: string;
};

export type KyosanChunkResult = { ok: true; batchId: string; results: KyosanChunkRowResult[] } | KyosanImportFailure;

// ── 순수 도움 함수 (시험이 직접 부른다) ────────────────────────────────────

/**
 * 줄마다의 멱등 키 — 같은 입력이면 늘 같다. UUID v4 모양(버전 · 변형 비트)으로 적는다
 * (isValidIdempotencyKey 가 UUID 모양만 받는다).
 */
export function kyosanIdempotencyKey(
  batchId: string,
  fileSha256: string,
  rowNumber: number,
  intakeNumber: string
): string {
  const hex = createHash("sha256")
    .update(`kyosan:${batchId}:${fileSha256}:${rowNumber}:${intakeNumber}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}

/**
 * 같은 인수번호의 기존 건이 파일의 줄과 **다른 물건으로 보이는가** — 고객사 키 · 모델 키 · S/N
 * 가운데 하나라도 다르면 true. 번호가 같은데 물건이 다르면 번호를 잘못 적었을 가능성이 높다.
 */
export function looksLikeDifferentCase(
  fileRow: Pick<KyosanRawRow, "customerName" | "modelName" | "serialNumber">,
  existing: Pick<KyosanExistingCase, "customerName" | "modelName" | "serialNumber">
): boolean {
  return (
    nfkcNameKey(fileRow.customerName ?? "") !== nfkcNameKey(existing.customerName ?? "") ||
    nfkcNameKey(fileRow.modelName ?? "") !== nfkcNameKey(existing.modelName ?? "") ||
    identifierKey(fileRow.serialNumber) !== identifierKey(existing.serialNumber)
  );
}

function identifierKey(value: string | null): string {
  return (value ?? "").normalize("NFKC").trim();
}

/** 원문 글자를 50자(UTF-16 단위) 이하로 — 글자 한가운데서 자르지 않는다. */
export function truncateSourceText(value: string | null): string | null {
  if (value === null) return null;
  let result = "";
  for (const char of value) {
    if (result.length + char.length > SOURCE_TEXT_MAX) break;
    result += char;
  }
  return result;
}

/** 수리 건 메모에 남기는 줄. 사람이 읽는 표시이고, 기계용 표시는 이력 metadata 다. */
export function kyosanImportNotes(plan: Pick<KyosanRowPlan, "billingReview" | "billingAdjustment" | "sourceBilling">): string | null {
  const lines: string[] = [];
  if (plan.billingReview) {
    const source = plan.sourceBilling === null ? "비어 있음" : truncateSourceText(plan.sourceBilling);
    lines.push(`${IMPORT_NOTE_PREFIX} 유/무상 확인 필요 (원본 費用: ${source})`);
  }
  if (plan.billingAdjustment === "WARRANTY_PO_TO_PARTIAL_PAID") {
    lines.push(`${IMPORT_NOTE_PREFIX} 원본 費用 無償 · 状態 中断：客先待ち → 일부 유상으로 가져옴`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

// ── DB 대조 (순수 — 조회 결과를 받는다) ─────────────────────────────────────

type MasterIndex = {
  customersByKey: Map<string, { id: string; name: string }[]>;
  endUsersByCustomer: Map<string, Map<string, { id: string; name: string }[]>>;
  modelsByKey: Map<string, { id: string; name: string; kind: WorkflowKind | null }[]>;
};

function groupByKey<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}

function indexMasters(lookups: KyosanImportLookups): MasterIndex {
  const endUsersByCustomer = new Map<string, Map<string, { id: string; name: string }[]>>();
  for (const [customerId, rows] of groupByKey(lookups.endUsers, (row) => row.customerId)) {
    endUsersByCustomer.set(customerId, groupByKey(rows, (row) => nfkcNameKey(row.name)));
  }
  return {
    customersByKey: groupByKey(lookups.customers, (row) => nfkcNameKey(row.name)),
    endUsersByCustomer,
    modelsByKey: groupByKey(lookups.productModels, (row) => nfkcNameKey(row.name)),
  };
}

function listNames(rows: readonly { name: string }[]): string {
  const shown = rows.slice(0, MAX_LISTED_NAMES).map((row) => `"${row.name}"`).join(" · ");
  const rest = rows.length - MAX_LISTED_NAMES;
  return rest > 0 ? `${shown} 외 ${rest}개` : shown;
}

function resolveCustomer(name: string, index: MasterIndex, reasons: string[]): KyosanNameResolution | null {
  const matches = index.customersByKey.get(nfkcNameKey(name)) ?? [];
  if (matches.length === 1) return { kind: "EXISTING", id: matches[0].id, name: matches[0].name };
  if (matches.length > 1) {
    reasons.push(
      `${columnCaption("customerName")} "${name}" 과(와) 같은 이름으로 볼 수 있는 고객사가 여럿 있습니다(${listNames(matches)}) — 고객사 관리에서 하나로 정리해 주세요.`
    );
    return null;
  }
  return { kind: "NEW", name };
}

function resolveEndUser(
  name: string,
  customer: KyosanNameResolution | null,
  index: MasterIndex,
  reasons: string[]
): KyosanNameResolution | null {
  // 새 고객사의 End-User 는 당연히 새것이다. 고객사를 못 정했으면 이 줄은 어차피 확인 필요다.
  if (customer === null || customer.kind === "NEW") return { kind: "NEW", name };
  const matches = index.endUsersByCustomer.get(customer.id)?.get(nfkcNameKey(name)) ?? [];
  if (matches.length === 1) return { kind: "EXISTING", id: matches[0].id, name: matches[0].name };
  if (matches.length > 1) {
    reasons.push(
      `${columnCaption("endUserName")} "${name}" 과(와) 같은 이름으로 볼 수 있는 End-User 가 고객사 "${customer.name}" 에 여럿 있습니다(${listNames(matches)}) — 고객사 관리에서 하나로 정리해 주세요.`
    );
    return null;
  }
  return { kind: "NEW", name };
}

function resolveProductModel(
  name: string,
  kind: WorkflowKind,
  index: MasterIndex,
  options: { canCreateProductModels: boolean },
  reasons: string[],
  warnings: string[]
): KyosanNameResolution | null {
  const matches = index.modelsByKey.get(nfkcNameKey(name)) ?? [];
  if (matches.length > 1) {
    reasons.push(
      `${columnCaption("modelName")} "${name}" 과(와) 같은 이름으로 볼 수 있는 모델이 여럿 있습니다(${listNames(matches)}) — 제품 모델 관리에서 하나로 정리해 주세요.`
    );
    return null;
  }
  if (matches.length === 1) {
    const model = matches[0];
    if (model.kind !== null && model.kind !== kind) {
      warnings.push(
        `모델 "${model.name}" 은(는) 이미 ${workflowKindLabels[model.kind]}(으)로 등록돼 있는데 파일의 종류는 ${workflowKindLabels[kind]} 입니다 — 모델의 종류는 바꾸지 않습니다.`
      );
    }
    return { kind: "EXISTING", id: model.id, name: model.name };
  }
  if (!options.canCreateProductModels) {
    reasons.push(
      `${columnCaption("modelName")} "${name}" 은(는) 등록되지 않은 모델인데, 새 모델을 만들 권한이 없습니다 — 제품 모델 관리에서 먼저 등록해 주세요.`
    );
    return null;
  }
  return { kind: "NEW", name };
}

const SHORT_TEXT_FIELDS: readonly KyosanColumnField[] = [
  "modelName",
  "customerName",
  "endUserName",
  "lotNumber",
  "serialNumber",
  "reportNumber",
];

/**
 * 접수 검증(validateCreateRepairCaseInput)에 걸릴 길이를 미리 알린다 — 실행 때 실패하기 전에.
 *
 * 신고증상은 **번역한 뒤의 글자**로 잰다. 번역은 낱말 사이에 공백을 넣기도 해서 원문보다
 * 길어질 수 있는데, 저장되는 것은 번역한 쪽이다 — 원문 길이로 재면 미리보기는 통과시켜
 * 놓고 실행이 검증에서 떨어지는 날이 온다.
 */
function lengthReasons(raw: KyosanRawRow, reportedSymptom: string | null): string[] {
  const reasons: string[] = [];
  for (const field of SHORT_TEXT_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.length > MAX_SHORT_TEXT) {
      reasons.push(`${columnCaption(field)}이 너무 깁니다 — ${MAX_SHORT_TEXT}자까지 가져올 수 있습니다.`);
    }
  }
  if (reportedSymptom !== null && reportedSymptom.length > MAX_LONG_TEXT) {
    reasons.push(`${columnCaption("reportedSymptom")}이 너무 깁니다 — ${MAX_LONG_TEXT}자까지 가져올 수 있습니다.`);
  }
  return reasons;
}

function classifyRow(
  row: KyosanClassifiedRow,
  lookups: KyosanImportLookups,
  index: MasterIndex,
  options: { canCreateProductModels: boolean }
): KyosanPreviewRow {
  const base = { rowNumber: row.raw.rowNumber, raw: row.raw, plan: null, existing: null };

  // 제외가 이긴다(S1 과 같은 원칙) — 어차피 안 가져올 줄이다.
  if (row.outcome === "EXCLUDED") {
    return { ...base, status: "EXCLUDED", reasons: [row.reason], warnings: [] };
  }

  // 이미 있는 번호 — 휴지통 포함. 절대 덮어쓰지 않는다.
  const intakeNumber = row.raw.intakeNumber;
  const existing = intakeNumber === null ? undefined : lookups.existingCases.get(intakeNumber);
  if (existing) {
    return {
      ...base,
      status: existing.isDeleted ? "ALREADY_EXISTS_TRASHED" : "ALREADY_EXISTS",
      reasons: [
        existing.isDeleted
          ? `인수번호 ${existing.intakeNumber} 인 건이 휴지통에 있습니다 — 휴지통의 건도 번호를 차지하므로 가져오지 않습니다(덮어쓰지 않습니다).`
          : `인수번호 ${existing.intakeNumber} 인 건이 이미 있습니다 — 가져오지 않습니다(덮어쓰지 않습니다).`,
      ],
      warnings: [],
      existing: {
        repairCaseId: existing.repairCaseId,
        intakeNumber: existing.intakeNumber,
        trashed: existing.isDeleted,
        customerName: existing.customerName,
        modelName: existing.modelName,
        serialNumber: existing.serialNumber,
        looksDifferent: looksLikeDifferentCase(row.raw, existing),
      },
    };
  }

  if (row.outcome === "NEEDS_REVIEW") {
    return { ...base, status: "NEEDS_REVIEW", reasons: [...row.reasons], warnings: [] };
  }

  // S1 이 가져올 수 있다고 본 줄 — 이제 DB 와 맞춘다.
  const raw = row.raw;
  const reasons: string[] = [];
  const warnings = [...row.warnings];

  if (!lookups.stepKeysByWorkflowType.get(row.workflowType)?.has(row.targetStepKey)) {
    reasons.push(
      `현재 절차(${workflowTypeLabels[row.workflowType]})에 ${row.targetStepKey} 단계가 없습니다 — 워크플로 관리에서 발행된 절차를 확인해 주세요.`
    );
  }
  // 🔴 일본어 낱말을 한글로 바꾸는 자리는 여기 **한 곳뿐이다** — 미리보기와 실행이 같은
  // 계획(plan.reportedSymptom)을 쓴다. 원문은 raw 에 그대로 남는다.
  const reportedSymptom = translateReportedSymptom(raw.reportedSymptom);
  reasons.push(...lengthReasons(raw, reportedSymptom));

  const customer = resolveCustomer(raw.customerName ?? "", index, reasons);
  const endUser = raw.endUserName === null ? null : resolveEndUser(raw.endUserName, customer, index, reasons);
  const productModel = resolveProductModel(raw.modelName ?? "", row.workflowKind, index, options, reasons, warnings);

  if (reasons.length > 0 || customer === null || productModel === null || (raw.endUserName !== null && endUser === null)) {
    return { ...base, status: "NEEDS_REVIEW", reasons, warnings };
  }

  return {
    ...base,
    status: "IMPORTABLE",
    reasons: [],
    warnings,
    plan: {
      workflowKind: row.workflowKind,
      billingType: row.billingType,
      workflowType: row.workflowType,
      targetStepKey: row.targetStepKey,
      actualShipmentDate: row.actualShipmentDate,
      billingReview: row.billingReview,
      billingAdjustment: row.billingAdjustment,
      sourceBilling: row.sourceBilling,
      reportedSymptom,
      customer,
      endUser,
      productModel,
    },
  };
}

/**
 * S1 의 판정에 DB 대조를 더해 줄마다 최종 분류를 낸다. 조회 결과를 인자로 받는 순수 함수라
 * 시험이 조회 결과를 바꿔 넣어 볼 수 있다(예: 현재 판에서 단계 하나를 뺀 경우).
 */
export function classifyKyosanRowsForImport(
  rows: readonly KyosanClassifiedRow[],
  lookups: KyosanImportLookups,
  options: { canCreateProductModels: boolean }
): KyosanPreviewRow[] {
  const index = indexMasters(lookups);
  return rows.map((row) => classifyRow(row, lookups, index, options));
}

function suggestionsFor(name: string, candidates: readonly { id: string; name: string }[]): KyosanNameSuggestion[] {
  return suggestSimilarNames(name, candidates).map((candidate) => ({ id: candidate.id, name: candidate.name }));
}

/** 가져올 줄들이 새로 만들 이름 — 같은 키끼리 묶는다(전각/반각 · 대소문자 · 공백 차이는 한 이름). */
function collectNewNames(rows: readonly KyosanPreviewRow[], lookups: KyosanImportLookups): KyosanNewNames {
  const customerEntries = new Map<string, KyosanNewNames["customers"][number]>();
  const endUserEntries = new Map<string, KyosanNewNames["endUsers"][number]>();
  const modelEntries = new Map<string, KyosanNewNames["productModels"][number]>();
  const modelCandidates = lookups.productModels.map((model) => ({ id: model.id, name: model.name }));

  for (const row of rows) {
    if (row.status !== "IMPORTABLE" || row.plan === null) continue;
    const { customer, endUser, productModel } = row.plan;

    if (customer.kind === "NEW") {
      const key = nfkcNameKey(customer.name);
      const entry = customerEntries.get(key) ?? {
        name: customer.name,
        rowNumbers: [],
        suggestions: suggestionsFor(customer.name, lookups.customers),
      };
      entry.rowNumbers.push(row.rowNumber);
      customerEntries.set(key, entry);
    }

    if (endUser?.kind === "NEW") {
      const customerKey = customer.kind === "EXISTING" ? `id:${customer.id}` : `new:${nfkcNameKey(customer.name)}`;
      const key = `${customerKey}|${nfkcNameKey(endUser.name)}`;
      const candidates =
        customer.kind === "EXISTING" ? lookups.endUsers.filter((row2) => row2.customerId === customer.id) : [];
      const entry = endUserEntries.get(key) ?? {
        customerName: customer.name,
        customerId: customer.kind === "EXISTING" ? customer.id : null,
        name: endUser.name,
        rowNumbers: [],
        suggestions: suggestionsFor(endUser.name, candidates),
      };
      entry.rowNumbers.push(row.rowNumber);
      endUserEntries.set(key, entry);
    }

    if (productModel.kind === "NEW") {
      const key = nfkcNameKey(productModel.name);
      const entry = modelEntries.get(key) ?? {
        name: productModel.name,
        kind: row.plan.workflowKind,
        rowNumbers: [],
        suggestions: suggestionsFor(productModel.name, modelCandidates),
      };
      entry.rowNumbers.push(row.rowNumber);
      modelEntries.set(key, entry);
    }
  }

  return {
    customers: [...customerEntries.values()],
    endUsers: [...endUserEntries.values()],
    productModels: [...modelEntries.values()],
  };
}

function countStatuses(rows: readonly KyosanPreviewRow[]): KyosanPreviewCounts {
  const counts = { total: rows.length } as KyosanPreviewCounts;
  for (const status of KYOSAN_PREVIEW_STATUSES) counts[status] = 0;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

// ── 권한 · 입력 ────────────────────────────────────────────────────────────

function forbidden(): KyosanImportFailure {
  return { ok: false, code: "FORBIDDEN", message: "과거 인수품을 가져올 권한이 없습니다." };
}

function invalid(message: string): KyosanImportFailure {
  return { ok: false, code: "VALIDATION_ERROR", message };
}

async function authorize(actor: KyosanImportActor): Promise<KyosanImportFailure | null> {
  if (actor.approvalStatus !== "APPROVED") return forbidden();
  const allowed = await hasPermission(
    { role: actor.role, isDeveloper: actor.isDeveloper },
    KYOSAN_IMPORT_PERMISSION_AREA,
    "MANAGE"
  );
  return allowed ? null : forbidden();
}

function mayCreateProductModels(actor: KyosanImportActor): boolean {
  return actorMay({ role: actor.role, isDeveloper: actor.isDeveloper }, canEditProductModels);
}

function parseFailure(parsed: Extract<KyosanParseResult, { ok: false }>): KyosanImportFailure {
  return {
    ok: false,
    code: "INVALID_FILE",
    message: parsed.message,
    parseFailureCode: parsed.code,
    ...(parsed.mismatches ? { mismatches: parsed.mismatches } : {}),
    ...(parsed.safetyCodes ? { safetyCodes: parsed.safetyCodes } : {}),
  };
}

function intakeNumbersOf(rows: readonly KyosanClassifiedRow[]): string[] {
  return rows.map((row) => row.raw.intakeNumber).filter((value): value is string => value !== null);
}

// ── 미리보기 ──────────────────────────────────────────────────────────────

/**
 * 미리보기 — **DB 에 쓰지 않는다.** 읽기 대조만 하고 새 batchId 를 준다. 화면은 이 batchId ·
 * fileSha256 과 같은 파일로 executeKyosanImportChunk 를 25줄씩 부른다.
 */
export async function buildKyosanImportPreview(input: {
  bytes: Buffer;
  fileName: string;
  actor: KyosanImportActor;
  today: string;
}): Promise<KyosanPreviewResult> {
  const denied = await authorize(input.actor);
  if (denied) return denied;

  const parsed = parseKyosanIntakeWorkbook(input.bytes, input.fileName, { today: input.today });
  if (!parsed.ok) return parseFailure(parsed);

  const lookups = await loadImportLookups(intakeNumbersOf(parsed.rows));
  const rows = classifyKyosanRowsForImport(parsed.rows, lookups, {
    canCreateProductModels: mayCreateProductModels(input.actor),
  });

  return {
    ok: true,
    batchId: randomUUID(),
    fileName: input.fileName,
    fileSha256: parsed.fileSha256,
    headerRow: parsed.headerRow,
    chunkSize: KYOSAN_IMPORT_CHUNK_SIZE,
    rows,
    counts: countStatuses(rows),
    newNames: collectNewNames(rows, lookups),
  };
}

// ── 조각 실행 ─────────────────────────────────────────────────────────────

function buildIntakeInput(raw: KyosanRawRow, plan: KyosanRowPlan): IntakeSubmissionInput {
  return {
    workflowType: plan.workflowType,
    billingType: plan.billingType,
    customerId: plan.customer.kind === "EXISTING" ? plan.customer.id : null,
    newCustomerName: plan.customer.kind === "NEW" ? plan.customer.name : null,
    endUserId: plan.endUser?.kind === "EXISTING" ? plan.endUser.id : null,
    newEndUserName: plan.endUser?.kind === "NEW" ? plan.endUser.name : null,
    productModelId: plan.productModel.kind === "EXISTING" ? plan.productModel.id : null,
    newProductModelName: plan.productModel.kind === "NEW" ? plan.productModel.name : null,
    modelName: raw.modelName ?? "",
    assignedEngineerId: null,
    // 타입상 필수지만 저장되지 않는다.
    priority: "NORMAL",
    receivedAt: raw.receivedAt ?? "",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    internalTargetInspectionCompletionDate: null,
    intakeNumber: raw.intakeNumber,
    legacyReportNumber: raw.reportNumber,
    lotNumber: raw.lotNumber ?? "",
    serialNumber: raw.serialNumber ?? "",
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    // 번역한 글자(classifyRow 가 한 번 만든 것). 원문은 metadata 의 sourceReportedSymptom.
    reportedSymptom: plan.reportedSymptom,
    notes: kyosanImportNotes(plan),
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

function buildLegacyImportState(
  batchId: string,
  fileSha256: string,
  raw: KyosanRawRow,
  plan: KyosanRowPlan
) {
  // 🔴 개인정보(고객 이름 등)는 넣지 않는다. 원문 글자는 50자까지.
  const metadata: LegacyImportMetadata = {
    source: KYOSAN_INTAKE_LIST_SOURCE,
    fileSha256,
    billingReview: plan.billingReview,
    billingAdjustment: plan.billingAdjustment,
    sourceStatus: truncateSourceText(raw.statusText),
    sourceBilling: truncateSourceText(plan.sourceBilling),
    // 신고증상은 일본어 낱말을 한글로 바꿔 넣는다 — 바꾸기 전 원문을 여기 남긴다(50자까지).
    sourceReportedSymptom: truncateSourceText(raw.reportedSymptom),
  };
  return {
    targetStepKey: plan.targetStepKey,
    actualShipmentDate: plan.targetStepKey === "shipment_completed" ? plan.actualShipmentDate : null,
    batchId,
    sourceRowNumber: raw.rowNumber,
    metadata,
    ...(plan.productModel.kind === "NEW" ? { productModelKindForNew: plan.workflowKind } : {}),
  };
}

function planCreatesMasters(plan: KyosanRowPlan): boolean {
  return plan.customer.kind === "NEW" || plan.endUser?.kind === "NEW" || plan.productModel.kind === "NEW";
}

/** 실패 문구 — 서비스가 준 문구와 칸별 문구만(입력값은 싣지 않는다). */
function describeCreateFailure(result: Extract<CreateRepairCaseResult, { ok: false }>): string {
  const parts = [result.message, ...Object.values(result.fieldErrors ?? {})];
  return [...new Set(parts)].join(" — ");
}

/**
 * 조각 하나를 실행한다. 올린 파일을 **다시 읽고 다시 대조한다** — 미리보기 결과를 믿지 않는다.
 * 줄은 행 번호 순서대로 하나씩 만든다(한 줄 = 한 트랜잭션). 한 줄이 실패해도 나머지는 계속한다.
 */
export async function executeKyosanImportChunk(input: {
  bytes: Buffer;
  fileName: string;
  batchId: string;
  fileSha256: string;
  rowNumbers: readonly number[];
  actor: KyosanImportActor;
  today: string;
}): Promise<KyosanChunkResult> {
  const denied = await authorize(input.actor);
  if (denied) return denied;

  if (typeof input.batchId !== "string" || !BATCH_ID_PATTERN.test(input.batchId)) {
    return invalid("가져오기 묶음 식별자를 확인할 수 없습니다. 미리보기부터 다시 해 주세요.");
  }
  if (typeof input.fileSha256 !== "string" || !SHA256_PATTERN.test(input.fileSha256)) {
    return invalid("파일 식별값을 확인할 수 없습니다. 미리보기부터 다시 해 주세요.");
  }
  if (
    !Array.isArray(input.rowNumbers) ||
    input.rowNumbers.length === 0 ||
    !input.rowNumbers.every((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 0)
  ) {
    return invalid("실행할 행을 확인할 수 없습니다.");
  }
  if (input.rowNumbers.length > KYOSAN_IMPORT_MAX_ROWS_PER_CHUNK) {
    return {
      ok: false,
      code: "TOO_MANY_ROWS",
      message: `한 번에 ${KYOSAN_IMPORT_MAX_ROWS_PER_CHUNK}줄까지 실행할 수 있습니다(받은 줄: ${input.rowNumbers.length}).`,
    };
  }
  const rowNumbers = [...new Set(input.rowNumbers)].sort((a, b) => a - b);

  const parsed = parseKyosanIntakeWorkbook(input.bytes, input.fileName, { today: input.today });
  if (!parsed.ok) return parseFailure(parsed);
  if (parsed.fileSha256 !== input.fileSha256) {
    return {
      ok: false,
      code: "FILE_CHANGED",
      message: "올린 파일이 미리보기 때의 파일과 다릅니다. 미리보기부터 다시 해 주세요.",
    };
  }

  const rowsByNumber = new Map(parsed.rows.map((row) => [row.raw.rowNumber, row]));
  const chunkRows = rowNumbers
    .map((rowNumber) => rowsByNumber.get(rowNumber))
    .filter((row): row is KyosanClassifiedRow => row !== undefined);

  let lookups = await loadImportLookups(intakeNumbersOf(chunkRows));
  const keys = new Map<number, string>();
  for (const row of chunkRows) {
    if (row.raw.intakeNumber !== null) {
      keys.set(row.raw.rowNumber, kyosanIdempotencyKey(input.batchId, input.fileSha256, row.raw.rowNumber, row.raw.intakeNumber));
    }
  }
  const succeeded = await findSucceededKyosanImports([...keys.values()]);
  const options = { canCreateProductModels: mayCreateProductModels(input.actor) };

  const results: KyosanChunkRowResult[] = [];
  for (const rowNumber of rowNumbers) {
    const parsedRow = rowsByNumber.get(rowNumber);
    if (!parsedRow) {
      results.push({
        rowNumber,
        outcome: "FAILED",
        intakeNumber: null,
        message: "파일에 이 행이 없습니다(빈 줄이거나 머리글 위의 행입니다).",
      });
      continue;
    }

    const [preview] = classifyKyosanRowsForImport([parsedRow], lookups, options);
    const intakeNumber = parsedRow.raw.intakeNumber;
    const key = keys.get(rowNumber);

    if (preview.existing) {
      // 이 가져오기(같은 batchId · 같은 파일 · 같은 줄)가 이미 만든 건이면 같은 건으로 답한다.
      const replay = key === undefined ? undefined : succeeded.get(key);
      if (
        replay &&
        replay.requesterUserId === input.actor.userId &&
        replay.repairCaseId === preview.existing.repairCaseId
      ) {
        results.push({
          rowNumber,
          outcome: "CREATED",
          repairCaseId: replay.repairCaseId,
          intakeNumber,
          message: "이 가져오기에서 이미 만든 건입니다(다시 실행해도 같은 건).",
        });
      } else {
        results.push({
          rowNumber,
          outcome: "ALREADY_EXISTS",
          repairCaseId: preview.existing.repairCaseId,
          intakeNumber,
          message: preview.reasons[0],
        });
      }
      continue;
    }

    if (preview.status !== "IMPORTABLE" || preview.plan === null || key === undefined || intakeNumber === null) {
      results.push({
        rowNumber,
        outcome: "SKIPPED",
        intakeNumber,
        message: preview.reasons.join(" / ") || "가져올 수 없는 줄입니다.",
      });
      continue;
    }

    const result = await createRepairCaseWithIdempotency({
      actor: input.actor,
      intake: buildIntakeInput(parsedRow.raw, preview.plan),
      idempotencyKey: key,
      logContext: "EXCEL_IMPORT",
      legacyImportState: buildLegacyImportState(input.batchId, input.fileSha256, parsedRow.raw, preview.plan),
    });

    if (result.ok) {
      results.push({ rowNumber, outcome: "CREATED", repairCaseId: result.id, intakeNumber: result.intakeNumber });
      // 새 이름을 만들었으면 목록을 다시 읽는다 — 다음 줄의 같은 이름(전각 등)이 방금 만든 것에 붙게.
      if (planCreatesMasters(preview.plan)) lookups = { ...lookups, ...(await loadKyosanMasterLookups()) };
      continue;
    }

    if (result.code === "INTAKE_NUMBER_DUPLICATE") {
      // 대조와 저장 사이에 누가 같은 번호를 만들었다. 덮어쓰지 않고 「이미 있음」으로 돌려준다.
      const existing = (await loadExistingCasesByIntakeNumber([intakeNumber])).get(intakeNumber);
      results.push({
        rowNumber,
        outcome: "ALREADY_EXISTS",
        ...(existing ? { repairCaseId: existing.repairCaseId } : {}),
        intakeNumber,
        message: `인수번호 ${intakeNumber} 인 건이 방금 생겼습니다 — 가져오지 않았습니다(덮어쓰지 않습니다).`,
      });
      continue;
    }

    results.push({ rowNumber, outcome: "FAILED", intakeNumber, message: describeCreateFailure(result) });
  }

  return { ok: true, batchId: input.batchId, results };
}
