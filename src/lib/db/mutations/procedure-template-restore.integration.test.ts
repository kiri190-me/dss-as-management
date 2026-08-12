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
  changeProcedureTemplateNodeType,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  saveProcedureTemplateLayout,
  deleteProcedureTemplateNode,
  deleteProcedureTemplateEdge,
  insertProcedureTemplateNodeOnEdge,
} from "./procedure-template-editor";
import { undoProcedureTemplateChange, redoProcedureTemplateChange } from "./procedure-template-undo-redo";
import { restoreProcedureTemplateChange } from "./procedure-template-restore";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";

/**
 * Phase 5C-5C — server-core Historical Restore integration tests. Same
 * self-cleaning convention as procedure-template-undo-redo.integration.
 * test.ts. Restore-picker UI is out of scope here.
 */

const TEST_CODE_PREFIX = "test-restore-";

let superAdminId: string;
let adminId: string;
let asEngineerId: string;
let salesId: string;
let inventoryManagerId: string;

const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

async function createTechnicalDraft(code: string, name = `Restore 테스트 ${code}`, actorId = superAdminId) {
  const result = await createManualTechnicalProcedureTemplate({ code, name, equipmentType: "COMMON" }, actorId);
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
    description: "Phase 5C-5C restore integration test fixture",
    sourceWorksheets: ["(TEST) restore 시트"],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: "(TEST) restore 시트", sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "END", title: "종료", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: "(TEST) restore 시트", sourceShapeId: "2" },
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
    .values({ code, name: `참조 템플릿 테스트 ${code}`, equipmentType: "COMMON", category: "REFERENCE", isReferenceOnly: true, status: "DRAFT", version: 1, sourceType: "MANUAL", createdByUserId: superAdminId })
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
  return db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId)).orderBy(procedureTemplateEditHistory.sequenceNumber);
}

async function lastGroupId(templateId: string): Promise<string> {
  const history = await loadHistory(templateId);
  return history[history.length - 1].changeGroupId;
}

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

describe("A. metadata restore", () => {
  test("rename to A, rename to B, Restore to A, Undo -> B, Redo -> A", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("metadata"));
    const row0 = await loadTemplateRow(templateId);

    const toA = await renameTechnicalProcedureTemplate(templateId, superAdminId, "A", row0.updatedAt.toISOString());
    assert.equal(toA.ok, true, JSON.stringify(toA));
    if (!toA.ok) return;
    const targetGroupId = await lastGroupId(templateId);

    const toB = await renameTechnicalProcedureTemplate(templateId, superAdminId, "B", toA.updatedAt);
    assert.equal(toB.ok, true, JSON.stringify(toB));
    if (!toB.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, toB.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.equal((await loadTemplateRow(templateId)).name, "A");

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, restored.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal((await loadTemplateRow(templateId)).name, "B", "Undo of the Restore must return to the exact pre-Restore state");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.equal((await loadTemplateRow(templateId)).name, "A", "Redo must reapply the same Restore atomically");
  });
});

describe("B. UPDATE_NODE restore", () => {
  test("edit node twice, Restore to the first edit point", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("update-node"));
    const seed = await seedGraph(templateId);

    const edit1 = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "edit1" }, seed.updatedAt);
    assert.equal(edit1.ok, true);
    if (!edit1.ok) return;
    const targetGroupId = await lastGroupId(templateId);

    const edit2 = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "edit2" }, edit1.updatedAt);
    assert.equal(edit2.ok, true);
    if (!edit2.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, edit2.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.equal((await loadNode(seed.nodeAId)).title, "edit1");
  });
});

describe("C. CREATE_NODE restore", () => {
  test("create node, later delete it, Restore to the point it existed recreates the SAME id", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-node"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드X" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const targetGroupId = await lastGroupId(templateId);
    const nodeId = created.nodeId;

    const deleted = await deleteProcedureTemplateNode(nodeId, superAdminId, null, created.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;
    assert.equal(await loadNode(nodeId), undefined);

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, deleted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const recreated = await loadNode(nodeId);
    assert.ok(recreated, "Restore must recreate the node with the SAME id");
    assert.equal(recreated.title, "노드X");
  });
});

