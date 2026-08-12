import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureChecklistItems,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  procedureReferenceItems,
  procedureTemplateEditHistory,
  users,
} from "../schema";
import {
  createDraftProcedureTemplateFromImport,
  publishProcedureTemplate,
  archiveProcedureTemplate,
  createNewDraftVersion,
  replaceDraftProcedureTemplates,
  createManualTechnicalProcedureTemplate,
  renameTechnicalProcedureTemplate,
} from "./procedure-templates";
import {
  canViewPublishedProcedureTemplates,
  canViewAllProcedureTemplateStatuses,
} from "@/lib/auth/procedure-template-authorization";
import { listProcedureTemplates, getProcedureTemplateDetail, listTechnicalProcedureTemplates } from "../queries/procedure-templates";
import { combineShapeGraphSheets } from "../../../../scripts/lib/xlsx/combine-shape-graph-sheets";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { LoadedSheet } from "../../../../scripts/lib/xlsx/workbook-loader";
import type { DrawingAnchor } from "../../../../scripts/lib/xlsx/ooxml-parser";

/**
 * Real-DB integration tests for the Phase 2 procedure-template mutation
 * layer. Uses hand-built synthetic ExtractedTemplate fixtures rather than
 * the real 26 MB workbook — keeps these tests fast, deterministic, and
 * independent of a file that lives outside the repo. The extractor logic
 * itself (parsing, branch/node classification, loop-back detection) is
 * covered separately by scripts/lib/xlsx/*.test.ts unit tests.
 *
 * Self-cleaning: every template created here uses a code prefixed with
 * TEST_CODE_PREFIX; after() deletes every row created (children before
 * parents, since every FK in this schema is onDelete:"restrict", never
 * cascade). Never touches D260801–D260809, products, existing users,
 * approvals, or intake sequences — only reads existing users to act as.
 */

const TEST_CODE_PREFIX = "test-proc-";

let superAdminId: string;
let nonSuperAdminId: string; // ADMIN — used for unauthorized-action tests
let asEngineerId: string;
let salesId: string;
let inventoryManagerId: string;

const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

function makeTemplate(opts: {
  code: string;
  includeErrorIssue?: boolean;
}): ExtractedTemplate {
  const includeErrorIssue = opts.includeErrorIssue ?? true;
  return {
    code: opts.code,
    name: `테스트 절차 ${opts.code}`,
    equipmentType: "RFG",
    description: "통합 테스트용 합성 템플릿",
    sourceWorksheets: ["(TEST) 가상 시트"],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "TASK", title: "시작 작업", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "DECISION", title: "판단 작업", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "CORRECTIVE_ACTION", title: "NG 조치", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "3" },
      { nodeCode: "n4", nodeType: "TASK", title: "정상 진행", positionX: 300, positionY: 0, sortOrder: 3, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "4" },
      { nodeCode: "n5", nodeType: "END", title: "완료", positionX: 400, positionY: 0, sortOrder: 4, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "5" },
      { nodeCode: "n6", nodeType: "CORRECTIVE_ACTION", title: "NO 조치", positionX: 500, positionY: 0, sortOrder: 5, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "6" },
      { nodeCode: "n7", nodeType: "CHECKLIST", title: "체크리스트", positionX: 0, positionY: 100, sortOrder: 6, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: null },
      { nodeCode: "n8", nodeType: "TROUBLESHOOTING", title: "고장 진단표", positionX: 0, positionY: 200, sortOrder: 7, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: null },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "NG", branchLabel: "NG", sortOrder: 1, sourceConnectorId: "c2" },
      { fromNodeCode: "n2", toNodeCode: "n4", branchType: "NORMAL", branchLabel: "정상", sortOrder: 2, sourceConnectorId: "c3" },
      { fromNodeCode: "n2", toNodeCode: "n6", branchType: "NO", branchLabel: "NO", sortOrder: 3, sourceConnectorId: "c4" },
      { fromNodeCode: "n3", toNodeCode: "n2", branchType: "RETRY", branchLabel: "재측정", sortOrder: 4, sourceConnectorId: "c5" },
      // Phase 4A note: YES/NO/NG/NORMAL are only structurally valid as a
      // DECISION node's own outcome (see procedure-graph-structural-
      // validation.ts's INVALID_BRANCH_TYPE_FOR_NODE rule) — n4 is TASK, so
      // this is a plain DEFAULT edge, same as the real workbook's pattern
      // of an ordinary task-to-task hand-off.
      { fromNodeCode: "n4", toNodeCode: "n5", branchType: "DEFAULT", branchLabel: null, sortOrder: 5, sourceConnectorId: "c6" },
      // LOOP_BACK must not target an END node (INVALID_LOOP_BACK_TARGET) —
      // sourced from n6 (CORRECTIVE_ACTION) instead of n5 (END), matching
      // the real RFG workbook's pattern of looping back from a corrective/
      // recheck step, never from the flow's actual completion node.
      { fromNodeCode: "n6", toNodeCode: "n1", branchType: "LOOP_BACK", branchLabel: "처음부터 재진행", sortOrder: 6, sourceConnectorId: null },
      { fromNodeCode: "n1", toNodeCode: "n6", branchType: "CUSTOM", branchLabel: "특수분기", sortOrder: 7, sourceConnectorId: "c7" },
    ],
    checklistSections: [
      {
        nodeCode: "n7",
        sectionCode: "sec1",
        title: "테스트 섹션",
        sortOrder: 0,
        sourceWorksheet: "(TEST) 가상 시트",
        sourceCellRange: "A1:B10",
        items: [
          {
            itemCode: "sec1-1",
            title: "압력 확인",
            instructions: "압력계를 확인한다.",
            measurementType: "PRESSURE",
            measurementUnit: "MPa",
            minValue: "0.5",
            maxValue: "0.505",
            required: true,
            sortOrder: 0,
            sourceCellRange: "A5:B5",
          },
        ],
      },
    ],
    troubleshootingEntries: [
      {
        nodeCode: "n8",
        symptom: "테스트 알람 발생",
        inspectionAction: "1차 점검",
        normalNextAction: "1차 점검 → 2차 점검 → 수리 완료",
        ngAction: "부품 교환",
        retryInstruction: null,
        sortOrder: 0,
        sourceCellRange: "A1:C5",
      },
    ],
    issues: [
      ...(includeErrorIssue
        ? ([
            {
              severity: "ERROR" as const,
              issueType: "DANGLING_CONNECTOR" as const,
              message: "연결선의 시작 또는 끝 도형 참조가 없습니다 (connector#99).",
              sourceWorksheet: "(TEST) 가상 시트",
              sourceReference: "connector#99",
            },
          ])
        : []),
      {
        severity: "WARNING",
        issueType: "FORMULA_ERROR",
        message: "셀 A5이(가) #VALUE! 수식 오류를 포함하고 있습니다.",
        sourceWorksheet: "(TEST) 가상 시트",
        sourceReference: "A5",
      },
    ],
  };
}

