import { NextResponse, type NextRequest } from "next/server";

import { parseDomesticOrderCompletionRequest } from "@/lib/api/domestic-order-completion-request";
import { NO_STORE } from "@/lib/api/shared-token";
import { checkWriteApiToken } from "@/lib/api/write-token";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { getUserBySsoSubject } from "@/lib/db/queries/users";
import { portalActorCanWork } from "@/lib/server/integration/portal-notifications";
import {
  completeDomesticOrderWithShipment,
  type CompleteDomesticOrderResultCode,
} from "@/lib/server/services/complete-domestic-order";
import {
  releaseDomesticOrderWithShipment,
  type ReleaseDomesticOrderResultCode,
} from "@/lib/server/services/release-domestic-order";

/**
 * ============================================================================
 * POST /api/v1/domestic-orders/{id}/completion — 내자 줄 완료 처리 · 완료 해제
 * ============================================================================
 * 부르는 쪽: **PO·내자 사이트(dss-po)의 서버**. 그쪽에도 내자 정리 화면이 있고
 * 같은 DB 를 본다. 2026-10-18 에 A/S 에 생긴 「완료 처리 한 번이 붙어 있는 수리
 * 건의 출하 완료까지 함께 움직인다」가 PO 쪽에서는 돌지 않아서 이 통로를 연다.
 *
 * 🔴 **규칙을 PO 로 베끼지 않는 것이 이 통로의 존재 이유다.** 출하 완료 판정 ·
 * 승인 확인 · 되돌리기 · 두 mutation 의 차례는 전부 A/S 의 서비스 둘이 쥐고
 * 있다(`server/services/complete-domestic-order.ts` ·
 * `release-domestic-order.ts`). 베끼면 규칙이 두 벌이 되어 한쪽만 고쳐지는 날이
 * 온다. 이 라우트는 **자격을 가리고 형식을 재서 그 서비스에 넘길 뿐**이고,
 * 업무 규칙은 한 줄도 여기 없다.
 *
 * ── 왜 `/api/v1/` 아래인가 ──────────────────────────────────────────────
 * 이 저장소의 통로는 **자격 방식으로** 갈려 있다.
 *   · `/api/integration/**` — 포털(dss-auth)이 **서명한** 토큰. 포털만 부른다.
 *   · `/api/v1/**`          — 사내 시스템의 **서버**가 공유 토큰으로 부른다.
 * PO 는 포털이 아니라 또 하나의 사이트이고 포털의 열쇠가 없으므로 뒤쪽이다.
 * 🔴 설명서 `API_FOR_INTERNAL_SYSTEMS.md` 는 「/api/v1 은 읽기 전용」이라고
 * 적고 있다 — 이 통로가 그 말을 **깬 첫 번째**다. 그 문서를 함께 고칠 것.
 *
 * ── 자격은 두 겹이다 ────────────────────────────────────────────────────
 *  1. **어느 시스템이 보냈나** — `Authorization: Bearer <AS_WRITE_TOKEN>`.
 *     판단은 `lib/api/write-token.ts` 하나이고, 읽기 토큰과 다른 값이다.
 *  2. **누가 눌렀나** — 본문의 `requester.sub`(포털 번호). 🔴 PO 가 「이 사람
 *     권한 있어요」라고 말하는 것을 믿지 않는다. A/S 가 **직접** 사람을 찾고
 *     (`getUserBySsoSubject`), 살아 있는 계정인지 보고(`portalActorCanWork` —
 *     승인됨 · 활성 · 잠기지 않음. 소프트 삭제는 조회가 이미 거른다), 화면의
 *     서버 액션과 **똑같은 관문**(`hasPermission(…, "domesticOrders", "WRITE")`)
 *     을 통과시킨다. 관문이 갈라지면 「화면으로는 막히는데 통로로는 되는」
 *     구멍이 생긴다.
 *
 * ── 🔴 이 통로가 없던 권한을 새로 주는 것은 아니다 ──────────────────────
 * 공유 비밀을 아는 쪽은 `requester.sub` 를 바꿔 보낼 수 있다. 그래도 위험이
 * 늘지 않는다 — **PO 는 A/S 와 같은 DB 를 쓰므로 그 표에 이미 직접 쓸 수 있다**
 * (PO_DOMESTIC_SPLIT_DESIGN.md B-2). 즉 이 통로는 PO 가 못 하던 일을 열어 주는
 * 것이 아니라, 하던 일을 **A/S 의 규칙을 거쳐** 하게 만드는 것이다. 이 판단을
 * 적어 두지 않으면 다음 사람이 「왜 사용자를 본문으로 받나」에서 멈춘다.
 * 포털 서명 토큰 쪽이 더 튼튼하다는 것과 지금 그것을 못 쓰는 까닭(PO 가 구울 수
 * 없다)은 `lib/api/write-token.ts` 머리말에 있다.
 *
 * ── 🔴 거절 까닭을 숨기는 자리와 알려 주는 자리가 갈린다 ────────────────
 *  · 자격 실패(401 · 403)는 **까닭을 담지 않는다.** 「토큰 틀림」과 「그런 줄
 *    없음」을 구별해 주면 두드려 보는 쪽에 실마리가 된다. 까닭은 서버 로그로.
 *  · 업무 거절(`SHIPMENT_COMPLETION_BLOCKED` 등)은 **그대로 내보낸다.** 그
 *    `message` 는 「최종 출하 승인이 없습니다」처럼 **사람에게 보여 줄 글**이고,
 *    PO 화면이 그 문장을 띄워야 사람이 다음에 무엇을 할지 안다. 숨기면 사람은
 *    같은 단추를 계속 누른다.
 *
 * ── 차례 ────────────────────────────────────────────────────────────────
 *   토큰 → 저장 모드 → 형식 검증 → 사람 찾기·권한 → 서비스
 * 🔵 서버 액션은 **인가가 검증보다 먼저**다(로그인하지 않은 요청이 어떤 값이
 *    유효한지 알아내지 못하게). 여기서 순서가 바뀐 까닭은 토큰을 통과한 시점에
 *    부르는 쪽이 이미 **믿는 시스템**이고, 사람을 찾으려면 본문의 `sub` 를 먼저
 *    읽어야 하기 때문이다. 🔴 **관문 자체는 하나도 다르지 않다** — 바뀐 것은
 *    순서뿐이다.
 *
 *   200  { ok: true, id, version, repairCaseShipmentCompleted, repairCaseShipmentReverted }
 *   400  { ok: false, code: "VALIDATION_ERROR", fieldErrors, message }
 *   401  { error: "unauthorized" }          토큰이 없거나 틀림
 *   403  { ok: false, code: "FORBIDDEN", message }   사람을 못 찾음 · 권한 없음
 *   404  { ok: false, code: "NOT_FOUND", message }
 *   409  { ok: false, code: "CONFLICT" | "SHIPMENT_COMPLETION_BLOCKED", message }
 *   503  { error: "api_closed" } · { ok: false, code: "DATABASE_UNAVAILABLE", message }
 *
 * 설명서: `API_FOR_INTERNAL_SYSTEMS.md`.
 * ============================================================================
 */

