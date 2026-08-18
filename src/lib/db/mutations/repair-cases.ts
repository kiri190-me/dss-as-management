import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import {
  endUsers,
  products,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
  repairCaseBillingDecisionHistories,
  repairCases,
  statusChangeHistories,
  stockTransactions,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { resolveBillingWorkflowTarget } from "./billing-workflow-target";
import { purgeAllRepairCaseFlowchartsForCase } from "./repair-case-flowcharts";
import { formatIntakeNumber, yearMonthFromDate } from "@/lib/domain/local/intake-number";
import { isNotEarlierThan } from "@/lib/domain/local/validation";
import { deriveWorkflowType, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type { BillingType, WorkflowType } from "@/lib/domain/types";
import type {
  CreateRepairCaseResult,
  ValidatedCreateRepairCaseInput,
} from "@/lib/validation/repair-case-input";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import {
  isUniqueViolation,
  resolveExistingCustomer,
  resolveExistingEndUser,
  resolveOrCreateCustomerByName,
  resolveOrCreateEndUserByName,
  resolveProductModelSelection,
} from "./intake-master-resolution";

/**
 * Single DB transaction for database-backed repair-case creation. No
 * session/authorization here (that's create-repair-case.ts's job) — this
 * module only knows how to write, assuming the caller has already
 * validated input shape and authorization.
 *
 * Every reference (customer/End-User/engineer/workflow/product) is
 * re-checked here against a fresh transactional snapshot, even though the
 * Server Action layer may have done a similar check first — the same
 * defensive-redundancy discipline used throughout this project's read path
 * (Stage G-2/G-3 resolvers). No UPDATE/DELETE anywhere in this file.
 */
type CreateRepairCaseFailure = Extract<CreateRepairCaseResult, { ok: false }>;

class CreateRepairCaseRollback extends Error {
  constructor(readonly result: CreateRepairCaseFailure) {
    super("CREATE_REPAIR_CASE_ROLLBACK");
  }
}

function rollbackCreate(result: CreateRepairCaseFailure): never {
  throw new CreateRepairCaseRollback(result);
}

export async function createRepairCase(
  input: ValidatedCreateRepairCaseInput,
  options: {
    /** Excel-only legacy identifier; never populated by the interactive intake. */
    legacyReportNumber?: string | null;
    legacyImportState?: {
      targetStepKey: string;
      actualShipmentDate: string | null;
      actorUserId: string;
      batchId: string;
      sourceRowNumber: number;
    };
  } = {}
): Promise<CreateRepairCaseResult> {
  try {
    return await db.transaction(async (tx) => {
    const customerResolution = input.customerId
      ? await resolveExistingCustomer(tx, input.customerId)
      : await resolveOrCreateCustomerByName(tx, input.newCustomerName as string);
    if (!customerResolution.ok) {
      rollbackCreate(customerResolution.result);
    }
    const customerId = customerResolution.customerId;

    const endUserResolution = input.endUserId
      ? await resolveExistingEndUser(tx, input.endUserId, customerId)
      : input.newEndUserName
        ? await resolveOrCreateEndUserByName(tx, input.newEndUserName, customerId)
        : { ok: true as const, endUserId: null };
    if (!endUserResolution.ok) {
      rollbackCreate(endUserResolution.result);
    }
    const endUserId = endUserResolution.endUserId;

    const assignedEngineerId = input.assignedEngineerId;
    if (assignedEngineerId) {
      const [engineer] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(and(eq(users.id, assignedEngineerId), eq(users.isDeleted, false)));
      if (!engineer) {
        rollbackCreate({
          ok: false,
          code: "REFERENCE_NOT_FOUND",
          fieldErrors: { assignedEngineerId: "선택한 담당 엔지니어를 확인할 수 없습니다." },
          message: "선택한 담당 엔지니어를 확인할 수 없습니다.",
        });
      }
      if (engineer.role !== "AS_ENGINEER" || engineer.approvalStatus !== "APPROVED") {
        rollbackCreate({
          ok: false,
          code: "ENGINEER_NOT_ALLOWED",
          fieldErrors: { assignedEngineerId: "선택한 담당 엔지니어는 배정할 수 없습니다." },
          message: "선택한 담당 엔지니어는 배정할 수 없습니다.",
        });
      }
    }

    // Workflow: resolve the template's current PUBLISHED version, then that
    // version's intake_inspection step — the same "first real step" rule
    // src/lib/domain/local/submit-intake.ts already uses for local mode.
    const [version] = await tx
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
      .where(
        and(
          eq(workflowTemplates.code, input.workflowType),
          eq(workflowVersions.status, "PUBLISHED"),
          eq(workflowVersions.isCurrent, true)
        )
      );
    if (!version) {
      rollbackCreate({
        ok: false,
        code: "WORKFLOW_NOT_ALLOWED",
        fieldErrors: { workflowType: "선택한 워크플로를 사용할 수 없습니다." },
        message: "선택한 워크플로를 사용할 수 없습니다.",
      });
    }

    const [initialStep] = await tx
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(
        and(eq(workflowSteps.workflowVersionId, version.id), eq(workflowSteps.key, "intake_inspection"))
      );
    if (!initialStep) {
      rollbackCreate({
        ok: false,
        code: "WORKFLOW_NOT_ALLOWED",
        message: "워크플로 초기 단계를 확인할 수 없습니다.",
      });
    }

    let targetStep = initialStep;
    if (options.legacyImportState) {
      const [resolvedTargetStep] = await tx
        .select({ id: workflowSteps.id })
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.workflowVersionId, version.id),
            eq(workflowSteps.key, options.legacyImportState.targetStepKey)
          )
        );
      if (!resolvedTargetStep) {
        rollbackCreate({
          ok: false,
          code: "WORKFLOW_NOT_ALLOWED",
          message: "과거 상태에 대응하는 워크플로 단계를 확인할 수 없습니다.",
        });
      }
      targetStep = resolvedTargetStep;
    }

    // Product Model Master 연결 — input.productModelId/newProductModelName이
    // 있을 때만(=validateCreateRepairCaseInput을 거친 DB 모드 A/S 접수)
    // 마스터를 조회/생성하고, 그 결과(마스터의 현재 정식 이름 + id)로
    // products에 실제로 쓰일 modelName/productModelId를 덮어쓴다 —
    // 클라이언트가 보낸 modelName 텍스트를 그대로 신뢰하지 않는다. 둘 다
    // 없으면(기존 통합 테스트 등, 레거시 직접 호출부) 완전히 예전과 동일하게
    // input.modelName 그대로, productModelId는 undefined(=NULL)로 남는다.
    let productModelSelection: { modelName: string; productModelId: string | null } | null = null;
    if (input.productModelId || input.newProductModelName) {
      const selection = await resolveProductModelSelection(tx, {
        productModelId: input.productModelId ?? null,
        newProductModelName: input.newProductModelName ?? null,
      });
      if (!selection.ok) {
        rollbackCreate({ ok: false, code: selection.code, fieldErrors: selection.fieldErrors, message: selection.message });
      }
      productModelSelection = selection;
    }

    const productResult = await resolveProduct(tx, {
      modelName: productModelSelection?.modelName ?? input.modelName,
      lotNumber: input.lotNumber,
      serialNumber: input.serialNumber,
      partNumber: input.partNumber,
      productModelId: productModelSelection?.productModelId,
    });
    if (!productResult.ok) {
      rollbackCreate(productResult.result);
    }

    // Intake-number: a manual override (already format-validated by
    // validateCreateRepairCaseInput) skips the allocator entirely and is
    // used as-is — duplicate detection then happens at INSERT time below,
    // via the table's own repair_cases_intake_number_unique index, exactly
    // like the auto-generated path. Otherwise, allocate via the single
    // committed, reviewed allocator (repair_case_intake_sequences,
    // migration 0001) — the ONLY place application code allocates a
    // database-backed intake number when no override is given. Bucket key
    // derives from the validated receivedAt date, never from server/browser
    // "now".
    let intakeNumber: string;
    if (input.intakeNumber) {
      intakeNumber = input.intakeNumber;
    } else {
      const { yy, mm } = yearMonthFromDate(input.receivedAt);
      const yearMonth = `${yy}${mm}`;

      const allocatedRows = await tx
        .insert(repairCaseIntakeSequences)
        .values({ yearMonth, lastSequence: 1 })
        .onConflictDoUpdate({
          target: repairCaseIntakeSequences.yearMonth,
          set: {
            lastSequence: sql`${repairCaseIntakeSequences.lastSequence} + 1`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${repairCaseIntakeSequences.lastSequence} < 99`,
        })
        .returning({ lastSequence: repairCaseIntakeSequences.lastSequence });

      const allocated = allocatedRows[0];
      if (!allocated) {
        rollbackCreate({
          ok: false,
          code: "INTAKE_SEQUENCE_EXHAUSTED",
          message: "선택한 달의 인수번호를 모두 사용했습니다(99건 초과). 다른 인수일을 선택해 주세요.",
        });
      }

      intakeNumber = formatIntakeNumber(yy, mm, allocated.lastSequence);
    }

    // The INSERT runs inside a nested transaction (SAVEPOINT) for the same
    // reason resolveProduct() above does: Postgres aborts the *entire*
    // enclosing transaction on a statement error, so a plain try/catch
    // around the insert alone would leave `tx` unusable for anything after
    // it. repair_cases has exactly one unique index (intake_number), so any
    // 23505 here unambiguously means a duplicate intake number — expected
    // only on the manual-override path (the allocator path can't collide,
    // since it derives the next free sequence from the same table).
    try {
      const [inserted] = await tx.transaction(async (tx2) => {
        return tx2
          .insert(repairCases)
          .values({
            intakeNumber,
            legacyReportNumber: options.legacyReportNumber ?? null,
            customerId,
            endUserId,
            productId: productResult.productId,
            workflowVersionId: version.id,
            currentWorkflowStepId: targetStep.id,
            billingType: input.billingType,
            assignedEngineerId: input.assignedEngineerId,
            receivedAt: input.receivedAt,
            actualShipmentDate:
              options.legacyImportState?.targetStepKey === "shipment_completed"
                ? options.legacyImportState.actualShipmentDate
                : null,
            isLocked: options.legacyImportState?.targetStepKey === "shipment_completed",
            customerRequestedDueDate: input.customerRequestedDueDate,
            internalTargetShipmentDate: input.internalTargetShipmentDate,
            internalTargetInspectionCompletionDate: input.internalTargetInspectionCompletionDate,
            reportedSymptom: input.reportedSymptom,
            intakeInspectionResult: input.intakeInspectionResult,
            currentDiagnosisSummary: input.currentDiagnosisSummary,
            nextPlannedAction: input.nextPlannedAction,
            notes: input.notes,
            accessoryList: input.accessoryList,
            externalConditionSummary: input.externalConditionSummary,
            reasonForRemoval: input.reasonForRemoval,
            contactNameSnapshot: input.contactName,
            contactPhoneSnapshot: input.contactPhone,
            contactEmailSnapshot: input.contactEmail,
          })
          .returning({ id: repairCases.id, intakeNumber: repairCases.intakeNumber });
      });

      if (options.legacyImportState && targetStep.id !== initialStep.id) {
        await tx.insert(statusChangeHistories).values({
          repairCaseId: inserted.id,
          workflowVersionId: version.id,
          fromStepId: initialStep.id,
          toStepId: targetStep.id,
          actionType: "LEGACY_IMPORT_STATE_SET",
          actorUserId: options.legacyImportState.actorUserId,
          reason: null,
          metadata: {
            importBatchId: options.legacyImportState.batchId,
            sourceRowNumber: options.legacyImportState.sourceRowNumber,
          },
        });
      }

      return { ok: true, id: inserted.id, intakeNumber: inserted.intakeNumber };
    } catch (err) {
      if (isUniqueViolation(err)) {
        rollbackCreate({
          ok: false,
          code: "INTAKE_NUMBER_DUPLICATE",
          fieldErrors: { intakeNumber: "이미 사용 중인 인수번호입니다. 다른 번호를 입력해 주세요." },
          message: "이미 사용 중인 인수번호입니다. 다른 번호를 입력해 주세요.",
        });
      }
      throw err;
    }
    });
  } catch (err) {
    if (err instanceof CreateRepairCaseRollback) return err.result;
    throw err;
  }
}

export type ProductTriple = Pick<
  ValidatedCreateRepairCaseInput,
  "modelName" | "lotNumber" | "serialNumber" | "partNumber"
> & {
  /**
   * Product Model Master 연결 체크포인트 — optional. 주어지면 resolveProduct가
   * 해당 products 행에 이 FK를 연결(또는 이미 NULL이 아니면 절대 덮어쓰지
   * 않음)한다. 생략되면(기존 통합 테스트 등 레거시 직접 호출부) 예전과
   * 완전히 동일하게 동작한다 — 새로 만들어지는 products 행은 product_model_id
   * NULL로 남는다.
   */
  productModelId?: string | null;
};

type ProductResolution =
  | { ok: true; productId: string }
  | { ok: false; result: Extract<CreateRepairCaseResult, { ok: false }> };


/**
 * Lookup-or-create by the exact (model, lot, serial) triple — the same
 * identity the app's own product-history matching already uses
 * (src/lib/domain/local/product-history-match.ts's matchesNormalizedTriple
 * concept, here applied at the DB level via the existing
 * products_model_lot_serial_unique composite index; Gate 4). No case
 * normalization is applied, matching that existing design decision.
 *
 * A concurrent duplicate create (two requests racing on the same new
 * product) is handled by re-selecting after a unique-violation rather than
 * failing the whole repair-case creation. The insert itself runs inside a
 * nested transaction (SAVEPOINT) — Postgres aborts the *entire* enclosing
 * transaction on any statement error, so a plain try/catch around the
 * insert alone would leave `tx` unusable for the re-select and for every
 * later statement in this request. Confirmed necessary by a real
 * concurrent-insert race in repair-cases.integration.test.ts, which failed
 * with "current transaction is aborted" before this fix.
 */
export async function resolveProduct(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: ProductTriple
): Promise<ProductResolution> {
  const matchCondition = and(
    eq(products.modelName, input.modelName),
    eq(products.lotNumber, input.lotNumber),
    eq(products.serialNumber, input.serialNumber)
  );

  const [existing] = await tx
    .select({ id: products.id, productModelId: products.productModelId })
    .from(products)
    .where(matchCondition);
  if (existing) {
    await linkProductModelIfMissing(tx, existing, input.productModelId);
    return { ok: true, productId: existing.id };
  }

  try {
    const created = await tx.transaction(async (tx2) => {
      const [row] = await tx2
        .insert(products)
        .values({
          modelName: input.modelName,
          lotNumber: input.lotNumber,
          serialNumber: input.serialNumber,
          partNumber: input.partNumber,
          productModelId: input.productModelId ?? null,
        })
        .returning({ id: products.id });
      return row;
    });
    return { ok: true, productId: created.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [reSelected] = await tx
        .select({ id: products.id, productModelId: products.productModelId })
        .from(products)
        .where(matchCondition);
      if (reSelected) {
        await linkProductModelIfMissing(tx, reSelected, input.productModelId);
        return { ok: true, productId: reSelected.id };
      }
    }
    throw err;
  }
}

/**
 * Opportunistic healing for legacy/unlinked products rows — only ever fills
 * in a NULL product_model_id, never overwrites an already-linked row's FK.
 * This is deliberately conservative ("no silent model merging"): the only
 * way a row's product_model_id changes here is NULL -> a real id supplied by
 * *this* resolution call, so an existing, already-linked physical unit is
 * never silently repointed to a different master just because a later
 * intake/edit happened to resolve the same (modelName, lot, serial) triple
 * with a different productModelId in hand.
 */
async function linkProductModelIfMissing(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  existing: { id: string; productModelId: string | null },
  productModelId: string | null | undefined
): Promise<void> {
  if (!productModelId || existing.productModelId) return;
  await tx
    .update(products)
    .set({ productModelId, updatedAt: new Date() })
    .where(eq(products.id, existing.id));
}

export type UpdateRepairCaseResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_MISMATCH"
  | "ENGINEER_NOT_ALLOWED"
  | "VALIDATION_ERROR"
  | "WORKFLOW_REASSIGNMENT_NOT_ALLOWED"
  | "WORKFLOW_NOT_ALLOWED";

export type UpdateRepairCaseResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: UpdateRepairCaseResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 접수 정보를 먼저 수정했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.";

/**
 * Shared safe-reassignment gate for any change that would rewrite a repair
 * case's workflowVersionId/currentWorkflowStepId — 종류(매쳐/제너레이터)
 * reassignment AND, since the Generator billing/workflow sync checkpoint,
 * a Generator case's billing_type change. A case may only be reassigned
 * while it is still sitting at intake_inspection with zero
 * status_change_histories rows — STEP_RETURNED back to intake_inspection
 * still counts as "already progressed" and must not be reassignable (step
 * key alone can't tell the two apart, hence the extra history check).
 */
async function checkWorkflowReassignmentEligible(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  repairCaseId: string,
  currentWorkflowStepId: string
): Promise<boolean> {
  const [currentStep] = await tx
    .select({ key: workflowSteps.key })
    .from(workflowSteps)
    .where(eq(workflowSteps.id, currentWorkflowStepId));
  const [existingHistory] = await tx
    .select({ id: statusChangeHistories.id })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, repairCaseId))
    .limit(1);
  return Boolean(currentStep) && currentStep!.key === "intake_inspection" && !existingHistory;
}

type WorkflowVersionAndStepResolution =
  | { ok: true; workflowVersionId: string; workflowStepId: string }
  | { ok: false; result: Extract<UpdateRepairCaseResult, { ok: false }> };

/**
 * Resolves a target workflowType's current PUBLISHED version and that
 * version's intake_inspection step — the same lookup createRepairCase()
 * uses for a brand-new case, shared here so 종류 reassignment and Generator
 * billing_type reassignment never diverge on how a target workflow is
 * resolved.
 */
async function resolveTargetWorkflowVersionAndStep(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  targetWorkflowType: WorkflowType
): Promise<WorkflowVersionAndStepResolution> {
  const [targetVersion] = await tx
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(
      and(
        eq(workflowTemplates.code, targetWorkflowType),
        eq(workflowVersions.status, "PUBLISHED"),
        eq(workflowVersions.isCurrent, true)
      )
    );
  if (!targetVersion) {
    return {
      ok: false,
      result: { ok: false, code: "WORKFLOW_NOT_ALLOWED", message: "선택한 종류의 워크플로를 사용할 수 없습니다." },
    };
  }
  const [targetInitialStep] = await tx
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, targetVersion.id), eq(workflowSteps.key, "intake_inspection")));
  if (!targetInitialStep) {
    return {
      ok: false,
      result: { ok: false, code: "WORKFLOW_NOT_ALLOWED", message: "워크플로 초기 단계를 확인할 수 없습니다." },
    };
  }
  return { ok: true, workflowVersionId: targetVersion.id, workflowStepId: targetInitialStep.id };
}

/**
 * Section-based, optimistic-concurrency update for an existing repair case.
 * Called only after update-repair-case.ts's Server Action has already
 * enforced authentication, the shipment-lock policy, and field-level role
 * authorization — this function still independently re-validates every
 * reference (never trusts that the caller did), exactly like
 * createRepairCase() does, but does NOT re-check role/authorization itself
 * (that boundary is deliberate — see repair-case-edit-authorization.ts).
 *
 * `fields` must already be per-field format-validated (repair-case-update-
 * input.ts) — this function only does stateful, DB-dependent checks
 * (existence, cross-field ordering against current row values, reference
 * existence, product resolution) that a pure validator cannot do.
 *
 * Every column write is gated by `key in fields` — a key absent from
 * `fields` is never included in the UPDATE's SET clause, so a partial
 * section submission (e.g. SALES submitting only `{ notes }` under
 * FAULT_SERVICE) leaves every other column exactly as it was. This is also
 * what "Do not accept an arbitrary object and spread it into an UPDATE
 * statement" means here in practice — every field is named and checked
 * explicitly below, nothing is spread.
 *
 * intakeNumber, workflowVersionId, currentWorkflowStepId, exceptionStatusId,
 * isLocked, actualShipmentDate, delayReason are never referenced anywhere
 * in this function — they cannot be changed through this action no matter
 * what the caller submits, because no section's field list includes them.
 */
export async function updateRepairCase(
  repairCaseId: string,
  expectedVersion: number,
  section: RepairCaseEditSection,
  fields: Record<string, string | null>,
  /**
   * 유·무상 변경 시 repair_case_billing_decision_histories에 남길 행위자다.
   * 선택 인자인 이유는 오직 기존 통합 테스트 60여 개의 호출부를 그대로 두기
   * 위해서이며, 실제 운영 경로(update-repair-case.ts Server Action)는 항상
   * 넘긴다. 값이 없으면 전용 변경 이력은 남지 않는다(일반 감사 로그는 별개로
   * 항상 기록된다).
   */
  actorUserId?: string
): Promise<UpdateRepairCaseResult> {
  return db.transaction(async (tx): Promise<UpdateRepairCaseResult> => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        customerId: repairCases.customerId,
        endUserId: repairCases.endUserId,
        receivedAt: repairCases.receivedAt,
        customerRequestedDueDate: repairCases.customerRequestedDueDate,
        productId: repairCases.productId,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
        // 유·무상 변경 시 대상 워크플로를 해석하려면 현재 버전 id가 필요하다.
        workflowVersionId: repairCases.workflowVersionId,
        billingType: repairCases.billingType,
        // repair_cases has no direct workflowType column — it's derived via
        // workflow_version_id -> workflow_versions.workflow_template_id ->
        // workflow_templates.code, same join queries/repair-cases.ts already
        // uses to resolve it for display.
        workflowType: workflowTemplates.code,
      })
      .from(repairCases)
      .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
      .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
      .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    const setValues: Record<string, unknown> = {};
    /**
     * 유·무상이 실제로 바뀐 경우에만 채워지며, UPDATE가 성공한 뒤
     * repair_case_billing_decision_histories에 그대로 기록된다. 확정
     * mutation(repair-case-billing-decision.ts)과 같은 이력을 남겨야 두
     * 경로 중 어느 쪽으로 바꿨든 "언제 누가 무엇을 무엇으로" 추적된다.
     */
    let billingReassignment:
      | {
          previousBillingType: BillingType;
          nextBillingType: BillingType;
          previousWorkflowVersionId: string;
          nextWorkflowVersionId: string;
          previousWorkflowStepId: string;
          nextWorkflowStepId: string;
        }
      | null = null;

    if (section === "INTAKE") {
      let effectiveCustomerId = current.customerId;
      const customerIsChanging = "customerId" in fields || "newCustomerName" in fields;
      if (customerIsChanging) {
        // customerId(기존 재사용)와 newCustomerName(자유 입력으로 새 고객사
        // 명시 등록)은 상호 배타적이다 — 접수 생성 때와 동일한 resolveCustomer
        // 계열 헬퍼를 그대로 재사용한다(매칭 규칙을 중복 구현하지 않는다).
        const customerResolution =
          "customerId" in fields
            ? await resolveExistingCustomer(tx, fields.customerId as string)
            : await resolveOrCreateCustomerByName(tx, fields.newCustomerName as string);
        if (!customerResolution.ok) {
          return {
            ok: false,
            code: customerResolution.result.code as UpdateRepairCaseResultCode,
            fieldErrors: customerResolution.result.fieldErrors,
            message: customerResolution.result.message,
          };
        }
        effectiveCustomerId = customerResolution.customerId;
        setValues.customerId = customerResolution.customerId;
      }

      const endUserIsChanging = "endUserId" in fields || "newEndUserName" in fields;
      if (endUserIsChanging) {
        if ("endUserId" in fields && fields.endUserId === null) {
          setValues.endUserId = null;
        } else {
          const endUserResolution =
            "endUserId" in fields
              ? await resolveExistingEndUser(tx, fields.endUserId as string, effectiveCustomerId)
              : await resolveOrCreateEndUserByName(tx, fields.newEndUserName as string, effectiveCustomerId);
          if (!endUserResolution.ok) {
            return {
              ok: false,
              code: endUserResolution.result.code as UpdateRepairCaseResultCode,
              fieldErrors: endUserResolution.result.fieldErrors,
              message: endUserResolution.result.message,
            };
          }
          setValues.endUserId = endUserResolution.endUserId;
        }
      } else if (customerIsChanging && current.endUserId) {
        // End-User was not explicitly touched in this submission, but the
        // customer is changing — never leave a dangling cross-customer
        // reference: clear it if it no longer belongs to the resolved
        // customer (same safety rule the intake form's handleCustomerNameChange
        // already enforces client-side; this is the server-side backstop).
        const [currentEndUser] = await tx
          .select({ customerId: endUsers.customerId })
          .from(endUsers)
          .where(eq(endUsers.id, current.endUserId));
        if (!currentEndUser || currentEndUser.customerId !== effectiveCustomerId) {
          setValues.endUserId = null;
        }
      }

      const effectiveReceivedAt = ("receivedAt" in fields ? fields.receivedAt : current.receivedAt) as string;
      if ("receivedAt" in fields) {
        // If the due date isn't part of this submission, the *currently
        // stored* due date must still not precede the new receivedAt.
        if (!("customerRequestedDueDate" in fields) && current.customerRequestedDueDate) {
          if (!isNotEarlierThan(current.customerRequestedDueDate, effectiveReceivedAt)) {
            return {
              ok: false,
              code: "VALIDATION_ERROR",
              fieldErrors: { receivedAt: "인수일이 기존 고객 요청 납기일보다 늦을 수 없습니다." },
              message: "입력값을 확인해 주세요.",
            };
          }
        }
        setValues.receivedAt = effectiveReceivedAt;
      }

      if ("customerRequestedDueDate" in fields) {
        const due = fields.customerRequestedDueDate;
        if (due !== null && !isNotEarlierThan(due, effectiveReceivedAt)) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { customerRequestedDueDate: "고객 요청 납기일은 인수일보다 이전일 수 없습니다." },
            message: "입력값을 확인해 주세요.",
          };
        }
        setValues.customerRequestedDueDate = due;
      }

      if ("internalTargetShipmentDate" in fields) {
        const target = fields.internalTargetShipmentDate;
        if (target !== null && !isNotEarlierThan(target, effectiveReceivedAt)) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { internalTargetShipmentDate: "사내 목표 출하일은 인수일보다 이전일 수 없습니다." },
            message: "입력값을 확인해 주세요.",
          };
        }
        setValues.internalTargetShipmentDate = target;
      }

      // 사내 목표 검수 완료일 — 인수정보/A/S 접수 일정 체크포인트부터 이
      // 섹션이 단독 소관이다(고장 및 서비스 정보에는 더 이상 없다).
      if ("internalTargetInspectionCompletionDate" in fields) {
        const target = fields.internalTargetInspectionCompletionDate;
        if (target !== null && !isNotEarlierThan(target, effectiveReceivedAt)) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: {
              internalTargetInspectionCompletionDate: "사내 목표 검수 완료일은 인수일보다 이전일 수 없습니다.",
            },
            message: "입력값을 확인해 주세요.",
          };
        }
        setValues.internalTargetInspectionCompletionDate = target;
      }

      // 우선순위 — NOT NULL 컬럼이라 다른 날짜 필드처럼 인수일과의 선후 관계
      // 검증이 필요 없다. billingType처럼 워크플로/게이트에도 영향을 주지
      // 않는 순수 값 교체다.
      if ("priority" in fields) setValues.priority = fields.priority;

      if ("contactName" in fields) setValues.contactNameSnapshot = fields.contactName;
      if ("contactPhone" in fields) setValues.contactPhoneSnapshot = fields.contactPhone;
      if ("contactEmail" in fields) setValues.contactEmailSnapshot = fields.contactEmail;

      // 유상/무상 — 인수정보가 이 값의 단일한 정상 편집 지점이다(제품 정보의
      // 종류 재배정과는 별개 섹션 제출). Generator billing/workflow sync
      // 체크포인트: 현재 종류가 GENERATOR면 billing_type은 workflowType
      // (PAID_GENERATOR/WARRANTY_GENERATOR)과 항상 일치해야 한다 — 값이
      // 실제로 바뀌는 경우, 종류 재배정과 완전히 동일한 안전 게이트를 통과할
      // 때만 workflowVersionId/currentWorkflowStepId를 같은 트랜잭션 안에서
      // 원자적으로 함께 갱신한다. 게이트를 통과하지 못하면 billing_type
      // 자체를 거부한다(PAID_GENERATOR+WARRANTY 같은 불일치 상태를 절대
      // 만들지 않는다). MATCHER는 예전과 동일하게 완전히 독립적이다.
      if ("billingType" in fields) {
        const newBillingType = fields.billingType as BillingType;
        const billingTypeIsChanging = newBillingType !== current.billingType;

        // 2026-08-18 원칙 변경: 유·무상은 언제든, 어느 단계에서든 바꿀 수 있다.
        // 여기 있던 두 가드("Matcher/Total Controller는 아직 지원하지 않음",
        // "Generator도 진행 후에는 불가")를 제거했다. 실제 업무에서 일부유상
        // 판단은 수리를 진행하다 나오므로, 진행 전에만 허용하는 규칙은 그
        // 판단을 시스템에 반영할 방법을 아예 없앤다.
        //
        // 대상 워크플로/단계는 확정 mutation과 같은 해석기를 쓴다 —
        // 두 경로가 각자 계산하던 것이 규칙이 갈라진 원인이었다.
        if (billingTypeIsChanging) {
          const target = await resolveBillingWorkflowTarget(tx, {
            currentWorkflowVersionId: current.workflowVersionId,
            currentWorkflowStepId: current.currentWorkflowStepId,
            nextBillingType: newBillingType,
          });
          if (!target.ok) {
            return {
              ok: false,
              code: "WORKFLOW_REASSIGNMENT_NOT_ALLOWED",
              fieldErrors: { billingType: target.message },
              message: target.message,
            };
          }

          setValues.workflowVersionId = target.workflowVersionId;
          setValues.currentWorkflowStepId = target.workflowStepId;
          // previous_billing_type이 NOT NULL이라, 값이 비어 있던 레거시 행은
          // 전용 이력을 남기지 못한다(일반 감사 로그에는 그대로 남는다).
          // 그 행들은 데이터 정리로 값을 채우면 이후부터 정상 기록된다.
          if (current.billingType) billingReassignment = {
            previousBillingType: current.billingType,
            nextBillingType: newBillingType,
            previousWorkflowVersionId: current.workflowVersionId,
            nextWorkflowVersionId: target.workflowVersionId,
            previousWorkflowStepId: current.currentWorkflowStepId,
            nextWorkflowStepId: target.workflowStepId,
          };
        }

        setValues.billingType = newBillingType;
      }
    }

    if (section === "FAULT_SERVICE") {
      if ("assignedEngineerId" in fields) {
        const engineerId = fields.assignedEngineerId;
        if (engineerId === null) {
          // 선택 입력이다 — 비워두면 미배정으로 저장한다(A/S INTAKE 담당
          // 엔지니어 선택 입력 원칙과 동일하게 편집 경로에도 적용).
          setValues.assignedEngineerId = null;
        } else {
          const [engineer] = await tx
            .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
            .from(users)
            .where(and(eq(users.id, engineerId), eq(users.isDeleted, false)));
          if (!engineer) {
            return {
              ok: false,
              code: "REFERENCE_NOT_FOUND",
              fieldErrors: { assignedEngineerId: "선택한 담당 엔지니어를 확인할 수 없습니다." },
              message: "선택한 담당 엔지니어를 확인할 수 없습니다.",
            };
          }
          if (engineer.role !== "AS_ENGINEER" || engineer.approvalStatus !== "APPROVED") {
            return {
              ok: false,
              code: "ENGINEER_NOT_ALLOWED",
              fieldErrors: { assignedEngineerId: "선택한 담당 엔지니어는 배정할 수 없습니다." },
              message: "선택한 담당 엔지니어는 배정할 수 없습니다.",
            };
          }
          setValues.assignedEngineerId = engineerId;
        }
      }

      // intakeInspectionResult/currentDiagnosisSummary/nextPlannedAction are
      // no longer submittable through this section (record_kind derived-
      // summary checkpoint — SECTION_FIELD_NAMES.FAULT_SERVICE no longer
      // lists them, so update-repair-case.ts rejects them upstream before
      // this function is ever called). The columns themselves are untouched
      // — createRepairCase above still writes them at intake time.
      const passthroughTextFields = ["reportedSymptom", "notes"] as const;
      for (const key of passthroughTextFields) {
        if (key in fields) setValues[key] = fields[key];
      }
    }

    if (section === "PRODUCT") {
      const modelSelectionIsChanging = "productModelId" in fields || "newProductModelName" in fields;
      // "modelName" is no longer a Server-Action-facing PRODUCT field
      // (SECTION_FIELD_NAMES.PRODUCT — replaced by productModelId/
      // newProductModelName), but the mutation layer keeps recognizing it
      // for backward compatibility with existing direct callers (integration
      // tests, etc.) that still exercise the legacy free-text path.
      const legacyModelNameIsChanging = "modelName" in fields;
      const productTripleIsChanging =
        modelSelectionIsChanging || legacyModelNameIsChanging || "lotNumber" in fields || "serialNumber" in fields;

      if (productTripleIsChanging) {
        const [currentProduct] = await tx
          .select({
            modelName: products.modelName,
            lotNumber: products.lotNumber,
            serialNumber: products.serialNumber,
            partNumber: products.partNumber,
            productModelId: products.productModelId,
          })
          .from(products)
          .where(eq(products.id, current.productId));

        // repair_cases.product_id is NOT NULL + FK-restrict, so this row is
        // always present — defensive only, never expected to fire.
        if (!currentProduct) {
          return { ok: false, code: "REFERENCE_NOT_FOUND", message: "제품 정보를 확인할 수 없습니다." };
        }

        // Model resolution: productModelId/newProductModelName re-resolves
        // the master (never trusting client text — same as intake). A raw
        // legacy modelName edit is a free-text rename with no master
        // knowledge, so it deliberately clears productModelId to null rather
        // than silently keeping a link that may no longer describe the new
        // text (no silent model merging). Neither submitted: both carry
        // forward unchanged from the current product row — lot/serial-only
        // edits must never disturb an existing master link.
        let resolvedModelName = currentProduct.modelName;
        let resolvedProductModelId: string | null = currentProduct.productModelId;
        if (modelSelectionIsChanging) {
          const selection = await resolveProductModelSelection(tx, {
            productModelId: "productModelId" in fields ? (fields.productModelId as string | null) : null,
            newProductModelName:
              "newProductModelName" in fields ? (fields.newProductModelName as string) : null,
          });
          if (!selection.ok) {
            return { ok: false, code: selection.code, fieldErrors: selection.fieldErrors, message: selection.message };
          }
          resolvedModelName = selection.modelName;
          resolvedProductModelId = selection.productModelId;
        } else if (legacyModelNameIsChanging) {
          resolvedModelName = fields.modelName as string;
          resolvedProductModelId = null;
        }

        // The submitted triple may be partial (only the changed field(s)) —
        // merge with the product's current values before resolving, since
        // (model, lot, serial) is a single composite identity that must be
        // resolved as a whole, never one column at a time. partNumber is no
        // longer a user-facing/editable field (UI cleanup checkpoint) — it is
        // always carried forward from the current product row unchanged, never
        // taken from `fields`.
        const merged: ProductTriple = {
          modelName: resolvedModelName,
          lotNumber: "lotNumber" in fields ? (fields.lotNumber as string) : (currentProduct.lotNumber ?? ""),
          serialNumber:
            "serialNumber" in fields ? (fields.serialNumber as string) : (currentProduct.serialNumber ?? ""),
          partNumber: currentProduct.partNumber,
          productModelId: resolvedProductModelId,
        };

        // Never mutates the existing product row in place — resolveProduct
        // only SELECTs or INSERTs, so a product row shared by another repair
        // case is never changed by this reassignment. The old row is left as
        // a possible orphan (see the final report's "remaining risks").
        const productResult = await resolveProduct(tx, merged);
        if (!productResult.ok) {
          return {
            ok: false,
            code: "REFERENCE_NOT_FOUND",
            fieldErrors: productResult.result.fieldErrors,
            message: productResult.result.message,
          };
        }
        setValues.productId = productResult.productId;
      }

      // 동봉 액세서리/외관 상태 요약/탈거 사유 — UI IA 정리 체크포인트로
      // 고장 및 서비스 정보에서 제품 정보로 이동했다. repair_cases의 일반
      // text 컬럼이라 FAULT_SERVICE가 하던 것과 동일한 단순 passthrough다.
      const productPassthroughTextFields = ["accessoryList", "externalConditionSummary", "reasonForRemoval"] as const;
      for (const key of productPassthroughTextFields) {
        if (key in fields) setValues[key] = fields[key];
      }

      // 종류(매쳐/제너레이터) 재배정 — createRepairCase()가 실제로 새 접수를
      // 배치하는 단계는 "product_intake"가 아니라 "intake_inspection"이다
      // (product_intake는 어떤 repair_cases 행도 실제로 머무르는 적이 없는
      // 개념상의 첫 단계일 뿐이다 — 위 152번째 줄 근방 createRepairCase 참고).
      // 그래서 "아직 워크플로가 전혀 진행되지 않은 상태"는 currentWorkflowStepKey
      // === "intake_inspection"으로 판단한다. 여기에 더해 실제
      // status_change_histories 이력이 0건인지도 별도로 직접 확인한다 —
      // STEP_RETURNED로 intake_inspection에 다시 돌아온 경우처럼 단계 키만으로는
      // "전이가 없었다"를 보장할 수 없는 경우까지 막기 위한 이중 방어다. 이
      // 시점 이후에는 템플릿마다 단계 구성이 달라 안전하게 대응시킬 방법이 없다
      // — 과거 이력 레코드를 다시 쓰거나 재해석하지 않는다.
      if ("workflowKind" in fields) {
        if (!["MATCHER", "PAID_GENERATOR", "WARRANTY_GENERATOR"].includes(current.workflowType)) {
          return {
            ok: false,
            code: "WORKFLOW_REASSIGNMENT_NOT_ALLOWED",
            message: "이 워크플로의 종류 변경은 아직 지원하지 않습니다.",
          };
        }
        const eligible = await checkWorkflowReassignmentEligible(tx, repairCaseId, current.currentWorkflowStepId);
        if (!eligible) {
          return {
            ok: false,
            code: "WORKFLOW_REASSIGNMENT_NOT_ALLOWED",
            message: "이미 워크플로가 진행된 접수 건은 종류를 변경할 수 없습니다.",
          };
        }

        const kind = fields.workflowKind as WorkflowKind;
        if (kind === "TOTAL_CONTROLLER") {
          return {
            ok: false,
            code: "WORKFLOW_REASSIGNMENT_NOT_ALLOWED",
            message: "Total Controller 종류 변경은 아직 지원하지 않습니다.",
          };
        }
        // billingType은 더 이상 이 섹션(PRODUCT)에서 함께 제출되지 않는다 —
        // 인수정보 섹션의 단독 소관이다. 그래서 현재 저장된 값만 본다. 절대
        // 추측하지 않는다 — 비어 있으면(레거시 NULL 등) 사용자가 인수정보에서
        // 먼저 유상/무상을 선택해야 한다.
        const targetWorkflowType = kind === "MATCHER"
          ? "MATCHER"
          : deriveWorkflowType("GENERATOR", current.billingType);
        if (!targetWorkflowType) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { billingType: "유상/무상이 설정되지 않아 제너레이터로 변경할 수 없습니다." },
            message: "유상/무상이 설정되지 않아 제너레이터로 변경할 수 없습니다. 인수정보에서 유상/무상을 먼저 선택한 후 다시 시도해 주세요.",
          };
        }

        const resolution = await resolveTargetWorkflowVersionAndStep(tx, targetWorkflowType);
        if (!resolution.ok) return resolution.result;

        setValues.workflowVersionId = resolution.workflowVersionId;
        setValues.currentWorkflowStepId = resolution.workflowStepId;
      }
    }

    const updatedRows = await tx
      .update(repairCases)
      .set({ ...setValues, version: sql`${repairCases.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.version, expectedVersion)))
      .returning({ id: repairCases.id, version: repairCases.version });

    if (updatedRows.length === 0) {
      // Never silently overwrite newer data: zero rows means either the
      // case no longer exists, or (the practical case, since no delete path
      // exists yet) someone else's update already advanced the version.
      const [stillExists] = await tx
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));

      if (!stillExists) {
        return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
      }
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const updated = updatedRows[0];

    // 유·무상이 실제로 바뀐 경우에만, 확정 mutation과 동일한 형태의 전용
    // 이력을 남긴다. UPDATE가 성공한 뒤에 넣는 이유는 버전 충돌로 0행이
    // 갱신된 경우 이력만 남는 상황을 막기 위해서다(같은 트랜잭션이라
    // 이후 예외가 나면 둘 다 롤백된다).
    if (billingReassignment && actorUserId) {
      await tx.insert(repairCaseBillingDecisionHistories).values({
        repairCaseId,
        previousBillingType: billingReassignment.previousBillingType,
        nextBillingType: billingReassignment.nextBillingType,
        previousWorkflowVersionId: billingReassignment.previousWorkflowVersionId,
        nextWorkflowVersionId: billingReassignment.nextWorkflowVersionId,
        previousWorkflowStepId: billingReassignment.previousWorkflowStepId,
        nextWorkflowStepId: billingReassignment.nextWorkflowStepId,
        decidedBy: actorUserId,
      });
    }

    return { ok: true, id: updated.id, version: updated.version };
  });
}

export type SoftDeleteRepairCaseResultCode = "NOT_FOUND" | "CONFLICT";

export type SoftDeleteRepairCaseResult =
  | { ok: true; id: string }
  | { ok: false; code: SoftDeleteRepairCaseResultCode; message: string };

/**
 * Bulk soft-delete for /repair-cases (전체 A/S 현황), SUPER_ADMIN/ADMIN only
 * (enforced by the caller, bulk-delete-repair-cases.ts) — one repair case
 * per call/transaction, looped by the caller; never batches multiple cases
 * into a single transaction so one stale/conflicting case in a bulk
 * selection can never roll back the others that were valid.
 *
 * Uses repair_cases' own established optimistic-concurrency shape (integer
 * `version`, plain conditional UPDATE — no `.for("update")` row lock, same
 * as updateRepairCase()) rather than the updated_at-based scheme customers/
 * end_users/product_models use. A SELECT-first snapshot (contact PII columns
 * excluded — see the repair_cases schema file's own redaction note) is taken
 * before the UPDATE, purely to give insertAuditLog() a `previousValue`; the
 * final WHERE clause on the UPDATE itself is still the single source of
 * truth for whether the delete actually applies (defends against a
 * concurrent change racing between the SELECT and the UPDATE within this
 * same transaction).
 *
 * Only ever flips is_deleted/deleted_at/deleted_by/delete_reason (+ version/
 * updated_at) — never touches products/product_models/customers/end_users/
 * inventory, and never cascades to work records/status history/approvals/
 * procedure execution/flowcharts/idempotency keys (all FK-restrict, so nothing
 * downstream could be cascaded even if this tried to). shipment/is_locked
 * status is deliberately never checked — same "no delete-blocking policy
 * exists" conclusion the earlier audit reached; isBlockedByShipmentLock is
 * an edit-authorization concept, not consulted here at all.
 */
export async function softDeleteRepairCase(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string | null;
}): Promise<SoftDeleteRepairCaseResult> {
  return db.transaction(async (tx): Promise<SoftDeleteRepairCaseResult> => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        intakeNumber: repairCases.intakeNumber,
        customerId: repairCases.customerId,
        endUserId: repairCases.endUserId,
        productId: repairCases.productId,
        assignedEngineerId: repairCases.assignedEngineerId,
        billingType: repairCases.billingType,
        priority: repairCases.priority,
        receivedAt: repairCases.receivedAt,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
        actualShipmentDate: repairCases.actualShipmentDate,
        isLocked: repairCases.isLocked,
        version: repairCases.version,
        // contactNameSnapshot/contactPhoneSnapshot/contactEmailSnapshot are
        // deliberately never selected here — PII, must never reach
        // audit_logs.previous_value (see the schema file's own redaction
        // note on those three columns).
      })
      .from(repairCases)
      .where(and(eq(repairCases.id, params.id), eq(repairCases.isDeleted, false)));

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const updatedRows = await tx
      .update(repairCases)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: params.actorUserId,
        deleteReason: params.reason,
        version: sql`${repairCases.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(repairCases.id, params.id),
          eq(repairCases.version, params.expectedVersion),
          eq(repairCases.isDeleted, false)
        )
      )
      .returning({ id: repairCases.id });

    if (updatedRows.length === 0) {
      // Lost a race between the SELECT above and this UPDATE — never
      // silently skip. Disambiguate NOT_FOUND vs CONFLICT exactly like
      // updateRepairCase() does.
      const [stillExists] = await tx
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(and(eq(repairCases.id, params.id), eq(repairCases.isDeleted, false)));
      return stillExists
        ? { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE }
        : { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "SOFT_DELETE",
      targetEntity: "repair_cases",
      targetRecordId: params.id,
      previousValue: current,
      newValue: null,
    });

    return { ok: true, id: updatedRows[0].id };
  });
}

export type RestoreRepairCaseResultCode = "NOT_FOUND" | "CONFLICT";

export type RestoreRepairCaseResult =
  | { ok: true; id: string }
  | { ok: false; code: RestoreRepairCaseResultCode; message: string };

/**
 * Repair Case Trash + Restore checkpoint — un-deletes a soft-deleted repair
 * case, SUPER_ADMIN/ADMIN only (enforced by the caller,
 * restore-repair-cases.ts). Symmetric with softDeleteRepairCase at exactly
 * the same level: one repair case per call/transaction (looped by the
 * caller for bulk restore, same "never batch multiple cases into one
 * transaction" reasoning), same version-based optimistic-concurrency shape,
 * same SELECT-then-conditional-UPDATE pattern, same NOT_FOUND-for-everything
 * disambiguation (doesn't exist vs. not actually deleted vs. stale version
 * are all folded into the WHERE clause below and re-checked on a 0-row
 * UPDATE).
 *
 * Only ever clears is_deleted/deleted_at/deleted_by/delete_reason (+
 * increments version/updated_at) — never touches products/product_models/
 * customers/end_users/inventory, and never recreates/touches work records/
 * status history/approvals/procedure execution/flowcharts/idempotency keys,
 * all of which were already left untouched by softDeleteRepairCase and stay
 * that way (nothing here can cascade into them — same FK-restrict topology).
 * shipment/is_locked is deliberately never checked, matching
 * softDeleteRepairCase's own "no delete/restore-blocking policy exists"
 * conclusion.
 */
export async function restoreRepairCase(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
}): Promise<RestoreRepairCaseResult> {
  return db.transaction(async (tx): Promise<RestoreRepairCaseResult> => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        intakeNumber: repairCases.intakeNumber,
        customerId: repairCases.customerId,
        endUserId: repairCases.endUserId,
        productId: repairCases.productId,
        assignedEngineerId: repairCases.assignedEngineerId,
        billingType: repairCases.billingType,
        priority: repairCases.priority,
        receivedAt: repairCases.receivedAt,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
        actualShipmentDate: repairCases.actualShipmentDate,
        isLocked: repairCases.isLocked,
        version: repairCases.version,
        isDeleted: repairCases.isDeleted,
        deletedAt: repairCases.deletedAt,
        deletedBy: repairCases.deletedBy,
        deleteReason: repairCases.deleteReason,
        // contactNameSnapshot/contactPhoneSnapshot/contactEmailSnapshot are
        // deliberately never selected here — PII, must never reach
        // audit_logs.previous_value (see softDeleteRepairCase's own note).
      })
      .from(repairCases)
      .where(and(eq(repairCases.id, params.id), eq(repairCases.isDeleted, true)));

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const updatedRows = await tx
      .update(repairCases)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        version: sql`${repairCases.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(repairCases.id, params.id),
          eq(repairCases.version, params.expectedVersion),
          eq(repairCases.isDeleted, true)
        )
      )
      .returning({ id: repairCases.id, version: repairCases.version });

    if (updatedRows.length === 0) {
      // Lost a race between the SELECT above and this UPDATE — never
      // silently skip. Disambiguate NOT_FOUND (already restored/gone) vs
      // CONFLICT exactly like softDeleteRepairCase does.
      const [stillDeleted] = await tx
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(and(eq(repairCases.id, params.id), eq(repairCases.isDeleted, true)));
      return stillDeleted
        ? { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE }
        : { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "RESTORE",
      targetEntity: "repair_cases",
      targetRecordId: params.id,
      previousValue: current,
      newValue: { id: current.id, version: updatedRows[0].version, isDeleted: false },
    });

    return { ok: true, id: updatedRows[0].id };
  });
}

