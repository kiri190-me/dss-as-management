import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 **납기요청일 칸의 [납기일 확정]** — 화면에 실제로 서는가 (2026-11-25)
 * ============================================================================
 * 사용자 요구 원문: 「납기 요청일 옆에 **[납기일 확정] 버튼**을 만들어줘, 이 버튼은
 * **납기 요청일이 작성되어 있을 때** 생기고 …」.
 *
 * ── 왜 **원본 글자**로 재는가 ───────────────────────────────────────────
 * DomesticOrderListScreen 은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬
 * 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * **import 자체가 던진다**(이웃 domestic-order-completed-row-readonly.test.ts ·
 * domestic-order-inline-cells.test.ts 가 같은 자리에서 같은 방법을 쓴다).
 *
 * ── 🔴 못 박는 것 다섯 ──────────────────────────────────────────────────
 *  ① 🔴 **`<button>` 안에 `<button>` 이 없다.** 고칠 수 있는 사람에게는 납기요청일
 *     칸 **자체가 `<button>`**(DomesticOrderDueDatesCell)이라, 그 안에 단추를 넣으면
 *     HTML 이 깨진다. 그래서 확정 묶음은 그 칸 **밖**, 같은 칸 안에 선다.
 *  ② 🔴 **표와 카드 둘 다** 선다. 한쪽만 고치면 **좁은 화면에서만 단추가 사라진다** —
 *     이 저장소에서 반복된 함정이고, 그래서 두 덩어리를 **따로 잘라** 잰다.
 *  ③ 🔴 **날짜가 보이는 줄에만** 선다(사용자 요구 그대로). 🔴 **2026-11-25 에 그 뜻이
 *     넓어졌다** — 수리 건에서 **빌려 온 날짜**가 보이는 줄도 포함된다(사용자 결정:
 *     「[수리건 요청일]도 … 같은 취급을 해줘」). 아무것도 안 그리는 줄은 칸에 "-" 만
 *     보이는 줄 하나다.
 *  ④ 🔴 **단추는 권한으로 갈리고 확정 표는 안 갈린다** — 표는 고치는 길이 아니라
 *     사실이다(회차별 완료 표가 같은 자리에서 같은 선을 긋는다).
 *  ⑤ 🔴 **보내는 값 셋**(줄 id · 그 줄의 version · 회차 번호)과, 누름이 위로 퍼지지
 *     않게 막는 한 줄. version 을 빼면 남이 납기요청일을 고친 뒤에 **엉뚱한 회차**가
 *     확정된다.
 *
 * 🔴 값은 전부 지어낸 것이다 — 실제 고객사·L/N·S/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 🔴 **세기 전에 주석을 걷는다.** 이 저장소는 「왜 그렇게 했는가」를 길게 적고 그 글에
 * 부품 이름이 그대로 들어 있다 — 날것으로 세면 **주석만으로 통과**한다.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const listScreen = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");
const screenNoComments = flat(stripComments(listScreen));

/**
 * 🔴 **사용중 목록 한 덩어리**를 먼저 잘라 낸다 — 이 파일에는 목록이 **둘**이고
 * 휴지통 쪽이 **앞에** 선언되어 있다(그 사고의 전문은 이웃
 * domestic-order-completed-row-readonly.test.ts 의 같은 자리에 있다).
 */
const activeList = sliceBetween(listScreen, 'listId="domestic-orders"', "<MasterDataDeleteDialog");
const tableBody = flat(stripComments(sliceBetween(activeList, "{group.rows.map((row) => {", "cards={")));
const cardBody = flat(stripComments(sliceBetween(activeList, "cards={", "{canDelete && (")));
/** 확정 묶음 그 자체. */
const toggles = flat(
  stripComments(sliceBetween(listScreen, "function DueDateRowConfirmToggles({", "type ListView ="))
);

