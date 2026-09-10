import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  inventoryPartIssueApprovals,
  inventoryPartIssueRequestItems,
  inventoryPartIssueRequests,
  inventoryPartRequestItems,
  inventoryPartRequests,
  partStockBalances,
  procedureCaseExecutionNodes,
  procedureCaseExecutions,
  repairCases,
  users,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
// 🔴 **안쪽 함수들** — 재고를 실제로 빼는 이미 검증된 경로다. 문이 달린 겉 함수
// (issuePartRequest · consumeStock)가 아니라 이쪽을 부른다: 실행은 문에 걸리면
// 안 되고, 무엇보다 **재고 이동과 신청 상태가 한 트랜잭션**이어야 한다.
import {
  consumeStockCore,
  extractInventoryFailure,
  isPartIssueApprovalRouteInForce,
  type InventoryMutationResultCode,
} from "./inventory";
import {
  extractPartRequestFailure,
  issuePartRequestCore,
  type InventoryPartRequestResultCode,
} from "./inventory-part-requests";
import { mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";
import { isRequestIssuable } from "@/lib/auth/inventory-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  getCurrentShipmentApprovalRouteChain,
  getShipmentApprovalRouteSteps,
} from "../queries/shipment-approval-routes";
import { findNextRouteStepToApprove } from "@/lib/domain/shipment-approval-route";
import {
  PART_ISSUE_APPROVAL_ROUTE_SCOPE,
  canTransitionPartIssueRequestStatus,
  isPartIssueRequestAwaitingApproval,
  isPartIssueRequestCancellable,
  isPartIssueRequestExecutable,
  type InventoryPartIssueRequestStatus,
} from "@/lib/domain/inventory-part-issue-rules";
import {
  aggregateAllocationsByItem,
  mergeDuplicateAllocations,
  safeAddQuantity,
  validateRawIssueAllocations,
  validateRawQuantity,
} from "@/lib/domain/inventory-part-request-rules";
import type { StockOwner } from "@/lib/domain/inventory-types";
import type {
  PartIssueActionFailure,
  PartIssueActionResultCode,
  PartIssueApprovalDecision,
  ValidatedCreatePartIssueRequestInput,
} from "@/lib/validation/inventory-part-issue-input";

/**
 * ============================================================================
 * 부품 불출 승인 — 신청 · 결재 · 취소
 * ============================================================================
 * 재고 담당자가 [불출]·[사용]을 눌렀을 때 그 자리에서 재고를 빼는 대신 **먼저
 * 결재를 받는** 길의 저장 경로다. 표의 뜻과 설계의 이유는
 * db/schema/inventory-part-issue-requests.ts 머리말에 있고, 결재 사슬의 모양은
 * mutations/repair-case-approvals.ts(최종 출하 승인)를 그대로 본떴다 — 같은
 * 결재선 표를 쓰므로 사슬의 규칙도 한 벌이어야 한다.
 *
 * ── 🔴 신청 · 결재 · 취소는 재고를 **한 톨도 움직이지 않는다** ──────────
 * 아래 세 mutation(createPartIssueRequest · decidePartIssueRequestApproval ·
 * cancelPartIssueRequest)은 `stock_transactions` 에도 `part_stock_balances` 에도
 * 한 줄도 쓰지 않는다. 승인은 「빼도 된다」까지이고, 실제로 빼는 것은 재고
 * 담당자가 따로 누른다(그래서 상태에 APPROVED 와 EXECUTED 가 따로 있다).
 *
 * 재고를 움직이는 것은 이 파일 맨 아래 **executePartIssueRequest 하나뿐**이고,
 * 그것도 직접 움직이지 않는다 — 이미 검증된 두 불출 경로의 **안쪽 함수**
 * (issuePartRequestCore · consumeStockCore)를 자기 트랜잭션 안에서 부른다. 그
 * 함수의 머리말에 왜 한 트랜잭션이어야 하는지가 적혀 있다.
 *
 * ── 🔴 안전장치: 「부품 불출」 판이 없으면 이 절차는 없는 것과 같다 ────────
 * 결재선 판이 하나도 없거나 단계가 0개면 신청은 ROUTE_NOT_CONFIGURED 로 거절되고
 * 행을 하나도 남기지 않으며, **두 불출 경로의 문도 열려 있어** 지금까지처럼 그
 * 자리에서 바로 불출된다. 이 약속이 없으면 기능을 올리는 순간 관리자가 절차를
 * 만들기 전까지 재고가 통째로 잠긴다 — 아무도 결재할 수 없는 신청만 쌓인다.
 * 「절차가 쓰이고 있는가」의 판정은 mutations/inventory.ts 의
 * isPartIssueApprovalRouteInForce 하나이고, 신청과 두 문이 전부 그것을 본다.
 *
 * ── 🔴 신청은 재고를 예약하지 않는다 ────────────────────────────────────
 * 아래 수량 검사는 「지금 잔량으로도 명백히 안 되는 것」을 앞에서 걸러 낼 뿐,
 * 그 수량을 잡아 두지 않는다(기존 부품 요청과 같은 원칙이다 — 요청도 재고를
 * 예약하지 않는다). 그 사이 남이 가져갈 수 있고, 그때는 실행 시점의 기존 검사가
 * 다시 막는다. 잔량 행을 `.for("update")` 로 잠그지 않는 것도 같은 이유다 —
 * 잡아 둘 것이 없는데 잠그면 진짜 불출과 다투기만 한다.
 *
 * ── 중복 방지 장치를 새로 만들지 않는다 ─────────────────────────────────
 * 부품 요청 영역에는 정교한 멱등 장치가 있지만(internal/
 * inventory-request-idempotency.ts) 여기서는 쓰지 않는다. 판단의 근거 셋:
 *  · **신청**은 재고를 움직이지 않는다 — 두 번 들어와도 사람이 하나를 취소하면
 *    되고, 그 사이 잘못 나가는 것이 없다.
 *  · **승인**의 중복은 표가 막는다 — 부분 유니크
 *    (inventory_part_issue_approvals_one_active_request)로 한 신청에 열린 행은
 *    언제나 하나뿐이고, 결정 UPDATE 는 `status = 'REQUESTED'` 를 조건으로 걸어
 *    두 번째 시도가 CONFLICT 로 떨어진다.
 *  · 진짜 필요한 자리는 **실행**이고, 거기는 기존 불출 경로가 이미 갖고 있다.
 * ============================================================================
 */

