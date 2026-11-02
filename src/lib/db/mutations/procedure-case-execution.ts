import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
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
  executionRequiresOwnAssignment,
  isBlockedByCaseLock,
  type EffectiveAssigneeContext,
} from "@/lib/auth/procedure-case-execution-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { actorMay } from "@/lib/auth/developer-promotion";
import { isExecutableNodeType, isSystemEntryNodeType } from "@/lib/domain/procedure-execution-topology";
import {
  classifyAutoAdvanceTarget,
  resolveAutoAdvanceTarget,
  type AutoAdvanceDecision,
} from "@/lib/domain/procedure-execution-focus";
import { assessExecutionFinish } from "@/lib/domain/procedure-execution-lifecycle";
import { classifyStartNode, type StartNodeRejectionReason } from "@/lib/domain/procedure-start-picker";
import { planNodeJump, type JumpRejectionReason } from "@/lib/domain/procedure-execution-jump";
import { resolveJumpPath } from "@/lib/domain/procedure-execution-path";
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
 *  - writes an append-only procedure_case_execution_history row for every
 *    state change, in the same transaction as the change itself. 🔴 완료
 *    (completeExecutionNode)만 **두 줄**이 될 수 있다 — 끝낸 줄
 *    (NODE_COMPLETED)과, 저절로 선 다음 노드의 줄(NODE_STARTED). 자동으로
 *    선 것도 사람이 나중에 「왜 이게 진행 중이지」를 되짚을 수 있어야 한다
 *    (자세한 것은 advanceToNextNode);
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
  | "SYSTEM_MANAGED_NODE"
  | "BILLING_DECISION_REQUIRED"
  /**
   * 이미 끝낸 실행을 또 끝내려 했다.
   *
   * 🔵 2026-11-02(조각 10)에 쓰는 자리가 하나 늘었다 — **마친 실행에서 「지금 할
   * 일」을 옮기려 한 경우**(jumpToExecutionNode). 새 코드를 만들지 않은 까닭은
   * 실제로 막은 사실이 둘 다 「이 실행은 이미 마쳤다」 하나이기 때문이다. 다시
   * 이으려면 [절차 다시 잇기]가 따로 있다(resumeProcedureExecution).
   */
  | "ALREADY_FINISHED"
  /**
   * 안 끝난 작업이 남았는데 「그래도 끝낸다」는 확인이 안 왔다.
   * 🔴 거절이 아니라 **물어보라는 신호**다 — 화면이 확인을 받고 다시 부른다.
   */
  | "UNFINISHED_NODES_REMAIN";

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
async function assertOrdinaryMutationAuthorized(
  actor: { id: string; role: Role; isDeveloper: boolean },
  repairCase: { isLocked: boolean; assignedEngineerId: string | null },
  nodeAssignedEngineerId: string | null
): Promise<void> {
  assertNotLocked(repairCase);

  // 역할은 설정이 정하고, "내 담당 건인가"는 종전대로 여기서 본다. 담당 조건은
  // 엔지니어에게만 붙는 것이라 맥락만으로는 답이 나오지 않는다.
  //
  // ⚠️ 승격은 **담당을 요구하는가**라는 역할 쪽 판정에만 더한다. 배정 사실
  // (isAssigned)은 손대지 않는다 — 개발자라고 해서 그 사람이 이 건에 배정된
  // 것이 되지는 않는다. 최고관리자는 담당을 요구받지 않으므로, 더한 결과
  // 개발자도 요구받지 않는다(「최고관리자 동급」).
  const effectiveAssigneeId = nodeAssignedEngineerId ?? repairCase.assignedEngineerId;
  const isAssigned = effectiveAssigneeId !== null && effectiveAssigneeId === actor.id;
  const assignmentOk = actorMay(actor, (role) => !executionRequiresOwnAssignment(role) || isAssigned);

  if (!assignmentOk || !(await hasPermission(actor, "repairCases.procedureExecution", "WRITE"))) {
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
    /**
     * 비워 두면 칸의 기본값(`now()`)이 쓰인다 — 거의 모든 자리가 그렇다.
     *
     * 🔴 넘기는 자리가 하나 있다: **한 트랜잭션이 이력 두 줄을 쓸 때.**
     * Postgres 의 `now()` 는 문장 시각이 아니라 **트랜잭션 시작 시각**이라,
     * 같은 트랜잭션에서 쓴 두 줄은 created_at 이 **글자 하나 다르지 않다.**
     * 이력 조회는 created_at 내림차순 하나로만 정렬하므로(getExecutionHistory),
     * 그러면 둘의 차례가 **정해지지 않는다** — 화면의 실행 이력에서 원인과
     * 결과가 새로고침할 때마다 자리를 바꿀 수 있다. 뒤따르는 줄에 아주 작은
     * 양수를 더해 차례를 못 박는다.
     */
    createdAt?: Date | SQL;
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
    ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
  });
}

/**
 * 한 트랜잭션이 이력 **두 줄**을 쓸 때, 뒤따르는 줄에 더하는 아주 작은 양수.
 * 까닭은 위 insertHistory 의 createdAt 주석에 있다 — Postgres 의 `now()` 는
 * 트랜잭션 시작 시각이라 같은 트랜잭션의 두 줄은 created_at 이 글자 하나 다르지
 * 않고, 이력 조회는 created_at 하나로만 정렬하므로 차례가 정해지지 않는다.
 *
 * 쓰는 자리는 둘이다:
 *  - 자동 전진(advanceToNextNode) — 완료 줄 **뒤**에 「저절로 섰다」가 와야 한다.
 *  - 중간부터 시작(startProcedureExecution) — 실행 시작 줄 **뒤**에 「거기서부터
 *    세웠다」가 와야 한다.
 *
 * 앱 시계(`new Date()`)로 바꾸지 않는 까닭은, 이 표의 다른 줄이 전부 DB 시계로
 * 적혀 있어서 한 줄만 다른 시계를 쓰면 **트랜잭션 사이의** 차례가 어긋날 수 있기
 * 때문이다.
 */
const FOLLOWING_HISTORY_AT = sql`now() + interval '1 millisecond'`;

/**
 * 한 트랜잭션이 이력을 **셋 이상** 쓸 때 쓰는 것 — 줄마다 다른 간격을 준다
 * (2026-11-02, 조각 11: 옮기기가 지나온 길의 줄 수만큼 NODE_COMPLETED 를 쓴다).
 * 위 FOLLOWING_HISTORY_AT 과 같은 까닭이고, 다른 것은 **몇 번째인가**뿐이다.
 *
 * 🔴 값을 sql 템플릿의 자리(`${}`)로 끼우지 않는다 — drizzle 이 그것을 바인딩
 * 자리($1)로 구워서, interval 글자 안에 들어가면 문장이 아예 안 선다. 그래서
 * 정수인지 확인하고 **글자 그대로** 넣는다(sql.raw).
 */
function followingHistoryAt(stepsAfterFirst: number): SQL {
  const safe = Math.max(0, Math.trunc(stepsAfterFirst));
  return sql.raw(`now() + interval '${safe} milliseconds'`);
}

/**
 * 중간부터 시작할 때, 화면이 보낸 노드를 거절하는 까닭 ↔ 이 변이의 결과 코드.
 *
 * 🔴 **새 코드를 만들지 않았다** — 세 까닭이 전부 이미 있는 코드에 그대로 들어맞는다.
 * (DB 의 action enum 도 마찬가지로 안 늘렸다 — 아래 NODE_STARTED 를 쓴다.)
 */
const START_AT_REJECTION_CODES: Record<StartNodeRejectionReason, ExecutionMutationResultCode> = {
  NOT_IN_TEMPLATE: "NOT_FOUND",
  SYSTEM_ENTRY: "SYSTEM_MANAGED_NODE",
  NO_EXECUTION_ROW: "INVALID_INPUT",
};

// ---- 실행 시작 (start execution) ----

export type StartExecutionResult = { ok: true; executionId: string } | Failure;

/**
 * `startAtTemplateNodeId` — **절차 중간부터 시작한다**(2026-11-02, 조각 7).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 앞의 노드를 건너뜀(SKIPPED)으로 만들지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 고른 노드 **하나만** 진행 중(IN_PROGRESS)으로 세우고 나머지는 전부 대기
 * (PENDING)다. 건너뜀은 「안 하기로 정했다」는 사람의 판정이고 사유가 따라붙는
 * 기록인데, 중간부터 시작한다고 해서 앞의 작업을 **안 하기로 정한 것은 아니다** —
 * 나중에 필요해지면 대기인 채로 남아 있어야 그때 할 수 있다. 안 한 것을 했다고
 * 적으면 되돌릴 길이 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 「어디서 시작했는가」를 따로 적는 칸이 없다 — 필요가 없다
 * ──────────────────────────────────────────────────────────────────────
 * 고른 노드가 진행 중이면 pickCurrentTask 가 그것을 「지금 할 일」로 고른다(진행
 * 중이 대기보다 먼저다). 흐름 띠도 거기를 가운데 둔다. 즉 **노드 상태만으로 다
 * 드러나므로** 마이그레이션이 필요 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 화면이 보낸 노드를 믿지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 이 절차의 노드인지, 시작(START) 표식은 아닌지, 실행 행이 생기는 종류인지를
 * **이 트랜잭션이 방금 읽은 템플릿 노드 목록**으로 다시 가른다(classifyStartNode —
 * 창이 쓰는 것과 같은 함수). 남의 절차 노드를 보내면 NOT_FOUND 다.
 */
