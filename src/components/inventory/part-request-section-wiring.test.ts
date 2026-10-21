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

/**
 * ============================================================================
 * 🔴 결정 사유에도 **제목이 붙는다** (2026-10-21)
 * ============================================================================
 * 보류 사유 상자에는 「보류 사유」라는 제목이 있는데 결정 사유 상자에는 없어서, 사람이
 * **상태 배지를 보고 유추**해야 했다. 재고 관리가 같은 자리를 먼저 셋으로 갈랐고
 * (저쪽 `lib/stock/codes.ts` 의 `requestDecisionNote`), **같은 규칙**으로 맞춘다.
 *
 * 🔵 셋으로 가르는 규칙 자체(① 마감 ② 반려 ③ 그 밖)는 순수 쪽 시험이 잰다
 *    (`lib/domain/inventory-gateway.test.ts`). 여기서는 **화면이 그것을 쓰는가**만 본다 —
 *    규칙은 맞는데 화면이 제 손으로 다시 적으면 두 벌이 되고, 고치는 날 한쪽만 바뀐다.
 * ============================================================================
 */
describe("🔴 결정 사유 상자에 제목이 붙는다", () => {
  test("머리글을 **도메인 함수**가 정한다 — 화면이 상태를 다시 가르지 않는다", () => {
    assert.match(source, /stockRequestDecisionLabel\(request\)/, "머리글을 부르지 않는다");
    // 🔴 글자를 화면에 박아 두면 재고 관리가 말을 바꾸는 날 이 줄만 옛말을 한다.
    assert.doesNotMatch(source, /마감 사유|반려 사유|결정 사유/, "머리글 글자가 화면에 박혀 있다");
    // 🔴 가르는 조건을 화면이 다시 적으면 차례(마감 → 반려)가 두 곳이 된다.
    assert.doesNotMatch(source, /status\.code === "REJECTED"/, "화면이 상태 코드를 직접 견준다");
  });

  test("🔵 사유가 있을 때만 제목을 단다 — 글 없는 「반려 사유」는 못 받아 온 것처럼 읽힌다", () => {
    assert.match(
      source,
      /\{request\.decision\.note && \(\s*<p[^>]*>\s*\{stockRequestDecisionLabel\(request\)\}/,
      "사유 없이도 제목이 선다"
    );
  });

  test("🔴 보류 사유의 제목을 지우지 않았다 — 짝이 되는 자리다", () => {
    assert.match(source, />보류 사유</);
  });
});

/**
 * ============================================================================
 * 🔴 저쪽이 준 상태 글자에 **아무것도 덧붙이지 않는다** (2026-10-21)
 * ============================================================================
 * 재고 관리는 마감된 신청의 `label` 자체를 「마감」으로 바꿔 보낸다(상태 코드는 `CONFIRMED`
 * 그대로 — 마감은 상태값이 아니라 `closed` 칸이다). 그런데 이 화면은 그것을 모르고 `closed`
 * 를 보고 제 꼬리를 하나 더 붙이고 있었고, 그래서 마감된 신청이 **「마감 (마감)」**으로 떴다.
 *
 * 🔴 **어느 쪽도 혼자서는 틀린 데가 없었다.** 저쪽은 제 화면에서 「마감」 한 번, 이쪽은 제
 *    규칙대로 꼬리 한 번. 두 저장소를 맞대어 보고서야 드러났고, 시험도 눈도 반년을 지나쳤다 —
 *    **그 겹침을 재는 자리가 아무 데도 없었기 때문**이다. 여기가 그 자리다.
 * 🔵 「마감」이 **정말로 label 에 들어 있는가**는 화면이 알 수 없다 — 그것은 살아 있는 저쪽
 *    서버에 물어야 하고, `scripts/check-inventory-contract.ts` 가 마감된 신청을 볼 때마다 잰다.
 * ============================================================================
 */
describe("🔴 상태 글자에 화면이 덧붙이지 않는다", () => {
  test("상태 배지는 **저쪽 글자 하나뿐**이다 — 뒤에 아무것도 안 붙는다", () => {
    assert.match(
      source,
      /\{request\.status\.label \|\| request\.status\.code\}\s*<\/span>/,
      "상태 글자 뒤에 화면이 무언가를 덧붙이고 있다 — 「마감 (마감)」이 그렇게 생겼다"
    );
  });

  test("🔴 `closed` 로 **글자를 그리는** 자리가 다시 생기지 않았다", () => {
    // 🔵 좁게 막는다 — `closed` **자체**를 쓰지 말라는 것이 아니다(사유 머리글과 취소 단추가
    //    그 칸으로 갈린다). 막는 것은 **그 칸을 보고 화면이 제 말을 덧그리는** 그 모양뿐이다.
    assert.doesNotMatch(source, /request\.closed &&\s*</, "closed 를 보고 화면이 제 글자를 그린다");
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

/**
 * ============================================================================
 * 🔴 부품 줄에 **그 부품의 모든 것**이 보인다 (2026-10-16 요청 B·C)
 * ============================================================================
 * 「부품 요청에 뜨는 정보가 그 부품의 모든 것이면 좋겠다」 + 「검색할 때 찾아지는 목록의
 * 내용에도 고객사 품명을 더해 달라」. 규칙 자체(무엇을 · 어떤 이름표로 · `-` 는 값이 아니다)는
 * 순수 쪽이 재고(`lib/domain/inventory-gateway.test.ts`), 여기서는 **화면이 그것을 실제로
 * 쓰는가**를 본다 — 규칙은 맞는데 화면이 안 부르면 시험이 비어 있는 것과 같다.
 * ============================================================================
 */
describe("🔴 부품 줄에 그 부품의 모든 것 — 찾은 줄과 담은 줄 둘 다", () => {
  test("다섯 가지가 그려질 길이 다 있다 — 품명 · 품명2 · 고객사 품명 · 교산 품번 · 도번", () => {
    assert.match(source, /inventoryPartSpec/, "품명2를 그리지 않는다");
    assert.match(source, /renderCustomerNameLine/, "고객사 품명 줄이 없다");
    assert.match(source, /inventoryPartIdLabels/, "교산 품번 · 도번을 그리지 않는다");
  });

  test("🔴 **값이 있는 것만** 그린다 — 자를 화면이 다시 적지 않고 도메인 것을 쓴다", () => {
    // 🔴 `-` 가 값으로 세어지면 「교산 품번 -」 같은 줄이 깔리고 정작 있는 값이 묻힌다.
    //    화면이 `part.name2` · `part.customerName` 을 **날것으로** 그리면 그 자가 새 버린다.
    assert.doesNotMatch(source, /\{part\.name2\}/, "품명2를 날것으로 그린다");
    assert.doesNotMatch(source, /\{part\.customerName\}/, "고객사 품명을 날것으로 그린다");
    assert.doesNotMatch(source, /\{part\.kyosanPartNo\}|\{part\.drawingNo\}/, "품번·도번을 날것으로 그린다");
  });

  test("🔵 담은 줄은 **번호로 되짚어** 그린다 — 베껴 담으면 채운 뒤에도 옛 값이 남는다", () => {
    assert.match(source, /const partByNo = new Map\(partList\.map\(\(part\) => \[part\.no, part\]\)\);/);
    assert.match(source, /const part = partByNo\.get\(line\.no\);/);
    // 🔴 못 되짚은 줄에 이름을 지어내지 않는다 — 담을 때 적어 둔 이름만 그린다.
    assert.match(source, /\{part && renderCustomerNameLine\(part, \{ canFill: false \}\)\}/);
  });

  test("🔴 찾는 칸의 안내가 다섯 가지를 그대로 적는다 — 쳐서 찾아지는 것과 같아야 한다", () => {
    assert.match(source, /품명 \/ 품명2 \/ 고객사 품명 \/ 교산 품번 \/ 도번/);
    // 거르는 자는 도메인 하나다(저쪽 `q` 와 같은 잣대).
    assert.match(source, /filterInventoryParts\(partList, search\)/);
  });

  test("🔴 차례를 화면이 따로 적지 않는다 — 이름표는 정해 둔 한 곳에서 온다(요청 ③)", () => {
    // 🔴 「고객사 품명」을 화면에서 다시 쳐 두면 그 말이 바뀌는 날 이 줄만 옛말을 한다.
    //    차례 자체가 지켜지는지는 quotes/quote-part-pick.test.ts 가 다섯 자리를 함께 잰다.
    assert.match(source, /PART_FIELD_LABELS\.customerPartName/, "이름표를 손으로 적고 있다");
    assert.doesNotMatch(source, /"고객사 품명 · "|>고객사 품명 ·/, "이름표가 화면에 박혀 있다");
  });
});

/**
 * ============================================================================
 * 🔴 담은 줄에도 **현재 재고** (2026-10-16 요청 ④)
 * ============================================================================
 * 「부품 요청에서 부품을 골랐을 때도 현재 재고가 표시되게.」 찾은 줄에만 있던 수를 담은
 * 줄에도 적는다 — 수량을 치는 자리가 그쪽이라, 거기서 안 보이면 위로 눈을 올려야 한다.
 *
 * 🔴 **그 수는 「지금 이 순간」이 아니다.** 화면을 열 때 한 번 받아 온 값이고, 그 뒤로 다른
 *    사람이 가져갔을 수 있다. 숫자만 적으면 「지금 3개 있다」로 읽혀 그 수를 믿고 요청
 *    수량을 정한다 — 그래서 **숫자 바로 옆**에 언제 잰 값인지 적는다. 그 글자는 도메인 쪽
 *    한 곳(`inventoryStockText`)에 있고 **찾은 줄과 담은 줄이 같은 것을 쓴다**.
 * 🔵 값을 장바구니에 베껴 담지 않는다 — 번호로 되짚어 **지금 들고 있는 부품**에서 꺼낸다.
 * ============================================================================
 */
describe("🔴 담은 줄에도 현재 재고 — 그 수가 「지금」이 아니라는 것까지", () => {
  test("담은 줄에 재고가 보인다 — 수량을 치는 자리가 거기다", () => {
    const cart = source.slice(source.indexOf("{cart.map((line) => {"), source.indexOf("</table>"));
    assert.match(cart, /inventoryStockText\(part\)/, "담은 줄에 재고가 없다");
  });

  test("🔴 찾은 줄과 담은 줄이 **같은 글자**를 쓴다 — 한쪽만 꼬리말이 붙으면 다른 값으로 읽힌다", () => {
    assert.equal(
      [...source.matchAll(/inventoryStockText\(part\)/g)].length,
      2,
      "재고를 적는 자리가 둘이 아니다 — 한쪽이 제 글자를 따로 쓰고 있다"
    );
    // 🔴 수를 날것으로 적는 길이 남아 있으면 그 줄에는 「언제 잰 값인지」가 빠진다.
    assert.doesNotMatch(source, /재고 \{part\.quantity\}/, "재고를 날것으로 그린다");
    assert.doesNotMatch(source, /line\.quantity.*재고|재고.*line\.quantity/, "요청 수량을 재고로 적고 있다");
  });

  test("🔵 담은 줄의 재고는 **번호로 되짚은** 부품에서 온다 — 베껴 담지 않는다", () => {
    // 베끼면 다시 읽은 뒤에도 담은 줄만 옛 수를 보인다.
    assert.doesNotMatch(source, /quantity: part\.quantity/, "장바구니에 재고를 베껴 담는다");
    const cart = source.slice(source.indexOf("{cart.map((line) => {"), source.indexOf("</table>"));
    const lookup = cart.indexOf("partByNo.get(line.no)");
    const stock = cart.indexOf("inventoryStockText(part)");
    assert.ok(lookup >= 0 && stock > lookup, "되짚기 전에 재고를 그린다");
  });
});

/**
 * ============================================================================
 * 🔴 고객사 품명을 **그 자리에서 채운다** (2026-10-16 요청 E)
 * ============================================================================
 * 견적서에서 「고객사 품명을 설정해 주세요」로 막힌 사람이 **여기서 채우고 돌아가면 고를 수
 * 있게** 되는, A 와 한 쌍인 기능이다. 붙잡는 것 다섯:
 *  ㉠ **빈 칸에만** 길이 선다 — 이 통로는 채우기만 하고 덮어쓰지 않는다.
 *  ㉡ **되돌릴 수 없는 일이라 창에서 한 번 더** 누른다(이 저장소의 확인 창 관행).
 *  ㉢ 🔴 **거절은 저쪽 문구 그대로, 창을 닫지 않고** — 닫히면 채워진 줄 안다.
 *  ㉣ 🔴 **「이미 있습니다」는 거절과 다른 말**이다 — 읽는 알림으로 간다(오류가 아니다).
 *  ㉤ 🔴 **성공하면 그 자리에서 값이 보인다** — 저쪽이 돌려준 지금 값으로.
 * ============================================================================
 */
describe("🔴 고객사 품명 채우기 — 그 자리에서", () => {
  const fillFn = source.slice(source.indexOf("async function handleFillConfirm"));

  test("㉠ 비어 있을 때만 길이 선다 — 값이 있으면 그 값만 보인다", () => {
    assert.match(source, /if \(customerName !== ""\) \{\s*return \(/);
    assert.match(source, /고객사 품명 채우기\s*<\/button>/, "[고객사 품명 채우기] 단추가 없다");
    // 🔴 「없음」으로 끝내지 않는다 — 견적서에서 막히는 까닭이 이 칸이다.
    assert.match(source, /CUSTOMER_NAME_EMPTY_NOTICE/);
  });

  test("㉠ 🔵 담은 줄에는 단추를 두지 않는다 — 수량·유상무상을 고르는 표다", () => {
    assert.match(source, /canFill: requesterGate\.ok/, "찾은 줄에 단추가 안 선다");
    assert.match(source, /canFill: false/, "담은 줄에 단추가 섰다");
  });

  test("㉡ 창에서 한 번 더 누른 뒤에야 서버 액션을 부른다", () => {
    assert.match(source, /setFillTarget\(part\)/, "창을 거치지 않고 바로 채우고 있다");
    assert.match(source, /<FillCustomerNameDialog/);
    assert.match(source, /fillInventoryPartCustomerNameAction\(\{/);
    // 🔴 화면이 채운 사람을 적어 보내지 않는다 — 포털 번호는 서버가 세션에서 꺼낸다.
    assert.doesNotMatch(source, /filledBy/, "화면이 채운 사람을 보낸다");
  });

  test("🔴 창이 **표 밖**에 있다 — 표 칸 안에서 태어나면 부모 칸의 CSS 가 따라온다", () => {
    const dialogAt = source.indexOf("<FillCustomerNameDialog");
    const tableEnd = source.indexOf("</table>");
    assert.ok(tableEnd >= 0 && dialogAt > tableEnd, "채우기 창이 표 안에 있다");
  });

  test("㉢ 🔴 거절하면 저쪽 문구를 **그대로** 보이고 창을 닫지 않는다", () => {
    const failure = fillFn.indexOf("if (!result.ok) {");
    assert.ok(failure >= 0, "채우기 실패를 가르는 자리가 없다");
    const branch = fillFn.slice(failure, fillFn.indexOf("return;", failure));
    assert.match(branch, /setFillError\(result\.message\)/, "거절 문구를 그대로 들지 않는다");
    assert.doesNotMatch(branch, /router\.refresh|showSavePopup|setFillTarget\(null\)/);
  });

  test("㉢ 🔴 보낸 글자를 화면이 미리 거르지 않는다 — 저쪽이 각각 다른 말로 거절한다", () => {
    // 🔵 [채우기]를 **빈 칸일 때 잠그는 것**만 한다(누르나 마나 한 왕복을 아낀다).
    assert.match(source, /disabled=\{isSubmitting \|\| value\.trim\(\) === ""\}/);
    // 🔴 길이·`-` 를 화면이 재면 자가 두 벌이 되고, 저쪽이 규칙을 고치는 날 여기만 옛 규칙이다.
    const box = source.slice(source.indexOf('id="fill-customer-name-input"'), source.indexOf("{errorMessage && ("));
    assert.doesNotMatch(box, /maxLength/, "입력칸이 글자 수를 잘라 받는다");
    // 🔵 `value` 는 이 창의 입력 상태다 — 그 글자의 길이를 재거나 `-` 를 가려내면 자가 두 벌이다.
    assert.doesNotMatch(box, /\.length|DASH|\/\^-/, "화면이 친 글자의 길이나 `-` 를 재고 있다");
    assert.doesNotMatch(source, /customerName\.length|CUSTOMER_NAME_MAX/, "화면이 길이 상한을 들고 있다");
    // 친 글자가 **손대지 않은 채** 액션으로 간다.
    assert.match(source, /fillInventoryPartCustomerNameAction\(\{\s*no: fillTarget\.no,\s*customerName,\s*\}\)/);
  });

  test("㉣ 🔵 이미 적혀 있던 것은 오류가 아니라 **읽는 알림**으로 말한다", () => {
    assert.match(fillFn, /if \(!result\.filled\)/);
    assert.match(fillFn, /customerNameAlreadySetLines/);
    assert.match(source, /<NoticePopup/);
    // 🔴 거절 자리(setFillError)로 보내면 「틀렸다」로 읽힌다 — 할 일이 다르다.
    const already = fillFn.indexOf("if (!result.filled)");
    const branch = fillFn.slice(already, fillFn.indexOf("return;", already));
    assert.doesNotMatch(branch, /setFillError/);
  });

  test("㉤ 🔴 성공하면 **저쪽이 돌려준 지금 값**이 그 자리에 보인다 — 보낸 값이 아니다", () => {
    assert.match(fillFn, /setFilledCustomerNames\(\(prev\) => \(\{ \.\.\.prev, \[result\.no\]: result\.customerName \}\)\);/);
    assert.match(source, /filledCustomerNames\[part\.no\] \?\? inventoryPartCustomerName\(part\)/);
    // 서버가 가진 목록도 따라오게 한다 — 위 값은 이 화면이 열려 있는 동안만 산다.
    assert.match(fillFn, /router\.refresh\(\)/);
  });

  test("㉤ 🔴 실패한 뒤에 값을 그려 두지 않는다 — 확인 순서가 거꾸로가 아니다", () => {
    const failure = fillFn.indexOf("if (!result.ok) {");
    const paint = fillFn.indexOf("setFilledCustomerNames(");
    assert.ok(failure >= 0 && paint > failure, "실패를 가르기 전에 값을 그린다");
  });

  test("🔴 채우기 창이 **덮어쓰지 않는다**는 것을 미리 말한다", () => {
    assert.match(source, /비어 있을 때만 채워집니다/);
    assert.match(source, /고객사에 나가는 서류/);
    // 🔴 다른 부품으로 다시 열 때 앞 글자가 남아 있으면 엉뚱한 이름이 박힌다 — **여는 자리**
    //    에서 비운다(창이 제 안에서 뒤늦게 비우면 그 한 번 그리는 사이에 눌릴 수 있다).
    assert.match(source, /setFillValue\(""\);\s*setFillTarget\(part\);/);
  });
});

/**
 * ============================================================================
 * 🔴 도번과 재고는 **값만** 눈에 띄게 (2026-10-19 사용자 결정)
 * ============================================================================
 * 후보 줄의 셋째 줄(교산 품번 · 도번 · 소유 · 재고)이 통째로 한 가지 회색이라, 사람이 가장
 * 자주 짚어 보는 **도번**과 **재고**가 나머지에 묻혀 있었다. 둘만 골라 색을 준다.
 *
 * 🔴 **이름표가 아니라 값이다** — 회색 「도번」 + 색 있는 「D-1420」. 이름표까지 칠하면 줄이
 *    다시 한 덩어리가 되어 아무것도 도드라지지 않는다.
 * 🔴 **찾은 줄과 담은 줄 둘 다**다. 한쪽만 칠하면 같은 부품이 두 자리에서 다르게 보인다.
 * 🔵 색 자체가 맞는지는 눈으로 볼 일이고, 여기서 잴 수 있는 것은 **색이 붙는 자리**다 —
 *    가려내는 자를 화면이 따로 적고 있지는 않은가, 두 자리에 다 붙었는가, 다크 짝이 있는가.
 * ============================================================================
 */
describe("🔴 도번과 재고는 값만 눈에 띄게", () => {
  test("㉠ 색은 한 곳에 적어 두고 **다크 짝**이 붙어 있다", () => {
    assert.match(source, /text-blue-700 dark:text-blue-400/, "값을 강조하는 색이 없다");
    // 🔴 밝은 쪽만 적으면 어두운 화면에서 글자가 배경에 잠긴다(이웃 고객사 품명 줄에는 짝이 있다).
    assert.equal(
      [...source.matchAll(/text-blue-700(?! dark:text-blue-400)/g)].length,
      0,
      "다크 짝 없는 파란색이 있다"
    );
  });

  test("㉡ 도번 **값**만 — 어느 것이 도번인지는 이름표를 지은 한 곳에 묻는다", () => {
    // 🔴 `inventoryPartIdLabels` 는 교산 품번과 도번을 **한 배열**로 돌려준다. 가려내지 않으면
    //    둘 다 칠해지거나 둘 다 안 칠해진다.
    assert.match(source, /item\.label === PART_FIELD_LABELS\.drawingNo/, "도번을 가려내지 않는다");
    // 🔴 「도번」을 화면에 박아 두고 견주면, 그 말이 바뀌는 날 오류 없이 **색만 조용히 빠진다**.
    assert.doesNotMatch(source, /=== "도번"/, "이름표 글자를 박아 두고 견준다");
    // 🔴 교산 품번은 회색 그대로다(사용자 결정: 도번과 재고 둘만).
    assert.doesNotMatch(source, /PART_FIELD_LABELS\.kyosanPartNo/, "교산 품번에도 색을 입힌다");
  });

  test("㉢ 재고는 **수**에만 — 찾은 줄과 담은 줄 둘 다", () => {
    assert.equal(
      [...source.matchAll(/renderStockText\(inventoryStockText\(part\)\)/g)].length,
      2,
      "두 자리 중 한쪽에만 색이 들어갔다 — 같은 부품이 두 줄에서 다르게 보인다"
    );
    const cart = source.slice(source.indexOf("{cart.map((line) => {"), source.indexOf("</table>"));
    assert.match(cart, /renderStockText\(inventoryStockText\(part\)\)/, "담은 줄의 재고에 색이 없다");
  });

  test("㉢ 🔴 글자는 도메인 것을 그대로 쓴다 — 그릴 때만 가른다", () => {
    // 🔴 색을 입히자고 `inventoryStockText` 의 반환값을 바꾸면 **다른 화면까지** 따라 바뀐다.
    //    그래서 받은 글자를 그대로 두고 그리는 자리에서만 토막 낸다.
    assert.match(source, /function renderStockText\(text: string\)/, "가르는 자리가 없다");
    // 🔴 꼬리말을 화면이 따로 적기 시작하면 도메인 한 곳이 쥔 말과 갈린다.
    assert.doesNotMatch(source, /INVENTORY_STOCK_AS_OF_NOTE/, "꼬리말을 화면이 다시 적는다");
    // 🔵 못 가를 때 색을 포기하고 **글자는 통째로** 내놓는다 — 수가 사라지면 수량을 잘못 정한다.
    assert.match(source, /if \(!parts\) return text;/, "못 가를 때 글자가 사라진다");
  });
});

/**
 * ============================================================================
 * 🔴 **반출 신청 줄에도 어느 부품인지가 보인다** (2026-10-21 쓰는 분 요청)
 * ============================================================================
 * 「No. 165 AMP-… — 요청 2 / 불출 0」만으로는 가릴 수 없었다 — 같은 품명인 부품 묶음이 16개
 * 있다. 재고 관리가 같은 날 제 화면([부품 요청]·[승인 요청건])을 그렇게 바꿨고, 통로가 칸을
 * 내주게 넓어졌다.
 *
 * 🔵 **규칙 자체**(무엇을 · 어떤 차례로 · 무엇을 앞세우고 · 딱지가 어떻게 갈리는가)는 순수 쪽
 *    시험이 잰다(`lib/domain/inventory-gateway.test.ts`). 여기서는 **화면이 그것을 실제로
 *    쓰는가**만 본다 — 규칙은 맞는데 화면이 제 손으로 다시 적으면 두 벌이 되고, 고치는 날
 *    한쪽만 바뀐다.
 * ============================================================================
 */
describe("🔴 반출 신청 줄 — 어느 부품인지가 보인다", () => {
  /** 신청 목록의 줄만 떼어 본다 — 찾은 줄·담은 줄(부품 고르기 쪽)과 섞이지 않게. */
  const requestLines = source.slice(source.indexOf("{request.lines.map((line, index) =>"), source.indexOf("{notice && <NoticePopup"));
  /**
   * 그리는 조각 **하나만** 떼어 본다. 🔴 끝을 안 끊으면 뒤의 확인 창 둘까지 딸려 와서
   * (거기는 amber 로 경고를 그린다) 「화면이 딱지 색을 따로 적는가」가 영영 ✗ 가 된다.
   */
  const detailsStart = source.indexOf("function StockRequestLineDetails");
  const detailsBlock = source.slice(detailsStart, source.indexOf("function CancelStockRequestDialog", detailsStart));

  test("🔵 **머리줄은 한 글자도 안 바뀌었다** — 수량이 어떻게 됐는지를 보는 줄이다", () => {
    assert.match(requestLines, /\{line\.name\} — 요청 \{line\.quantity\} \/ 불출 \{line\.issued\}/);
    assert.match(requestLines, /\{line\.no !== null && <span className="text-zinc-400">No\. \{line\.no\} <\/span>\}/);
  });

  test("🔴 자세한 내용을 그리는 조각을 **그 줄에서** 부른다", () => {
    assert.match(requestLines, /<StockRequestLineDetails line=\{line\} \/>/, "신청 줄에 자세한 내용이 안 붙는다");
    assert.match(source, /function StockRequestLineDetails\(\{ line \}/, "그리는 조각이 없다");
  });

  test("🔴 규칙을 **도메인 함수**가 정한다 — 화면이 다시 적지 않는다", () => {
    for (const fn of [
      /stockRequestLineCustomerName\(line\)/,
      /stockRequestLineDetails\(line\)/,
      /stockRequestLineOwnerTag\(line\)/,
      /stockRequestLineChargeTag\(line\)/,
    ]) {
      assert.match(source, fn, String(fn));
    }
  });

  test("🔴 **두 딱지를 따로 묻는다** — 한 함수로 합치면 「이 부품은 유상인가」가 된다", () => {
    assert.match(
      source,
      /\[stockRequestLineOwnerTag\(line\), stockRequestLineChargeTag\(line\)\]/,
      "딱지를 한 번에 받아 오고 있다 — 부품의 것과 줄의 것이 뭉개진다"
    );
    // 🔴 화면이 코드값을 직접 견주면 가르는 자리가 두 곳이 된다.
    assert.doesNotMatch(source, /chargeType\.code === "PAID"|chargeType === "PAID"/, "화면이 유상/무상을 직접 가른다");
    assert.doesNotMatch(source, /line\.owner\.code ===/, "화면이 소유구분을 직접 가른다");
  });

  test("🔴 **값이 없으면 빈 자리를 만들지 않는다** — 셋 다 없으면 아무것도 안 그린다", () => {
    assert.match(
      source,
      /if \(customerName === "" && tags\.length === 0 && rest\.length === 0\) return null;/,
      "빈 상자나 여백이 남는다"
    );
    // 🔴 날것으로 그리면 `-` 만 적힌 칸이 값으로 서고, 「없음」을 메워 넣는 길도 생긴다.
    assert.doesNotMatch(source, /\{line\.customerName\}|\{line\.name2\}/, "자세한 내용을 날것으로 그린다");
    assert.doesNotMatch(source, /\{line\.kyosanPartNo\}|\{line\.drawingNo\}/, "품번·도번을 날것으로 그린다");
    assert.doesNotMatch(source, /\{line\.owner\?\.|\{line\.chargeType\?\./, "딱지를 날것으로 그린다");
  });

  test("🔴 **고객사 품명이 앞선다** — 딱지보다, 나머지 글자보다 먼저", () => {
    const block = detailsBlock;
    const lead = block.indexOf("{customerName}");
    const tags = block.indexOf("{tag.value}");
    const rest = block.indexOf("{detail.value}");
    assert.ok(lead >= 0 && tags > lead, "딱지가 고객사 품명보다 앞에 선다");
    assert.ok(rest > tags, "나머지 글자가 딱지보다 앞에 선다");
  });

  test("🔴 **색만으로 가르지 않는다** — 앞세운 줄은 자리·굵기·크기로도 갈린다", () => {
    const block = detailsBlock;
    // ⓐ 제 줄(block) ⓑ 굵고(font-medium) ⓒ 한 치수 크다(text-xs ↔ 나머지 text-[11px]).
    assert.match(block, /className="mt-0\.5 block text-xs leading-snug font-medium/, "앞세운 줄이 굵지도 크지도 않다");
    assert.match(block, /className="mt-0\.5 block text-\[11px\] leading-snug/, "나머지가 앞세운 줄과 같은 크기다");
  });

  test("🔴 이름표는 **정해 둔 한 곳**에서 온다 — 화면에 박아 두지 않는다", () => {
    const block = detailsBlock;
    assert.match(block, /PART_FIELD_LABELS\.customerPartName/, "이름표를 손으로 적고 있다");
    assert.match(block, /\{detail\.label\}/, "나머지 이름표를 손으로 적고 있다");
    assert.doesNotMatch(block, />품명2|>교산 품번|>도번|>소유</, "이름표 글자가 화면에 박혀 있다");
  });

  test("🔴 딱지 꾸밈을 화면이 덧칠하지 않는다 — 도메인이 준 것을 그대로 붙인다", () => {
    const block = detailsBlock;
    assert.match(block, /\$\{tag\.className\}/, "도메인이 고른 꾸밈을 안 쓴다");
    // 🔴 여기서 색을 덧붙이기 시작하면 「색 말고도 갈리는가」를 재는 자리가 둘로 쪼개진다.
    assert.doesNotMatch(block, /bg-amber|text-amber|border-amber/, "화면이 딱지 색을 따로 적는다");
  });
});
