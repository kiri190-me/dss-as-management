import type { IconKey } from "@/lib/domain/procedure-visual-language";

/**
 * Phase 3B — hand-authored inline SVG icons, one per IconKey. Deliberately
 * not an icon library dependency: ~9 small line-art glyphs, all using
 * `currentColor` so they inherit whatever text color the chip around them
 * sets (light/dark theme handled by the caller, not here).
 */

type IconProps = { className?: string };

const STROKE_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function StartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <polygon points="6,4 20,12 6,20" />
    </svg>
  );
}

function EndIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TaskIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  );
}

function InspectionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </svg>
  );
}

function WrenchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2z" />
    </svg>
  );
}

function DecisionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M12 8v3M12 15v.01" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.2" />
    </svg>
  );
}

function ChecklistIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 2.5h6v2H9z" fill="currentColor" stroke="none" />
      <path d="M8 11l1.5 1.5L12 9.5M8 16l1.5 1.5L12 14.5" />
    </svg>
  );
}

function TroubleshootingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 4v16" />
    </svg>
  );
}

function DocumentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12h5M9.5 15.5h5" />
    </svg>
  );
}

function HoldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

const ICON_COMPONENTS: Record<IconKey, (props: IconProps) => React.JSX.Element> = {
  start: StartIcon,
  end: EndIcon,
  task: TaskIcon,
  inspection: InspectionIcon,
  wrench: WrenchIcon,
  decision: DecisionIcon,
  checklist: ChecklistIcon,
  troubleshooting: TroubleshootingIcon,
  document: DocumentIcon,
  hold: HoldIcon,
};

export default function ProcedureNodeIcon({ iconKey, className }: { iconKey: IconKey; className?: string }) {
  const Icon = ICON_COMPONENTS[iconKey];
  return <Icon className={className} />;
}
