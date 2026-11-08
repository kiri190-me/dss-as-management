"use server";

import { revalidatePath } from "next/cache";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  decideDomesticOrderApproval,
  requestDomesticOrderApproval,
  type DomesticOrderApprovalFailureCode,
} from "@/lib/db/mutations/domestic-order-approvals";
import { resolveActingDelegateUserIds } from "@/lib/db/queries/approval-route-delegations";
import { getDomesticOrderApprovalProgress } from "@/lib/db/queries/domestic-order-approvals";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
import { notifyDomesticOrderApprovalCreated } from "@/lib/server/integration/approval-created-notice";
import { notifyPortalApprovalCreated } from "@/lib/server/integration/portal-inbox";
import { isValidDomesticOrderId } from "@/lib/validation/domestic-order-input";
import {
  isValidApprovalDecision,
  validateReasonFormat,
  type ApprovalDecisionCode,
} from "@/lib/validation/repair-case-approval-input";

/**
 * ============================================================================
 * 기타건 최종 출하 승인 — 서버 액션 (정책 계층)
 * ============================================================================
 * server/actions/quote-approvals.ts 와 같은 형식이다: 세션 확인 → 인가 확인 → 입력
 * 형식 검증 → mutation 호출. **순서가 곧 규칙이다** — 검증을 먼저 하면 로그인하지
 * 않은 요청이 어떤 값이 유효한지를 알아낼 수 있게 된다.
 *
 * 🔴 **화면이 무엇을 보여 줬든 매번 처음부터 다시 검사한다.** 탭이 단추를 감추는
 * 것은 편의일 뿐이고, 여기서도 mutation 안에서도 판정을 다시 한다. 클라이언트가
 * 보낸 값은 형식 말고는 아무것도 믿지 않는다.
 *
 * ── 인가를 어디서 보는가 ────────────────────────────────────────────────
 *  · **요청**은 `domesticOrders` WRITE 다 — 내자 줄을 만들고 고치는 그 열쇠 그대로다
 *    (actions/domestic-orders.ts 와 같은 영역·같은 수준. 새 권한 영역을 만들지 않는다).
 *  · **승인·반려**는 권한 영역을 보지 않는다. 결재선에 올라간 사람이 곧 그 단계의
 *    결재자라는 것이 이 기능의 설계이고, 그 판정은 mutation 이 자기 트랜잭션 안에서
 *    한다(지정 관문 + 최고관리자 비상구). 여기서 `domesticOrders` 열쇠를 한 겹 더
 *    요구하면 **결재선에 올릴 수 있는 사람과 결재할 수 있는 사람이 갈라져**,
 *    관리자가 아무도 처리할 수 없는 절차를 만들 수 있게 된다.
 *
 * ── 🔴 포털을 찌르는 자리가 **둘**이다 (2026-11-06) ─────────────────────
 * 견적서·접수 건 결재와 같은 모양으로, 저장 **뒤에** 포털을 한 번 쿡 찔러 「지금
 * 차례」인 사람에게 결재 메일이 나가게 한다(notifyDomesticOrderApprovalCreated).
 * 요청 자리뿐 아니라 **결정 자리에도** 단다 — 한 단계를 승인하면 저장 경로가 다음
 * 단계 요청 행을 이어 만들어(mutations 의 「사슬을 잇는다」) 그 순간 **다른 사람에게
 * 새 차례**가 생기기 때문이다. 사슬이 끝났거나 반려면 가장 최근 행이 REQUESTED 가
 * 아니라서 아무것도 나가지 않는다 — 그 판단은 부르는 쪽이 아니라 그 함수 안에 있다.
 *
 * 🔴 **그 신호만으로는 알림이 가지 않는다.** 몸통에는 포털 번호 하나뿐이고, 포털은
 * A/S 에 되물어(`GET /api/integration/approvals`) 내용을 가져간다 — 그 통로가 기타건을
 * 내주는 자리는 app/api/integration/approvals/route.ts 의 세 번째 조회다. 미는 쪽만
 * 달면 포털이 202 를 주고 로그도 깨끗한데 알림은 영영 안 간다.
 *
 * 🔵 종과 통합 승인함은 이 호출과 **무관하다** — 둘 다 A/S 가 그때그때 파생시키는
 * 목록이라(queries/domestic-order-approvals-pending.ts) 포털을 찌르지 않아도 뜬다.
 * 여기서 찌르는 것이 바꾸는 것은 **결재 메일이 언제 나가는가** 하나다(2026-10-24 의
 * 그 조각 — 안 찌르면 밤의 주기 작업 때까지 밀린다).
 * ============================================================================
 */

