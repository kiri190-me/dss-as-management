import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import PortalDelegationUnavailableNotice from "./PortalDelegationUnavailableNotice";
import {
  PORTAL_DELEGATION_UNAVAILABLE_HEADLINE,
  PORTAL_DELEGATION_UNAVAILABLE_NOTICE,
} from "@/lib/domain/portal-approval-delegation";

/**
 * ============================================================================
 * 🔴 **설계 B-7 의 안내가 정말 그려지는가** (2026-11-16, 조각 3b)
 * ============================================================================
 * 포털에 못 물으면 A/S 는 「위임 없음」으로 보고 결재를 그대로 진행한다(B-6). 그 대가가
 * **「대리인만 조용히 막힌다」**이고, 이 상자가 그 대가를 갚는 **유일한** 자리다.
 *
 * 🔴 **진짜로 그려서 잰다.** 프롭을 받기만 하고 아무것도 안 그리는 조각은 원본 글자로
 * 읽는 시험에서 초록으로 통과한다 — 이 저장소에서 겪은 모양이다.
 *
 * 🔵 어디서 그리는가(결재 화면 셋)는 server/portal-delegation-read-wiring.test.ts 가,
 * 글자가 「없다」로 말하지 않는가는 domain/portal-approval-delegation.test.ts 가 잰다.
 * ============================================================================
 */

describe("포털 위임 확인 실패 안내", () => {
  test("🔴 못 물었으면 머리말과 안내문이 **글자 그대로** 나온다", () => {
    const html = renderToStaticMarkup(<PortalDelegationUnavailableNotice unavailable />);
    // 🔵 무엇을 재는지 먼저 — 빈 결과에 `includes` 를 걸면 공짜로 실패하지도 통과하지도
    //    않지만, 아래 두 줄이 **무엇을 찾는지**를 여기서 못 박아 둔다.
    assert.ok(html.length > 50, "아무것도 안 그려졌다");
    assert.ok(html.includes(PORTAL_DELEGATION_UNAVAILABLE_HEADLINE), "머리말이 없다");
    assert.ok(html.includes(PORTAL_DELEGATION_UNAVAILABLE_NOTICE), "안내문이 없다");
  });

  test("🔴 포털이 멀쩡하면 **아무것도 안 그린다** — 상시 경고는 아무도 안 읽는다", () => {
    assert.equal(renderToStaticMarkup(<PortalDelegationUnavailableNotice unavailable={false} />), "");
  });

  test("🔴 글자를 조각이 짓지 않는다 — 눌렀다 거절당한 자리와 **같은 상수**를 쓴다", () => {
    // 두 벌로 적으면 한쪽만 고쳐지는 날이 온다(안내 상자와 거절 메시지가 다른 말을 한다).
    const html = renderToStaticMarkup(<PortalDelegationUnavailableNotice unavailable />);
    // 🔴 상수를 빈 글자로 바꿔치기해도 통과하지 않게, 상수 자신이 비지 않은 것을 본다.
    assert.ok(PORTAL_DELEGATION_UNAVAILABLE_NOTICE.length > 40);
    assert.ok(html.includes("잠시 뒤 새로고침"), "사람이 할 다음 행동이 안 적혀 있다");
  });

  test("읽어 주기 — 상태 알림으로 표시된다", () => {
    const html = renderToStaticMarkup(<PortalDelegationUnavailableNotice unavailable />);
    assert.ok(html.includes('role="status"'), "화면 읽기 장치가 이 상자를 못 읽는다");
  });
});
