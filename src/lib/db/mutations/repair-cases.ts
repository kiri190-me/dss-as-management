import "server-only";
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "../client";
import {
  domesticOrderDueDates,
  domesticOrders,
  endUsers,
  inventoryPartIssueRequests,
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
import { nextReportNumber, reportNumberYearDigit } from "@/lib/domain/repair-case-report-number";
import { toKstDateOnly } from "@/lib/domain/date-only";
import { isNotEarlierThan } from "@/lib/domain/local/validation";
import {
  resolveDomesticOrderDueDateWriteThrough,
  type RequestedDueDateLinkOutcome,
  type RequestedDueDateLinkPlan,
} from "@/lib/domain/requested-due-date-link";
import { deriveWorkflowType, workflowKindLabels, type WorkflowKind } from "@/lib/domain/workflow-kind";
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

/**
 * 가져오기 흔적(LEGACY_IMPORT_STATE_SET 이력)에 importBatchId · sourceRowNumber 와 함께 적는 것
 * (과거 인수품 가져오기, 2026-09-15). 🔴 고객 이름 같은 개인정보는 넣지 않는다 — 칸이 정해져 있고
 * 서비스(server/services/create-repair-case.ts 의 validLegacyImportMetadata)가 그 칸만 받는다.
 * 원문 글자(sourceStatus · sourceBilling · sourceReportedSymptom)는 50자 이하로 잘려 온다.
 */
export type LegacyImportMetadata = {
  source: "KYOSAN_INTAKE_LIST";
  fileSha256: string;
  billingReview: boolean;
  billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID" | null;
  sourceStatus: string | null;
  sourceBilling: string | null;
  /**
   * 신고증상의 **원문**(L열 `客先返却理由`). 수리 건에 들어가는 신고증상은 일본어 낱말을
   * 한글로 바꾼 글자라(domain/kyosan-intake-import/symptom-translation.ts), 바꾸기 전 글자를
   * 증거로 남긴다. 고객사가 적어 보낸 기술 용어이고 개인정보 칸이 아니다.
   */
  sourceReportedSymptom: string | null;
};

class CreateRepairCaseRollback extends Error {
  constructor(readonly result: CreateRepairCaseFailure) {
    super("CREATE_REPAIR_CASE_ROLLBACK");
  }
}

function rollbackCreate(result: CreateRepairCaseFailure): never {
  throw new CreateRepairCaseRollback(result);
}

/**
 * 보고서번호 자동 채번(2026-10-18 쓰는 분 결정) — **칸이 비어 있는 대화형 A/S
 * 접수에서만** 부른다. 번호 규칙 자체(앞자리 · 순번 · 2030년 · 999 초과 ·
 * 무엇을 세고 무엇을 빼는가)는 domain/repair-case-report-number.ts 가 DB 없이
 * 들고 있고, 여기는 **같은 트랜잭션 안에서 읽고 바로 쓰는 일**만 한다 —
 * 인수번호를 형식(local/intake-number.ts)과 채번(DB)으로 가른 것과 같다.
 *
 * 🔴 **이 칸에는 고유 제약이 없다.** 옛 엑셀 A열 값에 중복이 있을 수 있어
 * 일부러 걸지 않은 칸이고(마이그레이션 0038), 이번에도 걸지 않는다. 그래서 DB
 * 가 겹침을 막아 주지 않는다 — 읽기와 쓰기를 한 트랜잭션으로 묶어 창을 좁히는
 * 것까지가 이번에 한 일이고, **동시에 두 건이 들어오면 드물게 같은 번호가 날 수
 * 있다**(둘 다 커밋 전이라 서로가 새로 넣은 행을 보지 못한다). 그때는 사람이
 * 상세 화면의 보고서번호 칸에서 고치면 된다. 인수번호처럼 전용 순번 표
 * (repair_case_intake_sequences)로 완전히 막으려면 새 표가 필요하고, 그것은
 * 스키마 변경이라 이번 범위 밖이다.
 *
 * 🔴 **휴지통에 간 건의 번호도 센다**(is_deleted 를 거르지 않는다) — 빼면 그
 * 번호를 다시 쓰게 된다. 다만 휴지통에서 **영구 삭제**된 건
 * (repair-cases-purge.ts)의 번호는 표에서 사라지므로 다시 나갈 수 있다. 이
 * 칸만 보고는 그 이상 알 길이 없다.
 *
 * 🔴 **번호를 못 매겨도 접수는 성공한다.** null 을 내고 접수는 그대로 진행된다.
 * 조용히 비면 아무도 모른 채 몇 달이 지나므로 까닭을 서버 기록에 남긴다 —
 * 지금 구조에서 「왜 비었나」가 남는 유일한 자리다(접수 결과에는 보고서번호가
 * 실려 가지 않는다). 사람은 상세 화면의 보고서번호 칸이 비어 있는 것을 보고
 * 손으로 적으면 된다.
 */
async function allocateLegacyReportNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  intakeNumber: string
): Promise<string | null> {
  // 기준은 **오늘(한국 날짜)**이지 인수일이 아니다. 보고서번호는 접수를 등록한
  // 차례대로 나가는 번호이고, 「해가 바뀌면 001 부터」의 해도 등록한 해를
  // 뜻한다 — 2026-12-30 에 받아 2027-01-02 에 등록한 건은 7001 이다. 인수번호는
  // 반대로 인수일에서 뽑는다(아래 할당기 주석) — 일부러 다르다.
  const today = toKstDateOnly(new Date());
  const yearDigit = reportNumberYearDigit(today);

  // 매길 수 없는 해(2030년 등)면 조회조차 하지 않는다.
  const existing =
    yearDigit === null
      ? []
      : (
          await tx
            .select({ value: repairCases.legacyReportNumber })
            .from(repairCases)
            // 올해 앞자리로 시작하는 값만 끌어온다. 네 자리인지 · 숫자인지는
            // 순수 모듈이 다시 본다 — 좁히는 조건과 세는 조건이 갈라지면
            // 한쪽만 고쳤을 때 조용히 어긋난다.
            .where(like(repairCases.legacyReportNumber, `${yearDigit}%`))
        ).map((row) => row.value);

  const next = nextReportNumber(existing, today);
  if (next.ok) return next.reportNumber;

  console.warn(
    `[repair-cases] 보고서번호를 자동으로 매기지 못했습니다(${next.reason}) — ` +
      `인수번호 ${intakeNumber}, 기준일 ${today}. 접수는 정상 등록되었고 보고서번호만 비어 있습니다. ` +
      (next.reason === "YEAR_OUT_OF_RANGE"
        ? "2030년부터의 번호 규칙이 아직 정해지지 않았습니다."
        : "올해 순번 999를 모두 사용했습니다.") +
      " 상세 화면의 인수 정보에서 보고서번호를 직접 입력해 주세요."
  );
  return null;
}

