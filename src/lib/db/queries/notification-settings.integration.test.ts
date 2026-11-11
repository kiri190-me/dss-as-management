import "../../../../scripts/load-env";

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  notificationKindSettings,
  notificationRoleSettings,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { saveNotificationSettings } from "../mutations/notification-settings";
import { buildNotificationSettingsView, loadStoredNotificationSettings } from "./notification-settings";
import { listMyNotifications } from "./notifications";
import { deliversNotification } from "@/lib/domain/notification-settings";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/domain/notifications";
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
 * ── 🔴 표본은 **두 종류**여야 한다 ──────────────────────────────────────
 * 이 파일의 시험 절반이 「하나만 껐을 때 다른 하나는 멀쩡한가」를 잰다. 표본이
 * 하나뿐이면 「그 종류만」이라는 말을 할 수 없어 보증이 통째로 사라진다. 그래서
 * 알림에 실제로 잡힐 자료를 **종류마다** 만든다 — 아직 결정되지 않은 검수 결재
 * 요청 하나(결재 대기)와, 결정이 끝난 결재 둘(승인 완료). 자료가 없으면 어느
 * 설정을 넣어도 빈 목록이라 검사를 통째로 지워도 초록색인 테스트가 된다.
 *
 * ── 🔴 두 표본은 **받는 사람을 정하는 축이 서로 다르다** ────────────────
 *  · 결재 대기(REPAIR_CASE_APPROVAL) → 「그 건의 **결재자**인가」. 검수 결재는
 *    최고관리자·관리자·엔지니어가 받는다(repair-case-approvals-pending.ts의
 *    INSPECTION_DECIDE_ELIGIBLE_ROLES).
 *  · 승인 완료(APPROVAL_GRANTED) → 「내가 **올린** 결재인가, **또는** 내 역할이
 *    영업·관리자·최고관리자인가」(approval-outcome-notifications.ts).
 *    🔴 **2026-11-12 에 뒤쪽 절반이 붙었다** — 전에는 「요청자 본인에게만 가고 역할은
 *    보지 않는다」였다(사용자 요구로 승인 완료만 넓혔다. 반려됨은 그대로다).
 * 두 축이 같으면 「역할을 빼면 그 역할만」을 잴 수 없다 — 같은 사람이 둘 다 받거나
 * 둘 다 못 받아 갈라지는 자리가 사라진다.
 * 🔴 **그 넓히기로 이 파일에서 잃은 것이 하나 있다**: 「영업에게는 아무것도 안 간다」를
 * 두 종류로 한꺼번에 잴 수 없게 됐다. 영업은 이제 승인 완료 쪽을 받는다. 대신
 * **엔지니어**가 그 자리를 잇는다(결재 대기는 받고 승인 완료는 못 받는 사람).
 *
 * 🔵 **2026-10-27(옛 재고 걷어내기 13-C2)에 첫째 표본을 갈았다.** 그 전에는
 *    「부품 요청 대기」였고, 밑자락으로 부품 하나와 부품 요청 하나를 옛 재고 mutation
 *    둘(mutations/inventory.ts · mutations/inventory-part-requests.ts)로 만들었다. 재고
 *    기능이 별도 시스템으로 옮겨 가면서 재고 알림 셋과 그 mutation 들이 걷힐 예정이라,
 *    재고를 한 줄도 쓰지 않는 종류로 옮긴 것이다. 고른 까닭은 위의 축 갈림이 그대로
 *    살아 있다는 것과, 밑자락이 결재 행 insert 둘로 끝난다는 것 둘이다.
 *    🔴 이 교체로 **잃은 것이 하나 있다**: 기본값이 역할마다 갈리는 종류는 재고 알림
 *    둘(부품 요청 대기 · 재고 부족)뿐이고 나머지는 전부 「다섯 역할 모두 받음」이라,
 *    여기서는 더 이상 **기본값의 역할 갈림**을 잴 수 없다. 그 보증은 순수 규칙 쪽이
 *    종류별로 그대로 쥐고 있다(domain/notification-settings.test.ts).
 *
 * 격리 규약은 이 디렉터리의 다른 통합 테스트와 같다 — 접수 월 "9609", 제품 모델
 * 접두사 "NOTIFSET-TEST-". 알림 설정 두 표는 키가 종류+역할이라 전역이므로 매
 * 테스트마다 지운다.
 * ============================================================================
 */

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

