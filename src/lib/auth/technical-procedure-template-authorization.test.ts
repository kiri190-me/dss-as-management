import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import {
  canManageTechnicalTemplates,
  canCreateTechnicalTemplateDraft,
  canEditTechnicalTemplateDraft,
  canPublishTechnicalTemplates,
  canCreateTechnicalTemplateDraftVersion,
  canViewPublishedTechnicalTemplates,
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