class PartIssueMutationError extends Error {
  result: PartIssueActionFailure;
  constructor(result: PartIssueActionFailure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: PartIssueActionResultCode, message: string): never {
  throw new PartIssueMutationError({ ok: false, code, message });
}

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

/** drizzle 이 던지는 바깥 오류에는 실패한 SQL 만 있고 원래 오류는 `.cause` 에 있다 — 둘 다 본다(mutations/inventory.ts 와 같은 도우미다). */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

async function requireActor(tx: Tx, actorUserId: string) {
  try {
    // 승인됨 · 활성 · 잠기지 않음 · 삭제 안 됨을 한 번에 본다. 재고 영역의 다른
    // mutation 들과 **같은 함수**다 — 여기서 조건을 한 벌 더 적으면 부품 요청은
    // 막는데 불출 신청은 통과시키는(또는 그 반대의) 어긋남이 생긴다.
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

type PreparedIssueRequest = {
  header: {
    partRequestId: string | null;
    repairCaseId: string | null;
    destinationNote: string | null;
    procedureExecutionNodeId: string | null;
  };
  items: { requestItemId: string | null; partStockBalanceId: string; quantity: number }[];
};

type BalanceSnapshot = { id: string; partId: string; owner: StockOwner; currentQuantity: number };

/**
 * 잔량 행을 읽어 온다 — **잠그지 않는다**(파일 머리말의 「예약하지 않는다」).
 *
 * 잔량 행에는 소프트삭제 칸이 없다(schema/inventory.ts) — 실재 여부가 곧
 * 「삭제되지 않았는가」다. 부품 마스터의 소프트삭제를 여기서 보지 않는 것은
 * 기존 불출 경로(issuePartRequest · consumeStock)와 같다: 이미 재고가 잡혀 있는
 * 부품은 목록에서 감춰졌더라도 남은 것을 빼낼 수 있어야 한다.
 */
async function loadBalances(tx: Tx, balanceIds: string[]): Promise<Map<string, BalanceSnapshot>> {
  const uniqueIds = [...new Set(balanceIds)].sort();
  const rows = await tx
    .select({
      id: partStockBalances.id,
      partId: partStockBalances.partId,
      owner: partStockBalances.owner,
      currentQuantity: partStockBalances.currentQuantity,
    })
    .from(partStockBalances)
    .where(inArray(partStockBalances.id, uniqueIds))
    .orderBy(partStockBalances.id);
  if (rows.length !== uniqueIds.length) fail("NOT_FOUND", "재고 정보를 찾을 수 없습니다.");
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * 한 신청 안에서 같은 잔량 행이 두 줄로 나뉘지 않는지 본다.
 *
 * 표의 유니크(inventory_part_issue_request_items_balance_unique)가 최종 방어선
 * 이지만, 거기까지 가면 사람에게는 「알 수 없는 오류」로 보인다. 정상적으로는
 * 생기지 않는 조합이다 — 잔량 행은 부품 하나에 속하고 한 부품 요청에 같은 부품
 * 줄은 하나뿐이라, 아래 부품 대조에서 먼저 걸린다. 그래도 남겨 두는 것은 그
 * 대조가 없는 길(직접 사용)과 앞으로 생길 길을 위해서다.
 */
function totalsByBalance(
  items: readonly { partStockBalanceId: string; quantity: number }[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (totals.has(item.partStockBalanceId)) {
      fail("INVALID_INPUT", "같은 재고를 한 신청에 두 번 적을 수 없습니다.");
    }
    totals.set(item.partStockBalanceId, item.quantity);
  }
  return totals;
}

/**
 * 🔴 **예약이 아니다.** 「결재를 다 받고 실행할 때 처음 알게 되는 것」을 앞으로
 * 당길 뿐이고, 이 검사를 통과했다고 그 수량이 이 신청의 것이 되지는 않는다 —
 * 그 사이 남이 가져가면 실행 시점에 기존 검사가 다시 막는다.
 */
function assertStockLooksSufficient(
  items: readonly { partStockBalanceId: string; quantity: number }[],
  balances: Map<string, BalanceSnapshot>
): void {
  for (const [balanceId, quantity] of totalsByBalance(items)) {
    const balance = balances.get(balanceId);
    if (!balance) fail("NOT_FOUND", "재고 정보를 찾을 수 없습니다.");
    if (quantity > balance.currentQuantity) {
      fail(
        "INSUFFICIENT_STOCK",
        `재고가 부족합니다. 현재 남은 수량은 ${balance.currentQuantity}개입니다.`
      );
    }
  }
}

/**
 * 요청 기반 불출 — 엔지니어가 올린 부품 요청에 대해 재고 담당자가 빼 주는 길.
 *
 * 보는 것은 지금의 불출 경로(issuePartRequest)가 보는 것과 **같은 기준**이다:
 * 요청이 실재하는가 · 접수 건이 아직 있는가 · 유·무상이 정해졌는가 · 지금
 * 불출할 수 있는 상태인가 · 그 요청의 줄이 맞는가 · 부품과 소유구분이 맞는가 ·
 * 남은 수량을 넘지 않는가. 여기서 미리 막지 않으면 결재를 다 받고 실행 순간에야
 * 같은 이유로 거절된다.
 *
 * 🔴 요청 줄·잔량 행을 잠그지 않는다. 이 길은 아무것도 바꾸지 않으므로 잠글
 * 것이 없고, 잠그면 진짜 불출을 붙잡아 둘 뿐이다.
 */
async function prepareRequestBasedIssue(
  tx: Tx,
  input: Extract<ValidatedCreatePartIssueRequestInput, { kind: "PART_REQUEST" }>
): Promise<PreparedIssueRequest> {
  const rawCheck = validateRawIssueAllocations(input.allocations);
  if (!rawCheck.ok) fail("INVALID_INPUT", rawCheck.message);

  const merged = mergeDuplicateAllocations(input.allocations);
  if (!merged.ok) fail("INVALID_INPUT", merged.message);

  const aggregated = aggregateAllocationsByItem(merged.allocations);
  if (!aggregated.ok) fail("INVALID_INPUT", aggregated.message);

  const [request] = await tx
    .select({
      id: inventoryPartRequests.id,
      repairCaseId: inventoryPartRequests.repairCaseId,
      status: inventoryPartRequests.status,
    })
    .from(inventoryPartRequests)
    .where(eq(inventoryPartRequests.id, input.partRequestId));
  if (!request) fail("NOT_FOUND", "해당 요청을 찾을 수 없습니다.");

  // 접수 건이 영구 삭제된 요청은 역사적 기록으로는 정상이지만 새로 빼 줄 곳이
  // 없다 — issuePartRequest 가 같은 자리에서 같은 말로 거절한다.
  if (!request.repairCaseId) {
    fail("NOT_FOUND", "이 요청과 연결된 접수 건이 더 이상 존재하지 않아 불출할 수 없습니다.");
  }

  const [repairCase] = await tx
    .select({ billingType: repairCases.billingType })
    .from(repairCases)
    .where(eq(repairCases.id, request.repairCaseId));
  if (repairCase?.billingType === "PENDING_DECISION") {
    fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 부품을 불출할 수 있습니다.");
  }

  if (!isRequestIssuable({ status: request.status })) {
    fail("NOT_ISSUABLE", "처리할 수 없는 요청 상태입니다.");
  }

  const itemIds = [...new Set(aggregated.aggregates.map((a) => a.requestItemId))].sort();
  const requestItems = await tx
    .select()
    .from(inventoryPartRequestItems)
    .where(inArray(inventoryPartRequestItems.id, itemIds))
    .orderBy(inventoryPartRequestItems.id);
  if (requestItems.length !== itemIds.length) fail("NOT_FOUND", "요청 항목을 찾을 수 없습니다.");
  for (const item of requestItems) {
    if (item.requestId !== request.id) {
      fail("INVALID_INPUT", "요청 항목이 해당 요청에 속하지 않습니다.");
    }
  }
  const itemById = new Map(requestItems.map((item) => [item.id, item]));

  const balances = await loadBalances(
    tx,
    merged.allocations.map((allocation) => allocation.partStockBalanceId)
  );

  // 부품 대조와 소유구분 대조 — issuePartRequest 와 같은 규칙이다. 요청자가 적은
  // 소유구분은 요구사항이지 참고값이 아니므로, 재고 담당자가 고른 자리가 다르면
  // 조용히 갈아치우지 않고 거절한다(옛 요청 줄은 소유구분이 NULL 이고 그때는
  // 지금까지처럼 어느 자리에서든 뺄 수 있다).
  for (const allocation of merged.allocations) {
    const item = itemById.get(allocation.requestItemId);
    const balance = balances.get(allocation.partStockBalanceId);
    if (!item || !balance) fail("NOT_FOUND", "요청 항목을 찾을 수 없습니다.");
    if (item.partId !== balance.partId) {
      fail("INVALID_INPUT", "선택한 재고의 부품이 요청 항목과 일치하지 않습니다.");
    }
    if (item.owner !== null && item.owner !== balance.owner) {
      fail("INVALID_INPUT", "선택한 재고의 소유구분이 요청한 소유구분과 일치하지 않습니다.");
    }
  }

  // 줄마다 **이번에 신청한 수량 전체**를 남은 수량과 견준다 — 낱개 배분을 따로
  // 보면 두 자리에서 조금씩 빼는 식으로 남은 수량을 넘길 수 있다.
  for (const aggregate of aggregated.aggregates) {
    const item = itemById.get(aggregate.requestItemId);
    if (!item) fail("NOT_FOUND", "요청 항목을 찾을 수 없습니다.");
    const sum = safeAddQuantity(item.issuedQuantity, aggregate.roundIssueQuantity);
    if (!sum.ok) fail("INVALID_INPUT", sum.message);
    if (sum.value > item.requestedQuantity) {
      const remaining = Math.max(0, item.requestedQuantity - item.issuedQuantity);
      fail(
        "EXCEEDS_REMAINING_REQUESTED",
        `요청 항목의 남은 수량(${remaining}개)을 초과하여 불출할 수 없습니다.`
      );
    }
  }

  const items = merged.allocations.map((allocation) => ({
    requestItemId: allocation.requestItemId,
    partStockBalanceId: allocation.partStockBalanceId,
    quantity: allocation.quantity,
  }));
  assertStockLooksSufficient(items, balances);

  return {
    // 🔴 접수 건·사용처·절차 작업은 여기 적지 않는다 — 부품 요청이 이미 들고
    // 있고, 같은 사실을 두 곳에 적으면 언젠가 갈라진다(표의 CHECK 이 막는다).
    header: {
      partRequestId: request.id,
      repairCaseId: null,
      destinationNote: null,
      procedureExecutionNodeId: null,
    },
    items,
  };
}

/**
 * 직접 사용 — 요청 없이 바로 빼는 길. 접수 건·사용처·절차 작업을 **이 신청이**
 * 들고 있어야 한다(실행할 때 consumeStock 에 그대로 넘길 값들이다).
 *
 * 보는 것은 consumeStock 이 보는 것과 같다: 수량이 1 이상인가 · 접수 건이나
 * 사용처 중 하나는 있는가 · 그 접수 건이 실재하고 유·무상이 정해졌는가 · 지정한
 * 절차 작업이 정말 그 접수 건의 것인가.
 */
async function prepareDirectUseIssue(
  tx: Tx,
  input: Extract<ValidatedCreatePartIssueRequestInput, { kind: "DIRECT_USE" }>
): Promise<PreparedIssueRequest> {
  const quantityCheck = validateRawQuantity(input.quantity);
  if (!quantityCheck.ok) fail("INVALID_INPUT", quantityCheck.message);

  if (!input.repairCaseId && !input.destinationNote) {
    fail("INVALID_INPUT", "수리 건 또는 사용처를 입력해 주세요.");
  }

  if (input.repairCaseId) {
    const [repairCase] = await tx
      .select({ id: repairCases.id, billingType: repairCases.billingType })
      .from(repairCases)
      .where(and(eq(repairCases.id, input.repairCaseId), eq(repairCases.isDeleted, false)));
    if (!repairCase) fail("NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
    if (repairCase.billingType === "PENDING_DECISION") {
      fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 재고를 사용할 수 있습니다.");
    }
  }

  if (input.procedureExecutionNodeId) {
    if (!input.repairCaseId) {
      fail("INVALID_INPUT", "절차 작업을 지정하려면 수리 건도 함께 지정해야 합니다.");
    }
    const [node] = await tx
      .select({ executionId: procedureCaseExecutionNodes.executionId })
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.id, input.procedureExecutionNodeId));
    if (!node) fail("INVALID_INPUT", "해당 절차 작업을 찾을 수 없습니다.");

    const [execution] = await tx
      .select({ repairCaseId: procedureCaseExecutions.repairCaseId })
      .from(procedureCaseExecutions)
      .where(eq(procedureCaseExecutions.id, node.executionId));
    // 접수 건이 영구 삭제된 절차 작업의 null 은 여기서 저절로 걸린다(null 은
    // 어떤 uuid 와도 같지 않다) — consumeStock 과 같은 자리, 같은 이유다.
    if (!execution || execution.repairCaseId !== input.repairCaseId) {
      fail("INVALID_INPUT", "지정한 절차 작업이 해당 수리 건에 속하지 않습니다.");
    }
  }

  const balances = await loadBalances(tx, [input.partStockBalanceId]);
  const items = [
    {
      // 요청 기반이 아니므로 요청 줄이 없다 — NULL 이 정상값이다.
      requestItemId: null,
      partStockBalanceId: input.partStockBalanceId,
      quantity: input.quantity,
    },
  ];
  assertStockLooksSufficient(items, balances);

  return {
    header: {
      partRequestId: null,
      repairCaseId: input.repairCaseId,
      destinationNote: input.destinationNote,
      procedureExecutionNodeId: input.procedureExecutionNodeId,
    },
    items,
  };
}

export type CreatePartIssueRequestInput = ValidatedCreatePartIssueRequestInput & {
  actorUserId: string;
};

export type CreatePartIssueRequestResult =
  | {
      ok: true;
      issueRequestId: string;
      /** 방금 만들어진 **1단계 결재 행**. 신청 하나에 열린 행은 언제나 하나다. */
      approvalId: string;
      routeId: string;
      /** 🔴 신청자 본인 단계를 건너뛴 **뒤의 실제 번호**다(1이 아닐 수 있다). */
      routeStepOrder: number;
      assignedApproverUserId: string;
    }
  | PartIssueActionFailure;

/**
 * 불출 신청 하나를 만든다 — 신청 헤더 + 항목들 + **첫 결재 행 하나**.
 *
 * 한 트랜잭션 안에서 전부 만들어지거나 하나도 만들어지지 않는다. 막힌 신청이
 * 행을 남기면 「결재선이 잘못 짜여 거절됐는데 신청은 남아 있는」 상태가 되고,
 * 그 신청은 아무도 결재할 수 없다.
 */
export async function createPartIssueRequest(
  input: CreatePartIssueRequestInput
): Promise<CreatePartIssueRequestResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      // 🔴 인가 — **새 역할 목록을 만들지 않는다.** 재고 영역의 판정은 설정
      // (사용자 관리 > 역할별 접근 권한)이 최종이고, 지금 두 불출 경로가 각각
      // 무엇을 묻는지 그대로 따라간다:
      //  · 요청 기반 → 부품 요청 처리(불출)를 할 수 있는가 — issuePartRequest 와
      //    같은 영역 열쇠·같은 수준이다.
      //  · 직접 사용 → 재고를 움직일 수 있는가 — consumeStock 과 같다.
      // 역할 명단을 여기 적으면 설정 화면에서 연 권한이 이 길에만 닿지 않는다.
      const allowed =
        input.kind === "PART_REQUEST"
          ? await hasPermission(actor, "inventory.requestProcessing", "MANAGE")
          : await hasPermission(actor, "inventory.stock", "WRITE");
      if (!allowed) {
        fail(
          "FORBIDDEN",
          input.kind === "PART_REQUEST" ? "불출 권한이 없습니다." : "재고를 사용할 권한이 없습니다."
        );
      }

      const prepared =
        input.kind === "PART_REQUEST"
          ? await prepareRequestBasedIssue(tx, input)
          : await prepareDirectUseIssue(tx, input);

      // 🔴 결재선 — 「현재 판」의 정의는 여기 적지 않는다. 그 용도 안에서 version
      // 이 가장 큰 판 하나이고, 그 정의가 적힌 곳은 queries/shipment-approval-
      // routes.ts 하나다. 용도 문자열도 글자로 적지 않는다(도메인 상수 하나).
      const route = await getCurrentShipmentApprovalRouteChain(tx, PART_ISSUE_APPROVAL_ROUTE_SCOPE);
      // 🔴 「절차가 쓰이고 있는가」의 판정은 **한 곳에만** 적힌다
      // (mutations/inventory.ts 의 isPartIssueApprovalRouteInForce). 두 불출
      // 경로의 문이 같은 함수를 반대 방향으로 본다 — 한쪽만 「단계 0개」를 절차로
      // 치면 신청도 못 하고 불출도 못 하는 상태가 생긴다.
      if (!isPartIssueApprovalRouteInForce(route)) {
        // 판이 없는 것도 단계가 0개인 것도 「절차를 쓰지 않겠다」는 같은 뜻이다.
        fail(
          "ROUTE_NOT_CONFIGURED",
          "부품 불출 승인 절차가 아직 설정되지 않았습니다. 사용자 관리 > 승인 절차에서 부품 불출 절차를 먼저 만들어 주세요."
        );
      }

      // 🔴 고르는 규칙을 여기 적지 않는다 — 아래 사슬 잇는 자리(결재 mutation)가
      // **같은 함수**를 부른다. 두 곳에 적으면 「신청할 때는 건너뛰는데 사슬에서는
      // 안 건너뛴다」가 되고, 그때 신청자는 자기 차례를 받는다.
      const firstStep = findNextRouteStepToApprove(route.steps, 0, actor.id);
      if (!firstStep) {
        fail(
          "ROUTE_HAS_NO_OTHER_APPROVER",
          "승인 절차의 모든 단계가 신청자 본인으로 지정되어 있어 불출 승인을 요청할 수 없습니다. 승인 절차에 다른 사람을 넣어 주세요."
        );
      }

      const [created] = await tx
        .insert(inventoryPartIssueRequests)
        .values({
          ...prepared.header,
          status: "PENDING_APPROVAL",
          requestedByUserId: actor.id,
          requestReason: input.requestReason,
        })
        .returning({ id: inventoryPartIssueRequests.id });

      await tx.insert(inventoryPartIssueRequestItems).values(
        prepared.items.map((item) => ({
          issueRequestId: created.id,
          requestItemId: item.requestItemId,
          partStockBalanceId: item.partStockBalanceId,
          quantity: item.quantity,
        }))
      );

      const [approval] = await tx
        .insert(inventoryPartIssueApprovals)
        .values({
          issueRequestId: created.id,
          status: "REQUESTED",
          routeId: route.routeId,
          // 🔴 **건너뛴 뒤의 실제 번호**를 적는다. 1로 고쳐 적으면 이 번호로 다음
          // 단계를 찾을 때 이미 지나온 단계로 되돌아간다.
          routeStepOrder: firstStep.stepOrder,
          assignedApproverUserId: firstStep.approverUserId,
          requestedByUserId: actor.id,
          requestReason: input.requestReason,
        })
        .returning({ id: inventoryPartIssueApprovals.id });

      return {
        ok: true,
        issueRequestId: created.id,
        approvalId: approval.id,
        routeId: route.routeId,
        routeStepOrder: firstStep.stepOrder,
        assignedApproverUserId: firstStep.approverUserId,
      };
    });
  } catch (err) {
    if (err instanceof PartIssueMutationError) return err.result;
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "이미 처리 대기 중인 결재가 있습니다. 최신 정보를 다시 불러와 주세요.",
      };
    }
    throw err;
  }
}

