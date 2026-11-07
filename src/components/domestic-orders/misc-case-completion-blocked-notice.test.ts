import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 기타건이 **승인 때문에 완료되지 않았을 때** 사람이 알게 하는가 (2026-11-07)
 * ============================================================================
 * 막는 일은 서버가 한다(db/mutations/domestic-orders.ts 의 관문, 사용자 결정 —
 * 「기타건의 경우도 [기타건 최종 출하 승인]이 되야 [완료]처리를 할 수 있도록」).
 * 화면이 할 일은 둘뿐이다:
 *  1. 서버가 `APPROVAL_REQUIRED` 를 돌려줬을 때 **읽고 닫아야 하는 알림**으로 띄운다.
 *     줄 위 빨간 글씨 한 줄은 놓치기 쉽고, 저장 팝업은 0.5초 뒤 저절로 닫혀 경고를
 *     전할 수 없다(components/common/NoticePopup.tsx 머리말).
 *  2. 🔴 그 알림이 **수리 건 이야기를 하지 않는다.** 기타건에는 수리 건이 아예 없다 —
 *     옆에 있는 SHIPMENT_COMPLETION_BLOCKED 상자의 글을 그대로 쓰면
 *     「수리 건 쪽을 먼저 처리하세요」라는 거짓말이 뜬다. 두 길을 가른 까닭이 그것이다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 목록 화면은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬 끝의
 * `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는 import
 * 자체가 던진다(이웃 시험들과 같은 방법이다 —
 * requested-due-date-link-notice.test.ts).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const listScreen = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");
const flatScreen = flat(listScreen);

describe("기타건 완료가 승인에 막혔을 때", () => {
  test("🔴 `APPROVAL_REQUIRED` 를 읽어 알림으로 올려 보낸다 — 그리고 거기서 끝낸다", () => {
    assert.match(
      flatScreen,
      /if \(result\.code === "APPROVAL_REQUIRED"\) \{ onApprovalBlocked\(result\.message\); return; \}/,
      "승인에 막혔다는 답을 읽는 길이 없다"
    );
  });

  test("🔵 못 — **두 길이 함께** 있다. 하나로 합치면 한쪽이 거짓말을 한다", () => {
    // 수리 건이 막은 경우(2026-10-18)와 기타건 승인이 막은 경우(2026-11-07)는
    // 사람이 다음에 할 일이 다르다. 둘 다 있는지를 먼저 못 박아야, 아래 「수리 건
    // 이야기를 하지 않는다」가 **합쳐 버린 화면에서도 통과하는** 일이 없다.
    assert.match(
      flatScreen,
      /if \(result\.code === "SHIPMENT_COMPLETION_BLOCKED"\) \{ onBlocked\(result\.message\); return; \}/
    );
    assert.notEqual(
      flatScreen.indexOf("onApprovalBlocked(result.message)"),
      flatScreen.indexOf("onBlocked(result.message)")
    );
  });

  test("🔴 저장 팝업보다 **앞**에서 돌아간다 — 두 상자가 함께 뜨지 않는다", () => {
    assert.ok(
      flatScreen.indexOf("onApprovalBlocked(result.message)") <
        flatScreen.indexOf("showSavePopup({ message: result.repairCaseShipmentCompleted"),
      "알림이 저장 팝업보다 뒤에 있다 — 막혔는데 「완료로 표시했습니다」가 함께 뜬다"
    );
  });

  test("🔴 표와 카드 **둘 다** 그 통로를 넘겨받는다 — 좁은 화면에서만 조용히 넘어가지 않게", () => {
    const passed = flatScreen.match(/onApprovalBlocked=\{setApprovalBlockedReason\}/g) ?? [];
    assert.equal(passed.length, 2, "완료 단추가 그려지는 자리는 표와 카드 둘이다");
    // 🔵 못 — 옆의 통로도 똑같이 둘이다. 숫자 2가 우연이 아님을 함께 적어 둔다.
    const siblings = flatScreen.match(/onBlocked=\{setShipmentBlockedReason\}/g) ?? [];
    assert.equal(siblings.length, 2);
  });

  test("🔴 알림은 **표 칸 밖**에서 그려진다 — 칸의 CSS 를 물려받으면 글이 쏠린다", () => {
    // 상태를 목록 화면이 가지고, 상자도 거기서 그린다(완료 처리가 막혔을 때와 같은 길).
    assert.match(
      flatScreen,
      /const \[approvalBlockedReason, setApprovalBlockedReason\] = useState<string \| null>\(null\);/
    );
    assert.match(
      flatScreen,
      /\{approvalBlockedReason !== null && \( <NoticePopup title="완료 처리를 하지 못했습니다"/
    );
  });

  test("🔴 그 상자는 **수리 건 이야기를 하지 않는다** — 기타건에는 수리 건이 없다", () => {
    const box = flatScreen.slice(
      flatScreen.indexOf("{approvalBlockedReason !== null &&"),
      flatScreen.indexOf("onClose={() => setApprovalBlockedReason(null)}")
    );
    assert.ok(box.length > 0, "상자를 못 찾았다 — 아래 단언이 빈 글자를 재고 있었다");
    assert.ok(!box.includes("수리 건"), `기타건 알림이 수리 건을 말하고 있다: ${box}`);
    // 그리고 **아무것도 저장되지 않았다**를 함께 전한다 — 서버가 준 까닭만 띄우면
    // 사람은 「승인은 없지만 완료는 됐나」로 읽는다.
    assert.ok(box.includes("그래서 내자 정리의 완료 처리도 되지 않았습니다."), box);
  });
});
