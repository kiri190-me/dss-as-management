import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { PORTAL_TOKEN_PURPOSES } from "@/lib/auth/portal-service-token";
import type { PortalApprovalDelegationAuditRow } from "@/lib/db/queries/portal-approval-delegations";
import { parsePortalDelegationPush } from "./portal-delegation-push";
import {
  DELEGATION_LIST_ACTION,
  DELEGATION_LIST_LIMIT,
  buildDelegationListReply,
  isDelegationListAction,
  readDelegationAction,
} from "./portal-delegation-list";

/**
 * ============================================================================
 * 포털의 **어긋남 점검**이 읽어 가는 갈래 — 모양과 상한 (설계 B-14, 조각 9a)
 * ============================================================================
 * 라우트는 DB 를 끌어와 이 목록에서 불러올 수 없으므로(옆 push 시험과 같은 사정),
 * 여기서는 **라우트가 쓰는 판단**을 값으로 돌려 본다. 라우트가 그 판단을 실제로 그
 * 차례대로 쓰는지는 `app/api/integration/route-source.test.ts` 가 글자로, 질의가 무엇을
 * 고르고 무엇을 안 거르는지는 `db/queries/portal-approval-delegations-audit.integration.test.ts`
 * 가 **구워진 SQL 과 실제 줄**로 본다.
 *
 * 🔴 여기서 못 박는 것:
 *  1. **글자가 세 집에서 같다** — `list` · `dss.delegations.read` · `dss.delegations.write`.
 *     🔴 A/S 에서는 다른 두 집의 소스를 읽을 수 없으므로 **값을 적어 둔다.** 한 집이
 *     글자를 바꾸면 그 집만 조용히 401 이 되고, 점검은 그것을 「못 쟀다」로 읽어 진짜
 *     어긋남과 섞인다.
 *  2. 🔴 **`list` 는 쓰기 명령이 아니다** — 쓰기 모양 검사가 그대로 거절한다. 거기 끼면
 *     **쓰기 토큰으로 읽기 갈래에 발을 들이는 길**이 생긴다.
 *  3. 🔴 **답에 사람이 없다** — 줄에 사람 칸을 섞어 넣어도 몸통에 안 나간다.
 *  4. 🔴 **철회된 줄도 그대로 실린다**(맞대어 보기의 핵심).
 *  5. 🔴 **넘치면 말한다**(`truncated`) — 조용히 자르면 점검이 「집에 없다」로 읽는다.
 * ============================================================================
 */

/** 🔴 가짜 번호다. 실제 사람·고객사가 한 자도 들어가지 않는다. */
const DELEGATION_ID = "cccc3333-3333-4333-8333-333333333333";
const DELEGATOR_SUB = "11111111-2222-4333-8444-555555555555";
const DELEGATE_SUB = "66666666-7777-4888-8999-aaaaaaaaaaaa";

/** 표에서 읽은 줄 한 개. 기본은 **살아 있는** 줄이다. */
function auditRow(
  over: Partial<PortalApprovalDelegationAuditRow> = {}
): PortalApprovalDelegationAuditRow {
  return {
    id: DELEGATION_ID,
    startsAt: new Date("2027-03-01T00:00:00.000Z"),
    endsAt: new Date("2027-03-08T00:00:00.000Z"),
    revokedAt: null,
    ...over,
  };
}

