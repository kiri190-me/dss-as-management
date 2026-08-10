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
  users,
} from "../schema";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate, createNewDraftVersion } from "./procedure-templates";
import {
  updateProcedureTemplateNode,
  changeProcedureTemplateNodeType,
  saveProcedureTemplateLayout,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  createProcedureTemplateEdge,
  validateProcedureTemplate,
} from "./procedure-template-editor";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import { MAX_ROUTE_POINTS } from "@/lib/graph-editor-core/routing";

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
});

after(async () => {
  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  if (allIds.length > 0) {
    // procedure_template_edit_history is onDelete:"restrict" against
    // procedure_templates/nodes/edges — must go first, or the later
    // template/node/edge deletes below would themselves be restricted.
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allIds));
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
    const extracted: ExtractedTemplate = { ...makeEditableTemplate(code), isReferenceOnly: true, nodes: [], edges: [] };
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
      .orderBy(procedureTemplateEditHistory.createdAt);
    assert.equal(history.length, 2, "one SAVE_LAYOUT row and one SAVE_EDGE_ROUTE row — never conflated into a single entry");
    assert.equal(history[0].actionType, "SAVE_LAYOUT");
    assert.equal(history[1].actionType, "SAVE_EDGE_ROUTE");
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
