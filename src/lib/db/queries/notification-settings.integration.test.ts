import "../../../../scripts/load-env";

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  inventoryPartRequestHistory,
  inventoryPartRequestIdempotencyKeys,
  inventoryPartRequestItems,
  inventoryPartRequests,
  notificationKindSettings,
  notificationRoleSettings,
  parts,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createPart } from "../mutations/inventory";
import { createPartRequest } from "../mutations/inventory-part-requests";
import { createRepairCase } from "../mutations/repair-cases";
import { saveNotificationSettings } from "../mutations/notification-settings";
import { buildNotificationSettingsView, loadStoredNotificationSettings } from "./notification-settings";
import { listMyNotifications } from "./notifications";
import { deliversNotification } from "@/lib/domain/notification-settings";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/domain/notifications";
import { canReceivePartRequestNotifications } from "@/lib/auth/inventory-authorization";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 알림 설정 읽기 + 설정이 실제 종 알림에 걸리는가
 * ============================================================================
 * 이 파일이 못 박는 것은 하나가 제일 중요하다: **설정이 하나도 저장돼 있지
 * 않을 때 종 알림이 알림 설정을 만들기 전과 똑같다.** 나머지는 그다음이다 —
 * 종류를 끄면 그 종류만 사라지는가, 역할을 빼면 그 역할만 빠지는가, 최고관리자는
 * 저장된 값과 무관하게 계속 받는가.
 *
 * 순수 규칙은 domain/notification-settings.test.ts가 본다. 여기서는 저장 →
 * 읽기 → listMyNotifications까지 **실제 경로 전체**를 태운다.
 *
 * 알림에 실제로 잡힐 자료를 하나씩 만든다 — 처리 대기 중인 부품 요청 하나와,
 * 그 접수 건에 걸린 검수 승인 요청 하나. 자료가 없으면 어느 설정을 넣어도
 * 빈 목록이라 검사를 통째로 지워도 초록색인 테스트가 된다.
 *
 * 격리 규약은 이 디렉터리의 다른 통합 테스트와 같다 — 접수 월 "9609",
 * 제품 모델 접두사 "NOTIFSET-TEST-", 부품명 접두사 "test-notification-settings-".
 * 알림 설정 두 표는 키가 종류+역할이라 전역이므로 매 테스트마다 지운다.
 * ============================================================================
 */

const TEST_PART_PREFIX = "test-notification-settings-";
const TEST_MODEL_PREFIX = "NOTIFSET-TEST-";
const TEST_YEAR_MONTH = "9609";
const TEST_RECEIVED_AT = "2096-09-10";
const TEST_SHIPMENT_DATE = "2096-09-20";

const TOUCHED_KINDS = [...NOTIFICATION_KINDS];

let superAdminId: string;
let adminId: string;
let engineerId: string;
let salesId: string;
let customerId: string;

let pendingRequestId: string;
let approvalCaseId: string;

const createdPartIds: string[] = [];
const createdRequestIds: string[] = [];
const createdCaseIds: string[] = [];

async function findUserId(role: Role): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, role),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(row, `expected an approved ${role} in the test DB`);
  return row.id;
}

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
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
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

