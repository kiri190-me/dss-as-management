import type { ProcedureChecklistSectionRow } from "@/lib/db/queries/procedure-templates";

function measurementSummary(item: ProcedureChecklistSectionRow["items"][number]): string | null {
  if (!item.measurementType) return null;
  const range =
    item.minValue !== null && item.maxValue !== null
      ? item.minValue === item.maxValue
        ? item.minValue
        : `${item.minValue} ~ ${item.maxValue}`
      : (item.minValue ?? item.maxValue ?? "");
  return `${range}${item.measurementUnit ?? ""}`.trim();
}

/**
 * Read-only viewer for a CHECKLIST-type node's sections/items (the
 * imported form of e.g. (MB) 외관 및 내부 검사 — Phase 1 report §3). Each
 * section is a native <details> disclosure so a reviewer can scan section
 * titles first, matching how the source workbook itself presents the form
 * as a sequence of collapsible topics.
 */
export default function ProcedureChecklistViewer({ sections }: { sections: ProcedureChecklistSectionRow[] }) {
  if (sections.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section) => (
        <details
          key={section.id}
          className="group rounded-lg border border-zinc-200 bg-white open:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:open:bg-zinc-800/40"
        >
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
            <span>{section.title}</span>
            <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
              {section.items.length}개 항목 · {section.sourceCellRange ?? section.sourceWorksheet}
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            {section.items.map((item) => {
              const measurement = measurementSummary(item);
              return (
                <div key={item.id} className="rounded-md border border-zinc-100 p-3 text-xs dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.title}</span>
                    {item.required && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        필수
                      </span>
                    )}
                    {measurement && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                        {item.measurementType} {measurement}
                      </span>
                    )}
                  </div>
                  {item.instructions && (
                    <p className="mt-2 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{item.instructions}</p>
                  )}
                  <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-600">원본 셀: {item.sourceCellRange}</p>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
