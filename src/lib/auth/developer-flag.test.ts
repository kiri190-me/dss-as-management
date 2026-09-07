import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_CODES, roleLabels, type AccountApprovalStatus, type Role } from "@/lib/domain/types";
import { PERMISSION_LEAF_KEYS } from "./permission-features";
import { PERMISSION_AREAS } from "./permission-areas";
import {
  REQUEST_ELIGIBLE_ROLES,
  INSPECTION_DECIDE_ELIGIBLE_ROLES,
  isRequestEligible,
  isInspectionDecideEligible,
  resolveShipmentAuthorization,
  type ActingUser,
} from "@/lib/domain/local/approval/transitions";
import type { LocalShipmentDelegation } from "@/lib/domain/local/approval/delegation-types";
import { actorHasAllowedRole, actorMay, DEVELOPER_PROMOTED_ROLE } from "./developer-promotion";
import { mayEnterDeveloperMode } from "./developer-mode-gate";
import {
  canViewPublishedProcedureTemplates,
  canViewAllProcedureTemplateStatuses,
  canImportProcedureTemplates,
  canPublishProcedureTemplates,
  canArchiveProcedureTemplates,
  canCreateProcedureTemplateDraft,
  canEditProcedureTemplateDraft,
  canResolveProcedureValidationIssues,
} from "./procedure-template-authorization";
import {
  canManageTechnicalTemplates,
  canEditTechnicalTemplateDraft,
  canCreateTechnicalTemplateDraftVersion,
  canActorPublishTemplateOfCategory,
  canActorCreateDraftVersionOfCategory,
  canActorManageTechnicalTemplateGraph,
  canDeleteTechnicalTemplates,
} from "./technical-procedure-template-authorization";
import { canManageRolePermissions } from "./role-permission-authorization";
import { canManageNotificationSettings } from "./notification-settings-authorization";
import { canEditProductModels } from "./product-model-authorization";
import {
  canPerformOrdinaryExecutionMutation,
  canReopenBlockedNode,
  canReopenCompletedOrSkippedNode,
  executionRequiresOwnAssignment,
} from "./procedure-case-execution-authorization";
import { workRecordRequiresOwnAssignment } from "./repair-case-work-record-authorization";
import {
  checkAssignedEngineer,
  checkHoldEligibilityForCategory,
  checkManualStepSetEligibility,
  checkRoleEligibility,
  checkTransitionEligibility,
} from "@/lib/domain/local/workflow/permissions";
import { evaluateAddCaseStepAvailability } from "@/lib/domain/local/workflow/workflow-action-availability";
import {
  STEP_CATEGORY_CODES,
  roleForCategory,
  type StepCategory,
} from "@/lib/domain/local/workflow/step-category";
import { RELEASED_HOLD_STATE, type HoldState } from "@/lib/domain/local/workflow/workflow-types";
import type { TransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";

/**
 * ============================================================================
 * 「A/S 엔지니어인데 개발자」 — 역할은 그대로다
 * ============================================================================
 * users.is_developer 가 켜지면 **권한 판정만** 최고관리자와 같아진다
 * (permission-resolver.ts). 역할 자체는 손대지 않는다 — 역할을 갈아치우는
 * 방식으로 구현하면 그 사람이 엔지니어 명단에서 사라지고 배정에서 빠진다.
 *
 * 여기 있는 시험들은 DB 를 타지 않는 쪽만 지킨다. 실효 권한이 실제로
 * 최고관리자와 같아지는지는 developer-permissions.integration.test.ts 가 본다
 * (해석기가 role_permissions 표를 읽으므로 DB 가 필요하다).
 * ============================================================================
 */

function engineer(overrides: Partial<ActingUser> = {}): ActingUser {
  return {
    id: "u-eng",
    name: "엔지니어 개발자",
    role: "AS_ENGINEER",
    approvalStatus: "APPROVED",
    isDeveloper: false,
    ...overrides,
  };
}

test("개발자여도 진짜 역할은 A/S 엔지니어 그대로다 — 이름표까지", () => {
  const dev = engineer({ isDeveloper: true });

  assert.equal(dev.role, "AS_ENGINEER");
  assert.equal(roleLabels[dev.role], "A/S 엔지니어");
});

test("개발자 표시는 배정·자격 판정을 하나도 바꾸지 않는다", () => {
  const plain = engineer();
  const dev = engineer({ isDeveloper: true });

  // 부품 요청·검수 자격은 역할 목록으로만 갈린다.
  assert.equal(isRequestEligible(dev), isRequestEligible(plain));
  assert.equal(isInspectionDecideEligible(dev), isInspectionDecideEligible(plain));

  // 자격 목록 자체가 역할 코드만 담는다 — 개발자라는 항목이 끼어들 자리가 없다.
  for (const role of [...REQUEST_ELIGIBLE_ROLES, ...INSPECTION_DECIDE_ELIGIBLE_ROLES]) {
    assert.ok((ROLE_CODES as readonly string[]).includes(role), `${role} 은 역할 코드가 아니다`);
  }
});

test("개발자여도 출하 대리인이 되지는 않는다 — 대표는 ID 로만 정해진다", () => {
  // 출하 승인은 역할이 아니라 명시적 대표 ID/위임으로만 열린다. 권한 승격이
  // 여기까지 번지면 「최고관리자와 동급」이 대표 제도를 통째로 무력화한다.
  const dev = engineer({ isDeveloper: true });
  assert.deepEqual(resolveShipmentAuthorization(dev, [], "2026-09-07T00:00:00Z"), { allowed: false });
});

test("개발자는 역할이 아니다 — ROLE_CODES 에 없다", () => {
  assert.ok(!(ROLE_CODES as readonly string[]).includes("DEVELOPER"));
  assert.equal(ROLE_CODES.length, 5);

  // 역할 이름표에도 없다(화면에 「개발자」라는 역할이 뜨면 안 된다).
  for (const role of ROLE_CODES) {
    assert.equal(typeof roleLabels[role as Role], "string");
  }
  assert.equal(Object.keys(roleLabels).length, 5);
});

/**
 * ============================================================================
 * 승격은 「더하기」다 — 갈아치우기가 아니다
 * ============================================================================
 * 아래 시험들이 지키는 규칙 하나:
 *
 *     개발자의 권한 = 진짜 역할의 권한 ∪ 최고관리자의 권한
 *
 * 갈아치우기(`isDeveloper ? "SUPER_ADMIN" : role`)였다면 최고관리자가 그 사람의
 * 진짜 역할보다 낮은 자리에서 **개발자가 되는 것이 손해**가 된다. 그런 자리가
 * 실제로 둘 있고 둘 다 화면에서 사람이 바꾸는 값이다 — role_permissions 표와
 * 워크플로 전이의 allowed_roles (developer-promotion.ts).
 * ============================================================================
 */

/** 「이 사람이 해도 되는가」를 역할로 판정하는 함수들 — 승격이 닿아야 하는 자리. */
const ROLE_PREDICATES: readonly { name: string; decide: (role: Role) => boolean }[] = [
  { name: "canViewPublishedProcedureTemplates", decide: canViewPublishedProcedureTemplates },
  { name: "canViewAllProcedureTemplateStatuses", decide: canViewAllProcedureTemplateStatuses },
  { name: "canImportProcedureTemplates", decide: canImportProcedureTemplates },
  { name: "canPublishProcedureTemplates", decide: canPublishProcedureTemplates },
  { name: "canArchiveProcedureTemplates", decide: canArchiveProcedureTemplates },
  { name: "canCreateProcedureTemplateDraft", decide: canCreateProcedureTemplateDraft },
  { name: "canEditProcedureTemplateDraft", decide: canEditProcedureTemplateDraft },
  { name: "canResolveProcedureValidationIssues", decide: canResolveProcedureValidationIssues },
  { name: "canManageTechnicalTemplates", decide: canManageTechnicalTemplates },
  { name: "canEditTechnicalTemplateDraft", decide: canEditTechnicalTemplateDraft },
  { name: "canCreateTechnicalTemplateDraftVersion", decide: canCreateTechnicalTemplateDraftVersion },
  { name: "canManageRolePermissions", decide: canManageRolePermissions },
  { name: "canManageNotificationSettings", decide: canManageNotificationSettings },
  { name: "canEditProductModels", decide: canEditProductModels },
  { name: "canReopenCompletedOrSkippedNode", decide: canReopenCompletedOrSkippedNode },
  {
    name: "canActorPublishTemplateOfCategory(TECHNICAL_TASK)",
    decide: (role) => canActorPublishTemplateOfCategory(role, "TECHNICAL_TASK"),
  },
  {
    name: "canActorPublishTemplateOfCategory(FULL_SERVICE)",
    decide: (role) => canActorPublishTemplateOfCategory(role, "FULL_SERVICE"),
  },
  {
    name: "canActorCreateDraftVersionOfCategory(TECHNICAL_TASK)",
    decide: (role) => canActorCreateDraftVersionOfCategory(role, "TECHNICAL_TASK"),
  },
  {
    name: "canActorManageTechnicalTemplateGraph(TECHNICAL_TASK)",
    decide: (role) => canActorManageTechnicalTemplateGraph(role, "TECHNICAL_TASK"),
  },
  {
    name: "canDeleteTechnicalTemplates(TECHNICAL_TASK)",
    decide: (role) => canDeleteTechnicalTemplates(role, "TECHNICAL_TASK"),
  },
];

test("🔴 승격은 더하기다 — 진짜 역할로 되던 것은 개발자가 되어도 그대로 된다", () => {
  // 갈아치우기였다면 「최고관리자는 안 되는데 이 역할은 되는」 함수에서 개발자가
  // 권한을 잃는다. 다섯 역할 × 모든 판정 함수에 대해 그런 일이 없어야 한다.
  for (const role of ROLE_CODES) {
    for (const { name, decide } of ROLE_PREDICATES) {
      const plain = decide(role);
      const dev = actorMay({ role, isDeveloper: true }, decide);
      if (plain) {
        assert.equal(dev, true, `${role}/${name}: 개발자가 되면서 권한을 잃었다`);
      }
      assert.equal(
        dev,
        plain || decide(DEVELOPER_PROMOTED_ROLE),
        `${role}/${name}: 더하기 결과가 「진짜 역할 ∪ 최고관리자」가 아니다`
      );
    }
  }
});

test("🔴 최고관리자 정책이 좁아도 개발자는 자기 역할 권한을 잃지 않는다 — 참/거짓 모양", () => {
  // 최고관리자에게는 닫혀 있고 A/S 엔지니어에게만 열린 가상의 정책. 갈아치우기
  // 방식에서는 여기서 개발자 엔지니어가 막힌다.
  const engineerOnly = (role: Role) => role === "AS_ENGINEER";

  assert.equal(engineerOnly("SUPER_ADMIN"), false);
  assert.equal(actorMay(engineer({ isDeveloper: true }), engineerOnly), true);
  assert.equal(actorMay(engineer(), engineerOnly), true);

  // 반대 방향도 마찬가지다 — 최고관리자에게만 열린 정책이면 개발자도 통과한다.
  const superAdminOnly = (role: Role) => role === "SUPER_ADMIN";
  assert.equal(actorMay(engineer({ isDeveloper: true }), superAdminOnly), true);
  assert.equal(actorMay(engineer(), superAdminOnly), false);
});

test("🔴 「최고관리자 동급」이 「무엇이든 통과」는 아니다", () => {
  // 최고관리자도 못 하는 일은 개발자도 못 한다. 이것이 「모든 권한 MANAGE 로
  // 박기」와 「최고관리자 해석 결과를 더하기」의 차이다.
  const nobody = () => false;
  assert.equal(actorMay(engineer({ isDeveloper: true }), nobody), false);

  const salesOnly: readonly Role[] = ["SALES"];
  assert.equal(actorHasAllowedRole(engineer({ isDeveloper: true }), salesOnly), false);
});

test("개발자 표시가 꺼진 계정의 답은 모든 자리에서 예전과 같다", () => {
  // 남에게 권한이 새지 않는다 — 승격은 isDeveloper === true 일 때만이다.
  for (const role of ROLE_CODES) {
    for (const { name, decide } of ROLE_PREDICATES) {
      assert.equal(
        actorMay({ role, isDeveloper: false }, decide),
        decide(role),
        `${role}/${name}: 개발자가 아닌데 답이 달라졌다`
      );
    }
    for (const allowed of [REQUEST_ELIGIBLE_ROLES, INSPECTION_DECIDE_ELIGIBLE_ROLES, [] as readonly Role[]]) {
      assert.equal(
        actorHasAllowedRole({ role, isDeveloper: false }, allowed),
        allowed.includes(role),
        `${role}: 허용 역할 목록 판정이 달라졌다`
      );
    }
  }
});

test("🔴 개발자는 표준 절차를 관리할 수 있다 — A/S 엔지니어여도", () => {
  const dev = engineer({ isDeveloper: true });

  // 절차 수명주기(가져오기·게시·보관·새 버전·편집)는 원래 최고관리자 전용이고,
  // 기술 절차 관리는 관리자 이상이다. 개발자 엔지니어는 둘 다 통과해야 한다.
  for (const { name, decide } of ROLE_PREDICATES) {
    if (!decide(DEVELOPER_PROMOTED_ROLE)) continue;
    assert.equal(actorMay(dev, decide), true, `${name}: 개발자가 통과하지 못한다`);
  }

  // 표시가 꺼진 같은 엔지니어는 여전히 막힌다 — 승격이 남에게 새지 않는다.
  assert.equal(actorMay(engineer(), canManageTechnicalTemplates), false);
  assert.equal(actorMay(engineer(), canImportProcedureTemplates), false);

  // 분류 조건이 먼저인 함수는 승격해도 분류를 뚫지 않는다.
  assert.equal(
    actorMay(dev, (role) => canActorManageTechnicalTemplateGraph(role, "FULL_SERVICE")),
    false,
    "승격이 TECHNICAL_TASK 전용 조건을 뚫었다"
  );
  assert.equal(
    actorMay(dev, (role) => canDeleteTechnicalTemplates(role, "REFERENCE")),
    false,
    "승격이 분류 조건을 뚫었다"
  );
});

test("개발자는 역할별 권한 설정·알림 설정을 관리할 수 있다", () => {
  const dev = engineer({ isDeveloper: true });
  assert.equal(actorMay(dev, canManageRolePermissions), true);
  assert.equal(actorMay(dev, canManageNotificationSettings), true);
  assert.equal(actorMay(engineer(), canManageRolePermissions), false);
  assert.equal(actorMay(engineer(), canManageNotificationSettings), false);

  // 기본 정책보다 높게 저장할 수 있는가(canWiden / mayWiden)도 같은 판정이다.
  const mayWiden = (role: Role) => role === "SUPER_ADMIN";
  assert.equal(actorMay(dev, mayWiden), true);
  assert.equal(actorMay(engineer(), mayWiden), false);
});

test("개발자는 접수 시 새 제품 모델을 등록할 수 있다", () => {
  // 접수 화면은 이미 승격된 판정으로 이 칸을 여닫는다. 저장 경로
  // (services/create-repair-case.ts)도 같은 답이어야 「보이는데 저장은 거절」이
  // 생기지 않는다.
  assert.equal(actorMay(engineer({ isDeveloper: true }), canEditProductModels), true);
  assert.equal(actorMay(engineer(), canEditProductModels), false);
});

/** 전이 정의 한 줄. 허용 역할과 담당 요구 여부만 바꿔 가며 자격 판정을 본다. */
function transitionAllowing(
  allowedRoles: readonly Role[],
  options: { requiresAssignedEngineer?: boolean } = {}
): TransitionDefinition {
  return {
    id: "t-test",
    workflowType: "PAID_GENERATOR",
    actionCode: "STEP_ADVANCED",
    fromStepKey: "intake_inspection",
    toStepKey: "parts_supply",
    toStatus: "WAITING_PARTS_SUPPLY",
    direction: "FORWARD",
    allowedRoles,
    requiresAssignedEngineer: options.requiresAssignedEngineer ?? false,
    requiresReason: false,
    requiredApprovalType: null,
  };
}

test("🔴 전이의 허용 역할이 [\"AS_ENGINEER\"] 뿐이어도 개발자 엔지니어는 통과한다", () => {
  // 초안 편집기에서 실제로 만들 수 있는 전이다. 갈아치우기 방식이었다면 개발자
  // 엔지니어는 진짜 역할로는 통과하는데 승격 뒤에는 막힌다 — 「표시를 켜니까
  // 오히려 안 되네」가 정확히 이 자리다.
  const engineerOnly = transitionAllowing(["AS_ENGINEER"]);
  assert.deepEqual(checkRoleEligibility(engineerOnly, engineer({ isDeveloper: true })), { allowed: true });
  assert.deepEqual(checkRoleEligibility(engineerOnly, engineer()), { allowed: true });

  // 최고관리자만 허용한 전이는 개발자 엔지니어에게 열린다(승격의 본래 목적).
  const superAdminOnly = transitionAllowing(["SUPER_ADMIN"]);
  assert.deepEqual(checkRoleEligibility(superAdminOnly, engineer({ isDeveloper: true })), { allowed: true });
  assert.equal(checkRoleEligibility(superAdminOnly, engineer()).allowed, false);

  // 최고관리자도 없는 전이는 개발자도 못 지난다.
  assert.equal(checkRoleEligibility(transitionAllowing(["SALES"]), engineer({ isDeveloper: true })).allowed, false);

  // 승인되지 않은 계정은 개발자여도 막힌다 — 승인 상태는 승격 대상이 아니다.
  assert.equal(
    checkRoleEligibility(superAdminOnly, engineer({ isDeveloper: true, approvalStatus: "PENDING" })).allowed,
    false
  );
});

test("🔴 워크플로 초안 편집기의 체크박스는 승격되지 않는다", () => {
  // 그 화면의 roles.includes(role) 은 현재 사용자에 대한 판정이 아니라 「이
  // 전이를 어느 역할에 허용할지」 고르는 체크박스의 체크 상태다 — 편집 중인
  // 값이다. 승격을 넣으면 개발자에게만 엉뚱한 체크가 켜져 보이고, 저장하면
  // 그 값이 실제 전이에 박힌다.
  const source = readFileSync(
    join(process.cwd(), "src/components/workflows/WorkflowDraftTransitionEditor.tsx"),
    "utf8"
  );
  assert.ok(
    !/from ["'][^"']*developer-promotion["']/.test(source),
    "전이 편집기가 승격 창구를 불러왔다 — 체크박스는 값이지 권한 판정이 아니다"
  );
  assert.ok(
    !/\bactorMay\b|\bactorHasAllowedRole\b/.test(source),
    "전이 편집기의 체크박스 판정에 승격이 들어갔다"
  );
});

test("개발자여도 배정 사실은 달라지지 않는다 — 바뀌는 것은 「담당을 요구하는가」뿐이다", () => {
  const dev = engineer({ isDeveloper: true });
  const someoneElse = { effectiveAssigneeId: "u-other", actorUserId: dev.id };
  const mine = { effectiveAssigneeId: dev.id, actorUserId: dev.id };

  // 최고관리자는 담당을 요구받지 않으므로, 더한 결과 개발자도 요구받지 않는다.
  assert.equal(executionRequiresOwnAssignment("AS_ENGINEER"), true);
  assert.equal(executionRequiresOwnAssignment(DEVELOPER_PROMOTED_ROLE), false);
  assert.equal(actorMay(dev, (role) => !executionRequiresOwnAssignment(role)), true);
  assert.equal(actorMay(engineer(), (role) => !executionRequiresOwnAssignment(role)), false);

  assert.equal(actorMay(dev, (role) => canPerformOrdinaryExecutionMutation(role, someoneElse)), true);
  assert.equal(actorMay(engineer(), (role) => canPerformOrdinaryExecutionMutation(role, someoneElse)), false);
  assert.equal(actorMay(engineer(), (role) => canPerformOrdinaryExecutionMutation(role, mine)), true);
  assert.equal(actorMay(dev, (role) => canReopenBlockedNode(role, someoneElse)), true);

  // 그런데 **배정 인자 자체는 그대로다** — 승격이 남의 배정을 내 것으로
  // 바꿔 적지 않는다. 그것을 확인하는 방법은 값을 그대로 되읽는 것뿐이다.
  assert.equal(someoneElse.effectiveAssigneeId, "u-other");
  assert.equal(someoneElse.actorUserId, dev.id);
});

test("🔴 개발자여도 출하 대리인·결재 위임은 달라지지 않는다 — 남의 위임까지", () => {
  const dev = engineer({ isDeveloper: true });

  // 대표가 아니고, 유효한 위임도 자기 것이 아니면 개발자여도 열리지 않는다.
  const someoneElsesDelegation: LocalShipmentDelegation[] = [
    {
      id: "d-1",
      principalUserId: "u-001",
      principalNameSnapshot: "대표",
      delegateUserId: "u-other",
      delegateNameSnapshot: "다른 사람",
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2027-01-01T00:00:00Z",
      reason: "휴가",
      createdAt: "2026-01-01T00:00:00Z",
      source: "LOCAL_DEMO",
    },
  ];
  assert.deepEqual(
    resolveShipmentAuthorization(dev, someoneElsesDelegation, "2026-09-07T00:00:00Z"),
    { allowed: false }
  );
});

test("🔴 자격 목록 판정은 승격된다 — 목록이 최고관리자를 담고 있으므로", () => {
  // 위의 「배정·자격 판정을 하나도 바꾸지 않는다」 시험은 A/S 엔지니어를 본다.
  // 엔지니어는 두 목록에 이미 들어 있어 답이 달라지지 않는다. 목록에 없는
  // 역할에서는 달라지는 것이 맞다 — 최고관리자가 목록에 있으니 개발자도 통과한다.
  const salesDev: ActingUser = {
    id: "u-sales",
    name: "영업 개발자",
    role: "SALES",
    approvalStatus: "APPROVED",
    isDeveloper: true,
  };
  const salesPlain: ActingUser = { ...salesDev, isDeveloper: false };

  assert.ok(REQUEST_ELIGIBLE_ROLES.includes(DEVELOPER_PROMOTED_ROLE));
  assert.ok(!REQUEST_ELIGIBLE_ROLES.includes("SALES"));

  assert.equal(isRequestEligible(salesPlain), false);
  assert.equal(isRequestEligible(salesDev), true);
  assert.equal(isInspectionDecideEligible(salesPlain), false);
  assert.equal(isInspectionDecideEligible(salesDev), true);

  // 승인 상태는 여전히 승격 대상이 아니다.
  assert.equal(isRequestEligible({ ...salesDev, approvalStatus: "PENDING" }), false);
});

/**
 * ============================================================================
 * 🔴 배정 관문 — 「담당 엔지니어인가」를 묻는 자리
 * ============================================================================
 * 최고관리자는 이 검사를 건너뛴다. 승격이 여기까지 닿지 않으면 개발자 엔지니어는
 * 남의 담당 건에서 막히고, 그러면 「최고관리자와 동급」이 아니다.
 *
 * 이 자리들에서 역할 비교는 두 방향으로 쓰인다:
 *  - 문을 **여는** 비교(「최고관리자·관리자면 통과」) → 개발자가 통과하는 쪽
 *  - 제약을 **조이는** 비교(「엔지니어일 뿐이면 담당 조건을 더 건다」)
 *    → 개발자가 **걸리지 않는** 쪽. 여기에 순진하게 승격을 씌우면 방향이
 *      뒤집혀 개발자에게 제약이 하나 더 붙는다.
 *
 * 아래 시험들이 두 방향을 각각 못 박는다. 판정 함수는 로컬(mock)과 DB 모드가
 * 같은 한 벌을 쓴다(mutations/workflow-transitions.ts 가 그대로 부른다).
 * ============================================================================
 */

const OTHER_ENGINEER_ID = "u-someone-else";

const ON_HOLD_STATE: HoldState = {
  isOnHold: true,
  reason: "부품 대기",
  startedByUserId: "u-eng",
  startedByNameSnapshot: "엔지니어",
  startedAt: "2026-09-07T00:00:00Z",
};

function actorWithRole(role: Role, overrides: Partial<ActingUser> = {}): ActingUser {
  return { ...engineer(), role, ...overrides };
}

test("🔴 개발자 엔지니어는 남의 담당 건도 전이할 수 있다 — 배정 관문을 최고관리자처럼 지난다", () => {
  const needsAssignee = transitionAllowing(["AS_ENGINEER"], { requiresAssignedEngineer: true });
  const dev = engineer({ isDeveloper: true });

  // 남의 담당 건 — 승격이 닿지 않으면 여기서 막힌다.
  assert.deepEqual(checkAssignedEngineer(needsAssignee, dev, OTHER_ENGINEER_ID), { allowed: true });
  assert.equal(checkAssignedEngineer(needsAssignee, engineer(), OTHER_ENGINEER_ID).allowed, false);

  // 담당이 아무도 없는 건도 최고관리자와 같은 답이다.
  assert.deepEqual(checkAssignedEngineer(needsAssignee, dev, null), { allowed: true });
  assert.equal(checkAssignedEngineer(needsAssignee, engineer(), null).allowed, false);

  // 최고관리자가 실제로 그렇게 지나간다는 것이 이 승격의 근거다.
  assert.deepEqual(
    checkAssignedEngineer(needsAssignee, actorWithRole("SUPER_ADMIN"), OTHER_ENGINEER_ID),
    { allowed: true }
  );

  // 자기 담당 건은 표시와 무관하게 통과한다 — 승격이 답을 뒤집지 않는다.
  assert.deepEqual(checkAssignedEngineer(needsAssignee, engineer(), "u-eng"), { allowed: true });

  // 담당을 요구하지 않는 전이는 애초에 이 관문을 보지 않는다.
  assert.deepEqual(
    checkAssignedEngineer(transitionAllowing(["AS_ENGINEER"]), engineer(), OTHER_ENGINEER_ID),
    { allowed: true }
  );
});

test("🔴 전이 전체 경로에서도 개발자 엔지니어가 남의 건을 진행한다", () => {
  // checkTransitionEligibility 는 역할 → 담당 → 보류 순서다. 세 검사 중
  // 어디에서도 개발자가 걸리지 않아야 실제로 버튼이 눌린다.
  const engineerOnly = transitionAllowing(["AS_ENGINEER"], { requiresAssignedEngineer: true });
  assert.deepEqual(
    checkTransitionEligibility(engineerOnly, engineer({ isDeveloper: true }), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE),
    { allowed: true }
  );
  assert.equal(
    checkTransitionEligibility(engineerOnly, engineer(), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE).allowed,
    false
  );

  // 최고관리자만 허용한 전이도 개발자 엔지니어에게 열린다 — 역할·담당 양쪽 모두.
  const superAdminOnly = transitionAllowing(["SUPER_ADMIN"], { requiresAssignedEngineer: true });
  assert.deepEqual(
    checkTransitionEligibility(superAdminOnly, engineer({ isDeveloper: true }), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE),
    { allowed: true }
  );

  // 보류 검사는 승격 대상이 아니다 — 개발자도 보류 중에는 다른 작업을 못 한다.
  assert.equal(
    checkTransitionEligibility(engineerOnly, engineer({ isDeveloper: true }), OTHER_ENGINEER_ID, ON_HOLD_STATE).allowed,
    false
  );
});

test("🔴 개발자 엔지니어는 어느 분류의 단계에서도 보류를 시작·해제할 수 있다", () => {
  const dev = engineer({ isDeveloper: true });

  for (const category of STEP_CATEGORY_CODES) {
    assert.deepEqual(
      checkHoldEligibilityForCategory(category, dev, OTHER_ENGINEER_ID),
      { allowed: true },
      `${category}: 개발자가 보류에서 막혔다`
    );
    assert.deepEqual(
      checkHoldEligibilityForCategory(category, actorWithRole("SUPER_ADMIN"), OTHER_ENGINEER_ID),
      { allowed: true },
      `${category}: 최고관리자 정책이 바뀌었다 — 이 시험의 전제가 사라졌다`
    );
  }

  // 분류를 못 찾은 단계까지 최고관리자와 같다(최고관리자도 분류를 보지 않는다).
  assert.deepEqual(checkHoldEligibilityForCategory(null, dev, OTHER_ENGINEER_ID), { allowed: true });

  // 표시가 꺼진 엔지니어는 예전 그대로 — 자기 담당의 기술 단계에서만.
  assert.deepEqual(checkHoldEligibilityForCategory("TECHNICAL", engineer(), "u-eng"), { allowed: true });
  assert.equal(checkHoldEligibilityForCategory("TECHNICAL", engineer(), OTHER_ENGINEER_ID).allowed, false);
  assert.equal(checkHoldEligibilityForCategory("TECHNICAL", engineer(), null).allowed, false);
  assert.equal(checkHoldEligibilityForCategory("BUSINESS", engineer(), "u-eng").allowed, false);
  assert.equal(checkHoldEligibilityForCategory(null, engineer(), "u-eng").allowed, false);
});

test("🔴 개발자 엔지니어는 단계를 직접 변경할 수 있다 — 조건이 더 붙지 않는다", () => {
  const dev = engineer({ isDeveloper: true });

  // 🔴 부정형 함정이 있던 자리. 「AS_ENGINEER 면 담당 조건을 더 건다」는 제약을
  // **조이는** 비교라, 순진하게 승격을 씌웠다면 개발자에게 제약이 하나 더 붙어
  // 바로 여기서 막힌다.
  assert.deepEqual(
    checkManualStepSetEligibility(dev, OTHER_ENGINEER_ID, RELEASED_HOLD_STATE),
    { allowed: true }
  );
  assert.deepEqual(checkManualStepSetEligibility(dev, null, RELEASED_HOLD_STATE), { allowed: true });

  // 최고관리자가 실제로 그렇게 지나간다.
  assert.deepEqual(
    checkManualStepSetEligibility(actorWithRole("SUPER_ADMIN"), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE),
    { allowed: true }
  );

  // 표시가 꺼진 엔지니어는 예전 그대로 자기 담당 건만.
  assert.deepEqual(checkManualStepSetEligibility(engineer(), "u-eng", RELEASED_HOLD_STATE), { allowed: true });
  assert.equal(checkManualStepSetEligibility(engineer(), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE).allowed, false);
  assert.equal(checkManualStepSetEligibility(engineer(), null, RELEASED_HOLD_STATE).allowed, false);

  // 역할 관문 자체도 열린다 — 영업 개발자는 최고관리자로 지난다.
  assert.deepEqual(
    checkManualStepSetEligibility(
      actorWithRole("SALES", { isDeveloper: true }),
      OTHER_ENGINEER_ID,
      RELEASED_HOLD_STATE
    ),
    { allowed: true }
  );
  assert.equal(
    checkManualStepSetEligibility(actorWithRole("SALES"), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE).allowed,
    false
  );

  // 보류 검사는 승격 대상이 아니다.
  assert.equal(checkManualStepSetEligibility(dev, OTHER_ENGINEER_ID, ON_HOLD_STATE).allowed, false);
});

test("🔴 승인되지 않은 개발자는 배정 관문 어디서도 통과하지 못한다", () => {
  // 승인 상태는 승격 대상이 아니고, 그 검사가 가장 먼저 오는 순서도 그대로다.
  const pending = engineer({ isDeveloper: true, approvalStatus: "PENDING" });

  assert.equal(checkHoldEligibilityForCategory("TECHNICAL", pending, "u-eng").allowed, false);
  assert.equal(checkHoldEligibilityForCategory(null, pending, "u-eng").allowed, false);
  assert.equal(checkManualStepSetEligibility(pending, "u-eng", RELEASED_HOLD_STATE).allowed, false);
  assert.equal(checkRoleEligibility(transitionAllowing(["SUPER_ADMIN"]), pending).allowed, false);
  assert.equal(
    checkTransitionEligibility(
      transitionAllowing(["SUPER_ADMIN"], { requiresAssignedEngineer: true }),
      pending,
      "u-eng",
      RELEASED_HOLD_STATE
    ).allowed,
    false
  );
});

/** 승격 **이전**의 판정을 그대로 적어 둔다 — 다른 역할의 답을 대조할 기준. */
function legacyAssignedEngineer(user: ActingUser, assignedEngineerId: string | null): boolean {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return true;
  if (user.role !== "AS_ENGINEER") return true;
  if (!assignedEngineerId) return false;
  return assignedEngineerId === user.id;
}

function legacyHold(
  category: StepCategory | null,
  user: ActingUser,
  assignedEngineerId: string | null
): boolean {
  if (user.approvalStatus !== "APPROVED") return false;
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return true;
  if (!category) return false;
  const requiredRole = roleForCategory(category);
  if (user.role !== requiredRole) return false;
  if (requiredRole === "AS_ENGINEER") {
    if (!assignedEngineerId) return false;
    if (assignedEngineerId !== user.id) return false;
  }
  return true;
}

function legacyManualStepSet(
  user: ActingUser,
  assignedEngineerId: string | null,
  holdState: HoldState
): boolean {
  if (user.approvalStatus !== "APPROVED") return false;
  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN" && user.role !== "AS_ENGINEER") return false;
  if (user.role === "AS_ENGINEER") {
    if (!assignedEngineerId) return false;
    if (assignedEngineerId !== user.id) return false;
  }
  return !holdState.isOnHold;
}

const ASSIGNEES: readonly (string | null)[] = [null, "u-eng", OTHER_ENGINEER_ID];
const CATEGORIES: readonly (StepCategory | null)[] = [null, ...STEP_CATEGORY_CODES];
const HOLD_STATES: readonly HoldState[] = [RELEASED_HOLD_STATE, ON_HOLD_STATE];
const APPROVALS: readonly AccountApprovalStatus[] = ["APPROVED", "PENDING"];

test("🔴 개발자 표시가 꺼진 계정의 답은 배정 관문 세 곳 전부 예전과 같다 — 다섯 역할", () => {
  // 남에게 권한이 새지 않는다. 다른 역할의 정책이 한 톨이라도 바뀌면 여기서 걸린다.
  const needsAssignee = transitionAllowing([...ROLE_CODES], { requiresAssignedEngineer: true });

  for (const role of ROLE_CODES) {
    for (const approvalStatus of APPROVALS) {
      const user = actorWithRole(role, { approvalStatus });
      for (const assignedEngineerId of ASSIGNEES) {
        assert.equal(
          checkAssignedEngineer(needsAssignee, user, assignedEngineerId).allowed,
          legacyAssignedEngineer(user, assignedEngineerId),
          `${role}/${approvalStatus}/${assignedEngineerId}: 담당 엔지니어 판정이 달라졌다`
        );
        for (const category of CATEGORIES) {
          assert.equal(
            checkHoldEligibilityForCategory(category, user, assignedEngineerId).allowed,
            legacyHold(category, user, assignedEngineerId),
            `${role}/${approvalStatus}/${category}/${assignedEngineerId}: 보류 판정이 달라졌다`
          );
        }
        for (const holdState of HOLD_STATES) {
          assert.equal(
            checkManualStepSetEligibility(user, assignedEngineerId, holdState).allowed,
            legacyManualStepSet(user, assignedEngineerId, holdState),
            `${role}/${approvalStatus}/${assignedEngineerId}/보류=${holdState.isOnHold}: 단계 직접 변경 판정이 달라졌다`
          );
        }
      }
    }
  }
});

test("🔴 개발자의 답은 배정 관문 세 곳 전부 「진짜 역할 ∪ 최고관리자」다 — 다섯 역할", () => {
  // 더하기의 정확한 정의를 그대로 단언한다: 같은 사람(같은 id)이 최고관리자였다면
  // 되는 일은 개발자에게도 되고, 그 이상은 열리지 않는다.
  const needsAssignee = transitionAllowing([...ROLE_CODES], { requiresAssignedEngineer: true });

  for (const role of ROLE_CODES) {
    for (const approvalStatus of APPROVALS) {
      const plain = actorWithRole(role, { approvalStatus });
      const dev: ActingUser = { ...plain, isDeveloper: true };
      const asSuperAdmin: ActingUser = { ...plain, role: DEVELOPER_PROMOTED_ROLE };

      for (const assignedEngineerId of ASSIGNEES) {
        assert.equal(
          checkAssignedEngineer(needsAssignee, dev, assignedEngineerId).allowed,
          checkAssignedEngineer(needsAssignee, plain, assignedEngineerId).allowed ||
            checkAssignedEngineer(needsAssignee, asSuperAdmin, assignedEngineerId).allowed,
          `${role}/${approvalStatus}/${assignedEngineerId}: 담당 관문이 더하기가 아니다`
        );
        for (const category of CATEGORIES) {
          assert.equal(
            checkHoldEligibilityForCategory(category, dev, assignedEngineerId).allowed,
            checkHoldEligibilityForCategory(category, plain, assignedEngineerId).allowed ||
              checkHoldEligibilityForCategory(category, asSuperAdmin, assignedEngineerId).allowed,
            `${role}/${approvalStatus}/${category}/${assignedEngineerId}: 보류가 더하기가 아니다`
          );
        }
        for (const holdState of HOLD_STATES) {
          assert.equal(
            checkManualStepSetEligibility(dev, assignedEngineerId, holdState).allowed,
            checkManualStepSetEligibility(plain, assignedEngineerId, holdState).allowed ||
              checkManualStepSetEligibility(asSuperAdmin, assignedEngineerId, holdState).allowed,
            `${role}/${approvalStatus}/${assignedEngineerId}/보류=${holdState.isOnHold}: 단계 직접 변경이 더하기가 아니다`
          );
        }
      }
    }
  }
});

test("🔴 배정 사실은 달라지지 않는다 — 바뀌는 것은 역할 축뿐이다", () => {
  const dev = engineer({ isDeveloper: true });
  const needsAssignee = transitionAllowing(["AS_ENGINEER"], { requiresAssignedEngineer: true });

  // 남의 건을 지나가도 담당 엔지니어 ID 는 그대로 남의 것이다 — 판정 함수는
  // 배정을 읽기만 하고 쓰지 않는다(순수 함수라 되읽어 확인한다).
  const assignedEngineerId = OTHER_ENGINEER_ID;
  assert.deepEqual(checkAssignedEngineer(needsAssignee, dev, assignedEngineerId), { allowed: true });
  assert.equal(assignedEngineerId, OTHER_ENGINEER_ID);
  assert.equal(dev.id, "u-eng");
  assert.notEqual(dev.id, assignedEngineerId);

  // 전이 정의의 requiresAssignedEngineer 도 그대로다 — 개발자라고 해서 「담당이
  // 필요 없는 전이」로 바뀌지 않는다. 바뀌는 것은 이 사람의 답뿐이다.
  assert.equal(needsAssignee.requiresAssignedEngineer, true);
});

/**
 * ============================================================================
 * 🔴 작업 기록의 배정 관문 — 화면과 서버가 같은 답을 내야 한다
 * ============================================================================
 * 형제 함수 executionRequiresOwnAssignment 는 이미 승격돼 있었다. 그래서
 * 승격 전에는 「작업 실행은 되는데 작업 기록은 거절」이 실제로 났다.
 * ============================================================================
 */

/** 화면(execution/page.tsx)과 서버(mutations/repair-case-work-records.ts)가 똑같이 계산하는 식. */
function mayCreateWorkRecord(user: ActingUser, isAssignedToCase: boolean): boolean {
  return actorMay(user, (role) => !workRecordRequiresOwnAssignment(role) || isAssignedToCase);
}

/** 형제 쪽(mutations/procedure-case-execution.ts)의 같은 식. */
function mayPerformExecution(user: ActingUser, isAssigned: boolean): boolean {
  return actorMay(user, (role) => !executionRequiresOwnAssignment(role) || isAssigned);
}

test("🔴 개발자 엔지니어는 남의 담당 건에도 작업 기록을 남긴다", () => {
  assert.equal(mayCreateWorkRecord(engineer({ isDeveloper: true }), false), true);
  assert.equal(mayCreateWorkRecord(engineer(), false), false);
  assert.equal(mayCreateWorkRecord(engineer(), true), true);

  // 최고관리자는 담당을 요구받지 않는다 — 그것이 이 승격의 근거다.
  assert.equal(workRecordRequiresOwnAssignment(DEVELOPER_PROMOTED_ROLE), false);
  assert.equal(workRecordRequiresOwnAssignment("AS_ENGINEER"), true);

  // 승인 상태는 여전히 승격 대상이 아니다 — 서버는 resolveEligibleActor 가
  // 승인·활성·잠금을 먼저 본다(developer-permissions.integration.test.ts).
});

test("🔴 형제 함수 둘이 같은 답을 준다 — 작업 실행과 작업 기록", () => {
  for (const role of ROLE_CODES) {
    for (const isDeveloper of [false, true]) {
      for (const assigned of [false, true]) {
        const user = actorWithRole(role, { isDeveloper });
        assert.equal(
          mayCreateWorkRecord(user, assigned),
          mayPerformExecution(user, assigned),
          `${role}/개발자=${isDeveloper}/배정=${assigned}: 두 형제 함수의 답이 갈린다`
        );
      }
    }
  }
});

test("작업 기록의 담당 조건 — 개발자 표시가 꺼진 계정은 다섯 역할 전부 예전과 같다", () => {
  for (const role of ROLE_CODES) {
    for (const assigned of [false, true]) {
      assert.equal(
        mayCreateWorkRecord(actorWithRole(role), assigned),
        !workRecordRequiresOwnAssignment(role) || assigned,
        `${role}/배정=${assigned}: 개발자가 아닌데 답이 달라졌다`
      );
    }
  }
});

test("🔴 작업 기록의 화면과 서버가 둘 다 승격 창구를 지난다 — 한쪽만 고치면 어긋난다", () => {
  // 한쪽만 고치면 「보이는데 저장은 거절」 또는 「안 보이는데 서버는 허용」이 된다.
  // 직전 조각에서 실제로 그런 어긋남이 하나 나왔다(접수 화면과 저장 경로).
  const sources = [
    "src/app/(app)/repair-cases/[id]/execution/page.tsx",
    "src/lib/db/mutations/repair-case-work-records.ts",
  ];

  for (const relative of sources) {
    const source = readFileSync(join(process.cwd(), relative), "utf8");
    assert.ok(
      /from ["'][^"']*developer-promotion["']/.test(source),
      `${relative}: 승격 창구를 부르지 않는다`
    );
    assert.ok(/\bactorMay\(/.test(source), `${relative}: actorMay 를 쓰지 않는다`);
    assert.ok(
      !/workRecordRequiresOwnAssignment\(\s*\w+\.role\s*\)/.test(source),
      `${relative}: 승격을 거치지 않고 역할을 그대로 넘긴다`
    );
  }
});

/**
 * ============================================================================
 * 🔴 「이 건에만 단계 추가」 — 화면과 서버가 같은 모양이다
 * ============================================================================
 * 화면(workflow-action-availability.ts 의 evaluateAddCaseStepAvailability)과
 * 서버(db/mutations/case-workflow-steps.ts 의 addCaseWorkflowStep)가 같은 식을
 * 각자 계산한다. 한쪽만 승격하면 「단추는 보이는데 저장은 거절」 또는 「안
 * 보이는데 서버는 허용」이 된다.
 *
 * 화면 쪽은 순수 함수라 여기서 직접 부른다. **서버가 실제로 통과시키는지**는
 * developer-permissions.integration.test.ts 가 DB 로 확인한다.
 *
 * ⚠️ 이 화면 판정에는 승인 상태 검사가 없다(전이 쪽과 달리 예전부터 그렇다 —
 * (app)/layout.tsx 가 APPROVED 세션만 통과시키고, 이 함수는 힌트다). 승격이
 * 그 사실을 바꾸지 않는다는 것도 아래 대조 시험이 다섯 역할 × 두 승인 상태로
 * 지킨다. 실제 차단은 서버가 승인 상태를 먼저 보는 것으로 이뤄진다.
 * ============================================================================
 */

const CASE_LOCKS: readonly boolean[] = [false, true];

/** 승격 **이전**의 화면 판정을 그대로 적어 둔다 — 다른 역할의 답을 대조할 기준. */
function legacyAddCaseStep(
  user: ActingUser,
  assignedEngineerId: string | null,
  isCaseLocked: boolean
): boolean {
  if (isCaseLocked) return false;
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return true;
  if (user.role !== "AS_ENGINEER") return false;
  return assignedEngineerId === user.id;
}

test("🔴 개발자 엔지니어는 남의 담당 건에도 단계를 추가할 수 있다 — 화면 판정", () => {
  const dev = engineer({ isDeveloper: true });

  // 남의 담당 건 — 승격이 닿지 않으면 여기서 단추가 잠긴다.
  assert.deepEqual(
    evaluateAddCaseStepAvailability({ actingUser: dev, assignedEngineerId: OTHER_ENGINEER_ID, isCaseLocked: false }),
    { available: true }
  );
  // 담당이 아무도 없는 건도 최고관리자와 같은 답이다.
  assert.deepEqual(
    evaluateAddCaseStepAvailability({ actingUser: dev, assignedEngineerId: null, isCaseLocked: false }),
    { available: true }
  );

  // 최고관리자가 실제로 그렇게 지나간다는 것이 이 승격의 근거다.
  assert.deepEqual(
    evaluateAddCaseStepAvailability({
      actingUser: actorWithRole("SUPER_ADMIN"),
      assignedEngineerId: OTHER_ENGINEER_ID,
      isCaseLocked: false,
    }),
    { available: true }
  );

  // 표시가 꺼진 엔지니어는 예전 그대로 자기 담당 건만.
  assert.equal(
    evaluateAddCaseStepAvailability({ actingUser: engineer(), assignedEngineerId: OTHER_ENGINEER_ID, isCaseLocked: false })
      .available,
    false
  );
  assert.deepEqual(
    evaluateAddCaseStepAvailability({ actingUser: engineer(), assignedEngineerId: "u-eng", isCaseLocked: false }),
    { available: true }
  );

  // 역할 관문 자체도 열린다 — 영업 개발자는 최고관리자로 지난다.
  assert.deepEqual(
    evaluateAddCaseStepAvailability({
      actingUser: actorWithRole("SALES", { isDeveloper: true }),
      assignedEngineerId: OTHER_ENGINEER_ID,
      isCaseLocked: false,
    }),
    { available: true }
  );
  assert.equal(
    evaluateAddCaseStepAvailability({
      actingUser: actorWithRole("SALES"),
      assignedEngineerId: OTHER_ENGINEER_ID,
      isCaseLocked: false,
    }).available,
    false
  );

  // 잠금은 승격 대상이 아니다 — 출하 완료로 잠긴 건은 개발자도 못 건드린다.
  assert.equal(
    evaluateAddCaseStepAvailability({ actingUser: dev, assignedEngineerId: OTHER_ENGINEER_ID, isCaseLocked: true })
      .available,
    false
  );
  // 로그인 정보가 없으면 개발자든 아니든 없는 것이다.
  assert.equal(
    evaluateAddCaseStepAvailability({ actingUser: null, assignedEngineerId: null, isCaseLocked: false }).available,
    false
  );
});

test("🔴 단계 추가에서도 배정 사실은 달라지지 않는다 — 바뀌는 것은 역할 축뿐이다", () => {
  const dev = engineer({ isDeveloper: true });
  const assignedEngineerId = OTHER_ENGINEER_ID;

  assert.deepEqual(
    evaluateAddCaseStepAvailability({ actingUser: dev, assignedEngineerId, isCaseLocked: false }),
    { available: true }
  );
  // 판정 함수는 배정을 읽기만 하고 쓰지 않는다(순수 함수라 되읽어 확인한다).
  assert.equal(assignedEngineerId, OTHER_ENGINEER_ID, "승격이 배정 사실을 바꿔 적었다");
  assert.equal(dev.id, "u-eng");
  assert.notEqual(dev.id, assignedEngineerId);
});

test("🔴 개발자 표시가 꺼진 계정의 단계 추가 답은 예전과 같다 — 다섯 역할", () => {
  // 남에게 권한이 새지 않는다. 다른 역할의 정책이 한 톨이라도 바뀌면 여기서 걸린다.
  for (const role of ROLE_CODES) {
    for (const approvalStatus of APPROVALS) {
      const user = actorWithRole(role, { approvalStatus });
      for (const assignedEngineerId of ASSIGNEES) {
        for (const isCaseLocked of CASE_LOCKS) {
          assert.equal(
            evaluateAddCaseStepAvailability({ actingUser: user, assignedEngineerId, isCaseLocked }).available,
            legacyAddCaseStep(user, assignedEngineerId, isCaseLocked),
            `${role}/${approvalStatus}/${assignedEngineerId}/잠금=${isCaseLocked}: 단계 추가 판정이 달라졌다`
          );
        }
      }
    }
  }
});

test("🔴 개발자의 단계 추가 답은 「진짜 역할 ∪ 최고관리자」다 — 다섯 역할", () => {
  for (const role of ROLE_CODES) {
    for (const approvalStatus of APPROVALS) {
      const plain = actorWithRole(role, { approvalStatus });
      const dev: ActingUser = { ...plain, isDeveloper: true };
      const asSuperAdmin: ActingUser = { ...plain, role: DEVELOPER_PROMOTED_ROLE };

      for (const assignedEngineerId of ASSIGNEES) {
        for (const isCaseLocked of CASE_LOCKS) {
          assert.equal(
            evaluateAddCaseStepAvailability({ actingUser: dev, assignedEngineerId, isCaseLocked }).available,
            evaluateAddCaseStepAvailability({ actingUser: plain, assignedEngineerId, isCaseLocked }).available ||
              evaluateAddCaseStepAvailability({ actingUser: asSuperAdmin, assignedEngineerId, isCaseLocked }).available,
            `${role}/${approvalStatus}/${assignedEngineerId}/잠금=${isCaseLocked}: 단계 추가가 더하기가 아니다`
          );
        }
      }
    }
  }
});

test("🔴 단계 추가의 화면과 서버가 둘 다 승격 창구를 지난다 — 한쪽만 고치면 어긋난다", () => {
  const screen = readFileSync(
    join(process.cwd(), "src/lib/domain/local/workflow/workflow-action-availability.ts"),
    "utf8"
  );
  const server = readFileSync(join(process.cwd(), "src/lib/db/mutations/case-workflow-steps.ts"), "utf8");

  for (const [label, source] of [["화면", screen], ["서버", server]] as const) {
    assert.ok(
      /from ["'][^"']*developer-promotion["']/.test(source),
      `${label}: 승격 창구를 부르지 않는다`
    );
    assert.ok(/\bactorMay\(/.test(source), `${label}: actorMay 를 쓰지 않는다`);
  }

  // 🔴 서버는 actor 를 select 할 때 isDeveloper 를 함께 읽어야 한다. 이 칸이
  // 빠지면 actorMay 를 불러도 언제나 false 로 판정된다(조용히 실패한다).
  assert.ok(
    /isDeveloper:\s*users\.isDeveloper/.test(server),
    "서버: actor select 에 isDeveloper 칸이 없다"
  );
  // 승격을 거치지 않고 역할을 그대로 비교하던 옛 모양이 남아 있지 않다.
  assert.ok(
    !/const isAdmin = actor\.role ===/.test(server),
    "서버: 승격을 거치지 않는 옛 역할 비교가 남아 있다"
  );
});

/**
 * ============================================================================
 * 🔴 출하 대리인 「지정」 — 화면과 서버가 같은 열쇠·같은 수준을 쓴다
 * ============================================================================
 * 서버는 세 곳 모두 `hasPermission(actor, "users.shipmentRepresentatives",
 * "MANAGE")` 으로 판정한다(대표 지정, 위임 생성, 위임 철회). 화면은
 * 클라이언트 컴포넌트라 그 함수를 await 할 수 없어서, 서버 페이지가 계산해
 * prop 으로 내려보낸다.
 *
 * 기본 정책이 `MANAGE = 최고관리자` 라서 다섯 역할에서는 화면이 역할 리터럴을
 * 쓰던 시절에도 두 답이 같았다. **개발자에게만 갈렸다** — 서버는 허용하는데
 * 단추가 잠겼다. 그래서 여기서는 「같은 열쇠·같은 수준을 쓰는가」를 원본으로
 * 지킨다. 서버가 실제로 개발자를 통과시키는지는 integration 시험이 본다.
 * ============================================================================
 */

const REPRESENTATIVE_AREA_KEY = "users.shipmentRepresentatives";

test("🔴 대표 지정 판정을 화면이 직접 계산하지 않는다 — 서버 페이지가 내려보낸다", () => {
  const screen = readFileSync(join(process.cwd(), "src/components/users/RepresentativeManagementScreen.tsx"), "utf8");

  // 🔴 예전 모양: 화면이 스스로 `const isSuperAdmin = actingUser.role === "SUPER_ADMIN"`
  // 을 계산했다. 그 자리가 남아 있으면 개발자에게 다시 갈린다.
  assert.ok(
    !/const\s+isSuperAdmin\s*=/.test(screen),
    "화면이 아직 역할 리터럴로 대표 지정 자격을 스스로 계산한다"
  );
  // 서버가 계산해 내려보낸 값을 받는다.
  assert.ok(/canManageRepresentatives:\s*boolean/.test(screen), "화면이 판정 prop 을 받지 않는다");
  // 🔴 아래 두 화면의 prop 이름도 2026-09-07 에 `canManageRepresentatives` 로
  // 바뀌었다. 이름만 고친 순수 개명이지만 여기서 대조하는 문자열이 그것이라
  // 함께 옮긴다 — 그리고 **두 자리 모두**에 넘기는지 개수로 확인한다. 한쪽만
  // 넘기면 목록은 열리는데 위임 칸이 잠긴다(또는 그 반대).
  assert.equal(
    [...screen.matchAll(/canManageRepresentatives=\{canManageRepresentatives\}/g)].length,
    2,
    "받은 값을 아래 두 화면 모두에 넘기지 않는다"
  );
  // 옛 이름으로 넘기는 자리가 남아 있지 않다(주석에서 경위를 설명하는 것은 별개).
  assert.ok(!/isSuperAdmin=\{/.test(screen), "옛 prop 이름 isSuperAdmin 으로 넘기는 자리가 남아 있다");
});

test("🔴 대표 지정 화면 둘의 prop 이름이 값의 뜻과 같다 — isSuperAdmin 은 거짓말이었다", () => {
  // 넘어오는 값은 hasPermission(actor, "users.shipmentRepresentatives",
  // "MANAGE") 이고, 개발자 표시가 켜진 계정도 통과한다. 이름이 `isSuperAdmin`
  // 이면 읽는 사람이 「최고관리자만」으로 읽고, 화면 문구도 그렇게 적힌다.
  for (const relative of [
    "src/components/users/RepresentativeListSection.tsx",
    "src/components/users/DelegationSection.tsx",
  ]) {
    const source = readFileSync(join(process.cwd(), relative), "utf8");
    assert.ok(
      /canManageRepresentatives:\s*boolean/.test(source),
      `${relative}: prop 이름이 canManageRepresentatives 가 아니다`
    );
    assert.ok(!/\bisSuperAdmin\b/.test(source), `${relative}: 옛 이름 isSuperAdmin 이 남아 있다`);
    // 안내 문구도 함께 고쳤다 — 「최고관리자만」이라고 적혀 있으면 개발자
    // 표시로 통과하는 사람에게 어긋난 이유를 알려 준다.
    assert.ok(
      !/최고관리자만/.test(source),
      `${relative}: 「최고관리자만」이라는 문구가 남아 있다`
    );
  }
});

test("🔴 화면 페이지와 서버 mutation 세 곳이 같은 영역 열쇠·같은 수준을 쓴다", () => {
  // 열쇠나 수준이 한 곳만 달라지면 개발자에게 또 갈린다 — 그때 증상은
  // 「단추는 보이는데 저장은 거절」이고, 화면에는 아무 설명도 남지 않는다.
  const sources = [
    "src/app/(app)/users/page.tsx",
    "src/lib/db/mutations/shipment-representatives.ts",
    "src/lib/db/mutations/shipment-delegations.ts",
  ];

  const pattern = /hasPermission\(\s*\w+(?:\.\w+)*\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  let total = 0;
  for (const relative of sources) {
    const source = readFileSync(join(process.cwd(), relative), "utf8");
    const found = [...source.matchAll(pattern)].filter(([, areaKey]) => areaKey === REPRESENTATIVE_AREA_KEY);
    assert.ok(found.length > 0, `${relative}: ${REPRESENTATIVE_AREA_KEY} 판정이 없다`);
    for (const [, , level] of found) {
      assert.equal(level, "MANAGE", `${relative}: 수준이 MANAGE 가 아니다`);
    }
    total += found.length;
  }
  // 화면 1 + 대표 지정 1 + 위임 생성·철회 2 = 4. 늘거나 줄면 새 자리가 생긴
  // 것이므로 같은 열쇠·수준인지 사람이 한 번 봐야 한다.
  assert.equal(total, 4, `대표 지정 판정 자리의 수가 달라졌다: ${total}`);
});

/**
 * ============================================================================
 * 🔴 개발자 모드 관문 — 설정으로는 절대 열 수 없는 문 하나
 * ============================================================================
 * 「개발자 모드」 메뉴만은 역할별 접근 권한 설정 밖의 길로 통과한다. 근거는
 * 그 설정 화면의 존재 목적이 **「접근을 넓히는 것」**이라서다 — 목록에 넣으면
 * 최고관리자가 A/S 엔지니어나 영업 담당자에게 그 화면을 열어 줄 수 있게 된다.
 * 더미 데이터와 배포 도구를 다루게 될 화면에 그 길이 있어서는 안 된다.
 *
 * 관문은 `actorMay` 를 쓰지 않는다. 그 창구의 질문은 「최고관리자 동급 권한이
 * 필요한 일을 해도 되는가」이고, 여기는 「이 사람이 **개발자냐**」다. 지금은 답이
 * 같아 보이지만(개발자가 최고관리자 권한을 가지므로) 뜻이 달라서, 섞으면 승격
 * 규칙을 손보는 날 이 문이 함께 움직인다(developer-mode-gate.ts 파일 주석).
 * ============================================================================
 */

test("🔴 개발자 모드 관문 — 최고관리자와 개발자만 통과한다", () => {
  // 최고관리자는 표시가 꺼져 있어도 통과한다.
  assert.equal(mayEnterDeveloperMode(actorWithRole("SUPER_ADMIN")), true);
  // 개발자 엔지니어도 통과한다 — 이 문이 열려야 하는 나머지 절반이다.
  assert.equal(mayEnterDeveloperMode(engineer({ isDeveloper: true })), true);

  // 다섯 역할의 **비개발자는 전부 거절**된다(최고관리자만 예외).
  for (const role of ROLE_CODES) {
    assert.equal(
      mayEnterDeveloperMode(actorWithRole(role)),
      role === "SUPER_ADMIN",
      `${role}: 개발자 표시가 꺼진 계정의 답이 틀렸다`
    );
    // 표시가 켜지면 역할과 무관하게 통과한다.
    assert.equal(
      mayEnterDeveloperMode(actorWithRole(role, { isDeveloper: true })),
      true,
      `${role}: 개발자인데 거절됐다`
    );
  }
});

test("🔴 승인되지 않은 개발자는 개발자 모드에 못 들어간다 — 승인은 승격 대상이 아니다", () => {
  for (const role of ROLE_CODES) {
    for (const isDeveloper of [false, true]) {
      assert.equal(
        mayEnterDeveloperMode(actorWithRole(role, { isDeveloper, approvalStatus: "PENDING" })),
        false,
        `${role}/개발자=${isDeveloper}: 승인 대기 계정이 통과했다`
      );
    }
  }
  // 승인 상태가 유일한 차이일 때 답이 갈린다는 것을 한 줄로 못 박는다.
  assert.equal(mayEnterDeveloperMode(engineer({ isDeveloper: true })), true);
  assert.equal(
    mayEnterDeveloperMode(engineer({ isDeveloper: true, approvalStatus: "PENDING" })),
    false
  );
});

test("🔴 관문은 승격 창구(actorMay)를 쓰지 않는다 — 다른 질문이기 때문이다", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/auth/developer-mode-gate.ts"), "utf8");
  assert.ok(
    !/from ["'][^"']*developer-promotion["']/.test(source),
    "관문이 승격 창구를 불러왔다 — 승격 규칙을 바꾸는 날 이 문이 함께 움직인다"
  );
  // 호출을 본다 — 파일 주석은 왜 안 쓰는지를 설명하느라 그 이름을 적고 있다.
  assert.ok(!/\bactorMay\(|\bactorHasAllowedRole\(/.test(source), "관문 판정에 승격 창구가 들어갔다");
  // 그런데 답은 지금 「최고관리자 ∪ 개발자」와 같아야 한다 — 뜻이 다르다는 것이
  // 값이 다르다는 뜻은 아니다. 갈리면 어느 한쪽이 잘못된 것이므로 여기서 걸린다.
  for (const role of ROLE_CODES) {
    for (const isDeveloper of [false, true]) {
      const actor = actorWithRole(role, { isDeveloper });
      assert.equal(
        mayEnterDeveloperMode(actor),
        actorMay(actor, (r) => r === DEVELOPER_PROMOTED_ROLE),
        `${role}/개발자=${isDeveloper}: 관문의 답이 「최고관리자 ∪ 개발자」와 갈렸다`
      );
    }
  }
});

test("🔴 데스크톱과 모바일 드로어가 같은 답을 준다 — 폰에서만 문이 열려 있던 자리다", () => {
  // 2026-08-31 에 accessibleAreaKeys 가 정확히 여기서 새어 나갔다: 데스크톱
  // <aside> 에만 넘기고 모바일 드로어를 빠뜨려서, 폰에서는 접근 권한 설정이
  // 통째로 무시됐다. 같은 처방을 쓴다 — **필수 prop** 으로 두어 빠뜨리면
  // 컴파일이 실패하게 하고, 두 호출부가 같은 값을 넘기는지 여기서 대조한다.
  const shell = readFileSync(join(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8");

  // 필수 prop 이다(물음표가 붙어 있으면 빠뜨려도 컴파일이 통과한다).
  assert.ok(
    /canEnterDeveloperMode:\s*boolean/.test(shell),
    "AppShell 이 canEnterDeveloperMode 를 받지 않는다"
  );
  assert.ok(
    !/canEnterDeveloperMode\?:/.test(shell),
    "canEnterDeveloperMode 가 선택 인자다 — 빠뜨려도 컴파일이 통과한다"
  );

  // <Sidebar 호출이 정확히 둘(데스크톱·모바일)이고, 둘 다 같은 값을 넘긴다.
  const sidebarCalls = [...shell.matchAll(/<Sidebar\b/g)].length;
  assert.equal(sidebarCalls, 2, `AppShell 의 Sidebar 호출부가 둘이 아니다: ${sidebarCalls}`);
  assert.equal(
    [...shell.matchAll(/canEnterDeveloperMode=\{canEnterDeveloperMode\}/g)].length,
    sidebarCalls,
    "Sidebar 호출부 중 관문 값을 안 넘기는 곳이 있다 — 폰과 컴퓨터가 다른 메뉴를 그린다"
  );
  // 접근 권한 쪽도 같은 수만큼 넘어간다 — 예전에 새던 그 값이다.
  assert.equal(
    [...shell.matchAll(/accessibleAreaKeys=\{accessibleAreaKeys\}/g)].length,
    sidebarCalls
  );

  // Sidebar 쪽도 필수로 받고, 거른다.
  const sidebar = readFileSync(join(process.cwd(), "src/components/layout/Sidebar.tsx"), "utf8");
  assert.ok(/canEnterDeveloperMode:\s*boolean/.test(sidebar), "Sidebar 가 관문 값을 받지 않는다");
  assert.ok(!/canEnterDeveloperMode\?:/.test(sidebar), "Sidebar 의 관문 prop 이 선택 인자다");
  assert.ok(
    /filterNavItemsForAccess\(navItems,\s*accessibleAreaKeys,\s*canEnterDeveloperMode\)/.test(sidebar),
    "Sidebar 가 관문 값을 필터에 넘기지 않는다"
  );
});

test("🔴 개발자 모드 페이지가 스스로 막는다 — 메뉴에서 감추는 것은 관문이 아니다", () => {
  // 주소를 직접 쳐도 막혀야 한다. 다른 페이지들이 requireAreaAccess 를 부르는
  // 자리에서 이 페이지는 같은 관문 함수를 부른다 — 영역 가드는 이 질문에 답할
  // 수 없다(PERMISSION_AREAS 에 developerMode 가 없으므로 늘 NONE 이고, 그러면
  // 최고관리자까지 막힌다).
  const page = readFileSync(join(process.cwd(), "src/app/(app)/settings/developer/page.tsx"), "utf8");
  assert.ok(
    /from ["'][^"']*developer-mode-gate["']/.test(page),
    "페이지가 관문 창구를 부르지 않는다"
  );
  assert.ok(/if\s*\(!mayEnterDeveloperMode\(/.test(page), "페이지가 스스로 막지 않는다");
  assert.ok(/redirect\(/.test(page), "막힐 때 보낼 곳이 없다");
  // 🔴 없는 기능의 단추를 두지 않는다. 누르면 아무 일도 안 나는 단추는
  // 「고장난 화면」으로 읽히고, 이 화면에서는 특히 「배포한 줄 알았는데 안 됐다」가
  // 된다. 앱은 자기 다음 버전을 자기 안에서 배포할 수 없다(CLAUDE.md 의 배포 규칙).
  assert.ok(!/<button\b/.test(page), "동작하지 않는 단추가 자리 표시로 들어갔다");
  assert.ok(!/<form\b/.test(page), "저장할 곳이 없는 입력 양식이 들어갔다");
});

test("개발자 표시는 역할별 권한 설정으로 켤 수 없다 — 설정 단위에 존재하지 않는다", () => {
  // 설정 화면이 다루는 단위는 영역 키와 잎 키뿐이다. 사람 단위 칸인
  // is_developer 는 어느 쪽으로도 표현되지 않으므로, 관리자가 권한 설정에서
  // 자기 자신을 개발자로 만들 방법이 없다.
  for (const key of PERMISSION_LEAF_KEYS) {
    assert.ok(!/developer/i.test(key), `잎 키에 개발자 항목이 생겼다: ${key}`);
  }
  for (const area of PERMISSION_AREAS) {
    assert.ok(!/developer/i.test(area.key), `영역 키에 개발자 항목이 생겼다: ${area.key}`);
  }
});
