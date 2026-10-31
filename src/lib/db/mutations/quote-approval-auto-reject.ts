import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { quoteApprovals } from "../schema";
import {
  QUOTE_APPROVAL_AUTO_REJECT_REASON,
  isQuoteApprovalAutoRejectedOnEdit,
} from "@/lib/domain/quote-approval-rules";

/**
 * ============================================================================
 * 견적서가 바뀌면 결재를 **자동으로 반려**한다 (2026-10-31 사용자 요구)
 * ============================================================================
 * 사용자 요구 그대로: 「견적서 결재를 올린 이후에 견적서를 수정하고 저장을 누르면
 * … 결재건이 자동으로 반려되도록 해줘.」 **이미 승인된 건도 반려한다**(같은 날
 * 사용자 결정).
 *
 * ── 🔴 사람이 반려하는 길과 **다른 길**이다 ─────────────────────────────
 * `mutations/quote-approvals.ts` 의 `decideQuoteApproval` 은 한 글자도 바뀌지
 * 않았다. 그쪽은 **사람이 단추를 눌러** 자기 차례의 결재를 처리하는 길이고,
 * 지정 관문 · 계정 자격 · 위임까지 본다. 이쪽은 **아무도 누르지 않았고** 결재할
 * 자격도 묻지 않는다 — 묻는 것은 하나뿐이다: 「그 결재가 가리키던 내용이 방금
 * 사라졌는가」. 자격을 묻는 순간 **견적서를 고칠 수 있는 사람이 자기 결재를
 * 못 무르는** 상태가 생긴다(결재자가 남이기 때문이다).
 *
 * 그래서 두 길을 한 함수로 합치지 않는다. 합치면 어느 한쪽의 관문을 고치는 일이
 * 다른 쪽의 뜻까지 조용히 바꾼다.
 *
 * ── 🔴 2026-09-18 결정과 어긋나지 않는다 ────────────────────────────────
 * 「이 표를 보고 **발행을 막는** 코드를 쓰지 말 것」이 그날의 금지였다. 여기서
 * 막는 것은 **없다** — 저장도 발행도 그대로 된다. 이 파일이 하는 일은 저장이
 * 끝난 뒤 이 표에 **기록을 한 줄 적는 것**뿐이다. 까닭은
 * domain/quote-approval-rules.ts 머리말의 「2026-10-31 에 더해진 것」에 있다.
 *
 * ── 🔴 **안 바뀐 저장은 여기까지 오지 않는다** ──────────────────────────
 * 부르는 쪽(mutations/quotes.ts)이 먼저 내용을 견주고, 같으면 UPDATE 도 이 함수도
 * 건너뛴다(사용자 결정 — 안 바뀐 저장은 반려하지 않는다).
 *
 * ── 🔴 줄을 **고쳐 쓰는 경우와 이어 쓰는 경우** ─────────────────────────
 * 표는 append 계열이고 「결정 칸을 **딱 한 번** 채우고, 그 뒤로는 역사적 사실이라
 * 고치지도 지우지도 않는다」가 그 규약이다(schema/quote-approvals.ts). 그래서
 * 두 갈래로 나뉜다:
 *
 *  · 마지막 줄이 `REQUESTED` → **그 줄을 반려로 닫는다.** 결정 칸이 아직 비어
 *    있으므로 「딱 한 번 채우는」 그 한 번이다. 사람이 반려했을 때와 같은 모양이다.
 *  · 마지막 줄이 `APPROVED`  → 🔴 **그 줄을 건드리지 않고 한 줄 더 잇는다.**
 *    덮어쓰면 **누가 그 승인을 눌렀는지가 영영 사라진다** — 마지막 단계의 승인자는
 *    그 줄에만 적혀 있다. 새 줄은 같은 요청(요청자 · 사유 · 판 · 단계 · 요청 시점의
 *    판 번호)을 그대로 물려받고 상태만 `REJECTED` 다. 「승인됐다가 자동으로
 *    물렸다」가 이력에 두 줄로 남는 것이 이 표가 바라는 모양이다.
 *
 * 🔴 **이어 쓰는 줄의 요청자는 「고친 사람」이 아니라 원래 요청자**다. 그래야 종의
 * 「내가 요청한 결재가 반려됐다」가 **올린 사람**에게 간다(queries/
 * approval-outcome-notifications.ts 는 요청자로 찾는다). 고친 사람을 적으면 그
 * 사람이 자기 행동을 자기 종으로 돌려받고, 정작 올린 사람은 아무 말도 못 듣는다.
 * 🔵 고친 사람이 곧 올린 사람이면 그 조회가 `decided_by ≠ 요청자` 로 걸러 낸다 —
 * 자기 저장이 자기 종에 뜨지 않는다.
 *
 * ── 🔴 마지막 줄을 잡는 동안 사슬이 움직일 수 있다 ──────────────────────
 * `decideQuoteApproval` 은 **견적서 행을 잠그지 않는다**(그 파일의 결정 — 결재가
 * 견적서 수정과 쓸데없이 줄 서지 않게). 그래서 이 저장이 견적서 행을 쥐고 있어도
 * 결재 쪽은 그 사이에 한 단계를 넘어갈 수 있다. 「잠근 줄」과 「지금 마지막 줄」이
 * 어긋난 채로 쓰면 **아직 살아 있는 요청 줄이 하나 남은 채** 상태만 반려로 보인다.
 * 아래 lockLatestApproval 이 **잠근 뒤 다시 한 번 확인**하는 까닭이다(새 문장은
 * 새 스냅숏을 쓰므로 방금 커밋된 줄이 보인다 — READ COMMITTED).
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type QuoteApprovalAutoRejectResult =
  /** 건드릴 결재가 없었다 — 올린 적이 없거나 이미 반려로 닫혀 있다. */
  | { rejected: false }
  | {
      rejected: true;
      /** 반려로 닫힌 줄(이어 쓴 경우에는 새로 생긴 줄). */
      approvalId: string;
      /** 반려 직전의 상태 — 「대기 중이던 것」과 「승인됐던 것」을 가른다. */
      previousStatus: "REQUESTED" | "APPROVED";
    };

