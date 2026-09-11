import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「견적서」 탭 → 수정 화면 → [취소] 가 그 탭으로 돌아오는가 — 화면이 규칙을 부르는가
 * ============================================================================
 * 주소를 만들고 돌아갈 곳을 정하는 규칙 자체는 도메인 시험이 값으로 본다
 * (lib/domain/quote-new-link.test.ts). 여기서 지키는 것은 **화면이 그 규칙을
 * 제자리에서 부르는가**다:
 *  · 목록의 줄 링크가 **표·카드 두 곳 모두** 같은 규칙으로 만들어진다 — 한쪽만
 *    바뀌면 창 폭에 따라(ResponsiveList 가 재서 고른다) 돌아가는 곳이 달라진다.
 *  · 기본값이면 PO/내자 목록의 줄 링크는 지금까지 그대로다(프롭 기본값 null).
 *  · 미리보기·xlsx 링크는 바뀌지 않는다.
 *  · 「견적서」 탭만 그 건의 id 를 넘기고, PO/내자 목록은 넘기지 않는다.
 *  · 수정 화면은 **읽어 온 견적서와 맞춰 본 뒤에** 돌아갈 곳을 정해 폼에 넘긴다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * QuoteListScreen 은 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**라, 그
 * 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다. 게다가 카드는 정적 렌더로 그려지지 않는다(표가 먼저
 * 나온다). 그래서 이웃 시험(users/approval-route-section.test.ts)과 같은 방법으로
 * 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 아래 줄바꿈 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 원본에서 **한 갈래만** 잘라낸다 — 파일 전체에 정규식을 걸면 이웃 갈래에 걸린다. */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const listSource = read("src/components/quotes/QuoteListScreen.tsx");
const tabPageSource = read("src/app/(app)/repair-cases/[id]/quotes/page.tsx");
const quotesPageSource = read("src/app/(app)/quotes/page.tsx");
const editPageSource = read("src/app/(app)/quotes/[id]/page.tsx");

const ROW_LINK = "href={quoteEditHref({ quoteId: row.id, repairCaseId: quoteLinkRepairCaseId })}";

const tableSource = flat(sliceBetween(listSource, "function QuoteTable(", "function QuoteCardList("));
const cardSource = flat(sliceBetween(listSource, "function QuoteCardList(", "function PreviewLink("));

describe("목록의 줄 링크", () => {
  test("🔴 표의 줄 링크는 접수 건 id 를 실을 수 있는 규칙으로 만든다", () => {
    assert.ok(tableSource.includes(ROW_LINK), "표의 줄 링크가 quoteEditHref 를 쓰지 않는다");
    assert.ok(!tableSource.includes("href={`/quotes/${row.id}`}"), "표에 옛 고정 주소가 남아 있다");
  });

  test("🔴 카드의 줄 링크도 같은 규칙이다 — 창 폭에 따라 돌아가는 곳이 달라지지 않게", () => {
    assert.ok(cardSource.includes(ROW_LINK), "카드의 줄 링크가 quoteEditHref 를 쓰지 않는다");
    assert.ok(!cardSource.includes("href={`/quotes/${row.id}`}"), "카드에 옛 고정 주소가 남아 있다");
  });

  test("표와 카드 둘 다 부르는 쪽이 넘긴 값을 받는다", () => {
    const screen = flat(sliceBetween(listSource, "<ResponsiveList", "/>\n      )}"));
    const tableProps = sliceBetween(screen, "<QuoteTable", "/>");
    const cardProps = sliceBetween(screen, "<QuoteCardList", "/>");
    for (const props of [tableProps, cardProps]) {
      assert.ok(
        props.includes("quoteLinkRepairCaseId={quoteLinkRepairCaseId}"),
        `목록에 값이 전달되지 않는다: ${props}`
      );
    }
  });

  test("🔴 기본값은 null 이다 — PO/내자 목록의 줄 링크는 지금까지의 `/quotes/{id}` 그대로", () => {
    // null 일 때 quoteEditHref 가 `/quotes/{id}` 를 그대로 돌려주는 것은 도메인 시험이 값으로 본다.
    const signature = flat(sliceBetween(listSource, "export default function QuoteListScreen(", "}) {"));
    assert.match(signature, /quoteLinkRepairCaseId = null,/);
  });

  test("미리보기와 xlsx 링크는 그대로다", () => {
    assert.ok(listSource.includes("href={`/quotes/${id}/print`}"), "미리보기 주소가 바뀌었다");
    assert.ok(listSource.includes("href={`/api/quotes/${row.id}/xlsx`}"), "xlsx 주소가 바뀌었다");
  });
});

describe("부르는 쪽", () => {
  test("「견적서」 탭은 그 건의 id 를 넘긴다", () => {
    const call = flat(sliceBetween(tabPageSource, "<QuoteListScreen", "/>\n  );"));
    assert.ok(call.includes("quoteLinkRepairCaseId={resolved.id}"), "탭이 건의 id 를 넘기지 않는다");
  });

  test("🔴 PO/내자 목록은 넘기지 않는다 — 기본값 그대로", () => {
    assert.ok(!quotesPageSource.includes("quoteLinkRepairCaseId"), "PO/내자 목록이 건의 id 를 넘긴다");
  });

  test("🔴 수정 화면은 읽어 온 견적서와 맞춰 본 뒤 돌아갈 곳을 폼에 넘긴다", () => {
    const body = flat(editPageSource);
    assert.match(
      body,
      /const returnHref = returnHrefForEditQuote\(searchParams \? await searchParams : undefined, quote\);/
    );
    assert.ok(body.includes("returnHref={returnHref}"), "폼에 돌아갈 곳이 넘어가지 않는다");
    // 견적서를 읽고(없으면 404) 난 **뒤에** 정한다 — 그 견적서의 건과 맞춰 봐야 하므로.
    const loaded = body.indexOf("if (!quote) notFound();");
    const decided = body.indexOf("const returnHref = returnHrefForEditQuote(");
    assert.ok(loaded >= 0 && decided > loaded, "돌아갈 곳을 견적서를 읽기 전에 정한다");
  });

  test("수정 화면의 권한 검사·redirect·notFound 순서는 그대로다", () => {
    const body = flat(editPageSource);
    const order = [
      'await requireAreaAccessForCurrentUser("quotes");',
      "if (!isValidQuoteId(id)) notFound();",
      'if (!canEdit) redirect("/quotes");',
      "const quote = await getQuoteForEdit(id);",
      "if (!quote) notFound();",
    ].map((marker) => {
      const at = body.indexOf(marker);
      assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
      return at;
    });
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] > order[i - 1], "권한 검사·조회 순서가 바뀌었다");
    }
  });
});
