import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import type { ProcedureTemplateCategory } from "@/lib/domain/procedure-template-types";
import {
  canManageTechnicalTemplates,
  canAuthorTechnicalTemplatesByDefault,
  canCreateTechnicalTemplateDraft,
  canEditTechnicalTemplateDraft,
  canPublishTechnicalTemplates,
  canCreateTechnicalTemplateDraftVersion,
  canViewPublishedTechnicalTemplates,
  canViewAllTechnicalTemplateStatuses,
  canActorEditTemplateOfCategory,
  canActorPublishTemplateOfCategory,
  canActorCreateDraftVersionOfCategory,
  canActorManageTechnicalTemplateGraph,
} from "./technical-procedure-template-authorization";
import {
  canEditProcedureTemplateDraft,
  canCreateProcedureTemplateDraft,
  canPublishProcedureTemplates,
  canArchiveProcedureTemplates,
  canViewPublishedProcedureTemplates,
} from "./procedure-template-authorization";

const MANAGE_ELIGIBLE: readonly Role[] = ["SUPER_ADMIN", "ADMIN"];
const MANAGE_INELIGIBLE: readonly Role[] = ROLE_CODES.filter((r) => !MANAGE_ELIGIBLE.includes(r));

test("canManageTechnicalTemplates: SUPER_ADMIN and ADMIN only", () => {
  for (const role of MANAGE_ELIGIBLE) assert.equal(canManageTechnicalTemplates(role), true, `${role} must be able to manage technical templates`);
  for (const role of MANAGE_INELIGIBLE) assert.equal(canManageTechnicalTemplates(role), false, `${role} must NOT be able to manage technical templates`);
});

test("canEditTechnicalTemplateDraft / canPublishTechnicalTemplates / canCreateTechnicalTemplateDraftVersion all match the same SUPER_ADMIN+ADMIN policy", () => {
  // 🔴 2026-11-27 — canCreateTechnicalTemplateDraft 가 **이 묶음에서 빠졌다.**
  //    사용자 결정으로 만들기에만 A/S 엔지니어가 들어왔기 때문이다(아래 전용 시험).
  //    단언을 느슨하게 만든 것이 아니라, 나머지 셋이 **안 움직였다**를 그대로 지킨다.
  for (const role of ROLE_CODES) {
    const expected = role === "SUPER_ADMIN" || role === "ADMIN";
    assert.equal(canEditTechnicalTemplateDraft(role), expected, `canEditTechnicalTemplateDraft(${role})`);
    assert.equal(canPublishTechnicalTemplates(role), expected, `canPublishTechnicalTemplates(${role})`);
    assert.equal(canCreateTechnicalTemplateDraftVersion(role), expected, `canCreateTechnicalTemplateDraftVersion(${role})`);
  }
});

test("🔴 canCreateTechnicalTemplateDraft: SUPER_ADMIN + ADMIN + AS_ENGINEER (2026-11-27 사용자 결정)", () => {
  // 사용자 원문: 「[절차 만들기]는 [최고 관리자/관리자/a/s엔지니어]는 [읽기+쓰기]를
  // 기본 권한으로 설정해줘.」 — 셋을 적고, 나머지 둘이 **아닌 것**도 함께 적는다.
  const ALLOWED: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"];
  for (const role of ROLE_CODES) {
    assert.equal(
      canCreateTechnicalTemplateDraft(role),
      ALLOWED.includes(role),
      `canCreateTechnicalTemplateDraft(${role})`
    );
  }
  // 🔵 표본 — 이 함수가 정말 이웃보다 **한 역할 넓다**(같으면 위 묶음과 구별이 안 된다).
  assert.equal(canCreateTechnicalTemplateDraft("AS_ENGINEER"), true);
  assert.equal(canManageTechnicalTemplates("AS_ENGINEER"), false);
});