describe("갈래 가리기 — 몸통에서 action 한 칸만 엿본다", () => {
  test("🔴 글자가 세 집에서 같아야 한다 — 값으로 못 박는다", () => {
    assert.equal(DELEGATION_LIST_ACTION, "list");
    assert.equal(PORTAL_TOKEN_PURPOSES.delegationsRead, "dss.delegations.read");
    // 🔵 쓰기 쪽이 그대로인 것도 함께 잰다 — 둘이 같은 글자가 되면 울타리가 없어진다.
    assert.equal(PORTAL_TOKEN_PURPOSES.delegationsWrite, "dss.delegations.write");
    assert.notEqual(
      PORTAL_TOKEN_PURPOSES.delegationsRead,
      PORTAL_TOKEN_PURPOSES.delegationsWrite
    );
    // 🔴 쓰임새 값이 **하나라도 겹치면** 그 두 통로 사이의 울타리가 사라진다.
    const 쓰임새 = Object.values(PORTAL_TOKEN_PURPOSES);
    assert.equal(new Set(쓰임새).size, 쓰임새.length, "쓰임새 글자가 겹친다");
  });

  test("JSON 몸통에서 읽기 갈래를 가린다", () => {
    const action = readDelegationAction('{"action":"list"}', "application/json");
    assert.equal(action, "list");
    assert.ok(isDelegationListAction(action));
    // 🔵 다른 칸이 함께 와도 action 만 본다.
    assert.ok(
      isDelegationListAction(
        readDelegationAction('{"id":"x","action":"list"}', "application/json")
      )
    );
  });

  test("🔴 폼 인코딩 몸통도 **같은 답**이다 — 휴가와 같은 글자로 둘 다 받는다", () => {
    // 쓰기 갈래는 처음부터 JSON 이었고 이 갈래의 설계 문서도 JSON 으로 못 박았지만,
    // 휴가(dss-leave)가 둘 다 받는다. 한쪽만 받으면 **포털이 어느 모양으로 부르느냐에
    // 따라 집 하나만 401** 이 되는데, 그 답은 점검에서 「못 쟀다」로 보여 어긋남과 섞인다.
    assert.equal(
      readDelegationAction("action=list", "application/x-www-form-urlencoded"),
      "list"
    );
    // 🔵 `charset` 이 붙어 와도 같은 말이다.
    assert.equal(
      readDelegationAction("action=list", "application/x-www-form-urlencoded; charset=utf-8"),
      "list"
    );
    assert.equal(
      readDelegationAction("sub=x&action=list", "application/x-www-form-urlencoded"),
      "list"
    );
  });

  test("🔴 쓰기 갈래의 말은 읽기로 가지 않는다 — 그리고 `list` 는 쓰기 명령이 아니다", () => {
    for (const action of ["upsert", "revoke"]) {
      const 읽은값 = readDelegationAction(JSON.stringify({ action }), "application/json");
      assert.equal(읽은값, action);
      assert.ok(!isDelegationListAction(읽은값), `${action} 이 읽기 갈래로 샜다`);
    }
    // 🔴 **쓰기 모양 검사가 `list` 를 받아들이면 안 된다.** 받아들이면 쓰기 토큰으로 읽기
    //    갈래에 발을 들일 수 있고, 거절 문구도 「id 가 uuid 가 아닙니다」라는 엉뚱한 말이
    //    된다. 🔵 이 조각은 그 함수를 **한 글자도 고치지 않았다** — 그대로 거절한다.
    const 거절 = parsePortalDelegationPush({ action: DELEGATION_LIST_ACTION, id: DELEGATION_ID });
    assert.equal(거절.ok, false);
    assert.match(거절.ok ? "" : 거절.message, /upsert.*revoke/);
  });

  test("읽을 수 없는 몸통은 null 이다 — 🔵 거절은 쓰기 갈래의 일이다", () => {
    // 🔵 여기서 400 을 내면 **토큰을 보기 전에** 모양으로 답을 가르게 된다.
    for (const 몸통 of ["", "{", "[]", '"list"', "null", "action=list"]) {
      assert.equal(readDelegationAction(몸통, "application/json"), null, 몸통);
    }
    // action 칸이 글자가 아니면 모르는 것으로 본다.
    assert.equal(readDelegationAction('{"action":{"x":1}}', "application/json"), null);
    assert.equal(readDelegationAction('{"action":3}', "application/json"), null);
    // content-type 이 아예 없어도 JSON 으로 읽어 본다(포털이 안 붙이고 보내는 날).
    assert.equal(readDelegationAction('{"action":"list"}', null), "list");
    assert.ok(!isDelegationListAction(null));
  });
});