export type DecidePartIssueRequestApprovalInput = {
  issueRequestId: string;
  decision: PartIssueApprovalDecision;
  actorUserId: string;
  decisionReason: string | null;
};

export type DecidePartIssueRequestApprovalResult =
  | {
      ok: true;
      issueRequestId: string;
      /** 방금 결정된 행. */
      approvalId: string;
      /** 결정 뒤의 **신청 상태**. 중간 단계면 PENDING_APPROVAL 그대로다. */
      status: InventoryPartIssueRequestStatus;
      /** 사슬이 이어졌으면 새로 열린 행, 끝났으면 `null`. */
      nextApprovalId: string | null;
    }
  | PartIssueActionFailure;

/**
 * 한 단계를 승인하거나 반려한다 — 그리고 승인이면 **다음 단계를 이어 연다.**
 *
 * mutations/repair-case-approvals.ts 의 decideRepairCaseApproval 을 그대로
 * 본떴다. 다른 점은 하나뿐이다: **대표·위임 판정이 없다.** 부품 불출에는 대표
 * 같은 것이 없고, 결재선에 올라간 사람(과 최고관리자)만 처리한다.
 */
export async function decidePartIssueRequestApproval(
  input: DecidePartIssueRequestApprovalInput
): Promise<DecidePartIssueRequestApprovalResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      // 신청 헤더를 먼저 잠근다 — 같은 신청을 동시에 결재·취소하려는 트랜잭션이
      // 여기서 줄을 선다. 뒤에 온 쪽은 커밋 뒤의 상태를 다시 읽고 CONFLICT 로
      // 떨어진다.
      const [request] = await tx
        .select({
          id: inventoryPartIssueRequests.id,
          status: inventoryPartIssueRequests.status,
        })
        .from(inventoryPartIssueRequests)
        .where(eq(inventoryPartIssueRequests.id, input.issueRequestId))
        .for("update");
      if (!request) fail("NOT_FOUND", "해당 불출 신청을 찾을 수 없습니다.");

      const [latest] = await tx
        .select({
          id: inventoryPartIssueApprovals.id,
          status: inventoryPartIssueApprovals.status,
          routeId: inventoryPartIssueApprovals.routeId,
          routeStepOrder: inventoryPartIssueApprovals.routeStepOrder,
          assignedApproverUserId: inventoryPartIssueApprovals.assignedApproverUserId,
          requestedByUserId: inventoryPartIssueApprovals.requestedByUserId,
          requestReason: inventoryPartIssueApprovals.requestReason,
        })
        .from(inventoryPartIssueApprovals)
        .where(eq(inventoryPartIssueApprovals.issueRequestId, request.id))
        .orderBy(desc(inventoryPartIssueApprovals.requestedAt))
        .limit(1)
        .for("update");
      if (!latest) fail("NOT_FOUND", "관련 결재 요청을 찾을 수 없습니다.");

      if (!isPartIssueRequestAwaitingApproval(request.status)) {
        fail("CONFLICT", "이미 처리된 불출 신청입니다. 최신 정보를 다시 불러와 주세요.");
      }
      if (latest.status !== "REQUESTED") {
        fail("CONFLICT", "이미 처리된 결재입니다. 최신 정보를 다시 불러와 주세요.");
      }

      // 🔴 지정 관문 — **계정 자격을 본 뒤에** 얹는다(requireActor 가 위에서 이미
      // 봤다). 순서가 뒤집히면 지정이 권한을 만들어 낸다. 판정 자체는 여기서
      // 새로 적지 않고 출하 승인·알림 조회와 **같은 함수 하나**를 부른다.
      if (
        !mayDecideAssignedApproval(latest.assignedApproverUserId, {
          id: actor.id,
          role: actor.role,
          isDeveloper: actor.isDeveloper,
        })
      ) {
        // 「권한이 없습니다」만 돌려주면 사람은 무엇을 해야 할지 모른다 — 누구에게
        // 지정되어 있는지 이름을 넣는다.
        const [assignee] = latest.assignedApproverUserId
          ? await tx
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, latest.assignedApproverUserId))
          : [];
        fail(
          "FORBIDDEN",
          assignee
            ? `이 결재는 ${assignee.name} 님에게 지정되어 있어 다른 사람은 처리할 수 없습니다.`
            : "이 결재는 지정된 승인자만 처리할 수 있습니다."
        );
      }

      if (input.decision === "REJECTED" && !input.decisionReason) {
        // 표의 CHECK 이 최종적으로 막지만, 여기서 먼저 사람 말로 말한다.
        fail("INVALID_INPUT", "반려 시에는 사유를 입력해야 합니다.");
      }

      const decided = await tx
        .update(inventoryPartIssueApprovals)
        .set({
          status: input.decision,
          decidedByUserId: actor.id,
          decidedAt: new Date(),
          decisionReason: input.decisionReason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryPartIssueApprovals.id, latest.id),
            eq(inventoryPartIssueApprovals.status, "REQUESTED")
          )
        )
        .returning({ id: inventoryPartIssueApprovals.id });
      if (decided.length === 0) {
        fail("CONFLICT", "이미 처리된 결재입니다. 최신 정보를 다시 불러와 주세요.");
      }

      if (input.decision === "REJECTED") {
        // 사슬이 끊긴다 — 다음 행을 만들지 않는다. 다시 받으려면 신청을 새로
        // 올린다(그때 1단계부터 다시 시작한다).
        await setRequestStatus(tx, request.id, request.status, "REJECTED");
        return {
          ok: true,
          issueRequestId: request.id,
          approvalId: latest.id,
          status: "REJECTED" as const,
          nextApprovalId: null,
        };
      }

      // 🔴 사슬을 잇는다 — 반드시 위의 UPDATE **뒤**다. 앞 행이 아직 REQUESTED 인
      // 채로 INSERT 하면 부분 유니크(한 신청에 열린 행은 하나)에 걸린다. 그
      // 인덱스가 곧 「한 번에 한 단계」의 보증이므로 우회하지 않고 순서로 푼다.
      let nextApprovalId: string | null = null;
      if (latest.routeId !== null && latest.routeStepOrder !== null) {
        // 「현재 판」이 아니라 **이 행에 적힌 판**으로 다음 단계를 찾는다 —
        // 진행 중인 신청은 관리자가 절차를 바꿔도 옛 판을 끝까지 따라간다.
        //
        // 🔴 요청자는 **이 사슬을 올린 사람**(latest.requestedByUserId)이지 방금
        // 결재한 사람이 아니다. 사슬이 나아가도 요청자는 그대로이고, 그 값이 다음
        // 행에 그대로 물려 내려간다.
        const steps = await getShipmentApprovalRouteSteps(tx, latest.routeId);
        const nextStep = findNextRouteStepToApprove(
          steps,
          latest.routeStepOrder,
          latest.requestedByUserId
        );
        if (nextStep) {
          const [next] = await tx
            .insert(inventoryPartIssueApprovals)
            .values({
              issueRequestId: request.id,
              status: "REQUESTED",
              routeId: latest.routeId,
              routeStepOrder: nextStep.stepOrder,
              assignedApproverUserId: nextStep.approverUserId,
              // 요청은 여전히 그 사람이 한 것이다 — 사슬이 나아갈 뿐이라
              // 요청자·사유를 물려받는다.
              requestedByUserId: latest.requestedByUserId,
              requestReason: latest.requestReason,
              // 🔴 requested_at 은 물려받지 않는다(표 기본값). 앞 행과 같은
              // 시각이 되면 「가장 최근 행」을 고르는 조회가 어느 행을 고를지
              // 정해지지 않는다.
            })
            .returning({ id: inventoryPartIssueApprovals.id });
          nextApprovalId = next.id;
        }
      }

      if (nextApprovalId !== null) {
        // 아직 결재 중이다 — 신청 상태는 그대로 둔다.
        return {
          ok: true,
          issueRequestId: request.id,
          approvalId: latest.id,
          status: request.status,
          nextApprovalId,
        };
      }

      // 다음 단계가 없다 = 마지막 단계였거나, 남은 단계가 전부 신청자 본인이었다.
      // 둘 다 정상이고 그때 결재가 끝난다.
      //
      // 🔴 **여기서 재고를 빼지 않는다.** 상태는 APPROVED 까지다 — 실행은 재고
      // 담당자가 따로 누르고(executePartIssueRequest), 그때 재고와 상태가 한
      // 트랜잭션에서 함께 바뀐다. 마지막 결재자가 「재고 부족」으로 막히면 안 되는
      // 것이 승인과 실행을 나눈 이유다(표 머리말).
      await setRequestStatus(tx, request.id, request.status, "APPROVED");
      return {
        ok: true,
        issueRequestId: request.id,
        approvalId: latest.id,
        status: "APPROVED" as const,
        nextApprovalId: null,
      };
    });
  } catch (err) {
    if (err instanceof PartIssueMutationError) return err.result;
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "이미 처리 대기 중인 결재가 있습니다. 최신 정보를 다시 불러와 주세요.",
      };
    }
    throw err;
  }
}

