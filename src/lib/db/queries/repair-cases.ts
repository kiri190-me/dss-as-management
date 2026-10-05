import { and, desc, eq } from "drizzle-orm";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  customers,
  endUsers,
  exceptionStatuses,
  productModels,
  products,
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { mapRepairCaseRow, mapRepairCaseTrashRow } from "../mappers/repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { TrashedRepairCase } from "../mappers/repair-case";

const deletedByUsers = alias(users, "repair_case_deleted_by_users");

/**
 * Read-only queries backing Stage G-2's REPAIR_CASE_READ_SOURCE=database
 * path. SELECT-only — no inserts/updates/deletes anywhere in this file, no
 * localStorage access, no mock-data.ts import. Never logs a row (rows may
 * contain the contact-snapshot PII columns; callers must not log query
 * results either — see repair-cases.ts schema comment).
 *
 * Both exported functions share the same 8-table join so the two read
 * paths (list, detail) can never drift into returning differently-shaped
 * data. This is a function (not a shared builder instance) so each call
 * gets its own fresh query.
 */
function repairCaseBaseColumns() {
  return {
    id: repairCases.id,
    version: repairCases.version,
    intakeNumber: repairCases.intakeNumber,
    legacyReportNumber: repairCases.legacyReportNumber,
    customerId: repairCases.customerId,
    customerName: customers.name,
    endUserId: repairCases.endUserId,
    endUserName: endUsers.name,
    productId: repairCases.productId,
    modelName: products.modelName,
    lotNumber: products.lotNumber,
    serialNumber: products.serialNumber,
    partNumber: products.partNumber,
    assignedEngineerId: repairCases.assignedEngineerId,
    engineerName: users.name,
    workflowTypeCode: workflowTypeCodeColumn(),
    billingType: repairCases.billingType,
    priority: repairCases.priority,
    currentWorkflowStepKey: workflowSteps.key,
    // Phase 2c: 상태를 TS 표가 아니라 이 컬럼에서 읽는다(mappers/repair-status.ts).
    currentWorkflowStepRepairStatus: workflowSteps.repairStatus,
    exceptionStatusCode: exceptionStatuses.code,
    receivedAt: repairCases.receivedAt,
    customerRequestedDueDate: repairCases.customerRequestedDueDate,
    internalTargetInspectionCompletionDate: repairCases.internalTargetInspectionCompletionDate,
    internalTargetShipmentDate: repairCases.internalTargetShipmentDate,
    actualShipmentDate: repairCases.actualShipmentDate,
    reportedSymptom: repairCases.reportedSymptom,
    intakeInspectionResult: repairCases.intakeInspectionResult,
    currentDiagnosisSummary: repairCases.currentDiagnosisSummary,
    nextPlannedAction: repairCases.nextPlannedAction,
    accessoryList: repairCases.accessoryList,
    externalConditionSummary: repairCases.externalConditionSummary,
    reasonForRemoval: repairCases.reasonForRemoval,
    notes: repairCases.notes,
    contactNameSnapshot: repairCases.contactNameSnapshot,
    contactPhoneSnapshot: repairCases.contactPhoneSnapshot,
    contactEmailSnapshot: repairCases.contactEmailSnapshot,
    createdAt: repairCases.createdAt,
  };
}

function selectRepairCaseJoin() {
  return db
    .select(repairCaseBaseColumns())
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .leftJoin(exceptionStatuses, eq(repairCases.exceptionStatusId, exceptionStatuses.id))
    .leftJoin(users, eq(repairCases.assignedEngineerId, users.id));
}

/**
 * Trash view (Repair Case Trash + Restore checkpoint) — same 8-table join
 * as selectRepairCaseJoin() plus the 3 soft-delete metadata columns and a
 * second, aliased join to `users` for the deleting admin's name
 * (`deletedByUsers` — a distinct alias from the assigned-engineer `users`
 * join above; a case can be deleted by someone other than its engineer).
 * A separate function rather than parameterizing selectRepairCaseJoin()
 * itself — drizzle's chained builder type does not thread extra columns
 * through cleanly, and this list only ever needs deleted rows.
 */