type CompletionResultCode =
  | CompleteDomesticOrderResultCode
  | ReleaseDomesticOrderResultCode
  | "FORBIDDEN"
  | "DATABASE_UNAVAILABLE";

const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const FORBIDDEN_MESSAGE = "이 작업을 수행할 권한이 없습니다.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

/**
 * 업무 거절의 HTTP 번호. 🔵 `code` 가 진짜 구분이고 번호는 거드는 값이다 —
 * CONFLICT 와 SHIPMENT_COMPLETION_BLOCKED 가 같은 409 인 까닭이 그것이다(둘 다
 * 「지금 상태라서 안 된다」이고, 무엇이 막았는지는 `code` 가 말한다).
 */
function statusForCode(code: CompletionResultCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "SHIPMENT_COMPLETION_BLOCKED":
      return 409;
    case "DATABASE_UNAVAILABLE":
      return 503;
  }
}

/**
 * 오류에서 **코드만** 꺼낸다. drizzle 이 Postgres 오류를 한 겹 싸므로 `cause` 도
 * 본다(mutations 쪽 시험의 expectPgError 와 같은 자리).
 */
function errorCode(err: unknown): unknown {
  const has = (value: unknown) => typeof value === "object" && value !== null && "code" in value;
  if (has(err)) return (err as { code?: unknown }).code;
  const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return has(cause) ? (cause as { code?: unknown }).code : undefined;
}

