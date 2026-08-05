import type { ProcedureBranchType, ProcedureNodeType } from "@/lib/domain/procedure-template-types";

/**
 * Deterministic, regex-based node_type classification — no AI
 * interpretation. Order matters: each rule below is checked in sequence
 * and the first match wins, from the most structurally certain signal
 * (no outgoing edge at all) down to the least (plain text keywords).
 */
export function classifyNodeType(params: {
  text: string;
  outgoingBranchTypes: ProcedureBranchType[];
  hasIncoming: boolean;
  isEarliestInSheet: boolean;
}): ProcedureNodeType {
  const { text, outgoingBranchTypes, hasIncoming, isEarliestInSheet } = params;

  if (isEarliestInSheet && !hasIncoming) return "START";
  if (outgoingBranchTypes.length === 0) return "END";

  if (/(보고서|리포트|report)[^\n]{0,12}(제출|업로드|송부)|업로드|클라우드\s*BOX|파일철에\s*보관/i.test(text)) {
    return "DOCUMENT_REFERENCE";
  }

  if (/교환|교체|조정\s*작업|재\s*측정|재\s*확인\s*후|부품\s*교환|일본\s*교산에\s*연락/.test(text)) {
    return "CORRECTIVE_ACTION";
  }

  const distinctBranchTypes = new Set(outgoingBranchTypes);
  const hasConditionalBranch =
    distinctBranchTypes.has("NG") ||
    distinctBranchTypes.has("YES") ||
    distinctBranchTypes.has("NO") ||
    distinctBranchTypes.size >= 2;
  if (hasConditionalBranch) return "DECISION";

  if (/확인|점검|검사|측정/.test(text)) return "INSPECTION";

  return "TASK";
}
