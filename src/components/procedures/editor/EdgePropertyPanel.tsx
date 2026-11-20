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
import type { NodeLookup } from "@/lib/domain/procedure-editor-client-state";
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
 * 🔴 됐다는 증거는 **지도에서 연결선이 옮겨 붙는 것**이다. 🔴 2026-11-20(조각 4)
 * 에 「실패는 아래 errorMessage 한 자리가 유일한 통로다」가 **더 이상 사실이 아니게**
 * 됐다 — 이 패널에는 실패할 서버 호출이 한 건도 안 남아 그 자리가 화면 위쪽 한 곳으로
 * 옮겨 갔다(아래 조각 4 절).
 * 🟢 **삭제(분기 삭제)는 건드리지 않았다** — 사용자가 말한 것은 추가/수정이다.
 *
 * ── 🔴 2026-11-20(조각 4) — 재연결·삭제·노드 끼우기 셋이 **[저장] 쪽으로 갔다** ──
 * 쓰는 분의 요청으로 구조 변경 일곱이 전부 모아 두는 쪽으로 옮겼다. 이 패널은 이제
 * 서버 액션을 하나도 부르지 않는다 — 무엇을 할지만 적어 화면에 넘기고, 화면이
 * [저장]에서 **같은 액션 셋을** 부른다(서버는 한 글자도 안 바뀌었다). 위 줄기 B-②
 * 의 「지도에서 옮겨 붙는 것이 증거」는 이제 **저장됐다는 증거가 아니라 모아 뒀다는
 * 증거**다 — 그래서 아래 각 묶음에 「[저장]을 눌러야 간다」를 한 줄씩 적었다.
 *
 * 🔴 **아직 저장 안 된 연결선 위에는 노드를 못 끼운다.** 서버 함수가 진짜 연결선
 * 하나를 전제하기 때문이다(조각 1 의 INSERT_ON_UNSAVED_EDGE). 그 조작이 목록에
 * 들어가면 [저장]이 통째로 막히므로, **조작 자체를 여기서 막는다** —
 * insertNodeBlockedReason.
 */
