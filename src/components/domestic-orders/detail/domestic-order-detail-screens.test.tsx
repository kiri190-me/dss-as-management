import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import DomesticOrderBasicInfoView from "./DomesticOrderBasicInfoView";
import DomesticOrderDetailHeader from "./DomesticOrderDetailHeader";
import DomesticOrderDetailNotice from "./DomesticOrderDetailNotice";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import type { DomesticOrderBasicInfoRow } from "@/lib/domain/domestic-order-basic-info";
import { MISC_CASE_STATUS_LABELS } from "@/lib/domain/misc-case-status";

/**
 * ============================================================================
 * 「기타건 상세」 — 화면이 서고, 권한이 **제자리에서** 다시 확인되는가 (2026-11-06)
 * ============================================================================
 * 값(머리 넷 · 기본정보 묶음)은 도메인 시험이 잰다
 * (lib/domain/domestic-order-basic-info.test.ts). 여기서 재는 것은 둘이다:
 *
 *  · 🔴 **그 값이 실제로 화면에 나오는가** — 머리 카드와 기본정보 탭을 그려 본다.
 *    도메인이 옳은 묶음을 내놓아도 화면이 안 그리면 사용자에게는 빈 화면이다.
 *  · 🔴 **권한이 페이지마다 다시 확인되는가** — 레이아웃이 탭을 감추는 것은 관문이
 *    아니다. 주소를 직접 치면 그대로 들어와지고, 이 표에는 거래 금액과 입금 여부가
 *    있다. 페이지는 서버 컴포넌트라 이 환경에서 그려 볼 수 없어 원본을 글자로 읽는다
 *    (이웃 시험들과 같은 사정).
 *
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게
 * 적어 두고 그 글에 함수 이름이 그대로 들어 있다. 걷어내지 않으면 「페이지가 가드를
 * 부른다」가 **주석만으로 통과한다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
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

const ROUTE_DIR = "src/app/(app)/domestic-orders/[id]";
const layout = flat(stripComments(read(`${ROUTE_DIR}/layout.tsx`)));
const basicInfoPage = flat(stripComments(read(`${ROUTE_DIR}/page.tsx`)));
const quotesPage = flat(stripComments(read(`${ROUTE_DIR}/quotes/page.tsx`)));
const purchaseOrdersPage = flat(stripComments(read(`${ROUTE_DIR}/purchase-orders/page.tsx`)));
const approvalPage = flat(stripComments(read(`${ROUTE_DIR}/approval/page.tsx`)));
const tabs = flat(stripComments(read("src/components/domestic-orders/detail/DomesticOrderDetailTabs.tsx")));

const PAGES = [
  ["기본정보", basicInfoPage],
  ["견적서", quotesPage],
  ["발주서", purchaseOrdersPage],
  ["승인", approvalPage],
] as const;

const ROW: DomesticOrderBasicInfoRow = {
  displayOrder: 12,
  displayIntakeNumber: null,
  customerName: "가나 테크",
  completedAt: null,
  purchaseOrderNumber: "PO-2026-0007",
  projectName: "라인 증설",
  orderIssuedDate: "2026-10-02",
  dueDates: [{ dueDate: "2026-11-10", note: "1차분" }],
  repairCaseCustomerRequestedDueDate: null,
  modelName: "케이블 교체 일식",
  lotNumber: "LN-1",
  serialNumber: "SN-1",
  reportedSymptom: "전원 불량",
  displayQuoteIssuedDate: "2026-09-30",
  displayQuoteNumber: "DSS 2026-120",
  progressNote: "발주 대기",
  // 🔴 2026-11-08 — 납품 둘은 행마다 하나씩이다. 행이 없는 줄이라 빈 목록.
  deliveredDateLines: [],
  deliveredByLines: [],
  deliveredDateBorrowed: false,
  taxInvoiceDate: null,
  displayAmountExcludingVat: "1234567.00",
  paymentCompleted: false,
  japanRemittanceNote: null,
  historyNote: null,
  etcNote: null,
};

test("🔵 못 — 읽어 온 원본 다섯이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
  for (const [name, source] of [["layout", layout], ...PAGES, ["tabs", tabs]] as const) {
    assert.ok(source.length > 300, `${name} 원본이 너무 짧다(${source.length})`);
  }
  assert.equal(count(stripComments("/* requireAreaAccessForCurrentUser */ const a = 1;"), "requireAreaAccessForCurrentUser"), 0);
  assert.equal(count(stripComments('  // requireAreaAccessForCurrentUser\nconst a = 1;'), "requireAreaAccessForCurrentUser"), 0);
  assert.equal(count(stripComments('await requireAreaAccessForCurrentUser("domesticOrders");'), "requireAreaAccessForCurrentUser"), 1);
});

