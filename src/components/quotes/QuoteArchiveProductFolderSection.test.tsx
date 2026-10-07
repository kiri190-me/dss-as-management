import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import QuoteArchiveProductFolderSection, {
  QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_FAILED_TEXT,
  QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_TRUNCATED_TEXT,
  QuoteArchiveProductFolderSectionView,
  loadQuoteArchiveProductFolders,
  quoteArchiveProductFolderNumbersText,
  quoteArchiveProductFolderSectionTitle,
  quoteArchiveProductFoldersUrl,
  readQuoteArchiveProductFoldersAnswer,
  type QuoteArchiveProductFolderSectionState,
  type QuoteArchiveProductFolderView,
} from "./QuoteArchiveProductFolderSection";

/**
 * ============================================================================
 * 「같은 장비의 지난 견적서」 구역 — 무엇을 보이는가 · 어디에 서는가 (2026-10-06)
 * ============================================================================
 * 통로 쪽 규율은 app/api/repair-cases/[id]/quote-archive-folders/route-source.test.ts 가,
 * 실제 찾기는 lib/storage/quote-archive-product-folders.test.ts 가, 번호 뽑기는
 * lib/domain/quote-archive-file-number.test.ts 가 본다.
 *
 * 🔴 네트워크를 쓰지 않는다 — fetch 는 값을 돌려주는 가짜로 바꿔 끼운다.
 * 🔴 고객사 · 모델 · L/N · S/N 은 가짜다(저장소가 공개다).
 * ============================================================================
 */

