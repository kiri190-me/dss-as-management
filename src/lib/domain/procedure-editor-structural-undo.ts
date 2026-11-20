import { createTempIdMinter, TEMP_EDGE_ID_PREFIX, TEMP_NODE_ID_PREFIX, type PendingStructuralOperation } from "./procedure-editor-structural-changes";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — 저장 전 구조 변경의 **되돌리기** (2026-11-20, 조각 3)
 * ============================================================================
 * 조각 1(procedure-editor-structural-changes.ts)이 모아 두는 조작 목록을, 저장 전
 * 되돌리기가 **값으로** 다룰 수 있게 해 주는 순수 도우미 한 벌. 이웃들과 같은
 * 규약이다 — DOM · React · 서버 액션 · DB 를 한 줄도 건드리지 않는다.
 *
 * 🔴 이 조각(3)도 **화면을 한 픽셀도 안 바꾼다.** 화면 연결은 조각 4 다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 저장 전 구조 변경을 **어디에 담았나** — PENDING 스냅샷 **안**이다
 * ──────────────────────────────────────────────────────────────────────────
 * 조각 1 이 「PENDING 스냅샷 안에 함께 싣는 것이 자연스러워 보인다 — 그 판단은
 * 조각 3 의 몫」이라고 적어 두고 넘겼다. 읽고 그대로 가기로 했다. 까닭 셋인데,
 * **조각 1 이 적은 것보다 하나 더 있다**(②번).
 *
 *  ① **시간순이 공짜로 지켜진다.** 구조 변경도 드래그 · 글자 입력과 똑같이
 *     「바뀌기 직전 상태」를 한 칸 쌓는 일이 되므로, 두 갈래를 시간순으로 섞으려고
 *     애쓸 자리가 아예 안 생긴다. 지금 스택이 애써 풀어낸 그 설계
 *     (procedure-editor-undo-plan.ts 머리말)를 건드리지 않고 그대로 탄다.
 *  ② 🔴 **임시 id 를 키로 쓰는 초안이 같은 스냅샷에 들어 있다.** 새로 만든 노드의
 *     설명 · 지시 요약 · 자리 · 경로점은 `tmp:node:1` 을 키로 다섯 지도에 적힌다.
 *     조작 목록만 따로 되돌리면 그 지도에 `tmp:node:1` 짜리 초안이 **남는다.**
 *     그다음에 사람이 노드를 새로 만들어 같은 번호를 받으면 **지운 적 없는 남의
 *     글이 새 노드에 붙는다** — 오류도 경고도 없다. 한 스냅샷에 함께 실으면 그
 *     일이 일어날 수 없다(둘이 늘 같이 움직인다).
 *  ③ **되돌리는 길이 하나로 남는다.** graph-editor-core/undo-stack.ts 가 「조작별
 *     역연산을 따로 만들지 않고 바뀌기 직전 상태를 통째로 쌓는다」고 적어 둔 그
 *     까닭(조작이 하나 늘 때마다 역연산 짝을 맞춰야 해서 어긋나기 쉽다)이 여기에도
 *     그대로 적용된다. 구조 조작용 되돌리기 칸을 따로 만들면 짝이 둘이 된다.
 *
 * 🔵 그래서 **이 모듈에는 스택이 없다.** 스택은 지금 있는 것 하나
 *    (procedure-editor-undo-plan.ts)로 충분하고, 여기 있는 것은 그 스냅샷에 실릴
 *    목록을 **값으로 다루는 규칙 둘**뿐이다 — 번호 도장과 견주기.
 *
 * 🔵 되돌리기가 「목록에서 빼는 일」이라 서버 되돌리기
 *    (db/mutations/procedure-template-undo-redo.ts)보다 훨씬 단순하다. 저쪽은 진짜
 *    DB 행을 거꾸로 돌리고 지웠던 노드를 **원래 번호 그대로** 되살려야 해서 이력
 *    표를 읽는다. 이쪽은 아직 아무것도 안 일어났으므로 되돌릴 DB 가 없다 —
 *    「할 일 목록」을 한 칸 전 모습으로 되돌려 놓으면 그만이다.
 */

// ==================== ① 번호 도장 — 들고 다니지 않는다 ====================

