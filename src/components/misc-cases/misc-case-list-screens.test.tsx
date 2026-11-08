import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import MiscCaseCardList from "./MiscCaseCardList";
import MiscCaseListScreen, { type MiscCaseListRow } from "./MiscCaseListScreen";
import MiscCaseStatusBadge from "./MiscCaseStatusBadge";
import MiscCaseTable from "./MiscCaseTable";
import { MISC_CASE_FIELDS } from "./misc-case-fields";
import { navItems } from "@/lib/navigation";
import { DOMESTIC_ORDER_NO_MODEL_LINK_LABEL } from "@/lib/domain/domestic-order-detail-link";
import { NO_ORDER_DATE_LABEL } from "@/lib/domain/domestic-order-display";
import {
  MISC_CASE_DEFAULT_SORT,
  MISC_CASE_EMPTY_LABEL,
  MISC_CASE_NO_MATCH_LABEL,
  MISC_CASE_UNASSIGNED_CUSTOMER_VALUE,
} from "@/lib/domain/misc-case-list";
import { MISC_CASE_STATUS_LABELS } from "@/lib/domain/misc-case-status";

/**
 * ============================================================================
 * 「기타건 현황」 — 화면이 서고, 권한이 **제자리에서** 확인되는가 (2026-11-06)
 * ============================================================================
 * 차례 규칙은 도메인 시험이 값으로 잰다(lib/domain/misc-case-list.test.ts). 어느 줄이
 * 이 목록에 들어오는지는 DB 시험이 잰다(db/queries/misc-domestic-orders.integration.test.ts).
 * 여기서 재는 것은 셋이다:
 *
 *  · 🔴 **그 값이 실제로 화면에 나오는가** — 표와 카드를 그려 본다. 조회가 옳고
 *    차례가 옳아도 화면이 안 그리면 사용자에게는 빈 칸이다.
 *  · 🔴 **표와 카드가 갈라지지 않는가** — 이름표와 값이 한 벌에서 오는지
 *    (misc-case-fields.tsx), 같은 줄이 화면 폭에 따라 다르게 읽히지 않는지.
 *  · 🔴 **권한이 질의보다 먼저 서는가** — 사이드바에서 감추는 것은 막은 것이 아니고,
 *    이 표에는 거래 금액과 입금 여부가 있다. 페이지는 서버 컴포넌트라 이 환경에서
 *    그려 볼 수 없어 원본을 글자로 읽는다(이웃 시험들과 같은 사정).
 *
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게
 * 적고 그 글에 함수 이름이 그대로 들어 있다. 걷어내지 않으면 「페이지가 가드를 부른다」가
 * **주석만으로 통과한다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

const flat = (source: string) => source.replace(/\s+/g, " ");
const count = (source: string, needle: string) => source.split(needle).length - 1;
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = indexOrFail(source, startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const page = flat(stripComments(read("src/app/(app)/misc-cases/page.tsx")));

/** 줄 하나. 안 주는 칸은 전부 비어 있다 — 이 표에는 빈 칸이 흔하다. */
function row(id: string, fields: Partial<MiscCaseListRow> = {}): MiscCaseListRow {
  return {
    id,
    repairCaseId: null,
    modelName: null,
    customerName: null,
    status: "IN_PROGRESS",
    displayQuoteNumber: null,
    displayQuoteIssuedDate: null,
    displayIntakeNumber: null,
    purchaseOrderNumber: null,
    orderIssuedDate: null,
    projectName: null,
    progressNote: null,
    displayAmountExcludingVat: null,
    paymentCompleted: false,
    deliveredDateLines: [],
    deliveredByLines: [],
    deliveredDateBorrowed: false,
    serialNumber: null,
    lotNumber: null,
    ...fields,
  };
}

/** 값이 다 찬 줄. 고객사·사람 이름은 전부 지어낸 것이다(이 저장소는 공개다). */
const FULL = row("11111111-1111-4111-8111-111111111111", {
  modelName: "케이블 교체 일식",
  customerName: "가나 테크",
  displayQuoteNumber: "DSS 2026-120",
  displayQuoteIssuedDate: "2026-09-30",
  purchaseOrderNumber: "PO-2026-0007",
  orderIssuedDate: "2026-10-02",
  projectName: "라인 증설",
  progressNote: "발주 대기",
  displayAmountExcludingVat: "1234567.00",
  paymentCompleted: true,
  // 🔴 2026-11-08 — 행마다 하나씩이다. 1차분을 보낸 줄.
  deliveredDateLines: ["2026-10-20"],
  deliveredByLines: ["담당자1"],
  deliveredDateBorrowed: false,
  // 🔴 서버가 접어 보낸 상태다(domain/misc-case-status.ts) — 화면은 이 값을 배지로만
  //    그린다. 접는 규칙 자체는 그 파일의 시험이 값으로 잰다.
  status: "COMPLETED",
});

