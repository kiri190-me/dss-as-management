import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import type { ProcedureTemplateCategory } from "@/lib/domain/procedure-template-types";
import {
  canManageTechnicalTemplates,
  canCreateTechnicalTemplateDraft,
  canEditTechnicalTemplateDraft,
  canPublishTechnicalTemplates,
  canCreateTechnicalTemplateDraftVersion,
  canViewPublishedTechnicalTemplates,
  canActorEditTemplateOfCategory,
  canActorPublishTemplateOfCategory,
  canActorCreateDraftVersionOfCategory,
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

test("canCreateTechnicalTemplateDraft / canEditTechnicalTemplateDraft / canPublishTechnicalTemplates / canCreateTechnicalTemplateDraftVersion all match the same SUPER_ADMIN+ADMIN policy", () => {
  for (const role of ROLE_CODES) {
    const expected = role === "SUPER_ADMIN" || role === "ADMIN";
    assert.equal(canCreateTechnicalTemplateDraft(role), expected, `canCreateTechnicalTemplateDraft(${role})`);
    assert.equal(canEditTechnicalTemplateDraft(role), expected, `canEditTechnicalTemplateDraft(${role})`);
    assert.equal(canPublishTechnicalTemplates(role), expected, `canPublishTechnicalTemplates(${role})`);
    assert.equal(canCreateTechnicalTemplateDraftVersion(role), expected, `canCreateTechnicalTemplateDraftVersion(${role})`);
  }
});

test("AS_ENGINEER, SALES, INVENTORY_MANAGER have zero technical-template management access", () => {
  for (const role of ["AS_ENGINEER", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canCreateTechnicalTemplateDraft(role), false);
    assert.equal(canEditTechnicalTemplateDraft(role), false);
    assert.equal(canPublishTechnicalTemplates(role), false);
    assert.equal(canCreateTechnicalTemplateDraftVersion(role), false);
  }
});

test("canViewPublishedTechnicalTemplates matches canViewPublishedProcedureTemplates exactly for every role (reused, not duplicated policy)", () => {
  for (const role of ROLE_CODES) {
    assert.equal(canViewPublishedTechnicalTemplates(role), canViewPublishedProcedureTemplates(role), `mismatch for ${role}`);
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
