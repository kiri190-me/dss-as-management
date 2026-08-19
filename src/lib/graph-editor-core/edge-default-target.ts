/**
 * Generic graph-editor-core — "새 연결 추가" 패널의 대상 노드 기본값 규칙.
 * Domain-free: {id}만 읽으며 절차 템플릿/케이스 플로우차트 어느 쪽도 알지
 * 못한다. 두 편집기가 "가장 최근에 추가한 노드"를 각자 다른 방식으로 알아내지만
 * (절차는 sortOrder, 플로우차트는 createdAt 정렬), 그 뒤의 선택 규칙은 여기
 * 하나로 통일한다.
 *
 * 호출자는 오래된 것 → 최근 것 순서로 정렬된 배열을 넘겨야 한다. 이 함수는
 * 정렬하지 않는다 — 무엇이 "최근"인지는 도메인만 알 수 있기 때문이다.
 */
export function pickDefaultTargetNodeId(
  nodesOldestFirst: readonly { id: string }[],
  fromNodeId: string | null
): string {
  // 가장 최근 노드가 시작 노드와 같으면 자기 자신으로의 연결이 되어 어차피
  // 제출할 수 없다 — 그 경우 한 칸 더 과거로 물러난다. 남는 후보가 없으면
  // 빈 값("직접 고르세요")이며, 절대 임의의 노드를 끼워 넣지 않는다.
  for (let i = nodesOldestFirst.length - 1; i >= 0; i -= 1) {
    const id = nodesOldestFirst[i]?.id;
    if (id && id !== fromNodeId) return id;
  }
  return "";
}
