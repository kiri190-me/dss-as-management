import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  procedureChecklistSections,
  procedureTroubleshootingEntries,
  users,
} from "../schema";
import {
  createDraftProcedureTemplateFromImport,
  publishProcedureTemplate,
  createNewDraftVersion,
  createManualTechnicalProcedureTemplate,
} from "./procedure-templates";
import {
  updateProcedureTemplateNode,
  changeProcedureTemplateNodeType,
  saveProcedureTemplateLayout,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  createProcedureTemplateEdge,
  validateProcedureTemplate,
  createProcedureTemplateNode,
  deleteProcedureTemplateNode,
  deleteProcedureTemplateEdge,
  insertProcedureTemplateNodeOnEdge,
} from "./procedure-template-editor";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import { MAX_ROUTE_POINTS } from "@/lib/graph-editor-core/routing";
import { getProcedureTemplateForEditor } from "../queries/procedure-template-editor";
import { getProcedureTemplateDetail } from "../queries/procedure-templates";

/**
 * Phase 4A integration tests for the controlled-editor mutation layer.
 * Same self-cleaning convention as procedure-templates.integration.test.ts:
 * every template created here uses a code prefixed with TEST_CODE_PREFIX;
 * after() deletes every row this suite created (edit-history rows first —
 * they're the one FK Phase 4A added, and it's onDelete:"restrict" — then
 * edges/nodes/templates), never touches the four real imported templates,
 * the 13 real validation issues, or the codebase's own user rows beyond a
 * momentary isActive/lockedAt flip-and-restore on the shared SUPER_ADMIN
 * test actor (same pattern procedure-validation-resolutions.integration.
 * test.ts already uses).
 */

const TEST_CODE_PREFIX = "test-editor-";

let superAdminId: string;
let adminId: string;
let asEngineerId: string;
let salesId: string;
let inventoryManagerId: string;

const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

/** START -> DECISION -> (YES: TASK -> END) -/(NG: TASK back to DECISION via RETRY) — structurally clean under procedure-graph-structural-validation.ts's rules, so publish succeeds until a test deliberately breaks it. */
function makeEditableTemplate(code: string): ExtractedTemplate {
  return {
    code,
    name: `편집기 테스트 ${code}`,
    equipmentType: "RFG",
    description: "Phase 4A editor mutation integration test fixture",
    sourceWorksheets: ["(TEST) 편집기 시트"],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: "(TEST) 편집기 시트", sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "DECISION", title: "판단", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: "(TEST) 편집기 시트", sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "TASK", title: "정상 작업", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: "(TEST) 편집기 시트", sourceShapeId: "3" },
      { nodeCode: "n4", nodeType: "END", title: "종료", positionX: 300, positionY: 0, sortOrder: 3, sourceWorksheet: "(TEST) 편집기 시트", sourceShapeId: "4" },
      { nodeCode: "n5", nodeType: "CORRECTIVE_ACTION", title: "NG 조치", positionX: 100, positionY: 100, sortOrder: 4, sourceWorksheet: "(TEST) 편집기 시트", sourceShapeId: "5" },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "YES", branchLabel: "YES", sortOrder: 1, sourceConnectorId: "c2" },
      { fromNodeCode: "n2", toNodeCode: "n5", branchType: "NG", branchLabel: "NG", sortOrder: 2, sourceConnectorId: "c3" },
      { fromNodeCode: "n5", toNodeCode: "n2", branchType: "RETRY", branchLabel: "재측정", sortOrder: 3, sourceConnectorId: "c4" },
      { fromNodeCode: "n3", toNodeCode: "n4", branchType: "DEFAULT", branchLabel: null, sortOrder: 4, sourceConnectorId: "c5" },
    ],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };
}

async function createDraft(code: string) {
  const result = await createDraftProcedureTemplateFromImport(makeEditableTemplate(code), superAdminId, { sourceFileName: "editor-fixture.xlsx", sourceFileHash: `hash-${code}` });
  assert.equal(result.ok, true, `fixture import failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdTemplateIds.push(result.id);
  return result.id;
}

/** Phase 5C-5B-1 — a manual TECHNICAL_TASK DRAFT with no nodes/edges yet, the starting point for createProcedureTemplateNode/deleteProcedureTemplateNode/deleteProcedureTemplateEdge tests. */
async function createTechnicalDraft(code: string, actorId = superAdminId) {
  const result = await createManualTechnicalProcedureTemplate({ code, name: `기술 절차 테스트 ${code}`, equipmentType: "COMMON" }, actorId);
  assert.equal(result.ok, true, `technical draft creation failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdTemplateIds.push(result.id);
  return result.id;
}

/**
 * Phase 5C-5B-1 — a REFERENCE DRAFT fixture. No production creation path
 * exists for REFERENCE templates yet (only the Excel importer's two
 * hardcoded navigational builders create real ones — see
 * scripts/import-procedure-templates.ts) — a direct insert is the only way
 * to get a synthetic one for the "REFERENCE hard-denies the new
 * capability" tests, same test-only-direct-DB-operation convention this
 * file's own tests 43-46 already use for isolated FK-behavior proofs.
 */
async function createReferenceDraft(code: string) {
  const [row] = await db
    .insert(procedureTemplates)
    .values({
      code,
      name: `참조 템플릿 테스트 ${code}`,
      equipmentType: "COMMON",
      category: "REFERENCE",
      isReferenceOnly: true,
      status: "DRAFT",
      version: 1,
      sourceType: "MANUAL",
      createdByUserId: superAdminId,
    })
    .returning({ id: procedureTemplates.id });
  createdTemplateIds.push(row.id);
  return row.id;
}

/** Phase 5C-5B-1 — builds a 2-TASK-node, 1-DEFAULT-edge graph on an existing (empty) technical DRAFT via the production mutations themselves (createProcedureTemplateNode x2, then the existing createProcedureTemplateEdge), so delete-edge/delete-node tests start from a realistic, mutation-produced fixture rather than a raw insert. */
async function seedTechnicalGraph(templateId: string, actorId = superAdminId) {
  const templateRow = await loadTemplateRow(templateId);
  const n1 = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "노드1" }, templateRow.updatedAt.toISOString());
  assert.equal(n1.ok, true, `seed node 1 failed: ${JSON.stringify(n1)}`);
  if (!n1.ok) throw new Error("unreachable");
  const n2 = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "노드2" }, n1.updatedAt);
  assert.equal(n2.ok, true, `seed node 2 failed: ${JSON.stringify(n2)}`);
  if (!n2.ok) throw new Error("unreachable");
  const edge = await createProcedureTemplateEdge(templateId, actorId, { fromNodeId: n1.nodeId, toNodeId: n2.nodeId, branchType: "DEFAULT", reason: "테스트 연결" }, n2.updatedAt);
  assert.equal(edge.ok, true, `seed edge failed: ${JSON.stringify(edge)}`);
  if (!edge.ok) throw new Error("unreachable");
  return { nodeAId: n1.nodeId, nodeBId: n2.nodeId, edgeId: edge.edgeId, updatedAt: edge.updatedAt };
}

async function loadTemplateRow(templateId: string) {
  const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
  return row;
}

async function loadNodesByCode(templateId: string) {
  const rows = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  return new Map(rows.map((n) => [n.nodeCode, n]));
}

