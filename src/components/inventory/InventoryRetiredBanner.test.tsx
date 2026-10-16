import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import InventoryRetiredBanner, {
  INVENTORY_RETIRED_LINK_LABEL,
  INVENTORY_RETIRED_NOT_SYNCED_TEXT,
  INVENTORY_RETIRED_TITLE,
  INVENTORY_RETIRED_WHERE_TEXT,
} from "./InventoryRetiredBanner";

/**
 * ============================================================================
 * 「여기가 아니라 저기」 안내 띠 (2026-10-16)
 * ============================================================================
 * 재고 일이 재고 관리 시스템으로 옮겨 갔다. 메뉴에서는 감췄지만(lib/navigation.ts)
 * 북마크·알림으로는 그대로 들어와지므로, 들어온 사람이 **쓰던 대로 쓰지 않게** 하는
 * 것이 이 띠의 일이다.
 *
 * 못 박는 것:
 *  · 🔴 「여기에 적은 것은 재고 관리에 들어가지 않습니다」가 **반드시** 있다. 이 말이
 *    빠지면 사람은 「옮겨 갔구나」까지만 읽고 그대로 적는다 — 그래서 그려진 글자와
 *    문구 상수 **둘 다** 잰다(상수만 재면 화면에 안 쓰여도 통과하고, 그려진 글자만
 *    재면 문구를 통째로 갈아도 통과한다).
 *  · 🔴 설정이 없으면 **링크 없이 글만** 선다 — 없는 주소로 보내지 않는다.
 *  · 🔴 다섯 화면이 **한 조각을 함께 쓰고**, 설정값을 넘긴다. 페이지는 서버 컴포넌트라
 *    여기서 그릴 수 없어 이 저장소 관례대로 원본을 글자로 읽는다.
 *  · 🔴 이 조각이 화면의 **다른 것을 건드리지 않았는가** — 다섯 페이지가 원래 그리던
 *    화면 조각을 그대로 그리는지 함께 읽는다.
 * ============================================================================
 */

const SITE = "http://inventory.test";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** 띠를 다는 재고 화면 **다섯**과, 각 페이지가 원래 그리던 화면 조각. */
const PAGES: ReadonlyArray<{ path: string; screen: string }> = [
  { path: "src/app/(app)/inventory/page.tsx", screen: "InventoryListScreen" },
  { path: "src/app/(app)/inventory/[id]/page.tsx", screen: "InventoryPartDetailScreen" },
  { path: "src/app/(app)/inventory/requests/page.tsx", screen: "PartRequestManagerScreen" },
  { path: "src/app/(app)/inventory/approvals/page.tsx", screen: "PartIssueApprovalScreen" },
  { path: "src/app/(app)/inventory/oh-templates/page.tsx", screen: "OhTemplateScreen" },
];

