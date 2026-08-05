import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureChecklistItems,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  users,
} from "../schema";
import {
  createDraftProcedureTemplateFromImport,
  publishProcedureTemplate,
  archiveProcedureTemplate,
  createNewDraftVersion,
} from "./procedure-templates";
import {
  canViewPublishedProcedureTemplates,
  canViewAllProcedureTemplateStatuses,
} from "@/lib/auth/procedure-template-authorization";
import { listProcedureTemplates, getProcedureTemplateDetail } from "../queries/procedure-templates";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";

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
      { fromNodeCode: "n4", toNodeCode: "n5", branchType: "YES", branchLabel: "YES", sortOrder: 5, sourceConnectorId: "c6" },
      { fromNodeCode: "n5", toNodeCode: "n1", branchType: "LOOP_BACK", branchLabel: "처음부터 재진행", sortOrder: 6, sourceConnectorId: null },
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

    const newNodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, result.id));
    assert.equal(newNodes.length, 8);
    const newEdges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, result.id));
    assert.equal(newEdges.length, 8);
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