async function importTemplate(opts: { code: string; includeErrorIssue?: boolean; actorId?: string }) {
  const template = makeTemplate({ code: opts.code, includeErrorIssue: opts.includeErrorIssue });
  const result = await createDraftProcedureTemplateFromImport(template, opts.actorId ?? superAdminId, {
    sourceFileName: "test-fixture.xlsx",
    sourceFileHash: `hash-${opts.code}`,
  });
  if (result.ok) createdTemplateIds.push(result.id);
  return result;
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(admin, "expected an approved ADMIN in the dev DB");
  nonSuperAdminId = admin.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the dev DB");
  asEngineerId = engineer.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(sales, "expected an approved SALES user in the dev DB");
  salesId = sales.id;

  const [inventoryManager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "INVENTORY_MANAGER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(inventoryManager, "expected an approved INVENTORY_MANAGER in the dev DB");
  inventoryManagerId = inventoryManager.id;
});

after(async () => {
  // Re-query every template descended from the ones we tracked (covers
  // createNewDraftVersion's cloned rows too, via the code prefix) so
  // cleanup is complete even though clones get a fresh id.
  const allTestTemplates = await db
    .select({ id: procedureTemplates.id })
    .from(procedureTemplates)
    .where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  if (allIds.length > 0) {
    const nodeRows = await db.select({ id: procedureTemplateNodes.id }).from(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allIds));
    const nodeIds = nodeRows.map((n) => n.id);
    const sectionRows =
      nodeIds.length > 0
        ? await db.select({ id: procedureChecklistSections.id }).from(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, nodeIds))
        : [];
    const sectionIds = sectionRows.map((s) => s.id);

    if (sectionIds.length > 0) await db.delete(procedureChecklistItems).where(inArray(procedureChecklistItems.sectionId, sectionIds));
    if (sectionIds.length > 0) await db.delete(procedureChecklistSections).where(inArray(procedureChecklistSections.id, sectionIds));
    if (nodeIds.length > 0) await db.delete(procedureTroubleshootingEntries).where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds));
    await db.delete(procedureTemplateValidationIssues).where(inArray(procedureTemplateValidationIssues.procedureTemplateId, allIds));
    await db.delete(procedureReferenceItems).where(inArray(procedureReferenceItems.procedureTemplateId, allIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allIds));
    if (nodeIds.length > 0) await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.id, nodeIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("createDraftProcedureTemplateFromImport", () => {
  test("1. creates a DRAFT template with nodes, edges, checklist, and troubleshooting content", async () => {
    const code = uniqueCode("create");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true, `import failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    assert.equal(row.status, "DRAFT");
    assert.equal(row.version, 1);
    assert.equal(row.sourceType, "EXCEL_IMPORT");
    assert.equal(row.code, code);
  });

  test("7. persists every node and edge with correct field values", async () => {
    const code = uniqueCode("nodes-edges");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    assert.equal(nodes.length, 8);
    const decisionNode = nodes.find((n) => n.nodeCode === "n2");
    assert.ok(decisionNode);
    assert.equal(decisionNode.nodeType, "DECISION");
    assert.equal(decisionNode.title, "판단 작업");
    assert.equal(decisionNode.sourceShapeId, "2");

    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    assert.equal(edges.length, 8);
  });

  test("8. NORMAL edge imports with correct branch_type and label", async () => {
    const code = uniqueCode("normal-edge");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    const normalEdge = edges.find((e) => e.branchType === "NORMAL");
    assert.ok(normalEdge, "expected a NORMAL edge");
    assert.equal(normalEdge.branchLabel, "정상");
  });

  test("9. NG label-to-edge imports with correct branch_type and label", async () => {
    const code = uniqueCode("ng-edge");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    const ngEdge = edges.find((e) => e.branchType === "NG");
    assert.ok(ngEdge, "expected an NG edge");
    assert.equal(ngEdge.branchLabel, "NG");
  });

  test("10. RETRY and LOOP_BACK edges persist correctly", async () => {
    const code = uniqueCode("retry-loopback");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    const retryEdge = edges.find((e) => e.branchType === "RETRY");
    const loopBackEdge = edges.find((e) => e.branchType === "LOOP_BACK");
    assert.ok(retryEdge, "expected a RETRY edge");
    assert.equal(retryEdge.branchLabel, "재측정");
    assert.ok(loopBackEdge, "expected a LOOP_BACK edge");
    assert.equal(loopBackEdge.branchLabel, "처음부터 재진행");
    assert.equal(loopBackEdge.sourceConnectorId, null); // loop-backs are text-inferred, not from a real connector
  });

  test("11. an issue with a dangling-connector reference persists as a validation issue row", async () => {
    const code = uniqueCode("dangling");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const issues = await db.select().from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.procedureTemplateId, result.id));
    const danglingIssue = issues.find((i) => i.issueType === "DANGLING_CONNECTOR");
    assert.ok(danglingIssue, "expected a DANGLING_CONNECTOR issue");
    assert.equal(danglingIssue.severity, "ERROR");
    assert.equal(danglingIssue.sourceReference, "connector#99");
    assert.equal(danglingIssue.resolvedAt, null);
  });

  test("12. checklist section and item persist correctly", async () => {
    const code = uniqueCode("checklist");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    const checklistNode = nodes.find((n) => n.nodeCode === "n7");
    assert.ok(checklistNode);

    const sections = await db.select().from(procedureChecklistSections).where(eq(procedureChecklistSections.nodeId, checklistNode.id));
    assert.equal(sections.length, 1);
    assert.equal(sections[0].title, "테스트 섹션");

    const items = await db.select().from(procedureChecklistItems).where(eq(procedureChecklistItems.sectionId, sections[0].id));
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "압력 확인");
  });

  test("13. checklist item measurement thresholds persist with full precision", async () => {
    const code = uniqueCode("measurement");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    const checklistNode = nodes.find((n) => n.nodeCode === "n7")!;
    const sections = await db.select().from(procedureChecklistSections).where(eq(procedureChecklistSections.nodeId, checklistNode.id));
    const items = await db.select().from(procedureChecklistItems).where(eq(procedureChecklistItems.sectionId, sections[0].id));

    assert.equal(items[0].measurementType, "PRESSURE");
    assert.equal(items[0].measurementUnit, "MPa");
    assert.equal(items[0].minValue, "0.5"); // unconstrained numeric — round-trips exactly as entered, no forced scale
    assert.equal(items[0].maxValue, "0.505");
  });

  test("14. troubleshooting matrix entry persists correctly", async () => {
    const code = uniqueCode("troubleshooting");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    const tsNode = nodes.find((n) => n.nodeCode === "n8");
    assert.ok(tsNode);

    const entries = await db.select().from(procedureTroubleshootingEntries).where(eq(procedureTroubleshootingEntries.nodeId, tsNode.id));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].symptom, "테스트 알람 발생");
    assert.equal(entries[0].ngAction, "부품 교환");
  });

  test("15. workbook source traceability is preserved on nodes and edges", async () => {
    const code = uniqueCode("traceability");
    const result = await importTemplate({ code });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    const node = nodes.find((n) => n.nodeCode === "n2")!;
    assert.equal(node.sourceWorksheet, "(TEST) 가상 시트");
    assert.equal(node.sourceShapeId, "2");

    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    const edge = edges.find((e) => e.sourceConnectorId === "c2")!;
    assert.ok(edge, "expected the NG edge's source_connector_id to be preserved");
  });

  test("16. re-importing the same source file hash is idempotent (no duplicate row)", async () => {
    const code = uniqueCode("idempotent");
    const first = await importTemplate({ code });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await importTemplate({ code });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyImported, true);
    assert.equal(second.id, first.id);

    const rows = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(eq(procedureTemplates.code, code));
    assert.equal(rows.length, 1, "expected exactly one template row despite importing twice");
  });

  test("17. unauthorized (non-SUPER_ADMIN) import is rejected with FORBIDDEN", async () => {
    const code = uniqueCode("unauthorized-import");
    const result = await importTemplate({ code, actorId: nonSuperAdminId });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");

    const rows = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(eq(procedureTemplates.code, code));
    assert.equal(rows.length, 0, "no template row should exist after a rejected import");
  });
});

describe("publishProcedureTemplate", () => {
  test("4. publish is blocked while an unresolved ERROR validation issue exists", async () => {
    const code = uniqueCode("publish-blocked");
    const imported = await importTemplate({ code, includeErrorIssue: true });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const result = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "HAS_UNRESOLVED_ERRORS");

    const [row] = await db.select({ status: procedureTemplates.status }).from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    assert.equal(row.status, "DRAFT", "status must remain DRAFT when publish is blocked");
  });

  test("5. a template with no unresolved ERROR issues publishes successfully", async () => {
    const code = uniqueCode("publish-ok");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const result = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(result.ok, true, `publish failed: ${JSON.stringify(result)}`);

    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    assert.equal(row.status, "PUBLISHED");
    assert.equal(row.publishedByUserId, superAdminId);
    assert.ok(row.publishedAt);
  });

  test("18. unauthorized (non-SUPER_ADMIN) publish is rejected with FORBIDDEN", async () => {
    const code = uniqueCode("unauthorized-publish");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const result = await publishProcedureTemplate(imported.id, nonSuperAdminId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");

    const [row] = await db.select({ status: procedureTemplates.status }).from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    assert.equal(row.status, "DRAFT");
  });

  test("2. a PUBLISHED template's rows are never mutated by re-importing the same source or creating a new version", async () => {
    const code = uniqueCode("immutable");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true);

    const [beforeRow] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));

    // Re-running the importer against the same (code, hash) must not touch the published row.
    const reImport = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(reImport.ok, true);
    if (reImport.ok) assert.equal(reImport.id, imported.id);

    // Creating a new draft version clones into a *new* row, leaving this one untouched.
    const newVersion = await createNewDraftVersion(imported.id, superAdminId);
    assert.equal(newVersion.ok, true);
    if (newVersion.ok) createdTemplateIds.push(newVersion.id);

    const [afterRow] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    assert.deepEqual(afterRow.updatedAt, beforeRow.updatedAt, "published row's updated_at must not change");
    assert.equal(afterRow.status, "PUBLISHED");
    assert.equal(afterRow.version, beforeRow.version);
  });

  test("19. a published template is readable by every allowed role, through the real query path", async () => {
    assert.equal(canViewPublishedProcedureTemplates("SUPER_ADMIN"), true);
    assert.equal(canViewPublishedProcedureTemplates("ADMIN"), true);
    assert.equal(canViewPublishedProcedureTemplates("AS_ENGINEER"), true);
    assert.equal(canViewPublishedProcedureTemplates("SALES"), false);
    assert.equal(canViewPublishedProcedureTemplates("INVENTORY_MANAGER"), false);
    assert.equal(canViewAllProcedureTemplateStatuses("AS_ENGINEER"), false);
    assert.equal(canViewAllProcedureTemplateStatuses("ADMIN"), true);

    // AS_ENGINEER's actual query scope is includeAllStatuses=false — confirm
    // the published template surfaces through that exact call, and that
    // getProcedureTemplateDetail (the [id] page's query) resolves it too.
    // asEngineerId itself is only used to prove this suite queried against
    // a real AS_ENGINEER account, not a placeholder role string.
    const [engineerRow] = await db.select({ role: users.role }).from(users).where(eq(users.id, asEngineerId));
    assert.equal(engineerRow.role, "AS_ENGINEER");

    const code = uniqueCode("readable");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true);

    const asEngineerScopedList = await listProcedureTemplates(canViewAllProcedureTemplateStatuses("AS_ENGINEER"));
    assert.ok(asEngineerScopedList.some((t) => t.id === imported.id), "published template must appear in the AS_ENGINEER-scoped list");

    const detail = await getProcedureTemplateDetail(imported.id);
    assert.ok(detail);
    assert.equal(detail?.status, "PUBLISHED");
    assert.equal(detail?.nodes.length, 8);
  });
});

describe("createNewDraftVersion", () => {
  test("3. creates a new DRAFT row (version+1) with cloned nodes/edges, not an edit of the published row", async () => {
    const code = uniqueCode("new-version");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true);

    const result = await createNewDraftVersion(imported.id, superAdminId);
    assert.equal(result.ok, true, `new version failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    createdTemplateIds.push(result.id);

    const [newRow] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    assert.equal(newRow.status, "DRAFT");
    assert.equal(newRow.version, 2);
    assert.equal(newRow.supersedesTemplateId, imported.id);
    assert.equal(newRow.code, code);

    // Phase 5C-5A — a new DRAFT version must preserve its parent's category
    // exactly; no conversion/switching path exists.
    const [publishedRow] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    assert.equal(newRow.category, publishedRow.category);
    assert.equal(newRow.category, "FULL_SERVICE");

    const newNodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    assert.equal(newNodes.length, 8);
    const newEdges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    assert.equal(newEdges.length, 8);

    // Phase 4A — every cloned edge must carry clonedFromEdgeId pointing at
    // its exact parent-version counterpart (never null for a clone), and
    // every one of those parent ids must actually belong to the published
    // template this draft was created from — the DRAFT-vs-parent edge diff
    // depends on this being exact, not a best-effort guess.
    const publishedEdges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, imported.id));
    const publishedEdgeIds = new Set(publishedEdges.map((e) => e.id));
    for (const e of newEdges) {
      assert.ok(e.clonedFromEdgeId, `cloned edge ${e.id} must have clonedFromEdgeId set`);
      assert.ok(publishedEdgeIds.has(e.clonedFromEdgeId!), `clonedFromEdgeId ${e.clonedFromEdgeId} must point at a real edge on the published parent`);
    }
    assert.equal(new Set(newEdges.map((e) => e.clonedFromEdgeId)).size, newEdges.length, "each cloned edge must map to a distinct parent edge, never shared");
  });
});