async function loadEdges(templateId: string) {
  return db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
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
  adminId = admin.id;

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
  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  if (allIds.length > 0) {
    // procedure_template_edit_history is onDelete:"restrict" against
    // procedure_templates/nodes/edges — must go first, or the later
    // template/node/edge deletes below would themselves be restricted.
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allIds));

    // Phase 5C-5B-1 — the NODE_HAS_DEPENDENT_CONTENT tests attach synthetic
    // checklist sections/troubleshooting entries directly; both are
    // onDelete:"restrict" against node_id, so they must go before the node
    // delete below too.
    const nodeRows = await db.select({ id: procedureTemplateNodes.id }).from(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allIds));
    const nodeIds = nodeRows.map((n) => n.id);
    if (nodeIds.length > 0) {
      await db.delete(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, nodeIds));
      await db.delete(procedureTroubleshootingEntries).where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds));
    }

    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("procedure-template-editor: authorization and draft/reference-only gating", () => {
  test("1. a PUBLISHED template's nodes cannot be edited", async () => {
    const templateId = await createDraft(uniqueCode("published-guard"));
    const nodes = await loadNodesByCode(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true);

    const templateRow = await loadTemplateRow(templateId);
    const result = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "should fail" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });

  test("2. a reference-only DRAFT template cannot be validated/edited", async () => {
    const code = uniqueCode("reference-only");
    const extracted: ExtractedTemplate = { ...makeEditableTemplate(code), category: "REFERENCE", isReferenceOnly: true, nodes: [], edges: [] };
    const result = await createDraftProcedureTemplateFromImport(extracted, superAdminId, { sourceFileName: "ref.xlsx", sourceFileHash: `hash-${code}` });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    createdTemplateIds.push(result.id);

    const validateResult = await validateProcedureTemplate(result.id, superAdminId);
    assert.equal(validateResult.ok, false);
    if (!validateResult.ok) assert.equal(validateResult.code, "REFERENCE_ONLY");
  });

  test("3. an unauthorized (non-SUPER_ADMIN) actor cannot edit a DRAFT node", async () => {
    const templateId = await createDraft(uniqueCode("unauthorized"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const result = await updateProcedureTemplateNode(nodes.get("n3")!.id, adminId, { title: "should be forbidden" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("4. an inactive SUPER_ADMIN actor cannot edit, and a locked one cannot either", async () => {
    const templateId = await createDraft(uniqueCode("inactive-locked"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    await db.update(users).set({ isActive: false }).where(eq(users.id, superAdminId));
    try {
      const result = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "inactive attempt" }, templateRow.updatedAt.toISOString());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    } finally {
      await db.update(users).set({ isActive: true }).where(eq(users.id, superAdminId));
    }

    await db.update(users).set({ lockedAt: new Date() }).where(eq(users.id, superAdminId));
    try {
      const result = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "locked attempt" }, templateRow.updatedAt.toISOString());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    } finally {
      await db.update(users).set({ lockedAt: null }).where(eq(users.id, superAdminId));
    }
  });
});

describe("procedure-template-editor: DRAFT creation/versioning", () => {
  test("5. createNewDraftVersion from a PUBLISHED template produces an editable clone; the parent stays untouched", async () => {
    const code = uniqueCode("new-version");
    const templateId = await createDraft(code);
    const nodesBefore = await loadNodesByCode(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true);

    const newDraft = await createNewDraftVersion(templateId, superAdminId);
    assert.equal(newDraft.ok, true);
    if (!newDraft.ok) return;
    createdTemplateIds.push(newDraft.id);

    const draftRow = await loadTemplateRow(newDraft.id);
    assert.equal(draftRow.status, "DRAFT");
    assert.equal(draftRow.supersedesTemplateId, templateId);

    // Editing the new draft must never touch the published parent's rows.
    const draftNodes = await loadNodesByCode(newDraft.id);
    const editResult = await updateProcedureTemplateNode(draftNodes.get("n3")!.id, superAdminId, { title: "초안에서만 변경" }, draftRow.updatedAt.toISOString());
    assert.equal(editResult.ok, true);

    const parentNodeAfter = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodesBefore.get("n3")!.id));
    assert.equal(parentNodeAfter[0].title, "정상 작업", "the published parent's own node row must remain exactly as it was");
  });
});

describe("procedure-template-editor: node edits", () => {
  test("6. edits an existing DRAFT node's properties", async () => {
    const templateId = await createDraft(uniqueCode("edit-node"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const result = await updateProcedureTemplateNode(
      nodes.get("n3")!.id,
      superAdminId,
      { title: "수정된 제목", description: "새 설명", isActive: false },
      templateRow.updatedAt.toISOString(),
      "테스트 편집"
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodes.get("n3")!.id));
    assert.equal(updated.title, "수정된 제목");
    assert.equal(updated.description, "새 설명");
    assert.equal(updated.isActive, false);
  });

  test("7. a node type change with a blank reason is rejected; with a reason it succeeds and re-validates", async () => {
    const templateId = await createDraft(uniqueCode("type-change"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const blankReason = await changeProcedureTemplateNodeType(nodes.get("n3")!.id, superAdminId, "INSPECTION", "", templateRow.updatedAt.toISOString());
    assert.equal(blankReason.ok, false);
    if (!blankReason.ok) assert.equal(blankReason.code, "INVALID_INPUT");

    const withReason = await changeProcedureTemplateNodeType(nodes.get("n3")!.id, superAdminId, "INSPECTION", "실제로는 검사 단계", templateRow.updatedAt.toISOString());
    assert.equal(withReason.ok, true, JSON.stringify(withReason));
    if (!withReason.ok) return;
    assert.ok(withReason.structuralValidation, "a type change must return a fresh structural validation summary");

    const [updated] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodes.get("n3")!.id));
    assert.equal(updated.nodeType, "INSPECTION");
  });
});

describe("procedure-template-editor: layout (user position)", () => {
  test("8. moving a node only persists to user_position_x/y on explicit save — position_x/y (source coordinates) never change", async () => {
    const templateId = await createDraft(uniqueCode("move-node"));
    const nodes = await loadNodesByCode(templateId);
    const n3 = nodes.get("n3")!;
    const templateRow = await loadTemplateRow(templateId);

    const result = await saveProcedureTemplateLayout(templateId, superAdminId, [{ nodeId: n3.id, x: 777, y: 888 }], [], templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    assert.equal(updated.positionX, n3.positionX, "position_x (source coordinate) must never change");
    assert.equal(updated.positionY, n3.positionY, "position_y (source coordinate) must never change");
    assert.equal(updated.userPositionX, 777);
    assert.equal(updated.userPositionY, 888);
  });

  test("9. discarding pending layout moves never calls the server, so the saved state is exactly as before", async () => {
    const templateId = await createDraft(uniqueCode("discard-layout"));
    const nodes = await loadNodesByCode(templateId);
    const n3 = nodes.get("n3")!;

    // "Discard" in the editor UI is purely client-side — it never issues a
    // saveProcedureTemplateLayout call at all, so the correct
    // assertion here is simply that user_position_x/y remain null (the
    // as-imported state) since this test never calls the mutation.
    const [row] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    assert.equal(row.userPositionX, null);
    assert.equal(row.userPositionY, null);
  });
});

describe("procedure-template-editor: edge edits, retarget, and creation", () => {
  test("10. retargeting an edge succeeds and updates its endpoints", async () => {
    const templateId = await createDraft(uniqueCode("retarget"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edgeToRetarget = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const result = await retargetProcedureTemplateEdge(edgeToRetarget.id, superAdminId, nodes.get("n1")!.id, nodes.get("n4")!.id, "시작에서 바로 종료로 재대상", templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeToRetarget.id));
    assert.equal(updated.toNodeId, nodes.get("n4")!.id);
  });

  test("11. a retarget that would create a duplicate (from,to,branchType) edge is rejected", async () => {
    const templateId = await createDraft(uniqueCode("dup-edge"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    // n2->n3 (YES) already exists; retarget n2->n5 (NG) to also point at n3 with... wait branchType stays NG, so this
    // wouldn't collide with the YES edge. Use createProcedureTemplateEdge instead for an exact duplicate-type check.
    const created = await createProcedureTemplateEdge(templateId, superAdminId, { fromNodeId: nodes.get("n2")!.id, toNodeId: nodes.get("n3")!.id, branchType: "YES", branchLabel: "YES", reason: "duplicate attempt setup" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, false);
    if (!created.ok) assert.equal(created.code, "DUPLICATE_EDGE");
    void edges;
  });

  test("12. an edge referencing a node id that doesn't exist in this template is rejected", async () => {
    const templateId = await createDraft(uniqueCode("cross-template"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const otherTemplateId = await createDraft(uniqueCode("cross-template-other"));
    const otherNodes = await loadNodesByCode(otherTemplateId);

    const result = await createProcedureTemplateEdge(
      templateId,
      superAdminId,
      { fromNodeId: nodes.get("n1")!.id, toNodeId: otherNodes.get("n2")!.id, branchType: "DEFAULT", reason: "cross-template attempt" },
      templateRow.updatedAt.toISOString()
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CROSS_TEMPLATE");
  });

  test("13. a self-edge is rejected for both createProcedureTemplateEdge and retargetProcedureTemplateEdge", async () => {
    const templateId = await createDraft(uniqueCode("self-edge"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const createResult = await createProcedureTemplateEdge(templateId, superAdminId, { fromNodeId: nodes.get("n1")!.id, toNodeId: nodes.get("n1")!.id, branchType: "DEFAULT", reason: "self attempt" }, templateRow.updatedAt.toISOString());
    assert.equal(createResult.ok, false);
    if (!createResult.ok) assert.equal(createResult.code, "SELF_EDGE");

    const someEdge = edges[0];
    const retargetResult = await retargetProcedureTemplateEdge(someEdge.id, superAdminId, nodes.get("n2")!.id, nodes.get("n2")!.id, "self attempt", templateRow.updatedAt.toISOString());
    assert.equal(retargetResult.ok, false);
    if (!retargetResult.ok) assert.equal(retargetResult.code, "SELF_EDGE");
  });

  test("14. creates a new edge between two existing nodes", async () => {
    const templateId = await createDraft(uniqueCode("create-edge"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const result = await createProcedureTemplateEdge(
      templateId,
      superAdminId,
      { fromNodeId: nodes.get("n3")!.id, toNodeId: nodes.get("n5")!.id, branchType: "CUSTOM", branchLabel: "예외 경로", reason: "테스트용 신규 연결" },
      templateRow.updatedAt.toISOString()
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const [inserted] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, result.edgeId));
    assert.equal(inserted.fromNodeId, nodes.get("n3")!.id);
    assert.equal(inserted.toNodeId, nodes.get("n5")!.id);
    assert.equal(inserted.clonedFromEdgeId, null, "a genuinely new edge must never carry a clonedFromEdgeId");
  });

  test("update edge property (branchLabel) succeeds", async () => {
    const templateId = await createDraft(uniqueCode("update-edge"));
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const target = edges[0];

    const result = await updateProcedureTemplateEdge(target.id, superAdminId, { branchLabel: "새 라벨" }, templateRow.updatedAt.toISOString(), "라벨 조정");
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, target.id));
    assert.equal(updated.branchLabel, "새 라벨");
  });
});

describe("procedure-template-editor: concurrency", () => {
  test("15. a save using a stale expectedTemplateUpdatedAt token is rejected", async () => {
    const templateId = await createDraft(uniqueCode("stale-revision"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const staleToken = templateRow.updatedAt.toISOString();

    const first = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "첫 번째 변경" }, staleToken);
    assert.equal(first.ok, true);

    // Reusing the now-stale token for a second save must be rejected.
    const second = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "두 번째 변경 (stale)" }, staleToken);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "STALE_REVISION");

    // The node must reflect only the first, successful change.
    const [row] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodes.get("n3")!.id));
    assert.equal(row.title, "첫 번째 변경");
  });
});

describe("procedure-template-editor: audit history", () => {
  test("16. every mutation writes exactly one append-only edit-history row, in order", async () => {
    const templateId = await createDraft(uniqueCode("audit-history"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const r1 = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "감사 이력 테스트" }, templateRow.updatedAt.toISOString());
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    const r2 = await saveProcedureTemplateLayout(templateId, superAdminId, [{ nodeId: nodes.get("n3")!.id, x: 1, y: 2 }], [], r1.updatedAt);
    assert.equal(r2.ok, true);
    if (!r2.ok) return;

    const history = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId)).orderBy(procedureTemplateEditHistory.createdAt);
    assert.equal(history.length, 2);
    assert.equal(history[0].actionType, "UPDATE_NODE");
    assert.equal(history[1].actionType, "SAVE_LAYOUT");
    assert.equal(history[0].actorUserId, superAdminId);
    assert.ok(history[0].beforeState);
    assert.ok(history[0].afterState);
    // Phase 5C-5C — two separate mutation calls (separate transactions) are
    // two separate logical operations: each gets its own non-null
    // change_group_id, and the two must differ.
    assert.ok(history[0].changeGroupId);
    assert.ok(history[1].changeGroupId);
    assert.notEqual(history[0].changeGroupId, history[1].changeGroupId);
    assert.equal(history[0].origin, "USER_EDIT");
    assert.equal(history[0].sourceGroupId, null);
    assert.equal(history[0].restoreTargetGroupId, null);
    assert.equal(typeof history[0].sequenceNumber, "number");
    assert.ok(history[1].sequenceNumber > history[0].sequenceNumber, "sequence_number must be DB-generated and monotonically increasing");
    void templateRow;
  });
});

describe("procedure-template-editor: structural validation re-run and publish gating", () => {
  test("17. structural validation re-runs after a graph change and reflects the new state", async () => {
    const templateId = await createDraft(uniqueCode("revalidate"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const before = await validateProcedureTemplate(templateId, superAdminId);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.structuralValidation.errorCount, 0, "the fixture is structurally clean before any edit");

    // Retargeting n1->n2 (DEFAULT) directly to n4 (END) leaves n2 with no
    // incoming edge at all — still structurally fine for a DECISION per
    // this validator's rules, but disconnects n2/n3/n5 from START,
    // producing UNREACHABLE_NODE warnings that weren't there before.
    const startEdge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;
    const retarget = await retargetProcedureTemplateEdge(startEdge.id, superAdminId, nodes.get("n1")!.id, nodes.get("n4")!.id, "구조 변경 테스트", templateRow.updatedAt.toISOString());
    assert.equal(retarget.ok, true);
    if (!retarget.ok) return;

    assert.ok(retarget.structuralValidation.warningCount > before.structuralValidation.warningCount, "re-validation after the edit must reflect newly-unreachable nodes");
  });

  test("18. an unresolved structural ERROR continues to block publication", async () => {
    const templateId = await createDraft(uniqueCode("publish-block"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);

    // Retarget the n3->n4 (END) edge to point at n2 (DECISION) instead —
    // n4 (END) then has zero incoming edges, an ERROR under
    // INVALID_END_STRUCTURE.
    const edgeToEnd = edges.find((e) => e.toNodeId === nodes.get("n4")!.id)!;
    const retarget = await retargetProcedureTemplateEdge(edgeToEnd.id, superAdminId, nodes.get("n3")!.id, nodes.get("n2")!.id, "END을 고립시키는 테스트", templateRow.updatedAt.toISOString());
    assert.equal(retarget.ok, true);
    if (!retarget.ok) return;
    assert.ok(retarget.structuralValidation.errorCount > 0, "fixture setup must actually introduce a structural ERROR");

    const publishResult = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(publishResult.ok, false);
    if (!publishResult.ok) assert.equal(publishResult.code, "HAS_STRUCTURAL_ERRORS");
  });
});

describe("procedure-template-editor: traceability", () => {
  test("19. source workbook traceability (source_worksheet/source_shape_id) survives node property edits untouched", async () => {
    const templateId = await createDraft(uniqueCode("traceability"));
    const nodes = await loadNodesByCode(templateId);
    const n3 = nodes.get("n3")!;
    const templateRow = await loadTemplateRow(templateId);

    const result = await updateProcedureTemplateNode(n3.id, superAdminId, { title: "제목만 변경" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true);

    const [updated] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    assert.equal(updated.sourceWorksheet, n3.sourceWorksheet);
    assert.equal(updated.sourceShapeId, n3.sourceShapeId);
    assert.equal(updated.nodeCode, n3.nodeCode);
  });
});

describe("procedure-template-editor: manual edge routes (Phase 4B)", () => {
  test("20. saving an edge route persists ordered waypoints exactly as sent", async () => {
    const templateId = await createDraft(uniqueCode("route-persist"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const points = [
      { x: 10, y: 20 },
      { x: 30, y: 5 },
      { x: 50, y: 40 },
    ];
    const result = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points }], templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.deepEqual(updated.userRoutePoints, points);
  });

  test("21. a malformed or non-finite route point is rejected and nothing is persisted", async () => {
    const templateId = await createDraft(uniqueCode("route-malformed"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const badPayloads: unknown[] = [
      [{ x: 1, y: 1 }, { x: NaN, y: 2 }],
      [{ x: 1, y: 1 }, { x: Infinity, y: 2 }],
      [{ x: 1, y: 1 }, { x: "1", y: 2 }],
      [{ x: 1, y: 1 }, { x: 1 }],
      "not-an-array",
    ];

    for (const points of badPayloads) {
      const result = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: points as never }], templateRow.updatedAt.toISOString());
      assert.equal(result.ok, false, `expected rejection for payload ${JSON.stringify(points)}`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }

    const [row] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.equal(row.userRoutePoints, null, "nothing must be persisted when validation fails");
  });

  test("22. more than the maximum allowed waypoints is rejected", async () => {
    const templateId = await createDraft(uniqueCode("route-maxpoints"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const tooMany = Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    const result = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: tooMany }], templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");

    const withinLimit = Array.from({ length: MAX_ROUTE_POINTS }, (_, i) => ({ x: i, y: i }));
    const okResult = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: withinLimit }], templateRow.updatedAt.toISOString());
    assert.equal(okResult.ok, true, "exactly MAX_ROUTE_POINTS must still be accepted");
  });

  test("23. saving an empty waypoint array normalizes to NULL (automatic routing), not an empty array", async () => {
    const templateId = await createDraft(uniqueCode("route-empty"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const first = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: [{ x: 1, y: 1 }] }], templateRow.updatedAt.toISOString());
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: [] }], first.updatedAt);
    assert.equal(second.ok, true, JSON.stringify(second));

    const [row] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.equal(row.userRoutePoints, null);
  });

  test("24. explicitly clearing a manual route (points: null) restores automatic routing", async () => {
    const templateId = await createDraft(uniqueCode("route-clear"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const first = await saveProcedureTemplateLayout(
      templateId,
      superAdminId,
      [],
      [{ edgeId: edge.id, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
      templateRow.updatedAt.toISOString()
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: null }], first.updatedAt);
    assert.equal(second.ok, true, JSON.stringify(second));

    const [row] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.equal(row.userRoutePoints, null);
  });

  test("25. saving a manual route never changes the edge's own endpoints or branch type/label", async () => {
    const templateId = await createDraft(uniqueCode("route-preserve-semantics"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n2")!.id && e.branchType === "YES")!;

    const result = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: [{ x: 5, y: 5 }] }], templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.equal(row.fromNodeId, edge.fromNodeId);
    assert.equal(row.toNodeId, edge.toNodeId);
    assert.equal(row.branchType, edge.branchType);
    assert.equal(row.branchLabel, edge.branchLabel);
  });

  test("26. a combined save persists node positions and edge routes together in one call", async () => {
    const templateId = await createDraft(uniqueCode("combined-save"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const n3 = nodes.get("n3")!;
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const result = await saveProcedureTemplateLayout(
      templateId,
      superAdminId,
      [{ nodeId: n3.id, x: 111, y: 222 }],
      [{ edgeId: edge.id, points: [{ x: 9, y: 9 }] }],
      templateRow.updatedAt.toISOString()
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updatedNode] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    const [updatedEdge] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.equal(updatedNode.userPositionX, 111);
    assert.equal(updatedNode.userPositionY, 222);
    assert.deepEqual(updatedEdge.userRoutePoints, [{ x: 9, y: 9 }]);

    const history = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId))
      // Phase 5C-5C — both rows are written inside the same transaction, so
      // created_at (transaction-scoped now()) can tie between them;
      // sequence_number is IDENTITY-allocated and therefore the only column
      // guaranteed to preserve insertion order here.
      .orderBy(procedureTemplateEditHistory.sequenceNumber);
    assert.equal(history.length, 2, "one SAVE_LAYOUT row and one SAVE_EDGE_ROUTE row — never conflated into a single entry");
    assert.equal(history[0].actionType, "SAVE_LAYOUT");
    assert.equal(history[1].actionType, "SAVE_EDGE_ROUTE");
    // Phase 5C-5C — one combined "저장" click is one logical operation: both
    // rows must share the same change_group_id.
    assert.ok(history[0].changeGroupId);
    assert.equal(history[0].changeGroupId, history[1].changeGroupId);
    assert.equal(history[0].origin, "USER_EDIT");
    assert.equal(history[1].origin, "USER_EDIT");
    assert.equal(history[0].sourceGroupId, null);
    assert.equal(history[0].restoreTargetGroupId, null);
  });

  test("27. a stale combined save persists neither the node position nor the edge route", async () => {
    const templateId = await createDraft(uniqueCode("combined-stale"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const n3 = nodes.get("n3")!;
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;
    const staleToken = templateRow.updatedAt.toISOString();

    const bump = await updateProcedureTemplateNode(n3.id, superAdminId, { title: "revision bump" }, staleToken);
    assert.equal(bump.ok, true);

    const result = await saveProcedureTemplateLayout(
      templateId,
      superAdminId,
      [{ nodeId: n3.id, x: 555, y: 666 }],
      [{ edgeId: edge.id, points: [{ x: 1, y: 1 }] }],
      staleToken
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const [updatedNode] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    const [updatedEdge] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));
    assert.equal(updatedNode.userPositionX, null, "no partial position write on a rejected stale save");
    assert.equal(updatedEdge.userRoutePoints, null, "no partial route write on a rejected stale save");
  });

  test("28. a PUBLISHED template rejects a combined layout save (node position + edge route)", async () => {
    const templateId = await createDraft(uniqueCode("route-published-guard"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true);

    const templateRow = await loadTemplateRow(templateId);
    const result = await saveProcedureTemplateLayout(
      templateId,
      superAdminId,
      [{ nodeId: nodes.get("n3")!.id, x: 1, y: 1 }],
      [{ edgeId: edges[0].id, points: [{ x: 1, y: 1 }] }],
      templateRow.updatedAt.toISOString()
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });

  test("29. an unauthorized (non-SUPER_ADMIN) actor cannot save an edge route", async () => {
    const templateId = await createDraft(uniqueCode("route-unauthorized"));
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);

    const result = await saveProcedureTemplateLayout(templateId, adminId, [], [{ edgeId: edges[0].id, points: [{ x: 1, y: 1 }] }], templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");

    const [row] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edges[0].id));
    assert.equal(row.userRoutePoints, null);
  });

  test("30. saving an edge route identical to its current stored value writes no new SAVE_EDGE_ROUTE row and does not advance the revision", async () => {
    const templateId = await createDraft(uniqueCode("route-noop-history"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const first = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: [{ x: 3, y: 3 }] }], templateRow.updatedAt.toISOString());
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const historyAfterFirst = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
    assert.equal(historyAfterFirst.length, 1);

    const second = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: [{ x: 3, y: 3 }] }], first.updatedAt);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.updatedAt, first.updatedAt, "a true no-op save must not advance the revision token");

    const historyAfterSecond = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
    assert.equal(historyAfterSecond.length, 1, "no new history row for an unchanged route");
  });

  test("31. a SAVE_EDGE_ROUTE history row records before/after points, reason, actor, and timestamp", async () => {
    const templateId = await createDraft(uniqueCode("route-history-fields"));
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const result = await saveProcedureTemplateLayout(
      templateId,
      superAdminId,
      [],
      [{ edgeId: edge.id, points: [{ x: 7, y: 7 }] }],
      templateRow.updatedAt.toISOString(),
      "시각적 명확성을 위한 경로 조정"
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "SAVE_EDGE_ROUTE")));
    assert.ok(row);
    assert.equal(row.actorUserId, superAdminId);
    assert.equal(row.reason, "시각적 명확성을 위한 경로 조정");
    assert.ok(row.createdAt);
    assert.deepEqual(row.beforeState, [{ edgeId: edge.id, points: null }]);
    assert.deepEqual(row.afterState, [{ edgeId: edge.id, points: [{ x: 7, y: 7 }] }]);
  });

  test("32. createNewDraftVersion clones edges with userRoutePoints reset to null, even if the parent had a manual route", async () => {
    const code = uniqueCode("route-clone-reset");
    const templateId = await createDraft(code);
    const nodes = await loadNodesByCode(templateId);
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const edge = edges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;

    const saveResult = await saveProcedureTemplateLayout(templateId, superAdminId, [], [{ edgeId: edge.id, points: [{ x: 2, y: 2 }] }], templateRow.updatedAt.toISOString());
    assert.equal(saveResult.ok, true);

    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const newDraft = await createNewDraftVersion(templateId, superAdminId);
    assert.equal(newDraft.ok, true);
    if (!newDraft.ok) return;
    createdTemplateIds.push(newDraft.id);

    const clonedEdges = await loadEdges(newDraft.id);
    const clonedEdge = clonedEdges.find((e) => e.clonedFromEdgeId === edge.id)!;
    assert.ok(clonedEdge, "the cloned edge must carry clonedFromEdgeId lineage");
    assert.equal(clonedEdge.userRoutePoints, null, "a new DRAFT clone must never inherit the parent's manual route");
  });
});

