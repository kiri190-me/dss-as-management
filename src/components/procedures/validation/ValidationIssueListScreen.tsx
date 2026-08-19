"use client";

import { useMemo, useState } from "react";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import { ListCard } from "@/components/common/list-card";
import Link from "next/link";
import {
  procedureValidationSeverityLabels,
  procedureValidationIssueTypeLabels,
  procedureValidationResolutionStatusLabels,
  procedureValidationConfidenceLabels,
  type ProcedureValidationResolutionStatus,
} from "@/lib/domain/procedure-template-types";
import type { ValidationIssueListResult } from "@/lib/db/queries/procedure-validation-resolutions";
import { buildWorkflowViewHref, parseSourceReference } from "@/lib/domain/procedure-graph-navigation";

const ALL = "ALL";

const STATUS_BADGE: Record<ProcedureValidationResolutionStatus, string> = {
  UNRESOLVED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  RESOLVED_WITH_GRAPH_CHANGE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  RESOLVED_NO_CHANGE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  DEFERRED: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

/**
 * Narrow validation-issue queue for one template (Phase 3A) — every row
 * links to /procedures/[id]/validation/[issueId], never edits inline.
 * Filters are computed client-side (confidence isn't even a database
 * column — it comes from the static known-issue classifier) since each
 * template's issue count is small.
 */
export default function ValidationIssueListScreen({ result }: { result: ValidationIssueListResult }) {
  const { template, issues, summary } = result;
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [worksheetFilter, setWorksheetFilter] = useState(ALL);
  const [issueTypeFilter, setIssueTypeFilter] = useState(ALL);
  const [confidenceFilter, setConfidenceFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const worksheets = useMemo(() => [...new Set(issues.map((i) => i.sourceWorksheet).filter((w): w is string => !!w))], [issues]);
  const issueTypes = useMemo(() => [...new Set(issues.map((i) => i.issueType))], [issues]);

  const filtered = issues.filter((i) => {
    if (unresolvedOnly && i.resolutionStatus !== "UNRESOLVED") return false;
    if (worksheetFilter !== ALL && i.sourceWorksheet !== worksheetFilter) return false;
    if (issueTypeFilter !== ALL && i.issueType !== issueTypeFilter) return false;
    if (confidenceFilter !== ALL && i.classification?.confidence !== confidenceFilter) return false;
    if (statusFilter !== ALL && i.resolutionStatus !== statusFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/procedures/${template.id}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
          ← {template.name} 상세로
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">검증 문제 검토 — {template.name}</h1>
        <p className="mt-1 font-mono text-xs text-zinc-400 dark:text-zinc-600">{template.code}</p>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <span className="text-zinc-400 dark:text-zinc-600">전체 오류</span>
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{summary.totalErrorCount}</p>
        </div>
        <div>
          <span className="text-zinc-400 dark:text-zinc-600">미해결</span>
          <p className="text-lg font-semibold text-red-600 dark:text-red-400">{summary.unresolvedErrorCount}</p>
        </div>
        <div>
          <span className="text-zinc-400 dark:text-zinc-600">해결됨</span>
          <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{summary.resolvedErrorCount}</p>
        </div>
        <div>
          <span className="text-zinc-400 dark:text-zinc-600">게시 차단 중</span>
          <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">{summary.publicationBlockingErrorCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} />
          미해결만 보기
        </label>
        <select value={worksheetFilter} onChange={(e) => setWorksheetFilter(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
          <option value={ALL}>전체 워크시트</option>
          {worksheets.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <select value={issueTypeFilter} onChange={(e) => setIssueTypeFilter(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
          <option value={ALL}>전체 유형</option>
          {issueTypes.map((t) => (
            <option key={t} value={t}>
              {procedureValidationIssueTypeLabels[t] ?? t}
            </option>
          ))}
        </select>
        <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
          <option value={ALL}>전체 신뢰도</option>
          <option value="HIGH">{procedureValidationConfidenceLabels.HIGH}</option>
          <option value="MEDIUM">{procedureValidationConfidenceLabels.MEDIUM}</option>
          <option value="LOW">{procedureValidationConfidenceLabels.LOW}</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
          <option value={ALL}>전체 상태</option>
          {(Object.keys(procedureValidationResolutionStatusLabels) as ProcedureValidationResolutionStatus[]).map((s) => (
            <option key={s} value={s}>
              {procedureValidationResolutionStatusLabels[s]}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          조건에 맞는 이슈가 없습니다.
        </p>
      ) : (
        <ResponsiveList
          listId="procedure-validation-issues"
          table={
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">심각도</th>
                <th className="px-3 py-2 font-medium">유형</th>
                <th className="px-3 py-2 font-medium">워크시트</th>
                <th className="px-3 py-2 font-medium">원본 참조</th>
                <th className="px-3 py-2 font-medium">내용</th>
                <th className="px-3 py-2 font-medium">신뢰도</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">처리자</th>
                <th className="px-3 py-2 font-medium">처리일</th>
                <th className="px-3 py-2 font-medium">처리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => {
                const { shapeId, connectorId } = parseSourceReference(issue.sourceReference);
                // Always navigates straight into 오류 집중 보기 (Problem 2) —
                // the graph screen re-derives exact/fallback/candidate-only
                // state from these same stable identifiers, never from node
                // title text.
                const workflowHref = buildWorkflowViewHref({
                  templateId: template.id,
                  issueId: issue.id,
                  worksheet: issue.sourceWorksheet,
                  shapeId,
                  connectorId,
                  errorFocus: true,
                });
                return (
                  <tr key={issue.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                    <td className="px-3 py-2">{procedureValidationSeverityLabels[issue.severity]}</td>
                    <td className="px-3 py-2">
                      <Link href={`/procedures/${template.id}/validation/${issue.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
                        {procedureValidationIssueTypeLabels[issue.issueType] ?? issue.issueType}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{issue.sourceWorksheet}</td>
                    <td className="px-3 py-2 font-mono">{issue.sourceReference}</td>
                    <td className="px-3 py-2 max-w-[280px] truncate text-zinc-600 dark:text-zinc-400" title={issue.message}>
                      {issue.message}
                    </td>
                    <td className="px-3 py-2">{issue.classification ? procedureValidationConfidenceLabels[issue.classification.confidence] : "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[issue.resolutionStatus]}`}>
                        {procedureValidationResolutionStatusLabels[issue.resolutionStatus]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{issue.resolvedByName ?? "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{issue.resolvedAt ? formatDate(issue.resolvedAt) : "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <Link
                          href={workflowHref}
                          className="rounded-md border border-blue-300 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950"
                        >
                          오류 위치 보기
                        </Link>
                        <Link
                          href={`/procedures/${template.id}/validation/${issue.id}`}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          처리
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          }
          cards={
            <ul className={LIST_CARD_GRID}>
              {filtered.map((issue) => {
                const { shapeId, connectorId } = parseSourceReference(issue.sourceReference);
                const workflowHref = buildWorkflowViewHref({
                  templateId: template.id,
                  issueId: issue.id,
                  worksheet: issue.sourceWorksheet,
                  shapeId,
                  connectorId,
                  errorFocus: true,
                });
                return (
                  <ListCard
                    key={issue.id}
                    href={`/procedures/${template.id}/validation/${issue.id}`}
                    title={procedureValidationIssueTypeLabels[issue.issueType] ?? issue.issueType}
                    badge={
                      <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[issue.resolutionStatus]}`}>
                        {procedureValidationResolutionStatusLabels[issue.resolutionStatus]}
                      </span>
                    }
                    fields={[
                      { label: "심각도", value: procedureValidationSeverityLabels[issue.severity] },
                      { label: "워크시트", value: issue.sourceWorksheet },
                      { label: "원본", value: <span className="font-mono">{issue.sourceReference}</span> },
                      { label: "내용", value: issue.message },
                      {
                        label: "신뢰도",
                        value: issue.classification
                          ? procedureValidationConfidenceLabels[issue.classification.confidence]
                          : null,
                      },
                      { label: "처리자", value: issue.resolvedByName },
                      { label: "처리일", value: issue.resolvedAt ? formatDate(issue.resolvedAt) : null },
                    ]}
                    actions={
                      <>
                        <Link
                          href={workflowHref}
                          className="rounded-md border border-blue-300 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950"
                        >
                          오류 위치 보기
                        </Link>
                        <Link
                          href={`/procedures/${template.id}/validation/${issue.id}`}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          처리
                        </Link>
                      </>
                    }
                  />
                );
              })}
            </ul>
          }
        />
      )}
    </div>
  );
}
