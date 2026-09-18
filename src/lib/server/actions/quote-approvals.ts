"use server";

import { revalidatePath } from "next/cache";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  decideQuoteApproval,
  requestQuoteApproval,
  type QuoteApprovalFailureCode,
} from "@/lib/db/mutations/quote-approvals";
import {
  isValidApprovalDecision,
  validateReasonFormat,
  type ApprovalDecisionCode,
} from "@/lib/validation/repair-case-approval-input";
import { isValidQuoteId } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 결재 — 서버 액션 (정책 계층)
 * ============================================================================
 * server/actions/quotes.ts · server/actions/repair-case-approvals.ts 와 같은
 * 형식이다: 세션 확인 → 인가 확인 → 입력 형식 검증 → mutation 호출.
 * **순서가 곧 규칙이다** — 검증을 먼저 하면 로그인하지 않은 요청이 어떤 값이
 * 유효한지를 알아낼 수 있게 된다.
 *
 * 🔴 **화면이 무엇을 보여 줬든 매번 처음부터 다시 검사한다.** 목록·상세가
 * 단추를 감추는 것은 편의일 뿐이고, 여기서도 mutation 안에서도 판정을 다시
 * 한다. 클라이언트가 보낸 값은 형식 말고는 아무것도 믿지 않는다.
 *
 * ── 🔴 이 액션들은 발행을 막지 않는다 ──────────────────────────────────
 * **결재가 끝나기 전에도 견적서를 발행할 수 있다**(2026-09-18 사용자 결정).
 * 여기서 남기는 것은 「누가 언제 승인했나」라는 기록이고, 발행 통로
 * (api/quotes/[id]/xlsx · api/quotes/[id]/issue)는 이 결재를 한 번도 보지
 * 않는다. 막아야 할 필요가 생기면 코드를 고치기 전에 사용자에게 먼저 묻는다.
 *
 * ── 인가를 어디서 보는가 ────────────────────────────────────────────────
 *  · **요청**은 `quotes` WRITE 다 — 견적서를 만들고 고치는 그 열쇠 그대로다
 *    (actions/quotes.ts 와 같은 영역·같은 수준. 새 권한 영역을 만들지 않는다).
 *  · **승인·반려**는 권한 영역을 보지 않는다. 결재선에 올라간 사람이 곧 그
 *    단계의 결재자라는 것이 이 기능의 설계이고, 그 판정은 mutation 이 자기
 *    트랜잭션 안에서 한다(지정 관문 + 최고관리자 비상구). 여기서 `quotes` 열쇠를
 *    한 겹 더 요구하면 **결재선에 올릴 수 있는 사람과 결재할 수 있는 사람이
 *    갈라져**, 관리자가 아무도 처리할 수 없는 절차를 만들 수 있게 된다.
 *    repair-case-approvals.ts 의 액션이 인가를 mutation 에 맡기는 것과 같은
 *    자리다.
 * ============================================================================
 */

export type QuoteApprovalActionCode =
  | QuoteApprovalFailureCode
  | "UNAUTHORIZED"
  | "DATABASE_UNAVAILABLE";

export type QuoteApprovalActionResult =
  | { ok: true; id: string }
  | { ok: false; code: QuoteApprovalActionCode; message: string };

export type RequestQuoteApprovalActionInput = {
  quoteId: string;
  /** 올리며 적는 말. 없어도 된다. */
  reason?: string | null;
};

export type DecideQuoteApprovalActionInput = {
  quoteId: string;
  decision: ApprovalDecisionCode;
  /** 🔴 반려에는 필수다 — 그 판정은 mutation 이 한다(상태를 봐야 알 수 있다). */
  reason?: string | null;
};

const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";

type ResolvedActor =
  | { ok: true; userId: string }
  | { ok: false; code: QuoteApprovalActionCode; message: string };

/**
 * 세션 → 살아 있는 계정 → (필요하면) 견적서 열쇠.
 *
 * 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다** — 강등된
 * 계정이 토큰 만료 전까지 예전 권한으로 결재하는 구멍을 막는다
 * (actions/quotes.ts 의 같은 자리).
 *
 * @param requiredQuotesLevel `null` 이면 견적서 권한 영역을 보지 않는다 —
 *   승인·반려가 그렇다(파일 머리말의 「인가를 어디서 보는가」).
 */