describe("🔴 머리 — 품명 · 공급처 · 발행일자 · 발행번호가 화면에 나온다", () => {
  const html = renderToStaticMarkup(<DomesticOrderDetailHeader row={ROW} />);

  test("이름표 넷과 값 넷이 그려진다", () => {
    for (const label of ["품명", "공급처", "발행일자", "발행번호"]) {
      assert.ok(html.includes(`>${label}</span>`), `${label} 이름표가 없다: ${html}`);
    }
    for (const value of ["케이블 교체 일식", "가나 테크", "2026-09-30", "DSS 2026-120"]) {
      assert.ok(html.includes(value), `${value} 가 없다: ${html}`);
    }
  });

  test("🔴 견적서 없이 손으로 더한 줄에서도 넷이 그대로 선다", () => {
    const hand = renderToStaticMarkup(
      <DomesticOrderDetailHeader
        row={{
          modelName: "RFG-7",
          customerName: "다라 전자",
          displayQuoteIssuedDate: null,
          displayQuoteNumber: null,
        }}
      />
    );
    for (const label of ["품명", "공급처", "발행일자", "발행번호"]) {
      assert.ok(hand.includes(`>${label}</span>`), `${label} 이름표가 없다: ${hand}`);
    }
    assert.ok(hand.includes("RFG-7"), hand);
    assert.ok(hand.includes("다라 전자"), hand);
    // 비어 있는 둘은 "-" 로 서 있다 — 알약째 사라지지 않는다.
    assert.equal(count(hand, ">-</span>"), 2, hand);
  });

  test("이 화면의 `<h1>` 은 하나다 — 탭 안의 상자는 `<h2>` 로 선다", () => {
    assert.equal(count(html, "<h1"), 1, html);
    const notice = renderToStaticMarkup(
      <DomesticOrderDetailNotice title="견적서" description="다음 조각에서 채웁니다." />
    );
    assert.equal(count(notice, "<h1"), 0, notice);
    assert.equal(count(notice, "<h2"), 1, notice);
  });
});

