import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  IDENTITY_TRANSFORM,
  NO_PICKS,
  isPickedId,
  orientationCss,
  setPickedIds,
  thumbnailOrientationOf,
  thumbnailTransformCss,
  viewerTransformCss,
  type PickedOrientations,
} from "./AttachmentViewer";
import { planRangeToggle } from "@/lib/domain/range-selection";
import { IDENTITY_ORIENTATION, type ImageOrientation } from "@/lib/domain/image-orientation";

/**
 * ============================================================================
 * 크게 보기의 **아래 썸네일 줄** — 미리 돌아 보이고, Shift 로 사이를 고른다
 * ============================================================================
 * 2026-09-29 사용자 요청으로 이 줄에 둘이 더해졌다. 둘 다 **보이는 것과 고르는
 * 방식**만 바꾼다 — 파일도, 저장하는 길도, 서버도 건드리지 않는다.
 *
 *  1. **돌리면 그 썸네일도 바로 돈다**(저장 전 미리보기). 지금까지는 저장해야
 *     새 방향이 보였다. 여러 장을 골라 한꺼번에 돌리는 길이 생긴 뒤로는
 *     **무엇을 어느 방향으로 저장하려는 것인지 누르기 전에 눈으로 세는** 일이
 *     그만큼 중요해졌다.
 *  2. **클릭 → Shift+클릭으로 사이를 전부 고른다**(파일 탐색기와 같은 손).
 *
 * 🔴 여기서 못박는 것 — 대부분 「되는가」가 아니라 **「넘어오면 안 되는 것이
 * 안 넘어오는가」** 다:
 *
 *  · **썸네일은 방향만 받는다.** 배율(scale)·이동(translate)까지 걸리면 8배로
 *    키워 둔 순간 56px 칸을 뚫고 나간다. 방향 CSS 를 만드는 자리가 **크게 보기와
 *    같은 함수 하나**(orientationCss)라 규칙이 갈라질 수 없다.
 *  · **어느 칸에 어느 방향을 거는가** — 고른 것은 각자의 방향, 지금 보는 한 장은
 *    화면 방향, 그 밖에는 없음.
 *  · **Shift 는 더해지는 길이지 대신하는 길이 아니다.** 폰에는 Shift 가 없으므로
 *    한 장씩 누르던 동작이 한 글자도 달라지면 안 된다.
 *  · **규칙을 새로 적지 않았다.** 이 시스템의 목록 여덟 곳이 이미 쓰는 공용 규칙
 *    (lib/domain/range-selection.ts)을 그대로 지나간다 — 화면마다 따로 적으면
 *    「여기서는 끄기도 번지는데 저기서는 켜기만 번지는」 차이가 생긴다.
 *
 * 뷰어의 「고르기」와 방향은 **안쪽 상태**라 인자로 「돌려 놓고 골라 둔 화면」을
 * 만들 길이 없다. 그래서 판정은 순수 함수로 부르고, 화면이 그 판정을 실제로
 * 쓰는지는 원본을 글자로 읽는다(이웃 attachment-multi-rotate.test.tsx 와 같은 방법).
 * ============================================================================
 */

