import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareHumanNumberedCode,
  computeExecutionPosition,
  formatExecutionPositionLabel,
  sortByProcedureExecutionOrder,
  type ProcedureExecutionOrderKey,
} from "./procedure-execution-order";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

/**
 * 절차 실행 화면의 차례·자리 시험.
 *
 * 🔵 표본이 비어서 공짜로 통과하는 일이 없도록, 차례를 재는 시험은 **먼저
 * 「입력이 정답과 다른 차례인가」를 단언**한다. 입력이 이미 정렬돼 있으면
 * 정렬 함수가 아무 일도 안 해도 통과해 버린다.
 */

function key(overrides: Partial<ProcedureExecutionOrderKey> & { id: string }): ProcedureExecutionOrderKey {
  return {
    procedureSortOrder: null,
    nodeCode: null,
    addedAt: null,
    ...overrides,
  };
}

function ids(nodes: readonly ProcedureExecutionOrderKey[]): string[] {
  return nodes.map((n) => n.id);
}

// ---- 번호 비교 (자릿수) ----

test("compareHumanNumberedCode: 자릿수가 다른 번호를 사람이 읽는 차례로 — N-2 가 N-10 앞", () => {
  const scrambled = ["N-10", "N-2", "N-1", "N-21", "N-3"];
  // 표본 확인 — 글자 그대로 정렬하면 틀린 차례가 나오는 입력이어야 이 시험이 뜻이 있다.
  assert.deepEqual(
    [...scrambled].sort(),
    ["N-1", "N-10", "N-2", "N-21", "N-3"],
    "글자 정렬이 실제로 틀려야 이 시험이 무언가를 잰다"
  );

  assert.deepEqual([...scrambled].sort(compareHumanNumberedCode), ["N-1", "N-2", "N-3", "N-10", "N-21"]);
});

test("compareHumanNumberedCode: 실제 개발 DB 에 있는 엑셀 들여오기 번호(s11-*)도 숫자 차례로", () => {
  // 2026-11-02 실측값 — procedure_template_nodes.node_code 에 그대로 있는 꼴.
  const scrambled = ["s11-14", "s11-9", "s11-42", "s11-7", "s11-10"];
  assert.deepEqual(
    [...scrambled].sort(),
    ["s11-10", "s11-14", "s11-42", "s11-7", "s11-9"],
    "글자 정렬이 실제로 틀려야 이 시험이 무언가를 잰다"
  );

  assert.deepEqual([...scrambled].sort(compareHumanNumberedCode), ["s11-7", "s11-9", "s11-10", "s11-14", "s11-42"]);
});

test("compareHumanNumberedCode: 시트 번호가 먼저, 그 안에서 도형 번호 — s9-1 이 s11-1 앞", () => {
  assert.deepEqual(["s11-1", "s9-2", "s9-1"].sort(compareHumanNumberedCode), ["s9-1", "s9-2", "s11-1"]);
});

test("compareHumanNumberedCode: 앞의 0 과 아주 긴 숫자 — 값으로 재고 정밀도에 기대지 않는다", () => {
  assert.equal(compareHumanNumberedCode("n-007", "n-8") < 0, true, "7 < 8");
  assert.equal(compareHumanNumberedCode("n-007", "n-7") > 0, true, "값이 같으면 짧은 쪽(n-7)을 앞에 둬 차례만 고정한다");
  // Number 로 바꿨다면 둘 다 9007199254740992 가 되어 0(같음)이 나온다.
  assert.equal(
    compareHumanNumberedCode("n-9007199254740993", "n-9007199254740994") < 0,
    true,
    "자릿수가 큰 번호도 값으로 갈려야 한다"
  );
});

test("compareHumanNumberedCode: 같은 자리에서 숫자 덩이가 글자 덩이보다 앞", () => {
  assert.equal(compareHumanNumberedCode("a-1", "a-b") < 0, true);
  assert.equal(compareHumanNumberedCode("a-b", "a-1") > 0, true);
});

// ---- 노드 차례 ----