describe("🔴 머리 — 상태 배지 (2026-11-06 사용자 요구)", () => {
  /**
   * 「[기타건 최종 출하 승인]요청을 누르면 **[출하 승인 대기]** 베찌가 뜨도록 해줘
   * (기타건 상세의 헤드와 기타건 현황 목록에) 그리고 출하 승인이 모두 완료되면
   * **[출하 대기]**로 베찌가 바뀌도록 해줘」.
   *
   * 🔴 **접는 규칙은 여기서 재지 않는다** — 값으로 재는 자리는 도메인 시험이다
   * (lib/domain/misc-case-status.test.ts). 여기서 보는 것은 **그 답이 이 카드에
   * 실제로 나오는가**와, 레이아웃이 그 값을 **실제로 넘기는가**다. 둘 중 하나만
   * 맞으면 배지는 영영 안 뜬다.
   */
  test("요청 중이면 「출하 승인 대기」, 승인이 끝나면 「출하 대기」", () => {
    const pending = renderToStaticMarkup(
      <DomesticOrderDetailHeader row={ROW} status="SHIPMENT_APPROVAL_PENDING" />
    );
    assert.ok(pending.includes(MISC_CASE_STATUS_LABELS.SHIPMENT_APPROVAL_PENDING), pending);
    assert.equal(pending.includes(MISC_CASE_STATUS_LABELS.SHIPMENT_READY), false, pending);

    const ready = renderToStaticMarkup(
      <DomesticOrderDetailHeader row={ROW} status="SHIPMENT_READY" />
    );
    assert.ok(ready.includes(MISC_CASE_STATUS_LABELS.SHIPMENT_READY), ready);
    assert.equal(ready.includes(MISC_CASE_STATUS_LABELS.SHIPMENT_APPROVAL_PENDING), false, ready);
  });

  test("🔴 목록과 **같은 배지 조각**을 쓴다 — 두 화면이 같은 말을 한다", () => {
    const fromHeader = renderToStaticMarkup(
      <DomesticOrderDetailHeader row={ROW} status="SHIPMENT_READY" />
    );
    const badge = renderToStaticMarkup(<MiscCaseStatusBadge status="SHIPMENT_READY" />);
    assert.ok(fromHeader.includes(badge), `머리의 배지가 목록의 것과 다르다: ${fromHeader}`);
  });

  test("🔵 상태를 안 넘기면 배지가 아예 없다 — 값만 보는 자리에서 승인 조회를 세우지 않는다", () => {
    const plain = renderToStaticMarkup(<DomesticOrderDetailHeader row={ROW} />);
    for (const label of Object.values(MISC_CASE_STATUS_LABELS)) {
      assert.equal(plain.includes(label), false, `${label} 이 그려졌다`);
    }
  });

  test("🔴 레이아웃이 그 값을 **실제로 넘긴다** — 안 넘기면 배지는 영영 안 뜬다", () => {
    // 🔴 **2026-11-08 에 조회가 바뀌었다 — 뜻은 그대로다.** 승인이 회차마다 서면서
    //    머리 배지가 봐야 하는 것이 「가장 최근 한 줄」이 아니라 **회차 전부를 접은
    //    값**이 되었다(1차만 승인되고 2차가 아직이면 이 줄은 「출하 대기」가 아니다).
    //    🔴 옛 함수(getDomesticOrderApprovalProgress)는 **지금도 있다** — 포털에 결재
    //    메일을 찌르는 자리가 쓴다. 바꿔 쓰면 2차를 올렸는데 1차의 결재자에게 메일이
    //    가므로, 여기서 **어느 쪽을 부르는지**를 글자로 못 박는다.
    assert.ok(layout.includes("getDomesticOrderApprovalUnits(id)"), layout);
    assert.ok(!layout.includes("getDomesticOrderApprovalProgress"), layout);
    assert.ok(layout.includes("resolveMiscCaseStatus({"), layout);
    // 🔴 **2026-11-08 에 인자가 하나 더 늘었다**(finalShipmentApproved — [최종 출하
    //    승인 완료] 배지). 뜻은 위와 같다: 레이아웃이 안 넘기면 그 배지도 영영 안 뜬다.
    //    그 배지가 상태 배지와 **따로** 가는 까닭은 머리 카드의 주석에 있다(완료된
    //    줄에서 상태 배지가 「완료」로 덮여 승인 사실이 사라진다).
    assert.match(
      layout,
      /<DomesticOrderDetailHeader row=\{row\} status=\{status\} finalShipmentApproved=\{finalShipmentApproved\} \/>/
    );
    // 🔴 판정을 레이아웃이 다시 적지 않는다 — 목록과 같은 함수 하나에 묻는다.
    assert.equal(count(layout, "completedAt !== null"), 0, layout);
  });
});

