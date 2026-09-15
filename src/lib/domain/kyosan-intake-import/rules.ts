import { NEW_INTAKE_WORKFLOW_TYPE_CODES, type NewIntakeWorkflowType } from "@/lib/domain/types";
import { deriveWorkflowType, type WorkflowKind } from "@/lib/domain/workflow-kind";
import { excelSerialToDateOnly } from "@/lib/xlsx/excel-date";
import type { GridCell } from "@/lib/xlsx/sheet-grid";
import { columnCaption } from "./columns";
import { nfkcNameKey } from "./name-suggestions";
import type { KyosanBillingAdjustment, KyosanClassifiedRow, KyosanRawRow } from "./types";

/**
 * ============================================================================
 * 교산 인수품 리스트 — 줄마다 DB 없이 판정한다
 * ============================================================================
 * 결과는 셋이다.
 *  · IMPORTABLE — 가져온다. 경고(`warnings`)나 유/무상 표시(`billingReview`)가 붙을
 *    수 있지만 막지는 않는다.
 *  · EXCLUDED — 가져오지 않는 종류(TTB/DUO). 다른 문제가 있어도 **제외가 이긴다** —
 *    어차피 안 가져올 줄을 고치라고 할 이유가 없다.
 *  · NEEDS_REVIEW — 사람이 엑셀을 고쳐야 한다. 사유는 여러 개일 수 있고, 전부
 *    한국어로 **어느 열이 어떻게** 틀렸는지 적는다.
 *
 * 규칙은 사용자가 정한 표 그대로다(2026-09-15). 비교 전에 NFKC + trim —
 * `中断：客先待ち` 의 전각 콜론은 NFKC 로 `:` 가 된다.
 *
 * 유/무상은 상태와 **함께** 본다 — 無償 인데 상태가 中断:客先待ち(PO 대기)면 일부 유상
 * (PARTIAL_PAID)으로 가져온다(사용자 결정 2026-09-15, 아래 resolveBilling).
 *
 * 파일 **안에서** 겹치는 것(같은 인수번호 두 줄 · 같은 모델이 다른 종류)도 여기서
 * 본다. DB 에 이미 있는지는 S2 의 일이다.
 * ============================================================================
 */

export const KYOSAN_RECEIVED_DATE_MINIMUM = "2000-01-01";

/** 대문자 D + 연 2자리 + 월(01~12) + 순번 2자리. 예: D210105. */
export const KYOSAN_INTAKE_NUMBER_PATTERN = /^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$/;

export const KYOSAN_SHIPPED_STATUS = "出荷済み";

/** PO 대기. NFKC 후의 글자다(원본은 전각 콜론 `中断：客先待ち`). */
export const KYOSAN_WAITING_PO_STATUS = "中断:客先待ち";

/** 규칙 비교용 — NFKC + trim. 원문을 바꾸지 않는다(반환값만 쓴다). */
export function normalizeForCompare(text: string | null): string {
  return (text ?? "").normalize("NFKC").trim();
}

/** 식별자(인수번호·L/N·S/N)용 — NFKC + trim, 비면 null. */
export function normalizeIdentifier(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized === "" ? null : normalized;
}

// ── 칸 → 글자 ─────────────────────────────────────────────────────────────

/**
 * 칸 → 글자(trim). 비면 null.
 *
 * 숫자 칸은 **정수 문자열**로 — S/N `1912120` 이 `1912120.0` 이나 `1.91212E6` 이
 * 되면 안 된다. 정수가 아닌 숫자는 Excel 이 보여 주는 15자리 정밀도로 적는다.
 */
export function cellToIdentifier(cell: GridCell | undefined): string | null {
  if (!cell) return null;
  if (cell.kind === "number") return numberToPlainString(cell.value);
  const trimmed = cell.text.trim();
  return trimmed === "" ? null : trimmed;
}

