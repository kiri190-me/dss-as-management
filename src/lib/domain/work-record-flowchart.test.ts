import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkRecordFlowchart,
  listWorkRecordIdsInFlowchart,
  toWorkRecordIdFromFlowchartNodeId,
  workRecordFlowchartMatchesSeenRecords,
  WORK_RECORD_FLOWCHART_END_NODE_ID,
  WORK_RECORD_FLOWCHART_START_NODE_ID,
  type WorkRecordFlowchartInput,
} from "./work-record-flowchart";

function record(overrides: Partial<WorkRecordFlowchartInput> & Pick<WorkRecordFlowchartInput, "id">): WorkRecordFlowchartInput {
  return {
    memo: "기본 메모",
    recordKind: "GENERAL",
    createdAt: "2026-09-01T00:00:00.000Z",
    isInvalidated: false,
    ...overrides,
  };
}

/** 시작·종료를 뺀 가운데 칸들 — 기록 하나당 하나다. */
function recordNodes(nodes: ReturnType<typeof buildWorkRecordFlowchart>["nodes"]) {
  return nodes.filter((n) => n.id !== WORK_RECORD_FLOWCHART_START_NODE_ID && n.id !== WORK_RECORD_FLOWCHART_END_NODE_ID);
}

test("오래된 기록이 위 — 조회가 주는 최신순을 그대로 뒤집어 그린다", () => {
  // getWorkRecordHistoryForCase 는 created_at DESC 로 준다. 화면은 시간 순으로
  // 읽어야 하므로 이 함수가 스스로 뒤집는다(부르는 쪽의 정렬을 믿지 않는다).
  const { nodes } = buildWorkRecordFlowchart([
    record({ id: "c", memo: "셋째", createdAt: "2026-09-03T00:00:00.000Z" }),
    record({ id: "a", memo: "첫째", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "b", memo: "둘째", createdAt: "2026-09-02T00:00:00.000Z" }),
  ]);

  assert.deepEqual(
    recordNodes(nodes).map((n) => n.title),
    ["첫째", "둘째", "셋째"]
  );
  assert.equal(nodes[0].id, WORK_RECORD_FLOWCHART_START_NODE_ID);
  assert.equal(nodes[0].nodeType, "START");
  assert.equal(nodes[nodes.length - 1].id, WORK_RECORD_FLOWCHART_END_NODE_ID);
  assert.equal(nodes[nodes.length - 1].nodeType, "END");
});

test("같은 시각의 두 기록도 언제나 같은 순서 — id 로 갈린다", () => {
  const sameMoment = "2026-09-01T09:00:00.000Z";
  const first = buildWorkRecordFlowchart([
    record({ id: "bbbb", memo: "나중", createdAt: sameMoment }),
    record({ id: "aaaa", memo: "먼저", createdAt: sameMoment }),
  ]);
  const second = buildWorkRecordFlowchart([
    record({ id: "aaaa", memo: "먼저", createdAt: sameMoment }),
    record({ id: "bbbb", memo: "나중", createdAt: sameMoment }),
  ]);

  assert.deepEqual(
    recordNodes(first.nodes).map((n) => n.title),
    ["먼저", "나중"]
  );
  assert.deepEqual(first.nodes, second.nodes);
});

test("칸 모양은 작성자가 고른 분류를 그대로 옮긴다 — 네 분류 전부", () => {
  // 메모 글은 일부러 분류와 어긋나게 적어 두었다. 글을 읽어 짐작하면 여기서
  // 걸린다(record_kind 는 "never inferred from memo text").
  const { nodes } = buildWorkRecordFlowchart([
    record({ id: "a", memo: "교체 완료", recordKind: "GENERAL", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "b", memo: "그냥 메모", recordKind: "INTAKE_INSPECTION_RESULT", createdAt: "2026-09-02T00:00:00.000Z" }),
    record({ id: "c", memo: "측정만 함", recordKind: "DIAGNOSIS_REPAIR_SUMMARY", createdAt: "2026-09-03T00:00:00.000Z" }),
    record({ id: "d", memo: "완료했음", recordKind: "NEXT_PLANNED_ACTION", createdAt: "2026-09-04T00:00:00.000Z" }),
  ]);

  assert.deepEqual(
    recordNodes(nodes).map((n) => n.nodeType),
    ["TASK", "INSPECTION", "CORRECTIVE_ACTION", "TASK"]
  );
});

test("무효 처리된 기록은 흐름도에 넣지 않는다 — 취소된 일을 그리면 사실과 다른 그림이 된다", () => {
  const { nodes, edges } = buildWorkRecordFlowchart([
    record({ id: "a", memo: "살아 있는 기록", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "b", memo: "무효 처리된 기록", createdAt: "2026-09-02T00:00:00.000Z", isInvalidated: true }),
    record({ id: "c", memo: "그 다음 기록", createdAt: "2026-09-03T00:00:00.000Z" }),
  ]);

  const titles = recordNodes(nodes).map((n) => n.title);
  assert.deepEqual(titles, ["살아 있는 기록", "그 다음 기록"]);
  assert.ok(!nodes.some((n) => n.description?.includes("무효 처리된 기록")));
  // 사슬도 무효 기록을 건너뛰고 곧바로 이어진다 — 끊긴 칸이 남지 않는다.
  assert.equal(edges.length, nodes.length - 1);
  for (const edge of edges) {
    assert.ok(nodes.some((n) => n.id === edge.fromNodeId));
    assert.ok(nodes.some((n) => n.id === edge.toNodeId));
  }
});

