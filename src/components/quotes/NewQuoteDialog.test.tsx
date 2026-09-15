import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NewQuoteDialog, {
  NEW_QUOTE_DEFAULT_KIND,
  NEW_QUOTE_DIALOG_TITLE_ID,
  NEW_QUOTE_EXCEL_ONLY_NOTE,
  NEW_QUOTE_EXCEL_ONLY_NOTE_ID,
  NewQuoteDialogView,
  type NewQuoteDialogViewProps,
} from "./NewQuoteDialog";
import {
  newQuoteHrefForRepairCase,
  parseNewQuoteLink,
  parseNewQuoteStart,
} from "@/lib/domain/quote-new-link";
import { QUOTE_KINDS, quoteKindLabels } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * [새 견적서] 팝업 — 무엇을 그리고, 무엇을 누르면 무엇이 불리는가 (견적서 ⑤)
 * ============================================================================
 * 이 시험 환경에는 브라우저가 없다(정적 렌더뿐). 그래서 둘로 본다:
 *  · 창 전체(NewQuoteDialog)를 정적으로 그려 **기본 선택 · 접근성 속성**을 본다 — 열었을 때의
 *    첫 화면이다.
 *  · 창의 그림(NewQuoteDialogView)은 훅이 없어 함수로 불러 **요소 나무**를 얻을 수 있다. 거기서
 *    단추 · 라디오 · 창 자신에 붙은 처리기를 찾아 직접 불러 본다 — 누르기 · Esc · 바깥 누름
 *    (이웃 시험 QuotePrintView.test.tsx 와 같은 방법).
 * 목록이 이 창을 제자리에서 여는지는 QuoteListScreen.test.ts 가, 덧붙이는 규칙은
 * lib/domain/quote-new-link.test.ts 가 본다.
 * ============================================================================
 */

const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INTAKE_NUMBER = "D260706";
const CASE_HREF = newQuoteHrefForRepairCase({ repairCaseId: CASE_ID, intakeNumber: INTAKE_NUMBER });

type AnyProps = { children?: ReactNode } & Record<string, unknown>;

function* walk(node: ReactNode): Generator<ReactElement<AnyProps>> {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) yield* walk(child);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ReactElement<AnyProps>;
  yield element;
  yield* walk(element.props.children);
}

/** 요소 안의 글자를 이어 붙인다. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return (node as ReactNode[]).map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as AnyProps).children);
  return "";
}

/** 처리기를 불러 본다 — 붙어 있지 않으면 시험이 실패한다. */
function fire(handler: unknown, ...args: unknown[]): void {
  assert.equal(typeof handler, "function", "처리기가 붙어 있어야 한다");
  (handler as (...a: unknown[]) => void)(...args);
}

function renderView(overrides: Partial<Pick<NewQuoteDialogViewProps, "baseHref" | "kind" | "excelOnly">> = {}) {
  const calls = { cancel: 0, kinds: [] as string[], excelOnly: [] as boolean[] };
  const dialog = NewQuoteDialogView({
    baseHref: "/quotes/new",
    kind: NEW_QUOTE_DEFAULT_KIND,
    excelOnly: false,
    onKindChange: (kind) => {
      calls.kinds.push(kind);
    },
    onExcelOnlyChange: (value) => {
      calls.excelOnly.push(value);
    },
    onCancel: () => {
      calls.cancel += 1;
    },
    ...overrides,
  }) as ReactElement<AnyProps>;
  const elements = [...walk(dialog)];
  const radios = elements.filter((element) => element.type === "input" && element.props.type === "radio");
  const checkboxes = elements.filter((element) => element.type === "input" && element.props.type === "checkbox");
  const links = elements.filter((element) => typeof element.props.href === "string");
  const button = (name: string) => {
    const found = elements.filter((element) => element.type === "button" && textOf(element.props.children).trim() === name);
    assert.equal(found.length, 1, `[${name}] 단추가 하나가 아니다`);
    return found[0];
  };
  return { dialog, radios, checkboxes, links, button, calls };
}

