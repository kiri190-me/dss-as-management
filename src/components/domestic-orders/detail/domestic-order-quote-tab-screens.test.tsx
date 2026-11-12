import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS } from "@/lib/auth/domestic-order-detail-tab-permissions";
import {
  QUOTE_ARCHIVE_FOLDER_SECTION_EMPTY_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_LOADING_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT,
} from "@/components/quotes/QuoteArchiveFolderSection";
import {
  DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT,
  domesticOrderQuoteArchiveNoDateText,
  domesticOrderQuoteArchiveOnlyText,
} from "@/lib/domain/domestic-order-quote-archive";
import {
  DomesticOrderQuoteArchiveFolderSectionView,
  domesticOrderQuoteArchiveFolderEntriesUrl,
  loadDomesticOrderQuoteArchiveFolderEntries,
  readDomesticOrderQuoteArchiveFolderAnswer,
  type DomesticOrderQuoteArchiveFolderSectionState,
} from "./DomesticOrderQuoteArchiveFolderSection";

/**
 * ============================================================================
 * 기타건 상세 「견적서」 탭 — **한 탭에 갈래 둘** (2026-11-06)
 * ============================================================================
 * 사용자 결정: 「수리건에 있는 [견적서]탭처럼 만들어줘」 · 「시스템에서 견적서를 만든 적이
 * 없는 … 건은 내자정리에 적힌 견적서 번호로 [견적서]탭의 공유폴더를 찾아서 띄워줘」 ·
 * 「[새 견적서] 단추는 넣지 않는다」.
 *
 * 여기서 재는 것은 셋이다:
 *  · 🔴 **구역이 무엇을 그리는가** — 상태를 직접 넣어 그려 본다(네트워크 없음)
 *  · 🔴 **통로를 부르는 길** — fetch 를 바꿔 끼워 값으로 본다. 🔴 주소에 **번호가 실리지
 *    않는다**(줄 id 하나다)
 *  · 🔴 **탭 페이지가 어느 갈래로 가는가** — 페이지는 서버 컴포넌트라 이 환경에서 그려 볼
 *    수 없어 원본을 글자로 읽는다(이웃 시험들과 같은 사정)
 *
 * 번호와 날짜를 고르는 규칙은 lib/domain/domestic-order-quote-archive.test.ts 가, 통로 쪽
 * 규율은 app/api/domestic-orders/[id]/quote-archive-folder/entries/route-source.test.ts 가,
 * 상자 · 표 · 줄의 [열기]는 components/quotes/QuoteArchiveFolderSection.test.tsx 가 본다 —
 * 🔴 **그리는 일을 그 구역에 맡겼기 때문에** 여기서 다시 재지 않는다.
 *
 * 🔴 번호 · 폴더 이름은 **가짜**다(이 저장소는 공개다). 모양만 실측과 같게 맞췄다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 탭 페이지의 머리말은 「[새 견적서] 단추를 넣지
 * 않는다」를 설명하느라 그 조각 이름(NewQuoteControl)을 그대로 적는다. 걷어내지 않으면
 * 「없다」를 재는 시험이 주석 때문에 빨개진다.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");

const flat = (source: string) => source.replace(/\s+/g, " ");

const QUOTES_PAGE_PATH = "src/app/(app)/domestic-orders/[id]/quotes/page.tsx";
const quotesPageRaw = read(QUOTES_PAGE_PATH);
const quotesPage = flat(stripComments(quotesPageRaw));
const sectionRaw = read("src/components/domestic-orders/detail/DomesticOrderQuoteArchiveFolderSection.tsx");
const sectionCode = flat(stripComments(sectionRaw));

/** 🔴 가짜 이름이다 — 모양만 실제와 같다. */
const RELATIVE_PATH = "21. 2026 내자견적서/DSS 2026-089 가나상사 MODEL-X1 L123 S456 수리 견적서";
const QUOTE_NUMBER = "DSS 2026-089";
const ROW_ID = "11111111-2222-3333-4444-555555555555";

function markup(state: DomesticOrderQuoteArchiveFolderSectionState, label = QUOTE_NUMBER): string {
  return renderToStaticMarkup(<DomesticOrderQuoteArchiveFolderSectionView state={state} label={label} />);
}