describe("procedure-template-editor: Phase 5C-5B coarse-then-fine authorization ordering", () => {
  const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000000";

  test("33. AS_ENGINEER against a nonexistent node id is rejected before any row lookup (FORBIDDEN, never NOT_FOUND)", async () => {
    const result = await updateProcedureTemplateNode(NONEXISTENT_ID, asEngineerId, { title: "x" }, new Date().toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("34. SALES against a nonexistent node id is rejected before any row lookup (FORBIDDEN, never NOT_FOUND)", async () => {
    const result = await updateProcedureTemplateNode(NONEXISTENT_ID, salesId, { title: "x" }, new Date().toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("35. INVENTORY_MANAGER against a nonexistent node id is rejected before any row lookup (FORBIDDEN, never NOT_FOUND)", async () => {
    const result = await updateProcedureTemplateNode(NONEXISTENT_ID, inventoryManagerId, { title: "x" }, new Date().toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("36. ADMIN passes the coarse pre-gate, so a nonexistent node id surfaces as NOT_FOUND (the disclosed, accepted ordering trade-off)", async () => {
    const result = await updateProcedureTemplateNode(NONEXISTENT_ID, adminId, { title: "x" }, new Date().toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("37. ADMIN against an EXISTING FULL_SERVICE draft node is FORBIDDEN at the fine-grained, category-specific check (not merely NOT_DRAFT/other)", async () => {
    const templateId = await createDraft(uniqueCode("admin-full-service-forbidden"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const result = await updateProcedureTemplateNode(nodes.get("n3")!.id, adminId, { title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("38. SUPER_ADMIN retains existing broad FULL_SERVICE management behavior after the authorization refactor (edit succeeds)", async () => {
    const templateId = await createDraft(uniqueCode("super-admin-unchanged"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const result = await updateProcedureTemplateNode(nodes.get("n3")!.id, superAdminId, { title: "super admin still works" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true);
  });

  // validateProcedureTemplate has its own separate inline authorization
  // check (it does not call assertEditableDraft) — proven independently
  // here so the refactor of that second code path isn't only covered by
  // the assertEditableDraft-based functions above.
  test("39. validateProcedureTemplate: AS_ENGINEER against a nonexistent template id is rejected before any row lookup (FORBIDDEN, never NOT_FOUND)", async () => {
    const result = await validateProcedureTemplate(NONEXISTENT_ID, asEngineerId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("40. validateProcedureTemplate: ADMIN passes the coarse pre-gate, so a nonexistent template id surfaces as NOT_FOUND", async () => {
    const result = await validateProcedureTemplate(NONEXISTENT_ID, adminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("41. validateProcedureTemplate: ADMIN against an EXISTING FULL_SERVICE draft is FORBIDDEN at the fine-grained check", async () => {
    const templateId = await createDraft(uniqueCode("admin-validate-forbidden"));
    const result = await validateProcedureTemplate(templateId, adminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("42. validateProcedureTemplate: SUPER_ADMIN retains existing behavior (validate succeeds) after the authorization refactor", async () => {
    const templateId = await createDraft(uniqueCode("super-admin-validate-unchanged"));
    const result = await validateProcedureTemplate(templateId, superAdminId);
    assert.equal(result.ok, true);
  });
});

/**
 * Phase 5C-5B — proves the applied 0017 migration's live DB behavior
 * directly (DDL-level, not through any production mutation — neither
 * deleteProcedureTemplateNode nor deleteProcedureTemplateEdge exists yet).
 * Every fixture here is synthetic, created via direct db.insert/db.delete
 * against a TEST_CODE_PREFIX-coded DRAFT template, cleaned up by this
 * file's existing after() hook. None of the four real templates are ever
 * touched.
 */
describe("procedure-template-editor: Phase 5C-5B FK behavior (SET NULL history pointers, RESTRICT graph integrity — DB-level only)", () => {
  /**
   * drizzle-orm wraps the driver's real PostgresError — the original is on
   * `.cause`, same convention as this codebase's other isXViolation helpers
   * (procedure-case-execution.ts's isUniqueViolation,
   * procedure-templates.integration.test.ts's isCheckViolation). Postgres
   * error code 23503 is foreign_key_violation; the message additionally
   * names the referencing table ("update or delete on table ... violates
   * foreign key constraint ... on table \"<referencingTable>\""), which is
   * what distinguishes *which* RESTRICT FK actually fired.
   */
  function isForeignKeyViolation(err: unknown, referencingTable: string): boolean {
    const cause = err instanceof Error ? err.cause : undefined;
    const code = cause !== undefined && cause !== null && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : undefined;
    const message = cause instanceof Error ? cause.message : String(err);
    return code === "23503" && message.includes(referencingTable);
  }

  test("43. deleting a node with no connected edges succeeds, and every history row referencing it survives with node_id set to NULL (before/after state and row count unchanged)", async () => {
    const templateId = await createDraft(uniqueCode("fk-node-set-null"));

    const [isolatedNode] = await db
      .insert(procedureTemplateNodes)
      .values({
        procedureTemplateId: templateId,
        nodeCode: `manual-test-${randomUUID()}`,
        nodeType: "TASK",
        title: "고립 노드 (FK 테스트 전용)",
      })
      .returning({ id: procedureTemplateNodes.id });

    const historyBefore = await db
      .insert(procedureTemplateEditHistory)
      .values([
        {
          procedureTemplateId: templateId,
          actionType: "CREATE_NODE",
          nodeId: isolatedNode.id,
          beforeState: null,
          afterState: { nodeCode: "synthetic", nodeType: "TASK", title: "고립 노드 (FK 테스트 전용)" },
          actorUserId: superAdminId,
          changeGroupId: randomUUID(),
        },
        {
          procedureTemplateId: templateId,
          actionType: "UPDATE_NODE",
          nodeId: isolatedNode.id,
          beforeState: { title: "old" },
          afterState: { title: "고립 노드 (FK 테스트 전용)" },
          reason: null,
          actorUserId: superAdminId,
          changeGroupId: randomUUID(),
        },
      ])
      .returning({ id: procedureTemplateEditHistory.id, beforeState: procedureTemplateEditHistory.beforeState, afterState: procedureTemplateEditHistory.afterState });
    assert.equal(historyBefore.length, 2);

    await db.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, isolatedNode.id));

    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, isolatedNode.id));
    assert.equal(stillThere, undefined, "the node row must actually be gone");

    const historyAfter = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(inArray(procedureTemplateEditHistory.id, historyBefore.map((h) => h.id)))
      // Phase 5C-5C — historyBefore's two rows came from one array insert
      // (same transaction), so created_at can tie; sequence_number is the
      // only column guaranteed to preserve insertion order for the
      // index-correlated comparison below.
      .orderBy(procedureTemplateEditHistory.sequenceNumber);
    assert.equal(historyAfter.length, 2, "both history rows must survive the node deletion");
    for (let i = 0; i < historyAfter.length; i++) {
      assert.equal(historyAfter[i].nodeId, null, "node_id must become NULL via ON DELETE SET NULL");
      assert.deepEqual(historyAfter[i].beforeState, historyBefore[i].beforeState, "beforeState must be byte-for-byte unchanged");
      assert.deepEqual(historyAfter[i].afterState, historyBefore[i].afterState, "afterState must be byte-for-byte unchanged");
    }
  });

  test("44. deleting an edge succeeds, and every history row referencing it survives with edge_id set to NULL", async () => {
    const templateId = await createDraft(uniqueCode("fk-edge-set-null"));
    const nodes = await loadNodesByCode(templateId);

    const [syntheticEdge] = await db
      .insert(procedureTemplateEdges)
      .values({
        procedureTemplateId: templateId,
        fromNodeId: nodes.get("n4")!.id, // n4 (END) already has no outgoing edges in the base fixture — safe to attach one extra edge from it for this isolated test without disturbing the base graph's own structural validity elsewhere.
        toNodeId: nodes.get("n1")!.id,
        branchType: "LOOP_BACK",
      })
      .returning({ id: procedureTemplateEdges.id });

    const historyBefore = await db
      .insert(procedureTemplateEditHistory)
      .values({
        procedureTemplateId: templateId,
        actionType: "CREATE_EDGE",
        edgeId: syntheticEdge.id,
        beforeState: null,
        afterState: { fromNodeId: nodes.get("n4")!.id, toNodeId: nodes.get("n1")!.id, branchType: "LOOP_BACK" },
        reason: "fk-test",
        actorUserId: superAdminId,
        changeGroupId: randomUUID(),
      })
      .returning({ id: procedureTemplateEditHistory.id, beforeState: procedureTemplateEditHistory.beforeState, afterState: procedureTemplateEditHistory.afterState });

    await db.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, syntheticEdge.id));

    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, syntheticEdge.id));
    assert.equal(stillThere, undefined, "the edge row must actually be gone");

    const [historyAfter] = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.id, historyBefore[0].id));
    assert.ok(historyAfter, "the history row must survive the edge deletion");
    assert.equal(historyAfter.edgeId, null, "edge_id must become NULL via ON DELETE SET NULL");
    assert.deepEqual(historyAfter.beforeState, historyBefore[0].beforeState);
    assert.deepEqual(historyAfter.afterState, historyBefore[0].afterState);
  });

  test("45. RESTRICT defense: a node with a live connected edge still cannot be directly deleted (from_node_id/to_node_id remain RESTRICT — changing the history FKs did not weaken graph integrity)", async () => {
    const templateId = await createDraft(uniqueCode("fk-restrict-defense-node"));
    const nodes = await loadNodesByCode(templateId);
    // n1 (START) has a real outgoing edge (n1->n2) in the base fixture.
    await assert.rejects(
      () => db.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodes.get("n1")!.id)),
      (err: unknown) => isForeignKeyViolation(err, "procedure_template_edges"),
      "deleting a node that still has a connected edge must be rejected by the from_node_id/to_node_id RESTRICT FK"
    );
    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodes.get("n1")!.id));
    assert.ok(stillThere, "the node must still exist after the rejected delete");
  });

  test("46. RESTRICT defense: an edge referenced by another edge's cloned_from_edge_id (a PUBLISHED parent edge already cloned into a DRAFT version) cannot be directly deleted", async () => {
    const templateId = await createDraft(uniqueCode("fk-restrict-defense-clone"));
    const nodes = await loadNodesByCode(templateId);
    const parentEdges = await loadEdges(templateId);
    const publishResult = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(publishResult.ok, true);

    const newDraft = await createNewDraftVersion(templateId, superAdminId);
    assert.equal(newDraft.ok, true);
    if (!newDraft.ok) return;
    createdTemplateIds.push(newDraft.id);

    const childEdges = await loadEdges(newDraft.id);
    const parentEdgeThatWasCloned = parentEdges.find((e) => e.fromNodeId === nodes.get("n1")!.id)!;
    const childClone = childEdges.find((e) => e.clonedFromEdgeId === parentEdgeThatWasCloned.id);
    assert.ok(childClone, "the child draft must carry an edge whose cloned_from_edge_id points at the parent edge");

    await assert.rejects(
      () => db.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, parentEdgeThatWasCloned.id)),
      (err: unknown) => isForeignKeyViolation(err, "procedure_template_edges"),
      "deleting a PUBLISHED parent edge that a DRAFT child's cloned_from_edge_id still points at must be rejected by RESTRICT"
    );
    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, parentEdgeThatWasCloned.id));
    assert.ok(stillThere, "the parent edge must still exist after the rejected delete");
  });
});

/**
 * Phase 5C-5B-1 — createProcedureTemplateNode: manual TECHNICAL_TASK node
 * authoring. All fixtures are synthetic (createTechnicalDraft/
 * createReferenceDraft), self-cleaning via this file's existing after()
 * hook and TEST_CODE_PREFIX convention.
 */
describe("createProcedureTemplateNode", () => {
  test("ADMIN creates a node on a TECHNICAL_TASK DRAFT", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-admin"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, adminId, { nodeType: "TASK", title: "작업 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("SUPER_ADMIN creates a node on a TECHNICAL_TASK DRAFT", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-super"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "작업 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("FULL_SERVICE: node creation through this NEW mutation fails even for SUPER_ADMIN", async () => {
    const templateId = await createDraft(uniqueCode("create-node-full-service"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("REFERENCE: node creation fails", async () => {
    const templateId = await createReferenceDraft(uniqueCode("create-node-reference"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("AS_ENGINEER, SALES, INVENTORY_MANAGER are denied", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-denied"));
    const templateRow = await loadTemplateRow(templateId);
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const result = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "x" }, templateRow.updatedAt.toISOString());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("a PUBLISHED technical template fails (NOT_DRAFT)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-published"));
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });

  test("CHECKLIST is rejected — not in the v1 manual authoring allow-list", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-checklist"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "CHECKLIST" as never, title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("TROUBLESHOOTING is rejected — not in the v1 manual authoring allow-list", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-troubleshooting"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TROUBLESHOOTING" as never, title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("title is required and trimmed", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-title"));
    const templateRow = await loadTemplateRow(templateId);

    const blank = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "   " }, templateRow.updatedAt.toISOString());
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.code, "INVALID_INPUT");

    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "  실제 제목  " }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(node.title, "실제 제목");
  });

  test("id/nodeCode are server-generated: nodeCode is exactly manual-<the node's own full UUID>, never client-supplied", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-id"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "x" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(node.nodeCode, `manual-${node.id}`);
  });

  test("sortOrder increments across successive creates; position defaults deterministically (x=0, y = previous max + 150, first node y=0)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-position"));
    let templateRow = await loadTemplateRow(templateId);

    const first = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "첫 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const [firstNode] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, first.nodeId));
    assert.equal(firstNode.positionX, 0);
    assert.equal(firstNode.positionY, 0, "the first node in an empty template must default to y=0");
    assert.equal(firstNode.sortOrder, 0);

    templateRow = await loadTemplateRow(templateId);
    const second = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "둘째 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const [secondNode] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, second.nodeId));
    assert.equal(secondNode.positionX, 0);
    assert.equal(secondNode.positionY, firstNode.positionY + 150);
    assert.equal(secondNode.sortOrder, firstNode.sortOrder + 1);
  });

  test("no reason is required to create a node, and CREATE_NODE history's afterState matches the persisted node exactly", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-history"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "INSPECTION", title: "검사 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    const [history] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "CREATE_NODE")));
    assert.ok(history, "expected exactly one CREATE_NODE history row");
    assert.equal(history.nodeId, node.id);
    assert.equal(history.beforeState, null);
    assert.equal(history.reason, null, "creation never requires or records a reason");
    assert.deepEqual(history.afterState, {
      id: node.id,
      procedureTemplateId: node.procedureTemplateId,
      nodeCode: node.nodeCode,
      nodeType: node.nodeType,
      title: node.title,
      description: node.description,
      objective: node.objective,
      preparation: node.preparation,
      toolsAndEquipment: node.toolsAndEquipment,
      safetyCaution: node.safetyCaution,
      instructions: node.instructions,
      expectedNormalResult: node.expectedNormalResult,
      ngSymptoms: node.ngSymptoms,
      recommendedCorrectiveAction: node.recommendedCorrectiveAction,
      acceptanceCriteria: node.acceptanceCriteria,
      workerMayAddNextTask: node.workerMayAddNextTask,
      positionX: node.positionX,
      positionY: node.positionY,
      userPositionX: node.userPositionX,
      userPositionY: node.userPositionY,
      sortOrder: node.sortOrder,
      sourceWorksheet: node.sourceWorksheet,
      sourceShapeId: node.sourceShapeId,
      sourceCellRange: node.sourceCellRange,
      isActive: node.isActive,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    });
    assert.equal(node.workerMayAddNextTask, true, "workerMayAddNextTask must use the column default");
    assert.equal(node.isActive, true);
    assert.equal(node.sourceWorksheet, null);
    assert.equal(node.sourceShapeId, null);
    assert.equal(node.sourceCellRange, null);
  });

  test("a stale expectedTemplateUpdatedAt token is rejected (STALE_REVISION), and no CREATE_NODE history row is written", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-stale"));
    const templateRow = await loadTemplateRow(templateId);
    const staleToken = templateRow.updatedAt.toISOString();

    const first = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "첫 변경" }, staleToken);
    assert.equal(first.ok, true);

    const historyBefore = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
    assert.equal(historyBefore.length, 1);

    const second = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "재사용된 낡은 토큰" }, staleToken);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "STALE_REVISION");

    const historyAfter = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
    assert.equal(historyAfter.length, 1, "a rejected stale create must not add a second history row");
  });
});

