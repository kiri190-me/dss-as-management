import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 부품 요청 칸이 **어디를 보고 있는가** (2026-10-15)
 * ============================================================================
 * 이 칸은 서버 액션을 부르는 클라이언트 컴포넌트라 이 환경에서 그려 볼 수 없다(이웃
 * `save-popup-screens.test.ts` · `used-parts-section.test.ts` 와 같은 사정). 그래서 **원본
 * 글자**를 읽어 규칙이 제자리에 있는지 본다 — 규칙 자체가 지켜지는가는 순수 모듈 쪽 시험이
 * 재고(`lib/domain/inventory-stock-request-cart.test.ts` · `lib/server/inventory-gateway.test.ts`),
 * 여기서는 **그 모듈을 화면이 실제로 쓰고 있는가**만 잰다. 둘 중 하나만 있으면 시험이 비어
 * 있는 것과 같다 — 규칙은 맞는데 화면이 안 쓰거나, 화면은 부르는데 규칙이 없다.
 *
 * 붙잡는 것 넷:
 *  ㉠ **A/S 제 표를 보지 않는다** — 재고 조회·서버 액션·도메인 타입을 하나도 끌어오지 않는다.
 *  ㉡ **요청 번호를 `useRef` 에 담아 그 helper 로 꺼낸다** — 두 번 눌러도 같은 값이 나간다.
 *  ㉢ **성공한 뒤에만 번호를 비운다** — 실패하고 다시 누르는 것은 같은 요청이다.
 *  ㉣ **[요청 취소]를 거둘 수 있는 줄에만 그린다**(2026-10-16 에 통로가 열렸다) — 조건 넷은
 *     도메인 함수 한 곳(`canCancelStockRequest`)이 쥐고, 화면은 그것을 부르기만 한다.
 * ============================================================================
 */

const PATH = "src/components/inventory/PartRequestSection.tsx";
const source = readFileSync(PATH, "utf8");