describe("표본 점검 — 자른 세 덩어리가 정말 그 자리다", () => {
  test("표·카드에 납기요청일 칸이 있고, 확정 묶음이 비어 있지 않다", () => {
    assert.ok(tableBody.includes("<DomesticOrderDueDatesCell"), "표 본문에 납기요청일 칸이 없다");
    assert.ok(cardBody.includes("field.dueDatesEdit"), "카드 본문에 납기요청일 편집이 없다");
    assert.ok(tableBody.includes("<td "), "표 본문이 아니다");
    assert.ok(cardBody.includes("<dd"), "카드 본문이 아니다");
    assert.ok(toggles.includes("setDomesticOrderDueDateRowConfirmationAction"), "확정 묶음이 아니다");
  });
});

describe("🔴 ① 단추가 단추 안으로 들어가지 않는다", () => {
  test("🔴 표 — 확정 묶음이 납기요청일 칸 **밖**이다", () => {
    // 칸은 `/>` 로 닫히고, 확정 묶음은 그 뒤에 **형제로** 선다. 안으로 들어가면
    // 열린 `<DomesticOrderDueDatesCell` 과 확정 묶음 사이에 `/>` 가 없다.
    const cell = sliceBetween(tableBody, "<DomesticOrderDueDatesCell", "<DueDateRowConfirmToggles");
    assert.ok(cell.includes("/>"), "확정 묶음이 납기요청일 칸 안으로 들어갔다 — <button> 안의 <button> 이다");
  });

  test("🔴 카드 — 갈래 **안**이 아니라 **옆**에 선다", () => {
    // 갈래 안에 넣으면 `rowCanEdit` 이 거짓인 세션에서 **확정 표까지 사라진다**
    // (그것은 고치는 길이 아니라 사실이다 — ④).
    assert.match(cardBody, /\{field\.dueDatesEdit && \( <DueDateRowConfirmToggles/);
    const branch = sliceBetween(cardBody, "{rowCanEdit && field.dueDatesEdit ?", "{field.dueDatesEdit &&");
    assert.equal(
      branch.includes("<DueDateRowConfirmToggles"),
      false,
      "확정 묶음이 `rowCanEdit` 갈래 안에 있다 — 권한이 없으면 확정 표까지 사라진다"
    );
  });
});

describe("🔴 ② 표와 카드 둘 다 — 한쪽만 고치면 좁은 화면에서만 사라진다", () => {
  test("두 덩어리에 각각 한 번씩 선다", () => {
    assert.equal(
      tableBody.split("<DueDateRowConfirmToggles").length - 1,
      1,
      "표에 확정 묶음이 하나가 아니다"
    );
    assert.equal(
      cardBody.split("<DueDateRowConfirmToggles").length - 1,
      1,
      "카드에 확정 묶음이 하나가 아니다"
    );
    // 선언 하나 + 쓰는 자리 둘 = 셋. 통째로 지우거나 한쪽만 더하면 수가 달라진다.
    assert.equal(screenNoComments.split("DueDateRowConfirmToggles").length - 1, 3);
  });

  test("🔴 둘 다 같은 재료를 넘긴다 — 줄 · 권한 · 오류 자리", () => {
    for (const [label, body] of [["표", tableBody], ["카드", cardBody]] as const) {
      const rest = body.slice(body.indexOf("<DueDateRowConfirmToggles"));
      const props = rest.slice(0, rest.indexOf("/>"));
      assert.ok(props.includes("row={row}"), `${label}가 줄을 안 넘긴다`);
      assert.ok(props.includes("access={editAccess}"), `${label}가 권한을 안 넘긴다`);
      assert.ok(props.includes("onError={setCompletionError}"), `${label}가 오류 자리를 안 넘긴다`);
    }
  });
});

describe("🔴 ③④⑤ 묶음이 하는 일", () => {
  test("🔴 ③ 칸에 **\"-\" 만 보이는 줄에는 아무것도 안 그린다**", () => {
    // 🔴 **2026-11-25 에 조건이 바뀌었다.** 그 전까지는 「회차가 0이면 안 그린다」라,
    //    수리 건에서 **빌려 온 날짜**가 보이는 줄에는 단추가 서지 않았다. 사용자
    //    결정으로 그 줄도 같은 취급이 되었다 — 이제 아무것도 안 그리는 줄은
    //    **적어 둔 회차도 없고 빌려 올 날짜도 없는** 줄 하나뿐이다.
    assert.match(
      toggles,
      /if \(row\.dueDates\.length === 0 && borrowedDueDate === null\) return null;/
    );
  });

  test("🔴 ③ 빌려 온 날짜는 **칸을 그리는 그 함수**에 물어본다 — 따로 재지 않는다", () => {
    // 따로 적으면 「날짜는 보이는데 단추가 없는」(또는 그 반대인) 줄이 생긴다.
    assert.match(toggles, /const display = resolveDomesticOrderDueDateDisplay\(row\);/);
    assert.match(toggles, /const borrowedDueDate = display\.borrowed \? display\.lines\[0\] : null;/);
  });

  test("🔴 ③ 빌려 온 줄에는 **1차 하나**가 선다 — 확정일 수 없고 번호를 말하지 않는다", () => {
    const borrowedUnit = sliceBetween(toggles, 'key: "borrowed",', "];");
    assert.ok(borrowedUnit.includes("rowOrder: 1,"), "빌려 온 줄의 회차 번호가 1 이 아니다");
    assert.ok(borrowedUnit.includes("confirmed: false,"), "아직 행이 없는데 확정으로 그린다");
    assert.ok(
      borrowedUnit.includes('name: "",'),
      "가리킬 다른 회차가 없는데 번호를 말한다"
    );
    // 🔴 회차 이름은 여기서도 **지어내지 않는다**. 비고는 없다 — 빌려 온 날짜에는
    //    메모가 딸려 오지 않는다.
    assert.ok(
      borrowedUnit.includes(
        "label: domesticOrderDueDateRowLabel(1, { dueDate: borrowedDueDate, note: null }),"
      ),
      "빌려 온 줄의 회차 이름을 지어내고 있다"
    );
  });

  test("🔴 ④ 단추만 권한으로 갈린다 — 확정 표는 그 밖이다", () => {
    assert.match(toggles, /const canToggle = canEditDomesticOrderWhenCompleted\(row, access\);/);
    assert.match(toggles, /\{canToggle && \( <button/);
    // 확정 표는 **단추를 감춘 조건 밖**에 있다 — 권한이 없어도 「확정됨」은 보인다.
    const gated = sliceBetween(toggles, "{canToggle && (", "</button>");
    assert.equal(gated.includes("확정 ✓"), false, "확정 표가 단추와 함께 사라진다");
    assert.ok(toggles.includes("{confirmed && ("), "확정 표를 그리는 자리가 없다");
    // 🔵 **회차의 완료 여부로 재지 않는다** — 확정은 완료와 뜻이 다른 값이다.
    assert.equal(
      toggles.includes("canEditDomesticOrderWhenCompleted(dueDate,"),
      false,
      "확정 단추를 회차의 완료 여부로 재고 있다 — 서버는 줄로 막는다"
    );
  });

  test("🔴 ⑤ 보내는 값 셋과, 누름이 위로 안 퍼지게 막는 한 줄", () => {
    assert.match(
      toggles,
      /setDomesticOrderDueDateRowConfirmationAction\(\{ id: row\.id, expectedVersion: row\.version, dueDateRowOrder: rowOrder, confirmed, \}\)/
    );
    // 🔴 이 단추는 납기요청일 칸 안에 산다 — 막지 않으면 누를 때마다 편집칸이 열린다.
    assert.match(toggles, /event\.stopPropagation\(\);/);
  });

  test("🔴 회차 이름을 **지어내지 않는다** — 다른 화면이 쓰는 그 한 줄을 받는다", () => {
    assert.match(toggles, /domesticOrderDueDateRowLabel\(rowOrder, dueDate\)/);
    // 🔵 회차가 하나뿐인 줄에서는 번호를 말하지 않는다(없는 구분을 있는 것처럼 읽게 한다).
    assert.match(toggles, /row\.dueDates\.length > 1 \? `\$\{rowOrder\}차 ` : ""/);
  });
});