describe("🔴 기본정보 탭 — 내자 정리의 내용이 화면에 나온다", () => {
  const html = renderToStaticMarkup(<DomesticOrderBasicInfoView row={ROW} />);

  /**
   * 🔴 2026-11-07 사용자 지정: 「[제품, 견적. 납품]을 한 박스 [줄, 발주, 정산, 기타]를
   * 한 박스로 해서 간결하게」. 하루 전까지는 상자가 여섯이었다.
   */
  test("🔴 상자는 **둘**이다 — 안에 소제목을 또 두지 않는다", () => {
    for (const box of ["제품 · 견적 · 납품", "줄 · 발주 · 정산 · 기타"]) {
      assert.ok(html.includes(`>${box}</h2>`), `${box} 상자가 없다: ${html}`);
    }
    assert.equal(count(html, "<h2"), 2, `상자가 둘이 아니다: ${html}`);
    // 🔴 안에 묶음 소제목(h3)을 두지 않는다 — 박스 이름이 이미 같은 낱말을 적고 있다.
    assert.equal(count(html, "<h3"), 0, html);
    // 옛 상자 이름이 하나라도 남아 있으면 반쪽만 접힌 것이다.
    for (const old of [">줄</h2>", ">발주</h2>", ">제품</h2>", ">견적 · 납품</h2>", ">정산</h2>", ">기타</h2>"]) {
      assert.equal(html.includes(old), false, `옛 상자 ${old} 가 남아 있다`);
    }
  });

  test("칸 이름표가 그려진다", () => {
    for (const label of ["견적서번호", "금액(VAT별도)", "납기요청일", "형식", "입금완료 여부"]) {
      assert.ok(html.includes(`>${label}</dt>`), `${label} 칸이 없다`);
    }
  });

  test("🔴 값이 목록과 같은 글자로 나온다", () => {
    for (const value of ["DSS 2026-120", "1,234,567", "미완료", "2026-11-10 (1차분)", "PO-2026-0007"]) {
      assert.ok(html.includes(value), `${value} 가 없다`);
    }
  });

  test("🔵 빈 칸도 자리를 지킨다 — 이름표만 떠 있는 칸이 생기지 않는다", () => {
    const empty = renderToStaticMarkup(
      <DomesticOrderBasicInfoView row={{ ...ROW, historyNote: null, etcNote: null }} />
    );
    assert.ok(empty.includes(">이력</dt>"), empty);
    assert.ok(empty.includes("<span class=\"block\">-</span>"), empty);
  });

  test("🔴 빌려 온 납기요청일에는 꼬리표가 화면에 붙는다", () => {
    const borrowed = renderToStaticMarkup(
      <DomesticOrderBasicInfoView
        row={{ ...ROW, dueDates: [], repairCaseCustomerRequestedDueDate: "2026-12-24" }}
      />
    );
    assert.ok(borrowed.includes("2026-12-24"), borrowed);
    assert.ok(borrowed.includes("수리 건 요청일"), borrowed);
  });

  test("🔵 읽기 전용이다 — 눌러 고치는 칸도 폼도 없다", () => {
    assert.equal(html.includes("<button"), false, html);
    assert.equal(html.includes("<form"), false, html);
    assert.equal(html.includes("<input"), false, html);
  });

  /**
   * 🔴 2026-11-07 사용자 지정: 「[제품]에서 L/N, S/N, 고장내역은 없어도 돼」 ·
   * 「[줄]에서 순번, 인수번호는 없어도 돼」.
   *
   * 🔵 **값이 들어 있는 줄로 잰다** — 전부 비어 있는 줄로 재면 「안 보인다」가 공짜로
   * 통과한다. 이름표뿐 아니라 **값 글자**까지 화면에 없어야 한다.
   */
  test("🔴 뺀 다섯 칸이 화면에 **안 보인다** — 값이 있는 줄에서도", () => {
    const filled = { ...ROW, displayIntakeNumber: "D990101" };
    // ① 표본에 값이 정말 들어 있다.
    assert.equal(filled.displayOrder, 12);
    assert.equal(filled.lotNumber, "LN-1");
    assert.equal(filled.serialNumber, "SN-1");
    assert.equal(filled.reportedSymptom, "전원 불량");

    const withValues = renderToStaticMarkup(<DomesticOrderBasicInfoView row={filled} />);
    for (const label of [">순번</dt>", ">인수번호</dt>", ">L/N</dt>", ">S/N</dt>", ">고장내역</dt>"]) {
      assert.equal(withValues.includes(label), false, `${label} 이름표가 아직 있다`);
    }
    for (const value of ["D990101", "LN-1", "SN-1", "전원 불량"]) {
      assert.equal(withValues.includes(value), false, `${value} 가 아직 그려진다`);
    }
  });

  /**
   * 🔴 **빠진 것은 이 탭뿐이다.** 다섯 칸은 내자 정리 목록에 그대로 있어야 한다 —
   * 표의 머리말 칸과 카드의 `제품` 묶음. 두 화면은 이 도메인 파일을 쓰지 않고 제
   * 상수를 가지고 있어서 함께 바뀔 일이 없지만, **그 사실이 바로 이 조각의 전제**라
   * 여기서 한 번 못 박는다(한 화면 요구로 공용 자리를 자르면 엉뚱한 데가 조용히
   * 깨진다).
   */
  test("🔴 같은 칸들이 **내자 정리 목록에는 그대로** 있다", () => {
    const listScreen = flat(stripComments(read("src/components/domestic-orders/DomesticOrderListScreen.tsx")));
    for (const header of [
      "<th className=\"px-3 py-2\">인수번호</th>",
      "<th className=\"px-3 py-2\">L/N</th>",
      "<th className=\"px-3 py-2\">S/N</th>",
      "<th className=\"px-3 py-2\">고장내역</th>",
    ]) {
      assert.ok(listScreen.includes(header), `목록 표에서 ${header} 가 사라졌다`);
    }
    // 카드 쪽 `제품` 묶음도 그대로다(좁은 화면에서만 사라지면 더 찾기 어렵다).
    assert.ok(listScreen.includes('{ label: "L/N", of: (row) => dash(row.lotNumber) }'), listScreen.length.toString());
    assert.ok(listScreen.includes('{ label: "S/N", of: (row) => dash(row.serialNumber) }'));
    // 🔵 그리고 이 탭은 그 상수를 쓰지 않는다 — 두 화면이 서로를 끌고 다니지 않는다.
    const view = stripComments(read("src/components/domestic-orders/detail/DomesticOrderBasicInfoView.tsx"));
    assert.equal(view.includes("CARD_FIELD_GROUPS"), false, view);
  });
});

