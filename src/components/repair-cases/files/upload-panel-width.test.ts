import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  attachmentCategoriesForOwner,
  attachmentCategoryLabels,
} from "@/lib/domain/attachment-category";

/**
 * ============================================================================
 * [파일 올리기] 패널이 제 상자 안에 들어오는가 (2026-11-18 폰 신고)
 * ============================================================================
 * 사용자가 안드로이드 크롬으로 수리 건 상세 [파일 관리]를 열고 보낸 것: 점선 테두리
 * **안**에 있어야 할 「분류」 드롭다운과 「파일」 칸이 그 선을 넘어 오른쪽으로 삐져나와
 * 있었다. 요청은 「드롭다운의 가로폭을 조절해 줘」.
 *
 * 까닭은 두 겹이다(FilesScreen.tsx 의 같은 자리 주석):
 *  · 두 칸을 감싼 `<label>` 은 grid 칸이고, grid·flex 칸의 기본값은 `min-width: auto`
 *    라 **속의 최소 폭보다 좁아지지 못한다.**
 *  · 속의 `<select>` · `<input type="file">` 은 제 내용만큼을 최소 폭으로 들고 있다 —
 *    분류는 가장 긴 이름(아래에서 값으로 잰다), 고르기 칸은 브라우저가 제 손으로
 *    그리는 「파일 선택 선택된 파일 없음」이다.
 * 그래서 고친 것도 두 겹이다 — 칸에 `min-w-0`, 속에 `max-w-full`.
 *
 * ── 🔴 이 시험이 할 수 있는 것과 없는 것 ────────────────────────────────────
 * **폭은 눈으로만 보인다.** 이 저장소의 화면 시험은 DOM 도 Tailwind 도 없이 돌아서
 * 「375px 에서 넘치는가」를 여기서 잴 길이 없다. 그러니 이 파일이 막는 것은 **고친
 * 것이 도로 빠지는 일**뿐이다: 네 자리에 폭 클래스가 남아 있는가, 그리고 🔴 **넓은
 * 화면의 두 칸 배치(`sm:grid-cols-2`)가 그대로인가** — 신고는 좁은 화면 하나였고,
 * 넓은 화면에서 드롭다운이 칸 끝까지 늘어나는 것도 똑같이 「바뀐 것」이다. 진짜 확인은
 * 폰으로 그 화면을 여는 일이다.
 *
 * ── 🔴 여기서 다시 재지 않는 것 ─────────────────────────────────────────────
 * 바로 앞 조각(heic)이 놓은 `accept={acceptAttribute}` 배선은 heic-upload.test.ts 가
 * 이미 못박고 있다(「고르는 칸이 계산된 accept 를 그대로 쓴다」 · 「고르는 칸이 안
 * 잠긴다」). 같은 것을 두 파일에 적으면 고친 사람이 한쪽만 고치고 지나간다. 다만
 * **heic 안내 줄이 화면에 그려지는지**는 아무도 안 보고 있었고, 이번에 폭을 건드린
 * 자리가 바로 그 줄이 든 라벨이라 그것만 여기서 본다.
 * ============================================================================
 */

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 지운다. 🔴 이 화면은 고친 까닭을 주석에 **클래스 이름까지 적어** 두었으므로,
 * 글자를 그냥 세면 클래스를 도로 빼도 주석 한 줄에 시험이 통과한다.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** `from` 이 나오는 자리부터 그 뒤 첫 `to` 까지. 못 찾으면 빈 글자다(표본 검사가 잡는다). */
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  if (start < 0) return "";
  const end = source.indexOf(to, start);
  return end > start ? source.slice(start, end) : "";
};

/** 낱말로 갈라 본다 — `max-w-full` 이 `sm:max-w-full` 같은 이웃에 걸리지 않게. */
const hasClass = (classNames: string, name: string) => classNames.split(/\s+/).includes(name);

const classNameIn = (block: string) => block.match(/className="([^"]*)"/)?.[1] ?? "";

const screen = withoutComments(read("FilesScreen.tsx"));

/**
 * [파일 올리기] 패널의 **점선 상자 안**. 🔴 이 조각 밖은 이번 신고가 아니다 — 같은
 * 화면의 목록·공유폴더 구역까지 넓히면 이 시험이 무엇을 지키는지 흐려진다.
 */
