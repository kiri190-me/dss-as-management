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
  procedureTemplateValidationIssues,
  procedureValidationResolutionHistory,
  users,
} from "../schema";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate } from "./procedure-templates";
import {
  bindValidationIssueEdge,
  resolveValidationIssueWithoutGraphChange,
  reopenValidationIssue,
  rollbackValidationIssueEdge,
} from "./procedure-validation-resolutions";
import {
  canViewProcedureValidationManagement,
  canResolveProcedureValidationIssues,
} from "@/lib/auth/procedure-template-authorization";
import { classifyKnownValidationIssue } from "@/lib/domain/procedure-validation-known-issues";
import { combineShapeGraphSheets } from "../../../../scripts/lib/xlsx/combine-shape-graph-sheets";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { LoadedSheet } from "../../../../scripts/lib/xlsx/workbook-loader";
import type { DrawingAnchor } from "../../../../scripts/lib/xlsx/ooxml-parser";

/**
 * Real-DB integration tests for the Phase 3A validation-resolution
 * mutation layer. Synthetic fixtures only, no dependency on the real
 * workbook — same convention as procedure-templates.integration.test.ts.
 * Self-cleaning via TEST_CODE_PREFIX; after() removes history rows before
 * issues/templates (procedure_validation_resolution_history.
 * validation_issue_id is onDelete:"restrict").
 */

const TEST_CODE_PREFIX = "test-valres-";

let superAdminId: string;
let nonSuperAdminId: string;
let asEngineerId: string;

const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

function makeBindableTemplate(code: string): ExtractedTemplate {
  return {
    code,
    name: `테스트 검증 해결 템플릿 ${code}`,
    equipmentType: "RFG",
    description: "통합 테스트용 합성 템플릿",
    sourceWorksheets: ["(TEST) 가상 시트"],
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "TASK", title: "노드1", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "노드2", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "TASK", title: "노드3", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: "(TEST) 가상 시트", sourceShapeId: "3" },
    ],
    edges: [],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [
      {
        severity: "ERROR",
        issueType: "DANGLING_CONNECTOR",
        message: "테스트용 댕글링 커넥터 (connector#c1)",
        sourceWorksheet: "(TEST) 가상 시트",
        sourceReference: "connector#c1",
        rawEvidence: {
          connectorId: "c1",
          stCxnId: "1",
          endCxnId: null,
          from: { col: 0, row: 0 },
          to: { col: 1, row: 0 },
          headType: "none",
          tailType: "triangle",
          toCandidates: [{ shapeId: "2", text: "노드2", distance: 1.0 }],
        },
      },
    ],
  };
}

