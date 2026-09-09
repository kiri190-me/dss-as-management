import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseApprovals,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { requestRepairCaseApproval, decideRepairCaseApproval } from "./repair-case-approvals";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test for the approval request/decision mutations —
 * the core of the database-backed approval persistence task's final
 * report. Calls the mutations directly with real DB user UUIDs (not
 * through readSession()), same layering choice every other
 * *.integration.test.ts file in this directory already makes.
 *
 * Self-cleaning and isolated to test month "9906" / product prefix
 * "APPROVAL-TEST-", distinct from every other isolated-month suite in this
 * directory (9901/9902/9903/9904/9905). Must never touch D2608, customers,
 * users, End-Users, or workflows.
 */

const TEST_RECEIVED_AT = "2099-06-10";
const TEST_SHIPMENT_DATE = "2099-06-20";
const TEST_MODEL_PREFIX = "APPROVAL-TEST-";
const TEST_YEAR_MONTH = "9906";
/**
 * 지정 승인자 시험이 쓰는 사용자들만 이 접두사로 직접 만든다 — 역할·계정
 * 상태를 정확히 골라야 하고(개발자 표시가 꺼진 관리자, 잠긴 계정 등), 시드
 * 사용자를 그 상태로 바꾸면 다른 스위트에 번진다. after()가 이 접두사의
 * 사용자만 지운다.
 */
const TEST_EMAIL_PREFIX = "approval-assignment-test-";

let customerId: string;
let engineerId: string; // AS_ENGINEER, request-eligible, inspection-decide-eligible
let adminId: string; // ADMIN, NOT the shipment representative
let salesId: string; // SALES, not request-eligible
let representativeId: string; // SUPER_ADMIN with is_shipment_representative = true

const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: `지정시험-${randomUUID().slice(0, 4)}`,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      isDeveloper: false,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isShipmentRepresentative, false)
      )
    )
    .limit(1);
  assert.ok(admin, "expected at least one approved, non-representative ADMIN in the dev DB");
  adminId = admin.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "expected at least one approved SALES user in the dev DB");
  salesId = sales.id;

  const [representative] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isShipmentRepresentative, true), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(representative, "expected a seeded users.is_shipment_representative = true row");
  representativeId = representative.id;
});

