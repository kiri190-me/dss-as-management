import {
  procedureValidationIssueTypeLabels,
  procedureValidationSeverityLabels,
  type ProcedureValidationSeverity,
} from "@/lib/domain/procedure-template-types";
import type { ProcedureValidationIssueRow } from "@/lib/db/queries/procedure-templates";

const SEVERITY_STYLES: Record<ProcedureValidationSeverity, string> = {
  ERROR: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  WARNING: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  INFO: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

/**
 * Read-only validation issue queue (this task's requirement: "validation
 * issues show source worksheet references"). Resolution (resolved_at/
 * resolved_by/resolution_note) is display-only here — no Phase 2 UI writes
 * to procedure_template_validation_issues; that is future editor work.
 */
export default function ProcedureValidationIssuePanel({ issues }: { issues: ProcedureValidationIssueRow[] }) {
  if (issues.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        검증 이슈가 없습니다.
      </p>
    );
  }

  const errorCount = issues.filter((i) => i.severity === "ERROR" && !i.resolvedAt).length;
  const warningCount = issues.filter((i) => i.severity === "WARNING" && !i.resolvedAt).length;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        미해결 오류 {errorCount}건 · 미해결 경고 {warningCount}건 (전체 {issues.length}건)
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">심각도</th>
              <th className="px-3 py-2 font-medium">유형</th>
              <th className="px-3 py-2 font-medium">내용</th>
              <th className="px-3 py-2 font-medium">원본 위치</th>
              <th className="px-3 py-2 font-medium">해결 여부</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_STYLES[issue.severity]}`}>
                    {procedureValidationSeverityLabels[issue.severity]}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                  {procedureValidationIssueTypeLabels[issue.issueType] ?? issue.issueType}
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{issue.message}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500 dark:text-zinc-500">
                  {issue.sourceWorksheet}
                  {issue.sourceReference ? ` · ${issue.sourceReference}` : ""}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500 dark:text-zinc-500">
                  {issue.resolvedAt ? `해결됨 (${issue.resolvedByName ?? "-"})` : "미해결"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
