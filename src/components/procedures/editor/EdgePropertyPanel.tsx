"use client";

import { useState } from "react";
import {
  PROCEDURE_BRANCH_TYPE_CODES,
  procedureBranchTypeLabels,
  MANUAL_TECHNICAL_NODE_TYPE_CODES,
  procedureNodeTypeLabels,
  type ProcedureBranchType,
  type ManualTechnicalNodeType,
} from "@/lib/domain/procedure-template-types";
import type { EditorEdgeRow, EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import {
  retargetProcedureTemplateEdgeAction,
  deleteProcedureTemplateEdgeAction,
  insertProcedureTemplateNodeOnEdgeAction,
} from "@/lib/server/actions/procedure-template-editor";
import type { NodeLookup } from "@/lib/domain/procedure-editor-client-state";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";
import type { RoutePoint } from "@/lib/graph-editor-core/routing";
import type { ProcedureEdgeFieldDraft } from "@/lib/domain/procedure-editor-save-state";

/**
 * Edge property side panel (Phase 4A; branchType/branchLabel converted to a
 * screen-owned pending draft in 5C-6D-1C) — branchType/branchLabel are a
 * controlled draft (`draft`/`onDraftChange`) persisted by the screen's
 * global [저장], together with any other pending change. "검토자 메모"
 * (`note`/`onNoteChange`) is lifted to the same place for the same reason
 * (this panel remounts — `key={edge.id}` — on selection change, before a
 * deferred save might run) but stays deliberately OUTSIDE the draft/dirty
 * comparison: it has no persisted server-side baseline (write-only, sent
 * only as that save's history `reason`), so it can never be "dirty" or
 * "clean" against a baseline that doesn't exist. Retargeting stays its own
 * separate, IMMEDIATE action and always requires a reason (unless
 * isTechnical).
 *
 * 🔴 2026-11-03(줄기 B-②) — 재연결의 **확인 창을 없앴다.** 예전에는
 * [변경 검토] → 현재/변경 후를 나란히 보여 주는 <dialog> → [적용] 이었다.
 * 없앤 까닭은 사용자가 "추가/수정할 때마다 팝업이 뜬다"고 직접 말했고,
 * 줄기 B-① 로 재연결도 [이전]으로 되돌릴 수 있게 됐기 때문이다. 미리보기가
 * 들려주던 "무엇이 무엇으로 바뀌는가"는 이미 화면에 다 있다 — 패널 머리의
 * `A → B` 가 현재이고, 바로 아래 두 드롭다운이 변경 후다. 그래서 창을 없애며
 * buildEdgeRetargetPreview 호출도 함께 걷어냈다(그 함수와 제 시험은 그대로
 * 둔다 — 이 조각의 일이 아니다).
 *
 * 🔴 됐다는 증거는 **지도에서 연결선이 옮겨 붙는 것**이고(onSaved →
 * router.refresh()), 실패는 아래 errorMessage 한 자리가 유일한 통로다.
 * 🟢 **삭제(분기 삭제)는 건드리지 않았다** — 사용자가 말한 것은 추가/수정이다.
 */
export default function EdgePropertyPanel({
  edge,
  nodes,
  canEdit,
  expectedTemplateUpdatedAt,
  draft,
  onDraftChange,
  note,
  onNoteChange,
  onSaved,
  routePoints,
  selectedWaypointIndex,
  onAddWaypoint,
  onRemoveSelectedWaypoint,
  onResetRoute,
  onStraighten,
  canDelete,
  onDeleted,
  canInsertNode,
  isTechnical,
}: {
  edge: EditorEdgeRow;
  nodes: EditorNodeRow[];
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  /** 5C-6D-1C — screen-owned pending draft for branchType/branchLabel; already reflects any locally-unsaved edit (this panel never keeps its own copy). */
  draft: ProcedureEdgeFieldDraft;
  onDraftChange: (patch: Partial<ProcedureEdgeFieldDraft>) => void;
  /** 5C-6D-1C — screen-owned "검토자 메모" text, sent only if/when the EDGE_FIELDS save step for this edge actually runs; blank means no note. Not part of `draft` — see this file's own doc comment. */
  note: string;
  onNoteChange: (note: string) => void;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
  /** Phase 4B — the edge's *working* (saved + pending-merged) manual route; null means automatic/deterministic routing. */
  routePoints: RoutePoint[] | null;
  selectedWaypointIndex: number | null;
  onAddWaypoint: () => void;
  onRemoveSelectedWaypoint: () => void;
  onResetRoute: () => void;
  /** 5C-6D-1E — "연결 정렬": null when the screen's own canStraighten gate (canEdit && layoutMode === "USER") is false, so the button is simply absent rather than a visible-but-disabled affordance for an action the canvas double-click itself wouldn't currently allow either. When present, calls the EXACT SAME screen handler double-click uses — no duplicated math, no duplicated save path. */
  onStraighten: (() => void) | null;
  /** Phase 5C-5B — true only for a TECHNICAL_TASK DRAFT; always false for FULL_SERVICE/REFERENCE. */
  canDelete: boolean;
  onDeleted: (newUpdatedAt: string) => void;
  /** Phase 5C-5B — same gate as canDelete (TECHNICAL_TASK DRAFT, ADMIN+SUPER_ADMIN); a separate prop only so the two capabilities stay independently named/readable at each call site. */
  canInsertNode: boolean;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK; relaxes the retarget reason from mandatory to optional (UI mirror of the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason, unchanged. */
  isTechnical: boolean;
}) {
  const nodesById = new Map<string, NodeLookup>(nodes.map((n) => [n.id, { id: n.id, title: n.title, nodeCode: n.nodeCode }]));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [newFromNodeId, setNewFromNodeId] = useState(edge.fromNodeId);
  const [newToNodeId, setNewToNodeId] = useState(edge.toNodeId);
  const [retargetReason, setRetargetReason] = useState("");
  const [isRetargeting, setIsRetargeting] = useState(false);

  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [showInsertNodeForm, setShowInsertNodeForm] = useState(false);
  const [insertNodeType, setInsertNodeType] = useState<ManualTechnicalNodeType>("TASK");
  const [insertNodeTitle, setInsertNodeTitle] = useState("");
  const [isInsertingNode, setIsInsertingNode] = useState(false);

  const hasRetarget = newFromNodeId !== edge.fromNodeId || newToNodeId !== edge.toNodeId;
  const labelRequired = draft.branchType === "CUSTOM" && draft.branchLabel.trim().length === 0;

  /**
   * [대상 변경] 의 본체 — 확인 창 없이 그 자리에서 서버로 간다.
   * 🔴 onSaved 는 **실패 검사 뒤**에만 부른다: 이 호출이 화면의
   * handleStructuralSaved → pushStructuralUndoStep() 으로 이어져 되돌리기 한
   * 걸음을 쌓으므로, 실패한 호출까지 쌓으면 일어나지도 않은 일을 되돌리려 들어
   * 바로 아래 있던 멀쩡한 변경이 대신 날아간다(줄기 B-①). 창을 없애면서도 이
   * 순서는 손대지 않았다.
   */
  async function handleRetarget() {
    setIsRetargeting(true);
    setErrorMessage(null);
    const result = await retargetProcedureTemplateEdgeAction({
      edgeId: edge.id,
      newFromNodeId,
      newToNodeId,
      reason: retargetReason,
      expectedTemplateUpdatedAt,
    });
    setIsRetargeting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onSaved(result.updatedAt, result.structuralValidation);
  }

  async function handleDelete() {
    setIsDeleting(true);
    setErrorMessage(null);
    const result = await deleteProcedureTemplateEdgeAction({ edgeId: edge.id, reason: deleteReason, expectedTemplateUpdatedAt });
    setIsDeleting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onDeleted(result.updatedAt);
  }

  async function handleInsertNodeAtRoutePoint() {
    if (selectedWaypointIndex === null || !routePoints) return;
    const point = routePoints[selectedWaypointIndex];
    if (!point) return;
    setIsInsertingNode(true);
    setErrorMessage(null);
    const result = await insertProcedureTemplateNodeOnEdgeAction({
      edgeId: edge.id,
      nodeType: insertNodeType,
      title: insertNodeTitle,
      position: point,
      expectedTemplateUpdatedAt,
    });
    setIsInsertingNode(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setShowInsertNodeForm(false);
    setInsertNodeTitle("");
    onSaved(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">분기 속성</h3>
        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
          {nodesById.get(edge.fromNodeId)?.title ?? edge.fromNodeId} → {nodesById.get(edge.toNodeId)?.title ?? edge.toNodeId}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        분기 유형
        <select
          value={draft.branchType}
          onChange={(e) => onDraftChange({ branchType: e.target.value as ProcedureBranchType })}
          disabled={!canEdit}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {procedureBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {draft.branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={draft.branchLabel} onChange={(e) => onDraftChange({ branchLabel: e.target.value })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {labelRequired && <p className="text-amber-600 dark:text-amber-400">사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다.</p>}
      <label className="flex flex-col gap-1">
        검토자 메모 (선택, 저장 시 함께 기록됨)
        <textarea rows={2} value={note} onChange={(e) => onNoteChange(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>

      {canEdit && <p className="text-[11px] text-zinc-400 dark:text-zinc-600">위 속성 변경은 화면 상단의 [저장] 버튼으로 다른 변경사항과 함께 저장됩니다.</p>}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
          <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300">분기 대상 변경</h4>
          <label className="flex flex-col gap-1">
            시작 노드
            <select value={newFromNodeId} onChange={(e) => setNewFromNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.nodeCode})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            대상 노드
            <select value={newToNodeId} onChange={(e) => setNewToNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.nodeCode})
                </option>
              ))}
            </select>
          </label>
          <textarea
            rows={2}
            value={retargetReason}
            onChange={(e) => setRetargetReason(e.target.value)}
            placeholder={isTechnical ? "변경 사유 (선택)" : "변경 사유 (필수)"}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={!hasRetarget || newFromNodeId === newToNodeId || (!isTechnical && retargetReason.trim().length === 0) || isRetargeting}
            onClick={() => void handleRetarget()}
            className="self-start rounded-md border border-blue-400 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            {isRetargeting ? "변경 중..." : "대상 변경"}
          </button>
          {newFromNodeId === newToNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">연결선 경로 (사용자 배치에서만 표시)</h4>
        <p className="text-zinc-500 dark:text-zinc-400">{routePoints && routePoints.length > 0 ? `수동 경로 — 경로점 ${routePoints.length}개` : "자동 경로 (계산된 경로 사용 중)"}</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAddWaypoint} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              경로점 추가
            </button>
            <button
              type="button"
              onClick={onRemoveSelectedWaypoint}
              disabled={selectedWaypointIndex === null}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              선택 경로점 삭제
            </button>
            <button
              type="button"
              onClick={onResetRoute}
              disabled={!routePoints || routePoints.length === 0}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              자동 경로로 초기화
            </button>
            {onStraighten && (
              <button
                type="button"
                onClick={onStraighten}
                className="rounded-md border border-emerald-400 px-2.5 py-1 text-xs text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900"
              >
                연결 정렬
              </button>
            )}
            {canInsertNode && (
              <button
                type="button"
                onClick={() => setShowInsertNodeForm((v) => !v)}
                disabled={selectedWaypointIndex === null}
                className="rounded-md border border-blue-400 px-2.5 py-1 text-xs text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
              >
                이 위치에 노드 추가
              </button>
            )}
          </div>
        )}
        {canInsertNode && showInsertNodeForm && selectedWaypointIndex !== null && (
          <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950">
            <p className="text-blue-800 dark:text-blue-300">
              선택된 경로점 위치에 새 노드를 삽입하고, 이 분기를 두 개로 나눕니다. 원래 분기 유형/라벨은 첫 번째 구간에 그대로 유지되고, 두 번째 구간은 기본(정상 진행) 연결이 됩니다.
            </p>
            <label className="flex flex-col gap-1">
              노드 유형
              <select
                value={insertNodeType}
                onChange={(e) => setInsertNodeType(e.target.value as ManualTechnicalNodeType)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {MANUAL_TECHNICAL_NODE_TYPE_CODES.map((t) => (
                  <option key={t} value={t}>
                    {procedureNodeTypeLabels[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              제목 (필수)
              <input
                value={insertNodeTitle}
                onChange={(e) => setInsertNodeTitle(e.target.value)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={insertNodeTitle.trim().length === 0 || isInsertingNode}
                onClick={() => void handleInsertNodeAtRoutePoint()}
                className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {isInsertingNode ? "추가 중..." : "노드 삽입"}
              </button>
              <button
                type="button"
                onClick={() => setShowInsertNodeForm(false)}
                disabled={isInsertingNode}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                취소
              </button>
            </div>
          </div>
        )}
        {routePoints && routePoints.length > 0 && (
          <details className="text-[11px] text-zinc-500 dark:text-zinc-400">
            <summary className="cursor-pointer select-none">기술 정보 (경로점 좌표)</summary>
            <ul className="mt-1 flex flex-col gap-0.5 font-mono">
              {routePoints.map((p, i) => (
                <li key={i} className={i === selectedWaypointIndex ? "font-semibold text-blue-700 dark:text-blue-400" : ""}>
                  #{i + 1}: ({Math.round(p.x)}, {Math.round(p.y)})
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {canDelete && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <h4 className="text-xs font-semibold text-red-900 dark:text-red-300">분기 삭제</h4>
          <textarea
            rows={2}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="삭제 사유 (선택)"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            {isDeleting ? "삭제 중..." : "분기 삭제"}
          </button>
        </div>
      )}

      {/*
        🔴 재연결·노드 삽입·삭제 셋이 함께 쓰는 **유일한** 실패 통로다. 확인
        창이 있던 시절에는 재연결 실패를 창 안에도 한 벌 더 그렸는데, 창이
        없어진 지금은 이 한 자리뿐이다 — 지우면 실패가 조용해진다.
      */}
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
