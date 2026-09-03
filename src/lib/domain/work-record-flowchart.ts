import type { WorkRecordKind } from "./types";
import type { RepairCaseFlowchartNodeType } from "./repair-case-flowchart-types";
import type { CaseFlowchartGraphEdge, CaseFlowchartGraphNode } from "@/components/repair-cases/flowchart/CaseFlowchartGraph";

/**
 * 「작업 이력」의 작업 기록(repair_case_work_records)을 그대로 옮겨 그리는
 * 진단 흐름도 — **저장하지 않는다.**
 *
 * 저장하지 않는 것이 이 모듈의 존재 이유다. 작업 기록은 계속 늘어나므로
 * 흐름도를 repair_case_flowcharts/…_nodes/…_edges 에 한 번 만들어 두면 기록이
 * 하나 붙는 순간 낡은 것이 되고, 그때 다시 만들면 ⓐ 같은 흐름도가 쌓이거나
 * ⓑ 엔지니어가 손으로 고쳐 둔 흐름도를 덮어쓴다. ⓑ 는 사람이 적은 것을
 * 말없이 지우는 사고다. 그래서 이 모듈은 순수 함수 하나로만 존재하고,
 * 화면은 열 때마다 그 시점의 기록으로 다시 그린다. INSERT/UPDATE/DELETE 가
 * 하나도 없고, 편집 이력도 남기지 않는다(고치는 것이 없으므로).
 *
 * 칸 종류는 작성자가 고른 record_kind 를 **그대로 옮긴다**. 메모 글을 읽어
 * 종류를 짐작하지 않는다 — repair-case-work-records.ts 스키마 머리말이
 * record_kind 를 "never inferred from memo text" 라고 못 박아 둔 그 규약을
 * 읽는 쪽에서도 지키는 것이다. 같은 이유로 갈림길(DECISION/YES/NO)도 만들지
 * 않는다: 메모에서 갈림길을 알아내려면 그 글을 외부 AI 에 보내야 하는데,
 * 거기에는 고객사 장비의 진단 내용이 들어 있어 CLAUDE.md 의 보안 규칙
 * ("실제 고객 정보·회로도를 외부 서비스로 전송하지 않는다")과 정면으로
 * 부딪힌다. 그래서 흐름은 언제나 한 줄기 DEFAULT 사슬이다.
 *
 * 출력 타입은 CaseFlowchartGraph 가 받는 바로 그 두 타입이다(타입 전용
 * import 라 런타임에는 아무것도 끌어오지 않는다) — 그리개의 칸 모양이 바뀌면
 * 여기서 tsc 가 먼저 잡는다. DB 조회는 전혀 하지 않으므로 이 모듈은
 * server-only 가 아니고, 시험도 DB 없이 돈다.
 */

/**
 * 이 함수가 실제로 쓰는 칸만 추린 입력 — WorkRecordRow 는 이 다섯 칸을 모두
 * 가지고 있어 그대로 넘길 수 있다(구조적 할당, 부르는 쪽에서 tsc 가 확인).
 * WorkRecordRow 를 직접 import 하지 않는 이유는 그 모듈이 "server-only" 라
 * 시험이 서버 전용 그래프를 통째로 끌어오게 되기 때문이다.
 */
export type WorkRecordFlowchartInput = {
  id: string;
  memo: string;
  recordKind: WorkRecordKind;
  /** ISO 8601 (UTC, `Z` 접미사) — WorkRecordRow.createdAt 이 주는 형식 그대로. 같은 형식끼리는 문자열 비교가 곧 시간 비교다. */
  createdAt: string;
  isInvalidated: boolean;
};

export type WorkRecordFlowchart = {
  nodes: CaseFlowchartGraphNode[];
  edges: CaseFlowchartGraphEdge[];
};