describe("Phase 5C-5A: procedure_templates.category foundation", () => {
  test("24. category/is_reference_only valid combinations round-trip exactly as inserted (FULL_SERVICE+false, TECHNICAL_TASK+false, REFERENCE+true)", async () => {
    const fullServiceCode = uniqueCode("category-full-service");
    const fullServiceResult = await createDraftProcedureTemplateFromImport(
      { ...makeTemplate({ code: fullServiceCode, includeErrorIssue: false }), category: "FULL_SERVICE", isReferenceOnly: false },
      superAdminId,
      { sourceFileName: "test-fixture.xlsx", sourceFileHash: `hash-${fullServiceCode}` }
    );
    assert.equal(fullServiceResult.ok, true);
    if (fullServiceResult.ok) {
      createdTemplateIds.push(fullServiceResult.id);
      const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, fullServiceResult.id));
      assert.equal(row.category, "FULL_SERVICE");
      assert.equal(row.isReferenceOnly, false);
    }

    const technicalCode = uniqueCode("category-technical-task");
    const technicalResult = await createDraftProcedureTemplateFromImport(
      { ...makeTemplate({ code: technicalCode, includeErrorIssue: false }), category: "TECHNICAL_TASK", isReferenceOnly: false },
      superAdminId,
      { sourceFileName: "test-fixture.xlsx", sourceFileHash: `hash-${technicalCode}` }
    );
    assert.equal(technicalResult.ok, true);
    if (technicalResult.ok) {
      createdTemplateIds.push(technicalResult.id);
      const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, technicalResult.id));
      assert.equal(row.category, "TECHNICAL_TASK");
      assert.equal(row.isReferenceOnly, false);
    }
  });

  /**
   * drizzle-orm wraps the driver's real PostgresError — the original is on
   * `.cause`, same convention this file's own isUniqueViolation-style
   * helpers rely on elsewhere in this codebase (see
   * db/mutations/procedure-case-execution.ts's isUniqueViolation). The
   * *outer* thrown error's own .message is just "Failed query: ...", never
   * the constraint-violation text — so the check-violation assertion must
   * inspect .cause, not the top-level error, or it fails for the wrong
   * reason even when the CHECK correctly did its job.
   */
  function isCheckViolation(err: unknown, constraintName: string): boolean {
    const cause = err instanceof Error ? err.cause : undefined;
    const message = cause instanceof Error ? cause.message : String(err);
    return /violates check constraint/i.test(message) && message.includes(constraintName);
  }

  test("25. an invalid category/is_reference_only combination is rejected at the DB level by the CHECK constraint", async () => {
    const code = uniqueCode("category-invalid-combo");
    await assert.rejects(
      () =>
        db.insert(procedureTemplates).values({
          code,
          name: "잘못된 조합 테스트",
          equipmentType: "COMMON",
          // Invalid: FULL_SERVICE must always pair with isReferenceOnly=false.
          category: "FULL_SERVICE",
          isReferenceOnly: true,
          status: "DRAFT",
          version: 1,
          sourceType: "MANUAL",
          createdByUserId: superAdminId,
        }),
      (err: unknown) => isCheckViolation(err, "procedure_templates_category_reference_only_consistency"),
      "a FULL_SERVICE + is_reference_only=true row must be rejected by procedure_templates_category_reference_only_consistency"
    );

    await assert.rejects(
      () =>
        db.insert(procedureTemplates).values({
          code: uniqueCode("category-invalid-combo-2"),
          name: "잘못된 조합 테스트 2",
          equipmentType: "COMMON",
          // Invalid: REFERENCE must always pair with isReferenceOnly=true.
          category: "REFERENCE",
          isReferenceOnly: false,
          status: "DRAFT",
          version: 1,
          sourceType: "MANUAL",
          createdByUserId: superAdminId,
        }),
      (err: unknown) => isCheckViolation(err, "procedure_templates_category_reference_only_consistency"),
      "a REFERENCE + is_reference_only=false row must be rejected by procedure_templates_category_reference_only_consistency"
    );
  });

  test("26. the exact 4 real templates carry exactly the approved explicit category backfill (rfg/mb-full-lifecycle -> FULL_SERVICE, main-page-index/qc-common-operations -> REFERENCE) — read-only, never written by this suite", async () => {
    const rows = await db
      .select({ code: procedureTemplates.code, category: procedureTemplates.category, isReferenceOnly: procedureTemplates.isReferenceOnly })
      .from(procedureTemplates)
      .where(sql`code not like ${TEST_CODE_PREFIX + "%"}`);
    const byCode = new Map(rows.map((r) => [r.code, r]));

    assert.equal(byCode.get("rfg-full-lifecycle")?.category, "FULL_SERVICE");
    assert.equal(byCode.get("rfg-full-lifecycle")?.isReferenceOnly, false);
    assert.equal(byCode.get("mb-full-lifecycle")?.category, "FULL_SERVICE");
    assert.equal(byCode.get("mb-full-lifecycle")?.isReferenceOnly, false);
    assert.equal(byCode.get("main-page-index")?.category, "REFERENCE");
    assert.equal(byCode.get("main-page-index")?.isReferenceOnly, true);
    assert.equal(byCode.get("qc-common-operations")?.category, "REFERENCE");
    assert.equal(byCode.get("qc-common-operations")?.isReferenceOnly, true);

    // Every non-test row must have been explicitly classified — the backfill
    // must never leave a real row's category unaccounted for.
    assert.equal(rows.length, 4, `expected exactly the 4 known real templates, found: ${rows.map((r) => r.code).join(", ")}`);
  });
});

