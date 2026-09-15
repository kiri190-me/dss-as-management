import "server-only";
import { and, eq, gte, inArray, notExists, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  endUsers,
  productModels,
  products,
  repairCaseBillingDecisionHistories,
  repairCaseIdempotencyKeys,
  repairCases,
  statusChangeHistories,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import type { BillingType } from "@/lib/domain/types";
import type { WorkflowKind } from "@/lib/domain/workflow-kind";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 조회 (읽기만)
 * ============================================================================
 * 미리보기와 조각 실행이 파일을 DB 와 맞춰 볼 때 쓰는 것들이다. 여기서는 **쓰지 않는다**.
 *
 *  · 이미 있는 인수번호 — 인수번호 유니크가 **휴지통 포함 전체**라(schema/repair-cases.ts 의
 *    repair_cases_intake_number_unique) 삭제 건을 거르지 않는다. 휴지통에 있는 번호로도 새 건을
 *    만들 수 없기 때문이다. 화면이 「다른 건으로 보임」을 칠할 수 있게 그 건의 고객사명 · 모델 ·
 *    S/N 을 함께 돌려준다.
 *  · 살아 있는 고객사 · End-User · 모델 — 이름 대조(nfkcNameKey)는 서비스가 한다. 표가 작아
 *    전부 읽는다(queries/customers.ts 의 listCustomersWithCounts 와 같은 판단).
 *  · 현재 판의 단계 key — createRepairCase 가 고르는 것과 같은 판(PUBLISHED · is_current).
 * ============================================================================
 */

/** 가져오기 흔적 metadata 의 source 값. mutations/repair-cases.ts 의 LegacyImportMetadata 와 같다. */
export const KYOSAN_INTAKE_LIST_SOURCE = "KYOSAN_INTAKE_LIST" as const;

export type KyosanExistingCase = {
  repairCaseId: string;
  intakeNumber: string;
  isDeleted: boolean;
  customerName: string | null;
  modelName: string | null;
  serialNumber: string | null;
};

export type KyosanMasterLookups = {
  customers: { id: string; name: string }[];
  endUsers: { id: string; customerId: string; name: string }[];
  productModels: { id: string; name: string; kind: WorkflowKind | null }[];
};

export type KyosanImportLookups = KyosanMasterLookups & {
  /** 인수번호 → 기존 건(휴지통 포함). */
  existingCases: ReadonlyMap<string, KyosanExistingCase>;
  /** workflowType(템플릿 code) → 현재 판의 단계 key 들. */
  stepKeysByWorkflowType: ReadonlyMap<string, ReadonlySet<string>>;
};

/** 미리보기 · 실행이 한 번에 부르는 묶음. */
export async function loadImportLookups(intakeNumbers: readonly string[]): Promise<KyosanImportLookups> {
  const [existingCases, masters, stepKeysByWorkflowType] = await Promise.all([
    loadExistingCasesByIntakeNumber(intakeNumbers),
    loadKyosanMasterLookups(),
    loadCurrentWorkflowStepKeys(),
  ]);
  return { ...masters, existingCases, stepKeysByWorkflowType };
}

/** 인수번호로 기존 건 — **휴지통 포함**(파일 머리 주석). */
export async function loadExistingCasesByIntakeNumber(
  intakeNumbers: readonly string[]
): Promise<Map<string, KyosanExistingCase>> {
  const unique = [...new Set(intakeNumbers)];
  const result = new Map<string, KyosanExistingCase>();
  if (unique.length === 0) return result;

  const rows = await db
    .select({
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      isDeleted: repairCases.isDeleted,
      customerName: customers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCases)
    .leftJoin(customers, eq(customers.id, repairCases.customerId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    .where(inArray(repairCases.intakeNumber, unique));

  for (const row of rows) result.set(row.intakeNumber, row);
  return result;
}

/** 살아 있는 고객사 · End-User · 모델. 실행 중 새 이름을 만든 뒤에도 다시 부른다. */
export async function loadKyosanMasterLookups(): Promise<KyosanMasterLookups> {
  const [customerRows, endUserRows, modelRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.isDeleted, false)),
    db
      .select({ id: endUsers.id, customerId: endUsers.customerId, name: endUsers.name })
      .from(endUsers)
      .where(eq(endUsers.isDeleted, false)),
    db
      .select({ id: productModels.id, name: productModels.modelName, kind: productModels.kind })
      .from(productModels)
      .where(eq(productModels.isDeleted, false)),
  ]);
  return { customers: customerRows, endUsers: endUserRows, productModels: modelRows };
}

/** workflowType → 현재 판(PUBLISHED · is_current)의 단계 key 들. */
export async function loadCurrentWorkflowStepKeys(): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({ workflowType: workflowTemplates.code, stepKey: workflowSteps.key })
    .from(workflowSteps)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSteps.workflowVersionId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(and(eq(workflowVersions.status, "PUBLISHED"), eq(workflowVersions.isCurrent, true)));

  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const keys = result.get(row.workflowType) ?? new Set<string>();
    keys.add(row.stepKey);
    result.set(row.workflowType, keys);
  }
  return result;
}

