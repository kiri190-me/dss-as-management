import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT,
} from "@/components/repair-cases/purchase-orders/PurchaseOrderFolderSection";
import { DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT } from "@/lib/domain/domestic-order-purchase-order-archive";
import {
  DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_MULTIPLE_TEXT,
  DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_NOT_FOUND_TEXT,
  DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_SCOPE_TEXT,
  DomesticOrderPurchaseOrderFolderSectionView,
  domesticOrderPurchaseOrderFolderEntriesUrl,
  loadDomesticOrderPurchaseOrderFolderEntries,
  readDomesticOrderPurchaseOrderFolderAnswer,
  type DomesticOrderPurchaseOrderFolderSectionState,
} from "./DomesticOrderPurchaseOrderFolderSection";

/**
 * ============================================================================
 * 기타건 상세 「발주서」 탭 — **내자에 적힌 번호의 공유폴더** (2026-11-06)
 * ============================================================================
 * 사용자 결정: 「[발주서]는 내자정리에 적힌 **[발주서 번호]**를 통해서 발주서들을 찾도록
 * 해줘 … **같은 발주서 번호를 가진 폴더와 연결**시켜줘」.
 *
 * 여기서 재는 것은 셋이다:
 *  · 🔴 **구역이 무엇을 그리는가** — 상태를 직접 넣어 그려 본다(네트워크 없음). 🔴 수리 건
 *    쪽 문장 셋(「이 **장비**의」 · 「같은 **날짜**의」 · 「이 장비(L/N · S/N)의 …」)이
 *    **이 화면에 오지 않는다** — 장비도 날짜도 쓰지 않는 화면이라 그 글자는 거짓말이다
 *  · 🔴 **통로를 부르는 길** — fetch 를 바꿔 끼워 값으로 본다. 🔴 주소에 **번호가 실리지
 *    않는다**(줄 id 하나다)
 *  · 🔴 **탭 페이지가 어느 갈래로 가는가** — 페이지는 서버 컴포넌트라 이 환경에서 그려 볼
 *    수 없어 원본을 글자로 읽는다(이웃 시험들과 같은 사정)
 *
 * 번호를 고르는 규칙은 lib/domain/domestic-order-purchase-order-archive.test.ts 가, 폴더 이름
 * 읽기는 lib/domain/purchase-order-folder-number.test.ts 가, 찾기 · 읽기는
 * lib/storage/purchase-order-number-archive.test.ts 가, 통로 쪽 규율은
 * app/api/domestic-orders/[id]/purchase-order-folder/entries/route-source.test.ts 가 본다.
 *
 * 🔴 번호 · 폴더 이름은 **가짜**다(이 저장소는 공개다). 모양만 실측과 같게 맞췄다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");

const flat = (source: string) => source.replace(/\s+/g, " ");

const PAGE_PATH = "src/app/(app)/domestic-orders/[id]/purchase-orders/page.tsx";
const pageRaw = read(PAGE_PATH);
const page = flat(stripComments(pageRaw));
const sectionRaw = read("src/components/domestic-orders/detail/DomesticOrderPurchaseOrderFolderSection.tsx");
const sectionCode = flat(stripComments(sectionRaw));

/** 🔴 가짜 번호 · 가짜 폴더 이름이다 — 모양만 실제와 같다. */
const NUMBER = "PO261103031";
const RELATIVE_PATH = "2026/2. 다라전자/117. 내자 20261103_PO261103031_(고객) 30kW 부속케이블 3SET - (금액)";
const ROW_ID = "11111111-2222-3333-4444-555555555555";

function markup(state: DomesticOrderPurchaseOrderFolderSectionState, label = NUMBER): string {
  return renderToStaticMarkup(<DomesticOrderPurchaseOrderFolderSectionView state={state} label={label} />);
}

const foundState = (
  entries: ReadonlyArray<{ name: string; isDirectory?: boolean }> = [],
  overrides: { totalCount?: number; truncated?: boolean } = {}
): DomesticOrderPurchaseOrderFolderSectionState => ({
  kind: "found",
  relativePath: RELATIVE_PATH,
  // 🔵 이 길은 폴더 이름의 날짜를 읽지 않는다 — 늘 빈 글자다(구역 머리말).
  issuedDate: "",
  entries: entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory === true, sizeBytes: 1024 })),
  totalCount: overrides.totalCount ?? entries.length,
  truncated: overrides.truncated ?? false,
});