function failure(
  code: CompletionResultCode,
  message: string,
  fieldErrors?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) },
    { status: statusForCode(code), headers: NO_STORE }
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // 🔴 문지기가 맨 먼저다. 막히면 DB 를 두드리지 않는다.
  const denied = checkWriteApiToken(request);
  if (denied) return denied;

  // 서버 액션의 첫 줄과 같은 검사다 — mock 모드에서는 `users` 표가 신원의
  // 출처가 아니라서 아래 사람 찾기가 뜻을 잃는다. 열어 둘 이유가 없다.
  if (getAuthSource() !== "database") {
    console.error("[api] 내자 완료 통로: AUTH_SOURCE 가 database 가 아니라 닫혀 있습니다.");
    return NextResponse.json(
      { error: "api_closed", message: "데이터베이스 저장 모드가 아닙니다." },
      { status: 503, headers: NO_STORE }
    );
  }

  const { id } = await context.params;
  // 🔴 JSON 이 아니면 `null` 로 넘긴다 — 빈 객체로 바꾸면 「본문 없음」이 「칸이
  //    빠졌음」으로 둔갑한다(파서 머리말).
  const body = await request.json().catch(() => null);

  const parsed = parseDomesticOrderCompletionRequest({ id, body });
  if (!parsed.ok) {
    return failure("VALIDATION_ERROR", VALIDATION_MESSAGE, { [parsed.field]: parsed.message });
  }

  // ── 누가 눌렀나 — A/S 가 **다시** 본다(위 머리말의 자격 두 겹) ──────────
  const actor = await getUserBySsoSubject(parsed.value.requesterSub);
  if (!actor || !portalActorCanWork(actor)) {
    // 🔴 「그런 사람 없음」과 「정지된 계정」을 응답에서 가르지 않는다.
    console.error("[api] 내자 완료 통로: 일할 수 있는 계정을 찾지 못했습니다.", { found: actor !== null });
    return failure("FORBIDDEN", FORBIDDEN_MESSAGE);
  }
  if (!(await hasPermission({ role: actor.role, isDeveloper: actor.isDeveloper }, "domesticOrders", "WRITE"))) {
    console.error("[api] 내자 완료 통로: 권한이 모자랍니다.", { userId: actor.id });
    return failure("FORBIDDEN", FORBIDDEN_MESSAGE);
  }

  try {
    if (!parsed.value.completed) {
      // 완료 해제 — 붙어 있는 수리 건의 출하 완료를 먼저 되돌린다(서비스가 한다).
      const released = await releaseDomesticOrderWithShipment({
        id: parsed.value.id,
        expectedVersion: parsed.value.expectedVersion,
        actorUserId: actor.id,
      });
      if (!released.ok) return failure(released.code, released.message);
      return NextResponse.json(
        {
          ok: true,
          id: released.id,
          version: released.version,
          repairCaseShipmentCompleted: false,
          repairCaseShipmentReverted: released.repairCaseShipmentReverted,
        },
        { headers: NO_STORE }
      );
    }

    const completed = await completeDomesticOrderWithShipment({
      id: parsed.value.id,
      expectedVersion: parsed.value.expectedVersion,
      actorUserId: actor.id,
    });
    if (!completed.ok) return failure(completed.code, completed.message);
    return NextResponse.json(
      {
        ok: true,
        id: completed.id,
        version: completed.version,
        repairCaseShipmentCompleted: completed.repairCaseShipmentCompleted,
        repairCaseShipmentReverted: false,
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    // 🔴 **오류 코드만** 남긴다. Postgres 오류 문구에는 걸린 값이 그대로 실려
    //    나오는데, 이 표의 자유 입력 칸(현황·이력·기타·납품자)에 사람 이름이
    //    섞일 수 있다. 휴지통·머리말 액션이 같은 까닭으로 같은 모양을 쓴다
    //    (actions/domestic-orders.ts 의 runEachTrashItem).
    console.error("[api] 내자 완료 통로: 예기치 못한 DB 오류", { code: errorCode(err) });
    return failure("DATABASE_UNAVAILABLE", DATABASE_UNAVAILABLE_MESSAGE);
  }
}