/**
 * 흐름도를 그리려고 한 번에 읽어 오는 작업 기록의 상한. 새 조회를 만들지 않고
 * 기존 getWorkRecordHistoryForCase(limit/offset)를 그대로 쓰는데, 그 조회는
 * 최신순이라 상한에 걸리면 **가장 오래된 기록부터** 빠진다. 진단 흐름도 줄이
 * 보이는지 판정하는 목록 페이지와 실제로 그리는 화면이 같은 숫자를 써야 두
 * 화면이 어긋나지 않으므로 상수를 여기 한 곳에 둔다. 200 은 그 조회 자신이
 * 적어 둔 실제 규모("a handful to a few dozen rows per case")보다 넉넉하다 —
 * 그래도 넘치는 건이 있으면 화면이 잘렸다고 밝힌다.
 */
export const WORK_RECORD_FLOWCHART_MAX_RECORDS = 200;

/**
 * 저장되지 않는 흐름도라 DB id 가 없다 — id 는 이 함수가 짓는다. 같은 입력이면
 * 언제나 같은 id 가 나와야 한다(화면이 다시 그릴 때마다 id 가 바뀌면 React Flow
 * 가 칸을 통째로 새로 만들어 선택·시점이 튄다). 기록 칸은 기록의 id 를 그대로
 * 쓰고, 시작/종료는 아래 고정 id 를 쓴다. 접두사를 붙이는 것은 UUID 하나가
 * 시작/종료 id 와 우연히 같아질 여지를 없애기 위해서다.
 */
export const WORK_RECORD_FLOWCHART_START_NODE_ID = "work-record-flowchart:start";
export const WORK_RECORD_FLOWCHART_END_NODE_ID = "work-record-flowchart:end";

const RECORD_NODE_ID_PREFIX = "work-record-flowchart:record:";
const EDGE_ID_PREFIX = "work-record-flowchart:edge:";

/**
 * 작성자가 고른 분류 → 칸 모양. Record<WorkRecordKind, …> 로 두었으므로
 * record_kind 에 값이 하나 늘면 tsc 가 빠진 칸을 잡는다(조용히 GENERAL 로
 * 흘러가지 않는다).
 *
 * GENERAL 과 NEXT_PLANNED_ACTION 이 둘 다 TASK 인 것은 의도한 것이다 —
 * 이 흐름도의 칸 모양은 일곱 가지뿐이라 네 분류가 일대일로 대응하지 않는다.
 * 어느 쪽인지는 칸 안의 제목·설명(메모)이 말해 준다.
 */
const NODE_TYPE_BY_RECORD_KIND: Record<WorkRecordKind, RepairCaseFlowchartNodeType> = {
  GENERAL: "TASK",
  INTAKE_INSPECTION_RESULT: "INSPECTION",
  DIAGNOSIS_REPAIR_SUMMARY: "CORRECTIVE_ACTION",
  NEXT_PLANNED_ACTION: "TASK",
};

/**
 * 칸 제목의 글자 수 상한. 칸 폭에는 상한이 없어(procedure-visual-language.ts
 * 의 computeNodeDimensions — "가로폭 상한은 없다") 제목이 길면 칸이 그대로
 * 넓어진다. 한글은 글자당 약 13px 로 잡히므로 30자면 400px 남짓 — 한 화면에
 * 세로로 늘어놓아도 읽히는 폭이다. 잘린 글자는 사라지지 않는다: 메모 전문이
 * description 에 그대로 들어가고, 칩의 tooltip 이 "제목 — 설명"을 다 보여준다.
 */
const TITLE_MAX_LENGTH = 30;
const TITLE_ELLIPSIS = "…";
/** 메모가 온통 빈 줄일 때의 제목. DB 의 memo_not_blank 검사 때문에 실제로는 일어나지 않지만, 제목이 빈 칸이 되면 칸이 이름 없는 상자가 되므로 방어적으로 둔다. */
const TITLE_FALLBACK = "(내용 없음)";