const foundState = (
  entries: ReadonlyArray<{ name: string; isDirectory?: boolean }> = []
): DomesticOrderQuoteArchiveFolderSectionState => ({
  kind: "found",
  relativePath: RELATIVE_PATH,
  entries: entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory === true, sizeBytes: 1024 })),
  totalCount: entries.length,
  truncated: false,
});

test("🔵 못 — 원본 둘이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
  assert.ok(quotesPage.length > 500, `탭 페이지 원본이 너무 짧다(${quotesPage.length})`);
  assert.ok(sectionCode.length > 500, `구역 원본이 너무 짧다(${sectionCode.length})`);
  // 🔴 머리말에는 그 이름이 있고 코드에는 없다 — 둘 다 봐야 「없다」가 뜻을 갖는다.
  assert.ok(quotesPageRaw.includes("NewQuoteControl"), "머리말이 바뀌었다 — 아래 못을 다시 보라");
  assert.equal(quotesPage.includes("NewQuoteControl"), false);
  assert.equal(flat(stripComments("/* canEdit */ const a = 1;")).includes("canEdit"), false);
  assert.ok(flat(stripComments("canEdit={false}")).includes("canEdit={false}"));
});

describe("🔴 구역 — 상태별로 무엇을 보이는가", () => {
  test("머리에 **내자 정리의 번호**가 적힌다 — 어느 폴더를 찾았는지 알 수 있게", () => {
    const html = markup(foundState([{ name: "DSS 2026-089 가나상사.xlsx" }]));
    assert.ok(html.includes(`공유폴더 — ${QUOTE_NUMBER}`), html);
  });

  test("🔴 그리는 일은 견적서 쪽 구역 한 벌이다 — 공용 상태 다섯이 **같은 글자**로 난다", () => {
    assert.ok(markup({ kind: "loading" }).includes(QUOTE_ARCHIVE_FOLDER_SECTION_LOADING_TEXT));
    assert.ok(markup({ kind: "not-found" }).includes(QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT));
    assert.ok(markup({ kind: "failed", reason: "느립니다" }).includes(QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT));
    assert.ok(markup({ kind: "failed", reason: "느립니다" }).includes("느립니다"));
    assert.ok(markup(foundState()).includes(QUOTE_ARCHIVE_FOLDER_SECTION_EMPTY_TEXT));
    assert.ok(markup({ kind: "multiple" }).includes(QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT));
  });

  test("🔴 설정이 꺼져 있으면 **아무것도 그리지 않는다**", () => {
    assert.equal(markup({ kind: "disabled" }), "");
  });

  test("🔴 맞는 폴더가 여럿이면 목록도 경로도 내지 않는다", () => {
    const html = markup({ kind: "multiple" });
    assert.equal(html.includes(RELATIVE_PATH), false, html);
    assert.equal(html.includes("<li"), false, html);
  });

  test("찾으면 줄이 그대로 서고, 열 수 있는 줄에만 [열기] 자리가 생긴다", () => {
    const html = markup(
      foundState([
        { name: "DSS 2026-089 가나상사 견적서.xlsx" },
        { name: "참고자료.pdf" },
        { name: "지난자료", isDirectory: true },
      ])
    );
    // 🔴 번호로 거르지 않는다 — 사람이 손으로 넣은 파일도 그대로 보인다(머리말).
    for (const name of ["DSS 2026-089 가나상사 견적서.xlsx", "참고자료.pdf", "지난자료"]) {
      assert.ok(html.includes(name), `${name} 줄이 없다: ${html}`);
    }
    // 폴더 줄에는 [열기] 표시가 붙지 않는다 — 파일 둘만 열 수 있다.
    assert.equal(html.split("data-quote-archive-folder-entry-openable").length - 1, 2, html);
  });

  describe("🔴 이 구역에만 있는 상태 둘 — 「없다」가 아니라 **아직 못 찾는다**", () => {
    test("번호가 없다 — 어디에 적으면 찾는지까지 적는다", () => {
      const html = markup({ kind: "no-quote-number" }, "");
      assert.ok(html.includes(DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT), html);
      // 🔴 경고가 아니다 — 차분한 글자이고, 「읽지 못했습니다」와 섞이지 않는다.
      assert.equal(html.includes(QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT), false, html);
      assert.equal(html.includes(QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT), false, html);
      assert.ok(html.includes("text-zinc-500"), html);
    });

    test("연도를 못 정한다 — 그 번호를 적어 준다", () => {
      const html = markup({ kind: "no-quote-date" });
      assert.ok(html.includes(domesticOrderQuoteArchiveNoDateText(QUOTE_NUMBER)), html);
      assert.ok(html.includes(QUOTE_NUMBER), html);
      assert.equal(html.includes(QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT), false, html);
    });

    test("🔴 둘 다 폴더 경로도 [폴더 열기]도 없다 — 열 자리가 없다", () => {
      for (const state of [{ kind: "no-quote-number" }, { kind: "no-quote-date" }] as const) {
        const html = markup(state);
        assert.equal(html.includes(RELATIVE_PATH), false, html);
        assert.equal(html.includes("<button"), false, html);
      }
    });
  });

  test("인쇄에 안 찍힌다 — 공유폴더는 그때그때 달라지는 바깥 사정이다", () => {
    for (const html of [markup(foundState([{ name: "a.xlsx" }])), markup({ kind: "no-quote-number" })]) {
      assert.ok(html.includes("print:hidden"), html);
    }
  });
});

