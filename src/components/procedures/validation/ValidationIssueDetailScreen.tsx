import Link from "next/link";
import {
  procedureValidationSeverityLabels,
  procedureValidationIssueTypeLabels,
  procedureValidationResolutionStatusLabels,
  procedureValidationConfidenceLabels,
} from "@/lib/domain/procedure-template-types";
import { getNodeChipVisual } from "@/lib/domain/procedure-visual-language";
import { buildWorkflowViewHref } from "@/lib/domain/procedure-graph-navigation";
import type {
  ValidationIssueDetail,
  ValidationIssueCandidateRow,
  ValidationIssueDetailNodeSummary,
  ValidationResolutionHistoryRow,
} from "@/lib/db/queries/procedure-validation-resolutions";
import ProcedureNodeChip from "../visual/ProcedureNodeChip";
import ProcedureBranchBadge from "../visual/ProcedureBranchBadge";
import BindConnectorForm from "./BindConnectorForm";
import NoChangeResolutionForm from "./NoChangeResolutionForm";
import ReopenRollbackControls from "./ReopenRollbackControls";
import ResolutionHistoryPanel from "./ResolutionHistoryPanel";

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  MEDIUM: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  LOW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function NodeSummaryChip({ node }: { node: ValidationIssueDetailNodeSummary }) {
  const { semanticType, iconKey } = getNodeChipVisual(node.nodeType);
  return (
    <ProcedureNodeChip
      semanticType={semanticType}
      iconKey={iconKey}
      title={node.title}
      subtitle={`${node.sourceWorksheet ?? ""} · ${node.nodeCode}`}
    />
  );
}