/**
 * 신청 상태를 옮긴다 — **갈 수 있는 곳인지 순수 규칙에 먼저 물어본다.**
 *
 * 규칙이 적힌 곳은 domain/inventory-part-issue-rules.ts 하나뿐이고
 * (canTransitionPartIssueRequestStatus), 이 함수는 그 답을 따를 뿐이다. 여기서
 * 조건을 다시 적으면 화면·조회·저장이 서로 다른 전이표를 갖게 된다.
 */
async function setRequestStatus(
  tx: Tx,
  issueRequestId: string,
  from: InventoryPartIssueRequestStatus,
  to: InventoryPartIssueRequestStatus
): Promise<void> {
  if (!canTransitionPartIssueRequestStatus(from, to)) {
    fail("CONFLICT", "이미 처리된 불출 신청입니다. 최신 정보를 다시 불러와 주세요.");
  }
  await tx
    .update(inventoryPartIssueRequests)
    .set({ status: to, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryPartIssueRequests.id, issueRequestId),
        eq(inventoryPartIssueRequests.status, from)
      )
    );
}

export type CancelPartIssueRequestInput = {
  issueRequestId: string;
  actorUserId: string;
  /** 왜 무르는가. 없어도 된다 — 열린 결재 행이 있으면 거기에 함께 적힌다. */
  reason: string | null;
};

