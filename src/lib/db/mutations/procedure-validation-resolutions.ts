import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateValidationIssues,
  procedureValidationResolutionHistory,
  users,
} from "../schema";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { ProcedureBranchType, ProcedureValidationResolutionActionType } from "@/lib/domain/procedure-template-types";
import type { ExtractedValidationIssueRawEvidence } from "../../../../scripts/lib/xlsx/types";
import type { Role } from "@/lib/domain/types";

/**
 * Phase 3A validation-resolution mutations — bind an existing unbound
 * connector to an existing node, resolve/defer without touching the
 * graph, reopen, or roll back a bind. Deliberately narrow: no free-form
 * node creation, no drag-to-connect, no arbitrary edge creation — every
 * mutation here operates on nodes that already exist in the template.
 *
 * Local resolveEligibleActor/error-class copy of the one in
 * procedure-templates.ts, not a shared import — that file's
 * ProcedureTemplateMutationError is caught by its own try/catch using its
 * own ProcedureTemplateResult shape; reusing it here would mean a thrown
 * error from that file's `fail()` silently escaping this file's catch
 * block (different exception class), which is worse than 12 lines of
 * duplication.
 */

export type ValidationResolutionResultCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type ValidationResolutionResult =
  | { ok: true; issueId: string; edgeId?: string; historyId: string }
  | { ok: false; code: ValidationResolutionResultCode; message: string };

class ValidationResolutionMutationError extends Error {
  result: ValidationResolutionResult & { ok: false };
  constructor(result: ValidationResolutionResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ValidationResolutionResultCode, message: string): never {
  throw new ValidationResolutionMutationError({ ok: false, code, message });
}

type EligibleActor = { id: string; role: Role; isDeveloper: boolean };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resolveEligibleActor(tx: Tx, actorUserId: string): Promise<EligibleActor> {
  const [actor] = await tx
    .select({
      id: users.id,
      role: users.role,
      approvalStatus: users.approvalStatus,
      isActive: users.isActive,
      lockedAt: users.lockedAt,
      isDeleted: users.isDeleted,
      isDeveloper: users.isDeveloper,
    })
    .from(users)
    .where(eq(users.id, actorUserId));
  if (!actor || actor.isDeleted || actor.approvalStatus !== "APPROVED" || !actor.isActive || actor.lockedAt !== null) {
    fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
  return actor;
}

/** BIND_SOURCE/BIND_TARGET record which single endpoint was already known before the reviewer completed the connector; ADD_EDGE records that neither endpoint was known (both stCxnId/endCxnId missing, or a MISSING_OUTGOING_PATH issue with no underlying connector at all). */
function determineBindActionType(rawEvidence: ExtractedValidationIssueRawEvidence | null): ProcedureValidationResolutionActionType {
  const stKnown = !!rawEvidence?.stCxnId;
  const endKnown = !!rawEvidence?.endCxnId;
  if (stKnown && !endKnown) return "BIND_TARGET";
  if (!stKnown && endKnown) return "BIND_SOURCE";
  return "ADD_EDGE";
}

const GRAPH_CHANGE_ACTION_TYPES: ProcedureValidationResolutionActionType[] = [
  "ADD_EDGE",
  "BIND_SOURCE",
  "BIND_TARGET",
  "RETARGET_EDGE",
];

export type BindValidationIssueEdgeInput = {
  sourceNodeId: string;
  targetNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel?: string | null;
  resolutionNote: string;
};

/**
 * Completes an unbound connector (or, for a MISSING_OUTGOING_PATH issue
 * with no drawn connector at all, adds the missing edge outright) by
 * inserting a real procedure_template_edges row and marking the issue
 * RESOLVED_WITH_GRAPH_CHANGE. Never silently picks a node — both
 * sourceNodeId/targetNodeId always come from an explicit reviewer choice
 * in the UI, even when one was pre-filled from the top-ranked candidate.
 */
export async function bindValidationIssueEdge(
  issueId: string,
  actorUserId: string,
  input: BindValidationIssueEdgeInput
): Promise<ValidationResolutionResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!(await hasPermission(actor, "technicalProcedures.validation", "WRITE"))) {
        fail("FORBIDDEN", "검증 이슈 해결 권한이 없습니다 (SUPER_ADMIN 전용).");
      }
      if (!input.resolutionNote || input.resolutionNote.trim().length === 0) {
        fail("VALIDATION_ERROR", "해결 메모는 필수입니다.");
      }
      if (input.sourceNodeId === input.targetNodeId) {
        fail("VALIDATION_ERROR", "자기 자신으로의 분기는 이 화면에서 지원하지 않습니다.");
      }