describe("그려 본다", () => {
  test("🔴 「여기에 적으면 재고 관리에는 안 들어갑니다」가 그려진 글자에 있다", () => {
    const html = renderToStaticMarkup(<InventoryRetiredBanner href={SITE} />);
    assert.ok(html.includes(INVENTORY_RETIRED_NOT_SYNCED_TEXT), html);
    // 문구 자체도 잰다 — 상수 값을 갈아 치우면 위 단언은 따라 움직여 조용히 통과한다.
    assert.match(INVENTORY_RETIRED_NOT_SYNCED_TEXT, /여기에 적은 것은 재고 관리에 들어가지 않습니다/);
  });

  test("더 이상 쓰지 않는다 · 재고 일은 저쪽에서 한다 — 세 줄이 차례대로 선다", () => {
    const html = renderToStaticMarkup(<InventoryRetiredBanner href={SITE} />);
    assert.ok(html.includes(INVENTORY_RETIRED_TITLE), html);
    assert.ok(html.includes(INVENTORY_RETIRED_WHERE_TEXT), html);
    assert.ok(
      html.indexOf(INVENTORY_RETIRED_TITLE) < html.indexOf(INVENTORY_RETIRED_WHERE_TEXT),
      "「더 이상 쓰지 않습니다」가 먼저 와야 한다"
    );
    assert.ok(
      html.indexOf(INVENTORY_RETIRED_WHERE_TEXT) < html.indexOf(INVENTORY_RETIRED_NOT_SYNCED_TEXT),
      "「안 들어갑니다」가 마지막이다 — 읽고 나가는 사람이 그 말을 마지막으로 본다"
    );
    assert.match(INVENTORY_RETIRED_TITLE, /더 이상 쓰지 않습니다/);
    assert.match(INVENTORY_RETIRED_WHERE_TEXT, /재고 관리 시스템에서 합니다/);
  });

  test("이 저장소에 이미 있는 주의 색(amber)을 쓴다 — 새 색을 짓지 않았다", () => {
    const html = renderToStaticMarkup(<InventoryRetiredBanner href={SITE} />);
    assert.ok(html.includes("bg-amber-50"), html);
    assert.ok(html.includes("border-amber-300"), html);
  });

  test("주소가 있으면 새 탭으로 가는 길을 함께 준다", () => {
    const html = renderToStaticMarkup(<InventoryRetiredBanner href={SITE} />);
    assert.ok(html.includes(`href="${SITE}"`), html);
    assert.ok(html.includes('target="_blank"'), html);
    assert.ok(html.includes('rel="noopener noreferrer"'), html);
    assert.ok(html.includes(INVENTORY_RETIRED_LINK_LABEL), html);
  });

  test("🔴 설정이 없으면 링크 없이 글만 — 없는 주소로 보내지 않는다", () => {
    const html = renderToStaticMarkup(<InventoryRetiredBanner href={null} />);
    assert.equal(html.includes("<a"), false, html);
    assert.equal(html.includes(INVENTORY_RETIRED_LINK_LABEL), false, html);
    // 글은 그대로 선다 — 길이 없다고 **안내까지 사라지면** 이 조각이 할 일을 못 한다.
    assert.ok(html.includes(INVENTORY_RETIRED_NOT_SYNCED_TEXT), html);
  });

  test("주소를 코드에 박지 않았다 — 원본에 재고 관리 주소가 한 글자도 없다", () => {
    const source = read("src/components/inventory/InventoryRetiredBanner.tsx");
    assert.equal(/https?:\/\//.test(source), false, "주소가 박혀 있다");
    assert.equal(source.includes("process.env"), false, "설정을 여기서 직접 읽는다");
  });
});

describe("재고 화면 다섯이 함께 쓴다", () => {
  for (const page of PAGES) {
    test(`${page.path} — 띠를 달고, 설정값을 넘기고, 원래 화면은 그대로다`, () => {
      const source = read(page.path);
      assert.ok(
        source.includes('from "@/components/inventory/InventoryRetiredBanner"'),
        "안내 띠를 부르지 않는다"
      );
      assert.ok(
        /<InventoryRetiredBanner\s+href=\{inventorySiteUrl\(\)\}\s*\/>/.test(source),
        "띠에 재고 관리 주소를 넘기지 않는다 — 설정값은 inventorySiteUrl() 하나에서만 온다"
      );
      assert.ok(
        source.includes('from "@/lib/server/inventory-gateway"'),
        "주소를 가져오는 자리가 재고 통로 모듈이 아니다"
      );
      // 🔴 이 조각은 **아무것도 걷어내지 않는다.** 화면이 그대로 서는지 함께 본다.
      assert.ok(source.includes(`<${page.screen}`), `${page.screen} 이 사라졌다`);
    });
  }

  test("🔴 문구가 갈리지 않는다 — 다섯 페이지 어디에도 안내 문장을 다시 적지 않았다", () => {
    for (const page of PAGES) {
      const source = read(page.path);
      for (const sentence of [
        INVENTORY_RETIRED_TITLE,
        INVENTORY_RETIRED_WHERE_TEXT,
        INVENTORY_RETIRED_NOT_SYNCED_TEXT,
        INVENTORY_RETIRED_LINK_LABEL,
      ]) {
        assert.equal(
          source.includes(sentence),
          false,
          `${page.path} 가 안내 문구를 따로 적었다 — 한 곳(InventoryRetiredBanner)에서만 적는다`
        );
      }
    }
  });
});
