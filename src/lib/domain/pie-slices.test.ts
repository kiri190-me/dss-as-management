import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_PIE_DETAIL,
  buildPieSlices,
  formatPieSliceLabel,
  type PieDetailHandlers,
  type PieSlice,
} from "./pie-slices";

/**
 * 이 시험이 지키는 것.
 *   1) **조각 건수의 합 = 넘겨받은 행 수.** 미입력을 버리거나 기타를 잘못 접으면
 *      이 등식이 먼저 깨진다.
 *   2) **각도의 합 = 360, 조각 사이에 틈이 없다.** 비율(%)을 반올림해 각도로 쓰면
 *      여기서 드러난다.
 *   3) **접힐 때 딸린 값도 함께 합쳐진다.** 이것이 이 모듈이 존재하는 까닭이다 —
 *      고장 증상 조각은 인수점검 결과를 달고 다니고, 기타로 접히면 그것들도
 *      합쳐져야 한다.
 *   4) **접기를 끌 수 있다.** 값이 넷뿐인 칸(유/무상)에 기타가 생기면 고장이다.
 */

type Row = { value: string | null; weight?: number };

function row(value: string | null, weight?: number): Row {
  return { value, weight };
}

const UNSPECIFIED = "미입력";
const OTHER = "기타";

function labelOf(r: Row): string | null {
  return r.value;
}

/** 딸린 값이 정말 합쳐지는지 보려고 쓰는 최소한의 누적기 — 무게의 합. */
const weightDetail: PieDetailHandlers<Row, { sum: number }> = {
  create: () => ({ sum: 0 }),
  add: (detail, r) => {
    detail.sum += r.weight ?? 0;
  },
  merge: (details) => ({ sum: details.reduce((acc, d) => acc + d.sum, 0) }),
};

function sumCounts(slices: readonly PieSlice<unknown>[]): number {
  return slices.reduce((acc, slice) => acc + slice.count, 0);
}

function find<TDetail>(slices: readonly PieSlice<TDetail>[], label: string): PieSlice<TDetail> {
  const slice = slices.find((s) => s.label === label);
  if (!slice) throw new Error(`'${label}' 조각이 없다`);
  return slice;
}

// ─────────────────────────────────────────────── 합이 맞는가

test("행이 하나도 없으면 빈 배열이다 — 0 으로 나누는 자리가 생기지 않는다", () => {
  const slices = buildPieSlices([], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.deepEqual(slices, []);
});

test("조각 건수의 합은 넘겨받은 행 수와 같다 — 미입력도 포함해서", () => {
  const rows = [row("가"), row("가"), row("나"), row(null), row("  "), row("\t\n")];
  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.equal(sumCounts(slices), rows.length);
  assert.equal(find(slices, UNSPECIFIED).count, 3);
});

test("null · 빈 문자열 · 공백뿐인 값은 전부 미입력 한 조각으로 모인다", () => {
  const slices = buildPieSlices([row(null), row(""), row("   "), row("\t\n")], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.equal(slices.length, 1);
  assert.equal(slices[0].label, UNSPECIFIED);
  assert.equal(slices[0].sliceKind, "UNSPECIFIED");
  assert.equal(slices[0].count, 4);
});

test("앞뒤 공백만 다른 두 값은 같은 조각이 되고, 이름표는 다듬은 원문 그대로다", () => {
  const slices = buildPieSlices([row("전원 인가 불가"), row(" 전원 인가 불가 ")], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.equal(slices.length, 1);
  // 가운데 공백은 건드리지 않는다.
  assert.equal(slices[0].label, "전원 인가 불가");
  assert.equal(slices[0].count, 2);
});

// ─────────────────────────────────────────────── 차례와 접기

test("기본 차례는 건수 많은 순, 같으면 이름 오름차순이다", () => {
  const slices = buildPieSlices([row("나"), row("나"), row("가"), row("다"), row("가")], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.deepEqual(
    slices.map((s) => [s.label, s.count]),
    [
      ["가", 2],
      ["나", 2],
      ["다", 1],
    ]
  );
});

test("상위 N 을 넘으면 기타로 접히고, 접힌 종류 수가 함께 나온다", () => {
  // 값 i 를 (20 - i)건씩 — 1번이 가장 많고 12번이 가장 적다.
  const rows: Row[] = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let n = 0; n < 20 - i; n += 1) rows.push(row(`값 ${String(i).padStart(2, "0")}`));
  }

  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    fold: { topLimit: 8, otherLabel: OTHER },
    detail: NO_PIE_DETAIL,
  });

  assert.equal(slices.length, 9);
  const other = slices[slices.length - 1];
  assert.equal(other.label, OTHER);
  assert.equal(other.sliceKind, "OTHER");
  // 9 · 10 · 11 · 12번이 접혔다 = 4종, 11 + 10 + 9 + 8 = 38건.
  assert.equal(other.foldedGroupCount, 4);
  assert.equal(other.count, 38);
  assert.equal(sumCounts(slices), rows.length);
});