/** 손으로 [행 추가] 한 줄 — 품명도 발주일도 없다. 개발 DB 에서 더 흔한 모양이다. */
const EMPTY = row("22222222-2222-4222-8222-222222222222");

const SAMPLE = [FULL, EMPTY];

const tableHtml = renderToStaticMarkup(
  <MiscCaseTable rows={SAMPLE} sort={MISC_CASE_DEFAULT_SORT} onSortChange={() => {}} />
);
const cardHtml = renderToStaticMarkup(<MiscCaseCardList rows={SAMPLE} />);

test("🔵 못 — 표본이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
  assert.ok(page.length > 300, `페이지 원본이 너무 짧다(${page.length})`);
  assert.ok(tableHtml.length > 500 && cardHtml.length > 500, "그린 결과가 너무 짧다");
  // 표본이 둘 다 같은 모양이면 아래 「빈 줄도 누를 것이 있다」가 공짜로 통과한다.
  assert.equal(FULL.modelName !== null && EMPTY.modelName === null, true, "표본에 빈 품명 줄이 없다");
  assert.equal(
    count(stripComments('/* requireAreaAccessForCurrentUser */ const a = 1;'), "requireAreaAccessForCurrentUser"),
    0
  );
  assert.equal(
    count(stripComments('  // requireAreaAccessForCurrentUser\nconst a = 1;'), "requireAreaAccessForCurrentUser"),
    0
  );
  assert.equal(
    count(stripComments('await requireAreaAccessForCurrentUser("miscCases");'), "requireAreaAccessForCurrentUser"),
    1
  );
});

