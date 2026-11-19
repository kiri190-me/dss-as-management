import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT,
  DOMESTIC_ORDER_COMPLETED_READ_ONLY_LABEL,
} from "@/lib/domain/domestic-order-completed-edit-access";

/**
 * ============================================================================
 * 🔴 **완료된 줄의 고치는 길이 표와 카드 양쪽에서 사라진다** (2026-11-19, 조각 2)
 * ============================================================================
 * 사용자 지시: 「[완료시 수정]권한이 없으면 [완료]건에 대해서 [수정], [완료해제]버튼이
 * **보이지 않도록** 해줘.」
 *
 * ── 왜 **원본 글자**로 재는가 ───────────────────────────────────────────
 * DomesticOrderListScreen 은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬
 * 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * **import 자체가 던진다**(이웃 domestic-order-inline-cells.test.ts ·
 * badge-visibility-screens.test.tsx 가 같은 자리에서 같은 방법을 쓴다).
 * 🔵 **규칙 자체는 값으로 잰다** — lib/domain/domestic-order-completed-edit-access.test.ts
 * 가 여덟 칸을 전부 돈다. 여기서 못 박는 것은 **화면이 그 규칙을 어디서 부르는가**다.
 *
 * ── 🔴 못 박는 것 일곱 ──────────────────────────────────────────────────
 *  ① **페이지가 깃발을 실제로 내려보낸다.** 안 내려보내면 화면은 영영 못 막는다 —
 *    조각 1에서 같은 꼴의 결함을 실제로 잡았다.
 *  ② 표의 **열네 칸 + [수정]** 이 줄마다의 판정으로 갈린다.
 *  ③ 🔴 **카드도 같다.** 한쪽만 고치면 **좁은 화면에서만 단추가 남는다** — 이
 *    저장소에서 반복된 함정이고, 카드 쪽을 안 고친 판을 일부러 만들어 이 시험이
 *    무는지 확인했다(2026-11-19).
 *  ④ **[완료 해제]는 단추마다** 판정한다 — 완료 전의 [완료 처리]는 예전 그대로다.
 *  ⑤ 🔴 **회차는 회차의 완료 여부로** 가른다(줄의 것이 아니다). 그리고 완료 표 ·
 *    승인 배지는 **남는다** — 그 둘은 고치는 길이 아니라 사실이다.
 *  ⑥ **읽기 전용 까닭**이 표와 카드 양쪽에 적히고, 배지도 단추도 아니다.
 *  ⑦ 🔴 **글자 두 벌이 같은 낱말을 말한다** — 화면의 한 줄과 서버의 거절 문장이
 *    둘 다 권한 화면의 칸 이름(「완료 시 수정」)을 댄다.
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
 * 함수 이름과 `canEdit` 같은 변수 이름이 그대로 들어 있다 — 날것으로 세면 주석만으로
 * 통과하거나, 반대로 주석 때문에 「남아 있다」가 된다.
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
const pageSource = flat(read("src/app/(app)/domestic-orders/page.tsx"));

/**
 * 🔴 **사용중 목록 한 덩어리**를 먼저 잘라 낸다.
 *
 * 이 파일에는 목록이 **둘**이다 — 휴지통 패널(`listId="domestic-orders-trash"`)이 이
 * 목록보다 **앞에** 선언되어 있고 그쪽에도 `cards={` 가 있다. 그래서 파일 전체에서
 * 곧장 `cards={` 를 찾으면 **휴지통 것이 잡혀** 「카드」 조각이 표까지 통째로 머금은
 * 덩어리가 되고, 그러면 **표만 고친 판이 카드 단언을 전부 통과한다.**
 * 🔵 아래 표본 점검이 바로 이 사고를 잡아 준다(2026-11-19 실제로 한 번 잡혔다).
 */