function CandidateTable({ title, candidates }: { title: string; candidates: ValidationIssueCandidateRow[] }) {
  if (candidates.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">shape#</th>
              <th className="px-3 py-2 font-medium">가져온 노드</th>
              <th className="px-3 py-2 font-medium">거리</th>
              <th className="px-3 py-2 font-medium">이미 연결됨</th>
              <th className="px-3 py-2 font-medium">후보 사유</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.shapeId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2 font-mono">{c.shapeId}</td>
                <td className="px-3 py-2">
                  {c.nodeId && c.nodeType ? (
                    <NodeSummaryChip
                      node={{ id: c.nodeId, nodeCode: "", nodeType: c.nodeType, title: c.title ?? c.shapeId, sourceWorksheet: c.sourceWorksheet, sourceShapeId: c.shapeId }}
                    />
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-600">(가져오지 않음)</span>
                  )}
                </td>
                <td className="px-3 py-2">{c.distance.toFixed(2)}</td>
                <td className="px-3 py-2">{c.alreadyConnected ? "예" : "아니오"}</td>
                <td className="px-3 py-2">{c.whyCandidate === "bound_endpoint" ? "원본 연결선의 기존 바인딩 끝점" : "근접 거리 기반 후보"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ValidationIssueDetailScreen({
  issue,
  history,
  nodeOptions,
  canResolve,
}: {
  issue: ValidationIssueDetail;
  history: ValidationResolutionHistoryRow[];
  nodeOptions: { id: string; nodeCode: string; title: string; nodeType: string; sourceWorksheet: string | null }[];
  canResolve: boolean;
}) {
  const isDraft = issue.templateStatus === "DRAFT";
  const canAct = canResolve && isDraft;
  const topFromCandidate = issue.fromCandidates[0];
  const topToCandidate = issue.toCandidates[0];
  const topGenericCandidate = issue.candidates[0];
  const lastGraphChangeHistory = history.find((h) => ["ADD_EDGE", "BIND_SOURCE", "BIND_TARGET", "RETARGET_EDGE"].includes(h.actionType));

  // Error-to-node navigation (Phase 3B revision) — currentNode is the exact
  // match; fallbackNodeId only exists when currentNode is null (an
  // unbound-connector issue), so it is always the approximation, never both.
  const workflowTargetNodeId = issue.currentNode?.id ?? issue.fallbackNodeId ?? null;
  const isWorkflowTargetFallback = !issue.currentNode && !!issue.fallbackNodeId;
  const workflowHref = buildWorkflowViewHref({
    templateId: issue.procedureTemplateId,
    issueId: issue.id,
    worksheet: issue.sourceWorksheet,
    nodeId: workflowTargetNodeId,
    isFallback: isWorkflowTargetFallback,
    errorFocus: true,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/procedures/${issue.procedureTemplateId}/validation`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
            ← 검증 이슈 목록으로
          </Link>
          <Link
            href={workflowHref}
            className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            오류 위치로 이동{!workflowTargetNodeId ? " (연결된 노드 없음)" : isWorkflowTargetFallback ? " (근접 노드)" : ""}
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{procedureValidationIssueTypeLabels[issue.issueType] ?? issue.issueType}</h1>
          <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
            {procedureValidationSeverityLabels[issue.severity]}
          </span>
          <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {procedureValidationResolutionStatusLabels[issue.resolutionStatus]}
          </span>
          {issue.classification && (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[issue.classification.confidence]}`}>
              신뢰도: {procedureValidationConfidenceLabels[issue.classification.confidence]}
            </span>
          )}
          {!isDraft && (
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              템플릿이 DRAFT 상태가 아니므로 읽기 전용입니다
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{issue.message}</p>
      </div>

      {issue.classification && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
          <p className="font-medium text-blue-900 dark:text-blue-300">권장 조치</p>
          <p className="mt-1 text-blue-800 dark:text-blue-400">{issue.classification.recommendedAction}</p>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-500">{issue.classification.reviewerGuidance}</p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">원본 정보</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">원본 워크시트</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{issue.sourceWorksheet ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">원본 참조</dt>
            <dd className="mt-0.5 font-mono text-zinc-700 dark:text-zinc-300">{issue.sourceReference ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">현재 노드</dt>
            <dd className="mt-0.5">{issue.currentNode ? <NodeSummaryChip node={issue.currentNode} /> : <span className="text-zinc-700 dark:text-zinc-300">-</span>}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">처리자 / 처리일</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
              {issue.resolvedByName ? `${issue.resolvedByName} · ${new Date(issue.resolvedAt!).toLocaleString("ko-KR")}` : "-"}
            </dd>
          </div>
        </dl>
        {issue.resolutionNote && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">{issue.resolutionNote}</p>
        )}
      </section>

      {(issue.outgoingEdges.length > 0 || issue.incomingEdges.length > 0) && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">현재 분기</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">나가는 분기 ({issue.outgoingEdges.length})</h3>
              <ul className="mt-1 flex flex-col gap-2 text-xs">
                {issue.outgoingEdges.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-1.5 rounded border border-zinc-100 px-2 py-1 dark:border-zinc-800">
                    <ProcedureBranchBadge branchType={e.branchType} label={e.branchLabel} />
                    <span className="text-zinc-400 dark:text-zinc-600">→</span>
                    <NodeSummaryChip node={e.otherNode} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">들어오는 분기 ({issue.incomingEdges.length})</h3>
              <ul className="mt-1 flex flex-col gap-2 text-xs">
                {issue.incomingEdges.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-1.5 rounded border border-zinc-100 px-2 py-1 dark:border-zinc-800">
                    <ProcedureBranchBadge branchType={e.branchType} label={e.branchLabel} />
                    <span className="text-zinc-400 dark:text-zinc-600">←</span>
                    <NodeSummaryChip node={e.otherNode} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {issue.rawEvidence && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">원본 연결선 검사기</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50 sm:grid-cols-4">
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">연결선 ID</dt>
              <dd className="font-mono text-zinc-700 dark:text-zinc-300">{issue.rawEvidence.connectorId ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">시작 연결 ID (stCxnId)</dt>
              <dd className="font-mono text-zinc-700 dark:text-zinc-300">{issue.rawEvidence.stCxnId ?? "(없음)"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">끝 연결 ID (endCxnId)</dt>
              <dd className="font-mono text-zinc-700 dark:text-zinc-300">{issue.rawEvidence.endCxnId ?? "(없음)"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">방향</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">
                head={issue.rawEvidence.headType ?? "-"} / tail={issue.rawEvidence.tailType ?? "-"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">시작 좌표</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{issue.rawEvidence.from ? `col=${issue.rawEvidence.from.col}, row=${issue.rawEvidence.from.row}` : "-"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">끝 좌표</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{issue.rawEvidence.to ? `col=${issue.rawEvidence.to.col}, row=${issue.rawEvidence.to.row}` : "-"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">원본 워크시트</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{issue.sourceWorksheet ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400 dark:text-zinc-600">원본 참조</dt>
              <dd className="font-mono text-zinc-700 dark:text-zinc-300">{issue.sourceReference ?? "-"}</dd>
            </div>
          </div>
        </section>
      )}

      {(issue.fromCandidates.length > 0 || issue.toCandidates.length > 0 || issue.candidates.length > 0) && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">순위가 매겨진 후보 도형</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            거리 기반으로 정렬된 후보 목록입니다 — 어떤 것도 자동으로 선택되지 않습니다. 아래 바인딩 양식에서 직접 확인 후 선택하세요.
          </p>
          <CandidateTable title="누락된 시작 지점 후보" candidates={issue.fromCandidates} />
          <CandidateTable title="누락된 대상 지점 후보" candidates={issue.toCandidates} />
          <CandidateTable title="근접 후보 (판단 노드 기준)" candidates={issue.candidates} />
        </section>
      )}

      {canAct && issue.resolutionStatus === "UNRESOLVED" && (
        <section id="resolution" className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">처리</h2>
          <BindConnectorForm
            issueId={issue.id}
            nodeOptions={nodeOptions}
            suggestedSourceNodeId={topFromCandidate?.nodeId ?? topGenericCandidate?.nodeId ?? issue.currentNode?.id ?? null}
            suggestedTargetNodeId={topToCandidate?.nodeId ?? topGenericCandidate?.nodeId ?? null}
          />
          <NoChangeResolutionForm issueId={issue.id} />
        </section>
      )}

      {canAct && issue.resolutionStatus !== "UNRESOLVED" && (
        <section>
          <ReopenRollbackControls issueId={issue.id} resolutionStatus={issue.resolutionStatus} hasGraphChangeToRollback={false} />
        </section>
      )}
      {canAct && issue.resolutionStatus === "UNRESOLVED" && lastGraphChangeHistory && (
        <section>
          <ReopenRollbackControls issueId={issue.id} resolutionStatus={issue.resolutionStatus} hasGraphChangeToRollback={true} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">처리 이력</h2>
        <ResolutionHistoryPanel history={history} />
      </section>
    </div>
  );
}