export type CancelPartIssueRequestResult =
  | { ok: true; issueRequestId: string; status: "CANCELLED"; closedApprovalId: string | null }
  | PartIssueActionFailure;

/**
 * 신청을 무른다 — 신청한 사람이 되돌리는 길이다.
 *
 * ── 🔴 열린 결재 행을 어떻게 정리하는가 ─────────────────────────────────
 * 지우지 않는다. 이 저장소는 물리 삭제를 원칙적으로 금지하고, 무엇보다 「누가
 * 언제 무엇을 승인했나」는 지워서는 안 되는 사실이다. 그래서 **행을 닫는다** —
 * 결정 상태를 REJECTED 로 두고, 결정자에 무른 사람을, 사유에 「신청 취소로
 * 종료」라고 적는다.
 *
 * 열어 둔 채로 남기지 않는 이유: 그 행은 아무도 결재할 수 없는데 상태만
 * REQUESTED 로 남는다. 지금 대기 목록은 신청 상태까지 함께 보므로 잡히지 않지만
 * (queries/inventory-part-issue-requests.ts), 결재 행만 보는 조회가 하나라도
 * 생기면 그날 유령 대기 건이 나타난다. 「지금은 괜찮다」에 기대는 대신 닫는다.
 *
 * REJECTED 를 쓰는 것은 표의 결정 상태에 그것 말고 닫는 값이 없기 때문이다
 * (REQUESTED · APPROVED · REJECTED). 값을 하나 더하려면 마이그레이션이 필요하고,
 * 이 조각에는 스키마 변경이 없다. 결정자가 **신청자 본인**이고 사유에 취소라고
 * 적혀 있으므로 이력을 되짚을 때 「결재자가 반려했다」와 헷갈리지 않는다.
 *
 * ── 최고관리자 비상구를 두지 않는 이유 ──────────────────────────────────
 * 취소는 아무것도 움직이지 않으므로 막혀도 위험이 없고, 신청자가 자리를 비운
 * 신청은 **반려**로 닫을 수 있다(지정된 결재자와 최고관리자가 언제나 할 수
 * 있다). 남을 대신해 무르는 길을 여기 열면 「내가 올린 것을 남이 물렸다」가
 * 조용히 가능해진다.
 */