export type PermanentlyDeleteRepairCaseResultCode = "NOT_FOUND" | "CONFLICT";

export type PermanentlyDeleteRepairCaseResult =
  | { ok: true; id: string }
  | { ok: false; code: PermanentlyDeleteRepairCaseResultCode; message: string };

/**
 * Repair Case Permanent Delete checkpoint — irreversible hard delete of an
 * already-soft-deleted (휴지통) repair case, SUPER_ADMIN/ADMIN only
 * (enforced by the caller, permanently-delete-repair-cases.ts). One repair
 * case per call/transaction, looped by the caller for bulk delete — same
 * "never batch multiple cases into one transaction" reasoning as
 * softDeleteRepairCase/restoreRepairCase, so one stale/conflicting case in
 * a bulk selection can never roll back the others that were valid.
 *
 * Uses `.for("update")` pessimistic locking on the repair_cases row
 * (unlike soft-delete/restore's plain optimistic-UPDATE approach) — a hard
 * delete has no "lost the race, just retry" semantics once it lands, so
 * the lock is taken up front and held for the whole transaction; this also
 * gives restoreRepairCase's own plain UPDATE (which takes an implicit row
 * lock the moment it runs) a well-defined serialization point against this
 * function for the restore-vs-purge race (see the two "race" integration
 * tests).
 *
 * Delete order, all inside the one locked transaction:
 *  1. SELECT ... FOR UPDATE, verify is_deleted = true (must already be
 *     trashed — same precondition as permanentlyDeleteRepairCaseFlowchart).
 *  2. verify expectedVersion (CONFLICT if stale).
 *  3. build the safe, PII-redacted snapshot (identical column set to
 *     softDeleteRepairCase/restoreRepairCase's own previousValue — contact-
 *     snapshot columns are never selected here either).
 *  4. delete repair_case_idempotency_keys for this case — short-lived
 *     operational dedup cache, no audit value, PII-free
 *     ({repairCaseId, intakeNumber} only) — explicitly emptied here rather
 *     than given a SET NULL treatment, since its own FK stayed RESTRICT.
 *  5. purgeAllRepairCaseFlowchartsForCase — force-purges every flowchart
 *     (active or already-trashed) belonging to this case; that FK also
 *     stayed RESTRICT by design, so nothing here can leave an orphan.
 *  6. backfill stock_transactions.destination_note (USE rows only, and
 *     only where it's still NULL — an existing operator-entered note is
 *     never overwritten) with a non-PII, identifiable reference (the
 *     intake number) — required so the stock_transactions_use_has_destination
 *     CHECK constraint still holds once step 7's DELETE fires this table's
 *     repair_case_id ON DELETE SET NULL action (migration 0031).
 *  7. DELETE the repair_cases row — the 6 preserved history/accounting
 *     tables (status_change_histories, repair_case_approvals,
 *     procedure_case_executions, stock_transactions, inventory_part_requests,
 *     repair_case_work_records) go to repair_case_id = NULL automatically
 *     via their own ON DELETE SET NULL action; nothing here deletes or
 *     rewrites a single row in any of them, or in products/product_models/
 *     customers/end_users (repair_cases.product_id/customer_id/end_user_id
 *     point AT those tables — deleting this row can never cascade toward
 *     its own parents).
 *  8. insert exactly one audit_logs PURGE row (previousValue = the step-3
 *     snapshot, newValue = null) — every prior audit_logs row about this
 *     case (CREATE/UPDATE/SOFT_DELETE/RESTORE) already survives
 *     automatically, since audit_logs.target_record_id is a polymorphic
 *     plain column with no DB-level FK to repair_cases at all.
 */