describe("🔴 통로를 부르는 길 — 네트워크 없이 값으로", () => {
  test("🔴 주소에 **번호가 실리지 않는다** — 줄 id 하나다", () => {
    const url = domesticOrderQuoteArchiveFolderEntriesUrl(ROW_ID);
    assert.equal(url, `/api/domestic-orders/${ROW_ID}/quote-archive-folder/entries`);
    assert.equal(url.includes("2026"), false, url);
    // 번호를 실을 칸이 원본에도 없다(물음표 뒤가 통째로 없다).
    assert.equal(sectionCode.includes("?quoteNumber="), false);
    assert.equal(sectionCode.includes("searchParams"), false);
    // 이상한 글자가 와도 주소를 지어내지 않는다.
    assert.ok(domesticOrderQuoteArchiveFolderEntriesUrl("a/b?c").includes("a%2Fb%3Fc"));
  });

  const response = (payload: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => payload,
  });

  test("부르는 주소는 그 줄의 것이다 — 한 번만 부른다", async () => {
    const calls: string[] = [];
    await loadDomesticOrderQuoteArchiveFolderEntries(ROW_ID, async (url) => {
      calls.push(url);
      return response({ status: "not-found" });
    });
    assert.deepEqual(calls, [`/api/domestic-orders/${ROW_ID}/quote-archive-folder/entries`]);
  });

  test("🔴 이 통로에만 있는 상태 둘을 그대로 읽는다 — 「읽지 못했습니다」로 바꿔 말하지 않는다", async () => {
    for (const [status, kind] of [
      ["no-quote-number", "no-quote-number"],
      ["no-quote-date", "no-quote-date"],
    ] as const) {
      const state = await loadDomesticOrderQuoteArchiveFolderEntries(ROW_ID, async () => response({ status }));
      assert.deepEqual(state, { kind });
    }
  });

  test("나머지 상태는 견적서 쪽 읽기에 그대로 맡긴다", async () => {
    const state = await loadDomesticOrderQuoteArchiveFolderEntries(ROW_ID, async () =>
      response({
        status: "found",
        relativePath: RELATIVE_PATH,
        entries: [{ name: "DSS 2026-089.xlsx", isDirectory: false, sizeBytes: 10, modifiedAt: "2026-09-08T02:00:00.000Z" }],
        totalCount: 1,
        truncated: false,
      })
    );
    assert.equal(state.kind, "found");
    assert.deepEqual(readDomesticOrderQuoteArchiveFolderAnswer({ status: "disabled" }), { kind: "disabled" });
    assert.deepEqual(readDomesticOrderQuoteArchiveFolderAnswer({ status: "multiple" }), { kind: "multiple" });
  });

  test("던지지 않는다 — 거절 · 끊김 · 모르는 모양이 모두 `failed` 한 상태로 끝난다", async () => {
    const rejected = await loadDomesticOrderQuoteArchiveFolderEntries(ROW_ID, async () =>
      response({ error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" }, false, 403)
    );
    assert.deepEqual(rejected, { kind: "failed", reason: "이 작업을 수행할 권한이 없습니다." });

    const offline = await loadDomesticOrderQuoteArchiveFolderEntries(ROW_ID, async () => {
      throw new Error("offline");
    });
    assert.equal(offline.kind, "failed");

    const garbage = await loadDomesticOrderQuoteArchiveFolderEntries(ROW_ID, async () =>
      response({ status: "무엇인가" })
    );
    assert.deepEqual(garbage, { kind: "failed", reason: "서버 응답을 읽지 못했습니다" });
  });
});

describe("🔴 탭 페이지 — 갈래 둘이 한 화면에 있다", () => {
  test("① 시스템 견적서가 있으면 **목록 + 그 견적서 id 로 폴더**(수리 건 탭과 같다)", () => {
    assert.ok(quotesPage.includes("const rows = await listQuotesForDomesticOrder(row.quoteId);"), quotesPage);
    assert.ok(quotesPage.includes("if (rows.length > 0) {"), quotesPage);
    assert.ok(quotesPage.includes("<QuoteListSlots rows={rows}"), quotesPage);
    assert.ok(quotesPage.includes("groupQuotesByArchiveBaseNumber(rows)"), quotesPage);
    assert.ok(
      quotesPage.includes("<QuoteArchiveFolderSection key={group.baseNumber} quoteId={group.quoteId}"),
      quotesPage
    );
  });

  test("② 없으면 **내자에 적힌 번호로 폴더만** — 줄 id 를 넘기고 번호는 머리 글자다", () => {
    assert.ok(quotesPage.includes("const lookup = resolveDomesticOrderQuoteArchiveLookup(row);"), quotesPage);
    assert.ok(
      quotesPage.includes("<DomesticOrderQuoteArchiveFolderSection domesticOrderId={row.id} label={lookup.quoteNumber} />"),
      quotesPage
    );
    // 목록이 왜 비었는지를 적는다 — 없으면 「견적서가 사라졌다」로 읽힌다.
    assert.ok(quotesPage.includes("domesticOrderQuoteArchiveOnlyText(lookup.quoteNumber)"), quotesPage);
    assert.ok(domesticOrderQuoteArchiveOnlyText(QUOTE_NUMBER).includes(QUOTE_NUMBER));
  });

  test("🔴 둘 다 아닐 때도 **조용한 빈 화면이 아니다** — 까닭이 갈라 적힌다", () => {
    /**
     * 🔴 **그 가지가 무엇을 돌려주는지**를 본다 — 글자가 어딘가에 있는지가 아니다. 들여온
     * 이름은 import 줄에도 있어서, `return null;` 로 바꿔도 「글자가 있다」는 그대로
     * 통과한다(이 시험을 쓰면서 실제로 그랬다).
     */
    for (const [name, branch, text] of [
      ["번호가 없다", 'if (lookup.status === "no-quote-number") {', "DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT"],
      ["연도를 못 정한다", 'if (lookup.status === "no-quote-date") {', "domesticOrderQuoteArchiveNoDateText(lookup.quoteNumber)"],
    ] as const) {
      const at = quotesPage.indexOf(branch);
      assert.ok(at >= 0, `${name} 가지가 없다`);
      const body = quotesPage.slice(at, at + 260);
      assert.ok(body.includes("<DomesticOrderDetailNotice"), `${name} 가지가 안내 상자를 세우지 않는다: ${body}`);
      assert.ok(body.includes(text), `${name} 가지가 그 문장을 쓰지 않는다: ${body}`);
    }
    // 🔴 자리표시 문구는 사라졌다 — 이 탭은 이제 진짜 내용을 그린다.
    assert.equal(quotesPage.includes("다음 조각에서 채웁니다"), false, quotesPage);
  });

  test("🔴 [새 견적서] 단추가 없다 (사용자 결정) — 슬롯도 조각도 들여오지 않는다", () => {
    for (const gone of ["NewQuoteControl", "newQuoteControl", "newQuoteHrefForRepairCase", "NewQuoteDialog"]) {
      assert.equal(quotesPage.includes(gone), false, `${gone} 가 되살아났다`);
    }
    // 공용 화면이 그 자리를 그릴지 정하는 값도 거짓이다 — 두 겹으로 막는다.
    assert.ok(quotesPage.includes("canEdit={false}"), quotesPage);
    // 그래서 이 탭은 쓰기 권한을 묻지도 않는다.
    assert.equal(quotesPage.includes('"WRITE"'), false, quotesPage);
  });

  test("🔴 제품 단위 폴더 구역이 없다 — 그것은 수리 건 id 를 받는 구역이다", () => {
    for (const gone of ["QuoteArchiveProductFolderSection", "hasQuoteArchiveProductKeys", "repairCaseId"]) {
      assert.equal(quotesPage.includes(gone), false, `${gone} 가 들어왔다`);
    }
  });

  test("🔴 함수 슬롯 넷을 서버에서 넘기지 않는다 — 넘기면 화면이 통째로 죽는다", () => {
    for (const slot of ["rowHref=", "intakeHref=", "renderFileBadges=", "renderRowActions="]) {
      assert.equal(quotesPage.includes(slot), false, `${slot} 를 서버 컴포넌트에서 넘기고 있다`);
    }
    assert.ok(quotesPage.includes('import QuoteListSlots from "@/components/quotes/QuoteListSlots";'), quotesPage);
  });

  test("🔴 서버에서 공유폴더를 읽지 않는다 — 읽기는 화면이 뜬 뒤 구역이 한다", () => {
    for (const gone of ["@/lib/storage/", "listQuoteArchiveEntries", "node:fs", "findQuoteArchiveFolder"]) {
      assert.equal(quotesPage.includes(gone), false, `탭이 서버에서 공유폴더를 읽는다: ${gone}`);
    }
    assert.ok(sectionCode.includes("useEffect(() => {"), "구역이 화면이 뜬 뒤에 부르지 않는다");
  });

  test("🔴 인가 — 레이아웃이 감춘 것은 관문이 아니다(열쇠 둘을 페이지가 다시 본다)", () => {
    assert.ok(quotesPage.includes('await requireAreaAccessForCurrentUser("domesticOrders");'), quotesPage);
    // 🔴 2026-11-12(둘째): 묻는 **열쇠는 그대로 `quotes` READ** 이고, 묻는 **길**만 탭 표를
    //    거치게 됐다(auth/domestic-order-detail-tab-permissions.ts). 레이아웃이 탭 단추를
    //    그릴지 정할 때도 같은 창구를 쓰므로 둘이 갈라질 자리가 없어졌다.
    //    🔵 열쇠가 그대로라는 것은 표를 값으로 읽어 못 박는다.
    assert.deepEqual(DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS.quotes, {
      anyOf: [{ key: "quotes", level: "READ" }],
    });
    assert.ok(quotesPage.includes('await canOpenDomesticOrderDetailTab(actingUser, "quotes")'), quotesPage);
    assert.ok(quotesPage.includes("권한이 없습니다"), quotesPage);
    // 살아 있는 계정을 다시 읽는다 — 강등된 계정이 옛 토큰으로 금액을 보지 못하게.
    assert.ok(quotesPage.includes("await resolveActingUserForSession(session)"), quotesPage);
    // 없는 줄 · 휴지통에 든 줄은 404 다.
    assert.ok(quotesPage.includes("await getDomesticOrderDetail(id);"), quotesPage);
    assert.ok(quotesPage.includes("if (!row) notFound();"), quotesPage);
  });

  test("🔴 통로도 같은 열쇠 둘을 스스로 본다 — 화면만 막으면 주소를 직접 치면 열린다", () => {
    const routeCode = flat(
      stripComments(read("src/app/api/domestic-orders/[id]/quote-archive-folder/entries/route.ts"))
    );
    assert.ok(routeCode.includes('hasPermission(actingUser, "domesticOrders", "READ")'), routeCode.slice(0, 200));
    assert.ok(routeCode.includes('hasPermission(actingUser, "quotes", "READ")'), routeCode.slice(0, 200));
  });
});