export type DomesticOrderApprovalActionCode =
  | DomesticOrderApprovalFailureCode
  | "UNAUTHORIZED"
  | "DATABASE_UNAVAILABLE";

export type DomesticOrderApprovalActionResult =
  | { ok: true; id: string }
  | { ok: false; code: DomesticOrderApprovalActionCode; message: string };

export type RequestDomesticOrderApprovalActionInput = {
  domesticOrderId: string;
  /** 올리며 적는 말. 없어도 된다. */
  reason?: string | null;
  /**
   * 🔴 **어느 납기요청일 회차에 대한 승인인가**(1부터, 2026-11-08 사용자 결정 12).
   * 화면은 회차가 둘 이상일 때 드롭다운으로 고르게 하고, 하나뿐이면 묻지 않고 1을
   * 보낸다. 🔴 **「그 줄에 있는 회차인가」는 여기서 보지 않는다** — 그것은 줄을 읽어야
   * 아는 판단이라 mutation 의 몫이다(이 파일의 순서 규칙: 형식만 본다).
   */
  dueDateRowOrder: number;
};

export type DecideDomesticOrderApprovalActionInput = {
  domesticOrderId: string;
  decision: ApprovalDecisionCode;
  /** 🔴 반려에는 필수다 — 그 판정은 mutation 이 한다(상태를 봐야 알 수 있다). */
  reason?: string | null;
  /**
   * 🔴 **어느 회차의 결재를 처리하는가**(1부터). 한 기타건에 열린 요청이 회차마다
   * 하나씩 여럿일 수 있으므로, 이 값 없이는 저장 경로가 남의 회차를 집어 든다.
   */
  dueDateRowOrder: number;
};

/**
 * 🔴 **회차 번호의 형식만** 본다 — 1 이상의 정수인가. 「그 줄에 그 회차가 있는가」는
 * 줄을 읽어야 아는 판단이라 여기서 하지 않는다(mutation 이 잠근 줄에서 다시 센다).
 *
 * 그래도 여기서 한 겹 거르는 까닭: 소수·음수·`NaN` 이 그대로 내려가면 SQL 비교가
 * 조용히 아무 행도 못 찾아 「관련 결재 요청을 찾을 수 없습니다」가 되고, 사람은 그
 * 말에서 **자기가 보낸 값이 이상했다**는 사실을 읽어 낼 수 없다.
 */
function isValidDueDateRowOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";

type ResolvedActor =
  | { ok: true; userId: string }
  | { ok: false; code: DomesticOrderApprovalActionCode; message: string };

/**
 * 세션 → 살아 있는 계정 → (필요하면) 내자 열쇠.
 *
 * 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다** — 강등된 계정이
 * 토큰 만료 전까지 예전 권한으로 결재하는 구멍을 막는다.
 *
 * @param requireDomesticOrdersWrite 거짓이면 내자 권한 영역을 보지 않는다 —
 *   승인·반려가 그렇다(파일 머리말의 「인가를 어디서 보는가」).
 */