export async function startProcedureExecution(
  repairCaseId: string,
  procedureTemplateId: string,
  actorUserId: string,
  startAtTemplateNodeId: string | null = null
): Promise<StartExecutionResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);

      const [repairCase] = await tx
        .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId, billingType: repairCases.billingType })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (repairCase.billingType === "PENDING_DECISION") {
        fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Procedure를 실행할 수 있습니다.");
      }

      await assertOrdinaryMutationAuthorized(actor, repairCase, null);

      const [template] = await tx
        .select({
          id: procedureTemplates.id,
          status: procedureTemplates.status,
          isReferenceOnly: procedureTemplates.isReferenceOnly,
          category: procedureTemplates.category,
        })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, procedureTemplateId), eq(procedureTemplates.isDeleted, false)));
      if (!template) fail("NOT_FOUND", "해당 절차 템플릿을 찾을 수 없습니다.");
      if (template.status !== "PUBLISHED" || template.isReferenceOnly) {
        fail("TEMPLATE_NOT_EXECUTABLE", "게시(PUBLISHED)된 실행 가능한 절차 템플릿만 실행을 시작할 수 있습니다.");
      }

      // 🔴 노드 목록을 **실행 행을 만들기 전에** 읽는다 — 중간부터 시작할 때
      // 고른 노드를 여기서 가려야 하기 때문이다. (거절하면 트랜잭션이 통째로
      // 되감기므로 차례 자체가 결과를 바꾸지는 않는다. 다만 「쓰기 전에 검사한다」는
      // 모양이 읽는 사람에게 분명하다.)
      const templateNodes = await tx
        .select({ id: procedureTemplateNodes.id, nodeType: procedureTemplateNodes.nodeType })
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, procedureTemplateId));

      if (startAtTemplateNodeId !== null) {
        const target = templateNodes.find((n) => n.id === startAtTemplateNodeId);
        // 🔴 못 찾았을 때 undefined 를 null 로 눕혀 넘긴다 — 「이 절차에 없다」도
        // classifyStartNode 가 함께 가르는 한 가지다(NOT_IN_TEMPLATE).
        const eligibility = classifyStartNode(target?.nodeType ?? null);
        if (!eligibility.ok) fail(START_AT_REJECTION_CODES[eligibility.reason], eligibility.message);
      }

      let executionId: string;
      try {
        // Phase 5C-5A — templateCategory is always this freshly-loaded DB
        // row's own category, never anything derived from caller input
        // (startProcedureExecution's only caller-supplied identifiers are
        // repairCaseId/procedureTemplateId — there is no category
        // parameter on this function at all, so there is nothing for a
        // client to spoof here even in principle).
        const [inserted] = await tx
          .insert(procedureCaseExecutions)
          .values({ repairCaseId, procedureTemplateId, templateCategory: template.category, startedBy: actor.id })
          .returning({ id: procedureCaseExecutions.id });
        executionId = inserted.id;
      } catch (err) {
        if (isUniqueViolation(err)) {
          fail("ALREADY_STARTED", "이미 이 접수 건에 대해 실행 중인 절차가 있습니다.");
        }
        throw err;
      }

      // Classification per the Phase 5A plan §1: only executable node types
      // (everything except DOCUMENT_REFERENCE) get an execution-state row.
      const executableNodes = templateNodes.filter((n) => isExecutableNodeType(n.nodeType));

      const now = new Date();
      const nodeInsertValues = executableNodes.map((n) => {
        const isStart = n.nodeType === "START";
        // 중간부터 시작 — 고른 그 한 줄만 진행 중이다. 🔴 앞의 줄들은 **대기
        // 그대로** 둔다(이 함수 머리말의 까닭).
        const isStartAt = startAtTemplateNodeId !== null && n.id === startAtTemplateNodeId;
        return {
          executionId,
          procedureTemplateNodeId: n.id,
          status: (isStart ? "COMPLETED" : isStartAt ? "IN_PROGRESS" : "PENDING") as "COMPLETED" | "IN_PROGRESS" | "PENDING",
          startedBy: isStart || isStartAt ? actor.id : null,
          startedAt: isStart || isStartAt ? now : null,
          completedBy: isStart ? actor.id : null,
          completedAt: isStart ? now : null,
        };
      });

      const insertedNodes =
        nodeInsertValues.length > 0
          ? await tx
              .insert(procedureCaseExecutionNodes)
              .values(nodeInsertValues)
              // 되받는 까닭 하나뿐 — 중간부터 시작한 줄의 **실행 노드 id** 가 있어야
              // 그 줄에 이력을 붙일 수 있다(아래 NODE_STARTED).
              .returning({ id: procedureCaseExecutionNodes.id, procedureTemplateNodeId: procedureCaseExecutionNodes.procedureTemplateNodeId })
          : [];

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
        afterState: {
          procedureTemplateId,
          executableNodeCount: executableNodes.length,
          autoCompletedSystemNodeCount,
          // 🔵 처음부터 시작한 실행에는 **아예 안 적는다.** null 을 적어 두면 지금까지
          // 쌓인 줄과 모양이 달라져서, 이력을 읽는 쪽이 「옛 줄은 왜 이 칸이 없지」를
          // 다시 설명해야 한다. 없음이 곧 처음부터다.
          ...(startAtTemplateNodeId === null ? {} : { startAtTemplateNodeId }),
        },
        actorUserId: actor.id,
      });

      // 🔴 새 action 값을 만들지 않는다 — enum 을 늘리는 것은 마이그레이션이다.
      // 이 행에 실제로 일어난 일은 「대기 → 진행 중」이고 그것이 NODE_STARTED 의
      // 뜻 그대로다(자동 전진이 쓴 것과 같은 판단). 사람이 [시작]을 눌러 선 것과
      // 가려내야 하므로 afterState 에 **중간부터 세운 것**임을 적는다 — 사람이 누른
      // NODE_STARTED 의 afterState 는 null 이거나 { assignedEngineerId } 뿐이고,
      // 자동 전진은 { autoAdvanced: true, … } 라 셋이 섞이지 않는다.
      const startedAtRow = insertedNodes.find((row) => row.procedureTemplateNodeId === startAtTemplateNodeId);
      if (startAtTemplateNodeId !== null && startedAtRow) {
        await insertHistory(tx, {
          executionId,
          executionNodeId: startedAtRow.id,
          actionType: "NODE_STARTED",
          afterState: { startedMidProcedure: true, procedureTemplateNodeId: startAtTemplateNodeId },
          actorUserId: actor.id,
          createdAt: FOLLOWING_HISTORY_AT,
        });
      }

      return { ok: true, executionId };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 실행 끝내기 · 다시 잇기 · 그만두기 (finish / resume / abandon — 실행 한 줄 자체를 다룬다) ----

/**
 * 실행 수준 조작(끝내기·다시 잇기·그만두기)이 쓰는 적재기.
 *
 * 노드 쪽(loadExecutionNodeOrFail)과 **두 가지가 다르다**:
 *
 *  1. 유·무상 미확정(PENDING_DECISION) 을 막지 않는다. 그 관문은 「유·무상을
 *     정하기 전에 **작업하지 마라**」는 뜻인데, 이 셋은 작업이 아니라 노드를 한
 *     줄도 안 건드리고 **실행 행의 칸 하나**를 여닫는 일이다. 여기서 막으면 잘못
 *     불러온 절차를 치우려 해도 유·무상부터 정해야 하는, 원래 불만(「바꿀 수가
 *     없다」)과 똑같은 막다른 길이 하나 더 생긴다.
 *  2. 이미 그만둔(is_deleted) 실행은 아예 못 찾는다 — 조회(getActiveExecution
 *     ForCase)와 같은 잣대다. 치운 실행에 다시 손대는 길을 남기지 않는다.
 *
 * 잠그는 것은 **실행 행 자신**이다. 노드 쪽과 달리 이 조작들은 노드를 한 줄도
 * 안 건드린다.
 */
async function loadExecutionForLifecycleOrFail(tx: Tx, executionId: string) {
  const [execution] = await tx
    .select()
    .from(procedureCaseExecutions)
    .where(and(eq(procedureCaseExecutions.id, executionId), eq(procedureCaseExecutions.isDeleted, false)))
    .for("update");
  if (!execution) fail("NOT_FOUND", "해당 실행을 찾을 수 없습니다.");

  // repair_case_id 는 nullable 이다(접수 건 영구 삭제 기반 작업) — 접수 건이
  // 사라진 과거 실행은 권한을 판정할 대상 자체가 없다. loadExecutionNodeOrFail
  // 의 같은 관문과 같은 까닭으로 여기서 깨끗이 거절한다.
  if (!execution.repairCaseId) fail("NOT_FOUND", "이 실행과 연결된 접수 건이 더 이상 존재하지 않습니다.");
  const executionRepairCaseId = execution.repairCaseId;

  const [repairCase] = await tx
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, executionRepairCaseId), eq(repairCases.isDeleted, false)));
  if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  return { execution, repairCase };
}