const activeList = sliceBetween(listScreen, 'listId="domestic-orders"', "<MasterDataDeleteDialog");
/** 표 본문(줄마다 그리는 `<tr>`). */
const tableBody = flat(stripComments(sliceBetween(activeList, "{group.rows.map((row) => {", "cards={")));
/** 카드 본문. 🔴 표와 **따로** 잘라 둔다 — 한 덩어리로 재면 한쪽만 고친 판이 통과한다. */
const cardBody = flat(stripComments(sliceBetween(activeList, "cards={", "{canDelete && (")));

/**
 * 🔴 **잘라 온 것이 정말 그 자리인가.** 표본이 비거나 엉뚱한 곳을 가리키면 아래
 * 단언들이 **전부 공짜로 통과**한다(「없다」를 재는 단언이 많아 더 위험하다).
 */
describe("표본 점검 — 자른 두 덩어리가 정말 표와 카드다", () => {
  test("표 본문에는 눌러 고치는 칸이 열넷, 카드 본문에는 칸 목록이 있다", () => {
    assert.equal(
      tableBody.split("<DomesticOrderTextCell").length - 1,
      11,
      "표 본문에 글자·날짜 칸 편집이 열하나가 아니다 — 자른 자리가 바뀌었다"
    );
    assert.ok(tableBody.includes("<DomesticOrderDueDatesCell"), "표 본문에 납기요청일 칸이 없다");
    assert.equal(
      tableBody.split("<DomesticOrderDeliveriesCell").length - 1,
      2,
      "표 본문에 납품 칸이 둘이 아니다"
    );
    assert.ok(cardBody.includes("field.edit"), "카드 본문에 칸 목록이 없다");
    assert.ok(cardBody.includes("field.dueDatesEdit"), "카드 본문에 납기요청일 편집이 없다");
    assert.ok(cardBody.includes("field.deliveriesEdit"), "카드 본문에 납품 편집이 없다");
  });

  test("🔴 두 덩어리가 서로 섞이지 않았다 — 표에는 <td>, 카드에는 <dd> 가 있고 반대는 없다", () => {
    assert.ok(tableBody.includes("<td "), "표 본문이 아니다");
    assert.equal(tableBody.includes("<dd"), false, "표 본문에 카드가 섞였다");
    assert.ok(cardBody.includes("<dd"), "카드 본문이 아니다");
    assert.equal(cardBody.includes("<td "), false, "카드 본문에 표가 섞였다");
  });
});

describe("🔴 ① 페이지가 새 깃발을 실제로 내려보낸다", () => {
  test("서버가 `domesticOrders.completedEdit` WRITE 를 잰다", () => {
    assert.match(
      pageSource,
      /hasPermission\(actingUser, "domesticOrders\.completedEdit", "WRITE"\)/,
      "페이지가 새 잎을 읽지 않는다"
    );
  });

  test("🔴 서버 관문과 같은 식이다 — `edit` 과 **AND** 로 접어 내려보낸다", () => {
    // 🔴 AND 가 빠지면 「수정은 접근 불가인데 완료 시 수정은 쓰기」라는 설정이 화면에서만
    //    힘을 갖는다(서버는 둘 다 묻는다 — canEditCompletedDomesticOrder).
    assert.match(pageSource, /const canEditCompleted = canEdit && actingUser !== null &&/);
  });

  test("🔴 화면에 **넘긴다** — 재 놓고 안 넘기면 화면은 영영 못 막는다", () => {
    assert.match(pageSource, /canEditCompleted=\{canEditCompleted\}/);
    assert.match(screenNoComments, /canEditCompleted = false,/, "화면이 그 프롭을 안 받는다");
    assert.match(screenNoComments, /canEditCompleted\?: boolean;/, "화면에 그 프롭 타입이 없다");
  });

  test("🔵 안 넘기면 **닫히는 쪽**으로 떨어진다 — 기본값이 거짓이다", () => {
    assert.equal(
      screenNoComments.includes("canEditCompleted = true"),
      false,
      "기본값이 참이면 이 값을 안 내려보내는 페이지가 생기는 날 조용히 전부 열린다"
    );
  });
});

