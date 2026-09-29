import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import AttachmentViewer, {
  NO_PICKS,
  dropPicked,
  hasPickedRotation,
  isPickedId,
  mapPicked,
  orientPickedTo,
  pickedCountOf,
  pickedSaveTargets,
  resetPicked,
  rotateOrientation,
  shownOrientationOf,
  thumbnailPressAction,
  togglePicked,
  type PickedOrientations,
  type PixelSize,
} from "./AttachmentViewer";
import SaveRotationDialog, {
  formatSaveOutcome,
  type SaveRotationTarget,
} from "./SaveRotationDialog";
import { IDENTITY_ORIENTATION, type ImageOrientation } from "@/lib/domain/image-orientation";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 여러 장을 골라 한꺼번에 돌리고 저장한다(2026-09-29)
 * ============================================================================
 * 🔴 **원본을 여러 장 한꺼번에 덮어쓰는 길이다.** 한 장 실수보다 크다. 그래서
 * 여기서 못박는 것은 「되는가」가 아니라 **「안 건드려야 할 것을 안 건드리는가」**
 * 쪽이다.
 *
 *  1. **고르기가 꺼져 있을 때의 동작이 한 글자도 달라지지 않았다.** 썸네일을
 *     누르면 그 사진으로 넘어간다 — 지금까지 그랬던 대로다.
 *  2. **켜면 누르는 것이 선택이 된다.** 넘어가지 않는다.
 *  3. 🔴 **「전부 가로로」는 이미 가로인 것을 건드리지 않는다.** 원본의 가로세로
 *     하나만 보면 **화면에서 이미 돌려 둔 사진**을 또 돌린다 — 둘을 합쳐야 맞다.
 *  4. **확인 창에 몇 장인지 나온다.** 되돌릴 수 없는 일에서 그 숫자가 제일 중요하다.
 *  5. **권한이 없으면 「고르기」가 처음부터 없다.**
 *  6. 🔴 **일부만 실패한 것을 숨기지 않는다.** 「5장 중 3장 저장, 2장 실패」가
 *     어느 사진이 왜 막혔는지와 함께 사람에게 보인다.
 *
 * 판정을 전부 순수 함수로 빼 두었으므로 손가락도 브라우저도 없이 돈다. 화면이
 * 그 판정을 **실제로 쓰는지**는 원본을 글자로 읽어 확인한다 — 뷰어의 고르기
 * 상태는 안쪽 상태라 인자로 「켜 놓은 화면」을 만들 길이 없다(이웃
 * attachment-rotation-save.test.tsx 와 같은 방법).
 * ============================================================================
 */