export type ExecutionLifecycleResult = { ok: true; version: number } | Failure;

/**
 * 실행을 **끝낸다** — procedure_case_executions.completed_at 을 채운다.
 *
 * 그 칸은 Phase 5A 때 만들어 두고 한 번도 채운 적이 없다(스키마 주석에 「5A 에는
 * 완료 기능이 없다」고 적혀 있다). 이 함수가 그것을 채우는 **첫 자리**다.
 *
 * 🔴 노드는 한 줄도 안 건드린다. 남은 대기 노드를 자동으로 완료·건너뜀으로
 * 바꾸지 않는다 — 안 한 일을 「했다」로 적는 것이고, 판단이 8할인 이 절차들에서
 * 안 가는 길의 노드는 원래 대기로 남는 것이 맞다. 「절차를 끝냈다」와 「그 노드를
 * 했다」는 서로 다른 사실이고, 둘을 섞으면 지나온 길이 거짓이 된다.
 *
 * 🔴 **남은 것이 있어도 끝낼 수 있다.** 다만 그때는 부르는 쪽이 사람에게 물은
 * 뒤 confirmedRemaining 을 실어 보내야 한다. 세는 자리는 화면과 공유한다
 * (assessExecutionFinish) — 화면만 묻게 두면 화면을 거치지 않는 호출이 아무것도
 * 안 묻고 끝낸다.
 *
 * ⚠️ **누가 끝냈는지는 안 남는다.** 이 표에는 completed_by 칸이 없고, 이력표의
 * action 값에도 실행 완료에 해당하는 것이 없다(EXECUTION_COMPLETED 는 Phase 5A
 * 에서 일부러 뺐다). 둘 중 하나라도 적으려면 마이그레이션이 필요하다 — 이 조각은
 * **이미 있는 칸만** 쓰기로 했으므로, 거짓으로 들어맞는 action 값(NODE_COMPLETED
 * 같은 것)을 빌려 쓰지 않는다. 빌려 쓰면 실행 이력에 「작업 완료」 한 줄이 노드
 * 없이 떠서, 나중에 읽는 사람이 없는 작업을 찾게 된다.
 */