describe("🔴 ②③ 표와 카드가 **같은 판정**을 줄마다 쓴다", () => {
  test("두 덩어리가 각각 그 줄의 판정을 만든다", () => {
    const line = "const rowCanEdit = canEditDomesticOrderWhenCompleted(row, editAccess);";
    assert.ok(tableBody.includes(line), "표가 줄마다의 판정을 안 만든다");
    assert.ok(cardBody.includes(line), "🔴 카드가 줄마다의 판정을 안 만든다 — 좁은 화면에서만 단추가 남는다");
    // 선언이 **둘뿐**이다. 셋이 되면 어딘가에서 세 번째 규칙이 자라고 있는 것이다.
    assert.equal(screenNoComments.split(line).length - 1, 2);
  });

  test("🔴 표의 열네 칸이 전부 줄마다의 판정으로 갈린다", () => {
    // 글자·날짜 열하나 + 납기요청일 하나 + 납품 둘 = 열넷.
    assert.equal(
      tableBody.split("{rowCanEdit ? (").length - 1,
      14,
      "표에서 줄마다의 판정을 쓰는 칸이 열넷이 아니다"
    );
    // 🔴 하나라도 `canEdit` 그대로 남으면 **완료된 줄에서 그 칸만 열린다.**
    assert.equal(tableBody.includes("{canEdit ? ("), false, "표에 옛 판정이 남아 있다");
  });

  test("🔴 카드의 세 갈래도 줄마다의 판정으로 갈린다", () => {
    assert.ok(cardBody.includes("{rowCanEdit && field.dueDatesEdit ? ("), "카드 납기요청일");
    assert.ok(cardBody.includes(": rowCanEdit && field.deliveriesEdit ? ("), "카드 납품");
    assert.ok(cardBody.includes(": rowCanEdit && field.edit ? ("), "카드 글자 칸");
    assert.equal(cardBody.includes("canEdit && field."), false, "카드에 옛 판정이 남아 있다");
  });

  test("🔴 [수정] 단추는 표와 카드 **둘 다** 줄마다의 판정이다", () => {
    const gated = "{rowCanEdit && <EditRowButton row={row} onOpen={openRow} />}";
    assert.equal(
      screenNoComments.split(gated).length - 1,
      2,
      "[수정] 을 막는 자리가 둘이 아니다 — 표나 카드 한쪽이 빠졌다"
    );
    // 🔵 단추 자체는 그대로 셋이다(선언 · 표 · 카드) — 막다가 통째로 지우지 않았는지 본다.
    assert.equal(screenNoComments.split("EditRowButton").length - 1, 3);
    assert.equal(
      screenNoComments.includes("{canEdit && <EditRowButton"),
      false,
      "한쪽이 옛 판정 그대로다"
    );
  });

  test("🔵 표의 폭을 다시 재는 조건에 새 깃발이 들어 있다", () => {
    // 완료된 줄의 단추가 빠지고 「읽기 전용」이 대신 서면 순번 칸의 폭이 달라진다.
    assert.match(
      screenNoComments,
      /measureKey=\{\[visibleRows\.length, groups\.length, canEdit, canEditCompleted\]\}/
    );
  });
});

