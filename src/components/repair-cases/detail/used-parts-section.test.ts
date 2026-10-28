import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「사용 부품」 칸 — 읽기(B-1) + 적고 저장하기(B-2)
 * ============================================================================
 * 수리 건 상세에 그 건에서 갈아 끼운 부품을 보여 주고, 줄을 더하고 · 지우고 ·
 * 저장하는 칸이다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────────────────
 * RepairCaseDetailView 아래의 상세 화면 컴포넌트들은 서버 액션(update-repair-case
 * 등)으로 이어지는 사슬을 물고 있어서 react-server 조건 없이 도는 test:components
 * 에서는 **import 자체가 던진다.** 같은 폴더의 product-info-history-disclosure.
 * test.ts 가 쓰는 방법을 그대로 쓴다. B-2 에서 칸이 직접 서버 액션을 물게 됐으니
 * 더욱 그렇다.
 *
 * ── 여기서 못 박는 것 ──────────────────────────────────────────────────────
 *  1. 🔴 한 건의 부품 출처를 둘로 쪼개지 않는다 — 반출 이력이 있으면 적을 자리를
 *     그리지 않고 안내만 낸다(같은 부품을 통계가 두 번 세지 않게).
 *  2. 반출 이력이 없고 줄도 없으면 「아직 적힌 것이 없습니다」.
 *  3. 줄이 있으면 품명·수량 표.
 *  4. 🔴 적을 수 있는 건인지는 **서버가 정한다**(writeGate) — 화면이 다시 따지지
 *     않는다.
 *  5. DATABASE 소스가 아니면 조회하지 않는다(MOCK·LOCAL_DEMO 에는 이 표가 없다).
 *  6. 🔴 왕복이 늘지 않았다 — 기존 Promise.all 에 태웠다(부품 마스터도 같이).
 *  7. 반출 이력으로 치는 상태 집합이 통계가 세는 집합과 같다(REJECTED·CANCELLED 제외).
 *  8. 🔴 부품 고르개를 붙였다 — 고르면 part_id 가 붙고, 고쳐 쓰면 풀린다. 마스터에
 *     없는 부품은 손으로 적을 수 있다.
 *  9. 🔴 화면이 줄 번호를 보내지 않는다 — line_no 는 서버가 매긴다.
 * 10. 🔴 역할 표가 화면에도 액션에도 없다 — 액션은 살아 있는 계정을 저장 쪽으로
 *     **나르기만** 하고, 「누가 적을 수 있는가」는 [역할별 접근 권한]의
 *     `repairCases.usedParts` 가 정한다(2026-09-17 전환). 기본값과 판정 차례는
 *     auth/repair-case-used-parts-authorization.test.ts 가 못 박는다.
 * 11. 🔴 **보이는 글자와 저장되는 글자가 다르다**(2026-10-28) — 저장은 품번 그대로,
 *     화면은 서버가 재고 관리의 고객사 품명을 앞에 붙여 만든 글자. 합치는 규칙은
 *     domain/used-part-display.ts 한 곳이고, 갈래마다 무엇이 보이는지는 그 곁의
 *     used-part-display.test.ts 가 **값으로** 못 박는다. 여기서 재는 것은 「그 규칙을
 *     어디서 부르고 어디로 나르는가」다.
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

const formCode = stripComments(read("src/components/repair-cases/detail/edit/UsedPartsEditForm.tsx"));
const formFlat = flatten(formCode);