test("SALES, INVENTORY_MANAGER have zero technical-template management access", () => {
  // 🔴 AS_ENGINEER 가 이 목록에서 빠졌다(2026-11-27) — 「절차 만들기」가 그 역할에
  //    열렸으므로 「zero ... access」가 더 이상 참이 아니다. 영업·자재는 그대로다.
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canAuthorTechnicalTemplatesByDefault(role), false);
    assert.equal(canCreateTechnicalTemplateDraft(role), false);
    assert.equal(canEditTechnicalTemplateDraft(role), false);
    assert.equal(canPublishTechnicalTemplates(role), false);
    assert.equal(canCreateTechnicalTemplateDraftVersion(role), false);
  }
});

test("🔴 canAuthorTechnicalTemplatesByDefault: 만들기·초안 편집의 **기본값** 집합 — 최고관리자 · 관리자 · A/S 엔지니어", () => {
  // 사용자 결정 둘(2026-11-27): 「[절차 만들기]는 [최고 관리자/관리자/a/s엔지니어]는
  // [읽기+쓰기]를 기본 권한으로」 + 「ㄱ으로 진행해」(= 초안 편집도 같은 셋에게).
  const ALLOWED: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"];
  for (const role of ROLE_CODES) {
    assert.equal(canAuthorTechnicalTemplatesByDefault(role), ALLOWED.includes(role), role);
  }
  // 🔵 표본 — 이웃보다 **한 역할 넓다**(같으면 canManageTechnicalTemplates 와 구별이 안 된다).
  assert.equal(canManageTechnicalTemplates("AS_ENGINEER"), false);
});

test("🔴 역할 고정 함수들은 **안 움직였다** — 넓어진 것은 기본값 쪽이다", () => {
  // 🔴 이 파일은 **역할 함수**를 재는 자리다. 2026-11-27 에 A/S 엔지니어에게 실제로
  //    열린 것은 설정 잎 둘(`technicalProcedures.create` · `.editDraft`)의 **기본값**이고,
  //    그 값은 위 canAuthorTechnicalTemplatesByDefault 가 들고 있다.
  //    🔴 `canEditTechnicalTemplateDraft` 는 **일부러 안 넓혔다** — 호출부가 셋이라
  //    넓히면 메뉴 상한과 canActorEditTemplateOfCategory 까지 허락 없이 따라 움직인다
  //    (그 함수의 주석). 그래서 여기서는 **닫혀 있는 것이 정답**이다.
  // 🔵 역할 × 조작으로 「실제로 누가 무엇을 할 수 있는가」를 재는 쪽은
  //    technical-procedure-settings-gate.test.ts 다.
  assert.equal(canEditTechnicalTemplateDraft("AS_ENGINEER"), false);
  assert.equal(canPublishTechnicalTemplates("AS_ENGINEER"), false);
  assert.equal(canCreateTechnicalTemplateDraftVersion("AS_ENGINEER"), false);
  assert.equal(canManageTechnicalTemplates("AS_ENGINEER"), false);
  assert.equal(canViewAllTechnicalTemplateStatuses("AS_ENGINEER"), false);
  // 🔴 분류별 관문도 안 움직였다 — 움직이면 전체 서비스 절차 쪽이 함께 흔들린다.
  assert.equal(canActorEditTemplateOfCategory("AS_ENGINEER", "TECHNICAL_TASK"), false);
  assert.equal(canActorManageTechnicalTemplateGraph("AS_ENGINEER", "TECHNICAL_TASK"), false);
});

test("canViewPublishedTechnicalTemplates matches canViewPublishedProcedureTemplates exactly for every role (reused, not duplicated policy)", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canViewPublishedTechnicalTemplates(role), canViewPublishedProcedureTemplates(role), `mismatch for ${role}`);
  }
});

test("canViewAllTechnicalTemplateStatuses matches canManageTechnicalTemplates exactly for every role", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canViewAllTechnicalTemplateStatuses(role), canManageTechnicalTemplates(role), `mismatch for ${role}`);
  }
});

// ---- critical regression guard: the lifecycle/full-service module must be completely unaffected ----

