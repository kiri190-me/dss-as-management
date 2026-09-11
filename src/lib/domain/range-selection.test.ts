import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRangeToggle,
  setIdsChecked,
  setIdsCheckedInList,
  type RangeToggleInput,
} from "./range-selection";

/**
 * ============================================================================
 * Shift 로 사이를 한꺼번에 고르는 규칙 — 값으로 못박는다
 * ============================================================================
 * 화면 열한 곳이 이 규칙 하나를 쓴다. 여기서 지키는 것:
 *  · 위→아래·아래→위 모두 기준점과 누른 항목 **사이 전부**가 맞춰진다.
 *  · 맞추는 상태는 **누른 항목의 새 상태**다 — 켜기도 끄기도 번진다.
 *  · 🔴 범위 **밖**의 선택은 그대로다.
 *  · 🔴 고를 수 없는 행은 범위 한가운데 있어도 켜지지 않는다.
 *  · 기준점이 없거나 지금 목록에서 사라졌으면 보통 누르기다.
 *  · 🔴 Shift 로 누른 것은 기준점을 옮기지 않는다.
 *  · 같은 id 가 두 번 담기지 않는다.
 * ============================================================================
 */

const ORDER = ["a", "b", "c", "d", "e", "f"];

function plan(overrides: Partial<RangeToggleInput> & { selected?: string[]; blocked?: string[] }) {
  const selected = new Set(overrides.selected ?? []);
  const blocked = new Set(overrides.blocked ?? []);
  return planRangeToggle({
    orderedIds: overrides.orderedIds ?? ORDER,
    isSelectable: overrides.isSelectable ?? ((id) => !blocked.has(id)),
    isSelected: overrides.isSelected ?? ((id) => selected.has(id)),
    anchorId: overrides.anchorId ?? null,
    targetId: overrides.targetId ?? "a",
    shiftKey: overrides.shiftKey ?? false,
  });
}

/** 여러 번 누른 것을 차례로 흘려 본다 — 화면의 훅이 하는 일과 같다. */
function clickThrough(
  clicks: { id: string; shift?: boolean }[],
  options: { orderedIds?: string[]; blocked?: string[]; initial?: string[] } = {}
) {
  let selected: Set<string> = new Set(options.initial ?? []);
  let anchorId: string | null = null;
  const blocked = new Set(options.blocked ?? []);
  for (const click of clicks) {
    const result = planRangeToggle({
      orderedIds: options.orderedIds ?? ORDER,
      isSelectable: (id) => !blocked.has(id),
      isSelected: (id) => selected.has(id),
      anchorId,
      targetId: click.id,
      shiftKey: click.shift ?? false,
    });
    if (result === null) continue;
    anchorId = result.anchorId;
    selected = setIdsChecked(selected, result.ids, result.nextChecked);
  }
  return { selected: [...selected].sort(), anchorId };
}

// ───────────────────────────── 보통 누르기

test("Shift 없이 누르면 그 하나만 뒤집고 기준점이 된다", () => {
  const result = plan({ targetId: "c", anchorId: "a" });
  assert.deepEqual(result, { ids: ["c"], nextChecked: true, anchorId: "c", isRange: false });

  const off = plan({ targetId: "c", selected: ["c"] });
  assert.deepEqual(off, { ids: ["c"], nextChecked: false, anchorId: "c", isRange: false });
});

// ───────────────────────────── 범위

test("위→아래: 기준점부터 누른 항목까지 전부 켜진다", () => {
  const result = plan({ anchorId: "b", targetId: "e", shiftKey: true, selected: ["b"] });
  assert.deepEqual(result?.ids, ["b", "c", "d", "e"]);
  assert.equal(result?.nextChecked, true);
  assert.equal(result?.isRange, true);

  assert.deepEqual(clickThrough([{ id: "b" }, { id: "e", shift: true }]).selected, ["b", "c", "d", "e"]);
});

test("아래→위: 방향이 거꾸로여도 같은 범위다 — 담기는 순서는 화면 순서", () => {
  const result = plan({ anchorId: "e", targetId: "b", shiftKey: true, selected: ["e"] });
  assert.deepEqual(result?.ids, ["b", "c", "d", "e"]);

  assert.deepEqual(clickThrough([{ id: "e" }, { id: "b", shift: true }]).selected, ["b", "c", "d", "e"]);
});

test("끄기도 번진다 — 누른 항목이 켜져 있었으면 범위를 끈다", () => {
  const result = plan({
    anchorId: "b",
    targetId: "e",
    shiftKey: true,
    selected: ["b", "c", "d", "e"],
  });
  assert.equal(result?.nextChecked, false);
  assert.deepEqual(result?.ids, ["b", "c", "d", "e"]);

  // 전부 켠 뒤 b 를 꺼 기준점으로 삼고, Shift 로 e 를 누르면 b~e 가 꺼진다.
  const after = clickThrough([{ id: "b" }, { id: "b" }, { id: "e", shift: true }], {
    initial: ["a", "b", "c", "d", "e", "f"],
  });
  assert.deepEqual(after.selected, ["a", "f"]);
});

test("맞추는 상태는 누른 항목의 새 상태다 — 범위 안이 섞여 있어도 한쪽으로 맞춘다", () => {
  // c 만 켜져 있다. 기준점 a, Shift 로 d(꺼짐) → 켜기로 맞춘다.
  const result = plan({ anchorId: "a", targetId: "d", shiftKey: true, selected: ["c"] });
  assert.equal(result?.nextChecked, true);
  assert.deepEqual(setIdsChecked(new Set(["c"]), result!.ids, result!.nextChecked), new Set(["a", "b", "c", "d"]));
});