export async function createRepairCase(
  input: ValidatedCreateRepairCaseInput,
  options: {
    /**
     * Excel 이관 전용 경로로 넘어오던 레거시 식별자다. 대화형 접수는 이
     * 옵션을 쓰지 않고 검증된 입력(input.legacyReportNumber)으로 같은
     * 컬럼을 채우며, 그마저 비어 있으면 자동으로 매긴다 — 아래 채번
     * 우선순위 주석 참고.
     */
    legacyReportNumber?: string | null;
    legacyImportState?: {
      targetStepKey: string;
      actualShipmentDate: string | null;
      actorUserId: string;
      batchId: string;
      sourceRowNumber: number;
      metadata?: LegacyImportMetadata;
      /** 새 모델을 만들게 될 때만 쓰는 종류(intake-master-resolution.ts 의 kindForNew). */
      productModelKindForNew?: WorkflowKind;
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
        kindForNew: options.legacyImportState?.productModelKindForNew ?? null,
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

    // 보고서번호 — ① 사람이 적어 보낸 값 ② Excel 이관 경로의 옵션 ③ 자동 채번.
    // 🔴 **자동은 ①②가 비었을 때만**이다(손으로 적은 값을 덮지 않는다).
    //
    // 🔴 **과거 이관(legacyImportState)에는 자동으로 매기지 않는다.** 이관되는
    // 줄의 보고서번호는 옛 엑셀 `목록` A열이 들고 오는 **과거** 번호이고, 비어
    // 있는 줄에 올해 번호를 찍으면 몇 해 전 건이 올해 순번을 먹는다. 비어 있는
    // 채로 들어가던 예전 동작 그대로 둔다.
    //
    // 자동 채번은 이 트랜잭션 안에서 읽고 바로 아래 INSERT 로 쓴다 —
    // allocateLegacyReportNumber 의 주석(겹침 · 휴지통 · 못 매길 때) 참고.
    const manualReportNumber = input.legacyReportNumber ?? options.legacyReportNumber ?? null;
    const legacyReportNumber =
      manualReportNumber ??
      (options.legacyImportState ? null : await allocateLegacyReportNumber(tx, intakeNumber));

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
            // 보고서번호 — 바로 위에서 정해진 값(수기 → 이관 옵션 → 자동 채번).
            legacyReportNumber,
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

      // 가져오기 흔적 — legacyImportState 가 있으면 **언제나** 한 줄(2026-09-15). 예전에는 대상
      // 단계가 인수점검이 아닐 때만 남겼는데, 인수점검에 놓이는 줄(受付·調査完了)도 가져온 건이라는
      // 사실과 metadata(유/무상 확인 필요 등)가 남아야 해서 from = to 도 적는다(CHECK 없음, 이력
      // 화면은 이미 처리한다). 대화형 접수는 legacyImportState 가 없으므로 달라지지 않는다.
      if (options.legacyImportState) {
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
            ...(options.legacyImportState.metadata ?? {}),
          },
        });
      }

      // 수기 인수번호는 월 순번을 올리지 않는다(위 할당기를 건너뛴다) — 과거 번호를 가져온 채로
      // 두면 다음 정상 접수가 그 번호와 부딪힌다. 그래서 가져오기일 때만 그 달의 순번을
      // GREATEST 로 끌어올린다(내려가지는 않는다). 같은 트랜잭션이라 이 건이 롤백되면 같이
      // 되돌아간다. 대화형 수기 번호의 같은 틈은 이번 범위 밖이다(손대지 않았다).
      if (options.legacyImportState && input.intakeNumber) {
        await tx
          .insert(repairCaseIntakeSequences)
          .values({ yearMonth: intakeNumber.slice(1, 5), lastSequence: Number(intakeNumber.slice(5, 7)) })
          .onConflictDoUpdate({
            target: repairCaseIntakeSequences.yearMonth,
            set: {
              lastSequence: sql`GREATEST(${repairCaseIntakeSequences.lastSequence}, excluded.last_sequence)`,
              updatedAt: sql`now()`,
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
  | {
      ok: true;
      id: string;
      version: number;
      /**
       * 🔴 이번 저장이 **내자 정리의 납기요청일까지 맞췄는가**(2026-10-30).
       * 없으면 맞출 일이 없었다는 뜻이다(고객 요청 납기일을 안 건드렸거나,
       * 연결된 내자 줄에 고칠 날짜 행이 없다 — 그때는 내자 쪽이 이 건의 날짜를
       * 빌려 그리므로 보이는 날짜가 이미 같다).
       *
       * `linked: false` 는 **저장은 됐는데 상대가 안 따라갔다**는 뜻이고, 화면은
       * 그 까닭을 읽어야 닫히는 알림으로 띄운다 — 조용히 버리면 사람은 양쪽이
       * 맞춰진 줄 안다(domain/requested-due-date-link.ts 머리말 ④).
       */
      requestedDueDateLink?: RequestedDueDateLinkOutcome;
    }
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
 * ============================================================================
 * 🔴 고객 요청 납기일을 고치면 **내자 정리의 납기요청일도 함께** (2026-10-30)
 * ============================================================================
 * 무엇을 할지 정하는 규칙은 여기 없다 — domain/requested-due-date-link.ts 의
 * resolveDomesticOrderDueDateWriteThrough 하나가 가지고, 거울 방향(내자 →
 * 수리 건)도 그 파일의 짝을 부른다. 이 함수가 하는 일은 **재료를 읽어 와 넘기고,
 * 고칠 행의 id 를 들고 돌아오는 것**뿐이다.
 *
 * ── 🔴 왜 여기서 **잠그는가** ───────────────────────────────────────────
 * 거울 방향(mutations/domestic-orders.ts)은 내자 줄을 먼저 `FOR UPDATE` 로 잡고
 * 그다음에 repair_cases 를 고친다. 이쪽이 repair_cases 를 먼저 고치고 내자 줄을
 * 나중에 잡으면 **잠그는 차례가 정반대**가 되어, 두 사람이 같은 건을 동시에 고칠 때
 * 교착이 난다. 그래서 이 함수는 repair_cases UPDATE **전에** 불리고, 실제로 날짜를
 * 쓰는 일만 UPDATE 가 성공한 뒤로 미룬다(아래 호출부).
 *
 * ── 🔴 왜 **쓰기를 여기서 하지 않는가** ──────────────────────────────────
 * 이 트랜잭션은 version 이 어긋나면 **결과를 돌려주며 끝난다**(예외를 던지지
 * 않는다 — 그때 드리즐은 커밋한다). 그 길에서 날짜를 이미 바꿔 놓았으면, 수리 건은
 * 안 바뀌었는데 내자 줄만 바뀐 상태가 남는다. 그래서 쓰기는 UPDATE 가 1행을
 * 돌려준 뒤에만 한다(유·무상 이력을 그 뒤에 넣는 것과 같은 까닭).
 * ============================================================================
 */
type DomesticOrderDueDateLinkWork = {
  plan: RequestedDueDateLinkPlan;
  /** 고칠 **납기요청일 행**의 id. WRITE 일 때만 있다. */
  dueDateRowId: string | null;
  /** 그 행이 달려 있는 **내자 줄**의 id. 그 줄의 version 도 함께 올려야 한다. */
  domesticOrderId: string | null;
};

async function planDomesticOrderDueDateLink(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: { repairCaseId: string; previous: string | null; next: string | null }
): Promise<DomesticOrderDueDateLinkWork> {
  // 지워진 줄은 세지 않는다 — 화면 어디에도 없는 줄이 「여럿이라 못 묶는다」를
  // 만들면 안 된다(domestic-order-issue-dates.ts 의 같은 판단).
  const lines = await tx
    .select({ id: domesticOrders.id })
    .from(domesticOrders)
    .where(
      and(eq(domesticOrders.repairCaseId, params.repairCaseId), eq(domesticOrders.isDeleted, false))
    )
    .for("update");

  const rows =
    lines.length === 0
      ? []
      : await tx
          .select({
            id: domesticOrderDueDates.id,
            domesticOrderId: domesticOrderDueDates.domesticOrderId,
          })
          .from(domesticOrderDueDates)
          .where(
            inArray(
              domesticOrderDueDates.domesticOrderId,
              lines.map((line) => line.id)
            )
          );

  const plan = resolveDomesticOrderDueDateWriteThrough({
    previousCustomerRequestedDueDate: params.previous,
    nextCustomerRequestedDueDate: params.next,
    lines: lines.map((line) => ({
      dueDateCount: rows.filter((row) => row.domesticOrderId === line.id).length,
    })),
  });

  if (plan.kind !== "WRITE") return { plan, dueDateRowId: null, domesticOrderId: null };

  // WRITE 는 「줄 하나 · 날짜 하나」라는 뜻이라 rows 가 꼭 하나다(같은 수로 판정했다).
  // 그래도 한 번 더 보는 것은, 여기서 틀리면 **엉뚱한 줄의 날짜**가 바뀌기 때문이다.
  // 🔴 걸리면 **아무 일도 없었던 것으로** 돌려준다 — 결과는 「맞췄다」고 말하는데
  // 실제로는 아무 행도 안 바뀐 상태가 제일 나쁘다(사람이 확인할 길이 없다).
  if (rows.length !== 1) {
    return { plan: { kind: "NONE" }, dueDateRowId: null, domesticOrderId: null };
  }
  return { plan, dueDateRowId: rows[0].id, domesticOrderId: rows[0].domesticOrderId };
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
 * isLocked, delayReason are never referenced anywhere in this function —
 * they cannot be changed through this action no matter what the caller
 * submits, because no section's field list includes them.
 *
 * actualShipmentDate(실제 출하일)는 2026-10-18부터 예외다 — INTAKE 섹션
 * 필드 목록에 들어갔고 아래에서 조건부로 고칠 수 있다. 다만 다른 칸들처럼
 * 자유롭게 바뀌지 않는다. 세 가지 규칙이 전부 이 함수 안에 있다:
 *   1. **이미 출하 완료된 건만** — 저장된 actual_shipment_date가 NULL이면
 *      거부한다. 날짜를 처음 적어 넣는 일은 워크플로의 출하 완료 처리
 *      (workflow-transitions.ts)만 할 수 있다. 이 경로는 **이미 일어난 일의
 *      날짜를 바로잡는 것**뿐이다.
 *   2. **비울 수 없다** — 형식 검증이 required 날짜로 받으므로(repair-case-
 *      update-input.ts의 normalizeRequiredDate) 빈 값/null은 여기까지 오지
 *      못하며, 혹시 와도 아래에서 거부한다.
 *   3. **인수일보다 이를 수 없다** — 다른 날짜 칸들과 같은 선후 검증이다.
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
        // 실제 출하일 — 값 자체가 "이미 출하 완료된 건인가"의 판정 근거다
        // (NULL이면 아직 출하 전이라 이 경로로는 적을 수 없다).
        actualShipmentDate: repairCases.actualShipmentDate,
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
    /**
     * 🔴 내자 정리의 납기요청일을 **이 저장과 함께 맞출 것인가**(2026-10-30).
     * 고객 요청 납기일이 실제로 바뀔 때만 채워지고, 쓰는 일은 UPDATE 가 성공한
     * 뒤에 일어난다 — 그 전까지는 **읽고 잠근 결과**일 뿐이다.
     */
    let requestedDueDateLink: DomesticOrderDueDateLinkWork | null = null;
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

        // 🔴 내자 정리의 납기요청일도 같은 날짜로 맞춘다(2026-10-30 사용자 결정 —
        // 「어느 쪽에서 수정하든 같은 날짜를 보고 있을 수 있도록」). 여기서는
        // **읽고 잠그기만** 하고, 쓰는 일은 아래 UPDATE 가 성공한 뒤다
        // (planDomesticOrderDueDateLink 머리말의 두 까닭).
        //
        // 🔵 **안 바뀐 저장은 아무 일도 하지 않는다** — 이 폼은 고칠 수 있는 칸을
        // 늘 함께 보내므로 날짜를 건드리지 않은 저장도 여기까지 온다. 그 판정은
        // 도메인이 한다(전·후 값을 함께 넘기는 까닭).
        //
        // 🔵 **출하 잠금은 여기서 보지 않는다** — 이 경로 자체가 잠긴 건을 막지
        // 않는다(auth/repair-case-edit-authorization.ts 의 isBlockedByShipmentLock
        // 은 지금 언제나 거짓이다). 여기서만 막으면 수리 건 편집보다 좁은 규칙이
        // 이 한 칸에만 생긴다.
        requestedDueDateLink = await planDomesticOrderDueDateLink(tx, {
          repairCaseId,
          previous: current.customerRequestedDueDate,
          next: due,
        });
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

      // 실제 출하일 — 위 세 날짜 칸과 달리 **현재 저장된 값**이 먼저 조건이다
      // (함수 머리말 참조). 셋을 차례로 본다: 출하 완료된 건인가 → 비우려는
      // 것은 아닌가 → 인수일보다 이르지 않은가.
      if ("actualShipmentDate" in fields) {
        const shipped = fields.actualShipmentDate;
        if (!current.actualShipmentDate) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: {
              actualShipmentDate: "아직 출하 완료되지 않은 건입니다. 실제 출하일은 출하 완료 처리로 적힙니다.",
            },
            message: "입력값을 확인해 주세요.",
          };
        }
        // 빈 문자열도 "지우려는 것"으로 본다 — 선후 검증에 그냥 흘려보내면
        // ""는 어떤 날짜보다도 작아서 "인수일보다 이전일 수 없습니다"로
        // 거부되는데, 사람이 읽기에 까닭이 엉뚱하다.
        if (shipped === null || shipped === "") {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { actualShipmentDate: "실제 출하일은 비울 수 없습니다." },
            message: "입력값을 확인해 주세요.",
          };
        }
        if (!isNotEarlierThan(shipped, effectiveReceivedAt)) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { actualShipmentDate: "실제 출하일은 인수일보다 이전일 수 없습니다." },
            message: "입력값을 확인해 주세요.",
          };
        }
        setValues.actualShipmentDate = shipped;
      }

      // 우선순위 — NOT NULL 컬럼이라 다른 날짜 필드처럼 인수일과의 선후 관계
      // 검증이 필요 없다. billingType처럼 워크플로/게이트에도 영향을 주지
      // 않는 순수 값 교체다.
      if ("priority" in fields) setValues.priority = fields.priority;

      // 보고서번호 — 접수할 때는 자동으로 매겨지지만(allocateLegacyReportNumber),
      // 이 수정 경로에는 자동 채번이 없다. 형식 규칙도 없어 적어 보낸 값을 그대로
      // 넣고 다른 값과의 정합성 검사도 하지 않는다(연락처 필드들과 같은 순수 값
      // 교체다) — 비워 보내 null이 되어도 다시 매겨 주지 않는다.
      if ("legacyReportNumber" in fields) setValues.legacyReportNumber = fields.legacyReportNumber;

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
      // 만들지 않는다).
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
      // 종류를 바꿀 수 있는 현재 워크플로 — 매쳐와 제너레이터의 유·무상 조합
      // 넷이다. 2026-08-19에 레거시 "MATCHER"(Matcher (기존 이력))가 없어지면서
      // 그 자리를 PAID_MATCHER/WARRANTY_MATCHER가 대신한다. 둘을 넣지 않으면
      // 제너레이터 → 매쳐로 바꾼 건이 다시는 되돌아오지 못하는 한쪽 문이 된다.
      // Total Controller는 예전과 같이 아직 대상이 아니다(아래에서 따로 거절).
      if ("workflowKind" in fields) {
        const REASSIGNABLE_FROM = ["PAID_MATCHER", "WARRANTY_MATCHER", "PAID_GENERATOR", "WARRANTY_GENERATOR"];
        if (!REASSIGNABLE_FROM.includes(current.workflowType)) {
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
        // 매쳐도 제너레이터와 같은 규칙으로 유·무상을 따라 간다. 예전에는
        // 매쳐만 레거시 "MATCHER"로 보내 유·무상과 무관했는데, 그 워크플로가
        // 없어졌으므로(2026-08-19) 이제 종류 세 개가 전부 같은 유도 규칙을 쓴다.
        const targetWorkflowType = deriveWorkflowType(kind, current.billingType);
        if (!targetWorkflowType) {
          const kindLabel = workflowKindLabels[kind];
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            fieldErrors: { billingType: `유상/무상이 설정되지 않아 ${kindLabel}로 변경할 수 없습니다.` },
            message: `유상/무상이 설정되지 않아 ${kindLabel}로 변경할 수 없습니다. 인수정보에서 유상/무상을 먼저 선택한 후 다시 시도해 주세요.`,
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

    // 🔴 내자 정리의 납기요청일 **한 행의 날짜만** 고친다(2026-10-30). 행을 지우지도
    // 만들지도 않는다 — 지우면 그 행의 비고가 함께 사라지고(운영에 5행 있다), 만들면
    // 「발주서에 적힌 날짜」가 아닌 것이 그 줄에 박제된다
    // (domain/requested-due-date-link.ts 머리말 ③).
    if (requestedDueDateLink?.plan.kind === "WRITE" && requestedDueDateLink.dueDateRowId) {
      await tx
        .update(domesticOrderDueDates)
        .set({ dueDate: requestedDueDateLink.plan.dueDate, updatedAt: new Date() })
        .where(eq(domesticOrderDueDates.id, requestedDueDateLink.dueDateRowId));
      // 🔴 그 줄의 version 도 올린다. 안 올리면 **열려 있던 내자 정리 화면**이 낡은
      // version 으로 저장해도 통과하고, 그 저장이 방금 맞춘 날짜를 제 옛 목록으로
      // 되돌린다(그 화면은 칸 하나를 고쳐도 줄 전체를 다시 보낸다).
      if (requestedDueDateLink.domesticOrderId) {
        await tx
          .update(domesticOrders)
          .set({
            version: sql`${domesticOrders.version} + 1`,
            updatedAt: new Date(),
            // 통합 테스트의 옛 호출부는 행위자를 넘기지 않는다(이 함수의 선택 인자).
            // 그때는 마지막으로 고친 사람을 **지우지 않고** 그대로 둔다.
            ...(actorUserId ? { updatedBy: actorUserId } : {}),
          })
          .where(eq(domesticOrders.id, requestedDueDateLink.domesticOrderId));
      }
    }

    return {
      ok: true,
      id: updated.id,
      version: updated.version,
      // 할 일이 없었으면(NONE) 아예 싣지 않는다 — 화면이 「무슨 일이 있었다」로 읽지
      // 않게. 맞췄을 때와 못 맞췄을 때만 말한다.
      ...(requestedDueDateLink && requestedDueDateLink.plan.kind !== "NONE"
        ? {
            requestedDueDateLink:
              requestedDueDateLink.plan.kind === "WRITE"
                ? ({ linked: true } as const)
                : requestedDueDateLink.plan.outcome,
          }
        : {}),
    };
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
 * 영구 삭제된 접수 건을 가리키던 직접 사용 기록에 채워 넣는 사용처 문구.
 *
 * 🔴 재고 장부(stock_transactions)와 불출 신청(inventory_part_issue_requests)이
 * **이 함수 하나**에서 문구를 받는다 — 두 곳에 글자로 적으면 언젠가 한쪽만
 * 바뀌어, 같은 접수 건에서 나간 부품이 두 화면에 다른 이름으로 남는다.
 * 인수번호만 담는다(연락처 등 PII 는 넣지 않는다) — 접수 건 행이 사라진 뒤에도
 * 「어느 건이었나」를 사람이 짚어 갈 수 있는 유일한 단서다.
 */
function purgedRepairCaseDestinationNote(intakeNumber: string): string {
  return `영구 삭제된 접수 건 (인수번호: ${intakeNumber})`;
}

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
 *  6. backfill destination_note, with the one non-PII, identifiable
 *     reference purgedRepairCaseDestinationNote builds (the intake number),
 *     on the two direct-use tables whose "must say where it went" CHECK
 *     would otherwise break once step 7's DELETE fires their repair_case_id
 *     ON DELETE SET NULL action — only where it's still NULL in both (an
 *     existing operator-entered note is never overwritten):
 *     6a. stock_transactions — USE rows only — so
 *         stock_transactions_use_has_destination still holds (migration 0031).
 *     6b. inventory_part_issue_requests — direct-use requests
 *         (part_request_id NULL), whatever their status — so
 *         inventory_part_issue_requests_direct_use_has_destination still
 *         holds (migration 0090). A request picked against a case carries
 *         only repair_case_id, so without this one pending/approved/executed
 *         request would roll the whole purge back.
 *  7. DELETE the repair_cases row — the 7 preserved history/accounting
 *     tables (status_change_histories, repair_case_approvals,
 *     procedure_case_executions, stock_transactions, inventory_part_requests,
 *     inventory_part_issue_requests, repair_case_work_records) go to
 *     repair_case_id = NULL automatically via their own ON DELETE SET NULL
 *     action; nothing here deletes a single row in any of them, or rewrites
 *     one beyond step 6's destination_note backfill (an issue request's
 *     items and approval rows hang off the request, not the case, and are
 *     never touched), nor anything in products/product_models/
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

    // 6a·6b 가 **같은 문구**를 받는다 — 한 번만 만든다.
    const purgedCaseDestinationNote = purgedRepairCaseDestinationNote(current.intakeNumber);

    // 6a. Never overwrites an existing destinationNote (operator-entered text
    // stays authoritative) — only backfills the rows that would otherwise
    // violate stock_transactions_use_has_destination once repair_case_id
    // goes NULL below. RECEIPT/RETURN rows are never touched: repair_case_id
    // is "USE only" by design (schema comment) and the CHECK itself only
    // ever applies to USE.
    await tx
      .update(stockTransactions)
      .set({ destinationNote: purgedCaseDestinationNote })
      .where(
        and(
          eq(stockTransactions.repairCaseId, params.id),
          eq(stockTransactions.transactionType, "USE"),
          isNull(stockTransactions.destinationNote)
        )
      );

    // 6b. 불출 신청도 같은 모양의 CHECK 을 가진다
    // (inventory_part_issue_requests_direct_use_has_destination) — 접수 건을
    // 골라 올린 직접 사용 신청은 repair_case_id 만 들고 사용처가 NULL 이 정상이라,
    // 아래 DELETE 의 SET NULL 이 세 칸을 모두 비우는 순간 CHECK 에 걸려 영구 삭제가
    // 통째로 되돌아간다. 위 장부 줄과 같은 규칙으로 막는다:
    //  · 운영자가 적은 사용처는 덮지 않는다(NULL 인 행만).
    //  · 상태는 가리지 않는다 — 결재 중·실행 대기인 신청은 삭제 뒤에도 이 사용처로
    //    실행될 수 있어야 하고, 끝난 신청(EXECUTED·REJECTED·CANCELLED)도 CHECK 은
    //    똑같이 걸린다.
    //  · `part_request_id IS NULL` 은 방어선이다 — 요청 기반 신청은 표의
    //    direct_use_columns_only_when_direct CHECK 상 repair_case_id 가 언제나
    //    NULL 이라 여기 잡힐 수 없고, 잡혀서 사용처가 채워지면 오히려 그 CHECK 에
    //    걸린다. 장부 쪽의 `transaction_type = 'USE'` 와 같은 자리다.
    //  · updated_at 을 함께 올린다 — 이 표의 모든 갱신(결재·취소·실행)이 그렇게
    //    한다. 사용처가 실제로 바뀐 행이다.
    await tx
      .update(inventoryPartIssueRequests)
      .set({ destinationNote: purgedCaseDestinationNote, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryPartIssueRequests.repairCaseId, params.id),
          isNull(inventoryPartIssueRequests.partRequestId),
          isNull(inventoryPartIssueRequests.destinationNote)
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
