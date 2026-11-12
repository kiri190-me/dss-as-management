import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { RepairCaseDetailTabVisibility } from "@/lib/auth/repair-case-detail-tab-permissions";
import { buildRepairCaseDetailTabs } from "@/components/repair-cases/detail/detail-tabs-list";
import {
  SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
  SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
  SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
  SHARE_FOLDER_ENTRY_ROW_CLASS,
} from "@/lib/domain/share-folder-entry-meta";
import PurchaseOrderFolderSection, {
  PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT,
  PurchaseOrderFolderSectionView,
  canOpenPurchaseOrderFolderEntry,
  loadPurchaseOrderFolderEntries,
  purchaseOrderFolderEntriesUrl,
  purchaseOrderFolderEntryMeta,
  purchaseOrderFolderOpenPath,
  purchaseOrderFolderTruncatedText,
  readPurchaseOrderFolderEntriesAnswer,
  type PurchaseOrderFolderSectionState,
} from "./PurchaseOrderFolderSection";

/**
 * ============================================================================
 * 「발주서」 탭의 공유폴더 구역 — 상태 여덟 · 자리 · 인쇄 · 읽기만 (2026-10-12)
 * ============================================================================
 * 통로 쪽 규율은 app/api/repair-cases/[id]/purchase-order-folder/entries/route-source.test.ts 가,
 * 실제 읽기는 lib/storage/purchase-order-archive.test.ts 가, 이름 읽기는
 * lib/domain/purchase-order-folder-name.test.ts 가 본다. 여기서는 **화면이 무엇을 내는가**와
 * **줄의 [열기]가 어느 줄에만 생기는가**, 그리고 **탭이 어디에 서는가**를 본다.
 *
 * 🔴 네트워크를 쓰지 않는다 — fetch 는 값을 돌려주는 가짜로 바꿔 끼운다. 고객사 · 모델 ·
 * L/N · S/N 은 가짜다(저장소가 공개다).
 * ============================================================================
 */