const actionCode = stripComments(read("src/lib/server/actions/repair-case-used-parts.ts"));
const actionFlat = flatten(actionCode);

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
    assert.match(queryFlat, /return probe\.length > 0;/);
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

  test("질의를 나란히 쏜다 — 왕복을 직렬로 늘리지 않는다", () => {
    assert.match(
      queryFlat,
      /const \[rows, hasPartRequestHistory, caseProbe, isLegacyImportedCase, canWriteUsedParts\] = await Promise\.all\(\[/
    );
  });

  test("🔴 누가 적을 수 있는지는 설정에 묻는다 — 역할 이름을 비교하지 않는다", () => {
    assert.match(queryFlat, /hasPermission\(actor, "repairCases\.usedParts", "WRITE"\)/);
    // 사람을 못 읽었으면 묻지 않고 닫는다 — 권한 조회가 없는 쪽이 곧 false 다.
    assert.match(queryFlat, /actor === null \? false : hasPermission\(actor, "repairCases\.usedParts", "WRITE"\)/);
  });

  test("🔴 읽기뿐이다 — insert·update·delete 가 없다", () => {
    assert.ok(!/db\.insert|db\.update|db\.delete|\.transaction\(/.test(queryCode));
  });

  test("🔴 적을 수 있는 건인가를 **서버가** 정해 내려보낸다", () => {
    assert.match(queryFlat, /writeGate: resolveUsedPartsWriteGate\(\{/);
    assert.match(queryFlat, /isShipmentLocked: caseProbe\[0\]\?\.isLocked \?\? true/);
    assert.match(queryFlat, /isLegacyImportedCase,/);
  });
});

describe("사용 부품 — 칸", () => {
  test("🔴 반출 이력이 있으면 적을 자리를 그리지 않고 안내만 낸다", () => {
    assert.match(sectionFlat, /\{hasPartRequestHistory && \(/);
    assert.ok(sectionCode.includes("부품 요청(반출) 이력"));
    assert.ok(sectionCode.includes("여기에는 따로 적지 않습니다"));
  });

  test("반출 이력이 없고 줄도 없으면 「아직 적힌 것이 없습니다」", () => {
    assert.match(sectionFlat, /\{!hasPartRequestHistory && !hasRows && !isEditing && \(/);
    assert.ok(sectionCode.includes("아직 적힌 것이 없습니다."));
  });

  test("줄이 있으면 품명·수량 표를 그린다", () => {
    assert.match(sectionFlat, /const hasRows = rows\.length > 0;/);
    assert.match(sectionFlat, /\{hasRows && !isEditing && \(/);
    assert.match(sectionFlat, /<th[^>]*>품명<\/th>/);
    assert.match(sectionFlat, /<th[^>]*>수량<\/th>/);
    assert.match(sectionFlat, /\{rows\.map\(\(row\) => \(/);
    /**
     * 🔴 2026-10-28 에 품명 칸의 글자가 바뀌었다. 저장된 글자는 **품번**이고(연락서
     * 이식이 `型式`·`仕様書番号` 칸을 읽는다), 화면은 서버가 고객사 품명을 앞에 붙여
     * 만들어 준 글자를 그린다. 🔴 **없는 줄은 품번으로 떨어진다** — 그 `??` 가 없으면
     * 재고 관리가 멈춘 날 품명 칸이 통째로 빈다(이미 저장된 사실이 사라진다).
     */
    assert.match(sectionFlat, /\{displayNames\[row\.id\] \?\? row\.partNameText\}/);
    assert.match(sectionFlat, /\{row\.quantity\}/);
  });

  test("🔴 합치는 규칙이 화면에 없다 — 서버가 만든 글자를 그리기만 한다", () => {
    // 괄호로 잇는 일도, 재고 관리 줄을 뒤지는 일도 여기서 하지 않는다. 규칙이 두 벌이
    // 되면 [사용부품] 칸과 [고장 부품] 그래프가 같은 부품을 다른 이름으로 부른다.
    assert.ok(
      !/customerPartName|kyosanPartNo|partFieldValue|usedPartMatchKey|usedPartDisplayName/.test(sectionCode),
      "화면이 스스로 합치고 있다"
    );
  });

  test("🔴 저장되는 글자는 품번 그대로다 — 수정 폼에 합친 글자가 들어가지 않는다", () => {
    // 폼은 줄을 그대로 받는다(`rows={rows}`). displayNames 는 폼으로 내려가지 않는다 —
    // 내려가면 「고객사 품명 (품번)」이 그대로 저장돼, 재고 관리에서 이름이 바뀌어도
    // 안 따라가는 글자가 DB 에 박힌다.
    assert.ok(!/displayNames/.test(formCode), "폼이 합친 글자를 보고 있다");
    // 🔵 `indexOf` 가 -1 이면 slice(-1) 이 마지막 한 글자가 되어 아래가 **공짜로** 통과한다.
    //    그래서 폼을 그리는 자리를 먼저 찾았는지 단언한다.
    const formTagAt = sectionFlat.indexOf("<UsedPartsEditForm");
    assert.ok(formTagAt > 0, "수정 폼을 그리는 자리를 찾지 못했다");
    assert.ok(
      !/displayNames=\{/.test(sectionFlat.slice(formTagAt)),
      "폼으로 합친 글자를 넘기고 있다"
    );
    assert.match(formFlat, /value=\{line\.partNameText\}/);
  });

  test("정렬을 여기서 다시 하지 않는다 — 조회가 line_no 차례로 준다", () => {
    assert.ok(!/\.sort\(|\.reverse\(/.test(sectionCode));
  });

  test("🔴 적을 수 있는지는 서버가 준 writeGate 하나로 정한다 — 화면이 다시 따지지 않는다", () => {
    assert.match(sectionFlat, /const canEdit = writeGate\.ok;/);
    assert.match(sectionFlat, /\{canEdit && !isEditing && \(/);
    assert.match(sectionFlat, /\{canEdit && isEditing && \(/);
    assert.ok(
      !/hasPartRequestHistory \?|!hasPartRequestHistory &&\s*<|isLocked|resolveUsedPartsWriteGate/.test(sectionFlat),
      "잠그는 판단을 화면이 다시 하지 않는다"
    );
  });

  test("막힌 까닭을 말해 준다 — 잠긴 건 · 권한 없음(반출 이력은 위에서 이미 안내한다)", () => {
    assert.match(sectionFlat, /!writeGate\.ok && writeGate\.code !== "PART_REQUEST_HISTORY_EXISTS"/);
    assert.match(sectionFlat, /\{writeGate\.message\}/);
  });

  test("🔴 화면에 역할 이름이 한 글자도 없다 — 역할 표는 인가 모듈 한 곳에만 있다", () => {
    for (const [label, code] of [
      ["UsedPartsSection.tsx", sectionCode],
      ["UsedPartsEditForm.tsx", formCode],
    ] as const) {
      assert.ok(
        !/SUPER_ADMIN|AS_ENGINEER|INVENTORY_MANAGER|"ADMIN"|'ADMIN'|"SALES"|'SALES'/.test(code),
        `${label} 이 역할을 스스로 따지고 있다`
      );
    }
    // 화면이 보는 것은 여전히 writeGate 하나뿐이다.
    assert.match(sectionFlat, /const canEdit = writeGate\.ok;/);
  });

  test("편집 폼은 적을 수 있는 건에만 그려진다 — 폼이 스스로 판정하지 않는다", () => {
    assert.match(sectionFlat, /<UsedPartsEditForm repairCaseId=\{repairCaseId\} version=\{version\}/);
    assert.ok(
      !/writeGate|hasPartRequestHistory|isLocked/.test(formCode),
      "폼에는 인가 판단이 하나도 없다"
    );
  });
});

describe("사용 부품 — 적고 저장하기", () => {
  test("서버 액션 하나만 부른다", () => {
    assert.match(
      formFlat,
      /import \{ saveRepairCaseUsedPartsAction \} from "@\/lib\/server\/actions\/repair-case-used-parts";/
    );
    assert.equal(formCode.match(/Action\(\{/g)?.length, 1, "저장 길은 하나뿐이다");
  });

  test("🔴 줄을 더하고 지울 수 있다 — 마지막 줄까지", () => {
    assert.match(formFlat, /줄 추가/);
    assert.match(formFlat, /function removeLine\(key: string\) \{ setLines\(\(prev\) => prev\.filter/);
    // 「한 줄은 남겨야 한다」는 제약이 없다 — 빈 목록 저장이 전부 걷어내는 길이다.
    assert.ok(!/lines\.length > 1 &&|lines\.length === 1 \?/.test(formFlat));
  });

  test("🔴 부품 고르개를 붙였다 — 견적서가 쓰는 그 조각을 재사용한다", () => {
    // 🔴 2026-09-22 고르개가 공용 묶음으로 옮겨 갔다(A/S 안의 사본이 아니라 서브모듈의
    //    한 벌이다). 견적서 폼도 **같은 경로**에서 같은 이름을 부른다 — 여기서 경로를
    //    글자로 박아 두는 까닭이 그것이다.
    assert.match(
      formFlat,
      /import \{ PartSuggestionList, filterPartOptions, partPickPatch, \} from "@dss\/core\/ui\/inventory\/part-picker";/
    );
    assert.match(formFlat, /<PartSuggestionList options=\{filterPartOptions\(partOptionRows, line\.partNameText\)\}/);
    /**
     * 🔴 2026-10-16 — 고르는 대상이 **재고 관리의 부품**으로 바뀌었다. 그 부품에는 A/S
     *    `parts.id`(UUID)가 없어서 고른 줄의 번호를 `part_id` 에 넣지 않고 **비운다** —
     *    넣으면 저장이 거절된다(validation/repair-case-used-parts-input.ts 가 UUID 를 본다).
     *    품명은 글자로 저장되므로 화면과 옛 줄은 그대로다.
     */
    assert.match(
      formFlat,
      /onPick=\{\(option\) => \{ updateLine\(line\.key, \{ \.\.\.partPickPatch\(option\),/
    );
    assert.match(formFlat, /partId: null, \}\); setPickerKey\(null\); \}\}/);
  });

  test("🔴 고르면 붙고, 글자를 고치면 풀린다 — 마스터에 없는 부품은 손으로 적는다", () => {
    assert.match(
      formFlat,
      /updateLine\(line\.key, \{ partNameText: e\.target\.value, partId: null \}\)/
    );
    assert.match(formFlat, /placeholder="부품 품명 \(마스터에 없으면 그냥 적으세요\)"/);
  });

  test("🔴 화면이 줄 번호를 보내지 않는다 — line_no 는 서버가 매긴다", () => {
    assert.match(
      formFlat,
      /lines: lines\.map\(\(line\) => \(\{ partId: line\.partId, partNameText: line\.partNameText, quantity: Number\(line\.quantity\), \}\)\)/
    );
    assert.ok(!/lineNo/.test(formCode), "폼에 줄 번호가 없다");
  });

  test("동시 편집 — CONFLICT 면 폼을 얼리고 다시 불러오게 한다", () => {
    assert.match(formFlat, /expectedVersion: version,/);
    assert.match(formFlat, /if \(result\.code === "CONFLICT"\) \{ setIsConflict\(true\);/);
    assert.match(formFlat, /const disabled = isSubmitting \|\| isConflict;/);
    assert.match(formFlat, /<EditSectionActions/);
  });

  test("저장 뒤 목록으로 튀지 않는다 — 상세 화면에 머문다", () => {
    assert.match(formFlat, /showSavePopup\(\{ message: "사용 부품을 저장했습니다\.", redirectTo: null \}\)/);
    assert.match(formFlat, /router\.refresh\(\);/);
  });

  test("UUID 는 공용 함수로 만든다 — 평문 HTTP 에서도 돌아야 한다", () => {
    assert.match(formFlat, /import \{ generateClientUuid \} from "@\/lib\/client-uuid";/);
    assert.ok(!/crypto\.randomUUID/.test(formCode));
  });
});

describe("사용 부품 — 서버 액션의 관문", () => {
  test("update-repair-case 와 같은 앞부분을 같은 차례로 본다", () => {
    assert.match(actionFlat, /^"use server";/);
    const order = [
      "getRepairCaseWriteSource()",
      "getRepairCaseReadSource()",
      "await readSession()",
      "await resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      "isValidRepairCaseId(input.repairCaseId)",
      "isValidExpectedVersion(input.expectedVersion)",
      "validateUsedPartLines(input.lines)",
      "saveRepairCaseUsedParts(",
      // 🔴 사람은 세션 토큰이 아니라 위에서 다시 읽은 살아 있는 계정에서 온다.
      "actor: actingUser,",
    ];
    let cursor = -1;
    for (const needle of order) {
      const next = actionFlat.indexOf(needle, cursor + 1);
      assert.ok(next > cursor, `${needle} 가 차례에 맞게 나와야 한다`);
      cursor = next;
    }
  });

  test("날 DB 오류를 브라우저로 보내지 않는다", () => {
    assert.match(actionFlat, /code: "DATABASE_UNAVAILABLE"/);
    assert.match(actionFlat, /console\.error\("saveRepairCaseUsedPartsAction: unexpected DB error"/);
  });

  test("🔴 규칙 셋은 액션이 아니라 mutation 이 본다 — 트랜잭션 안에서", () => {
    assert.ok(
      !/hasLivePartRequest|isImportedFromKyosanIntake|resolveUsedPartsWriteGate|hasPermission|USED_PARTS_WRITE_ROLES/.test(
        actionCode
      ),
      "액션이 판정을 미리 흉내 내지 않는다"
    );
    // 사람만 나른다 — 권한 판정은 저장 쪽에서 다시 일어난다.
    assert.match(actionFlat, /actor: actingUser,/);
  });
});

describe("사용 부품 — 상세 화면에 붙이기", () => {
  test("🔴 DATABASE 소스 건에만 조회한다 — MOCK·LOCAL_DEMO 에는 이 표가 없다", () => {
    assert.match(
      pageFlat,
      /resolved\.source === "DATABASE" \? getRepairCaseUsedPartsView\(resolved\.id, actingUser\) : null/
    );
    /**
     * 🔴 품명 칸에서 고를 부품은 2026-10-16 부터 **재고 관리**에서 온다(A/S 의 부품 표는
     * 다음 조각에서 걷어낸다). MOCK · LOCAL_DEMO 건에는 이 칸 자체가 그려지지 않으므로
     * 부르지 않는다 — 🔵 그 자리의 빈 목록은 **실패를 접은 것이 아니다**.
     */
    assert.match(pageFlat, /resolved\.source === "DATABASE" \? \(partRequestData\?\.parts \?\? fetchInventoryParts\(\)\)/);
    assert.match(pageFlat, /\{ status: "ok", value: \[\] \} satisfies InventoryResult<InventoryPart\[\]>/);
  });

  test("🔴 기존 Promise.all 에 태웠다 — 왕복이 늘지 않았다", () => {
    assert.equal(pageCode.match(/Promise\.all\(/g)?.length, 1, "묶음은 하나뿐이다");

    const start = pageFlat.indexOf("Promise.all([");
    const end = pageFlat.indexOf("]);", start);
    assert.ok(start > 0 && end > start, "Promise.all 묶음을 찾지 못했다");
    const bundle = pageFlat.slice(start, end);
    assert.ok(
      bundle.includes("getRepairCaseUsedPartsView(resolved.id, actingUser)"),
      "조회가 기존 Promise.all 묶음 안에 있어야 한다"
    );
    assert.ok(bundle.includes("fetchInventoryParts()"), "고를 부품도 같은 묶음 안에 있어야 한다");

    // 묶음 밖에서 따로 기다리면 왕복이 하나 늘어난다.
    assert.ok(!/await getRepairCaseUsedPartsView|await fetchInventoryParts/.test(pageCode));
    assert.equal(pageCode.match(/getRepairCaseUsedPartsView\(/g)?.length, 1);
    // 🔴 한 번뿐이다 — 부품 요청 칸이 이미 받아 왔으면 그 목록을 그대로 쓴다(같은 통로를
    //    한 화면에서 두 번 두드리지 않는다).
    assert.equal(pageCode.match(/fetchInventoryParts\(/g)?.length, 1);
  });

  test("결과를 상세 화면으로 넘긴다", () => {
    assert.match(
      pageFlat,
      /import \{ getRepairCaseUsedPartsView \} from "@\/lib\/db\/queries\/repair-case-used-parts";/
    );
    assert.match(pageFlat, /usedParts=\{usedParts\}/);
    assert.match(pageFlat, /usedPartOptions=\{usedPartOptions\}/);
    assert.match(pageFlat, /usedPartDisplayNames=\{usedPartDisplayNames\}/);
  });

  test("🔴 보여 줄 글자는 **서버가** 합친다 — 통로를 더 두드리지 않는다 (2026-10-28)", () => {
    assert.match(
      pageFlat,
      /import \{ buildUsedPartNameIndex, usedPartDisplayNamesById \} from "@\/lib\/domain\/used-part-display";/
    );
    /**
     * 🔴 **바로 위에서 받아 온 그 목록**으로 만든다(`usedPartOptions`). 여기서 다시
     * `fetchInventoryParts()` 를 부르면 한 화면이 같은 통로를 두 번 두드리고, 위
     * 「왕복이 늘지 않았다」 시험은 그것을 못 잡는다(그 시험은 Promise.all 묶음만 본다).
     */
    assert.match(
      pageFlat,
      /const usedPartDisplayNames = usedPartDisplayNamesById\( usedParts\?\.rows \?\? \[\], buildUsedPartNameIndex\(usedPartOptions\) \);/
    );
    // 🔴 합치는 규칙이 페이지에 번지지 않았다 — 규칙은 domain 한 곳이다.
    assert.ok(
      !/customerPartName|kyosanPartNo|normalizeKey|kyosanUsedPartKey/.test(pageCode),
      "페이지가 스스로 칸을 뒤지고 있다"
    );
  });

  test("🔴 합친 글자가 화면까지 그대로 간다 — 가운데서 다시 만들지 않는다", () => {
    assert.match(viewFlat, /usedPartDisplayNames: Record<string, string>;/);
    assert.match(viewFlat, /displayNames=\{usedPartDisplayNames\}/);
    assert.ok(
      !/buildUsedPartNameIndex|usedPartDisplayNamesById|usedPartDisplayName\(/.test(viewCode),
      "상세 화면이 스스로 합치고 있다"
    );
  });

  test("칸은 조회 결과가 있을 때만 그려진다 — PartRequestSection 과 같은 모양", () => {
    assert.match(viewFlat, /\{usedParts && \( <UsedPartsSection repairCaseId=\{effective\.id\}/);
    assert.match(viewFlat, /version=\{effective\.version\}/);
    assert.match(viewFlat, /writeGate=\{usedParts\.writeGate\}/);
    assert.match(viewFlat, /partOptions=\{usedPartOptions\}/);
  });

  test("기존 부품 요청 칸은 그대로 남아 있다", () => {
    assert.match(viewFlat, /\{partRequestData && partRequestData\.caseContext && \( <PartRequestSection/);
  });
});
