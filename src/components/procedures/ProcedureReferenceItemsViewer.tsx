import { procedureReferenceItemTypeLabels } from "@/lib/domain/procedure-template-types";
import type { ProcedureReferenceItemRow } from "@/lib/db/queries/procedure-templates";

const ITEM_TYPE_BADGE: Record<string, string> = {
  NAV_LINK: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  EXTERNAL_FILE_LINK: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
  CROSS_REFERENCE_ID: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  TEXT_NOTE: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function targetText(item: ProcedureReferenceItemRow): string {
  if (item.itemType === "NAV_LINK") return item.hyperlinkTarget ?? "-";
  if (item.itemType === "EXTERNAL_FILE_LINK") return item.hyperlinkTarget ?? "-";
  if (item.itemType === "CROSS_REFERENCE_ID") return `#${item.crossReferenceNumber ?? "-"} (미해결)`;
  return "-";
}

/**
 * Read-only viewer for a reference-only template's content (Main page, QC
 * — Phase 2.5). These templates have zero executable nodes/edges by
 * design, so this table (worksheet + cell range + hyperlink target /
 * cross-reference number) is their entire content, not a supplementary
 * panel next to a flowchart.
 */
export default function ProcedureReferenceItemsViewer({ items }: { items: ProcedureReferenceItemRow[] }) {
  if (items.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="px-3 py-2 font-medium">유형</th>
            <th className="px-3 py-2 font-medium">내용</th>
            <th className="px-3 py-2 font-medium">원본 시트 · 셀</th>
            <th className="px-3 py-2 font-medium">대상</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${ITEM_TYPE_BADGE[item.itemType]}`}>
                  {procedureReferenceItemTypeLabels[item.itemType]}
                </span>
              </td>
              <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{item.label}</td>
              <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                {item.sourceWorksheet}
                {item.sourceCellRange ? ` · ${item.sourceCellRange}` : ""}
              </td>
              <td className="px-3 py-2 max-w-[320px] truncate text-xs text-zinc-500 dark:text-zinc-400" title={targetText(item)}>
                {targetText(item)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