function selectRepairCaseTrashJoin() {
  return db
    .select({
      ...repairCaseBaseColumns(),
      deletedAt: repairCases.deletedAt,
      deleteReason: repairCases.deleteReason,
      deletedByUserId: repairCases.deletedBy,
      deletedByUserName: deletedByUsers.name,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .leftJoin(exceptionStatuses, eq(repairCases.exceptionStatusId, exceptionStatuses.id))
    .leftJoin(users, eq(repairCases.assignedEngineerId, users.id))
    .leftJoin(deletedByUsers, eq(repairCases.deletedBy, deletedByUsers.id));
}

export async function listRepairCases(): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(eq(repairCases.isDeleted, false))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

/**
 * 휴지통 (trash) list for /repair-cases — SUPER_ADMIN/ADMIN only at the
 * caller level (this function itself has no role check, same "queries are
 * mechanism, Server Actions/pages are policy" precedent as every other
 * query in this file). Explicitly loads `is_deleted = true` rows — the
 * mirror image of listRepairCases()'s `is_deleted = false`, never the
 * default/unfiltered set.
 */
export async function listDeletedRepairCases(): Promise<TrashedRepairCase[]> {
  const rows = await selectRepairCaseTrashJoin()
    .where(eq(repairCases.isDeleted, true))
    .orderBy(desc(repairCases.deletedAt));

  return rows.map((row) => mapRepairCaseTrashRow(row));
}

/**
 * A/S 이력 for the Customer Management detail page (/customers/[id]) — same
 * shared join/mapper as listRepairCases/getRepairCaseById, just scoped by
 * customerId, so this can never drift from what the case list/detail pages
 * themselves show for the same rows.
 */
export async function listRepairCasesByCustomerId(customerId: string): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.customerId, customerId)))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

/**
 * A/S 이력 for the Product Model Management detail page (/product-models/[id])
 * — same shared join/mapper as listRepairCases/getRepairCaseById/
 * listRepairCasesByCustomerId, scoped by the product's product_model_id
 * (the real master-table FK, migration 0030), never by a model_name string
 * comparison — a later master rename never breaks this linkage.
 */
export async function listRepairCasesByProductModelId(productModelId: string): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(products.productModelId, productModelId)))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

/**
 * 「이 제품의 과거 A/S 이력」 for the repair case detail page
 * (/repair-cases/[id]) — same shared join/mapper as listRepairCases/
 * getRepairCaseById/listRepairCasesByCustomerId, scoped by
 * repair_cases.product_id (index repair_cases_product_id_idx), so this can
 * never drift from what the case list/detail pages themselves show for the
 * same rows.
 *
 * 모델 마스터(listRepairCasesByProductModelId)가 아니라 제품 **개체**를
 * 기준으로 좁히는 이유: 이 화면이 묻는 것은 "같은 모델이 몇 번 들어왔나"가
 * 아니라 "지금 눈앞의 이 물건이 전에도 들어왔나"이기 때문이다. 현재 건
 * 자기 자신 제외·접수일 비교·정렬은 여기서 하지 않고, mock/local 경로와
 * 같은 규칙을 쓰도록 domain/local/product-history-match.ts가 맡는다.
 */
export async function listRepairCasesByProductId(productId: string): Promise<ResolvedRepairCase[]> {
  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.productId, productId)))
    .orderBy(desc(repairCases.receivedAt));

  return rows.map((row) => mapRepairCaseRow(row));
}

// Deliberately permissive UUID matcher (any RFC-4122-shaped hex string, not
// version-pinned) — its only job is to reject obviously-non-UUID input
// before it reaches Postgres, so a malformed :id route param returns a
// clean `null` instead of a raw "invalid input syntax for type uuid" error.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRepairCaseById(id: string): Promise<ResolvedRepairCase | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const rows = await selectRepairCaseJoin()
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.id, id)))
    .limit(1);

  const row = rows[0];
  return row ? mapRepairCaseRow(row) : null;
}

/**
 * 이 제품 **개체**가 속한 제품 모델 마스터의 id — 수리 건 상세의 `Model` 글자를
 * /product-models/[id] 로 잇기 위한 것 하나뿐이다(2026-09-30 요구).
 *
 * ResolvedRepairCase 는 모델 **이름**(products.model_name, 그 개체가 제 손으로
 * 적어 둔 글자)만 들고 있고 마스터 id 는 들고 있지 않다. 이름으로 마스터를
 * 되찾으면 나중에 모델명을 고치는 날 링크가 조용히 끊기므로, 화면이 필요한
 * 곳에서 FK(products.product_model_id, migration 0030)를 직접 묻는다 —
 * listRepairCasesByProductModelId 가 이름 비교를 피한 것과 같은 이유다.
 *
 * null 이 되는 경우가 둘이고, 둘 다 정상이다:
 *  - products.product_model_id 가 NULL 이다. 이 칸은 nullable 이고(products.ts
 *    의 주석), 아직 마스터로 풀리지 않은 개체가 실제로 있다.
 *  - 붙어 있는 마스터가 **휴지통에 있다**. 모델을 버리면 그 모델의 개체까지
 *    함께 소프트 삭제되지만(mutations/product-models-trash.ts), 그 개체를 물고
 *    있는 수리 건은 상세 화면에 그대로 남는다(selectRepairCaseJoin 은 제품의
 *    is_deleted 를 보지 않는다). 그 상태에서 마스터 주소로 보내면 막다른 길이라
 *    여기서 걸러 null 로 떨어뜨린다.
 *
 * 부르는 쪽이 null 을 받으면 링크를 만들지 않고 글자로 둔다.
 */
export async function getProductModelIdForProduct(productId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(productId)) {
    return null;
  }

  const rows = await db
    .select({ productModelId: productModels.id })
    .from(products)
    .innerJoin(productModels, eq(products.productModelId, productModels.id))
    .where(and(eq(products.id, productId), eq(productModels.isDeleted, false)))
    .limit(1);

  return rows[0]?.productModelId ?? null;
}