/**
 * 세로 한 줄 배치. 칸 높이는 제목 한 줄 기준 약 52~63px(NODE_SIZE.MIN_HEIGHT
 * + 부제 한 줄)이므로 120px 간격이면 어떤 칸도 겹치지 않는다. x 는 모두 같은
 * 값이라 연결선이 곧은 수직선으로 떨어진다.
 */
const NODE_X = 0;
const NODE_Y_STEP = 120;

function toRecordNodeId(recordId: string): string {
  return `${RECORD_NODE_ID_PREFIX}${recordId}`;
}

function toEdgeId(fromNodeId: string, toNodeId: string): string {
  return `${EDGE_ID_PREFIX}${fromNodeId}>${toNodeId}`;
}

/**
 * 칸 제목 = 메모의 첫 줄. 다만 빈 줄로 시작하는 메모(엔터를 먼저 친 글)가
 * 실제로 들어오므로 "첫 줄"은 **내용이 있는 첫 줄**로 읽는다 — 그러지 않으면
 * 제목 없는 칸이 생긴다. CRLF 는 trim() 이 함께 걷어낸다.
 */
function toNodeTitle(memo: string): string {
  const firstFilledLine = memo
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstFilledLine === undefined) return TITLE_FALLBACK;
  return firstFilledLine.length > TITLE_MAX_LENGTH
    ? `${firstFilledLine.slice(0, TITLE_MAX_LENGTH)}${TITLE_ELLIPSIS}`
    : firstFilledLine;
}

/** 오래된 것이 위. createdAt 이 같을 때는 id 로 갈라 언제나 같은 순서가 나오게 한다(작업 기록 조회의 `created_at DESC, id DESC` 를 그대로 뒤집은 것). */
function compareOldestFirst(a: WorkRecordFlowchartInput, b: WorkRecordFlowchartInput): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * 작업 기록 목록 → 보기 전용 흐름도(칸·연결선). 입력 배열은 건드리지 않는다.
 *
 * - 무효 처리된 기록(isInvalidated)은 넣지 않는다. 취소된 기록이 흐름도에
 *   남으면 사실과 다른 그림이 된다 — 무효화는 "이 기록은 없던 일"이라는 뜻이지
 *   "이런 일이 있었는데 취소됐다"를 흐름도에 그리라는 뜻이 아니다.
 * - 남은 기록이 하나도 없으면 시작·종료 칸도 만들지 않고 빈 목록을 돌려준다.
 *   "그릴 것이 있는가"는 부르는 쪽이 nodes.length 로 판단한다.
 */
export function buildWorkRecordFlowchart(records: readonly WorkRecordFlowchartInput[]): WorkRecordFlowchart {
  const ordered = records.filter((record) => !record.isInvalidated).sort(compareOldestFirst);
  if (ordered.length === 0) return { nodes: [], edges: [] };

  const nodes: CaseFlowchartGraphNode[] = [
    {
      id: WORK_RECORD_FLOWCHART_START_NODE_ID,
      nodeType: "START",
      title: "시작",
      description: null,
      instructions: null,
      positionX: NODE_X,
      positionY: 0,
    },
    ...ordered.map((record, index) => ({
      id: toRecordNodeId(record.id),
      nodeType: NODE_TYPE_BY_RECORD_KIND[record.recordKind],
      title: toNodeTitle(record.memo),
      // 메모 전문 그대로. 제목에서 잘린 글자가 여기서 사라지면 안 된다.
      description: record.memo,
      instructions: null,
      positionX: NODE_X,
      positionY: (index + 1) * NODE_Y_STEP,
    })),
    {
      id: WORK_RECORD_FLOWCHART_END_NODE_ID,
      nodeType: "END",
      // "종료"가 아니라 "현재까지" — 마지막 기록이 곧 작업의 끝이라는 뜻은
      // 아니다. 이 흐름도는 지금까지 쌓인 기록의 끝을 가리킬 뿐이다.
      title: "현재까지",
      description: null,
      instructions: null,
      positionX: NODE_X,
      positionY: (ordered.length + 1) * NODE_Y_STEP,
    },
  ];

  const edges: CaseFlowchartGraphEdge[] = [];
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const fromNodeId = nodes[i].id;
    const toNodeId = nodes[i + 1].id;
    edges.push({
      id: toEdgeId(fromNodeId, toNodeId),
      fromNodeId,
      toNodeId,
      // 갈림길을 만들지 않는 이유는 이 모듈 머리말 참조 — 언제나 DEFAULT 사슬.
      branchType: "DEFAULT",
      branchLabel: null,
      routePoints: null,
    });
  }

  return { nodes, edges };
}