describe("🔴 ④⑤ [완료 해제]만 사라진다 — [완료 처리]와 사실 표시는 그대로", () => {
  const toggle = flat(
    stripComments(sliceBetween(listScreen, "function CompletionToggle({", "function DueDateRowCompletionToggles({"))
  );
  const rowToggles = flat(
    stripComments(sliceBetween(listScreen, "function DueDateRowCompletionToggles({", "type ListView ="))
  );

  test("줄 단추는 **그 줄의 완료 여부**로 가른다", () => {
    assert.match(toggle, /const canToggle = canEditDomesticOrderWhenCompleted\(row, access\);/);
    assert.match(toggle, /\{canToggle && \( <button/);
    // 막는 것이 바로 그 단추다 — 글자가 「완료 해제」/「완료 처리」인 그것.
    assert.match(toggle, /\{completed \? "완료 해제" : "완료 처리"\}/);
  });

  test("🔴 그릴 것이 하나도 없으면 **감싸개도 안 만든다** — 빈 상자가 순번 칸에 틈을 남긴다", () => {
    // 「완료됐고 · 권한이 없고 · 승인 배지도 없는」 줄에서만 생기는 틈이다. 감싸개를
    // 남기면 바깥 줄의 `gap-2` 가 그대로 빈 자리가 된다.
    assert.match(toggle, /if \(!canToggle && !approvedRowOrders\.includes\(1\)\) return null;/);
  });

  test("🔴 승인 배지는 **단추 밖**이다 — 권한이 없어도 사실은 보인다", () => {
    const gated = sliceBetween(toggle, "{canToggle && (", "<FinalShipmentApprovedBadge");
    assert.equal(
      gated.includes("</span>"),
      false,
      "전제가 깨졌다 — 배지가 단추를 감싼 조건 안으로 들어갔다"
    );
    // 🔵 `{ }` 는 걷어 낸 주석 자리다 — 거기 설명이 붙고 떨어진다고 깨지면 안 된다.
    assert.match(toggle, /<\/button> \)\}( \{ \})? <FinalShipmentApprovedBadge/, "배지가 조건 밖이 아니다");
  });

  test("🔴 회차는 **회차마다** 판정한다 — 줄의 완료 여부로 재지 않는다", () => {
    assert.match(rowToggles, /\{canEditDomesticOrderWhenCompleted\(dueDate, access\) && \( <button/);
    assert.equal(
      rowToggles.includes("canEditDomesticOrderWhenCompleted(row,"),
      false,
      "🔴 회차를 줄로 재고 있다 — 1차만 끝난 줄에서 [1차 해제]가 그려지고 서버가 거절한다"
    );
  });

  test("🔴 회차의 완료 표와 승인 배지는 **남는다** — 고치는 길이 아니라 사실이다", () => {
    const gated = sliceBetween(rowToggles, "{canEditDomesticOrderWhenCompleted(dueDate, access) && (", "</button>");
    assert.ok(gated.includes("}차 {completed ? \"해제\" : \"완료\"}"), "전제가 깨졌다 — 막은 것이 그 단추가 아니다");
    assert.equal(gated.includes("DueDateRowCompletedBadge"), false, "완료 표가 단추와 함께 사라진다");
    assert.equal(gated.includes("FinalShipmentApprovedBadge"), false, "승인 배지가 단추와 함께 사라진다");
    // 그 둘은 조각 안에 여전히 있다(통째로 지운 것이 아니다).
    assert.ok(rowToggles.includes("<DueDateRowCompletedBadge"));
    assert.ok(rowToggles.includes("<FinalShipmentApprovedBadge"));
  });

  test("🔴 표와 카드가 둘 다 완료 단추에 권한을 넘긴다", () => {
    assert.equal(
      screenNoComments.split("access={editAccess}").length - 1,
      2,
      "완료 단추에 권한을 넘기는 자리가 둘이 아니다 — 한쪽에서는 영영 안 막힌다"
    );
    assert.ok(tableBody.includes("access={editAccess}"), "표가 안 넘긴다");
    assert.ok(cardBody.includes("access={editAccess}"), "카드가 안 넘긴다");
  });

  test("🔴 화면이 새 깃발을 **날것으로 읽지 않는다** — 판정은 도메인 하나가 쥔다", () => {
    assert.equal(
      screenNoComments.includes("access.canEditCompleted"),
      false,
      "화면이 깃발을 직접 보고 있다 — 줄의 완료 여부를 안 보는 지름길이 생긴다"
    );
  });
});

describe("🔴 ⑥ 읽기 전용이 된 까닭을 그 자리에 적는다", () => {
  const note = flat(
    stripComments(sliceBetween(listScreen, "function CompletedReadOnlyNote()", "function IntakeNumberLink("))
  );

  test("표와 카드 **둘 다** 적는다", () => {
    const call = "{showDomesticOrderCompletedReadOnlyNote(row, editAccess) && ( <CompletedReadOnlyNote /> )}";
    assert.ok(tableBody.includes(call), "표에 까닭이 안 적힌다");
    assert.ok(cardBody.includes(call), "카드에 까닭이 안 적힌다 — 폰에서는 단추가 그냥 사라진 것이 된다");
    // 🔵 조각은 하나이고 쓰는 자리가 둘이다. 🔴 `showDomesticOrderCompletedReadOnlyNote`
    //    가 이 이름을 품고 있어 통짜로 세면 안 된다 — 여는 태그로 센다.
    assert.equal(screenNoComments.split("<CompletedReadOnlyNote />").length - 1, 2);
    assert.equal(screenNoComments.split("function CompletedReadOnlyNote()").length - 1, 1);
  });

  test("🔴 배지가 아니다 — 배지 표시 설정으로 꺼지면 안 되는 글자다", () => {
    assert.equal(note.includes("placeKey"), false, "배지처럼 자리를 받고 있다");
    assert.equal(note.includes("useIsBadgeVisible"), false, "배지 표시 설정을 따른다");
  });

  test("🔴 단추가 아니다 — 눌러도 아무 일이 없는 단추는 지금보다 나쁘다", () => {
    assert.equal(note.includes("<button"), false);
    assert.equal(note.includes("rowActionButtonClass"), false);
  });

  test("글자와 까닭 한 줄은 도메인에서 온다 — 화면이 지어내지 않는다", () => {
    assert.match(note, /title=\{DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT\}/);
    assert.match(note, /\{DOMESTIC_ORDER_COMPLETED_READ_ONLY_LABEL\}/);
    assert.equal(note.includes('"읽기 전용"'), false, "글자를 화면이 또 적어 두었다");
  });
});

describe("🔴 ⑦ 화면의 한 줄과 서버의 거절 문장이 **같은 낱말**을 댄다", () => {
  const mutation = read("src/lib/db/mutations/domestic-orders.ts");
  const features = read("src/lib/auth/permission-features.ts");

  test("권한 화면의 칸 이름이 「완료 시 수정」이다 — 두 글자가 그것을 가리킨다", () => {
    assert.match(features, /label: "완료 시 수정",/, "잎의 이름이 바뀌었다 — 두 문장을 함께 고칠 것");
    assert.match(DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT, /「완료 시 수정」/);
    assert.match(
      sliceBetween(mutation, "COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE =", ";"),
      /「완료 시 수정」/,
      "서버의 거절 문장이 다른 이름을 댄다 — 눌러 본 사람과 안 눌러 본 사람이 다른 권한을 찾게 된다"
    );
  });

  test("보이는 글자는 짧다 — 줄마다 서는 자리라 문장을 적지 않는다", () => {
    assert.ok(
      DOMESTIC_ORDER_COMPLETED_READ_ONLY_LABEL.length <= 6,
      "표의 순번 칸이 가로로 밀린다"
    );
  });
});

describe("🔵 [삭제]·[휴지통]은 영향이 없다 — 다른 권한이 정한다", () => {
  test("휴지통으로 보내기는 여전히 canDelete 하나로 선다", () => {
    assert.match(
      screenNoComments,
      /onRequestDelete=\{ canDelete && editingRow \? \(\) => trash\.open\("DELETE", \[trashTarget\(editingRow\)\]\) : undefined \}/
    );
    // 확인 창 셋도 그대로 canDelete 다.
    assert.ok(screenNoComments.includes("{canDelete && ( <> <MasterDataDeleteDialog"));
  });

  test("🔴 삭제 판정에 새 깃발이 섞이지 않았다", () => {
    assert.equal(screenNoComments.includes("canDelete && canEditCompleted"), false);
    assert.equal(screenNoComments.includes("canDelete && rowCanEdit"), false);
    assert.equal(screenNoComments.includes("rowCanEdit && canDelete"), false);
  });
});