async function resolveActor(requireDomesticOrdersWrite: boolean): Promise<ResolvedActor> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (requireDomesticOrdersWrite && !(await hasPermission(actingUser, "domesticOrders", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }
  return { ok: true, userId: actingUser.id };
}

/**
 * 결재가 실제로 움직인 뒤 **그 행동을 한 사람의 다음 렌더**를 새로 계산하게 만든다.
 * 요청을 올려 놓고 새로 고쳐도 자기 화면이 그대로인 상태를 없앤다.
 *
 * 닿아야 할 곳이 둘이다 — 사이드바·헤더 계산이 있는 `(app)/layout.tsx`(라우트
 * 그룹이라 URL 에 나타나지 않으므로 경로는 `/` 다)와, 그 기타건의 상세 화면.
 * 앞의 호출에 이미 포함되지만 따로 적어 둔다: 나중에 `/` 호출을 더 좁은 것으로
 * 바꾸더라도 상세 화면 갱신이 조용히 사라지지 않게 하기 위해서다.
 */
function revalidateDomesticOrderApprovalSurfaces(domesticOrderId: string): void {
  revalidatePath("/", "layout");
  revalidatePath(`/domestic-orders/${domesticOrderId}`, "layout");
}

/**
 * 「이 줄의 결재가 지금 누구 차례인가」를 **다시 읽어** 포털에 한 번 알린다.
 *
 * 🔴 **방금 넣은 행을 넘기지 않는다.** 그래야 세 자리가 이 함수 하나로 끝난다 —
 * 처음 요청 · 반려 뒤 재요청 · 결재선이 다음 단계로 나아간 자리. 판단(가장 최근 행이
 * REQUESTED 인가, 누구에게 가는가)은 전부 notifyDomesticOrderApprovalCreated 안에 있고,
 * 여기서 하는 일은 **진짜 조회를 꽂는 것**뿐이다.
 *
 * 🔴 **어떤 일이 있어도 던지지 않는다** — 반환형이 `Promise<void>` 이고, 그 함수 안의
 * try 와 portal-inbox.ts 의 그물이 포털 쪽 실패까지 삼킨다. 부르는 자리는 결재가 이미
 * 저장된 뒤라, 여기서 던지면 저장된 결재가 사람에게 **실패로 보인다.**
 *
 * 🔵 `getDomesticOrderApprovalProgress` 는 `cache()` 로 감싸여 있지만 괜찮다 — 서버
 * 액션은 자기 요청에서 먼저 돌고, 이 호출은 **커밋 뒤**라 그때 담기는 값이 새 값이다.
 *
 * 위임 조회를 그대로 못 꽂고 감싸는 까닭은 접수 건·견적서 쪽 같은 도우미와 같다 —
 * 그 조회가 「지금」을 인자로 받는다(트랜잭션 안에서 읽는 자리와 같은 함수라서다).
 */
async function notifyPortalOfDomesticOrderApprovalTurn(domesticOrderId: string): Promise<void> {
  await notifyDomesticOrderApprovalCreated(domesticOrderId, {
    readDomesticOrderProgress: getDomesticOrderApprovalProgress,
    listRouteDelegatesFor: (approverUserId) =>
      resolveActingDelegateUserIds(approverUserId, new Date()),
    readPortalSubject: getSsoSubjectForUser,
    notifyPortal: notifyPortalApprovalCreated,
  });
}

export async function requestDomesticOrderApprovalAction(
  input: RequestDomesticOrderApprovalActionInput
): Promise<DomesticOrderApprovalActionResult> {
  const actor = await resolveActor(true);
  if (!actor.ok) return actor;

  if (!isValidDomesticOrderId(input.domesticOrderId)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 기타건을 찾을 수 없습니다." };
  }
  // 형식만 본다 — 「사유가 필수인가」는 상태를 봐야 아는 판단이라 mutation 의 몫이다
  // (validation/repair-case-approval-input.ts 의 같은 주석).
  const reason = validateReasonFormat(input.reason);
  if (!reason.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reason.error };
  }
  if (!isValidDueDateRowOrder(input.dueDateRowOrder)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "납기요청일 회차를 확인할 수 없습니다." };
  }

  // 갱신은 try 밖에서 한다 — 여기서 나는 오류까지 DB 오류로 접어 넣으면 「저장은
  // 됐는데 화면만 안 바뀐 것」을 「저장 실패」라고 말하게 된다.
  let result: Awaited<ReturnType<typeof requestDomesticOrderApproval>>;
  try {
    result = await requestDomesticOrderApproval({
      domesticOrderId: input.domesticOrderId,
      actorUserId: actor.userId,
      requestReason: reason.reason,
      dueDateRowOrder: input.dueDateRowOrder,
    });
  } catch (err) {
    // 값 자체는 로그에 담지 않는다 — 사유 글에 고객사 사정이 섞일 수 있다
    // (schema/domestic-orders.ts 의 PII 항목).
    console.error("requestDomesticOrderApprovalAction: unexpected DB error", {
      code: isPgErrorLike(err) ? err.code : undefined,
    });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }

  // 성사됐을 때만 — 실패한 요청은 바뀐 것이 없으므로 캐시를 버릴 이유가 없다.
  if (result.ok) {
    revalidateDomesticOrderApprovalSurfaces(input.domesticOrderId);
    // 결재가 **새로 생긴** 자리다 — 처음 요청과 반려 뒤 재요청이 둘 다 여기로 온다.
    await notifyPortalOfDomesticOrderApprovalTurn(input.domesticOrderId);
  }
  return result;
}