let approvalCaseId: string;
let grantedForAdminApprovalId: string;
let grantedForSuperAdminApprovalId: string;

/**
 * 이 스위트가 **아무것도 만들기 전에** 관리자 종에 이미 서 있던 종류들.
 *
 * 🔴 **왜 재어 두는가**(2026-10-30). 등록된 종류 가운데 셋은 사람이 아니라 **DB 의
 * 지금 상태**가 띄운다 — 납기 임박 · 사내 목표 완료일 미등록 · 납기 역전(레지스트리
 * 머리말의 (다)형). 시험 DB 에는 이 스위트가 만들지 않은 접수 건이 이미 잔뜩 있어서,
 * 그중 하나가 그런 상태이면 그 종류가 **우리와 무관하게** 종에 선다.
 *
 * 실제로 그렇게 됐다: 납기 역전 알림을 붙인 날(2026-10-30) 아래 「1단계와 똑같다」가
 * 깨졌는데, 샌 것이 아니라 시험 DB 의 옛 건 하나가 역전이었다. 그렇다고 그 종류들을
 * 단언에서 빼 버리면 「남의 알림이 섞이지 않는다」는 보증이 통째로 사라진다. 그래서
 * **빼는 대신 먼저 재어 둔다** — 아래 시험은 「이 스위트가 만든 자료가 더한 종류가
 * 정확히 무엇인가」를 묻고, 재어 둔 것과의 차이만 본다.
 *
 * 🔵 우리 접수 건은 이 셋 중 하나도 띄우지 않는다(납기요청일 없음 · PO발행일 없음 ·
 *    고객 요청 납기일 없음). 그게 달라지면 차이에 그 종류가 섞여 아래 단언이 깨진다 —
 *    그때는 밑자락이 바뀐 것이니 여기 주석부터 다시 읽어야 한다.
 */
let ambientAdminKinds: Set<NotificationKind>;

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

/** 결재 행이 요구하는 `repair_case_version_at_request`. 방금 만든 건의 지금 판이다. */
async function caseVersion(caseId: string): Promise<number> {
  const [row] = await db
    .select({ version: repairCases.version })
    .from(repairCases)
    .where(eq(repairCases.id, caseId));
  assert.ok(row, "방금 만든 접수 건을 다시 읽지 못했다");
  return row.version;
}

/**
 * 「승인 완료」 알림이 그 결재 행을 가리키는 키.
 *
 * 글자 모양을 여기 그대로 적는 것은 domain/notifications.ts의
 * buildApprovalGrantedNotification이 만드는 값과 **맞대어 보기 위해서**다 — 그 함수를
 * 불러다 쓰면 「같은 코드로 만든 값과 같다」가 되어 아무것도 재지 못한다. `rca`는 그
 * 결재 행이 repair_case_approvals의 것이라는 표시다(그 파일의
 * APPROVAL_OUTCOME_KEY_TABLE_TAG). 이 키는 눌러서 확인한 기록의 키이기도 해서, 모양이
 * 바뀌면 쌓여 있던 확인 기록이 통째로 안 맞게 된다.
 */
function grantedTargetKey(approvalId: string): string {
  return `APPROVAL_GRANTED:rca:${approvalId}`;
}