      const [issue] = await tx
        .select()
        .from(procedureTemplateValidationIssues)
        .where(eq(procedureTemplateValidationIssues.id, issueId))
        .for("update");
      if (!issue) fail("NOT_FOUND", "해당 검증 이슈를 찾을 수 없습니다.");
      if (issue.resolutionStatus !== "UNRESOLVED") {
        fail("CONFLICT", "이미 처리된 이슈입니다 (다른 검토자가 먼저 처리했을 수 있습니다).");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, issue.procedureTemplateId), eq(procedureTemplates.isDeleted, false)))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (template.status !== "DRAFT") {
        fail("CONFLICT", "초안(DRAFT) 상태의 템플릿에서만 검증 이슈를 해결할 수 있습니다.");
      }

      const nodes = await tx
        .select()
        .from(procedureTemplateNodes)
        .where(inArray(procedureTemplateNodes.id, [input.sourceNodeId, input.targetNodeId]));
      const sourceNode = nodes.find((n) => n.id === input.sourceNodeId);
      const targetNode = nodes.find((n) => n.id === input.targetNodeId);
      if (!sourceNode || !targetNode) fail("NOT_FOUND", "선택한 노드를 찾을 수 없습니다.");
      if (sourceNode.procedureTemplateId !== issue.procedureTemplateId || targetNode.procedureTemplateId !== issue.procedureTemplateId) {
        fail("VALIDATION_ERROR", "선택한 노드가 이 이슈의 템플릿에 속하지 않습니다.");
      }

      const [existingEdge] = await tx
        .select({ id: procedureTemplateEdges.id })
        .from(procedureTemplateEdges)
        .where(
          and(
            eq(procedureTemplateEdges.procedureTemplateId, issue.procedureTemplateId),
            eq(procedureTemplateEdges.fromNodeId, input.sourceNodeId),
            eq(procedureTemplateEdges.toNodeId, input.targetNodeId)
          )
        )
        .limit(1);
      if (existingEdge) fail("CONFLICT", "동일한 시작→대상 분기가 이미 존재합니다.");

      const [maxSortRow] = await tx
        .select({ sortOrder: procedureTemplateEdges.sortOrder })
        .from(procedureTemplateEdges)
        .where(eq(procedureTemplateEdges.procedureTemplateId, issue.procedureTemplateId))
        .orderBy(desc(procedureTemplateEdges.sortOrder))
        .limit(1);
      const nextSortOrder = (maxSortRow?.sortOrder ?? -1) + 1;

      const [insertedEdge] = await tx
        .insert(procedureTemplateEdges)
        .values({
          procedureTemplateId: issue.procedureTemplateId,
          fromNodeId: input.sourceNodeId,
          toNodeId: input.targetNodeId,
          branchType: input.branchType,
          branchLabel: input.branchLabel ?? null,
          sortOrder: nextSortOrder,
          sourceConnectorId: null,
        })
        .returning({ id: procedureTemplateEdges.id });

      const rawEvidence = (issue.rawEvidence as ExtractedValidationIssueRawEvidence | null) ?? null;
      const actionType = determineBindActionType(rawEvidence);

      const beforeState = { resolutionStatus: issue.resolutionStatus };
      const afterState = {
        resolutionStatus: "RESOLVED_WITH_GRAPH_CHANGE",
        edge: {
          id: insertedEdge.id,
          fromNodeId: input.sourceNodeId,
          toNodeId: input.targetNodeId,
          branchType: input.branchType,
          branchLabel: input.branchLabel ?? null,
        },
      };

      await tx
        .update(procedureTemplateValidationIssues)
        .set({
          resolutionStatus: "RESOLVED_WITH_GRAPH_CHANGE",
          resolvedAt: new Date(),
          resolvedByUserId: actor.id,
          resolutionNote: input.resolutionNote,
        })
        .where(eq(procedureTemplateValidationIssues.id, issueId));

      const [historyRow] = await tx
        .insert(procedureValidationResolutionHistory)
        .values({
          validationIssueId: issueId,
          procedureTemplateId: issue.procedureTemplateId,
          actionType,
          beforeState,
          afterState,
          selectedNodeId: targetNode.id,
          affectedEdgeId: insertedEdge.id,
          branchType: input.branchType,
          note: input.resolutionNote,
          actorUserId: actor.id,
        })
        .returning({ id: procedureValidationResolutionHistory.id });

      return { ok: true, issueId, edgeId: insertedEdge.id, historyId: historyRow.id };
    });
  } catch (err) {
    if (err instanceof ValidationResolutionMutationError) return err.result;
    throw err;
  }
}