function numberToPlainString(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) {
    return Number.isSafeInteger(value) ? String(value) : BigInt(value).toString();
  }
  return String(Number(value.toPrecision(15)));
}

// ── 날짜 ──────────────────────────────────────────────────────────────────

export type KyosanDateCell =
  | { kind: "empty" }
  | { kind: "date"; date: string }
  /** 칸은 있는데 날짜로 못 읽었다. `text` 는 적힌 글자(사유 문구에 쓴다). */
  | { kind: "invalid"; text: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 날짜 칸 → `YYYY-MM-DD`.
 *  · 숫자 — Excel 일련번호. `date1904` 통합문서면 1904 체계로 푼다.
 *  · 글자 — `YYYY-MM-DD` · `YYYY/MM/DD`(월·일 한 자리도 받는다). 전각 숫자는 NFKC 로.
 */
export function cellToDate(cell: GridCell | undefined, date1904: boolean): KyosanDateCell {
  if (!cell) return { kind: "empty" };
  if (cell.kind === "number") {
    const date = excelSerialToDateOnly(cell.value, date1904 ? "1904" : "1900");
    // 9999-12-31 을 넘는 일련번호는 toISOString 이 `+010000-…` 로 적는다 — 날짜가 아니다.
    return date !== null && DATE_ONLY.test(date)
      ? { kind: "date", date }
      : { kind: "invalid", text: numberToPlainString(cell.value) ?? String(cell.value) };
  }
  const text = cell.text.normalize("NFKC").trim();
  if (text === "") return { kind: "empty" };
  const match = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[3]), Number(match[4])];
    if (isCalendarDate(year, month, day)) return { kind: "date", date: formatDate(year, month, day) };
  }
  return { kind: "invalid", text: cell.text.trim() };
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `today` 같은 인자가 진짜 `YYYY-MM-DD` 날짜인가. 아니면 던진다(부르는 쪽의 실수다). */
export function assertDateOnly(value: string, name: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new Error(`${name} 는 YYYY-MM-DD 날짜여야 합니다: "${value}"`);
  }
}

// ── 종류(G) ───────────────────────────────────────────────────────────────

/** 종류 판정. `EXCLUDED` 는 가져오지 않는 종류, null 은 모름(빈칸 포함). */
export type KyosanKindMapping = WorkflowKind | "EXCLUDED" | null;

export function mapKind(kindText: string | null): KyosanKindMapping {
  const key = normalizeForCompare(kindText).toUpperCase();
  if (key === "") return null;
  if (key.startsWith("RF")) return "GENERATOR";
  if (key.startsWith("MB")) return "MATCHER";
  if (key === "その他") return "TOTAL_CONTROLLER";
  if (key === "TTB/DUO") return "EXCLUDED";
  return null;
}

// ── 상태(O) → 목표 단계 ──────────────────────────────────────────────────

type StepByKind = Readonly<Record<WorkflowKind, string>>;

function sameForAllKinds(stepKey: string): StepByKind {
  return { MATCHER: stepKey, GENERATOR: stepKey, TOTAL_CONTROLLER: stepKey };
}

/** 매쳐 워크플로에는 `repair_or_defective_parts_replacement` 가 없고 `repair_in_progress` 가 있다. */
const REPAIR_STEP: StepByKind = {
  MATCHER: "repair_in_progress",
  GENERATOR: "repair_or_defective_parts_replacement",
  TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
};

/** 출하 대기 단계(`waiting_shipment`)는 매쳐 워크플로에만 있다. */
const AWAITING_SHIPMENT_STEP: StepByKind = {
  MATCHER: "waiting_shipment",
  GENERATOR: "shipment_approved",
  TOTAL_CONTROLLER: "shipment_approved",
};