test("🔴 범위 밖의 선택은 그대로 둔다", () => {
  const after = clickThrough([{ id: "f" }, { id: "b" }, { id: "d", shift: true }]);
  assert.deepEqual(after.selected, ["b", "c", "d", "f"], "f 는 범위 밖이라 남아 있어야 한다");

  // 끌 때도 같다 — 범위 밖에 켜 둔 a·f 는 그대로다.
  const off = clickThrough([{ id: "c" }, { id: "c" }, { id: "e", shift: true }], {
    initial: ["a", "b", "c", "d", "e", "f"],
  });
  assert.deepEqual(off.selected, ["a", "b", "f"]);
});

test("🔴 고를 수 없는 행은 범위 한가운데 있어도 건너뛴다", () => {
  const result = plan({ anchorId: "a", targetId: "e", shiftKey: true, selected: ["a"], blocked: ["c", "d"] });
  assert.deepEqual(result?.ids, ["a", "b", "e"]);

  const after = clickThrough([{ id: "a" }, { id: "f", shift: true }], { blocked: ["b", "e"] });
  assert.deepEqual(after.selected, ["a", "c", "d", "f"]);
});

test("고를 수 없는 항목을 누른 것은 아무 일도 없다 — 기준점도 그대로", () => {
  assert.equal(plan({ targetId: "c", blocked: ["c"] }), null);

  const after = clickThrough([{ id: "a" }, { id: "c" }, { id: "e", shift: true }], { blocked: ["c"] });
  // c 는 눌리지 않았으므로 기준점은 a 에 남아 a~e(c 제외)가 켜진다.
  assert.deepEqual(after.selected, ["a", "b", "d", "e"]);
});

// ───────────────────────────── 기준점

test("기준점이 없으면 Shift 여도 보통 누르기다", () => {
  const result = plan({ anchorId: null, targetId: "d", shiftKey: true });
  assert.deepEqual(result, { ids: ["d"], nextChecked: true, anchorId: "d", isRange: false });
});

test("기준점이 지금 목록에서 사라졌으면(검색·페이지·삭제) 보통 누르기다", () => {
  const result = plan({ orderedIds: ["c", "d", "e"], anchorId: "a", targetId: "e", shiftKey: true });
  assert.deepEqual(result, { ids: ["e"], nextChecked: true, anchorId: "e", isRange: false });

  // 페이지를 넘나드는 범위는 만들지 않는다: 1쪽의 a 를 기준점으로 두고 2쪽에서
  // Shift 로 누르면 그 하나만 켜진다.
  const firstPage = ["a", "b", "c"];
  const secondPage = ["d", "e", "f"];
  let selected = new Set<string>();
  const first = planRangeToggle({
    orderedIds: firstPage,
    isSelectable: () => true,
    isSelected: (id) => selected.has(id),
    anchorId: null,
    targetId: "a",
    shiftKey: false,
  })!;
  selected = setIdsChecked(selected, first.ids, first.nextChecked);
  const second = planRangeToggle({
    orderedIds: secondPage,
    isSelectable: () => true,
    isSelected: (id) => selected.has(id),
    anchorId: first.anchorId,
    targetId: "e",
    shiftKey: true,
  })!;
  selected = setIdsChecked(selected, second.ids, second.nextChecked);
  assert.deepEqual([...selected].sort(), ["a", "e"]);
});

test("🔴 Shift 로 누른 것은 기준점을 옮기지 않는다 — 범위를 고쳐 잡을 수 있다", () => {
  const result = plan({ anchorId: "b", targetId: "e", shiftKey: true, selected: ["b"] });
  assert.equal(result?.anchorId, "b");

  // b 기준으로 f 까지 켰다가 너무 멀리 잡은 걸 알고, 다시 Shift 로 d 를 누르면
  // (d 가 켜져 있으므로) b~d 가 꺼진다. 기준점은 여전히 b 다.
  const after = clickThrough([{ id: "b" }, { id: "f", shift: true }, { id: "d", shift: true }]);
  assert.deepEqual(after.selected, ["e", "f"]);
  assert.equal(after.anchorId, "b");
});

test("기준점 자신을 Shift 로 누르면 그 하나만 뒤집힌다", () => {
  const result = plan({ anchorId: "c", targetId: "c", shiftKey: true, selected: ["c"] });
  assert.deepEqual(result?.ids, ["c"]);
  assert.equal(result?.nextChecked, false);
});

// ───────────────────────────── 중복 없음

test("같은 id 가 목록에 두 번 있어도 한 번만 담긴다", () => {
  const result = plan({ orderedIds: ["a", "b", "b", "c"], anchorId: "a", targetId: "c", shiftKey: true });
  assert.deepEqual(result?.ids, ["a", "b", "c"]);
});

test("Set 에 얹기: 이미 켜진 것은 한 번만, 받은 Set 은 그대로", () => {
  const before = new Set(["a", "b"]);
  const after = setIdsChecked(before, ["b", "c"], true);
  assert.deepEqual([...after].sort(), ["a", "b", "c"]);
  assert.deepEqual([...before].sort(), ["a", "b"], "원래 Set 을 고치면 React 가 바뀐 줄 모른다");
  assert.deepEqual([...setIdsChecked(after, ["a", "c"], false)], ["b"]);
});

test("배열에 얹기: 순서는 지키고 새로 켜진 것만 뒤에, 두 번 담지 않는다", () => {
  const before = ["c", "a"];
  assert.deepEqual(setIdsCheckedInList(before, ["a", "b", "b", "d"], true), ["c", "a", "b", "d"]);
  assert.deepEqual(setIdsCheckedInList(before, ["a", "x"], false), ["c"]);
  assert.deepEqual(before, ["c", "a"], "원래 배열을 고치면 React 가 바뀐 줄 모른다");
});
