import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderSelection,
  selectionLabels,
  selectionSummary,
  toggleSelection,
  watchDropdownDismiss,
  type CheckboxFilterOption,
  type DropdownDismissHandle,
} from "./checkbox-filter-dropdown";

/**
 * 체크박스 드롭다운의 **값으로 도는 부분**(2026-11-11 복수 선택).
 *
 * 그리는 쪽은 CheckboxFilterDropdown.test.tsx 가 본다 — 저쪽은 정적 렌더라
 * 첫 화면밖에 못 재므로, 누르고 난 뒤의 값과 접기 규칙은 전부 여기 있다.
 */

const STATUS_OPTIONS: CheckboxFilterOption[] = [
  { value: "RECEIVED", label: "접수" },
  { value: "REPAIRING", label: "수리 중" },
  { value: "INSPECTING", label: "검사 중" },
  { value: "WAITING_SHIPMENT", label: "출하 대기" },
  { value: "SHIPPED", label: "출하 완료" },
];

// ─────────────────────────────────────────────── 닫힌 칸에 적히는 글자

test("🔴 하나도 안 고르면 「전체」다 — 빈 선택 = 아무것도 안 거는 것", () => {
  assert.equal(selectionSummary(STATUS_OPTIONS, []), "전체");
  // 부르는 쪽이 다른 글자를 쓸 수도 있다(기타건 필터가 그럴 수 있다).
  assert.equal(selectionSummary(STATUS_OPTIONS, [], "제한 없음"), "제한 없음");
});

test("🔴 하나만 고르면 그 이름 그대로다 — 「… 외 0개」가 되면 안 된다", () => {
  assert.equal(selectionSummary(STATUS_OPTIONS, ["REPAIRING"]), "수리 중");
  assert.ok(!selectionSummary(STATUS_OPTIONS, ["REPAIRING"]).includes("외"));
});

test("🔴 여럿 고르면 「첫째 이름 외 N개」", () => {
  assert.equal(
    selectionSummary(STATUS_OPTIONS, ["RECEIVED", "REPAIRING", "INSPECTING", "WAITING_SHIPMENT"]),
    "접수 외 3개"
  );
  assert.equal(selectionSummary(STATUS_OPTIONS, ["RECEIVED", "SHIPPED"]), "접수 외 1개");
});

test("🔴 누른 차례가 달라도 같은 글자가 적힌다 — 선택지의 차례로 세운다", () => {
  // 고른 차례를 그대로 쓰면 같은 조합인데 누른 순서에 따라 다른 글자가 적힌다.
  const a = selectionSummary(STATUS_OPTIONS, ["REPAIRING", "RECEIVED"]);
  const b = selectionSummary(STATUS_OPTIONS, ["RECEIVED", "REPAIRING"]);
  assert.equal(a, b);
  assert.equal(a, "접수 외 1개");
});

test("🔴 선택지에 없는 값도 세고 보인다 — 조용히 사라지면 못 푸는 필터가 된다", () => {
  // 버리면 칸에는 「전체」라고 적히는데 목록은 걸러진 채로 남는다.
  assert.equal(selectionSummary(STATUS_OPTIONS, ["GONE"]), "GONE");
  assert.equal(selectionSummary(STATUS_OPTIONS, ["RECEIVED", "GONE"]), "접수 외 1개");
  assert.deepEqual(selectionLabels(STATUS_OPTIONS, ["GONE", "RECEIVED"]), ["접수", "GONE"]);
});

// ─────────────────────────────────────────────── 체크를 눌렀을 때의 다음 값

test("체크를 누르면 더해지고 다시 누르면 빠진다", () => {
  assert.deepEqual(toggleSelection(STATUS_OPTIONS, [], "REPAIRING"), ["REPAIRING"]);
  assert.deepEqual(toggleSelection(STATUS_OPTIONS, ["REPAIRING"], "REPAIRING"), []);
  assert.deepEqual(toggleSelection(STATUS_OPTIONS, ["REPAIRING"], "RECEIVED"), [
    "RECEIVED",
    "REPAIRING",
  ]);
});