export type KyosanSucceededImport = { repairCaseId: string; requesterUserId: string };

/**
 * 이미 성공한 가져오기 줄 — 멱등 키가 SUCCEEDED 인 것. 같은 조각을 다시 실행했을 때 「이미
 * 있음」이 아니라 **같은 건**으로 답하려고 본다(서비스의 executeKyosanImportChunk).
 */
export async function findSucceededKyosanImports(
  idempotencyKeys: readonly string[]
): Promise<Map<string, KyosanSucceededImport>> {
  const result = new Map<string, KyosanSucceededImport>();
  if (idempotencyKeys.length === 0) return result;

  const rows = await db
    .select({
      idempotencyKey: repairCaseIdempotencyKeys.idempotencyKey,
      repairCaseId: repairCaseIdempotencyKeys.repairCaseId,
      requesterUserId: repairCaseIdempotencyKeys.requesterUserId,
    })
    .from(repairCaseIdempotencyKeys)
    .where(
      and(
        inArray(repairCaseIdempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]),
        eq(repairCaseIdempotencyKeys.status, "SUCCEEDED")
      )
    );

  for (const row of rows) {
    if (row.repairCaseId) {
      result.set(row.idempotencyKey, { repairCaseId: row.repairCaseId, requesterUserId: row.requesterUserId });
    }
  }
  return result;
}

export type ImportedCaseNeedingBillingReview = {
  repairCaseId: string;
  intakeNumber: string;
  /** repair_cases.billing_type 는 null 을 허용하는 칸이다(가져온 건은 늘 값이 있다). */
  billingType: BillingType | null;
  importBatchId: string | null;
  sourceRowNumber: number | null;
  /** 가져온 파일의 費用 원문(50자까지). 비어 있었으면 null. */
  sourceBilling: string | null;
  /** 가져온 때(가져오기 흔적 이력의 created_at), ISO 문자열. */
  importedAt: string;
};

/**
 * 과거 인수품 가져오기로 들어왔는데 **유/무상을 사람이 아직 확인하지 않은** 건.
 *
 * 가져오기 흔적(LEGACY_IMPORT_STATE_SET) metadata 의 billingReview 가 true 이고, 그 뒤로
 * 유/무상 결정 이력(repair_case_billing_decision_histories)이 한 줄도 없는 건이다. 휴지통의
 * 건은 뺀다 — 손볼 대상 목록이라서다.
 */
export async function listImportedCasesNeedingBillingReview(): Promise<ImportedCaseNeedingBillingReview[]> {
  const rows = await db
    .select({
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      billingType: repairCases.billingType,
      metadata: statusChangeHistories.metadata,
      importedAt: statusChangeHistories.createdAt,
    })
    .from(statusChangeHistories)
    .innerJoin(repairCases, eq(repairCases.id, statusChangeHistories.repairCaseId))
    .where(
      and(
        eq(statusChangeHistories.actionType, "LEGACY_IMPORT_STATE_SET"),
        sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_INTAKE_LIST_SOURCE}`,
        sql`${statusChangeHistories.metadata} ->> 'billingReview' = 'true'`,
        eq(repairCases.isDeleted, false),
        notExists(
          db
            .select({ id: repairCaseBillingDecisionHistories.id })
            .from(repairCaseBillingDecisionHistories)
            .where(
              and(
                eq(repairCaseBillingDecisionHistories.repairCaseId, repairCases.id),
                gte(repairCaseBillingDecisionHistories.decidedAt, statusChangeHistories.createdAt)
              )
            )
        )
      )
    )
    .orderBy(repairCases.intakeNumber);

  return rows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      repairCaseId: row.repairCaseId,
      intakeNumber: row.intakeNumber,
      billingType: row.billingType,
      importBatchId: typeof metadata.importBatchId === "string" ? metadata.importBatchId : null,
      sourceRowNumber: typeof metadata.sourceRowNumber === "number" ? metadata.sourceRowNumber : null,
      sourceBilling: typeof metadata.sourceBilling === "string" ? metadata.sourceBilling : null,
      importedAt: row.importedAt.toISOString(),
    };
  });
}