/**
 * 결정이 끝난 결재 행 하나 — 「승인 완료」 알림의 원본.
 *
 * 창은 결정 시각 기준 7일이라 `decidedAt`을 지금으로 둔다. 결정자는 요청자와 **달라야**
 * 한다 — 자기가 한 일은 자기에게 알리지 않는다. 🔵 그 조건이 보는 것은 **지금 종을 여는
 * 사람**이다(approval-outcome-notifications.ts 의 `ne(decided_by, 보는 사람)`) —
 * 요청자만 보던 시절에는 둘이 같은 말이었다. 「최종 승인」은 같은 (접수 건, 결재 종류)에
 * 더 늦게 요청된 행이 없는 것이므로, 종류를 하나씩 나눠 쓰면 접수 건 하나로 둘을 만들 수
 * 있다.
 *
 * 🔴 **이 두 행은 관리자와 최고관리자가 서로의 것을 결정한 모양이다** — 그래서
 * 2026-11-12 뒤에도 각자 자기가 올린 것 하나씩만 본다(상대의 것은 자기가 결정해서
 * 빠진다). 영업처럼 **둘 다 결정하지 않은** 사람에게는 두 줄이 다 간다.
 */
async function insertGrantedApproval(input: {
  repairCaseId: string;
  approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT";
  requestedByUserId: string;
  decidedByUserId: string;
  versionAtRequest: number;
}): Promise<string> {
  const [row] = await db
    .insert(repairCaseApprovals)
    .values({
      repairCaseId: input.repairCaseId,
      approvalType: input.approvalType,
      status: "APPROVED",
      requestedByUserId: input.requestedByUserId,
      decidedByUserId: input.decidedByUserId,
      decidedAt: new Date(),
      repairCaseVersionAtRequest: input.versionAtRequest,
    })
    .returning({ id: repairCaseApprovals.id });
  assert.ok(row, "결재 행이 들어가지 않았다");
  return row.id;
}

/** 이 사용자에게 지금 잡히는 알림의 종류 집합. */
async function kindsFor(actorUserId: string, actorRole: Role): Promise<Set<NotificationKind>> {
  const items = await listMyNotifications(actorUserId, actorRole);
  return new Set(items.map((item) => item.kind));
}