/** 정적 렌더의 `<태그 …>` 들. 속성은 글자로 본다. */
const inputTags = (html: string) => html.match(/<input [^>]*>/g) ?? [];
const linkTags = (html: string) => html.match(/<a [^>]*>/g) ?? [];
/** 속성 값의 `&amp;` 를 되돌린다 — 주소를 되읽기 위해. */
const hrefOf = (tag: string) => (tag.match(/href="([^"]*)"/)?.[1] ?? "").replaceAll("&amp;", "&");
const queryOf = (href: string) => Object.fromEntries(new URL(href, "https://example.invalid").searchParams.entries());

describe("기본 선택 — 창을 열면 지금까지의 [새 견적서] 그대로(내자 · 엑셀 전용 아님)", () => {
  const html = renderToStaticMarkup(<NewQuoteDialog baseHref="/quotes/new" onCancel={() => {}} />);

  test("🔴 내자 견적서가 골라져 있고 OH 견적서는 아니다", () => {
    const kindRadios = inputTags(html).filter((tag) => tag.includes('type="radio"'));
    assert.equal(kindRadios.length, 2, html);
    const domestic = kindRadios.find((tag) => tag.includes('value="DOMESTIC"'));
    const overhaul = kindRadios.find((tag) => tag.includes('value="OVERHAUL"'));
    assert.ok(domestic?.includes("checked"), `내자가 골라져 있지 않다: ${domestic}`);
    assert.ok(!overhaul?.includes("checked"), `OH 가 골라져 있다: ${overhaul}`);
    assert.equal(NEW_QUOTE_DEFAULT_KIND, "DOMESTIC");
  });

  test("🔴 엑셀 전용은 꺼져 있다", () => {
    const boxes = inputTags(html).filter((tag) => tag.includes('type="checkbox"'));
    assert.equal(boxes.length, 1, html);
    assert.ok(!boxes[0].includes("checked"), boxes[0]);
  });

  test("🔴 [만들기]는 고른 그대로(내자 · 엑셀 전용 아님)를 주소에 싣는다", () => {
    const links = linkTags(html);
    assert.equal(links.length, 1, "링크가 [만들기] 하나가 아니다");
    assert.equal(hrefOf(links[0]), "/quotes/new?kind=DOMESTIC");
    assert.deepEqual(parseNewQuoteStart(queryOf(hrefOf(links[0]))), { kind: "DOMESTIC", excelOnly: false });
    assert.ok(html.includes(">만들기</a>"), "[만들기] 글자가 링크에 없다");
  });

  test("🔴 수리 건 탭에서 열면 [만들기] 주소에 그 건의 인수번호 · 건 id 가 그대로 있다", () => {
    const caseHtml = renderToStaticMarkup(<NewQuoteDialog baseHref={CASE_HREF} onCancel={() => {}} />);
    const href = hrefOf(linkTags(caseHtml)[0] ?? "");
    assert.ok(href.startsWith(`${CASE_HREF}&`), href);
    assert.deepEqual(parseNewQuoteLink(queryOf(href)), { intakeNumber: INTAKE_NUMBER, repairCaseId: CASE_ID });
    assert.deepEqual(parseNewQuoteStart(queryOf(href)), { kind: "DOMESTIC", excelOnly: false });
  });

  test("두 선택지의 글자와 엑셀 전용 설명이 보인다 — 설명은 폼의 스위치와 뜻이 같다", () => {
    for (const kind of QUOTE_KINDS) {
      assert.ok(html.includes(quoteKindLabels[kind]), `${quoteKindLabels[kind]} 가 없다`);
    }
    assert.ok(html.includes("엑셀 전용 견적서"), html);
    assert.ok(html.includes(NEW_QUOTE_EXCEL_ONLY_NOTE), html);
    // 폼의 스위치 설명(QuoteAttachmentParts 의 ExcelOnlySwitch)과 같은 세 가지를 말한다.
    for (const phrase of ["손으로 만든 엑셀로 발행합니다", "작업비", "공급가액을 직접 적습니다"]) {
      assert.ok(NEW_QUOTE_EXCEL_ONLY_NOTE.includes(phrase), `설명에 '${phrase}' 가 없다`);
    }
  });
});

