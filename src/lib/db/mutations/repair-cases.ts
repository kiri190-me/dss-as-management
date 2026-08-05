import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  endUsers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { formatIntakeNumber, yearMonthFromDate } from "@/lib/domain/local/intake-number";
import { isNotEarlierThan } from "@/lib/domain/local/validation";
import type {
  CreateRepairCaseResult,
  ValidatedCreateRepairCaseInput,
} from "@/lib/validation/repair-case-input";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";

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
export async function createRepairCase(
  input: ValidatedCreateRepairCaseInput
): Promise<CreateRepairCaseResult> {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.isDeleted, false)));
    if (!customer) {
      return {
        ok: false,
        code: "REFERENCE_NOT_FOUND",
        fieldErrors: { customerId: "선택한 고객사를 확인할 수 없습니다." },
        message: "선택한 고객사를 확인할 수 없습니다.",
      };
    }

    if (input.endUserId) {
      const [endUser] = await tx
        .select({ id: endUsers.id, customerId: endUsers.customerId })
        .from(endUsers)
        .where(and(eq(endUsers.id, input.endUserId), eq(endUsers.isDeleted, false)));
      if (!endUser) {
        return {
          ok: false,
          code: "REFERENCE_NOT_FOUND",
          fieldErrors: { endUserId: "선택한 End-User를 확인할 수 없습니다." },
          message: "선택한 End-User를 확인할 수 없습니다.",
        };
      }
      if (endUser.customerId !== input.customerId) {
        return {
          ok: false,
          code: "REFERENCE_MISMATCH",
          fieldErrors: { endUserId: "선택한 End-User가 고객사와 일치하지 않습니다." },
          message: "선택한 End-User가 고객사와 일치하지 않습니다.",
        };
      }
    }

    const [engineer] = await tx
      .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
      .from(users)
      .where(and(eq(users.id, input.assignedEngineerId), eq(users.isDeleted, false)));
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
      return {
        ok: false,
        code: "WORKFLOW_NOT_ALLOWED",
        fieldErrors: { workflowType: "선택한 워크플로를 사용할 수 없습니다." },
        message: "선택한 워크플로를 사용할 수 없습니다.",
      };
    }

    const [initialStep] = await tx
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(
        and(eq(workflowSteps.workflowVersionId, version.id), eq(workflowSteps.key, "intake_inspection"))
      );
    if (!initialStep) {
      return {
        ok: false,
        code: "WORKFLOW_NOT_ALLOWED",
        message: "워크플로 초기 단계를 확인할 수 없습니다.",
      };
    }

    const productResult = await resolveProduct(tx, input);
    if (!productResult.ok) {
      return productResult.result;
    }

    // Intake-number allocation — the single committed, reviewed allocator
    // (repair_case_intake_sequences, migration 0001). This is the ONLY
    // place application code allocates a database-backed intake number;
    // no second implementation exists. Bucket key derives from the
    // validated receivedAt date, never from server/browser "now".
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
      return {
        ok: false,
        code: "INTAKE_SEQUENCE_EXHAUSTED",
        message: "선택한 달의 인수번호를 모두 사용했습니다(99건 초과). 다른 인수일을 선택해 주세요.",
      };
    }

    const intakeNumber = formatIntakeNumber(yy, mm, allocated.lastSequence);

    const [inserted] = await tx
      .insert(repairCases)
      .values({
        intakeNumber,
        customerId: input.customerId,
        endUserId: input.endUserId,
        productId: productResult.productId,
        workflowVersionId: version.id,
        currentWorkflowStepId: initialStep.id,
        assignedEngineerId: input.assignedEngineerId,
        receivedAt: input.receivedAt,
        customerRequestedDueDate: input.customerRequestedDueDate,
        internalTargetShipmentDate: input.internalTargetShipmentDate,
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

    return { ok: true, id: inserted.id, intakeNumber: inserted.intakeNumber };
  });
}

export type ProductTriple = Pick<
  ValidatedCreateRepairCaseInput,
  "modelName" | "lotNumber" | "serialNumber" | "partNumber"
>;

type ProductResolution =
  | { ok: true; productId: string }
  | { ok: false; result: Extract<CreateRepairCaseResult, { ok: false }> };

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

/**
 * drizzle-orm wraps the driver's PostgresError in its own error class (the
 * original is on `.cause`), so the Postgres error `code` is not always on
 * the caught error itself — check both. Confirmed necessary by a real
 * concurrent-insert race in repair-cases.integration.test.ts, which failed
 * with an uncaught 23505 before this fix.
 */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

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

  const [existing] = await tx.select({ id: products.id }).from(products).where(matchCondition);
  if (existing) {
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
        })
        .returning({ id: products.id });
      return row;
    });
    return { ok: true, productId: created.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [reSelected] = await tx.select({ id: products.id }).from(products).where(matchCondition);
      if (reSelected) {
        return { ok: true, productId: reSelected.id };
      }
    }
    throw err;
  }
}