test("🔵 못 — 원본 둘이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
  assert.ok(page.length > 400, `탭 페이지 원본이 너무 짧다(${page.length})`);
  assert.ok(sectionCode.length > 500, `구역 원본이 너무 짧다(${sectionCode.length})`);
  // 🔴 머리말에는 그 낱말이 있고 코드에는 없다 — 둘 다 봐야 「없다」가 뜻을 갖는다.
  assert.ok(pageRaw.includes("quotes"), "머리말이 바뀌었다 — 아래 못을 다시 보라");
  assert.equal(page.includes('"quotes"'), false);
  assert.equal(flat(stripComments("/* notFound */ const a = 1;")).includes("notFound"), false);
  assert.ok(flat(stripComments("if (!row) notFound();")).includes("notFound();"));
});

describe("🔴 구역 — 상태별로 무엇을 보이는가", () => {
  test("머리에 **내자 정리의 발주서번호**가 적힌다 — 어느 발주 건인지 알 수 있게", () => {
    const html = markup(foundState([{ name: "발주서.pdf" }]));
    assert.ok(html.includes(`공유폴더 — ${NUMBER}`), html);
    // 찾았을 때만 그 폴더의 **루트 기준** 경로가 함께 선다(절대 경로가 아니다).
    assert.ok(html.includes("2026/2. 다라전자"), html);
  });

  test("공용 상태 셋은 수리 건 쪽과 **같은 글자**다 — 줄 읽기 · 공통 문장은 한 벌이다", () => {
    assert.ok(markup({ kind: "loading" }).includes(PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT));
    assert.ok(markup(foundState()).includes(PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT));
    const failed = markup({ kind: "failed", reason: "공유폴더가 느립니다" });
    assert.ok(failed.includes(PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT), failed);
    assert.ok(failed.includes("공유폴더가 느립니다"), failed);
  });

  test("🔴 **수리 건 쪽 문장 셋은 오지 않는다** — 장비도 날짜도 쓰지 않는 화면이다", () => {
    const notFound = markup({ kind: "not-found" });
    assert.ok(notFound.includes(DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_NOT_FOUND_TEXT), notFound);
    assert.equal(notFound.includes(PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT), false, notFound);

    const multiple = markup({ kind: "multiple" });
    assert.ok(multiple.includes(DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_MULTIPLE_TEXT), multiple);
    assert.equal(multiple.includes(PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT), false, multiple);

    const found = markup(foundState([{ name: "발주서.pdf" }]));
    assert.ok(found.includes(DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_SCOPE_TEXT), found);
    assert.equal(found.includes(PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT), false, found);
    // 🔵 못 — 수리 건 쪽 문장 셋이 실제로 **장비 · 날짜**를 말하고 있다(그래서 못 쓴다).
    assert.ok(PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT.includes("장비"));
    assert.ok(PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT.includes("날짜"));
    assert.ok(PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT.includes("L/N"));
    // 🔴 그리고 이쪽 문장은 **번호**를 말한다.
    assert.ok(DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_NOT_FOUND_TEXT.includes("발주서번호"));
    assert.ok(DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_MULTIPLE_TEXT.includes("발주서번호"));
  });

  test("🔴 설정이 꺼져 있으면 **아무것도 그리지 않는다**", () => {
    assert.equal(markup({ kind: "disabled" }), "");
  });

  test("🔴 맞는 폴더가 여럿이면 목록도 경로도 [폴더 열기]도 없다", () => {
    const html = markup({ kind: "multiple" });
    assert.equal(html.includes(RELATIVE_PATH), false, html);
    assert.equal(html.includes("<li"), false, html);
    assert.equal(html.includes("<button"), false, html);
  });

  test("찾으면 줄이 그대로 서고, 열 수 있는 줄에만 [열기] 자리가 생긴다", () => {
    const html = markup(
      foundState([
        { name: "발주서.pdf" },
        { name: "참고자료.xlsx" },
        { name: "지난자료", isDirectory: true },
      ])
    );
    // 🔴 번호로 거르지 않는다 — 사람이 손으로 넣은 파일도 그대로 보인다(머리말).
    for (const name of ["발주서.pdf", "참고자료.xlsx", "지난자료"]) {
      assert.ok(html.includes(name), `${name} 줄이 없다: ${html}`);
    }
    // 폴더 줄에는 [열기] 표시가 붙지 않는다 — 파일 둘만 열 수 있다.
    assert.equal(html.split("data-domestic-order-purchase-order-folder-entry-openable").length - 1, 2, html);
  });

  test("잘렸으면 「더 있습니다」가 선다 — 수리 건 쪽과 같은 곁말 한 벌", () => {
    const html = markup(foundState([{ name: "발주서.pdf" }], { totalCount: 120, truncated: true }));
    assert.ok(html.includes("더 있습니다"), html);
    assert.ok(html.includes("120"), html);
  });

  describe("🔴 이 구역에만 있는 상태 — 「없다」가 아니라 **아직 못 찾는다**", () => {
    test("번호가 없다 — 어디에 적으면 찾는지까지 적는다", () => {
      const html = markup({ kind: "no-po-number" }, "");
      assert.ok(html.includes(DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT), html);
      // 🔴 경고가 아니다 — 차분한 글자이고, 「읽지 못했습니다」와 섞이지 않는다.
      assert.equal(html.includes(PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT), false, html);
      assert.equal(html.includes(DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_NOT_FOUND_TEXT), false, html);
      assert.ok(html.includes("text-zinc-500"), html);
      // 열 자리가 없다 — 경로도 단추도 안 그린다.
      assert.equal(html.includes(RELATIVE_PATH), false, html);
      assert.equal(html.includes("<button"), false, html);
    });
  });

  test("인쇄에 안 찍힌다 — 공유폴더는 그때그때 달라지는 바깥 사정이다", () => {
    for (const html of [markup(foundState([{ name: "발주서.pdf" }])), markup({ kind: "no-po-number" })]) {
      assert.ok(html.includes("print:hidden"), html);
    }
  });
});