export async function cancelPartIssueRequest(
  input: CancelPartIssueRequestInput
): Promise<CancelPartIssueRequestResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const [request] = await tx
        .select({
          id: inventoryPartIssueRequests.id,
          status: inventoryPartIssueRequests.status,
          requestedByUserId: inventoryPartIssueRequests.requestedByUserId,
        })
        .from(inventoryPartIssueRequests)
        .where(eq(inventoryPartIssueRequests.id, input.issueRequestId))
        .for("update");
      if (!request) fail("NOT_FOUND", "해당 불출 신청을 찾을 수 없습니다.");

      if (request.requestedByUserId !== actor.id) {
        fail("FORBIDDEN", "신청한 사람만 불출 신청을 취소할 수 있습니다.");
      }

      // 🔴 「무를 수 있는가」를 여기서 다시 적지 않는다 — 순수 규칙 하나가 쥐고
      // 있고(isPartIssueRequestCancellable) 화면의 [신청 취소] 단추도 같은 것을
      // 본다.
      if (!isPartIssueRequestCancellable(request.status)) {
        fail(
          "NOT_CANCELLABLE",
          request.status === "EXECUTED"
            ? "이미 재고가 나간 신청은 취소할 수 없습니다. 되돌리려면 반품으로 처리해 주세요."
            : "이미 종료된 불출 신청은 취소할 수 없습니다."
        );
      }

      const [open] = await tx
        .select({ id: inventoryPartIssueApprovals.id })
        .from(inventoryPartIssueApprovals)
        .where(
          and(
            eq(inventoryPartIssueApprovals.issueRequestId, request.id),
            eq(inventoryPartIssueApprovals.status, "REQUESTED")
          )
        )
        .for("update");

      let closedApprovalId: string | null = null;
      if (open) {
        const reason = input.reason
          ? `신청자가 불출 신청을 취소했습니다. (${input.reason})`
          : "신청자가 불출 신청을 취소했습니다.";
        const closed = await tx
          .update(inventoryPartIssueApprovals)
          .set({
            status: "REJECTED",
            decidedByUserId: actor.id,
            decidedAt: new Date(),
            decisionReason: reason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventoryPartIssueApprovals.id, open.id),
              eq(inventoryPartIssueApprovals.status, "REQUESTED")
            )
          )
          .returning({ id: inventoryPartIssueApprovals.id });
        if (closed.length === 0) {
          fail("CONFLICT", "결재가 방금 처리되었습니다. 최신 정보를 다시 불러와 주세요.");
        }
        closedApprovalId = closed[0].id;
      }

      await setRequestStatus(tx, request.id, request.status, "CANCELLED");

      return { ok: true, issueRequestId: request.id, status: "CANCELLED" as const, closedApprovalId };
    });
  } catch (err) {
    if (err instanceof PartIssueMutationError) return err.result;
    throw err;
  }
}