test("🔴 원본 배열을 건드리지 않는다 — 상태를 그 자리에서 고치면 React 가 다시 안 그린다", () => {
  const before = ["REPAIRING"];
  const after = toggleSelection(STATUS_OPTIONS, before, "RECEIVED");
  assert.deepEqual(before, ["REPAIRING"], "받은 배열이 바뀌었다");
  assert.notEqual(after, before, "같은 배열을 돌려주면 화면이 안 바뀐다");
});

test("🔴 단축 단추로 채운 뒤에도 하나씩 빼고 더할 수 있다", () => {
  // 단축 단추는 체크 칸이 아니라 **값을 갈아 끼우는 단추**라, 누른 뒤에 남는 것은
  // 그냥 「여럿 고른 상태」여야 한다(2026-11-11 사용자 결정). 그 성질을 값으로 잰다.
  const filled = ["RECEIVED", "REPAIRING", "INSPECTING", "WAITING_SHIPMENT"];
  assert.deepEqual(toggleSelection(STATUS_OPTIONS, filled, "REPAIRING"), [
    "RECEIVED",
    "INSPECTING",
    "WAITING_SHIPMENT",
  ]);
  assert.deepEqual(toggleSelection(STATUS_OPTIONS, filled, "SHIPPED"), [
    "RECEIVED",
    "REPAIRING",
    "INSPECTING",
    "WAITING_SHIPMENT",
    "SHIPPED",
  ]);
});

test("같은 값이 두 번 들어와도 한 번만 남는다", () => {
  assert.deepEqual(orderSelection(STATUS_OPTIONS, ["RECEIVED", "RECEIVED"]), ["RECEIVED"]);
});

test("선택지에 없는 값은 버리지 않고 뒤에 둔다", () => {
  assert.deepEqual(orderSelection(STATUS_OPTIONS, ["GONE", "REPAIRING", "RECEIVED"]), [
    "RECEIVED",
    "REPAIRING",
    "GONE",
  ]);
});

// ─────────────────────────────────────────────── 바깥 누르기 · Esc 로 접기
//
// 진짜 DOM 없이 잰다 — 듣는 곳과 드롭다운을 가짜로 넣는다(이 저장소에는 jsdom 이
// 없다). @dss/ui 의 service-menu/DropdownDismiss.test.tsx 와 같은 방법이다.

type Listener = (event: Event) => void;

function fakeHost() {
  const listeners = new Map<string, Listener[]>();
  return {
    host: {
      addEventListener(type: string, listener: Listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: Listener) {
        listeners.set(type, (listeners.get(type) ?? []).filter((one) => one !== listener));
      },
    },
    types: () => [...listeners.keys()].sort(),
    count: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
    fire(type: string, event: Partial<Event> & Record<string, unknown>) {
      for (const listener of listeners.get(type) ?? []) listener(event as unknown as Event);
    },
  };
}

/**
 * 「안」으로 칠 자리 하나와 「바깥」 하나. 진짜 DOM 마디가 아니라 **같은 것인지만**
 * 가리는 표식이다 — contains 가 받는 것이 EventTarget 이라 그 모양으로만 싼다.
 */
const INSIDE = { where: "inside" } as unknown as EventTarget;
const OUTSIDE = { where: "outside" } as unknown as EventTarget;

function fakeDropdown(closed: ("outside" | "escape")[]): DropdownDismissHandle {
  return {
    contains: (node) => node === INSIDE,
    dismiss: (reason) => closed.push(reason),
  };
}

test("🔴 바깥을 누르면 접힌다", () => {
  const closed: ("outside" | "escape")[] = [];
  const fake = fakeHost();
  watchDropdownDismiss(fake.host, fakeDropdown(closed));

  fake.fire("pointerdown", { target: OUTSIDE });
  assert.deepEqual(closed, ["outside"]);
});

