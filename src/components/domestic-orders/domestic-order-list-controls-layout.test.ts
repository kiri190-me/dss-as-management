import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 내자 정리 목록의 **조작 줄 배치** — 이름표는 전부 칸 옆 (2026-11-18)
 * ============================================================================
 * 사용자 신고: 「기능적으로는 문제 없는데 배치를 조금 고쳐줘」. 검색 · 발주 년도는
 * 이름표가 칸 **옆**인데 상태 · 고객사만 공용 부품의 기본 모양이라 칸 **위**였다 —
 * 그 둘만 한 줄치 높아 줄이 들쭉날쭉했고, 이 화면은 위가 쓰고 남은 높이를 표가 받는
 * 구조라 그 높이가 그대로 표에서 빠졌다. 사용자가 고른 안은 **「전부 옆으로」**다.
 *
 * ── 🔴 이 파일이 지키는 것 가운데 가장 무거운 것 ─────────────────────────
 * **같은 부품을 쓰는 일곱 칸이 한 픽셀도 안 바뀌었는가.** [전체 A/S 현황]의 다섯과
 * [기타건 현황]의 둘이다. 새 모양은 **선택**(labelPlacement)이고 **기본값이 예전
 * 모양**이라, 그 일곱은 이 값을 넘기지 않는다는 사실로 지켜진다 — 기본값이 뒤집히면
 * 오류 한 줄 없이 일곱 화면이 한꺼번에 바뀐다. 기본값 자체가 예전 모양인지는 부품을
 * 진짜로 그려서 잰다(components/common/CheckboxFilterDropdown.test.tsx).
 *
 * 함께 보는 것:
 *  · 🔵 **접히는 단위가 「이름표 + 칸」인가** — 폰에서 「검색」만 윗줄에 남고 칸이
 *    다음 줄로 내려가던 것이 이번에 고친 둘째다(사용자 스크린샷).
 *  · 🔵 복수 선택 칸 둘이 **폰에서 한 치수 작은 폭**을 쓰는가(좁은 화면에서 한 줄에
 *    더 서게). 같은 성질의 기본 클래스를 두 번 적지 않았는가도 함께 본다 — 그러면
 *    class 차례가 아니라 **생성된 CSS 차례**가 이겨 조용히 엉뚱한 값이 먹는다.
 *  · 🔴 **사용자 요구로 걷어낸 안내 둘이 되살아나지 않았는가**(2026-11-18) —
 *    발행일순 줄의 **설명 부분**과 **납품일 안내 문단 전체**. 상태를 말하는 짧은
 *    한 줄과 [순번 차례로] 단추는 그대로여야 한다(이웃
 *    domestic-order-list-filters-screen.test.ts 가 그쪽을 잰다).
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * 세 파일 다 "use client" 에 서버 사슬(편집 폼 → 서버 액션 → server-only)이나
 * useUiText 를 물고 있어 이 자리에서 통째로 그릴 수 없고, 그릴 수 있다 해도 드롭다운은
 * **접힌 채로 태어나** 정적 렌더로는 목록을 못 본다(이 저장소에는 jsdom 이 없다).
 * 이웃 repair-case-multi-select-filters.test.ts · domestic-order-list-filters-screen
 * .test.ts 가 같은 사정을 같은 방법으로 푼다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 저장소의 주석은 「왜 그렇게 했는가」를 길게 적는
 * 자리라 `labelPlacement` 도 걷어낸 안내 문구도 거기 적혀 있다 — 날것으로 세면 코드를
 * 되돌려도 주석만으로 영영 통과한다(이웃 시험들과 같은 함정·같은 정규식).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석 걷어내기. 안쪽을 `[\s\S]*?` 로 적으면 다른 주석의 닫힘까지 뛰어넘어 코드를
 * 통째로 지운다 — 이웃 시험이 실제로 밟은 함정이라 같은 모양을 그대로 쓴다.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, " ") // JSX 주석 {/* … */}
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, " ") // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1"); // 줄 주석 ("https://" 는 건드리지 않는다)
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const SCREEN_PATH = "src/components/domestic-orders/DomesticOrderListScreen.tsx";
const REPAIR_PATH = "src/components/repair-cases/RepairCaseFilters.tsx";
const MISC_PATH = "src/components/misc-cases/MiscCaseFilters.tsx";

const rawScreen = read(SCREEN_PATH);
const screen = flat(withoutComments(rawScreen));
const repairFilters = flat(withoutComments(read(REPAIR_PATH)));
const miscFilters = flat(withoutComments(read(MISC_PATH)));

