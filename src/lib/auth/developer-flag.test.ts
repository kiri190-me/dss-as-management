import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";
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
import { checkRoleEligibility } from "@/lib/domain/local/workflow/permissions";
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

/** 전이 정의 한 줄. 허용 역할만 바꿔 가며 자격 판정을 본다. */
function transitionAllowing(allowedRoles: readonly Role[]): TransitionDefinition {
  return {
    id: "t-test",
    workflowType: "PAID_GENERATOR",
    actionCode: "STEP_ADVANCED",
    fromStepKey: "intake_inspection",
    toStepKey: "parts_supply",
    toStatus: "WAITING_PARTS_SUPPLY",
    direction: "FORWARD",
    allowedRoles,
    requiresAssignedEngineer: false,
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
