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

/**
 * 작은 흐름 그림의 **화살표**에 적을 글자. 없으면 null — 화살표만 그린다.
 *
 * 단추와 규칙이 다른 까닭: 단추는 사람이 **고르는 것**이라 이름이 반드시
 * 있어야 하지만, 화살표는 길이 하나뿐인 자리에도 그려진다. 실측한 절차에서
 * 갈라지는 선은 「정상」·「NG」로 적혀 있고 곧은 길은 전부 DEFAULT 에 이름이
 * 비어 있다 — 그 자리에 「기본」을 적으면 모든 화살표에 같은 글자가 붙어
 * 정작 갈래 이름이 묻힌다.
 */
export function formatFlowEdgeLabel(edge: { branchLabel: string | null; branchType: ProcedureBranchType }): string | null {
  if (edge.branchLabel !== null && edge.branchLabel.trim() !== "") return edge.branchLabel;
  return edge.branchType === "DEFAULT" ? null : procedureBranchTypeLabels[edge.branchType];
}