async function importTemplate(code: string): Promise<{ templateId: string; issueId: string }> {
  const result = await createDraftProcedureTemplateFromImport(makeBindableTemplate(code), superAdminId, {
    sourceFileName: "test-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(result.ok, true, `import failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdTemplateIds.push(result.id);

  const [issue] = await db
    .select({ id: procedureTemplateValidationIssues.id })
    .from(procedureTemplateValidationIssues)
    .where(eq(procedureTemplateValidationIssues.procedureTemplateId, result.id));
  return { templateId: result.id, issueId: issue.id };
}

async function getNodeIdByShape(templateId: string, sourceShapeId: string): Promise<string> {
  const [node] = await db
    .select({ id: procedureTemplateNodes.id })
    .from(procedureTemplateNodes)
    .where(and(eq(procedureTemplateNodes.procedureTemplateId, templateId), eq(procedureTemplateNodes.sourceShapeId, sourceShapeId)));
  return node.id;
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
  const allTestTemplates = await db
    .select({ id: procedureTemplates.id })
    .from(procedureTemplates)
    .where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  if (allIds.length > 0) {
    const issueRows = await db
      .select({ id: procedureTemplateValidationIssues.id })
      .from(procedureTemplateValidationIssues)
      .where(inArray(procedureTemplateValidationIssues.procedureTemplateId, allIds));
    const issueIds = issueRows.map((i) => i.id);
    if (issueIds.length > 0) {
      await db.delete(procedureValidationResolutionHistory).where(inArray(procedureValidationResolutionHistory.validationIssueId, issueIds));
    }
    await db.delete(procedureTemplateValidationIssues).where(inArray(procedureTemplateValidationIssues.procedureTemplateId, allIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("authorization", () => {
  test("1. unauthorized roles cannot view validation management", () => {
    assert.equal(canViewProcedureValidationManagement("SUPER_ADMIN"), true);
    assert.equal(canViewProcedureValidationManagement("ADMIN"), true);
    assert.equal(canViewProcedureValidationManagement("AS_ENGINEER"), false);
    assert.equal(canViewProcedureValidationManagement("SALES"), false);
    assert.equal(canViewProcedureValidationManagement("INVENTORY_MANAGER"), false);
  });

  test("resolution mutation capability is SUPER_ADMIN only", () => {
    assert.equal(canResolveProcedureValidationIssues("SUPER_ADMIN"), true);
    assert.equal(canResolveProcedureValidationIssues("ADMIN"), false);
    assert.equal(canResolveProcedureValidationIssues("AS_ENGINEER"), false);
  });

  test("2. an unauthorized (non-SUPER_ADMIN) user cannot resolve an issue", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("unauthorized"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const result = await bindValidationIssueEdge(issueId, nonSuperAdminId, {
      sourceNodeId: n1,
      targetNodeId: n2,
      branchType: "DEFAULT",
      resolutionNote: "권한 없는 시도",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
  });

  test("2b. AS_ENGINEER cannot resolve an issue either", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("unauthorized-engineer"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const result = await bindValidationIssueEdge(issueId, asEngineerId, {
      sourceNodeId: n1,
      targetNodeId: n2,
      branchType: "DEFAULT",
      resolutionNote: "권한 없는 시도",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
  });

  test("3. an inactive user cannot resolve, even with the SUPER_ADMIN role", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("inactive-actor"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");

    await db.update(users).set({ isActive: false }).where(eq(users.id, superAdminId));
    try {
      const result = await bindValidationIssueEdge(issueId, superAdminId, {
        sourceNodeId: n1,
        targetNodeId: n2,
        branchType: "DEFAULT",
        resolutionNote: "비활성 계정 시도",
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    } finally {
      await db.update(users).set({ isActive: true }).where(eq(users.id, superAdminId));
    }
  });

  test("3b. a locked user cannot resolve", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("locked-actor"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");

    await db.update(users).set({ lockedAt: new Date() }).where(eq(users.id, superAdminId));
    try {
      const result = await bindValidationIssueEdge(issueId, superAdminId, {
        sourceNodeId: n1,
        targetNodeId: n2,
        branchType: "DEFAULT",
        resolutionNote: "잠긴 계정 시도",
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    } finally {
      await db.update(users).set({ lockedAt: null }).where(eq(users.id, superAdminId));
    }
  });
});

describe("bindValidationIssueEdge", () => {
  test("7. binds a missing target endpoint successfully and marks the issue RESOLVED_WITH_GRAPH_CHANGE", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("bind-target"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");

    const result = await bindValidationIssueEdge(issueId, superAdminId, {
      sourceNodeId: n1,
      targetNodeId: n2,
      branchType: "DEFAULT",
      resolutionNote: "connector#c1을 노드2로 바인딩",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const [issueRow] = await db.select().from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.id, issueId));
    assert.equal(issueRow.resolutionStatus, "RESOLVED_WITH_GRAPH_CHANGE");
    assert.ok(issueRow.resolvedAt);
    assert.equal(issueRow.resolvedByUserId, superAdminId);

    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
    assert.equal(edges.length, 1);
    assert.equal(edges[0].fromNodeId, n1);
    assert.equal(edges[0].toNodeId, n2);
    assert.equal(edges[0].branchType, "DEFAULT");
  });

  test("8. binds a missing source endpoint successfully (BIND_SOURCE action type recorded)", async () => {
    const code = uniqueCode("bind-source");
    const template = makeBindableTemplate(code);
    // flip the fixture: endCxnId known, stCxnId missing
    template.issues[0].rawEvidence = {
      connectorId: "c1",
      stCxnId: null,
      endCxnId: "2",
      from: { col: 0, row: 0 },
      to: { col: 1, row: 0 },
      fromCandidates: [{ shapeId: "1", text: "노드1", distance: 1.0 }],
    };
    const result = await createDraftProcedureTemplateFromImport(template, superAdminId, { sourceFileName: "test.xlsx", sourceFileHash: `hash-${code}` });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    createdTemplateIds.push(result.id);
    const [issue] = await db.select({ id: procedureTemplateValidationIssues.id }).from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.procedureTemplateId, result.id));

    const n1 = await getNodeIdByShape(result.id, "1");
    const n2 = await getNodeIdByShape(result.id, "2");
    const bindResult = await bindValidationIssueEdge(issue.id, superAdminId, {
      sourceNodeId: n1,
      targetNodeId: n2,
      branchType: "DEFAULT",
      resolutionNote: "connector#c1의 시작점을 노드1로 바인딩",
    });
    assert.equal(bindResult.ok, true, JSON.stringify(bindResult));
    if (!bindResult.ok) return;

    const [historyRow] = await db.select().from(procedureValidationResolutionHistory).where(eq(procedureValidationResolutionHistory.validationIssueId, issue.id));
    assert.equal(historyRow.actionType, "BIND_SOURCE");
  });

  test("9. a duplicate (fromNodeId, toNodeId) edge is rejected", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("duplicate-edge"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const n3 = await getNodeIdByShape(templateId, "3");

    // pre-seed the exact edge the bind would create
    await db.insert(procedureTemplateEdges).values({ procedureTemplateId: templateId, fromNodeId: n1, toNodeId: n2, branchType: "DEFAULT", sortOrder: 0 });

    const result = await bindValidationIssueEdge(issueId, superAdminId, {
      sourceNodeId: n1,
      targetNodeId: n2,
      branchType: "DEFAULT",
      resolutionNote: "이미 존재하는 분기 시도",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");

    // sanity: a genuinely different pair still works fine afterward
    const otherResult = await bindValidationIssueEdge(issueId, superAdminId, {
      sourceNodeId: n1,
      targetNodeId: n3,
      branchType: "DEFAULT",
      resolutionNote: "다른 분기는 정상 동작",
    });
    assert.equal(otherResult.ok, true, JSON.stringify(otherResult));
  });

  test("10. a node from another template is rejected", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("cross-template-a"));
    const { templateId: otherTemplateId } = await importTemplate(uniqueCode("cross-template-b"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const foreignNode = await getNodeIdByShape(otherTemplateId, "2");

    const result = await bindValidationIssueEdge(issueId, superAdminId, {
      sourceNodeId: n1,
      targetNodeId: foreignNode,
      branchType: "DEFAULT",
      resolutionNote: "다른 템플릿의 노드 시도",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("self-edge is rejected outright", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("self-edge"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const result = await bindValidationIssueEdge(issueId, superAdminId, {
      sourceNodeId: n1,
      targetNodeId: n1,
      branchType: "DEFAULT",
      resolutionNote: "자기 자신 분기 시도",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("a missing resolution note is rejected", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("missing-note"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const result = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "  " });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("11. two concurrent resolution attempts on the same issue: exactly one succeeds, the other is rejected", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("concurrent"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const n3 = await getNodeIdByShape(templateId, "3");

    const [resultA, resultB] = await Promise.all([
      bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "동시 시도 A" }),
      bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n3, branchType: "DEFAULT", resolutionNote: "동시 시도 B" }),
    ]);
    const outcomes = [resultA, resultB];
    assert.equal(outcomes.filter((r) => r.ok).length, 1, "exactly one of the two concurrent attempts must succeed");
    assert.equal(outcomes.filter((r) => !r.ok).length, 1);
    const failed = outcomes.find((r) => !r.ok);
    if (failed && !failed.ok) assert.equal(failed.code, "CONFLICT");
  });

  test("12. an already-resolved issue cannot be resolved a second time", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("double-resolve"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const n3 = await getNodeIdByShape(templateId, "3");

    const first = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "첫 처리" });
    assert.equal(first.ok, true);

    const second = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n3, branchType: "DEFAULT", resolutionNote: "두번째 처리 시도" });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "CONFLICT");
  });

  test("4. a PUBLISHED template's issues cannot be modified (bind rejected once published)", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("published-immutable"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");

    const bindResult = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "게시 전 해결" });
    assert.equal(bindResult.ok, true);

    const publishResult = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(publishResult.ok, true, JSON.stringify(publishResult));

    const reopenResult = await reopenValidationIssue(issueId, superAdminId, { note: "게시된 템플릿 재검토 시도" });
    assert.equal(reopenResult.ok, false);
    if (!reopenResult.ok) assert.equal(reopenResult.code, "CONFLICT");
  });
});

describe("resolveValidationIssueWithoutGraphChange", () => {
  test("13. marks an issue RESOLVED_NO_CHANGE with no edge created", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("no-change"));
    const result = await resolveValidationIssueWithoutGraphChange(issueId, superAdminId, {
      outcome: "RESOLVED_NO_CHANGE",
      resolutionNote: "장식 도형으로 확인",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [issueRow] = await db.select().from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.id, issueId));
    assert.equal(issueRow.resolutionStatus, "RESOLVED_NO_CHANGE");
    assert.ok(issueRow.resolvedAt);

    const edges = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
    assert.equal(edges.length, 0);
  });

  test("15. a RESOLVED_NO_CHANGE ERROR no longer blocks publication", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("no-change-publish"));
    const resolveResult = await resolveValidationIssueWithoutGraphChange(issueId, superAdminId, { outcome: "RESOLVED_NO_CHANGE", resolutionNote: "문제없음으로 확인" });
    assert.equal(resolveResult.ok, true);

    const publishResult = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(publishResult.ok, true, JSON.stringify(publishResult));
  });

  test("14. a DEFERRED ERROR continues to block publication", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("deferred-publish"));
    const resolveResult = await resolveValidationIssueWithoutGraphChange(issueId, superAdminId, { outcome: "DEFERRED", resolutionNote: "업무 확인 필요로 보류" });
    assert.equal(resolveResult.ok, true);

    const publishResult = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(publishResult.ok, false);
    if (!publishResult.ok) assert.equal(publishResult.code, "HAS_UNRESOLVED_ERRORS");
  });
});

describe("reopen and rollback", () => {
  test("16. bind writes an audit-history row with the correct action type and note", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("history-bind"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const result = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "NG", branchLabel: "NG", resolutionNote: "이력 검증용" });
    assert.equal(result.ok, true);

    const history = await db.select().from(procedureValidationResolutionHistory).where(eq(procedureValidationResolutionHistory.validationIssueId, issueId));
    assert.equal(history.length, 1);
    assert.equal(history[0].actionType, "BIND_TARGET");
    assert.equal(history[0].note, "이력 검증용");
    assert.equal(history[0].branchType, "NG");
    assert.equal(history[0].actorUserId, superAdminId);
    assert.ok(history[0].affectedEdgeId);
  });

  test("17/18. reopen writes history and does not silently remove the edge; a separate rollback then removes it and writes its own history row", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("reopen-rollback"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");

    const bindResult = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "초기 해결" });
    assert.equal(bindResult.ok, true);
    if (!bindResult.ok) return;

    const reopenResult = await reopenValidationIssue(issueId, superAdminId, { note: "재검토 필요 판단" });
    assert.equal(reopenResult.ok, true, JSON.stringify(reopenResult));

    const [issueAfterReopen] = await db.select().from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.id, issueId));
    assert.equal(issueAfterReopen.resolutionStatus, "UNRESOLVED");
    assert.equal(issueAfterReopen.resolvedAt, null);

    // the edge must still exist — reopening alone never removes it
    const edgesAfterReopen = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, bindResult.edgeId!));
    assert.equal(edgesAfterReopen.length, 1);

    const historyAfterReopen = await db.select().from(procedureValidationResolutionHistory).where(eq(procedureValidationResolutionHistory.validationIssueId, issueId));
    assert.equal(historyAfterReopen.length, 2);
    assert.ok(historyAfterReopen.some((h) => h.actionType === "REOPEN"));

    const rollbackResult = await rollbackValidationIssueEdge(issueId, superAdminId, { note: "결정 철회 — 다른 대상이 맞음" });
    assert.equal(rollbackResult.ok, true, JSON.stringify(rollbackResult));

    const edgesAfterRollback = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, bindResult.edgeId!));
    assert.equal(edgesAfterRollback.length, 0, "the edge must be gone after an explicit rollback");

    const historyAfterRollback = await db.select().from(procedureValidationResolutionHistory).where(eq(procedureValidationResolutionHistory.validationIssueId, issueId));
    assert.equal(historyAfterRollback.length, 3);
    assert.ok(historyAfterRollback.some((h) => h.actionType === "ROLLBACK_EDGE"));
    // template still DRAFT throughout — never published
    const [templateRow] = await db.select({ status: procedureTemplates.status }).from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
    assert.equal(templateRow.status, "DRAFT");
  });

  test("rollback without a prior reopen is rejected", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("rollback-without-reopen"));
    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    const bindResult = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "해결됨" });
    assert.equal(bindResult.ok, true);

    const rollbackResult = await rollbackValidationIssueEdge(issueId, superAdminId, { note: "재검토 없이 되돌리기 시도" });
    assert.equal(rollbackResult.ok, false);
    if (!rollbackResult.ok) assert.equal(rollbackResult.code, "CONFLICT");
  });
});

