import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * [기타건 현황]의 **두 필터가 복수 선택 칸인가** (2026-11-11)
 * ============================================================================
 * 사용자 개선요청: 「[전체 A/S 현황]·[기타건 현황]에서 한 종류의 필터 안에서
 * 복수로 선택」. 일곱 칸 가운데 **마지막 둘**(상태 · 공급처)이 이 파일의 몫이고,
 * [전체 A/S 현황]의 다섯은 이웃
 * repair-cases/repair-case-multi-select-filters.test.ts 가 본다 — 그 파일을
 * 본보기로 베꼈다(자르는 도구와 ⓪ 절까지).
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * 복수 선택 칸은 **접힌 채로 태어나고**(useState(false)) 이 저장소에는 jsdom 이
 * 없어 정적 렌더로는 펼친 목록을 못 본다. 그려서 잴 수 있는 것(닫힌 칸의 글자 ·
 * <select> 가 안 남았는가)은 misc-case-list-screens.test.tsx 가 실제로 그려서
 * 재고, 여기서 보는 것은 **선택지를 어디서 뽑고 값을 어느 칸에서 읽는가**다.
 *
 * 🔴 **값으로 도는 부분은 여기서 재지 않는다.** 거르는 규칙(빈 배열 = 전체 · 한
 * 종류 안에서 합집합 · 「미지정」)은 lib/domain/misc-case-list.test.ts 가, 닫힌
 * 칸의 글자와 체크 뒤집기는 components/common/checkbox-filter-dropdown.test.ts 가
 * 잰다. 여기서 보는 것은 **화면이 그 부품을 실제로 그렇게 쓰는가**뿐이다 — 값 쪽
 * 시험이 전부 통과한 채로 화면만 <select> 로 되돌아가면 사용자가 보는 것은 전과
 * 똑같아지는데, 되돌리는 쪽은 **시험이 줄어드는 것으로도 안 드러난다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 주석을 걷어낸 뒤에 센다. 이 저장소의 화면 파일은 "왜 그렇게 했는가"를 길게
 * 적는 자리라 `<select>` 도 "미지정" 도 거기 적혀 있다 — 날것으로 세면 코드를
 * 되돌려도 주석만으로 영영 통과한다. 걷어내기가 정말 듣는지는 아래 ⓪ 에서 먼저
 * 잰다(정규식은 본보기 파일과 같은 모양이다 — 안쪽을 `[\s\S]*?` 로 적으면 다른
 * 주석의 닫힘까지 뛰어넘어 코드를 통째로 지운다).
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, " ") // JSX 주석 {/* … */}
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, " ") // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1"); // 줄 주석 ("https://" 는 건드리지 않는다)
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const filtersSource = read("src/components/misc-cases/MiscCaseFilters.tsx");
const screenSource = read("src/components/misc-cases/MiscCaseListScreen.tsx");

const strippedFilters = flat(withoutComments(filtersSource));
const strippedScreen = flat(withoutComments(screenSource));

/**
 * `id="…"` 자리에서 **그 요소의 여는 `<`** 까지 되짚는다.
 *
 * 🔴 그냥 바로 앞의 `<` 를 잡으면 안 된다 — 타입 인자를 적은 칸
 * (`<CheckboxFilterDropdown<MiscCaseStatus> id="misc-case-status" …`)에서는 그것이
 * `<MiscCaseStatus>` 의 `<` 다. 타입 인자의 `<` 는 **바로 앞이 낱말 글자**이고,
 * 여는 태그의 `<` 는 공백이나 `{` 뒤에 온다. 그 차이로 가른다.
 */
function openingTagStart(at: number): number {
  for (let i = at; i >= 0; i -= 1) {
    if (strippedFilters[i] !== "<") continue;
    const before = i === 0 ? " " : strippedFilters[i - 1];
    if (!/[\w$]/.test(before)) return i;
  }
  return -1;
}

