import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  inventoryPartIssueApprovals,
  inventoryPartIssueRequestItems,
  inventoryPartIssueRequests,
  inventoryPartRequests,
  partStockBalances,
  parts,
  repairCases,
  users,
} from "../schema";
import { mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";
import {
  INVENTORY_PART_ISSUE_REQUEST_STATUSES,
  isPartIssueRequestAwaitingApproval,
  isPartIssueRequestExecutable,
  type InventoryPartIssueRequestStatus,
} from "@/lib/domain/inventory-part-issue-rules";
import type { StockOwner } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 부품 불출 승인 — 읽기만 하는 조회
 * ============================================================================
 * 표의 뜻과 「승인이 끝나도 재고는 자동으로 빠지지 않는다」는 설계의 이유는
 * db/schema/inventory-part-issue-requests.ts 머리말에 있다.
 *
 * 🔴 **이 파일은 아무것도 쓰지 않는다.** 판정도 최종 판정이 아니다 — 실제 승인·
 * 반려·실행은 다음 조각들의 mutation 이 자기 트랜잭션 안에서 전부 다시 확인한다.
 *
 * 이 함수들을 부르는 화면은 재고 관리 > [승인 요청건] 탭
 * (app/(app)/inventory/approvals/page.tsx)이다. 🔴 **누가 어느 묶음을 보는지는
 * 그 페이지가 정한다** — 여기 조회들은 사람으로 거르지 않는다. 예외는 하나,
 * 「내가 결재할 건」(listPartIssueRequestsPendingMyApproval)이 아래 지정 관문으로
 * 좁히는 것뿐이다. 부품 요청 관리 화면(app/(app)/inventory/requests/page.tsx)도
 * [불출] 단추를 잠글지 정하려고 listInProgressPartIssueStatusesByPartRequest 를 부른다.
 * 종 알림의 「불출 승인 대기」(db/queries/notifications.ts)도 「내가 결재할 건」과
 * **같은 조회**를 그대로 부른다 — 알림과 목록이 서로 다른 말을 할 수 없게.
 *
 * ── 판정을 새로 만들지 않는다 ───────────────────────────────────────────
 * 「이 결재를 내가 처리할 수 있는가」는 출하 승인과 **같은 함수 하나**를 본다 —
 * auth/approval-assignment.ts 의 `mayDecideAssignedApproval`(지정된 사람, 또는
 * 최고관리자). 여기서 한 벌 더 적으면 목록에는 뜨는데 눌러도 거절되는(또는 그
 * 반대의) 어긋남이 생기고, 후자는 화면에 아무 표시도 남기지 않아 더 나쁘다.
 * ============================================================================
 */

/** 헤더가 가리키는 접수 건과, 부품 요청이 가리키는 접수 건을 따로 읽는다. */
const directCase = alias(repairCases, "direct_repair_case");
const requestCase = alias(repairCases, "part_request_repair_case");
const requester = alias(users, "issue_requester");
const executor = alias(users, "issue_executor");
const approvalRequester = alias(users, "approval_requester");
const approvalDecider = alias(users, "approval_decider");
const assignedApprover = alias(users, "assigned_approver");

/** 신청 한 줄이 무엇을 얼마나 빼겠다는 것인가. */
export type PartIssueRequestItemView = {
  id: string;
  /** 요청 기반 불출이면 그 요청 줄. 직접 사용이면 `null` 이고 정상값이다. */
  requestItemId: string | null;
  partStockBalanceId: string;
  partId: string;
  partName: string;
  partSpec: string | null;
  owner: StockOwner;
  location: string;
  /** **승인받은 수량.** 실행은 이 수량으로만 해야 한다. */
  quantity: number;
  /**
   * 🔴 그 잔량 행에 **지금** 남아 있는 수량 — 승인 시점의 값이 아니라 이 조회를
   * 부른 순간의 값이다. 승인과 실행 사이에 재고는 얼마든지 달라질 수 있으므로
   * (그것이 승인과 실행을 나눈 이유다) 실행 화면이 「지금도 뺄 수 있는가」를
   * 사람에게 보여 주려면 이 값이 필요하다. 판정 자체는 실행 mutation 이 자기
   * 트랜잭션 안에서 잠그고 다시 한다 — 이 값으로 문을 열지 말 것.
   */
  currentQuantity: number;
};

/** 단계별 승인 한 줄. */
export type PartIssueApprovalView = {
  id: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  /**
   * 요청 시점에 붙잡아 둔 판과 단계 번호. 🔴 **「현재 판」이 아니다** — 관리자가
   * 절차를 바꿔도 이미 요청된 신청은 이 판을 끝까지 따라간다.
   */
  routeId: string | null;
  routeStepOrder: number | null;
  assignedApproverUserId: string | null;
  assignedApproverName: string | null;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  requestReason: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
};

export type PartIssueRequestDetail = {
  id: string;
  /** 요청 기반 불출이면 그 부품 요청. 직접 사용이면 `null`. */
  partRequestId: string | null;
  /**
   * 이 불출이 향하는 접수 건. 직접 사용이면 헤더가 직접 가리키고, 요청 기반이면
   * **부품 요청이 가리키는 것**을 그대로 읽어 온다 — 헤더에 같은 사실을 두 번
   * 적지 않기 때문이다(표 CHECK 참조).
   */
  repairCaseId: string | null;
  /** 그 접수 건의 인수번호. 접수 건이 없으면(사용처만 있는 불출) `null`. */
  intakeNumber: string | null;
  status: InventoryPartIssueRequestStatus;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  requestReason: string | null;
  /** 직접 사용의 사용처. 요청 기반이면 언제나 `null`(표 CHECK). */
  destinationNote: string | null;
  procedureExecutionNodeId: string | null;
  executedByUserId: string | null;
  executedByName: string | null;
  executedAt: string | null;
  /** 승인받은 항목들. 신청에 항목이 없는 일은 없어야 하지만 빈 배열도 돌려준다. */
  items: PartIssueRequestItemView[];
  /** 오래된 것부터 — 결재가 지나온 순서 그대로 읽힌다. */
  approvals: PartIssueApprovalView[];
};

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * 신청 한 건 — 헤더 + 항목 + 승인 이력.
 *
 * 없으면 `null`. 조회를 셋으로 나눈 것은 의도다: 한 번에 조인하면 항목 수 ×
 * 승인 수만큼 행이 부풀고, 부풀린 행을 다시 접는 코드가 조인보다 틀리기 쉽다.
 * 셋 다 신청 하나에 매인 작은 조회다.
 */
export async function getPartIssueRequestDetail(
  issueRequestId: string
): Promise<PartIssueRequestDetail | null> {
  const [header] = await db
    .select({
      id: inventoryPartIssueRequests.id,
      partRequestId: inventoryPartIssueRequests.partRequestId,
      directRepairCaseId: inventoryPartIssueRequests.repairCaseId,
      directIntakeNumber: directCase.intakeNumber,
      partRequestRepairCaseId: inventoryPartRequests.repairCaseId,
      partRequestIntakeNumber: requestCase.intakeNumber,
      status: inventoryPartIssueRequests.status,
      requestedByUserId: inventoryPartIssueRequests.requestedByUserId,
      requestedByName: requester.name,
      requestedAt: inventoryPartIssueRequests.requestedAt,
      requestReason: inventoryPartIssueRequests.requestReason,
      destinationNote: inventoryPartIssueRequests.destinationNote,
      procedureExecutionNodeId: inventoryPartIssueRequests.procedureExecutionNodeId,
      executedByUserId: inventoryPartIssueRequests.executedByUserId,
      executedByName: executor.name,
      executedAt: inventoryPartIssueRequests.executedAt,
    })
    .from(inventoryPartIssueRequests)
    // 요청자는 NOT NULL + RESTRICT 라 언제나 실재한다 — 그래도 innerJoin 을 쓰지
    // 않는 이유는, 조인 하나가 잘못돼 헤더가 통째로 사라지는 실패 방식이 이
    // 화면에서 가장 알아채기 어렵기 때문이다(「신청이 없습니다」로만 보인다).
    .leftJoin(requester, eq(requester.id, inventoryPartIssueRequests.requestedByUserId))
    .leftJoin(executor, eq(executor.id, inventoryPartIssueRequests.executedByUserId))
    .leftJoin(directCase, eq(directCase.id, inventoryPartIssueRequests.repairCaseId))
    .leftJoin(
      inventoryPartRequests,
      eq(inventoryPartRequests.id, inventoryPartIssueRequests.partRequestId)
    )
    .leftJoin(requestCase, eq(requestCase.id, inventoryPartRequests.repairCaseId))
    .where(eq(inventoryPartIssueRequests.id, issueRequestId));

  if (!header) return null;

  const items = await db
    .select({
      id: inventoryPartIssueRequestItems.id,
      requestItemId: inventoryPartIssueRequestItems.requestItemId,
      partStockBalanceId: inventoryPartIssueRequestItems.partStockBalanceId,
      partId: partStockBalances.partId,
      partName: parts.partName,
      partSpec: parts.partSpec,
      owner: partStockBalances.owner,
      location: partStockBalances.location,
      quantity: inventoryPartIssueRequestItems.quantity,
      currentQuantity: partStockBalances.currentQuantity,
    })
    .from(inventoryPartIssueRequestItems)
    // 잔량 행·부품은 RESTRICT 로 매여 있어 사라지지 않는다 — innerJoin 이어도
    // 행을 잃지 않는다.
    .innerJoin(
      partStockBalances,
      eq(partStockBalances.id, inventoryPartIssueRequestItems.partStockBalanceId)
    )
    .innerJoin(parts, eq(parts.id, partStockBalances.partId))
    .where(eq(inventoryPartIssueRequestItems.issueRequestId, issueRequestId))
    // 사람이 읽는 순서가 실행마다 흔들리지 않도록 이름으로 세우고 id 로 동점을
    // 깬다(ORDER BY 가 완전하지 않은 조회는 순서를 보장하지 않는다).
    .orderBy(asc(parts.partName), asc(inventoryPartIssueRequestItems.id));

  const approvals = await db
    .select({
      id: inventoryPartIssueApprovals.id,
      status: inventoryPartIssueApprovals.status,
      routeId: inventoryPartIssueApprovals.routeId,
      routeStepOrder: inventoryPartIssueApprovals.routeStepOrder,
      assignedApproverUserId: inventoryPartIssueApprovals.assignedApproverUserId,
      assignedApproverName: assignedApprover.name,
      requestedByUserId: inventoryPartIssueApprovals.requestedByUserId,
      requestedByName: approvalRequester.name,
      requestedAt: inventoryPartIssueApprovals.requestedAt,
      requestReason: inventoryPartIssueApprovals.requestReason,
      decidedByUserId: inventoryPartIssueApprovals.decidedByUserId,
      decidedByName: approvalDecider.name,
      decidedAt: inventoryPartIssueApprovals.decidedAt,
      decisionReason: inventoryPartIssueApprovals.decisionReason,
    })
    .from(inventoryPartIssueApprovals)
    .leftJoin(
      approvalRequester,
      eq(approvalRequester.id, inventoryPartIssueApprovals.requestedByUserId)
    )
    // LEFT JOIN — 아직 결정되지 않은 행(지금 대기 중인 단계)이 여기서 떨어지면
    // 안 된다. 지정 승인자도 같은 이유다.
    .leftJoin(approvalDecider, eq(approvalDecider.id, inventoryPartIssueApprovals.decidedByUserId))
    .leftJoin(
      assignedApprover,
      eq(assignedApprover.id, inventoryPartIssueApprovals.assignedApproverUserId)
    )
    .where(eq(inventoryPartIssueApprovals.issueRequestId, issueRequestId))
    // 결재가 지나온 순서 그대로. 같은 시각이 겹칠 때를 위해 단계 번호로 동점을
    // 깬다.
    .orderBy(
      asc(inventoryPartIssueApprovals.requestedAt),
      asc(inventoryPartIssueApprovals.routeStepOrder)
    );

  return {
    id: header.id,
    partRequestId: header.partRequestId,
    repairCaseId: header.directRepairCaseId ?? header.partRequestRepairCaseId,
    intakeNumber: header.directIntakeNumber ?? header.partRequestIntakeNumber,
    status: header.status,
    requestedByUserId: header.requestedByUserId,
    requestedByName: header.requestedByName ?? "",
    requestedAt: header.requestedAt.toISOString(),
    requestReason: header.requestReason,
    destinationNote: header.destinationNote,
    procedureExecutionNodeId: header.procedureExecutionNodeId,
    executedByUserId: header.executedByUserId,
    executedByName: header.executedByName,
    executedAt: toIsoOrNull(header.executedAt),
    items,
    approvals: approvals.map((row) => ({
      ...row,
      requestedByName: row.requestedByName ?? "",
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: toIsoOrNull(row.decidedAt),
    })),
  };
}

/** 「내가 지금 결재해야 할 불출 신청」 한 줄. */
export type PendingPartIssueApprovalItem = {
  issueRequestId: string;
  /** 지금 열려 있는 승인 행. 결재 mutation 이 이 행을 닫는다. */
  approvalId: string;
  /** 몇 번째 단계인가(1부터). 결재선을 타지 않는 행이면 `null`. */
  routeStepOrder: number | null;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  requestReason: string | null;
  /** 요청 기반 불출이면 그 부품 요청. 직접 사용이면 `null`. */
  partRequestId: string | null;
  /**
   * 이 신청이 향하는 접수 건의 인수번호 — getPartIssueRequestDetail 의
   * `intakeNumber` 와 같은 규칙이다(직접 사용이면 헤더가 가리키는 접수 건, 요청
   * 기반이면 부품 요청이 가리키는 접수 건). 접수 건이 없으면 `null`.
   * 종 알림이 「무엇에 대한 신청인가」를 굵게 적을 때 쓴다.
   */
  intakeNumber: string | null;
  /** 직접 사용의 사용처. 요청 기반이면 언제나 `null`(표 CHECK). */
  destinationNote: string | null;
};

/** 지정 관문(mayDecideAssignedApproval)에 그대로 넘기는 최소 모양. */
type AssignmentActor = { id: string; role: string; isDeveloper: boolean };

/**
 * 결재선 단계를 맡을 수 있는 계정인가 — 조건은 「결재선에 올릴 수 있는 사람」
 * (queries/shipment-approval-routes.ts 의 listSelectableApproverCandidates)과
 * **글자 그대로 같다**: 승인됨 · 활성 · 잠기지 않음 · 삭제 안 됨. 역할 제한은
 * 없다(결재선 지정에도 없다).
 *
 * 🔴 여기서 사람을 더 좁히지 않는 것이 의도다. 넓게 물어도 아래에서 지정 관문이
 * 그 단계의 승인자(와 최고관리자)로 좁힌다. 반대로 여기서 좁히면 **최고관리자
 * 비상구가 함께 닫힌다** — 자기 단계가 아니면 물어보지도 않게 되므로.
 */
async function resolvePartIssueApprovalActor(actorUserId: string): Promise<AssignmentActor | null> {
  const [actor] = await db
    .select({
      id: users.id,
      role: users.role,
      isDeveloper: users.isDeveloper,
    })
    .from(users)
    .where(
      and(
        eq(users.id, actorUserId),
        eq(users.isDeleted, false),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        isNull(users.lockedAt)
      )
    );

  return actor ?? null;
}

/**
 * 내가 지금 결재해야 할 불출 신청들 — 오래 기다린 것부터.
 *
 * 후보는 **아직 결정되지 않은 승인 행**이다. 그리고 그 신청이 여전히 결재를
 * 기다리는 중(PENDING_APPROVAL)이어야 한다 — 신청이 취소·반려된 뒤에 열린 행이
 * 남아 있더라도 결재자가 지금 할 일은 없다. 목록은 「눌러서 처리할 수 있는 건」
 * 이어야 하고, 잡히는데 눌러도 막히면 사람은 곧 이 목록을 믿지 않게 된다.
 *
 * ⚠️ **실패하는 방향이 조용하다.** 잘못 좁히면 처리해야 할 사람이 목록을 못 받는데,
 * 그 실패는 화면에 아무 표시도 남기지 않는다(그냥 안 뜬다). 그래서 좁히는 자리를
 * 하나로 모아 두고(`mayDecideAssignedApproval`) 통합 시험이 그 경로를 못 박는다.
 */
export async function listPartIssueRequestsPendingMyApproval(
  actorUserId: string
): Promise<PendingPartIssueApprovalItem[]> {
  const actor = await resolvePartIssueApprovalActor(actorUserId);
  if (!actor) return [];

  const rows = await db
    .select({
      issueRequestId: inventoryPartIssueRequests.id,
      approvalId: inventoryPartIssueApprovals.id,
      routeStepOrder: inventoryPartIssueApprovals.routeStepOrder,
      assignedApproverUserId: inventoryPartIssueApprovals.assignedApproverUserId,
      requestedByUserId: inventoryPartIssueApprovals.requestedByUserId,
      requestedByName: approvalRequester.name,
      requestedAt: inventoryPartIssueApprovals.requestedAt,
      requestReason: inventoryPartIssueApprovals.requestReason,
      partRequestId: inventoryPartIssueRequests.partRequestId,
      directIntakeNumber: directCase.intakeNumber,
      partRequestIntakeNumber: requestCase.intakeNumber,
      destinationNote: inventoryPartIssueRequests.destinationNote,
    })
    .from(inventoryPartIssueApprovals)
    .innerJoin(
      inventoryPartIssueRequests,
      eq(inventoryPartIssueRequests.id, inventoryPartIssueApprovals.issueRequestId)
    )
    .leftJoin(
      approvalRequester,
      eq(approvalRequester.id, inventoryPartIssueApprovals.requestedByUserId)
    )
    // 무엇에 대한 신청인가 — getPartIssueRequestDetail 과 같은 두 갈래 조인이다.
    // 🔴 셋 다 상대의 기본키(id)에 붙는 LEFT JOIN 이라 행이 늘지도 줄지도 않는다 —
    // 아래 WHERE·지정 관문이 걸러내는 결과는 이 조인이 없을 때와 같다. 신청마다
    // 상세를 따로 읽지 않으려고(N+1) 여기서 한 번에 붙인다 — 종 알림이 이 조회를
    // 모든 페이지 로드마다 부른다.
    .leftJoin(directCase, eq(directCase.id, inventoryPartIssueRequests.repairCaseId))
    .leftJoin(
      inventoryPartRequests,
      eq(inventoryPartRequests.id, inventoryPartIssueRequests.partRequestId)
    )
    .leftJoin(requestCase, eq(requestCase.id, inventoryPartRequests.repairCaseId))
    .where(
      and(
        eq(inventoryPartIssueApprovals.status, "REQUESTED"),
        eq(inventoryPartIssueRequests.status, "PENDING_APPROVAL")
      )
    )
    .orderBy(asc(inventoryPartIssueApprovals.requestedAt), asc(inventoryPartIssueApprovals.id));

  return rows
    // 🔴 지정이 걸린 건은 **그 사람과 최고관리자에게만** 보인다. 판정은 여기서
    // 새로 적지 않고 출하 승인과 같은 함수 하나를 부른다.
    .filter((row) => mayDecideAssignedApproval(row.assignedApproverUserId, actor))
    .map((row) => ({
      issueRequestId: row.issueRequestId,
      approvalId: row.approvalId,
      routeStepOrder: row.routeStepOrder,
      requestedByUserId: row.requestedByUserId,
      requestedByName: row.requestedByName ?? "",
      requestedAt: row.requestedAt.toISOString(),
      requestReason: row.requestReason,
      partRequestId: row.partRequestId,
      intakeNumber: row.directIntakeNumber ?? row.partRequestIntakeNumber,
      destinationNote: row.destinationNote,
    }));
}

/**
 * 「승인은 났는데 아직 안 나간」 신청들 — 재고 담당자가 실행할 차례인 것들.
 * 오래 기다린 것부터.
 *
 * 🔴 상태 하나로 정해진다(`APPROVED`). 판정을 SQL 에 적지 않고 순수 규칙
 * (domain/inventory-part-issue-rules.ts 의 isPartIssueRequestExecutable)이 쥐게
 * 하고 싶지만, 그러려면 전량을 읽어 걸러야 한다 — 그래서 여기서는 같은 뜻의
 * WHERE 를 쓰고, **그 두 벌이 같은 말인지는 시험이 맞춰 본다.**
 */
export async function listExecutablePartIssueRequests(): Promise<
  { issueRequestId: string; requestedAt: string; partRequestId: string | null }[]
> {
  const rows = await db
    .select({
      issueRequestId: inventoryPartIssueRequests.id,
      requestedAt: inventoryPartIssueRequests.requestedAt,
      partRequestId: inventoryPartIssueRequests.partRequestId,
    })
    .from(inventoryPartIssueRequests)
    .where(eq(inventoryPartIssueRequests.status, "APPROVED"))
    .orderBy(asc(inventoryPartIssueRequests.requestedAt), asc(inventoryPartIssueRequests.id));

  return rows.map((row) => ({
    issueRequestId: row.issueRequestId,
    requestedAt: row.requestedAt.toISOString(),
    partRequestId: row.partRequestId,
  }));
}

/**
 * 「진행 중」인 신청의 상태들 — 결재 중이거나, 승인이 끝나 실행을 기다린다.
 *
 * 🔴 글자로 다시 적지 않고 **순수 규칙 두 개에서 뽑는다**(결재를 기다리는가 ·
 * 지금 실행할 수 있는가). 그 둘이 화면의 두 이름(「결재 중」·「승인 완료 · 실행
 * 대기」)과 짝이므로, 여기 목록과 화면의 이름표가 서로 다른 말을 할 수 없다.
 * 그래도 뽑힌 결과가 PENDING_APPROVAL·APPROVED 둘뿐인지는 통합 시험이 못 박는다.
 */
const PART_ISSUE_IN_PROGRESS_STATUSES = INVENTORY_PART_ISSUE_REQUEST_STATUSES.filter(
  (status) => isPartIssueRequestAwaitingApproval(status) || isPartIssueRequestExecutable(status)
);

/**
 * 아직 끝나지 않은 불출 신청 전부 — 결재 중(PENDING_APPROVAL)이거나 승인이 끝나
 * 실행을 기다리는(APPROVED) 것. 오래된 것부터.
 *
 * [승인 요청건] 탭의 「진행 중인 신청」 묶음이 쓴다. 신청을 올린 사람이 자기
 * 신청이 어디까지 왔는지 볼 곳이 이것이다 — 「내가 결재할 건」과 「실행할 건」은
 * 올린 사람에게는 비어 보이는 것이 정상이라, 이 묶음이 없으면 올린 신청이
 * 사라진 것처럼 보인다.
 *
 * 🔴 **요청자·결재자로 거르지 않는다.** 누가 이 목록을 보는지는 부르는 페이지가
 * 정한다(재고 메뉴를 볼 수 있는 사람 전원). 여기서 사람을 좁히면 그 기준이 두
 * 곳에 적힌다.
 *
 * 동점 처리는 listExecutablePartIssueRequests 와 같다(요청 시각 → id).
 */
export async function listPartIssueRequestsInProgress(): Promise<
  { issueRequestId: string; requestedAt: string; partRequestId: string | null }[]
> {
  const rows = await db
    .select({
      issueRequestId: inventoryPartIssueRequests.id,
      requestedAt: inventoryPartIssueRequests.requestedAt,
      partRequestId: inventoryPartIssueRequests.partRequestId,
    })
    .from(inventoryPartIssueRequests)
    .where(inArray(inventoryPartIssueRequests.status, PART_ISSUE_IN_PROGRESS_STATUSES))
    .orderBy(asc(inventoryPartIssueRequests.requestedAt), asc(inventoryPartIssueRequests.id));

  return rows.map((row) => ({
    issueRequestId: row.issueRequestId,
    requestedAt: row.requestedAt.toISOString(),
    partRequestId: row.partRequestId,
  }));
}

/**
 * 한 부품 요청에 딸린 불출 신청들 — 새것부터. 부품 요청 상세 화면이 「이 요청에
 * 대해 어떤 불출이 결재 중인가」를 보여 줄 때 쓴다.
 */
export async function listPartIssueRequestsForPartRequest(
  partRequestId: string
): Promise<{ issueRequestId: string; status: InventoryPartIssueRequestStatus; requestedAt: string }[]> {
  const rows = await db
    .select({
      issueRequestId: inventoryPartIssueRequests.id,
      status: inventoryPartIssueRequests.status,
      requestedAt: inventoryPartIssueRequests.requestedAt,
    })
    .from(inventoryPartIssueRequests)
    .where(eq(inventoryPartIssueRequests.partRequestId, partRequestId))
    .orderBy(desc(inventoryPartIssueRequests.requestedAt), desc(inventoryPartIssueRequests.id));

  return rows.map((row) => ({
    issueRequestId: row.issueRequestId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
  }));
}

/**
 * 부품 요청 여러 개에 대해, 각 요청에 달린 **살아 있는** 불출 신청들의 상태 —
 * 조회 한 번으로 읽는다. 부품 요청 관리 화면(app/(app)/inventory/requests/page.tsx)이
 * 「이 요청의 [불출]을 잠가야 하는가」를 정할 때 쓴다.
 *
 * 「살아 있다」는 「진행 중인 신청」 묶음과 **같은 목록**(PART_ISSUE_IN_PROGRESS_STATUSES)
 * 이다 — 글자로 다시 적지 않는다. 끝난 신청(실행됨·반려·취소)은 잡히지 않는다.
 *
 * 돌려주는 모양: 부품 요청 id → 그 요청에 달린 살아 있는 신청의 상태들(오래된
 * 것부터). 살아 있는 신청이 없는 요청은 **아예 들어 있지 않다.** 직접 사용 신청
 * (부품 요청이 없는 것)은 입력 id 와 짝이 될 수 없으므로 잡히지 않는다.
 *
 * 🔴 요청마다 한 번씩 부르지 않는다(N+1). 빈 입력이면 DB 를 부르지 않는다.
 */
export async function listInProgressPartIssueStatusesByPartRequest(
  partRequestIds: readonly string[]
): Promise<Map<string, InventoryPartIssueRequestStatus[]>> {
  const statusesByPartRequest = new Map<string, InventoryPartIssueRequestStatus[]>();
  if (partRequestIds.length === 0) return statusesByPartRequest;

  const rows = await db
    .select({
      partRequestId: inventoryPartIssueRequests.partRequestId,
      status: inventoryPartIssueRequests.status,
    })
    .from(inventoryPartIssueRequests)
    .where(
      and(
        inArray(inventoryPartIssueRequests.partRequestId, [...new Set(partRequestIds)]),
        inArray(inventoryPartIssueRequests.status, PART_ISSUE_IN_PROGRESS_STATUSES)
      )
    )
    .orderBy(asc(inventoryPartIssueRequests.requestedAt), asc(inventoryPartIssueRequests.id));

  for (const row of rows) {
    // IN 조건 때문에 null 일 수는 없다 — 타입을 좁히려는 것뿐이다.
    if (row.partRequestId === null) continue;
    const statuses = statusesByPartRequest.get(row.partRequestId);
    if (statuses) statuses.push(row.status);
    else statusesByPartRequest.set(row.partRequestId, [row.status]);
  }
  return statusesByPartRequest;
}

/**
 * 부품 요청의 [불출]이 잠긴 까닭. 잠기지 않았으면 `null` 을 쓴다(아래 함수).
 *  · AWAITING_APPROVAL  — 결재 중인 불출 신청이 있다.
 *  · AWAITING_EXECUTION — 결재 중인 것은 없고, 승인이 끝나 실행을 기다리는 신청이 있다.
 */
export type PartRequestIssueLock = "AWAITING_APPROVAL" | "AWAITING_EXECUTION";

/**
 * 한 부품 요청에 달린 신청 상태들 → 그 요청의 [불출] 잠금. **순수 함수**다.
 *
 * 🔴 결재 중이 하나라도 있으면 「승인 대기」가 이긴다 — 실행 대기 건을 실행해도
 * 결재 중인 건이 남아 있으면 여전히 다시 올릴 수 없기 때문이다. 판정은 이 한
 * 곳에서만 하고, 상태는 순수 규칙 두 개(결재를 기다리는가 · 지금 실행할 수
 * 있는가)로 가른다 — 「진행 중인 신청」 묶음의 두 이름표와 같은 갈림이다.
 *
 * 🔴 절차(판)가 켜져 있는지는 **보지 않는다.** 관리자가 절차를 꺼도 이미 올라간
 * 신청은 살아 있어 결재·실행될 수 있으므로, 그 사이 [불출]로 한 번 더 내보내면
 * 같은 부품이 두 번 나간다.
 *
 * 이 잠금은 화면 힌트다. 서버의 불출·신청 mutation 은 이것을 보지 않는다.
 */
export function partRequestIssueLockFor(
  statuses: readonly InventoryPartIssueRequestStatus[]
): PartRequestIssueLock | null {
  if (statuses.some((status) => isPartIssueRequestAwaitingApproval(status))) return "AWAITING_APPROVAL";
  if (statuses.some((status) => isPartIssueRequestExecutable(status))) return "AWAITING_EXECUTION";
  return null;
}
