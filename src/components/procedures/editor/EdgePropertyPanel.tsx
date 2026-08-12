"use client";

import { useEffect, useRef, useState } from "react";
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
  updateProcedureTemplateEdgeAction,
  retargetProcedureTemplateEdgeAction,
  deleteProcedureTemplateEdgeAction,
  insertProcedureTemplateNodeOnEdgeAction,
} from "@/lib/server/actions/procedure-template-editor";
import { buildEdgeRetargetPreview, type NodeLookup } from "@/lib/domain/procedure-editor-client-state";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";
import type { RoutePoint } from "@/lib/graph-editor-core/routing";

/**
 * Edge property side panel (Phase 4A) — branchType/branchLabel edit
 * through its own explicit "저장"; retargeting always shows a current-vs-
 * proposed preview inside a native <dialog> confirmation (same pattern as
 * BindConnectorForm) and always requires a reason — it must never silently
 * replace an edge.
 */
export default function EdgePropertyPanel({
  edge,
  nodes,
  canEdit,
  expectedTemplateUpdatedAt,
  onSaved,
  routePoints,
  selectedWaypointIndex,
  onAddWaypoint,
  onRemoveSelectedWaypoint,
  onResetRoute,
  canDelete,
  onDeleted,
  canInsertNode,
  isTechnical,
}: {
  edge: EditorEdgeRow;
  nodes: EditorNodeRow[];
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
  /** Phase 4B — the edge's *working* (saved + pending-merged) manual route; null means automatic/deterministic routing. */
  routePoints: RoutePoint[] | null;
  selectedWaypointIndex: number | null;
  onAddWaypoint: () => void;
  onRemoveSelectedWaypoint: () => void;
  onResetRoute: () => void;
  /** Phase 5C-5B — true only for a TECHNICAL_TASK DRAFT; always false for FULL_SERVICE/REFERENCE. */
  canDelete: boolean;
  onDeleted: (newUpdatedAt: string) => void;
  /** Phase 5C-5B — same gate as canDelete (TECHNICAL_TASK DRAFT, ADMIN+SUPER_ADMIN); a separate prop only so the two capabilities stay independently named/readable at each call site. */
  canInsertNode: boolean;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK; relaxes the retarget reason from mandatory to optional (UI mirror of the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason, unchanged. */
  isTechnical: boolean;
}) {
  const nodesById = new Map<string, NodeLookup>(nodes.map((n) => [n.id, { id: n.id, title: n.title, nodeCode: n.nodeCode }]));
  const [branchType, setBranchType] = useState<ProcedureBranchType>(edge.branchType);
  const [branchLabel, setBranchLabel] = useState(edge.branchLabel ?? "");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [newFromNodeId, setNewFromNodeId] = useState(edge.fromNodeId);
  const [newToNodeId, setNewToNodeId] = useState(edge.toNodeId);
  const [retargetReason, setRetargetReason] = useState("");
  const [confirmingRetarget, setConfirmingRetarget] = useState(false);
  const [isRetargeting, setIsRetargeting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [showInsertNodeForm, setShowInsertNodeForm] = useState(false);
  const [insertNodeType, setInsertNodeType] = useState<ManualTechnicalNodeType>("TASK");
  const [insertNodeTitle, setInsertNodeTitle] = useState("");
  const [isInsertingNode, setIsInsertingNode] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmingRetarget && !dialog.open) dialog.showModal();
    else if (!confirmingRetarget && dialog.open) dialog.close();
  }, [confirmingRetarget]);

  const hasFieldChanges = branchType !== edge.branchType || branchLabel !== (edge.branchLabel ?? "");
  const hasRetarget = newFromNodeId !== edge.fromNodeId || newToNodeId !== edge.toNodeId;
  const labelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;

  async function handleSaveFields() {
    setIsSaving(true);
    setErrorMessage(null);
    const result = await updateProcedureTemplateEdgeAction({
      edgeId: edge.id,
      patch: { branchType, branchLabel: branchLabel.trim() || null },
      expectedTemplateUpdatedAt,
      note,
    });
    setIsSaving(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onSaved(result.updatedAt, result.structuralValidation);
  }

  async function handleConfirmRetarget() {
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
    setConfirmingRetarget(false);
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

  const preview = hasRetarget
    ? buildEdgeRetargetPreview({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, branchType: edge.branchType, branchLabel: edge.branchLabel }, { fromNodeId: newFromNodeId, toNodeId: newToNodeId }, nodesById)
    : null;

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
        <select value={branchType} onChange={(e) => setBranchType(e.target.value as ProcedureBranchType)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900">
          {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {procedureBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={branchLabel} onChange={(e) => setBranchLabel(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        검토자 메모 (선택)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>

      {canEdit && (
        <button
          type="button"
          disabled={!hasFieldChanges || labelRequired || isSaving}
          onClick={() => void handleSaveFields()}
          className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {isSaving ? "저장 중..." : "속성 저장"}
        </button>
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
            disabled={!hasRetarget || newFromNodeId === newToNodeId || (!isTechnical && retargetReason.trim().length === 0)}
            onClick={() => setConfirmingRetarget(true)}
            className="self-start rounded-md border border-blue-400 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            변경 검토
          </button>
          {newFromNodeId === newToNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
        </div>
      )}

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

      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}

      <dialog
        ref={dialogRef}
        aria-labelledby="retarget-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!isRetargeting) setConfirmingRetarget(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="retarget-confirm-title" className="text-sm font-semibold">
          분기 대상 변경 확인
        </h2>
        {preview && (
          <div className="mt-3 space-y-2 text-sm">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">현재</p>
              <p>
                {preview.current.from.title} → {preview.current.to.title} ({procedureBranchTypeLabels[preview.current.branchType]})
              </p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">변경 후</p>
              <p className="font-medium">
                {preview.proposed.from.title} → {preview.proposed.to.title} ({procedureBranchTypeLabels[preview.proposed.branchType]})
              </p>
            </div>
            <p className="whitespace-pre-wrap text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">사유:</span> {retargetReason}
            </p>
          </div>
        )}
        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmingRetarget(false)}
            disabled={isRetargeting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmRetarget()}
            disabled={isRetargeting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isRetargeting ? "적용 중..." : "적용"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
