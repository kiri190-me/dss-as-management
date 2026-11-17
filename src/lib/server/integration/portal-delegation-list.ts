import type { PortalApprovalDelegationAuditRow } from "@/lib/db/queries/portal-approval-delegations";

/**
 * ============================================================================
 * 포털의 **어긋남 점검**이 읽어 가는 위임 목록 — 몸통 모양과 상한 (설계 B-14)
 * ============================================================================
 * 2026-11-17, 조각 9a. 포털이 결재권 위임을 지정·철회하면 세 시스템(A/S · 재고관리 ·
 * 휴가)에 전파하고 **셋이 다 성공했을 때만** 포털에 적는다(설계 B-13). 🔴 **그래도
 * 「전파는 됐는데 포털 저장이 실패하는」 틈은 남는다.** 맞대어 볼 장치가 없으면 그
 * 어긋남은 **영영 조용하다** — 그래서 통로에 **읽기 갈래**를 연다.
 *
 * 🔴 **실제로 한 번 갈렸던 자리다.** 같은 규약을 세 집에 줬는데 규약이
 * 「`revokedAt` 에 널이 오면?」을 안 적어서 A/S 는 안 지우고 재고관리·휴가는 지웠다
 * (설계 B-15). **셋이 제 시험을 전부 통과하면서** 갈려 있었고, 잡은 길은 맞대어 보기
 * 하나뿐이었다. 이 파일은 그 맞대어 보기의 **내주는 쪽**이다.
 *
 * ── 🔴 답에 **사람을 싣지 않는다** — 이 설계의 핵심 ────────────────────────
 * 돌려주는 칸은 넷뿐이다: `id` · `startsAt` · `endsAt` · `revokedAt`.
 *  · 짝 맞추기는 **`id` 하나로 된다** — 포털이 정한 번호가 세 집에 **기본키로 그대로**
 *    들어 있다(표에 `defaultRandom()` 이 없다 — 그 칸의 주석).
 *  · 사람 칸을 빼면 **이 통로가 새는 자료가 사실상 없다.** 🔴
 *    `delegator_user_id`·`delegate_user_id`·`reason` 을 실으면 안 된다 — 점검에 쓰이지도
 *    않는데 「회사 전체의 결재 대리 관계」가 토큰 하나로 통째로 나간다. 사유에는 고객사나
 *    사람 이야기가 그대로 적혀 있을 수 있다.
 * 🔵 그래서 이 갈래는 포털 번호 ↔ A/S `users.id` 변환을 **한 번도 쓰지 않는다.** 변환을
 * 끌어오면 그 순간 사람을 실을 수 있게 되고, 다음 사람이 「이왕 읽은 김에」로 싣는다.
 *
 * ── 🔴 **모든 줄을 준다** ─────────────────────────────────────────────────
 * 살아 있는 것·끝난 것·**철회된 것 전부**다. 이 집에 이미 있는
 * `listPortalApprovalDelegationsForUser`(화면용)는 **보는 사람의 줄만** 집고 「살아
 * 있다/끝났다」로 나눠 상한까지 거는 조회라 그대로 쓰면 맞대어 보기가 그 자리에서 눈이
 * 먼다 — 「포털은 거뒀는데 집에서는 살아 있는」 줄이 B-13 이 말하는 **더 위험한 쪽**인데,
 * 하필 그것이 안 보인다. 그래서 거르개가 하나도 없는 조회를 따로 만들었다
 * (db/queries/portal-approval-delegations.ts 의 `listPortalApprovalDelegationsForAudit`).
 *
 * ── 🔴 왜 모양이 여기 있고 조회가 저기 있나 ──────────────────────────────
 * 이 집의 통합 통로는 판단을 전부 `server/integration/` 의 모듈로 빼고 라우트에는
 * 「토큰 꺼내 검증하고 이 함수 부르기」만 남긴다(portal-delegation-push.ts 머리말).
 * 🔴 그리고 **저장 계층(`db/queries/`)은 `@/lib/server/` 를 끌어오지 않는다** — 이 집의
 * 층 규칙이고 시험이 지킨다(server/portal-delegation-read-wiring.test.ts). 그래서
 * **상한 값을 조회가 import 할 수 없고**, 통로가 아래 상수를 조회와 이 모듈에 **같은
 * 값으로 들고 내려간다**(route.ts 의 그 자리 · 시험이 둘 다 같은 상수인지 센다).
 * ============================================================================
 */

/**
 * 읽기 갈래를 고르는 글자. 🔴 **세 집이 같아야 한다** — 포털 한 곳이 같은 몸통으로
 * 셋을 부른다(쓰기 갈래의 `upsert`·`revoke` 와 같은 약속).
 *
 * 🔴 **쓰기 갈래의 말 목록에 더하지 않았다.** `parsePortalDelegationPush` 가 `list` 를
 * 쓰기 명령으로 받아들이면 「id 가 uuid 가 아닙니다」라는 엉뚱한 말이 돌아가고, 무엇보다
 * **쓰기 토큰으로 읽기 갈래에 발을 들이는 길**이 생긴다. 두 갈래는 쓰임새(purpose)가
 * 다르므로 **갈라지는 자리가 모양 검사보다 앞**이어야 한다(통로 머리말).
 */
export const DELEGATION_LIST_ACTION = "list";

