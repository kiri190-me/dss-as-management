import Link from "next/link";
import {
  NODE_VISUAL_CONFIG,
  NODE_SIZE,
  NODE_BORDER,
  ISSUE_BADGE_STYLES,
  computeNodeDimensions,
  getNodeContentExtraHorizontalPadding,
  shouldShowNodeIcon,
  type NodeShapeKind,
  type SemanticNodeVisualType,
  type IconKey,
  type NodeIssueBadge,
} from "@/lib/domain/procedure-visual-language";
import ProcedureNodeIcon from "./ProcedureNodeIcons";

/**
 * The single reusable "what is this node" unit (Phase 3B) — icon + shape-
 * appropriate colored container + title, driven entirely by
 * NODE_VISUAL_CONFIG so every screen renders a given semantic node type
 * identically. Takes the semantic type + icon directly (not a raw
 * ProcedureNodeType) so callers with real stored data derive both via
 * getSemanticNodeVisualType/getNodeIconKey, while the legend can render
 * HOLD_OR_REVIEW/SUBPROCESS_OR_STAGE — semantic types with no
 * corresponding stored ProcedureNodeType today — the same way.
 *
 * Used both as the inner content of the read-only graph's custom node
 * component (`size="graph"`, real shape geometry, the graph adds its own
 * Handles around this) and as a compact inline chip in the Phase 3A
 * validation-resolution screens (`size="compact"`, same icon/colors/label,
 * simplified container — shape geometry mostly disappears at 14px
 * regardless of how it's built, so legibility wins there; the legend
 * always renders `size="graph"` so it stays a true sample of the graph's
 * own shapes).
 */

const SHAPE_CLASS: Record<NodeShapeKind, string> = {
  capsule: "rounded-full",
  rect: "rounded-lg",
  diamond: "rounded-lg", // graph size overrides via clip-path below; compact size keeps the pill
  "double-border-rect": "rounded-lg",
  document: "rounded-lg",
  "pentagon-warning": "rounded-lg",
};

const SHAPE_CLIP_PATH: Partial<Record<NodeShapeKind, string>> = {
  // A true rotated-square diamond clipped against a wide, short flex box
  // squeezes to a near-zero-height sliver at the left/right edges — since
  // the icon+label flex row spans nearly the full box width, most of it
  // lands in that sliver and gets clipped away. This gentler diamond-like
  // hexagon keeps a full-height, unclipped band from 10% to 90% of the
  // width (only the outer corners taper to points) so the shape still reads
  // as a rhombus while maximizing the safe text area for long Korean
  // decision questions — readability over strict BPMN diamond geometry.
  diamond: "polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)",
  document: "polygon(0% 0%, 78% 0%, 100% 22%, 100% 100%, 0% 100%)",
  "pentagon-warning": "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
};

export type ProcedureNodeChipProps = {
  semanticType: SemanticNodeVisualType;
  iconKey: IconKey;
  title: string;
  subtitle?: string | null;
  size?: "graph" | "compact";
  /** Non-null when this node has an unresolved ERROR/WARNING validation issue. Carries the issue id so the badge can link straight to it. */
  issueBadge?: NodeIssueBadge | null;
  /** Href for the issue badge (e.g. /procedures/{id}/validation/{issueId}) — omit to render the badge as a non-interactive indicator (e.g. in the legend). */
  issueHref?: string;
  isSelected?: boolean;
  isDimmed?: boolean;
  /** Problem 2 revision (오류 집중 보기) — a much stronger dim than the ordinary node-selected dimming, for everything outside the focused issue's immediate neighborhood. */
  isSeverelyDimmed?: boolean;
};