async function createTestCase(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `case create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

/** 이 사용자에게 지금 잡히는 알림의 종류 집합. */
async function kindsFor(actorUserId: string, actorRole: Role): Promise<Set<NotificationKind>> {
  const items = await listMyNotifications(actorUserId, actorRole);
  return new Set(items.map((item) => item.kind));
}

/** 이 스위트가 만든 자료에서 나온 알림만. 시드·다른 스위트의 행에 흔들리지 않게 한다. */
async function myItemIds(actorUserId: string, actorRole: Role): Promise<string[]> {
  const items = await listMyNotifications(actorUserId, actorRole);
  return items
    .filter(
      (item) =>
        (item.kind === "PART_REQUEST_PENDING" && item.targetKey === pendingRequestId) ||
        (item.kind === "REPAIR_CASE_APPROVAL" && item.targetKey === approvalCaseId)
    )
    .map((item) => item.id);
}

before(async () => {
  superAdminId = await findUserId("SUPER_ADMIN");
  adminId = await findUserId("ADMIN");
  engineerId = await findUserId("AS_ENGINEER");
  salesId = await findUserId("SALES");

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  const existingKinds = await db.select({ id: notificationKindSettings.id }).from(notificationKindSettings);
  const existingRoles = await db.select({ id: notificationRoleSettings.id }).from(notificationRoleSettings);
  assert.equal(existingKinds.length, 0, "이 테스트는 알림 설정이 비어 있는 상태를 전제로 합니다");
  assert.equal(existingRoles.length, 0, "이 테스트는 알림 설정이 비어 있는 상태를 전제로 합니다");

  // ── 처리 대기 중인 부품 요청 하나 ────────────────────────────────────
  const requestCaseId = await createTestCase();
  const part = await createPart({
    partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}`,
    partSpec: "알림 설정 테스트용",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(part.ok, true, `part create failed: ${JSON.stringify(part)}`);
  if (!part.ok) throw new Error("unreachable");
  createdPartIds.push(part.partId);

  const request = await createPartRequest({
    repairCaseId: requestCaseId,
    items: [{ partId: part.partId, quantity: 1, owner: "DSS" }],
    actorUserId: engineerId,
    idempotencyKey: randomUUID(),
  });
  assert.equal(request.ok, true, `request create failed: ${JSON.stringify(request)}`);
  if (!request.ok) throw new Error("unreachable");
  createdRequestIds.push(request.requestId);
  pendingRequestId = request.requestId;

  // ── 아직 결정되지 않은 검수 승인 요청 하나 ───────────────────────────
  // 최고관리자·관리자·A/S 엔지니어가 결재할 수 있는 종류다
  // (repair-case-approvals-pending.ts의 INSPECTION_DECIDE_ELIGIBLE_ROLES).
  approvalCaseId = await createTestCase();
  const [approvalCase] = await db
    .select({ version: repairCases.version })
    .from(repairCases)
    .where(eq(repairCases.id, approvalCaseId));
  await db.insert(repairCaseApprovals).values({
    repairCaseId: approvalCaseId,
    approvalType: "REPAIR_INSPECTION",
    status: "REQUESTED",
    requestedByUserId: engineerId,
    repairCaseVersionAtRequest: approvalCase.version,
  });

  // 전제 확인 — 자료가 실제로 알림에 잡혀야 이 파일의 모든 단언이 뜻을 갖는다.
  const adminKinds = await kindsFor(adminId, "ADMIN");
  assert.ok(adminKinds.has("PART_REQUEST_PENDING"), "설정 전에 부품 요청 알림이 잡혀야 한다");
  assert.ok(adminKinds.has("REPAIR_CASE_APPROVAL"), "설정 전에 결재 알림이 잡혀야 한다");
});

afterEach(async () => {
  await db.delete(notificationRoleSettings).where(inArray(notificationRoleSettings.kindKey, TOUCHED_KINDS));
  await db.delete(notificationKindSettings).where(inArray(notificationKindSettings.kindKey, TOUCHED_KINDS));
});

