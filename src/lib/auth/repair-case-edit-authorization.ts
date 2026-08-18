import type { Role } from "@/lib/domain/types";
import {
  SECTION_FIELD_NAMES,
  type RepairCaseEditSection,
} from "@/lib/validation/repair-case-update-input";

/**
 * Centralized, server-side, field-level authorization for repair-case
 * editing. UI components (IntakeInfoSection/ProductInfoSection/
 * FaultServiceSection) also import this to decide which Edit buttons/inputs
 * to render — but that is a UX convenience only. update-repair-case.ts's
 * Server Action re-checks every submitted field against this same table
 * independently; hiding a control here never substitutes for that check.
 *
 * Policy source: this task's approved authorization matrix. Field lists
 * mirror SECTION_FIELD_NAMES exactly (a role's set is always a subset of
 * the section's known fields) so the two modules can never silently drift.
 *
 * intakeInspectionResult/currentDiagnosisSummary/nextPlannedAction are not
 * section fields at all anymore (removed from SECTION_FIELD_NAMES by the
 * record_kind derived-summary checkpoint) — they never appear in any role's
 * editable set here, not even SUPER_ADMIN/ADMIN's, because ALL_EDITABLE_FIELDS
 * is derived from SECTION_FIELD_NAMES rather than hand-maintained.
 */
const ALL_EDITABLE_FIELDS: readonly string[] = [
  ...SECTION_FIELD_NAMES.INTAKE,
  ...SECTION_FIELD_NAMES.PRODUCT,
  ...SECTION_FIELD_NAMES.FAULT_SERVICE,
];

// "priority" (SECTION_FIELD_NAMES.INTAKE) is deliberately absent from both
// AS_ENGINEER_FIELDS and SALES_FIELDS below — it's only in ALL_EDITABLE_FIELDS,
// so today only SUPER_ADMIN/ADMIN can edit it (자동 상속, 아래 두 목록에 손댈
// 필요 없음). No requirement specified which non-admin roles should also get
// it; broaden deliberately later if needed, not as a side effect of some
// other change.
const AS_ENGINEER_FIELDS: readonly string[] = [
  "reportedSymptom",
  "accessoryList",
  "externalConditionSummary",
  "reasonForRemoval",
  "notes",
  "assignedEngineerId",
  "internalTargetInspectionCompletionDate",
  "internalTargetShipmentDate",
  "productModelId",
  "lotNumber",
  "serialNumber",
  "customerId",
  "newCustomerName",
  "endUserId",
  "newEndUserName",
  "workflowKind",
  "billingType",
];

const SALES_FIELDS: readonly string[] = [
  "customerId",
  "newCustomerName",
  "endUserId",
  "newEndUserName",
  "receivedAt",
  "customerRequestedDueDate",
  "contactName",
  "contactPhone",
  "contactEmail",
  "notes",
];

const EDITABLE_FIELDS_BY_ROLE: Record<Role, ReadonlySet<string>> = {
  SUPER_ADMIN: new Set(ALL_EDITABLE_FIELDS),
  ADMIN: new Set(ALL_EDITABLE_FIELDS),
  AS_ENGINEER: new Set(AS_ENGINEER_FIELDS),
  SALES: new Set(SALES_FIELDS),
  // Read-only for this task — no field is ever editable.
  INVENTORY_MANAGER: new Set(),
};

export function isFieldEditable(role: Role, field: string): boolean {
  return EDITABLE_FIELDS_BY_ROLE[role].has(field);
}

export function editableFieldsForRoleInSection(
  role: Role,
  section: RepairCaseEditSection
): string[] {
  return SECTION_FIELD_NAMES[section].filter((field) => isFieldEditable(role, field));
}

/** Drives whether a section's Edit button should render at all. */
export function canEditSection(role: Role, section: RepairCaseEditSection): boolean {
  return editableFieldsForRoleInSection(role, section).length > 0;
}

export type FieldAuthorizationResult =
  | { ok: true }
  | { ok: false; unauthorizedFields: string[] };