describe("D. DELETE_NODE restore", () => {
  /**
   * Deliberately no UPDATE_NODE on the SAME node between its creation and
   * deletion: node_id is ON DELETE SET NULL, so any row that once
   * referenced this node (including an earlier property-edit row, whose
   * before/afterState never carries an id) loses its only identity signal
   * the moment the node is EVER deleted — regardless of how far in the
   * past that edit was. There is no snapshot to fall back on for that
   * action type (unlike CREATE_EDGE, whose full-snapshot DELETE_EDGE
   * content-match fallback exists) — a documented, currently-unresolved
   * gap (see procedure-template-restore.ts's own doc comment), not
   * exercised by this test.
   */
  test("Restore to the point before deletion recreates the SAME id", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-node"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "삭제 전 상태" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const nodeId = created.nodeId;
    const targetGroupId = await lastGroupId(templateId);

    // An unrelated, independent operation between the target point and the
    // deletion — confirms the restore reconstructs THIS node's exact state
    // rather than merely "whatever currently exists minus the delete".
    const other = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "무관한 노드" }, created.updatedAt);
    assert.equal(other.ok, true);
    if (!other.ok) return;

    const deleted = await deleteProcedureTemplateNode(nodeId, superAdminId, null, other.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, deleted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const recreated = await loadNode(nodeId);
    assert.ok(recreated, "Restore must recreate the node with the SAME id");
    assert.equal(recreated.title, "삭제 전 상태");
    assert.equal(await loadNode(other.nodeId), undefined, "the unrelated later-created node must not exist at this earlier target point");
  });
});

describe("E. CREATE_EDGE / DELETE_EDGE restore", () => {
  test("CREATE_EDGE: later delete it, Restore recreates the SAME id", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("create-edge"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);
    const edgeId = seed.edgeId;

    const deleted = await deleteProcedureTemplateEdge(edgeId, superAdminId, null, seed.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, deleted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const recreated = await loadEdge(edgeId);
    assert.ok(recreated, "Restore must recreate the edge with the SAME id");
    assert.equal(recreated.fromNodeId, seed.nodeAId);
    assert.equal(recreated.toNodeId, seed.nodeBId);
  });

  test("DELETE_EDGE: Restore to before deletion recreates the SAME id", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("delete-edge"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);

    const deleted = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, null, seed.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, deleted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.ok(await loadEdge(seed.edgeId), "Restore must recreate the edge with the SAME id");
  });
});

describe("F. UPDATE_EDGE / RETARGET_EDGE restore", () => {
  test("UPDATE_EDGE: Restore reverts branchType/branchLabel", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("update-edge"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);

    const edited = await updateProcedureTemplateEdge(seed.edgeId, superAdminId, { branchType: "CUSTOM", branchLabel: "특수" }, seed.updatedAt, "테스트");
    assert.equal(edited.ok, true, JSON.stringify(edited));
    if (!edited.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, edited.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const edge = await loadEdge(seed.edgeId);
    assert.equal(edge.branchType, "DEFAULT");
    assert.equal(edge.branchLabel, null);
  });

  test("RETARGET_EDGE: Restore reverts fromNodeId/toNodeId", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("retarget-edge"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);
    const n3 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드3" }, seed.updatedAt);
    assert.equal(n3.ok, true);
    if (!n3.ok) return;

    const retargeted = await retargetProcedureTemplateEdge(seed.edgeId, superAdminId, seed.nodeAId, n3.nodeId, "테스트 재대상", n3.updatedAt);
    assert.equal(retargeted.ok, true, JSON.stringify(retargeted));
    if (!retargeted.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, retargeted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.equal((await loadEdge(seed.edgeId)).toNodeId, seed.nodeBId, "Restore must revert to the original target node");
  });
});

describe("G. SAVE_LAYOUT / SAVE_EDGE_ROUTE restore", () => {
  test("Restore reverts a combined layout+route save", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("save-layout"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);

    const saved = await saveProcedureTemplateLayout(templateId, superAdminId, [{ nodeId: seed.nodeAId, x: 50, y: 60 }], [{ edgeId: seed.edgeId, points: [{ x: 1, y: 2 }] }], seed.updatedAt);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, saved.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const node = await loadNode(seed.nodeAId);
    const edge = await loadEdge(seed.edgeId);
    assert.equal(node.userPositionX, null);
    assert.equal(node.userPositionY, null);
    assert.equal(edge.userRoutePoints, null);
  });
});