describe("🔴 A/S 제 표를 보지 않는다", () => {
  test("A/S 재고 조회·옛 서버 액션·소유구분 타입을 끌어오지 않는다", () => {
    for (const forbidden of [
      "@/lib/db/queries/inventory",
      "@/lib/db/queries/inventory-part-requests",
      "@/lib/db/queries/oh-part-templates",
      "@/lib/server/actions/inventory-part-requests",
      "@/lib/domain/inventory-types",
      "@/lib/domain/inventory-part-request-cart",
    ]) {
      assert.doesNotMatch(source, new RegExp(forbidden.replace(/[/-]/g, "\\$&")), forbidden);
    }
  });

  test("올리는 곳은 재고 관리 통로를 부르는 서버 액션 하나다", () => {
    assert.match(source, /from "@\/lib\/server\/actions\/inventory-stock-requests"/);
    assert.match(source, /createInventoryStockRequestAction\(\{/);
    // 옛 액션(A/S 표에 쓰던 것)은 한 번도 불리지 않는다.
    assert.doesNotMatch(source, /createPartRequestAction|cancelPartRequestAction/);
  });

  test("소유를 고르는 칸이 없다 — 번호를 고르면 정해지는 값이다", () => {
    assert.doesNotMatch(source, /STOCK_OWNER_CODES|stockOwnerLabels|ownerScopedAvailability/);
    // 대신 유상/무상을 줄마다 고른다.
    assert.match(source, /CHARGE_TYPES\.map/);
    assert.match(source, /유상\/무상 \*/);
  });
});

describe("🔴 요청 번호는 두 번 눌러도 같은 값이 나간다", () => {
  test("`useRef` 에 담고 `getOrCreateRequestKey` 로 꺼낸다", () => {
    assert.match(source, /const requestKeyRef = useRef<string \| null>\(null\);/);
    assert.match(source, /requestKey: getOrCreateRequestKey\(requestKeyRef, generateClientUuid\)/);
    // 🔴 매번 새로 만드는 길이 남아 있으면 안 된다 — 그 한 줄이 멱등을 통째로 깬다.
    assert.doesNotMatch(source, /requestKey: generateClientUuid\(\)/);
  });

  test("🔴 번호를 비우는 자리는 **성공한 뒤** 한 곳뿐이다", () => {
    const reset = [...source.matchAll(/resetRequestKey\(requestKeyRef\)/g)];
    assert.equal(reset.length, 1, "비우는 자리가 하나가 아니다");

    // 실패해서 돌아가는 자리(`if (!result.ok) { … return; }`)보다 **뒤에** 있어야 한다.
    const failureReturn = source.indexOf("if (!result.ok) {");
    assert.ok(failureReturn >= 0, "실패를 가르는 자리가 없다");
    assert.ok(reset[0].index > failureReturn, "실패해도 번호를 비우고 있다 — 다시 누르면 요청이 두 줄 선다");
  });

  test("이미 올라가 있었으면 저절로 닫히는 팝업이 아니라 읽는 알림으로 말한다", () => {
    assert.match(source, /if \(!result\.created\)/);
    assert.match(source, /<NoticePopup/);
  });
});

describe("🔴 [요청 취소] — 거둘 수 있는 줄에만 그린다", () => {
  /** 거두는 손잡이 하나만 떼어 본다 — 올리는 쪽의 같은 모양(`if (!result.ok)`)과 섞이지 않게. */
  const cancelFn = source.slice(source.indexOf("async function handleCancelConfirm"));
  test("단추를 그릴지 **도메인 함수**가 정한다 — 화면이 조건을 다시 적지 않는다", () => {
    // 🔴 넷(내 것 · 열쇠 있음 · 대기 · 마감 아님)을 화면이 손으로 적으면 규칙이 두 벌이 되고,
    //    고치는 날 한쪽만 바뀐다. 규칙 자체는 lib/domain/inventory-gateway.test.ts 가 잰다.
    assert.match(source, /canCancelStockRequest\(request\)/);
    assert.match(source, />\s*요청 취소\s*</, "[요청 취소] 단추가 그려지지 않는다");
    // 상태 코드를 화면에서 직접 비교하고 있으면 규칙이 두 곳이 된 것이다.
    assert.doesNotMatch(source, /status\.code === "PENDING"/);
  });

  test("🔴 열쇠가 없는 줄에는 그리지 않는다 — 거둘 열쇠가 애초에 없다", () => {
    assert.match(source, /canCancelStockRequest\(request\) && request\.requestKey !== null/);
  });

  test("🔴 「담당자에게 말씀하세요」 안내를 지우지 않았다 — 못 거두는 줄이 여전히 있다", () => {
    assert.match(source, /STOCK_REQUEST_CANCEL_NOTICE/);
  });

  test("🔴 화면 조건은 **편의**일 뿐이고 막는 자리는 서버와 저쪽 통로라고 적어 두었다", () => {
    assert.match(source, /편의/);
    assert.match(source, /울타리가 아니다/);
  });

  test("되돌릴 수 없는 일이라 **한 번 더 묻는다** — 이 저장소의 확인 창 관행", () => {
    assert.match(source, /setCancelTarget\(\{/, "확인 창을 거치지 않고 바로 거두고 있다");
    assert.match(source, /showModal\(\)/);
    assert.match(source, /되돌릴 수 없습니다/);
    // 🔴 브라우저 기본 창은 쓰지 않는다(common/NoticePopup.tsx 머리말).
    // 🔵 **부르는 자리**만 잰다 — 머리말에 「window.confirm 을 쓰지 않는다」라고 적어 두었다.
    assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\(/);
  });

  test("확인 창에서 누른 뒤에야 서버 액션을 부른다", () => {
    assert.match(source, /cancelInventoryStockRequestAction\(\{/);
    // 🔴 화면이 신청자를 적어 보내지 않는다 — 포털 번호는 서버가 세션에서 꺼낸다.
    assert.doesNotMatch(source, /requesterSub|requester:\s*\{/);
  });

  test("🔴 실패하면 저쪽 문구를 **그대로** 보이고 거둬진 것처럼 보이지 않는다", () => {
    const failure = cancelFn.indexOf("if (!result.ok) {");
    assert.ok(failure >= 0, "거두기 실패를 가르는 자리가 없다");
    // 실패 갈래 안(= 돌아가기 전)에서 목록을 새로 읽거나 성공 팝업을 띄우면 거둬진 것처럼 보인다.
    const branch = cancelFn.slice(failure, cancelFn.indexOf("return;", failure));
    assert.match(branch, /setCancelError\(result\.message\)/, "거절 문구를 그대로 들지 않는다");
    assert.doesNotMatch(branch, /router\.refresh|showSavePopup|setCancelTarget\(null\)/);
    assert.match(source, /\{errorMessage\}/, "거절 문구를 그릴 자리가 없다");
  });

  test("성공하면 목록을 다시 읽는다 — 상태가 「취소」로 바뀐 것이 보여야 한다", () => {
    const failure = cancelFn.indexOf("if (!result.ok) {");
    const refresh = cancelFn.indexOf("router.refresh()");
    assert.ok(refresh > failure && failure >= 0, "실패를 가른 **뒤에** 목록을 다시 읽어야 한다");
  });

  test("🔵 이미 거둬져 있던 것은 오류가 아니라 **읽는 알림**으로 말한다", () => {
    assert.match(source, /if \(!result\.cancelled\)/);
    assert.match(source, /이미 거둬져 있었습니다/);
  });
});

describe("🔴 못 받아 온 것을 「없다」로 그리지 않는다", () => {
  test("세 가지 재료 전부 `status !== \"ok\"` 를 따로 그린다", () => {
    for (const guard of [
      /parts\.status !== "ok"/,
      /ohTemplate\.status !== "ok"/,
      /requests\.status !== "ok"/,
    ]) {
      assert.match(source, guard, String(guard));
    }
    // 못 받아 왔을 때는 까닭을 사람 말로 적는다.
    assert.match(source, /inventoryUnreachableMessage\(parts\.reason\)/);
    assert.match(source, /inventoryUnreachableMessage\(requests\.reason\)/);
  });

  test("「없다」는 말은 ok 일 때만 한다", () => {
    assert.match(source, /requests\.value\.length === 0 \? \(\s*<p[\s\S]{0,200}반출 신청이 없습니다/);
  });

  test("부품 목록을 못 받아 왔으면 올리기를 잠근다 — 고를 수 없는데 올릴 수는 없다", () => {
    assert.match(source, /const canSubmit = parts\.status === "ok" && requesterGate\.ok;/);
    assert.match(source, /disabled=\{isSubmitting \|\| cart\.length === 0 \|\| !canSubmit\}/);
  });
});

describe("O/H 한 번에 담기 — 안 이어진 줄의 말을 그대로 살린다", () => {
  test("「재고에 없어 담지 못함」을 이름과 함께 알린다", () => {
    assert.match(source, /재고에 없어 담지 못함\(직접 찾아 담아 주세요\): \$\{skippedNoPart\.join\(", "\)\}/);
    assert.match(source, /이미 담겨 있음/);
  });

  test("🔴 `linked` 가 거짓인 줄은 담기지 않는다", () => {
    assert.match(source, /item\.linked && item\.no !== null/);
  });
});
