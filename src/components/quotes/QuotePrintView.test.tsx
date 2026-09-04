import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QuotePrintView, { type QuotePrintData } from "./QuotePrintView";

/**
 * ============================================================================
 * 미리보기의 「돌아가기」 — 갈리는 기준은 저장 여부가 아니라 **어떻게 열렸나**다
 * ============================================================================
 * 이 컴포넌트는 두 곳에서 쓰인다.
 *
 *   · QuoteEditForm 의 **겹쳐 뜬** 미리보기 — 폼은 그 자리에 그대로 있고 화면만
 *     바뀐다. 주소는 `/quotes/{id}`(또는 `/quotes/new`) 그대로다. `onClose` 를
 *     받는다.
 *   · `/quotes/{id}/print` **독립 페이지** — 목록에서 들어온다. `onClose` 가 없다.
 *
 * 🔴 예전에는 `quoteId` 로 갈랐다. 그래서 **저장된 견적서를 고치다가** 미리보기를
 * 열면 `/quotes/{id}` 로 가는 링크가 그려졌는데, 그때 주소가 이미 거기라서 눌러도
 * 아무 일이 없었다 — 미리보기가 계속 떠 있는, 죽은 단추. 새 견적서에서는
 * `quoteId` 가 null 이라 안 드러났다. 아래 첫 시험이 그 자리를 붙잡아 둔다.
 *
 * 「Excel 받기」는 **저장 여부로 갈리는 것이 맞다** — 파일을 만드는 라우트가 DB 의
 * 그 줄을 읽기 때문이다. 둘이 같은 기준으로 묶여 버리지 않게 그쪽도 함께 못 박는다.
 * ============================================================================
 */

type Props = Parameters<typeof QuotePrintView>[0];

/**
 * 양식에서 읽어 오는 값들. 시험에서는 전부 비워 둔다 — 여기서 보는 것은 도구모음이고,
 * 무엇보다 **계좌번호는 코드에 두지 않는다**(실제 값은 양식 파일에서 온다).
 */
const HEADER: Props["header"] = {
  companyName: null,
  ceoLine: null,
  address: null,
  tel: null,
  fax: null,
  email: null,
  homepage: null,
  defaultValidity: null,
  defaultDelivery: null,
  defaultPayment: null,
  bankAccount: null,
};

const QUOTE: QuotePrintData = {
  quoteNumber: "Q-2026-0001",
  quoteDate: "2026-09-01",
  customerNameText: "주성 엔지니어링",
  subject: "MBK200-JS3 수리",
  validity: null,
  delivery: null,
  payment: null,
  modelNameText: "MBK200-JS3",
  serialNumberText: "1708075",
  lotNumberText: null,
  workCost: "300000",
  items: [
    { partId: null, partNameText: "커넥터 SMA", isOverhaulPart: false, quantity: 2, unitPrice: "12000" },
  ],
};

type Opened = { quoteId: string | null; onClose?: () => void };

function render(opened: Opened): string {
  return renderToStaticMarkup(
    <QuotePrintView quote={QUOTE} header={HEADER} quoteId={opened.quoteId} onClose={opened.onClose} />
  );
}

/**
 * 눌렀을 때 무엇이 불리는지는 정적 렌더로 볼 수 없다(마크업에 onClick 이 안 남는다).
 * 이 컴포넌트는 상태가 없는 순수 함수라 그대로 불러 요소 나무를 걸을 수 있다.
 */
function* walk(node: ReactNode): Generator<ReactElement<{ children?: ReactNode }>> {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) yield* walk(child);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ReactElement<{ children?: ReactNode }>;
  yield element;
  yield* walk(element.props.children);
}

/** 도구모음 왼쪽, 「←」로 시작하는 그 자리 하나. */
function backControl(opened: Opened): ReactElement<{ children?: ReactNode; onClick?: () => void }> {
  const tree = QuotePrintView({ quote: QUOTE, header: HEADER, ...opened });
  const found = [...walk(tree)].filter(
    (element) => typeof element.props.children === "string" && element.props.children.startsWith("←")
  );
  assert.equal(found.length, 1, "돌아가는 자리는 언제나 하나여야 한다");
  return found[0] as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
}

function click(control: ReactElement<{ onClick?: () => void }>): void {
  assert.equal(typeof control.props.onClick, "function", "누를 것이 붙어 있어야 한다");
  control.props.onClick?.();
}

// ───────────────────────────── 겹쳐 뜬 미리보기(onClose 를 받았다)

test("🔴 저장된 견적서를 고치다 연 미리보기도 단추다 — 누르면 닫혀 폼으로 돌아간다", () => {
  // 이 버그의 핵심이다. 주소가 이미 `/quotes/q-1` 이라, 그리로 가는 링크를 그리면
  // 눌러도 주소가 안 바뀌고 미리보기가 그대로 떠 있다.
  let closed = 0;
  const control = backControl({ quoteId: "q-1", onClose: () => { closed += 1; } });

  assert.equal(control.type, "button", "저장됐다는 이유로 링크가 되면 안 된다");
  click(control);
  assert.equal(closed, 1, "누르면 미리보기가 닫혀야 한다");
});