describe("H. compound route-point split restore", () => {
  test("A->B, split A->NEW->B, later changes, Restore to pre-split -> A->B, Undo -> pre-restore state, Redo -> A->B", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("split"));
    const seed = await seedGraph(templateId);
    const preSplitGroupId = await lastGroupId(templateId);

    const split = await insertProcedureTemplateNodeOnEdge(seed.edgeId, superAdminId, { nodeType: "TASK", title: "삽입", position: { x: 5, y: 5 } }, seed.updatedAt);
    assert.equal(split.ok, true, JSON.stringify(split));
    if (!split.ok) return;

    const laterEdit = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "분할 후 편집" }, split.updatedAt);
    assert.equal(laterEdit.ok, true, JSON.stringify(laterEdit));
    if (!laterEdit.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, preSplitGroupId, laterEdit.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;

    let edgesNow = await loadEdges(templateId);
    assert.equal(edgesNow.length, 1, "back to a single A->B edge");
    assert.equal(edgesNow[0].id, seed.edgeId);
    assert.equal(edgesNow[0].toNodeId, seed.nodeBId);
    assert.equal(await loadNode(split.nodeId), undefined, "the split node must be gone");
    assert.equal((await loadNode(seed.nodeAId)).title, "노드1", "the later property edit must also be reverted by the restore");

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, restored.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    edgesNow = await loadEdges(templateId);
    assert.equal(edgesNow.length, 2, "Undo of the Restore must return to the exact pre-Restore state (A->NEW->B)");
    assert.ok(await loadNode(split.nodeId), "the split node must be back");
    assert.equal((await loadNode(seed.nodeAId)).title, "분할 후 편집", "the later property edit must also be back");

    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    edgesNow = await loadEdges(templateId);
    assert.equal(edgesNow.length, 1, "Redo must reapply the same Restore atomically -> back to A->B");
    assert.equal(await loadNode(split.nodeId), undefined);
  });
});

describe("I. Restore after prior Undo/Redo history", () => {
  test("restoring to an early point works correctly even after intervening Undo/Redo activity", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("after-undo-redo"));
    const templateRow = await loadTemplateRow(templateId);
    const a = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "A" }, templateRow.updatedAt.toISOString());
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const targetGroupId = await lastGroupId(templateId);

    const b = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "B" }, a.updatedAt);
    assert.equal(b.ok, true);
    if (!b.ok) return;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, b.updatedAt);
    assert.equal(undone.ok, true);
    if (!undone.ok) return;
    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true);
    if (!redone.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, redone.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    assert.ok(await loadNode(a.nodeId), "A must remain");
    assert.equal(await loadNode(b.nodeId), undefined, "B must be gone — restored to the point before B existed");
  });
});

describe("J. invalid target origins", () => {
  test("an UNDO group cannot be selected as a restore target", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("invalid-target"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, created.updatedAt);
    assert.equal(undone.ok, true);
    if (!undone.ok) return;
    const undoGroupId = await lastGroupId(templateId);

    const result = await restoreProcedureTemplateChange(templateId, superAdminId, undoGroupId, undone.updatedAt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_RESTORE_TARGET");
  });
});

describe("K. stale revision", () => {
  test("a stale expectedTemplateUpdatedAt is rejected atomically, with no mutation or history write", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("stale"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);
    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "staleness" }, seed.updatedAt);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    const historyBefore = await loadHistory(templateId);
    const stale = new Date(new Date(edited.updatedAt).getTime() - 60_000).toISOString();
    const result = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, stale);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STALE_REVISION");

    const historyAfter = await loadHistory(templateId);
    assert.equal(historyAfter.length, historyBefore.length);
    assert.equal((await loadNode(seed.nodeAId)).title, "staleness");
  });
});