describe("두 선택지 — 고르면 창의 상태로 올라간다", () => {
  test("🔴 종류는 라디오 둘 — 같은 묶음, 차례는 내자 → OH", () => {
    const { radios } = renderView();
    assert.deepEqual(
      radios.map((radio) => radio.props.value),
      [...QUOTE_KINDS]
    );
    assert.equal(new Set(radios.map((radio) => radio.props.name)).size, 1, "라디오가 한 묶음이 아니다");
  });

  test("🔴 OH 를 고르면 OVERHAUL, 내자를 고르면 DOMESTIC 이 올라간다", () => {
    const { radios, calls } = renderView();
    fire(radios.find((radio) => radio.props.value === "OVERHAUL")?.props.onChange);
    fire(radios.find((radio) => radio.props.value === "DOMESTIC")?.props.onChange);
    assert.deepEqual(calls.kinds, ["OVERHAUL", "DOMESTIC"]);
    assert.equal(calls.cancel, 0, "고르기가 창을 닫는다");
  });

  test("🔴 엑셀 전용 체크 상자는 누른 방향 그대로 올라간다", () => {
    const { checkboxes, calls } = renderView();
    assert.equal(checkboxes.length, 1);
    fire(checkboxes[0].props.onChange, { target: { checked: true } });
    fire(checkboxes[0].props.onChange, { target: { checked: false } });
    assert.deepEqual(calls.excelOnly, [true, false]);
  });

  test("받은 값이 그대로 그려진다 — OH · 엑셀 전용", () => {
    const { radios, checkboxes } = renderView({ kind: "OVERHAUL", excelOnly: true });
    assert.deepEqual(
      radios.map((radio) => [radio.props.value, radio.props.checked]),
      [
        ["DOMESTIC", false],
        ["OVERHAUL", true],
      ]
    );
    assert.equal(checkboxes[0].props.checked, true);
  });
});

describe("[만들기] — newQuoteHref 에 두 값을 덧붙인 주소로 간다", () => {
  test("🔴 맨 `/quotes/new` — OH · 엑셀 전용", () => {
    const { links } = renderView({ kind: "OVERHAUL", excelOnly: true });
    assert.equal(links.length, 1);
    assert.equal(textOf(links[0].props.children), "만들기");
    assert.equal(links[0].props.href, "/quotes/new?kind=OVERHAUL&excelOnly=1");
  });

  test("🔴 수리 건 주소 — 인수번호 · 건 id 가 남고 두 값이 더해진다", () => {
    const { links } = renderView({ baseHref: CASE_HREF, kind: "OVERHAUL", excelOnly: true });
    const href = links[0].props.href as string;
    assert.deepEqual(parseNewQuoteLink(queryOf(href)), { intakeNumber: INTAKE_NUMBER, repairCaseId: CASE_ID });
    assert.deepEqual(parseNewQuoteStart(queryOf(href)), { kind: "OVERHAUL", excelOnly: true });
  });

  test("[만들기]는 창을 닫는 길(onCancel)을 부르지 않는다 — 고른 값을 실은 주소로 갈 뿐이다", () => {
    const { links, calls } = renderView();
    assert.equal(links[0].props.onClick, undefined, "[만들기]에 따로 붙은 처리기가 있다");
    assert.equal(calls.cancel, 0);
  });
});