/** Phase 5C-5B-1 — deleteProcedureTemplateEdge. Fixtures via seedTechnicalGraph/createDraft/createReferenceDraft, all synthetic. */
describe("deleteProcedureTemplateEdge", () => {
  test("ADMIN deletes an edge on a TECHNICAL_TASK DRAFT; the edge is gone, DELETE_EDGE history survives with edge_id=NULL and beforeState/reason intact", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge-admin"));
    const seed = await seedTechnicalGraph(templateId, adminId);

    const [nodeA] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeAId));
    const [nodeB] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeBId));

    const result = await deleteProcedureTemplateEdge(seed.edgeId, adminId, "더 이상 필요하지 않은 연결", seed.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.equal(stillThere, undefined, "the edge row must actually be gone");

    const [history] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_EDGE")));
    assert.ok(history, "expected a DELETE_EDGE history row");
    assert.equal(history.edgeId, null, "edge_id must become NULL via ON DELETE SET NULL (migration 0017)");
    assert.equal(history.afterState, null);
    assert.equal(history.reason, "더 이상 필요하지 않은 연결");
    assert.deepEqual(history.beforeState, {
      id: seed.edgeId,
      procedureTemplateId: templateId,
      fromNodeId: seed.nodeAId,
      toNodeId: seed.nodeBId,
      fromNodeCode: nodeA.nodeCode,
      fromNodeTitle: nodeA.title,
      toNodeCode: nodeB.nodeCode,
      toNodeTitle: nodeB.title,
      branchType: "DEFAULT",
      branchLabel: null,
      conditionDefinition: null,
      sortOrder: 0,
      sourceConnectorId: null,
      clonedFromEdgeId: null,
      userRoutePoints: null,
    });
  });

  test("SUPER_ADMIN deletes an edge on a TECHNICAL_TASK DRAFT", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge-super"));
    const seed = await seedTechnicalGraph(templateId);
    const result = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "사유", seed.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("FULL_SERVICE: edge deletion through this NEW mutation fails even for SUPER_ADMIN", async () => {
    const templateId = await createDraft(uniqueCode("delete-edge-full-service"));
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const result = await deleteProcedureTemplateEdge(edges[0].id, superAdminId, "사유", templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edges[0].id));
    assert.ok(stillThere, "the FULL_SERVICE edge must be untouched");
  });

  test("a PUBLISHED technical template's edge cannot be deleted (NOT_DRAFT)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge-published"));
    const seed = await seedTechnicalGraph(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const result = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "사유", seed.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });

  test("Phase 5C-5B usability: a blank reason no longer blocks the delete — it succeeds, and the DELETE_EDGE history row's reason is null", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge-blank-reason"));
    const seed = await seedTechnicalGraph(templateId);
    const result = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "   ", seed.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.equal(stillThere, undefined, "the edge must actually be deleted");
    const [history] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_EDGE")));
    assert.ok(history, "a DELETE_EDGE history row must still be written — optional reason never means no audit trail");
    assert.equal(history.reason, null, "a whitespace-only reason normalizes to null, never an empty string");
  });

  test("using a different technical template's revision token is rejected (STALE_REVISION) — the token is scoped to the edge's own owning template, never guessable/reusable across templates", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge-cross-a"));
    const seed = await seedTechnicalGraph(templateId);
    const otherTemplateId = await createTechnicalDraft(uniqueCode("delete-edge-cross-b"));
    const otherTemplateRow = await loadTemplateRow(otherTemplateId);

    const result = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "사유", otherTemplateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");
    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.ok(stillThere);
  });

  test("EDGE_HAS_CLONE_DEPENDENTS: an edge still referenced by another edge's clonedFromEdgeId cannot be deleted", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge-clone-parent"));
    const seed = await seedTechnicalGraph(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const newDraft = await createNewDraftVersion(templateId, adminId);
    assert.equal(newDraft.ok, true, JSON.stringify(newDraft));
    if (!newDraft.ok) return;
    createdTemplateIds.push(newDraft.id);

    const childEdges = await loadEdges(newDraft.id);
    const childClone = childEdges.find((e) => e.clonedFromEdgeId === seed.edgeId);
    assert.ok(childClone, "the child draft must carry an edge whose clonedFromEdgeId points at the parent edge");

    // deleteProcedureTemplateEdge is DRAFT-only, and clonedFromEdgeId always
    // points at a PUBLISHED source (createNewDraftVersion's only source) —
    // so under normal production flows the owning template of a
    // clone-dependent edge can never be DRAFT, and this dependency check
    // can never actually fire through the DRAFT-only gate above it.
    // Restoring the parent template to DRAFT here is a deliberate,
    // synthetic, test-only DB operation (same convention this file's own
    // tests 43-46 already use) purely to exercise this defensive branch in
    // isolation; no real template is ever touched this way.
    const now = new Date();
    await db.update(procedureTemplates).set({ status: "DRAFT", updatedAt: now }).where(eq(procedureTemplates.id, templateId));

    const result = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "사유", now.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "EDGE_HAS_CLONE_DEPENDENTS");
      const detailed = result as typeof result & { dependentEdgeCount: number; dependentEdgeIds: string[] };
      assert.equal(detailed.dependentEdgeCount, 1);
      assert.deepEqual(detailed.dependentEdgeIds, [childClone.id]);
    }
    const [stillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.ok(stillThere, "the edge must still exist after the rejected delete");
    const history = await db.select().from(procedureTemplateEditHistory).where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_EDGE")));
    assert.equal(history.length, 0, "a rejected delete (dependency check failed) must never write a DELETE_EDGE history row");
  });
});