describe("known-issue classification never gates a mutation (Group 2 / Group 3 safety)", () => {
  test("20/21. classification is display-only — bind/resolve mutations require the same explicit input regardless of confidence or group", async () => {
    // A MEDIUM-confidence (Group 2) real signature and a LOW-confidence
    // (Group 3) real signature both classify successfully...
    const mediumClassification = classifyKnownValidationIssue({
      templateCode: "rfg-full-lifecycle",
      sourceWorksheet: "(RFG) (5)통전검사(3상입력)",
      issueType: "DANGLING_CONNECTOR",
      sourceReference: "connector#274",
    });
    assert.equal(mediumClassification?.confidence, "MEDIUM");
    const lowClassification = classifyKnownValidationIssue({
      templateCode: "mb-full-lifecycle",
      sourceWorksheet: "(MB) 출하완료",
      issueType: "DANGLING_CONNECTOR",
      sourceReference: "connector#11",
    });
    assert.equal(lowClassification?.confidence, "LOW");

    // ...but neither classification is ever consulted by the mutation layer:
    // a synthetic issue with no known classification at all still requires
    // full explicit sourceNodeId/targetNodeId/resolutionNote, and nothing
    // auto-applies just because a classification would exist for the real
    // issue with the same shape.
    const { issueId, templateId } = await importTemplate(uniqueCode("classification-unused"));
    const missingFieldsResult = await bindValidationIssueEdge(issueId, superAdminId, {
      sourceNodeId: "",
      targetNodeId: "",
      branchType: "DEFAULT",
      resolutionNote: "",
    });
    assert.equal(missingFieldsResult.ok, false);

    const n1 = await getNodeIdByShape(templateId, "1");
    const n2 = await getNodeIdByShape(templateId, "2");
    // even with valid nodes, an empty note is still rejected — no shortcut exists for any confidence tier.
    const emptyNoteResult = await bindValidationIssueEdge(issueId, superAdminId, { sourceNodeId: n1, targetNodeId: n2, branchType: "DEFAULT", resolutionNote: "" });
    assert.equal(emptyNoteResult.ok, false);
  });
});

