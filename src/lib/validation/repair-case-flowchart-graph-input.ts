import { REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES, REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES } from "@/lib/domain/repair-case-flowchart-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Own standalone copy of the UUID format check, matching this codebase's existing convention (each validation module keeps its own copy rather than cross-importing). */
export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidExpectedUpdatedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export function isValidNodeType(value: unknown): value is string {
  return typeof value === "string" && (REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES as readonly string[]).includes(value);
}

export function isValidBranchType(value: unknown): value is string {
  return typeof value === "string" && (REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES as readonly string[]).includes(value);
}

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_BRANCH_LABEL_LENGTH = 200;

export type NodeTitleValidationResult = { ok: true; title: string } | { ok: false; error: string };

/** Same shape/limit as repair-case-flowchart-input.ts's validateFlowchartTitle — kept as its own copy (a node title is a distinct field on a distinct entity) rather than cross-imported, matching this codebase's per-module-owns-its-copy convention. */
export function validateNodeTitle(value: unknown): NodeTitleValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "노드 제목을 입력해 주세요." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `노드 제목은 ${MAX_TITLE_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, title: trimmed };
}

export type NodeDescriptionValidationResult = { ok: true; description: string | null } | { ok: false; error: string };

export function validateNodeDescription(value: unknown): NodeDescriptionValidationResult {
  if (value === null || value === undefined) return { ok: true, description: null };
  if (typeof value !== "string") return { ok: false, error: "노드 설명 형식이 올바르지 않습니다." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, description: null };
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `노드 설명은 ${MAX_DESCRIPTION_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, description: trimmed };
}

export type BranchLabelValidationResult = { ok: true; branchLabel: string | null } | { ok: false; error: string };

export function validateBranchLabel(value: unknown): BranchLabelValidationResult {
  if (value === null || value === undefined) return { ok: true, branchLabel: null };
  if (typeof value !== "string") return { ok: false, error: "분기 라벨 형식이 올바르지 않습니다." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, branchLabel: null };
  if (trimmed.length > MAX_BRANCH_LABEL_LENGTH) {
    return { ok: false, error: `분기 라벨은 ${MAX_BRANCH_LABEL_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, branchLabel: trimmed };
}

export function isValidPosition(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    Number.isFinite((value as { x: unknown }).x) &&
    Number.isFinite((value as { y: unknown }).y)
  );
}

/**
 * Action-layer shape check only — the authoritative normalization is
 * sanitizeRoutePoints (graph-editor-core/routing.ts), called unconditionally
 * inside saveRepairCaseFlowchartEdgeRoute regardless of what passes here.
 * This just rejects an obviously-malformed payload before it reaches the
 * mutation layer at all.
 */
export function isValidRoutePoints(value: unknown): value is { x: number; y: number }[] | null {
  if (value === null || value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((p) => isValidPosition(p));
}

export type LayoutPositionInput = { id: string; positionX: number; positionY: number };

export function isValidLayoutPositions(value: unknown): value is LayoutPositionInput[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      isValidUuid((p as { id: unknown }).id) &&
      Number.isFinite((p as { positionX: unknown }).positionX) &&
      Number.isFinite((p as { positionY: unknown }).positionY)
  );
}
