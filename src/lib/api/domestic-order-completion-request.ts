import { isValidDomesticOrderId, isValidExpectedVersion } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * PO 가 보내 온 「완료 처리 / 완료 해제」 요청의 **형식**만 본다
 * ============================================================================
 * `src/app/api/v1/domestic-orders/[id]/completion` 라우트가 쓴다. 이 저장소가
 * 입력 검증을 두는 자리와 같은 성격이다(`lib/validation/domestic-order-input.ts`)
 * — **DB 도 세션도 여기서 만지지 않는다.** 순수 함수라 DB 없이 그대로 시험할 수
 * 있고, 그래서 「어떤 값을 받아들이는가」가 실제로 검증된다.
 *
 * ── 🔴 느슨하게 받지 않는다 ─────────────────────────────────────────────
 * `completed` 가 불리언이 아니면 거절한다. `undefined` 를 「거짓」으로 읽으면
 * 키를 빠뜨린 요청이 조용히 **완료 해제**가 되고, 그 해제는 붙어 있는 수리 건의
 * 출하 완료까지 되돌린다. 같은 검사를 서버 액션이 이미 하고 있다
 * (`server/actions/domestic-orders.ts` 의 setDomesticOrderCompletionAction).
 *
 * ── 🔴 `sub` 은 A/S 의 users.id 가 아니다 ───────────────────────────────
 * 포털(dss-auth)에서의 그 사람 id 이고, A/S 는 그 값을 `users.sso_subject` 에
 * 적어 둔다. 모양을 여기서 UUID 로 못 박지 않는 까닭은 그 값의 모양을 정하는
 * 곳이 포털이기 때문이다 — 길이만 재고, 사람을 실제로 찾는 일은 라우트가
 * `getUserBySsoSubject` 에게 맡긴다.
 * ============================================================================
 */

/** 포털 쪽 `sub`. 지금은 UUID 지만 모양은 포털이 정하므로 길이만 막는다. */
const MAX_SUBJECT_LENGTH = 200;

export type DomesticOrderCompletionRequest = {
  id: string;
  expectedVersion: number;
  completed: boolean;
  /** 🔴 포털 번호(`users.sso_subject`). A/S 의 `users.id` 가 아니다. */
  requesterSub: string;
};

export type DomesticOrderCompletionRequestParseResult =
  | { ok: true; value: DomesticOrderCompletionRequest }
  /** `field` 는 화면이 칸 밑에 붙일 수 있게 서버 액션의 fieldErrors 키와 같다. */
  | { ok: false; field: "id" | "body" | "completed" | "expectedVersion" | "requester"; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 주소의 `[id]` 와 본문을 함께 본다 — 두 곳에서 오지만 하나의 요청이고, 나눠
 * 검사하면 「어느 쪽이 틀렸는가」를 라우트가 다시 엮어야 한다.
 *
 * 🔴 본문을 읽지 못한 경우(JSON 이 아니다)는 부르는 쪽이 `null` 을 넘긴다.
 *    여기서 `null` 을 빈 객체로 바꾸지 않는다 — 그러면 「본문 없음」이 「칸이
 *    빠졌음」으로 둔갑해 오류 문구가 엉뚱한 칸을 가리킨다.
 */
export function parseDomesticOrderCompletionRequest(input: {
  id: unknown;
  body: unknown;
}): DomesticOrderCompletionRequestParseResult {
  if (!isValidDomesticOrderId(input.id)) {
    return { ok: false, field: "id", message: "항목을 확인할 수 없습니다." };
  }
  if (!isPlainObject(input.body)) {
    return { ok: false, field: "body", message: "요청 본문을 읽을 수 없습니다." };
  }

  const { completed, expectedVersion, requester } = input.body;

  // 🔴 불리언이 아닌 값을 받아 두면 undefined 가 "해제"로 조용히 읽힌다.
  if (typeof completed !== "boolean") {
    return { ok: false, field: "completed", message: "완료 여부를 확인할 수 없습니다." };
  }
  if (!isValidExpectedVersion(expectedVersion)) {
    return { ok: false, field: "expectedVersion", message: "수정 시점 정보를 확인할 수 없습니다." };
  }
  if (!isPlainObject(requester)) {
    return { ok: false, field: "requester", message: "요청한 사람을 확인할 수 없습니다." };
  }

  const sub = requester.sub;
  if (typeof sub !== "string" || sub.trim() === "" || sub.trim().length > MAX_SUBJECT_LENGTH) {
    return { ok: false, field: "requester", message: "요청한 사람을 확인할 수 없습니다." };
  }

  return {
    ok: true,
    value: { id: input.id, expectedVersion, completed, requesterSub: sub.trim() },
  };
}