export async function permanentlyDeleteRepairCase(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string;
}): Promise<PermanentlyDeleteRepairCaseResult> {
  return db.transaction(async (tx): Promise<PermanentlyDeleteRepairCaseResult> => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        intakeNumber: repairCases.intakeNumber,
        customerId: repairCases.customerId,
        endUserId: repairCases.endUserId,
        productId: repairCases.productId,
        assignedEngineerId: repairCases.assignedEngineerId,
        billingType: repairCases.billingType,
        priority: repairCases.priority,
        receivedAt: repairCases.receivedAt,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
        actualShipmentDate: repairCases.actualShipmentDate,
        isLocked: repairCases.isLocked,
        version: repairCases.version,
        isDeleted: repairCases.isDeleted,
        deletedAt: repairCases.deletedAt,
        deletedBy: repairCases.deletedBy,
        deleteReason: repairCases.deleteReason,
        // contactNameSnapshot/contactPhoneSnapshot/contactEmailSnapshot are
        // deliberately never selected here — PII, must never reach
        // audit_logs.previous_value (see softDeleteRepairCase's own note).
        // This IS the last surviving trace of this case once step 7 below
        // runs, so this redaction is the actual point contact PII is
        // permanently erased from the system, not merely hidden.
      })
      .from(repairCases)
      .where(and(eq(repairCases.id, params.id), eq(repairCases.isDeleted, true)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    await tx.delete(repairCaseIdempotencyKeys).where(eq(repairCaseIdempotencyKeys.repairCaseId, params.id));

    await purgeAllRepairCaseFlowchartsForCase(tx, {
      repairCaseId: params.id,
      actorUserId: params.actorUserId,
      reason: params.reason,
    });

    // Never overwrites an existing destinationNote (operator-entered text
    // stays authoritative) — only backfills the rows that would otherwise
    // violate stock_transactions_use_has_destination once repair_case_id
    // goes NULL below. RECEIPT/RETURN rows are never touched: repair_case_id
    // is "USE only" by design (schema comment) and the CHECK itself only
    // ever applies to USE.
    await tx
      .update(stockTransactions)
      .set({ destinationNote: `영구 삭제된 접수 건 (인수번호: ${current.intakeNumber})` })
      .where(
        and(
          eq(stockTransactions.repairCaseId, params.id),
          eq(stockTransactions.transactionType, "USE"),
          isNull(stockTransactions.destinationNote)
        )
      );

    const deletedRows = await tx
      .delete(repairCases)
      .where(
        and(
          eq(repairCases.id, params.id),
          eq(repairCases.version, params.expectedVersion),
          eq(repairCases.isDeleted, true)
        )
      )
      .returning({ id: repairCases.id });

    if (deletedRows.length === 0) {
      // Held the row lock from the initial SELECT FOR UPDATE onward, so
      // this branch is unreachable in practice — kept anyway as the same
      // defensive NOT_FOUND-vs-CONFLICT disambiguation every other mutation
      // here uses on a 0-row write, rather than trusting the lock alone.
      const [stillDeleted] = await tx
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(and(eq(repairCases.id, params.id), eq(repairCases.isDeleted, true)));
      return stillDeleted
        ? { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE }
        : { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: "repair_cases",
      targetRecordId: params.id,
      previousValue: current,
      newValue: null,
    });

    return { ok: true, id: deletedRows[0].id };
  });
}
