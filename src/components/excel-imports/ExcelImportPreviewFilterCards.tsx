import {
  EXCEL_IMPORT_PREVIEW_FILTER_LABELS,
  EXCEL_IMPORT_PREVIEW_FILTERS,
  type ExcelImportPreviewFilter,
} from "@/lib/domain/excel-import-preview-filter";

type FilterCounts = {
  total: number;
  executable: number;
  autoExcluded: number;
  conflicts: number;
  imported: number;
};

const COLOR_CLASSES: Readonly<Record<ExcelImportPreviewFilter, string>> = {
  ALL: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  EXECUTABLE: "hover:bg-emerald-50 dark:hover:bg-emerald-950",
  AUTO_EXCLUDED: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  CONFLICT: "hover:bg-amber-50 dark:hover:bg-amber-950",
  IMPORTED: "hover:bg-blue-50 dark:hover:bg-blue-950",
};

function countFor(filter: ExcelImportPreviewFilter, counts: FilterCounts): number {
  if (filter === "EXECUTABLE") return counts.executable;
  if (filter === "AUTO_EXCLUDED") return counts.autoExcluded;
  if (filter === "CONFLICT") return counts.conflicts;
  if (filter === "IMPORTED") return counts.imported;
  return counts.total;
}

export function ExcelImportPreviewFilterCards({
  selected,
  counts,
  onSelect,
}: {
  selected: ExcelImportPreviewFilter;
  counts: FilterCounts;
  onSelect: (filter: ExcelImportPreviewFilter) => void;
}) {
  return (
    <div aria-label="Preview 목록 필터" className="grid w-full grid-cols-2 gap-2 text-center text-sm sm:grid-cols-3 xl:w-auto xl:grid-cols-5">
      {EXCEL_IMPORT_PREVIEW_FILTERS.map((filter) => {
        const isSelected = selected === filter;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(filter)}
            className={`min-w-0 rounded-md border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${COLOR_CLASSES[filter]} ${isSelected ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600 dark:bg-blue-950" : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
          >
            <span className="block font-semibold text-zinc-900 dark:text-zinc-100">{countFor(filter, counts)}</span>
            <span className="block text-xs text-zinc-500">{EXCEL_IMPORT_PREVIEW_FILTER_LABELS[filter]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ExcelImportPreviewEmptyRow() {
  return (
    <tr>
      <td colSpan={18} className="px-3 py-10 text-center text-zinc-500">해당하는 항목이 없습니다</td>
    </tr>
  );
}