export default function EdgePropertyPanel({
  edge,
  nodes,
  canEdit,
  draft,
  onDraftChange,
  note,
  onNoteChange,
  onQueueRetarget,
  routePoints,
  selectedWaypointIndex,
  onAddWaypoint,
  onRemoveSelectedWaypoint,
  onResetRoute,
  onStraighten,
  canDelete,
  onQueueDelete,
  canInsertNode,
  insertNodeBlockedReason = null,
  onQueueInsertNode,
  isTechnical,
}: {
  edge: EditorEdgeRow;
  nodes: EditorNodeRow[];
  canEdit: boolean;
  /** 5C-6D-1C — screen-owned pending draft for branchType/branchLabel; already reflects any locally-unsaved edit (this panel never keeps its own copy). */
  draft: ProcedureEdgeFieldDraft;
  onDraftChange: (patch: Partial<ProcedureEdgeFieldDraft>) => void;
  /** 5C-6D-1C — screen-owned "검토자 메모" text, sent only if/when the EDGE_FIELDS save step for this edge actually runs; blank means no note. Not part of `draft` — see this file's own doc comment. */
  note: string;
  onNoteChange: (note: string) => void;
  /** 🔴 서버에 보내지 않고 **모아 둔다**(2026-11-20, 조각 4). 그림에서는 그 자리에서 선이 옮겨 붙는다. */
  onQueueRetarget: (newFromNodeId: string, newToNodeId: string, reason: string | null) => void;
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
  /** 🔴 서버에 보내지 않고 **모아 둔다**. 그림에서는 그 자리에서 선이 사라진다. */
  onQueueDelete: (reason: string | null) => void;
  /** Phase 5C-5B — same gate as canDelete (TECHNICAL_TASK DRAFT, ADMIN+SUPER_ADMIN); a separate prop only so the two capabilities stay independently named/readable at each call site. */
  canInsertNode: boolean;
  /**
   * 지금은 **끼울 수 없는** 까닭(2026-11-20, 조각 4). null 이면 끼울 수 있다.
   *
   * 🔴 아직 저장 안 된 연결선이 그 경우다. 조각 1 이 적어 둔 대로 쪼갤 차례가
   * 성립하지 않아(삽입은 노드 만들기보다 앞서야 하는데, 쪼갤 선을 만드는 일이
   * 그보다 앞서야 한다) 접기가 그 조작을 conflicts 로 올리고 **[저장]이 통째로
   * 막힌다.** 저장을 막는 것보다 조작 자체를 막는 쪽이 낫다.
   */
  insertNodeBlockedReason?: string | null;
  /** 🔴 서버에 보내지 않고 **모아 둔다**. 그림에서는 그 자리에서 선이 둘로 갈린다. */
  onQueueInsertNode: (input: { nodeType: ManualTechnicalNodeType; title: string; position: RoutePoint }) => void;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK; relaxes the retarget reason from mandatory to optional (UI mirror of the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason, unchanged. */
  isTechnical: boolean;
}) {
  const nodesById = new Map<string, NodeLookup>(nodes.map((n) => [n.id, { id: n.id, title: n.title, nodeCode: n.nodeCode }]));

  const [newFromNodeId, setNewFromNodeId] = useState(edge.fromNodeId);
  const [newToNodeId, setNewToNodeId] = useState(edge.toNodeId);
  const [retargetReason, setRetargetReason] = useState("");

  const [deleteReason, setDeleteReason] = useState("");

  const [showInsertNodeForm, setShowInsertNodeForm] = useState(false);
  const [insertNodeType, setInsertNodeType] = useState<ManualTechnicalNodeType>("TASK");
  const [insertNodeTitle, setInsertNodeTitle] = useState("");

  const hasRetarget = newFromNodeId !== edge.fromNodeId || newToNodeId !== edge.toNodeId;
  const labelRequired = draft.branchType === "CUSTOM" && draft.branchLabel.trim().length === 0;

  /**
   * [대상 변경] 의 본체 — 🔴 **모아 두기만 한다**(2026-11-20, 조각 4).
   *
   * 🔵 실패 검사가 사라진 까닭은 CreateEdgePanel 의 handleAdd 와 같다 — 되돌리기
   * 한 걸음을 화면이 **목록을 고치기 직전에** 쌓으므로, 실패한 호출로 한 걸음이
   * 쌓일 길 자체가 없어졌다.
   *
   * 🔵 사유는 그대로 실어 보낸다. FULL_SERVICE/REFERENCE 의 「사유 필수」를 지키는
   * 단추 조건(아래 disabled)도 전과 같은 식이다.
   */
  function handleRetarget() {
    onQueueRetarget(newFromNodeId, newToNodeId, retargetReason.trim() || null);
    setRetargetReason("");
  }

  function handleDelete() {
    onQueueDelete(deleteReason.trim() || null);
    setDeleteReason("");
  }

  function handleInsertNodeAtRoutePoint() {
    if (selectedWaypointIndex === null || !routePoints) return;
    const point = routePoints[selectedWaypointIndex];
    if (!point) return;
    onQueueInsertNode({ nodeType: insertNodeType, title: insertNodeTitle, position: point });
    setShowInsertNodeForm(false);
    setInsertNodeTitle("");
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
            disabled={!hasRetarget || newFromNodeId === newToNodeId || (!isTechnical && retargetReason.trim().length === 0)}
            onClick={handleRetarget}
            className="self-start rounded-md border border-blue-400 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            대상 변경
          </button>
          {newFromNodeId === newToNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
          <p className="text-blue-800 dark:text-blue-300">대상 변경은 화면 상단의 [저장]을 눌러야 서버에 저장됩니다.</p>
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
                disabled={selectedWaypointIndex === null || insertNodeBlockedReason !== null}
                className="rounded-md border border-blue-400 px-2.5 py-1 text-xs text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
              >
                이 위치에 노드 추가
              </button>
            )}
          </div>
        )}
        {/* 🔴 못 끼우는 까닭을 **그 단추 바로 아래** 적는다 — 흐린 단추만 두면 고장으로 읽힌다. */}
        {canEdit && canInsertNode && insertNodeBlockedReason && <p className="text-amber-700 dark:text-amber-400">{insertNodeBlockedReason}</p>}
        {canInsertNode && insertNodeBlockedReason === null && showInsertNodeForm && selectedWaypointIndex !== null && (
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
                disabled={insertNodeTitle.trim().length === 0}
                onClick={handleInsertNodeAtRoutePoint}
                className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                노드 삽입
              </button>
              <button
                type="button"
                onClick={() => setShowInsertNodeForm(false)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                취소
              </button>
            </div>
            <p className="text-blue-800 dark:text-blue-300">끼운 노드는 화면 상단의 [저장]을 눌러야 서버에 저장됩니다.</p>
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
          {/*
            🔵 2026-11-21 — 키 이야기는 **툴팁 하나**로 적는다(까닭은
            NodePropertyPanel 의 같은 자리에 있다 — 상시 안내를 두 번 세웠다 두 번
            다 지웠다).
            🔴 경로점을 고른 동안에는 [Delete] 가 **그 경로점부터** 지운다(고른 것
            중 가장 안쪽). 그 상태에서 「[Delete] 로도 분기를 지울 수 있다」고
            적으면 거짓이라, 같은 자리에서 그 차례를 그대로 말한다.
          */}
          <button
            type="button"
            onClick={handleDelete}
            title={
              selectedWaypointIndex === null
                ? "[Delete] 키로도 지울 수 있습니다"
                : "경로점을 고른 동안에는 [Delete] 가 그 경로점을 먼저 지웁니다"
            }
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            분기 삭제
          </button>
          {/* 🔴 지워도 아직 안 간다 — 그림에서 사라지는 것이 더 이상 「저장됐다」는 증거가 아니다. */}
          <p className="text-red-700 dark:text-red-400">삭제는 화면 상단의 [저장]을 눌러야 서버에 반영됩니다.</p>
        </div>
      )}
      {/*
        🔴 2026-11-20(조각 4) — **실패를 알리던 자리가 여기서 없어졌다.** 재연결·
        노드 끼우기·삭제 셋이 전부 [저장] 쪽으로 옮겨 가 이 패널에는 실패할 호출이
        한 건도 안 남았다. 서버가 거절하면 그 글은 화면 위쪽 [저장] 줄 아래에서
        나온다 — 실패를 알리는 자리를 **하나로 모은 것**이지 없앤 것이 아니다.
      */}
    </div>
  );
}