async function resolveActor(requiredQuotesLevel: "READ" | "WRITE" | null): Promise<ResolvedActor> {
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
  if (requiredQuotesLevel !== null && !(await hasPermission(actingUser, "quotes", requiredQuotesLevel))) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }
  return { ok: true, userId: actingUser.id };
}

/**
 * 결재가 실제로 움직인 뒤 **그 행동을 한 사람의 다음 렌더**를 새로 계산하게
 * 만든다. 요청을 올려 놓고 새로 고쳐도 자기 화면이 그대로인 상태를 없앤다.
 *
 * 닿아야 할 곳이 둘이다 — 사이드바·헤더의 「내게 온 결재」 계산이 있는
 * `(app)/layout.tsx`(라우트 그룹이라 URL 에 나타나지 않으므로 경로는 `/` 다)와,
 * 그 견적서의 상세 화면(`/quotes/<id>` 아래). 앞의 호출에 이미 포함되지만 따로
 * 적어 둔다: 나중에 `/` 호출을 더 좁은 것으로 바꾸더라도 상세 화면 갱신이
 * 조용히 사라지지 않게 하기 위해서다(repair-case-approvals.ts 의 같은 도우미).
 */
function revalidateQuoteApprovalSurfaces(quoteId: string): void {
  revalidatePath("/", "layout");
  revalidatePath(`/quotes/${quoteId}`, "layout");
}

export async function requestQuoteApprovalAction(
  input: RequestQuoteApprovalActionInput
): Promise<QuoteApprovalActionResult> {
  const actor = await resolveActor("WRITE");
  if (!actor.ok) return actor;

  if (!isValidQuoteId(input.quoteId)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 견적서를 찾을 수 없습니다." };
  }
  // 형식만 본다 — 「사유가 필수인가」는 상태를 봐야 아는 판단이라 mutation 의
  // 몫이다(validation/repair-case-approval-input.ts 의 같은 주석).
  const reason = validateReasonFormat(input.reason);
  if (!reason.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reason.error };
  }

  // 갱신은 try 밖에서 한다 — 여기서 나는 오류까지 DB 오류로 접어 넣으면
  // 「저장은 됐는데 화면만 안 바뀐 것」을 「저장 실패」라고 말하게 된다.
  let result: Awaited<ReturnType<typeof requestQuoteApproval>>;
  try {
    result = await requestQuoteApproval({
      quoteId: input.quoteId,
      actorUserId: actor.userId,
      requestReason: reason.reason,
    });
  } catch (err) {
    // 값 자체는 로그에 담지 않는다 — 사유 글에 고객사 사정이 섞일 수 있다
    // (schema/quotes.ts 의 PII 항목).
    console.error("requestQuoteApprovalAction: unexpected DB error", {
      code: isPgErrorLike(err) ? err.code : undefined,
    });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }

  // 성사됐을 때만 — 실패한 요청은 바뀐 것이 없으므로 캐시를 버릴 이유가 없다.
  if (result.ok) revalidateQuoteApprovalSurfaces(input.quoteId);
  return result;
}

export async function decideQuoteApprovalAction(
  input: DecideQuoteApprovalActionInput
): Promise<QuoteApprovalActionResult> {
  // 🔴 견적서 권한 영역을 묻지 않는다 — 파일 머리말의 「인가를 어디서 보는가」.
  const actor = await resolveActor(null);
  if (!actor.ok) return actor;

  if (!isValidQuoteId(input.quoteId)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 견적서를 찾을 수 없습니다." };
  }
  if (!isValidApprovalDecision(input.decision)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "결정 종류를 확인할 수 없습니다." };
  }
  const reason = validateReasonFormat(input.reason);
  if (!reason.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reason.error };
  }

  let result: Awaited<ReturnType<typeof decideQuoteApproval>>;
  try {
    result = await decideQuoteApproval({
      quoteId: input.quoteId,
      decision: input.decision,
      actorUserId: actor.userId,
      decisionReason: reason.reason,
    });
  } catch (err) {
    console.error("decideQuoteApprovalAction: unexpected DB error", {
      code: isPgErrorLike(err) ? err.code : undefined,
    });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }

  // 승인·반려가 성사되면 결재자 자신의 화면에서 그 건이 곧바로 빠져야 한다 —
  // 눌렀는데 그대로면 처리가 안 된 줄 알고 다시 누르게 된다.
  if (result.ok) revalidateQuoteApprovalSurfaces(input.quoteId);
  return result.ok ? { ok: true, id: result.id } : result;
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