/**
 * Checks a submitted fields object's own keys against both (a) membership
 * in the given section (an unknown key is a malformed request, handled by
 * the caller as VALIDATION_ERROR, not this function's concern) and (b) role
 * permission for each key that IS a real section field. Called with the
 * raw, not-yet-format-validated submission — this must run first, so an
 * unauthorized field is rejected before any DB or format-validation work,
 * and so the whole request is rejected rather than the field silently
 * dropped.
 */
export function authorizeSubmittedFields(
  role: Role,
  section: RepairCaseEditSection,
  submittedFieldNames: readonly string[]
): FieldAuthorizationResult {
  const sectionFields = new Set<string>(SECTION_FIELD_NAMES[section]);
  const unauthorizedFields = submittedFieldNames.filter(
    (field) => sectionFields.has(field) && !isFieldEditable(role, field)
  );
  return unauthorizedFields.length === 0 ? { ok: true } : { ok: false, unauthorizedFields };
}

/**
 * Product policy change (shipment-lock removal checkpoint): shipment
 * completion must NOT automatically make a repair case read-only. This
 * reverses the previously documented policy (PROJECT_REQUIREMENTS.md "출하
 * 완료 후 수정(잠금 해제) 정책", SECURITY_POLICY.md §2 — both now stale,
 * flagged for the user to update separately) that required a
 * request → 관리자 승인 → 임시 잠금 해제 → 사유 필수 입력 후 수정 → 재검토
 * 및 재승인 → 재잠금 procedure, which was never actually implemented (no
 * unlock_requests persistence ever existed) — every repair case was
 * simply permanently read-only after shipment instead.
 *
 * `isLocked` is intentionally still accepted here (not removed from the
 * signature) so every call site's shape stays unchanged and this remains
 * the single place to reintroduce edit-locking later if ever needed —
 * always returns false now, unconditionally.
 */
export function isBlockedByShipmentLock(isLocked: boolean): boolean {
  void isLocked;
  return false;
}

/**
 * Bulk soft-delete for /repair-cases (전체 A/S 현황) — SUPER_ADMIN/ADMIN only.
 * Independent of the field-level edit matrix above (deleting a case is not a
 * field edit) — a pure role predicate, same shape/precedent as
 * canEditProductModels/canEditCustomers, re-checked independently by
 * bulk-delete-repair-cases.ts's Server Action regardless of what the UI
 * happened to render.
 */
export function canBulkDeleteRepairCases(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * Trash view + restore for /repair-cases (Repair Case Trash + Restore
 * checkpoint) — same SUPER_ADMIN/ADMIN-only role set as
 * canBulkDeleteRepairCases (soft-delete and restore/view-trash are two
 * halves of one admin-only lifecycle for this entity — unlike repair case
 * flowcharts, where AS_ENGINEER also gets mutate/restore rights, there is no
 * corresponding split here). Kept as its own named predicate rather than
 * calling canBulkDeleteRepairCases directly at trash/restore call sites,
 * purely so each call site reads correctly for what it's actually gating.
 * Gates both "is the 휴지통 tab visible at all" and "may this restore
 * request proceed" — re-checked independently by restore-repair-cases.ts's
 * Server Action regardless of what the UI happened to render.
 */
export function canRestoreRepairCases(role: Role): boolean {
  return canBulkDeleteRepairCases(role);
}

/**
 * Permanent delete (hard delete of an already-soft-deleted repair case, 휴지통
 * 완전 삭제) — SUPER_ADMIN/ADMIN only, same role set as
 * canBulkDeleteRepairCases/canRestoreRepairCases. Kept as its own named
 * predicate rather than calling one of those directly — same call-site-
 * clarity precedent as canRestoreRepairCases, and mirrors
 * canPermanentlyDeleteRepairCaseFlowchart's own separate-narrower-predicate
 * shape (repair-case-flowchart-authorization.ts) even though the role set
 * happens to be identical here. Re-checked independently by
 * permanently-delete-repair-cases.ts's Server Action regardless of what the
 * UI happened to render.
 */
export function canPermanentlyDeleteRepairCases(role: Role): boolean {
  return canBulkDeleteRepairCases(role);
}
