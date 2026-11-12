import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FINAL_SHIPMENT_APPROVED_FILTER_VALUE,
  FINAL_SHIPMENT_APPROVED_LABEL,
} from "@/lib/domain/final-shipment-approval-badge";
import { IN_HOUSE_STATUSES } from "@/lib/domain/repair-case-filters";
import { isShortcutActive } from "@/components/common/checkbox-filter-dropdown";

/**
 * ============================================================================
 * [현재 상태] 필터의 **[최종 출하 승인 완료]** 한 줄 (2026-11-12 사용자 요구)
 * ============================================================================
 * 요구 원문: 「[전체 A/S 현황]의 [현재 상태] 필터에 [최종 출하 승인 완료]도 추가해
 * 줘. 그걸 선택하면 [최종 출하 승인 완료] 배지가 있는 수리건들을 찾아볼 수 있도록
 * 해 줘.」
 *
 * 🔴 **거르는 규칙은 여기서 재지 않는다** — unit 목록의
 * lib/domain/repair-case-filters.test.ts 가 OR·빈 배열·근거 없을 때까지 전부 잰다.
 * 여기서 못 박는 것은 화면 둘이 그 값을 **실제로 그렇게 쓰는가**다:
 *   ① 거르개에 그 줄이 **있는가** — 없으면 값 쪽이 다 통과해도 고를 길이 없다.
 *   ② 목록 화면이 승인 묶음을 **applyFilters 에 넘기는가** — 안 넘기면 골라도
 *      0건이고, 오류가 아니라 「조건에 맞는 건이 없습니다」라 아무도 신고하지 않는다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * RepairCaseFilters 는 "use client" + useUiText 라 여기서 통째로 못 그리고, 그릴 수
 * 있어도 드롭다운은 **접힌 채로 태어나** 정적 렌더로는 목록을 못 본다(이 저장소에는
 * jsdom 이 없다). 이웃 repair-case-multi-select-filters.test.ts 와 같은 방법·같은
 * 까닭이고, 주석을 걷어내는 도구도 그 파일에서 그대로 가져왔다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 주석을 걷어낸 뒤에 센다. 이 화면의 주석은 "왜 그렇게 했는가"를 길게 적는
 * 자리라 「최종 출하 승인 완료」도 상수 이름도 거기 적혀 있다 — 날것으로 세면
 * **코드를 통째로 되돌려도 주석만으로 영영 통과한다.** 걷어내기가 정말 듣는지는
 * 아래 ⓪ 에서 먼저 잰다(안쪽을 `[\s\S]*?` 로 적으면 다른 주석의 닫힘까지 뛰어넘어
 * 코드를 통째로 지운다 — 이웃 시험이 실제로 당했다).
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, " ") // JSX 주석 {/* … */}
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, " ") // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1"); // 줄 주석 ("https://" 는 건드리지 않는다)
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const filtersSource = read("src/components/repair-cases/RepairCaseFilters.tsx");
const listPageSource = read("src/components/repair-cases/RepairCaseListPage.tsx");

const strippedFilters = flat(withoutComments(filtersSource));
const strippedListPage = flat(withoutComments(listPageSource));

/**
 * [현재 상태] 칸 **한 덩어리**. 넉넉히 자르면 다음 칸(제품군)이 딸려 들어와 무엇을
 * 재는지 알 수 없게 된다 — id 자리에서 시작해 첫 `/>` 에서 끊는다.
 */
function statusField(): string {
  const at = strippedFilters.indexOf('id="repair-case-status"');
  assert.notEqual(at, -1, "현재 상태 칸을 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것");
  const end = strippedFilters.indexOf("/>", at);
  assert.notEqual(end, -1, "현재 상태 칸의 끝(/>)을 찾지 못했다");
  const block = strippedFilters.slice(at, end);
  assert.ok(block.length > 0, "덩어리를 못 잘랐다 — 아래 단언이 공짜로 통과한다");
  assert.ok(block.includes('label="현재 상태"'), "덩어리에 칸 이름이 없다 — 엉뚱한 곳을 자르고 있다");
  assert.ok(!block.includes('label="제품군"'), "다음 칸이 딸려 들어왔다");
  return block;
}