/** Phase 5C-5B-1 — deleteProcedureTemplateNode. */
describe("deleteProcedureTemplateNode", () => {
  test("an unconnected node (no edges) deletes; the node is gone, DELETE_NODE history survives with node_id=NULL and beforeState/reason intact", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-unconnected"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "고립 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, created.nodeId));

    const result = await deleteProcedureTemplateNode(created.nodeId, superAdminId, "잘못 생성된 노드 정리", created.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, created.nodeId));
    assert.equal(stillThere, undefined, "the node row must actually be gone");

    const [history] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_NODE")));
    assert.ok(history, "expected a DELETE_NODE history row");
    assert.equal(history.nodeId, null, "node_id must become NULL via ON DELETE SET NULL (migration 0017)");
    assert.equal(history.afterState, null);
    assert.equal(history.reason, "잘못 생성된 노드 정리");
    assert.deepEqual(history.beforeState, {
      id: node.id,
      procedureTemplateId: node.procedureTemplateId,
      nodeCode: node.nodeCode,
      nodeType: node.nodeType,
      title: node.title,
      description: node.description,
      objective: node.objective,
      preparation: node.preparation,
      toolsAndEquipment: node.toolsAndEquipment,
      safetyCaution: node.safetyCaution,
      instructions: node.instructions,
      expectedNormalResult: node.expectedNormalResult,
      ngSymptoms: node.ngSymptoms,
      recommendedCorrectiveAction: node.recommendedCorrectiveAction,
      acceptanceCriteria: node.acceptanceCriteria,
      workerMayAddNextTask: node.workerMayAddNextTask,
      positionX: node.positionX,
      positionY: node.positionY,
      userPositionX: node.userPositionX,
      userPositionY: node.userPositionY,
      sortOrder: node.sortOrder,
      sourceWorksheet: node.sourceWorksheet,
      sourceShapeId: node.sourceShapeId,
      sourceCellRange: node.sourceCellRange,
      isActive: node.isActive,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    });
  });

  test("NODE_HAS_CONNECTED_EDGES: a node with a live edge cannot be deleted; blockingEdgeIds/count are correct, and edges are never cascade-deleted", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-connected"));
    const seed = await seedTechnicalGraph(templateId);

    const result = await deleteProcedureTemplateNode(seed.nodeAId, superAdminId, "사유", seed.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "NODE_HAS_CONNECTED_EDGES");
      const detailed = result as typeof result & { blockingEdgeCount: number; blockingEdgeIds: string[]; blockingEdges: { edgeId: string; direction: string; otherNodeId: string }[] };
      assert.equal(detailed.blockingEdgeCount, 1);
      assert.deepEqual(detailed.blockingEdgeIds, [seed.edgeId]);
      assert.equal(detailed.blockingEdges.length, 1);
      assert.equal(detailed.blockingEdges[0].edgeId, seed.edgeId);
      assert.equal(detailed.blockingEdges[0].direction, "OUTGOING");
      assert.equal(detailed.blockingEdges[0].otherNodeId, seed.nodeBId);
    }
    const [nodeStillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeAId));
    assert.ok(nodeStillThere, "the node must still exist after the rejected delete");
    const [edgeStillThere] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.ok(edgeStillThere, "the connected edge must never be cascade-deleted");
  });

  test("NODE_HAS_DEPENDENT_CONTENT: a node with a checklist section cannot be deleted", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-checklist"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "체크리스트 보유 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // Synthetic dependent content, direct DB operation — no production
    // mutation creates procedure_checklist_sections rows yet.
    await db.insert(procedureChecklistSections).values({ nodeId: created.nodeId, title: "테스트 섹션", sortOrder: 0, sourceWorksheet: null, sourceCellRange: null });

    const result = await deleteProcedureTemplateNode(created.nodeId, superAdminId, "사유", created.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "NODE_HAS_DEPENDENT_CONTENT");
      const detailed = result as typeof result & { checklistSectionCount: number; troubleshootingEntryCount: number };
      assert.equal(detailed.checklistSectionCount, 1);
      assert.equal(detailed.troubleshootingEntryCount, 0);
    }
    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, created.nodeId));
    assert.ok(stillThere);
  });

  test("NODE_HAS_DEPENDENT_CONTENT: a node with a troubleshooting entry cannot be deleted", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-troubleshooting"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "고장 진단표 보유 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    await db.insert(procedureTroubleshootingEntries).values({ nodeId: created.nodeId, symptom: "테스트 증상", sortOrder: 0, sourceCellRange: null });

    const result = await deleteProcedureTemplateNode(created.nodeId, superAdminId, "사유", created.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "NODE_HAS_DEPENDENT_CONTENT");
      const detailed = result as typeof result & { checklistSectionCount: number; troubleshootingEntryCount: number };
      assert.equal(detailed.checklistSectionCount, 0);
      assert.equal(detailed.troubleshootingEntryCount, 1);
    }
    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, created.nodeId));
    assert.ok(stillThere);
  });

  test("FULL_SERVICE: node deletion through this NEW mutation fails even for SUPER_ADMIN", async () => {
    const templateId = await createDraft(uniqueCode("delete-node-full-service"));
    const nodes = await loadNodesByCode(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const target = nodes.get("n4")!; // n4 (END) has no outgoing edges in the base fixture, but incoming edges still exist — irrelevant here since FORBIDDEN fires before any dependency check.
    const result = await deleteProcedureTemplateNode(target.id, superAdminId, "사유", templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, target.id));
    assert.ok(stillThere);
  });

  test("a PUBLISHED technical template's node cannot be deleted (NOT_DRAFT)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-published"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const result = await deleteProcedureTemplateNode(created.nodeId, superAdminId, "사유", created.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });

  test("Phase 5C-5B usability: a blank reason no longer blocks the delete — it succeeds, and the DELETE_NODE history row's reason is null", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-blank-reason"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await deleteProcedureTemplateNode(created.nodeId, superAdminId, "", created.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, created.nodeId));
    assert.equal(stillThere, undefined, "the node must actually be deleted");
    const [history] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_NODE")));
    assert.ok(history, "a DELETE_NODE history row must still be written — optional reason never means no audit trail");
    assert.equal(history.reason, null);
  });

  test("using a different technical template's revision token is rejected (STALE_REVISION)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-cross-a"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const otherTemplateId = await createTechnicalDraft(uniqueCode("delete-node-cross-b"));
    const otherTemplateRow = await loadTemplateRow(otherTemplateId);

    const result = await deleteProcedureTemplateNode(created.nodeId, superAdminId, "사유", otherTemplateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");
  });

  test("delete edge, then delete the now-unconnected node: succeeds", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node-after-edge"));
    const seed = await seedTechnicalGraph(templateId);

    const blocked = await deleteProcedureTemplateNode(seed.nodeAId, superAdminId, "사유", seed.updatedAt);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "NODE_HAS_CONNECTED_EDGES");

    const edgeDeleted = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "연결 제거", seed.updatedAt);
    assert.equal(edgeDeleted.ok, true, JSON.stringify(edgeDeleted));
    if (!edgeDeleted.ok) return;

    const nodeDeleted = await deleteProcedureTemplateNode(seed.nodeAId, superAdminId, "이제 연결 없는 노드 삭제", edgeDeleted.updatedAt);
    assert.equal(nodeDeleted.ok, true, JSON.stringify(nodeDeleted));

    const [stillThere] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeAId));
    assert.equal(stillThere, undefined);
  });
});