describe("🔴 탭 틀 — 기본정보가 첫 화면이고, 아직 안 만든 하나만 자리표시다", () => {
  test("탭 넷의 차례가 기본정보 · 견적서 · 발주서 · 승인이다", () => {
    const list = flat(tabs.slice(indexOrFail(tabs, "const tabs = ["), indexOrFail(tabs, "const activeHref")));
    assert.ok(list.includes('{ label: "기본정보", href: hrefs.root },'), list);
    assert.ok(list.includes('{ label: "견적서", href: hrefs.quotes }'), list);
    assert.ok(list.includes('{ label: "발주서", href: hrefs.purchaseOrders }'), list);
    assert.ok(list.includes('{ label: "승인", href: hrefs.approval }'), list);
    // 차례가 곧 화면의 차례다 — 기본정보가 맨 앞이어야 한다(사용자 결정).
    assert.ok(list.indexOf('"기본정보"') < list.indexOf('"견적서"'), list);
    assert.ok(list.indexOf('"견적서"') < list.indexOf('"발주서"'), list);
    assert.ok(list.indexOf('"발주서"') < list.indexOf('"승인"'), list);
  });

  test("🔴 견적서 탭만 조건부다 — 발주서 · 승인은 늘 그린다", () => {
    assert.ok(tabs.includes('...(canViewQuotes ? [{ label: "견적서", href: hrefs.quotes }] : []),'), tabs);
    assert.equal(tabs.includes("canViewPurchaseOrders"), false, "안 쓰는 프롭이 생겼다");
  });

  /**
   * 🔴 **2026-11-06 으로 자리표시 탭이 하나도 남지 않았다** — 견적서 · 발주서 · 승인이
   * 차례로 채워졌다. 그래서 이 시험은 「빈 탭이 안내를 단다」가 아니라 **「어느 탭도
   * 자리표시가 아니다」**를 재는 쪽으로 뒤집혔다. 그냥 지우면 탭 하나가 자리표시로
   * 되돌아가도 아무도 모른다.
   */
  test("🔴 자리표시로 남은 탭이 하나도 없다", () => {
    for (const [name, source] of [
      ["기본정보", basicInfoPage],
      ["견적서", quotesPage],
      ["발주서", purchaseOrdersPage],
      ["승인", approvalPage],
    ] as const) {
      assert.equal(
        source.includes("다음 조각에서 채웁니다"),
        false,
        `${name} 탭이 아직 자리표시다`
      );
    }
    // 기본정보 탭은 진짜 내용을 그린다.
    assert.ok(basicInfoPage.includes("<DomesticOrderBasicInfoView row={row} />"), basicInfoPage);
  });

  /**
   * 🔴 **승인 탭도 2026-11-06 에 채워졌다**(기타건 최종 출하 승인). 위 둘과 같은
   * 까닭으로 **채워졌다는 사실**을 여기서 못 박는다 — 탭이 무엇을 그리는지는
   * domestic-order-approval-tab-screens.test.tsx 가 본다.
   */
  test("🔴 승인 탭은 자리표시가 아니다 — 승인 패널을 그린다", () => {
    assert.ok(approvalPage.includes("<DomesticOrderApprovalPanel"), approvalPage);
    // 🔴 결재선 갈래를 **글자로 적지 않는다** — 도메인 상수 하나를 본다.
    assert.ok(approvalPage.includes("DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE"), approvalPage);
    assert.equal(
      approvalPage.includes('"DOMESTIC_ORDER_FINAL_SHIPMENT"'),
      false,
      "갈래를 글자로 박았다 — 오타 하나가 「판이 없다」로 조용히 보인다"
    );
  });

  /**
   * 🔴 **견적서 탭은 2026-11-06 에 채워졌다** — 이 시험은 그날 「셋」에서 「둘」로 줄었다.
   * 줄이기만 하면 그 탭이 다시 자리표시로 돌아가도 아무도 모르므로, **채워졌다는 사실**을
   * 여기서 못 박는다(탭이 무엇을 그리는지는 domestic-order-quote-tab-screens.test.tsx 가 본다).
   */
  test("🔴 견적서 탭은 자리표시가 아니다 — 갈래 둘을 실제로 그린다", () => {
    assert.equal(quotesPage.includes("다음 조각에서 채웁니다"), false, quotesPage);
    // ① 시스템 견적서가 있는 줄 → 수리 건 탭과 같은 공용 목록
    assert.ok(quotesPage.includes("<QuoteListSlots rows={rows}"), quotesPage);
    // ② 없는 줄 → 내자 정리에 적힌 번호로 공유폴더만(사용자 결정 2026-11-06)
    assert.ok(quotesPage.includes("<DomesticOrderQuoteArchiveFolderSection domesticOrderId={row.id}"), quotesPage);
    // 🔴 안내 상자는 그대로 쓴다 — 번호도 없는 줄에 **조용한 빈 화면**을 내밀지 않는다.
    assert.ok(quotesPage.includes("<DomesticOrderDetailNotice"), quotesPage);
  });

  /**
   * 🔴 **발주서 탭도 2026-11-06 에 채워졌다** — 이 시험은 그날 「둘」에서 「하나」로 줄었다
   * (견적서 탭이 바로 앞 조각에서 그랬던 것과 같은 사정). 줄이기만 하면 그 탭이 다시
   * 자리표시로 돌아가도 아무도 모르므로, **채워졌다는 사실**을 여기서 못 박는다 — 탭이
   * 무엇을 그리는지는 domestic-order-purchase-order-tab-screens.test.tsx 가 본다.
   */
  test("🔴 발주서 탭은 자리표시가 아니다 — 내자에 적힌 번호로 공유폴더를 그린다", () => {
    assert.equal(purchaseOrdersPage.includes("다음 조각에서 채웁니다"), false, purchaseOrdersPage);
    // 번호가 있는 줄 → 그 번호의 발주 건 폴더(사용자 결정 2026-11-06)
    assert.ok(
      purchaseOrdersPage.includes("<DomesticOrderPurchaseOrderFolderSection domesticOrderId={row.id}"),
      purchaseOrdersPage
    );
    // 번호가 없는 줄 → **조용한 빈 화면이 아니라** 까닭을 적은 안내 상자다.
    assert.ok(purchaseOrdersPage.includes("<DomesticOrderDetailNotice"), purchaseOrdersPage);
  });
});