const zoneStart = screen.indexOf(`name="repair-case-files-upload"`);
const zone = between(screen, `name="repair-case-files-upload"`, "</FileDropZone>");

/** 상자 안의 라벨 둘 — 왼쪽이 분류, 오른쪽이 파일이다(좁은 화면에서는 위아래). */
const labelClassNames = [...zone.matchAll(/<label className="([^"]*)"/g)].map((match) => match[1]);

/** 폭을 가진 칸 둘. `<select>` 의 여는 태그에는 화살표 함수의 `>` 가 들어 있어 닫는
 *  태그까지 통째로 잘라 그 안의 첫 className 을 읽는다. */
const FIELDS = [
  { name: "분류 드롭다운", classNames: classNameIn(between(zone, "<select", "</select>")) },
  { name: "파일 고르기 칸", classNames: classNameIn(between(zone, "ref={fileInputRef}", "/>")) },
] as const;

/** 폭을 칸에 맡기는 길은 하나가 아니다 — 둘 중 **무엇이든** 하나는 있어야 한다. */
const WIDTH_CLASSES = ["max-w-full", "w-full"] as const;

describe("🔵 재는 자리를 제대로 집었는가 — 표본이 비면 아래가 전부 공짜로 통과한다", () => {
  test("점선 상자 안을 잘라 냈다", () => {
    assert.ok(zoneStart >= 0, "FileDropZone 의 자리 이름(repair-case-files-upload)이 바뀌었다");
    assert.ok(zone.length > 400, `잘라 낸 것이 너무 짧다 — ${zone.length}자`);
    assert.ok(zone.includes(">분류<"), "「분류」 칸이 이 상자 안에 없다");
    assert.ok(zone.includes("파일 (여러 개 선택 가능)"), "「파일」 칸이 이 상자 안에 없다");
  });

  test("상자 안의 라벨은 둘이다 — 하나가 늘면 그 칸의 폭도 함께 봐야 한다", () => {
    assert.equal(labelClassNames.length, 2, `라벨이 ${labelClassNames.length}개다: ${labelClassNames.join(" / ")}`);
  });

  test("폭을 재는 칸 둘의 className 을 둘 다 찾았다", () => {
    for (const field of FIELDS) {
      assert.ok(field.classNames.length > 0, `${field.name}의 className 을 못 찾았다`);
    }
  });
});

describe("🔴 좁은 화면 — 두 칸이 점선 상자를 넘지 않는다", () => {
  test("감싼 칸이 줄어들 수 있다 — grid 칸의 min-width: auto 를 푼다", () => {
    for (const [index, classNames] of labelClassNames.entries()) {
      assert.ok(
        hasClass(classNames, "min-w-0"),
        `${index + 1}번째 라벨에 min-w-0 이 없다 — 속이 넓으면 칸 자체가 안 줄어들어 ` +
          `속에 폭을 줘도 안 풀린다: ${classNames}`
      );
    }
  });

  for (const field of FIELDS) {
    test(`${field.name}이 폭을 제 마음대로 정하지 않는다`, () => {
      assert.ok(
        WIDTH_CLASSES.some((name) => hasClass(field.classNames, name)),
        `${field.name}에 폭 클래스(${WIDTH_CLASSES.join(" · ")})가 없다 — 내용만큼 넓어져 ` +
          `점선 테두리를 넘는다: ${field.classNames}`
      );
    });
  }
});

describe("🔴 넓은 화면은 건드리지 않았다 — 신고는 좁은 화면 하나였다", () => {
  test("점선 상자는 여전히 sm: 에서 두 칸이다", () => {
    const zoneClassNames = classNameIn(zone);
    assert.ok(
      hasClass(zoneClassNames, "sm:grid-cols-2"),
      `넓은 화면의 두 칸 배치가 사라졌다: ${zoneClassNames}`
    );
    assert.ok(
      hasClass(zoneClassNames, "border-dashed"),
      `점선 테두리가 사라졌다 — 「넘었는지」를 눈으로 가늠할 선이 그것이다: ${zoneClassNames}`
    );
  });

  test("🔴 넓은 화면에서 폭을 새로 **정하지** 않는다 — w-full 을 쓰려면 sm: 에서 되돌려야 한다", () => {
    for (const field of FIELDS) {
      if (!hasClass(field.classNames, "w-full")) continue;
      assert.ok(
        hasClass(field.classNames, "sm:w-auto"),
        `${field.name}: w-full 은 넓은 화면에서도 칸 끝까지 늘린다 — 지금 모습이 아니다. ` +
          `넘치는 것만 막으려면 max-w-full 이다: ${field.classNames}`
      );
    }
  });
});