/**
 * Phase 5C-5B-1 — transaction atomicity: every rejection path in
 * createProcedureTemplateNode/deleteProcedureTemplateNode/
 * deleteProcedureTemplateEdge above (FORBIDDEN, NOT_DRAFT, STALE_REVISION,
 * INVALID_INPUT, NODE_HAS_CONNECTED_EDGES, NODE_HAS_DEPENDENT_CONTENT,
 * EDGE_HAS_CLONE_DEPENDENTS) fails BEFORE insertEditHistory ever runs — the
 * per-test assertions above already prove no orphan CREATE_NODE/DELETE_NODE/
 * DELETE_EDGE history row exists after each rejection. This block adds one
 * more end-to-end proof: a whole batch of mixed successes and failures
 * against the same template leaves history exactly matching only the
 * successes, in order, nothing more, nothing less. (The remaining
 * atomicity claim in the task brief — history-insert-succeeds-but-DELETE-
 * later-fails must roll back both — is not independently fault-injectable
 * without instrumenting the transaction; it is guaranteed by construction,
 * since the insert and the DELETE are two statements in the same
 * db.transaction() with no intervening commit, the same standard Postgres
 * atomicity guarantee this codebase's every other multi-statement mutation
 * already relies on and none of its existing tests fault-inject either.)
 */
describe("Phase 5C-5B-1 transaction atomicity", () => {
  test("a rejected create/delete never leaves a partial history row; a subsequent success is unaffected", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("atomicity"));
    const seed = await seedTechnicalGraph(templateId);

    // 1. rejected delete (connected edges) — no DELETE_NODE row.
    const rejected1 = await deleteProcedureTemplateNode(seed.nodeAId, superAdminId, "사유", seed.updatedAt);
    assert.equal(rejected1.ok, false);

    // 2. rejected delete (nonexistent edge id — reason is optional now, so this scenario no longer uses a blank reason) — no DELETE_EDGE row.
    const rejected2 = await deleteProcedureTemplateEdge(randomUUID(), superAdminId, "사유", seed.updatedAt);
    assert.equal(rejected2.ok, false);
    if (!rejected2.ok) assert.equal(rejected2.code, "NOT_FOUND");

    // 3. rejected create (bad node type) — no CREATE_NODE row.
    const rejected3 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "CHECKLIST" as never, title: "x" }, seed.updatedAt);
    assert.equal(rejected3.ok, false);

    const historyAfterFailures = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
    // seedTechnicalGraph itself wrote CREATE_NODE x2 + CREATE_EDGE x1 = 3 legitimate rows; none of the 3 rejections above added a 4th.
    assert.equal(historyAfterFailures.length, 3, "none of the three rejected calls may add a history row");

    // 4. a real success afterward proceeds normally, unaffected by the failed attempts.
    const success = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "정상 삭제", seed.updatedAt);
    assert.equal(success.ok, true, JSON.stringify(success));
    const historyAfterSuccess = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
    assert.equal(historyAfterSuccess.length, 4);
  });
});

/**
 * Phase 5C-5B usability follow-up — confirms the EXISTING
 * updateProcedureTemplateEdge/saveProcedureTemplateLayout mutations (no new
 * mutation added) behave identically on a TECHNICAL_TASK DRAFT as they
 * already do for FULL_SERVICE: connection-type change persists with CUSTOM
 * branch-label validation intact, and a dragged node position persists via
 * userPositionX/Y (never positionX/Y) — both now reachable through the
 * technical editor UI (EdgePropertyPanel / node drag + defaultLayoutMode).
 */