export type UpdateRepairCaseResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_MISMATCH"
  | "ENGINEER_NOT_ALLOWED"
  | "VALIDATION_ERROR";

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
  fields: Record<string, string | null>
): Promise<UpdateRepairCaseResult> {
  return db.transaction(async (tx): Promise<UpdateRepairCaseResult> => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        customerId: repairCases.customerId,
        receivedAt: repairCases.receivedAt,
        customerRequestedDueDate: repairCases.customerRequestedDueDate,
        productId: repairCases.productId,
      })
      .from(repairCases)
      .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    const setValues: Record<string, unknown> = {};

    if (section === "INTAKE") {
      let effectiveCustomerId = current.customerId;
      if ("customerId" in fields) {
        const customerId = fields.customerId as string;
        const [customer] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, customerId), eq(customers.isDeleted, false)));
        if (!customer) {
          return {
            ok: false,
            code: "REFERENCE_NOT_FOUND",
            fieldErrors: { customerId: "선택한 고객사를 확인할 수 없습니다." },
            message: "선택한 고객사를 확인할 수 없습니다.",
          };
        }
        effectiveCustomerId = customerId;
        setValues.customerId = customerId;
      }

      if ("endUserId" in fields) {
        const endUserId = fields.endUserId;
        if (endUserId !== null) {
          const [endUser] = await tx
            .select({ id: endUsers.id, customerId: endUsers.customerId })
            .from(endUsers)
            .where(and(eq(endUsers.id, endUserId), eq(endUsers.isDeleted, false)));
          if (!endUser) {
            return {
              ok: false,
              code: "REFERENCE_NOT_FOUND",
              fieldErrors: { endUserId: "선택한 End-User를 확인할 수 없습니다." },
              message: "선택한 End-User를 확인할 수 없습니다.",
            };
          }
          if (endUser.customerId !== effectiveCustomerId) {
            return {
              ok: false,
              code: "REFERENCE_MISMATCH",
              fieldErrors: { endUserId: "선택한 End-User가 고객사와 일치하지 않습니다." },
              message: "선택한 End-User가 고객사와 일치하지 않습니다.",
            };
          }
        }
        setValues.endUserId = endUserId;
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

      if ("contactName" in fields) setValues.contactNameSnapshot = fields.contactName;
      if ("contactPhone" in fields) setValues.contactPhoneSnapshot = fields.contactPhone;
      if ("contactEmail" in fields) setValues.contactEmailSnapshot = fields.contactEmail;
    }

    if (section === "FAULT_SERVICE") {
      if ("assignedEngineerId" in fields) {
        const engineerId = fields.assignedEngineerId as string;
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

      if ("internalTargetShipmentDate" in fields) {
        const date = fields.internalTargetShipmentDate as string;
        if (!isNotEarlierThan(date, current.receivedAt)) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { internalTargetShipmentDate: "사내 목표 출하일은 인수일보다 이전일 수 없습니다." },
            message: "입력값을 확인해 주세요.",
          };
        }
        setValues.internalTargetShipmentDate = date;
      }

      if ("internalTargetInspectionCompletionDate" in fields) {
        const date = fields.internalTargetInspectionCompletionDate;
        if (date !== null && !isNotEarlierThan(date, current.receivedAt)) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: {
              internalTargetInspectionCompletionDate: "사내 목표 검수완료일은 인수일보다 이전일 수 없습니다.",
            },
            message: "입력값을 확인해 주세요.",
          };
        }
        setValues.internalTargetInspectionCompletionDate = date;
      }

      const passthroughTextFields = [
        "reportedSymptom",
        "intakeInspectionResult",
        "currentDiagnosisSummary",
        "nextPlannedAction",
        "accessoryList",
        "externalConditionSummary",
        "reasonForRemoval",
        "notes",
      ] as const;
      for (const key of passthroughTextFields) {
        if (key in fields) setValues[key] = fields[key];
      }
    }

    if (section === "PRODUCT") {
      const [currentProduct] = await tx
        .select({
          modelName: products.modelName,
          lotNumber: products.lotNumber,
          serialNumber: products.serialNumber,
          partNumber: products.partNumber,
        })
        .from(products)
        .where(eq(products.id, current.productId));

      // repair_cases.product_id is NOT NULL + FK-restrict, so this row is
      // always present — defensive only, never expected to fire.
      if (!currentProduct) {
        return { ok: false, code: "REFERENCE_NOT_FOUND", message: "제품 정보를 확인할 수 없습니다." };
      }

      // The submitted triple may be partial (only the changed field(s)) —
      // merge with the product's current values before resolving, since
      // (model, lot, serial) is a single composite identity that must be
      // resolved as a whole, never one column at a time.
      const merged: ProductTriple = {
        modelName: "modelName" in fields ? (fields.modelName as string) : currentProduct.modelName,
        lotNumber: "lotNumber" in fields ? (fields.lotNumber as string) : (currentProduct.lotNumber ?? ""),
        serialNumber:
          "serialNumber" in fields ? (fields.serialNumber as string) : (currentProduct.serialNumber ?? ""),
        partNumber: "partNumber" in fields ? fields.partNumber : currentProduct.partNumber,
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
    return { ok: true, id: updated.id, version: updated.version };
  });
}