export async function finishProcedureExecution(
  executionId: string,
  actorUserId: string,
  expectedVersion: number,
  confirmedRemaining: boolean
): Promise<ExecutionLifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const { execution, repairCase } = await loadExecutionForLifecycleOrFail(tx, executionId);

      await assertOrdinaryMutationAuthorized(actor, repairCase, null);

      // 버전을 상태보다 먼저 본다 — startExecutionNode 의 같은 주석 참고.
      if (execution.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 절차를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (execution.completedAt !== null) {
        fail("ALREADY_FINISHED", "이미 끝낸 절차입니다.");
      }

      const nodes = await tx
        .select({ status: procedureCaseExecutionNodes.status })
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.executionId, executionId));

      // 🔴 잠근 뒤에 **다시** 센다. 화면이 세어 보낸 수를 믿지 않는다 — 그 사이에
      // 남이 노드를 끝냈거나 막았을 수 있고, 사람이 본 「3개 남았습니다」가 이미
      // 옛말일 수 있다.
      const assessment = assessExecutionFinish(nodes);
      if (assessment.needsConfirmation && !confirmedRemaining) {
        fail("UNFINISHED_NODES_REMAIN", assessment.confirmationMessage ?? "아직 끝내지 않은 작업이 있습니다.");
      }

      const now = new Date();
      await tx
        .update(procedureCaseExecutions)
        .set({ completedAt: now, version: execution.version + 1, updatedAt: now })
        .where(eq(procedureCaseExecutions.id, executionId));

      return { ok: true, version: execution.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

/**
 * 실행을 **그만둔다** — 소프트 삭제 네 칸(is_deleted · deleted_at · deleted_by ·
 * delete_reason)을 채운다. DATABASE_DESIGN.md #8 의 규약 그대로다.
 *
 * 왜 필요한가: 한 접수 건에 FULL_SERVICE 실행은 하나뿐이라(partial unique
 * index), 절차를 잘못 고르면 **그 건에서는 바꿀 길이 아예 없었다.** 그래서 사람이
 * 시험 삼아 눌러 보기를 무서워했다.
 *
 * 🔴 노드도 이력도 **한 줄도 지우지 않는다.** 실행 행만 치운다 — 실제로 한 일은
 * 그대로 남아야 하고, 이력표는 append-only 다. 치운 뒤에는 조회가 이 실행을 못
 * 보므로(getActiveExecutionForCase 가 is_deleted 로 거른다) 화면에 「+ 기술 절차
 * 불러오기」가 다시 서고, 다른 절차를 고를 수 있게 된다.
 *
 * 🔴 **사유를 받는다.** 소프트 삭제 네 칸 가운데 delete_reason 을 비워 두면 나중에
 * 「잘못 불러와서 치운 것」과 「고객이 수리를 취소해서 멈춘 것」을 구별할 수단이
 * 아무 데도 없다 — 둘은 다음에 할 일이 정반대다. 같은 모듈의 건너뛰기·차단·재개가
 * 이미 전부 사유를 받으므로 받는 창도 검증도 이미 있다.
 *
 * ⚠️ 이력표에는 줄을 안 쓴다. action 값에 실행 중단에 해당하는 것이 없고
 * (EXECUTION_ABANDONED 는 Phase 5A 에서 일부러 뺐다), 억지로 다른 값을 빌리면
 * 이력이 거짓이 된다. 누가·언제·왜 치웠는지는 **치운 행 자신의 네 칸**에 남는다 —
 * 그것이 이 저장소의 소프트 삭제 규약이고, 치운 실행의 이력 화면은 어차피 더
 * 열리지 않는다.
 *
 * 끝낸(completed_at 이 찬) 실행도 그만둘 수 있다. 막으면 잘못 끝낸 사람이 또
 * 갇힌다.
 *
 * 🔵 2026-11-02(조각 9)에 되돌리는 길이 **하나 더 생겼다** —
 * resumeProcedureExecution(「절차 다시 잇기」). 둘은 하는 일이 정반대다: 이쪽은
 * 그 실행을 이 건에서 **치우고**, 저쪽은 마쳤다는 표시만 지워 **다시 돌게** 한다.
 * 그래서 「치우려는 것이 아니라 더 하려는 것」이면 저쪽이 맞는 단추다.
 */
export async function abandonProcedureExecution(
  executionId: string,
  actorUserId: string,
  expectedVersion: number,
  reason: string
): Promise<ExecutionLifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const { execution, repairCase } = await loadExecutionForLifecycleOrFail(tx, executionId);

      // 🔵 시작할 수 있는 사람이 치울 수도 있어야 한다. 관리자 이상으로 올리면
      // 「잘못 불러왔는데 바꿀 수가 없다」는 원래 불만이 담당 엔지니어에게는
      // 그대로 남는다. 지우는 것이 아니라 **치우는 것**이고(행은 사유와 함께
      // 남는다) 화면이 확인 창으로 한 번 더 묻는다.
      await assertOrdinaryMutationAuthorized(actor, repairCase, null);

      if (execution.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 절차를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (!reason || reason.trim().length === 0) {
        fail("REASON_REQUIRED", "실행을 그만두는 사유를 입력해 주세요.");
      }

      const now = new Date();
      await tx
        .update(procedureCaseExecutions)
        .set({
          isDeleted: true,
          deletedAt: now,
          deletedBy: actor.id,
          deleteReason: reason.trim(),
          version: execution.version + 1,
          updatedAt: now,
        })
        .where(eq(procedureCaseExecutions.id, executionId));

      return { ok: true, version: execution.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

/**
 * 마친 실행을 **다시 잇는다** — procedure_case_executions.completed_at 을 **비운다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 필요한가 (사용자 말 그대로, 2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 * 「절차를 다 진행하지 않고 절차를 마친 경우는 마쳐진 노드부터 절차를 재개할 수
 * 있도록 해주고.」
 *
 * 조각 8 부터 마친 실행은 큰 카드에서 내려와 「이 건의 다른 절차」의 한 줄이
 * 된다. 그래서 **남은 작업이 있는데 마친 실행**은 다시 손댈 길이 화면에서 통째로
 * 사라졌다 — 그때 유일하게 남은 단추가 [실행 그만두기]였는데, 그것은 **치우는
 * 것**이지 잇는 것이 아니다(치우면 그 줄이 화면에서 더 안 보이고 되돌릴 수 없다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 하는 일은 **칸 하나를 비우는 것**뿐이다 — 노드는 한 줄도 안 건드린다
 * ──────────────────────────────────────────────────────────────────────
 * 남은 대기·차단 노드를 되살리지도, 진행 중을 새로 세우지도 않는다. 그럴 필요가
 * 없다 — 마칠 때의 노드 상태가 **그대로 남아 있기** 때문이다(끝내기도 노드를 안
 * 건드린다 — finishProcedureExecution 의 같은 주석). completed_at 만 비우면
 * pickCurrentTask 가 **진행 중을 먼저** 고르므로, 「지금 할 일」은 저절로 마칠 때
 * 하던 그 노드가 된다. 사용자가 말한 「마쳐진 노드부터」가 그것이다.
 *
 * 여기서 노드를 건드리면 거꾸로 **마칠 때의 자리를 잃는다** — 어디까지 했는지를
 * 적어 둔 칸이 그 상태들뿐이라, 한 번 덮으면 돌아올 수 없다.
 *
 * 그래서 **마이그레이션도 없다.** 새 칸도 새 action 값도 안 만든다(아래 이력 줄).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 거절하는 둘 — **안 마친 실행**과 **그만둔 실행**
 * ──────────────────────────────────────────────────────────────────────
 *  - 안 마친 실행(completed_at 이 null) … 이을 것이 없다. 이미 돌고 있는 실행에
 *    이 호출이 닿으면 **아무것도 안 바뀌는데 version 만 오르는** 쓰기가 되고,
 *    그러면 같은 화면을 보던 다른 사람의 단추가 전부 CONFLICT 로 죽는다.
 *    🔴 새 결과 코드를 만들지 않았다 — 실제로 일어난 일이 「지금 상태에서는 할
 *    수 없는 전이」이고 그것이 INVALID_STATUS_TRANSITION 의 뜻 그대로다.
 *  - 그만둔 실행(is_deleted) … loadExecutionForLifecycleOrFail 이 **아예 못
 *    찾는다**(NOT_FOUND). 치운 실행에 다시 손대는 길을 안 남긴다는 같은 잣대다 —
 *    여기에 따로 if 를 쓰지 않는 까닭이 그것이고, 두 벌로 두면 한쪽만 고치게 된다.
 *
 * 🔵 **완주한 실행은 막지 않는다**(2026-11-02 결정). 화면에서는 [절차 다시 잇기]가
 * 완주 줄에 안 붙지만(resolveResumeBlockedReason), 그것은 **이어서 할 것이 한 장도
 * 없어서 쓸모가 없다**는 화면 쪽 판단이지 금지가 아니다. 서버까지 막으면 셋이
 * 곤란해진다:
 *   1. 잘못 끝낸 것을 되돌릴 길이 다시 **그만두기(치우기)** 하나로 돌아간다.
 *   2. 「완주인가」는 **노드 수를 세어야** 나오는 값이라, 세는 시점이 다르면
 *      화면과 서버의 답이 갈린다(추가 작업이 한 장 늘면 그 순간 완주가 아니다).
 *      그런 판정으로 거절하면 사람 눈에는 「눌렀는데 이유 없이 거절」로 보인다.
 *   3. 다시 이어도 **잃는 것이 없다** — 노드를 안 건드리므로, 그 자리에서 바로
 *      [절차 끝내기]를 다시 누르면 처음과 같은 상태로 돌아간다.
 * 짝인 abandonProcedureExecution 도 같은 모양이다 — 화면만 완주 줄을 가리고 서버는
 * 연다.
 *
 * 🔴 **사유를 안 받는다.** 그만두기가 사유를 받는 까닭은 치운 뒤에 「왜 치웠는지」를
 * 알 수단이 그 글자뿐이기 때문인데, 다시 잇기는 치우는 일이 아니고 **되돌릴 수도
 * 있다**([절차 끝내기]를 다시 누르면 된다). 매번 「재개」 같은 빈말을 적게 만들지
 * 않는다 — 끝내기가 사유를 안 받는 것과 같은 잣대다.
 */
export async function resumeProcedureExecution(
  executionId: string,
  actorUserId: string,
  expectedVersion: number
): Promise<ExecutionLifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const { execution, repairCase } = await loadExecutionForLifecycleOrFail(tx, executionId);

      // 🔵 끝내기·그만두기와 **같은 문턱**이다. 절차를 끝낸 사람이 그것을 다시
      // 이을 수도 있어야, 「잘못 눌렀는데 바꿀 수가 없다」가 담당 엔지니어에게
      // 그대로 남지 않는다.
      await assertOrdinaryMutationAuthorized(actor, repairCase, null);

      // 버전을 상태보다 먼저 본다 — startExecutionNode 의 같은 주석 참고.
      if (execution.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 절차를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (execution.completedAt === null) {
        fail("INVALID_STATUS_TRANSITION", "아직 마치지 않은 절차입니다. 이미 진행 중이라 다시 이을 것이 없습니다.");
      }
      const finishedAt = execution.completedAt;

      const now = new Date();
      // 🔴 비우는 칸은 **completed_at 하나**다. 노드도, 소프트 삭제 네 칸도,
      // started_at 도 안 건드린다 — 시작한 때는 여전히 처음 시작한 그때다.
      await tx
        .update(procedureCaseExecutions)
        .set({ completedAt: null, version: execution.version + 1, updatedAt: now })
        .where(eq(procedureCaseExecutions.id, executionId));

      // 🔴 **새 action 값을 만들지 않는다** — enum 을 늘리는 것은 마이그레이션이다.
      // 이 실행에 실제로 일어난 일은 「다시 돌기 시작했다」이고, 실행 수준의 action
      // 값으로 있는 것은 EXECUTION_STARTED 하나다(이력 화면에 「실행 시작」으로
      // 뜬다). 그 줄은 원래 execution_node_id 가 비어 있어서, 노드 없는 줄을
      // 이력 화면이 이미 제대로 그린다.
      //
      // 🔵 처음 시작한 줄과 가려내야 하므로 afterState 에 **다시 이은 것**임을
      // 적는다 — 조각 2·7 이 NODE_STARTED 에 표시를 덧붙여 가린 방식 그대로다.
      // 처음 시작의 afterState 는 { procedureTemplateId, executableNodeCount, … }
      // 라 둘이 섞이지 않는다. beforeState 에는 **지워진 마친 시각**을 남긴다 —
      // 칸을 비우고 나면 「언제 마쳤던 것인지」가 DB 어디에도 안 남기 때문이다.
      await insertHistory(tx, {
        executionId,
        actionType: "EXECUTION_STARTED",
        beforeState: { completedAt: finishedAt.toISOString() },
        afterState: { resumed: true },
        actorUserId: actor.id,
      });

      return { ok: true, version: execution.version + 1 };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- shared node-context loader ----

type LoadedExecutionNode = {
  node: typeof procedureCaseExecutionNodes.$inferSelect;
  /**
   * `completedAt` 은 2026-11-02(조각 10)에 늘었다 — 「지금 할 일 옮기기」가
   * **마친 실행을 거절**해야 하기 때문이다. 🔴 다른 변이들의 뜻은 하나도 안
   * 바뀐다: 그쪽은 이 칸을 안 읽고, 마친 실행에서도 노드를 계속 고칠 수 있다는
   * 규칙은 그대로다(이 적재기의 머리말).
   */
  execution: { id: string; repairCaseId: string; procedureTemplateId: string; completedAt: Date | null };
  repairCase: { id: string; isLocked: boolean; assignedEngineerId: string | null; billingType: string | null };
  nodeType: ProcedureNodeType | null;
};

async function loadExecutionNodeOrFail(tx: Tx, executionNodeId: string): Promise<LoadedExecutionNode> {
  const [node] = await tx
    .select()
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.id, executionNodeId))
    .for("update");
  if (!node) fail("NOT_FOUND", "해당 실행 항목을 찾을 수 없습니다.");

  // 🔴 그만둔(is_deleted) 실행의 노드는 더 못 건드린다 — 화면에서 사라진 실행에
  // 직접 요청이 날아들 수 있다(오래된 탭). 조회가 그 실행을 안 보여 주므로
  // (getActiveExecutionForCase) 서버 쪽도 같은 잣대를 써야 「화면에는 없는데
  // 저장은 되는」 자리가 안 생긴다.
  //
  // 반대로 **끝낸(completed_at 이 찬) 실행은 막지 않는다.** 끝내기는 잠그는 일이
  // 아니라 「여기까지」를 적는 일이고, 잘못 끝냈을 때 더 손댈 길까지 막으면
  // 되돌릴 방법이 사라진다.
  const [execution] = await tx
    .select({
      id: procedureCaseExecutions.id,
      repairCaseId: procedureCaseExecutions.repairCaseId,
      procedureTemplateId: procedureCaseExecutions.procedureTemplateId,
      completedAt: procedureCaseExecutions.completedAt,
    })
    .from(procedureCaseExecutions)
    .where(and(eq(procedureCaseExecutions.id, node.executionId), eq(procedureCaseExecutions.isDeleted, false)));
  if (!execution) fail("NOT_FOUND", "해당 실행을 찾을 수 없습니다.");

  // repair_case_id is nullable (repair-case permanent-delete schema
  // foundation checkpoint): an execution whose repair case has since been
  // permanently purged is a legitimate historical row (its own nodes/
  // history are untouched by that purge), but every mutation reachable
  // through this shared loader (start/complete/skip/block/reopen a node,
  // update its memo) fundamentally requires a live, assignable case —
  // there is none left to check lock/assignment against. Reject cleanly
  // here rather than querying a nonexistent case.
  if (!execution.repairCaseId) fail("NOT_FOUND", "이 작업과 연결된 접수 건이 더 이상 존재하지 않습니다.");
  const executionRepairCaseId = execution.repairCaseId;

  const [repairCase] = await tx
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId, billingType: repairCases.billingType })
    .from(repairCases)
    .where(and(eq(repairCases.id, executionRepairCaseId), eq(repairCases.isDeleted, false)));
  if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
  if (repairCase.billingType === "PENDING_DECISION") {
    fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Procedure 작업을 변경할 수 있습니다.");
  }

  let nodeType: ProcedureNodeType | null = null;
  if (node.procedureTemplateNodeId) {
    const [templateNode] = await tx
      .select({ nodeType: procedureTemplateNodes.nodeType })
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.id, node.procedureTemplateNodeId));
    nodeType = templateNode?.nodeType ?? null;
  }

  // Rebuilt with the already-narrowed executionRepairCaseId (not the
  // original `execution` object) so LoadedExecutionNode.execution's
  // declared repairCaseId: string is satisfied by construction, without a
  // non-null assertion — TS control-flow narrowing on execution.repairCaseId
  // doesn't reliably persist across the awaited queries above.
  return { node, execution: { ...execution, repairCaseId: executionRepairCaseId }, repairCase, nodeType };
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

      await assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

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

