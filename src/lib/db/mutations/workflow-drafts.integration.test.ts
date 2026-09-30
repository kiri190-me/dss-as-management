import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  products,
  repairCases,
  statusChangeHistories,
  users,
  workflowSteps,
  workflowTemplates,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import {
  WORKFLOW_APPLY_AUDIT_ACTION,
  applyCurrentWorkflowVersionToCases,
  createWorkflowDraft,
  discardWorkflowDraft,
  findWorkflowDraft,
  publishWorkflowDraft,
} from "./workflow-drafts";
import { getWorkflowTemplateDetail } from "../queries/workflow-templates";

/**
 * 발행은 이 프로젝트에서 가장 위험한 쓰기다 — 잘못 나가면 그 워크플로의 접수
 * 건이 전부 멈춘다. 그래서 "되는 경로"보다 **막혀야 할 경로**를 더 촘촘히
 * 고정한다.
 *
 * 대상 워크플로는 WARRANTY_TOTAL_CONTROLLER 하나로 고정한다. 각 테스트는 자기가
 * 만든 초안을 정리하며, 발행 테스트는 원래 발행본을 다시 current로 되돌린다 —
 * 이 DB의 다른 통합 테스트가 워크플로 구성에 의존하기 때문이다.
 */

const TEMPLATE_CODE = "WARRANTY_TOTAL_CONTROLLER";

let adminId: string;
let salesId: string;
let templateId: string;
let originalCurrentVersionId: string;
const createdVersionIds: string[] = [];

before(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(admin, "승인된 SUPER_ADMIN이 필요합니다");
  adminId = admin.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "승인된 SALES가 필요합니다");
  salesId = sales.id;

  const [template] = await db
    .select({ id: workflowTemplates.id })
    .from(workflowTemplates)
    .where(eq(workflowTemplates.code, TEMPLATE_CODE));
  assert.ok(template);
  templateId = template.id;

  const [current] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
  assert.ok(current, "현재 발행 버전이 있어야 합니다");
  originalCurrentVersionId = current.id;
});

after(async () => {
  // 이 테스트가 만든 버전을 전부 지우고, 원래 발행본을 current로 되돌린다.
  for (const id of createdVersionIds) {
    await db.delete(workflowTransitions).where(eq(workflowTransitions.workflowVersionId, id));
    await db.delete(workflowSteps).where(eq(workflowSteps.workflowVersionId, id));
  }
  if (createdVersionIds.length > 0) {
    await db.delete(workflowVersions).where(inArray(workflowVersions.id, createdVersionIds));
  }
  await db
    .update(workflowVersions)
    .set({ status: "PUBLISHED", isCurrent: true })
    .where(eq(workflowVersions.id, originalCurrentVersionId));
  await pgClient.end({ timeout: 5 });
});

async function makeDraft() {
  const result = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: adminId });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  createdVersionIds.push(result.versionId);
  return result;
}