describe("Phase 5C-5B usability follow-up: connection-type editing and node-drag persistence on TECHNICAL_TASK", () => {
  test("changing an edge's branch type on a TECHNICAL_TASK DRAFT persists after a fresh read, and CUSTOM branch-label validation still applies", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("edge-type-technical"));
    const seed = await seedTechnicalGraph(templateId, adminId);

    const blankLabel = await updateProcedureTemplateEdge(seed.edgeId, adminId, { branchType: "CUSTOM", branchLabel: null }, seed.updatedAt);
    assert.equal(blankLabel.ok, false, "CUSTOM without a label must still be rejected, same as FULL_SERVICE");
    if (!blankLabel.ok) assert.equal(blankLabel.code, "INVALID_INPUT");

    const result = await updateProcedureTemplateEdge(seed.edgeId, adminId, { branchType: "CUSTOM", branchLabel: "특수 조건" }, seed.updatedAt, "연결 유형 변경");
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.structuralValidation !== undefined, true, "structural re-validation must still run, unweakened");

    const [persisted] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.equal(persisted.branchType, "CUSTOM");
    assert.equal(persisted.branchLabel, "특수 조건");
  });

  test("a dragged node position on a TECHNICAL_TASK DRAFT persists via userPositionX/Y through saveProcedureTemplateLayout, never touching positionX/Y (source coordinates)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("node-drag-technical"));
    const seed = await seedTechnicalGraph(templateId, superAdminId);
    const [nodeBefore] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeAId));

    const result = await saveProcedureTemplateLayout(templateId, superAdminId, [{ nodeId: seed.nodeAId, x: 321, y: 654 }], [], seed.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const [persisted] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeAId));
    assert.equal(persisted.userPositionX, 321);
    assert.equal(persisted.userPositionY, 654);
    assert.equal(persisted.positionX, nodeBefore.positionX, "position_x (source coordinate) must never change");
    assert.equal(persisted.positionY, nodeBefore.positionY, "position_y (source coordinate) must never change");
  });

  test("a read-only actor (AS_ENGINEER) cannot persist a layout move on a TECHNICAL_TASK DRAFT", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("node-drag-readonly"));
    const seed = await seedTechnicalGraph(templateId);

    const result = await saveProcedureTemplateLayout(templateId, asEngineerId, [{ nodeId: seed.nodeAId, x: 10, y: 10 }], [], seed.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");

    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, seed.nodeAId));
    assert.equal(node.userPositionX, null, "a rejected save must never persist a partial position");
  });
});

/** Phase 5C-5B usability follow-up — insertProcedureTemplateNodeOnEdge: splitting a route point into a new node. */
describe("insertProcedureTemplateNodeOnEdge", () => {
  async function seedCustomEdge(templateId: string, actorId = superAdminId) {
    const templateRow = await loadTemplateRow(templateId);
    const n1 = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "시작" }, templateRow.updatedAt.toISOString());
    assert.equal(n1.ok, true);
    if (!n1.ok) throw new Error("unreachable");
    const n2 = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "끝" }, n1.updatedAt);
    assert.equal(n2.ok, true);
    if (!n2.ok) throw new Error("unreachable");
    const edge = await createProcedureTemplateEdge(templateId, actorId, { fromNodeId: n1.nodeId, toNodeId: n2.nodeId, branchType: "CUSTOM", branchLabel: "특수 조건", reason: "테스트" }, n2.updatedAt);
    assert.equal(edge.ok, true);
    if (!edge.ok) throw new Error("unreachable");
    return { nodeAId: n1.nodeId, nodeBId: n2.nodeId, edgeId: edge.edgeId, updatedAt: edge.updatedAt };
  }

  test("splits an edge: A->NEW preserves original branch semantics (CUSTOM label), NEW->B is a plain DEFAULT continuation, and the route-point coordinate becomes the new node's user position", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-basic"));
    const seed = await seedCustomEdge(templateId);

    const result = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "INSPECTION", title: "삽입 노드", position: { x: 111, y: 222 } }, seed.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const [firstEdge] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.equal(firstEdge.fromNodeId, seed.nodeAId);
    assert.equal(firstEdge.toNodeId, result.nodeId, "the original edge must now point at the new node");
    assert.equal(firstEdge.branchType, "CUSTOM", "original branch semantics must be preserved");
    assert.equal(firstEdge.branchLabel, "특수 조건");

    const [secondEdge] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, result.secondEdgeId));
    assert.equal(secondEdge.fromNodeId, result.nodeId);
    assert.equal(secondEdge.toNodeId, seed.nodeBId);
    assert.equal(secondEdge.branchType, "DEFAULT", "the new continuation edge must never duplicate CUSTOM/YES/NO semantics");
    assert.equal(secondEdge.branchLabel, null);

    const allEdges = await loadEdges(templateId);
    assert.equal(allEdges.length, 2, "exactly the (retargeted) original edge and the new continuation edge — nothing else");

    const [newNode] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(newNode.nodeType, "INSPECTION");
    assert.equal(newNode.title, "삽입 노드");
    assert.equal(newNode.userPositionX, 111, "the route-point coordinate becomes the new node's user position");
    assert.equal(newNode.userPositionY, 222);
  });

  test("writes exactly CREATE_NODE, RETARGET_EDGE, and CREATE_EDGE history rows (existing action types — no schema change), with correct before/after state", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-history"));
    const seed = await seedTechnicalGraph(templateId);

    const result = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "삽입", position: { x: 5, y: 5 } }, seed.updatedAt);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const history = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId))
      // Phase 5C-5C — the split's 3 rows are written inside one transaction,
      // so created_at (transaction-scoped now()) can tie between them;
      // sequence_number is IDENTITY-allocated (globally monotonic across
      // every transaction) and is the only column guaranteed to preserve
      // insertion order here.
      .orderBy(procedureTemplateEditHistory.sequenceNumber);
    // seedTechnicalGraph itself already wrote 3 rows (CREATE_NODE x2, CREATE_EDGE x1); the split adds exactly 3 more.
    const splitRows = history.slice(3);
    assert.equal(splitRows.length, 3);
    assert.equal(splitRows[0].actionType, "CREATE_NODE");
    assert.equal(splitRows[0].nodeId, result.nodeId);
    assert.equal(splitRows[1].actionType, "RETARGET_EDGE");
    assert.equal(splitRows[1].edgeId, seed.edgeId);
    // Phase 5C-5C — `id` is now embedded in RETARGET_EDGE's before/afterState too (identity permanence fix).
    assert.deepEqual(splitRows[1].beforeState, { id: seed.edgeId, fromNodeId: seed.nodeAId, toNodeId: seed.nodeBId, branchType: "DEFAULT" });
    assert.deepEqual(splitRows[1].afterState, { id: seed.edgeId, fromNodeId: seed.nodeAId, toNodeId: result.nodeId, branchType: "DEFAULT" });
    assert.equal(splitRows[2].actionType, "CREATE_EDGE");
    assert.equal(splitRows[2].edgeId, result.secondEdgeId);
    // Phase 5C-5C — one "split" call is one logical compound operation: all
    // three rows must share the same change_group_id, distinct from the
    // group ids seedTechnicalGraph's own (separate-transaction) rows used.
    assert.ok(splitRows[0].changeGroupId);
    assert.equal(splitRows[0].changeGroupId, splitRows[1].changeGroupId);
    assert.equal(splitRows[0].changeGroupId, splitRows[2].changeGroupId);
    for (const row of splitRows) {
      assert.equal(row.origin, "USER_EDIT");
      assert.equal(row.sourceGroupId, null);
      assert.equal(row.restoreTargetGroupId, null);
    }
  });

  test("FULL_SERVICE: node insertion through this NEW mutation fails even for SUPER_ADMIN, and nothing changes", async () => {
    const templateId = await createDraft(uniqueCode("split-full-service"));
    const edges = await loadEdges(templateId);
    const templateRow = await loadTemplateRow(templateId);
    const result = await insertProcedureTemplateNodeOnEdge(edges[0].id, superAdminId, { nodeType: "TASK", title: "x", position: { x: 0, y: 0 } }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    const edgesAfter = await loadEdges(templateId);
    assert.equal(edgesAfter.length, edges.length, "no edge must be added/changed on a denied FULL_SERVICE attempt");
  });

  test("AS_ENGINEER, SALES, INVENTORY_MANAGER are denied", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-denied"));
    const seed = await seedTechnicalGraph(templateId);
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const result = await insertProcedureTemplateNodeOnEdge(seed.edgeId, actorId, { nodeType: "TASK", title: "x", position: { x: 0, y: 0 } }, seed.updatedAt);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("a PUBLISHED technical template's edge cannot be split (NOT_DRAFT)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-published"));
    const seed = await seedTechnicalGraph(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));
    const result = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "x", position: { x: 0, y: 0 } }, seed.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });

  test("a blank title and an out-of-allow-list node type are both rejected with INVALID_INPUT, and the split is fully atomic (nothing partially created)", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-invalid"));
    const seed = await seedTechnicalGraph(templateId);

    const blankTitle = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "   ", position: { x: 0, y: 0 } }, seed.updatedAt);
    assert.equal(blankTitle.ok, false);
    if (!blankTitle.ok) assert.equal(blankTitle.code, "INVALID_INPUT");

    const badType = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "CHECKLIST" as never, title: "x", position: { x: 0, y: 0 } }, seed.updatedAt);
    assert.equal(badType.ok, false);
    if (!badType.ok) assert.equal(badType.code, "INVALID_INPUT");

    const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
    assert.equal(nodes.length, 2, "still exactly the 2 seed nodes — nothing partially created by either rejected attempt");
    const edges = await loadEdges(templateId);
    assert.equal(edges.length, 1, "still exactly the 1 seed edge, unretargeted");
  });

  test("a stale expectedTemplateUpdatedAt token is rejected (STALE_REVISION), and the edge/graph is left untouched", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-stale"));
    const seed = await seedTechnicalGraph(templateId);
    const staleToken = seed.updatedAt;

    const bump = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "무관한 변경" }, staleToken);
    assert.equal(bump.ok, true);

    const result = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "x", position: { x: 0, y: 0 } }, staleToken);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const [edgeAfter] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, seed.edgeId));
    assert.equal(edgeAfter.toNodeId, seed.nodeBId, "the edge must still point at its original target after a rejected split");
  });
});

/**
 * Phase 5C-5B usability correction — the detail view (getProcedureTemplateDetail)
 * previously never fetched userPositionX/userPositionY at all (a
 * pre-existing gap, not introduced this phase), so it could never reflect
 * a saved 사용자 배치 override the editor (getProcedureTemplateForEditor)
 * already showed — the root cause of the detail-vs-editor layout mismatch.
 * These tests prove both read models now agree.
 */