// ---- 지금 할 일 옮기기 (jump — 사람이 고른 노드를 진행 중으로 세운다) ----

/**
 * 못 옮기는 까닭 ↔ 이 변이의 결과 코드.
 *
 * 🔴 **새 코드를 만들지 않았다** — 셋이 전부 이미 있는 코드에 그대로 들어맞는다.
 * (DB 의 action enum 도 마찬가지로 안 늘렸다 — 아래 NODE_STARTED 를 쓴다.)
 * 셋 가운데 둘이 같은 코드로 가지만 **메시지가 다르다** — 사람이 읽는 것은
 * 메시지이고, 그 글자는 화면·서버가 같은 함수에서 가져온다(classifyJumpTarget).
 */
const JUMP_REJECTION_CODES: Record<JumpRejectionReason, ExecutionMutationResultCode> = {
  NOT_IN_EXECUTION: "NOT_FOUND",
  SKIPPED: "INVALID_STATUS_TRANSITION",
  BLOCKED: "INVALID_STATUS_TRANSITION",
};

/**
 * 「지금 할 일」을 **사람이 고른 노드로 옮긴다**(2026-11-02, 조각 10).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 하는 일 — 한 줄을 세우고, 다른 진행 중을 대기로 내린다
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 바뀌는지는 **도메인이 정한다**(planNodeJump). 여기서 if 로 다시 적지
 * 않는다 — 시험이 같은 함수로 기대값을 만들기 때문에, 두 벌이 되면 시험이 쓰기
 * 코드를 베껴 재게 된다.
 *
 * 🔴 다른 진행 중을 **대기로 되돌리는** 까닭은 procedure-execution-jump.ts 의
 * 머리말에 있다 — 안 되돌리면 차례가 앞선 진행 중이 그대로 「지금 할 일」로
 * 남아서, 눌러도 아무 일이 안 일어난 것처럼 보인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 화면이 보낸 것을 하나도 안 믿는다
 * ──────────────────────────────────────────────────────────────────────
 *  - **그 실행의 노드인가** … 실행 id 를 함께 받아 잠근 행과 맞댄다. 남의 실행
 *    노드를 보내면 NOT_FOUND 다(화면에는 창 하나뿐이지만, 오래 열어 둔 탭에서
 *    남의 id 가 날아들 수 있다).
 *  - **실행이 도는 중인가** … 그만둔 실행은 적재기가 아예 못 찾고(NOT_FOUND),
 *    **마친 실행은 여기서 거절한다**(ALREADY_FINISHED). 마친 실행에서 자리를
 *    옮기면 「마쳤다」는 사람의 판단을 서버가 뒤집는 꼴이다 — 다시 이으려면
 *    [절차 다시 잇기]가 따로 있다.
 *  - **옮길 수 있는 상태인가** … 건너뜀·차단됨은 거절한다(사람이 **사유를 적어**
 *    정한 것이라, 사유 없이 뒤집는 길을 내지 않는다). 🔴 **완료는 2026-11-03
 *    (조각 12)부터 받는다** — 사용자 결정이고, 그 줄은 아래에서 **새로 밟는 것처럼**
 *    비워진다(까닭은 도메인 머리말의 targetResetsTrail).
 *  - **시작(START) 표식인가** … 다른 변이들과 같은 관문을 그대로 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이력은 **한 줄**이고 새 action 값이 없다
 * ──────────────────────────────────────────────────────────────────────
 * 고른 노드에 NODE_STARTED 한 줄을 적는다. 실제로 일어난 일이 「대기 → 진행 중」
 * 이고 그것이 그 값의 뜻 그대로다(조각 2 의 자동 전진 · 조각 7 의 중간부터
 * 시작이 쓴 것과 같은 판단). 사람이 [시작]을 눌러 선 것과 가려내야 하므로
 * afterState 에 **옮겨서 세운 것**임을 적는다 — 사람이 누른 NODE_STARTED 의
 * afterState 는 null 이거나 { assignedEngineerId } 뿐이고, 자동 전진은
 * { autoAdvanced: true, … }, 중간부터 시작은 { startedMidProcedure: true, … } 라
 * 넷이 섞이지 않는다.
 *
 * 🔴 **대기로 내린 줄에는 이력을 안 적는다.** 「진행 중 → 대기」에 들어맞는
 * action 값이 이 enum 에 없고, 억지로 NODE_REOPENED 를 빌리면 이력 화면에
 * 「작업 재개(되돌림)」라고 뜬다 — 대기로 **내려간** 줄에 재개라고 적는 거짓말이다.
 * abandonProcedureExecution 이 같은 까닭으로 이력을 안 쓰는 것과 같은 잣대다.
 * 대신 내려간 줄의 id 를 **이 한 줄의 afterState 에** 남긴다 — 무엇이 함께
 * 바뀌었는지가 기록에서 사라지지는 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **자리가 상태를 정한다**(2026-11-02, 조각 11)
 * ──────────────────────────────────────────────────────────────────────
 * 사용자 결정 — 「시작점 부터 그 노드까지의 경로에 있는 노드들만 [완료]처리」·
 * 「이전 노드로 옮겨가면 옮겨가는 노드 뒷부분에 배치되어 있는 노드들은 다시
 * [대기]상태가 되도록」. 합치면 한 규칙이다:
 *
 *   **「시작점 → 고른 노드」 최단 경로 위는 완료, 그 길에 없는 완료는 대기.**
 *
 * 어느 줄이 그 길 위인지는 resolveJumpPath 가 정하고, 무엇을 건드리고 무엇을
 * 그냥 두는지는 전과 같이 **도메인이** 정한다(planNodeJump) — 쓰기 쪽에서 if 로
 * 다시 적으면 시험이 쓰기 코드를 베껴 재게 된다.
 *
 * ⚠️ **권한 한 칸이 넓어졌다**(사용자 결정의 결과). reopenExecutionNode 는 완료를
 * 되돌리는 것을 **관리 수준(MANAGE)** 으로 묶어 두는데, 이 길은 WRITE 만 가진
 * 담당 엔지니어도 **경로 밖의 완료를 대기로 되돌리게** 한다. 그렇게 한 까닭은
 * 고리가 있는 절차에서 되돌아갔을 때 그 뒤가 완료로 남아 있으면 **다시 할 일이
 * 「이미 한 일」로 보이기** 때문이다. 다만 되돌리는 범위를 좁혀 둔다 —
 * **완료만**, **사유를 적어 둔 건너뜀·차단됨은 안 건드린다**(planNodeJump 머리말).
 *
 * 🔴 **길을 못 찾으면 한 줄도 안 건드린다.** 실측 「원복 검사 및 개선 작업
 * (3상 입력)」은 노드 23개에 간선 8개라 START 에서 닿는 노드가 9개뿐이다. 길이
 * 없다는 것은 **지나왔다는 근거도, 「경로 밖」이라는 판정도 없다**는 뜻이다 —
 * 근거 없이 완료로 적으면 안 한 일을 했다고 적는 것이고, 근거 없이 되돌리면
 * 끝낸 일이 통째로 대기가 된다. 그때 옮기기는 조각 10 그대로 자리만 옮긴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 함께 바뀐 줄의 이력 — **이미 있는 action 값에 표시를 덧붙인다**
 * ──────────────────────────────────────────────────────────────────────
 * 줄마다 한 줄씩 적는다 — 완료는 NODE_COMPLETED 에 `completedByJump: true`,
 * 되돌림은 NODE_REOPENED 에 `reopenedByJump: true`. 사람이 [완료]를 눌러 적힌
 * NODE_COMPLETED 의 afterState 는 null 이거나 { selectedOutgoingEdgeId } 뿐이고,
 * [재개(되돌림)]가 적는 NODE_REOPENED 는 { status: "IN_PROGRESS" } 에 사유가
 * 붙으므로 넷이 섞이지 않는다. 🔴 새 action 값을 만들지 않는다 — enum 을 늘리는
 * 것은 마이그레이션이고, 이 행에 실제로 일어난 일이 그 값의 뜻 그대로다
 * (조각 2·7·9·10 이 이미 있는 값에 표시를 덧붙인 것과 같은 판단).
 *
 * 🔵 **고른 갈래(selected_outgoing_edge_id)는 안 적는다.** 경로가 어느 간선을
 * 탔는지는 알지만, 그 칸의 뜻은 「**사람이** 고른 갈래」다. 같은 길이의 길이
 * 여럿일 때 우리가 고른 쪽을 사람의 판단으로 적어 두면, 나중에 그 기록을 근거로
 * 읽는 사람이 틀린다 — 「여럿일 때 첫째를 고르는 것은 틀린 쪽을 1순위로 만드는
 * 것」이라는 resolveAutoAdvanceTarget 의 판단과 같은 잣대다.
 */