/**
 * 한 번에 내주는 줄의 상한.
 *
 * 🔵 넉넉하다 — 이 표의 줄은 「자리를 비우는 사람 수」에 묶여 있어 끝난 줄까지 세어도
 * 해에 수십 줄 자란다(개발 DB 에 둘뿐이다).
 * 🔴 **그래도 상한을 둔다.** 없으면 표가 자란 어느 날 점검 한 번이 수만 줄을 한 몸통에
 * 싣고, 그 줄에는 사람이 없으니 아무도 눈치채지 못한 채 느려진다.
 * 🔴 **넘치면 `truncated: true` 로 말한다**(아래 `buildDelegationListReply`). 조용히
 * 자르면 점검이 잘린 줄을 「집에 없다」로 읽는데, 그 모양은 이 점검이 찾으려는 어긋남과
 * **글자 그대로 같다** — 거짓 경보가 아니라 **거짓 진짜**가 된다.
 */
export const DELEGATION_LIST_LIMIT = 2000;

/**
 * 몸통에 실리는 한 줄. 시각은 ISO 8601(UTC, `Z`)로 나간다 — 포털이 제 줄의
 * `toISOString()` 과 **글자로** 맞대므로 시간대가 붙어 있어야 한다.
 */
export type PortalDelegationListEntry = {
  id: string;
  startsAt: string;
  endsAt: string;
  /** 비어 있으면 살아 있는 줄. 🔴 **거둔 줄도 반드시 함께 내준다.** */
  revokedAt: string | null;
};

export type PortalDelegationListReply = {
  delegations: PortalDelegationListEntry[];
  /** 🔴 상한에 걸려 **잘렸는가.** 잘렸으면 포털은 안 온 줄을 「없다」로 읽으면 안 된다. */
  truncated: boolean;
};

/** 몸통이 폼 인코딩인가. 🔵 `; charset=utf-8` 이 붙어 와도 같은 말이다. */
const FORM_ENCODED = /^application\/x-www-form-urlencoded\s*(;|$)/i;

/**
 * 몸통에서 **`action` 한 칸만** 엿본다. 🔴 모양 검사가 아니다 — 어느 갈래로 갈지(= 어느
 * 쓰임새의 토큰을 요구할지)만 정한다. 읽지 못하면 `null` 이고, 그러면 통로는 **예전
 * 그대로** 쓰기 갈래로 간다(모르는 값의 거절 규칙을 새로 만들지 않는다).
 *
 * ── 🔴 몸통 모양 **둘을 다 받는다** ──────────────────────────────────────
 * 이 통로의 몸통은 처음부터 **JSON** 이고(세 집 규약, 2026-11-16) 이 갈래의 설계 문서도
 * JSON 으로 못 박았다. 그런데 **휴가(dss-leave)가 폼 인코딩도 함께 받는다** —
 * 그 집 지시서에 폼 인코딩이라 적혀 있었던 흔적이다(포털이 **제 화면에** 쓰는 위임
 * 통로가 폼 인코딩이라 그 모양이 따라온 것으로 보인다). 🔴 **한쪽만 받으면 포털이 어느
 * 모양으로 부르느냐에 따라 집 하나만 400·401 이 되는데**, 그 답은 점검 스크립트에서
 * 「못 쟀다」로 보여 **진짜 어긋남과 섞인다.** 규약이 안 정한 빈칸에서 집마다 다르게 간
 * 것이 바로 B-15 였으므로, 여기서도 **휴가와 같은 글자**로 둘 다 받는다.
 */
export function readDelegationAction(raw: string, contentType: string | null): string | null {
  if (FORM_ENCODED.test((contentType ?? "").trim())) {
    return new URLSearchParams(raw).get("action");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 🔵 여기서 400 을 내지 않는다. 읽히지 않는 몸통은 **쓰기 갈래의 일**이고, 거기서는
    //    토큰을 먼저 보고 거절한다(통로 머리말의 차례).
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const action = (parsed as Record<string, unknown>).action;
  return typeof action === "string" ? action : null;
}

/** 읽기 갈래인가. */
export function isDelegationListAction(action: string | null): boolean {
  return action === DELEGATION_LIST_ACTION;
}

/**
 * 표에서 읽은 줄을 몸통으로.
 *
 * 🔴 **상한보다 한 줄 더 받아서** 넘쳤는지를 가린다 — 조회가 `limit + 1` 로 묻는다
 * (db/queries/portal-approval-delegations.ts). 딱 `limit` 만 읽으면 **정확히 상한만큼
 * 있는 날**과 **넘친 날**을 가를 수 없고, 둘 중 뒤쪽에서만 `truncated` 가 참이어야 한다.
 *
 * 🔴 **칸을 하나씩 적어 싣는다.** `...row` 로 펼치면 표에 칸이 하나 늘거나 조회가 칸을
 * 더 고르는 날 **사람 번호가 조용히 몸통에 실린다** — 오류도 경고도 없고, 받는 쪽(포털)은
 * 더 온 칸을 그냥 버리므로 아무도 모른다.
 */
export function buildDelegationListReply(
  rows: readonly PortalApprovalDelegationAuditRow[],
  limit: number = DELEGATION_LIST_LIMIT
): PortalDelegationListReply {
  const truncated = rows.length > limit;
  return {
    delegations: rows.slice(0, limit).map((row) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    })),
    truncated,
  };
}
