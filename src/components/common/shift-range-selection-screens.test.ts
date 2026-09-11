import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 여러 개를 골라 한꺼번에 처리하는 목록 — 모두 Shift 로 사이를 고를 수 있는가
 * ============================================================================
 * 2026-09-11 사용자 요청: 한 항목을 고른 뒤 Shift 를 누른 채 멀리 떨어진 항목을
 * 고르면 그 사이가 연쇄로 골라진다(파일 탐색기·Gmail). 규칙은
 * lib/domain/range-selection.ts 한 곳, 화면은 lib/hooks/useShiftRangeSelection.ts
 * 를 거친다.
 *
 * 여기서 못박는 것:
 *  1. **목록마다 훅을 쓴다** — 한 곳이라도 옛 손수 토글이 남으면 그 목록만
 *     Shift 가 안 먹는다. 눌러 보기 전에는 모른다.
 *  2. 🔴 **표와 카드가 같은 선택을 쓰는 목록은 둘 다** Shift 를 넘긴다 —
 *     ResponsiveList 가 폭을 재서 둘 중 하나를 고르므로, 한쪽만 되면 창 크기에
 *     따라 된다 안 된다 한다.
 *  3. 범위의 순서는 **지금 보이는 순서**(정렬·검색·페이지 적용 뒤)이고, 고를 수
 *     있는지는 체크박스의 disabled 와 **같은 기준**이다.
 *  4. 체크박스마다 Shift 일 때 글자 선택을 막는다(누르는 요소에서만).
 *  5. 전체 선택은 손대지 않았다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 이 화면들은 서버 액션을 직접 import 하는 클라이언트 컴포넌트라, 그 사슬 끝의
 * `server-only` 때문에 test:components 에서는 import 자체가 던진다. 정적 렌더로는
 * 이벤트 처리기도 보이지 않는다. 그래서 이웃 시험(StoredAttachmentList.test.tsx,
 * approval-route-section.test.ts)과 같은 방법으로 원본을 글자로 읽는다. 주석은
 * 걷어낸다 — 우리가 보려는 것은 실제로 도는 코드뿐이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);

function readCode(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoUrl), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const HOOK_IMPORT = 'from "@/lib/hooks/useShiftRangeSelection"';

/**
 * 목록 파일마다: 누르는 자리가 몇 개인가(표·카드·휴지통 표·휴지통 카드·격자).
 * 그 수만큼 Shift 를 읽어 넘기고, 그 수만큼 글자 선택을 막아야 한다.
 */
const TOGGLE_SITES: { file: string; sites: number; why: string }[] = [
  { file: "src/components/repair-cases/RepairCaseTable.tsx", sites: 1, why: "접수 건 표" },
  { file: "src/components/repair-cases/RepairCaseCardList.tsx", sites: 1, why: "접수 건 카드" },
  { file: "src/components/repair-cases/trash/RepairCaseTrashTable.tsx", sites: 1, why: "접수 건 휴지통 표" },
  { file: "src/components/repair-cases/trash/RepairCaseTrashCardList.tsx", sites: 1, why: "접수 건 휴지통 카드" },
  { file: "src/components/customers/CustomerListScreen.tsx", sites: 4, why: "삭제 모드 표·카드, 휴지통 표·카드" },
  { file: "src/components/product-models/ProductModelListScreen.tsx", sites: 4, why: "삭제 모드 표·카드, 휴지통 표·카드" },
  { file: "src/components/inventory/InventoryListScreen.tsx", sites: 4, why: "삭제 모드 표·카드, 휴지통 표·카드" },
  {
    file: "src/components/procedures/TechnicalProcedureTemplateListScreen.tsx",
    sites: 4,
    why: "삭제 모드 표·카드, 휴지통 표·카드",
  },
  { file: "src/components/repair-cases/files/StoredAttachmentList.tsx", sites: 3, why: "첨부 표·카드·격자" },
  { file: "src/components/repair-cases/files/FilesScreen.tsx", sites: 1, why: "찍은 사진 격자" },
];