/**
 * ============================================================================
 * 실행 — 승인된 신청으로 **실제로 재고를 뺀다**
 * ============================================================================
 * 이 파일에서 재고를 움직이는 함수는 아래 하나뿐이다. 그리고 직접 움직이지
 * 않는다 — 이미 검증된 두 경로의 **안쪽 함수**를 자기 트랜잭션 안에서 부른다
 * (issuePartRequestCore · consumeStockCore). 수량 검사·잔량 갱신·장부 기록·
 * 잠금 순서는 전부 그쪽에 있고 여기서 다시 적지 않는다.
 *
 * ── 🔴 재고 이동과 상태 변경이 **한 트랜잭션**이다 ──────────────────────
 * 나뉘면 「재고는 나갔는데 신청은 아직 승인됨」이 실재하게 되고, 그 신청은 다시
 * 실행될 수 있다. 겉 함수(issuePartRequest · consumeStock)를 부르지 않고 안쪽
 * 함수를 부르는 이유가 이것이다 — 겉은 자기 트랜잭션을 열어 다른 연결을 쓴다.
 *
 * ── 🔴 문에 걸리지 않는다 ───────────────────────────────────────────────
 * 안쪽 함수에는 「부품 불출 승인 절차」 문이 없다. 있으면 승인을 받고도 실행할 수
 * 없게 된다 — 문은 겉에만 있다.
 *
 * ── 🔴 화면이 보낸 수량을 쓰지 않는다 ───────────────────────────────────
 * 무엇을 승인했는지는 **신청 항목**에 적혀 있다
 * (inventory_part_issue_request_items). 실행은 그 잔량 행과 그 수량으로만 한다 —
 * 그것과 다른 것이 나가면 「승인받은 것과 다른 것이 나갔다」가 되고, 나중에 그것을
 * 밝혀낼 방법이 없다. 그래서 이 mutation 은 신청 id 와 실행자 말고는 아무것도
 * 받지 않는다.
 * ============================================================================
 */

/**
 * 실행이 쓰는 **중복 방지 열쇠의 이름공간** — 고정 UUID 하나다(RFC 4122 v5 의
 * namespace 와 같은 자리). 값 자체에는 뜻이 없고, 바뀌면 안 된다: 바뀌는 순간
 * 이미 실행된 신청의 열쇠가 달라져 「두 번 눌러도 한 번만 나간다」가 깨진다.
 */
const PART_ISSUE_EXECUTION_IDEMPOTENCY_NAMESPACE = "9c1d4b7e-5a30-4f21-8e6c-2b7f0d93a641";

/**
 * 🔴 **신청 id 에서 유도한 중복 방지 열쇠.** 같은 신청은 몇 번을 눌러도 같은
 * 열쇠를 만들고, 그래서 요청 기반 불출의 멱등 장치가 두 번째를 재생(replay)으로
 * 돌려준다.
 *
 * 무작위 값을 쓰면 안 된다 — 그러면 두 번 누른 것이 서로 다른 두 불출이 된다.
 * 신청 id 를 **그대로** 쓰지 않는 것은 화면이 보낸 열쇠와 같은 공간을 쓰기
 * 때문이다: 유도해 두면 그 둘이 우연히도 겹치지 않는다.
 *
 * 표의 칸이 uuid 라 결과도 uuid 여야 한다(text 가 아니다). v5 와 같은 방식으로
 * 접는다 — 이름공간 16바이트 + 이름을 SHA-1 로 접고 판·변종 비트를 박는다.
 */
