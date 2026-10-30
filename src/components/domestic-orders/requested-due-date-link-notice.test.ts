import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 내자 정리 — 「수리 건이 못 따라갔다」를 **사람이 알게 하는가** (2026-10-30)
 * ============================================================================
 * 저장할 때 두 날짜를 묶는 일은 서버가 한다(db/mutations/domestic-orders.ts).
 * 화면이 할 일은 하나뿐이다 — 서버가 **「못 맞췄다」**를 돌려줬을 때 그것을 **읽고
 * 닫아야 하는 알림**으로 띄우는 것. 조용히 버리면 사람은 「저장했습니다」만 보고
 * 양쪽이 맞춰진 줄 알고, 다음에 수리 건을 열었을 때 제가 고친 적 없는 날짜를 본다.
 *
 * ── 여기서 지키는 것 셋 ─────────────────────────────────────────────────
 *  1. **두 저장 통로가 둘 다** 그 답을 읽는다 — 납기요청일 칸(DomesticOrderDueDatesCell)과
 *     `줄 수정` 폼(DomesticOrderEditForm). 한쪽만 읽으면 어느 길로 고쳤느냐에 따라
 *     알림이 뜨기도 안 뜨기도 한다.
 *  2. 그때 **저장 팝업을 띄우지 않는다**(return 으로 끝난다). 0.5초 뒤 저절로 닫히는
 *     팝업과 읽어야 닫히는 알림이 함께 뜨면 읽어야 하는 글이 가린다
 *     (components/common/NoticePopup.tsx 머리말).
 *  3. 🔴 팝업을 **칸 안에서 그리지 않는다** — 표의 `<td>` 안에서 태어난 대화상자는
 *     칸의 CSS(정렬·줄바꿈 금지)를 물려받아 글이 한쪽으로 쏠린다. 그래서 상태와
 *     그리기는 목록 화면이 가진다(완료 처리가 막혔을 때의 onBlocked 와 같은 길).
 *
 * 표·카드의 두 칸이 그 통로를 **정말 넘겨받는지**는 이웃 시험이 JSX 를 글자 그대로
 * 본다(domestic-order-inline-cells.test.ts).
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 이 파일들은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬 끝의
 * `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는 import
 * 자체가 던진다(이웃 시험들과 같은 방법이다).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const dueDatesCell = read("src/components/domestic-orders/DomesticOrderDueDatesCell.tsx");
const editForm = read("src/components/domestic-orders/DomesticOrderEditForm.tsx");
const listScreen = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");

/**
 * 성공한 저장에서 **「못 맞췄다」를 읽고 먼저 돌아가는가.** 두 통로가 같은 모양을
 * 쓰므로 한 함수로 본다 — 한쪽만 고쳐지면 그 자리에서 깨진다.
 */
function assertReadsLinkOutcomeBeforePopup(source: string, label: string) {
  assert.match(
    flat(source),
    /const link = result\.requestedDueDateLink; if \(link && !link\.linked\) \{ onRequestedDueDateNotLinked\(link\.message\); return; \}/,
    `${label}: 「못 맞췄다」를 읽고 알림으로 올려 보내는 길이 없다`
  );
}

test("🔴 납기요청일 칸은 「수리 건이 못 따라갔다」를 알림으로 올려 보낸다 — 저장 팝업 대신", () => {
  assertReadsLinkOutcomeBeforePopup(dueDatesCell, "납기요청일 칸");
  // 그 분기가 **저장 팝업보다 앞**에 있어야 한다. 뒤에 있으면 둘 다 뜬다.
  const flattened = flat(dueDatesCell);
  assert.ok(
    flattened.indexOf("onRequestedDueDateNotLinked(link.message)") <
      flattened.indexOf('showSavePopup({ message: "납기요청일을 저장했습니다."'),
    "알림이 저장 팝업보다 뒤에 있다 — 두 상자가 함께 뜬다"
  );
});

test("🔴 `줄 수정` 폼도 같은 답을 읽는다 — 어느 길로 고쳤느냐로 갈리지 않는다", () => {
  assertReadsLinkOutcomeBeforePopup(editForm, "줄 수정 폼");
  const flattened = flat(editForm);
  assert.ok(
    flattened.indexOf("onRequestedDueDateNotLinked(link.message)") <
      flattened.indexOf('showSavePopup({ message: row ? "내자 줄을 저장했습니다."'),
    "알림이 저장 팝업보다 뒤에 있다 — 두 상자가 함께 뜬다"
  );
});

test("🔴 팝업은 표 칸이 아니라 **목록 화면**이 그린다 — 칸의 CSS 를 물려받지 않게", () => {
  // 띄우는 쪽(칸 · 폼)에는 대화상자가 없어야 한다. 🔴 **글자를 세지 않고 여는 꺾쇠로**
  // 본다 — 두 파일의 주석이 그 부품을 까닭으로 들고 있어서(「0.5초 팝업으로는 전할 수
  // 없다」), 이름만 세면 주석 때문에 영영 실패한다.
  assert.doesNotMatch(
    dueDatesCell,
    /<NoticePopup/,
    "납기요청일 칸이 제 안에서 팝업을 그린다 — 칸의 정렬·줄바꿈을 물려받는다"
  );
  assert.doesNotMatch(editForm, /<NoticePopup/, "`줄 수정` 폼이 제 안에서 팝업을 그린다");

  // 목록 화면이 상태를 쥐고, 그 상태로 알림을 그린다.
  assert.match(
    listScreen,
    /const \[requestedDueDateNotLinked, setRequestedDueDateNotLinked\] = useState<string \| null>\(null\);/
  );
  assert.match(
    flat(listScreen),
    /\{requestedDueDateNotLinked !== null && \( <NoticePopup title="수리 건의 고객 요청 납기일은 바뀌지 않았습니다" lines=\{\[requestedDueDateNotLinked\]\} onClose=\{\(\) => setRequestedDueDateNotLinked\(null\)\}/,
    "목록 화면이 그 상태로 알림을 그리지 않는다"
  );
  // `줄 수정` 폼도 같은 상태에 묶여 있어야 한다(표·카드의 두 칸은 이웃 시험이 본다).
  // 🔴 `[^>]*` 로 적지 않는다 — 이 태그의 앞 프롭에 `() => …` 가 있어서 꺾쇠가 먼저
  // 걸린다(그 글자가 화살표의 일부다). 길이를 묶은 게으른 짝짓기로 본다.
  assert.match(
    flat(listScreen),
    /<DomesticOrderEditForm[\s\S]{0,400}?onRequestedDueDateNotLinked=\{setRequestedDueDateNotLinked\}/,
    "`줄 수정` 폼이 알림 상태에 묶여 있지 않다"
  );
});

test("🔴 칸 하나를 고치는 열두 칸은 이 길을 타지 않는다 — 날짜를 안 바꾸기 때문이다", () => {
  // DomesticOrderTextCell 은 줄 전체를 되실어 보내지만 **납기요청일은 읽어 온 그대로**다.
  // 서버는 「날짜가 안 바뀐 저장」으로 보고 아무 일도 하지 않으므로 알릴 것도 없다
  // (domain/requested-due-date-link.ts 머리말 ②). 그 전제가 깨지면 이 칸에서도
  // 알림이 떠야 하는데 뜰 자리가 없다 — 그때 이 시험이 먼저 깨진다.
  const textCell = read("src/components/domestic-orders/DomesticOrderTextCell.tsx");
  assert.equal(
    textCell.includes("requestedDueDateLink"),
    false,
    "글자 칸 편집이 묶기 결과를 읽기 시작했다 — 알림을 띄울 자리가 없다"
  );
  assert.match(
    flat(textCell),
    /fields: buildDomesticOrderCellUpdateFields\(row, field, value\)/,
    "글자 칸이 보내는 값이 달라졌다 — 납기요청일을 그대로 되싣는지 다시 볼 것"
  );
});