const viewerSource = readFileSync(new URL("./AttachmentViewer.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** 주석을 걷어낸 원본 — 우리가 보려는 것은 실제로 도는 코드뿐이다. */
const viewerCode = viewerSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const TURNED_RIGHT: ImageOrientation = { rotate: 90, flipX: false, flipY: false };
const UPSIDE_DOWN_MIRRORED: ImageOrientation = { rotate: 180, flipX: true, flipY: false };

// ═══════════════════════════════ 1. 방향만 CSS 로 — 배율·이동이 섞일 길이 없다

describe("🔴 방향만 거는 자리(orientationCss)", () => {
  test("그대로인 방향은 빈 문자열이다 — style 자체를 걸지 않는다", () => {
    assert.equal(orientationCss(IDENTITY_ORIENTATION), "");
  });

  test("회전 → 좌우 → 상하 차례로 적힌다", () => {
    assert.equal(orientationCss(TURNED_RIGHT), "rotate(90deg)");
    assert.equal(
      orientationCss({ rotate: 270, flipX: true, flipY: true }),
      "rotate(270deg) scaleX(-1) scaleY(-1)"
    );
    assert.equal(orientationCss({ rotate: 0, flipX: true, flipY: false }), "scaleX(-1)");
  });

  test("🔴 배율도 이동도 들어올 수 없다 — 썸네일이 칸을 뚫고 나가는 길이 막혀 있다", () => {
    const css = orientationCss({ rotate: 90, flipX: true, flipY: true });
    // scaleX(·scaleY( 는 뒤집기다. 배율은 `scale(` 이고, 그것이 없어야 한다.
    assert.ok(!css.includes("scale("), `배율이 섞였다: ${css}`);
    assert.ok(!css.includes("translate("), `이동이 섞였다: ${css}`);
  });
});

describe("🔴 크게 보기와 썸네일의 방향 규칙은 갈라질 수 없다", () => {
  test("크게 보기의 변환은 「자리 + 방향」이고, 방향 쪽이 곧 orientationCss 다", () => {
    const transform = {
      orientation: UPSIDE_DOWN_MIRRORED,
      scale: 3.5,
      offsetX: 12,
      offsetY: -8,
    };
    const full = viewerTransformCss(transform);
    assert.equal(full, "translate(12px, -8px) scale(3.5) rotate(180deg) scaleX(-1)");
    assert.ok(
      full.endsWith(orientationCss(transform.orientation)),
      "화면과 썸네일이 서로 다른 방향 CSS 를 만든다"
    );
  });

  test("🔴 차례는 그대로다 — translate 가 맨 앞, 뒤집기가 맨 끝", () => {
    const full = viewerTransformCss({
      orientation: { rotate: 90, flipX: true, flipY: true },
      scale: 2,
      offsetX: 10,
      offsetY: -20,
    });
    assert.equal(full, "translate(10px, -20px) scale(2) rotate(90deg) scaleX(-1) scaleY(-1)");
    assert.ok(full.indexOf("translate(") < full.indexOf("rotate("), "translate 가 rotate 보다 앞");
    assert.ok(full.indexOf("rotate(") < full.indexOf("scaleX("), "뒤집기는 그림 자신의 축에 먼저");
  });

  test("그대로인 방향이면 꼬리에 빈칸이 붙지 않는다 — 예전과 한 글자도 같다", () => {
    assert.equal(viewerTransformCss(IDENTITY_TRANSFORM), "translate(0px, 0px) scale(1)");
  });

  test("🔴 방향 CSS 를 만드는 자리가 하나뿐이다 — 회전 글자를 따로 적어 둔 곳이 없다", () => {
    assert.equal(
      count(viewerCode, "rotate(${"),
      1,
      "rotate CSS 를 만드는 자리가 둘 이상이다 — 한쪽만 고쳐지면 화면과 썸네일이 갈라진다"
    );
    assert.equal(count(viewerCode, '"scaleX(-1)"'), 1, "좌우 뒤집기 CSS 를 만드는 자리가 둘 이상이다");
    assert.equal(count(viewerCode, '"scaleY(-1)"'), 1, "상하 뒤집기 CSS 를 만드는 자리가 둘 이상이다");
  });
});

// ═══════════════════════════════ 2. 어느 칸에 어느 방향을 거는가

describe("🔴 썸네일 한 칸이 지금 어느 방향으로 보여야 하는가", () => {
  const picked: PickedOrientations = { a1: TURNED_RIGHT, a2: UPSIDE_DOWN_MIRRORED };

  function orientationOf(
    id: string,
    overrides: { isCurrent?: boolean; isPicking?: boolean; currentOrientation?: ImageOrientation } = {}
  ): ImageOrientation | null {
    return thumbnailOrientationOf({
      id,
      isCurrent: overrides.isCurrent ?? false,
      isPicking: overrides.isPicking ?? true,
      picked,
      currentOrientation: overrides.currentOrientation ?? IDENTITY_ORIENTATION,
    });
  }

  test("🔴 고른 것은 **각자의** 방향이다 — 한 묶음 안에서도 칸마다 갈린다", () => {
    // 「전부 가로로」가 이미 가로인 것을 건드리지 않으므로 실제로 갈린다.
    assert.deepEqual(orientationOf("a1"), TURNED_RIGHT);
    assert.deepEqual(orientationOf("a2"), UPSIDE_DOWN_MIRRORED);
  });

  test("고르지도 않고 지금 보는 것도 아니면 방향이 없다 — 손대지 않은 사진은 돌리지 않는다", () => {
    assert.equal(orientationOf("a3"), null);
  });

  test("🔴 지금 보는 한 장이고 안 골랐으면 **화면 방향**이다 — 위에서 돌리면 아래도 돈다", () => {
    assert.deepEqual(orientationOf("a3", { isCurrent: true, currentOrientation: TURNED_RIGHT }), TURNED_RIGHT);
    // 고르기를 쓰지 않는 지금까지의 길도 같다.
    assert.deepEqual(
      thumbnailOrientationOf({
        id: "a3",
        isCurrent: true,
        isPicking: false,
        picked: NO_PICKS,
        currentOrientation: UPSIDE_DOWN_MIRRORED,
      }),
      UPSIDE_DOWN_MIRRORED
    );
  });

  test("🔴 고른 것이면서 지금 보는 것이면 **고른 쪽이 이긴다** — 크게 보기(shownTransform)와 같은 판단", () => {
    assert.deepEqual(
      orientationOf("a1", { isCurrent: true, currentOrientation: UPSIDE_DOWN_MIRRORED }),
      TURNED_RIGHT,
      "큰 그림과 그 썸네일이 서로 다른 방향으로 보인다"
    );
  });

  test("고른 것이 「그대로」여도 고른 것으로 읽는다 — 걸 방향이 없을 뿐이다", () => {
    const params = {
      id: "a9",
      isCurrent: true,
      isPicking: true,
      picked: { a9: IDENTITY_ORIENTATION } as PickedOrientations,
      currentOrientation: TURNED_RIGHT,
    };
    assert.deepEqual(thumbnailOrientationOf(params), IDENTITY_ORIENTATION);
    assert.equal(thumbnailTransformCss(params), "");
  });

  test("고르기가 꺼져 있으면 고른 표시를 보지 않는다 — 화면이 고른 테두리를 안 그리는 것과 같은 기준", () => {
    assert.equal(orientationOf("a1", { isPicking: false }), null);
  });
});

describe("🔴 썸네일에 거는 CSS 는 방향뿐이다", () => {
  test("8배로 키우고 멀리 끌어 두어도 썸네일에는 회전만 걸린다", () => {
    // 인자에 배율·이동을 넣을 자리 자체가 없다 — 그것이 이 함수의 요점이다.
    const css = thumbnailTransformCss({
      id: "a1",
      isCurrent: true,
      isPicking: false,
      picked: NO_PICKS,
      currentOrientation: TURNED_RIGHT,
    });
    assert.equal(css, "rotate(90deg)");
    assert.ok(!css.includes("scale("), "배율이 걸렸다 — 칸을 뚫고 나간다");
    assert.ok(!css.includes("translate("), "이동이 걸렸다");
  });

  test("걸 것이 없으면 빈 문자열이다", () => {
    assert.equal(
      thumbnailTransformCss({
        id: "a3",
        isCurrent: false,
        isPicking: true,
        picked: { a1: TURNED_RIGHT },
        currentOrientation: TURNED_RIGHT,
      }),
      ""
    );
  });
});

describe("🔴 화면이 그 판정을 그대로 쓴다 — 아래 썸네일 줄", () => {
  /** 썸네일 단추 하나를 그리는 자리만 잘라 본다. */
  const thumbBlock = (() => {
    const start = viewerCode.indexOf("{items.map((item, itemIndex) => {");
    assert.ok(start >= 0, "썸네일 줄이 없다");
    const end = viewerCode.indexOf("</button>", start);
    assert.ok(end > start, "썸네일 단추가 없다");
    return viewerCode.slice(start, end);
  })();

  test("썸네일은 thumbnailTransformCss 로 방향만 받는다", () => {
    assert.ok(thumbBlock.includes("thumbnailTransformCss({"), "썸네일이 방향을 안 받는다");
    assert.ok(
      thumbBlock.includes("currentOrientation: transform.orientation"),
      "화면 방향을 넘기는 자리가 없다"
    );
    assert.ok(
      thumbBlock.includes("style={thumbTransform ? { transform: thumbTransform } : undefined}"),
      "받은 방향을 실제로 걸지 않는다"
    );
  });

  test("🔴 썸네일에 크게 보기의 변환(배율·이동)이 걸리지 않는다", () => {
    assert.ok(!thumbBlock.includes("viewerTransformCss"), "썸네일에 배율·이동이 함께 걸린다");
    assert.ok(!thumbBlock.includes("transform.scale"), "썸네일에 배율이 넘어간다");
    assert.ok(!thumbBlock.includes("shownTransform"), "썸네일에 무대의 변환이 넘어간다");
  });

  test("🔴 크게 보는 그림은 예전 그대로 viewerTransformCss 를 쓴다", () => {
    assert.ok(
      viewerCode.includes("transform: viewerTransformCss(shownTransform)"),
      "크게 보기의 변환이 바뀌었다"
    );
  });

  test("🔴 thumb/full 구분은 그대로다 — 이 줄에서 원본을 부르면 수십 장이 한꺼번에 내려온다", () => {
    assert.ok(thumbBlock.includes("viewerThumbUrl(item)"), "썸네일 줄이 ?view=thumb 이 아니다");
    assert.ok(!thumbBlock.includes("viewerFullUrl"), "썸네일 줄이 원본을 부른다");
    assert.ok(viewerCode.includes("src={viewerFullUrl(current)}"), "크게 보는 자리가 원본이 아니다");
  });

  test("🔴 칸 크기와 맞춰 넣기는 건드리지 않았다 — 90° 돌아도 잘리지 않는 근거다", () => {
    // 칸이 정사각(h-14 w-14)이고 <img> 가 그것을 가득 채우므로(h-full w-full),
    // 한가운데를 축으로 90° 돌려도 그 정사각 자리에 그대로 들어맞는다.
    // 그림은 object-contain 으로 이미 그 안에 맞춰져 있어 전체가 보인다.
    assert.ok(thumbBlock.includes("h-14 w-14"), "칸 크기가 바뀌었다");
    assert.ok(
      thumbBlock.includes('className="h-full w-full bg-white/15 object-contain"'),
      "맞춰 넣기(object-contain)가 바뀌었다 — 돌린 썸네일이 잘린다"
    );
  });
});

// ═══════════════════════════════ 3. Shift 로 사이를 한꺼번에 고르기

/** 지금 줄에 보이는 사진들. 범위는 언제나 이 순서로 잡힌다. */
const PHOTOS = ["a1", "a2", "a3", "a4", "a5", "a6"];

type PickState = { picked: PickedOrientations; anchorId: string | null };

const NOTHING_PICKED: PickState = { picked: NO_PICKS, anchorId: null };

/**
 * 썸네일 한 번 누르기를 값으로 다시 짠다 — **화면이 하는 그대로다.** 공용 규칙
 * (planRangeToggle)이 「이 id 들을 이 상태로」를 내놓고, setPickedIds 가 얹는다.
 * 화면이 실제로 이 둘을 지나가는지는 아래 원본 읽기가 본다.
 */
function press(state: PickState, id: string, shiftKey = false): PickState {
  const plan = planRangeToggle({
    orderedIds: PHOTOS,
    isSelectable: () => true,
    isSelected: (candidate) => isPickedId(state.picked, candidate),
    anchorId: state.anchorId,
    targetId: id,
    shiftKey,
  });
  if (plan === null) return state;
  return {
    picked: setPickedIds(state.picked, plan.ids, plan.nextChecked),
    anchorId: plan.anchorId,
  };
}

const pickedIdsOf = (state: PickState) => Object.keys(state.picked).sort();

describe("🔴 클릭 → Shift+클릭 (사용자 결정 2026-09-29)", () => {
  test("한 장을 누르고 다른 장을 Shift 로 누르면 **그 사이 전부**가 골라진다", () => {
    const state = press(press(NOTHING_PICKED, "a2"), "a5", true);
    assert.deepEqual(pickedIdsOf(state), ["a2", "a3", "a4", "a5"]);
  });

  test("거꾸로 눌러도 같다 — 뒤에서 앞으로", () => {
    const state = press(press(NOTHING_PICKED, "a5"), "a2", true);
    assert.deepEqual(pickedIdsOf(state), ["a2", "a3", "a4", "a5"]);
  });

  test("🔴 기준점이 없는데 Shift 로 누르면 **한 장만** 골라진다", () => {
    // 고르기를 켜고 첫 누르기부터 Shift 인 경우. 짐작해서 범위를 만들지 않는다.
    const state = press(NOTHING_PICKED, "a4", true);
    assert.deepEqual(pickedIdsOf(state), ["a4"]);
    assert.equal(state.anchorId, "a4", "그 한 장이 다음 기준점이 된다");
  });

  test("🔴 Shift 로 누른 것은 기준점을 옮기지 않는다 — 처음 기준점에서 범위를 고쳐 잡는다", () => {
    const wide = press(press(NOTHING_PICKED, "a3"), "a5", true);
    assert.deepEqual(pickedIdsOf(wide), ["a3", "a4", "a5"]);
    assert.equal(wide.anchorId, "a3", "Shift 가 기준점을 옮겼다");

    // 기준점이 a3 이므로 범위는 a3‥a4 다. a5 로 옮겨 갔다면 a4‥a5 가 되어
    // 남는 것이 a3 이었을 것이다.
    const narrowed = press(wide, "a4", true);
    assert.deepEqual(pickedIdsOf(narrowed), ["a5"]);
    assert.equal(narrowed.anchorId, "a3", "범위를 잡은 뒤에도 기준점은 처음 것이다");
  });

  test("🔴 범위가 이미 고른 것을 덮어도 **빠지지 않는다** — 고름으로 통일된다", () => {
    // a4 는 이미 골라 두고 오른쪽으로 돌려 놓았다.
    const started: PickState = { picked: { a4: TURNED_RIGHT }, anchorId: null };
    const state = press(press(started, "a2"), "a6", true);
    assert.deepEqual(pickedIdsOf(state), ["a2", "a3", "a4", "a5", "a6"]);
    assert.deepEqual(
      state.picked["a4"],
      TURNED_RIGHT,
      "🔴 범위가 덮었다고 걸어 둔 방향이 풀렸다 — 돌려 둔 것을 잃는다"
    );
    for (const id of ["a2", "a3", "a5", "a6"]) {
      assert.deepEqual(state.picked[id], IDENTITY_ORIENTATION, `${id} 는 「그대로」로 들어와야 한다`);
    }
  });
});

describe("🔴 「고르기」를 끄면 고른 것과 **기준점**이 함께 비워진다", () => {
  /**
   * 🔴 실제로 겪은 결함이다(2026-09-29). 끌 때 고른 것만 비우고 기준점을 공용 훅
   * 안에 남겨 두면, 다시 켜고 **첫 누르기부터 Shift** 로 누를 때 지난번에 눌러
   * 둔 자리를 기준으로 범위가 잡힌다 — 눈에 보이지도 않던 자리에서 여러 장이
   * 한꺼번에 골라지고, 그 끝은 되돌릴 수 없는 저장이다.
   */
  const turnPickingOff = (): PickState => ({ picked: NO_PICKS, anchorId: null });

  test("🔴 껐다 켠 뒤 **첫 Shift+클릭이 한 장만** 고른다", () => {
    // 지난번: a2 를 누르고 a5 까지 Shift 로 잡아 두었다.
    const before = press(press(NOTHING_PICKED, "a2"), "a5", true);
    assert.deepEqual(pickedIdsOf(before), ["a2", "a3", "a4", "a5"]);
    assert.equal(before.anchorId, "a2");

    // 「고르기」를 껐다 켠다 — 고른 것도 기준점도 비워진다.
    const after = press(turnPickingOff(), "a6", true);
    assert.deepEqual(
      pickedIdsOf(after),
      ["a6"],
      "🔴 지난번 기준점이 남아 a2‥a6 이 한꺼번에 골라졌다"
    );
    assert.equal(after.anchorId, "a6", "그 한 장이 새 기준점이 된다");
  });

  test("비운 뒤에도 클릭 → Shift+클릭은 그대로 된다 — 기준점을 새로 잡을 뿐이다", () => {
    const state = press(press(turnPickingOff(), "a4"), "a6", true);
    assert.deepEqual(pickedIdsOf(state), ["a4", "a5", "a6"]);
  });

  test("🔴 화면이 끌 때 셋을 다 한다 — 고르기 끄기 · 고른 것 비우기 · 기준점 비우기", () => {
    const start = viewerCode.indexOf("function togglePicking()");
    assert.ok(start >= 0, "togglePicking 이 없다");
    const block = viewerCode.slice(start, viewerCode.indexOf("\n  }", start));
    for (const needle of ["setIsPicking(false)", "setPicked(NO_PICKS)", "pickRange.resetAnchor()"]) {
      assert.ok(block.includes(needle), `끄는 가지에 ${needle} 이 없다:\n${block}`);
    }
  });

  test("🔴 기준점을 비우는 길은 공용 훅이 낸다 — 화면이 제 손으로 들고 있지 않다", () => {
    const hook = readFileSync(
      new URL("../../../lib/hooks/useShiftRangeSelection.ts", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    assert.ok(hook.includes("function resetAnchor()"), "공용 훅에 기준점을 비우는 길이 없다");
    assert.ok(hook.includes("setAnchorId(null)"), "기준점을 null 로 되돌리지 않는다");
    assert.ok(hook.includes("return { toggle, resetAnchor };"), "내주지 않으면 화면이 부를 수 없다");
    // 🔴 **더하기만 했다** — 누를 때의 규칙(toggle)은 예전 그대로다.
    assert.ok(
      hook.includes("setAnchorId(plan.anchorId);"),
      "누를 때 기준점을 두는 규칙이 달라졌다 — 기존 화면들의 동작이 바뀐다"
    );
  });
});

describe("🔴 폰에는 Shift 가 없다 — 한 장씩 누르던 길이 그대로다", () => {
  test("Shift 없이 누르면 그 한 장만 골라지고, 다시 누르면 빠진다", () => {
    const one = press(NOTHING_PICKED, "a3");
    assert.deepEqual(pickedIdsOf(one), ["a3"]);
    assert.deepEqual(one.picked["a3"], IDENTITY_ORIENTATION);

    const none = press(one, "a3");
    assert.deepEqual(pickedIdsOf(none), []);
  });

  test("떨어져 있는 여러 장을 하나씩 고를 수 있다 — 사이가 딸려 오지 않는다", () => {
    const state = press(press(press(NOTHING_PICKED, "a1"), "a3"), "a5");
    assert.deepEqual(pickedIdsOf(state), ["a1", "a3", "a5"]);
  });

  test("Shift 없이 누른 것이 기준점이 된다", () => {
    assert.equal(press(press(NOTHING_PICKED, "a1"), "a4").anchorId, "a4");
  });

  test("한 장씩 눌러 둔 방향은 다음 누르기에 흔들리지 않는다", () => {
    const started: PickState = { picked: { a2: TURNED_RIGHT }, anchorId: "a2" };
    const state = press(started, "a5");
    assert.deepEqual(state.picked["a2"], TURNED_RIGHT);
  });
});

describe("여러 장에 한 상태를 얹는 자리(setPickedIds)", () => {
  test("🔴 이미 걸어 둔 방향은 지키고, 새로 들어오는 것만 「그대로」다", () => {
    const next = setPickedIds({ a1: TURNED_RIGHT }, ["a1", "a2"], true);
    assert.deepEqual(next["a1"], TURNED_RIGHT, "눌렀다는 이유로 돌려 둔 것이 풀렸다");
    assert.deepEqual(next["a2"], IDENTITY_ORIENTATION);
  });

  test("끄면 빠진다", () => {
    const next = setPickedIds({ a1: TURNED_RIGHT, a2: IDENTITY_ORIENTATION }, ["a1"], false);
    assert.deepEqual(Object.keys(next), ["a2"]);
  });

  test("바뀐 것이 없으면 받은 것을 그대로 돌려준다 — 괜히 다시 그리지 않는다", () => {
    const picked: PickedOrientations = { a1: TURNED_RIGHT };
    assert.equal(setPickedIds(picked, ["a1"], true), picked);
    assert.equal(setPickedIds(picked, ["a2"], false), picked);
    assert.equal(setPickedIds(picked, [], true), picked);
  });
});

describe("🔴 규칙을 화면에 새로 적지 않았다 — 공용 한 곳을 지나간다", () => {
  test("화면이 공용 Shift 규칙을 거친다", () => {
    assert.ok(
      viewerCode.includes('from "@/lib/hooks/useShiftRangeSelection"'),
      "공용 규칙을 거치지 않는다"
    );
    assert.equal(count(viewerCode, "useShiftRangeSelection({"), 1, "선택 상태마다 훅이 하나씩");
    assert.ok(
      viewerCode.includes("orderedIds: items.map((item) => item.id)"),
      "🔴 범위는 지금 줄에 보이는 순서로 잡혀야 한다"
    );
    assert.ok(
      viewerCode.includes("setPickedIds(previous, ids, checked)"),
      "규칙이 내놓은 계획을 얹는 자리가 없다"
    );
  });

  test("🔴 기준점·범위를 화면이 제 손으로 셈하지 않는다", () => {
    // anchorX·anchorY 는 확대의 기준점이라 다른 것이다 — 고르기의 기준점
    // (anchorId)과 범위 셈(planRangeToggle)만 여기 있으면 안 된다.
    for (const forbidden of ["anchorId", "planRangeToggle"]) {
      assert.ok(
        !viewerCode.includes(forbidden),
        `${forbidden} — 규칙이 두 군데로 갈린다(공용 훅이 기준점을 들고 있다)`
      );
    }
  });

  test("Shift 를 누르는 자리에서 읽고, 글자가 긁히지 않게 막는다", () => {
    assert.equal(count(viewerCode, "shiftKeyOf(event)"), 1, "썸네일이 Shift 를 안 읽는다");
    assert.equal(
      count(viewerCode, "onMouseDown={preventShiftClickTextSelection}"),
      1,
      "Shift+누르기에 글자가 파랗게 긁힌다"
    );
  });
});