// ───────────────────────────────────── ⓪ 재는 도구가 정말 듣는가

describe("🔵 재는 도구", () => {
  test("주석 걷어내기가 정말 듣는다 — 안 들으면 아래가 주석만으로 통과한다", () => {
    assert.ok(
      filtersSource.includes("2026-11-12 사용자 요구"),
      "표지로 삼은 주석 글귀가 사라졌다 — 이 시험도 함께 고칠 것"
    );
    assert.ok(
      !withoutComments(filtersSource).includes("2026-11-12 사용자 요구"),
      "주석이 그대로 남아 있다 — 아래 부정 단언들이 무의미해진다"
    );
    assert.ok(strippedFilters.includes("현재 상태"), "걷어내다 칸 이름까지 날렸다");
  });
});

// ───────────────────────────────────── ① 거르개에 그 줄이 있는가

describe("🔴 [현재 상태] 칸의 마지막 한 줄", () => {
  test("선택지 끝에 [최종 출하 승인 완료]가 붙는다 — 상태 열둘은 그대로 코드 목록에서", () => {
    const block = statusField();
    assert.match(
      block,
      /options=\{\[ \.\.\.REPAIR_STATUS_CODES\.map\(\(status\) => \(\{ value: status, label: uiText\.repairStatus\[status\], \}\)\), \{ value: FINAL_SHIPMENT_APPROVED_FILTER_VALUE, label: FINAL_SHIPMENT_APPROVED_LABEL \}, \]\}/,
      "상태 열둘 뒤에 그 한 줄이 붙는 모양이 아니다"
    );
  });

  test("🔴 그 줄이 **맨 아래**다 — 상태 사이에 끼면 사람이 한 단계로 읽는다", () => {
    // 위의 열둘은 워크플로 순서대로 서 있다. 마지막 상태(출하 완료) 뒤에 두어야
    // 「흐름이 끝난 자리부터가 다른 종류」라는 것이 읽는 차례만으로 드러난다.
    const block = statusField();
    const statuses = block.indexOf("REPAIR_STATUS_CODES.map");
    const added = block.indexOf("FINAL_SHIPMENT_APPROVED_FILTER_VALUE");
    assert.notEqual(statuses, -1, "상태 목록이 사라졌다");
    assert.notEqual(added, -1, "더한 줄이 사라졌다");
    assert.ok(added > statuses, "더한 줄이 상태 열둘보다 앞에 있다");
  });

  test("🔴 글자를 손으로 적지 않는다 — 배지가 쓰는 그 상수를 가져다 쓴다", () => {
    // 같은 말이 두 벌로 정의되면 이름표가 바뀌는 날 거르개와 배지가 다른 말을
    // 하는데, 타입이 같은 문자열이라 tsc 가 한마디도 안 한다.
    assert.match(
      filtersSource,
      /^import \{\n  FINAL_SHIPMENT_APPROVED_FILTER_VALUE,\n  FINAL_SHIPMENT_APPROVED_LABEL,\n\} from "@\/lib\/domain\/final-shipment-approval-badge";$/m,
      "배지 도메인에서 값과 글자를 가져오지 않는다"
    );
    assert.ok(
      !withoutComments(filtersSource).includes(`"${FINAL_SHIPMENT_APPROVED_LABEL}"`),
      "화면에 「최종 출하 승인 완료」를 글자로 적어 두었다 — 두 벌이 된다"
    );
    assert.ok(
      !withoutComments(filtersSource).includes(`"${FINAL_SHIPMENT_APPROVED_FILTER_VALUE}"`),
      "화면에 필터 값을 글자로 적어 두었다 — 상수와 어긋나면 아무 줄도 안 걸린다"
    );
  });

  test("🔴 다른 네 칸에는 새어 들어가지 않았다", () => {
    for (const id of [
      "repair-case-product-category",
      "repair-case-billing-type",
      "repair-case-customer",
      "repair-case-priority",
    ]) {
      const at = strippedFilters.indexOf(`id="${id}"`);
      assert.notEqual(at, -1, `${id} 칸을 찾지 못했다`);
      const block = strippedFilters.slice(at, strippedFilters.indexOf("/>", at));
      assert.ok(
        !block.includes("FINAL_SHIPMENT_APPROVED"),
        `${id} 에 [최종 출하 승인 완료]가 섞였다`
      );
    }
  });
});