function derivePartIssueExecutionIdempotencyKey(issueRequestId: string): string {
  const namespaceBytes = Buffer.from(
    PART_ISSUE_EXECUTION_IDEMPOTENCY_NAMESPACE.replace(/-/g, ""),
    "hex"
  );
  const digest = createHash("sha1").update(namespaceBytes).update(issueRequestId, "utf8").digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // 판(version) 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 변종(variant)
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 안쪽이 돌려준 실패를 **이 영역의 말로 옮긴다.**
 *
 * 🔴 **메시지는 손대지 않는다** — 「재고가 부족합니다」·「요청 항목의 남은
 * 수량(3개)을 초과하여…」는 사람이 실제로 읽고 행동할 문장이고, 여기서 뭉뚱그리면
 * 실행이 왜 막혔는지 알 수 없게 된다. 코드만 이 영역에 있는 이름으로 바꾼다.
 *
 * 두 union 에만 있고 이쪽에는 없는 값들(멱등 관련·반품 관련·잠긴 접수 건)은
 * CONFLICT 로 모은다. 실행 경로에서 실제로 나올 수 있는 값이 아니고(열쇠는 신청
 * id 에서 유도하고, 반품은 이 길로 오지 않는다), 나온다면 「새로 고쳐 다시
 * 보라」가 사람에게 할 수 있는 유일한 말이다.
 */
function toPartIssueFailureCode(
  code: InventoryPartRequestResultCode | InventoryMutationResultCode
): PartIssueActionResultCode {
  switch (code) {
    case "FORBIDDEN":
    case "NOT_FOUND":
    case "CONFLICT":
    case "INVALID_INPUT":
    case "INSUFFICIENT_STOCK":
    case "EXCEEDS_REMAINING_REQUESTED":
    case "NOT_ISSUABLE":
    case "BILLING_DECISION_REQUIRED":
      return code;
    default:
      return "CONFLICT";
  }
}

export type ExecutePartIssueRequestInput = {
  issueRequestId: string;
  actorUserId: string;
};

export type ExecutePartIssueRequestResult =
  | {
      ok: true;
      issueRequestId: string;
      status: "EXECUTED";
      /** 요청 기반이면 방금 만들어진 **불출 사건** id. 직접 사용이면 `null`. */
      requestIssueId: string | null;
      /** 실제로 빠져나간 잔량 행들 — 화면이 「무엇이 나갔는지」를 그대로 보여 준다. */
      movedBalanceIds: string[];
    }
  | PartIssueActionFailure;

/**
 * 승인된 불출 신청 하나를 실행한다.
 *
 * 순서에 이유가 있다:
 *  1. **신청 헤더를 먼저 잠근다.** 같은 신청을 동시에 실행·취소하려는 트랜잭션이
 *     여기서 줄을 선다. 뒤에 온 쪽은 커밋 뒤의 상태(EXECUTED)를 다시 읽고 거절
 *     된다 — 이것이 「두 번 눌러도 한 번만 나간다」의 1차 방어선이다.
 *  2. **지금 실행할 수 있는가**는 순수 규칙 하나가 답한다
 *     (isPartIssueRequestExecutable — APPROVED 하나뿐이다).
 *  3. **자격**을 묻는다. 갈래마다 기존 두 불출 경로와 같은 영역 열쇠·같은 수준
 *     이다. 안쪽 함수도 자기 안에서 같은 것을 다시 묻는다 — 여기서 먼저 묻는
 *     것은 아무것도 잠그기 전에 막기 위해서다.
 *  4. **신청 항목**을 읽어 그것으로만 실행한다.
 *  5. 안쪽 함수를 **같은 tx** 로 부른다.
 *  6. 안쪽이 실패하면 그 실패를 그대로 돌려주고 **트랜잭션째 되돌린다.** 신청은
 *     APPROVED 로 남는다 — 입고 뒤에 다시 누르면 된다.
 *  7. 성공하면 헤더를 EXECUTED + 실행자 + 실행 시각으로 **한꺼번에** 바꾼다
 *     (표의 CHECK 이 셋을 함께 요구한다). WHERE 에 `status = 'APPROVED'` 를 걸어
 *     둔 것은 잠금이 이미 막고 있는 경쟁에 대한 최종 방어선이다.
 */
export async function executePartIssueRequest(
  input: ExecutePartIssueRequestInput
): Promise<ExecutePartIssueRequestResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const [request] = await tx
        .select({
          id: inventoryPartIssueRequests.id,
          status: inventoryPartIssueRequests.status,
          partRequestId: inventoryPartIssueRequests.partRequestId,
          repairCaseId: inventoryPartIssueRequests.repairCaseId,
          destinationNote: inventoryPartIssueRequests.destinationNote,
          procedureExecutionNodeId: inventoryPartIssueRequests.procedureExecutionNodeId,
        })
        .from(inventoryPartIssueRequests)
        .where(eq(inventoryPartIssueRequests.id, input.issueRequestId))
        .for("update");
      if (!request) fail("NOT_FOUND", "해당 불출 신청을 찾을 수 없습니다.");

      // 🔴 판정을 여기서 다시 적지 않는다 — 순수 규칙 하나가 쥐고 있고, 화면의
      // [실행] 단추와 「실행할 차례인 신청」 목록도 같은 것을 본다.
      if (!isPartIssueRequestExecutable(request.status)) {
        fail("NOT_EXECUTABLE", executionBlockedMessage(request.status));
      }

      // 🔴 자격 — **새 역할 목록을 만들지 않는다.** 갈래마다 지금 그 불출을 하는
      // 경로가 묻는 것과 글자 그대로 같은 영역·같은 수준을 묻는다(신청을 만들 때
      // 물은 것과도 같다).
      const allowed =
        request.partRequestId !== null
          ? await hasPermission(actor, "inventory.requestProcessing", "MANAGE")
          : await hasPermission(actor, "inventory.stock", "WRITE");
      if (!allowed) {
        fail(
          "FORBIDDEN",
          request.partRequestId !== null ? "불출 권한이 없습니다." : "재고를 사용할 권한이 없습니다."
        );
      }

      const items = await tx
        .select({
          id: inventoryPartIssueRequestItems.id,
          requestItemId: inventoryPartIssueRequestItems.requestItemId,
          partStockBalanceId: inventoryPartIssueRequestItems.partStockBalanceId,
          quantity: inventoryPartIssueRequestItems.quantity,
        })
        .from(inventoryPartIssueRequestItems)
        .where(eq(inventoryPartIssueRequestItems.issueRequestId, request.id))
        // 잔량 행 id 순 — 안쪽 함수의 잠금 순서와 같은 기준이라 서로 다른 실행이
        // 같은 두 잔량 행을 반대 순서로 잡는 일이 없다.
        .orderBy(asc(inventoryPartIssueRequestItems.partStockBalanceId));
      if (items.length === 0) {
        // 신청을 만드는 길이 항목 0개를 막으므로 실제로는 생기지 않는다.
        fail("CONFLICT", "이 불출 신청에는 실행할 항목이 없습니다.");
      }

      const movedBalanceIds = items.map((item) => item.partStockBalanceId);
      let requestIssueId: string | null = null;

      if (request.partRequestId !== null) {
        // ── 요청 기반 ──────────────────────────────────────────────────
        const allocations = items.map((item) => {
          if (item.requestItemId === null) {
            // 헤더는 요청 기반인데 줄에 요청 항목이 없다 — 신청을 만드는 길이
            // 짝을 맞추므로 생기지 않는다(표는 그 짝을 강제하지 않는다).
            fail("CONFLICT", "불출 신청 항목이 부품 요청과 짝이 맞지 않습니다.");
          }
          return {
            requestItemId: item.requestItemId,
            partStockBalanceId: item.partStockBalanceId,
            quantity: item.quantity,
          };
        });

        const issued = await issuePartRequestCore(tx, {
          requestId: request.partRequestId,
          allocations,
          note: null,
          actorUserId: actor.id,
          // 🔴 신청 id 에서 유도한다 — 두 번 눌러도 한 번만 나간다.
          idempotencyKey: derivePartIssueExecutionIdempotencyKey(request.id),
        });
        requestIssueId = issued.requestIssueId;
      } else {
        // ── 직접 사용 ──────────────────────────────────────────────────
        for (const item of items) {
          // 🔴 `expectedVersion` 은 **지금 이 트랜잭션에서 읽은 값**이다. 신청
          // 시점의 판번호는 이미 낡았다(그 사이 입고·반품이 있었으면 실행이 늘
          // CONFLICT 로 막힌다). 여기서 잠그고 읽으므로 안쪽이 다시 잠글 때까지
          // 아무도 끼어들 수 없다.
          const [balance] = await tx
            .select({ version: partStockBalances.version })
            .from(partStockBalances)
            .where(eq(partStockBalances.id, item.partStockBalanceId))
            .for("update");
          if (!balance) fail("NOT_FOUND", "재고 정보를 찾을 수 없습니다.");

          await consumeStockCore(tx, {
            partStockBalanceId: item.partStockBalanceId,
            quantity: item.quantity,
            // 접수 건·사용처·절차 작업은 **신청 헤더가** 들고 있다(표의 CHECK).
            repairCaseId: request.repairCaseId,
            destinationNote: request.destinationNote,
            procedureExecutionNodeId: request.procedureExecutionNodeId,
            actorUserId: actor.id,
            expectedVersion: balance.version,
          });
        }
      }

      // 🔴 세 값을 **한꺼번에** 쓴다 — 표의 CHECK 이 status='EXECUTED' 와 실행 두
      // 칸을 함께 요구한다. 그리고 `status = 'APPROVED'` 를 걸어 둔다.
      const updated = await tx
        .update(inventoryPartIssueRequests)
        .set({
          status: "EXECUTED",
          executedByUserId: actor.id,
          executedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryPartIssueRequests.id, request.id),
            eq(inventoryPartIssueRequests.status, "APPROVED")
          )
        )
        .returning({ id: inventoryPartIssueRequests.id });
      if (updated.length === 0) {
        // 헤더를 이미 잠그고 있으므로 실제로는 닿지 않는 자리다. 그래도 둔다 —
        // 여기서 멈추면 **재고 이동도 함께 되돌아간다**(같은 트랜잭션이다).
        fail("CONFLICT", "이 불출 신청이 방금 다른 곳에서 처리되었습니다. 최신 정보를 다시 불러와 주세요.");
      }

      return {
        ok: true,
        issueRequestId: request.id,
        status: "EXECUTED" as const,
        requestIssueId,
        movedBalanceIds,
      };
    });
  } catch (err) {
    if (err instanceof PartIssueMutationError) return err.result;
    // 🔴 안쪽 함수가 던진 실패 — 여기까지 올라왔다는 것은 **트랜잭션이 통째로
    // 되돌아갔다**는 뜻이다. 재고도 상태도 그대로이고, 신청은 APPROVED 로 남는다.
    const innerFailure = extractPartRequestFailure(err) ?? extractInventoryFailure(err);
    if (innerFailure) {
      return {
        ok: false,
        code: toPartIssueFailureCode(innerFailure.code),
        message: innerFailure.message,
      };
    }
    throw err;
  }
}

/** 왜 지금 실행할 수 없는지 — 상태마다 사람이 할 일이 다르다. */
function executionBlockedMessage(status: InventoryPartIssueRequestStatus): string {
  if (status === "PENDING_APPROVAL") return "아직 결재가 끝나지 않은 불출 신청입니다.";
  if (status === "EXECUTED") return "이미 실행된 불출 신청입니다. 되돌리려면 반품으로 처리해 주세요.";
  if (status === "REJECTED") return "반려된 불출 신청은 실행할 수 없습니다.";
  return "취소된 불출 신청은 실행할 수 없습니다.";
}