after(async () => {
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9906%"));
  for (const { id } of testCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9906%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  // 사용자는 마지막이다 — 위에서 이 스위트의 결재 행을 이미 지웠으므로
  // requested_by/assigned_approver 의 RESTRICT 에 걸리지 않는다.
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    modelName: `${TEST_MODEL_PREFIX}${randomUUID().slice(0, 8)}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

async function createTestCase() {
  const result = await createRepairCase(baseCreateInput());
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("requestRepairCaseApproval / decideRepairCaseApproval", () => {
  test("1. a valid REPAIR_INSPECTION request succeeds and stores the real requester UUID", async () => {
    const caseId = await createTestCase();
    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, "검수 요청합니다");
    assert.equal(result.ok, true, `request failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, result.id));
    assert.ok(row);
    assert.equal(row.status, "REQUESTED");
    assert.equal(row.requestedByUserId, engineerId);
    assert.match(row.requestedByUserId, UUID_PATTERN, "requester id must be a real UUID, never a mock-style id");
    assert.equal(row.requestReason, "검수 요청합니다");
  });

  test("3. a duplicate pending request is rejected with ALREADY_REQUESTED", async () => {
    const caseId = await createTestCase();
    const first = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(first.ok, true);

    const second = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "ALREADY_REQUESTED");
  });

  test("4. an unauthorized requester (SALES) is rejected with FORBIDDEN", async () => {
    const caseId = await createTestCase();
    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", salesId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("2. a FINAL_SHIPMENT request is blocked until REPAIR_INSPECTION is approved, then succeeds", async () => {
    const caseId = await createTestCase();

    const tooEarly = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(tooEarly.ok, false);
    if (!tooEarly.ok) assert.equal(tooEarly.code, "FORBIDDEN");

    const inspectionRequest = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(inspectionRequest.ok, true);
    const inspectionDecision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(inspectionDecision.ok, true, `inspection approval failed: ${JSON.stringify(inspectionDecision)}`);

    const shipmentRequest = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, "출하 승인 요청");
    assert.equal(shipmentRequest.ok, true, `shipment request failed: ${JSON.stringify(shipmentRequest)}`);
  });

  test("5/7. an unauthorized (non-representative) approver is rejected; the representative succeeds", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);

    const byAdmin = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", adminId, null);
    assert.equal(byAdmin.ok, false);
    if (!byAdmin.ok) assert.equal(byAdmin.code, "FORBIDDEN");

    const byRepresentative = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(byRepresentative.ok, true, `representative decision failed: ${JSON.stringify(byRepresentative)}`);
  });

  test("8. a second decision on an already-decided request is rejected with CONFLICT (double decision)", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const first = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(first.ok, true);

    const second = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, "재고");
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "CONFLICT");
  });

  test("6. self-approval is allowed (no restriction defined in local-demo mode either)", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", engineerId, null);
    assert.equal(decision.ok, true, `self-approval unexpectedly rejected: ${JSON.stringify(decision)}`);
  });

  test("rejection requires a decision reason; a rejected request can be resubmitted", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);

    const noReason = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, null);
    assert.equal(noReason.ok, false);
    if (!noReason.ok) assert.equal(noReason.code, "VALIDATION_ERROR");

    const rejected = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, "재작업 필요");
    assert.equal(rejected.ok, true);

    const resubmitted = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, "재요청");
    assert.equal(resubmitted.ok, true, `resubmission failed: ${JSON.stringify(resubmitted)}`);

    const rows = await db
      .select()
      .from(repairCaseApprovals)
      .where(and(eq(repairCaseApprovals.repairCaseId, caseId), eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")));
    assert.equal(rows.length, 2, "history must preserve both the rejected and the resubmitted rows");
    assert.equal(rows.filter((r) => r.status === "REJECTED").length, 1);
    assert.equal(rows.filter((r) => r.status === "REQUESTED").length, 1);
  });

  test("10. two concurrent decisions on the same request: exactly one succeeds, the other gets CONFLICT", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);

    const [a, b] = await Promise.all([
      decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null),
      decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", engineerId, "동시 처리 시도"),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.code === "CONFLICT");
    assert.equal(successes.length, 1, "exactly one decision must succeed");
    assert.equal(conflicts.length, 1, "the other must fail with CONFLICT");

    const decidedRows = await db
      .select()
      .from(repairCaseApprovals)
      .where(and(eq(repairCaseApprovals.repairCaseId, caseId), eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")));
    assert.equal(decidedRows.length, 1, "no duplicate decision row must exist");
  });

  test("NOT_FOUND: missing repair case (request and decide)", async () => {
    const missingId = randomUUID();
    const requestResult = await requestRepairCaseApproval(missingId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(requestResult.ok, false);
    if (!requestResult.ok) assert.equal(requestResult.code, "NOT_FOUND");

    const decideResult = await decideRepairCaseApproval(missingId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(decideResult.ok, false);
    if (!decideResult.ok) assert.equal(decideResult.code, "NOT_FOUND");
  });

  test("NOT_FOUND: deciding a type that was never requested", async () => {
    const caseId = await createTestCase();
    const result = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("CASE_LOCKED blocks a new approval request", async () => {
    const caseId = await createTestCase();
    // Arrange-only direct SQL — no legitimate path reaches isLocked=true
    // without a full SHIPMENT_COMPLETED transition (see
    // workflow-transitions.integration.test.ts's identical note).
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));

    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
  });
});

/**
 * ============================================================================
 * 지정 승인자 — 「누가 처리할지」를 요청할 때 고를 수 있다
 * ============================================================================
 * 규칙은 하나뿐이다: **지정이 NULL 이면 지금까지와 완전히 같고**, 지정이 있으면
 * 그 사람(과 최고관리자)만 처리한다. 그리고 지정은 **권한을 만들지 않는다** —
 * 자격 검사가 먼저이고 지정 관문이 그 뒤다.
 *
 * 사용자를 여기서 직접 만드는 이유: 「개발자 표시가 꺼진 관리자」·「잠긴
 * 계정」처럼 상태를 정확히 골라야 하는데, 시드 사용자를 그 상태로 바꾸면 다른
 * 스위트에 번진다.
 * ============================================================================
 */
describe("requestRepairCaseApproval / decideRepairCaseApproval: 지정 승인자", () => {
  let assigneeId: string; // 지정될 사람 — A/S 엔지니어, 검수 결재 자격 있음
  let otherAdminId: string; // 자격은 있지만 지정되지 않은 사람 (개발자 표시 꺼짐)
  let superAdminId: string; // 지정과 무관하게 언제나 처리할 수 있는 사람
  let salesUserId: string; // 역할 자격이 없는 사람

  before(async () => {
    assigneeId = await createTestUser({ role: "AS_ENGINEER" });
    otherAdminId = await createTestUser({ role: "ADMIN" });
    superAdminId = await createTestUser({ role: "SUPER_ADMIN" });
    salesUserId = await createTestUser({ role: "SALES" });
  });

  /** 요청 mutation 을 우회해 지정된 요청 행을 직접 넣는다 — 요청 단계에서 막히는 지정(자격 없는 사람)을 결재 단계에서 시험하기 위한 것이다. */
  async function insertAssignedRequest(repairCaseId: string, assignedApproverUserId: string) {
    const [row] = await db
      .select({ version: repairCases.version })
      .from(repairCases)
      .where(eq(repairCases.id, repairCaseId));
    await db.insert(repairCaseApprovals).values({
      repairCaseId,
      approvalType: "REPAIR_INSPECTION",
      status: "REQUESTED",
      requestedByUserId: engineerId,
      assignedApproverUserId,
      repairCaseVersionAtRequest: row.version,
    });
  }

  async function inspectionRows(repairCaseId: string) {
    return db
      .select()
      .from(repairCaseApprovals)
      .where(
        and(
          eq(repairCaseApprovals.repairCaseId, repairCaseId),
          eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")
        )
      );
  }

  test("🔴 지정이 없으면(NULL) 자격 있는 사람 누구나 처리한다 — 이 칸이 생기기 전과 같다", async () => {
    const caseId = await createTestCase();
    const requested = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(requested.ok, true, `request failed: ${JSON.stringify(requested)}`);

    const [row] = await inspectionRows(caseId);
    assert.equal(row.assignedApproverUserId, null, "지정하지 않으면 NULL 로 남아야 한다");

    // 요청자도, 요청과 아무 상관 없는 다른 자격자도 처리할 수 있다.
    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", otherAdminId, null);
    assert.equal(decision.ok, true, `지정 없는 요청이 막혔다: ${JSON.stringify(decision)}`);
  });

  test("지정된 사람은 처리할 수 있다", async () => {
    const caseId = await createTestCase();
    const requested = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, assigneeId);
    assert.equal(requested.ok, true, `request failed: ${JSON.stringify(requested)}`);

    const [row] = await inspectionRows(caseId);
    assert.equal(row.assignedApproverUserId, assigneeId, "지정이 행에 저장돼야 한다");

    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", assigneeId, null);
    assert.equal(decision.ok, true, `지정된 사람이 막혔다: ${JSON.stringify(decision)}`);
  });

  test("🔴 지정되지 않은 다른 사람은 거절되고, 행이 하나도 바뀌지 않는다", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, assigneeId);

    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", otherAdminId, null);
    assert.equal(decision.ok, false, "자격이 있어도 지정된 사람이 아니면 막혀야 한다");
    if (!decision.ok) {
      assert.equal(decision.code, "FORBIDDEN");
      // 「권한이 없습니다」만으로는 무엇을 해야 할지 알 수 없다 — 이름이 있어야 한다.
      const [assignee] = await db.select({ name: users.name }).from(users).where(eq(users.id, assigneeId));
      assert.ok(
        decision.message.includes(assignee.name),
        `거절 메시지에 지정된 사람 이름이 없다: ${decision.message}`
      );
    }

    const rows = await inspectionRows(caseId);
    assert.equal(rows.length, 1, "거절이 새 행을 만들면 안 된다");
    assert.equal(rows[0].status, "REQUESTED", "행이 그대로여야 한다");
    assert.equal(rows[0].decidedByUserId, null);
    assert.equal(rows[0].decidedAt, null);
  });

  test("최고관리자는 지정이 남에게 되어 있어도 처리할 수 있다 — 자리를 비워 영영 막히는 것을 막는다", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, assigneeId);

    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", superAdminId, null);
    assert.equal(decision.ok, true, `최고관리자가 막혔다: ${JSON.stringify(decision)}`);
  });

  test("🔴 역할 자격이 없는 사람은 지정돼 있어도 거절된다 — 지정이 권한을 만들지 않는다", async () => {
    const caseId = await createTestCase();
    // 요청 경로로는 지정할 수 없는 사람이므로 행을 직접 넣는다.
    await insertAssignedRequest(caseId, salesUserId);

    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", salesUserId, null);
    assert.equal(decision.ok, false, "영업 담당자는 지정돼 있어도 검수 승인을 처리할 수 없다");
    if (!decision.ok) assert.equal(decision.code, "FORBIDDEN");

    const rows = await inspectionRows(caseId);
    assert.equal(rows[0].status, "REQUESTED", "행이 그대로여야 한다");
  });

  test("🔴 계정 상태 자격이 없는 사람도 지정돼 있어도 거절된다", async () => {
    const pendingAdminId = await createTestUser({ role: "ADMIN", approvalStatus: "PENDING" });
    const caseId = await createTestCase();
    await insertAssignedRequest(caseId, pendingAdminId);

    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", pendingAdminId, null);
    assert.equal(decision.ok, false, "승인되지 않은 계정은 지정돼 있어도 처리할 수 없다");
    if (!decision.ok) assert.equal(decision.code, "FORBIDDEN");

    const rows = await inspectionRows(caseId);
    assert.equal(rows[0].status, "REQUESTED", "행이 그대로여야 한다");
  });

  test("🔴 자격 없는 사람을 지정하려 하면 요청 자체가 거절되고 행이 만들어지지 않는다", async () => {
    const caseId = await createTestCase();
    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, salesUserId);
    assert.equal(result.ok, false, "자격 없는 사람에게 지정된 요청은 영영 처리되지 않는 상태로 남는다");
    if (!result.ok) {
      assert.equal(result.code, "ASSIGNEE_NOT_ELIGIBLE");
      const [sales] = await db.select({ name: users.name }).from(users).where(eq(users.id, salesUserId));
      assert.ok(result.message.includes(sales.name), `누구를 지정할 수 없는지 이름이 없다: ${result.message}`);
    }

    assert.equal((await inspectionRows(caseId)).length, 0, "거절된 요청은 행을 남기지 않는다");
  });

  test("삭제·비활성·잠긴 계정을 지정하려 해도 거절된다", async () => {
    const inactiveId = await createTestUser({ role: "AS_ENGINEER", isActive: false });
    const lockedId = await createTestUser({ role: "AS_ENGINEER", lockedAt: new Date() });
    const deletedId = await createTestUser({ role: "AS_ENGINEER", isDeleted: true, deletedAt: new Date() });

    for (const [label, targetId] of [
      ["비활성", inactiveId],
      ["잠김", lockedId],
      ["삭제됨", deletedId],
    ] as const) {
      const caseId = await createTestCase();
      const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, targetId);
      assert.equal(result.ok, false, `${label} 계정을 지정할 수 있으면 안 된다`);
      if (!result.ok) assert.equal(result.code, "ASSIGNEE_NOT_ELIGIBLE");
      assert.equal((await inspectionRows(caseId)).length, 0, `${label}: 행이 남으면 안 된다`);
    }

    // 대조 — 같은 경로로 정상 계정은 지정된다(위 거절이 「지정이 전부 막힘」이
    // 아니라 계정 상태 때문이었다).
    const okCaseId = await createTestCase();
    const okResult = await requestRepairCaseApproval(okCaseId, "REPAIR_INSPECTION", engineerId, null, assigneeId);
    assert.equal(okResult.ok, true, `대조가 성립하지 않는다: ${JSON.stringify(okResult)}`);
  });

  test("존재하지 않는 사용자를 지정하려 해도 거절된다", async () => {
    const caseId = await createTestCase();
    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, randomUUID());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ASSIGNEE_NOT_ELIGIBLE");
    assert.equal((await inspectionRows(caseId)).length, 0);
  });

  test("최종 출하 승인 요청에는 아직 지정할 수 없다 — 조용히 무시하지 않고 거절한다", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);

    const result = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null, assigneeId);
    assert.equal(result.ok, false, "무시하고 통과시키면 요청자는 지정한 줄 알고 넘어간다");
    if (!result.ok) assert.equal(result.code, "ASSIGNEE_NOT_ELIGIBLE");

    const shipmentRows = await db
      .select()
      .from(repairCaseApprovals)
      .where(
        and(
          eq(repairCaseApprovals.repairCaseId, caseId),
          eq(repairCaseApprovals.approvalType, "FINAL_SHIPMENT")
        )
      );
    assert.equal(shipmentRows.length, 0, "거절된 요청은 행을 남기지 않는다");

    // 대조 — 지정을 빼면 같은 요청이 그대로 통과한다.
    const withoutAssignee = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(withoutAssignee.ok, true, `대조가 성립하지 않는다: ${JSON.stringify(withoutAssignee)}`);
  });

  test("반려도 같은 관문을 지난다 — 승인만 막고 반려는 통과하는 구멍이 없다", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null, assigneeId);

    const byOther = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", otherAdminId, "반려 사유");
    assert.equal(byOther.ok, false);
    if (!byOther.ok) assert.equal(byOther.code, "FORBIDDEN");

    const byAssignee = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", assigneeId, "반려 사유");
    assert.equal(byAssignee.ok, true, `지정된 사람의 반려가 막혔다: ${JSON.stringify(byAssignee)}`);
  });
});

