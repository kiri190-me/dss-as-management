import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE,
  canRenderQuoteDocument,
} from "./quote-document-support";
import { STORED_QUOTE_KINDS } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 잘못된 문서가 나가는 길이 막혀 있는가 (2026-09-16 케이블 ③)
 * ============================================================================
 * 케이블 견적서를 만들 수 있게 된 순간, 그 장을 **내자 양식으로 그리고 채우는 길**이
 * 함께 열렸다 — 미리보기 화면 · GET 받기 통로 · 발행 통로(POST issue) 셋이 전부 종류를
 * 보지 않고 앱 양식을 쓴다. 화면에서 단추를 감추는 것으로는 주소를 직접 여는 길이 남는다.
 *
 * 그래서 이 시험은 둘을 본다:
 *  ㉠ **판정 자체** — 케이블은 막히고, 내자 · OH 는 지금과 똑같이 지나간다.
 *  ㉡ **막는 자리가 실제로 그 판정을 부르는가** — 다섯 곳(받기 통로 둘 · 미리보기 화면 ·
 *     목록 · 편집 화면)의 원본을 읽어 본다. 통로의 실제 거절은 통합시험이 본다
 *     (server/services/quote-issue.integration.test.ts).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

describe("㉠ 판정 — 앱 양식이 있는 종류만 지나간다", () => {
  test("🔴 내자 · OH 는 지금 그대로 지나간다", () => {
    assert.equal(canRenderQuoteDocument({ kind: "DOMESTIC", isExcelOnly: false }), true);
    assert.equal(canRenderQuoteDocument({ kind: "OVERHAUL", isExcelOnly: false }), true);
  });

  test("🔴 케이블은 막힌다 — 그리면 내자 양식에 케이블 값이 채워진 문서가 된다", () => {
    assert.equal(canRenderQuoteDocument({ kind: "CABLE", isExcelOnly: false }), false);
  });

  test("🔴 엑셀 전용이면 종류를 보지 않는다 — 그 장의 문서는 손으로 만든 엑셀이다", () => {
    for (const kind of STORED_QUOTE_KINDS) {
      assert.equal(
        canRenderQuoteDocument({ kind, isExcelOnly: true }),
        true,
        `${kind} 엑셀 전용 장이 막혔다 — 앱 양식을 쓰지 않는 장이다`
      );
    }
  });

  test("🔴 새 종류는 일단 막힌다 — 할 수 있는 쪽을 적어 두었다", () => {
    // DB 가 내줄 수 있는 종류 가운데 지금 양식이 있는 것은 둘뿐이다.
    const allowed = STORED_QUOTE_KINDS.filter((kind) => canRenderQuoteDocument({ kind, isExcelOnly: false }));
    assert.deepEqual([...allowed], ["DOMESTIC", "OVERHAUL"]);
  });

  test("거절 문장은 「오류」가 아니라 아직 안 되는 일이라고 말한다", () => {
    assert.match(QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE, /케이블 견적서/);
    assert.match(QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE, /미리보기 · 견적서 받기/);
    assert.match(QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE, /다음 차례/);
    // 지금 할 수 있는 일도 말한다 — 사람이 적어 둔 것이 사라진 줄 알면 안 된다.
    assert.match(QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE, /저장/);
  });
});