describe("Phase 2.5: full-lifecycle combine, replace mode, reference-only templates", () => {
  /**
   * Synthetic 3-sheet fixture reproducing the real workbook's two verified
   * RFG cross-stage loop-backs firing simultaneously against the same
   * combined template: (RFG)(7)-shaped source A uses the stage-7 wording
   * ("...과정부터 재진행 실시"), (RFG)(11)-shaped source B uses the
   * stage-11 wording ("...재실시") — both name stage 4, and both must
   * resolve to a real LOOP_BACK edge into the same (RFG)(4)-shaped
   * target's START node once all three sheets are combined.
   */
  function buildStage7Sheet(): LoadedSheet {
    const drawing: DrawingAnchor[] = [
      { kind: "shape", id: "1", name: "n1", descr: null, geom: "rect", text: "에이징 테스트 실시", fill: null, from: { col: 0, row: 0 }, to: { col: 2, row: 1 } },
      { kind: "shape", id: "2", name: "n2", descr: null, geom: "rect", text: "(4)기본 정전 검사 과정부터 재진행 실시", fill: null, from: { col: 0, row: 3 }, to: { col: 2, row: 4 } },
      { kind: "connector", id: "c1", name: "c1", geom: "straightConnector1", stCxnId: "1", endCxnId: "2", headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 0, row: 3 } },
    ];
    return {
      name: "(TEST-RFG) (7)원복 검사 및 개선 작업",
      sheetId: "9107",
      worksheetPath: "xl/worksheets/sheetStage7.xml",
      drawingPath: "xl/drawings/drawingStage7.xml",
      worksheet: { dimension: "A1:F10", merges: [], hyperlinks: [], cells: {} },
      drawing,
    };
  }

  function buildStage11Sheet(): LoadedSheet {
    const drawing: DrawingAnchor[] = [
      { kind: "shape", id: "1", name: "n1", descr: null, geom: "rect", text: "출하 준비 확인", fill: null, from: { col: 0, row: 0 }, to: { col: 2, row: 1 } },
      { kind: "shape", id: "2", name: "n2", descr: null, geom: "rect", text: "(4) 기본 정전 검사 재실시", fill: null, from: { col: 0, row: 3 }, to: { col: 2, row: 4 } },
      { kind: "connector", id: "c1", name: "c1", geom: "straightConnector1", stCxnId: "1", endCxnId: "2", headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 0, row: 3 } },
    ];
    return {
      name: "(TEST-RFG) (11)출하 준비",
      sheetId: "9111",
      worksheetPath: "xl/worksheets/sheetStage11.xml",
      drawingPath: "xl/drawings/drawingStage11.xml",
      worksheet: { dimension: "A1:F10", merges: [], hyperlinks: [], cells: {} },
      drawing,
    };
  }

  function buildStage4Sheet(): LoadedSheet {
    const drawing: DrawingAnchor[] = [
      { kind: "shape", id: "1", name: "n1", descr: null, geom: "rect", text: "판금 탈거 및 외관 확인", fill: null, from: { col: 0, row: 0 }, to: { col: 2, row: 1 } },
      { kind: "shape", id: "2", name: "n2", descr: null, geom: "rect", text: "통전 검사 실시", fill: null, from: { col: 0, row: 3 }, to: { col: 2, row: 4 } },
      { kind: "connector", id: "c1", name: "c1", geom: "straightConnector1", stCxnId: "1", endCxnId: "2", headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 0, row: 3 } },
    ];
    return {
      name: "(TEST-RFG) (4)기본 정전 검사",
      sheetId: "9104",
      worksheetPath: "xl/worksheets/sheetStage4.xml",
      drawingPath: "xl/drawings/drawingStage4.xml",
      worksheet: { dimension: "A1:F10", merges: [], hyperlinks: [], cells: {} },
      drawing,
    };
  }

  function buildRfgLifecycleFixture(code: string): ExtractedTemplate {
    return combineShapeGraphSheets([buildStage7Sheet(), buildStage11Sheet(), buildStage4Sheet()], {
      code,
      name: "테스트 RFG 전체 수명주기",
      equipmentType: "RFG",
      description: "합성 3시트 결합 테스트 — 두 개의 독립된 재진행(LOOP_BACK) 참조가 동일 대상으로 수렴한다.",
    });
  }

  test("20. a combined multi-sheet template with two independent stage-restart references persists two LOOP_BACK edges into the same target START node", async () => {
    const code = uniqueCode("rfg-two-loopbacks");
    const template = buildRfgLifecycleFixture(code);
    assert.equal(template.edges.filter((e) => e.branchType === "LOOP_BACK").length, 2, "extractor-level sanity check");

    const result = await createDraftProcedureTemplateFromImport(template, superAdminId, {
      sourceFileName: "test-fixture.xlsx",
      sourceFileHash: `hash-${code}`,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    createdTemplateIds.push(result.id);

    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    const loopBackEdges = edges.filter((e) => e.branchType === "LOOP_BACK");
    assert.equal(loopBackEdges.length, 2, "both verified loop-backs must persist as real edges");
    const targets = new Set(loopBackEdges.map((e) => e.toNodeId));
    assert.equal(targets.size, 1, "both loop-backs must resolve to the same target START node");

    const targetNode = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, [...targets][0]));
    assert.equal(targetNode[0].sourceWorksheet, "(TEST-RFG) (4)기본 정전 검사");
  });

  test("21. re-running the importer against the same combined-template source is idempotent — zero duplicate rows, identical node/edge counts", async () => {
    const code = uniqueCode("rfg-idempotent-combine");
    const hash = `hash-${code}`;

    const first = await createDraftProcedureTemplateFromImport(buildRfgLifecycleFixture(code), superAdminId, {
      sourceFileName: "test-fixture.xlsx",
      sourceFileHash: hash,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    createdTemplateIds.push(first.id);

    const second = await createDraftProcedureTemplateFromImport(buildRfgLifecycleFixture(code), superAdminId, {
      sourceFileName: "test-fixture.xlsx",
      sourceFileHash: hash,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyImported, true);
    assert.equal(second.id, first.id);

    const templateRows = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(eq(procedureTemplates.code, code));
    assert.equal(templateRows.length, 1);
    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, first.id));
    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, first.id));
    assert.equal(nodes.length, 6, "3 sheets x 2 flow shapes each — no duplicate node rows from the second run");
    assert.equal(edges.length, 5, "3 internal connector edges + 2 loop-back edges — no duplicate edge rows");
  });

  test("22. replaceDraftProcedureTemplates deletes only DRAFT rows matching the given codes, and never touches a PUBLISHED template with the same code", async () => {
    const publishedCode = uniqueCode("replace-guard-published");
    const publishedImport = await importTemplate({ code: publishedCode, includeErrorIssue: false });
    assert.equal(publishedImport.ok, true);
    if (!publishedImport.ok) return;
    const publishResult = await publishProcedureTemplate(publishedImport.id, superAdminId);
    assert.equal(publishResult.ok, true);

    const draftOnlyCode = uniqueCode("replace-guard-draft");
    const draftImport = await importTemplate({ code: draftOnlyCode, includeErrorIssue: false });
    assert.equal(draftImport.ok, true);
    if (!draftImport.ok) return;

    const replaceResult = await replaceDraftProcedureTemplates([publishedCode, draftOnlyCode], superAdminId);
    assert.equal(replaceResult.ok, true);
    if (!replaceResult.ok) return;

    const deletedCodes = replaceResult.deleted.map((d) => d.code);
    assert.ok(deletedCodes.includes(draftOnlyCode), "the DRAFT-status template must be deleted");
    assert.ok(!deletedCodes.includes(publishedCode), "the PUBLISHED-status template must never be deleted");

    const [publishedRow] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, publishedImport.id));
    assert.ok(publishedRow, "the published template row must still exist");
    assert.equal(publishedRow.status, "PUBLISHED");

    const draftRows = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(eq(procedureTemplates.code, draftOnlyCode));
    assert.equal(draftRows.length, 0, "the draft template row must be gone");

    // Only createdTemplateIds not deleted need to remain tracked for cleanup.
    createdTemplateIds.push(publishedImport.id);
  });

  test("23. a reference-only template imports with zero procedure_template_nodes rows and its reference items persist and are queryable", async () => {
    const code = uniqueCode("reference-only");
    const template: ExtractedTemplate = {
      code,
      name: "테스트 참고용 인덱스",
      equipmentType: "COMMON",
      description: "합성 참고용 템플릿",
      sourceWorksheets: ["(TEST) Main page"],
      category: "REFERENCE",
      isReferenceOnly: true,
      nodes: [],
      edges: [],
      checklistSections: [],
      troubleshootingEntries: [],
      referenceItems: [
        {
          itemType: "NAV_LINK",
          label: "1. 고장/이슈 발생",
          sourceWorksheet: "(TEST) Main page",
          sourceCellRange: "A3:A4",
          hyperlinkTarget: "(TEST-RFG) (1)고장 접수 확인",
          crossReferenceNumber: null,
          sortOrder: 0,
        },
        {
          itemType: "CROSS_REFERENCE_ID",
          label: "68",
          sourceWorksheet: "(TEST) Main page",
          sourceCellRange: "C5",
          hyperlinkTarget: null,
          crossReferenceNumber: "68",
          sortOrder: 1,
        },
      ],
      issues: [
        {
          severity: "INFO",
          issueType: "ORPHAN_REFERENCE_ITEM",
          message: "셀 C5의 교차 참조 번호가 해석되지 않습니다.",
          sourceWorksheet: "(TEST) Main page",
          sourceReference: "C5",
        },
      ],
    };

    const result = await createDraftProcedureTemplateFromImport(template, superAdminId, {
      sourceFileName: "test-fixture.xlsx",
      sourceFileHash: `hash-${code}`,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    createdTemplateIds.push(result.id);

    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    assert.equal(row.equipmentType, "COMMON");
    assert.equal(row.isReferenceOnly, true);
    assert.equal(row.category, "REFERENCE");

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    assert.equal(nodes.length, 0, "a reference-only template must have zero executable nodes");

    const items = await db.select().from(procedureReferenceItems).where(eq(procedureReferenceItems.procedureTemplateId, result.id));
    assert.equal(items.length, 2);

    const detail = await getProcedureTemplateDetail(result.id);
    assert.ok(detail);
    assert.equal(detail?.isReferenceOnly, true);
    assert.equal(detail?.referenceItems.length, 2);
    assert.equal(detail?.nodes.length, 0);
  });
});