describe("🔴 표 — 값이 나오고, 줄마다 기타건 상세로 가는 길이 있다", () => {
  test("품명 칸이 **그 줄의 id** 로 가는 링크다", () => {
    assert.ok(
      tableHtml.includes(`href="/domestic-orders/${FULL.id}"`),
      `품명 링크가 없다: ${tableHtml}`
    );
    assert.ok(tableHtml.includes("케이블 교체 일식"), tableHtml);
    // 줄마다 상세로 가는 링크는 둘(품명 · [상세])이고, 둘 다 같은 곳으로 간다 —
    // 전체 A/S 현황의 인수번호 + [상세] 와 같은 모양이다.
    assert.equal(count(tableHtml, `href="/domestic-orders/${FULL.id}"`), 2, tableHtml);
    assert.equal(count(tableHtml, `href="/domestic-orders/${EMPTY.id}"`), 2, tableHtml);
  });

  test("🔴 품명이 빈 줄도 누를 것이 있다 — 내자 정리와 **같은 글자**", () => {
    assert.ok(
      tableHtml.includes(DOMESTIC_ORDER_NO_MODEL_LINK_LABEL),
      `빈 품명 줄의 링크 글자가 없다: ${tableHtml}`
    );
  });

  test("상태 · 공급처 · 발행 두 칸 · 발주 두 칸 · 금액 · 입금 · 납품일이 나온다", () => {
    for (const value of [
      MISC_CASE_STATUS_LABELS.COMPLETED, // 완료 처리된 줄
      MISC_CASE_STATUS_LABELS.IN_PROGRESS, // 아직 진행 중인 줄
      "가나 테크",
      "DSS 2026-120",
      "2026-09-30",
      "PO-2026-0007",
      "2026-10-02",
      "라인 증설",
      "발주 대기",
      "1,234,567", // 금액 서식 — 세 자리마다 쉼표, 소수점 이하 0 은 적지 않는다
      "2026-10-20",
      // 🔴 2026-11-08 에 생긴 칸 — 납품자. 분할 납품은 기타건에서만 생기므로
      //    여러 줄이 실제로 서는 곳이 이 화면이다(사용자 결정 9).
      "담당자1",
    ]) {
      assert.ok(tableHtml.includes(value), `표에 ${value} 가 없다`);
    }
    // 🔴 카드에서도 같은 두 값이 보인다 — 좁은 화면이라고 칸이 사라지면 같은 줄이
    //    화면 폭에 따라 다르게 읽힌다.
    assert.ok(cardHtml.includes("2026-10-20"), "카드에 납품일이 없다");
    assert.ok(cardHtml.includes("담당자1"), "카드에 납품자가 없다");
    // 발주일이 없는 줄은 "-" 가 아니라 「발주일 미정」이다(내자 정리와 같은 글자).
    assert.ok(tableHtml.includes(NO_ORDER_DATE_LABEL), tableHtml);
  });

  test("🔴 [품명]은 **파란 밑줄이 아니다** — A/S 현황의 인수번호와 같은 모양이다", () => {
    // 2026-11-06 사용자 지정: 「[품명]을 하이퍼링크처럼 파란색에 밑줄로 표시하지 말고
    // a/s 현황의 인수번호가 표에 표시되는 것처럼 해줘」.
    const modelLink = sliceBetween(
      flat(stripComments(read("src/components/misc-cases/misc-case-fields.tsx"))),
      "export function MiscCaseModelLink(",
      "export type MiscCaseField"
    );
    const miscClass = /className="([^"]+)"/.exec(modelLink)?.[1];
    assert.ok(miscClass, modelLink);
    const miscTokens = miscClass.split(" ");

    assert.equal(miscTokens.includes("text-blue-700"), false, "아직 파란색이다");
    // 🔴 밑줄은 **마우스를 올렸을 때만**이다. `hover:underline` 과 섞이지 않게
    //    **토큰으로** 본다 — 글자 포함으로 보면 hover 쪽이 걸려 늘 통과한다.
    assert.equal(miscTokens.includes("underline"), false, miscClass);
    assert.ok(miscTokens.includes("hover:underline"), miscClass);

    // 🔴 **본보기와 같은 글자인지 원본끼리 맞댄다** — 눈으로 베끼면 한쪽만 바뀐다.
    //    저쪽의 whitespace-nowrap 만 뺀 나머지가 같아야 한다(품명은 문장이 들어오는
    //    칸이라 안 접으면 그 칸 하나가 표를 옆으로 늘린다 — 그 파일의 ⚠️).
    const repairCaseTable = flat(stripComments(read("src/components/repair-cases/RepairCaseTable.tsx")));
    const intakeClass = /href=\{`\/repair-cases\/\$\{row\.id\}`\} className="([^"]+)"/.exec(repairCaseTable)?.[1];
    assert.ok(intakeClass, "A/S 현황의 인수번호 링크를 찾지 못했다");
    assert.deepEqual(
      [...miscTokens].sort(),
      intakeClass.split(" ").filter((token) => token !== "whitespace-nowrap").sort()
    );
  });

  test("🔴 상태가 **배지**다 — 글자만 적지 않는다", () => {
    // 2026-11-06 사용자 지정: 「상태를 베찌 모양으로 해주고」.
    const badge = renderToStaticMarkup(<MiscCaseStatusBadge status="SHIPMENT_APPROVAL_PENDING" />);
    assert.match(badge, /^<span class="[^"]*rounded-full[^"]*">출하 승인 대기<\/span>$/);
    // 표 안의 상태 칸도 그 배지다 — 글자만 있으면 알약 클래스가 안 나온다.
    const statusCell = renderToStaticMarkup(<>{MISC_CASE_FIELDS.status.of(FULL)}</>);
    assert.ok(statusCell.includes("rounded-full"), statusCell);
    assert.ok(statusCell.includes(MISC_CASE_STATUS_LABELS.COMPLETED), statusCell);
  });

  test("머리글이 아홉이고, 처음 서는 차례가 발행일자 내림차순이다", () => {
    // `<th ` 로 센다 — `<th` 로 세면 `<thead` 가 함께 걸려 하나 더 나온다.
    assert.equal(count(tableHtml, "<th "), 9, tableHtml);
    // 기본 차례의 칸에만 ▼ 가 붙는다 — 붙지 않으면 어느 차례로 서 있는지 화면이
    // 말하지 않는 것이다.
    assert.equal(count(tableHtml, "▼"), 1, tableHtml);
    assert.equal(count(tableHtml, "▲"), 0, tableHtml);
  });
});