export async function jumpToExecutionNode(
  executionId: string,
  executionNodeId: string,
  actorUserId: string,
  expectedVersion: number
): Promise<ExecutionNodeMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, actorUserId);
      const ctx = await loadExecutionNodeOrFail(tx, executionNodeId);
      assertNotSystemEntryNode(ctx.nodeType);

      // 🔴 「그 실행의 노드인가」. 적재기는 노드 → 실행 방향으로 찾으므로 이
      // 맞대보기가 없으면 **아무 실행 id 나 보내도 통과**한다.
      if (ctx.execution.id !== executionId) {
        fail("NOT_FOUND", "이 작업은 해당 절차 실행의 항목이 아닙니다.");
      }

      await assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

      // 버전을 상태보다 먼저 본다 — startExecutionNode 의 같은 주석 참고.
      if (ctx.node.version !== expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 작업을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }
      if (ctx.execution.completedAt !== null) {
        fail("ALREADY_FINISHED", "이미 마친 절차입니다. [절차 다시 잇기]로 다시 이은 뒤에 옮길 수 있습니다.");
      }

      // 🔴 **같은 실행의 모든 노드를 잠근다.** 대기로 내릴 줄이 어느 것인지는
      // 지금 상태를 봐야 정해지는데, 잠그지 않고 읽으면 그 사이에 남이 하나를
      // 더 시작할 수 있다. id 차례로 잠가 두 사람이 동시에 옮길 때 서로를
      // 기다리는 자리가 어긋나지 않게 한다.
      const siblings = await tx
        .select({
          id: procedureCaseExecutionNodes.id,
          procedureTemplateNodeId: procedureCaseExecutionNodes.procedureTemplateNodeId,
          status: procedureCaseExecutionNodes.status,
          version: procedureCaseExecutionNodes.version,
          startedBy: procedureCaseExecutionNodes.startedBy,
          startedAt: procedureCaseExecutionNodes.startedAt,
          assignedEngineerId: procedureCaseExecutionNodes.assignedEngineerId,
          // 🔵 아래 다섯은 **되돌리면서 비우는 칸**이다(조각 11). 비우기 **전에**
          // 이력 줄에 옮겨 적어야 해서 여기서 함께 읽는다 — 안 읽고 비우면 그
          // 기록이 DB 어디에도 안 남는다.
          completedBy: procedureCaseExecutionNodes.completedBy,
          completedAt: procedureCaseExecutionNodes.completedAt,
          workMemo: procedureCaseExecutionNodes.workMemo,
          lastActionReason: procedureCaseExecutionNodes.lastActionReason,
          selectedOutgoingEdgeId: procedureCaseExecutionNodes.selectedOutgoingEdgeId,
        })
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.executionId, executionId))
        .orderBy(procedureCaseExecutionNodes.id)
        .for("update");

      // 🔴 **지나온 길**을 절차 그림에서 찾는다(조각 11). 간선·노드는 템플릿
      // 전체를 읽는다 — 실측 템플릿의 간선이 8~42개라 한 번 더 읽어도 비용이
      // 뜻있게 늘지 않고, 좁혀 읽으면 경로가 애초에 안 그려진다
      // (advanceToNextNode 가 참고 문서를 건너뛰려고 전체를 읽는 것과 같은 사정).
      const templateNodes = await tx
        .select({ id: procedureTemplateNodes.id, nodeType: procedureTemplateNodes.nodeType })
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, ctx.execution.procedureTemplateId));
      const templateEdges = await tx
        .select({
          id: procedureTemplateEdges.id,
          fromNodeId: procedureTemplateEdges.fromNodeId,
          toNodeId: procedureTemplateEdges.toNodeId,
          sortOrder: procedureTemplateEdges.sortOrder,
        })
        .from(procedureTemplateEdges)
        .where(eq(procedureTemplateEdges.procedureTemplateId, ctx.execution.procedureTemplateId));

      const jumpPath = resolveJumpPath({
        templateNodes,
        edges: templateEdges,
        executionNodes: siblings,
        targetExecutionNodeId: executionNodeId,
      });

      // 🔴 START 의 실행 행을 **가려서** 넘긴다. 그 줄은 만들 때 바로 완료로 차는데
      // 경로 계산에서는 사람이 할 일이 아니라 빠지므로, 안 가리면 「경로 밖의
      // 완료」로 읽혀 대기로 되돌아간다(JumpPlanNode.isSystemEntry 주석).
      const systemEntryTemplateNodeIds = new Set(
        templateNodes.filter((n) => isSystemEntryNodeType(n.nodeType)).map((n) => n.id)
      );
      const planNodes = siblings.map((s) => ({
        id: s.id,
        status: s.status,
        isSystemEntry: s.procedureTemplateNodeId !== null && systemEntryTemplateNodeIds.has(s.procedureTemplateNodeId),
      }));

      const siblingById = new Map(siblings.map((s) => [s.id, s]));
      const plan = planNodeJump({
        nodes: planNodes,
        targetExecutionNodeId: executionNodeId,
        path: jumpPath,
      });
      if (plan.kind === "REJECTED") fail(JUMP_REJECTION_CODES[plan.reason], plan.message);
      // 바꿀 것이 없으면 **아무것도 안 쓴다** — 값은 그대로인데 version 만 올리면
      // 같은 화면을 보던 다른 사람의 단추가 전부 CONFLICT 로 죽는다
      // (updateExecutionNodeMemo 의 같은 규약).
      if (plan.kind === "NO_CHANGE") return { ok: true, version: ctx.node.version };

      const now = new Date();
      const nextVersion = ctx.node.version + 1;

      // 🔴 **완료였던 줄로 옮기면 그 줄을 새로 밟는 것처럼 비운다**(2026-11-03,
      // 조각 12 — 사용자 결정으로 완료가 고를 수 있게 됐다). 비우는 칸은 경로
      // 밖의 완료를 되돌릴 때와 **똑같다**(아래 reopenOffPath 의 주석) — 이번에
      // 밟은 자취만 비우고, 그 줄이 무엇인가와 담당은 그대로 둔다.
      //
      // 🔵 그래서 start 기록도 **되읽지 않고 지금으로 채운다.** 비운 뒤의 줄은
      // 「한 번도 안 선 줄」이고, 그 줄의 시작은 바로 이 옮기기다.
      const targetSibling = siblingById.get(executionNodeId);
      await tx
        .update(procedureCaseExecutionNodes)
        .set({
          status: "IN_PROGRESS",
          // 처음 서는 줄만 채운다 — 이 모듈의 backfill 규약 그대로다. 되돌아온
          // 줄은 **처음 손댄 때**를 그대로 간직한다.
          startedBy: plan.targetResetsTrail ? actor.id : (ctx.node.startedBy ?? actor.id),
          startedAt: plan.targetResetsTrail ? now : (ctx.node.startedAt ?? now),
          ...(plan.targetResetsTrail
            ? { completedBy: null, completedAt: null, workMemo: null, lastActionReason: null, selectedOutgoingEdgeId: null }
            : {}),
          version: nextVersion,
          updatedAt: now,
        })
        .where(eq(procedureCaseExecutionNodes.id, executionNodeId));

      for (const standDownId of plan.standDownExecutionNodeIds) {
        const sibling = siblingById.get(standDownId);
        if (!sibling) continue;
        // 🔴 status 한 칸만 내린다. started_at · started_by · 작업 메모는 그대로
        // 둔다 — 하던 일을 없던 일로 만들지 않는다(도메인 머리말).
        await tx
          .update(procedureCaseExecutionNodes)
          .set({ status: "PENDING", version: sibling.version + 1, updatedAt: now })
          .where(eq(procedureCaseExecutionNodes.id, standDownId));
      }

      // 지나온 길 — 경로 차례 그대로 완료로 바꾼다.
      for (const passedId of plan.completeOnPathExecutionNodeIds) {
        const sibling = siblingById.get(passedId);
        if (!sibling) continue;
        await tx
          .update(procedureCaseExecutionNodes)
          .set({
            status: "COMPLETED",
            // 한 번도 안 선 줄에도 시작 기록이 있어야 한다 — 이 모듈의 backfill
            // 규약 그대로다(completeExecutionNode 가 같은 길을 쓴다).
            startedBy: sibling.startedBy ?? actor.id,
            startedAt: sibling.startedAt ?? now,
            completedBy: actor.id,
            completedAt: now,
            version: sibling.version + 1,
            updatedAt: now,
          })
          .where(eq(procedureCaseExecutionNodes.id, passedId));
      }

      // 경로 밖으로 밀려난 완료 — 대기로 되돌리고 **새로 밟는 것처럼 비운다**.
      //
      // 🔴 사용자 결정(2026-11-02) — 「한번 지나갔던 노드로 다시 돌아오게 된다면
      // 이전 기록(메모 등)은 실행 이력에 남겠지만, [지금 할 일]에서는 기존 메모가
      // 보이는 것이 아니라 그 노드를 새로 밟는 것처럼 되야 해.」
      //
      // 🔴 비우는 잣대는 **「다시 밟을 때 새 작업처럼 보이는가」** 다. 그래서
      // **이번에 밟은 자취**(상태 · 시작 · 완료 · 작업 메모 · 마지막 사유 · 고른
      // 갈래)는 비우고, **그 줄이 무엇인가**(절차 노드 · 추가 작업 제목·지시 ·
      // 만든 때)는 그대로 둔다.
      //
      // 🔵 `assigned_engineer_id` 는 **안 비운다.** 그 칸은 「이번에 무엇을
      // 했는가」가 아니라 「누가 맡는가」이고, 비우면 유효 담당이 접수 건의 담당
      // 으로 떨어져 **누가 이 줄을 건드릴 수 있는지가 바뀐다** — 화면 글자 문제가
      // 아니라 권한 문제다. 카드의 담당 줄은 비워도 접수 건 담당 이름이 그대로
      // 뜨므로, 남겨 둔다고 「이미 손댄 줄」로 보이지도 않는다.
      //
      // 🔴 조각 10 의 **stand-down(진행 중 → 대기)과 다르다.** 그쪽은 「지나간」
      // 것이 아니라 **잠시 미뤄 둔** 것이라 자취를 그대로 둔다 — 다시 오면 하던
      // 자리로 돌아와야 한다. 이쪽은 **완료했던 것을 다시 하러** 돌아가는 길이다.
      for (const reopenedId of plan.reopenOffPathExecutionNodeIds) {
        const sibling = siblingById.get(reopenedId);
        if (!sibling) continue;
        await tx
          .update(procedureCaseExecutionNodes)
          .set({
            status: "PENDING",
            startedBy: null,
            startedAt: null,
            completedBy: null,
            completedAt: null,
            workMemo: null,
            lastActionReason: null,
            selectedOutgoingEdgeId: null,
            version: sibling.version + 1,
            updatedAt: now,
          })
          .where(eq(procedureCaseExecutionNodes.id, reopenedId));
      }

      await insertHistory(tx, {
        executionId,
        executionNodeId,
        actionType: "NODE_STARTED",
        // 🔵 고른 줄이 **옮기기 전에 어땠는지**가 그대로 적힌다 — 이력을 읽는
        // 사람이 「이번에 시작한 것」·「지금 할 일 자리만 옮긴 것」·「끝냈던 것을
        // 다시 밟는 것」을 가릴 수 있어야 한다.
        //
        // 🔴 비운 줄은 **비우기 전 값을 통째로** 같은 자리에 옮겨 적는다(아래
        // 되돌린 줄과 같은 모양 · 같은 표시). 칸을 그냥 비우면 사람이 쓴 메모가
        // DB 어디에도 안 남는다 — 「이전 기록(메모 등)은 실행 이력에 남겠지만」이
        // 가리키는 자리가 여기다. 표시가 같아야 이력 화면이 한 규칙으로 그린다
        // (readJumpResetWorkMemo).
        beforeState: {
          status: plan.targetBeforeStatus,
          ...(plan.targetResetsTrail && targetSibling
            ? {
                clearedOnJump: true,
                workMemo: targetSibling.workMemo,
                lastActionReason: targetSibling.lastActionReason,
                startedBy: targetSibling.startedBy,
                startedAt: targetSibling.startedAt ? targetSibling.startedAt.toISOString() : null,
                completedBy: targetSibling.completedBy,
                completedAt: targetSibling.completedAt ? targetSibling.completedAt.toISOString() : null,
                selectedOutgoingEdgeId: targetSibling.selectedOutgoingEdgeId,
              }
            : {}),
        },
        afterState: {
          jumpedTo: true,
          status: "IN_PROGRESS",
          standDownExecutionNodeIds: plan.standDownExecutionNodeIds,
          // 🔴 길을 **찾았는지**까지 적는다. 함께 완료한 줄이 없는 까닭이 둘이라
          // (길이 없었다 / 길은 있는데 이미 다 끝나 있었다) 빈 배열 하나로는
          // 나중에 그 둘을 못 가른다.
          pathFound: jumpPath.found,
          completedOnPathExecutionNodeIds: plan.completeOnPathExecutionNodeIds,
          reopenedOffPathExecutionNodeIds: plan.reopenOffPathExecutionNodeIds,
        },
        actorUserId: actor.id,
      });

      // 함께 바뀐 줄마다 한 줄씩. 🔴 **옮긴 줄의 뒤**에 세운다 — 이력 조회는
      // created_at 하나로만 정렬하므로(getExecutionHistory), 같은 트랜잭션의
      // 줄들은 간격을 안 주면 차례가 아예 정해지지 않는다(insertHistory 주석).
      const touchedOnJump = [
        ...plan.completeOnPathExecutionNodeIds.map((id) => ({ id, actionType: "NODE_COMPLETED" as const, status: "COMPLETED" as const })),
        ...plan.reopenOffPathExecutionNodeIds.map((id) => ({ id, actionType: "NODE_REOPENED" as const, status: "PENDING" as const })),
      ];
      for (const [index, touched] of touchedOnJump.entries()) {
        const sibling = siblingById.get(touched.id);
        // 🔴 되돌린 줄은 **비우기 전 값을 통째로** 이력에 옮겨 적는다. 칸을 그냥
        // 비우면 그 기록이 DB 어디에도 안 남는다 — 사용자가 「이전 기록(메모 등)은
        // 실행 이력에 남겠지만」이라고 한 그 「남는다」가 여기다. 조각 9 가
        // completed_at 을 비우면서 beforeState 에 옮겨 적은 것과 같은 수법이다.
        const clearedOnJump =
          touched.actionType === "NODE_REOPENED" && sibling
            ? {
                clearedOnJump: true,
                workMemo: sibling.workMemo,
                lastActionReason: sibling.lastActionReason,
                startedBy: sibling.startedBy,
                startedAt: sibling.startedAt ? sibling.startedAt.toISOString() : null,
                completedBy: sibling.completedBy,
                completedAt: sibling.completedAt ? sibling.completedAt.toISOString() : null,
                selectedOutgoingEdgeId: sibling.selectedOutgoingEdgeId,
              }
            : {};
        await insertHistory(tx, {
          executionId,
          executionNodeId: touched.id,
          // 🔴 새 action 값을 만들지 않는다. 되돌린 줄에 NODE_REOPENED 를 쓰는 것은
          // 빌려 쓰는 것이 아니라 **그 값의 뜻 그대로**다 — reopenExecutionNode 가
          // 완료를 되돌릴 때 적는 것과 같은 값이고, 이력 화면에도 「작업
          // 재개(되돌림)」로 뜬다. 조각 10 이 「진행 중 → 대기」에 이 값을 안 쓴
          // 것과 어긋나지 않는다: 그쪽은 **완료가 아니었던** 줄이라 재개라는 말이
          // 거짓이 되지만, 이쪽은 실제로 완료를 되돌리는 것이다.
          actionType: touched.actionType,
          beforeState: { status: sibling?.status ?? null, ...clearedOnJump },
          afterState:
            touched.actionType === "NODE_COMPLETED"
              ? { completedByJump: true, status: touched.status, jumpTargetExecutionNodeId: executionNodeId }
              : { reopenedByJump: true, status: touched.status, jumpTargetExecutionNodeId: executionNodeId },
          actorUserId: actor.id,
          createdAt: followingHistoryAt(index + 1),
        });
      }

      return { ok: true, version: nextVersion };
    });
  } catch (err) {
    if (err instanceof ExecutionMutationError) return err.result;
    throw err;
  }
}

