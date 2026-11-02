import { procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * 판단(DECISION) 갈래 단추에 적을 이름.
 *
 * 절차를 만든 사람이 간선에 적어 둔 글자(branchLabel)가 있으면 그것이 가장
 * 정확하다 — 실제 절차에는 「정상」·「NG」·「재측정」처럼 그 절차의 말로 적혀
 * 있다. 비어 있을 때만 갈래 종류의 우리말 이름으로 대신한다.
 *
 * 🔴 갈래 종류 코드(`DEFAULT`)를 그대로 보여 주지 않는다. 쓰는 자리가 둘
 * (큰 카드의 갈래 단추, 작은 카드의 완료 창)이고 둘이 **같은 선택지**를
 * 그리므로, 한 곳에서만 정한다 — 두 벌로 두면 한쪽만 고치는 날이 오고
 * 타입이 같아 컴파일러는 아무 말도 하지 않는다.
 */
export function formatBranchChoiceLabel(edge: { branchLabel: string | null; branchType: ProcedureBranchType }): string {
  return edge.branchLabel ?? procedureBranchTypeLabels[edge.branchType];
}