/**
 * `id="…"` 자리에서 **그 요소의 여는 `<`** 까지 되짚는다. 타입 인자를 적은 칸
 * (`<CheckboxFilterDropdown<Priority> id="…"`)에서는 바로 앞의 `<` 가 타입 인자의
 * 것이다 — 그쪽은 **바로 앞이 낱말 글자**라는 차이로 가른다.
 */
function openingTagStart(source: string, at: number): number {
  for (let i = at; i >= 0; i -= 1) {
    if (source[i] !== "<") continue;
    const before = i === 0 ? " " : source[i - 1];
    if (!/[\w$]/.test(before)) return i;
  }
  return -1;
}

/** 칸 하나를 그리는 `<CheckboxFilterDropdown … />` 한 덩어리만 잘라낸다. */
function fieldBlock(source: string, id: string): string {
  const at = source.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `${id} 칸을 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것`);
  const start = openingTagStart(source, at);
  assert.notEqual(start, -1, `${id} 칸의 여는 태그를 찾지 못했다`);
  const end = source.indexOf("/>", start);
  assert.notEqual(end, -1, `${id} 칸의 끝(/>)을 찾지 못했다`);
  const block = source.slice(start, end);
  assert.ok(block.includes("<CheckboxFilterDropdown"), `${id} 가 공용 부품이 아니다: ${block}`);
  return block;
}

/** 이 부품을 **먼저 쓰고 있던 일곱 칸.** 이번 변경이 건드리면 안 되는 자리다. */
const SEVEN_UNCHANGED = [
  { source: repairFilters, file: REPAIR_PATH, id: "repair-case-status" },
  { source: repairFilters, file: REPAIR_PATH, id: "repair-case-product-category" },
  { source: repairFilters, file: REPAIR_PATH, id: "repair-case-billing-type" },
  { source: repairFilters, file: REPAIR_PATH, id: "repair-case-customer" },
  { source: repairFilters, file: REPAIR_PATH, id: "repair-case-priority" },
  { source: miscFilters, file: MISC_PATH, id: "misc-case-status" },
  { source: miscFilters, file: MISC_PATH, id: "misc-case-customer" },
] as const;

/** 내자 정리의 둘. **이 둘만** 새 모양을 넘긴다. */
const TWO_INLINE = ["domestic-order-status-filter", "domestic-order-customer-filter"] as const;

// ───────────────────────────────────── ⓪ 재는 도구가 정말 듣는가

describe("🔵 재는 도구", () => {
  test("주석 걷어내기가 정말 듣는다 — 안 들으면 아래 부정 단언이 주석만으로 통과한다", () => {
    const marker = "이름표를 칸 옆에 둔다";
    assert.ok(rawScreen.includes(marker), "표지로 삼은 주석 글귀가 사라졌다 — 이 시험도 함께 고칠 것");
    assert.ok(
      !withoutComments(rawScreen).includes(marker),
      "주석이 그대로 남아 있다 — 아래 부정 단언들이 무의미해진다"
    );
    assert.ok(screen.includes('label="상태"'), "걷어내다 칸 이름까지 날렸다");
  });

  test("일곱 칸을 **일곱 다** 집었다 — 하나라도 못 집으면 아래가 공짜로 통과한다", () => {
    assert.equal(SEVEN_UNCHANGED.length, 7);
    for (const field of SEVEN_UNCHANGED) {
      const block = fieldBlock(field.source, field.id);
      assert.ok(block.length > 0, `${field.id} 덩어리를 못 잘랐다`);
      // 옆 칸이 딸려 오면 「안 넘긴다」가 엉뚱한 칸을 재게 된다.
      for (const other of SEVEN_UNCHANGED) {
        if (other.id === field.id) continue;
        assert.ok(!block.includes(`id="${other.id}"`), `${field.id} 에 ${other.id} 가 딸려 왔다`);
      }
    }
  });
});

// ───────────────────── ① 일곱 칸은 한 픽셀도 안 바뀐다

