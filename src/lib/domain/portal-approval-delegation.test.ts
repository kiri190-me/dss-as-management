import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_PORTAL_DELEGATIONS,
  notePortalDelegationOutage,
  type PortalRouteDelegations,
} from "./portal-approval-delegation";

/**
 * ============================================================================
 * 「포털에 못 물었다」가 결과에 실려 나가는가 — 순수 규칙
 * ============================================================================
 * 설계 B-6 으로 **포털에 못 물으면 「위임 없음」으로 보고 결재를 그대로 진행**하기로
 * 했다. 그 대가는 「대리인만 조용히 막힌다」이고, B-7 이 **눈에 보이는 안내**로 그
 * 대가를 갚기로 했다. 안내를 띄우려면 그 사실이 **값으로** 화면까지 가야 한다.
 *
 * 🔴 여기서 못 박는 것 셋. 전부 **틀려도 그 자리에서는 아무 오류가 안 난다.**
 *  1. 못 물었을 때 깃발이 **선다**.
 *  2. 멀쩡할 때는 **안 선다**(`false` 조차 싣지 않는다). 매번 실리면 아무 상관없는
 *     결재 화면마다 경고가 깔리고, 그러면 사람이 그 경고를 읽지 않게 된다.
 *  3. **원래 칸을 하나도 잃지 않는다.** `ok`·`code`·`message` 가 사라지면 화면은
 *     「알 수 없는 오류」만 보여 주고, 깃발 하나 때문에 본문을 잃는 꼴이 된다.
 * ============================================================================
 */

const 못물었다: PortalRouteDelegations = { delegatorUserIds: [], unavailable: true };
const 물었다: PortalRouteDelegations = {
  delegatorUserIds: ["11111111-1111-4111-8111-111111111111"],
  unavailable: false,
};

/**
 * 결재 결과를 흉내 낸 값의 타입. 🔴 **깃발 칸을 선언에 적어 둬야** 한다 — 실제
 * 결과 타입 셋이 전부 그렇게 생겼고(그래야 화면이 그 칸을 읽을 수 있다), 안 적으면
 * 이 시험이 실제와 다른 모양을 재게 된다.
 */
type 결재결과<T> = T & { portalDelegationUnavailable?: true };

test("🔴 못 물었으면 깃발이 선다 — 거절한 결과에서", () => {
  const 거절: 결재결과<{ ok: false; code: "FORBIDDEN"; message: string }> = {
    ok: false,
    code: "FORBIDDEN",
    message: "지정된 승인자만…",
  };
  // 🔵 먼저 원래 값에 깃발이 **없음**을 못 박는다 — 안 하면 「원래부터 있었다」와
  //    구별되지 않아 이 시험이 아무것도 지키지 못한다.
  assert.ok(!("portalDelegationUnavailable" in 거절));
  assert.deepEqual(notePortalDelegationOutage(거절, 못물었다), {
    ok: false,
    code: "FORBIDDEN",
    message: "지정된 승인자만…",
    portalDelegationUnavailable: true,
  });
});

test("🔴 못 물었으면 **성공한 결과에도** 선다 — 가지를 두지 않는다", () => {
  const 성공: 결재결과<{ ok: true; id: string; nextApprovalId: string | null }> = {
    ok: true,
    id: "a",
    nextApprovalId: null,
  };
  assert.deepEqual(notePortalDelegationOutage(성공, 못물었다), {
    ok: true,
    id: "a",
    nextApprovalId: null,
    portalDelegationUnavailable: true,
  });
});

test("🔴 포털이 멀쩡하면 깃발을 **아예 싣지 않는다** — `false` 도 안 싣는다", () => {
  const 성공: 결재결과<{ ok: true; id: string }> = { ok: true, id: "a" };
  const 결과 = notePortalDelegationOutage(성공, 물었다);
  assert.deepEqual(결과, { ok: true, id: "a" });
  assert.ok(!("portalDelegationUnavailable" in 결과), "🔴 멀쩡한데 깃발이 실렸다");
  // 🔵 새 객체를 만들지도 않는다 — 평소에는 아무 비용도 없다.
  assert.equal(결과, 성공);
});

test("🔴 「묻지 않았다」는 장애가 아니다 — NO_PORTAL_DELEGATIONS 는 깃발을 세우지 않는다", () => {
  assert.equal(NO_PORTAL_DELEGATIONS.unavailable, false);
  assert.deepEqual(NO_PORTAL_DELEGATIONS.delegatorUserIds, []);
  const 성공: 결재결과<{ ok: true; id: string }> = { ok: true, id: "a" };
  const 결과 = notePortalDelegationOutage(성공, NO_PORTAL_DELEGATIONS);
  assert.ok(!("portalDelegationUnavailable" in 결과));
});

test("🔴 빈 목록과 「못 물었다」가 **다른 값**이다 — 뭉개면 안내할 자리에서 구별할 길이 없다", () => {
  const 물었는데없다: PortalRouteDelegations = { delegatorUserIds: [], unavailable: false };
  assert.deepEqual(물었는데없다.delegatorUserIds, 못물었다.delegatorUserIds);
  assert.notEqual(물었는데없다.unavailable, 못물었다.unavailable);
});