for (const { file, sites, why } of TOGGLE_SITES) {
  test(`${file} — 누르는 자리 ${sites}곳(${why})이 모두 Shift 를 넘긴다`, () => {
    const code = readCode(file);
    assert.ok(code.includes(HOOK_IMPORT), "useShiftRangeSelection 모듈을 거쳐야 한다");
    assert.equal(count(code, "shiftKeyOf(event)"), sites, "누르는 자리마다 Shift 를 읽어 넘긴다");
    assert.equal(
      count(code, "onMouseDown={preventShiftClickTextSelection}"),
      sites,
      "누르는 자리마다 Shift+누르기의 글자 선택을 막는다"
    );
    // 옛 손수 토글(인자 없는 onChange/onClick 으로 한 개만 뒤집기)이 남아 있으면 그 자리만 Shift 가 안 먹는다.
    assert.equal(
      code.match(/on(?:Change|Click)=\{\(\) => (?:toggle|onToggle|handleToggle)\w*\??\.?\(/g),
      null,
      "Shift 를 버리는 옛 토글이 남아 있다"
    );
  });
}

/** 선택 상태를 가진 화면: 훅을 몇 번 쓰고, 범위를 어떤 순서·기준으로 잡는가. */
const OWNERS: { file: string; hooks: number; expects: string[] }[] = [
  {
    file: "src/components/repair-cases/RepairCaseListPage.tsx",
    hooks: 2,
    expects: [
      // 사용중: 지금 이 페이지에 그려진 순서 — 페이지를 넘나드는 범위는 없다.
      "orderedIds: pagedRows.map((row) => row.id)",
      // 로컬 임시 접수 건은 체크박스가 비활성 — 같은 기준으로 건너뛴다.
      "isSelectable: (id) => selectableIds.has(id)",
      "orderedIds: trashCases.map((row) => row.id)",
    ],
  },
  {
    file: "src/components/customers/CustomerListScreen.tsx",
    hooks: 2,
    expects: [
      "orderedIds: filteredRows.map((row) => row.id)",
      "isSelectable: (id) => selectableVisibleIdSet.has(id)",
      "orderedIds: trashRows.map((row) => row.id)",
    ],
  },
  {
    file: "src/components/product-models/ProductModelListScreen.tsx",
    hooks: 2,
    expects: [
      "orderedIds: filteredRows.map((row) => row.id)",
      "isSelectable: (id) => selectableVisibleIdSet.has(id)",
      "orderedIds: trashRows.map((row) => row.id)",
    ],
  },
  {
    file: "src/components/inventory/InventoryListScreen.tsx",
    hooks: 2,
    expects: [
      "orderedIds: filtered.map((p) => p.id)",
      "isSelectable: (id) => selectableVisibleIdSet.has(id)",
      "orderedIds: trashParts.map((p) => p.id)",
      "onToggleSelected={trashRangeSelection.toggle}",
    ],
  },
  {
    file: "src/components/procedures/TechnicalProcedureTemplateListScreen.tsx",
    hooks: 2,
    expects: [
      "orderedIds: templates.map((t) => t.id)",
      // 체크박스의 disabled={blocked} 와 같은 기준이다.
      "isSelectable: (id) => !undeletable.has(id)",
      "orderedIds: trashTemplates.map((t) => t.id)",
      "onToggleSelected={trashRangeSelection.toggle}",
    ],
  },
  {
    file: "src/components/repair-cases/files/StoredAttachmentList.tsx",
    hooks: 1,
    expects: ["orderedIds: visible.map((item) => item.id)", "setIdsCheckedInList(previous, ids, checked)"],
  },
  {
    file: "src/components/repair-cases/files/FilesScreen.tsx",
    hooks: 1,
    expects: ["orderedIds: stagedPhotos.map((photo) => photo.id)"],
  },
];

for (const { file, hooks, expects } of OWNERS) {
  test(`${file} — 범위는 지금 보이는 순서, 고를 수 있는지는 체크박스와 같은 기준`, () => {
    const code = readCode(file);
    assert.equal(count(code, "useShiftRangeSelection({"), hooks, "선택 상태마다 훅이 하나씩");
    for (const needle of expects) {
      assert.ok(code.includes(needle), `빠졌다: ${needle}`);
    }
    // 옛 손수 토글 몸통이 남아 있지 않다 — 남아 있으면 그쪽을 부르는 자리가 생긴다.
    assert.ok(!code.includes("if (next.has(id)) next.delete(id);"), "옛 한 개 토글이 남아 있다");
  });
}

test("🔴 접수 건: 표와 카드가 같은 처리기를 받는다 — 창 크기에 따라 된다 안 된다 하지 않는다", () => {
  const code = readCode("src/components/repair-cases/RepairCaseListPage.tsx");
  assert.equal(count(code, "onToggleSelect={handleToggleSelect}"), 2, "사용중 표·카드 둘 다");
  assert.equal(count(code, "onToggleSelect={handleToggleTrashSelect}"), 2, "휴지통 표·카드 둘 다");
  assert.ok(code.includes("rangeSelection.toggle(id, shiftKey)"));
  assert.ok(code.includes("trashRangeSelection.toggle(id, shiftKey)"));
});

test("🔴 표와 카드를 나눠 둔 컴포넌트는 Shift 를 부모에게 그대로 넘긴다", () => {
  for (const file of [
    "src/components/repair-cases/RepairCaseTable.tsx",
    "src/components/repair-cases/RepairCaseCardList.tsx",
  ]) {
    const code = readCode(file);
    assert.ok(code.includes("onToggleSelect?: (id: string, shiftKey: boolean) => void;"), file);
    assert.ok(code.includes("onToggleSelect?.(row.id, shiftKeyOf(event))"), file);
  }
  for (const file of [
    "src/components/repair-cases/trash/RepairCaseTrashTable.tsx",
    "src/components/repair-cases/trash/RepairCaseTrashCardList.tsx",
  ]) {
    const code = readCode(file);
    assert.ok(code.includes("onToggleSelect: (id: string, shiftKey: boolean) => void;"), file);
    assert.ok(code.includes("onToggleSelect(row.id, shiftKeyOf(event))"), file);
  }
});

test("전체 선택은 그대로다 — 범위 고르기와 섞지 않았다", () => {
  const pairs: [string, string[]][] = [
    [
      "src/components/repair-cases/RepairCaseListPage.tsx",
      ["onChange={handleToggleSelectAllTrash}", "onToggleSelectAll={handleToggleSelectAllOnPage}"],
    ],
    ["src/components/customers/CustomerListScreen.tsx", ["onChange={toggleSelectAllVisible}"]],
    ["src/components/product-models/ProductModelListScreen.tsx", ["onChange={toggleSelectAllVisible}"]],
    ["src/components/inventory/InventoryListScreen.tsx", ["onToggleSelectAll={toggleSelectAllVisible}"]],
    ["src/components/procedures/TechnicalProcedureTemplateListScreen.tsx", ["onChange={toggleSelectAll}"]],
    ["src/components/repair-cases/files/StoredAttachmentList.tsx", ["onChange={toggleAll}"]],
    ["src/components/repair-cases/files/FilesScreen.tsx", ["onClick={() => setAllPhotosSelected(true)}"]],
  ];
  for (const [file, needles] of pairs) {
    const code = readCode(file);
    for (const needle of needles) assert.ok(code.includes(needle), `${file}: ${needle}`);
  }
  // 공용 전체 선택 체크박스는 Shift 를 모른다 — 머리글 체크박스는 범위가 아니다.
  assert.ok(!readCode("src/components/common/select-all-checkbox.tsx").includes("useShiftRangeSelection"));
});
