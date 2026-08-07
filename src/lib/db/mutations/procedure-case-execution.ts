import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import {
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionHistory,
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  repairCases,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import {
  canPerformOrdinaryExecutionMutation,
  canReopenCompletedOrSkippedNode,
  canReopenBlockedNode,
  isBlockedByCaseLock,
  type EffectiveAssigneeContext,
} from "@/lib/auth/procedure-case-execution-authorization";
import { isExecutableNodeType, isSystemEntryNodeType } from "@/lib/domain/procedure-execution-topology";
import type { ProcedureCaseExecutionActionType } from "@/lib/domain/procedure-case-execution-types";
import type { ProcedureNodeType } from "@/lib/domain/procedure-template-types";
import type { Role } from "@/lib/domain/types";

/**
 * Phase 5A — repair-case procedure execution mutations. Same conventions as
 * procedure-templates.ts / procedure-template-editor.ts:
 *  - re-checks the actor from the live DB (resolveEligibleActor, shared);
 *  - every write re-verifies its preconditions inside its own transaction,
 *    never trusting that the UI already checked them;
 *  - locks the row being mutated with `.for("update")`, then compares the
 *    caller's expected `version` against the freshly-locked row instead of
 *    a WHERE-clause race (same pattern as
 *    procedure-template-editor.ts's assertEditableDraft — the lock itself
 *    already serializes concurrent writers within the transaction window);
 *  - writes exactly one append-only procedure_case_execution_history row
 *    per mutation, in the same transaction as the state change;
 *  - locked-case behavior (repair_cases.is_locked) is unconditional for
 *    every role, including SUPER_ADMIN/ADMIN — no exception, no
 *    post-shipment correction path in Phase 5A (plan §11).
 */

export type ExecutionMutationResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "CONFLICT"
  | "TEMPLATE_NOT_EXECUTABLE"
  | "ALREADY_STARTED"
  | "INVALID_STATUS_TRANSITION"
  | "REASON_REQUIRED"
  | "DECISION_SELECTION_REQUIRED"
  | "INVALID_DECISION_SELECTION"
  | "INVALID_INPUT"
  | "SYSTEM_MANAGED_NODE";

type Failure = { ok: false; code: ExecutionMutationResultCode; message: string };

class ExecutionMutationError extends Error {
  result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ExecutionMutationResultCode, message: string): never {
  throw new ExecutionMutationError({ ok: false, code, message });
}

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

/** drizzle-orm wraps the driver's PostgresError (the original is on `.cause`) — check both, same convention as repair-cases.ts's isUniqueViolation. */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

async function requireActor(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

function assertNotLocked(repairCase: { isLocked: boolean }) {
  if (isBlockedByCaseLock(repairCase.isLocked)) {
    fail("CASE_LOCKED", "잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.");
  }
}

/**
 * START is a system entry marker, auto-completed at execution creation —
 * never a task an engineer starts/completes/skips/blocks/reopens or
 * annotates. Checked independently of the UI (which never renders action
 * controls for it in the first place) so a direct/malicious call against a
 * START node's id is rejected here too, not just hidden client-side.
 * nodeType is null for a case-specific extra task, which is never a
 * system-entry node, so this only ever fires for a real START row.
 */
function assertNotSystemEntryNode(nodeType: ProcedureNodeType | null): void {
  if (nodeType !== null && isSystemEntryNodeType(nodeType)) {
    fail("SYSTEM_MANAGED_NODE", "시작(START) 노드는 시스템이 자동으로 관리하며 직접 조작할 수 없습니다.");
  }
}

/** Lock check + role/assignment check for the common "ordinary mutation" tier (start execution, start/complete/skip/block a node, add an extra task, update a memo). */
function assertOrdinaryMutationAuthorized(
  actor: { id: string; role: Role },
  repairCase: { isLocked: boolean; assignedEngineerId: string | null },
  nodeAssignedEngineerId: string | null
): void {
  assertNotLocked(repairCase);
  const effectiveAssigneeId = nodeAssignedEngineerId ?? repairCase.assignedEngineerId;
  const assignment: EffectiveAssigneeContext = { effectiveAssigneeId, actorUserId: actor.id };
  if (!canPerformOrdinaryExecutionMutation(actor.role, assignment)) {
    fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }
}

async function insertHistory(
  tx: Tx,
  row: {
    executionId: string;
    executionNodeId?: string | null;
    actionType: ProcedureCaseExecutionActionType;
    beforeState?: unknown;
    afterState?: unknown;
    reason?: string | null;
    actorUserId: string;
  }
): Promise<void> {
  await tx.insert(procedureCaseExecutionHistory).values({
    executionId: row.executionId,
    executionNodeId: row.executionNodeId ?? null,
    actionType: row.actionType,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    reason: row.reason ?? null,
    actorUserId: row.actorUserId,
  });
}

// ---- 실행 시작 (start execution) ----

export type StartExecutionResult = { ok: true; executionId: string } | Failure;

export async function startProcedureExecution(
  repairCaseId: string,
  procedureTemplateId: string,
  actorUserId: string
): Promise<StartExecutionResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);

      const [repairCase] = await tx
        .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      assertOrdinaryMutationAuthorized(actor, repairCase, null);

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status, isReferenceOnly: procedureTemplates.isReferenceOnly })
        .from(procedureTemplates)
        .where(eq(procedureTemplates.id, procedureTemplateId));
      if (!template) fail("NOT_FOUND", "해당 절차 템플릿을 찾을 수 없습니다.");
      if (template.status !== "PUBLISHED" || template.isReferenceOnly) {
        fail("TEMPLATE_NOT_EXECUTABLE", "게시(PUBLISHED)된 실행 가능한 절차 템플릿만 실행을 시작할 수 있습니다.");
      }

      let executionId: string;
      try {
        const [inserted] = await tx
          .insert(procedureCaseExecutions)
          .values({ repairCaseId, procedureTemplateId, startedBy: actor.id })
          .returning({ id: procedureCaseExecutions.id });
        executionId = inserted.id;
      } catch (err) {
        if (isUniqueViolation(err)) {
          fail("ALREADY_STARTED", "이미 이 접수 건에 대해 실행 중인 절차가 있습니다.");
        }
        throw err;
      }

      const templateNodes = await tx
        .select({ id: procedureTemplateNodes.id, nodeType: procedureTemplateNodes.nodeType })
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, procedureTemplateId));

      // Classification per the Phase 5A plan §1: only executable node types
      // (everything except DOCUMENT_REFERENCE) get an execution-state row.
      const executableNodes = templateNodes.filter((n) => isExecutableNodeType(n.nodeType));

      const now = new Date();
      const nodeInsertValues = executableNodes.map((n) => {
        const isStart = n.nodeType === "START";
        return {
          executionId,
          procedureTemplateNodeId: n.id,
          status: (isStart ? "COMPLETED" : "PENDING") as "COMPLETED" | "PENDING",
          startedBy: isStart ? actor.id : null,
          startedAt: isStart ? now : null,
          completedBy: isStart ? actor.id : null,
          completedAt: isStart ? now : null,
        };
      });

      if (nodeInsertValues.length > 0) {
        await tx.insert(procedureCaseExecutionNodes).values(nodeInsertValues);
      }

      // EXECUTION_STARTED alone documents system initialization — no
      // per-node NODE_COMPLETED row for the auto-completed START node(s).
      // NODE_COMPLETED is a user-action audit entry; START's completion is
      // never a user action, and a stray NODE_COMPLETED row for it would
      // misleadingly suggest an engineer completed a task that was never
      // engineer-facing to begin with. autoCompletedSystemNodeCount keeps
      // this row self-descriptive about why the initial node set isn't
      // all-PENDING, without duplicating that fact into a second history
      // entry.
      const autoCompletedSystemNodeCount = nodeInsertValues.filter((row) => row.status === "COMPLETED").length;
      await insertHistory(tx, {
        executionId,
        actionType: "EXECUTION_STARTED",
        afterState: { procedureTemplateId, executableNodeCount: executableNodes.length, autoCompletedSystemNodeCount },
        actorUserId: actor.id,
      });

      return { ok: true, executionId };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- shared node-context loader ----