/** 키는 NFKC 후의 글자다(전각 콜론은 이미 `:`). */
const STATUS_STEPS: ReadonlyMap<string, StepByKind> = new Map([
  ["受付", sameForAllKinds("intake_inspection")],
  ["調査完了", sameForAllKinds("intake_inspection")],
  // 무상 제너레이터·T/C 절차에는 waiting_po 가 없고, 사용자 결정으로 無償+PO 대기는 종류와 관계없이 일부 유상으로 가져온다(resolveBilling).
  [KYOSAN_WAITING_PO_STATUS, sameForAllKinds("waiting_po")],
  ["中断:部材待ち", sameForAllKinds("parts_supply")],
  ["中断:指示待ち", sameForAllKinds("waiting_kyosan_reply")],
  ["修理作業待ち", REPAIR_STEP],
  ["修理中", REPAIR_STEP],
  ["修理完了", REPAIR_STEP],
  ["出荷待ち", AWAITING_SHIPMENT_STEP],
  [KYOSAN_SHIPPED_STATUS, sameForAllKinds("shipment_completed")],
]);

const KNOWN_STATUS_LIST = [...STATUS_STEPS.keys()].join("·");

export function isKnownStatus(statusText: string | null): boolean {
  return STATUS_STEPS.has(normalizeForCompare(statusText));
}

export function isShippedStatus(statusText: string | null): boolean {
  return normalizeForCompare(statusText) === KYOSAN_SHIPPED_STATUS;
}

/** 상태 → 목표 단계 key. 모르는 상태(빈칸 포함)면 null. */
export function mapStatus(statusText: string | null, kind: WorkflowKind): string | null {
  return STATUS_STEPS.get(normalizeForCompare(statusText))?.[kind] ?? null;
}

// ── 유/무상(Y) ────────────────────────────────────────────────────────────

export type KyosanBillingMapping = {
  billingType: "PAID" | "WARRANTY";
  /** 有償·無償 이 아니어서 PAID 로 둔 것 — 가져오되 표시한다(확인 필요가 아니다). */
  billingReview: boolean;
  /** 원문(trim 만). 빈칸이면 null. */
  sourceBilling: string | null;
};

export function mapBilling(billingText: string | null): KyosanBillingMapping {
  const trimmed = billingText?.trim() ?? "";
  const sourceBilling = trimmed === "" ? null : trimmed;
  const key = normalizeForCompare(billingText);
  if (key === "有償") return { billingType: "PAID", billingReview: false, sourceBilling };
  if (key === "無償") return { billingType: "WARRANTY", billingReview: false, sourceBilling };
  return { billingType: "PAID", billingReview: true, sourceBilling };
}

/** 無償 + PO 대기 줄에 붙는 경고. */
export const KYOSAN_WARRANTY_PO_WARNING =
  "費用(Y열)은 無償이지만 상태가 中断：客先待ち(PO 대기)라 일부 유상으로 가져옵니다.";

export type KyosanBillingDecision = {
  billingType: "PAID" | "PARTIAL_PAID" | "WARRANTY";
  billingReview: boolean;
  /** 원문(trim 만). 빈칸이면 null. 일부 유상으로 바꿔도 원문 그대로다. */
  sourceBilling: string | null;
  billingAdjustment: KyosanBillingAdjustment | null;
};

/**
 * 유/무상(Y)을 **상태(O)와 함께** 보고 정한다.
 *
 * 🔴 無償 인데 상태가 中断:客先待ち(PO 대기)면 **일부 유상(PARTIAL_PAID)** 으로 가져온다
 * (사용자 결정 2026-09-15). 무상 절차(WARRANTY_*)에는 PO 단계를 만들지 않기로 했고,
 * 무상 건이 PO 를 기다린다면 그것은 일부 유상이라고 본다. 일부 유상은 유상 절차(PAID_*)를
 * 타므로 세 종류 모두 `waiting_po` 가 있다(deriveWorkflowType 이 PARTIAL_PAID 를 PAID_* 로
 * 접는다 — db/mutations/billing-workflow-target.ts 참고).
 *
 * 원문(`sourceBilling`)은 無償 그대로 남기고, 바꿨다는 사실은 `billingAdjustment` 로 알린다.
 * 검토 표시(`billingReview`)는 켜지 않는다 — 원문이 분명하고 규칙이 정해진 경우라서다.
 *
 * 그 밖의 조합은 mapBilling 그대로다(有償·빈칸·調整中 + PO 대기는 PAID).
 */