after(async () => {
  if (createdRequestIds.length > 0) {
    await db
      .delete(inventoryPartRequestIdempotencyKeys)
      .where(inArray(inventoryPartRequestIdempotencyKeys.requestId, createdRequestIds));
    await db
      .delete(inventoryPartRequestHistory)
      .where(inArray(inventoryPartRequestHistory.requestId, createdRequestIds));
    await db
      .delete(inventoryPartRequestItems)
      .where(inArray(inventoryPartRequestItems.requestId, createdRequestIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.id, createdRequestIds));
  }
  for (const caseId of createdCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, caseId));
  }

  const leftoverParts = await db
    .select({ id: parts.id })
    .from(parts)
    .where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...leftoverParts.map((row) => row.id)])];
  if (allPartIds.length > 0) {
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

// ──────────────────────────────────────────── 설정이 하나도 없을 때

test("표가 비어 있으면 저장된 설정도 비어 있다", async () => {
  const stored = await loadStoredNotificationSettings();
  assert.deepEqual(stored, { kindEnabled: {}, roleReceives: {} });
});

test("🔴 설정이 하나도 없으면 다섯 역할 × 두 종류가 1단계 규칙 그대로다", async () => {
  const stored = await loadStoredNotificationSettings();
  for (const role of ROLE_CODES) {
    assert.equal(
      deliversNotification("REPAIR_CASE_APPROVAL", role, stored),
      true,
      `결재 알림이 ${role}에게서 달라졌다 — 1단계에는 역할로 막는 코드가 없었다`
    );
    assert.equal(
      deliversNotification("PART_REQUEST_PENDING", role, stored),
      canReceivePartRequestNotifications(role),
      `부품 요청 알림이 ${role}에게서 달라졌다`
    );
  }
});

test("🔴 설정이 하나도 없을 때 실제 종 알림이 1단계와 똑같다", async () => {
  // 규칙이 아니라 결과로 확인한다 — listMyNotifications를 그대로 태운다.
  assert.deepEqual(
    [...(await kindsFor(adminId, "ADMIN"))].sort(),
    ["PART_REQUEST_PENDING", "REPAIR_CASE_APPROVAL"],
    "관리자는 둘 다 받는다"
  );

  const engineerKinds = await kindsFor(engineerId, "AS_ENGINEER");
  assert.ok(engineerKinds.has("REPAIR_CASE_APPROVAL"), "엔지니어는 검수 결재자다");
  assert.equal(
    engineerKinds.has("PART_REQUEST_PENDING"),
    false,
    "엔지니어는 요청하는 쪽이지 처리하는 쪽이 아니다 — 1단계 그대로여야 한다"
  );

  const salesItems = await myItemIds(salesId, "SALES");
  assert.deepEqual(salesItems, [], "영업은 검수 결재자도 부품 요청 처리자도 아니다");
});

// ──────────────────────────────────────────── 종류 스위치

test("🔴 종류를 끄면 그 종류만 사라지고 다른 종류는 그대로다", async () => {
  const before = await kindsFor(adminId, "ADMIN");
  assert.ok(before.has("PART_REQUEST_PENDING") && before.has("REPAIR_CASE_APPROVAL"));

  const saved = await saveNotificationSettings({
    changes: [{ kind: "PART_REQUEST_PENDING", enabled: false, roles: {} }],
    actorUserId: superAdminId,
  });
  assert.equal(saved.ok, true);

  const after = await kindsFor(adminId, "ADMIN");
  assert.equal(after.has("PART_REQUEST_PENDING"), false, "끈 종류가 아직 온다");
  assert.equal(after.has("REPAIR_CASE_APPROVAL"), true, "끄지 않은 종류까지 사라졌다");
});

test("종류를 끄면 최고관리자에게도 그 종류가 가지 않는다 — 역할 스위치와 다른 축이다", async () => {
  // 종류 스위치는 "이 알림을 당분간 아무에게도 보내지 않는다"는 뜻이라
  // 예외를 두면 그 뜻이 성립하지 않는다. 역할 스위치의 최고관리자 잠금과
  // 혼동하지 않도록 여기서 못 박는다.
  await saveNotificationSettings({
    changes: [{ kind: "PART_REQUEST_PENDING", enabled: false, roles: {} }],
    actorUserId: superAdminId,
  });

  const kinds = await kindsFor(superAdminId, "SUPER_ADMIN");
  assert.equal(kinds.has("PART_REQUEST_PENDING"), false);
});

test("종류를 다시 켜면 원래 대상에게 돌아온다", async () => {
  await saveNotificationSettings({
    changes: [{ kind: "PART_REQUEST_PENDING", enabled: false, roles: {} }],
    actorUserId: superAdminId,
  });
  assert.equal((await kindsFor(adminId, "ADMIN")).has("PART_REQUEST_PENDING"), false);

  await saveNotificationSettings({
    changes: [{ kind: "PART_REQUEST_PENDING", enabled: true, roles: {} }],
    actorUserId: superAdminId,
  });
  assert.equal((await kindsFor(adminId, "ADMIN")).has("PART_REQUEST_PENDING"), true);
});

// ──────────────────────────────────────────── 역할 스위치

test("역할을 빼면 그 역할만 빠진다 — 다른 역할·다른 종류는 그대로다", async () => {
  await saveNotificationSettings({
    changes: [{ kind: "PART_REQUEST_PENDING", enabled: true, roles: { ADMIN: false } }],
    actorUserId: superAdminId,
  });

  const adminKinds = await kindsFor(adminId, "ADMIN");
  assert.equal(adminKinds.has("PART_REQUEST_PENDING"), false, "뺀 역할에게 아직 온다");
  assert.equal(adminKinds.has("REPAIR_CASE_APPROVAL"), true, "다른 종류까지 사라졌다");

  assert.equal(
    (await kindsFor(superAdminId, "SUPER_ADMIN")).has("PART_REQUEST_PENDING"),
    true,
    "다른 역할까지 빠졌다"
  );
});

test("🔴 최고관리자는 저장된 값과 무관하게 계속 받는다 — DB를 직접 고쳐도 그렇다", async () => {
  // 저장 경로는 이미 거절한다(mutations 통합 테스트). 여기서는 그 관문을
  // 우회해 행을 직접 넣어, 판정 쪽에도 잠금이 있는지 본다.
  await db.insert(notificationRoleSettings).values({
    kindKey: "PART_REQUEST_PENDING",
    role: "SUPER_ADMIN",
    receives: false,
    updatedBy: superAdminId,
  });

  const stored = await loadStoredNotificationSettings();
  assert.equal(stored.roleReceives.PART_REQUEST_PENDING?.SUPER_ADMIN, false, "행은 실제로 들어가 있다");
  assert.equal(
    deliversNotification("PART_REQUEST_PENDING", "SUPER_ADMIN", stored),
    true,
    "판정이 그 행을 따라가면 안 된다"
  );
  assert.equal((await kindsFor(superAdminId, "SUPER_ADMIN")).has("PART_REQUEST_PENDING"), true);
});

test("역할을 넣어도 원래 판정은 그대로다 — 설정은 윗단 필터일 뿐이다", async () => {
  // 영업을 결재 알림 대상으로 두어도, 영업은 검수 결재자가 아니므로 이 스위트가
  // 만든 결재 건은 여전히 보이지 않는다. 이것이 REPAIR_CASE_APPROVAL의 원래
  // 판정을 남겨 둔 이유다.
  await saveNotificationSettings({
    changes: [{ kind: "REPAIR_CASE_APPROVAL", enabled: true, roles: { SALES: true } }],
    actorUserId: superAdminId,
  });

  assert.deepEqual(await myItemIds(salesId, "SALES"), [], "역할을 열었다고 남의 결재 건이 보이면 안 된다");
  // 대조 — 결재자인 관리자에게는 같은 건이 그대로 보인다.
  assert.ok((await kindsFor(adminId, "ADMIN")).has("REPAIR_CASE_APPROVAL"));
});

// ──────────────────────────────────────────── 읽기 쪽 규약

test("등록되지 않은 종류의 남은 행은 무시된다", async () => {
  await db.insert(notificationKindSettings).values({
    kindKey: "옛날종류",
    isEnabled: false,
    updatedBy: superAdminId,
  });
  await db.insert(notificationRoleSettings).values({
    kindKey: "옛날종류",
    role: "ADMIN",
    receives: false,
    updatedBy: superAdminId,
  });

  try {
    const stored = await loadStoredNotificationSettings();
    assert.deepEqual(stored, { kindEnabled: {}, roleReceives: {} }, "없어진 종류의 행이 판정에 섞였다");
  } finally {
    await db.delete(notificationRoleSettings).where(eq(notificationRoleSettings.kindKey, "옛날종류"));
    await db.delete(notificationKindSettings).where(eq(notificationKindSettings.kindKey, "옛날종류"));
  }
});

test("화면 자료는 저장된 값과 기본값을 함께 내려보낸다", async () => {
  await saveNotificationSettings({
    changes: [{ kind: "PART_REQUEST_PENDING", enabled: false, roles: { INVENTORY_MANAGER: false } }],
    actorUserId: superAdminId,
  });

  const view = await buildNotificationSettingsView();
  const row = view.kinds.find((candidate) => candidate.kind === "PART_REQUEST_PENDING");
  assert.ok(row);
  assert.equal(row.enabled, false);
  assert.equal(row.defaultEnabled, true, "기본값은 저장된 값에 흔들리지 않는다");
  assert.equal(row.roles.INVENTORY_MANAGER.receives, false);
  assert.equal(row.roles.INVENTORY_MANAGER.defaultReceives, true);
  assert.equal(row.roles.SUPER_ADMIN.receives, true, "최고관리자 칸은 언제나 켜져 있다");

  const untouched = view.kinds.find((candidate) => candidate.kind === "REPAIR_CASE_APPROVAL");
  assert.ok(untouched);
  assert.equal(untouched.enabled, true, "다른 종류는 건드려지지 않는다");
});