test("sortByProcedureExecutionOrder: 템플릿이 정한 차례(sort_order)가 번호보다 먼저다", () => {
  const nodes = [
    key({ id: "c", procedureSortOrder: 2, nodeCode: "n-1" }),
    key({ id: "a", procedureSortOrder: 0, nodeCode: "n-9" }),
    key({ id: "b", procedureSortOrder: 1, nodeCode: "n-5" }),
  ];
  assert.notDeepEqual(ids(nodes), ["a", "b", "c"], "입력이 이미 정답 차례면 이 시험은 아무것도 재지 않는다");

  assert.deepEqual(ids(sortByProcedureExecutionOrder(nodes)), ["a", "b", "c"]);
});

test("sortByProcedureExecutionOrder: sort_order 가 전부 같으면(기본값 0) 번호가 차례를 정한다 — 자릿수가 달라도", () => {
  const nodes = [
    key({ id: "ten", procedureSortOrder: 0, nodeCode: "N-10" }),
    key({ id: "two", procedureSortOrder: 0, nodeCode: "N-2" }),
    key({ id: "one", procedureSortOrder: 0, nodeCode: "N-1" }),
  ];
  assert.deepEqual(ids(sortByProcedureExecutionOrder(nodes)), ["one", "two", "ten"]);
});

test("sortByProcedureExecutionOrder: 템플릿에 없는 추가 작업은 언제나 뒤, 그들끼리는 더해진 차례", () => {
  const nodes = [
    key({ id: "extra-late", addedAt: "2026-11-02T10:00:00.000Z" }),
    key({ id: "last-step", procedureSortOrder: 99, nodeCode: "n-99" }),
    key({ id: "extra-early", addedAt: "2026-11-01T09:00:00.000Z" }),
    key({ id: "first-step", procedureSortOrder: 1, nodeCode: "n-1" }),
  ];
  assert.deepEqual(ids(sortByProcedureExecutionOrder(nodes)), ["first-step", "last-step", "extra-early", "extra-late"]);
});

test("🔴 sortByProcedureExecutionOrder: 번호가 비어 있어도(null·빈 글자) 깨지지 않고 뒤로 간다", () => {
  const nodes = [
    key({ id: "blank", procedureSortOrder: 0, nodeCode: "" }),
    key({ id: "missing", procedureSortOrder: 0, nodeCode: null }),
    key({ id: "numbered", procedureSortOrder: 0, nodeCode: "n-1" }),
  ];
  const sorted = sortByProcedureExecutionOrder(nodes);
  assert.equal(sorted.length, 3, "하나도 사라지지 않는다");
  assert.equal(sorted[0].id, "numbered", "번호가 있는 쪽이 앞");
  assert.deepEqual(ids(sorted).slice(1).sort(), ["blank", "missing"], "번호 없는 둘은 뒤에 남는다");
});

test("sortByProcedureExecutionOrder: 모든 열쇠가 같으면 id 로 갈라 — 같은 입력이면 언제나 같은 차례", () => {
  const nodes = [
    key({ id: "zz", procedureSortOrder: 0, nodeCode: "same" }),
    key({ id: "aa", procedureSortOrder: 0, nodeCode: "same" }),
    key({ id: "mm", procedureSortOrder: 0, nodeCode: "same" }),
  ];
  assert.deepEqual(ids(sortByProcedureExecutionOrder(nodes)), ["aa", "mm", "zz"]);
  // 입력 차례를 바꿔도 결과가 같아야 한다 — 새로고침마다 카드가 춤추면 안 된다.
  assert.deepEqual(ids(sortByProcedureExecutionOrder([...nodes].reverse())), ["aa", "mm", "zz"]);
});

test("sortByProcedureExecutionOrder: 원본 배열을 건드리지 않는다", () => {
  const nodes = [
    key({ id: "b", procedureSortOrder: 1 }),
    key({ id: "a", procedureSortOrder: 0 }),
  ];
  const sorted = sortByProcedureExecutionOrder(nodes);
  assert.deepEqual(ids(nodes), ["b", "a"], "원본은 그대로");
  assert.deepEqual(ids(sorted), ["a", "b"]);
});

