import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
 * 「발주서」 탭의 공유폴더 구역 — 상태 일곱 · 자리 · 인쇄 · 읽기만 (2026-10-12)
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
const detailTabs = readFileSync(
  path.join(srcDir, "components", "repair-cases", "detail", "DetailTabs.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

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

  test("못 찾았을 때", () => {
    const html = render({ kind: "not-found" });
    assert.ok(html.includes(PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT));
    assert.equal(html.includes("data-contact-folder-place-open"), false, "열 자리가 없는데 단추가 섰다");
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
    const quotesAt = detailTabs.indexOf("href: hrefs.quotes");
    const purchaseAt = detailTabs.indexOf("href: hrefs.purchaseOrders");
    const approvalAt = detailTabs.indexOf("href: hrefs.approval");
    assert.ok(quotesAt >= 0 && purchaseAt >= 0 && approvalAt >= 0, "탭 줄에서 세 자리를 찾지 못했다");
    assert.ok(quotesAt < purchaseAt, "발주서 탭이 견적서 탭 왼쪽에 있다");
    assert.ok(purchaseAt < approvalAt, "발주서 탭이 검수/승인 오른쪽에 있다");
    assert.ok(detailTabs.includes('label: "발주서"'));
    // 🔴 화면이 권한을 묻지 않는다 — 서버가 넘겨준 값을 그릴 뿐이다.
    assert.equal(detailTabs.includes("hasPermission"), false);
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
