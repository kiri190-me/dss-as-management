import {
  billingTypeLabels,
  productCategoryLabels,
  type BillingType,
  type ExceptionStatus,
  type Priority,
  type RepairStatus,
  type WorkflowType,
} from "@/lib/domain/types";
// 🔴 types.ts 가 아니다 — 2026-11-07 에 고리를 끊느라 분가했다(그 파일 머리말).
import { isRepairCaseOverdue } from "@/lib/domain/repair-case-overdue";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { resolveRepairStatusFromStep } from "./repair-status";

/**
 * Flat shape produced by the single joined query in
 * src/lib/db/queries/repair-cases.ts. Deliberately a plain structural type
 * (no drizzle-orm import here) so this mapper stays a pure function with no
 * DB/React dependency, and so no Drizzle row/table type ever needs to leak
 * past this file.
 */
export type RepairCaseJoinRow = {
  id: string;
  version: number;
  intakeNumber: string;
  legacyReportNumber: string | null;
  customerId: string;
  customerName: string;
  endUserId: string | null;
  endUserName: string | null;
  productId: string;
  modelName: string;
  lotNumber: string | null;
  serialNumber: string | null;
  partNumber: string | null;
  assignedEngineerId: string | null;
  engineerName: string | null;
  workflowTypeCode: WorkflowType;
  billingType: BillingType | null;
  priority: Priority;
  currentWorkflowStepKey: string;
  /**
   * Phase 2c: 상태의 출처가 step-status-map.ts(TS 표)에서 DB의
   * workflow_steps.repair_status로 바뀌었다. 쿼리가 이미 workflow_steps를
   * 조인하고 있으므로 컬럼 하나를 더 고르는 것으로 끝난다.
   *
   * nullable인 것은 컬럼이 아직 NOT NULL로 승격되지 않았기 때문이다. 비어
   * 있으면 조용히 넘기지 않고 UnmappedWorkflowStepError로 실패한다 — 예전
   * 표에 매핑이 없을 때와 정확히 같은 동작이다.
   */
  currentWorkflowStepRepairStatus: RepairStatus | null;
  exceptionStatusCode: string | null;
  receivedAt: string;
  customerRequestedDueDate: string | null;
  internalTargetInspectionCompletionDate: string | null;
  internalTargetShipmentDate: string | null;
  actualShipmentDate: string | null;
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
  currentDiagnosisSummary: string | null;
  nextPlannedAction: string | null;
  accessoryList: string | null;
  externalConditionSummary: string | null;
  reasonForRemoval: string | null;
  notes: string | null;
  contactNameSnapshot: string | null;
  contactPhoneSnapshot: string | null;
  contactEmailSnapshot: string | null;
  createdAt: Date;
};

/**
 * Trash view row shape (Repair Case Trash + Restore checkpoint) — every
 * RepairCaseJoinRow column plus the 4 soft-delete metadata columns.
 * `deletedAt` stays nullable at the type level (it's the same nullable DB
 * column either way) even though a row only ever reaches this shape via
 * selectRepairCaseTrashJoin()'s `is_deleted = true` filter, where
 * softDeleteRepairCase guarantees deleted_at is always set in that same
 * update — mapRepairCaseTrashRow asserts the non-null invariant explicitly.
 */
export type RepairCaseTrashJoinRow = RepairCaseJoinRow & {
  deletedAt: Date | null;
  deleteReason: string | null;
  deletedByUserId: string | null;
  deletedByUserName: string | null;
};

/**
 * DB-only extension of ResolvedRepairCase for the trash list — never
 * produced by the mock/local resolvers (a local/draft repair case has no
 * server-side row and can never be soft-deleted), so this type lives here
 * rather than alongside ResolvedRepairCase's mock/local variants.
 */
export type TrashedRepairCase = ResolvedRepairCase & {
  deletedAt: string;
  deleteReason: string | null;
  deletedByUserId: string | null;
  deletedByUserName: string | null;
};

/**
 * Maps one joined DB row to the existing ResolvedRepairCase shape
 * (source: "DATABASE"). Pure function, no mutation, no logging of its own —
 * callers are responsible for not logging the row (it may contain the
 * contact-snapshot PII columns; see repair-cases.ts schema comment).
 *
 * `priority` now reads the real `repair_cases.priority` column (인수 정보
 * priority-editing checkpoint) — no longer a fixed "NORMAL" placeholder.
 * It still never affects status derivation (deriveRepairStatus/isOverdue
 * are computed independently of priority).
 */