/** 이 스위트가 만든 자료에서 나온 알림만. 시드·다른 스위트의 행에 흔들리지 않게 한다. */
async function myItemIds(actorUserId: string, actorRole: Role): Promise<string[]> {
  const items = await listMyNotifications(actorUserId, actorRole);
  const grantedKeys = new Set([
    grantedTargetKey(grantedForAdminApprovalId),
    grantedTargetKey(grantedForSuperAdminApprovalId),
  ]);
  return items
    .filter(
      (item) =>
        (item.kind === "REPAIR_CASE_APPROVAL" && item.targetKey === approvalCaseId) ||
        (item.kind === "APPROVAL_GRANTED" && grantedKeys.has(item.targetKey))
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

  // 🔴 **밑자락을 깔기 전에** 지금 종에 무엇이 서 있는지 먼저 센다(위 ambientAdminKinds
  //    주석). 설정 표가 비어 있다는 것은 바로 위에서 확인했으므로, 여기서 나오는 것은
  //    전부 「시험 DB 의 지금 상태」다.
  ambientAdminKinds = await kindsFor(adminId, "ADMIN");

  // ── 아직 결정되지 않은 검수 승인 요청 하나 ───────────────────────────
  // 최고관리자·관리자·A/S 엔지니어가 결재할 수 있는 종류다
  // (repair-case-approvals-pending.ts의 INSPECTION_DECIDE_ELIGIBLE_ROLES).
  approvalCaseId = await createTestCase();
  await db.insert(repairCaseApprovals).values({
    repairCaseId: approvalCaseId,
    approvalType: "REPAIR_INSPECTION",
    status: "REQUESTED",
    requestedByUserId: engineerId,
    repairCaseVersionAtRequest: await caseVersion(approvalCaseId),
  });

  // ── 결정이 끝난 결재 둘 — 관리자와 최고관리자가 각자 올린 것 하나씩 ────
  // 둘 다 필요한 것은 아래 시험들이 「관리자에게서 사라지는가」와 「최고관리자
  // 에게는 남는가」를 **같은 종류 하나로** 함께 재기 때문이다. 한쪽이 비면 그
  // 시험은 재는 것 없이 통과한다.
  const outcomeCaseId = await createTestCase();
  const outcomeVersion = await caseVersion(outcomeCaseId);
  grantedForAdminApprovalId = await insertGrantedApproval({
    repairCaseId: outcomeCaseId,
    approvalType: "REPAIR_INSPECTION",
    requestedByUserId: adminId,
    decidedByUserId: superAdminId,
    versionAtRequest: outcomeVersion,
  });
  grantedForSuperAdminApprovalId = await insertGrantedApproval({
    repairCaseId: outcomeCaseId,
    approvalType: "FINAL_SHIPMENT",
    requestedByUserId: superAdminId,
    decidedByUserId: adminId,
    versionAtRequest: outcomeVersion,
  });

  // 전제 확인 — 자료가 실제로 알림에 잡혀야 이 파일의 모든 단언이 뜻을 갖는다.
  const adminKinds = await kindsFor(adminId, "ADMIN");
  assert.ok(adminKinds.has("REPAIR_CASE_APPROVAL"), "설정 전에 결재 알림이 잡혀야 한다");
  assert.ok(adminKinds.has("APPROVAL_GRANTED"), "설정 전에 승인 완료 알림이 잡혀야 한다");
  // 🔴 최고관리자 쪽도 함께 본다 — 「종류를 끄면 최고관리자에게도 안 간다」와
  //    「역할을 빼도 최고관리자에게는 남는다」가 이 전제 위에 서 있어서, 전제가
  //    깨지면 그 둘이 아무것도 재지 않은 채 통과한다.
  const superAdminKinds = await kindsFor(superAdminId, "SUPER_ADMIN");
  assert.ok(superAdminKinds.has("REPAIR_CASE_APPROVAL"), "설정 전에 최고관리자도 결재 알림을 받아야 한다");
  assert.ok(superAdminKinds.has("APPROVAL_GRANTED"), "설정 전에 최고관리자도 승인 완료 알림을 받아야 한다");
});

afterEach(async () => {
  await db.delete(notificationRoleSettings).where(inArray(notificationRoleSettings.kindKey, TOUCHED_KINDS));
  await db.delete(notificationKindSettings).where(inArray(notificationKindSettings.kindKey, TOUCHED_KINDS));
});

after(async () => {
  for (const caseId of createdCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, caseId));
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
  // 역할이 늘거나 줄면 제목의 "다섯"이 거짓이 된다 — 빈 목록을 도는 for 문은
  // 아무것도 재지 않고 통과하므로 먼저 세어 둔다.
  assert.equal(ROLE_CODES.length, 5, "역할 수가 바뀌었다 — 이 시험이 무엇을 도는지 다시 적어야 한다");
  for (const role of ROLE_CODES) {
    assert.equal(
      deliversNotification("REPAIR_CASE_APPROVAL", role, stored),
      true,
      `결재 알림이 ${role}에게서 달라졌다 — 1단계에는 역할로 막는 코드가 없었다`
    );
    assert.equal(
      deliversNotification("APPROVAL_GRANTED", role, stored),
      true,
      `승인 완료 알림이 ${role}에게서 달라졌다 — 받는 사람을 정하는 것은 역할이 아니라 「내가 올린 결재인가」다`
    );
  }
});