/**
 * 🔴 조각 2 의 경고 ㄴ) 에 대한 답.
 *
 * 조각 2 가 이렇게 적어 두었다: 「임시 번호를 찍는 도장의 세는 수가 스냅샷 밖에
 * 있다. 되돌리기로 조작 목록을 되살릴 때 도장을 `startAt: 1` 로 다시 만들면
 * **번호가 겹친다**(조각 1 이 「같은 번호를 두 번 내주면 안 된다」고 적어 뒀다).」
 *
 * 세는 수를 스냅샷 안에 **함께 싣는 길**도 있었다. 안 골랐다 — 들고 다니면
 * 「목록」과 「세는 수」 두 값이 **늘 맞아야** 하고, 한쪽만 되돌아간 날 아무도 못
 * 잡는다(겹친 번호는 조각 1 의 접기에서 두 노드를 한 덩어리로 만들어, 하나를
 * 지우면 다른 하나가 같이 사라지는 꼴로 나타난다 — 원인에서 아주 먼 증상이다).
 *
 * 대신 **살아 있는 목록에서 그때그때 뽑는다.** 들고 다닐 것이 없으니 어긋날 두
 * 값도 없고, 「도장을 1 부터 다시 만든다」는 실수 자체가 성립하지 않는다 —
 * 번호를 내주는 길이 appendPendingStructuralOperations 하나뿐이고 그 안에서 늘
 * 목록을 다시 읽기 때문이다.
 *
 * 🔵 목록을 통째로 되돌려 임시 id 가 하나도 안 남으면 다음 번호는 **다시 1** 이다.
 *    그래도 겹치지 않는다 — 겹칠 수 있는 상대(되돌려져 future 로 간 조작)는 새
 *    조작이 쌓이는 순간 통째로 버려진다(undo-stack.ts 의 「새 조작은 future 를
 *    무효로 만든다」). 지켜야 하는 것은 **살아 있는 목록 안에서의 유일함**뿐이고,
 *    이 함수가 재는 것이 정확히 그것이다.
 *
 * ── 🔴 왜 `Object.values` 로 **모든 칸**을 훑는가 ─────────────────────────
 * 이름에 `temp` 가 붙은 칸만 보면 모자란다. 조각 2 의 치환
 * (applyResolvedStructuralIds)이 돈 뒤에는 `CREATE_EDGE.fromNodeId` 처럼 **가리키는
 * 칸**에만 임시 id 가 남아 있는 목록이 정상으로 존재한다(부분 실패 뒤의
 * remainingOperations 가 그 모습이다). 거기 있는 번호를 안 세면 그 번호를 다시
 * 내준다.
 *
 * 칸 이름을 여기 한 벌 적어 두는 길도 있었지만, 그러면 조작에 칸이 하나 느는 날
 * 조용히 낡는다(조각 1 의 applyResolvedStructuralIds 가 「칸 목록을 아는 곳이 이
 * 함수 하나뿐이어야 한다」고 적은 것과 같은 걱정이다). `Object.values` 는 **칸이
 * 늘어도 저절로 따라간다.**
 * 🔵 대가: 사람이 노드 제목을 글자 그대로 `tmp:node:999` 라고 적으면 그것도 번호로
 *    읽힌다. 그래서 다음 번호가 1000 부터 나간다 — **번호를 낭비할 뿐 겹치지는
 *    않는다.** 틀리는 방향이 안전한 쪽이라 이 대가를 받아들였다.
 * 🔴 글자 배열 칸(`string[]`)이 생기면 이 훑기가 못 본다. 지금은 없다
 *    (2026-11-20 실측 — 조작의 칸은 글자 · 수 · `Position` · null 뿐이다).
 */
export function nextTempSequencesFor(operations: readonly PendingStructuralOperation[]): { node: number; edge: number } {
  let node = 0;
  let edge = 0;
  for (const operation of operations) {
    for (const value of Object.values(operation)) {
      if (typeof value !== "string") continue;
      const nodeSequence = sequenceOf(value, TEMP_NODE_ID_PREFIX);
      if (nodeSequence !== null && nodeSequence > node) node = nodeSequence;
      const edgeSequence = sequenceOf(value, TEMP_EDGE_ID_PREFIX);
      if (edgeSequence !== null && edgeSequence > edge) edge = edgeSequence;
    }
  }
  return { node: node + 1, edge: edge + 1 };
}

/** `tmp:node:12` → 12. 접두사가 안 맞거나 꼬리가 숫자가 아니면 번호가 아니다(진짜 id 는 여기서 null 로 빠진다). */
function sequenceOf(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const tail = id.slice(prefix.length);
  if (!/^[0-9]+$/.test(tail)) return null;
  return Number(tail);
}

/** 조각 1 의 createTempIdMinter 가 돌려주는 모양. 받는 쪽이 번호를 직접 셀 수 없도록 함수 둘만 준다. */
export type ProcedureTempIdMinter = { nextNodeId: () => string; nextEdgeId: () => string };