/**
 * 🔴 **몇 번까지 다시 잡아 보는가.** 현실에서는 첫 번에 끝난다 — 저장과 결재가
 * 밀리초 단위로 겹쳐야 두 번째가 돈다. 그래도 끝없이 돌지 않게 상한을 둔다:
 * 결재가 계속 움직인다는 것은 사람이 쉼 없이 단추를 누르고 있다는 뜻이고, 그때는
 * 포기하는 편이 저장을 붙잡아 두는 것보다 낫다(저장 자체는 이미 끝나 있다).
 */
const LATEST_APPROVAL_LOCK_ATTEMPTS = 3;

const LATEST_APPROVAL_COLUMNS = {
  id: quoteApprovals.id,
  status: quoteApprovals.status,
  requestedByUserId: quoteApprovals.requestedByUserId,
  requestReason: quoteApprovals.requestReason,
  assignedApproverUserId: quoteApprovals.assignedApproverUserId,
  routeId: quoteApprovals.routeId,
  routeStepOrder: quoteApprovals.routeStepOrder,
  quoteVersionAtRequest: quoteApprovals.quoteVersionAtRequest,
};

/**
 * 그 견적서의 **가장 최근 결재 줄**을 잠그고 돌려준다. 없으면 null.
 *
 * 「가장 최근」의 정의는 `requested_at` 내림차순 첫 줄이다 — 조회
 * (queries/quote-approvals.ts 의 getQuoteApprovalProgress)와 **같은 정의**여야
 * 한다. 다르면 화면이 보는 줄과 여기서 닫는 줄이 달라진다.
 *
 * 🔴 잠근 뒤 **다시 한 번** 마지막 줄을 묻는다(머리말의 마지막 절). 같으면 그
 * 줄이 맞고, 다르면 그 사이에 사슬이 한 칸 나아간 것이라 새로 잡는다.
 */
async function lockLatestApproval(tx: Tx, quoteId: string) {
  for (let attempt = 0; attempt < LATEST_APPROVAL_LOCK_ATTEMPTS; attempt += 1) {
    const [locked] = await tx
      .select(LATEST_APPROVAL_COLUMNS)
      .from(quoteApprovals)
      .where(eq(quoteApprovals.quoteId, quoteId))
      .orderBy(desc(quoteApprovals.requestedAt))
      .limit(1)
      .for("update");
    if (!locked) return null;

    const [latest] = await tx
      .select({ id: quoteApprovals.id })
      .from(quoteApprovals)
      .where(eq(quoteApprovals.quoteId, quoteId))
      .orderBy(desc(quoteApprovals.requestedAt))
      .limit(1);
    if (latest && latest.id === locked.id) return locked;
  }
  // 🔴 포기한다 — 결재는 손대지 않는다. 저장은 그대로 끝난다(위 상한 주석).
  return null;
}

