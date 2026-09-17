import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「사용 부품」 칸 — 읽기까지 (B-1)
 * ============================================================================
 * 수리 건 상세에 그 건에서 갈아 끼운 부품을 보여 주는 칸을 냈다. **적고 저장하는
 * 길은 다음 조각(B-2)** 이고, 이 시험은 그 길이 아직 **없다는 것까지** 못 박는다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────────────────
 * RepairCaseDetailView 아래의 상세 화면 컴포넌트들은 서버 액션(update-repair-case
 * 등)으로 이어지는 사슬을 물고 있어서 react-server 조건 없이 도는 test:components
 * 에서는 **import 자체가 던진다.** 같은 폴더의 product-info-history-disclosure.
 * test.ts 가 쓰는 방법을 그대로 쓴다.
 *
 * ── 여기서 못 박는 것 ──────────────────────────────────────────────────────
 *  1. 🔴 한 건의 부품 출처를 둘로 쪼개지 않는다 — 반출 이력이 있으면 적을 자리를
 *     그리지 않고 안내만 낸다(같은 부품을 통계가 두 번 세지 않게).
 *  2. 반출 이력이 없고 줄도 없으면 「아직 적힌 것이 없습니다」.
 *  3. 줄이 있으면 품명·수량 표.
 *  4. 🔴 이번 조각에 쓰기 길이 없다 — 입력 칸·단추·서버 액션이 하나도 없다.
 *  5. DATABASE 소스가 아니면 조회하지 않는다(MOCK·LOCAL_DEMO 에는 이 표가 없다).
 *  6. 🔴 왕복이 늘지 않았다 — 기존 Promise.all 에 태웠다.
 *  7. 반출 이력으로 치는 상태 집합이 통계가 세는 집합과 같다(REJECTED·CANCELLED 제외).
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoUrl), "utf8");
}