export function resolveBilling(
  billingText: string | null,
  statusText: string | null
): KyosanBillingDecision {
  const mapped = mapBilling(billingText);
  if (mapped.billingType === "WARRANTY" && normalizeForCompare(statusText) === KYOSAN_WAITING_PO_STATUS) {
    return {
      billingType: "PARTIAL_PAID",
      billingReview: false,
      sourceBilling: mapped.sourceBilling,
      billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID",
    };
  }
  return { ...mapped, billingAdjustment: null };
}

// ── 줄 분류 ───────────────────────────────────────────────────────────────

/** 읽개가 뽑은 줄 — 날짜 칸은 "못 읽음" 을 구별하려고 따로 들고 온다. */
export type KyosanExtractedRow = {
  raw: KyosanRawRow;
  receivedDate: KyosanDateCell;
  shippedDate: KyosanDateCell;
};

/** 사유 문구에 늘어놓는 행은 이만큼까지. 나머지는 "외 N줄". */
const MAX_LISTED_ROWS = 5;

export function classifyKyosanRows(
  rows: readonly KyosanExtractedRow[],
  options: { today: string }
): KyosanClassifiedRow[] {
  assertDateOnly(options.today, "today");
  const crossRowReasons = rows.map((): string[] => []);
  addDuplicateIntakeNumberReasons(rows, crossRowReasons);
  addModelKindConflictReasons(rows, crossRowReasons);
  return rows.map((row, index) => classifyRow(row, options.today, crossRowReasons[index]));
}

/**
 * 같은 인수번호가 두 줄 이상 — 그 줄들 **전부** 확인 필요. 어느 줄이 맞는지 여기서
 * 고를 수 없다. 제외될 줄(TTB/DUO)도 세는데, 그 줄 자체는 제외가 이긴다.
 */
function addDuplicateIntakeNumberReasons(
  rows: readonly KyosanExtractedRow[],
  reasons: string[][]
): void {
  const indexesByNumber = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const intakeNumber = row.raw.intakeNumber;
    if (intakeNumber === null) return;
    indexesByNumber.set(intakeNumber, [...(indexesByNumber.get(intakeNumber) ?? []), index]);
  });

  for (const [intakeNumber, indexes] of indexesByNumber) {
    if (indexes.length < 2) continue;
    const where = listRows(indexes.map((index) => String(rows[index].raw.rowNumber)), "·", "행");
    for (const index of indexes) {
      reasons[index].push(
        `인수번호 ${intakeNumber} 이 파일 안에 여러 번 있습니다(${where}) — 한 번만 적혀 있어야 합니다.`
      );
    }
  }
}

/**
 * 같은 모델 이름(`nfkcNameKey`)이 파일 안에서 서로 다른 종류로 나온다 — 그 줄들 전부
 * 확인 필요. 종류는 **판정 결과**(제너레이터·매쳐·T/C·제외)로 견준다: RF(FH) 와
 * RF(TP) 는 둘 다 제너레이터라 충돌이 아니다. 종류를 모르는 줄은 이미 따로 걸리므로
 * 견주는 데 넣지 않는다.
 */
