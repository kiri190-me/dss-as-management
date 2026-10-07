import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 전체 A/S 현황의 기본 차례 — 인수번호 내림차순 (2026-10-07 사용자 지시)
 * ============================================================================
 * 「A/S 현황표가 기본적으로 인수번호 내림차순으로 정렬되도록 해줘.」
 *
 * 🔴 이 화면은 서버가 보낸 행을 **제 손으로 다시 정렬한다**(sortRows). 그래서 눈에
 * 보이는 첫 차례를 정하는 것은 서버 조회가 아니라 이 파일의 DEFAULT_SORT 다 —
 * 서버 쪽 orderBy 만 바꾸면 이 화면은 하나도 달라지지 않는다. 그 사실을 여기서
 * 못 박아, 다음 사람이 한쪽만 고치고 끝내지 않게 한다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────────────────
 * RepairCaseListPage 는 @/lib/server/actions/* (Server Action) 셋을 물고 있어서
 * react-server 조건 없이 도는 test:components 에서는 **import 자체가 던진다.**
 * 이웃(detail/product-info-history-disclosure.test.ts ·
 * approval/approval-screen-layout.test.tsx)이 같은 자리에서 쓰는 방법 그대로다.
 *
 * 정렬 **동작** 자체(인수번호가 접수일 차례를 이긴다)는 순수 함수 쪽에서 본다 —
 * lib/domain/repair-case-filters.test.ts 의 「인수번호 차례」 묶음.
 * 서버가 돌려주는 차례는 lib/db/queries/repair-cases-list-order.integration.test.ts.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const source = readFileSync(
  new URL("src/components/repair-cases/RepairCaseListPage.tsx", repoUrl),
  "utf8"
);

/** 주석이 "intakeNumber"·"receivedAt" 을 글자로 적고 있어 먼저 지운다. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = code.replace(/\s+/g, " ");

const queriesSource = readFileSync(new URL("src/lib/db/queries/repair-cases.ts", repoUrl), "utf8");
const queriesCode = queriesSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("전체 A/S 현황 — 기본 정렬", () => {
  test("DEFAULT_SORT 는 인수번호 내림차순이다", () => {
    assert.match(
      flat,
      /const DEFAULT_SORT: SortState = \{ column: "intakeNumber", direction: "desc" \};/,
      "기본 차례가 인수번호 내림차순이 아니다"
    );
  });

  test("기본값이 접수일로 되돌아가 있지 않다", () => {
    assert.ok(
      !/const DEFAULT_SORT[^;]*"receivedAt"/.test(flat),
      "DEFAULT_SORT 가 접수일(receivedAt)을 가리킨다 — 2026-10-07 요구가 되돌려졌다"
    );
  });

  test("차례 고르개는 그대로 남아 있다 — 바꾼 것은 기본값뿐이다", () => {
    assert.ok(code.includes("function handleSortChange"), "열 머리로 차례를 바꾸는 함수가 사라졌다");
    assert.ok(flat.includes("onSortChange={handleSortChange}"), "표에 차례 고르개가 연결되어 있지 않다");
    assert.ok(flat.includes("sortRows(filteredRows, sort)"), "화면이 받은 행을 다시 정렬하지 않는다");
  });

  test("서버 조회(listRepairCases)도 같은 칸으로 세운다", () => {
    // 화면이 다시 정렬하더라도 서버가 보내는 차례를 같은 값으로 맞춰 둔다 —
    // 같은 조회를 쓰는 다른 화면(대시보드 · 재고 상세의 접수 건 고르개)이
    // 받는 차례도 이것이다. 이 파일에는 desc(receivedAt) 를 쓰는 다른 조회가
    // 넷 더 있으므로, **listRepairCases 의 몸통만** 잘라서 본다.
    const start = queriesCode.indexOf("export async function listRepairCases(");
    assert.notEqual(start, -1, "listRepairCases 를 찾지 못했다");
    const body = queriesCode.slice(start, queriesCode.indexOf("export ", start + 1));
    assert.ok(
      body.includes("orderBy(desc(repairCases.intakeNumber))"),
      "listRepairCases 가 인수번호로 세우지 않는다"
    );
  });
});