describe("archiveProcedureTemplate", () => {
  test("6. archives a PUBLISHED template; rejects archiving a DRAFT; rejects double-archive", async () => {
    const code = uniqueCode("archive");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const blockedOnDraft = await archiveProcedureTemplate(imported.id, superAdminId);
    assert.equal(blockedOnDraft.ok, false);
    if (!blockedOnDraft.ok) assert.equal(blockedOnDraft.code, "CONFLICT");

    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true);

    const archived = await archiveProcedureTemplate(imported.id, superAdminId);
    assert.equal(archived.ok, true, `archive failed: ${JSON.stringify(archived)}`);
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    assert.equal(row.status, "ARCHIVED");
    assert.ok(row.archivedAt);
    assert.equal(row.archivedByUserId, superAdminId);

    const doubleArchive = await archiveProcedureTemplate(imported.id, superAdminId);
    assert.equal(doubleArchive.ok, false);
    if (!doubleArchive.ok) assert.equal(doubleArchive.code, "CONFLICT");
  });
});

describe("Phase 5C-5B: coarse-then-fine authorization ordering (publishProcedureTemplate / createNewDraftVersion)", () => {
  const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000000";

  test("27. publishProcedureTemplate: AS_ENGINEER/SALES/INVENTORY_MANAGER against a nonexistent template id are rejected before any row lookup (FORBIDDEN, never NOT_FOUND)", async () => {
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const result = await publishProcedureTemplate(NONEXISTENT_ID, actorId);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("28. publishProcedureTemplate: ADMIN passes the coarse pre-gate, so a nonexistent template id surfaces as NOT_FOUND", async () => {
    const result = await publishProcedureTemplate(NONEXISTENT_ID, nonSuperAdminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("29. publishProcedureTemplate: ADMIN against an EXISTING FULL_SERVICE DRAFT is FORBIDDEN at the fine-grained, category-specific check", async () => {
    const imported = await importTemplate({ code: uniqueCode("admin-publish-forbidden"), includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const result = await publishProcedureTemplate(imported.id, nonSuperAdminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("30. createNewDraftVersion: AS_ENGINEER/SALES/INVENTORY_MANAGER against a nonexistent template id are rejected before any row lookup (FORBIDDEN, never NOT_FOUND)", async () => {
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const result = await createNewDraftVersion(NONEXISTENT_ID, actorId);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("31. createNewDraftVersion: ADMIN passes the coarse pre-gate, so a nonexistent template id surfaces as NOT_FOUND", async () => {
    const result = await createNewDraftVersion(NONEXISTENT_ID, nonSuperAdminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("32. createNewDraftVersion: ADMIN against an EXISTING PUBLISHED FULL_SERVICE template is FORBIDDEN at the fine-grained, category-specific check", async () => {
    const imported = await importTemplate({ code: uniqueCode("admin-new-version-forbidden"), includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true);

    const result = await createNewDraftVersion(imported.id, nonSuperAdminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("33. SUPER_ADMIN retains existing publish/createNewDraftVersion behavior unchanged after the authorization refactor", async () => {
    const imported = await importTemplate({ code: uniqueCode("super-admin-unchanged"), includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true, `publish failed: ${JSON.stringify(published)}`);

    const newVersion = await createNewDraftVersion(imported.id, superAdminId);
    assert.equal(newVersion.ok, true, `createNewDraftVersion failed: ${JSON.stringify(newVersion)}`);
    if (newVersion.ok) createdTemplateIds.push(newVersion.id);
  });
});

/**
 * Phase 5C-5B-1 — createManualTechnicalProcedureTemplate: the first
 * template-creation path that is not the Excel importer. Self-cleaning via
 * the same TEST_CODE_PREFIX convention as every other describe block in
 * this file.
 */
describe("createManualTechnicalProcedureTemplate", () => {
  async function trackAndReturn(result: Awaited<ReturnType<typeof createManualTechnicalProcedureTemplate>>) {
    if (result.ok) createdTemplateIds.push(result.id);
    return result;
  }

  test("ADMIN creates a TECHNICAL_TASK DRAFT", async () => {
    const code = uniqueCode("manual-admin");
    const result = await trackAndReturn(
      await createManualTechnicalProcedureTemplate({ code, name: "수동 생성 절차", equipmentType: "COMMON", description: "설명" }, nonSuperAdminId)
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("SUPER_ADMIN creates a TECHNICAL_TASK DRAFT", async () => {
    const code = uniqueCode("manual-super");
    const result = await trackAndReturn(
      await createManualTechnicalProcedureTemplate({ code, name: "수동 생성 절차", equipmentType: "RFG" }, superAdminId)
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("AS_ENGINEER, SALES, INVENTORY_MANAGER are denied", async () => {
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const code = uniqueCode("manual-denied");
      const result = await createManualTechnicalProcedureTemplate({ code, name: "x", equipmentType: "COMMON" }, actorId);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("the created row is always category=TECHNICAL_TASK, isReferenceOnly=false, status=DRAFT, version=1, sourceType=MANUAL", async () => {
    const code = uniqueCode("manual-fields");
    const result = await trackAndReturn(await createManualTechnicalProcedureTemplate({ code, name: "필드 확인", equipmentType: "MB" }, superAdminId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    assert.equal(row.category, "TECHNICAL_TASK");
    assert.equal(row.isReferenceOnly, false);
    assert.equal(row.status, "DRAFT");
    assert.equal(row.version, 1);
    assert.equal(row.sourceType, "MANUAL");
    assert.equal(row.code, code);
    assert.equal(row.equipmentType, "MB");
  });

  test("category cannot be spoofed by client input — the input type has no category/isReferenceOnly/status/version/sourceType field at all, so passing one (as an out-of-band/loosely-typed payload) is silently ignored, never read", async () => {
    const code = uniqueCode("manual-spoof");
    const spoofed = { code, name: "위조 시도", equipmentType: "COMMON" as const, category: "FULL_SERVICE", isReferenceOnly: true, status: "PUBLISHED", version: 99, sourceType: "EXCEL_IMPORT" };
    const result = await trackAndReturn(await createManualTechnicalProcedureTemplate(spoofed as never, superAdminId));
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    assert.equal(row.category, "TECHNICAL_TASK", "the extra category field on the input object must never be read");
    assert.equal(row.isReferenceOnly, false);
    assert.equal(row.status, "DRAFT");
    assert.equal(row.version, 1);
    assert.equal(row.sourceType, "MANUAL");
  });

  test("blank code, blank name, and an unsupported equipmentType are all rejected with INVALID_INPUT", async () => {
    const blankCode = await createManualTechnicalProcedureTemplate({ code: "   ", name: "x", equipmentType: "COMMON" }, superAdminId);
    assert.equal(blankCode.ok, false);
    if (!blankCode.ok) assert.equal(blankCode.code, "INVALID_INPUT");

    const blankName = await createManualTechnicalProcedureTemplate({ code: uniqueCode("manual-blank-name"), name: "   ", equipmentType: "COMMON" }, superAdminId);
    assert.equal(blankName.ok, false);
    if (!blankName.ok) assert.equal(blankName.code, "INVALID_INPUT");

    const badEquipment = await createManualTechnicalProcedureTemplate({ code: uniqueCode("manual-bad-equip"), name: "x", equipmentType: "NOT_REAL" as never }, superAdminId);
    assert.equal(badEquipment.ok, false);
    if (!badEquipment.ok) assert.equal(badEquipment.code, "INVALID_INPUT");
  });

  test("code/name are trimmed before storage", async () => {
    const rawCode = uniqueCode("manual-trim");
    const result = await trackAndReturn(
      await createManualTechnicalProcedureTemplate({ code: `  ${rawCode}  `, name: "  공백 포함 이름  ", equipmentType: "COMMON" }, superAdminId)
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    assert.equal(row.code, rawCode);
    assert.equal(row.name, "공백 포함 이름");
  });

  test("a duplicate (code, version=1) is translated to a clean CONFLICT, never a raw unique-constraint error, and never discloses the colliding template's category", async () => {
    const code = uniqueCode("manual-dup");
    const first = await trackAndReturn(await createManualTechnicalProcedureTemplate({ code, name: "첫 번째", equipmentType: "COMMON" }, superAdminId));
    assert.equal(first.ok, true);

    const second = await createManualTechnicalProcedureTemplate({ code, name: "두 번째 (중복)", equipmentType: "COMMON" }, superAdminId);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "CONFLICT");
      assert.doesNotMatch(second.message.toUpperCase(), /FULL_SERVICE|TECHNICAL_TASK|REFERENCE/, "the CONFLICT message must never disclose the colliding template's category");
    }
  });

  test("a duplicate against an EXISTING FULL_SERVICE imported template's code is also translated to the same generic CONFLICT, without disclosing that the collision is against a different category", async () => {
    const code = uniqueCode("manual-dup-cross-category");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const result = await createManualTechnicalProcedureTemplate({ code, name: "충돌 시도", equipmentType: "COMMON" }, superAdminId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "CONFLICT");
      assert.doesNotMatch(result.message.toUpperCase(), /FULL_SERVICE|TECHNICAL_TASK|REFERENCE/);
    }
  });

  test("no nodes/edges are created automatically — a freshly created manual template has an empty graph", async () => {
    const code = uniqueCode("manual-empty-graph");
    const result = await trackAndReturn(await createManualTechnicalProcedureTemplate({ code, name: "빈 그래프", equipmentType: "COMMON" }, superAdminId));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    assert.equal(nodes.length, 0);
    assert.equal(edges.length, 0);
  });
});

/**
 * Phase 5C-5B usability item 5 — renameTechnicalProcedureTemplate. Same
 * self-cleaning convention (createdTemplateIds) as every other describe
 * block here.
 */
describe("renameTechnicalProcedureTemplate", () => {
  async function createDraft() {
    const code = uniqueCode("rename");
    const result = await createManualTechnicalProcedureTemplate({ code, name: "원래 이름", equipmentType: "COMMON" }, superAdminId);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("setup failed");
    createdTemplateIds.push(result.id);
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, result.id));
    return row;
  }

  test("ADMIN and SUPER_ADMIN can rename a TECHNICAL_TASK DRAFT; the name is trimmed", async () => {
    const draft = await createDraft();
    const result = await renameTechnicalProcedureTemplate(draft.id, nonSuperAdminId, "  새 이름  ", draft.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.name, "새 이름");
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, draft.id));
    assert.equal(row.name, "새 이름");
    assert.equal(row.updatedAt.toISOString(), result.updatedAt);
  });

  test("AS_ENGINEER, SALES, INVENTORY_MANAGER are denied", async () => {
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const draft = await createDraft();
      const result = await renameTechnicalProcedureTemplate(draft.id, actorId, "변경 시도", draft.updatedAt.toISOString());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("a blank/whitespace-only name is rejected with INVALID_INPUT", async () => {
    const draft = await createDraft();
    const result = await renameTechnicalProcedureTemplate(draft.id, superAdminId, "   ", draft.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("a stale expectedTemplateUpdatedAt is rejected with CONFLICT, and the name is left unchanged", async () => {
    const draft = await createDraft();
    const stale = new Date(draft.updatedAt.getTime() - 1000).toISOString();
    const result = await renameTechnicalProcedureTemplate(draft.id, superAdminId, "변경 시도", stale);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, draft.id));
    assert.equal(row.name, "원래 이름");
  });

  test("a PUBLISHED TECHNICAL_TASK template cannot be renamed", async () => {
    const draft = await createDraft();
    const published = await publishProcedureTemplate(draft.id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, draft.id));
    const result = await renameTechnicalProcedureTemplate(draft.id, superAdminId, "변경 시도", row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");
  });

  test("SUPER_ADMIN cannot rename a FULL_SERVICE template through this function — no broadening beyond TECHNICAL_TASK", async () => {
    const code = uniqueCode("rename-full-service");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, imported.id));
    const result = await renameTechnicalProcedureTemplate(imported.id, superAdminId, "변경 시도", row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("renaming does not insert a procedure_template_edit_history row (no existing action type represents template metadata rename)", async () => {
    const draft = await createDraft();
    const result = await renameTechnicalProcedureTemplate(draft.id, superAdminId, "이력 없음 확인", draft.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    const historyRows = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(eq(procedureTemplateEditHistory.procedureTemplateId, draft.id));
    assert.equal(historyRows.length, 0);
  });

  test("the code is never changed by a rename", async () => {
    const draft = await createDraft();
    const originalCode = draft.code;
    const result = await renameTechnicalProcedureTemplate(draft.id, superAdminId, "코드 불변 확인", draft.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, draft.id));
    assert.equal(row.code, originalCode);
  });
});

/** Phase 5C-5B — listTechnicalProcedureTemplates: the technical-library list query. */
describe("listTechnicalProcedureTemplates", () => {
  test("only returns TECHNICAL_TASK rows, excluding FULL_SERVICE/REFERENCE templates created by other suites in this file", async () => {
    const code = uniqueCode("list-technical");
    const created = await createManualTechnicalProcedureTemplate({ code, name: "목록 조회 테스트", equipmentType: "COMMON" }, superAdminId);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    createdTemplateIds.push(created.id);

    const rows = await listTechnicalProcedureTemplates(true);
    assert.ok(rows.some((r) => r.id === created.id));

    // No FULL_SERVICE/REFERENCE row this file creates can ever appear here.
    const fullServiceImport = await importTemplate({ code: uniqueCode("list-technical-full-service"), includeErrorIssue: false });
    assert.equal(fullServiceImport.ok, true);
    if (!fullServiceImport.ok) return;
    const rowsAfter = await listTechnicalProcedureTemplates(true);
    assert.equal(rowsAfter.some((r) => r.id === fullServiceImport.id), false, "a FULL_SERVICE row must never appear in the technical list");
  });

  test("includeAllStatuses=false hides a DRAFT technical template; true shows it", async () => {
    const code = uniqueCode("list-technical-draft");
    const created = await createManualTechnicalProcedureTemplate({ code, name: "DRAFT 표시 테스트", equipmentType: "COMMON" }, superAdminId);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    createdTemplateIds.push(created.id);

    const publishedOnly = await listTechnicalProcedureTemplates(false);
    assert.equal(publishedOnly.some((r) => r.id === created.id), false, "a DRAFT row must be hidden when includeAllStatuses=false");

    const all = await listTechnicalProcedureTemplates(true);
    assert.equal(all.some((r) => r.id === created.id), true, "a DRAFT row must be visible when includeAllStatuses=true");
  });

  test("nodeCount/edgeCount reflect the template's actual graph", async () => {
    const code = uniqueCode("list-technical-counts");
    const created = await createManualTechnicalProcedureTemplate({ code, name: "그래프 수 테스트", equipmentType: "COMMON" }, superAdminId);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    createdTemplateIds.push(created.id);

    const before = await listTechnicalProcedureTemplates(true);
    const rowBefore = before.find((r) => r.id === created.id);
    assert.ok(rowBefore);
    assert.equal(rowBefore.nodeCount, 0);
    assert.equal(rowBefore.edgeCount, 0);
  });
});