describe("Group 1 deterministic fixture (end-to-end)", () => {
  function buildStage4LikeSheet(): LoadedSheet {
    const drawing: DrawingAnchor[] = [
      { kind: "shape", id: "50", name: "n50", descr: null, geom: "rect", text: "판단 노드", fill: null, from: { col: 0, row: 67 }, to: { col: 4, row: 70 } },
      { kind: "shape", id: "52", name: "n52", descr: null, geom: "rect", text: "NG 조치 노드", fill: null, from: { col: 0, row: 73 }, to: { col: 4, row: 76 } },
      // shape#58 is a legitimate flow node in its own right (connected via
      // c58 below to shape#59), matching the real workbook: connector#57's
      // target is not an orphan shape, it's a normal step that happens to
      // also be the nearest real content to connector#57's lost endpoint.
      { kind: "shape", id: "58", name: "n58", descr: null, geom: "rect", text: "정상 진행 노드", fill: null, from: { col: 0, row: 76 }, to: { col: 4, row: 79 } },
      { kind: "shape", id: "59", name: "n59", descr: null, geom: "rect", text: "다음 단계 노드", fill: null, from: { col: 0, row: 82 }, to: { col: 4, row: 85 } },
      { kind: "shape", id: "55", name: "lbl-ng", descr: null, geom: "rect", text: "NG", fill: "FF0000", from: { col: 2, row: 70 }, to: { col: 3, row: 71 } },
      { kind: "connector", id: "51", name: "c51", geom: "straightConnector1", stCxnId: "50", endCxnId: "52", headType: "none", tailType: "triangle", from: { col: 2, row: 70 }, to: { col: 2, row: 73 } },
      // c57 mirrors the real connector#57 defect: stCxnId known, endCxnId lost, geometric 'to' anchor lands right on shape#58.
      { kind: "connector", id: "57", name: "c57", geom: "straightConnector1", stCxnId: "50", endCxnId: null, headType: "none", tailType: "triangle", from: { col: 2, row: 70 }, to: { col: 2, row: 78 } },
      { kind: "connector", id: "58", name: "c58", geom: "straightConnector1", stCxnId: "58", endCxnId: "59", headType: "none", tailType: "triangle", from: { col: 2, row: 79 }, to: { col: 2, row: 82 } },
    ];
    return {
      name: "(TEST-GROUP1) 기본 정전 검사",
      sheetId: "9024",
      worksheetPath: "xl/worksheets/sheetGroup1.xml",
      drawingPath: "xl/drawings/drawingGroup1.xml",
      worksheet: { dimension: "A1:F100", merges: [], hyperlinks: [], cells: {} },
      drawing,
    };
  }

  test("19. the Group-1 pipeline (extract -> import -> bind) resolves the dangling connector using the ranked evidence", async () => {
    const code = uniqueCode("group1-e2e");
    const template = combineShapeGraphSheets([buildStage4LikeSheet()], {
      code,
      name: "테스트 Group 1 파이프라인",
      equipmentType: "RFG",
      description: "",
    });

    const dangling = template.issues.find((i) => i.issueType === "DANGLING_CONNECTOR");
    assert.ok(dangling, "expected the extractor to raise a DANGLING_CONNECTOR issue");
    assert.equal(dangling?.rawEvidence?.connectorId, "57");
    const topCandidate = dangling?.rawEvidence?.toCandidates?.[0];
    assert.equal(topCandidate?.shapeId, "58", "the geometrically nearest real shape must rank first");

    const result = await createDraftProcedureTemplateFromImport(template, superAdminId, { sourceFileName: "test.xlsx", sourceFileHash: `hash-${code}` });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    createdTemplateIds.push(result.id);

    const [issueRow] = await db
      .select()
      .from(procedureTemplateValidationIssues)
      .where(and(eq(procedureTemplateValidationIssues.procedureTemplateId, result.id), eq(procedureTemplateValidationIssues.issueType, "DANGLING_CONNECTOR")));
    const sourceNodeId = await getNodeIdByShape(result.id, "50");
    const targetNodeId = await getNodeIdByShape(result.id, "58");

    const bindResult = await bindValidationIssueEdge(issueRow.id, superAdminId, {
      sourceNodeId,
      targetNodeId,
      branchType: "DEFAULT",
      resolutionNote: "connector#57을 shape#58로 연결 (거리 기반 상위 후보 채택)",
    });
    assert.equal(bindResult.ok, true, JSON.stringify(bindResult));
  });
});

