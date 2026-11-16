import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendPortalDelegationOutage,
  NO_PORTAL_DELEGATIONS,
  notePortalDelegationOutage,
  PORTAL_DELEGATION_UNAVAILABLE_HEADLINE,
  PORTAL_DELEGATION_UNAVAILABLE_NOTICE,
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

/* ────────────────────────── 설계 B-7 — 사람에게 하는 말 (2026-11-16, 조각 3b) */

/**
 * 🔴 **이 묶음이 재는 것은 「깃발을 읽는 자리가 있는가」다.** 조각 3a 가 결과에 실어
 * 둔 `portalDelegationUnavailable` 은 **아무도 안 읽으면 죽은 값**이고, 죽은 값은
 * 깨져도 아무 시험이 안 깨진다.
 */

test("🔴 「없다」와 「확인할 수 없다」를 가른다 — 안내 글이 「위임이 없습니다」면 안 된다", () => {
  // 🔵 무엇을 재는지 먼저 못 박는다 — 글자가 비면 아래 「안 들어 있다」가 공짜로 통과한다.
  assert.ok(PORTAL_DELEGATION_UNAVAILABLE_HEADLINE.length > 5, "머리말이 비었다");
  assert.ok(PORTAL_DELEGATION_UNAVAILABLE_NOTICE.length > 40, "안내문이 비었다");

  // 🔴 「없습니다」로 읽히면 맡긴 사람은 맡겨 뒀다고 믿고, 대리인은 왜 못 누르는지 모른다.
  for (const 금지 of ["위임이 없습니다", "위임이 없습니다.", "맡긴 결재권이 없습니다"]) {
    assert.ok(
      !PORTAL_DELEGATION_UNAVAILABLE_HEADLINE.includes(금지),
      `머리말이 「${금지}」로 말한다 — 「없다」가 아니라 「지금 못 읽었다」다`
    );
    assert.ok(!PORTAL_DELEGATION_UNAVAILABLE_NOTICE.includes(금지), `안내문이 「${금지}」로 말한다`);
  }
  // 🔵 통합 승인함이 같은 상황에서 쓰는 두 마디. 두 화면이 다른 낱말로 말하면 오가는
  //    사람은 다른 종류의 고장으로 읽는다(dss-approvals 의 delegationTroubles).
  assert.ok(PORTAL_DELEGATION_UNAVAILABLE_NOTICE.includes("위임이 없는 것이 아니라"));
  assert.ok(PORTAL_DELEGATION_UNAVAILABLE_NOTICE.includes("지금 읽지 못한 것"));
  // 🔴 주석 문체가 화면으로 새지 않는다 — 별표는 이 저장소의 **주석** 표시다.
  assert.ok(!PORTAL_DELEGATION_UNAVAILABLE_NOTICE.includes("*"), "화면 글자에 별표가 들어갔다");
});

test("🔴 깃발이 실린 결과에만 말이 붙는다 — 멀쩡하면 서버가 준 글자 그대로다", () => {
  // 🔴 깃발 칸을 **선언에 적어 둔다** — 실제 결재 결과 셋이 전부 그렇게 생겼고(선택
  //    칸이다), 안 적으면 「깃발이 없는 값」이 애초에 못 들어가 시험이 실제와 다른
  //    모양을 재게 된다.
  const 거절: 결재결과<{ ok: false; code: string; message: string }> = {
    ok: false,
    code: "FORBIDDEN",
    message: "지정된 승인자만 처리할 수 있습니다.",
  };
  // 멀쩡할 때: 한 글자도 안 바뀐다(같은 문자열이어야 한다).
  assert.equal(appendPortalDelegationOutage(거절.message, 거절), 거절.message);

  const 못물은거절 = { ...거절, portalDelegationUnavailable: true as const };
  const 이어붙인말 = appendPortalDelegationOutage(못물은거절.message, 못물은거절);
  // 🔴 서버가 준 말을 **삼키지 않는다** — 사람이 읽고 움직여야 할 말이 그대로 있어야 한다.
  assert.ok(이어붙인말.startsWith(거절.message), "서버가 돌려준 거절 이유가 사라졌다");
  assert.ok(이어붙인말.includes(PORTAL_DELEGATION_UNAVAILABLE_NOTICE), "안내가 안 붙었다");
  // 🔵 한 줄이다 — 받는 자리들이 <p> 하나에 글자로 그려서 줄바꿈은 어차피 접힌다.
  assert.ok(!이어붙인말.includes("\n"), "줄바꿈을 넣었다 — 화면에서는 공백 한 칸으로 접힌다");
});

test("🔴 성공한 결과에도 깃발이 있으면 같은 말을 붙일 수 있다 — 가지를 두지 않는다", () => {
  // 3a 가 성공·실패를 가리지 않고 싣는 까닭이 그것이다(그쪽 머리말). 읽는 쪽에서
  // 조건을 한 벌 더 적으면, 두 벌이 갈리는 날 안내가 조용히 사라진다.
  const 성공: 결재결과<{ ok: true; id: string }> = {
    ok: true,
    id: "a",
    portalDelegationUnavailable: true,
  };
  assert.ok(appendPortalDelegationOutage("처리했습니다.", 성공).includes("잠시 뒤 새로고침"));
});

test("🔴 3a 가 실어 보낸 깃발을 그대로 받아 읽는다 — 두 함수가 같은 칸을 쓴다", () => {
  // 🔴 이름이 갈리면 「싣기는 하는데 아무도 안 읽는」 가장 조용한 결함이 된다.
  //    값으로 이어 본다: 얹는 함수의 출력이 읽는 함수의 입력이다.
  const 거절: 결재결과<{ ok: false; code: string; message: string }> = {
    ok: false,
    code: "FORBIDDEN",
    message: "지정된 승인자만 처리할 수 있습니다.",
  };
  const 얹은결과 = notePortalDelegationOutage(거절, 못물었다);
  assert.equal(얹은결과.portalDelegationUnavailable, true);
  assert.ok(
    appendPortalDelegationOutage(얹은결과.message, 얹은결과).includes(
      PORTAL_DELEGATION_UNAVAILABLE_NOTICE
    ),
    "🔴 얹은 깃발을 읽는 쪽이 못 본다 — 칸 이름이 갈렸다"
  );
});