/**
 * 주석을 뺀 원본. 이 파일들의 머리말이 규칙을 **글자로** 적어 두고 있어서 그냥
 * 찾으면 그 문장에 걸린다. 실제로 그린 자리·부른 자리만 보려면 주석을 먼저
 * 지워야 한다(JSX 안의 중괄호 주석도 블록 주석이라 함께 지워진다).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
function flatten(code: string): string {
  return code.replace(/\s+/g, " ");
}

const queryCode = stripComments(read("src/lib/db/queries/repair-case-used-parts.ts"));
const queryFlat = flatten(queryCode);

const sectionCode = stripComments(read("src/components/repair-cases/detail/UsedPartsSection.tsx"));
const sectionFlat = flatten(sectionCode);

const pageCode = stripComments(read("src/app/(app)/repair-cases/[id]/page.tsx"));
const pageFlat = flatten(pageCode);

const viewCode = stripComments(read("src/components/repair-cases/detail/RepairCaseDetailView.tsx"));
const viewFlat = flatten(viewCode);

const productModelsCode = stripComments(read("src/lib/db/queries/product-models.ts"));

describe("사용 부품 — 조회", () => {
  test("서버 전용 모듈이다", () => {
    assert.match(queryFlat, /^import "server-only";/);
  });

  test("그 건의 줄을 line_no 차례대로 읽는다 — 화면이 다시 정렬하지 않는다", () => {
    assert.match(queryFlat, /\.from\(repairCaseUsedParts\)/);
    assert.match(queryFlat, /\.where\(eq\(repairCaseUsedParts\.repairCaseId, repairCaseId\)\)/);
    assert.match(queryFlat, /\.orderBy\(asc\(repairCaseUsedParts\.lineNo\)\)/);
  });

  test("화면에 보이는 품명은 그 건에 적힌 글자다 — parts 마스터와 조인하지 않는다", () => {
    assert.match(queryFlat, /partNameText: repairCaseUsedParts\.partNameText/);
    assert.ok(!/innerJoin|leftJoin/.test(queryCode), "조인 없이 그린다 (quote_items 와 같은 판단)");
  });

  test("반출 이력은 있나 없나만 본다 — 개수를 세지 않는다", () => {
    assert.match(queryFlat, /\.from\(inventoryPartRequests\)/);
    assert.match(queryFlat, /\.limit\(1\)/);
    assert.ok(!/count\(/.test(queryCode), "exists 로 충분하다 — 개수를 세지 않는다");
    assert.match(queryFlat, /hasPartRequestHistory: requestProbe\.length > 0/);
  });

  test("🔴 반출 이력으로 치는 집합이 통계가 세는 집합과 같다 — REJECTED·CANCELLED 는 빼고 본다", () => {
    assert.match(
      queryFlat,
      /const UNCOUNTED_PART_REQUEST_STATUSES = \["REJECTED", "CANCELLED"\] as const;/
    );
    assert.match(
      queryFlat,
      /notInArray\(inventoryPartRequests\.status, \[\.\.\.UNCOUNTED_PART_REQUEST_STATUSES\]\)/
    );
    // 통계 쪽(queries/product-models.ts)이 빼고 세는 목록과 **같은 목록**이어야
    // 한다. 어긋나면 두 번 세거나 한 번도 안 세는 건이 생긴다.
    assert.match(
      flatten(productModelsCode),
      /const UNCOUNTED_PART_REQUEST_STATUSES = \["REJECTED", "CANCELLED"\] as const;/
    );
  });

  test("두 질의를 나란히 쏜다 — 왕복을 직렬로 늘리지 않는다", () => {
    assert.match(queryFlat, /const \[rows, requestProbe\] = await Promise\.all\(\[/);
  });

  test("🔴 읽기뿐이다 — insert·update·delete 가 없다", () => {
    assert.ok(!/db\.insert|db\.update|db\.delete|\.transaction\(/.test(queryCode));
  });
});

describe("사용 부품 — 칸", () => {
  test("🔴 반출 이력이 있으면 적을 자리를 그리지 않고 안내만 낸다", () => {
    assert.match(sectionFlat, /\{hasPartRequestHistory && \(/);
    assert.ok(sectionCode.includes("부품 요청(반출) 이력"));
    assert.ok(sectionCode.includes("여기에는 따로 적지 않습니다"));
  });

  test("반출 이력이 없고 줄도 없으면 「아직 적힌 것이 없습니다」", () => {
    assert.match(sectionFlat, /\{!hasPartRequestHistory && !hasRows && \(/);
    assert.ok(sectionCode.includes("아직 적힌 것이 없습니다."));
  });

  test("줄이 있으면 품명·수량 표를 그린다", () => {
    assert.match(sectionFlat, /const hasRows = rows\.length > 0;/);
    assert.match(sectionFlat, /\{hasRows && \(/);
    assert.match(sectionFlat, /<th[^>]*>품명<\/th>/);
    assert.match(sectionFlat, /<th[^>]*>수량<\/th>/);
    assert.match(sectionFlat, /\{rows\.map\(\(row\) => \(/);
    assert.match(sectionFlat, /\{row\.partNameText\}/);
    assert.match(sectionFlat, /\{row\.quantity\}/);
  });

  test("정렬을 여기서 다시 하지 않는다 — 조회가 line_no 차례로 준다", () => {
    assert.ok(!/\.sort\(|\.reverse\(/.test(sectionCode));
  });

  test("🔴 이번 조각에는 쓰기 길이 없다 — 입력 칸·단추·폼이 하나도 없다", () => {
    for (const tag of ["<input", "<button", "<form", "<textarea", "<select"]) {
      assert.ok(!sectionCode.includes(tag), `${tag} 는 다음 조각(B-2)이다`);
    }
  });

  test("🔴 서버 액션·mutation 을 부르지 않는다", () => {
    assert.ok(!/@\/lib\/server\/actions/.test(sectionCode), "서버 액션을 부르지 않는다");
    assert.ok(!/Action\(/.test(sectionCode));
    assert.ok(!/useState|useTransition|useRouter|showSavePopup/.test(sectionCode), "상태도 팝업도 없다");
  });

  test("서버 전용 조회 모듈에서는 타입만 가져온다", () => {
    assert.match(
      sectionFlat,
      /import type \{ RepairCaseUsedPartRow \} from "@\/lib\/db\/queries\/repair-case-used-parts";/
    );
    assert.ok(!/^import \{/m.test(sectionCode.replace(/^import type .*$/gm, "")));
  });
});

describe("사용 부품 — 상세 화면에 붙이기", () => {
  test("🔴 DATABASE 소스 건에만 조회한다 — MOCK·LOCAL_DEMO 에는 이 표가 없다", () => {
    assert.match(
      pageFlat,
      /resolved\.source === "DATABASE" \? getRepairCaseUsedPartsView\(resolved\.id\) : null/
    );
  });

  test("🔴 기존 Promise.all 에 태웠다 — 왕복이 늘지 않았다", () => {
    assert.equal(pageCode.match(/Promise\.all\(/g)?.length, 1, "묶음은 하나뿐이다");

    const start = pageFlat.indexOf("Promise.all([");
    const end = pageFlat.indexOf("]);", start);
    assert.ok(start > 0 && end > start, "Promise.all 묶음을 찾지 못했다");
    const bundle = pageFlat.slice(start, end);
    assert.ok(
      bundle.includes("getRepairCaseUsedPartsView(resolved.id)"),
      "조회가 기존 Promise.all 묶음 안에 있어야 한다"
    );

    // 묶음 밖에서 따로 기다리면 왕복이 하나 늘어난다.
    assert.ok(!/await getRepairCaseUsedPartsView/.test(pageCode));
    assert.equal(pageCode.match(/getRepairCaseUsedPartsView\(/g)?.length, 1);
  });

  test("결과를 상세 화면으로 넘긴다", () => {
    assert.match(
      pageFlat,
      /import \{ getRepairCaseUsedPartsView \} from "@\/lib\/db\/queries\/repair-case-used-parts";/
    );
    assert.match(pageFlat, /usedParts=\{usedParts\}/);
  });

  test("칸은 조회 결과가 있을 때만 그려진다 — PartRequestSection 과 같은 모양", () => {
    assert.match(viewFlat, /\{usedParts && \( <UsedPartsSection rows=\{usedParts\.rows\}/);
    assert.match(viewFlat, /hasPartRequestHistory=\{usedParts\.hasPartRequestHistory\} \/> \)\}/);
  });

  test("기존 부품 요청 칸은 그대로 남아 있다", () => {
    assert.match(viewFlat, /\{partRequestData && partRequestData\.caseContext && \( <PartRequestSection/);
  });
});