describe("queries", () => {
  test("5. listValidationIssuesForTemplate returns the correct unresolved/resolved/blocking summary", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("list-query"));
    const { listValidationIssuesForTemplate } = await import("../queries/procedure-validation-resolutions");

    const before = await listValidationIssuesForTemplate(templateId);
    assert.ok(before);
    assert.equal(before?.summary.totalErrorCount, 1);
    assert.equal(before?.summary.unresolvedErrorCount, 1);
    assert.equal(before?.summary.publicationBlockingErrorCount, 1);

    await resolveValidationIssueWithoutGraphChange(issueId, superAdminId, { outcome: "RESOLVED_NO_CHANGE", resolutionNote: "확인 완료" });

    const after = await listValidationIssuesForTemplate(templateId);
    assert.equal(after?.summary.unresolvedErrorCount, 0);
    assert.equal(after?.summary.resolvedErrorCount, 1);
    assert.equal(after?.summary.publicationBlockingErrorCount, 0);
  });

  test("6. getValidationIssueDetail returns ranked candidates annotated with live already-connected state", async () => {
    const { issueId, templateId } = await importTemplate(uniqueCode("candidate-query"));
    const { getValidationIssueDetail } = await import("../queries/procedure-validation-resolutions");

    const before = await getValidationIssueDetail(issueId);
    assert.ok(before);
    assert.equal(before?.toCandidates.length, 1);
    assert.equal(before?.toCandidates[0].shapeId, "2");
    assert.equal(before?.toCandidates[0].alreadyConnected, false);

    // connect shape#1 -> shape#3 (not the candidate) via a direct edge, to
    // prove "alreadyConnected" reflects live edges, not the static evidence.
    const n1 = await getNodeIdByShape(templateId, "1");
    const n3 = await getNodeIdByShape(templateId, "3");
    await db.insert(procedureTemplateEdges).values({ procedureTemplateId: templateId, fromNodeId: n1, toNodeId: n3, branchType: "DEFAULT", sortOrder: 0 });

    const after = await getValidationIssueDetail(issueId);
    assert.equal(after?.toCandidates[0].alreadyConnected, false, "shape#2 (the candidate) is still not connected to anything");
  });
});