test("정확히 상한만큼이면 접지 않는다 — 기타 조각이 생기지 않는다", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => row(`값 ${i}`));
  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    fold: { topLimit: 8, otherLabel: OTHER },
    detail: NO_PIE_DETAIL,
  });
  assert.equal(slices.length, 8);
  assert.equal(
    slices.find((s) => s.sliceKind === "OTHER"),
    undefined
  );
});

test("미입력은 건수가 가장 적어도 접히지 않고, 상위 N 셈에도 들어가지 않는다", () => {
  // 값 9종(각 5건) + 미입력 1건. 9종이라 상위 8 + 기타가 되는데, 미입력은 따로 남는다.
  const rows: Row[] = [];
  for (let i = 1; i <= 9; i += 1) {
    for (let n = 0; n < 5; n += 1) rows.push(row(`값 ${i}`));
  }
  rows.push(row(null));

  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    fold: { topLimit: 8, otherLabel: OTHER },
    detail: NO_PIE_DETAIL,
  });

  const unspecified = find(slices, UNSPECIFIED);
  assert.equal(unspecified.count, 1);
  assert.equal(unspecified.sliceKind, "UNSPECIFIED");
  // 기타에는 9번째 값만 들어간다 — 미입력이 섞이면 6건이 된다.
  const other = find(slices, OTHER);
  assert.equal(other.count, 5);
  assert.equal(other.foldedGroupCount, 1);
  // 차례: 값 8개 → 미입력 → 기타.
  assert.equal(slices[slices.length - 2].sliceKind, "UNSPECIFIED");
  assert.equal(slices[slices.length - 1].sliceKind, "OTHER");
});

test("fold 를 넘기지 않으면 종류가 아무리 많아도 접지 않는다", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 12; i += 1) rows.push(row(`값 ${i}`));

  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });

  assert.equal(slices.length, 12);
  assert.equal(
    slices.find((s) => s.sliceKind === "OTHER"),
    undefined
  );
});

test("valueOrder 는 건수를 무시하고 차례를 못 박는다 — 미입력은 언제나 그 뒤다", () => {
  const rows = [
    row("무상"),
    row("무상"),
    row("무상"),
    row("유상"),
    row("추후결정"),
    row(null),
    row(null),
    row(null),
    row(null),
  ];
  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: "미지정",
    valueOrder: ["유상", "일부유상", "무상", "추후결정"],
    detail: NO_PIE_DETAIL,
  });

  // 건수 순이었다면 무상(3) → 미지정(4)이 앞섰을 것이다.
  assert.deepEqual(
    slices.map((s) => s.label),
    ["유상", "무상", "추후결정", "미지정"]
  );
  // 건수 0 인 값(일부유상)은 조각을 만들지 않는다.
  assert.equal(
    slices.find((s) => s.label === "일부유상"),
    undefined
  );
});

test("valueOrder 에 없는 이름표는 뒤로 밀리고, 그들끼리는 건수 순이다", () => {
  const rows = [row("모름 B"), row("모름 B"), row("모름 A"), row("유상")];
  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: "미지정",
    valueOrder: ["유상", "무상"],
    detail: NO_PIE_DETAIL,
  });
  assert.deepEqual(
    slices.map((s) => s.label),
    ["유상", "모름 B", "모름 A"]
  );
});

// ─────────────────────────────────────────────── 딸린 값

test("조각마다 딸린 값이 모이고, 기타로 접힐 때 함께 합쳐진다", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 8; i += 1) {
    for (let n = 0; n < 10; n += 1) rows.push(row(`값 ${i}`, 1));
  }
  // 9 · 10번째 값이 기타로 접힌다.
  rows.push(row("값 9", 100));
  rows.push(row("값 10", 20));
  rows.push(row(null, 7));

  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    fold: { topLimit: 8, otherLabel: OTHER },
    detail: weightDetail,
  });

  assert.equal(find(slices, "값 1").detail.sum, 10);
  // 접힌 두 조각의 딸린 값이 합쳐졌다.
  const other = find(slices, OTHER);
  assert.equal(other.detail.sum, 120);
  assert.equal(find(slices, UNSPECIFIED).detail.sum, 7);
});