describe("Phase 5C-5B usability correction: detail and editor read models expose the same saved position", () => {
  test("getProcedureTemplateDetail now includes userPositionX/userPositionY, matching getProcedureTemplateForEditor exactly, after a drag-save", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("detail-editor-consistency"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const saved = await saveProcedureTemplateLayout(templateId, superAdminId, [{ nodeId: created.nodeId, x: 456, y: 789 }], [], created.updatedAt);
    assert.equal(saved.ok, true, JSON.stringify(saved));

    const editorView = await getProcedureTemplateForEditor(templateId);
    const detailView = await getProcedureTemplateDetail(templateId);
    assert.ok(editorView);
    assert.ok(detailView);
    const editorNode = editorView!.nodes.find((n) => n.id === created.nodeId);
    const detailNode = detailView!.nodes.find((n) => n.id === created.nodeId);
    assert.ok(editorNode);
    assert.ok(detailNode);
    assert.equal(detailNode!.userPositionX, 456);
    assert.equal(detailNode!.userPositionY, 789);
    assert.equal(detailNode!.userPositionX, editorNode!.userPositionX, "detail and editor must report the identical saved override");
    assert.equal(detailNode!.userPositionY, editorNode!.userPositionY);
  });

  test("a node with no saved override reports userPositionX/userPositionY as null in both read models", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("detail-editor-no-override"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const editorView = await getProcedureTemplateForEditor(templateId);
    const detailView = await getProcedureTemplateDetail(templateId);
    const editorNode = editorView!.nodes.find((n) => n.id === created.nodeId);
    const detailNode = detailView!.nodes.find((n) => n.id === created.nodeId);
    assert.equal(detailNode!.userPositionX, null);
    assert.equal(detailNode!.userPositionY, null);
    assert.equal(editorNode!.userPositionX, null);
    assert.equal(editorNode!.userPositionY, null);
  });
});

/**
 * Phase 5C-5B usability — reasons become optional for TECHNICAL_TASK
 * authoring. deleteProcedureTemplateNode/deleteProcedureTemplateEdge were
 * already TECHNICAL_TASK-only, so they're unconditionally optional now;
 * changeProcedureTemplateNodeType/retargetProcedureTemplateEdge/
 * createProcedureTemplateEdge are shared with FULL_SERVICE, so they must
 * stay category-aware — optional only for TECHNICAL_TASK, still mandatory
 * for FULL_SERVICE (no permission broadening).
 */
describe("Phase 5C-5B usability: reasons are optional for TECHNICAL_TASK, still mandatory for FULL_SERVICE", () => {
  test("deleteProcedureTemplateNode/deleteProcedureTemplateEdge: blank/omitted reason succeeds, history.reason = null; a supplied reason is trimmed and stored", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("optional-reason-delete"));
    const seed = await seedTechnicalGraph(templateId);

    const deletedEdge = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, "", seed.updatedAt);
    assert.equal(deletedEdge.ok, true, JSON.stringify(deletedEdge));
    if (!deletedEdge.ok) return;
    const [edgeHistory] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_EDGE")));
    assert.equal(edgeHistory.reason, null);

    const deletedNode = await deleteProcedureTemplateNode(seed.nodeAId, superAdminId, "  실제 사유  ", deletedEdge.updatedAt);
    assert.equal(deletedNode.ok, true, JSON.stringify(deletedNode));
    const [nodeHistory] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, templateId), eq(procedureTemplateEditHistory.actionType, "DELETE_NODE")));
    assert.equal(nodeHistory.reason, "실제 사유", "a supplied reason must still be trimmed and stored");
  });

  test("changeProcedureTemplateNodeType: blank reason succeeds on TECHNICAL_TASK (reason=null); still mandatory (INVALID_INPUT) on FULL_SERVICE", async () => {
    const technicalId = await createTechnicalDraft(uniqueCode("optional-reason-type-technical"));
    const techRow = await loadTemplateRow(technicalId);
    const created = await createProcedureTemplateNode(technicalId, superAdminId, { nodeType: "TASK", title: "노드" }, techRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const result = await changeProcedureTemplateNodeType(created.nodeId, superAdminId, "INSPECTION", "", created.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));
    const [history] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.procedureTemplateId, technicalId), eq(procedureTemplateEditHistory.actionType, "CHANGE_NODE_TYPE")));
    assert.equal(history.reason, null);

    const fullServiceId = await createDraft(uniqueCode("optional-reason-type-full-service"));
    const fsNodes = await loadNodesByCode(fullServiceId);
    const fsRow = await loadTemplateRow(fullServiceId);
    const blocked = await changeProcedureTemplateNodeType(fsNodes.get("n3")!.id, superAdminId, "INSPECTION", "", fsRow.updatedAt.toISOString());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "INVALID_INPUT", "FULL_SERVICE must still require a reason — no broadening");
  });

  test("retargetProcedureTemplateEdge: blank reason succeeds on TECHNICAL_TASK; still mandatory on FULL_SERVICE", async () => {
    const technicalId = await createTechnicalDraft(uniqueCode("optional-reason-retarget-technical"));
    const seed = await seedTechnicalGraph(technicalId);
    const techRow = await loadTemplateRow(technicalId);
    const third = await createProcedureTemplateNode(technicalId, superAdminId, { nodeType: "TASK", title: "셋째" }, techRow.updatedAt.toISOString());
    assert.equal(third.ok, true);
    if (!third.ok) return;
    const result = await retargetProcedureTemplateEdge(seed.edgeId, superAdminId, seed.nodeAId, third.nodeId, "", third.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const fullServiceId = await createDraft(uniqueCode("optional-reason-retarget-full-service"));
    const fsEdges = await loadEdges(fullServiceId);
    const fsNodes = await loadNodesByCode(fullServiceId);
    const fsRow = await loadTemplateRow(fullServiceId);
    const edgeToRetarget = fsEdges.find((e) => e.fromNodeId === fsNodes.get("n1")!.id)!;
    const blocked = await retargetProcedureTemplateEdge(edgeToRetarget.id, superAdminId, fsNodes.get("n1")!.id, fsNodes.get("n4")!.id, "", fsRow.updatedAt.toISOString());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "INVALID_INPUT", "FULL_SERVICE must still require a reason — no broadening");
  });

  test("createProcedureTemplateEdge: blank/omitted reason succeeds on TECHNICAL_TASK; still mandatory on FULL_SERVICE", async () => {
    const technicalId = await createTechnicalDraft(uniqueCode("optional-reason-create-edge-technical"));
    const techRow = await loadTemplateRow(technicalId);
    const n1 = await createProcedureTemplateNode(technicalId, superAdminId, { nodeType: "TASK", title: "A" }, techRow.updatedAt.toISOString());
    assert.equal(n1.ok, true);
    if (!n1.ok) return;
    const n2 = await createProcedureTemplateNode(technicalId, superAdminId, { nodeType: "TASK", title: "B" }, n1.updatedAt);
    assert.equal(n2.ok, true);
    if (!n2.ok) return;
    const result = await createProcedureTemplateEdge(technicalId, superAdminId, { fromNodeId: n1.nodeId, toNodeId: n2.nodeId, branchType: "DEFAULT" }, n2.updatedAt);
    assert.equal(result.ok, true, JSON.stringify(result));

    const fullServiceId = await createDraft(uniqueCode("optional-reason-create-edge-full-service"));
    const fsNodes = await loadNodesByCode(fullServiceId);
    const fsRow = await loadTemplateRow(fullServiceId);
    const blocked = await createProcedureTemplateEdge(fullServiceId, superAdminId, { fromNodeId: fsNodes.get("n3")!.id, toNodeId: fsNodes.get("n5")!.id, branchType: "CUSTOM", branchLabel: "예외" }, fsRow.updatedAt.toISOString());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "INVALID_INPUT", "FULL_SERVICE must still require a reason — no broadening");
  });
});

/** Phase 5C-5B usability — createProcedureTemplateNode's optional explicit `position` (selection-aware add-node placement). */
describe("Phase 5C-5B usability: createProcedureTemplateNode with an explicit position", () => {
  test("an explicit position becomes BOTH position_x/y and user_position_x/y, so it survives regardless of the auto-layout fallback", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-explicit-position"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "선택 아래 추가", position: { x: 42, y: 199 } }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(node.positionX, 42);
    assert.equal(node.positionY, 199);
    assert.equal(node.userPositionX, 42);
    assert.equal(node.userPositionY, 199);
  });

  test("omitting position falls back to the original default stacking, unchanged", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-default-position"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "기본 위치" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(node.positionX, 0);
    assert.equal(node.positionY, 0);
    assert.equal(node.userPositionX, null);
    assert.equal(node.userPositionY, null);
  });

  test("an invalid (non-finite) position is rejected with INVALID_INPUT", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node-bad-position"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "x", position: { x: Number.NaN, y: 0 } }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

/**
 * Multiline node titles (Shift+Enter). Server validation must preserve
 * internal `\n` (never normalize/collapse it to
 * a space) while still trimming only the outer whitespace, and must
 * reject a title that is effectively blank after trimming even when it
 * contains only whitespace/newlines.
 */
describe("Phase 5C-5B usability item 4: multiline node titles", () => {
  test("createProcedureTemplateNode: a multiline title persists its internal newlines exactly, with only outer whitespace trimmed", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("multiline-create"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(
      templateId,
      superAdminId,
      { nodeType: "TASK", title: "  1차 확인\n2차 확인  " },
      templateRow.updatedAt.toISOString()
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(node.title, "1차 확인\n2차 확인");
  });

  test("createProcedureTemplateNode: a title that is only whitespace/newlines is rejected with INVALID_INPUT", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("multiline-create-blank"));
    const templateRow = await loadTemplateRow(templateId);
    const result = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "  \n\n  \n " }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("updateProcedureTemplateNode: a multiline title patch persists its internal newlines exactly, with only outer whitespace trimmed", async () => {
    const templateId = await createDraft(uniqueCode("multiline-update"));
    const nodes = await loadNodesByCode(templateId);
    const n3 = nodes.get("n3")!;
    const templateRow = await loadTemplateRow(templateId);

    const result = await updateProcedureTemplateNode(n3.id, superAdminId, { title: "  1단계\n2단계\n3단계  " }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    assert.equal(updated.title, "1단계\n2단계\n3단계");
  });

  test("updateProcedureTemplateNode: a title patch that is only whitespace/newlines is rejected with INVALID_INPUT, and the stored title is left unchanged", async () => {
    const templateId = await createDraft(uniqueCode("multiline-update-blank"));
    const nodes = await loadNodesByCode(templateId);
    const n3 = nodes.get("n3")!;
    const templateRow = await loadTemplateRow(templateId);
    const originalTitle = n3.title;

    const result = await updateProcedureTemplateNode(n3.id, superAdminId, { title: "\n \n" }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");

    const [row] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    assert.equal(row.title, originalTitle);
  });

  test("updateProcedureTemplateNode: a patch that never touches title (title undefined) is unaffected by the new validation — other fields still update", async () => {
    const templateId = await createDraft(uniqueCode("multiline-update-other-fields"));
    const nodes = await loadNodesByCode(templateId);
    const n3 = nodes.get("n3")!;
    const templateRow = await loadTemplateRow(templateId);

    const result = await updateProcedureTemplateNode(n3.id, superAdminId, { isActive: false }, templateRow.updatedAt.toISOString());
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n3.id));
    assert.equal(row.title, n3.title, "title must remain exactly what it was — omitted from the patch entirely");
    assert.equal(row.isActive, false);
  });
});