// ─────────────────────────── 「본 그대로」를 지키기 위한 대조 (저장할 때만 쓴다)

/**
 * 칸 id → 그 칸이 옮겨 그린 작업 기록의 id. 기록에서 나오지 않은 칸(시작·현재까지)
 * 이면 null 이다. 접두사를 벗기는 일은 toRecordNodeId 의 정확한 반대이므로 두
 * 함수를 같은 파일에 붙여 둔다 — 접두사가 바뀌면 한쪽만 고쳐지는 일이 없다.
 */
export function toWorkRecordIdFromFlowchartNodeId(nodeId: string): string | null {
  if (!nodeId.startsWith(RECORD_NODE_ID_PREFIX)) return null;
  return nodeId.slice(RECORD_NODE_ID_PREFIX.length);
}

/** 그려진 차례 그대로 늘어놓은, 칸들이 가리키는 작업 기록 id 목록. */
export function listWorkRecordIdsInFlowchart(nodes: readonly CaseFlowchartGraphNode[]): string[] {
  const recordIds: string[] = [];
  for (const node of nodes) {
    const recordId = toWorkRecordIdFromFlowchartNodeId(node.id);
    if (recordId !== null) recordIds.push(recordId);
  }
  return recordIds;
}

/**
 * 「화면이 본 그 흐름도」와 「서버가 방금 다시 그린 흐름도」가 같은 것인가.
 *
 * 이 흐름도를 진짜 흐름도로 저장할 때만 쓴다. 저장하는 쪽이 풀어야 하는 문제는
 * 둘이 맞물려 있다:
 *
 *  ⓐ 화면이 보낸 칸 내용을 그대로 저장하면 **서버가 화면 말을 믿게 된다** —
 *    누구든 아무 제목·아무 분류의 칸을 「작업 기록에서 뽑았다」며 밀어 넣을 수
 *    있다. 그러면 이 흐름도는 더 이상 작업 기록의 사본이 아니다.
 *  ⓑ 그렇다고 서버가 그냥 자기가 다시 그린 것을 저장하면, 사람이 화면에서 보고
 *    「이대로 저장」을 누른 그 그림과 다른 것이 저장될 수 있다(누르기 직전에
 *    기록이 하나 더 붙었다면). 「본 대로 저장한다」는 약속이 깨진다.
 *
 * 그래서 화면은 **자기가 본 기록 id 목록만** 보내고, 내용은 서버가 DB 에서 다시
 * 읽어 다시 그린다. 그 둘을 여기서 견주어 같을 때만 저장한다 — ⓐ 는 내용이
 * 언제나 DB 에서 오므로 막히고, ⓑ 는 어긋나면 저장을 거절하고 새로 고치라고
 * 말하므로 막힌다.
 *
 * 순서까지 같아야 한다. 사이에 기록이 하나 끼면 개수가 같아도 차례가 달라지고,
 * 그때 사람이 본 그림과 저장될 그림은 서로 다른 그림이다.
 */
export function workRecordFlowchartMatchesSeenRecords(
  nodes: readonly CaseFlowchartGraphNode[],
  seenRecordIds: readonly string[]
): boolean {
  const currentRecordIds = listWorkRecordIdsInFlowchart(nodes);
  if (currentRecordIds.length !== seenRecordIds.length) return false;
  return currentRecordIds.every((recordId, index) => recordId === seenRecordIds[index]);
}