test("🔴 설정이 하나도 없을 때 실제 종 알림이 1단계와 똑같다", async () => {
  // 규칙이 아니라 결과로 확인한다 — listMyNotifications를 그대로 태운다.
  //
  // 🔴 **「전부」가 아니라 「우리가 더한 것」을 본다**(2026-10-30 — ambientAdminKinds
  //    주석). 시험 DB 의 옛 건이 띄우는 상태형 종류는 이 스위트의 몫이 아니다. 빼고
  //    세는 것이 아니라 **미리 재어 둔 것과의 차이**를 보므로, 우리가 만들지 않은
  //    종류가 새로 끼어들면 여전히 여기서 깨진다.
  // 🔵 먼저 그 차이가 뜻을 갖는지부터 본다 — 두 종류가 이미 서 있었다면 아래
  //    deepEqual 은 「우리 자료가 하나도 안 잡혀도」 통과한다.
  for (const kind of ["REPAIR_CASE_APPROVAL", "APPROVAL_GRANTED"] as const) {
    assert.equal(
      ambientAdminKinds.has(kind),
      false,
      `${kind} 가 이 스위트 전에 이미 서 있었다 — 이 시험의 전제가 깨졌다(시험 DB 에 남의 결재 자료가 있다)`
    );
  }
  assert.deepEqual(
    [...(await kindsFor(adminId, "ADMIN"))].filter((kind) => !ambientAdminKinds.has(kind)).sort(),
    ["APPROVAL_GRANTED", "REPAIR_CASE_APPROVAL"],
    "관리자는 둘 다 받는다 — 검수 결재자이면서, 결정이 끝난 결재를 올린 사람이다"
  );

  const engineerKinds = await kindsFor(engineerId, "AS_ENGINEER");
  assert.ok(engineerKinds.has("REPAIR_CASE_APPROVAL"), "엔지니어는 검수 결재자다");
  assert.equal(
    engineerKinds.has("APPROVAL_GRANTED"),
    false,
    "엔지니어가 올린 검수 요청은 아직 결정되지 않았다 — 결과 알림은 결정이 나야 생긴다"
  );
  // 🔴 **2026-11-12 뒤에는 이 줄이 「안 넓혔다」까지 함께 지킨다.** 승인 완료가
  //    영업·관리자·최고관리자에게 넓어졌고 엔지니어는 그 셋이 아니다 — 여기까지
  //    넓히면 이 단언이 먼저 깨진다.

  // 🔴 **여기가 2026-11-12 에 뒤집혔다.** 전에는 「영업은 검수 결재자도, 이 결재들을
  //    올린 사람도 아니다」라 빈 목록이었다. 지금은 **영업이라서** 남이 올린 승인 완료
  //    두 줄을 받는다(결재 대기는 여전히 안 받는다 — 검수 결재자가 아니다).
  assert.deepEqual(
    [...(await myItemIds(salesId, "SALES"))].sort(),
    [grantedTargetKey(grantedForAdminApprovalId), grantedTargetKey(grantedForSuperAdminApprovalId)].sort(),
    "영업이 남이 올린 승인 완료를 못 받는다(2026-11-12 사용자 요구)"
  );
  // 🔵 **승인 완료만** 열린 것도 같은 단언이 함께 지킨다 — 거름망은 우리 결재 대기 건도
  //    집으므로(myItemIds), 영업에게 그것까지 갔다면 위 목록이 세 줄이 됐을 것이다.
  // 🔴 대조 — 같은 거름망이 관리자에게는 **두 줄을 집는다.** 이것이 없으면 위의
  //    빈 목록이 「영업에게 안 간다」인지 「거름망이 애초에 아무것도 못 집는다」인지
  //    구별되지 않는다.
  assert.equal(
    (await myItemIds(adminId, "ADMIN")).length,
    2,
    "거름망이 이 스위트가 만든 두 줄을 집지 못한다"
  );
});

// ──────────────────────────────────────────── 종류 스위치

test("🔴 종류를 끄면 그 종류만 사라지고 다른 종류는 그대로다", async () => {
  const before = await kindsFor(adminId, "ADMIN");
  assert.ok(before.has("APPROVAL_GRANTED") && before.has("REPAIR_CASE_APPROVAL"));

  const saved = await saveNotificationSettings({
    changes: [{ kind: "APPROVAL_GRANTED", enabled: false, roles: {} }],
    actorUserId: superAdminId,
  });
  assert.equal(saved.ok, true);

  const after = await kindsFor(adminId, "ADMIN");
  assert.equal(after.has("APPROVAL_GRANTED"), false, "끈 종류가 아직 온다");
  assert.equal(after.has("REPAIR_CASE_APPROVAL"), true, "끄지 않은 종류까지 사라졌다");
});