const viewerSource = readFileSync(new URL("./AttachmentViewer.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

function attachment(
  overrides: Partial<RepairCaseAttachmentListItem> = {}
): RepairCaseAttachmentListItem {
  return {
    id: "att-1",
    category: "INTAKE_PHOTO",
    originalFileName: "외관.jpg",
    storedPath: "repair-cases/case-1/att-1.jpg",
    previewPath: "repair-cases/case-1/att-1.preview.jpg",
    mimeType: "image/jpeg",
    fileSize: 1024,
    checksumSha256: "0".repeat(64),
    malwareScanStatus: "CLEAN",
    description: null,
    uploadedById: "user-1",
    uploadedByName: "홍길동",
    uploadedAt: "2026-09-29T01:02:03.000Z",
    ...overrides,
  };
}

async function noopSave() {
  return { ok: true } as const;
}

function renderViewer(options: { withSave: boolean; count: number }): string {
  const items = Array.from({ length: options.count }, (_unused, position) =>
    attachment({ id: `a${position + 1}`, originalFileName: `사진${position + 1}.jpg` })
  );
  return renderToStaticMarkup(
    <AttachmentViewer
      items={items}
      initialIndex={0}
      onClose={() => {}}
      onSaveOrientation={options.withSave ? noopSave : undefined}
    />
  );
}

/** 원본이 가로인 사진(4000×3000)과 세로인 사진(3000×4000). */
const LANDSCAPE: PixelSize = { width: 4000, height: 3000 };
const PORTRAIT: PixelSize = { width: 3000, height: 4000 };
const SQUARE: PixelSize = { width: 2000, height: 2000 };

const TURNED_RIGHT: ImageOrientation = { rotate: 90, flipX: false, flipY: false };

/** 시험 안에서 「이 사진의 크기는 이렇다」를 건네는 자리. 없는 것은 null 이다. */
function sizes(table: Record<string, PixelSize>): (id: string) => PixelSize | null {
  return (id) => table[id] ?? null;
}

// ═════════════════════════════════ 1·2. 고르기를 켜고 끄는 것이 무엇을 바꾸는가

describe("🔴 고르기가 꺼져 있을 때의 동작은 달라지지 않았다", () => {
  test("꺼져 있으면 썸네일을 눌러 그 사진으로 넘어간다", () => {
    assert.equal(thumbnailPressAction({ isPicking: false, isSaving: false }), "navigate");
  });

  test("🔴 켜져 있으면 눌러도 안 넘어가고 고르기만 된다", () => {
    assert.equal(thumbnailPressAction({ isPicking: true, isSaving: false }), "pick");
  });

  test("저장이 도는 동안에는 아무 일도 하지 않는다 — 대상이 바뀌면 안 된다", () => {
    assert.equal(thumbnailPressAction({ isPicking: false, isSaving: true }), "ignore");
    assert.equal(thumbnailPressAction({ isPicking: true, isSaving: true }), "ignore");
  });

  test("🔴 화면이 그 판정을 그대로 쓴다 — 넘어가는 길이 그대로 남아 있다", () => {
    // 2026-09-29: 고르는 가지가 공용 Shift 규칙을 지나게 되면서 부르는 자리가
    // `togglePicked` 에서 `pickRange.toggle` 로 바뀌었다. 못박는 것은 그대로다 —
    // 넘어가는 길과 고르는 길이 둘 다 있고, 판정은 순수 함수가 한다.
    assert.ok(
      viewerSource.includes("onClick={(event) => pressThumbnail(item, itemIndex, shiftKeyOf(event))}"),
      "썸네일이 pressThumbnail 을 부르지 않는다"
    );
    const start = viewerSource.indexOf("function pressThumbnail(");
    assert.ok(start >= 0, "pressThumbnail 이 없다");
    const block = viewerSource.slice(start, viewerSource.indexOf("\n  }", start));
    assert.ok(
      block.includes("thumbnailPressAction({ isPicking, isSaving })"),
      "판정을 순수 함수에서 받아 오지 않는다"
    );
    assert.ok(block.includes("go(itemIndex)"), "넘어가는 길이 사라졌다");
    assert.ok(block.includes("pickRange.toggle(item.id, shiftKey)"), "고르는 길이 없다");
  });
});

describe("고른 것을 들고 있는 방식", () => {
  test("누르면 골라지고, 다시 누르면 빠진다", () => {
    const one = togglePicked(NO_PICKS, "a1");
    assert.equal(isPickedId(one, "a1"), true);
    assert.equal(pickedCountOf(one), 1);
    // 값이 「그대로인 방향」이라도 고른 것으로 읽혀야 한다 — 거짓처럼 보이지 않게.
    assert.deepEqual(one["a1"], IDENTITY_ORIENTATION);

    const none = togglePicked(one, "a1");
    assert.equal(isPickedId(none, "a1"), false);
    assert.equal(pickedCountOf(none), 0);
  });

  test("🔴 고른 것 전부에 같은 값이 걸린다", () => {
    const picked = togglePicked(togglePicked(NO_PICKS, "a1"), "a3");
    const turned = mapPicked(picked, (orientation) => rotateOrientation(orientation, 1));
    assert.deepEqual(turned["a1"], TURNED_RIGHT);
    assert.deepEqual(turned["a3"], TURNED_RIGHT);
    assert.equal(pickedCountOf(turned), 2, "고르지 않은 것이 끼어들었다");
    assert.equal(hasPickedRotation(turned), true);
    assert.equal(hasPickedRotation(resetPicked(turned)), false, "「원래대로」가 안 푼다");
  });

  test("🔴 저장에 성공한 것만 빠지고 실패한 것은 고른 채로 남는다", () => {
    const picked: PickedOrientations = {
      a1: TURNED_RIGHT,
      a2: TURNED_RIGHT,
      a3: TURNED_RIGHT,
    };
    const left = dropPicked(picked, ["a1", "a3"]);
    assert.deepEqual(Object.keys(left), ["a2"], "실패한 것이 고른 것에서 사라졌다");
    assert.deepEqual(left["a2"], TURNED_RIGHT, "다시 시도할 방향까지 잃었다");
    // 뺄 것이 없으면 같은 것을 그대로 돌려준다 — 괜히 다시 그리지 않는다.
    assert.equal(dropPicked(picked, []), picked);
  });

  test("🔴 고르기를 끄면 고른 것을 비운다 — 잊고 저장하는 사고를 막는다", () => {
    const start = viewerSource.indexOf("function togglePicking()");
    assert.ok(start >= 0, "togglePicking 이 없다");
    const block = viewerSource.slice(start, viewerSource.indexOf("\n  }", start));
    assert.ok(
      block.includes("setIsPicking(false)") && block.includes("setPicked(NO_PICKS)"),
      `끄는 가지가 고른 것을 비우지 않는다:\n${block}`
    );
  });
});

// ═════════════════════════════════ 3. 「전부 가로로」·「전부 세로로」

describe("🔴 지금 가로인가 세로인가 — 원본 크기와 화면 회전을 합쳐야 맞다", () => {
  test("돌리지 않았으면 원본 크기 그대로 읽는다", () => {
    assert.equal(shownOrientationOf(LANDSCAPE, IDENTITY_ORIENTATION), "landscape");
    assert.equal(shownOrientationOf(PORTRAIT, IDENTITY_ORIENTATION), "portrait");
  });

  test("🔴 원본이 세로라도 90°·270° 로 돌려 두었으면 **이미 가로다**", () => {
    assert.equal(shownOrientationOf(PORTRAIT, { rotate: 90, flipX: false, flipY: false }), "landscape");
    assert.equal(shownOrientationOf(PORTRAIT, { rotate: 270, flipX: false, flipY: false }), "landscape");
    // 180° 는 가로세로를 바꾸지 않는다.
    assert.equal(shownOrientationOf(PORTRAIT, { rotate: 180, flipX: false, flipY: false }), "portrait");
  });

  test("뒤집기는 가로세로를 바꾸지 않는다", () => {
    assert.equal(shownOrientationOf(LANDSCAPE, { rotate: 0, flipX: true, flipY: true }), "landscape");
  });

  test("정사각이거나 크기를 모르면 답이 없다(null)", () => {
    assert.equal(shownOrientationOf(SQUARE, IDENTITY_ORIENTATION), null);
    assert.equal(shownOrientationOf({ width: 0, height: 0 }, IDENTITY_ORIENTATION), null);
  });
});

describe("🔴 「전부 가로로」는 이미 가로인 것을 건드리지 않는다", () => {
  test("세로인 것만 오른쪽으로 90° 돈다", () => {
    const picked: PickedOrientations = {
      wide: IDENTITY_ORIENTATION,
      tall: IDENTITY_ORIENTATION,
    };
    const next = orientPickedTo(
      picked,
      "landscape",
      sizes({ wide: LANDSCAPE, tall: PORTRAIT })
    );
    assert.deepEqual(next["wide"], IDENTITY_ORIENTATION, "이미 가로인 것을 또 돌렸다");
    assert.deepEqual(next["tall"], TURNED_RIGHT, "세로인 것이 안 돌았다");
  });

  test("🔴 화면에서 이미 돌려 둔 것도 「이미 가로」로 친다 — 여기를 빠뜨리면 또 돈다", () => {
    // 원본은 세로지만 사람이 90° 돌려 놓았다. 화면에서는 이미 가로다.
    const picked: PickedOrientations = { tall: TURNED_RIGHT };
    const next = orientPickedTo(picked, "landscape", sizes({ tall: PORTRAIT }));
    assert.deepEqual(next["tall"], TURNED_RIGHT, "이미 눕혀 둔 사진을 또 돌렸다");
    // 아무것도 안 바뀌었으면 같은 것을 그대로 돌려준다.
    assert.equal(next, picked);
  });

  test("반대로 가로 사진을 90° 돌려 두었으면 그것은 세로다 — 가로로 맞추면 한 번 더 돈다", () => {
    const picked: PickedOrientations = { wide: TURNED_RIGHT };
    const next = orientPickedTo(picked, "landscape", sizes({ wide: LANDSCAPE }));
    assert.deepEqual(next["wide"], { rotate: 180, flipX: false, flipY: false });
  });

  test("「전부 세로로」도 같은 규칙이다 — 이미 세로인 것은 그대로", () => {
    const picked: PickedOrientations = {
      wide: IDENTITY_ORIENTATION,
      tall: IDENTITY_ORIENTATION,
    };
    const next = orientPickedTo(picked, "portrait", sizes({ wide: LANDSCAPE, tall: PORTRAIT }));
    assert.deepEqual(next["wide"], TURNED_RIGHT, "가로인 것이 안 돌았다");
    assert.deepEqual(next["tall"], IDENTITY_ORIENTATION, "이미 세로인 것을 또 돌렸다");
  });

  test("🔴 크기를 모르는 사진은 건드리지 않는다 — 짐작 위에 덮어쓰기를 얹지 않는다", () => {
    const picked: PickedOrientations = { unknown: IDENTITY_ORIENTATION };
    assert.equal(orientPickedTo(picked, "landscape", sizes({})), picked);
  });

  test("정사각은 돌려도 가로가 되지 않으므로 그대로 둔다", () => {
    const picked: PickedOrientations = { square: IDENTITY_ORIENTATION };
    assert.equal(orientPickedTo(picked, "landscape", sizes({ square: SQUARE })), picked);
  });

  test("돌릴 때 뒤집어 둔 것은 잃지 않는다 — 각도만 바뀐다", () => {
    const flipped: ImageOrientation = { rotate: 0, flipX: true, flipY: false };
    const next = orientPickedTo({ tall: flipped }, "landscape", sizes({ tall: PORTRAIT }));
    assert.deepEqual(next["tall"], { rotate: 90, flipX: true, flipY: false });
  });

  test("🔴 방향만 바꾼다 — 이 단추가 파일을 저장하지 않는다", () => {
    const start = viewerSource.indexOf("function orientPicked(");
    assert.ok(start >= 0, "orientPicked 이 없다");
    const block = viewerSource.slice(start, viewerSource.indexOf("\n  }", start));
    assert.ok(!block.includes("onSaveOrientation"), `저장이 섞여 있다:\n${block}`);
    assert.ok(!block.includes("setIsSaveOpen"), `확인 창이 열린다:\n${block}`);
  });
});

// ═════════════════════════════════ 저장 대상 고르기

describe("저장 대상", () => {
  const items = [
    attachment({ id: "a1", originalFileName: "하나.jpg" }),
    attachment({ id: "a2", originalFileName: "둘.jpg" }),
    attachment({ id: "a3", originalFileName: "셋.jpg" }),
  ];

  test("🔴 고른 것 가운데 그대로인 것은 저장하지 않는다 — 화질만 잃는다", () => {
    const picked: PickedOrientations = {
      a1: TURNED_RIGHT,
      a2: IDENTITY_ORIENTATION,
      a3: TURNED_RIGHT,
    };
    const targets = pickedSaveTargets(items, picked);
    assert.deepEqual(
      targets.map((target) => target.item.id),
      ["a1", "a3"],
      "그대로인 것이 끼었거나 차례가 화면과 다르다"
    );
    assert.deepEqual(targets[0].orientation, TURNED_RIGHT);
  });

  test("고르지 않은 것은 들어가지 않는다", () => {
    assert.deepEqual(pickedSaveTargets(items, { a2: TURNED_RIGHT }).map((t) => t.item.id), ["a2"]);
    assert.deepEqual(pickedSaveTargets(items, NO_PICKS), []);
  });

  test("🔴 있는 통로를 한 장씩 여러 번 부른다 — 묶는 새 통로를 만들지 않았다", () => {
    const start = viewerSource.indexOf("async function confirmSaveOrientation()");
    assert.ok(start >= 0);
    const block = viewerSource.slice(start, viewerSource.indexOf("\n  }", start));
    assert.ok(
      block.includes("for (const [position, target] of targets.entries())"),
      `한 장씩 도는 자리가 없다:\n${block}`
    );
    assert.equal(
      block.split("await onSaveOrientation(").length - 1,
      1,
      "저장을 부르는 자리가 하나가 아니다"
    );
    assert.ok(
      block.includes("failures.push("),
      "하나가 실패해도 나머지를 이어 가는 자리가 없다"
    );
    assert.ok(
      block.includes("dropPicked(previous, savedIds)"),
      "🔴 실패한 것을 고른 채로 남기지 않는다 — 다시 시도할 수 없게 된다"
    );
  });
});

// ═════════════════════════════════ 4·5. 화면에 그려지는 것

describe("고르기 단추가 있어야 할 때만 있다", () => {
  test("🔴 권한이 없으면(저장할 길이 없으면) 「고르기」가 없다", () => {
    const html = renderViewer({ withSave: false, count: 3 });
    assert.ok(!html.includes("고르기"), "권한 없이도 고르기가 보인다");
    assert.ok(!html.includes("전부 가로로"), "권한 없이도 전부 가로로가 보인다");
  });

  test("🔴 사진이 한 장뿐이면 「고르기」가 없다 — 고를 자리가 없다", () => {
    const html = renderViewer({ withSave: true, count: 1 });
    assert.ok(!html.includes("고르기"), "한 장짜리에 고르기가 생겼다");
  });

  test("권한이 있고 사진이 여럿이면 「고르기」가 있다 — 처음에는 꺼져 있다", () => {
    const html = renderViewer({ withSave: true, count: 3 });
    assert.ok(html.includes(">고르기<"), "고르기 단추가 없다");
    assert.ok(html.includes('aria-pressed="false"'), "처음부터 켜져 있다");
    // 꺼져 있으므로 고르기 전용 단추는 아직 없다.
    assert.ok(!html.includes("전부 가로로"), "꺼져 있는데 전부 가로로가 보인다");
    assert.ok(!html.includes("전부 세로로"), "꺼져 있는데 전부 세로로가 보인다");
  });

  test("🔴 꺼져 있는 첫 화면의 썸네일은 지금까지처럼 「보기」다", () => {
    const html = renderViewer({ withSave: true, count: 3 });
    assert.ok(html.includes('aria-label="사진2.jpg 보기"'), "썸네일이 보기가 아니다");
    assert.ok(!html.includes("고르기\""), "썸네일 이름표가 고르기로 바뀌었다");
  });

  test("저장 중에는 고르기 줄이 잠긴다", () => {
    const start = viewerSource.indexOf("{canPickMany && (");
    assert.ok(start >= 0, "고르기 줄이 없다");
    const block = viewerSource.slice(start, viewerSource.indexOf("\n        )}", start));
    assert.ok(block.includes("disabled={isSaving}"), "고르기 단추가 안 잠긴다");
    assert.equal(
      block.split("disabled={isSaving || pickedTotal === 0}").length - 1,
      2,
      "전부 가로로·전부 세로로 둘 다 잠기지는 않는다"
    );
  });
});

// ═════════════════════════════════ 확인 창 — 장수와 일부 실패

describe("확인 창", () => {
  function target(id: string, name: string, orientation = TURNED_RIGHT): SaveRotationTarget {
    return { id, displayName: name, orientation };
  }

  function renderDialog(
    targets: SaveRotationTarget[],
    extras: {
      outcome?: {
        total: number;
        saved: number;
        failures: { name: string; message: string }[];
      } | null;
      progress?: { current: number; total: number } | null;
      isSubmitting?: boolean;
    } = {}
  ): string {
    return renderToStaticMarkup(
      <SaveRotationDialog
        isOpen
        targets={targets}
        isSubmitting={extras.isSubmitting ?? false}
        progress={extras.progress ?? null}
        errorMessage={null}
        outcome={extras.outcome ?? null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
  }

  test("🔴 몇 장을 덮어쓰는지 확인 창에 나온다", () => {
    const html = renderDialog([
      target("a1", "하나.jpg"),
      target("a2", "둘.jpg"),
      target("a3", "셋.jpg"),
    ]);
    assert.ok(
      html.includes("3장의 원본을 덮어씁니다. 되돌릴 수 없습니다."),
      "장수가 없는 경고는 몇 장이 걸린 일인지 알려 주지 않는다"
    );
    assert.ok(html.includes("대상: "), "대상 줄이 없다");
    assert.ok(html.includes("3장"), "몇 장인지 안 보인다");
    assert.ok(html.includes("3장 덮어쓰고 저장"), "누르는 단추에도 장수가 있어야 한다");
  });

  test("사진마다 어느 방향으로 바뀌는지 한 줄씩 보인다 — 방향이 갈릴 수 있다", () => {
    const html = renderDialog([
      target("a1", "하나.jpg", TURNED_RIGHT),
      target("a2", "둘.jpg", { rotate: 180, flipX: true, flipY: false }),
    ]);
    assert.ok(html.includes("하나.jpg"), "파일 이름이 없다");
    assert.ok(html.includes("오른쪽으로 90도 회전"));
    assert.ok(html.includes("오른쪽으로 180도 회전 · 좌우 뒤집기"));
  });

  test("한 장짜리 문장은 예전 그대로다", () => {
    const html = renderDialog([target("a1", "외관.jpg")]);
    assert.ok(html.includes("원본 파일을 덮어씁니다. 되돌릴 수 없습니다."));
    assert.ok(html.includes("덮어쓰고 저장"));
    assert.ok(!html.includes("1장의 원본을 덮어씁니다"), "한 장짜리 문장이 바뀌었다");
  });

  test("여러 장을 저장하는 동안 어디까지 갔는지 보인다", () => {
    const html = renderDialog([target("a1", "하나.jpg"), target("a2", "둘.jpg")], {
      isSubmitting: true,
      progress: { current: 2, total: 5 },
    });
    assert.ok(html.includes("저장 중… 2/5"), "진행이 안 보인다");
  });
});

describe("🔴 일부만 실패했을 때 사람에게 보이는 것", () => {
  test("성공·실패 수가 한 줄로 읽힌다", () => {
    assert.equal(
      formatSaveOutcome({ total: 5, saved: 3, failures: [{ name: "a", message: "x" }, { name: "b", message: "y" }] }),
      "5장 중 3장 저장, 2장 실패"
    );
    assert.equal(
      formatSaveOutcome({ total: 2, saved: 0, failures: [{ name: "a", message: "x" }, { name: "b", message: "y" }] }),
      "2장 중 0장 저장, 2장 실패"
    );
  });

  test("어느 사진이 왜 막혔는지까지 창 안에 보인다", () => {
    const html = renderToStaticMarkup(
      <SaveRotationDialog
        isOpen
        targets={[{ id: "a2", displayName: "둘.jpg", orientation: TURNED_RIGHT }]}
        isSubmitting={false}
        progress={null}
        errorMessage={null}
        outcome={{
          total: 5,
          saved: 3,
          failures: [
            { name: "둘.jpg", message: "그 사이 이 파일이 바뀌었습니다." },
            { name: "넷.jpg", message: "출하 완료로 잠긴 접수 건입니다." },
          ],
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.ok(html.includes("5장 중 3장 저장, 2장 실패"), "어디까지 됐는지가 없다");
    assert.ok(html.includes("둘.jpg"), "실패한 파일 이름이 없다");
    assert.ok(html.includes("그 사이 이 파일이 바뀌었습니다."), "막힌 까닭이 없다");
    assert.ok(html.includes("넷.jpg"));
    assert.ok(html.includes("출하 완료로 잠긴 접수 건입니다."));
    assert.ok(
      html.includes("실패한 사진은 고른 채로 남겨 두었습니다"),
      "다시 시도할 수 있다는 것을 말해 주지 않는다"
    );
    assert.ok(html.includes('role="alert"'), "읽어 주는 장치가 놓친다");
  });
});
