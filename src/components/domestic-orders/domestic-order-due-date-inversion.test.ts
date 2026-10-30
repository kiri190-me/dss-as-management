import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DUE_DATE_INVERSION_NOTE,
  DUE_DATE_INVERSION_NOTE_CLASS,
  DUE_DATE_INVERSION_SHORT_NOTE,
} from "@/lib/domain/due-date-inversion";
import { DUE_DATE_NEAR_TEXT_CLASS } from "@/components/repair-cases/due-date-near";

/**
 * ============================================================================
 * 내자 정리 `납기요청일` — 납기 역전이면 날짜가 붉어지고 「협의 필요」가 붙는다
 * (2026-10-30)
 * ============================================================================
 * 사용자 요구: 「사내 목표 출하일이 고객 요청 납기일보다 늦으면 수리 건 상세와
 * **내자정리**의 그 날짜를 빨간 볼드로, 옆에 『납기 요청일 협의가 필요합니다.』」.
 * 수리 건 상세 쪽은 이웃 시험이 본다(repair-cases/detail/due-date-inversion-note.test.ts).
 * 판정 자체는 값으로 domain/due-date-inversion.test.ts 가 재고, 여기서는 **그 판정이
 * 표와 카드까지 닿는 사슬**을 본다.
 *
 * ── 🔴 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * 그려 볼 수 없다. DomesticOrderListScreen 은 서버 액션을 import 하는 클라이언트
 * 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * test:components 에서는 import 자체가 던진다. 이웃 둘이 같은 자리에서 같은 방법을
 * 쓴다(domestic-order-inline-cells.test.ts · domestic-order-trash.test.ts).
 *
 * 🔴 **주석을 걷어 낸 코드만 본다.** 이 파일들은 주석에 규칙을 글자로 적어 두므로
 * 날것으로 찾으면 **화면에서 사라져도 주석에 걸려 통과한다**(이 저장소가 실제로 겪은
 * 함정 — source-text 검사가 주석을 먼저 세던 일).
 *
 * 🔴 못 박는 것 일곱
 *  ① 판정을 화면이 **다시 적지 않는다** — 도메인 함수 하나를 부른다. 두 날짜를 직접
 *    견주는 화면이 생기면 같은 건이 화면마다 다른 말을 한다.
 *  ② 말도 옷도 **도메인 상수**다 — 글자가 화면에 박히면 네 자리가 다른 말을 한다.
 *  ③ 🔴 **역전이 아니면 HTML 이 예전과 한 글자도 다르지 않다** — 조건 안에서만
 *    더한다. 이 칸은 모든 줄이 함께 쓰므로 평소 모양이 바뀌면 표 전체가 바뀐다.
 *  ④ 빌려 왔다는 꼬리표는 **함께 붉어지지 않는다** — 경보가 아니라 출처 표시다.
 *  ⑤ 표와 카드가 **같은 말**을 쓴다 — 좁은 화면이라고 다른 말로 적지 않는다.
 *  ⑥ 🔴 표에는 **짧은 말**만 그린다 — 22칼럼짜리 표라 긴 문장을 넣으면 그 칼럼만
 *    넓어져 표가 옆으로 길어진다. 긴 문장은 title 로 간다.
 *  ⑦ 🔴 **납기일을 여럿 추가하는 기능은 건드리지 않았다** — 편집 조각은 역전을
 *    모른다(분할 납품하는 별도 건이 쓰는 기능이다).
 *
 * 🔴 조회가 재료를 **실제로** 싣고 오는지는 DB 시험이 본다
 * (db/queries/domestic-orders.integration.test.ts). 여기서는 칸이 질의에 적혀
 * 있는지만 센다 — 빠지면 화면은 오류 없이 영영 평범한 검은 글자로 남는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);

/** 주석을 걷어 낸 원본. 블록 주석과 줄 주석을 둘 다 뗀다. */
function codeOf(path: string): string {
  const raw = readFileSync(new URL(path, repoUrl), "utf8").replace(/\r\n/g, "\n");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 한 칸으로 접는다. */
function flatten(code: string): string {
  return code.replace(/\s+/g, " ");
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
}

const screen = codeOf("src/components/domestic-orders/DomesticOrderListScreen.tsx");
const dueDatesCell = codeOf("src/components/domestic-orders/DomesticOrderDueDatesCell.tsx");
const query = codeOf("src/lib/db/queries/domestic-orders.ts");

/** 표의 `납기요청일` 칸을 그리는 조각 하나. */
const tableCell = flatten(
  sliceBetween(screen, "function DueDateCellContent(", "function OrderIssuedDateContent(")
);
/** 카드의 `납기요청일` 칸 한 덩어리(다음 칸 묶음 `제품` 앞까지). */
const cardField = flatten(sliceBetween(screen, 'label: "납기요청일",', 'label: "제품",'));

describe("내자 정리 납기요청일 — 납기 역전이 화면까지 닿는 사슬", () => {
  test("표본 확인 — 주석을 걷어 낸 코드에서 표와 카드의 그 칸이 실제로 잡힌다", () => {
    // 아래 단언들이 빈 글자를 뒤지다 전부 초록색이 되는 일을 막는다.
    assert.ok(tableCell.includes("resolveDomesticOrderDueDateDisplay(row)"), tableCell);
    assert.ok(cardField.includes("hint: DOMESTIC_ORDER_DUE_DATE_LINK_NOTE"), cardField);
  });

  test("🔴 판정을 화면이 다시 적지 않는다 — 도메인 함수 하나를 부른다", () => {
    assert.ok(
      screen.includes('from "@/lib/domain/due-date-inversion"'),
      "화면이 공용 판정을 가져오지 않는다"
    );
    assert.ok(tableCell.includes("isDomesticOrderDueDateInverted(row)"), tableCell);
    // 카드는 제 손으로 부르지 않는다 — 표와 **같은 부품**에 통째로 맡긴다(아래 시험).
    // 두 날짜를 화면이 직접 견주면 빌려 오기·출하 거르기가 두 벌이 된다.
    assert.ok(
      !/internalTargetShipmentDate\s*[<>]/.test(screen),
      "화면이 두 날짜를 직접 견준다"
    );
    assert.equal(
      screen.includes("isRepairCaseShipmentFinished"),
      false,
      "화면이 출하 여부를 제 손으로 가른다 — 거르는 일은 판정 함수 안이다"
    );
  });

  test("🔴 말도 옷도 도메인 상수다 — 화면에 글자로 박히지 않았다", () => {
    for (const literal of [DUE_DATE_INVERSION_SHORT_NOTE, DUE_DATE_INVERSION_NOTE]) {
      assert.equal(
        screen.includes(literal),
        false,
        `경보 글자가 화면에 박혔다("${literal}") — 상수를 쓸 것`
      );
    }
    assert.ok(tableCell.includes("className={DUE_DATE_INVERSION_NOTE_CLASS}"), tableCell);
    assert.equal(
      screen.includes(DUE_DATE_INVERSION_NOTE_CLASS),
      false,
      "클래스 글자가 화면에 다시 적혔다 — 한쪽만 고쳐지는 날이 온다"
    );
    assert.equal(
      screen.includes(DUE_DATE_NEAR_TEXT_CLASS),
      false,
      "굵은 붉은색 한 벌이 화면에 다시 적혔다 — 임박과 역전이 다른 색이 된다"
    );
    assert.ok(
      screen.includes('from "@/components/repair-cases/due-date-near"'),
      "날짜가 입는 옷을 수리 건 쪽과 같은 자리에서 가져오지 않는다"
    );
  });

  test("🔴 역전이 아니면 HTML 이 예전과 한 글자도 다르지 않다 — 조건 안에서만 더한다", () => {
    // 날짜를 감싸는 마디: 거짓일 때는 글자 그대로다(감싸는 <span> 이 없다).
    assert.ok(
      tableCell.includes(
        "{inverted ? <span className={DUE_DATE_NEAR_TEXT_CLASS}>{line}</span> : line}"
      ),
      tableCell
    );
    // 메모 줄: 참일 때만 그려진다.
    assert.ok(tableCell.includes("{inverted && ("), tableCell);
    // 카드도 자동으로 같다 — 같은 부품을 쓰므로 여기 한 벌만 보면 된다(아래 시험).
  });

  test("🔴 빌려 왔다는 꼬리표는 함께 붉어지지 않는다 — 경보가 아니라 출처 표시다", () => {
    const badge = sliceBetween(tableCell, "{display.borrowed && (", "{inverted && (");
    assert.ok(badge.includes("className={borrowedBadgeClass}"), badge);
    assert.equal(
      badge.includes("DUE_DATE_NEAR_TEXT_CLASS"),
      false,
      "출처 꼬리표까지 굵은 붉은색이 됐다 — 고쳐야 할 것으로 읽힌다"
    );
    // 읽는 차례 — 날짜 → 어디서 온 값인가 → 그래서 무엇을 해야 하는가.
    assert.ok(
      tableCell.indexOf("{display.borrowed && (") < tableCell.indexOf("{inverted && ("),
      "경보가 출처 표시보다 앞에 끼어들었다"
    );
  });

  test("🔴 표와 카드가 같은 부품을 쓴다 — 좁은 화면이라고 약한 경보가 되지 않는다", () => {
    // 2026-10-30 사용자 결정. 그 전까지 카드는 글자 한 줄로만 적었고(카드에는 배지도
    // 색도 두지 않는다는 규칙), 그때는 양쪽이 같은 **말**을 쓰는지까지만 볼 수 있었다.
    // 이제는 같은 **마디**라 갈라질 데가 없다 — 카드는 칸들이 세로로 서므로 이 칸만
    // 높아져도 옆줄이 밀리지 않는다는 것이 그 결정의 까닭이다.
    assert.ok(tableCell.includes("{DUE_DATE_INVERSION_SHORT_NOTE}"), tableCell);
    assert.ok(cardField.includes("of: (row) => <DueDateCellContent row={row} />"), cardField);

    // 🔴 카드가 날짜를 제 손으로 만들거나 판정을 다시 부르면 그날로 두 벌이 된다.
    for (const forbidden of [
      "resolveDomesticOrderDueDateDisplay",
      "isDomesticOrderDueDateInverted",
      "DUE_DATE_INVERSION_SHORT_NOTE",
      "DUE_DATE_FROM_REPAIR_CASE_LABEL",
    ]) {
      assert.equal(
        cardField.includes(forbidden),
        false,
        `카드가 ${forbidden} 를 따로 쓴다 — 표와 갈라진다`
      );
    }

    // 줄 나눔을 부품이 제 마디로 하므로 pre-line 은 할 일이 없다. 켜 두면 `<dd>` 와
    // 편집칸의 접는 방식만 둘로 갈린다(화면 쪽 of 의 ⚠️).
    assert.equal(cardField.includes("multiline: true"), false, cardField);
    assert.ok(cardField.includes('wrapping: "break-words whitespace-normal"'), cardField);
  });

  test("🔴 표에는 짧은 말만 그린다 — 긴 문장은 title 로 간다(칼럼을 늘리지 않는다)", () => {
    assert.ok(tableCell.includes("title={DUE_DATE_INVERSION_SHORT_NOTE_TITLE}"), tableCell);
    // 긴 문장을 그리는 상수가 이 칸에 들어오면 그 칼럼만 넓어진다.
    assert.equal(
      tableCell.includes("{DUE_DATE_INVERSION_NOTE}"),
      false,
      "표 칸에 긴 문장을 그린다 — 22칼럼 표가 옆으로 길어진다"
    );
    // 버튼 안에 들어가는 자리라 <div> 를 둘 수 없다(이웃 시험이 보는 규칙과 같다).
    assert.equal(tableCell.includes("</div>"), false, "버튼 안에 <div> 가 들어간다");
  });

  test("🔴 납기일을 여럿 추가하는 편집은 건드리지 않았다 — 그 조각은 역전을 모른다", () => {
    // 분할 납품하는 별도 건이 쓰는 기능이다(2026-10-30 사용자 확인). 경보를 붙이면서
    // 그 단추·폼을 막거나 없애지 않는다 — 편집 조각은 예전 그대로다.
    for (const forbidden of ["due-date-inversion", "isDomesticOrderDueDateInverted"]) {
      assert.equal(
        dueDatesCell.includes(forbidden),
        false,
        `납기요청일 편집 조각이 역전을 알게 됐다: ${forbidden}`
      );
    }
    assert.ok(dueDatesCell.includes("function addLine()"), "날짜 추가가 사라졌다");
  });

  test("🔴 조회가 재료를 싣고 온다 — 빠지면 화면은 오류 없이 검은 글자로 남는다", () => {
    for (const column of [
      "repairCaseInternalTargetShipmentDate: repairCases.internalTargetShipmentDate",
      "repairCaseStatus: workflowSteps.repairStatus",
      // 셋이 한 묶음이다 — 출하 여부는 상태와 실제 출하일을 함께 봐야 안다.
      "repairCaseActualShipmentDate: repairCases.actualShipmentDate",
      "repairCaseCustomerRequestedDueDate: repairCases.customerRequestedDueDate",
    ]) {
      assert.ok(query.includes(column), `내자 목록 조회가 ${column} 를 안 골라 온다`);
    }
    // 상태는 조인이 있어야 온다. 🔴 **LEFT 여야 한다** — INNER 면 연결 없는 줄이
    // 목록에서 통째로 사라진다(그 줄은 사람이 이어 붙여야 하는 줄이다).
    assert.ok(
      query.includes(
        "leftJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))"
      ),
      "단계 조인이 없거나 LEFT 가 아니다"
    );
  });
});
