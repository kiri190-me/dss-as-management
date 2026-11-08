import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 내자 정리 표 칸 편집 — 화면이 규칙을 제자리에서 부르는가 (2026-09-11)
 * ============================================================================
 * 무엇을 싣는지 · 편집 목록을 무엇으로 채우는지는 도메인 시험이 본다
 * (lib/domain/domestic-order-cell-edit.test.ts). 여기서 지키는 것은 화면 쪽 약속이다:
 *
 *  · 세금계산서발행일은 표와 카드 **둘 다** 눌러 고친다(원래대로).
 *  · 금액(VAT별도)은 칸 편집이 **없다** — 견적서에서 가져오는 값이다(사용자 결정).
 *  · 납기요청일은 표와 카드 둘 다 DomesticOrderDueDatesCell 로 눌러 고친다.
 *  · 🔴 그 칸의 편집 목록은 **이 줄에 적힌 날짜로만** 채운다 — 수리 건 요청일을
 *    읽는 길이 그 파일에 아예 없다(HANDOFF V-3 · V-5).
 *  · 칸 편집의 클릭이 `줄 수정` 폼으로 새지 않는다(stopPropagation).
 *  · sr-only 는 relative 가 있는 버튼 안에만 있다(HANDOFF V-6).
 *  · 견적서를 따르는 칸의 막음이 편집 여부보다 먼저 판정된다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 이 칸들은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬 끝의
 * `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는 import
 * 자체가 던진다. 이웃 시험(domestic-order-trash.test.ts)과 같은 방법이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 🔴 **세기 전에 주석을 걷는다.** 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게
 * 적고 그 글에 함수 이름이 그대로 들어 있다 — `EditRowButton` 은 주석째 세면 여덟,
 * 실제로 쓰이는 자리는 셋이다(선언 · 표 · 카드).
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
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
const dueDatesCell = read("src/components/domestic-orders/DomesticOrderDueDatesCell.tsx");
const textCell = read("src/components/domestic-orders/DomesticOrderTextCell.tsx");

/** 표 본문(줄마다 그리는 `<tr>`) — 머리말의 같은 글자와 섞이지 않게 잘라 둔다. */
const tableBody = flat(sliceBetween(listScreen, "{group.rows.map((row) => {", "cards={"));
/** 카드 칸 목록. */
const cardGroups = flat(sliceBetween(listScreen, "label: \"발주\",", "function CompletedBadge"));
/** 카드가 칸 하나를 그리는 자리. */
const cardRender = flat(sliceBetween(listScreen, "{fieldGroup.fields.map((field) => (", "</dl>"));

/**
 * ============================================================================
 * 🔴 `줄 수정` 은 **[수정] 버튼으로만** 열린다 (2026-11-06 사용자 결정)
 * ============================================================================
 * 「내자정리의 표에서 줄을 클릭했을때 [줄 수정]창이 뜨는 기능을 없애줘. [줄 수정]은
 * 표에서 [수정] 버튼을 눌렀을 때만 뜨도록 해줘」.
 *
 * 🔴 **세 가지를 함께 잰다.** 줄 누르기를 걷다가 **[형식] 링크(기타건 상세로 가는
 * 길)** 나 **[수정] 버튼**까지 죽이면, 걷은 것은 맞는데 화면이 못 쓰게 된다. 하나만
 * 재면 그 사고가 통과한다.
 *
 * 🔵 「줄을 누르면 수정창이 뜬다」를 재던 **기존 시험은 없었다**(2026-11-06 실측 —
 * `openRow` · `cursor-pointer` 를 재는 시험이 저장소에 하나도 없었다). 그래서
 * 뒤집을 단언이 아니라 **새로 박는 못**이다.
 */
test("🔴 표의 줄과 카드에 누르기가 없다 — 눌러도 `줄 수정` 이 열리지 않는다", () => {
  for (const [name, source] of [
    ["표의 줄", tableBody],
    ["카드", flat(sliceBetween(listScreen, "{group.rows.map((row) => {", "</dl>"))],
  ] as const) {
    assert.equal(
      source.includes("onClick={canEdit ? () => openRow(row.id) : undefined}"),
      false,
      `${name} 에 줄 전체 누르기가 남아 있다`
    );
    // 손 모양만 남으면 「눌러도 아무 일이 없는 줄」이 되어 고장으로 읽힌다.
    assert.equal(
      source.includes('canEdit ? "cursor-pointer" : ""'),
      false,
      `${name} 에 cursor-pointer 가 남아 있다`
    );
  }
});

test("🔴 그런데 [수정] 버튼은 표와 카드 **둘 다** 그대로 있다", () => {
  const screen = flat(stripComments(listScreen));
  // 선언 1 + 표 1 + 카드 1 = 3. 줄면 한쪽에서 여는 길이 통째로 사라진 것이다.
  // 🔵 주석을 걷은 뒤에 센다 — 안 걷으면 여덟이다(위 stripComments).
  assert.equal(screen.split("EditRowButton").length - 1, 3, "EditRowButton 이 셋이 아니다");
  assert.match(screen, /<EditRowButton row=\{row\} onOpen=\{openRow\} \/>/);
  // 누르면 실제로 그 줄의 폼을 연다 — 버튼만 남고 아무 일도 안 하면 같은 고장이다.
  const button = flat(sliceBetween(listScreen, "function EditRowButton(", "function IntakeNumberLink("));
  assert.match(button, /onOpen\(row\.id\);/);
});

test("🔴 [형식]을 누르면 기타건 상세로 가는 길도 그대로다", () => {
  // 줄 누르기를 걷다가 이 링크까지 죽이면 기타건 상세로 갈 길이 목록에서 사라진다
  // (조각 3 에서 만든 것이다. 규칙은 domain/domestic-order-detail-link.ts).
  assert.match(tableBody, /<ModelNameLink row=\{row\} \/>/);
  assert.match(cardGroups, /\{ label: "형식", of: \(row\) => <ModelNameLink row=\{row\} \/> \}/);
  const component = flat(sliceBetween(listScreen, "function ModelNameLink(", "function CompletionToggle("));
  assert.match(component, /const link = resolveDomesticOrderModelLink\(row\);/);
  assert.match(component, /href=\{link\.href\}/);
});

test("세금계산서발행일은 표와 카드 둘 다 눌러 고친다", () => {
  assert.match(
    tableBody,
    /<DomesticOrderTextCell row=\{row\} field="taxInvoiceDate" displayText=\{dash\(row\.taxInvoiceDate\)\}/,
    "표의 세금계산서발행일이 칸 편집이 아니다"
  );
  assert.match(
    cardGroups,
    /label: "세금계산서발행일", of: \(row\) => dash\(row\.taxInvoiceDate\), edit: \{ field: "taxInvoiceDate"/,
    "카드의 세금계산서발행일이 칸 편집이 아니다"
  );
});

test("금액(VAT별도)은 칸 편집이 없다 — 표시만 한다(사용자 결정 2026-09-11)", () => {
  assert.equal(listScreen.includes('field="amountExcludingVat"'), false, "표에 금액 칸 편집이 생겼다");
  assert.equal(listScreen.includes('field: "amountExcludingVat"'), false, "카드에 금액 칸 편집이 생겼다");
  assert.match(
    tableBody,
    /<td className="px-3 py-2 text-right tabular-nums"> \{formatAmount\(row\.displayAmountExcludingVat\)\} <\/td>/
  );
  assert.match(cardGroups, /\{ label: "금액\(VAT별도\)", of: \(row\) => formatAmount\(row\.displayAmountExcludingVat\) \}/);
});

test("납기요청일은 표에서 눌러 고친다 — 못 고치는 사람에게는 지금과 같은 글자만", () => {
  // 🔴 2026-10-30 에 프롭이 하나 늘었다(onRequestedDueDateNotLinked) — 수리 건이 못
  //    따라갔을 때의 알림을 **화면 위쪽**이 띄우게 올려 보내는 길이다. 여기 적어 두는
  //    까닭: 빠뜨리면 타입이 막지만, **엉뚱한 상태에 묶는 것**은 타입이 안 막는다.
  assert.match(
    tableBody,
    /\{canEdit \? \( <DomesticOrderDueDatesCell row=\{row\} displayText=\{<DueDateCellContent row=\{row\} \/>\} wrapping="whitespace-nowrap" numeric="tabular-nums" onRequestedDueDateNotLinked=\{setRequestedDueDateNotLinked\} \/> \) : \( <DueDateCellContent row=\{row\} \/> \)\}/
  );
});

test("납기요청일은 카드에서도 눌러 고친다 — 좁은 화면이라고 고칠 수 있던 칸이 사라지지 않는다", () => {
  // 납기요청일 칸 한 덩어리(다음 칸 묶음 `제품` 앞까지)에 편집이 달려 있다.
  const dueDateEntry = sliceBetween(cardGroups, 'label: "납기요청일",', 'label: "제품",');
  // 🔵 2026-10-30 까지 이 칸은 `multiline: true` 인 글자 칸이었고 여기서 그것을
  // 전제로 삼았다. 그날 카드가 표와 **같은 부품**을 쓰게 되면서(납기 역전 경보를
  // 글자로는 같은 세기로 말할 수 없다 — 사용자 결정) 줄 나눔을 그 부품이 제 마디로
  // 한다. 넘길 `\n` 이 없으니 pre-line 은 할 일이 없고, 접는 방식은 pre-line 이 빠진
  // `<dd>`(break-words)와 결과가 같은 값이어야 한다. **이 시험이 지키는 것 둘은
  // 그대로다** — 카드에서도 눌러 고칠 수 있는가, 접는 방식이 `<dd>` 와 같은가.
  assert.ok(
    dueDateEntry.includes("of: (row) => <DueDateCellContent row={row} />"),
    "전제가 깨졌다 — 카드가 표와 같은 부품을 쓰지 않는다"
  );
  assert.equal(
    dueDateEntry.includes("multiline: true"),
    false,
    "마디를 그리는 칸에 pre-line 이 켜져 있다 — <dd> 와 편집칸의 접는 방식이 갈린다"
  );
  assert.ok(
    dueDateEntry.includes('dueDatesEdit: { wrapping: "break-words whitespace-normal" }'),
    "카드의 납기요청일에 편집이 없거나, <dd> 와 다른 접는 방식이다"
  );
  // 🔴 표와 **같은 프롭**을 받아야 한다 — 카드에서 고친 저장만 알림이 안 뜨면,
  //    좁은 화면에서는 수리 건이 안 따라간 것을 아무도 모른다(2026-10-30).
  assert.match(
    cardRender,
    /\{canEdit && field\.dueDatesEdit \? \( (\/\/[^<]*)?<DomesticOrderDueDatesCell row=\{row\} displayText=\{field\.of\(row\)\} wrapping=\{field\.dueDatesEdit\.wrapping\} onRequestedDueDateNotLinked=\{setRequestedDueDateNotLinked\} \/>/
  );
});

test("🔴 납기요청일 편집 목록은 이 줄에 적힌 날짜로만 채운다 — 수리 건 요청일을 읽는 길이 없다", () => {
  // 편집 목록을 채우는 곳은 한 군데이고, 그 함수는 도메인의 것이다.
  assert.match(flat(dueDatesCell), /return domesticOrderDueDateEditDraft\(row\)\.map\(/);
  assert.match(flat(dueDatesCell), /setLines\(linesOf\(row\)\);/);
  // 수리 건의 날짜를 이 파일이 직접 만지는 길이 아예 없다 — 안내에 쓰는 날짜도
  // 도메인 함수가 목록과 같은 규칙으로 정한다.
  assert.equal(
    dueDatesCell.includes("repairCaseCustomerRequestedDueDate"),
    false,
    "수리 건 요청일을 이 파일이 직접 읽는다 — 편집 목록에 섞일 수 있다"
  );
  assert.equal(dueDatesCell.includes("resolveDomesticOrderDueDateDisplay"), false);
  assert.match(flat(dueDatesCell), /const borrowed = domesticOrderDueDateBorrowHint\(row\);/);
});

test("납기요청일 저장은 줄 전체를 싣고 version 을 건다 — 다른 칸과 같은 길이다", () => {
  const source = flat(dueDatesCell);
  assert.match(
    source,
    /updateDomesticOrderAction\(\{ id: row\.id, (\/\/[^}]*)?expectedVersion: row\.version, (\/\/[^}]*)?fields: buildDomesticOrderDueDatesUpdateFields\(row, drafts\), \}\)/
  );
});

test("칸 편집의 클릭은 `줄 수정` 폼으로 새지 않는다 — 여는 버튼과 편집 폼 둘 다", () => {
  const source = flat(dueDatesCell);
  assert.match(source, /function openEditor\(event: MouseEvent<HTMLButtonElement>\) \{ (\/\/[^}]*)?event\.stopPropagation\(\);/);
  assert.match(source, /<form onSubmit=\{handleSubmit\} onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("sr-only 는 relative 가 있는 버튼 안에만 있다 — 문서 바닥에 자리를 주장하지 않는다", () => {
  // 이 파일의 sr-only 는 둘이다: 여는 버튼(공용 값에 relative 가 들어 있다)과
  // 줄마다의 삭제 버튼.
  const occurrences = dueDatesCell.split('className="sr-only"').length - 1;
  assert.equal(occurrences, 2, "sr-only 가 늘었다 — relative 짝을 확인할 것");
  assert.match(flat(dueDatesCell), /className=\{inlineEditCellButtonClass\(wrapping, numeric\)\} > \{displayText\}/);
  assert.match(flat(dueDatesCell), /className=\{`relative flex-none \$\{smallButtonClass\}`\}/);
  // 공용 값에 relative 가 그대로 있다.
  const shared = read("src/components/common/inline-edit-cell-button.ts");
  assert.match(shared, /return `relative -mx-1 block w-full/);
});

