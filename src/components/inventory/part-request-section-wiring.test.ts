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
