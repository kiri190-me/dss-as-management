import type { ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * Deterministic branch-label → branch_type mapping, matching exactly the
 * vocabulary found across the workbook's shape-graph sheets (Phase 1
 * report §5): NG (red label box) is by far the most common; YES/NO appear
 * on literal yes/no decision nodes; 정상/OK/O.K. appear rarely as an
 * explicit positive label where the source didn't leave it implicit. No
 * label at all is the default/continue path. Anything else found near an
 * edge is CUSTOM, not guessed at.
 */
export function classifyBranchLabel(labelText: string | null): {
  branchType: ProcedureBranchType;
  branchLabel: string | null;
} {
  if (!labelText) return { branchType: "DEFAULT", branchLabel: null };
  const t = labelText.trim();
  if (/^N\.?\s*G\.?$/i.test(t)) return { branchType: "NG", branchLabel: t };
  if (/^YES$/i.test(t)) return { branchType: "YES", branchLabel: t };
  if (/^NO$/i.test(t)) return { branchType: "NO", branchLabel: t };
  if (/^(정상|OK|O\.\s*K\.?)$/i.test(t)) return { branchType: "NORMAL", branchLabel: t };
  return { branchType: "CUSTOM", branchLabel: t };
}

/**
 * Matches the two verified cross-stage restart references found in the
 * workbook (Phase 1 report §2): "(4)기본 정전 검사 과정부터 재진행 실시"
 * (stage 7's aging-test-failure loop-back) and "(4) 기본 정전 검사 재실시"
 * (stage 11's shipment-prep staleness loop-back). Both name the target
 * stage by its parenthesized number and end in 재진행/재실시 — this regex
 * matches that shared shape rather than either exact string, so it
 * generalizes to either wording without being so loose it fires on
 * unrelated text.
 */
const STAGE_RESTART_RE = /\((\d+)\)\s*([^\n]*?)\s*(?:과정부터\s*)?재(?:진행|실시)/;

export function matchStageRestartReference(
  text: string
): { stageNumber: string; stageLabelFragment: string } | null {
  const m = text.match(STAGE_RESTART_RE);
  if (!m) return null;
  return { stageNumber: m[1], stageLabelFragment: m[2].trim() };
}