test("표의 납기요청일 줄들은 버튼 안에 들어갈 수 있는 모양이다(<div> 가 아니다)", () => {
  const content = sliceBetween(listScreen, "function DueDateCellContent(", "\n}\n");
  // 여는 태그는 주석에도 적혀 있어 닫는 태그로 본다.
  assert.equal(content.includes("</div>"), false, "버튼 안에 <div> 가 들어간다");
  assert.match(content, /<span key=\{index\} className="block">/);
});

/**
 * ============================================================================
 * 🔴 납품일 · 납품자 — 표에서 직접 고친다 (2026-11-08)
 * ============================================================================
 * 사용자 요구: 「**납품일을 표에서 직접 바꿀 수 있도록** 해주고」. 2026-11-07 까지
 * 이 칸에는 칸 편집이 **없었고**(「연결된 줄에서는 못 적는 값이다」), 그 결정이
 * 양방향 연동으로 뒤집혔다.
 *
 * 🔵 두 칸이 **같은 부품**을 연다 — 같은 행의 두 값이라, 따로 열면 한쪽을 저장하는
 * 동안 다른 쪽이 낡은 값을 들고 있게 된다.
 * ============================================================================
 */
const deliveriesCell = read("src/components/domestic-orders/DomesticOrderDeliveriesCell.tsx");