describe("㉡ 막는 자리 — 다섯 곳이 같은 판정 하나를 부른다", () => {
  const xlsxRoute = flat(read("src/app/api/quotes/[id]/xlsx/route.ts"));
  const issueService = flat(read("src/lib/server/services/quote-issue.ts"));
  const issueRoute = flat(read("src/app/api/quotes/[id]/issue/route.ts"));
  const printPage = flat(read("src/app/(app)/quotes/[id]/print/page.tsx"));
  const listScreen = flat(read("src/components/quotes/QuoteListScreen.tsx"));
  const editForm = flat(read("src/components/quotes/QuoteEditForm.tsx"));

  test("🔴 GET 받기 통로 — 견적서를 읽은 **직후**, 채우기보다 앞에서 거절한다", () => {
    const at = xlsxRoute.indexOf("if (!canRenderQuoteDocument(quote)) { return fail(501, \"KIND_NOT_SUPPORTED\", QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE); }");
    assert.ok(at >= 0, "GET 통로가 거절하지 않는다");
    const render = xlsxRoute.indexOf("await renderQuoteWorkbook(quote)");
    assert.ok(render > at, "채우기가 거절보다 앞이다 — 그 사이에 문서가 만들어진다");
    // 감사(EXCEL_EXPORT)도 남지 않아야 한다 — 나가지 않은 문서다.
    assert.ok(xlsxRoute.indexOf("recordQuoteExport({") > at, "감사가 거절보다 앞이다");
  });

  test("🔴 발행 통로(POST issue) — 공유폴더 · 첨부 칸에 닿기 전에 거절한다", () => {
    const at = issueService.indexOf("if (!canRenderQuoteDocument(quote)) { return fail(\"KIND_NOT_SUPPORTED\", QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE); }");
    assert.ok(at >= 0, "발행 통로가 거절하지 않는다");
    assert.ok(
      issueService.indexOf("return quote.isExcelOnly ? issueAttachedExcel(quote, input) : issueRenderedWorkbook(quote, input);") > at,
      "거절이 갈림길보다 뒤다"
    );
    // 라우트가 응답 코드로 바꾼다 — 고장(5xx 관리자 문의)이 아니라 아직 안 만든 기능이다.
    assert.ok(issueRoute.includes("KIND_NOT_SUPPORTED: 501,"), "발행 통로의 응답 코드가 없다");
  });

  test("🔴 미리보기 화면 — 그리기 전에 멈추고, 「없는 장」이라고 하지 않는다", () => {
    const at = printPage.indexOf("if (!canRenderQuoteDocument(quote)) {");
    assert.ok(at >= 0, "미리보기 화면이 거절하지 않는다");
    assert.ok(
      printPage
        .slice(at)
        .includes('<PlaceholderPage title="견적서 미리보기" description={QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE} />'),
      "까닭을 말하지 않는다"
    );
    // 🔴 notFound() 로 보내지 않는다 — 그 장은 목록에도 수정 화면에도 멀쩡히 있다.
    assert.ok(printPage.slice(at).indexOf("notFound()") < 0, "없는 장으로 답한다");
    // 그리는 쪽(QuotePrintView)보다 앞이다.
    assert.ok(printPage.indexOf("<QuotePrintView") > at, "그리기가 거절보다 앞이다");
  });

  test("🔴 목록 — 케이블 줄에는 받기 · 미리보기를 내밀지 않는다", () => {
    assert.ok(
      listScreen.includes("if (!canRenderQuoteDocument(row)) { return ( <span title={QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE}"),
      "목록의 받기가 그대로 있다"
    );
    assert.ok(
      listScreen.includes("function PreviewLink({ row, repairCaseId }: { row: QuoteListItem; repairCaseId: string | null }) { if (!canRenderQuoteDocument(row)) return null;"),
      "목록의 미리보기가 그대로 있다"
    );
    // 표와 카드 두 곳 모두 같은 조각을 쓴다 — 폭에 따라 한쪽만 뚫리면 안 된다.
    assert.equal(listScreen.split("<PreviewLink row={row} repairCaseId={quoteLinkRepairCaseId} />").length - 1, 2);
    assert.equal(listScreen.split("<DownloadLink row={row} canEdit={canEdit} onIssueOutcome={onIssueOutcome} />").length - 1, 2);
  });

  test("🔴 편집 화면 — 화면도 같은 판정을 본다(엑셀 전용 케이블은 열려 있다)", () => {
    assert.ok(editForm.includes("const canGetDocument = canRenderQuoteDocument({ kind, isExcelOnly });"), editForm.slice(0, 0));
    assert.ok(editForm.includes("{canGetDocument && ( <button type=\"button\" onClick={() => setShowPreview(true)}"));
    assert.ok(editForm.includes("{savedQuote && canGetDocument && ( <QuoteIssueButton"));
    // 안내 문장도 서버가 돌려주는 그 하나다 — 두 벌이면 화면과 통로가 다른 말을 한다.
    assert.ok(editForm.includes("{!canGetDocument && ( <p"));
    assert.ok(editForm.includes("{QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE} </p>"));
  });

  test("🔴 다섯 곳 어디에도 종류를 손으로 적은 갈림이 없다 — 판정은 한 곳이다", () => {
    for (const [name, source] of [
      ["GET 받기 통로", xlsxRoute],
      ["발행 통로", issueService],
      ["미리보기 화면", printPage],
      ["목록", listScreen],
    ] as const) {
      assert.ok(!source.includes('=== "CABLE"'), `${name} 가 종류를 손으로 가른다`);
      assert.ok(!source.includes('!== "CABLE"'), `${name} 가 종류를 손으로 가른다`);
    }
    // 편집 화면만 예외다 — 그 화면은 **그리는 일**로도 종류를 가른다(규격 칸 · 설명 줄 ·
    // 특이사항 · 작업 구역). 그것도 한 곳뿐임은 quote-edit-cable.test.ts 가 본다.
    assert.equal(editForm.split('kind === "CABLE"').length - 1, 1);
  });
});