const sectionSource = readFileSync(new URL("./PurchaseOrderFolderSection.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const sectionCode = sectionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const srcDir = fileURLToPath(new URL("../../../", import.meta.url));
const tabPage = readFileSync(
  path.join(srcDir, "app", "(app)", "repair-cases", "[id]", "purchase-orders", "page.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");
/**
 * 🔴 탭 줄은 파일 **둘**이 되었다(2026-11-12) — 그리는 조각(DetailTabs.tsx)과, 무엇을
 * 어떤 차례로 그릴지 정하는 순수 함수(detail-tabs-list.ts). 아래 '화면이 권한을 묻지
 * 않는다'는 **둘 다** 봐야 한다: 한쪽만 보면 다른 쪽으로 옮겨 적는 순간 조용히 통과한다.
 */
const detailTabs = readFileSync(
  path.join(srcDir, "components", "repair-cases", "detail", "DetailTabs.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");
const detailTabsList = readFileSync(
  path.join(srcDir, "components", "repair-cases", "detail", "detail-tabs-list.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

/** 여덟 탭이 전부 보이는 세션. 차례를 재는 데 쓴다. */
const ALL_TABS_VISIBLE: RepairCaseDetailTabVisibility = {
  execution: true,
  diagnosis: true,
  workHistory: true,
  files: true,
  report: true,
  quotes: true,
  purchaseOrders: true,
  approval: true,
};

const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
/** 🔴 실제 폴더 이름 **모양** — 값은 가짜다. */
const RELATIVE_PATH = "2026/1. 가나전자/101. 내자 20251223_PO4500371858_MODEL-X1_AB1234_1234567 - 1,000,000원";

function render(state: PurchaseOrderFolderSectionState): string {
  return renderToStaticMarkup(createElement(PurchaseOrderFolderSectionView, { state }));
}

function foundState(
  overrides: Partial<Extract<PurchaseOrderFolderSectionState, { kind: "found" }>> = {}
): PurchaseOrderFolderSectionState {
  return {
    kind: "found",
    relativePath: RELATIVE_PATH,
    issuedDate: "2025-12-23",
    entries: [{ name: "발주서.pdf", isDirectory: false, sizeBytes: 1024, modifiedAt: "2026-01-02T03:04:05.000Z" }],
    totalCount: 1,
    truncated: false,
    ...overrides,
  };
}

describe("상태마다 무엇을 보이는가", () => {
  test("불러오는 중", () => {
    const html = render({ kind: "loading" });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT));
    assert.ok(html.includes('aria-live="polite"'));
  });

  test("🔴 `disabled` 면 **아무것도 그리지 않는다**", () => {
    assert.equal(render({ kind: "disabled" }), "");
  });

  test("🔴 발주발행일이 비면 **차분한 한 줄**이다 — 경고가 아니다", () => {
    const html = render({ kind: "no-order-date" });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT));
    // 경고색(amber)이 아니라 흐린 글씨다 — 고장이 아니라 아직 그때가 아니라는 뜻이다.
    assert.equal(html.includes("amber"), false, "차분해야 할 줄이 경고로 섰다");
    // 어디에 적어야 하는지를 함께 알려 준다.
    assert.ok(PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT.includes("내자 정리"));
    // 🔴 공유폴더를 본 적이 없으므로 경로도 단추도 없다.
    assert.equal(html.includes(RELATIVE_PATH), false);
    assert.equal(html.includes("data-contact-folder-place-open"), false);
  });

  test("🔴 못 찾았을 때 — **찾아봤지만 없다**는 뜻이 드러난다", () => {
    const html = render({ kind: "not-found" });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT));
    assert.equal(html.includes("data-contact-folder-place-open"), false, "열 자리가 없는데 단추가 섰다");
    // 🔴 이 상태는 **연도 폴더를 전부 훑은 뒤**다. 2026-10-12 판은 「**아직** … 찾지
    //    **못했습니다**」였고 그 말이 「아직 안 해 봤다」로 읽혔다 — 그때 할 일은 기다리는
    //    것이 아니라 공유폴더를 정리하는 것이다(2026-11-11 사용자 결정).
    assert.ok(
      PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT.includes("찾아봤"),
      PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT
    );
    assert.ok(
      PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT.includes("없습니다"),
      PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT
    );
    assert.equal(
      PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT.includes("아직"),
      false,
      "「아직」이 있으면 아직 안 해 본 것으로 읽힌다"
    );
    // 🔴 열쇠가 없을 때의 문장이 **여기 섞이지 않는다** — 사람이 할 일이 정반대다.
    assert.equal(html.includes(PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT), false, html);
  });

  test("🔴 L/N · S/N 이 없으면 **다른 문장**이다 — 할 일이 공유폴더 정리가 아니다", () => {
    const html = render({ kind: "no-equipment-key" });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT), html);
    // 🔴 **갈라졌는지**를 글자로 본다 — 「다 뒤졌는데 없다」 문장이 함께 나오면 가른 뜻이 없다.
    assert.equal(html.includes(PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT), false, html);
    assert.notEqual(
      PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT,
      PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT
    );
    // 🔴 **둘 다** 있어야 한다는 것이 드러나야 한다 — S/N 하나로는 장비가 확정되지 않는다
    //    (같은 S/N 에 모델이 셋인 사례가 있다 — domain/purchase-order-folder-name.ts 머리말).
    for (const must of ["L/N", "S/N", "둘 다"]) {
      assert.ok(
        PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT.includes(must),
        `${must} 가 빠졌다: ${PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT}`
      );
    }
    // 🔴 어디를 고쳐야 하는지까지 적는다 — 공유폴더가 아니라 **접수 정보**다.
    assert.ok(
      PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT.includes("접수 정보"),
      PURCHASE_ORDER_FOLDER_SECTION_NO_EQUIPMENT_KEY_TEXT
    );
    // 고장이 아니다 — 경고색(amber)이 아니라 흐린 글씨이고, 「읽지 못했습니다」와 섞이지 않는다.
    assert.equal(html.includes("amber"), false, "차분해야 할 줄이 경고로 섰다");
    assert.equal(html.includes(PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT), false, html);
    // 🔴 공유폴더를 한 번도 안 봤으므로 경로도 줄도 단추도 없다.
    assert.equal(html.includes(RELATIVE_PATH), false, html);
    assert.equal(html.includes("<li"), false, html);
    assert.equal(html.includes("data-contact-folder-place-open"), false, html);
    assert.equal(purchaseOrderFolderOpenPath({ kind: "no-equipment-key" }), "");
  });

  test("🔴 `multiple` 이면 **목록도 경로도 내지 않는다**", () => {
    const html = render({ kind: "multiple" });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT));
    assert.equal(html.includes(RELATIVE_PATH), false, "어느 폴더인지 모르는데 경로가 나왔다");
    assert.equal(html.includes("발주서.pdf"), false);
    assert.equal(html.includes("data-contact-folder-place-open"), false);
    assert.equal(purchaseOrderFolderOpenPath({ kind: "multiple" }), "");
  });

  test("읽다 실패했을 때 — 짧은 사유를 함께 보인다", () => {
    const html = render({ kind: "failed", reason: "공유폴더를 읽을 권한이 없습니다." });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT));
    assert.ok(html.includes("공유폴더를 읽을 권한이 없습니다."));
  });

  test("찾았는데 폴더가 비었을 때 — 열 자리는 그대로다(폴더는 있다)", () => {
    const empty = foundState({ entries: [], totalCount: 0 });
    assert.ok(render(empty).includes(PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT));
    // 🔴 [폴더 열기]는 Windows 가 아니면 **스스로** 안 그려진다(서버 렌더도 그렇다) — 그래서
    //    그려졌는지가 아니라 **열 경로를 넘겼는지**로 본다. 빈 폴더에도 그 자리는 있다.
    assert.equal(purchaseOrderFolderOpenPath(empty), RELATIVE_PATH);
  });

  test("찾았을 때 — 표 · 발행일 · 경로 · 무엇만 보이는지", () => {
    const html = render(foundState());
    assert.ok(html.includes("발주서.pdf"));
    assert.ok(html.includes("발주발행 2025-12-23"));
    assert.ok(html.includes(RELATIVE_PATH));
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT));
    // 🔴 무엇만 보이는지 한 줄에 **외자가 아니라 내자**임이 적혀 있다.
    assert.ok(PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT.includes("내자"));
  });

  test("🔴 잘렸으면 「더 있습니다」", () => {
    const html = render(foundState({ totalCount: 7, truncated: true }));
    assert.ok(html.includes(purchaseOrderFolderTruncatedText(1, 7)));
    assert.ok(purchaseOrderFolderTruncatedText(1, 7).includes("더 있습니다"));
  });

  test("🔴 인쇄에 안 찍힌다", () => {
    assert.ok(render(foundState()).includes("print:hidden"));
  });
});