function addModelKindConflictReasons(
  rows: readonly KyosanExtractedRow[],
  reasons: string[][]
): void {
  const indexesByModel = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (row.raw.modelName === null || mapKind(row.raw.kindText) === null) return;
    const key = nfkcNameKey(row.raw.modelName);
    indexesByModel.set(key, [...(indexesByModel.get(key) ?? []), index]);
  });

  for (const indexes of indexesByModel.values()) {
    const kinds = new Set(indexes.map((index) => mapKind(rows[index].raw.kindText)));
    if (kinds.size < 2) continue;
    const where = listRows(
      indexes.map((index) => `${rows[index].raw.rowNumber}행 ${rows[index].raw.kindText ?? ""}`),
      " · "
    );
    for (const index of indexes) {
      reasons[index].push(
        `모델 "${rows[index].raw.modelName}" 이 파일 안에서 서로 다른 종류로 적혀 있습니다(${where}) — 한 종류로 맞춰 주세요.`
      );
    }
  }
}

/** `18·25행` / `18·19·20·21·22행 외 2줄` — `suffix` 는 보인 목록 바로 뒤에 붙는다. */
function listRows(labels: readonly string[], separator: string, suffix = ""): string {
  const shown = labels.slice(0, MAX_LISTED_ROWS).join(separator) + suffix;
  const rest = labels.length - MAX_LISTED_ROWS;
  return rest > 0 ? `${shown} 외 ${rest}줄` : shown;
}