describe("🔵 왜 넘쳤나 — 드롭다운에 실리는 이름을 값으로 재 둔다", () => {
  const names = attachmentCategoriesForOwner("REPAIR_CASE").map(
    (code) => attachmentCategoryLabels[code]
  );

  test("이름은 공용 목록에서 온다 — 이 칸의 폭을 정하는 것이 그 목록이다", () => {
    assert.ok(names.length >= 15, `수리 건이 쓰는 분류가 ${names.length}개뿐이다 — 목록을 잘못 집었다`);
    assert.ok(zone.includes("REPAIR_CASE_UPLOAD_CATEGORIES.map("), "드롭다운이 공용 목록을 돌지 않는다");
    assert.ok(zone.includes("attachmentCategoryLabels[code]"), "이름을 다른 데서 가져온다");
  });

  test("가장 긴 이름이 열 글자가 넘는다 — 폰 한 줄에서 이 칸이 넓어지는 까닭", () => {
    const longest = names.reduce((left, right) => (right.length > left.length ? right : left));
    assert.ok(
      longest.length >= 10,
      `가장 긴 분류 이름이 「${longest}」(${longest.length}자)다 — 짧아졌다면 이 시험의 까닭을 다시 적어라`
    );
  });
});

/**
 * 🔴 **2026-11-18 에 이 자리의 뜻이 뒤집혔다.** 폭을 고친 그날 저녁, 사용자가 같은
 * 패널의 안내 문구 셋을 「없어도 될 것 같아」로 걷어내라고 했다 — 그중 하나가 바로
 * 여기서 「그대로 있는가」를 재던 heic 안내 줄이다. 시험을 느슨하게 지우지 않고
 * **같은 강도로 반대쪽**을 못박는다: 이제 그 줄은 **없어야 한다**.
 */
describe("🔴 고르기 칸 아래 안내 줄은 없앴다 — 기능이 아니라 글자만 지운 자리다", () => {
  /** 고르기 칸 라벨 — 안내 줄이 그 안에 있었다. */
  const fileLabel = zone.slice(zone.indexOf("파일 (여러 개 선택 가능)"));

  test("표본: 고르기 칸 라벨을 제대로 잘랐다 — 못 자르면 아래가 공짜로 통과한다", () => {
    assert.ok(zone.includes("파일 (여러 개 선택 가능)"), "고르기 칸 라벨을 못 찾았다");
    assert.ok(fileLabel.includes("ref={fileInputRef}"), "자른 것이 고르기 칸 라벨이 아니다");
    // 남아 있어야 하는 안내 한 줄(끌어다 놓기)은 그대로다 — 「라벨 안의 글이 전부
    // 사라졌다」가 아니라 **heic 줄만** 사라진 것이어야 한다.
    assert.ok(fileLabel.includes("폴더에서 이 칸 위로 끌어다 놓아도 됩니다."), "끌어다 놓기 안내까지 사라졌다");
  });

  test("🔴 heic 안내 줄이 화면에서 사라졌다", () => {
    assert.ok(!fileLabel.includes("HEIC_PICKER_HINT"), "안내 줄이 그대로 있다");
    assert.ok(
      !fileLabel.includes("원본 heic 는 남지 않습니다"),
      "안내 글귀를 화면에 손으로 옮겨 적었다"
    );
    assert.ok(!zone.includes("아이폰 사진("), "상자 어딘가에 아이폰 사진 안내가 남아 있다");
  });

  test("🔴 지운 것은 글자뿐이다 — heic 를 고를 수 있는 길(accept)은 그대로다", () => {
    assert.ok(
      fileLabel.includes("accept={acceptAttribute}"),
      "고르기 칸이 계산된 accept 를 안 쓴다 — heic 가 고르는 창에서 사라진다"
    );
    // 사진을 받는 분류인지 보는 값 자체는 화면에 그대로 있어야 한다. 변환을 거는
    // 조건(`!fromCamera && takesPhotos`)이 그것을 쓴다 — heic-upload.test.ts 가 잰다.
    assert.ok(screen.includes("const takesPhotos ="), "takesPhotos 판정이 사라졌다");
  });
});
