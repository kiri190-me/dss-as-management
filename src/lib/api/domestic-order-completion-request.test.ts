import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseDomesticOrderCompletionRequest } from "./domestic-order-completion-request";

/**
 * ============================================================================
 * PO 가 보내 온 완료 처리·완료 해제 요청의 형식 검증
 * ============================================================================
 * 🔴 가장 중요한 한 줄: **`completed` 가 빠진 요청이 「완료 해제」로 읽히지
 * 않는가.** 해제는 붙어 있는 수리 건의 출하 완료까지 되돌리는 조작이라, 키 하나를
 * 빠뜨린 요청이 조용히 그 일을 하면 안 된다. 서버 액션이 같은 검사를 하고 있고
 * (`server/actions/domestic-orders.ts`), 여기 적는 것은 그 울타리의 통로 쪽 몫이다.
 * ============================================================================
 */

const ID = "11111111-2222-4333-8444-555555555555";
const SUB = "bd06ad30-1111-4222-8333-444444444444";

function ok(body: Record<string, unknown>) {
  return parseDomesticOrderCompletionRequest({ id: ID, body });
}

const VALID_BODY = { completed: true, expectedVersion: 3, requester: { sub: SUB } };

describe("제대로 된 요청", () => {
  test("네 값을 그대로 돌려준다", () => {
    const result = ok(VALID_BODY);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { id: ID, expectedVersion: 3, completed: true, requesterSub: SUB });
  });

  test("completed: false 도 제대로 된 요청이다 — 완료 해제가 그 길이다", () => {
    const result = ok({ ...VALID_BODY, completed: false });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.completed, false);
  });

  test("sub 의 앞뒤 공백은 떼고 넘긴다", () => {
    const result = ok({ ...VALID_BODY, requester: { sub: `  ${SUB}  ` } });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.requesterSub, SUB);
  });

  test("모르는 칸이 섞여 와도 걸러서 넘긴다 — 네 값만 나간다", () => {
    const result = ok({ ...VALID_BODY, actorUserId: "남이 정한 값", force: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(Object.keys(result.value).sort(), ["completed", "expectedVersion", "id", "requesterSub"]);
  });
});

describe("🔴 completed 를 느슨하게 받지 않는다", () => {
  test("빠졌거나 불리언이 아니면 거절한다 — undefined 가 해제로 읽히면 안 된다", () => {
    for (const completed of [undefined, null, 0, 1, "", "true", "false", [], {}]) {
      const body: Record<string, unknown> = { expectedVersion: 3, requester: { sub: SUB } };
      if (completed !== undefined) body.completed = completed;
      const result = parseDomesticOrderCompletionRequest({ id: ID, body });
      assert.equal(result.ok, false, `${JSON.stringify(completed)} 를 받아들였다`);
      if (result.ok) return;
      assert.equal(result.field, "completed");
    }
  });
});

describe("나머지 칸", () => {
  test("id 가 UUID 모양이 아니면 거절한다", () => {
    for (const id of [undefined, null, "", "1", "not-a-uuid", 12345, {}]) {
      const result = parseDomesticOrderCompletionRequest({ id, body: VALID_BODY });
      assert.equal(result.ok, false, `${JSON.stringify(id)} 를 받아들였다`);
      if (result.ok) return;
      assert.equal(result.field, "id");
    }
  });

  test("본문이 객체가 아니면 거절한다 — JSON 이 아니면 부르는 쪽이 null 을 넘긴다", () => {
    for (const body of [null, undefined, "", "{}", 3, true, []]) {
      const result = parseDomesticOrderCompletionRequest({ id: ID, body });
      assert.equal(result.ok, false, `${JSON.stringify(body)} 를 받아들였다`);
      if (result.ok) return;
      assert.equal(result.field, "body");
    }
  });

  test("expectedVersion 은 1 이상의 정수여야 한다", () => {
    for (const expectedVersion of [undefined, null, 0, -1, 1.5, "3", Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = ok({ ...VALID_BODY, expectedVersion });
      assert.equal(result.ok, false, `${JSON.stringify(expectedVersion)} 를 받아들였다`);
      if (result.ok) return;
      assert.equal(result.field, "expectedVersion");
    }
  });

  test("requester.sub 가 없거나 빈 글자면 거절한다", () => {
    for (const requester of [undefined, null, {}, { sub: "" }, { sub: "   " }, { sub: 3 }, "sub", []]) {
      const result = ok({ ...VALID_BODY, requester });
      assert.equal(result.ok, false, `${JSON.stringify(requester)} 를 받아들였다`);
      if (result.ok) return;
      assert.equal(result.field, "requester");
    }
  });

  test("터무니없이 긴 sub 는 거절한다", () => {
    const result = ok({ ...VALID_BODY, requester: { sub: "a".repeat(201) } });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.field, "requester");
  });

  test("🔴 거절 문구에 받은 값을 되비치지 않는다", () => {
    const result = ok({ ...VALID_BODY, requester: { sub: "someone-elses-subject" } , expectedVersion: "열셋" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(!result.message.includes("열셋"));
  });
});