describe("표는 공용 한 벌을 쓴다", () => {
  test("🔴 열 넷의 생김새를 여기서 다시 적지 않는다", () => {
    const html = render(foundState());
    assert.ok(html.includes(SHARE_FOLDER_ENTRY_ROW_CLASS));
    assert.ok(html.includes(SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS));
    assert.ok(html.includes(SHARE_FOLDER_ENTRY_META_SIZE_CLASS));
    assert.ok(html.includes(SHARE_FOLDER_ENTRY_ACTIONS_CLASS));
    // 🔴 열 폭 · 날짜 모양을 이 파일이 손으로 적지 않는다.
    for (const forbidden of ["grid-cols-[", "toLocaleString(", "dateStyle"]) {
      assert.equal(sectionCode.includes(forbidden), false, `표의 한 벌을 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 수정시각이 없어도 칸은 그대로 — 글자만 빈다", () => {
    const meta = purchaseOrderFolderEntryMeta({ name: "a.pdf", isDirectory: false, sizeBytes: 10 });
    assert.equal(meta.modifiedText, "");
    assert.notEqual(meta.sizeText, "");
    // 폴더 줄은 크기 자리에 「폴더」라고 적는다.
    assert.equal(
      purchaseOrderFolderEntryMeta({ name: "사진", isDirectory: true, sizeBytes: 0 }).sizeText,
      "폴더"
    );
  });
});

describe("줄의 [열기]", () => {
  test("🔴 허용 목록에 든 확장자의 **파일** 줄에만 그린다", () => {
    assert.equal(canOpenPurchaseOrderFolderEntry({ name: "발주서.pdf", isDirectory: false, sizeBytes: 1 }), true);
    assert.equal(canOpenPurchaseOrderFolderEntry({ name: "발주서.xlsx", isDirectory: false, sizeBytes: 1 }), true);
    assert.equal(canOpenPurchaseOrderFolderEntry({ name: "사진", isDirectory: true, sizeBytes: 0 }), false);
    assert.equal(canOpenPurchaseOrderFolderEntry({ name: "설치.exe", isDirectory: false, sizeBytes: 1 }), false);
    assert.equal(canOpenPurchaseOrderFolderEntry({ name: "확장자없음", isDirectory: false, sizeBytes: 1 }), false);
  });

  test("🔴 경로를 모르면 아무 줄에도 안 그린다 — 주소를 지어내지 않는다", () => {
    const html = render(foundState({ relativePath: "" }));
    assert.equal(html.includes("data-purchase-order-folder-entry-openable"), false);
    assert.equal(purchaseOrderFolderOpenPath(foundState({ relativePath: "" })), "");
  });

  test("🔴 확장자를 이 파일이 다시 세지 않는다 — 판단은 순수 함수 하나다", () => {
    assert.ok(sectionCode.includes("isOpenableQuoteFolderFileName("));
    for (const forbidden of ['".pdf"', '".xlsx"', "EXTENSIONS"]) {
      assert.equal(sectionCode.includes(forbidden), false, `확장자를 베꼈다: ${forbidden}`);
    }
  });
});

describe("통로", () => {
  test("주소", () => {
    assert.equal(
      purchaseOrderFolderEntriesUrl(CASE_ID),
      `/api/repair-cases/${CASE_ID}/purchase-order-folder/entries`
    );
    // 주소에 싣는 값은 반드시 감싼다.
    assert.ok(purchaseOrderFolderEntriesUrl("a/b").includes("a%2Fb"));
  });

  test("🔴 알려진 칸만 옮긴다 — 모양이 다르면 null", () => {
    assert.equal(readPurchaseOrderFolderEntriesAnswer(null), null);
    assert.equal(readPurchaseOrderFolderEntriesAnswer({ status: "무엇" }), null);
    assert.deepEqual(readPurchaseOrderFolderEntriesAnswer({ status: "no-order-date" }), { kind: "no-order-date" });
    assert.deepEqual(readPurchaseOrderFolderEntriesAnswer({ status: "multiple" }), { kind: "multiple" });
    assert.deepEqual(readPurchaseOrderFolderEntriesAnswer({ status: "not-found" }), { kind: "not-found" });
    // 🔴 통로가 가른 둘을 화면도 갈라 받는다 — 한쪽으로 접어 읽으면 문장이 다시 하나가 된다.
    assert.deepEqual(readPurchaseOrderFolderEntriesAnswer({ status: "no-equipment-key" }), {
      kind: "no-equipment-key",
    });
    assert.deepEqual(readPurchaseOrderFolderEntriesAnswer({ status: "disabled" }), { kind: "disabled" });

    const answer = readPurchaseOrderFolderEntriesAnswer({
      status: "found",
      relativePath: RELATIVE_PATH,
      issuedDate: "2025-12-23",
      totalCount: 2,
      truncated: true,
      entries: [
        { name: "발주서.pdf", isDirectory: false, sizeBytes: 5, modifiedAt: "2026-01-02T03:04:05.000Z" },
        { isDirectory: false },
        { name: "", isDirectory: false },
      ],
      // 🔴 끼어든 칸은 화면까지 오지 않는다.
      absolutePath: "C:/실제/경로",
    });
    assert.deepEqual(answer, {
      kind: "found",
      relativePath: RELATIVE_PATH,
      issuedDate: "2025-12-23",
      entries: [{ name: "발주서.pdf", isDirectory: false, sizeBytes: 5, modifiedAt: "2026-01-02T03:04:05.000Z" }],
      totalCount: 2,
      truncated: true,
    });
  });

  test("🔴 던지지 않는다 — 무슨 일이 나도 상태 하나로 끝난다", async () => {
    const thrown = await loadPurchaseOrderFolderEntries(CASE_ID, () => Promise.reject(new Error("끊김")));
    assert.equal(thrown.kind, "failed");

    const rejected = await loadPurchaseOrderFolderEntries(CASE_ID, () =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "권한이 없습니다." }) })
    );
    assert.deepEqual(rejected, { kind: "failed", reason: "권한이 없습니다." });

    const garbage = await loadPurchaseOrderFolderEntries(CASE_ID, () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "???" }) })
    );
    assert.equal(garbage.kind, "failed");

    let askedUrl = "";
    const ok = await loadPurchaseOrderFolderEntries(CASE_ID, (url) => {
      askedUrl = url;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "no-order-date" }) });
    });
    assert.deepEqual(ok, { kind: "no-order-date" });
    assert.equal(askedUrl, purchaseOrderFolderEntriesUrl(CASE_ID));
  });
});

describe("자리와 규율", () => {
  test("🔴 **견적서 탭 오른쪽**이다 — 검수/승인보다는 앞이다", () => {
    // 🔴 2026-11-12: 글자(indexOf)가 아니라 **실제로 만들어지는 목록**으로 잰다 —
    // 탭 줄이 순수 함수로 떨어져 나오면서 값으로 확인할 수 있게 됐다. 글자로 재면
    // 조각이 또 옮겨 갈 때 조용히 통과한다.
    const labels = buildRepairCaseDetailTabs(CASE_ID, ALL_TABS_VISIBLE).map((tab) => tab.label);
    const quotesAt = labels.indexOf("견적서");
    const purchaseAt = labels.indexOf("발주서");
    const approvalAt = labels.indexOf("검수/승인");
    assert.ok(quotesAt >= 0 && purchaseAt >= 0 && approvalAt >= 0, `탭 줄에서 세 자리를 찾지 못했다: ${labels.join(" · ")}`);
    assert.ok(quotesAt < purchaseAt, "발주서 탭이 견적서 탭 왼쪽에 있다");
    assert.ok(purchaseAt < approvalAt, "발주서 탭이 검수/승인 오른쪽에 있다");

    // 🔴 견적서를 못 보는 세션에서는 **그 자리에 그대로** 선다 — 차례가 흔들리지 않는다.
    const withoutQuotes = buildRepairCaseDetailTabs(CASE_ID, { ...ALL_TABS_VISIBLE, quotes: false }).map((t) => t.label);
    assert.equal(withoutQuotes.includes("견적서"), false);
    assert.ok(withoutQuotes.indexOf("발주서") < withoutQuotes.indexOf("검수/승인"));

    // 🔴 화면이 권한을 묻지 않는다 — 서버가 넘겨준 값을 그릴 뿐이다(파일 둘 다).
    assert.equal(detailTabs.includes("hasPermission"), false);
    assert.equal(detailTabsList.includes("hasPermission"), false);
  });

  test("🔴 탭 페이지가 **서버에서 공유폴더를 읽지 않는다**", () => {
    assert.equal(tabPage.includes("@/lib/storage/"), false, "서버 컴포넌트가 공유폴더를 읽는다");
    assert.equal(tabPage.includes("node:fs"), false);
    // 🔴 인가를 화면에 맡기지 않는다 — 페이지가 스스로 다시 본다.
    assert.ok(tabPage.includes('hasPermission(actingUser, "domesticOrders", "READ")'));
    assert.equal(tabPage.includes('"quotes"'), false, "견적서 열쇠를 쓴다");
  });

  test("🔴 구역은 **화면이 뜬 뒤** 스스로 통로를 부른다", () => {
    assert.ok(sectionCode.includes("useEffect("));
    assert.ok(sectionSource.startsWith('"use client";'));
    // 🔴 읽기만 한다 — 올리고 지우는 길이 없다.
    for (const forbidden of ["method: \"POST\"", "FormData", "node:fs", "fetch(url, {"]) {
      assert.equal(sectionCode.includes(forbidden), false, `읽기 전용이 아니다: ${forbidden}`);
    }
  });

  test("🔴 단추는 베끼지 않고 가져다 쓴다 — 도우미는 PC 당 한 벌이다", () => {
    assert.ok(sectionCode.includes("ContactFolderEntryOpenButton"));
    assert.ok(sectionCode.includes("ContactFolderPlaceOpenButton"));
    // 도우미 주소를 이 파일이 직접 만들지 않는다.
    for (const forbidden of ["dss-folder://", "base64url", "iframe"]) {
      assert.equal(sectionCode.includes(forbidden), false, `여는 장치를 베꼈다: ${forbidden}`);
    }
  });

  test("기본 내보내기가 구역을 그린다", () => {
    assert.equal(typeof PurchaseOrderFolderSection, "function");
  });
});