const sectionSource = readFileSync(new URL("./QuoteArchiveProductFolderSection.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(iframe …)에 걸리지 않게. */
const sectionCode = sectionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 수리 건 상세 「견적서」 탭 — 구역이 서는 자리. */
const srcDir = fileURLToPath(new URL("../../", import.meta.url));
const quotesTabPage = readFileSync(
  path.join(srcDir, "app", "(app)", "repair-cases", "[id]", "quotes", "page.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

/** 🔴 가짜 이름이다 — 모양만 실제와 같다. */
const FOLDER_2024 = "DSS 2024-027 가나상사 MODEL-X1 AB1234 1234567 전원 불량";
const FOLDER_2023 = "DSS 2023-052 가나상사 MODEL-X1 AB1234 1234567 탄내 발생";

const folder = (overrides: Partial<QuoteArchiveProductFolderView> = {}): QuoteArchiveProductFolderView => ({
  year: 2024,
  folderName: FOLDER_2024,
  relativePath: `19. 2024 내자견적서/${FOLDER_2024}`,
  quoteNumbers: ["2024-027", "2024-027-1"],
  fileCount: 3,
  ...overrides,
});

function markup(state: QuoteArchiveProductFolderSectionState): string {
  return renderToStaticMarkup(createElement(QuoteArchiveProductFolderSectionView, { state }));
}

describe("무엇을 보이는가 — 없으면 아예 안 그린다", () => {
  test("🔴 불러오는 중 · 설정이 꺼짐 · 0 건이면 **아무것도 그리지 않는다**", () => {
    assert.equal(markup({ kind: "loading" }), "");
    assert.equal(markup({ kind: "disabled" }), "");
    assert.equal(markup({ kind: "found", folders: [], truncated: false }), "");
  });

  test("🔴 읽다 실패했을 때는 짧게 알린다 — 조용히 사라지면 고장인지 없는 건지 모른다", () => {
    const html = markup({ kind: "failed", reason: "공유폴더에 연결할 수 없습니다(네트워크 · NAS 상태를 확인하세요)." });
    assert.ok(html.includes(QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_FAILED_TEXT), html);
    assert.ok(html.includes("공유폴더에 연결할 수 없습니다"), html);
    // 목록 자리가 서지 않는다.
    assert.equal(html.includes("<ul"), false, html);
  });

  test("줄마다 연도 · 폴더 이름 · 뽑은 번호 · 파일 수", () => {
    const html = markup({
      kind: "found",
      folders: [folder(), folder({ year: 2023, folderName: FOLDER_2023, quoteNumbers: [], fileCount: 0 })],
      truncated: false,
    });

    assert.ok(html.includes(quoteArchiveProductFolderSectionTitle(2)), html);
    assert.ok(html.includes("같은 장비의 지난 견적서 (2건)"), html);
    assert.ok(html.includes("2024"), html);
    assert.ok(html.includes(FOLDER_2024), html);
    assert.ok(html.includes("번호: 2024-027 · 2024-027-1"), html);
    assert.ok(html.includes("파일 3개"), html);
    // 번호를 못 뽑은 폴더도 줄로 선다 — 번호 자리만 비어 있다.
    assert.ok(html.includes(FOLDER_2023), html);
    assert.equal(html.match(/data-quote-archive-product-folder=""/g)?.length, 2, html);
  });

  test("🔴 상한에 걸리면 「더 있습니다」를 세운다", () => {
    const html = markup({ kind: "found", folders: [folder()], truncated: true });
    assert.ok(html.includes("더 있습니다"), html);
    assert.ok(html.includes(QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_TRUNCATED_TEXT), html);
  });

  test("🔴 줄에 **절대 경로가 보이지 않는다** — 연도 폴더 아래의 폴더 이름만 적는다", () => {
    const html = markup({ kind: "found", folders: [folder()], truncated: false });
    assert.equal(html.includes("/mnt/"), false, html);
    assert.equal(html.includes("C:"), false, html);
  });

  test("그려지는 모든 상태에 인쇄 감춤이 있다", () => {
    for (const state of [
      { kind: "failed", reason: "x" } satisfies QuoteArchiveProductFolderSectionState,
      { kind: "found", folders: [folder()], truncated: false } satisfies QuoteArchiveProductFolderSectionState,
    ]) {
      assert.ok(markup(state).includes("print:hidden"), state.kind);
    }
  });

  test("번호 곁말 — 없으면 빈 글자다", () => {
    assert.equal(quoteArchiveProductFolderNumbersText([]), "");
    assert.equal(quoteArchiveProductFolderNumbersText(["2024-027"]), "번호: 2024-027");
  });

  test("기본 내보내기도 그려진다 — 처음에는 아무것도 없다", () => {
    assert.equal(renderToStaticMarkup(createElement(QuoteArchiveProductFolderSection, { repairCaseId: "r-1" })), "");
  });
});

describe("🔴 여는 장치를 베끼지 않았다 — 연락서 쪽 한 벌을 그대로 쓴다", () => {
  test("줄의 [열기]는 자리 열기 단추를 가져다 쓴다", () => {
    assert.ok(
      sectionSource.includes(
        'import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";'
      ),
      "자리 열기 단추를 가져다 쓰지 않는다"
    );
    assert.ok(sectionCode.includes("<ContactFolderPlaceOpenButton relativePath={folder.relativePath} />"));
  });

  test("🔴 주소 만들기 · 도우미 감지를 이 파일이 다시 짜지 않는다", () => {
    for (const forbidden of [
      "dss-folder://",
      "iframe",
      "localStorage",
      "buildQuoteFolderLink",
      "watchFocusLoss",
      "visibilitychange",
      "navigator",
    ]) {
      assert.equal(sectionCode.includes(forbidden), false, `여는 장치를 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 서버 컴포넌트에서 읽지 않는다 — 화면이 뜬 뒤 스스로 부른다", () => {
    assert.ok(sectionSource.startsWith('"use client";'), "클라이언트 구역이 아니다");
    assert.ok(sectionSource.includes("useEffect("), "화면이 뜬 뒤 부르지 않는다");
    assert.equal(sectionSource.includes("server-only"), false);
    assert.equal(sectionSource.includes('"use server"'), false);
    assert.equal(sectionSource.includes("@/lib/storage/"), false, "화면이 공유폴더를 직접 읽는다");
  });
});

describe("통로를 부르는 길 — 던지지 않는다", () => {
  test("주소 — 수리 건 id 하나뿐이다", () => {
    assert.equal(quoteArchiveProductFoldersUrl("r-1"), "/api/repair-cases/r-1/quote-archive-folders");
    assert.equal(quoteArchiveProductFoldersUrl("a/b"), "/api/repair-cases/a%2Fb/quote-archive-folders");
    assert.equal(sectionCode.includes("?path="), false);
  });

  test("🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 화면까지 오지 않는다", () => {
    const answer = readQuoteArchiveProductFoldersAnswer({
      status: "found",
      truncated: false,
      folders: [
        {
          year: 2024,
          folderName: FOLDER_2024,
          relativePath: `19. 2024 내자견적서/${FOLDER_2024}`,
          quoteNumbers: ["2024-027"],
          fileCount: 3,
          // 🔴 서버가 실수로 실어 보내도 화면 값에는 들어오지 않는다.
          absolutePath: "/mnt/share/견적서",
          root: "/mnt/share",
        },
      ],
    });
    assert.ok(answer !== null && answer.kind === "found");
    if (answer === null || answer.kind !== "found") throw new Error("unreachable");
    assert.deepEqual(Object.keys(answer).sort(), ["folders", "kind", "truncated"]);
    assert.deepEqual(Object.keys(answer.folders[0]).sort(), [
      "fileCount",
      "folderName",
      "quoteNumbers",
      "relativePath",
      "year",
    ]);
    assert.equal(JSON.stringify(answer).includes("/mnt/share"), false, JSON.stringify(answer));
  });

  test("이름이나 경로가 없는 줄은 그 줄만 버린다", () => {
    const answer = readQuoteArchiveProductFoldersAnswer({
      status: "found",
      truncated: false,
      folders: [{ year: 2024 }, { folderName: FOLDER_2024, relativePath: `x/${FOLDER_2024}` }],
    });
    assert.ok(answer !== null && answer.kind === "found");
    if (answer === null || answer.kind !== "found") throw new Error("unreachable");
    assert.equal(answer.folders.length, 1);
    assert.deepEqual(answer.folders[0].quoteNumbers, []);
  });

  test("모양이 다르면 null — 화면은 「찾지 못했습니다」가 된다", () => {
    for (const bad of [null, "x", 1, [], { status: "뭔가" }]) {
      assert.equal(readQuoteArchiveProductFoldersAnswer(bad), null, JSON.stringify(bad));
    }
    assert.deepEqual(readQuoteArchiveProductFoldersAnswer({ status: "disabled" }), { kind: "disabled" });
  });

  test("🔴 네트워크가 끊겨도 던지지 않는다 — failed 한 상태로 끝난다", async () => {
    const thrown = await loadQuoteArchiveProductFolders("r-1", () => Promise.reject(new Error("끊김")));
    assert.equal(thrown.kind, "failed");

    const rejected = await loadQuoteArchiveProductFolders("r-1", () =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "권한이 없습니다.", code: "FORBIDDEN" }),
      })
    );
    assert.deepEqual(rejected, { kind: "failed", reason: "권한이 없습니다." });

    const broken = await loadQuoteArchiveProductFolders("r-1", () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("JSON 아님")) })
    );
    assert.equal(broken.kind, "failed");
  });

  test("성공 — 부르는 주소가 그 수리 건의 것이고, 받은 상태를 그대로 쓴다", async () => {
    const called: string[] = [];
    const state = await loadQuoteArchiveProductFolders("r-7", (url) => {
      called.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            status: "found",
            truncated: false,
            folders: [
              {
                year: 2024,
                folderName: FOLDER_2024,
                relativePath: `19. 2024 내자견적서/${FOLDER_2024}`,
                quoteNumbers: ["2024-027"],
                fileCount: 3,
              },
            ],
          }),
      });
    });
    assert.deepEqual(called, ["/api/repair-cases/r-7/quote-archive-folders"]);
    assert.equal(state.kind, "found");
  });
});

/**
 * 🔴 L/N · S/N 판정(hasQuoteArchiveProductKeys)의 시험은 **여기 없다** — 그 함수가
 * quote-archive-product-keys.ts 로 옮겨 갔고, 시험도 그 곁(quote-archive-product-keys.test.ts)
 * 으로 따라갔다. 서버 컴포넌트가 부르는 함수를 `"use client"` 인 이 파일에 둘 수 없다.
 */

describe("자리 — 「이 건의 견적서 폴더」 구역들 **아래**", () => {
  test("🔴 탭이 이 구역을 그 아래에 붙인다", () => {
    assert.ok(
      quotesTabPage.includes(
        'import QuoteArchiveProductFolderSection from "@/components/quotes/QuoteArchiveProductFolderSection";'
      ),
      "탭이 이 구역을 가져오지 않는다"
    );
    // 🔴 판정은 중립 파일에서 가져온다 — 이 파일(`"use client"`)에서 가져오면 탭이 안 열린다.
    assert.ok(
      quotesTabPage.includes(
        'import { hasQuoteArchiveProductKeys } from "@/components/quotes/quote-archive-product-keys";'
      ),
      "탭이 판정을 중립 파일에서 가져오지 않는다"
    );
    assert.ok(
      quotesTabPage.includes(
        "{hasQuoteArchiveProductKeys(resolved.lotNumber, resolved.serialNumber) && (\n        <QuoteArchiveProductFolderSection repairCaseId={resolved.id} />\n      )}"
      ),
      quotesTabPage.slice(quotesTabPage.indexOf("hasQuoteArchiveProductKeys"))
    );
    // 🔴 견적서 목록보다도, 「이 건의 견적서 폴더」 구역들보다도 **뒤**다.
    const list = quotesTabPage.indexOf("<QuoteListSlots");
    const thisCase = quotesTabPage.indexOf("{archiveFolderGroups.map(");
    const product = quotesTabPage.indexOf("<QuoteArchiveProductFolderSection");
    assert.ok(list >= 0 && thisCase > list, "이 건의 폴더 구역이 목록보다 앞에 있다");
    assert.ok(product > thisCase, "지난 견적서 구역이 이 건의 폴더 구역보다 앞에 있다");
  });

  test("🔴 앞 조각이 붙인 「이 건의 견적서 폴더」는 그대로다", () => {
    assert.ok(
      quotesTabPage.includes(
        "{archiveFolderGroups.map((group) => (\n        <QuoteArchiveFolderSection key={group.baseNumber} quoteId={group.quoteId} label={group.baseNumber} />\n      ))}"
      ),
      "앞 조각의 구역이 바뀌었다"
    );
    assert.ok(quotesTabPage.includes("const archiveFolderGroups = groupQuotesByArchiveBaseNumber(rows);"));
  });

  test("🔴 탭이 공유폴더를 읽지 않는다 — NAS 가 느린 날 탭 자체가 안 뜨면 안 된다", () => {
    for (const forbidden of [
      "listQuoteArchiveProductFolders",
      "listQuoteArchiveEntries",
      "resolveQuoteArchiveRoot",
      "findQuoteArchiveFolder",
      "node:fs",
      "@/lib/storage/",
    ]) {
      assert.equal(quotesTabPage.includes(forbidden), false, `탭이 공유폴더를 읽는다: ${forbidden}`);
    }
  });
});
