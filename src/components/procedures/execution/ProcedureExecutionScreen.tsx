import ExecutionStartCard from "./ExecutionStartCard";
import ExecutionNodeCard from "./ExecutionNodeCard";
import ExecutionExtraTaskForm from "./ExecutionExtraTaskForm";
import ExecutionHistoryTimeline from "./ExecutionHistoryTimeline";
import RelatedRepairHistoryPanel from "./RelatedRepairHistoryPanel";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { computeExecutionPosition, formatExecutionPositionLabel } from "@/lib/domain/procedure-execution-order";
import type {
  ExecutableTemplateOption,
  ExecutionDetail,
  ExecutionHistoryRow,
  RelatedRepairHistory,
} from "@/lib/db/queries/procedure-case-execution";

const ORDINARY_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

function ProgressSummary({ detail }: { detail: ExecutionDetail }) {
  const total = detail.nodes.length;
  const completed = detail.nodes.filter((n) => n.status === "COMPLETED").length;
  const skipped = detail.nodes.filter((n) => n.status === "SKIPPED").length;
  const blocked = detail.nodes.filter((n) => n.status === "BLOCKED").length;
  const inProgress = detail.nodes.filter((n) => n.status === "IN_PROGRESS").length;
  const pending = detail.nodes.filter((n) => n.status === "PENDING").length;
  const donePct = total > 0 ? Math.round(((completed + skipped) / total) * 100) : 0;
  // 퍼센트와 개수만으로는 「지금 어디냐」가 안 읽힌다. 셈은 화면에서 하지 않고
  // 도메인 함수가 한다 — 끝난 수 + 1 이고, 다 끝나면 1 을 더하지 않는다.
  const positionLabel = formatExecutionPositionLabel(computeExecutionPosition(detail.nodes));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {detail.templateName} ({detail.templateCode})
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {detail.startedByName}님이 {new Date(detail.startedAt).toLocaleString("ko-KR")}에 시작
          </p>
        </div>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{donePct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-50" style={{ width: `${donePct}%` }} />
      </div>
      {positionLabel && (
        <p className="mt-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">{positionLabel}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>전체 {total}</span>
        <span>대기 {pending}</span>
        <span>진행 중 {inProgress}</span>
        <span>완료 {completed}</span>
        <span>건너뜀 {skipped}</span>
        <span>차단됨 {blocked}</span>
      </div>
    </div>
  );
}

function NodeSection({
  title,
  nodes,
  actingUser,
  emptyMessage,
}: {
  title: string;
  nodes: ExecutionDetail["nodes"];
  actingUser: { id: string; role: string; isDeveloper: boolean };
  emptyMessage: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {title} ({nodes.length})
      </h3>
      <div className="mt-2 flex flex-col gap-2">
        {nodes.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>
        ) : (
          nodes.map((node) => <ExecutionNodeCard key={node.id} node={node} actingUser={actingUser} />)
        )}
      </div>
    </div>
  );
}

export default function ProcedureExecutionScreen({
  repairCaseId,
  actingUser,
  activeExecution,
  templateOptions,
  executionDetail,
  history,
  relatedHistory,
}: {
  repairCaseId: string;
  actingUser: ActingUser;
  activeExecution: { id: string } | null;
  templateOptions: ExecutableTemplateOption[];
  executionDetail: ExecutionDetail | null;
  history: ExecutionHistoryRow[];
  relatedHistory: RelatedRepairHistory;
}) {
  if (!activeExecution || !executionDetail) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">기술 절차</h2>
        <ExecutionStartCard repairCaseId={repairCaseId} actingUserRole={actingUser.role} templateOptions={templateOptions} />
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">이전 수리 이력</h2>
          <div className="mt-2">
            <RelatedRepairHistoryPanel relatedHistory={relatedHistory} />
          </div>
        </div>
      </div>
    );
  }

  // 네 구역 모두 getExecutionDetail 이 정한 **절차 차례**를 그대로 물려받는다
  // (filter 는 차례를 안 바꾼다). 그래서 카드에 찍힌 번호가 구역 안에서 오름차순이다.
  //
  // 「실행 가능」만 예외로, 추천 노드를 앞으로 끌어올린다 — 전부터 있던 동작이다.
  // Array.prototype.sort 는 안정 정렬이라 **추천끼리·추천 아닌 것끼리는 절차
  // 차례가 그대로 남는다**. 바꾸려면 이 한 줄만 빼면 된다.
  const pendingNodes = executionDetail.nodes
    .filter((n) => n.status === "PENDING")
    .sort((a, b) => Number(b.isSuggestedNext) - Number(a.isSuggestedNext));
  const inProgressNodes = executionDetail.nodes.filter((n) => n.status === "IN_PROGRESS");
  const doneNodes = executionDetail.nodes.filter((n) => n.status === "COMPLETED" || n.status === "SKIPPED");
  const blockedNodes = executionDetail.nodes.filter((n) => n.status === "BLOCKED");

  // Shipment-lock removal policy: role-only now — see isBlockedByCaseLock
  // (procedure-case-execution-authorization.ts), which the server
  // independently enforces regardless of this UI hint.
  const extraTaskEligible = actorHasAllowedRole(actingUser, ORDINARY_ELIGIBLE_ROLES);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">기술 절차</h2>
      <ProgressSummary detail={executionDetail} />

      <NodeSection
        title="실행 가능"
        nodes={pendingNodes}
        actingUser={actingUser}
        emptyMessage="대기 중인 작업이 없습니다."
      />
      <NodeSection
        title="진행 중"
        nodes={inProgressNodes}
        actingUser={actingUser}
        emptyMessage="진행 중인 작업이 없습니다."
      />
      <NodeSection
        title="차단됨"
        nodes={blockedNodes}
        actingUser={actingUser}
        emptyMessage="차단된 작업이 없습니다."
      />
      <NodeSection
        title="완료 / 건너뜀"
        nodes={doneNodes}
        actingUser={actingUser}
        emptyMessage="완료되거나 건너뛴 작업이 없습니다."
      />

      {executionDetail.referenceNodes.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">참고 문서</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {executionDetail.referenceNodes.map((ref) => (
              <li key={ref.id} className="text-xs text-zinc-600 dark:text-zinc-300">
                <span className="font-medium">{ref.title}</span>
                {ref.instructions && <p className="mt-0.5 whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">{ref.instructions}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExecutionExtraTaskForm executionId={executionDetail.executionId} eligible={extraTaskEligible} />

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">실행 이력</h2>
        <div className="mt-2">
          <ExecutionHistoryTimeline history={history} />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">이전 수리 이력</h2>
        <div className="mt-2">
          <RelatedRepairHistoryPanel relatedHistory={relatedHistory} />
        </div>
      </div>
    </div>
  );
}