describe("🔴 통로를 부르는 길 — 네트워크 없이 값으로", () => {
  test("🔴 주소에 **번호가 실리지 않는다** — 줄 id 하나다", () => {
    const url = domesticOrderPurchaseOrderFolderEntriesUrl(ROW_ID);
    assert.equal(url, `/api/domestic-orders/${ROW_ID}/purchase-order-folder/entries`);
    assert.equal(url.includes("PO"), false, url);
    // 번호를 실을 칸이 원본에도 없다(물음표 뒤가 통째로 없다).
    assert.equal(sectionCode.includes("?purchaseOrderNumber="), false);
    assert.equal(sectionCode.includes("searchParams"), false);
    // 이상한 글자가 와도 주소를 지어내지 않는다.
    assert.ok(domesticOrderPurchaseOrderFolderEntriesUrl("a/b?c").includes("a%2Fb%3Fc"));
  });

  const response = (payload: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => payload,
  });

  test("부르는 주소는 그 줄의 것이다 — 한 번만 부른다", async () => {
    const calls: string[] = [];
    await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async (url) => {
      calls.push(url);
      return response({ status: "not-found" });
    });
    assert.deepEqual(calls, [`/api/domestic-orders/${ROW_ID}/purchase-order-folder/entries`]);
  });

  test("🔴 이 통로에만 있는 상태를 그대로 읽는다 — 「읽지 못했습니다」로 바꿔 말하지 않는다", async () => {
    const state = await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async () =>
      response({ status: "no-po-number" })
    );
    assert.deepEqual(state, { kind: "no-po-number" });
  });

  test("🔴 `no-order-date` 는 **모르는 모양**이다 — 이 통로가 내지 않는 상태다", async () => {
    // 🔴 그 글자를 그리면 이 화면에 없는 조건(발주발행일)을 사람에게 설명하게 된다.
    assert.equal(readDomesticOrderPurchaseOrderFolderAnswer({ status: "no-order-date" }), null);
    const state = await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async () =>
      response({ status: "no-order-date" })
    );
    assert.deepEqual(state, { kind: "failed", reason: "서버 응답을 읽지 못했습니다" });
    // 🔵 못 — 그 글자는 수리 건 구역에 **그대로 있다**(저쪽을 고치지 않았다).
    assert.ok(PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT.includes("발주발행일"));
  });

  test("나머지 상태는 수리 건 쪽 읽기에 그대로 맡긴다", async () => {
    const state = await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async () =>
      response({
        status: "found",
        relativePath: RELATIVE_PATH,
        entries: [
          { name: "발주서.pdf", isDirectory: false, sizeBytes: 10, modifiedAt: "2026-11-03T02:00:00.000Z" },
        ],
        totalCount: 1,
        truncated: false,
      })
    );
    assert.equal(state.kind, "found");
    if (state.kind !== "found") return;
    assert.equal(state.relativePath, RELATIVE_PATH);
    assert.deepEqual(
      state.entries.map((entry) => entry.name),
      ["발주서.pdf"]
    );
    assert.deepEqual(readDomesticOrderPurchaseOrderFolderAnswer({ status: "disabled" }), { kind: "disabled" });
    assert.deepEqual(readDomesticOrderPurchaseOrderFolderAnswer({ status: "multiple" }), { kind: "multiple" });
  });

  test("던지지 않는다 — 거절 · 끊김 · 모르는 모양이 모두 `failed` 한 상태로 끝난다", async () => {
    const rejected = await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async () =>
      response({ error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" }, false, 403)
    );
    assert.deepEqual(rejected, { kind: "failed", reason: "이 작업을 수행할 권한이 없습니다." });

    const offline = await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async () => {
      throw new Error("offline");
    });
    assert.equal(offline.kind, "failed");

    const garbage = await loadDomesticOrderPurchaseOrderFolderEntries(ROW_ID, async () =>
      response({ status: "무엇인가" })
    );
    assert.deepEqual(garbage, { kind: "failed", reason: "서버 응답을 읽지 못했습니다" });
  });
});