type LoadedExecutionNode = {
  node: typeof procedureCaseExecutionNodes.$inferSelect;
  execution: { id: string; repairCaseId: string; procedureTemplateId: string };
  repairCase: { id: string; isLocked: boolean; assignedEngineerId: string | null };
  nodeType: ProcedureNodeType | null;
};

async function loadExecutionNodeOrFail(tx: Tx, executionNodeId: string): Promise<LoadedExecutionNode> {
  const [node] = await tx
    .select()
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.id, executionNodeId))
    .for("update");
  if (!node) fail("NOT_FOUND", "해당 실행 항목을 찾을 수 없습니다.");

  const [execution] = await tx
    .select({
      id: procedureCaseExecutions.id,
      repairCaseId: procedureCaseExecutions.repairCaseId,
      procedureTemplateId: procedureCaseExecutions.procedureTemplateId,
    })
    .from(procedureCaseExecutions)
    .where(eq(procedureCaseExecutions.id, node.executionId));
  if (!execution) fail("NOT_FOUND", "해당 실행을 찾을 수 없습니다.");

  const [repairCase] = await tx
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, execution.repairCaseId), eq(repairCases.isDeleted, false)));
  if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  let nodeType: ProcedureNodeType | null = null;
  if (node.procedureTemplateNodeId) {
    const [templateNode] = await tx
      .select({ nodeType: procedureTemplateNodes.nodeType })
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.id, node.procedureTemplateNodeId));
    nodeType = templateNode?.nodeType ?? null;
  }

  return { node, execution, repairCase, nodeType };
}

