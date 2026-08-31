import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { procedureTemplates, procedureTemplateNodes, procedureTemplateEdges, procedureTemplateEditHistory, users } from "../schema";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate, createManualTechnicalProcedureTemplate, renameTechnicalProcedureTemplate } from "./procedure-templates";
import {
  createProcedureTemplateNode,
  createProcedureTemplateEdge,
  updateProcedureTemplateNode,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  saveProcedureTemplateLayout,
  deleteProcedureTemplateNode,
  deleteProcedureTemplateEdge,
  insertProcedureTemplateNodeOnEdge,
} from "./procedure-template-editor";
import { undoProcedureTemplateChange, redoProcedureTemplateChange } from "./procedure-template-undo-redo";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";

/**
 * Phase 5C-5C — server-core Undo/Redo integration tests. Same self-cleaning
 * convention (TEST_CODE_PREFIX + createdTemplateIds, edit-history deleted
 * before templates/nodes/edges in after()) as procedure-template-editor.
 * integration.test.ts. Historical Restore / UI are out of scope here.
 */

const TEST_CODE_PREFIX = "test-undoredo-";

let superAdminId: string;
let adminId: string;
let asEngineerId: string;
let salesId: string;
let inventoryManagerId: string;

const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

async function createTechnicalDraft(code: string, actorId = superAdminId) {
  const result = await createManualTechnicalProcedureTemplate({ code, name: `Undo/Redo 테스트 ${code}`, equipmentType: "COMMON" }, actorId);
  assert.equal(result.ok, true, `technical draft creation failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdTemplateIds.push(result.id);
  return result.id;
}

function makeFullServiceFixture(code: string): ExtractedTemplate {
  return {
    code,
    name: `FULL_SERVICE 테스트 ${code}`,
    equipmentType: "RFG",
    description: "Phase 5C-5C undo/redo integration test fixture",
    sourceWorksheets: ["(TEST) undo-redo 시트"],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: "(TEST) undo-redo 시트", sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "END", title: "종료", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: "(TEST) undo-redo 시트", sourceShapeId: "2" },
    ],
    edges: [{ fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" }],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };
}

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

async function loadTemplateRow(templateId: string) {
  const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
  return row;
}

async function loadNode(nodeId: string) {
  const [row] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId));
  return row;
}

async function loadEdge(edgeId: string) {
  const [row] = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId));
  return row;
}

async function loadEdges(templateId: string) {
  return db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
}

async function loadHistory(templateId: string) {
  return db
    .select()
    .from(procedureTemplateEditHistory)
    .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId))
    .orderBy(procedureTemplateEditHistory.sequenceNumber);
}

/** Two TASK nodes + one DEFAULT edge, built through the production mutations themselves. */
async function seedGraph(templateId: string, actorId = superAdminId) {
  const templateRow = await loadTemplateRow(templateId);
  const n1 = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "노드1" }, templateRow.updatedAt.toISOString());
  assert.equal(n1.ok, true, JSON.stringify(n1));
  if (!n1.ok) throw new Error("unreachable");
  const n2 = await createProcedureTemplateNode(templateId, actorId, { nodeType: "TASK", title: "노드2" }, n1.updatedAt);
  assert.equal(n2.ok, true, JSON.stringify(n2));
  if (!n2.ok) throw new Error("unreachable");
  const edge = await createProcedureTemplateEdge(templateId, actorId, { fromNodeId: n1.nodeId, toNodeId: n2.nodeId, branchType: "DEFAULT", reason: "테스트 연결" }, n2.updatedAt);
  assert.equal(edge.ok, true, JSON.stringify(edge));
  if (!edge.ok) throw new Error("unreachable");
  return { nodeAId: n1.nodeId, nodeBId: n2.nodeId, edgeId: edge.edgeId, updatedAt: edge.updatedAt };
}

before(async () => {
  const [superAdmin] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true))).limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [admin] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true))).limit(1);
  assert.ok(admin, "expected an approved ADMIN in the dev DB");
  adminId = admin.id;

  const [engineer] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true))).limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the dev DB");
  asEngineerId = engineer.id;

  const [sales] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true))).limit(1);
  assert.ok(sales, "expected an approved SALES user in the dev DB");
  salesId = sales.id;

  const [inventoryManager] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "INVENTORY_MANAGER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true))).limit(1);
  assert.ok(inventoryManager, "expected an approved INVENTORY_MANAGER in the dev DB");
  inventoryManagerId = inventoryManager.id;
});

after(async () => {
  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  if (allIds.length > 0) {
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("A. UPDATE_NODE: edit -> Undo -> original -> Redo -> edited", () => {
  test("round-trips node title/description through Undo and Redo", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("update-node"));
    const seed = await seedGraph(templateId);
    const before = await loadNode(seed.nodeAId);

    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "수정된 제목" }, seed.updatedAt);
    assert.equal(edited.ok, true, JSON.stringify(edited));
    if (!edited.ok) return;
    const afterEdit = await loadNode(seed.nodeAId);
    assert.equal(afterEdit.title, "수정된 제목");

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, edited.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    const afterUndo = await loadNode(seed.nodeAId);
    assert.equal(afterUndo.title, before.title, "Undo must restore the original title");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    const afterRedo = await loadNode(seed.nodeAId);
    assert.equal(afterRedo.title, "수정된 제목", "Redo must reapply the edit");
  });
});

describe("B. CREATE_NODE: create -> Undo removes it -> Redo recreates SAME id", () => {
  test("node id is preserved across Undo/Redo of its own creation", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "새 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;
    const originalNodeId = created.nodeId;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, created.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal(await loadNode(originalNodeId), undefined, "Undo of CREATE_NODE must delete the node");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    const recreated = await loadNode(originalNodeId);
    assert.ok(recreated, "Redo of CREATE_NODE must recreate the node with the SAME id");
    assert.equal(recreated.title, "새 노드");
  });
});

describe("C. DELETE_NODE: delete -> Undo recreates SAME id -> Redo deletes again", () => {
  test("node id is preserved across Undo/Redo of its own deletion", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "삭제될 노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const nodeId = created.nodeId;

    const deleted = await deleteProcedureTemplateNode(nodeId, superAdminId, null, created.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;
    assert.equal(await loadNode(nodeId), undefined);

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, deleted.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    const recreated = await loadNode(nodeId);
    assert.ok(recreated, "Undo of DELETE_NODE must recreate the node with the SAME id");
    assert.equal(recreated.title, "삭제될 노드");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.equal(await loadNode(nodeId), undefined, "Redo of DELETE_NODE must delete the node again");
  });
});

describe("D. CREATE_EDGE / DELETE_EDGE same-id restoration", () => {
  test("CREATE_EDGE: create -> Undo removes it -> Redo recreates SAME id", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-edge"));
    const seed = await seedGraph(templateId);
    const originalEdgeId = seed.edgeId;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, seed.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal(await loadEdge(originalEdgeId), undefined, "Undo of CREATE_EDGE must delete the edge");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    const recreated = await loadEdge(originalEdgeId);
    assert.ok(recreated, "Redo of CREATE_EDGE must recreate the edge with the SAME id");
    assert.equal(recreated.fromNodeId, seed.nodeAId);
    assert.equal(recreated.toNodeId, seed.nodeBId);
  });

  test("DELETE_EDGE: delete -> Undo recreates SAME id -> Redo deletes again", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge"));
    const seed = await seedGraph(templateId);

    const deleted = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, null, seed.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;
    assert.equal(await loadEdge(seed.edgeId), undefined);

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, deleted.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    const recreated = await loadEdge(seed.edgeId);
    assert.ok(recreated, "Undo of DELETE_EDGE must recreate the edge with the SAME id");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.equal(await loadEdge(seed.edgeId), undefined, "Redo of DELETE_EDGE must delete the edge again");
  });
});

describe("E. UPDATE_EDGE / RETARGET_EDGE", () => {
  test("UPDATE_EDGE round-trips branchType/branchLabel through Undo/Redo", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("update-edge"));
    const seed = await seedGraph(templateId);

    const edited = await updateProcedureTemplateEdge(seed.edgeId, superAdminId, { branchType: "CUSTOM", branchLabel: "특수" }, seed.updatedAt, "테스트");
    assert.equal(edited.ok, true, JSON.stringify(edited));
    if (!edited.ok) return;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, edited.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    let edge = await loadEdge(seed.edgeId);
    assert.equal(edge.branchType, "DEFAULT");
    assert.equal(edge.branchLabel, null);

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    edge = await loadEdge(seed.edgeId);
    assert.equal(edge.branchType, "CUSTOM");
    assert.equal(edge.branchLabel, "특수");
  });

  test("RETARGET_EDGE round-trips fromNodeId/toNodeId through Undo/Redo", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("retarget-edge"));
    const seed = await seedGraph(templateId);
    const n3 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드3" }, seed.updatedAt);
    assert.equal(n3.ok, true);
    if (!n3.ok) return;

    const retargeted = await retargetProcedureTemplateEdge(seed.edgeId, superAdminId, seed.nodeAId, n3.nodeId, "테스트 재대상", n3.updatedAt);
    assert.equal(retargeted.ok, true, JSON.stringify(retargeted));
    if (!retargeted.ok) return;
    assert.equal((await loadEdge(seed.edgeId)).toNodeId, n3.nodeId);

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, retargeted.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal((await loadEdge(seed.edgeId)).toNodeId, seed.nodeBId, "Undo must restore the original target node");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.equal((await loadEdge(seed.edgeId)).toNodeId, n3.nodeId, "Redo must reapply the retarget");
  });
});

describe("F. SAVE_LAYOUT / SAVE_EDGE_ROUTE", () => {
  test("a combined layout+route save round-trips through Undo/Redo as one group", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("save-layout"));
    const seed = await seedGraph(templateId);

    const saved = await saveProcedureTemplateLayout(templateId, superAdminId, [{ nodeId: seed.nodeAId, x: 50, y: 60 }], [{ edgeId: seed.edgeId, points: [{ x: 1, y: 2 }] }], seed.updatedAt);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, saved.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    let node = await loadNode(seed.nodeAId);
    let edge = await loadEdge(seed.edgeId);
    assert.equal(node.userPositionX, null);
    assert.equal(node.userPositionY, null);
    assert.equal(edge.userRoutePoints, null);

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    node = await loadNode(seed.nodeAId);
    edge = await loadEdge(seed.edgeId);
    assert.equal(node.userPositionX, 50);
    assert.equal(node.userPositionY, 60);
    assert.deepEqual(edge.userRoutePoints, [{ x: 1, y: 2 }]);
  });
});

describe("G. UPDATE_TEMPLATE_METADATA rename", () => {
  test("a rename round-trips through Undo/Redo", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("rename"));
    const row = await loadTemplateRow(templateId);
    const originalName = row.name;

    const renamed = await renameTechnicalProcedureTemplate(templateId, superAdminId, "새 이름", row.updatedAt.toISOString());
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    if (!renamed.ok) return;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, renamed.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal((await loadTemplateRow(templateId)).name, originalName, "Undo must restore the original name");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.equal((await loadTemplateRow(templateId)).name, "새 이름", "Redo must reapply the rename");
  });
});

describe("H. compound route-point insertion", () => {
  test("A->B -> insert NEW -> A->NEW->B -> Undo -> A->B -> Redo -> A->NEW->B, atomically", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split"));
    const seed = await seedGraph(templateId);

    const split = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "삽입 노드", position: { x: 5, y: 5 } }, seed.updatedAt);
    assert.equal(split.ok, true, JSON.stringify(split));
    if (!split.ok) return;

    let edgesNow = await loadEdges(templateId);
    assert.equal(edgesNow.length, 2, "A->NEW and NEW->B");
    assert.ok(await loadNode(split.nodeId));

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, split.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;

    edgesNow = await loadEdges(templateId);
    assert.equal(edgesNow.length, 1, "back to a single A->B edge — no partial graph state");
    assert.equal(edgesNow[0].id, seed.edgeId);
    assert.equal(edgesNow[0].fromNodeId, seed.nodeAId);
    assert.equal(edgesNow[0].toNodeId, seed.nodeBId);
    assert.equal(await loadNode(split.nodeId), undefined, "the inserted node must be gone too");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;

    edgesNow = await loadEdges(templateId);
    assert.equal(edgesNow.length, 2, "A->NEW->B restored atomically");
    const recreatedNode = await loadNode(split.nodeId);
    assert.ok(recreatedNode, "the split node must be recreated with the SAME id");
    const firstEdge = edgesNow.find((e) => e.id === seed.edgeId)!;
    assert.equal(firstEdge.toNodeId, split.nodeId);
    const secondEdge = edgesNow.find((e) => e.id === split.secondEdgeId);
    assert.ok(secondEdge, "the second edge must be recreated with the SAME id");
    assert.equal(secondEdge!.fromNodeId, split.nodeId);
    assert.equal(secondEdge!.toNodeId, seed.nodeBId);
  });

  test("the Undo group for the split writes exactly 3 rows in the required reverse order", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split-order"));
    const seed = await seedGraph(templateId);
    const split = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "삽입", position: { x: 0, y: 0 } }, seed.updatedAt);
    assert.equal(split.ok, true);
    if (!split.ok) return;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, split.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;

    const history = await loadHistory(templateId);
    const undoRows = history.filter((h) => h.origin === "UNDO");
    assert.equal(undoRows.length, 3);
    assert.equal(undoRows[0].actionType, "DELETE_EDGE", "inverse of CREATE_EDGE first");
    assert.equal(undoRows[1].actionType, "RETARGET_EDGE", "inverse of RETARGET_EDGE second");
    assert.equal(undoRows[2].actionType, "DELETE_NODE", "inverse of CREATE_NODE last, once its edges are already gone");
    const groupIds = new Set(undoRows.map((r) => r.changeGroupId));
    assert.equal(groupIds.size, 1, "all 3 inverse rows share one change_group_id");
  });
});

describe("I. multi-step stack: A, B, C -> Undo C -> Undo B -> Redo B: next Undo targets B, next Redo targets C", () => {
  /**
   * "next Undo targets B" and "next Redo targets C" describe two
   * ALTERNATIVE single next-actions from the SAME state reached after
   * Redo B (appliedStack=[A,B], redoStack=[C]) — not a further sequential
   * chain. A strict LIFO redo stack always pushes the most-recently-undone
   * group back on top, so actually performing "Undo B" again and THEN
   * "Redo" from there would target B again, not C — the two branches are
   * exercised independently below, each replaying the same A,B,C,UndoC,
   * UndoB,RedoB prefix fresh.
   */
  async function seedThreeStepsThenUndoCUndoBRedoB(codeSuffix: string) {
    const templateId = await createTechnicalDraft(uniqueCode(codeSuffix));
    const templateRow = await loadTemplateRow(templateId);
    const a = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "A" }, templateRow.updatedAt.toISOString());
    assert.equal(a.ok, true);
    if (!a.ok) throw new Error("unreachable");
    const b = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "B" }, a.updatedAt);
    assert.equal(b.ok, true);
    if (!b.ok) throw new Error("unreachable");
    const c = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "C" }, b.updatedAt);
    assert.equal(c.ok, true);
    if (!c.ok) throw new Error("unreachable");

    const undoC = await undoProcedureTemplateChange(templateId, superAdminId, c.updatedAt);
    assert.equal(undoC.ok, true, JSON.stringify(undoC));
    if (!undoC.ok) throw new Error("unreachable");
    const undoB = await undoProcedureTemplateChange(templateId, superAdminId, undoC.updatedAt);
    assert.equal(undoB.ok, true, JSON.stringify(undoB));
    if (!undoB.ok) throw new Error("unreachable");
    const redoB = await redoProcedureTemplateChange(templateId, superAdminId, undoB.updatedAt);
    assert.equal(redoB.ok, true, JSON.stringify(redoB));
    if (!redoB.ok) throw new Error("unreachable");

    return { templateId, a, b, c, updatedAt: redoB.updatedAt };
  }

  test("from that state, the next Undo targets B", async () => {
    const { templateId, a, b, c, updatedAt } = await seedThreeStepsThenUndoCUndoBRedoB("multi-step-undo");
    assert.ok(await loadNode(a.nodeId), "A remains applied");
    assert.ok(await loadNode(b.nodeId), "B was reapplied by Redo B");
    assert.equal(await loadNode(c.nodeId), undefined, "C is still undone");

    const undoAgain = await undoProcedureTemplateChange(templateId, superAdminId, updatedAt);
    assert.equal(undoAgain.ok, true, JSON.stringify(undoAgain));
    if (!undoAgain.ok) return;
    assert.equal(await loadNode(b.nodeId), undefined, "the next Undo must target B, removing it again");
    assert.ok(await loadNode(a.nodeId), "A must remain untouched");
  });

  test("from that state, the next Redo targets C", async () => {
    const { templateId, a, b, c, updatedAt } = await seedThreeStepsThenUndoCUndoBRedoB("multi-step-redo");

    const redoAgain = await redoProcedureTemplateChange(templateId, superAdminId, updatedAt);
    assert.equal(redoAgain.ok, true, JSON.stringify(redoAgain));
    if (!redoAgain.ok) return;
    assert.ok(await loadNode(c.nodeId), "the next Redo must target C, reapplying it");
    assert.ok(await loadNode(b.nodeId), "B must remain untouched (still applied)");
    assert.ok(await loadNode(a.nodeId), "A must remain untouched");
  });
});

describe("J. divergent new edit clears redo", () => {
  test("A, B, C, Undo C, new D -> Redo must be unavailable", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("divergent"));
    const templateRow = await loadTemplateRow(templateId);
    const a = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "A" }, templateRow.updatedAt.toISOString());
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "B" }, a.updatedAt);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    const c = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "C" }, b.updatedAt);
    assert.equal(c.ok, true);
    if (!c.ok) return;

    const undoC = await undoProcedureTemplateChange(templateId, superAdminId, c.updatedAt);
    assert.equal(undoC.ok, true);
    if (!undoC.ok) return;

    const d = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "D" }, undoC.updatedAt);
    assert.equal(d.ok, true, JSON.stringify(d));
    if (!d.ok) return;

    const redoAttempt = await redoProcedureTemplateChange(templateId, superAdminId, d.updatedAt);
    assert.equal(redoAttempt.ok, false, "Redo must be unavailable after a divergent new edit");
    if (!redoAttempt.ok) assert.equal(redoAttempt.code, "NO_REDO_AVAILABLE");
  });
});

describe("K. Undo/Redo group fields", () => {
  test("shared change_group_id per logical operation, correct origin/source_group_id, deterministic sequence_number", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("group-fields"));
    const seed = await seedGraph(templateId);
    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "그룹 필드 테스트" }, seed.updatedAt);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    const historyBeforeUndo = await loadHistory(templateId);
    const targetGroup = historyBeforeUndo[historyBeforeUndo.length - 1];
    assert.equal(targetGroup.actionType, "UPDATE_NODE");
    assert.equal(targetGroup.origin, "USER_EDIT");

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, edited.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;

    const historyAfterUndo = await loadHistory(templateId);
    const undoRow = historyAfterUndo[historyAfterUndo.length - 1];
    assert.equal(undoRow.origin, "UNDO");
    assert.equal(undoRow.sourceGroupId, targetGroup.changeGroupId);
    assert.equal(undoRow.restoreTargetGroupId, null);
    assert.notEqual(undoRow.changeGroupId, targetGroup.changeGroupId, "the Undo writes a NEW group id, never reusing the original");
    assert.ok(undoRow.sequenceNumber > targetGroup.sequenceNumber, "sequence_number must be DB-generated and monotonically increasing");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    const historyAfterRedo = await loadHistory(templateId);
    const redoRow = historyAfterRedo[historyAfterRedo.length - 1];
    assert.equal(redoRow.origin, "REDO");
    assert.equal(redoRow.sourceGroupId, targetGroup.changeGroupId, "Redo's source_group_id points at the ORIGINAL forward group, not the UNDO group");
    assert.equal(redoRow.restoreTargetGroupId, null);
  });
});

describe("L. stale-revision rejection leaves graph/history unchanged", () => {
  test("a stale expectedTemplateUpdatedAt is rejected and nothing is written", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("stale"));
    const seed = await seedGraph(templateId);
    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "staleness 테스트" }, seed.updatedAt);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    const historyBefore = await loadHistory(templateId);
    const stale = new Date(new Date(edited.updatedAt).getTime() - 60_000).toISOString();
    const result = await undoProcedureTemplateChange(templateId, superAdminId, stale);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const historyAfter = await loadHistory(templateId);
    assert.equal(historyAfter.length, historyBefore.length, "no new history row on a rejected stale Undo");
    assert.equal((await loadNode(seed.nodeAId)).title, "staleness 테스트", "the graph must be untouched");
  });
});

describe("M. unauthorized rejection leaves graph/history unchanged", () => {
  test("AS_ENGINEER/SALES/INVENTORY_MANAGER cannot Undo, and nothing is written", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("unauthorized"));
    const seed = await seedGraph(templateId);
    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "권한 테스트" }, seed.updatedAt);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    const historyBefore = await loadHistory(templateId);
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const result = await undoProcedureTemplateChange(templateId, actorId, edited.updatedAt);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
    const historyAfter = await loadHistory(templateId);
    assert.equal(historyAfter.length, historyBefore.length);
    assert.equal((await loadNode(seed.nodeAId)).title, "권한 테스트");
  });
});

describe("Authorization regression (item 8)", () => {
  test("ADMIN and SUPER_ADMIN can Undo a TECHNICAL_TASK DRAFT", async () => {
    for (const actorId of [adminId, superAdminId]) {
      const templateId = await createTechnicalDraft(uniqueCode("authz-ok"));
      const seed = await seedGraph(templateId, actorId);
      const edited = await updateProcedureTemplateNode(seed.nodeAId, actorId, { title: "권한 허용 테스트" }, seed.updatedAt);
      assert.equal(edited.ok, true, JSON.stringify(edited));
      if (!edited.ok) continue;
      const result = await undoProcedureTemplateChange(templateId, actorId, edited.updatedAt);
      assert.equal(result.ok, true, JSON.stringify(result));
    }
  });

  test("FULL_SERVICE is hard-denied, including SUPER_ADMIN", async () => {
    const code = uniqueCode("authz-full-service");
    const imported = await createDraftProcedureTemplateFromImport(makeFullServiceFixture(code), superAdminId, { sourceFileName: "undo-redo-fixture.xlsx", sourceFileHash: `hash-${code}` });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    createdTemplateIds.push(imported.id);
    const row = await loadTemplateRow(imported.id);
    const result = await undoProcedureTemplateChange(imported.id, superAdminId, row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("REFERENCE is denied", async () => {
    const templateId = await createReferenceDraft(uniqueCode("authz-reference"));
    const row = await loadTemplateRow(templateId);
    const result = await undoProcedureTemplateChange(templateId, superAdminId, row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("a PUBLISHED TECHNICAL_TASK template is denied", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("authz-published"));
    const seed = await seedGraph(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));
    const row = await loadTemplateRow(templateId);
    const result = await undoProcedureTemplateChange(templateId, superAdminId, row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
    void seed;
  });
});