export async function decideDomesticOrderApprovalAction(
  input: DecideDomesticOrderApprovalActionInput
): Promise<DomesticOrderApprovalActionResult> {
  // 🔴 내자 권한 영역을 묻지 않는다 — 파일 머리말의 「인가를 어디서 보는가」.
  const actor = await resolveActor(false);
  if (!actor.ok) return actor;

  if (!isValidDomesticOrderId(input.domesticOrderId)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 기타건을 찾을 수 없습니다." };
  }
  if (!isValidApprovalDecision(input.decision)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "결정 종류를 확인할 수 없습니다." };
  }
  const reason = validateReasonFormat(input.reason);
  if (!reason.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reason.error };
  }
  if (!isValidDueDateRowOrder(input.dueDateRowOrder)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "납기요청일 회차를 확인할 수 없습니다." };
  }

  let result: Awaited<ReturnType<typeof decideDomesticOrderApproval>>;
  try {
    result = await decideDomesticOrderApproval({
      domesticOrderId: input.domesticOrderId,
      decision: input.decision,
      actorUserId: actor.userId,
      decisionReason: reason.reason,
      dueDateRowOrder: input.dueDateRowOrder,
    });
  } catch (err) {
    console.error("decideDomesticOrderApprovalAction: unexpected DB error", {
      code: isPgErrorLike(err) ? err.code : undefined,
    });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }

  // 승인·반려가 성사되면 결재자 자신의 화면에서 그 건이 곧바로 빠져야 한다 —
  // 눌렀는데 그대로면 처리가 안 된 줄 알고 다시 누르게 된다.
  if (result.ok) {
    revalidateDomesticOrderApprovalSurfaces(input.domesticOrderId);
    // 🔴 **결재가 생기는 자리는 여기도다.** 한 단계가 승인되면 저장 경로가 **다음
    // 단계 요청 행을 이어 만든다**(mutations 의 「사슬을 잇는다」). 그 순간 다음
    // 사람에게 **새로** 차례가 오므로 그 사람도 메일을 받아야 한다. 사슬이
    // 끝났거나(마지막 단계 승인) 반려면 가장 최근 행이 REQUESTED 가 아니라서
    // 아무것도 나가지 않는다 — 그 판단은 notifyDomesticOrderApprovalCreated 안에 있다.
    await notifyPortalOfDomesticOrderApprovalTurn(input.domesticOrderId);
  }
  return result.ok ? { ok: true, id: result.id } : result;
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