describe("🔴 ① 먼저 쓰던 일곱 칸은 그대로다", () => {
  test("🔴 일곱 칸 어느 것도 이름표 자리를 넘기지 않는다 — 기본값(칸 위)으로 그려진다", () => {
    for (const field of SEVEN_UNCHANGED) {
      assert.ok(
        !fieldBlock(field.source, field.id).includes("labelPlacement"),
        `${field.file} 의 ${field.id} 가 이름표 자리를 넘긴다 — 그 칸의 모양이 바뀐다`
      );
    }
  });

  test("🔴 두 파일 어디에도 그 낱말이 없다 — 칸 밖에서 몰래 넘기지도 않았다", () => {
    // 칸 덩어리만 보면 `{...extra}` 같은 길로 빠져나갈 수 있다. 파일 전체로 한 번 더 센다.
    assert.ok(!repairFilters.includes("labelPlacement"), `${REPAIR_PATH} 에 이름표 자리가 들어갔다`);
    assert.ok(!miscFilters.includes("labelPlacement"), `${MISC_PATH} 에 이름표 자리가 들어갔다`);
  });

  test("🔴 부품을 베낀 둘째 사본이 생기지 않았다 — 셋 다 같은 파일을 import 한다", () => {
    // 사본이 둘이면 타입이 같아 tsc 가 영영 침묵하고, 나중에 한쪽만 고쳐진다.
    for (const [path, source] of [
      [SCREEN_PATH, screen],
      [REPAIR_PATH, repairFilters],
      [MISC_PATH, miscFilters],
    ] as const) {
      assert.ok(
        source.includes('from "@/components/common/CheckboxFilterDropdown"'),
        `${path} 가 공용 부품을 안 가져다 쓴다`
      );
    }
  });
});

// ───────────────────── ② 내자 정리의 둘만 옆 모양이다

describe("🔴 ② 내자 정리만 이름표를 옆에 둔다", () => {
  test("🔴 두 칸이 옆 모양을 넘긴다", () => {
    for (const id of TWO_INLINE) {
      assert.ok(
        fieldBlock(screen, id).includes('labelPlacement="inline"'),
        `${id} 가 아직 이름표를 칸 위에 둔다 — 그 칸만 한 줄 높아진다`
      );
    }
  });

  test("🔴 이 화면에서 넘기는 자리가 그 둘뿐이다", () => {
    assert.equal(
      (screen.match(/labelPlacement=/g) ?? []).length,
      TWO_INLINE.length,
      "이름표 자리를 넘기는 칸 수가 둘이 아니다"
    );
  });
});

// ───────────────────── ③ 접히는 단위는 「이름표 + 칸」

describe("🔵 ③ 폰에서 이름표와 칸이 떨어지지 않는다", () => {
  /** `htmlFor` 로 가리키는 조작과 그 이름표를 **감싸는 상자**의 class 를 뽑는다. */
  function labelBoxClass(controlId: string, controlTag: string): string {
    const labelAt = screen.indexOf(`htmlFor="${controlId}"`);
    assert.notEqual(labelAt, -1, `${controlId} 의 이름표를 못 찾았다`);
    const labelStart = openingTagStart(screen, labelAt);
    assert.notEqual(labelStart, -1, `${controlId} 이름표의 여는 태그를 못 찾았다`);

    const controlAt = screen.indexOf(`<${controlTag} id="${controlId}"`);
    assert.notEqual(controlAt, -1, `${controlId} 조작 자체를 못 찾았다`);
    assert.ok(controlAt > labelStart, `${controlId} 의 이름표가 조작보다 뒤에 있다`);
    // 🔴 이름표와 조작 **사이에 상자가 닫히면** 둘은 각각 접힌다 — 폰에서 이름표만
    //    윗줄에 남는 것이 바로 그 모양이었다.
    assert.ok(
      !screen.slice(labelStart, controlAt).includes("</div>"),
      `${controlId} 의 이름표와 칸 사이에서 상자가 닫힌다 — 둘이 따로 접힌다`
    );

    const boxStart = screen.lastIndexOf("<div", labelStart);
    assert.notEqual(boxStart, -1, `${controlId} 를 감싸는 상자를 못 찾았다`);
    const boxTag = screen.slice(boxStart, labelStart);
    const className = (boxTag.match(/className="([^"]*)"/) ?? [])[1];
    assert.ok(className, `${controlId} 를 감싸는 상자에 class 가 없다: ${boxTag}`);
    return className;
  }

  test("🔴 검색 · 발주 년도는 이름표와 칸이 **한 상자**에 들어 있다", () => {
    for (const [id, tag] of [
      ["domestic-order-search", "input"],
      ["domestic-order-year", "select"],
    ] as const) {
      const className = labelBoxClass(id, tag);
      assert.match(className, /(^|\s)flex(\s|$)/, `${id} 묶음이 한 줄로 안 선다: ${className}`);
      assert.match(className, /items-center/, `${id} 묶음의 높이가 안 맞는다: ${className}`);
    }
  });

  test("🔴 검색 묶음은 **줄어들 수 있다** — 안 그러면 좁은 화면에서 줄을 밀어낸다", () => {
    // flex 칸의 기본값은 min-width:auto 라, 상자에 min-w-0 이 없으면 안쪽 입력칸에만
    // 적어 둔 min-w-0 이 한 겹 바깥에서 막힌다(폰에서 가로 스크롤이 생긴다).
    const className = labelBoxClass("domestic-order-search", "input");
    assert.match(className, /min-w-0/, `검색 묶음이 줄어들 수 없다: ${className}`);
  });

  test("🔵 조작 줄 자체는 **접히는 줄**로 남는다 — 억지로 한 줄에 밀어 넣지 않았다", () => {
    assert.ok(
      screen.includes('<div className="flex flex-wrap items-center gap-x-3 gap-y-2">'),
      "조작 줄의 접힘(flex-wrap)이 사라졌다"
    );
  });

  test("🔵 복수 선택 칸 둘은 **폰에서 한 치수 작다** — 같은 성질을 두 번 적지 않았다", () => {
    for (const id of TWO_INLINE) {
      const at = screen.indexOf(`id="${id}"`);
      const boxStart = screen.lastIndexOf("<div", at);
      assert.notEqual(boxStart, -1, `${id} 를 감싸는 상자를 못 찾았다`);
      const className = (screen.slice(boxStart, at).match(/className="([^"]*)"/) ?? [])[1];
      assert.ok(className, `${id} 를 감싸는 상자에 class 가 없다`);

      const base = className.match(/(?:^|\s)w-(\d+)(?:\s|$)/g) ?? [];
      assert.equal(
        base.length,
        1,
        `${id} 의 기본 폭이 ${base.length} 개다 — 같은 성질을 두 번 적으면 class 차례가 아니라 생성된 CSS 차례가 이긴다: ${className}`
      );
      const baseWidth = Number(/(\d+)/.exec(base[0])?.[1]);
      const wide = Number(/(?:^|\s)sm:w-(\d+)(?:\s|$)/.exec(className)?.[1]);
      assert.ok(Number.isFinite(wide), `${id} 에 넓은 화면용 폭이 없다: ${className}`);
      assert.ok(
        baseWidth < wide,
        `${id} 의 폰 폭이 넓은 화면보다 작지 않다(${baseWidth} / ${wide}): ${className}`
      );
      // 폭이 글자에 따라 늘었다 줄었다 하면 옆의 조작들이 함께 밀린다.
      assert.match(className, /shrink-0/, `${id} 의 폭이 못 박혀 있지 않다: ${className}`);
    }
  });
});