export default function ProcedureNodeChip({
  semanticType,
  iconKey,
  title,
  subtitle,
  size = "compact",
  issueBadge = null,
  issueHref,
  isSelected = false,
  isDimmed = false,
  isSeverelyDimmed = false,
}: ProcedureNodeChipProps) {
  const config = NODE_VISUAL_CONFIG[semanticType];
  const clipShape = size === "graph" ? SHAPE_CLIP_PATH[config.shape] : undefined;
  const isDoubleBorder = config.shape === "double-border-rect";
  // Adaptive sizing (graph size only — compact chips in validation screens
  // stay auto-width pills). The exact same function drives
  // computeStageSortedLayout's row packing, so the box the layout reserves
  // and the box actually rendered here can never disagree.
  const dims = size === "graph" ? computeNodeDimensions({ title, shape: config.shape }) : null;
  const badgeStyle = issueBadge ? ISSUE_BADGE_STYLES[issueBadge.severity] : null;
  // "For very compact nodes, the icon may be omitted before sacrificing
  // title readability" — see shouldShowNodeIcon's own doc comment. Compact
  // (validation-screen pill) size always shows its icon; this only applies
  // to the graph size's centered stack.
  const showGraphIcon = size === "graph" && shouldShowNodeIcon(dims);
  const graphContentExtraPadding = size === "graph" ? getNodeContentExtraHorizontalPadding(config.shape) : 0;

  // Theme-aware colors come from a JS config (per-semantic-type hex pairs),
  // not static Tailwind palette classes — so light/dark switching goes
  // through CSS custom properties set here and consumed by Tailwind
  // arbitrary-value `dark:` classes below, the one place in this component
  // that needs to bridge data-driven color to the app's existing
  // class-based dark mode toggle.
  const cssVars = {
    "--node-bg-light": config.bgLight,
    "--node-bg-dark": config.bgDark,
    "--node-border-light": config.borderLight,
    "--node-border-dark": config.borderDark,
    "--node-text-light": config.textLight,
    "--node-text-dark": config.textDark,
  } as React.CSSProperties;

  // The tooltip must always carry the FULL title (never dropped in favor of
  // the subtitle) — this is the "show the full title in a tooltip" fallback
  // for whenever the visible text is clamped.
  const tooltip = subtitle ? `${title} — ${subtitle}` : title;

  return (
    <div
      data-semantic-type={semanticType}
      className={[
        "relative inline-flex",
        SHAPE_CLASS[config.shape],
        // A ring/outline drawn on a clip-path'd shape layer gets clipped
        // away along with everything else outside the polygon (the same
        // bug the badge had) — so selection and issue-state indicators
        // live on this plain, unclipped outer box instead. For non-clipped
        // shapes this just draws around the same visible edge as before.
        // Selection (box-shadow ring), the WARNING/ERROR badge (CSS
        // outline), and the hover/focus glow below (filter: drop-shadow)
        // are three independent CSS channels, so any combination of them
        // stays visually distinguishable rather than one silently
        // overwriting another.
        // ring-offset defaults to white, which reads as an unwanted bright
        // halo against the app's dark canvas (`body`'s `--background:
        // #0a0a0a` in globals.css) — pin it to that same color in dark mode
        // so only the blue ring itself stands out, not a white gap around it.
        isSelected ? "ring-[3px] ring-offset-2 ring-blue-500 ring-offset-white dark:ring-blue-400 dark:ring-offset-[#0a0a0a]" : "",
        badgeStyle ? badgeStyle.outlineClass : "",
        isDimmed ? (isSeverelyDimmed ? "opacity-15" : "opacity-35") : "opacity-100",
        // drop-shadow (unlike box-shadow) hugs the actual rendered alpha
        // silhouette, so this hover/focus glow automatically follows the
        // diamond/document/pentagon clip-path shapes too, with no
        // shape-specific code — and it never moves or resizes the node
        // since `filter` doesn't participate in layout.
        "hover:drop-shadow-[0_0_3px_var(--node-border-light)] dark:hover:drop-shadow-[0_0_3px_var(--node-border-dark)]",
        "focus-within:drop-shadow-[0_0_3px_var(--node-border-light)] dark:focus-within:drop-shadow-[0_0_3px_var(--node-border-dark)]",
        "transition-[opacity,filter] duration-150",
      ].join(" ")}
      style={{ width: dims?.width, minHeight: dims?.height, ...cssVars }}
      title={tooltip}
    >
      {/* Shape layer: background/border/clip-path only — purely decorative.
          Kept separate from the content layer below so a shape's clip-path
          (diamond/document/pentagon) can never clip the title text or the
          issue badge, which sit in a sibling layer that ignores this one's
          clip entirely. */}
      {clipShape ? (
        <>
          {/* A CSS `border` on an element that also has `clip-path` only
              survives where the polygon touches the box's straight edges
              (e.g. the diamond's flat top/bottom segments) — every diagonal
              edge loses its border stroke entirely, since clip-path crops
              the whole rendered box (border included) to the polygon.
              Layered clip-path border instead: an outer div filled with the
              border color and clipped to the polygon, plus an inner div
              inset by NODE_BORDER.NORMAL_WIDTH, filled with the node's own
              background and clipped to the *same* polygon, painted on top —
              since clip-path polygons are percentage-based they scale with
              the inset box, so the visible ring follows the shape's actual
              outline (including diagonal edges) rather than faking a
              rectangular border around a non-rectangular node. */}
          <div
            aria-hidden="true"
            data-node-shape-layer="true"
            className={["bg-[var(--node-border-light)] dark:bg-[var(--node-border-dark)]", "absolute inset-0", SHAPE_CLASS[config.shape]].join(" ")}
            style={{ clipPath: clipShape }}
          />
          <div
            aria-hidden="true"
            className={["bg-[var(--node-bg-light)] dark:bg-[var(--node-bg-dark)]", "absolute", SHAPE_CLASS[config.shape]].join(" ")}
            style={{ inset: NODE_BORDER.NORMAL_WIDTH, clipPath: clipShape }}
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          data-node-shape-layer="true"
          className={[
            "bg-[var(--node-bg-light)] dark:bg-[var(--node-bg-dark)]",
            "border-[var(--node-border-light)] dark:border-[var(--node-border-dark)]",
            "absolute inset-0 border",
            SHAPE_CLASS[config.shape],
            isDoubleBorder ? "shadow-[var(--node-double-border-shadow-light)] dark:shadow-[var(--node-double-border-shadow-dark)]" : "",
          ].join(" ")}
          style={{
            borderWidth: isDoubleBorder ? NODE_BORDER.DOUBLE_INNER_WIDTH : NODE_BORDER.NORMAL_WIDTH,
            ...(isDoubleBorder
              ? ({
                  "--node-double-border-shadow-light": `0 0 0 ${NODE_BORDER.DOUBLE_GAP}px var(--node-bg-light), 0 0 0 ${NODE_BORDER.DOUBLE_GAP + NODE_BORDER.DOUBLE_OUTER_WIDTH}px var(--node-border-light)`,
                  "--node-double-border-shadow-dark": `0 0 0 ${NODE_BORDER.DOUBLE_GAP}px var(--node-bg-dark), 0 0 0 ${NODE_BORDER.DOUBLE_GAP + NODE_BORDER.DOUBLE_OUTER_WIDTH}px var(--node-border-dark)`,
                } as React.CSSProperties)
              : {}),
          }}
        />
      )}

      {/* Content layer: never clipped, never shrunk by the badge. UI-
          stabilization pass — the whole icon/type-label/title/subtitle
          group renders as one centered vertical stack (never icon-left +
          text-right) so the title stays visually centered inside the
          shape's safe inner area regardless of shape, icon presence, or
          badge/handle layers sitting outside this one entirely. */}
      <div
        data-node-content="true"
        className={[
          "text-[var(--node-text-light)] dark:text-[var(--node-text-dark)]",
          "relative z-[1] flex w-full min-w-0",
          size === "graph" ? "h-full flex-col items-center justify-center gap-0.5 py-1.5 text-center" : "items-center gap-1.5 px-2 py-0.5 text-xs",
        ].join(" ")}
        style={{
          ...cssVars,
          ...(size === "graph" ? { paddingLeft: 10 + graphContentExtraPadding, paddingRight: 10 + graphContentExtraPadding } : {}),
        }}
      >
        {size === "graph" ? (
          <>
            {(showGraphIcon || config.label) && (
              <div className="flex w-full items-center justify-center gap-1">
                {showGraphIcon && <ProcedureNodeIcon iconKey={iconKey} className="h-4 w-4 shrink-0" />}
                <span className="text-[9px] font-bold tracking-wide opacity-75">{config.label}</span>
              </div>
            )}
            <span
              className="w-full break-words whitespace-pre-line text-center font-semibold leading-tight"
              style={
                dims?.isTruncated
                  ? { display: "-webkit-box", WebkitLineClamp: NODE_SIZE.MAX_VISIBLE_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }
                  : undefined
              }
            >
              {title}
            </span>
            {subtitle && <span className="w-full truncate text-center text-[9px] opacity-55">{subtitle}</span>}
          </>
        ) : (
          <>
            <ProcedureNodeIcon iconKey={iconKey} className="h-3 w-3 shrink-0" />
            <span className="truncate font-medium">{title}</span>
          </>
        )}
      </div>

      {/* Badge layer: absolutely positioned outside the shape entirely — a
          warning badge must never shrink or be clipped/covered (task
          requirement), so it lives outside both layers above. */}
      {badgeStyle &&
        (issueHref ? (
          <Link
            href={issueHref}
            onClick={(e) => e.stopPropagation()}
            className={`absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${badgeStyle.badgeBgClass} hover:brightness-110`}
            aria-label={badgeStyle.label}
            title={badgeStyle.label}
          >
            !
          </Link>
        ) : (
          <span
            className={`absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${badgeStyle.badgeBgClass}`}
            aria-label={badgeStyle.label}
            title={badgeStyle.label}
          >
            !
          </span>
        ))}
    </div>
  );
}