export type ResolveWithoutGraphChangeInput = {
  outcome: "RESOLVED_NO_CHANGE" | "DEFERRED";
  resolutionNote: string;
  businessConfirmationReference?: string | null;
};

/**
 * The 4 preset buttons the UI offers ("문제없음으로 확인" / "원본 절차가
 * 단일 경로임" / "장식 도형으로 확인" / "업무 확인 필요로 보류") are canned
 * starting text for resolutionNote — only two real outcome values exist
 * here, DEFERRED is the one that keeps blocking publication (see
 * publishProcedureTemplate's resolution_status check).
 */
export async function resolveValidationIssueWithoutGraphChange(
  issueId: string,
  actorUserId: string,
  input: ResolveWithoutGraphChangeInput
): Promise<ValidationResolutionResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!(await hasPermission(actor, "technicalProcedures.validation", "WRITE"))) {
        fail("FORBIDDEN", "검증 이슈 해결 권한이 없습니다 (SUPER_ADMIN 전용).");
      }
      if (!input.resolutionNote || input.resolutionNote.trim().length === 0) {
        fail("VALIDATION_ERROR", "해결 메모는 필수입니다.");
      }

      const [issue] = await tx
        .select()
        .from(procedureTemplateValidationIssues)
        .where(eq(procedureTemplateValidationIssues.id, issueId))
        .for("update");
      if (!issue) fail("NOT_FOUND", "해당 검증 이슈를 찾을 수 없습니다.");
      if (issue.resolutionStatus !== "UNRESOLVED") {
        fail("CONFLICT", "이미 처리된 이슈입니다 (다른 검토자가 먼저 처리했을 수 있습니다).");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, issue.procedureTemplateId), eq(procedureTemplates.isDeleted, false)))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (template.status !== "DRAFT") {
        fail("CONFLICT", "초안(DRAFT) 상태의 템플릿에서만 검증 이슈를 해결할 수 있습니다.");
      }

      const note = input.businessConfirmationReference
        ? `${input.resolutionNote}\n[업무 확인 참조: ${input.businessConfirmationReference}]`
        : input.resolutionNote;
      const beforeState = { resolutionStatus: issue.resolutionStatus };

      await tx
        .update(procedureTemplateValidationIssues)
        .set({
          resolutionStatus: input.outcome,
          resolvedAt: new Date(),
          resolvedByUserId: actor.id,
          resolutionNote: note,
        })
        .where(eq(procedureTemplateValidationIssues.id, issueId));

      const [historyRow] = await tx
        .insert(procedureValidationResolutionHistory)
        .values({
          validationIssueId: issueId,
          procedureTemplateId: issue.procedureTemplateId,
          actionType: input.outcome === "DEFERRED" ? "DEFER" : "MARK_NO_CHANGE",
          beforeState,
          afterState: { resolutionStatus: input.outcome },
          note,
          actorUserId: actor.id,
        })
        .returning({ id: procedureValidationResolutionHistory.id });

      return { ok: true, issueId, historyId: historyRow.id };
    });
  } catch (err) {
    if (err instanceof ValidationResolutionMutationError) return err.result;
    throw err;
  }
}

/**
 * SUPER_ADMIN only. Sets the issue back to UNRESOLVED — never touches any
 * edge (see rollbackValidationIssueEdge for that, a deliberately separate
 * action). Only valid while the template is still DRAFT.
 */