// ───────────────────── ④ 걷어낸 안내 둘 (2026-11-18 사용자 요구)

describe("🔴 ④ 걷어낸 안내가 되살아나지 않았다", () => {
  test("🔴 납품일 안내 문단이 표 위에서 사라졌다 — 그리던 조건까지 함께", () => {
    assert.ok(
      !/>\s*\{DOMESTIC_ORDER_DELIVERED_DATE_NOTE\}/.test(screen),
      "납품일 안내가 다시 화면 글자로 섰다"
    );
    assert.ok(!screen.includes("showDeliveredDateNote"), "그 문단만 그리던 조건이 남아 있다");
  });

  test("🔴 **글자만 걷었다** — 같은 설명이 칸에 닿으면 뜨는 자리는 그대로다", () => {
    // 상수도 그대로이고(여러 화면이 함께 쓴다), 이 화면에서는 표 머리말 둘과 카드
    // 이름표 둘이 그 글자를 title 로 받는다. 그쪽까지 지우면 납품일이 왜 빈칸일 수
    // 있는지 아는 자리가 통째로 사라진다.
    assert.equal(
      (screen.match(/title=\{DOMESTIC_ORDER_DELIVERED_DATE_NOTE\}/g) ?? []).length,
      2,
      "납품일 · 납품자 머리말의 설명이 사라졌다"
    );
    assert.equal(
      (screen.match(/hint: DOMESTIC_ORDER_DELIVERED_DATE_NOTE/g) ?? []).length,
      2,
      "카드 이름표의 설명이 사라졌다"
    );
  });

  test("🔴 주황 안내(「발주일 미정 N건」)는 **그대로다** — 지우라고 한 둘에 없었다", () => {
    assert.ok(
      screen.includes("{alwaysVisibleCount}건은 어느 년도를 골라도 함께 보입니다."),
      "발주일 미정 안내가 함께 사라졌다"
    );
    assert.match(
      screen,
      /const showAlwaysVisibleNote = alwaysVisibleCount > 0 && years\.length > 0 && !isSearching;/
    );
  });

  test("🔵 안내 묶음은 **둘 다 안 적힐 때 상자째** 빠진다 — 빈 상자가 줄을 차지하지 않게", () => {
    assert.ok(
      screen.includes("{(showAlwaysVisibleNote || showOrderIssuedSortNote) && ("),
      "안내 묶음의 조건이 남은 둘과 맞지 않는다"
    );
  });
});