test("existing procedure-template-authorization.ts functions remain SUPER_ADMIN-only, unchanged by this module's existence", () => {
  for (const role of ROLE_CODES) {
    const expectedSuperAdminOnly = role === "SUPER_ADMIN";
    assert.equal(canEditProcedureTemplateDraft(role), expectedSuperAdminOnly, `canEditProcedureTemplateDraft(${role}) must stay SUPER_ADMIN-only`);
    assert.equal(canCreateProcedureTemplateDraft(role), expectedSuperAdminOnly, `canCreateProcedureTemplateDraft(${role}) must stay SUPER_ADMIN-only`);
    assert.equal(canPublishProcedureTemplates(role), expectedSuperAdminOnly, `canPublishProcedureTemplates(${role}) must stay SUPER_ADMIN-only`);
    assert.equal(canArchiveProcedureTemplates(role), expectedSuperAdminOnly, `canArchiveProcedureTemplates(${role}) must stay SUPER_ADMIN-only`);
  }
});

test("ADMIN does NOT gain FULL_SERVICE/lifecycle template edit access merely because it gained technical-template access", () => {
  assert.equal(canEditProcedureTemplateDraft("ADMIN"), false, "ADMIN must still be rejected by the lifecycle edit function");
  assert.equal(canPublishProcedureTemplates("ADMIN"), false, "ADMIN must still be rejected by the lifecycle publish function");
  // The only true statement about ADMIN's new capability is in the separate technical module:
  assert.equal(canEditTechnicalTemplateDraft("ADMIN"), true);
  assert.equal(canPublishTechnicalTemplates("ADMIN"), true);
});

// ---- Phase 5C-5B: category-dispatching authorization ----
//
// Pure-function proof of the role x category matrix — deliberately no DB
// row of any category is created to prove this; the dispatch functions are
// plain functions of (role, category), so a real TECHNICAL_TASK template
// row is not needed to prove ADMIN is admitted for that category (see the
// integration suites for the full mutation-flow proof, which reuses only
// already-existing FULL_SERVICE fixtures plus nonexistent ids).

const CATEGORIES: readonly ProcedureTemplateCategory[] = ["FULL_SERVICE", "TECHNICAL_TASK", "REFERENCE"];

test("canActorEditTemplateOfCategory: TECHNICAL_TASK uses the technical policy, FULL_SERVICE/REFERENCE fall through to the unchanged lifecycle policy", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canActorEditTemplateOfCategory(role, "TECHNICAL_TASK"), canEditTechnicalTemplateDraft(role), `TECHNICAL_TASK, role=${role}`);
    assert.equal(canActorEditTemplateOfCategory(role, "FULL_SERVICE"), canEditProcedureTemplateDraft(role), `FULL_SERVICE, role=${role}`);
    assert.equal(canActorEditTemplateOfCategory(role, "REFERENCE"), canEditProcedureTemplateDraft(role), `REFERENCE, role=${role}`);
  }
});

test("canActorPublishTemplateOfCategory: TECHNICAL_TASK uses the technical policy, FULL_SERVICE/REFERENCE fall through to the unchanged lifecycle policy", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canActorPublishTemplateOfCategory(role, "TECHNICAL_TASK"), canPublishTechnicalTemplates(role), `TECHNICAL_TASK, role=${role}`);
    assert.equal(canActorPublishTemplateOfCategory(role, "FULL_SERVICE"), canPublishProcedureTemplates(role), `FULL_SERVICE, role=${role}`);
    assert.equal(canActorPublishTemplateOfCategory(role, "REFERENCE"), canPublishProcedureTemplates(role), `REFERENCE, role=${role}`);
  }
});

test("canActorCreateDraftVersionOfCategory: TECHNICAL_TASK uses the technical policy, FULL_SERVICE/REFERENCE fall through to the unchanged lifecycle policy", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canActorCreateDraftVersionOfCategory(role, "TECHNICAL_TASK"), canCreateTechnicalTemplateDraftVersion(role), `TECHNICAL_TASK, role=${role}`);
    assert.equal(canActorCreateDraftVersionOfCategory(role, "FULL_SERVICE"), canCreateProcedureTemplateDraft(role), `FULL_SERVICE, role=${role}`);
    assert.equal(canActorCreateDraftVersionOfCategory(role, "REFERENCE"), canCreateProcedureTemplateDraft(role), `REFERENCE, role=${role}`);
  }
});