/**
 * 칸 하나를 그리는 `<CheckboxFilterDropdown … />` 한 덩어리만 잘라낸다. 넉넉히
 * 잘라 보면 **옆 칸까지 딸려 들어와** 무엇을 재는지 알 수 없게 된다.
 */
function fieldBlock(id: string): string {
  const at = strippedFilters.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `${id} 칸을 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것`);
  const start = openingTagStart(at);
  assert.notEqual(start, -1, `${id} 칸의 여는 태그를 찾지 못했다`);
  const end = strippedFilters.indexOf("/>", start);
  assert.notEqual(end, -1, `${id} 칸의 끝(/>)을 찾지 못했다`);
  const block = strippedFilters.slice(start, end);
  assert.ok(block.length > 0, `${id} 덩어리를 못 잘랐다 — 아래 단언이 공짜로 통과한다`);
  return block;
}

/** 이번 조각이 바꾼 두 칸 — 일곱 중 마지막 둘이다. */
const TWO_FIELDS = [
  { id: "misc-case-status", label: "상태", selected: "filters.statuses" },
  { id: "misc-case-customer", label: "공급처", selected: "filters.customerNames" },
] as const;

// ───────────────────────────────────── ⓪ 재는 도구가 정말 듣는가

describe("🔵 재는 도구", () => {
  test("주석 걷어내기가 정말 듣는다 — 안 들으면 아래가 주석만으로 통과한다", () => {
    assert.ok(
      filtersSource.includes("단축 단추(shortcut)는 둘 다 주지 않는다"),
      "표지로 삼은 주석 글귀가 사라졌다 — 이 시험도 함께 고칠 것"
    );
    assert.ok(
      !withoutComments(filtersSource).includes("단축 단추(shortcut)는 둘 다 주지 않는다"),
      "주석이 그대로 남아 있다 — 아래 부정 단언들이 무의미해진다"
    );
    assert.ok(strippedFilters.includes("상태"), "걷어내다 칸 이름까지 날렸다");
    assert.ok(strippedFilters.includes("공급처"), "걷어내다 칸 이름까지 날렸다");
  });

  test("칸 덩어리 자르기가 칸 하나에서 끝난다 — 옆 칸이 딸려 오지 않는다", () => {
    // 덩어리가 넘치면 "상태 칸에 공급처 값이 들어 있다"는 식으로 아무 단언이나
    // 통과한다. 제 label 만 있고 남의 label 은 없는지로 잰다.
    for (const field of TWO_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(block.includes(`label="${field.label}"`), `${field.id} 에 제 이름이 없다`);
      for (const other of TWO_FIELDS) {
        if (other.id === field.id) continue;
        assert.ok(
          !block.includes(`label="${other.label}"`),
          `${field.id} 덩어리에 ${other.label} 칸이 딸려 들어왔다`
        );
      }
    }
  });
});

// ───────────────────── ① 두 칸이 모두 복수 선택 부품을 쓴다

describe("🔴 두 칸이 복수 선택 칸이다", () => {
  test("공용 부품을 가져다 쓴다 — 이 화면에 따로 만들지 않았다", () => {
    assert.match(
      filtersSource,
      /^import CheckboxFilterDropdown from "@\/components\/common\/CheckboxFilterDropdown";$/m
    );
  });

  test("둘 다 <CheckboxFilterDropdown> 이고, 고른 값을 배열 칸에서 읽는다", () => {
    for (const field of TWO_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(block.includes("<CheckboxFilterDropdown"), `${field.id} 가 복수 선택 칸이 아니다`);
      assert.ok(
        block.includes(`selected={${field.selected}}`),
        `${field.id} 가 ${field.selected} 를 읽지 않는다`
      );
    }
  });

  test("🔴 한 번에 하나만 고르던 <select> 가 한 칸도 남지 않았다", () => {
    // 되돌리는 쪽은 "시험이 줄어드는 것"으로도 안 드러난다 — 값 쪽 시험은 전부
    // 통과한 채로 화면만 예전으로 돌아간다.
    assert.ok(!strippedFilters.includes("<select"), "거르개에 <select> 가 되살아났다");
    assert.ok(!strippedFilters.includes("<option"), "거르개에 <option> 이 되살아났다");
    assert.ok(
      !strippedFilters.includes('value="ALL"'),
      "「전체」가 다시 고르는 값이 되었다 — 이제는 빈 배열이 「전체」다"
    );
  });

  test("🔴 두 칸에는 단축 단추를 주지 않는다 — 그건 [전체 A/S 현황]의 [현재 상태] 하나뿐이다", () => {
    for (const field of TWO_FIELDS) {
      assert.ok(
        !fieldBlock(field.id).includes("shortcut="),
        `${field.id} 에 단축 단추가 붙었다 — 미리 정해진 묶음이 있는 것은 [현재 상태]뿐이다`
      );
    }
  });
});