test("NO_PIE_DETAIL 을 넘기면 조각의 딸린 값은 null 이다", () => {
  const slices = buildPieSlices([row("가")], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.equal(slices[0].detail, null);
});

// ─────────────────────────────────────────────── key

test("React key 는 성격을 앞에 붙여 같은 이름표끼리 갈라 둔다", () => {
  // `기타`라고 **적힌 진짜 값**이 있고, 접힌 기타 조각도 함께 생기는 경우.
  const rows: Row[] = [];
  for (let i = 1; i <= 9; i += 1) {
    for (let n = 0; n < 5; n += 1) rows.push(row(`값 ${i}`));
  }
  rows.push(row("기타"), row("기타"), row("기타"), row("기타"), row("기타"), row("기타"));

  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    fold: { topLimit: 8, otherLabel: OTHER },
    detail: NO_PIE_DETAIL,
  });

  const keys = slices.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, `key 가 겹친다: ${keys.join(", ")}`);
  assert.ok(keys.includes("VALUE:기타"));
  assert.ok(keys.includes("OTHER:기타"));
});

// ─────────────────────────────────────────────── 각도

test("각도의 합은 360 이고, 조각은 앞 조각이 끝난 자리에서 시작한다", () => {
  // 3 · 3 · 1 — 어떻게 나눠도 딱 떨어지지 않아 반올림 오차가 드러난다.
  const rows = [row("가"), row("가"), row("가"), row("나"), row("나"), row("나"), row("다")];
  const slices = buildPieSlices(rows, {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });

  const sweepSum = slices.reduce((acc, s) => acc + s.sweepAngle, 0);
  assert.ok(Math.abs(sweepSum - 360) < 1e-9, `각도 합이 360 이 아니다: ${sweepSum}`);
  assert.equal(slices[0].startAngle, 0);
  for (let i = 1; i < slices.length; i += 1) {
    const prev = slices[i - 1];
    const gap = slices[i].startAngle - (prev.startAngle + prev.sweepAngle);
    assert.ok(Math.abs(gap) < 1e-9, `${i}번째 조각 앞에 틈이 있다: ${gap}`);
  }
});

test("조각이 하나뿐이면 그 조각이 360 도를 차지한다", () => {
  const slices = buildPieSlices([row("가")], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  assert.equal(slices[0].startAngle, 0);
  assert.equal(slices[0].sweepAngle, 360);
  assert.equal(slices[0].percentage, 100);
});

test("반올림한 비율의 합이 100 이 아닐 수 있다 — 각도는 그 값을 쓰지 않는다", () => {
  const slices = buildPieSlices([row("가"), row("나"), row("다")], {
    labelOf,
    unspecifiedLabel: UNSPECIFIED,
    detail: NO_PIE_DETAIL,
  });
  const percentSum = slices.reduce((acc, s) => acc + s.percentage, 0);
  assert.equal(Math.round(percentSum * 10) / 10, 99.9);
  const sweepSum = slices.reduce((acc, s) => acc + s.sweepAngle, 0);
  assert.ok(Math.abs(sweepSum - 360) < 1e-9, `각도 합이 360 이 아니다: ${sweepSum}`);
});

// ─────────────────────────────────────────────── 이름표

test("기타 이름표에만 접힌 종류 수가 붙는다", () => {
  assert.equal(
    formatPieSliceLabel({ sliceKind: "OTHER", label: "기타", foldedGroupCount: 3 }),
    "기타(3종)"
  );
  assert.equal(
    formatPieSliceLabel({ sliceKind: "UNSPECIFIED", label: "미입력", foldedGroupCount: 1 }),
    "미입력"
  );
  assert.equal(
    formatPieSliceLabel({ sliceKind: "VALUE", label: "전원 인가 불가", foldedGroupCount: 1 }),
    "전원 인가 불가"
  );
  // 대시보드는 값 조각을 `SYMPTOM` 이라 부른다 — 그것도 그대로 나가야 한다.
  assert.equal(
    formatPieSliceLabel({ sliceKind: "SYMPTOM", label: "기타", foldedGroupCount: 1 }),
    "기타"
  );
});