test("전부 무효면 칸을 하나도 만들지 않는다", () => {
  const { nodes, edges } = buildWorkRecordFlowchart([
    record({ id: "a", isInvalidated: true }),
    record({ id: "b", isInvalidated: true }),
  ]);
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test("기록이 0건이면 시작·종료 칸도 만들지 않는다", () => {
  // 시작→종료만 남은 빈 흐름도를 그리면 "아무 기록도 없다"가 "여기서 시작해서
  // 여기서 끝났다"로 읽힌다. 그릴 것이 없으면 아무것도 돌려주지 않는다.
  assert.deepEqual(buildWorkRecordFlowchart([]), { nodes: [], edges: [] });
});

test("여러 줄 메모 — 제목은 첫 줄, 설명은 전문 그대로", () => {
  const memo = "전원부 재측정\n입력 12.1V 정상\n출력 리플 과다 — 커패시터 의심";
  const { nodes } = buildWorkRecordFlowchart([record({ id: "a", memo })]);
  const [node] = recordNodes(nodes);

  assert.equal(node.title, "전원부 재측정");
  assert.equal(node.description, memo);
});

test("긴 첫 줄은 잘리지만 잘린 글자는 설명에 그대로 남는다", () => {
  const longFirstLine = "가".repeat(50);
  const memo = `${longFirstLine}\n둘째 줄`;
  const { nodes } = buildWorkRecordFlowchart([record({ id: "a", memo })]);
  const [node] = recordNodes(nodes);

  assert.equal(node.title, `${"가".repeat(30)}…`);
  assert.equal(node.title.length, 31);
  assert.equal(node.description, memo);
});

test("상한과 꼭 같은 길이의 첫 줄은 자르지 않는다 — 말줄임표가 괜히 붙지 않는다", () => {
  const exact = "나".repeat(30);
  const { nodes } = buildWorkRecordFlowchart([record({ id: "a", memo: exact })]);
  assert.equal(recordNodes(nodes)[0].title, exact);
});

test("빈 줄로 시작하는 메모 — 제목이 빈 칸이 되지 않는다", () => {
  const memo = "\n   \n실제 내용은 셋째 줄부터";
  const { nodes } = buildWorkRecordFlowchart([record({ id: "a", memo })]);
  const [node] = recordNodes(nodes);

  assert.equal(node.title, "실제 내용은 셋째 줄부터");
  assert.equal(node.description, memo);
});

test("id 는 결정적이다 — 같은 입력이면 칸도 연결선도 글자 하나까지 같다", () => {
  // 다시 그릴 때마다 id 가 바뀌면 React Flow 가 칸을 통째로 새로 만들어
  // 선택·화면 위치가 튄다.
  const input = [
    record({ id: "11111111-1111-1111-1111-111111111111", memo: "하나", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "22222222-2222-2222-2222-222222222222", memo: "둘", createdAt: "2026-09-02T00:00:00.000Z" }),
  ];

  assert.deepEqual(buildWorkRecordFlowchart(input), buildWorkRecordFlowchart(input));
  const { nodes, edges } = buildWorkRecordFlowchart(input);
  assert.ok(nodes.some((n) => n.id.includes("11111111-1111-1111-1111-111111111111")));
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length);
  assert.equal(new Set(edges.map((e) => e.id)).size, edges.length);
});

test("연결선은 위에서 아래로 한 줄기 DEFAULT 사슬 — 갈림길이 없다", () => {
  const { nodes, edges } = buildWorkRecordFlowchart([
    record({ id: "a", memo: "하나", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "b", memo: "둘", createdAt: "2026-09-02T00:00:00.000Z" }),
  ]);

  assert.equal(nodes.length, 4); // 시작 + 기록 둘 + 현재까지
  assert.equal(edges.length, 3);
  assert.deepEqual(
    edges.map((e) => e.branchType),
    ["DEFAULT", "DEFAULT", "DEFAULT"]
  );
  assert.deepEqual(
    edges.map((e) => [e.fromNodeId, e.toNodeId]),
    [
      [nodes[0].id, nodes[1].id],
      [nodes[1].id, nodes[2].id],
      [nodes[2].id, nodes[3].id],
    ]
  );
  // 어떤 칸도 나가는 선이 둘일 수 없다.
  assert.equal(new Set(edges.map((e) => e.fromNodeId)).size, edges.length);
  for (const edge of edges) {
    assert.equal(edge.branchLabel, null);
    assert.equal(edge.routePoints, null);
  }
});

test("칸은 세로로 겹치지 않게 놓인다", () => {
  const { nodes } = buildWorkRecordFlowchart([
    record({ id: "a", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "b", createdAt: "2026-09-02T00:00:00.000Z" }),
    record({ id: "c", createdAt: "2026-09-03T00:00:00.000Z" }),
  ]);

  const xs = new Set(nodes.map((n) => n.positionX));
  assert.equal(xs.size, 1); // 한 줄로 곧게 떨어진다
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    // 칸 높이는 제목 한 줄 기준 약 63px — 100px 이상 벌어지면 겹칠 수 없다.
    assert.ok(nodes[i + 1].positionY - nodes[i].positionY >= 100);
  }
});