test("종류를 끄면 최고관리자에게도 그 종류가 가지 않는다 — 역할 스위치와 다른 축이다", async () => {
  // 종류 스위치는 "이 알림을 당분간 아무에게도 보내지 않는다"는 뜻이라
  // 예외를 두면 그 뜻이 성립하지 않는다. 역할 스위치의 최고관리자 잠금과
  // 혼동하지 않도록 여기서 못 박는다.
  await saveNotificationSettings({
    changes: [{ kind: "APPROVAL_GRANTED", enabled: false, roles: {} }],
    actorUserId: superAdminId,
  });

  const kinds = await kindsFor(superAdminId, "SUPER_ADMIN");
  assert.equal(kinds.has("APPROVAL_GRANTED"), false);
});

test("종류를 다시 켜면 원래 대상에게 돌아온다", async () => {
  await saveNotificationSettings({
    changes: [{ kind: "APPROVAL_GRANTED", enabled: false, roles: {} }],
    actorUserId: superAdminId,
  });
  assert.equal((await kindsFor(adminId, "ADMIN")).has("APPROVAL_GRANTED"), false);

  await saveNotificationSettings({
    changes: [{ kind: "APPROVAL_GRANTED", enabled: true, roles: {} }],
    actorUserId: superAdminId,
  });
  assert.equal((await kindsFor(adminId, "ADMIN")).has("APPROVAL_GRANTED"), true);
});

// ──────────────────────────────────────────── 역할 스위치

test("역할을 빼면 그 역할만 빠진다 — 다른 역할·다른 종류는 그대로다", async () => {
  await saveNotificationSettings({
    changes: [{ kind: "APPROVAL_GRANTED", enabled: true, roles: { ADMIN: false } }],
    actorUserId: superAdminId,
  });

  const adminKinds = await kindsFor(adminId, "ADMIN");
  assert.equal(adminKinds.has("APPROVAL_GRANTED"), false, "뺀 역할에게 아직 온다");
  assert.equal(adminKinds.has("REPAIR_CASE_APPROVAL"), true, "다른 종류까지 사라졌다");

  assert.equal(
    (await kindsFor(superAdminId, "SUPER_ADMIN")).has("APPROVAL_GRANTED"),
    true,
    "다른 역할까지 빠졌다"
  );
});

test("🔴 최고관리자는 저장된 값과 무관하게 계속 받는다 — DB를 직접 고쳐도 그렇다", async () => {
  // 저장 경로는 이미 거절한다(mutations 통합 테스트). 여기서는 그 관문을
  // 우회해 행을 직접 넣어, 판정 쪽에도 잠금이 있는지 본다.
  await db.insert(notificationRoleSettings).values({
    kindKey: "APPROVAL_GRANTED",
    role: "SUPER_ADMIN",
    receives: false,
    updatedBy: superAdminId,
  });

  const stored = await loadStoredNotificationSettings();
  assert.equal(stored.roleReceives.APPROVAL_GRANTED?.SUPER_ADMIN, false, "행은 실제로 들어가 있다");
  assert.equal(
    deliversNotification("APPROVAL_GRANTED", "SUPER_ADMIN", stored),
    true,
    "판정이 그 행을 따라가면 안 된다"
  );
  assert.equal((await kindsFor(superAdminId, "SUPER_ADMIN")).has("APPROVAL_GRANTED"), true);
});