describe("🔴 인가 — 감추는 것은 막은 것이 아니다", () => {
  test("레이아웃과 **네 페이지 전부** 가 `domesticOrders` 가드를 스스로 건다", () => {
    for (const [name, source] of [["layout", layout], ...PAGES] as const) {
      assert.ok(
        source.includes('await requireAreaAccessForCurrentUser("domesticOrders");'),
        `${name} 에 가드가 없다 — 주소를 직접 치면 그대로 들어와진다`
      );
    }
  });

  test("🔴 견적서 탭은 `quotes` READ 를 **페이지가 다시** 본다", () => {
    assert.ok(quotesPage.includes('await hasPermission(actingUser, "quotes", "READ")'), quotesPage);
    assert.ok(quotesPage.includes("권한이 없습니다"), quotesPage);
    // 살아 있는 계정을 다시 읽는다 — 강등된 계정이 옛 토큰으로 금액을 보지 못하게.
    assert.ok(quotesPage.includes("await resolveActingUserForSession(session)"), quotesPage);
    // 레이아웃이 탭을 감추는 판정도 **같은 열쇠**다.
    assert.ok(layout.includes('await hasPermission(actingUser, "quotes", "READ")'), layout);
  });

  test("🔴 없는 줄 · 휴지통에 든 줄은 레이아웃과 페이지 넷 모두에서 404 다", () => {
    for (const [name, source] of [["layout", layout], ...PAGES] as const) {
      assert.ok(source.includes("await getDomesticOrderDetail(id);"), `${name} 이 줄을 읽지 않는다`);
      assert.ok(source.includes("if (!row) notFound();"), `${name} 에 404 갈래가 없다`);
    }
  });

  test("🔴 머리 카드는 탭 줄 **위**다 — 어느 탭을 눌러도 같은 카드가 남는다", () => {
    // 2026-11-06 에 상태 배지가 붙으면서 `status` 인자가 늘었다 — 자리는 그대로다.
    const header = indexOrFail(layout, "<DomesticOrderDetailHeader row={row}");
    const tabBar = indexOrFail(layout, "<DomesticOrderDetailTabs id={id}");
    const children = indexOrFail(layout, "{children}");
    assert.ok(header < tabBar, layout);
    assert.ok(tabBar < children, layout);
  });
});