test("🔴 겹쳐 뜬 미리보기에는 견적서 주소로 가는 링크가 아예 없다", () => {
  const html = render({ quoteId: "q-1", onClose: () => {} });

  assert.ok(html.includes("<button"), "돌아가는 자리가 단추로 그려져야 한다");
  assert.ok(
    !html.includes('href="/quotes/q-1"'),
    "지금 주소와 같은 자리로 가는 링크는 눌러도 화면이 안 바뀐다"
  );
});

test("아직 저장 전 미리보기도 같은 단추다(종전 그대로)", () => {
  let closed = 0;
  const control = backControl({ quoteId: null, onClose: () => { closed += 1; } });

  assert.equal(control.type, "button");
  click(control);
  assert.equal(closed, 1);
});

// ───────────────────────────── 독립 페이지(onClose 가 없다)

test("독립된 미리보기 페이지에서는 견적서 주소로 가는 링크다", () => {
  const html = render({ quoteId: "q-1" });
  assert.ok(html.includes('href="/quotes/q-1"'), "돌아갈 곳이 주소로만 있다");

  const control = backControl({ quoteId: "q-1" });
  assert.notEqual(control.type, "button", "닫을 폼이 없는 화면에서 단추는 죽은 단추다");
});

// ───────────────────────────── Excel 받기는 종전대로 저장 여부로 갈린다

test("Excel 받기: 저장 전에는 링크 대신 왜 못 받는지 적는다", () => {
  const html = render({ quoteId: null, onClose: () => {} });

  assert.ok(html.includes("Excel 은 저장한 뒤에 받을 수 있습니다"));
  assert.ok(!html.includes("/xlsx"), "만들 수 없는 파일의 링크를 내밀면 안 된다");
});

test("Excel 받기: 저장된 견적서면 겹쳐 뜬 미리보기에서도 받기 링크다", () => {
  // 돌아가기 기준이 onClose 로 바뀌었다고 이쪽까지 딸려 가면, 수정 중에는
  // 받을 수 있는 파일을 못 받게 된다.
  const html = render({ quoteId: "q-1", onClose: () => {} });

  assert.ok(html.includes('href="/api/quotes/q-1/xlsx"'));
  assert.ok(!html.includes("Excel 은 저장한 뒤에"));
});

test("Excel 받기: 독립 페이지에서도 받기 링크다", () => {
  const html = render({ quoteId: "q-1" });
  assert.ok(html.includes('href="/api/quotes/q-1/xlsx"'));
});

// ───────────────────────────── 통전작업 제외 — ③ 을 그리지 않는다

/**
 * 미리보기와 실제로 나가는 xlsx 는 **같은 종이여야 한다.** 파일 쪽은 「③
 * 통전검사」 구역을 머리글까지 지우고(xlsx/quote-template.ts), 여기가 그리는
 * 것이 다르면 받아 본 쪽이 다른 문서로 읽는다.
 */
function renderSections(powerTestExcluded?: boolean): string {
  return renderToStaticMarkup(
    <QuotePrintView
      quote={{ ...QUOTE, powerTestExcluded }}
      header={HEADER}
      quoteId="q-1"
      onClose={() => {}}
    />
  );
}

test("🔴 통전작업 제외: ③ 통전검사 묶음이 사라진다 — 파일이 그렇게 나간다", () => {
  const html = renderSections(true);
  assert.ok(!html.includes("통전검사"), "하지 않은 시험을 적어 보내면 안 된다");
  assert.ok(html.includes("서류작업"));
  // ①·② 는 그대로다.
  assert.ok(html.includes("①　인수 조사") && html.includes("②　수리 작업"));
});

/**
 * 🔴 지우기만 하고 번호를 두면 고객이 받는 종이에 `① ② ④` 로 번호가 하나
 * 건너뛴다. 양식(xlsx)도 같은 자리에서 번호를 당긴다 — 둘이 다르면 미리보기와
 * 받아 본 문서가 서로 다른 종이가 된다.
 */
test("🔴 통전작업 제외: 서류작업이 ③ 이 되고 ④ 는 종이 어디에도 없다", () => {
  const html = renderSections(true);
  assert.ok(html.includes("③　서류작업"), "서류작업의 번호가 안 당겨졌다");
  assert.ok(!html.includes("④"), "④ 가 남으면 번호가 건너뛴다");
});

test("🔴 옛 견적서 — 제외를 주지 않으면 ③ 이 그대로다", () => {
  for (const html of [renderSections(), renderSections(false)]) {
    assert.ok(html.includes("③　통전검사[출하검사]"), "예전과 한 줄도 달라지면 안 된다");
    // 🔴 제외하지 않았으면 서류작업은 ④ 그대로다.
    assert.ok(html.includes("④　서류작업"));
  }
  assert.equal(renderSections(), renderSections(false), "안 준 것과 꺼진 것은 같은 종이다");
});
