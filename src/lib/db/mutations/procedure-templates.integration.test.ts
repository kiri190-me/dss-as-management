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
  auditLogs,
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
    // Phase 5C-5C — procedure_template_edit_history.procedure_template_id is
    // onDelete:"restrict" (unlike its node_id/edge_id, which are "set
    // null"), so any row referencing one of these templates must be deleted
    // before the template itself. Previously nothing in this file ever
    // wrote a history row (renameTechnicalProcedureTemplate didn't yet), so
    // this was never exercised; renameTechnicalProcedureTemplate now writes
    // UPDATE_TEMPLATE_METADATA on every successful rename.
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allIds));
    // 2026-11-04 — 게시가 옛 게시본을 [만료됨]으로 내리면서 **감사 이력을
    // 남기기 시작했다.** FK 가 없어서(audit_logs 는 polymorphic 참조) 지우지
    // 않아도 템플릿 삭제는 성공하지만, 그러면 시험이 돌 때마다 이력이 쌓인다.
    // 이웃 시험(procedure-templates-trash.integration.test.ts)이 쓰는 그 방식 그대로다.
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "procedure_templates"), inArray(auditLogs.targetRecordId, allIds)));
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

  /**
   * 2026-11-03(줄기 B-⑤) — **사람이 끌어 놓은 배치가 새 초안으로 따라온다.**
   *
   * 그 전까지 user_position_x/y 가 복제 목록에서 빠져 있어서, 게시된 절차로 새
   * 초안을 만들면 배치가 통째로 사라졌다(개발 DB 실측: 「기본 통전 검사」 v1 은
   * 28/28 노드에 자리 값이 있는데 v2 초안은 0/28). 화면에서는 「원본 배치」로
   * 봐야만 모양이 맞고 「사용자 배치」가 텅 비는 것으로 드러났다.
   *
   * 🔴 두 쪽을 함께 잰다: 자리 값이 **있던** 노드는 값 그대로, **없던** 노드는
   * null 그대로. 한쪽만 재면 「전부 복사」도 「전부 0으로 채우기」도 통과한다.
   */
  test("3-B. a new DRAFT inherits the parent's saved user layout — and a node that never had one still arrives with null", async () => {
    const code = uniqueCode("new-version-layout");
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const parentNodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, imported.id));
    assert.ok(parentNodes.length >= 2, "표본이 비었다 — 자리 값이 있는 노드와 없는 노드가 둘 다 필요하다");
    const [placed, ...untouched] = [...parentNodes].sort((a, b) => a.nodeCode.localeCompare(b.nodeCode));
    assert.ok(parentNodes.every((n) => n.userPositionX === null), "가져온 직후에는 자리 값이 하나도 없어야 한다");

    // 편집기의 [저장]이 쓰는 바로 그 두 칸. 여기서는 레이아웃 저장 mutation 을
    // 거치지 않고 직접 적는다 — 이 시험이 재는 것은 "저장"이 아니라 "복제"다.
    await db.update(procedureTemplateNodes).set({ userPositionX: 135, userPositionY: -246 }).where(eq(procedureTemplateNodes.id, placed.id));

    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const result = await createNewDraftVersion(imported.id, superAdminId);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    createdTemplateIds.push(result.id);

    const clonedNodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    assert.equal(clonedNodes.length, parentNodes.length);
    const clonedByCode = new Map(clonedNodes.map((n) => [n.nodeCode, n]));

    const clonedPlaced = clonedByCode.get(placed.nodeCode);
    assert.ok(clonedPlaced, "node_code 는 판이 올라가도 그대로다");
    assert.equal(clonedPlaced!.userPositionX, 135, "사람이 끌어 놓은 자리가 새 초안으로 따라와야 한다");
    assert.equal(clonedPlaced!.userPositionY, -246);
    // 원본 좌표는 건드리지 않는다 — 자리 값과 완전히 별개의 칸이다.
    assert.equal(clonedPlaced!.positionX, placed.positionX);
    assert.equal(clonedPlaced!.positionY, placed.positionY);

    for (const parent of untouched) {
      const clone = clonedByCode.get(parent.nodeCode);
      assert.ok(clone);
      assert.equal(clone!.userPositionX, null, "한 번도 안 옮긴 노드에 자리를 만들어 주면 안 된다");
      assert.equal(clone!.userPositionY, null);
    }
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

  test("26. the four baseline legacy templates still exist and retain exactly the approved explicit category backfill (rfg/mb-full-lifecycle -> FULL_SERVICE, main-page-index/qc-common-operations -> REFERENCE) — read-only, never written by this suite", async () => {
    // Deliberately NOT asserting a total real-template row count: Phase
    // 5C-5B shipped createManualTechnicalProcedureTemplate, so legitimate
    // new real TECHNICAL_TASK rows are an expected, by-design outcome, not
    // an invariant violation — the only thing this test protects is that
    // these 4 specific legacy rows were never left unclassified/altered by
    // the one-time backfill, never "the database contains exactly 4 rows".
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

/**
 * ============================================================================
 * 한 계열(code)에 게시본은 하나 — 게시하면 옛 게시본이 [만료됨]이 된다 (2026-11-04)
 * ============================================================================
 * 사용자가 말한 것: "지금 게시된 것이 있다면 그 다른 버전은 [만료됨]이 되고,
 * 만료됨 에도 [게시]를 둬서 다시 게시할 수 있도록 … 한 제목 안에서 한개의
 * 버전만 게시상태로."
 *
 * 🔵 재는 것을 나눠 두었다 — 고르는 **규칙**은 unit 목록의
 * procedure-template-publish-policy.test.ts 가 값으로, 화면 배선과 "한
 * 트랜잭션인가"의 **구조**는 components 목록의 procedure-publish-flow.test.tsx 가
 * 원본 글자로 잰다. 여기서는 **진짜 행이 그렇게 바뀌는가**만 본다.
 *
 * 🔴 모든 단언 앞에 "그 게시본이 정말 있었는가"를 먼저 세운다. 안 그러면
 * "옛 게시본이 만료됐다"가 **게시본이 애초에 없어서** 공짜로 통과한다.
 * ============================================================================
 */
describe("publishProcedureTemplate — 한 계열에 게시본은 하나", () => {
  /** 한 계열의 (판 번호 → 상태) — 단언을 한 줄로 읽히게 한다. */
  async function statusByVersion(code: string): Promise<Record<number, string>> {
    const rows = await db
      .select({ version: procedureTemplates.version, status: procedureTemplates.status })
      .from(procedureTemplates)
      .where(and(eq(procedureTemplates.code, code), eq(procedureTemplates.isDeleted, false)));
    return Object.fromEntries(rows.map((r) => [r.version, r.status as string]));
  }

  async function rowOf(templateId: string) {
    const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
    return row;
  }

  /** 그 판을 내린 감사 이력 — 없으면 null. */
  async function expiryAuditFor(templateId: string) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "procedure_templates"), eq(auditLogs.targetRecordId, templateId)));
    return rows.filter((r) => r.actionType === "STATUS_CHANGE");
  }

  /** v1 을 게시해 둔 계열 하나. 돌려주는 것은 code 와 v1 의 id. */
  async function publishedV1(suffix: string) {
    const code = uniqueCode(suffix);
    const imported = await importTemplate({ code, includeErrorIssue: false });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) throw new Error("unreachable");
    const published = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));
    return { code, v1Id: imported.id };
  }

  /** 지금 게시본에서 새 초안을 떠서 그 id 를 돌려준다. */
  async function draftFrom(publishedId: string) {
    const next = await createNewDraftVersion(publishedId, superAdminId);
    assert.equal(next.ok, true, JSON.stringify(next));
    if (!next.ok) throw new Error("unreachable");
    createdTemplateIds.push(next.id);
    return next.id;
  }

  test("34. 🔴 가: 게시하면 같은 계열의 옛 게시본이 [만료됨](ARCHIVED)으로 내려간다", async () => {
    const { code, v1Id } = await publishedV1("expire-on-publish");
    const v2Id = await draftFrom(v1Id);

    // 🔵 먼저 표본 — 내려갈 게시본이 **정말 있었다.**
    assert.deepEqual(await statusByVersion(code), { 1: "PUBLISHED", 2: "DRAFT" });

    const published = await publishProcedureTemplate(v2Id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    assert.deepEqual(await statusByVersion(code), { 1: "ARCHIVED", 2: "PUBLISHED" });

    const v1 = await rowOf(v1Id);
    assert.ok(v1.archivedAt, "언제 내려갔는지가 비면 수명주기 칸이 반만 채워진다");
    assert.equal(v1.archivedByUserId, superAdminId, "게시를 누른 사람이 들어간다");
    // 게시된 판의 내용은 한 칸도 안 건드린다 — 내려간 것은 상태뿐이다.
    assert.equal(v1.publishedByUserId, superAdminId);
    assert.ok(v1.publishedAt, "게시 자국은 그대로 남는다 — 언제 쓰였던 판인지가 사라지면 안 된다");
  });

  test("35. 🔴 가: 다른 계열은 한 줄도 안 건드린다", async () => {
    const other = await publishedV1("other-lineage");
    const { code, v1Id } = await publishedV1("expire-scope");
    const v2Id = await draftFrom(v1Id);

    // 🔵 먼저 표본 — 이웃 계열이 게시 상태로 서 있다.
    assert.deepEqual(await statusByVersion(other.code), { 1: "PUBLISHED" });

    const published = await publishProcedureTemplate(v2Id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    assert.deepEqual(await statusByVersion(code), { 1: "ARCHIVED", 2: "PUBLISHED" });
    assert.deepEqual(await statusByVersion(other.code), { 1: "PUBLISHED" }, "남의 계열이 내려갔다");
    assert.deepEqual(await expiryAuditFor(other.v1Id), [], "남의 계열에 이력이 남았다");
  });

  test("36. 🔴 가: 감사 이력에 '게시에 딸려 내려갔다'는 표시가 남는다", async () => {
    const { v1Id } = await publishedV1("expire-audit");
    const v2Id = await draftFrom(v1Id);

    // 🔵 먼저 표본 — 내리기 전에는 이 판에 상태 변경 이력이 없다.
    assert.deepEqual(await expiryAuditFor(v1Id), []);

    const published = await publishProcedureTemplate(v2Id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const audits = await expiryAuditFor(v1Id);
    assert.equal(audits.length, 1, "내려간 판마다 한 줄이어야 한다");
    const [audit] = audits;
    assert.equal(audit.actorUserId, superAdminId);
    const before = audit.previousValue as Record<string, unknown>;
    const after = audit.newValue as Record<string, unknown>;
    assert.equal(before.status, "PUBLISHED", "무엇이었는지");
    assert.equal(after.status, "ARCHIVED", "무엇이 되었는지");
    // 🔴 사람이 손으로 내린 것과 가르는 열쇠. 이것이 없으면 둘 다 그냥
    //    STATUS_CHANGE 라 영영 구분되지 않는다.
    assert.equal(after.expiredByPublish, true);
    assert.equal(
      after.reason,
      "같은 절차의 다른 판이 게시되어 시스템이 [만료됨]으로 내렸습니다.",
      "처리자 칸에는 게시를 누른 사람이 서 있다 — 이 문장이 없으면 그 사람이 손으로 내린 것으로 읽힌다"
    );
    assert.equal(after.publishedTemplateId, v2Id, "무엇에 딸려 내려갔는지");
    assert.equal(after.publishedVersion, 2);

    // 🔵 견줄 쪽 — 올라간 판에는 이 이력이 안 붙는다.
    assert.deepEqual(await expiryAuditFor(v2Id), []);
  });

  test("37. 🔴 가: 게시가 거절되면 **옛 게시본도 그대로다** — 한 트랜잭션이다", async () => {
    const { code, v1Id } = await publishedV1("expire-rollback");
    const v2Id = await draftFrom(v1Id);
    // 새 초안에 미해결 ERROR 를 하나 심는다. createNewDraftVersion 은 검증
    // 이슈를 일부러 안 옮기므로(그 함수의 주석), 여기서 직접 넣어야 한다.
    await db.insert(procedureTemplateValidationIssues).values({
      procedureTemplateId: v2Id,
      severity: "ERROR",
      issueType: "DANGLING_CONNECTOR",
      message: "통합 시험용 미해결 오류",
      sourceWorksheet: "(TEST) 가상 시트",
      sourceReference: "A1",
    });

    // 🔵 먼저 표본 — 막히기 전의 모습.
    assert.deepEqual(await statusByVersion(code), { 1: "PUBLISHED", 2: "DRAFT" });

    const blocked = await publishProcedureTemplate(v2Id, superAdminId);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "HAS_UNRESOLVED_ERRORS");

    // 🔴 둘 다 안 바뀌어야 한다. v1 만 내려가고 v2 는 안 올라가면, 그 계열은
    //    게시본이 **하나도 없는** 상태로 남는다(현장에서 불러올 수 없게 된다).
    assert.deepEqual(await statusByVersion(code), { 1: "PUBLISHED", 2: "DRAFT" });
    const v1 = await rowOf(v1Id);
    assert.equal(v1.archivedAt, null, "거절된 게시가 옛 판에 만료 자국을 남겼다");
    assert.equal(v1.archivedByUserId, null);
    assert.deepEqual(await expiryAuditFor(v1Id), [], "거절됐는데 이력만 남으면 거짓 기록이다");
  });

  test("38. 🔴 나: [만료됨]에서 다시 게시할 수 있고, 그때 지금 게시본이 내려간다", async () => {
    const { code, v1Id } = await publishedV1("republish");
    const v2Id = await draftFrom(v1Id);
    assert.equal((await publishProcedureTemplate(v2Id, superAdminId)).ok, true);

    // 🔵 먼저 표본 — v1 이 정말 만료 상태이고 v2 가 지금 게시본이다.
    assert.deepEqual(await statusByVersion(code), { 1: "ARCHIVED", 2: "PUBLISHED" });

    const republished = await publishProcedureTemplate(v1Id, superAdminId);
    assert.equal(republished.ok, true, `만료본을 다시 게시하지 못했다: ${JSON.stringify(republished)}`);

    assert.deepEqual(await statusByVersion(code), { 1: "PUBLISHED", 2: "ARCHIVED" }, "다시 게시해도 계열당 하나여야 한다");
    const v1 = await rowOf(v1Id);
    assert.equal(v1.archivedAt, null, "다시 올라간 판에 만료 자국이 남으면 '게시됐는데 만료된' 행이 된다");
    assert.equal(v1.archivedByUserId, null);
    assert.ok(v1.publishedAt);
    assert.equal(v1.version, 1, "다시 게시는 판 번호를 올리지 않는다 — 같은 내용이다");
  });

  test("39. 🔴 나: 만료본에서 다시 게시할 때도 **검증을 그대로 거친다**", async () => {
    const { code, v1Id } = await publishedV1("republish-validation");
    const v2Id = await draftFrom(v1Id);
    assert.equal((await publishProcedureTemplate(v2Id, superAdminId)).ok, true);
    assert.deepEqual(await statusByVersion(code), { 1: "ARCHIVED", 2: "PUBLISHED" });

    // 만료된 v1 에 미해결 ERROR 가 생겼다고 치자(그 사이 검증 규칙이 바뀌었거나,
    // 그 판에 달려 있던 이슈가 다시 열렸거나).
    await db.insert(procedureTemplateValidationIssues).values({
      procedureTemplateId: v1Id,
      severity: "ERROR",
      issueType: "MISSING_OUTGOING_PATH",
      message: "통합 시험용 미해결 오류(재게시)",
      sourceWorksheet: "(TEST) 가상 시트",
      sourceReference: "B2",
    });

    const blocked = await publishProcedureTemplate(v1Id, superAdminId);
    assert.equal(blocked.ok, false, "한 번 게시됐던 판이라는 이유로 검증을 건너뛰면 안 된다");
    if (!blocked.ok) assert.equal(blocked.code, "HAS_UNRESOLVED_ERRORS");
    assert.deepEqual(await statusByVersion(code), { 1: "ARCHIVED", 2: "PUBLISHED" }, "막혔으면 둘 다 그대로다");
  });

  test("40. 🔴 이미 게시된 판은 또 게시할 수 없다 (CONFLICT)", async () => {
    const { code, v1Id } = await publishedV1("double-publish");
    const again = await publishProcedureTemplate(v1Id, superAdminId);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "CONFLICT");
    assert.deepEqual(await statusByVersion(code), { 1: "PUBLISHED" }, "거절이 제 행을 건드리면 안 된다");
    assert.deepEqual(await expiryAuditFor(v1Id), [], "자기 자신을 내리고 올리는 일이 있으면 안 된다");
  });

  test("41. 🔴 게시본이 둘이던 옛 계열 — 한 번 게시하면 **둘 다** 내려간다", async () => {
    // 개발 DB 의 code "7"(v1·v2 둘 다 PUBLISHED)과 같은 모양을 만든다. 그 상태는
    // 이제 mutation 으로는 만들 수 없으므로(이 조각이 막았다) **직접 UPDATE** 로
    // 세운다 — 이미 있는 행을 고치는 길이 없으면 이 경우를 영영 못 잰다.
    const { code, v1Id } = await publishedV1("legacy-double");
    const v2Id = await draftFrom(v1Id);
    await db
      .update(procedureTemplates)
      .set({ status: "PUBLISHED", publishedByUserId: superAdminId, publishedAt: new Date() })
      .where(eq(procedureTemplates.id, v2Id));

    // 🔵 먼저 표본 — 게시본이 정말 둘이다.
    assert.deepEqual(await statusByVersion(code), { 1: "PUBLISHED", 2: "PUBLISHED" });

    const v3Id = await draftFrom(v2Id);
    const published = await publishProcedureTemplate(v3Id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    assert.deepEqual(
      await statusByVersion(code),
      { 1: "ARCHIVED", 2: "ARCHIVED", 3: "PUBLISHED" },
      "한 판만 내리면 게시본이 둘로 남는다"
    );
    assert.equal((await expiryAuditFor(v1Id)).length, 1, "내려간 판마다 이력이 한 줄씩");
    assert.equal((await expiryAuditFor(v2Id)).length, 1);
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

  test("renaming inserts exactly one UPDATE_TEMPLATE_METADATA history row with before/after {name} and Phase 5C-5C group/sequence fields populated", async () => {
    const draft = await createDraft();
    const result = await renameTechnicalProcedureTemplate(draft.id, superAdminId, "이력 확인", draft.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    const historyRows = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(eq(procedureTemplateEditHistory.procedureTemplateId, draft.id));
    assert.equal(historyRows.length, 1);
    const [row] = historyRows;
    assert.equal(row.actionType, "UPDATE_TEMPLATE_METADATA");
    assert.equal(row.nodeId, null);
    assert.equal(row.edgeId, null);
    assert.deepEqual(row.beforeState, { name: "원래 이름" });
    assert.deepEqual(row.afterState, { name: "이력 확인" });
    assert.ok(row.changeGroupId, "changeGroupId must be populated");
    assert.equal(row.origin, "USER_EDIT");
    assert.equal(row.sourceGroupId, null);
    assert.equal(row.restoreTargetGroupId, null);
    assert.equal(typeof row.sequenceNumber, "number");
    assert.ok(row.sequenceNumber > 0, "sequence_number must be DB-generated (IDENTITY)");
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

/**
 * ============================================================================
 * 줄기 B ④ 조각 ③ — **게시 관문이 이어가기 검증을 실제로 본다**
 * ============================================================================
 * 🔴 이 절이 지키는 것은 「규칙이 맞는가」가 아니라 **「게시 관문이 그 규칙을
 * 부르기는 하는가」**다. 규칙 자체는 단위 시험이 값으로 잰다.
 *
 * 이 조각을 만들다 실제로 한 번 어긋났다 — 게시가 검증을 **맥락 없이** 부르고
 * 있어서, 편집기 [검증]에는 빨간 줄이 뜨는데 게시는 그냥 통과했다. 맥락을
 * 만드는 쪽이 편집기 파일에만 있었기 때문이다. 단위 시험은 그 어긋남을 영영
 * 못 잡는다(규칙은 멀쩡했다). 그래서 여기서 **진짜 게시를 불러** 잰다.
 *
 * 🔴 그리고 **막지 말아야 할 것이 안 막히는지**도 함께 잰다. 「가리킨 쪽에
 * 게시본이 없다」를 ERROR 로 올리면, 서로를 가리킨 두 절차가 **어느 쪽도 먼저
 * 게시할 수 없어** 영영 막힌다.
 * ============================================================================
 */
describe("줄기 B ④ 조각 ③ — 게시 관문과 이어가기", () => {
  /** 이 절차의 END 노드에 「다음 절차」를 심는다(편집기를 거치지 않고 바로). */
  async function pointEndTo(templateId: string, targetId: string) {
    const [endNode] = await db
      .select()
      .from(procedureTemplateNodes)
      .where(
        and(
          eq(procedureTemplateNodes.procedureTemplateId, templateId),
          eq(procedureTemplateNodes.nodeType, "END")
        )
      );
    assert.ok(endNode, "표본 확인 — 이 밑자락에 END 노드가 있어야 이 시험에 뜻이 있다");
    await db
      .update(procedureTemplateNodes)
      .set({ nextProcedureTemplateId: targetId })
      .where(eq(procedureTemplateNodes.id, endNode.id));
    return endNode.id;
  }

  test("🔴 자기 계열을 가리키면 **게시가 막힌다** — 관문이 이 갈래를 부르고 있다는 증거다", async () => {
    const imported = await importTemplate({ code: uniqueCode("next-self-loop"), includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    await pointEndTo(imported.id, imported.id);

    const result = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(result.ok, false, "맥락을 안 넘기면 이 갈래가 통째로 안 돌아 그냥 통과한다");
    if (result.ok) return;
    assert.equal(result.code, "HAS_STRUCTURAL_ERRORS");

    const [row] = await db
      .select({ status: procedureTemplates.status })
      .from(procedureTemplates)
      .where(eq(procedureTemplates.id, imported.id));
    assert.equal(row.status, "DRAFT");
  });

  test("🔴 가리킨 쪽에 게시본이 없어도 **게시는 된다** — ERROR 면 서로 가리킨 둘이 영영 못 나간다", async () => {
    const a = await importTemplate({ code: uniqueCode("next-pair-a"), includeErrorIssue: false });
    const b = await importTemplate({ code: uniqueCode("next-pair-b"), includeErrorIssue: false });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;

    // A→B · B→A, 둘 다 아직 초안이다. 「게시본이 있어야 한다」가 막는 조건이면
    // 여기서 어느 쪽도 나갈 수 없다.
    await pointEndTo(a.id, b.id);
    await pointEndTo(b.id, a.id);

    const published = await publishProcedureTemplate(a.id, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const [row] = await db
      .select({ status: procedureTemplates.status })
      .from(procedureTemplates)
      .where(eq(procedureTemplates.id, a.id));
    assert.equal(row.status, "PUBLISHED", "한쪽이 나가야 나머지도 따라 나갈 수 있다");
  });

  test("🔵 지정이 없으면 게시는 전과 똑같다 — 새 갈래가 멀쩡한 절차를 막지 않는다", async () => {
    const imported = await importTemplate({ code: uniqueCode("next-none"), includeErrorIssue: false });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const result = await publishProcedureTemplate(imported.id, superAdminId);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});