export type RepairCaseEditGuard = { id: string; isLocked: boolean };

/**
 * Minimal, edit-authorization-only lookup — used by update-repair-case.ts's
 * Server Action to check the shipment-lock policy (PROJECT_REQUIREMENTS.md
 * "출하 완료 후 수정(잠금 해제) 정책", SECURITY_POLICY.md §2) before
 * attempting any write, without pulling the full 8-table join just to read
 * one boolean.
 */
export async function getRepairCaseEditGuardById(id: string): Promise<RepairCaseEditGuard | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked })
    .from(repairCases)
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.id, id)))
    .limit(1);

  return row ?? null;
}

/** 연락서 공유폴더를 찾는 데 쓰는 최소한의 것 — 🔴 찾는 열쇠는 인수번호 하나뿐이다. */
export type RepairCaseContactFolderKey = { id: string; intakeNumber: string };

/**
 * 인수번호만 읽는 조회 — `GET /api/repair-cases/{id}/contact-folder` 하나가 쓴다.
 *
 * getRepairCaseById 의 8-테이블 join 을 쓰지 않는 까닭은 위
 * getRepairCaseEditGuardById · listRepairCasesForFlowchartCreateSelector 와 같다: 그 join 은
 * 연락처 스냅숏(PII)까지 함께 싣는데, 이 통로가 쓰는 것은 **인수번호 한 칸**뿐이다.
 *
 * 휴지통에 있는 건(is_deleted)은 없는 것으로 본다 — 부르는 쪽은 404 로 답한다(그 id 의 건이
 * 있다는 사실조차 알리지 않는다). 모양이 아닌 id 는 Postgres 에 닿기 전에 null 이다.
 */
export async function getRepairCaseContactFolderKeyById(
  id: string
): Promise<RepairCaseContactFolderKey | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const [row] = await db
    .select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.id, id)))
    .limit(1);

  return row ?? null;
}

/**
 * 연락서 폴더 **이름을 짓는 데** 쓰는 칸들 — `POST /api/repair-cases/{id}/contact-folder`
 * 하나가 쓴다(연락서 조각 5). 폴더 이름은 사람이 목록에서 읽는 줄이라 여섯 조각이
 * 전부 필요하다(domain/contact-folder-naming.ts).
 *
 * 🔴 **찾는 열쇠는 여전히 인수번호 하나뿐이다.** 나머지 다섯은 **이름을 지을 때만** 쓴다 —
 * 어느 것도 폴더를 **확정**하지 않는다(같은 장비가 여러 번 수리를 온다 —
 * kyosan/report-match.ts 머리말). 2026-10-05 조각 8 이 S/N 으로 폴더를 한 번 더 훑던
 * 장치를 걷어내, 이제 S/N 도 이름 조각일 뿐이다(domain/contact-folder-naming.ts 머리말).
 *
 * 위 getRepairCaseContactFolderKeyById 와 같은 규율로 8-테이블 join 을 쓰지 않는다 —
 * 그 join 은 연락처 스냅숏(PII)까지 싣는데 여기서 쓰는 것은 여섯 칸뿐이다.
 * 휴지통에 있는 건은 없는 것으로 본다(부르는 쪽은 404).
 */
export type RepairCaseContactFolderNaming = {
  id: string;
  intakeNumber: string;
  customerName: string;
  modelName: string;
  lotNumber: string | null;
  serialNumber: string | null;
  reportedSymptom: string | null;
};

export async function getRepairCaseContactFolderNamingById(
  id: string
): Promise<RepairCaseContactFolderNaming | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const [row] = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      modelName: products.modelName,
      lotNumber: products.lotNumber,
      serialNumber: products.serialNumber,
      reportedSymptom: repairCases.reportedSymptom,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(and(eq(repairCases.isDeleted, false), eq(repairCases.id, id)))
    .limit(1);

  return row ?? null;
}

export type RepairCaseFlowchartCreateOption = {
  id: string;
  intakeNumber: string;
  customerName: string;
  modelName: string;
  serialNumber: string | null;
};

/**
 * Checkpoint 3A — the smallest identity-only projection needed for the
 * 진단 Flowchart 관리 page's "새 Flowchart 추가" target-case dropdown. Same
 * minimal-columns precedent as getRepairCaseEditGuardById (never the full
 * 8-table selectRepairCaseJoin, which also carries contact-snapshot PII
 * this selector has no reason to load). ~20 active cases today — a plain
 * <select> is the right size for this dataset (see this checkpoint's own
 * audit); no search/typeahead is introduced.
 */
export async function listRepairCasesForFlowchartCreateSelector(): Promise<RepairCaseFlowchartCreateOption[]> {
  const rows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(eq(repairCases.isDeleted, false))
    .orderBy(desc(repairCases.receivedAt));

  return rows;
}
