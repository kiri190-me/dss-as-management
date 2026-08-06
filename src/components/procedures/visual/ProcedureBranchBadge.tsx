import { EDGE_VISUAL_CONFIG } from "@/lib/domain/procedure-visual-language";
import { procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * The edge-type equivalent of ProcedureNodeChip (Phase 3B) — a color +
 * dash-pattern swatch + label, driven by EDGE_VISUAL_CONFIG so a given
 * branch type renders identically in the graph's edge labels and in the
 * validation-resolution screens' edge lists. Never relies on color alone:
 * the swatch's dash pattern and the text label both change per type too.
 */
export default function ProcedureBranchBadge({
  branchType,
  label,
}: {
  branchType: ProcedureBranchType;
  label?: string | null;
}) {
  const config = EDGE_VISUAL_CONFIG[branchType];
  const displayLabel = label ?? config.defaultLabel ?? procedureBranchTypeLabels[branchType];

  const cssVars = {
    "--edge-stroke-light": config.strokeLight,
    "--edge-stroke-dark": config.strokeDark,
  } as React.CSSProperties;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      <svg viewBox="0 0 24 8" className="h-2 w-6 shrink-0" style={cssVars} aria-hidden="true">
        <line
          x1="1"
          y1="4"
          x2="23"
          y2="4"
          className="stroke-[var(--edge-stroke-light)] dark:stroke-[var(--edge-stroke-dark)]"
          strokeWidth={config.strokeWidth + 1}
          strokeDasharray={config.dashPattern}
          strokeLinecap="round"
        />
      </svg>
      {displayLabel}
    </span>
  );
}