// ───────────────────── ② 선택지를 어디서 뽑는가

describe("🔴 선택지의 출처", () => {
  test("상태는 **흐름의 순서**로 선 상수에서 뽑는다 — 손으로 적지 않는다", () => {
    // 이름순으로 세우면 단계를 거꾸로 읽고, 손으로 적어 두면 상태가 하나 느는 날
    // 그 값이 아무 소리 없이 이 칸에서만 빠진다.
    assert.match(fieldBlock("misc-case-status"), /options=\{MISC_CASE_STATUS_ORDER\.map\(/);
  });

  test("공급처는 **받은 명단을 그대로** 넘긴다 — 이 화면이 만들지 않는다", () => {
    // 그 명단은 거르기 전의 줄에서 뽑은 것이고(collectMiscCaseCustomerOptions),
    // 거른 뒤의 줄에서 뽑으면 한 공급처를 고르는 순간 다른 이름이 선택지에서
    // 사라져 되돌릴 수 없다. 어느 배열을 넘기는지는
    // misc-case-list-screens.test.tsx 가 원본 글자로 함께 못 박는다.
    assert.match(fieldBlock("misc-case-customer"), /options=\{customerOptions\}/);
  });

  test("🔴 「미지정」 줄도 이 화면이 적지 않는다 — 도메인이 붙여 보낸다", () => {
    // 여기에 손으로 한 줄 더 적으면, 빈 공급처가 하나도 없는 날에도 눌러서 늘
    // 0건인 칸이 선다(도메인이 그 판단을 하고 있다).
    assert.ok(!strippedFilters.includes('"NONE"'), "화면이 미지정 값을 직접 적었다");
    assert.ok(!strippedFilters.includes("미지정"), "화면이 미지정 글자를 직접 적었다");
  });
});

// ───────────────────── ③ 목록 화면이 그 값을 필터에 넣는가

describe("🔴 목록 화면의 배선", () => {
  test("두 칸의 onChange 가 배열 칸을 그대로 고친다", () => {
    for (const [prop, field] of [
      ["onStatusesChange", "statuses"],
      ["onCustomerNamesChange", "customerNames"],
    ] as const) {
      assert.ok(
        strippedScreen.includes(`${prop}={(value) => updateFilters({ ${field}: value })}`),
        `${prop} 가 ${field} 로 이어지지 않았다`
      );
    }
  });

  test("🔴 값 하나를 넘기던 옛 프롭 이름이 남아 있지 않다", () => {
    // 이름만 남고 아무 데도 안 닿는 프롭은 tsc 가 잡아 주지만, 두 화면 중 한쪽에만
    // 남으면 "안 쓰이는 줄" 로 조용히 산다.
    for (const stale of ["onStatusChange", "onCustomerNameChange"]) {
      assert.ok(!strippedScreen.includes(stale), `목록 화면에 옛 프롭 ${stale} 이 남아 있다`);
      assert.ok(!strippedFilters.includes(stale), `거르개에 옛 프롭 ${stale} 이 남아 있다`);
    }
  });
});