describe("L. unauthorized/full-service/published rejection", () => {
  test("AS_ENGINEER/SALES/INVENTORY_MANAGER cannot Restore, with zero mutation/history", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("unauthorized"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);
    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "권한" }, seed.updatedAt);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    const historyBefore = await loadHistory(templateId);
    for (const actorId of [asEngineerId, salesId, inventoryManagerId]) {
      const result = await restoreProcedureTemplateChange(templateId, actorId, targetGroupId, edited.updatedAt);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
    const historyAfter = await loadHistory(templateId);
    assert.equal(historyAfter.length, historyBefore.length);
    assert.equal((await loadNode(seed.nodeAId)).title, "권한");
  });

  test("FULL_SERVICE is hard-denied, including SUPER_ADMIN", async () => {
    const code = uniqueCode("full-service");
    const imported = await createDraftProcedureTemplateFromImport(makeFullServiceFixture(code), superAdminId, { sourceFileName: "restore-fixture.xlsx", sourceFileHash: `hash-${code}` });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    createdTemplateIds.push(imported.id);
    const row = await loadTemplateRow(imported.id);
    const result = await restoreProcedureTemplateChange(imported.id, superAdminId, randomUUID(), row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("REFERENCE is denied", async () => {
    const templateId = await createReferenceDraft(uniqueCode("reference"));
    const row = await loadTemplateRow(templateId);
    const result = await restoreProcedureTemplateChange(templateId, superAdminId, randomUUID(), row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("a PUBLISHED TECHNICAL_TASK template is denied", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("published"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, JSON.stringify(published));
    const row = await loadTemplateRow(templateId);
    const result = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, row.updatedAt.toISOString());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_DRAFT");
  });
});

describe("M. Restore group metadata", () => {
  test("origin RESTORE, source_group_id NULL, restore_target_group_id = target, one shared change_group_id, deterministic sequence_number", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("group-metadata"));
    const seed = await seedGraph(templateId);
    const targetGroupId = await lastGroupId(templateId);

    const edited = await updateProcedureTemplateNode(seed.nodeAId, superAdminId, { title: "메타데이터 테스트" }, seed.updatedAt);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, edited.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;

    const history = await loadHistory(templateId);
    const restoreRows = history.filter((h) => h.origin === "RESTORE");
    assert.ok(restoreRows.length > 0);
    const groupIds = new Set(restoreRows.map((r) => r.changeGroupId));
    assert.equal(groupIds.size, 1, "all rows from this Restore share one change_group_id");
    for (const r of restoreRows) {
      assert.equal(r.sourceGroupId, null);
      assert.equal(r.restoreTargetGroupId, targetGroupId);
    }
    const seqNumbers = restoreRows.map((r) => r.sequenceNumber);
    assert.deepEqual(seqNumbers, [...seqNumbers].sort((a, b) => a - b), "sequence_number must be DB-generated and monotonically increasing");
  });
});