export function mapRepairCaseRow(
  row: RepairCaseJoinRow,
  /**
   * 그 건이 **내자 정리에서 빌려 올 납기요청일 전부**(빌릴 것이 없으면 빈 배열).
   *
   * 🔴 **선택 인자가 아니다 — 부르는 자리마다 한 번씩 정하게 한다.** 2026-11-07
   * 까지 이 값은 매퍼가 늘 빈 배열로 내놓고 **조회가 나중에 덧씌우는** 것이었는데,
   * 그 사이에 계산되는 isOverdue 는 덧씌우기 전의 빈 배열로 판정하고 있었다. 그래서
   * 상세 화면에 날짜가 **보이는데도** 「납기 지연」이 안 뜨는 건이 생겼다(사용자
   * 신고). 기본값을 두면 그 모양이 아무 오류 없이 되살아난다.
   *
   * 🔵 조인해 온 한 줄에는 들어 있을 수 없는 값이다 — 한 건에 내자 줄이 여럿이고
   * 줄마다 날짜가 또 여럿이라, 이 join 에 끌어다 붙이면 그 건이 날짜 수만큼
   * 복제된다(queries/repair-case-domestic-order-due-dates.ts 머리말). 그래서
   * **따로 읽어** 여기로 넘긴다.
   */
  domesticOrderDueDates: readonly string[],
  referenceDate: Date = new Date()
): ResolvedRepairCase {
  const status = resolveRepairStatusFromStep({
    repairCaseId: row.id,
    workflowType: row.workflowTypeCode,
    currentStepKey: row.currentWorkflowStepKey,
    stepRepairStatus: row.currentWorkflowStepRepairStatus,
  });

  const createdAtIso = row.createdAt.toISOString();

  return {
    id: row.id,
    version: row.version,
    source: "DATABASE",
    productId: row.productId,
    intakeNumber: row.intakeNumber,
    legacyReportNumber: row.legacyReportNumber,
    workflowType: row.workflowTypeCode,
    status,
    priority: row.priority,
    exceptionStatus: row.exceptionStatusCode as ExceptionStatus | null,
    currentWorkflowStepKey: row.currentWorkflowStepKey,
    receivedAt: row.receivedAt,
    customerRequestedDueDate: row.customerRequestedDueDate,
    // 조인이 아니라 **따로 읽어 받은** 값이다(위 인자 주석). 2026-11-07 까지는
    // 여기서 빈 배열을 내놓고 조회가 뒤에서 덧씌웠는데, 그러면 바로 아래 isOverdue
    // 가 덧씌우기 전의 빈 배열로 판정한다.
    domesticOrderDueDates,
    internalTargetInspectionCompletionDate: row.internalTargetInspectionCompletionDate,
    internalTargetShipmentDate: row.internalTargetShipmentDate,
    actualShipmentDate: row.actualShipmentDate,
    createdAt: createdAtIso,
    // 🔴 2026-11-03 부터 「납기 지연」은 **고객 요청 납기일**로 잰다(사내 목표
    // 완료일이 아니다 — domain/repair-case-overdue.ts 머리말).
    // 🔴 2026-11-07 부터 그 칸이 비면 **내자 정리에서 빌려 온 날짜**로 잰다. 빌려
    // 오는 일은 그 함수 안에서 일어나므로 여기서는 재료만 넘긴다 — 화면에 그려지는
    // 날짜와 판정이 본 날짜가 언제나 같은 하나다.
    isOverdue: isRepairCaseOverdue(
      {
        status,
        customerRequestedDueDate: row.customerRequestedDueDate,
        domesticOrderDueDates,
        actualShipmentDate: row.actualShipmentDate,
      },
      referenceDate
    ),
    // 라벨이 없으면 "-" — 도메인에서 없앤 레거시 코드가 만에 하나 조인되어도
    // undefined가 화면에 새어 나가지 않게 한다(db/workflow-type-column.ts 주석).
    productCategory: productCategoryLabels[row.workflowTypeCode] ?? "-",
    paidOrWarranty: row.billingType ? billingTypeLabels[row.billingType] : "-",
    billingType: row.billingType,
    modelName: row.modelName,
    lotNumber: row.lotNumber ?? "-",
    serialNumber: row.serialNumber ?? "-",
    partNumber: row.partNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    endUserId: row.endUserId,
    endUserName: row.endUserName,
    assignedEngineerId: row.assignedEngineerId,
    engineerName: row.engineerName,
    reportedSymptom: row.reportedSymptom,
    intakeInspectionResult: row.intakeInspectionResult,
    currentDiagnosisSummary: row.currentDiagnosisSummary,
    nextPlannedAction: row.nextPlannedAction,
    accessoryList: row.accessoryList,
    externalConditionSummary: row.externalConditionSummary,
    reasonForRemoval: row.reasonForRemoval,
    notes: row.notes,
    contactName: row.contactNameSnapshot,
    contactPhone: row.contactPhoneSnapshot,
    contactEmail: row.contactEmailSnapshot,
  };
}

/**
 * Maps one joined trash-list DB row (see RepairCaseTrashJoinRow) to TrashedRepairCase.
 *
 * 🔵 빌려 올 내자 날짜를 **받지 않는다 — 휴지통에는 그 자리가 없다.** 휴지통 화면은
 * 「납기 지연」 배지를 그리지 않고(components/repair-cases/trash/ 의 표·카드), 지워진
 * 건을 두고 살아 있는 경보를 세는 일 자체가 뜻이 없다. 종 알림 셋도 모두
 * `is_deleted = false` 로 휴지통을 먼저 뺀다. 그래서 아래 호출은 **일부러** 빈
 * 배열이다 — 재료를 빠뜨린 것이 아니다.
 */
export function mapRepairCaseTrashRow(
  row: RepairCaseTrashJoinRow,
  referenceDate: Date = new Date()
): TrashedRepairCase {
  return {
    ...mapRepairCaseRow(row, [], referenceDate),
    // Non-null invariant: this row only ever reaches here via the trash
    // list's is_deleted=true filter, and softDeleteRepairCase always sets
    // deleted_at in that same update — see this file's RepairCaseTrashJoinRow
    // doc comment.
    deletedAt: row.deletedAt!.toISOString(),
    deleteReason: row.deleteReason,
    deletedByUserId: row.deletedByUserId,
    deletedByUserName: row.deletedByUserName,
  };
}