describe("🔴 카드 — 같은 줄이 화면 폭에 따라 다르게 읽히지 않는다", () => {
  test("표에 나온 값이 카드에도 그대로 나온다", () => {
    for (const value of [
      "케이블 교체 일식",
      "가나 테크",
      "DSS 2026-120",
      "2026-09-30",
      "PO-2026-0007",
      "1,234,567",
      MISC_CASE_STATUS_LABELS.COMPLETED,
      NO_ORDER_DATE_LABEL,
      DOMESTIC_ORDER_NO_MODEL_LINK_LABEL,
    ]) {
      assert.ok(cardHtml.includes(value), `카드에 ${value} 가 없다`);
    }
  });

  test("🔴 이름표가 한 벌에서 온다 — 표와 카드에 같은 글자로 나온다", () => {
    // ⚠️ `품명` 만은 카드에 **이름표가 없다.** 카드의 머리에 값만 크게 서기
    //    때문이고(내자 정리의 카드도 인수번호를 그렇게 그린다), 그 값이 실제로
    //    서는지는 바로 아래 시험이 링크로 잰다.
    for (const [key, field] of Object.entries(MISC_CASE_FIELDS)) {
      assert.ok(tableHtml.includes(field.label), `표에 이름표 ${field.label} 가 없다`);
      if (key === "modelName") continue;
      assert.ok(cardHtml.includes(field.label), `카드에 이름표 ${field.label} 가 없다`);
    }
    // 🔵 못 — 위 반복이 실제로 돌았는가(칸이 통째로 비면 아무것도 안 재고 통과한다).
    assert.ok(Object.keys(MISC_CASE_FIELDS).length >= 10, "보여 줄 칸이 너무 적다");
  });

  test("카드에서도 품명이 그 줄의 상세로 간다", () => {
    assert.ok(cardHtml.includes(`href="/domestic-orders/${FULL.id}"`), cardHtml);
  });
});

describe("🔴 화면 — 건수와 0건일 때의 말", () => {
  test("건수를 말한다", () => {
    const html = renderToStaticMarkup(<MiscCaseListScreen rows={SAMPLE} />);
    assert.ok(html.includes("기타건 2건"), html);
    // 표가 함께 그려진다 — 건수만 맞고 목록이 비는 화면이 아니다.
    assert.ok(html.includes("케이블 교체 일식"), html);
  });

  test("🔴 0건이면 **말을 한다** — 빈 화면으로 두지 않는다", () => {
    const html = renderToStaticMarkup(<MiscCaseListScreen rows={[]} />);
    assert.ok(html.includes(MISC_CASE_EMPTY_LABEL), html);
    assert.ok(html.includes("기타건 0건"), html);
    // 🔴 조건을 아무것도 안 건 상태에서는 「필터 초기화」를 **빈 상자 안에** 내밀지
    //    않는다 — 풀 것이 없는데 단추가 있으면 사람은 자기가 무언가 걸어 둔 줄 안다.
    //    (거르개 카드 안의 같은 이름 단추는 늘 있으므로, 상자 안쪽만 잘라서 본다.)
    const emptyBox = sliceBetween(html, MISC_CASE_EMPTY_LABEL, "</div>");
    assert.equal(emptyBox.includes("필터 초기화"), false, emptyBox);
    // 자료가 없는 것과 조건에 안 걸리는 것은 **다른 말**이다(둘 다 쓰이는 자리가 있다).
    assert.equal(html.includes(MISC_CASE_NO_MATCH_LABEL), false, html);
  });
});