function classifyRow(
  row: KyosanExtractedRow,
  today: string,
  crossRowReasons: readonly string[]
): KyosanClassifiedRow {
  const { raw, receivedDate, shippedDate } = row;

  const kind = mapKind(raw.kindText);
  if (kind === "EXCLUDED") {
    return {
      raw,
      outcome: "EXCLUDED",
      reason: `${columnCaption("kindText")}이 "${raw.kindText ?? ""}" 입니다 — TTB/DUO 는 가져오지 않습니다.`,
    };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];

  // 인수번호(C)
  const intakeNumber = raw.intakeNumber;
  const intakeNumberValid = intakeNumber !== null && KYOSAN_INTAKE_NUMBER_PATTERN.test(intakeNumber);
  if (intakeNumber === null) {
    reasons.push(`${columnCaption("intakeNumber")}이 비어 있습니다.`);
  } else if (!intakeNumberValid) {
    reasons.push(
      `${columnCaption("intakeNumber")} 형식이 틀렸습니다: "${intakeNumber}" — 대문자 D 뒤에 연월 4자리와 순번 2자리(예: D210105)여야 합니다.`
    );
  }

  // 인수일(D)
  if (receivedDate.kind === "empty") {
    reasons.push(`${columnCaption("receivedAt")}이 비어 있습니다.`);
  } else if (receivedDate.kind === "invalid") {
    reasons.push(
      `${columnCaption("receivedAt")}을 날짜로 읽지 못했습니다: "${receivedDate.text}" — 날짜 서식이나 YYYY-MM-DD 로 적어 주세요.`
    );
  } else if (receivedDate.date < KYOSAN_RECEIVED_DATE_MINIMUM) {
    reasons.push(
      `${columnCaption("receivedAt")} ${receivedDate.date} 이 너무 이릅니다 — ${KYOSAN_RECEIVED_DATE_MINIMUM} 이후여야 합니다.`
    );
  }

  // 반드시 있어야 하는 글자 칸
  if (raw.modelName === null) reasons.push(`${columnCaption("modelName")}이 비어 있습니다.`);
  if (raw.customerName === null) reasons.push(`${columnCaption("customerName")}이 비어 있습니다.`);
  if (raw.lotNumber === null) reasons.push(`${columnCaption("lotNumber")}이 비어 있습니다.`);
  if (raw.serialNumber === null) reasons.push(`${columnCaption("serialNumber")}이 비어 있습니다.`);

  // 종류(G)
  if (kind === null) {
    reasons.push(
      raw.kindText === null
        ? `${columnCaption("kindText")}이 비어 있습니다.`
        : `${columnCaption("kindText")}을 알 수 없습니다: "${raw.kindText}" — RF…·MB…·その他·TTB/DUO 가운데 하나여야 합니다.`
    );
  }

  // 상태(O)
  const statusSteps = STATUS_STEPS.get(normalizeForCompare(raw.statusText));
  if (statusSteps === undefined) {
    reasons.push(
      raw.statusText === null
        ? `${columnCaption("statusText")}이 비어 있습니다.`
        : `${columnCaption("statusText")}을 알 수 없습니다: "${raw.statusText}" — ${KNOWN_STATUS_LIST} 가운데 하나여야 합니다.`
    );
  }

  // 출하일(S) — 出荷済み 인 줄만 본다. 그 밖의 줄의 S열은 무시한다.
  let actualShipmentDate: string | null = null;
  if (isShippedStatus(raw.statusText)) {
    if (shippedDate.kind === "empty") {
      reasons.push(`${columnCaption("statusText")}이 ${KYOSAN_SHIPPED_STATUS} 인데 ${columnCaption("shippedAt")}이 비어 있습니다.`);
    } else if (shippedDate.kind === "invalid") {
      reasons.push(
        `${columnCaption("shippedAt")}을 날짜로 읽지 못했습니다: "${shippedDate.text}" — 날짜 서식이나 YYYY-MM-DD 로 적어 주세요.`
      );
    } else {
      if (receivedDate.kind === "date" && shippedDate.date < receivedDate.date) {
        reasons.push(
          `${columnCaption("shippedAt")} ${shippedDate.date} 이 ${columnCaption("receivedAt")} ${receivedDate.date} 보다 이릅니다.`
        );
      }
      if (shippedDate.date > today) {
        reasons.push(`${columnCaption("shippedAt")} ${shippedDate.date} 이 오늘(${today})보다 뒤입니다.`);
      }
      actualShipmentDate = shippedDate.date;
    }
  }

  reasons.push(...crossRowReasons);

  // 경고 — 인수일의 연월이 인수번호의 연월과 다르다(가져오긴 한다).
  if (intakeNumberValid && receivedDate.kind === "date") {
    const numberYearMonth = intakeNumber.slice(1, 5);
    const dateYearMonth = receivedDate.date.slice(2, 4) + receivedDate.date.slice(5, 7);
    if (numberYearMonth !== dateYearMonth) {
      warnings.push(
        `${columnCaption("receivedAt")} ${receivedDate.date} 의 연월(${dateYearMonth})이 인수번호 ${intakeNumber} 의 연월(${numberYearMonth})과 다릅니다.`
      );
    }
  }

  if (reasons.length > 0 || kind === null || statusSteps === undefined) {
    return { raw, outcome: "NEEDS_REVIEW", reasons };
  }

  const billing = resolveBilling(raw.billingText, raw.statusText);
  if (billing.billingAdjustment === "WARRANTY_PO_TO_PARTIAL_PAID") warnings.push(KYOSAN_WARRANTY_PO_WARNING);

  return {
    raw,
    outcome: "IMPORTABLE",
    workflowKind: kind,
    billingType: billing.billingType,
    workflowType: toNewIntakeWorkflowType(deriveWorkflowType(kind, billing.billingType)),
    targetStepKey: statusSteps[kind],
    actualShipmentDate,
    billingReview: billing.billingReview,
    sourceBilling: billing.sourceBilling,
    billingAdjustment: billing.billingAdjustment,
    warnings,
  };
}

/**
 * PAID·PARTIAL_PAID·WARRANTY 로 구한 workflowType 은 늘 새 접수용이다(PARTIAL_PAID 는
 * PAID_* 로 접힌다) — 아니면 규칙이 틀린 것이라 던진다.
 */
function toNewIntakeWorkflowType(value: string | null): NewIntakeWorkflowType {
  const found = NEW_INTAKE_WORKFLOW_TYPE_CODES.find((code) => code === value);
  if (!found) throw new Error(`workflowType 을 정하지 못했습니다: ${String(value)}`);
  return found;
}