test("🔴 납품일·납품자는 표에서 눌러 고친다 — 두 칸이 같은 편집칸을 연다", () => {
  assert.match(
    tableBody,
    /\{canEdit \? \( <DomesticOrderDeliveriesCell row=\{row\} displayText=\{<DeliveredDateCellContent row=\{row\} \/>\} wrapping="whitespace-nowrap" numeric="tabular-nums" onLinkNotice=\{setRequestedDueDateNotLinked\} \/> \) : \( <DeliveredDateCellContent row=\{row\} \/> \)\}/,
    "표의 납품일이 칸 편집이 아니다"
  );
  assert.match(
    tableBody,
    /\{canEdit \? \( <DomesticOrderDeliveriesCell row=\{row\} displayText=\{<DeliveredByCellContent row=\{row\} \/>\} wrapping="whitespace-nowrap" onLinkNotice=\{setRequestedDueDateNotLinked\} \/> \) : \( <DeliveredByCellContent row=\{row\} \/> \)\}/,
    "표의 납품자가 칸 편집이 아니다"
  );
});

test("🔴 납품일·납품자는 카드에서도 눌러 고친다 — 좁은 화면이라고 사라지지 않는다", () => {
  const deliveredEntry = sliceBetween(cardGroups, 'label: "납품일",', 'label: "정산"');
  assert.ok(
    deliveredEntry.includes("of: (row) => <DeliveredDateCellContent row={row} />"),
    "카드의 납품일이 표와 같은 부품을 쓰지 않는다"
  );
  assert.ok(
    deliveredEntry.includes("of: (row) => <DeliveredByCellContent row={row} />"),
    "카드의 납품자가 표와 같은 부품을 쓰지 않는다"
  );
  // 두 칸 다 편집이 달려 있고, 접는 방식은 `<dd>` 와 결과가 같은 값이다.
  assert.equal(
    deliveredEntry.split('deliveriesEdit: { wrapping: "break-words whitespace-normal" }').length - 1,
    2,
    "카드의 납품 두 칸 중 하나에 편집이 없다"
  );
  // 🔴 표와 **같은 알림 상태**에 묶여야 한다 — 카드에서 고친 저장만 알림이 안 뜨면
  //    좁은 화면에서는 수리 건이 안 따라간 것을 아무도 모른다.
  assert.match(
    cardRender,
    /: canEdit && field\.deliveriesEdit \? \( (\/\/[^<]*)?<DomesticOrderDeliveriesCell row=\{row\} displayText=\{field\.of\(row\)\} wrapping=\{field\.deliveriesEdit\.wrapping\} onLinkNotice=\{setRequestedDueDateNotLinked\} \/>/
  );
});

test("🔴 납품 편집칸은 행을 더하지도 지우지도 않는다 — 행은 납기요청일이 만든다", () => {
  // 그 표의 due_date 가 NOT NULL 이라, 여기서 행을 만들려면 지어낸 납기일이 필요하다.
  const source = flat(stripComments(deliveriesCell));
  assert.equal(source.includes("추가</button>"), false, "납품 편집칸에 [추가] 가 생겼다");
  assert.equal(source.includes("삭제 <span"), false, "납품 편집칸에 [삭제] 가 생겼다");
  // 행이 없으면 **먼저 납기요청일을 적으라**고 말한다 — 빈 자리는 고장으로 읽힌다.
  assert.match(
    flat(deliveriesCell),
    /납기요청일이 없어 납품일을 적을 자리가 없습니다\. 먼저 `납기요청일` 칸에서 날짜를 추가해 주세요\./
  );
});

test("🔴 납품 편집칸도 줄 전체를 싣고 version 을 건다 — 납기요청일 칸과 같은 길이다", () => {
  const source = flat(deliveriesCell);
  assert.match(
    source,
    /updateDomesticOrderAction\(\{ id: row\.id, (\/\/[^}]*)?expectedVersion: row\.version, fields: buildDomesticOrderDueDatesUpdateFields\(row, drafts\), \}\)/
  );
  // 🔴 **네 칸을 전부** 보낸다 — 날짜·메모를 빼면 그 저장이 납기요청일을 지운다.
  //
  // 🔴 **2026-11-08 에 다섯째 칸이 붙었다**(`isCompleted`). 회차별 [완료 처리]가
  //    생기면서 편집 목록이 그 값을 **들고 다니게** 되었는데, 그것은 **서버로 나가지
  //    않는다** — buildDomesticOrderDueDatesUpdateFields 가 네 칸만 옮긴다. 그래서
  //    단언을 약하게 만들지 않고 **방향을 바꿨다**: 「나가는 네 칸이 그대로 있는가」와
  //    「완료는 **나가지 않는가**」를 함께 잰다.
  assert.match(
    source,
    /lines\.map\( \(\{ dueDate, note, deliveredDate, deliveredBy, isCompleted \}\) => \(\{ dueDate, note, deliveredDate, deliveredBy, isCompleted, \}\) \)/
  );
  // 🔴 저장 payload 를 만드는 함수가 **네 칸만** 옮긴다 — 그 보증은 도메인 쪽에 있고
  //    (domain/domestic-order-cell-edit.ts 의 DomesticOrderDueDateDraftPayload), 여기서는
  //    이 칸이 완료를 **직접 fields 에 끼워 넣지 않는지**만 본다.
  assert.ok(
    !/fields: \{[^}]*isCompleted/.test(source),
    "납품 편집칸이 완료 표시를 저장 payload 에 끼워 넣는다 — 승인 없이 완료를 찍는 길이 된다"
  );
  assert.match(source, /function openEditor\(event: MouseEvent<HTMLButtonElement>\) \{ (\/\/[^}]*)?event\.stopPropagation\(\);/);
  assert.match(source, /<form onSubmit=\{handleSubmit\} onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("🔴 막힌 단추 둘은 **까닭을 글로** 보여 준다 — title 만 달면 키보드 사용자에게는 없다", () => {
  const source = flat(dueDatesCell);
  // [삭제] — 납품 기록이 달린 줄(사용자 결정 5).
  assert.match(source, /disabled=\{disabled \|\| removeBlocked !== null\} title=\{removeBlocked \?\? undefined\}/);
  assert.match(source, /\{removeBlocked !== null && <p className=\{cellHintClass\}>\{removeBlocked\}<\/p>\}/);
  // [납기요청일 추가] — 수리 건이 붙은 줄(사용자 결정 9).
  assert.match(
    source,
    /disabled=\{disabled \|\| addBlockedReason !== null\} title=\{addBlockedReason \?\? undefined\}/
  );
  assert.match(
    source,
    /\{addBlockedReason !== null && <p className=\{cellHintClass\}>\{addBlockedReason\}<\/p>\}/
  );
  // 🔴 판정은 화면이 하지 않는다 — 서버가 거절하는 그 함수에 그대로 물어본다.
  assert.match(source, /domesticOrderAddDueDateBlockReason\(\{/);
  assert.match(source, /domesticOrderRemoveDueDateBlockReason\(\{/);
});

test("🔴 `줄 수정` 폼의 같은 두 단추도 같은 함수에 물어본다 — 길마다 갈리면 안 된다", () => {
  const editForm = read("src/components/domestic-orders/DomesticOrderEditForm.tsx");
  const source = flat(editForm);
  assert.match(source, /domesticOrderAddDueDateBlockReason\(\{/);
  assert.match(source, /domesticOrderRemoveDueDateBlockReason\(\{/);
  assert.match(source, /\{removeBlocked !== null && <p className=\{hintClass\}>\{removeBlocked\}<\/p>\}/);
  assert.match(
    source,
    /\{addDueDateBlockedReason !== null && \( <p className=\{hintClass\}>\{addDueDateBlockedReason\}<\/p> \)\}/
  );
  // 🔴 그리고 **따로 서 있던 납품일·납품자 칸이 사라졌다** — 옛 칼럼을 고치는 죽은
  //    단추가 남으면, 글자를 적어도 아무 데도 안 뜬다.
  assert.equal(
    source.includes('renderText("deliveredDate"'),
    false,
    "옛 칼럼을 고치는 납품일 입력칸이 남아 있다"
  );
  assert.equal(
    source.includes('renderText("deliveredBy"'),
    false,
    "옛 칼럼을 고치는 납품자 입력칸이 남아 있다"
  );
});

test("견적서를 따르는 칸의 막음은 편집 여부보다 먼저 본다", () => {
  const lockAt = textCell.indexOf("const quoteLock = domesticOrderInlineEditQuoteLock(row, field);");
  const editingAt = textCell.indexOf("if (!isEditing) {");
  assert.ok(lockAt > 0, "견적서 연결 막음 판정이 없다");
  assert.ok(editingAt > lockAt, "막음 판정이 편집 여부보다 뒤에 있다 — 열려 있던 편집칸이 남는다");
  // 막힌 칸은 버튼이 아니라 글자다(왜 못 고치는지는 title 로 띄운다). 🔴 2026-11-06
  // 전에는 그 글자를 누르면 줄 전체로 올라가 `줄 수정` 이 열렸는데, 줄 누르기가
  // 없어지면서 그 길도 함께 사라졌다 — 연결을 푸는 길은 [수정] 버튼이다.
  const lockedBranch = flat(textCell.slice(lockAt, editingAt));
  assert.match(lockedBranch, /<span title=\{quoteLock\}/);
  assert.equal(lockedBranch.includes("<button"), false);
  assert.equal(lockedBranch.includes("sr-only"), false);
});
