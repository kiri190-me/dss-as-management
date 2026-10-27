import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detailEditButtonClass, inlineEditButtonAlignClass } from "./edit-button-class";

/**
 * ============================================================================
 * 수리 건 상세의 [수정] 단추가 **한 벌을 같이 입는가** (2026-10-19)
 * ============================================================================
 * 2026-10-19 사용자 결정: 「[수정] 단추에 박스를 씌워 단추임이 보이게 한다 · 글자
 * 굵기는 font-semibold」. 그 전까지 이 일곱 자리는 테두리도 배경도 없는
 * `text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400` 글자였고,
 * 그 **똑같은 글자가 일곱 파일에 복사**되어 있었다. 복사가 갈래를 가른다 — 한 곳만
 * 고쳐지는 날이 반드시 온다. 그래서 `edit-button-class.ts` 한 곳으로 모았고, 이
 * 시험이 그 한 곳을 지킨다.
 *
 * 이 일곱은 서버 액션을 부르는 화면 조각이라 여기서 그려 볼 수 없다(이웃
 * `used-parts-section.test.ts` · `detail-header-placement.test.ts` 와 같은 사정).
 * 그래서 **원본 글자**를 읽어 본다 — 본보기는 이제 같은 폴더의
 * `part-request-section-wiring.test.ts` 다(2026-10-27 에 `components/inventory/` 에서 이리로
 * 옮겨 왔다 — 옛 재고 화면을 걷어내면서 그 폴더에 섞여 있던 새 코드만 건져 냈다).
 *
 * 붙잡는 것 넷:
 *  ㉠ 상수가 **박스 한 벌**이다 — 테두리 · 안쪽 여백 · font-semibold.
 *  ㉡ 일곱 파일이 전부 그 상수를 쓴다 — className 에 글자를 다시 적지 않는다.
 *  ㉢ 일곱 어디에도 `hover:underline` 이 남아 있지 않다(박스가 된 뒤의 밑줄은
 *     링크처럼도 단추처럼도 안 보인다).
 *  ㉣ **값 옆 글줄에 끼인 둘**에는 세로 정렬 클래스가 더 붙어 있다. 그 둘만
 *     `담당자이름 [수정]` 처럼 값과 한 줄에 서므로, 박스가 글줄보다 높아지면
 *     위아래로 떠 보인다.
 * ============================================================================
 */

const DIR = "src/components/repair-cases/detail";

/** 구역 제목 줄에서 <h2> 와 나란히 서는 다섯. */
const HEADER_FILES = [
  `${DIR}/UsedPartsSection.tsx`,
  `${DIR}/ProductInfoSection.tsx`,
  `${DIR}/IntakeInfoSection.tsx`,
  `${DIR}/FaultServiceSection.tsx`,
  `${DIR}/DomesticOrderDatesSection.tsx`,
] as const;

/** 🔴 값 옆 글줄에 **끼어** 서는 둘. 정렬 클래스를 더 입는다. */
const INLINE_FILES = [
  `${DIR}/edit/ReportNumberEditCell.tsx`,
  `${DIR}/edit/EngineerEditCell.tsx`,
] as const;

const ALL_FILES = [...HEADER_FILES, ...INLINE_FILES];

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("🔴 [수정] 단추의 옷 — 상수 한 벌", () => {
  test("박스다 — 테두리 · 안쪽 여백 · 둥근 모서리가 다 있다", () => {
    for (const token of ["rounded-md", "border", "border-zinc-300", "px-2", "py-1"]) {
      assert.ok(
        detailEditButtonClass.split(" ").includes(token),
        `${token} 이 없다 — ${detailEditButtonClass}`
      );
    }
  });

  test("글자 굵기는 font-semibold 다(2026-10-19 사용자 결정)", () => {
    assert.ok(detailEditButtonClass.split(" ").includes("font-semibold"), detailEditButtonClass);
    assert.ok(!detailEditButtonClass.includes("font-medium"), detailEditButtonClass);
  });

  test("🔴 밑줄은 없다 — 박스 안이 밝아지는 것으로 충분하다", () => {
    assert.ok(!detailEditButtonClass.includes("underline"), detailEditButtonClass);
    assert.ok(detailEditButtonClass.includes("hover:bg-zinc-100"), detailEditButtonClass);
  });

  test("어두운 화면 짝이 함께 있다", () => {
    for (const token of ["dark:border-zinc-700", "dark:text-zinc-300", "dark:hover:bg-zinc-800"]) {
      assert.ok(detailEditButtonClass.split(" ").includes(token), token);
    }
  });
});

describe("🔴 일곱이 그 상수를 쓴다 — 글자를 다시 적지 않는다", () => {
  for (const path of ALL_FILES) {
    test(`${path} 이 detailEditButtonClass 를 끌어와 className 에 쓴다`, () => {
      const code = source(path);
      assert.match(
        code,
        /import \{[^}]*detailEditButtonClass[^}]*\} from "(?:\.\.\/|\.\/|@\/components\/repair-cases\/detail\/)edit-button-class";/,
        `${path} 이 상수를 끌어오지 않는다`
      );
      assert.match(
        code,
        /className=\{(?:detailEditButtonClass|`\$\{detailEditButtonClass\}[^`]*`)\}/,
        `${path} 의 className 이 상수를 쓰지 않는다`
      );
    });

    test(`${path} 에 hover:underline 이 남아 있지 않다`, () => {
      assert.ok(!source(path).includes("hover:underline"), `${path} 에 밑줄이 남았다`);
    });

    test(`${path} 에 옛 글자뿐인 옷이 남아 있지 않다`, () => {
      assert.ok(
        !source(path).includes("text-xs font-medium text-zinc-600"),
        `${path} 에 옛 className 이 남았다`
      );
    });
  }
});

describe("🔴 값 옆에 끼인 둘 — 세로 정렬 클래스가 더 붙는다", () => {
  test("정렬 상수는 실제로 일하는 self-center 하나다", () => {
    const tokens = inlineEditButtonAlignClass.split(" ");
    assert.ok(tokens.includes("self-center"), inlineEditButtonAlignClass);
    // 🔴 `align-middle`(vertical-align)은 flex 항목에 듣지 않는다. 넣어 두면 읽는
    // 사람이 그것이 정렬을 잡고 있다고 믿고, 나중에 빼면 아무 일도 안 하는 것
    // 때문에 시험이 깨진다. 안 듣는 클래스를 단언으로 굳히지 않는다.
    assert.ok(!inlineEditButtonAlignClass.includes("align-middle"), inlineEditButtonAlignClass);
  });

  for (const path of INLINE_FILES) {
    test(`${path} 이 공통 옷 + 정렬 클래스를 함께 입는다`, () => {
      const code = source(path);
      assert.match(
        code,
        /import \{[^}]*inlineEditButtonAlignClass[^}]*\} from "\.\.\/edit-button-class";/,
        `${path} 이 정렬 상수를 끌어오지 않는다`
      );
      assert.match(
        code,
        /className=\{`\$\{detailEditButtonClass\} \$\{inlineEditButtonAlignClass\}`\}/,
        `${path} 이 둘을 함께 쓰지 않는다`
      );
    });
  }

  for (const path of HEADER_FILES) {
    test(`${path} 은 정렬 클래스를 쓰지 않는다 — 제목 줄은 부모가 맞춘다`, () => {
      assert.ok(
        !source(path).includes("inlineEditButtonAlignClass"),
        `${path} 에 끼인 자리의 클래스가 번졌다`
      );
    });
  }
});
