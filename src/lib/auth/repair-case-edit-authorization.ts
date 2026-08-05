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
 */
const ALL_EDITABLE_FIELDS: readonly string[] = [
  ...SECTION_FIELD_NAMES.INTAKE,
  ...SECTION_FIELD_NAMES.PRODUCT,
  ...SECTION_FIELD_NAMES.FAULT_SERVICE,
];

const AS_ENGINEER_FIELDS: readonly string[] = [
  "reportedSymptom",
  "intakeInspectionResult",
  "currentDiagnosisSummary",
  "nextPlannedAction",
  "accessoryList",
  "externalConditionSummary",
  "reasonForRemoval",
  "notes",
  "assignedEngineerId",
  "internalTargetInspectionCompletionDate",
  "internalTargetShipmentDate",
  "modelName",
  "lotNumber",
  "serialNumber",
  "partNumber",
];

const SALES_FIELDS: readonly string[] = [
  "customerId",
  "endUserId",
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
 * Documented policy (PROJECT_REQUIREMENTS.md "출하 완료 후 수정(잠금 해제)
 * 정책", SECURITY_POLICY.md §2): a shipment-locked repair case can only be
 * edited via a separate request → 관리자 승인 → 임시 잠금 해제 → 사유 필수
 * 입력 후 수정 → 재검토 및 재승인 → 재잠금 procedure — which this task does
 * not implement (out of scope: no workflow-transition/approval persistence
 * here). So this general edit action blocks ALL roles, including
 * SUPER_ADMIN/ADMIN, whenever isLocked is true; it is not a per-role
 * exception like the rest of this file. This is a deliberate difference
 * from the task's suggested default matrix (which didn't mention isLocked
 * at all) — see the final report.
 */
export function isBlockedByShipmentLock(isLocked: boolean): boolean {
  return isLocked;
}