describe("몸통 짓기 — 🔴 사람이 안 실린다", () => {
  test("칸은 넷뿐이고 시각은 ISO 8601(UTC)이다", () => {
    const 답 = buildDelegationListReply([auditRow()]);
    assert.equal(답.delegations.length, 1);
    assert.deepEqual(Object.keys(답.delegations[0]).sort(), [
      "endsAt",
      "id",
      "revokedAt",
      "startsAt",
    ]);
    assert.equal(답.delegations[0].id, DELEGATION_ID);
    assert.equal(답.delegations[0].startsAt, "2027-03-01T00:00:00.000Z");
    assert.equal(답.delegations[0].endsAt, "2027-03-08T00:00:00.000Z");
    assert.equal(답.delegations[0].revokedAt, null);
    assert.equal(답.truncated, false);
  });

  test("🔴 **철회된 줄도 그대로 실린다** — 맞대어 보기의 핵심", () => {
    // 🔴 걸러 내면 「포털은 거뒀는데 집에서는 살아 있는」 줄이 양쪽에서 똑같이 안 보인다
    //    (설계 B-13 이 더 위험하다고 한 쪽).
    const 답 = buildDelegationListReply([
      auditRow({ revokedAt: new Date("2027-03-04T09:30:00.000Z") }),
    ]);
    assert.equal(답.delegations.length, 1);
    assert.equal(답.delegations[0].revokedAt, "2027-03-04T09:30:00.000Z");
  });

  test("🔴 사람 칸은 **섞어 넣어도** 몸통에 안 나간다", () => {
    // 🔵 표에 칸이 늘거나 조회가 칸을 더 고르는 날을 흉내 낸다. `...row` 로 펼치는
    //    구현이면 여기서 터진다 — 오류도 경고도 없이 새는 모양이다.
    const 사람이섞인줄 = {
      ...auditRow(),
      delegatorUserId: DELEGATOR_SUB,
      delegateUserId: DELEGATE_SUB,
      delegatorName: "홍길동",
      reason: "출장",
      syncedAt: new Date("2027-02-28T00:00:00.000Z"),
    } as unknown as PortalApprovalDelegationAuditRow;
    const 글자 = JSON.stringify(buildDelegationListReply([사람이섞인줄]));
    for (const 새는값 of [
      DELEGATOR_SUB,
      DELEGATE_SUB,
      "홍길동",
      "출장",
      "delegator",
      "delegate",
      "reason",
      "synced",
    ]) {
      assert.ok(!글자.includes(새는값), `${새는값} 가 몸통에 실렸다`);
    }
    // 🔵 표본이 비어 공짜로 통과하지 않게 — 같은 몸통에 번호는 실려 있어야 한다.
    assert.ok(글자.includes(DELEGATION_ID));
  });

  test("빈 목록도 제대로 된 답이다", () => {
    assert.deepEqual(buildDelegationListReply([]), { delegations: [], truncated: false });
  });

  test("🔴 상한을 넘치면 **말한다**(truncated) — 조용히 자르지 않는다", () => {
    const 줄 = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        auditRow({ id: `cccc3333-3333-4333-8333-${String(i).padStart(12, "0")}` })
      );
    // 🔴 딱 상한만큼은 **안 잘린 것**이다. 여기서 참이 되면 점검이 멀쩡한 날마다
    //    「잘렸을 수 있다」를 보고한다.
    const 딱맞음 = buildDelegationListReply(줄(5), 5);
    assert.equal(딱맞음.truncated, false);
    assert.equal(딱맞음.delegations.length, 5);
    // 한 줄 더 읽었으면 넘친 것이다 — 그 한 줄은 버리고 참으로 답한다.
    const 넘침 = buildDelegationListReply(줄(6), 5);
    assert.equal(넘침.truncated, true);
    assert.equal(넘침.delegations.length, 5);
    assert.ok(넘침.delegations[4].id.endsWith("000000000004"), "잘리는 쪽이 뒤가 아니다");
  });

  test("🔴 상한의 기본값이 2000 이고 **한 줄 더 읽은 것을 버린다**", () => {
    assert.equal(DELEGATION_LIST_LIMIT, 2000);
    // 조회는 `limit + 1` 로 묻는다 — 둘이 어긋나면 2001 줄이 나간다.
    const 꽉찬목록 = Array.from({ length: DELEGATION_LIST_LIMIT + 1 }, () => auditRow());
    const 답 = buildDelegationListReply(꽉찬목록);
    assert.equal(답.delegations.length, DELEGATION_LIST_LIMIT);
    assert.equal(답.truncated, true);
  });
});