describe("🔴 거르개 — 상태 · 공급처 (2026-11-06 사용자 요구)", () => {
  const html = renderToStaticMarkup(<MiscCaseListScreen rows={SAMPLE} />);

  test("상태 고르개에 여섯 상태가 **전부** 선다", () => {
    assert.ok(html.includes('id="misc-case-status"'), html);
    for (const label of Object.values(MISC_CASE_STATUS_LABELS)) {
      assert.ok(html.includes(`>${label}</option>`), `상태 고르개에 ${label} 이 없다`);
    }
    // 「전체」가 없으면 한 번 고른 뒤 되돌릴 길이 없다. (React 가 고른 칸에
    // `selected=""` 를 붙이므로 글자만 본다.)
    assert.ok(html.includes(">전체</option>"), html);
  });

  test("🔴 공급처 고르개는 **지금 떠 있는 줄에서** 뽑는다", () => {
    assert.ok(html.includes('id="misc-case-customer"'), html);
    // 표본의 두 줄 중 하나에만 공급처가 있다 — 그 이름 하나와 「미지정」이 선다.
    assert.ok(html.includes('value="가나 테크"'), html);
    assert.ok(html.includes(`value="${MISC_CASE_UNASSIGNED_CUSTOMER_VALUE}"`), html);
    // 🔵 못 — 표본에 없는 이름이 섞여 있으면 고객사 마스터를 끌어온 것이다.
    assert.equal(html.includes("다라 전자"), false, html);
  });

  test("🔴 공급처 목록을 **거르기 전의 줄**에서 뽑는다 — 원본 글자로 못을 박는다", () => {
    /**
     * 그린 화면만 보아서는 이 규칙을 잴 수 없다. 조건을 걸어 본 뒤의 선택지를 보려면
     * 실제로 눌러야 하는데(조건은 상태다), 이 환경에는 눌러 볼 수단이 없다.
     * 그래서 **어느 배열을 넘기는지**를 원본에서 본다 — 거른 뒤의 배열을 넘기면 한
     * 공급처를 고르는 순간 다른 이름이 선택지에서 사라져 되돌릴 수 없다.
     */
    const screen = flat(stripComments(read("src/components/misc-cases/MiscCaseListScreen.tsx")));
    assert.ok(screen.includes("collectMiscCaseCustomerOptions(rows), [rows])"), screen);
    for (const wrong of ["collectMiscCaseCustomerOptions(sortedRows", "collectMiscCaseCustomerOptions(filteredRows", "collectMiscCaseCustomerOptions(pagedRows"]) {
      assert.equal(screen.includes(wrong), false, `거른 뒤의 줄에서 뽑는다: ${wrong}`);
    }
  });

  test("좁은 화면에서 접는 부품을 **그대로** 쓴다 — 전체 A/S 현황과 같은 모양", () => {
    // FilterDisclosure 가 그리는 단추다(그 파일의 글자). 새로 만든 접기였다면 이
    // 글자가 안 나온다.
    assert.ok(html.includes("상세 조건"), html);
    assert.ok(html.includes("더보기"), html);
  });
});

describe("🔴 페이지 — 가드가 질의보다 먼저 선다", () => {
  test("`miscCases` READ 를 묻고, 그 한 줄이 조회보다 **앞**이다", () => {
    assert.equal(count(page, 'requireAreaAccessForCurrentUser("miscCases")'), 1, page);
    assert.ok(
      indexOrFail(page, 'requireAreaAccessForCurrentUser("miscCases")') <
        indexOrFail(page, "listMiscDomesticOrders()"),
      "질의가 가드보다 먼저 돈다 — 막기 전에 읽는다"
    );
  });

  test("🔴 기타건만 읽는 조회를 부른다 — 내자 정리 목록 조회가 아니다", () => {
    assert.equal(count(page, "listMiscDomesticOrders"), 2, "부르는 곳(그리고 import)이 하나가 아니다");
    assert.equal(
      count(page, "listDomesticOrders("),
      0,
      "내자 정리 전체 목록을 읽는다 — 수리 건이 붙은 줄이 섞인다"
    );
  });

  test("정적으로 캐시되지 않는다", () => {
    assert.ok(page.includes('export const dynamic = "force-dynamic"'), page);
  });

  test("🔴 메뉴의 주소와 실제 경로가 같다 — 갈리면 눌러서 404 가 난다", () => {
    const item = navItems.find((candidate) => candidate.key === "miscCases");
    assert.ok(item, "메뉴에 기타건 현황이 없다");
    // 메뉴가 가리키는 주소로 파일을 찾는다. 폴더 이름을 바꾸면 여기서 던진다 —
    // 주소를 손으로 적어 두면 둘이 갈라져도 아무 데서도 티가 나지 않는다.
    const fromMenu = read(`src/app/(app)${item.href}/page.tsx`);
    assert.ok(fromMenu.includes("MiscCaseListScreen"), "메뉴 주소의 페이지가 이 화면이 아니다");
    // 가드의 열쇠도 메뉴 열쇠와 **같은 글자**여야 한다(갈리면 아무에게도 안 보인다).
    assert.ok(page.includes(`requireAreaAccessForCurrentUser("${item.key}")`), page);
  });
});