test("역할을 넣어도 원래 판정은 그대로다 — 설정은 윗단 필터일 뿐이다", async () => {
  // 엔지니어를 두 종류의 대상으로 두어도, 엔지니어는 이 결재들을 올린 사람이 아니고
  // 승인 완료가 넓어진 세 역할에도 들지 않으므로 **승인 완료는 여전히 보이지 않는다.**
  // 이것이 종류의 원래 판정을 조회 안에 남겨 둔 이유다.
  //
  // 🔴 **표본이 영업에서 엔지니어로 바뀌었다**(2026-11-12). 영업은 이제 **역할 때문에**
  //    남의 승인 완료를 받으므로, 이 시험의 「역할을 열어도 안 보인다」를 영업으로는 더
  //    이상 잴 수 없다. 엔지니어는 결재 대기 쪽에서 원래 결재자라 그 줄이 함께 보이는
  //    것이 정상이다 — 그래서 승인 완료 쪽만 본다.
  await saveNotificationSettings({
    changes: [
      { kind: "REPAIR_CASE_APPROVAL", enabled: true, roles: { AS_ENGINEER: true } },
      { kind: "APPROVAL_GRANTED", enabled: true, roles: { AS_ENGINEER: true } },
    ],
    actorUserId: superAdminId,
  });

  assert.equal(
    (await kindsFor(engineerId, "AS_ENGINEER")).has("APPROVAL_GRANTED"),
    false,
    "역할을 열었다고 남이 올린 결재의 결과가 보이면 안 된다"
  );
  // 🔴 대조 — 결재자이자 요청자인 관리자에게는 같은 두 줄이 그대로 보인다. 거름망
  //    쪽으로도 한 번 더 세는 것은 위의 「안 보인다」가 「거름망이 아무것도 못 집는다」일
  //    수 있기 때문이다(실제로 알림 키 모양을 일부러 어긋나게 해 보니 이 시험만 조용히
  //    통과했다).
  const adminKinds = await kindsFor(adminId, "ADMIN");
  assert.ok(adminKinds.has("REPAIR_CASE_APPROVAL"));
  assert.ok(adminKinds.has("APPROVAL_GRANTED"));
  assert.equal((await myItemIds(adminId, "ADMIN")).length, 2, "거름망이 이 스위트가 만든 두 줄을 집지 못한다");
});

test("🔴 역할 스위치를 끄면 넓어진 역할도 남의 승인 완료를 못 받는다 — 설정이 윗단 필터인 자리", async () => {
  // 🔵 **넓힌 쪽을 되좁히는 손잡이가 실제로 듣는가**(2026-11-12). 바로 위 시험의
  //    반대 방향이다 — 그쪽은 「열어도 원래 판정이 막는다」, 이쪽은 「닫으면 넓어진
  //    것도 막힌다」. 둘 중 하나만 있으면 스위치가 한쪽으로만 듣는 것을 못 잡는다.
  assert.deepEqual(
    [...(await myItemIds(salesId, "SALES"))].sort(),
    [grantedTargetKey(grantedForAdminApprovalId), grantedTargetKey(grantedForSuperAdminApprovalId)].sort(),
    "전제 — 끄기 전에는 영업에게 두 줄이 간다"
  );

  await saveNotificationSettings({
    changes: [{ kind: "APPROVAL_GRANTED", enabled: true, roles: { SALES: false } }],
    actorUserId: superAdminId,
  });

  assert.deepEqual(await myItemIds(salesId, "SALES"), [], "역할 스위치를 꺼도 남의 승인 완료가 온다");
  // 🔴 끈 것은 영업 한 칸뿐이다 — 관리자는 그대로 자기 것을 받는다.
  assert.equal((await myItemIds(adminId, "ADMIN")).length, 2, "영업을 껐는데 관리자까지 빠졌다");
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
    changes: [{ kind: "APPROVAL_GRANTED", enabled: false, roles: { INVENTORY_MANAGER: false } }],
    actorUserId: superAdminId,
  });

  const view = await buildNotificationSettingsView();
  const row = view.kinds.find((candidate) => candidate.kind === "APPROVAL_GRANTED");
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
