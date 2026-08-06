"use client";

import { useState } from "react";
import { SEMANTIC_NODE_VISUAL_TYPES, NODE_VISUAL_CONFIG } from "@/lib/domain/procedure-visual-language";
import { PROCEDURE_BRANCH_TYPE_CODES } from "@/lib/domain/procedure-template-types";
import ProcedureNodeChip from "./ProcedureNodeChip";
import ProcedureBranchBadge from "./ProcedureBranchBadge";

/**
 * Compact expandable legend (Phase 3B) — renders the exact same
 * ProcedureNodeChip/ProcedureBranchBadge components the graph and
 * validation screens use, not separate illustrations, so the legend can
 * never drift out of sync with what the graph actually shows.
 */
export default function ProcedureGraphLegend() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300"
        aria-expanded={expanded}
      >
        <span>범례</span>
        <span aria-hidden="true">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <div>
            <p className="mb-2 font-semibold text-zinc-500 dark:text-zinc-400">노드 유형</p>
            <div className="flex flex-wrap gap-2">
              {SEMANTIC_NODE_VISUAL_TYPES.map((type) => (
                <ProcedureNodeChip
                  key={type}
                  semanticType={type}
                  iconKey={NODE_VISUAL_CONFIG[type].iconKey}
                  title={NODE_VISUAL_CONFIG[type].label}
                  size="graph"
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 font-semibold text-zinc-500 dark:text-zinc-400">분기 유형</p>
            <div className="flex flex-wrap gap-2">
              {PROCEDURE_BRANCH_TYPE_CODES.map((branchType) => (
                <ProcedureBranchBadge key={branchType} branchType={branchType} />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
            노란색 경고 표시(!)가 있는 노드는 미해결 검증 이슈가 있는 노드입니다. 재진행(LOOP_BACK) 분기는 보라색
            점선과 애니메이션으로 강조됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