/**
 * 모아 둔 목록 뒤에 조작을 더한다. **임시 번호는 이 함수가 찍는다** — 부르는 쪽이
 * 도장을 만들 길을 주지 않는 것이 이 함수의 핵심이다(위 nextTempSequencesFor 머리말).
 *
 * 🔵 `build` 가 **목록**을 돌려주는 까닭: 한 번의 조작이 여러 줄로 적히는 경우가
 *    있다. 조각 1 이 적어 둔 「저장 안 된 연결선 위에 노드 삽입」의 우회로가 그것으로,
 *    노드 만들기 + 임시 연결선 재연결 + 연결선 만들기 셋이 **한 도장**에서 번호를
 *    받아야 한다. 한 건씩 나눠 부르면 그 사이에 목록이 바뀌어 번호가 어긋날 수 있다.
 *
 * 🔴 들어온 배열도 그 안의 객체도 건드리지 않는다(순수 함수의 약속 — 조각 1 의
 *    coalescePendingStructuralOperations 와 같은 규약).
 */
export function appendPendingStructuralOperations(
  operations: readonly PendingStructuralOperation[],
  build: (mint: ProcedureTempIdMinter) => readonly PendingStructuralOperation[]
): PendingStructuralOperation[] {
  const next = nextTempSequencesFor(operations);
  // 🔵 조각 1 의 도장을 **두 벌** 세운다. 그쪽은 노드·연결선이 같은 `startAt` 에서
  //    출발하는 모양이라(한 수를 나눠 쓰지 않으려고 일부러 그렇게 했다) 갈래마다
  //    다른 자리에서 시작시키려면 이 길뿐이다. 번호를 만드는 글자 규칙과 세는 일
  //    자체는 여전히 저쪽 한 벌만 쓴다 — 여기서 `tmp:` 를 다시 적지 않는다.
  const nodes = createTempIdMinter(next.node);
  const edges = createTempIdMinter(next.edge);
  const minted = build({ nextNodeId: () => nodes.nextNodeId(), nextEdgeId: () => edges.nextEdgeId() });
  return [...operations, ...minted];
}

// ==================== ② 견주기 ====================

/**
 * 🔴 **이것을 안 섞으면 되돌리기 한 단계가 조용히 사라진다.**
 *
 * planProcedureUndo 는 「지금 화면과 똑같은 PENDING 칸」을 헛도는 단계로 보고
 * 조용히 버린다(눌렀는데 화면이 그대로인 단계를 만들지 않으려는 원래 규칙이다).
 * 그 같다/다르다를 가르는 함수는 **화면이 준다** — 지금 화면의
 * pendingSnapshotsEqual 은 다섯 지도만 직렬화해 견준다.
 *
 * 구조 조작만 바뀐 단계는 **다섯 지도가 똑같다.** 그래서 화면이 이 서명을 함께
 * 섞지 않으면 그 단계가 버려진다 — 오류도 경고도 없이 [이전]이 한 칸을 건너뛴다.
 * 🔴 조각 4 는 pendingSnapshotSignature 에 이 함수를 **반드시 한 줄 더해야 한다.**
 *
 * 🔵 서명(글자) 꼴로 돌려주는 까닭: 화면이 이미 그 방식이라 한 줄만 보태면 된다.
 *    참·거짓으로 주면 화면이 두 비교를 합치는 코드를 따로 적어야 하고, 그 자리가
 *    또 하나의 빠뜨릴 곳이 된다.
 *
 * 🔴 칸 차례에 흔들리지 않게 **키를 정렬해** 직렬화한다. 조각 2 의 치환이
 *    `{ ...operation, edgeId: ... }` 로 조작을 다시 만드는데, 그렇게 만든 객체의 키
 *    차례가 원본과 다를 수 있다. 그대로 JSON 으로 찍으면 **내용이 같은데 다르다**고
 *    읽히고, 그러면 아무것도 안 바뀐 자리에 되돌리기 칸이 한 개 더 쌓인다([이전]을
 *    눌러도 화면이 그대로인 헛도는 단계 — 원래 pushUndoStep 이 막던 바로 그것이다).
 */
export function procedureStructuralOperationsSignature(operations: readonly PendingStructuralOperation[]): string {
  return JSON.stringify(operations.map(canonicalize));
}

/** 서명이 같으면 같은 목록이다. 🔵 차례도 뜻이 있다 — 보낼 차례를 조각 1 이 그 목록 순서에서 뽑는다. */
export function pendingStructuralOperationsEqual(a: readonly PendingStructuralOperation[], b: readonly PendingStructuralOperation[]): boolean {
  return procedureStructuralOperationsSignature(a) === procedureStructuralOperationsSignature(b);
}

/** 키를 정렬해 다시 만든다. `position` 처럼 한 겹 더 들어간 값도 같이 다룬다. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
    return sorted;
  }
  return value;
}