describe("workflow drafts", () => {
  test("초안 생성: 현재 발행본의 단계와 이동 규칙을 그대로 복제한다", async () => {
    const [sourceStepCount] = await db
      .select({ n: workflowSteps.id })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, originalCurrentVersionId))
      .limit(1);
    assert.ok(sourceStepCount, "원본에 단계가 있어야 한다");

    const sourceSteps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, originalCurrentVersionId));
    const sourceTransitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, originalCurrentVersionId));

    const draft = await makeDraft();

    const draftSteps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowVersionId, draft.versionId));
    const draftTransitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, draft.versionId));

    assert.equal(draftSteps.length, sourceSteps.length, "단계 수가 같아야 한다");
    assert.equal(draftTransitions.length, sourceTransitions.length, "이동 규칙 수가 같아야 한다");
    assert.deepEqual(
      draftSteps.map((s) => `${s.key}:${s.stepOrder}:${s.repairStatus}:${s.category}:${s.isActive}`).sort(),
      sourceSteps.map((s) => `${s.key}:${s.stepOrder}:${s.repairStatus}:${s.category}:${s.isActive}`).sort(),
      "단계의 내용까지 같아야 한다 — 편집자는 지금 돌아가는 그대로에서 시작해야 한다"
    );

    // 복제본은 원본과 다른 행이어야 한다(같은 행을 가리키면 초안 편집이 발행본을 바꾼다).
    const sourceIds = new Set(sourceSteps.map((s) => s.id));
    assert.equal(draftSteps.some((s) => sourceIds.has(s.id)), false);
  });

  test("초안은 템플릿당 하나만 만들 수 있다", async () => {
    // 앞 테스트가 이미 초안을 하나 만들어 두었다.
    const existing = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(existing, "이 시점에 초안이 있어야 한다");

    const second = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: adminId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "DRAFT_ALREADY_EXISTS");
  });

  test("영업 담당자는 초안을 만들 수도 발행할 수도 없다", async () => {
    const draft = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(draft);

    const created = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: salesId });
    assert.equal(created.ok, false);
    if (!created.ok) assert.equal(created.code, "FORBIDDEN");

    const published = await publishWorkflowDraft({ versionId: draft.id, actorUserId: salesId });
    assert.equal(published.ok, false);
    if (!published.ok) assert.equal(published.code, "FORBIDDEN");

    const discarded = await discardWorkflowDraft({ versionId: draft.id, actorUserId: salesId });
    assert.equal(discarded.ok, false);
    if (!discarded.ok) assert.equal(discarded.code, "FORBIDDEN");
  });

  test("구조가 깨진 초안은 발행이 거부된다", async () => {
    const draft = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(draft);

    // 신규 접수가 배치되는 단계를 지우면 A/S 접수 자체가 실패한다.
    // 전이가 먼저 참조하므로 그 전이부터 지운다.
    const [intakeStep] = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowVersionId, draft.id), eq(workflowSteps.key, "intake_inspection")));
    assert.ok(intakeStep);
    await db.delete(workflowTransitions).where(eq(workflowTransitions.workflowVersionId, draft.id));
    await db.delete(workflowSteps).where(eq(workflowSteps.id, intakeStep.id));

    const result = await publishWorkflowDraft({ versionId: draft.id, actorUserId: adminId });
    assert.equal(result.ok, false, "검증을 통과하지 못해야 한다");
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_FAILED");
      assert.ok(result.issues?.some((i) => i.code === "MISSING_START_STEP"), JSON.stringify(result.issues));
    }

    // 거부됐으니 상태가 그대로여야 한다 — 실패한 발행이 절반만 적용되면 안 된다.
    const [after] = await db
      .select({ status: workflowVersions.status, isCurrent: workflowVersions.isCurrent })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, draft.id));
    assert.equal(after.status, "DRAFT");
    assert.equal(after.isCurrent, false);

    const [stillCurrent] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    assert.equal(stillCurrent.id, originalCurrentVersionId, "기존 발행본이 그대로 current여야 한다");
  });

  test("깨진 초안은 폐기할 수 있고, 폐기 후에는 새 초안을 만들 수 있다", async () => {
    const draft = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(draft);
    const result = await discardWorkflowDraft({ versionId: draft.id, actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [gone] = await db.select({ id: workflowVersions.id }).from(workflowVersions).where(eq(workflowVersions.id, draft.id));
    assert.equal(gone, undefined, "버전 행이 남아 있으면 안 된다");
    assert.equal(await findWorkflowDraft(TEMPLATE_CODE), null);
  });

  test("정상 초안은 발행되고, 기존 발행본은 보관 상태로 내려간다", async () => {
    const draft = await makeDraft();

    const result = await publishWorkflowDraft({ versionId: draft.versionId, actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.archivedVersionId, originalCurrentVersionId);

    const [published] = await db
      .select({ status: workflowVersions.status, isCurrent: workflowVersions.isCurrent, publishedAt: workflowVersions.publishedAt })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, draft.versionId));
    assert.equal(published.status, "PUBLISHED");
    assert.equal(published.isCurrent, true);
    assert.ok(published.publishedAt, "발행 시각이 기록되어야 한다");

    const [archived] = await db
      .select({ status: workflowVersions.status, isCurrent: workflowVersions.isCurrent })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, originalCurrentVersionId));
    assert.equal(archived.status, "ARCHIVED");
    assert.equal(archived.isCurrent, false);

    // 템플릿당 current는 정확히 하나여야 한다(부분 유니크 인덱스가 강제하지만,
    // 발행 순서가 잘못되면 인덱스 위반으로 트랜잭션이 통째로 실패한다).
    const currents = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    assert.equal(currents.length, 1);
  });

  test("이미 발행된 버전은 다시 발행할 수 없다", async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    const result = await publishWorkflowDraft({ versionId: current.id, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_A_DRAFT");
  });

  test("발행된 버전은 폐기할 수 없다", async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    const result = await discardWorkflowDraft({ versionId: current.id, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_A_DRAFT");
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 발행 시 접수 건 이관 (2026-09-30)
 * ────────────────────────────────────────────────────────────────────────
 * 접수 건 넷을 같은 옛 버전에 세워 두고 **한 번만 발행한 뒤** 넷의 행방을
 * 각각 확인한다. 넷을 따로 발행해 보지 않는 이유는, 실제로 위험한 것이
 * "하나를 옮기는가"가 아니라 **한 번의 발행이 옮겨도 되는 것만 골라 옮기는가**
 * 이기 때문이다 — 섞여 있을 때만 드러나는 실수다.
 *
 * 접수 건은 createRepairCase를 거치지 않고 직접 넣는다. 여기서 필요한 것은
 * "특정 버전의 특정 단계에 서 있는 행"뿐이고, 접수 경로는 항상 current
 * 버전의 시작 단계에만 건을 놓으므로 옛 버전에 세울 수가 없다.
 *
 * 정리 규칙은 다른 통합 테스트와 같다 — 접수번호 접두사 "D9703"과 모델 접두사
 * 하나만 쓰고, 옛 버전에 끼워 넣은 단계까지 직접 지운다.
 */

const MIGRATION_INTAKE_PREFIX = "D9703";
const MIGRATION_MODEL_PREFIX = "WFMIGRATE-TEST-";
/** 옛 버전에만 있는 단계. 초안을 복제한 **뒤에** 끼워 넣어야 새 버전에 없다. */
const OLD_ONLY_STEP_KEY = "wfmigrate_test_only_step";

describe("발행 시 진행 중인 접수 건 이관", () => {
  let oldVersionId: string;
  let newVersionId: string;
  let oldOnlyStepId: string;
  let oldIntakeStepId: string;
  let oldShipmentStepId: string;
  let inFlightCaseId: string;
  let shippedCaseId: string;
  let deletedCaseId: string;
  let strandedCaseId: string;
  let publishResult: Awaited<ReturnType<typeof publishWorkflowDraft>>;

  async function makeCase(params: {
    sequence: string;
    stepId: string;
    deleted?: boolean;
  }): Promise<string> {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.isDeleted, false))
      .limit(1);
    assert.ok(customer, "삭제되지 않은 고객이 최소 1건 필요합니다");

    const [product] = await db
      .insert(products)
      .values({ modelName: `${MIGRATION_MODEL_PREFIX}${params.sequence}` })
      .returning({ id: products.id });

    const [row] = await db
      .insert(repairCases)
      .values({
        intakeNumber: `${MIGRATION_INTAKE_PREFIX}${params.sequence}`,
        customerId: customer.id,
        productId: product.id,
        workflowVersionId: oldVersionId,
        currentWorkflowStepId: params.stepId,
        receivedAt: "2097-03-10",
        isDeleted: params.deleted ?? false,
        deletedAt: params.deleted ? new Date() : null,
      })
      .returning({ id: repairCases.id });
    return row.id;
  }

  async function fetchCase(id: string) {
    const [row] = await db
      .select({
        workflowVersionId: repairCases.workflowVersionId,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
      })
      .from(repairCases)
      .where(eq(repairCases.id, id));
    assert.ok(row, "접수 건이 있어야 한다");
    return row;
  }

  before(async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    assert.ok(current, "현재 발행 버전이 있어야 합니다");
    oldVersionId = current.id;

    // 초안(= 새 버전이 될 것)을 **먼저** 복제한다.
    const draft = await makeDraft();
    newVersionId = draft.versionId;

    // 복제가 끝난 뒤에 옛 버전에만 있는 단계를 끼워 넣는다. 순서를 바꾸면
    // 이 단계가 초안에도 복사되어 "갈 곳 없는 건"을 만들 수 없다.
    const [oldOnly] = await db
      .insert(workflowSteps)
      .values({
        workflowVersionId: oldVersionId,
        stepOrder: 9901,
        key: OLD_ONLY_STEP_KEY,
        label: "이관 테스트 전용 단계",
        repairStatus: "IN_REPAIR",
        category: "TECHNICAL",
      })
      .returning({ id: workflowSteps.id });
    oldOnlyStepId = oldOnly.id;

    const oldSteps = await db
      .select({ id: workflowSteps.id, key: workflowSteps.key })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, oldVersionId));
    const oldStepIdByKey = new Map(oldSteps.map((s) => [s.key, s.id]));
    const intake = oldStepIdByKey.get("intake_inspection");
    const shipment = oldStepIdByKey.get("shipment_completed");
    assert.ok(intake, "옛 버전에 intake_inspection 단계가 있어야 합니다");
    assert.ok(shipment, "옛 버전에 shipment_completed 단계가 있어야 합니다");
    oldIntakeStepId = intake;
    oldShipmentStepId = shipment;

    inFlightCaseId = await makeCase({ sequence: "01", stepId: oldIntakeStepId });
    shippedCaseId = await makeCase({ sequence: "02", stepId: oldShipmentStepId });
    deletedCaseId = await makeCase({ sequence: "03", stepId: oldIntakeStepId, deleted: true });
    strandedCaseId = await makeCase({ sequence: "04", stepId: oldOnlyStepId });

    publishResult = await publishWorkflowDraft({ versionId: newVersionId, actorUserId: adminId });
  });

  after(async () => {
    await db.delete(repairCases).where(like(repairCases.intakeNumber, `${MIGRATION_INTAKE_PREFIX}%`));
    await db.delete(products).where(like(products.modelName, `${MIGRATION_MODEL_PREFIX}%`));
    // 옛 버전은 파일 맨 아래 after가 지우는 목록에 들어 있을 수도, 아닐 수도
    // 있다(앞 테스트가 무엇을 발행했느냐에 달렸다). 끼워 넣은 것은 직접 치운다.
    if (oldOnlyStepId) await db.delete(workflowSteps).where(eq(workflowSteps.id, oldOnlyStepId));
  });

  test("진행 중인 건이 새 판으로 옮겨진다", async () => {
    assert.equal(publishResult.ok, true, JSON.stringify(publishResult));

    const moved = await fetchCase(inFlightCaseId);
    assert.equal(moved.workflowVersionId, newVersionId, "묶인 버전이 새 버전이어야 한다");
    assert.notEqual(moved.currentWorkflowStepId, oldIntakeStepId, "단계 행도 새 버전의 것으로 갈려야 한다");

    const [newStep] = await db
      .select({ key: workflowSteps.key, versionId: workflowSteps.workflowVersionId })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, moved.currentWorkflowStepId));
    assert.equal(newStep.versionId, newVersionId);
    assert.equal(newStep.key, "intake_inspection", "key가 같은 단계로만 옮겨져야 한다 — label로 짝지으면 안 된다");
  });

  test("출하 완료된 건은 안 옮겨진다", async () => {
    const stayed = await fetchCase(shippedCaseId);
    assert.equal(stayed.workflowVersionId, oldVersionId, "끝난 건의 기록을 흔들면 안 된다");
    assert.equal(stayed.currentWorkflowStepId, oldShipmentStepId);
  });

  test("삭제된 건은 안 옮겨진다", async () => {
    const stayed = await fetchCase(deletedCaseId);
    assert.equal(stayed.workflowVersionId, oldVersionId);
    assert.equal(stayed.currentWorkflowStepId, oldIntakeStepId);
  });

  test("key가 새 판에 없는 건은 옛 판에 남고, 발행은 성공한다", async () => {
    assert.equal(publishResult.ok, true, "단계 하나를 없앴다고 발행을 막으면 워크플로를 영영 못 고친다");

    const stayed = await fetchCase(strandedCaseId);
    assert.equal(stayed.workflowVersionId, oldVersionId);
    assert.equal(stayed.currentWorkflowStepId, oldOnlyStepId);

    if (publishResult.ok) {
      assert.ok(
        publishResult.strandedCaseCount >= 1,
        `남은 건이 세어져야 한다: ${publishResult.strandedCaseCount}`
      );
    }
  });

  test("감사 로그에 옮긴 건수가 남는다", async () => {
    assert.equal(publishResult.ok, true);
    if (!publishResult.ok) return;
    assert.ok(publishResult.migratedCaseCount >= 1, `옮긴 건이 세어져야 한다: ${publishResult.migratedCaseCount}`);

    const [log] = await db
      .select({ newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "workflow_versions"), eq(auditLogs.targetRecordId, newVersionId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    assert.ok(log, "발행 감사 로그가 있어야 한다");

    const recorded = log.newValue as { status?: string; migratedCaseCount?: number; strandedCaseCount?: number };
    assert.equal(recorded.status, "PUBLISHED", "발행 로그를 집은 것이 맞는지 확인한다");
    assert.equal(recorded.migratedCaseCount, publishResult.migratedCaseCount);
    assert.equal(recorded.strandedCaseCount, publishResult.strandedCaseCount);
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 발행 없이 「기존 건을 현재 버전으로 적용」 (2026-09-30)
 * ────────────────────────────────────────────────────────────────────────
 * 앞 묶음이 고정한 이관 규칙을 **발행이 아닌 경로**로 다시 밟는다. 조건은 한
 * 곳(planInFlightCaseMigration)에만 있으므로, 여기서 확인하는 것은 "그 한 곳을
 * 정말로 지나는가"다.
 *
 * 🔴 가장 중요한 시험은 **미리 보기 수 = 실제로 옮긴 수**다. 단추에 적히는 수
 * (화면이 getWorkflowTemplateDetail 로 받는 값)와 mutation 이 실제로 옮긴 수가
 * 다르면 두 곳이 조건을 따로 갖고 있다는 뜻이고, 그 증상은 "27건이라 써 놓고
 * 25건만 옮겼다"라서 오류 없이 조용히 틀린다.
 *
 * 무대는 판 셋이다:
 *   · **지금 판**   — 앞 묶음이 발행해 둔 current.
 *   · **옛 판**     — 지금 판을 복제해 만든 뒤 보관으로 내린 것. 여기에만 있는
 *                     단계를 하나 끼워 넣어 "갈 곳 없는 건"을 만든다.
 *   · **건 전용 판** — 단계 구성이 지금 판과 **똑같은** 복제본이다. 그래서 이 판에
 *                     묶인 건이 움직이지 않는 이유는 오직 is_case_scoped 하나다 —
 *                     그 조건이 빠지면 이 건이 따라 움직여 바로 잡힌다.
 */

const APPLY_INTAKE_PREFIX = "D9704";
const APPLY_MODEL_PREFIX = "WFAPPLY-TEST-";
/** 옛 판에만 있는 단계. 복제한 **뒤에** 끼워 넣어야 지금 판에 없다. */
const APPLY_OLD_ONLY_STEP_KEY = "wfapply_test_only_step";

describe("적용 — 발행하지 않고 지금 판으로 옮기기", () => {
  let currentVersionId: string;
  let currentVersionNumber: number;
  let oldVersionId: string;
  let caseScopedVersionId: string;

  let oldIntakeStepId: string;
  let oldShipmentStepId: string;
  let oldOnlyStepId: string;
  let caseScopedIntakeStepId: string;

  let inFlightCaseId: string;
  let shippedCaseId: string;
  let deletedCaseId: string;
  let strandedCaseId: string;
  let caseScopedCaseId: string;

  /** 적용 직전에 화면이 보게 될 수 — 단추에 적히는 값과 같은 길로 읽는다. */
  let preview: { migratableCaseCount: number; strandedCaseCount: number } | null;
  let forbiddenResult: Awaited<ReturnType<typeof applyCurrentWorkflowVersionToCases>>;
  let caseAfterForbidden: { workflowVersionId: string; currentWorkflowStepId: string };
  let applyResult: Awaited<ReturnType<typeof applyCurrentWorkflowVersionToCases>>;
  let historyCountBefore: number;
  let historyCountAfter: number;

  async function makeCase(params: {
    sequence: string;
    versionId: string;
    stepId: string;
    deleted?: boolean;
  }): Promise<string> {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.isDeleted, false))
      .limit(1);
    assert.ok(customer, "삭제되지 않은 고객이 최소 1건 필요합니다");

    const [product] = await db
      .insert(products)
      .values({ modelName: `${APPLY_MODEL_PREFIX}${params.sequence}` })
      .returning({ id: products.id });

    const [row] = await db
      .insert(repairCases)
      .values({
        intakeNumber: `${APPLY_INTAKE_PREFIX}${params.sequence}`,
        customerId: customer.id,
        productId: product.id,
        workflowVersionId: params.versionId,
        currentWorkflowStepId: params.stepId,
        receivedAt: "2097-04-10",
        isDeleted: params.deleted ?? false,
        deletedAt: params.deleted ? new Date() : null,
      })
      .returning({ id: repairCases.id });
    return row.id;
  }

  async function fetchCase(id: string) {
    const [row] = await db
      .select({
        workflowVersionId: repairCases.workflowVersionId,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
      })
      .from(repairCases)
      .where(eq(repairCases.id, id));
    assert.ok(row, "접수 건이 있어야 한다");
    return row;
  }

  async function stepIdByKey(versionId: string, key: string): Promise<string> {
    const [step] = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowVersionId, versionId), eq(workflowSteps.key, key)));
    assert.ok(step, `그 버전에 ${key} 단계가 있어야 합니다`);
    return step.id;
  }

  async function countStatusHistories(): Promise<number> {
    const [row] = await db.select({ n: count() }).from(statusChangeHistories);
    return Number(row.n);
  }

  before(async () => {
    const [current] = await db
      .select({ id: workflowVersions.id, versionNumber: workflowVersions.versionNumber })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    assert.ok(current, "현재 발행 버전이 있어야 합니다");
    currentVersionId = current.id;
    currentVersionNumber = current.versionNumber;

    // 옛 판 — 지금 판의 복제본을 보관 상태로 내린다. 단계 key 가 같으므로
    // 여기 선 건은 "짝이 있는 건"이 된다.
    const oldDraft = await makeDraft();
    oldVersionId = oldDraft.versionId;
    await db
      .update(workflowVersions)
      .set({ status: "ARCHIVED", isCurrent: false })
      .where(eq(workflowVersions.id, oldVersionId));

    // 건 전용 판 — 단계 구성은 지금 판과 똑같다. 움직이지 않을 이유가
    // is_case_scoped 하나뿐이어야 시험이 그 조건을 겨눈다.
    const scopedDraft = await makeDraft();
    caseScopedVersionId = scopedDraft.versionId;
    await db
      .update(workflowVersions)
      .set({ status: "PUBLISHED", isCurrent: false, isCaseScoped: true, publishedAt: new Date() })
      .where(eq(workflowVersions.id, caseScopedVersionId));

    // 복제가 모두 끝난 뒤에 끼워 넣는다 — 순서를 바꾸면 지금 판에도 생긴다.
    const [oldOnly] = await db
      .insert(workflowSteps)
      .values({
        workflowVersionId: oldVersionId,
        stepOrder: 9902,
        key: APPLY_OLD_ONLY_STEP_KEY,
        label: "적용 시험 전용 단계",
        repairStatus: "IN_REPAIR",
        category: "TECHNICAL",
      })
      .returning({ id: workflowSteps.id });
    oldOnlyStepId = oldOnly.id;

    oldIntakeStepId = await stepIdByKey(oldVersionId, "intake_inspection");
    oldShipmentStepId = await stepIdByKey(oldVersionId, "shipment_completed");
    caseScopedIntakeStepId = await stepIdByKey(caseScopedVersionId, "intake_inspection");

    inFlightCaseId = await makeCase({ sequence: "01", versionId: oldVersionId, stepId: oldIntakeStepId });
    shippedCaseId = await makeCase({ sequence: "02", versionId: oldVersionId, stepId: oldShipmentStepId });
    deletedCaseId = await makeCase({
      sequence: "03",
      versionId: oldVersionId,
      stepId: oldIntakeStepId,
      deleted: true,
    });
    strandedCaseId = await makeCase({ sequence: "04", versionId: oldVersionId, stepId: oldOnlyStepId });
    caseScopedCaseId = await makeCase({
      sequence: "05",
      versionId: caseScopedVersionId,
      stepId: caseScopedIntakeStepId,
    });
    await db
      .update(workflowVersions)
      .set({ repairCaseId: caseScopedCaseId })
      .where(eq(workflowVersions.id, caseScopedVersionId));

    // 권한 없는 사람이 먼저 눌러 본다 — 거절이 **쓰기 전에** 일어나는지를
    // 성공 적용보다 앞에서 봐야 "그 건이 그대로인가"를 물을 수 있다.
    forbiddenResult = await applyCurrentWorkflowVersionToCases({
      templateCode: TEMPLATE_CODE,
      actorUserId: salesId,
    });
    caseAfterForbidden = await fetchCase(inFlightCaseId);

    // 🔴 화면이 단추에 적을 수를 **실제 적용 직전에** 읽는다.
    const detail = await getWorkflowTemplateDetail(TEMPLATE_CODE);
    assert.ok(detail, "워크플로 상세를 읽을 수 있어야 한다");
    preview = detail.inFlightCases;

    historyCountBefore = await countStatusHistories();
    applyResult = await applyCurrentWorkflowVersionToCases({
      templateCode: TEMPLATE_CODE,
      actorUserId: adminId,
    });
    historyCountAfter = await countStatusHistories();
  });

  after(async () => {
    await db.delete(repairCases).where(like(repairCases.intakeNumber, `${APPLY_INTAKE_PREFIX}%`));
    await db.delete(products).where(like(products.modelName, `${APPLY_MODEL_PREFIX}%`));
    if (oldOnlyStepId) await db.delete(workflowSteps).where(eq(workflowSteps.id, oldOnlyStepId));
  });

  test("🔴 미리 보기에 적힌 수가 실제로 옮긴 수와 같다", () => {
    assert.ok(preview, "현재 발행 버전이 있으므로 미리 보기 수가 있어야 한다");
    assert.equal(applyResult.ok, true, JSON.stringify(applyResult));
    if (!applyResult.ok || !preview) return;

    // 이 파일에서 가장 중요한 두 줄이다 — 세는 조건과 옮기는 조건이 갈라지면
    // 여기서 잡힌다.
    assert.equal(
      preview.migratableCaseCount,
      applyResult.migratedCaseCount,
      "단추에 적은 수와 실제로 옮긴 수가 다르다 — 조건이 두 곳에 생겼다는 뜻이다"
    );
    assert.equal(
      preview.strandedCaseCount,
      applyResult.strandedCaseCount,
      "남을 것으로 센 수와 실제로 남은 수가 다르다"
    );
    assert.ok(preview.migratableCaseCount >= 1, `옮길 건이 있어야 한다: ${preview.migratableCaseCount}`);
    assert.ok(preview.strandedCaseCount >= 1, `남을 건이 있어야 한다: ${preview.strandedCaseCount}`);
  });

  test("진행 중인 건이 지금 판의 같은 단계로 옮겨진다", async () => {
    const moved = await fetchCase(inFlightCaseId);
    assert.equal(moved.workflowVersionId, currentVersionId, "묶인 버전이 지금 판이어야 한다");
    assert.notEqual(moved.currentWorkflowStepId, oldIntakeStepId, "단계 행도 지금 판의 것으로 갈려야 한다");

    const [newStep] = await db
      .select({ key: workflowSteps.key, versionId: workflowSteps.workflowVersionId })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, moved.currentWorkflowStepId));
    assert.equal(newStep.versionId, currentVersionId);
    assert.equal(newStep.key, "intake_inspection", "key 가 같은 단계로만 옮겨져야 한다");
  });

  test("출하 완료된 건·삭제된 건은 안 옮겨진다", async () => {
    const shipped = await fetchCase(shippedCaseId);
    assert.equal(shipped.workflowVersionId, oldVersionId, "끝난 건의 기록을 흔들면 안 된다");
    assert.equal(shipped.currentWorkflowStepId, oldShipmentStepId);

    const deleted = await fetchCase(deletedCaseId);
    assert.equal(deleted.workflowVersionId, oldVersionId);
    assert.equal(deleted.currentWorkflowStepId, oldIntakeStepId);
  });

  test("🔴 건 전용 판에 묶인 건은 안 옮겨진다 — 그 건만을 위해 넣은 단계가 사라진다", async () => {
    const stayed = await fetchCase(caseScopedCaseId);
    assert.equal(
      stayed.workflowVersionId,
      caseScopedVersionId,
      "단계 구성이 지금 판과 같아도 건 전용 판은 끌어오지 않는다"
    );
    assert.equal(stayed.currentWorkflowStepId, caseScopedIntakeStepId);
  });

  test("key 가 지금 판에 없는 건은 남고, 적용 자체는 성공한다", async () => {
    assert.equal(applyResult.ok, true, "단계 하나가 없다고 적용을 통째로 막으면 안 된다");
    const stayed = await fetchCase(strandedCaseId);
    assert.equal(stayed.workflowVersionId, oldVersionId);
    assert.equal(stayed.currentWorkflowStepId, oldOnlyStepId);
    if (applyResult.ok) {
      assert.ok(applyResult.strandedCaseCount >= 1, `남은 건이 세어져야 한다: ${applyResult.strandedCaseCount}`);
    }
  });

  test("단계 이동 이력은 한 줄도 남기지 않는다 — 단계가 바뀐 것이 아니다", () => {
    assert.equal(historyCountAfter, historyCountBefore, "status_change_histories 에 적으면 거짓 이력이 된다");
  });

  test("권한이 없으면 거절되고, 건은 그대로 있다", () => {
    assert.equal(forbiddenResult.ok, false, "영업 담당자는 적용할 수 없어야 한다");
    if (!forbiddenResult.ok) assert.equal(forbiddenResult.code, "FORBIDDEN");
    assert.equal(caseAfterForbidden.workflowVersionId, oldVersionId, "거절됐는데 건이 움직이면 안 된다");
    assert.equal(caseAfterForbidden.currentWorkflowStepId, oldIntakeStepId);
  });

  test("🔴 감사 로그가 남고, 발행 로그와 구별된다", async () => {
    assert.equal(applyResult.ok, true);
    if (!applyResult.ok) return;

    const logs = await db
      .select({ newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "workflow_versions"), eq(auditLogs.targetRecordId, currentVersionId)))
      .orderBy(desc(auditLogs.createdAt));

    type LoggedValue = {
      action?: string;
      status?: string;
      versionNumber?: number;
      migratedCaseCount?: number;
      strandedCaseCount?: number;
    };
    const values = logs.map((log) => (log.newValue ?? {}) as LoggedValue);

    const applied = values.filter((value) => value.action === WORKFLOW_APPLY_AUDIT_ACTION);
    assert.equal(applied.length, 1, "적용 한 번에 로그 한 줄이어야 한다");
    assert.equal(applied[0].migratedCaseCount, applyResult.migratedCaseCount);
    assert.equal(applied[0].strandedCaseCount, applyResult.strandedCaseCount);
    assert.equal(applied[0].versionNumber, currentVersionNumber);
    // 🔴 발행과 섞이지 않는다: 적용 로그에는 발행이 쓰는 status 칸이 없고,
    // 발행 로그에는 적용이 쓰는 action 칸이 없다. 나중에 로그를 읽는 사람이
    // "이건 발행이었나 적용이었나"를 한 칸으로 가를 수 있어야 한다.
    assert.equal(applied[0].status, undefined, "적용 로그가 발행과 같은 칸을 쓰면 구별할 수 없다");
    for (const value of values.filter((v) => v.status === "PUBLISHED")) {
      assert.equal(value.action, undefined, "발행 로그에 적용 표시가 붙으면 안 된다");
    }
  });

  test("지금 판이 없으면 거절된다", async () => {
    // 현재 발행본을 잠깐 내렸다가 반드시 되돌린다 — 이 파일의 다른 시험도,
    // 이 DB 의 다른 통합 시험도 current 가 하나 있다는 것을 전제한다.
    await db.update(workflowVersions).set({ isCurrent: false }).where(eq(workflowVersions.id, currentVersionId));
    try {
      const result = await applyCurrentWorkflowVersionToCases({
        templateCode: TEMPLATE_CODE,
        actorUserId: adminId,
      });
      assert.equal(result.ok, false, "옮길 목적지가 없으면 적용해서는 안 된다");
      if (!result.ok) assert.equal(result.code, "NO_PUBLISHED_VERSION");
    } finally {
      await db
        .update(workflowVersions)
        .set({ status: "PUBLISHED", isCurrent: true })
        .where(eq(workflowVersions.id, currentVersionId));
    }
  });
});