// ───────────────────────────────────── ② 「입고품 전체」 단추는 그대로다

describe("🔴 「입고품 전체」 토글의 규칙은 안 건드렸다", () => {
  test("더한 줄은 단축 단추의 묶음에 들어가지 않는다", () => {
    assert.ok(
      !(IN_HOUSE_STATUSES as readonly string[]).includes(FINAL_SHIPMENT_APPROVED_FILTER_VALUE),
      "단축 단추가 승인 여부까지 말하는 조건이 되었다 — 대시보드 [현재 입고 수]와 수가 갈린다"
    );
    assert.match(
      statusField(),
      /shortcut=\{\{ label: "입고품 전체", values: IN_HOUSE_STATUSES \}\}/,
      "단축 단추가 넣는 값을 손으로 적기 시작했다"
    );
  });

  test("🔵 단추를 누른 뒤 이 줄을 더 체크하면 단추가 풀린 모습이 된다 — 그것이 기존 규칙이다", () => {
    // 2026-11-11 에 정한 「눌렀는가가 아니라 **지금 고른 값**으로 판정한다」 그대로다
    // (checkbox-filter-dropdown.ts 의 isShortcutActive). 여기서만 따로 봐주면 손으로
    // 체크한 사람과 단추를 누른 사람이 다른 화면을 보게 된다 — 특별 취급하지 않는다.
    assert.equal(
      isShortcutActive(IN_HOUSE_STATUSES, [...IN_HOUSE_STATUSES]),
      true,
      "그 묶음 그대로일 때는 눌린 모습이어야 한다 — 아래 단언이 공짜로 통과한다"
    );
    assert.equal(
      isShortcutActive(IN_HOUSE_STATUSES, [
        ...IN_HOUSE_STATUSES,
        FINAL_SHIPMENT_APPROVED_FILTER_VALUE,
      ]),
      false
    );
  });
});

// ───────────────────────────────────── ③ 목록 화면이 근거를 넘기는가

describe("🔴 목록 화면의 배선", () => {
  test("applyFilters 에 승인 묶음을 **다섯째 인자로** 넘긴다", () => {
    // 안 넘기면 그 줄을 골라도 한 건도 안 나온다(근거가 없으면 아무 줄도 더하지
    // 않는 쪽을 골랐다 — repair-case-filters.ts 의 그 인자 주석).
    assert.ok(
      strippedListPage.includes(
        "applyFilters( rows, filters, myPendingApprovalIdSet, longPendingPoIdSet, finalShipmentApprovedIdSet )"
      ),
      "applyFilters 가 승인 묶음을 안 받는다"
    );
  });

  test("🔴 다시 거르는 조건이 되도록 useMemo 가 그 묶음을 지켜본다", () => {
    assert.ok(
      strippedListPage.includes(
        "[rows, filters, myPendingApprovalIdSet, longPendingPoIdSet, finalShipmentApprovedIdSet]"
      ),
      "의존 목록에 없다 — 묶음이 바뀌어도 목록이 안 다시 걸러진다"
    );
  });

  test("🔴 배지와 필터가 **같은 묶음 하나**를 본다", () => {
    // 갈라지면 「골랐는데 배지가 없는 줄」이 나오고 오류는 한 번도 안 난다.
    // 표·카드에 넘기는 것과 위에서 applyFilters 에 넘기는 것이 같은 변수다.
    assert.equal(
      (strippedListPage.match(/finalShipmentApprovedCaseIds=\{finalShipmentApprovedIdSet\}/g) ?? [])
        .length,
      2,
      "표·카드 두 곳이 그 묶음을 받지 않는다"
    );
    assert.ok(
      !strippedListPage.includes("loadRepairCaseFinalShipmentApprovalStates"),
      "목록 화면이 승인 상태를 따로 읽는다 — 묶음이 두 벌이 된다"
    );
  });
});