export type ExecutionNodeMutationResult = { ok: true; version: number } | Failure;

// ---- 작업 시작 (start a node, with self-claim on first start) ----

export async function startExecutionNode(
  executionNodeId: string,
  actorUserId: string,
  expectedVersion: number
): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, executionNodeId);
      assertNotSystemEntryNode(ctx.nodeType);

      assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

      // Version staleness is checked first: under the row lock, a second
      // concurrent caller unblocks only after the first already committed,
      // so its in-memory expectedVersion is stale by the time it reaches
      // this point — reporting CONFLICT ("someone else changed this")
      // first is more accurate than INVALID_STATUS_TRANSITION, since the
      // caller's real mistake was acting on stale data, not an invalid
      // status by itself.
      if (ctx.node.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 작업을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (ctx.node.status !== "PENDING") {
        fail("INVALID_STATUS_TRANSITION", "대기 상태의 작업만 시작할 수 있습니다.");
      }

      // Self-claim on start: never assigns a third party, only the actor's own id.
      const selfClaim = ctx.node.assignedEngineerId === null;

      await tx
        .update(procedureCaseExecutionNodes)
        .set({
          status: "IN_PROGRESS",
          startedBy: actor.id,
          startedAt: new Date(),
          assignedEngineerId: selfClaim ? actor.id : ctx.node.assignedEngineerId,
          version: ctx.node.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(procedureCaseExecutionNodes.id, executionNodeId));

      await insertHistory(tx, {
        executionId: ctx.node.executionId,
        executionNodeId,
        actionType: "NODE_STARTED",
        afterState: selfClaim ? { assignedEngineerId: actor.id } : null,
        actorUserId: actor.id,
      });

      return { ok: true, version: ctx.node.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 작업 완료 (complete a node — DECISION nodes require a branch selection) ----

export type CompleteExecutionNodeInput = {
  executionNodeId: string;
  actorUserId: string;
  expectedVersion: number;
  selectedOutgoingEdgeId?: string | null;
  reason?: string | null;
};

export async function completeExecutionNode(input: CompleteExecutionNodeInput): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, input.executionNodeId);
      assertNotSystemEntryNode(ctx.nodeType);

      assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

      // Version checked before status — see startExecutionNode's comment.
      if (ctx.node.version !== input.expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 작업을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (ctx.node.status !== "PENDING" && ctx.node.status !== "IN_PROGRESS") {
        fail("INVALID_STATUS_TRANSITION", "대기 또는 진행 중인 작업만 완료할 수 있습니다.");
      }

      const isDecision = ctx.nodeType === "DECISION";
      const selectedOutgoingEdgeId = input.selectedOutgoingEdgeId ?? null;

      if (isDecision) {
        if (!selectedOutgoingEdgeId) {
          fail("DECISION_SELECTION_REQUIRED", "판단(DECISION) 작업을 완료하려면 분기를 선택해야 합니다.");
        }
        const [edge] = await tx
          .select({
            id: procedureTemplateEdges.id,
            procedureTemplateId: procedureTemplateEdges.procedureTemplateId,
            fromNodeId: procedureTemplateEdges.fromNodeId,
          })
          .from(procedureTemplateEdges)
          .where(eq(procedureTemplateEdges.id, selectedOutgoingEdgeId));
        if (
          !edge ||
          edge.procedureTemplateId !== ctx.execution.procedureTemplateId ||
          edge.fromNodeId !== ctx.node.procedureTemplateNodeId
        ) {
          fail("INVALID_DECISION_SELECTION", "선택한 분기가 이 판단 노드에서 시작하는 유효한 분기가 아닙니다.");
        }
      } else if (selectedOutgoingEdgeId) {
        fail("INVALID_INPUT", "판단(DECISION) 노드가 아닌 작업에는 분기를 선택할 수 없습니다.");
      }

      // A node completed directly from PENDING (never explicitly started)
      // still needs a startedAt/startedBy record — same "backfill on the
      // first status change that needs it" convention used by
      // skip/block/reopen below.
      const startedFields = ctx.node.startedAt === null ? { startedBy: actor.id, startedAt: new Date() } : {};

      await tx
        .update(procedureCaseExecutionNodes)
        .set({
          ...startedFields,
          status: "COMPLETED",
          completedBy: actor.id,
          completedAt: new Date(),
          selectedOutgoingEdgeId: isDecision ? selectedOutgoingEdgeId : null,
          lastActionReason: input.reason ?? null,
          version: ctx.node.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(procedureCaseExecutionNodes.id, input.executionNodeId));

      await insertHistory(tx, {
        executionId: ctx.node.executionId,
        executionNodeId: input.executionNodeId,
        actionType: "NODE_COMPLETED",
        afterState: isDecision ? { selectedOutgoingEdgeId } : null,
        reason: input.reason ?? null,
        actorUserId: actor.id,
      });

      return { ok: true, version: ctx.node.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 건너뛰기 / 차단 (skip / block — both require an explicit reason) ----

async function transitionToExceptionalStatus(
  tx: Tx,
  params: {
    executionNodeId: string;
    actor: { id: string; role: Role };
    ctx: LoadedExecutionNode;
    targetStatus: "SKIPPED" | "BLOCKED";
    expectedVersion: number;
    reason: string;
    actionType: ProcedureCaseExecutionActionType;
    reasonRequiredMessage: string;
  }
): Promise<number> {
  assertNotSystemEntryNode(params.ctx.nodeType);
  assertOrdinaryMutationAuthorized(params.actor, params.ctx.repairCase, params.ctx.node.assignedEngineerId);

  // Version checked before status — see startExecutionNode's comment.
  if (params.ctx.node.version !== params.expectedVersion) {
    fail("CONFLICT", "다른 사용자가 이 작업을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
  }
  if (params.ctx.node.status !== "PENDING" && params.ctx.node.status !== "IN_PROGRESS") {
    fail("INVALID_STATUS_TRANSITION", "대기 또는 진행 중인 작업만 상태를 변경할 수 있습니다.");
  }
  if (!params.reason || params.reason.trim().length === 0) {
    fail("REASON_REQUIRED", params.reasonRequiredMessage);
  }

  const startedFields = params.ctx.node.startedAt === null ? { startedBy: params.actor.id, startedAt: new Date() } : {};

  await tx
    .update(procedureCaseExecutionNodes)
    .set({
      ...startedFields,
      status: params.targetStatus,
      lastActionReason: params.reason,
      version: params.ctx.node.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(procedureCaseExecutionNodes.id, params.executionNodeId));

  await insertHistory(tx, {
    executionId: params.ctx.node.executionId,
    executionNodeId: params.executionNodeId,
    actionType: params.actionType,
    reason: params.reason,
    actorUserId: params.actor.id,
  });

  return params.ctx.node.version + 1;
}

export async function skipExecutionNode(
  executionNodeId: string,
  actorUserId: string,
  expectedVersion: number,
  reason: string
): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, executionNodeId);
      const version = await transitionToExceptionalStatus(tx, {
        executionNodeId,
        actor,
        ctx,
        targetStatus: "SKIPPED",
        expectedVersion,
        reason,
        actionType: "NODE_SKIPPED",
        reasonRequiredMessage: "건너뛰는 사유를 입력해 주세요.",
      });
      return { ok: true, version };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

export async function blockExecutionNode(
  executionNodeId: string,
  actorUserId: string,
  expectedVersion: number,
  reason: string
): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, executionNodeId);
      const version = await transitionToExceptionalStatus(tx, {
        executionNodeId,
        actor,
        ctx,
        targetStatus: "BLOCKED",
        expectedVersion,
        reason,
        actionType: "NODE_BLOCKED",
        reasonRequiredMessage: "차단 사유를 입력해 주세요.",
      });
      return { ok: true, version };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 재개(되돌림) (reopen — COMPLETED/SKIPPED require ADMIN+, BLOCKED also allows the assigned AS_ENGINEER) ----

export async function reopenExecutionNode(
  executionNodeId: string,
  actorUserId: string,
  expectedVersion: number,
  reason: string
): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, executionNodeId);
      assertNotSystemEntryNode(ctx.nodeType);

      assertNotLocked(ctx.repairCase);

      // Version checked before status — see startExecutionNode's comment.
      if (ctx.node.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 작업을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (ctx.node.status !== "COMPLETED" && ctx.node.status !== "SKIPPED" && ctx.node.status !== "BLOCKED") {
        fail("INVALID_STATUS_TRANSITION", "완료, 건너뜀 또는 차단 상태의 작업만 재개(되돌림)할 수 있습니다.");
      }
      if (!reason || reason.trim().length === 0) {
        fail("REASON_REQUIRED", "재개(되돌림) 사유를 입력해 주세요.");
      }

      const wasCompletedOrSkipped = ctx.node.status === "COMPLETED" || ctx.node.status === "SKIPPED";
      const assignment: EffectiveAssigneeContext = {
        effectiveAssigneeId: ctx.node.assignedEngineerId ?? ctx.repairCase.assignedEngineerId,
        actorUserId: actor.id,
      };
      const allowed = wasCompletedOrSkipped
        ? canReopenCompletedOrSkippedNode(actor.role)
        : canReopenBlockedNode(actor.role, assignment);
      if (!allowed) {
        fail("FORBIDDEN", "이 작업을 재개(되돌림)할 권한이 없습니다.");
      }

      const beforeStatus = ctx.node.status;
      const startedFields = ctx.node.startedAt === null ? { startedBy: actor.id, startedAt: new Date() } : {};
      const clearCompletion =
        beforeStatus === "COMPLETED" ? { completedBy: null, completedAt: null, selectedOutgoingEdgeId: null } : {};

      await tx
        .update(procedureCaseExecutionNodes)
        .set({
          ...startedFields,
          ...clearCompletion,
          status: "IN_PROGRESS",
          lastActionReason: reason,
          version: ctx.node.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(procedureCaseExecutionNodes.id, executionNodeId));

      await insertHistory(tx, {
        executionId: ctx.node.executionId,
        executionNodeId,
        actionType: "NODE_REOPENED",
        beforeState: { status: beforeStatus },
        afterState: { status: "IN_PROGRESS" },
        reason,
        actorUserId: actor.id,
      });

      return { ok: true, version: ctx.node.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 추가 작업 등록 (case-specific extra task — no template counterpart) ----

export type AddExtraTaskResult = { ok: true; executionNodeId: string } | Failure;

export async function addExecutionExtraTask(
  executionId: string,
  actorUserId: string,
  title: string,
  instructions: string | null
): Promise<AddExtraTaskResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);

      const [execution] = await tx
        .select({ id: procedureCaseExecutions.id, repairCaseId: procedureCaseExecutions.repairCaseId })
        .from(procedureCaseExecutions)
        .where(and(eq(procedureCaseExecutions.id, executionId), eq(procedureCaseExecutions.isDeleted, false)));
      if (!execution) fail("NOT_FOUND", "해당 실행을 찾을 수 없습니다.");

      const [repairCase] = await tx
        .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
        .from(repairCases)
        .where(and(eq(repairCases.id, execution.repairCaseId), eq(repairCases.isDeleted, false)));
      if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      // No node-level assignment override exists yet (the row doesn't
      // exist until this insert) — the effective assignee for authorizing
      // this action is the case's own assigned engineer only.
      assertOrdinaryMutationAuthorized(actor, repairCase, null);

      const trimmedTitle = title.trim();
      if (trimmedTitle.length === 0) {
        fail("INVALID_INPUT", "작업 제목을 입력해 주세요.");
      }

      const [inserted] = await tx
        .insert(procedureCaseExecutionNodes)
        .values({
          executionId,
          procedureTemplateNodeId: null,
          extraTaskTitle: trimmedTitle,
          extraTaskInstructions: instructions,
          status: "PENDING",
        })
        .returning({ id: procedureCaseExecutionNodes.id });

      await insertHistory(tx, {
        executionId,
        executionNodeId: inserted.id,
        actionType: "NODE_ADDED",
        afterState: { title: trimmedTitle, instructions },
        actorUserId: actor.id,
      });

      return { ok: true, executionNodeId: inserted.id };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 작업 메모 수정 (work-memo update — mutable current value + append-only history) ----

/**
 * Same trim + empty-to-null convention the server-action layer already
 * applies before calling this mutation (procedure-case-execution.ts
 * actions: `input.memo?.trim() || null`) — normalized here too so the
 * no-op comparison below is correct regardless of caller (every
 * *.integration.test.ts call goes straight to the mutation, bypassing the
 * action layer), and so the persisted value itself never carries
 * insignificant leading/trailing whitespace.
 */
function normalizeMemo(memo: string | null): string | null {
  if (memo === null) return null;
  const trimmed = memo.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function updateExecutionNodeMemo(
  executionNodeId: string,
  actorUserId: string,
  expectedVersion: number,
  newMemo: string | null
): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, executionNodeId);
      assertNotSystemEntryNode(ctx.nodeType);

      assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

      // Stale-version detection always takes priority over the no-op check
      // below — a caller acting on stale data must see CONFLICT even if
      // the value they're stale-resubmitting happens to match the current
      // one.
      if (ctx.node.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 작업을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }

      const normalizedBeforeMemo = normalizeMemo(ctx.node.workMemo);
      const normalizedNewMemo = normalizeMemo(newMemo);

      // No semantic change: return success without touching the row —
      // no version bump, no updated_at, no NODE_MEMO_UPDATED history. A
      // resubmit of the same content is not a real edit and must not
      // manufacture a phantom audit entry or invalidate other callers'
      // concurrency tokens.
      if (normalizedNewMemo === normalizedBeforeMemo) {
        return { ok: true, version: ctx.node.version };
      }

      await tx
        .update(procedureCaseExecutionNodes)
        .set({ workMemo: normalizedNewMemo, version: ctx.node.version + 1, updatedAt: new Date() })
        .where(eq(procedureCaseExecutionNodes.id, executionNodeId));

      await insertHistory(tx, {
        executionId: ctx.node.executionId,
        executionNodeId,
        actionType: "NODE_MEMO_UPDATED",
        beforeState: { memo: normalizedBeforeMemo },
        afterState: { memo: normalizedNewMemo },
        actorUserId: actor.id,
      });

      return { ok: true, version: ctx.node.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}