describe("[취소] · Esc · 바깥 누름 = 취소", () => {
  test("🔴 [취소] 단추", () => {
    const { button, calls } = renderView();
    const cancel = button("취소");
    assert.equal(cancel.props.type, "button");
    fire(cancel.props.onClick);
    assert.equal(calls.cancel, 1);
    assert.deepEqual(calls.kinds, []);
  });

  test("🔴 Esc — 브라우저가 제멋대로 닫지 않게 막고 [취소]와 같은 길로 닫는다", () => {
    const { dialog, calls } = renderView();
    let prevented = false;
    fire(dialog.props.onCancel, {
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true, "Esc 의 기본 동작을 막지 않는다");
    assert.equal(calls.cancel, 1);
  });

  test("브라우저가 cancel 없이 창을 닫아도(close) 같은 길을 탄다 — 부모가 열린 줄 알고 남지 않게", () => {
    const { dialog, calls } = renderView();
    fire(dialog.props.onClose);
    assert.equal(calls.cancel, 1);
  });

  test("🔴 바깥(배경) 누름은 취소, 창 안쪽 누름은 아니다", () => {
    const { dialog, calls } = renderView();
    const self = {};
    fire(dialog.props.onClick, { target: self, currentTarget: self });
    assert.equal(calls.cancel, 1, "배경을 눌러도 닫히지 않는다");
    fire(dialog.props.onClick, { target: {}, currentTarget: self });
    assert.equal(calls.cancel, 1, "창 안쪽을 눌렀는데 닫힌다");
  });

  test("안쪽 칸이 창을 꽉 채운다 — 창 자신이 받는 누름이 배경뿐이게(창에는 안쪽 여백이 없다)", () => {
    const { dialog } = renderView();
    const className = String(dialog.props.className);
    assert.ok(className.split(" ").includes("p-0"), className);
    const inner = dialog.props.children as ReactElement<AnyProps>;
    assert.ok(isValidElement(inner), "창의 자식이 칸 하나가 아니다");
    assert.ok(String(inner.props.className).split(" ").includes("p-4"), String(inner.props.className));
  });
});

describe("접근성 · 폭", () => {
  const html = renderToStaticMarkup(<NewQuoteDialog baseHref="/quotes/new" onCancel={() => {}} />);

  test("🔴 모달 창이고 제목으로 이름이 붙는다", () => {
    const dialogTag = html.match(/<dialog [^>]*>/)?.[0] ?? "";
    assert.ok(dialogTag.includes('aria-modal="true"'), dialogTag);
    assert.ok(dialogTag.includes(`aria-labelledby="${NEW_QUOTE_DIALOG_TITLE_ID}"`), dialogTag);
    assert.ok(html.includes(`<h2 id="${NEW_QUOTE_DIALOG_TITLE_ID}"`), "제목의 id 가 없다");
    assert.ok(html.includes(">새 견적서</h2>"), html);
  });

  test("🔴 종류는 legend 가 붙은 묶음이고, 선택지마다 라벨이 입력을 감싼다", () => {
    assert.ok(html.includes("<fieldset>"), html);
    assert.ok(html.includes(">견적서 종류</legend>"), html);
    for (const kind of QUOTE_KINDS) {
      assert.match(html, new RegExp(`<label [^>]*><input type="radio" [^>]*value="${kind}"[^>]*/>${quoteKindLabels[kind]}</label>`));
    }
  });

  test("엑셀 전용 체크 상자는 설명 한 줄과 이어져 있다", () => {
    const box = inputTags(html).find((tag) => tag.includes('type="checkbox"')) ?? "";
    assert.ok(box.includes(`aria-describedby="${NEW_QUOTE_EXCEL_ONLY_NOTE_ID}"`), box);
    assert.ok(html.includes(`id="${NEW_QUOTE_EXCEL_ONLY_NOTE_ID}"`), "설명의 id 가 없다");
  });

  test("폭 400px — 창은 화면 폭을 넘지 않고, 단추 줄은 좁으면 접힌다", () => {
    const { dialog, elements } = (() => {
      const view = renderView();
      return { dialog: view.dialog, elements: [...walk(view.dialog)] };
    })();
    const dialogClass = String(dialog.props.className).split(" ");
    assert.ok(dialogClass.includes("w-full") && dialogClass.includes("max-w-md"), dialogClass.join(" "));
    assert.ok(!dialogClass.some((name) => name.startsWith("min-w-")), "창에 최소 폭이 있다");
    // 글자가 딱 「취소만들기」인 칸 — 창 · 안쪽 칸도 그 글자를 품지만 다른 글자가 더 있다.
    const buttonRow = elements.find((element) => textOf(element.props.children) === "취소만들기");
    assert.ok(buttonRow, "단추 줄을 찾지 못했다");
    assert.ok(String(buttonRow.props.className).split(" ").includes("flex-wrap"), String(buttonRow.props.className));
  });
});