describe("🔴 탭 페이지 — 번호가 있으면 구역, 없으면 까닭", () => {
  test("🔴 자리표시 문구가 사라졌다 — 이 탭은 이제 진짜 내용을 그린다", () => {
    assert.equal(page.includes("다음 조각에서 채웁니다"), false, page);
  });

  test("번호가 있으면 **줄 id 를 넘기고** 번호는 머리 글자다", () => {
    assert.ok(page.includes("const lookup = resolveDomesticOrderPurchaseOrderArchiveLookup(row);"), page);
    assert.ok(
      page.includes(
        "<DomesticOrderPurchaseOrderFolderSection domesticOrderId={row.id} label={lookup.purchaseOrderNumber} />"
      ),
      page
    );
  });

  test("🔴 번호가 없으면 **조용한 빈 화면이 아니다** — 그 가지가 안내 상자를 세운다", () => {
    /**
     * 🔴 **그 가지가 무엇을 돌려주는지**를 본다 — 글자가 어딘가에 있는지가 아니다. 들여온
     * 이름은 import 줄에도 있어서, `return null;` 로 바꿔도 「글자가 있다」는 그대로 통과한다.
     */
    const at = page.indexOf('if (lookup.status === "no-po-number") {');
    assert.ok(at >= 0, page);
    const body = page.slice(at, at + 260);
    assert.ok(body.includes("<DomesticOrderDetailNotice"), body);
    assert.ok(body.includes("DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT"), body);
  });

  test("🔴 인가 — 레이아웃이 감춘 것은 관문이 아니다(열쇠를 페이지가 다시 본다)", () => {
    assert.ok(page.includes('await requireAreaAccessForCurrentUser("domesticOrders");'), page);
    // 없는 줄 · 휴지통에 든 줄은 404 다.
    assert.ok(page.includes("await getDomesticOrderDetail(id);"), page);
    assert.ok(page.includes("if (!row) notFound();"), page);
    // 🔴 열쇠는 하나다 — 발주서는 내자 영역이 답한다(견적서 열쇠를 묻지 않는다).
    assert.equal(page.includes("hasPermission"), false, page);
  });

  test("🔴 통로도 같은 열쇠를 스스로 본다 — 화면만 막으면 주소를 직접 치면 열린다", () => {
    const routeCode = flat(
      stripComments(read("src/app/api/domestic-orders/[id]/purchase-order-folder/entries/route.ts"))
    );
    assert.ok(routeCode.includes('hasPermission(actingUser, "domesticOrders", "READ")'), routeCode.slice(0, 200));
    assert.ok(routeCode.includes("resolveDomesticOrderPurchaseOrderArchiveLookup(row)"), routeCode.slice(0, 200));
  });

  test("🔴 서버에서 공유폴더를 읽지 않는다 — 읽기는 화면이 뜬 뒤 구역이 한다", () => {
    for (const gone of ["@/lib/storage/", "findPurchaseOrderArchiveFolder", "node:fs"]) {
      assert.equal(page.includes(gone), false, `탭이 서버에서 공유폴더를 읽는다: ${gone}`);
    }
    assert.ok(sectionCode.includes("useEffect(() => {"), "구역이 화면이 뜬 뒤에 부르지 않는다");
  });
});
