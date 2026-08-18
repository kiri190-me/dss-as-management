import "./load-env";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/connection";
import {
  users,
  customers,
  endUsers,
  endUserContacts,
  products,
  workflowTemplates,
  workflowVersions,
  workflowSteps,
  exceptionStatuses,
  repairCases,
} from "../src/lib/db/schema";
import {
  mockUsers,
  mockCustomers,
  mockEndUsers,
  mockProducts,
  workflowSteps as mockWorkflowSteps,
  mockRepairCases,
} from "../src/lib/domain/mock-data";
import {
  WORKFLOW_TYPE_CODES,
  workflowTypeLabels,
  EXCEPTION_STATUS_CODES,
  exceptionStatusLabels,
} from "../src/lib/domain/types";
import { FINAL_SHIPMENT_REPRESENTATIVE_USER_ID } from "../src/lib/domain/local/approval/representative";
import { getStepStatus } from "../src/lib/domain/local/workflow/step-status-map";
import { getStepCategory } from "../src/lib/domain/local/workflow/step-category";
import { seedRealisticDemoDataset } from "./seed-realistic-demo";

/**
 * Seeds the dev database from the existing fictional domain modules only —
 * src/lib/domain/mock-data.ts (users/customers/end-users/products/workflow
 * steps/repair cases) and src/lib/domain/types.ts (the fixed workflow-type
 * and exception-status master lists, which are canonical reference data
 * already defined there, not fictional business records). Never reads
 * localStorage, never modifies mock-data.ts, never inserts real
 * customer/employee data.
 *
 * Re-run safety: every row uses a deterministic UUID derived from its mock
 * id (sha256-based, not cryptographically meaningful — just stable), and
 * every insert is `ON CONFLICT (id) DO UPDATE`, so running this script
 * again converges existing rows to the current mock data instead of
 * duplicating or failing.
 */

const SEED_FIXED_TIMESTAMP = new Date("2026-01-01T00:00:00.000Z");