test("sortByProcedureExecutionOrder: 실제 절차 크기(22개)에서 처음부터 끝까지 빠짐없이 늘어선다", () => {
  // 2026-11-02 실측 — 실행되는 「원복 검사 및 개선 작업 (3상 입력)」이
  // START 를 뺀 22개다. 템플릿의 sort_order 는 1..22(0 은 START).
  const expected = Array.from({ length: 22 }, (_, i) => `node-${i + 1}`);
  const shuffled = [...expected].reverse().map((id, i) =>
    key({ id, procedureSortOrder: 22 - i, nodeCode: `manual-${id}` })
  );
  assert.notDeepEqual(ids(shuffled), expected, "입력이 뒤집혀 있어야 정렬이 무언가를 한다");

  const sorted = sortByProcedureExecutionOrder(shuffled);
  assert.equal(sorted.length, 22);
  assert.deepEqual(ids(sorted), expected);
});

// ---- 「몇 번째 / 전체」 ----

function statuses(list: ProcedureCaseExecutionNodeStatus[]) {
  return list.map((status) => ({ status }));
}

test("computeExecutionPosition: 하나도 안 끝났으면 1번째", () => {
  const position = computeExecutionPosition(statuses(["PENDING", "PENDING", "PENDING"]));
  assert.deepEqual(position, { total: 3, finished: 0, current: 1 });
  assert.equal(formatExecutionPositionLabel(position), "1번째 / 전체 3");
});

test("computeExecutionPosition: 끝난 것은 완료와 건너뜀뿐 — 진행 중·차단됨은 아직 안 끝났다", () => {
  const position = computeExecutionPosition(
    statuses(["COMPLETED", "SKIPPED", "COMPLETED", "IN_PROGRESS", "BLOCKED", "PENDING"])
  );
  assert.equal(position.total, 6);
  assert.equal(position.finished, 3, "완료 2 + 건너뜀 1");
  assert.equal(position.current, 4, "셋 끝냈으니 지금은 네 번째");
  assert.equal(formatExecutionPositionLabel(position), "4번째 / 전체 6");
});

test("🔴 computeExecutionPosition: 전부 끝났으면 1 을 더하지 않는다 — 「24번째 / 23」이 나오면 안 된다", () => {
  const all = statuses(Array.from({ length: 23 }, (_, i) => (i % 2 === 0 ? "COMPLETED" : "SKIPPED")));
  const position = computeExecutionPosition(all);
  assert.equal(position.total, 23);
  assert.equal(position.finished, 23);
  assert.equal(position.current, null, "다 끝난 자리는 번호가 없다");
  assert.equal(formatExecutionPositionLabel(position), "23 / 23 · 끝");
});

test("🔴 computeExecutionPosition: 마지막 하나 직전까지는 번호가 전체를 넘지 않는다", () => {
  for (let total = 1; total <= 23; total += 1) {
    for (let finished = 0; finished < total; finished += 1) {
      const list: ProcedureCaseExecutionNodeStatus[] = [
        ...Array.from({ length: finished }, () => "COMPLETED" as const),
        ...Array.from({ length: total - finished }, () => "PENDING" as const),
      ];
      const position = computeExecutionPosition(statuses(list));
      assert.equal(position.current !== null, true, `${finished}/${total} 는 아직 남았다`);
      assert.equal(
        (position.current as number) <= total,
        true,
        `${finished}/${total} 에서 번호(${position.current})가 전체를 넘었다`
      );
    }
  }
});

test("computeExecutionPosition: 노드가 하나도 없으면 적을 글자가 없다", () => {
  const position = computeExecutionPosition([]);
  assert.deepEqual(position, { total: 0, finished: 0, current: null });
  assert.equal(formatExecutionPositionLabel(position), null, "「0번째 / 전체 0」 같은 글자를 만들어 내지 않는다");
});
