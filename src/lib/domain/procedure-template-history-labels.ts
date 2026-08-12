/**
 * Phase 5C-5C UI — human-readable Korean labels for one history group.
 * Pure/domain-only (no DB, no React) so it's trivially unit-testable.
 * Deliberately NOT a localization framework — a single lookup table plus
 * one compound-shape special case is all this phase needs.
 */

export type HistoryGroupOrigin = "USER_EDIT" | "UNDO" | "REDO" | "RESTORE";

/** Item 10 — the short badge distinguishing WHICH KIND of operation a group is, shown alongside (not instead of) the operation label below. */
export function getOriginBadgeLabel(origin: HistoryGroupOrigin): string {
  switch (origin) {
    case "USER_EDIT":
      return "일반 작업";
    case "UNDO":
      return "이전";
    case "REDO":
      return "앞으로";
    case "RESTORE":
      return "복원";
    default: {
      const exhaustive: never = origin;
      return String(exhaustive);
    }
  }
}

const SINGLE_ACTION_LABELS: Record<string, string> = {
  CREATE_NODE: "노드 추가",
  DELETE_NODE: "노드 삭제",
  UPDATE_NODE: "노드 내용 수정",
  CHANGE_NODE_TYPE: "노드 유형 변경",
  CREATE_EDGE: "연결 추가",
  DELETE_EDGE: "연결 삭제",
  UPDATE_EDGE: "연결 수정",
  RETARGET_EDGE: "연결 대상 변경",
  SAVE_LAYOUT: "노드 위치 변경",
  SAVE_EDGE_ROUTE: "연결 경로 변경",
  UPDATE_TEMPLATE_METADATA: "기술 절차 이름 변경",
  VALIDATE_TEMPLATE: "구조 검증 실행",
};

const COMPOUND_SPLIT_SHAPE = ["CREATE_NODE", "RETARGET_EDGE", "CREATE_EDGE"];

/** Per-row label for an expanded group's detail view — keeps the underlying rows readable to an engineer rather than exposing raw DB action-type strings. */
export function getActionTypeLabel(actionType: string): string {
  return SINGLE_ACTION_LABELS[actionType] ?? actionType;
}

/**
 * The group's primary label. Origin overrides the action-type-derived
 * label for UNDO/REDO/RESTORE — an Undo group's rows mechanically describe
 * the INVERSE of what the user did (e.g. a DELETE_NODE row for an undone
 * CREATE_NODE), which would read backwards/confusingly if shown as
 * "노드 삭제"; "이전 작업 취소" describes what the user experiences,
 * regardless of the underlying row mix. Only USER_EDIT groups derive their
 * label from actionTypes.
 */
export function getHistoryGroupLabel(input: { origin: HistoryGroupOrigin; actionTypes: string[] }): string {
  switch (input.origin) {
    case "UNDO":
      return "이전 작업 취소";
    case "REDO":
      return "작업 다시 적용";
    case "RESTORE":
      return "과거 상태로 복원";
    case "USER_EDIT":
      return getUserEditLabel(input.actionTypes);
    default: {
      const exhaustive: never = input.origin;
      return String(exhaustive);
    }
  }
}

function getUserEditLabel(actionTypes: string[]): string {
  if (actionTypes.length === COMPOUND_SPLIT_SHAPE.length && actionTypes.every((t, i) => t === COMPOUND_SPLIT_SHAPE[i])) {
    return "분기 중간에 노드 삽입";
  }
  const hasLayout = actionTypes.includes("SAVE_LAYOUT");
  const hasRoute = actionTypes.includes("SAVE_EDGE_ROUTE");
  if (hasLayout && hasRoute) return "노드 위치 및 연결 경로 변경";

  if (actionTypes.length === 1) {
    return SINGLE_ACTION_LABELS[actionTypes[0]] ?? actionTypes[0];
  }
  // No other multi-row USER_EDIT shape is currently emitted — fall back to
  // a plain, honest join rather than inventing a label for an unrecognized
  // combination.
  return actionTypes.map((t) => SINGLE_ACTION_LABELS[t] ?? t).join(" · ");
}
