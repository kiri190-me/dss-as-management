import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { procedureTemplates, procedureTemplateNodes, procedureTemplateEdges, procedureTemplateEditHistory, users } from "../schema";
import { createManualTechnicalProcedureTemplate } from "../mutations/procedure-templates";
import { createProcedureTemplateNode, createProcedureTemplateEdge, insertProcedureTemplateNodeOnEdge } from "../mutations/procedure-template-editor";
import { undoProcedureTemplateChange } from "../mutations/procedure-template-undo-redo";
import { getProcedureTemplateHistoryView } from "./procedure-template-history";

/**
 * Phase 5C-5C UI — integration tests for the grouped-history read model
 * (canUndo/canRedo derivation from the pure fold, change_group_id
 * grouping, compound-operation single-group behavior, restore
 * eligibility). Same self-cleaning convention as the Undo/Redo/Restore
 * mutation integration tests.
 */

const TEST_CODE_PREFIX = "test-history-view-";

let superAdminId: string;
const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

async function createTechnicalDraft(code: string) {
  const result = await createManualTechnicalProcedureTemplate({ code, name: `이력 뷰 테스트 ${code}`, equipmentType: "COMMON" }, superAdminId);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  createdTemplateIds.push(result.id);
  return result.id;
}

async function loadTemplateRow(templateId: string) {
  const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
  return row;
}

before(async () => {
  const [superAdmin] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true))).limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;
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

describe("getProcedureTemplateHistoryView", () => {
  test("a template with no history has canUndo/canRedo both false and an empty group list", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("empty"));
    const view = await getProcedureTemplateHistoryView(templateId);
    assert.equal(view.groups.length, 0);
    assert.equal(view.canUndo, false);
    assert.equal(view.canRedo, false);
  });

  test("canUndo is true after one edit; canRedo becomes true only after an Undo, and a new edit clears it again", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("canundoredo"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "A" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const afterCreate = await getProcedureTemplateHistoryView(templateId);
    assert.equal(afterCreate.canUndo, true);
    assert.equal(afterCreate.canRedo, false);

    const undone = await undoProcedureTemplateChange(templateId, superAdminId, created.updatedAt);
    assert.equal(undone.ok, true, JSON.stringify(undone));
    if (!undone.ok) return;

    const afterUndo = await getProcedureTemplateHistoryView(templateId);
    assert.equal(afterUndo.canUndo, false, "the only forward group was just undone");
    assert.equal(afterUndo.canRedo, true);

    const templateRow2 = await loadTemplateRow(templateId);
    const created2 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "B" }, templateRow2.updatedAt.toISOString());
    assert.equal(created2.ok, true);
    if (!created2.ok) return;

    const afterDivergentEdit = await getProcedureTemplateHistoryView(templateId);
    assert.equal(afterDivergentEdit.canUndo, true);
    assert.equal(afterDivergentEdit.canRedo, false, "a new edit after Undo must naturally clear redo availability");
  });

  test("history groups by change_group_id — a compound route-point split renders as exactly one group with 3 rows, and eligibility/current-top are set correctly", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("compound"));
    const templateRow = await loadTemplateRow(templateId);
    const n1 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "A" }, templateRow.updatedAt.toISOString());
    assert.equal(n1.ok, true);
    if (!n1.ok) return;
    const n2 = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "B" }, n1.updatedAt);
    assert.equal(n2.ok, true);
    if (!n2.ok) return;
    const edge = await createProcedureTemplateEdge(templateId, superAdminId, { fromNodeId: n1.nodeId, toNodeId: n2.nodeId, branchType: "DEFAULT", reason: "연결" }, n2.updatedAt);
    assert.equal(edge.ok, true);
    if (!edge.ok) return;

    const split = await insertProcedureTemplateNodeOnEdge(edge.edgeId, superAdminId, { nodeType: "TASK", title: "삽입", position: { x: 0, y: 0 } }, edge.updatedAt);
    assert.equal(split.ok, true, JSON.stringify(split));
    if (!split.ok) return;

    const view = await getProcedureTemplateHistoryView(templateId);
    // 3 prior single-row USER_EDIT groups (n1, n2, edge) + 1 compound group (the split) = 4 groups total, never 6 flat rows.
    assert.equal(view.groups.length, 4);
    const splitGroup = view.groups[0]; // newest first
    assert.equal(splitGroup.rows.length, 3, "the compound split's 3 underlying rows must be ONE group");
    assert.deepEqual(
      splitGroup.rows.map((r) => r.actionType),
      ["CREATE_NODE", "RETARGET_EDGE", "CREATE_EDGE"]
    );
    assert.equal(splitGroup.origin, "USER_EDIT");
    assert.equal(splitGroup.isRestoreEligible, true, "a USER_EDIT group is a valid restore target");
    assert.equal(splitGroup.isCurrentTop, true, "the most recently applied group is top(appliedStack)");
    // every earlier group must NOT be marked current.
    for (const g of view.groups.slice(1)) assert.equal(g.isCurrentTop, false);
  });

  test("an UNDO-origin group is never restore-eligible", async () => {
    const templateId = await createTechnicalDraft(uniqueCode("undo-ineligible"));
    const templateRow = await loadTemplateRow(templateId);
    const created = await createProcedureTemplateNode(templateId, superAdminId, { nodeType: "TASK", title: "A" }, templateRow.updatedAt.toISOString());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const undone = await undoProcedureTemplateChange(templateId, superAdminId, created.updatedAt);
    assert.equal(undone.ok, true);
    if (!undone.ok) return;

    const view = await getProcedureTemplateHistoryView(templateId);
    const undoGroup = view.groups.find((g) => g.origin === "UNDO");
    assert.ok(undoGroup);
    assert.equal(undoGroup!.isRestoreEligible, false, "an UNDO group can never be selected as a restore target");
  });
});