describe("Identity permanence: node edit -> delete -> restore", () => {
  test("UPDATE_NODE/CHANGE_NODE_TYPE rows lose node_id after a later delete, but Restore succeeds via the persisted JSON id and recreates the SAME UUID", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("identity-node"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "원본" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const nodeId = created.nodeId;

    const edited = await updateProcedureTemplateNode(nodeId, superAdminId, { title: "편집됨" }, created.updatedAt);
    assert.equal(edited.ok, true, JSON.stringify(edited));
    if (!edited.ok) return;

    const typeChanged = await changeProcedureTemplateNodeType(nodeId, superAdminId, "INSPECTION", null, edited.updatedAt);
    assert.equal(typeChanged.ok, true, JSON.stringify(typeChanged));
    if (!typeChanged.ok) return;
    const targetGroupId = await lastGroupId(templateId); // the CHANGE_NODE_TYPE group — after both edits, before the delete

    const deleted = await deleteProcedureTemplateNode(nodeId, superAdminId, null, typeChanged.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;

    // Confirm the exact gap this checkpoint fixes: the older UPDATE_NODE/
    // CHANGE_NODE_TYPE rows now have node_id = NULL (ON DELETE SET NULL,
    // migration 0017), yet their persisted JSON still carries the id.
    const historyRows = await loadHistory(templateId);
    const updateNodeRow = historyRows.find((h) => h.actionType === "UPDATE_NODE")!;
    const changeTypeRow = historyRows.find((h) => h.actionType === "CHANGE_NODE_TYPE")!;
    assert.ok(updateNodeRow);
    assert.ok(changeTypeRow);
    assert.equal(updateNodeRow.nodeId, null, "node_id must be NULL after the later delete");
    assert.equal(changeTypeRow.nodeId, null, "node_id must be NULL after the later delete");
    assert.equal((updateNodeRow.beforeState as { id: string }).id, nodeId);
    assert.equal((updateNodeRow.afterState as { id: string }).id, nodeId);
    assert.equal((changeTypeRow.beforeState as { id: string }).id, nodeId);
    assert.equal((changeTypeRow.afterState as { id: string }).id, nodeId);

    // No UNDO ever happened in this scenario, and UPDATE_NODE/CHANGE_NODE_TYPE
    // have no mirror/content-match fallback at all (only CREATE_EDGE does) —
    // a successful Restore here is only possible via the persisted JSON id.
    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, deleted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const recreated = await loadNode(nodeId);
    assert.ok(recreated, "Restore must recreate the node with the SAME original UUID");
    assert.equal(recreated.title, "편집됨", "the UPDATE_NODE edit must be correctly reflected");
    assert.equal(recreated.nodeType, "INSPECTION", "the CHANGE_NODE_TYPE edit must be correctly reflected");

    // Undo/Redo of the Restore itself must also still work.
    const undone = await undoProcedureTemplateChange(templateId, superAdminId, restored.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal(await loadNode(nodeId), undefined, "Undo of the Restore must return to the deleted state");
    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.ok(await loadNode(nodeId), "Redo must reapply the Restore atomically");
  });
});

describe("Identity permanence: edge edit -> delete -> restore", () => {
  test("UPDATE_EDGE/RETARGET_EDGE rows lose edge_id after a later delete, but Restore succeeds via the persisted JSON id and preserves the SAME UUID", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("identity-edge"));
    const seed = await seedGraph(templateId);
    const n3 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "노드3" }, seed.updatedAt);
    assert.equal(n3.ok, true);
    if (!n3.ok) return;

    const edited = await updateProcedureTemplateEdge(seed.edgeId, superAdminId, { branchType: "CUSTOM", branchLabel: "특수" }, n3.updatedAt, "테스트");
    assert.equal(edited.ok, true, JSON.stringify(edited));
    if (!edited.ok) return;

    const retargeted = await retargetProcedureTemplateEdge(seed.edgeId, superAdminId, seed.nodeAId, n3.nodeId, "테스트 재대상", edited.updatedAt);
    assert.equal(retargeted.ok, true, JSON.stringify(retargeted));
    if (!retargeted.ok) return;
    const targetGroupId = await lastGroupId(templateId); // the RETARGET_EDGE group — after both edits, before the delete

    const deleted = await deleteProcedureTemplateEdge(seed.edgeId, superAdminId, null, retargeted.updatedAt);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    if (!deleted.ok) return;

    const historyRows = await loadHistory(templateId);
    const updateEdgeRow = historyRows.find((h) => h.actionType === "UPDATE_EDGE")!;
    const retargetRow = historyRows.find((h) => h.actionType === "RETARGET_EDGE")!;
    assert.ok(updateEdgeRow);
    assert.ok(retargetRow);
    assert.equal(updateEdgeRow.edgeId, null, "edge_id must be NULL after the later delete");
    assert.equal(retargetRow.edgeId, null, "edge_id must be NULL after the later delete");
    assert.equal((updateEdgeRow.beforeState as { id: string }).id, seed.edgeId);
    assert.equal((retargetRow.afterState as { id: string }).id, seed.edgeId);

    // No UNDO ever happened, and UPDATE_EDGE/RETARGET_EDGE have no mirror/
    // content-match fallback (only CREATE_EDGE does) — success here is only
    // possible via the persisted JSON id, proving the fix, not a fallback.
    const restored = await restoreProcedureTemplateChange(templateId, superAdminId, targetGroupId, deleted.updatedAt);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    if (!restored.ok) return;
    const recreated = await loadEdge(seed.edgeId);
    assert.ok(recreated, "Restore must recreate the edge with the SAME original UUID");
    assert.equal(recreated.branchType, "CUSTOM");
    assert.equal(recreated.branchLabel, "특수");
    assert.equal(recreated.toNodeId, n3.nodeId, "the RETARGET_EDGE edit must be correctly reflected");

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, restored.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;
    assert.equal(await loadEdge(seed.edgeId), undefined, "Undo of the Restore must return to the deleted state");
    const redone = await redoProcedureTemplateChange(templateId, superAdminId, undone.updatedAt);
    assert.equal(redone.ok, true, JSON.stringify(redone));
    if (!redone.ok) return;
    assert.ok(await loadEdge(seed.edgeId), "Redo must reapply the Restore atomically");
  });
});