// ---- 자동 전진 (완료하면 다음 하나가 저절로 선다) ----

/**
 * 노드 하나를 완료한 **같은 트랜잭션 안에서**, 다음 노드 하나를 진행 중으로
 * 세운다.
 *
 * 왜 이것이 필요한가: 전에는 완료해도 다른 행을 하나도 건드리지 않아서, 사람이
 * 카드 22장 중에서 다음 것을 **다시 찾아야** 했다. 판단 노드에서 갈래를 골라도
 * 그 갈래가 가리키는 노드가 서지 않았다 — 고른 것이 화면에 아무 변화도 만들지
 * 않았다.
 *
 * 🔴 무엇을 안 하는가:
 *  - **다른 노드의 진행 중을 끄지 않는다.** 세우는 것은 언제나 한 행뿐이고,
 *    그 한 행도 대기(PENDING)일 때만 건드린다. 진행 중이 여럿 있어도 괜찮다 —
 *    사람이 둘을 동시에 할 수 있다.
 *  - **이미 끝난(완료·건너뜀) 노드를 되살리지 않는다.** 「재측정」처럼 되돌아
 *    가는 간선이 있는 절차에서 끝난 일이 다시 「지금 할 일」로 올라온다.
 *  - **담당을 가로채지 않는다.** startExecutionNode 는 사람이 직접 [시작]을
 *    누를 때 비어 있던 담당을 그 사람으로 채우지만(self-claim), 여기서는
 *    채우지 않는다. 앞 작업을 끝낸 사람이 다음 작업까지 맡는다는 근거가 없고,
 *    담당이 비어 있으면 접수 건의 담당 엔지니어가 그대로 쓰인다.
 *
 * 🔵 **참고 문서는 건너뛴다**(2026-11-02). 참고 문서에는 실행 행이 없어서 전에는
 * 거기서 멈췄는데, 실측 rfg-full-lifecycle 에 들어오는 선과 나가는 선을 다 가진
 * 참고 문서가 둘 있다 — 게시하는 날 그 자리에서 절차가 조용히 멈춘다. 건너뛰는
 * 규칙(갈래가 여럿이면 안 세운다 · 고리를 이루면 멈춘다)은 전부
 * resolveAutoAdvanceTarget 안에 있고, 이 함수는 그러느라 **템플릿 전체의 간선과
 * 노드 갈래**를 읽어 넘긴다.
 *
 * 세우지 못한 경우에도 **던지지 않는다.** 완료 자체는 사람이 한 일이고 이미
 * 성공했다 — 다음 것을 못 세운 것은 절차 그림의 사정(갈 곳이 없다/여럿이다)
 * 이지 완료의 실패가 아니다. 까닭은 돌려주기만 하고 부르는 쪽이 삼킨다.
 */