test("ADMIN + TECHNICAL_TASK is allowed at the authorization boundary for all three category-dispatching actions; ADMIN + FULL_SERVICE is forbidden for all three", () => {
  assert.equal(canActorEditTemplateOfCategory("ADMIN", "TECHNICAL_TASK"), true);
  assert.equal(canActorPublishTemplateOfCategory("ADMIN", "TECHNICAL_TASK"), true);
  assert.equal(canActorCreateDraftVersionOfCategory("ADMIN", "TECHNICAL_TASK"), true);
  assert.equal(canActorEditTemplateOfCategory("ADMIN", "FULL_SERVICE"), false);
  assert.equal(canActorPublishTemplateOfCategory("ADMIN", "FULL_SERVICE"), false);
  assert.equal(canActorCreateDraftVersionOfCategory("ADMIN", "FULL_SERVICE"), false);
});

test("SUPER_ADMIN is allowed for every category on all three category-dispatching actions (existing broad management behavior preserved)", () => {
  for (const category of CATEGORIES) {
    assert.equal(canActorEditTemplateOfCategory("SUPER_ADMIN", category), true, `edit, category=${category}`);
    assert.equal(canActorPublishTemplateOfCategory("SUPER_ADMIN", category), true, `publish, category=${category}`);
    assert.equal(canActorCreateDraftVersionOfCategory("SUPER_ADMIN", category), true, `createDraftVersion, category=${category}`);
  }
});

test("AS_ENGINEER, SALES, INVENTORY_MANAGER are forbidden for every category on all three category-dispatching actions", () => {
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    for (const category of CATEGORIES) {
      assert.equal(canActorEditTemplateOfCategory(role, category), false, `edit, role=${role}, category=${category}`);
      assert.equal(canActorPublishTemplateOfCategory(role, category), false, `publish, role=${role}, category=${category}`);
      assert.equal(canActorCreateDraftVersionOfCategory(role, category), false, `createDraftVersion, role=${role}, category=${category}`);
    }
  }
});

// ---- Phase 5C-5B-1: node/edge structural CRUD authorization (TECHNICAL_TASK-only, no SUPER_ADMIN carve-out) ----

test("canActorManageTechnicalTemplateGraph: TECHNICAL_TASK admits ADMIN+SUPER_ADMIN only, matching canManageTechnicalTemplates exactly", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canActorManageTechnicalTemplateGraph(role, "TECHNICAL_TASK"), canManageTechnicalTemplates(role), `TECHNICAL_TASK, role=${role}`);
  }
});

test("canActorManageTechnicalTemplateGraph: FULL_SERVICE and REFERENCE are hard-denied for every role, including SUPER_ADMIN — no carve-out", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canActorManageTechnicalTemplateGraph(role, "FULL_SERVICE"), false, `FULL_SERVICE must hard-deny role=${role}`);
    assert.equal(canActorManageTechnicalTemplateGraph(role, "REFERENCE"), false, `REFERENCE must hard-deny role=${role}`);
  }
});

test("canActorManageTechnicalTemplateGraph differs from canActorEditTemplateOfCategory specifically on SUPER_ADMIN + FULL_SERVICE (the whole point of the new function)", () => {
  assert.equal(canActorEditTemplateOfCategory("SUPER_ADMIN", "FULL_SERVICE"), true, "the existing property-edit policy still allows SUPER_ADMIN on FULL_SERVICE");
  assert.equal(canActorManageTechnicalTemplateGraph("SUPER_ADMIN", "FULL_SERVICE"), false, "the NEW structural-CRUD policy must never allow this, even for SUPER_ADMIN");
});