/**
 * 🔴 **견적서가 바뀐 뒤** 올라가 있던 결재를 자동으로 반려한다.
 *
 * ⚠️ **반드시 저장 트랜잭션 안에서** 부른다(`tx` 를 받는 이유). 저장이 되돌아가는
 * 길에서는 이 반려도 함께 없던 일이 되어야 한다 — 따로 돌면 「견적서는 그대로인데
 * 결재만 반려된」 장이 남고, 그 상태는 화면 어디에서도 설명되지 않는다.
 *
 * 🔴 상태 판정을 여기 글자로 적지 않는다 — 도메인 함수 하나를 부른다
 * (isQuoteApprovalAutoRejectedOnEdit). 사유 글자도 마찬가지다.
 */
export async function autoRejectQuoteApprovalAfterEdit(
  tx: Tx,
  input: { quoteId: string; actorUserId: string }
): Promise<QuoteApprovalAutoRejectResult> {
  const latest = await lockLatestApproval(tx, input.quoteId);
  if (!latest) return { rejected: false };
  if (!isQuoteApprovalAutoRejectedOnEdit(latest.status)) return { rejected: false };

  const now = new Date();
  /**
   * 반려 줄이 반드시 갖춰야 하는 셋(표의 quote_approvals_decision_metadata CHECK).
   *
   * 🔴 `decidedByUserId` 는 **견적서를 고친 사람**이다(2026-10-31 사용자 결정 —
   * 「(가)로 해」). 결재를 무르게 만든 행동을 한 사람이 그 사람이고, 비워 둘 수
   * 있는 칸도 아니다. 그래서 사유 글자가 **사람이 적은 사유와 달라야** 한다 —
   * 안 그러면 받는 쪽에 「그 사람이 직접 반려했다」로 보인다.
   */
  const decision = {
    decidedByUserId: input.actorUserId,
    decidedAt: now,
    decisionReason: QUOTE_APPROVAL_AUTO_REJECT_REASON,
  };

  if (latest.status === "REQUESTED") {
    // 🔴 아직 비어 있는 결정 칸을 **딱 한 번** 채운다 — 표의 규약 그대로다.
    //    `status = 'REQUESTED'` 를 조건에 다시 거는 것은, 잠금을 기다리는 사이
    //    남이 먼저 처리했다면 여기서 아무 줄도 고치지 않게 하기 위해서다.
    const updated = await tx
      .update(quoteApprovals)
      .set({ status: "REJECTED", ...decision, updatedAt: now })
      .where(and(eq(quoteApprovals.id, latest.id), eq(quoteApprovals.status, "REQUESTED")))
      .returning({ id: quoteApprovals.id });
    if (updated.length === 0) return { rejected: false };
    return { rejected: true, approvalId: updated[0].id, previousStatus: "REQUESTED" };
  }

  /**
   * 🔴 승인이 끝난 줄은 **고치지 않는다** — 머리말의 「줄을 고쳐 쓰는 경우와 이어
   * 쓰는 경우」. 같은 요청을 그대로 물려받은 줄을 하나 더 이어 반려로 닫는다.
   *
   * 🔴 `requested_at` 은 물려받지 않는다(표 기본값 now()). 앞 줄과 같은 시각이면
   * 「가장 최근 줄」을 고르는 조회가 어느 줄을 고를지 정해지지 않는다 —
   * decideQuoteApproval 이 사슬을 이을 때 지키는 그 규율과 같다.
   *
   * 🔵 `assigned_approver_user_id` 도 물려받는다 — 「누구 자리의 승인이 물렸는가」가
   * 남는다. 대기 목록은 `status = 'REQUESTED'` 만 보므로(queries/
   * quote-approvals-pending.ts) 이 줄이 누구의 할 일로 되살아나지는 않는다.
   *
   * 🔵 `delegated_from_user_id` 는 비운다 — 자동 반려는 위임이 아니다. NULL 이
   * 「직접 눌렀다」라는 정상값이고, 여기서는 「사람이 누른 것이 아니다」를 사유
   * 글자가 말한다(표의 그 칸 주석).
   */
  const [appended] = await tx
    .insert(quoteApprovals)
    .values({
      quoteId: input.quoteId,
      status: "REJECTED",
      requestedByUserId: latest.requestedByUserId,
      requestReason: latest.requestReason,
      assignedApproverUserId: latest.assignedApproverUserId,
      routeId: latest.routeId,
      routeStepOrder: latest.routeStepOrder,
      // 🔴 **요청 시점의 판 번호 그대로** — 이 줄이 가리키는 것은 방금 저장된
      //    새 판이 아니라 「그때 승인됐던 그 판」이다.
      quoteVersionAtRequest: latest.quoteVersionAtRequest,
      ...decision,
    })
    .returning({ id: quoteApprovals.id });
  return { rejected: true, approvalId: appended.id, previousStatus: "APPROVED" };
}