test("입력 배열을 건드리지 않는다", () => {
  const input = [
    record({ id: "b", memo: "나중", createdAt: "2026-09-02T00:00:00.000Z" }),
    record({ id: "a", memo: "먼저", createdAt: "2026-09-01T00:00:00.000Z" }),
  ];
  const snapshot = input.map((r) => r.id);
  buildWorkRecordFlowchart(input);
  assert.deepEqual(
    input.map((r) => r.id),
    snapshot
  );
});

// ────────────────── 「본 그대로 저장」을 지키는 대조 (진짜 흐름도로 저장할 때)

/** 세 건짜리 흐름도 하나 — 아래 대조 시험들이 공통으로 쓰는 바탕. */
function threeRecords(): WorkRecordFlowchartInput[] {
  return [
    record({ id: "11111111-1111-1111-1111-111111111111", memo: "하나", createdAt: "2026-09-01T00:00:00.000Z" }),
    record({ id: "22222222-2222-2222-2222-222222222222", memo: "둘", createdAt: "2026-09-02T00:00:00.000Z" }),
    record({ id: "33333333-3333-3333-3333-333333333333", memo: "셋", createdAt: "2026-09-03T00:00:00.000Z" }),
  ];
}

test("칸 id 에서 기록 id 를 되찾는다 — 시작·현재까지 칸은 가리키는 기록이 없다", () => {
  const { nodes } = buildWorkRecordFlowchart(threeRecords());

  assert.equal(toWorkRecordIdFromFlowchartNodeId(WORK_RECORD_FLOWCHART_START_NODE_ID), null);
  assert.equal(toWorkRecordIdFromFlowchartNodeId(WORK_RECORD_FLOWCHART_END_NODE_ID), null);
  // 기록 칸은 정확히 그 기록의 id 로 되돌아온다 — 접두사만 벗는다.
  assert.deepEqual(listWorkRecordIdsInFlowchart(nodes), [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
  ]);
});

test("같으면 저장한다 — 화면이 본 목록과 서버가 다시 그린 목록이 일치", () => {
  const { nodes } = buildWorkRecordFlowchart(threeRecords());
  assert.equal(workRecordFlowchartMatchesSeenRecords(nodes, listWorkRecordIdsInFlowchart(nodes)), true);
});

test("사이에 기록이 하나 늘면 저장하지 않는다", () => {
  // 화면이 본 것은 세 건. 그 뒤 DB 에 한 건이 더 붙어 서버는 네 건을 그린다.
  const seen = listWorkRecordIdsInFlowchart(buildWorkRecordFlowchart(threeRecords()).nodes);
  const { nodes } = buildWorkRecordFlowchart([
    ...threeRecords(),
    record({ id: "44444444-4444-4444-4444-444444444444", memo: "넷", createdAt: "2026-09-04T00:00:00.000Z" }),
  ]);

  assert.equal(workRecordFlowchartMatchesSeenRecords(nodes, seen), false);
});

test("사이에 기록이 하나 빠지면(무효 처리) 저장하지 않는다", () => {
  const seen = listWorkRecordIdsInFlowchart(buildWorkRecordFlowchart(threeRecords()).nodes);
  const withOneInvalidated = threeRecords().map((r) =>
    r.id === "22222222-2222-2222-2222-222222222222" ? { ...r, isInvalidated: true } : r
  );
  const { nodes } = buildWorkRecordFlowchart(withOneInvalidated);

  assert.equal(workRecordFlowchartMatchesSeenRecords(nodes, seen), false);
});

test("개수가 같아도 순서가 다르면 저장하지 않는다 — 사이에 낀 기록을 놓치지 않는다", () => {
  // 개수만 세면 통과해 버리는 자리다. 화면이 본 차례와 서버가 그린 차례가
  // 다르면 사람이 본 그림과 저장될 그림이 서로 다른 그림이다.
  const { nodes } = buildWorkRecordFlowchart(threeRecords());
  const shuffled = [...listWorkRecordIdsInFlowchart(nodes)].reverse();

  assert.equal(shuffled.length, listWorkRecordIdsInFlowchart(nodes).length);
  assert.equal(workRecordFlowchartMatchesSeenRecords(nodes, shuffled), false);
});

test("화면이 아무것도 보내지 않았는데 그릴 것이 있으면 저장하지 않는다", () => {
  const { nodes } = buildWorkRecordFlowchart(threeRecords());
  assert.equal(workRecordFlowchartMatchesSeenRecords(nodes, []), false);
});