test("🔴 안을 누르면 안 접힌다 — 접히면 복수 선택을 할 수가 없다", () => {
  // 이 부품이 있는 까닭 그 자체다. 체크를 하나 누를 때마다 접히면 둘째를 고르려고
  // 매번 다시 펼쳐야 한다.
  const closed: ("outside" | "escape")[] = [];
  const fake = fakeHost();
  watchDropdownDismiss(fake.host, fakeDropdown(closed));

  fake.fire("pointerdown", { target: INSIDE });
  fake.fire("pointerdown", { target: INSIDE });
  assert.deepEqual(closed, [], "안을 눌렀는데 접혔다");
});

test("🔴 Esc 로 접힌다 — 바깥을 누를 수 없는 키보드 사용자에게는 닫을 유일한 길이다", () => {
  const closed: ("outside" | "escape")[] = [];
  const fake = fakeHost();
  watchDropdownDismiss(fake.host, fakeDropdown(closed));

  // 안에 초점이 있어도 접힌다 — 접기 자리를 target 으로 가르지 않는다.
  fake.fire("keydown", { key: "Escape", target: INSIDE });
  assert.deepEqual(closed, ["escape"]);
});

test("Esc 말고 다른 키에는 안 접힌다", () => {
  const closed: ("outside" | "escape")[] = [];
  const fake = fakeHost();
  watchDropdownDismiss(fake.host, fakeDropdown(closed));

  for (const key of ["Enter", " ", "Tab", "ArrowDown", "Esc"]) {
    fake.fire("keydown", { key, target: OUTSIDE });
  }
  // 🔵 "Esc" 는 옛 브라우저의 이름이다. 지금 쓰는 값은 "Escape" 하나뿐이고,
  //    둘 다 받게 하면 무엇이 진짜인지 모른 채로 굳는다.
  assert.deepEqual(closed, []);
});

test("🔴 접는 까닭을 함께 알려 준다 — 초점을 돌려줄지가 갈린다", () => {
  // 바깥을 눌러 접을 때 초점을 단추로 돌려주면 방금 누른 칸에서 초점을 빼앗아,
  // 글자를 치려고 누른 입력칸에 글자가 안 들어간다.
  const closed: ("outside" | "escape")[] = [];
  const fake = fakeHost();
  watchDropdownDismiss(fake.host, fakeDropdown(closed));

  fake.fire("pointerdown", { target: OUTSIDE });
  fake.fire("keydown", { key: "Escape", target: OUTSIDE });
  assert.deepEqual(closed, ["outside", "escape"]);
});

test("🔴 폰까지 한 번에 받으려고 pointerdown 을 듣는다 — click 은 iOS 에서 문서까지 오지 않는다", () => {
  const fake = fakeHost();
  watchDropdownDismiss(fake.host, fakeDropdown([]));
  assert.deepEqual(fake.types(), ["keydown", "pointerdown"]);
});

test("🔴 뒷정리가 절반이다 — 떼면 하나도 안 남는다", () => {
  // 떼지 않으면 화면을 오갈수록 리스너가 쌓여 누를 때마다 하는 일이 는다.
  // 이 칸은 한 화면에 일곱까지 늘어날 예정이다.
  const closed: ("outside" | "escape")[] = [];
  const fake = fakeHost();
  const stop = watchDropdownDismiss(fake.host, fakeDropdown(closed));

  assert.equal(fake.count(), 2);
  stop();
  assert.equal(fake.count(), 0, "떼어낼 때 같은 리스너를 못 찾았다");

  fake.fire("pointerdown", { target: OUTSIDE });
  fake.fire("keydown", { key: "Escape", target: OUTSIDE });
  assert.deepEqual(closed, [], "뗐는데도 사건이 왔다");
});