export async function reopenValidationIssue(issueId: string, actorUserId: string, input: { note: string }): Promise<ValidationResolutionResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!(await hasPermission(actor, "technicalProcedures.validation", "WRITE"))) {
        fail("FORBIDDEN", "재검토 재개 권한이 없습니다 (SUPER_ADMIN 전용).");
      }
      if (!input.note || input.note.trim().length === 0) {
        fail("VALIDATION_ERROR", "재검토 재개 사유는 필수입니다.");
      }

      const [issue] = await tx
        .select()
        .from(procedureTemplateValidationIssues)
        .where(eq(procedureTemplateValidationIssues.id, issueId))
        .for("update");
      if (!issue) fail("NOT_FOUND", "해당 검증 이슈를 찾을 수 없습니다.");
      if (issue.resolutionStatus === "UNRESOLVED") {
        fail("CONFLICT", "이미 미해결 상태입니다.");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, issue.procedureTemplateId), eq(procedureTemplates.isDeleted, false)))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (template.status !== "DRAFT") {
        fail("CONFLICT", "초안(DRAFT) 상태의 템플릿만 재검토를 재개할 수 있습니다.");
      }

      const beforeState = {
        resolutionStatus: issue.resolutionStatus,
        resolvedAt: issue.resolvedAt,
        resolvedByUserId: issue.resolvedByUserId,
        resolutionNote: issue.resolutionNote,
      };

      await tx
        .update(procedureTemplateValidationIssues)
        .set({ resolutionStatus: "UNRESOLVED", resolvedAt: null, resolvedByUserId: null, resolutionNote: null })
        .where(eq(procedureTemplateValidationIssues.id, issueId));

      const [historyRow] = await tx
        .insert(procedureValidationResolutionHistory)
        .values({
          validationIssueId: issueId,
          procedureTemplateId: issue.procedureTemplateId,
          actionType: "REOPEN",
          beforeState,
          afterState: { resolutionStatus: "UNRESOLVED" },
          note: input.note,
          actorUserId: actor.id,
        })
        .returning({ id: procedureValidationResolutionHistory.id });

      return { ok: true, issueId, historyId: historyRow.id };
    });
  } catch (err) {
    if (err instanceof ValidationResolutionMutationError) return err.result;
    throw err;
  }
}

/**
 * Separate, explicit action from reopenValidationIssue — reopening alone
 * never deletes an edge. Only valid once the issue is UNRESOLVED again
 * (i.e. after a reopen) and its most recent graph-changing history row
 * still has a live affected_edge_id.
 */
export async function rollbackValidationIssueEdge(issueId: string, actorUserId: string, input: { note: string }): Promise<ValidationResolutionResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!(await hasPermission(actor, "technicalProcedures.validation", "WRITE"))) {
        fail("FORBIDDEN", "분기 되돌리기 권한이 없습니다 (SUPER_ADMIN 전용).");
      }
      if (!input.note || input.note.trim().length === 0) {
        fail("VALIDATION_ERROR", "되돌리기 사유는 필수입니다.");
      }

      const [issue] = await tx
        .select()
        .from(procedureTemplateValidationIssues)
        .where(eq(procedureTemplateValidationIssues.id, issueId))
        .for("update");
      if (!issue) fail("NOT_FOUND", "해당 검증 이슈를 찾을 수 없습니다.");
      if (issue.resolutionStatus !== "UNRESOLVED") {
        fail("CONFLICT", "먼저 재검토를 재개(reopen)한 뒤에만 되돌리기를 할 수 있습니다.");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, issue.procedureTemplateId), eq(procedureTemplates.isDeleted, false)))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (template.status !== "DRAFT") {
        fail("CONFLICT", "초안(DRAFT) 상태의 템플릿에서만 되돌리기를 할 수 있습니다.");
      }

      const [lastGraphChange] = await tx
        .select()
        .from(procedureValidationResolutionHistory)
        .where(
          and(
            eq(procedureValidationResolutionHistory.validationIssueId, issueId),
            inArray(procedureValidationResolutionHistory.actionType, GRAPH_CHANGE_ACTION_TYPES)
          )
        )
        .orderBy(desc(procedureValidationResolutionHistory.createdAt))
        .limit(1);
      if (!lastGraphChange || !lastGraphChange.affectedEdgeId) {
        fail("CONFLICT", "되돌릴 그래프 변경 이력을 찾을 수 없습니다 (분기가 이미 제거되었거나 그래프 변경 없이 해결된 이슈입니다).");
      }

      const [edge] = await tx
        .select()
        .from(procedureTemplateEdges)
        .where(eq(procedureTemplateEdges.id, lastGraphChange.affectedEdgeId))
        .for("update");
      if (!edge) fail("CONFLICT", "되돌릴 분기가 이미 존재하지 않습니다.");

      const beforeState = {
        edge: { id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, branchType: edge.branchType, branchLabel: edge.branchLabel },
      };

      await tx.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edge.id));

      const [historyRow] = await tx
        .insert(procedureValidationResolutionHistory)
        .values({
          validationIssueId: issueId,
          procedureTemplateId: issue.procedureTemplateId,
          actionType: "ROLLBACK_EDGE",
          beforeState,
          afterState: { edgeDeleted: true },
          affectedEdgeId: null,
          note: input.note,
          actorUserId: actor.id,
        })
        .returning({ id: procedureValidationResolutionHistory.id });

      return { ok: true, issueId, historyId: historyRow.id };
    });
  } catch (err) {
    if (err instanceof ValidationResolutionMutationError) return err.result;
    throw err;
  }
}