function deterministicUuid(key: string): string {
  const hex = createHash("sha256")
    .update(`dss-as-seed-dev:${key}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4"; // version nibble
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variant nibble
  const joined = hex.join("");
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20, 32),
  ].join("-");
}

const userId = (mockId: string) => deterministicUuid(`user:${mockId}`);
const customerIdFor = (mockId: string) => deterministicUuid(`customer:${mockId}`);
const endUserIdFor = (mockId: string) => deterministicUuid(`end-user:${mockId}`);
const endUserContactIdFor = (mockId: string) => deterministicUuid(`end-user-contact:${mockId}`);
const productIdFor = (mockId: string) => deterministicUuid(`product:${mockId}`);
const FOUNDATION_WORKFLOW_CODES = new Set([
  "PAID_MATCHER",
  "WARRANTY_MATCHER",
  "PAID_TOTAL_CONTROLLER",
  "WARRANTY_TOTAL_CONTROLLER",
  // Migration 0036 (pending_billing_workflow_foundation) inserted these three
  // codes' templates/versions/steps directly via the same
  // md5('dss-as-workflow-<kind>:...')::uuid formula as migrationUuid() below.
  // They must stay in this set so templateIdFor/versionIdFor/stepIdFor keep
  // computing the same ids as that migration, instead of colliding with it
  // on workflow_templates_code_unique via the sha256 deterministicUuid path.
  "PENDING_MATCHER",
  "PENDING_GENERATOR",
  "PENDING_TOTAL_CONTROLLER",
]);
const migrationUuid = (key: string) => {
  const hex = createHash("md5").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const templateIdFor = (code: string) => FOUNDATION_WORKFLOW_CODES.has(code)
  ? migrationUuid(`dss-as-workflow-template:${code}`)
  : deterministicUuid(`workflow-template:${code}`);
const versionIdFor = (code: string) => FOUNDATION_WORKFLOW_CODES.has(code)
  ? migrationUuid(`dss-as-workflow-version:${code}:1`)
  : deterministicUuid(`workflow-version:${code}`);
const stepIdFor = (code: string, key: string) =>
  FOUNDATION_WORKFLOW_CODES.has(code)
    ? migrationUuid(`dss-as-workflow-step:${code}:${key}`)
    : deterministicUuid(`workflow-step:${code}:${key}`);
const exceptionStatusIdFor = (code: string) =>
  deterministicUuid(`exception-status:${code}`);

export async function seedDevelopmentFixtures() {
  const databaseIdentity = await db.execute(sql`select current_database() as name`);
  if (process.env.DSS_SEED_TEST_WRAPPER !== "1" && databaseIdentity[0]?.name !== "dss_as_dev") {
    throw new Error(`Refusing to seed: expected dss_as_dev, connected to ${String(databaseIdentity[0]?.name ?? "unknown")}`);
  }
  const counts: Record<string, number> = {};

  await db.transaction(async (tx) => {
    // 1. users — no FK dependencies.
    const userRows = mockUsers.map((u) => ({
      id: userId(u.id),
      email: u.email,
      passwordHash: null,
      name: u.name,
      role: u.role,
      approvalStatus: u.approvalStatus,
      isDeveloper: false,
      // Mirrors the local-demo layer's single hardcoded FINAL_SHIPMENT
      // representative (representative.ts) so dev-seed behavior agrees
      // between mock and database modes.
      isShipmentRepresentative: u.id === FINAL_SHIPMENT_REPRESENTATIVE_USER_ID,
      failedLoginCount: 0,
      lockedAt: null,
      isActive: true,
      version: 1,
      createdAt: new Date(u.createdAt),
      updatedAt: new Date(u.createdAt),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    }));
    await tx
      .insert(users)
      .values(userRows)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: sql`excluded.email`,
          name: sql`excluded.name`,
          role: sql`excluded.role`,
          approvalStatus: sql`excluded.approval_status`,
          isShipmentRepresentative: sql`excluded.is_shipment_representative`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.users = userRows.length;

    // 2. exception_statuses — fixed 9-code master list (types.ts).
    const exceptionStatusRows = EXCEPTION_STATUS_CODES.map((code) => ({
      id: exceptionStatusIdFor(code),
      code,
      label: exceptionStatusLabels[code],
      isActive: true,
      createdAt: SEED_FIXED_TIMESTAMP,
      updatedAt: SEED_FIXED_TIMESTAMP,
    }));
    await tx
      .insert(exceptionStatuses)
      .values(exceptionStatusRows)
      .onConflictDoUpdate({
        target: exceptionStatuses.id,
        set: { label: sql`excluded.label`, updatedAt: sql`excluded.updated_at` },
      });
    counts.exceptionStatuses = exceptionStatusRows.length;

    // 3. workflow_templates — fixed 3-type master list (types.ts).
    const templateRows = WORKFLOW_TYPE_CODES.map((code) => ({
      id: templateIdFor(code),
      code,
      name: workflowTypeLabels[code],
      createdAt: SEED_FIXED_TIMESTAMP,
    }));
    await tx
      .insert(workflowTemplates)
      .values(templateRows)
      .onConflictDoUpdate({
        target: workflowTemplates.id,
        set: { name: sql`excluded.name` },
      });
    counts.workflowTemplates = templateRows.length;

    // 4. workflow_versions — one PUBLISHED/is_current version per template.
    const superAdminMockUser = mockUsers.find((u) => u.role === "SUPER_ADMIN");
    if (!superAdminMockUser) {
      throw new Error("Seed source mock-data.ts has no SUPER_ADMIN user to attribute workflow_versions.created_by to.");
    }
    const superAdminId = userId(superAdminMockUser.id);
    const versionRows = WORKFLOW_TYPE_CODES.map((code) => ({
      id: versionIdFor(code),
      workflowTemplateId: templateIdFor(code),
      versionNumber: 1,
      status: "PUBLISHED" as const,
      isCurrent: true,
      publishedAt: SEED_FIXED_TIMESTAMP,
      createdBy: superAdminId,
      createdAt: SEED_FIXED_TIMESTAMP,
    }));
    await tx
      .insert(workflowVersions)
      .values(versionRows)
      .onConflictDoUpdate({
        target: workflowVersions.id,
        set: { status: sql`excluded.status`, isCurrent: sql`excluded.is_current` },
      });
    counts.workflowVersions = versionRows.length;

    // 5. workflow_steps
    //
    // repair_status/category는 Phase 1(워크플로 규칙 DB 이관)에서 추가된
    // 컬럼이다. 시드가 채우지 않으면 새로 만든 DB의 단계는 값이 빈 채로
    // 남고, 그 단계에 놓인 접수 건은 목록·대시보드를 읽을 때마다
    // UnmappedWorkflowStepError로 화면을 깨뜨린다. 값의 출처는 런타임이
    // 쓰는 것과 같은 표다 — 시드만의 별도 매핑을 만들지 않는다.
    const stepRows = mockWorkflowSteps.map((s) => ({
      id: stepIdFor(s.workflowType, s.key),
      workflowVersionId: versionIdFor(s.workflowType),
      stepOrder: s.order,
      key: s.key,
      label: s.label,
      repairStatus: getStepStatus(s.workflowType, s.key) ?? null,
      category: getStepCategory(s.workflowType, s.key) ?? null,
      // product_intake는 전이 그래프에서 의도적으로 제외된 단계다
      // (transition-definitions.ts 헤더 주석) — 들어오는 규칙도 나가는 규칙도
      // 없어서, 접수 건이 이 단계에 놓이면 진행도 되돌리기도 못 하고 갇힌다.
      // 실제로 DEMO 시드가 59건을 그렇게 만들었고 2026-08-18에 정리했다
      // (scripts/fix-stranded-intake-steps.ts). 비활성으로 만들어 두면
      // seed-realistic-demo.ts가 is_active 필터로 자동으로 피해 간다.
      isActive: s.key !== "product_intake",
      createdAt: SEED_FIXED_TIMESTAMP,
      updatedAt: SEED_FIXED_TIMESTAMP,
    }));
    await tx
      .insert(workflowSteps)
      .values(stepRows)
      .onConflictDoUpdate({
        target: workflowSteps.id,
        set: {
          label: sql`excluded.label`,
          repairStatus: sql`excluded.repair_status`,
          category: sql`excluded.category`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.workflowSteps = stepRows.length;

    // 6. customers
    const customerRows = mockCustomers.map((c) => ({
      id: customerIdFor(c.id),
      name: c.name,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      createdAt: SEED_FIXED_TIMESTAMP,
      updatedAt: SEED_FIXED_TIMESTAMP,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    }));
    await tx
      .insert(customers)
      .values(customerRows)
      .onConflictDoUpdate({
        target: customers.id,
        set: {
          name: sql`excluded.name`,
          contactName: sql`excluded.contact_name`,
          contactEmail: sql`excluded.contact_email`,
          contactPhone: sql`excluded.contact_phone`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.customers = customerRows.length;

    // 7. end_users — depends on customers. contactName/contactEmail are no
    // longer end_users columns (End-User 다중 담당자 체크포인트, migration
    // 0029) — mock-data.ts's EndUser entries still carry those two fields
    // (unchanged, still used by local/mock mode elsewhere), but the seed
    // script now routes them into end_user_contacts below instead.
    const endUserRows = mockEndUsers.map((eu) => ({
      id: endUserIdFor(eu.id),
      customerId: customerIdFor(eu.customerId),
      name: eu.name,
      createdAt: SEED_FIXED_TIMESTAMP,
      updatedAt: SEED_FIXED_TIMESTAMP,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    }));
    await tx
      .insert(endUsers)
      .values(endUserRows)
      .onConflictDoUpdate({
        target: endUsers.id,
        set: {
          name: sql`excluded.name`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.endUsers = endUserRows.length;

    // 7b. end_user_contacts — depends on end_users. One contact row per
    // mockEndUsers entry that has a contactName/contactEmail (today, every
    // entry does — this filter is defensive for future mock entries that
    // might omit both, matching end_user_contacts.contact_name's own NOT
    // NULL constraint: a contact row is never created without a name).
    const endUserContactRows = mockEndUsers
      .filter((eu) => eu.contactName || eu.contactEmail)
      .map((eu) => ({
        id: endUserContactIdFor(eu.id),
        endUserId: endUserIdFor(eu.id),
        contactName: eu.contactName,
        contactEmail: eu.contactEmail,
        createdAt: SEED_FIXED_TIMESTAMP,
        updatedAt: SEED_FIXED_TIMESTAMP,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      }));
    await tx
      .insert(endUserContacts)
      .values(endUserContactRows)
      .onConflictDoUpdate({
        target: endUserContacts.id,
        set: {
          contactName: sql`excluded.contact_name`,
          contactEmail: sql`excluded.contact_email`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.endUserContacts = endUserContactRows.length;

    // 8. products
    const productRows = mockProducts.map((p) => ({
      id: productIdFor(p.id),
      modelName: p.modelName,
      serialNumber: p.serialNumber,
      lotNumber: p.lotNumber,
      partNumber: null,
      createdAt: SEED_FIXED_TIMESTAMP,
      updatedAt: SEED_FIXED_TIMESTAMP,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    }));
    await tx
      .insert(products)
      .values(productRows)
      .onConflictDoUpdate({
        target: products.id,
        set: {
          modelName: sql`excluded.model_name`,
          serialNumber: sql`excluded.serial_number`,
          lotNumber: sql`excluded.lot_number`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.products = productRows.length;

    // 9. repair_cases — depends on everything above.
    // reportedSymptom/intakeInspectionResult/currentDiagnosisSummary/
    // nextPlannedAction are mapped from mock-data.ts as-is (already
    // `string | null` there). notes/accessoryList/externalConditionSummary/
    // reasonForRemoval/contact*Snapshot have NO corresponding property on
    // mock-data.ts's RepairCase objects at all (confirmed — those fields
    // only exist in the browser-only local-demo layer, not mock-data.ts),
    // so every mock-sourced row seeds them as null. This is deliberately
    // NOT backfilled from mockCustomers/mockEndUsers contact fields — doing
    // so would invent an intake-time snapshot the source data never
    // actually recorded. Fields still NOT carried over (priority, flat
    // status) — see repair-cases.ts schema comment.
    const repairCaseRows = mockRepairCases.map((rc) => ({
      id: deterministicUuid(`repair-case:${rc.id}`),
      intakeNumber: rc.intakeNumber,
      customerId: customerIdFor(rc.customerId),
      endUserId: rc.endUserId ? endUserIdFor(rc.endUserId) : null,
      productId: productIdFor(rc.productId),
      workflowVersionId: versionIdFor(rc.workflowType),
      currentWorkflowStepId: stepIdFor(rc.workflowType, rc.currentWorkflowStepKey),
      exceptionStatusId: rc.exceptionStatus
        ? exceptionStatusIdFor(rc.exceptionStatus)
        : null,
      assignedEngineerId: rc.assignedEngineerId ? userId(rc.assignedEngineerId) : null,
      receivedAt: rc.receivedAt,
      customerRequestedDueDate: rc.customerRequestedDueDate,
      internalTargetShipmentDate: rc.internalTargetShipmentDate,
      actualShipmentDate: rc.actualShipmentDate,
      isLocked: rc.isLocked,
      reportedSymptom: rc.reportedSymptom,
      intakeInspectionResult: rc.intakeInspectionResult,
      currentDiagnosisSummary: rc.currentDiagnosisSummary,
      nextPlannedAction: rc.nextPlannedAction,
      // No corresponding field on mock-data.ts's RepairCase — null, not
      // invented content.
      notes: null,
      accessoryList: null,
      externalConditionSummary: null,
      reasonForRemoval: null,
      contactNameSnapshot: null,
      contactPhoneSnapshot: null,
      contactEmailSnapshot: null,
      version: 1,
      createdAt: new Date(rc.createdAt),
      updatedAt: new Date(rc.createdAt),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    }));
    await tx
      .insert(repairCases)
      .values(repairCaseRows)
      .onConflictDoUpdate({
        target: repairCases.id,
        set: {
          currentWorkflowStepId: sql`excluded.current_workflow_step_id`,
          exceptionStatusId: sql`excluded.exception_status_id`,
          assignedEngineerId: sql`excluded.assigned_engineer_id`,
          isLocked: sql`excluded.is_locked`,
          actualShipmentDate: sql`excluded.actual_shipment_date`,
          reportedSymptom: sql`excluded.reported_symptom`,
          intakeInspectionResult: sql`excluded.intake_inspection_result`,
          currentDiagnosisSummary: sql`excluded.current_diagnosis_summary`,
          nextPlannedAction: sql`excluded.next_planned_action`,
          notes: sql`excluded.notes`,
          accessoryList: sql`excluded.accessory_list`,
          externalConditionSummary: sql`excluded.external_condition_summary`,
          reasonForRemoval: sql`excluded.reason_for_removal`,
          contactNameSnapshot: sql`excluded.contact_name_snapshot`,
          contactPhoneSnapshot: sql`excluded.contact_phone_snapshot`,
          contactEmailSnapshot: sql`excluded.contact_email_snapshot`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    counts.repairCases = repairCaseRows.length;
  });

  console.log("Seed complete. Row counts:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count}`);
  }
  if (process.env.DSS_SEED_TEST_WRAPPER !== "1") await seedRealisticDemoDataset();
}

if (process.env.DSS_SEED_TEST_WRAPPER !== "1") {
  seedDevelopmentFixtures()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