async function advanceToNextNode(
  tx: Tx,
  params: {
    executionId: string;
    procedureTemplateId: string;
    completedExecutionNodeId: string;
    completedTemplateNodeId: string | null;
    isDecision: boolean;
    selectedOutgoingEdgeId: string | null;
    actorUserId: string;
  }
): Promise<AutoAdvanceDecision> {
  if (params.completedTemplateNodeId === null) return { kind: "SKIP", reason: "NOT_IN_GRAPH" };

  // 🔴 끝낸 노드에서 **나가는 간선만** 읽던 것을 템플릿 전체로 넓혔다. 참고
  // 문서를 건너뛰려면 그 노드에서 나가는 선이 필요한데, 좁혀 읽으면 그 선이
  // 애초에 결과에 없다(resolveAutoAdvanceTarget 머리말). 실측 템플릿의 간선은
  // 8~60개라 한 번 더 읽어도 비용이 뜻있게 늘지 않는다.
  const templateEdges = await tx
    .select({
      id: procedureTemplateEdges.id,
      fromNodeId: procedureTemplateEdges.fromNodeId,
      toNodeId: procedureTemplateEdges.toNodeId,
    })
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, params.procedureTemplateId));

  // 실행 행이 없는 노드가 **참고 문서라서** 없는 것인지 가리는 데 쓴다.
  const templateNodes = await tx
    .select({ id: procedureTemplateNodes.id, nodeType: procedureTemplateNodes.nodeType })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, params.procedureTemplateId));

  const siblings = await tx
    .select({
      id: procedureCaseExecutionNodes.id,
      procedureTemplateNodeId: procedureCaseExecutionNodes.procedureTemplateNodeId,
      status: procedureCaseExecutionNodes.status,
    })
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.executionId, params.executionId));

  const decision = resolveAutoAdvanceTarget({
    completedTemplateNodeId: params.completedTemplateNodeId,
    isDecision: params.isDecision,
    selectedOutgoingEdgeId: params.selectedOutgoingEdgeId,
    edges: templateEdges,
    templateNodes,
    executionNodes: siblings,
  });
  if (decision.kind !== "ADVANCE") return decision;

  // 위 siblings 조회는 **잠금 없이** 읽었다. 고를 대상이 정해진 뒤에 그 한 행만
  // 잠그고 상태를 **다시** 본다 — 그 사이에 다른 사람이 그 노드를 시작했거나
  // 막았을 수 있다. 잠근 뒤의 판정이 진짜이고, 잣대는 고를 때와 같은 함수다.
  const [target] = await tx
    .select()
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.id, decision.executionNodeId))
    .for("update");
  if (!target) return { kind: "SKIP", reason: "TARGET_NOT_EXECUTABLE" };
  const racedReason = classifyAutoAdvanceTarget(target.status);
  if (racedReason) return { kind: "SKIP", reason: racedReason };

  const now = new Date();
  await tx
    .update(procedureCaseExecutionNodes)
    .set({
      status: "IN_PROGRESS",
      // 되돌림을 거쳐 다시 대기가 된 행이라면 시작 기록이 이미 있다 — 처음
      // 서는 행만 채운다(다른 변이들이 쓰는 backfill 규약과 같다).
      startedBy: target.startedBy ?? params.actorUserId,
      startedAt: target.startedAt ?? now,
      version: target.version + 1,
      updatedAt: now,
    })
    .where(eq(procedureCaseExecutionNodes.id, target.id));

  // 새 action 값을 만들지 않는다 — enum 을 늘리는 것은 마이그레이션이다.
  // 이 행에 실제로 일어난 일은 「대기 → 진행 중」이고 그것이 NODE_STARTED 의
  // 뜻 그대로다. 사람이 누른 것과 가려내야 하므로 afterState 에 자동으로
  // 섰다는 것과 **어느 노드의 어느 갈래를 타고 왔는지**를 적는다. 사람이 누른
  // NODE_STARTED 의 afterState 는 null 이거나 { assignedEngineerId } 뿐이라
  // 둘이 섞이지 않는다.
  await insertHistory(tx, {
    executionId: params.executionId,
    executionNodeId: target.id,
    actionType: "NODE_STARTED",
    afterState: {
      autoAdvanced: true,
      fromExecutionNodeId: params.completedExecutionNodeId,
      viaEdgeId: decision.viaEdgeId,
    },
    actorUserId: params.actorUserId,
    createdAt: FOLLOWING_HISTORY_AT,
  });

  return decision;
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

      await assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

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

      // 다음 하나를 세운다. 못 세워도 완료는 완료다 — advanceToNextNode 는
      // 던지지 않고 까닭만 돌려준다.
      await advanceToNextNode(tx, {
        executionId: ctx.node.executionId,
        procedureTemplateId: ctx.execution.procedureTemplateId,
        completedExecutionNodeId: input.executionNodeId,
        completedTemplateNodeId: ctx.node.procedureTemplateNodeId,
        isDecision,
        selectedOutgoingEdgeId,
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
    actor: { id: string; role: Role; isDeveloper: boolean };
    ctx: LoadedExecutionNode;
    targetStatus: "SKIPPED" | "BLOCKED";
    expectedVersion: number;
    reason: string;
    actionType: ProcedureCaseExecutionActionType;
    reasonRequiredMessage: string;
  }
): Promise<number> {
  assertNotSystemEntryNode(params.ctx.nodeType);
  await assertOrdinaryMutationAuthorized(params.actor, params.ctx.repairCase, params.ctx.node.assignedEngineerId);

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
      const isAssigned =
        assignment.effectiveAssigneeId !== null && assignment.effectiveAssigneeId === actor.id;
      const allowed = wasCompletedOrSkipped
        ? // 이미 끝난 단계를 되돌리는 것은 담당 여부와 무관하게 관리 수준이다.
          await hasPermission(actor, "repairCases.procedureExecution", "MANAGE")
        : actorMay(actor, (role) => !executionRequiresOwnAssignment(role) || isAssigned) &&
          (await hasPermission(actor, "repairCases.procedureExecution", "WRITE"));
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

      // repair_case_id is nullable (repair-case permanent-delete schema
      // foundation checkpoint) — see loadExecutionNodeOrFail's identical
      // guard. Adding a brand-new extra task fundamentally requires a live
      // case to authorize/assign against; an orphaned (purged-case)
      // execution can never accept new work.
      if (!execution.repairCaseId) fail("NOT_FOUND", "이 실행과 연결된 접수 건이 더 이상 존재하지 않습니다.");
      const executionRepairCaseId = execution.repairCaseId;

      const [repairCase] = await tx
        .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId, billingType: repairCases.billingType })
        .from(repairCases)
        .where(and(eq(repairCases.id, executionRepairCaseId), eq(repairCases.isDeleted, false)));
      if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (repairCase.billingType === "PENDING_DECISION") {
        fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Procedure 작업을 추가할 수 있습니다.");
      }

      // No node-level assignment override exists yet (the row doesn't
      // exist until this insert) — the effective assignee for authorizing
      // this action is the case's own assigned engineer only.
      await assertOrdinaryMutationAuthorized(actor, repairCase, null);

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

      await assertOrdinaryMutationAuthorized(actor, ctx.repairCase, ctx.node.assignedEngineerId);

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
