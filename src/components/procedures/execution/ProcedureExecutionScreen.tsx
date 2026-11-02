import ExecutionStartCard from "./ExecutionStartCard";
import ExecutionNodeCard from "./ExecutionNodeCard";
import CurrentTaskCard from "./CurrentTaskCard";
import ExecutionFlowStrip from "./ExecutionFlowStrip";
import ExecutionFoldSection from "./ExecutionFoldSection";
import PastExecutionsSection from "./PastExecutionsSection";
import ExecutionExtraTaskForm from "./ExecutionExtraTaskForm";
import ExecutionLifecycleActions from "./ExecutionLifecycleActions";
import ExecutionAbandonButton from "./ExecutionAbandonButton";
import ExecutionResumeButton from "./ExecutionResumeButton";
import ExecutionHistoryTimeline from "./ExecutionHistoryTimeline";
import RelatedRepairHistoryPanel from "./RelatedRepairHistoryPanel";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { computeExecutionPosition, formatExecutionPositionLabel } from "@/lib/domain/procedure-execution-order";
import { pickCurrentTask, type NoCurrentTaskReason } from "@/lib/domain/procedure-execution-focus";
import { buildProcedureExecutionMinimap } from "@/lib/domain/procedure-execution-minimap";
import { buildExecutionHistoryFold, buildExecutionListFold } from "@/lib/domain/procedure-execution-list-fold";
import { placeExecutionSummary } from "@/lib/domain/procedure-execution-summary-placement";
import { assessExecutionFinish, type ExecutionFinishAssessment } from "@/lib/domain/procedure-execution-lifecycle";
import { formatProcedureTemplateTitle } from "@/lib/domain/procedure-template-title";
import type { PastExecutionCandidate } from "@/lib/domain/procedure-execution-past-runs";
import type {
  ExecutableTemplateGraph,
  ExecutionDetail,
  ExecutionHistoryRow,
  RelatedRepairHistory,
} from "@/lib/db/queries/procedure-case-execution";

const ORDINARY_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

/**
 * 진행 요약 상자 — 이 실행에 대한 **한 상자**(2026-11-02, 조각 8).
 *
 * 전에는 상자가 둘이었다. 위에 이 요약이, 바로 아래에 [절차 끝내기]·[실행
 * 그만두기]가 든 상자가 따로 서서 **절차 이름을 두 번** 적었다. 사용자가 눈으로
 * 보고 정했다 — 「이 두 내용이 서로 다른 박스로 있을 필요 없을 것 같은데?
 * [절차 끝내기], [실행 그만두기]도 진행바가 있는 박스 안에 포함시켜줘.」
 *
 * 🔴 상자 안의 차례는 **진행바와 수치가 먼저, 단추가 나중**이다. 단추가 위에
 * 있으면 「지금 눌러야 하는 것」처럼 보이는데, 이 둘은 절차를 **끝낼 때** 쓰는
 * 것이라 평소에는 읽고 지나가야 하는 자리다.
 */
function ProgressSummary({
  detail,
  finish,
  eligible,
}: {
  detail: ExecutionDetail;
  /** 도메인이 정한 「끝내면 무엇이 남는가」. 화면은 다시 세지 않는다. */
  finish: ExecutionFinishAssessment;
  /** 끝내기·그만두기를 할 수 있는 사람인가. 서버도 같은 문턱으로 다시 판정한다. */
  eligible: boolean;
}) {
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
          {/* 🔴 「이름 (코드)」를 여기서 이어 붙이지 않는다 — 코드 칸에 이름이
              그대로 들어간 절차가 있어서 「이름 (이름)」이 떴다. 붙일지 말지는
              formatProcedureTemplateTitle 한 곳에서만 정한다(아래 「이 건의 다른
              절차」 줄·불러오기 드롭다운이 같은 함수를 쓴다). */}
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {formatProcedureTemplateTitle(detail.templateName, detail.templateCode)}
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

      {/* 실행 하나를 통째로 다루는 단추 둘(끝내기 · 그만두기). 🔴 **맨 아래**다 —
          위의 진행바·수치를 읽고 나서 누르는 것이 차례다. 제 테두리는 없다(그
          상자가 이 상자다). */}
      <ExecutionLifecycleActions
        executionId={detail.executionId}
        executionVersion={detail.version}
        templateName={detail.templateName}
        finish={finish}
        eligible={eligible}
      />
    </div>
  );
}

function NodeSection({
  title,
  nodes,
  actingUser,
  emptyMessage,
  currentTaskNodeId,
}: {
  title: string;
  nodes: ExecutionDetail["nodes"];
  actingUser: { id: string; role: string; isDeveloper: boolean };
  emptyMessage: string;
  /** 「지금 할 일」로 위에 크게 서 있는 노드. 이 구역에 없으면 아무 일도 없다. */
  currentTaskNodeId: string | null;
}) {
  return (
    <div>
      {/* 개수는 **빼지 않고 센다.** 위로 올라간 한 장도 이 구역에 속한 일이라,
          「진행 중 (0)」인데 실제로는 하나 진행 중인 화면이 되면 안 된다. */}
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {title} ({nodes.length})
      </h3>
      <div className="mt-2 flex flex-col gap-2">
        {nodes.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>
        ) : (
          nodes.map((node) =>
            node.id === currentTaskNodeId ? (
              // 🔴 같은 카드를 두 번 그리지 않는다. 그렇다고 목록에서 통째로
              // 지우면 「방금 보던 카드가 사라졌다」가 또 된다 — 이 화면의
              // 원래 불만이 그것이었다. 그래서 자리는 남기고 **위를 가리키는
              // 한 줄**로 바꾼다.
              <p
                key={node.id}
                data-current-task-pointer
                className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
              >
                {node.orderIndex > 0 && <span className="font-semibold tabular-nums">{node.orderIndex}. </span>}
                {node.title} — 맨 위 「지금 할 일」에 있습니다.
              </p>
            ) : (
              <ExecutionNodeCard key={node.id} node={node} actingUser={actingUser} />
            )
          )
        )}
      </div>
    </div>
  );
}

/**
 * 할 일이 하나도 안 남았을 때 「지금 할 일」 자리에 서는 안내.
 *
 * 🔴 까닭을 갈라 적는다. 「다 끝났습니다」와 「남은 것이 전부 차단돼
 * 있습니다」는 사람이 해야 할 다음 행동이 정반대다 — 전자는 아무것도 안 해도
 * 되고, 후자는 차단을 풀어야 절차가 다시 흐른다.
 *
 * 🔴 마친 실행(EXECUTION_FINISHED)은 **이 카드 자체가 안 선다** — 그래서 prop
 * 타입에서 아예 뺐다. 타입으로 빼 두면 「마쳤습니다」 자리에 또 다른 안내를
 * 덧붙이려는 시도를 컴파일러가 막는다. 마쳤다는 말을 하는 자리는 「이 건의 다른
 * 절차」의 그 줄 하나다 — 배지(완주 · 중단 마침)와 마친 시각(2026-11-02, 조각 8).
 */
function NoCurrentTaskCard({ reason }: { reason: Exclude<NoCurrentTaskReason, "EXECUTION_FINISHED"> }) {
  const message =
    reason === "ALL_FINISHED"
      ? "모든 작업이 끝났습니다(완료 또는 건너뜀)."
      : reason === "ALL_BLOCKED"
        ? "남은 작업이 모두 차단돼 있습니다. 아래 「차단됨」에서 [재개(되돌림)]로 풀어야 다음으로 넘어갑니다."
        : "이 절차에는 진행할 작업이 없습니다.";

  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">지금 할 일</span>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
    </section>
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
  pastExecutions,
}: {
  repairCaseId: string;
  actingUser: ActingUser;
  activeExecution: { id: string } | null;
  /**
   * 불러오기 창이 쓰는 재료 — 목록 한 줄에 **그 절차의 노드·간선**이 함께 실려
   * 있다(2026-11-02, 조각 7). 창이 「모든 절차」에서 노드 이름을 찾고 그림을
   * 그려야 하기 때문이다. 이 화면은 그대로 넘기기만 한다.
   */
  templateOptions: ExecutableTemplateGraph[];
  executionDetail: ExecutionDetail | null;
  history: ExecutionHistoryRow[];
  relatedHistory: RelatedRepairHistory;
  /**
   * 지금 화면에 선 실행 **말고** 이 건에서 돌린 것들(마친 것 · 그만둔 것 ·
   * 아직 도는 것 전부). 「이 건의 다른 절차」 묶음이 이것으로 선다 — 그릴지
   * 말지·배지·차례는 전부 도메인이 정한다(PastExecutionsSection).
   */
  pastExecutions: PastExecutionCandidate[];
}) {
  if (!activeExecution || !executionDetail) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">기술 절차</h2>
        <ExecutionStartCard repairCaseId={repairCaseId} actingUserRole={actingUser.role} templateOptions={templateOptions} />
        {/* 🔴 큰 카드가 없을 때도 다른 절차는 있다 — 그만둔 뒤의 화면이 바로
            그 모습이다. 여기에 안 그리면 그만둔 실행은 여전히 아무 데서도 안
            보인다(이 조각이 고치려던 바로 그 상태).

            🔵 이 가지에는 [실행 그만두기]를 안 보낸다. 세울 실행이 없다는 것은
            **안 치운 실행이 한 건도 없다**는 뜻이고(getActiveExecutionForCase 가
            is_deleted 로 거르고 하나라도 있으면 돌려준다), 그러면 여기 뜨는 줄은
            전부 「그만둠」이라 도메인이 어차피 단추를 안 붙인다. */}
        <PastExecutionsSection candidates={pastExecutions} />
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
  //
  // 🔵 추가 작업 등록과 **실행 끝내기·그만두기**가 같은 문턱을 쓴다(2026-11-02).
  // 서버도 셋 다 assertOrdinaryMutationAuthorized 하나로 판정한다 — 시작할 수
  // 있는 사람이 끝내고 치울 수도 있어야, 「잘못 불러왔는데 바꿀 수가 없다」가
  // 담당 엔지니어에게 그대로 남지 않는다.
  const ordinaryActionEligible = actorHasAllowedRole(actingUser, ORDINARY_ELIGIBLE_ROLES);

  // 🔴 「지금 할 일」은 **절차 차례**로 고른다 — 추천(isSuggestedNext)으로
  // 고르지 않는다. 게시된 절차 하나가 노드 23개에 간선 8개뿐이라 거의 모든
  // 노드가 추천으로 켜진다(까닭은 procedure-execution-focus.ts 머리말).
  //
  // 🔴 위의 pendingNodes 가 아니라 **원본 배열**을 넘긴다. pendingNodes 는
  // 추천을 앞으로 끌어올리려고 다시 정렬한 것이고, 대기만 담아 진행 중도 없다.
  //
  // 🔵 「마쳤는가」는 **사실 한 줄**로 뽑아 세 곳(큰 카드 · 흐름 띠 · 아래 목록)에
  // 똑같이 넘긴다. 화면마다 completedAt 을 다시 보면 한 곳만 고치는 날이 온다.
  const isExecutionFinished = executionDetail.completedAt !== null;
  const currentTask = pickCurrentTask(executionDetail.nodes, { isExecutionFinished });
  const currentTaskNodeId = currentTask.kind === "NONE" ? null : currentTask.node.id;

  // 🔴 진행 요약 상자가 **어디에 서는가**. 마치면 위에 안 서고 「이 건의 다른
  // 절차」의 한 줄로 내려간다(2026-11-02 사용자 결정 — 조각 8). 그 결정과,
  // 아래 묶음에서 **무엇을 빼고 읽는가**는 반드시 같은 답이어야 해서 도메인
  // 함수 하나가 둘을 함께 정한다(placeExecutionSummary) — 페이지가 빼기 쪽
  // 답을 쓴다. 화면이 여기서 또 if 로 가르면 「두 번 뜨거나 아예 안 뜨거나」가
  // 조용히 생긴다.
  const placement = placeExecutionSummary({ executionId: executionDetail.executionId, isExecutionFinished });

  // 지금 자리 둘레 몇 걸음만 담은 작은 흐름 그림. 「그릴 수 없다」는 판정까지
  // 전부 도메인 함수가 한다(procedure-execution-minimap.ts) — 실측한 절차 하나가
  // 노드 23개에 간선 8개뿐인 「그리다 만」 상태라, 선이 안 붙은 노드에서는
  // 점 하나짜리 그림 대신 한 줄을 적고, 절차 전체에 선이 없으면 띠를 통째로
  // 안 그린다.
  const minimap = buildProcedureExecutionMinimap({
    nodes: executionDetail.nodes,
    edges: executionDetail.flowEdges,
    current: currentTask.kind === "NONE" ? null : currentTask.node,
  });

  // 아래 목록을 접는 규칙. 🔴 「접힌 채로 둘지」도 「아예 안 그릴지」도 여기서
  // if 로 적지 않는다 — 도메인 함수가 정해서 group 에 담아 준다.
  //
  // 🔴 네 구역과 **같은 배열**을 넘긴다. 위로 올라간 한 장을 걸러낸 배열을
  // 넘기면 접힌 줄의 수가 실제로 보이는 줄 수보다 한 장 모자라진다 — 그 노드는
  // 목록에서 사라지지 않고 점선 한 줄로 남아 있다(NodeSection).
  const fold = buildExecutionListFold({ nodes: executionDetail.nodes, isExecutionFinished });

  // 「실행 이력」 묶음 — **「지나온 길」을 품은** 한 덩이다(2026-11-02 사용자 결정,
  // 조각 8: 「[실행 이력]에 [지나온 길]의 내용을 넣자」). 둘이 같은 일을 각자
  // 적고 있었다 — 카드 쪽은 작업 메모와 사유를, 이력 쪽은 누가 언제를.
  //
  // 🔴 접힌 채로 뜨고, 머릿수·덧말·「끝난 카드를 그릴지」까지 전부 도메인이
  // 정한다. 아래 목록과 같은 그릇을 쓰므로 「펼치기/접기」가 두 벌이 되지 않는다.
  const historyFold = buildExecutionHistoryFold({ historyCount: history.length, nodes: executionDetail.nodes });

  // 끝내기 단추가 무엇을 물어야 하는지. 🔴 여기서 세지 않는다 — 서버가 잠근 뒤
  // **같은 함수로 다시** 세고, 그래야 「물었는가」가 화면 밖에서도 성립한다.
  const finish = assessExecutionFinish(executionDetail.nodes);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">기술 절차</h2>

      {/* 🔴 끝낸 실행에서는 불러오기 카드가 **다시 선다.** 그래야 다음 절차로
          넘어갈 수 있다 — 이 카드가 없으면 「마쳤습니다」만 남고 화면이 다시
          막힌다. 아직 도는 실행에서는 templateOptions 가 빈 배열이라 페이지가
          목록을 읽지도 않는다. */}
      {executionDetail.completedAt && (
        <ExecutionStartCard repairCaseId={repairCaseId} actingUserRole={actingUser.role} templateOptions={templateOptions} />
      )}

      {/* 🔴 마친 실행에서는 이 상자가 **위에 안 선다** — 「이 건의 다른 절차」의
          한 줄로 내려간다(아래 PastExecutionsSection). 그러면 끝낸 뒤의 화면
          맨 위에는 「+ 기술 절차 불러오기」만 남는다.

          여기서 completedAt 을 다시 보지 않는다 — 도메인이 고른 자리를 그대로
          따른다. 단추 둘도 이 상자 **안**에 들어 있다. */}
      {placement.slot === "TOP" && (
        <ProgressSummary detail={executionDetail} finish={finish} eligible={ordinaryActionEligible} />
      )}

      {/* 요약과 큰 카드 **사이**다. 위로 올리면 「몇 번째인가」와 「지금 할 일」이
          멀어지고, 아래로 내리면 큰 카드가 띠에 밀려 내려간다. */}
      <ExecutionFlowStrip minimap={minimap} />

      {/* 🔴 마친 실행에서는 이 자리가 **통째로 빈다.** 「지금 할 일」도, 그것이
          없을 때 서는 안내도 안 그린다 — 사람이 [절차 끝내기]를 눌렀으면 남은
          작업이 있어도 마친 것이고, 그때 할 일을 띄우면 그 판단을 화면이
          뒤집는 꼴이다. 「마쳤습니다」는 아래 「이 건의 다른 절차」의 줄이 한 번만
          말한다.

          여기서 completedAt 을 다시 보지 않는다 — pickCurrentTask 가 돌려준
          까닭을 그대로 따른다. */}
      {currentTask.kind === "NONE" ? (
        currentTask.reason === "EXECUTION_FINISHED" ? null : <NoCurrentTaskCard reason={currentTask.reason} />
      ) : (
        <CurrentTaskCard node={currentTask.node} actingUser={actingUser} />
      )}

      {/* 네 구역은 그대로 두고 **담는 그릇만** 둘로 바꾼다. 구역마다 접으면
          접는 줄이 넷 생겨, 줄인 길이만큼 줄 머리가 도로 늘어난다.

          🔴 `fold.remaining &&` 는 「담을 카드가 없다」를 화면이 다시 판정하는
          것이 아니다 — 도메인이 null 을 돌려주면 그릴 것이 없다는 뜻이고,
          여기서는 그 결과를 그대로 따를 뿐이다. 머릿수를 화면에서 다시 세면
          (fold.remaining.count > 0 같은 식) 판정이 두 벌이 된다. */}
      {fold.remaining && (
        <ExecutionFoldSection group={fold.remaining}>
          <NodeSection
            title="실행 가능"
            nodes={pendingNodes}
            actingUser={actingUser}
            emptyMessage="대기 중인 작업이 없습니다."
            currentTaskNodeId={currentTaskNodeId}
          />
          <NodeSection
            title="진행 중"
            nodes={inProgressNodes}
            actingUser={actingUser}
            emptyMessage="진행 중인 작업이 없습니다."
            currentTaskNodeId={currentTaskNodeId}
          />
          <NodeSection
            title="차단됨"
            nodes={blockedNodes}
            actingUser={actingUser}
            emptyMessage="차단된 작업이 없습니다."
            currentTaskNodeId={currentTaskNodeId}
          />
        </ExecutionFoldSection>
      )}
      {/* 🔵 「지나온 길」 묶음이 있던 자리다. 그 안의 카드는 그대로 두고 **담는
          그릇만** 아래 「실행 이력」과 합쳤다(2026-11-02 사용자 결정, 조각 8) —
          끝난 노드 카드(작업 메모 · 건너뛴 사유)와 그 일들의 시각 기록은 같은
          일을 두 각도에서 적은 것이라 한 묶음에 있는 편이 맞다.

          🔴 두 구역 다 **버리는 것 없이** 통째로 들어온다. 윗구역은 전과 같은
          NodeSection 이고(같은 제목·같은 카드), 아랫구역은 전과 같은
          ExecutionHistoryTimeline 이다. */}
      {historyFold && (
        <ExecutionFoldSection group={historyFold.fold}>
          {/* 끝낸 카드가 한 장도 없으면 이 구역을 아예 안 그린다 — 「(0)」과
              「…없습니다」 한 줄이 접힌 묶음 안에 남지 않게. 그 판정도 도메인이
              한다(historyFold.showsTrail) — 화면이 머릿수를 다시 세지 않는다. */}
          {historyFold.showsTrail && (
            <NodeSection
              title="완료 / 건너뜀"
              nodes={doneNodes}
              actingUser={actingUser}
              emptyMessage="완료되거나 건너뛴 작업이 없습니다."
              currentTaskNodeId={currentTaskNodeId}
            />
          )}
          <div>
            {/* 🔵 제목을 다는 까닭 — 한 묶음 안에 종류가 다른 둘이 쌓이면 어디까지가
                카드이고 어디부터가 기록인지 안 갈린다. 괄호 안 수는 바로 아래가
                그리는 줄 수다(NodeSection 의 머릿수와 같은 잣대). */}
            <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">시각 기록 ({history.length})</h3>
            <div className="mt-2">
              <ExecutionHistoryTimeline history={history} />
            </div>
          </div>
        </ExecutionFoldSection>
      )}

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

      <ExecutionExtraTaskForm executionId={executionDetail.executionId} eligible={ordinaryActionEligible} />

      {/* 🔵 자리가 여기인 까닭 — 위는 전부 **지금 이 실행** 이야기고(요약·띠·
          지금 할 일·목록·이력), 아래 「이전 수리 이력」은 **다른 접수 건** 이야기다.
          「이 건에서 지난번에 돌린 절차」는 그 둘 사이에 있는 것이 읽는 차례와
          맞는다. 접힌 채로 뜨므로 도는 실행의 화면을 밀어내지도 않는다.

          🔴 **줄마다** 단추를 붙여 보낸다(2026-11-02 사용자 지적 — 「건별로 있도록
          해주고」). 처음 판은 마쳐서 내려온 한 줄에만 붙였는데, 줄이 여럿일 때 그
          단추가 어느 줄의 것인지 눈으로 안 갈렸다.

          🔴 **어느 줄에 어느 단추가 붙는지는 도메인이 정한다.** 둘의 답이 서로
          달라서 까닭도 둘이다 — [절차 다시 잇기]는 **중단 마침 하나**
          (resolveResumeBlockedReason), [실행 그만두기]는 **중단 마침 · 진행 중 둘**
          (resolveAbandonBlockedReason). 여기서 배지를 다시 보고 가르지 않는다.

          🔵 **차례는 잇기가 먼저**다 — 왼쪽이 더 많이 쓰는 쪽이고, 되돌릴 수 없는
          쪽(그만두기)을 오른쪽 끝에 두면 잘못 누를 일이 준다. 요약 상자의
          [절차 끝내기] → [실행 그만두기] 차례와도 같은 잣대다.

          여기서는 **그 줄의 재료로** 단추를 만들어 줄 뿐이다 — 🔴 실행 id 도
          version 도 줄마다 제 것이라, 한 벌을 돌려 쓰면 남의 실행을 건드리는
          호출이 된다. */}
      <PastExecutionsSection
        candidates={pastExecutions}
        renderRowAction={(row) =>
          ordinaryActionEligible ? (
            <>
              {row.resumeBlockedReason === null && (
                <ExecutionResumeButton executionId={row.executionId} executionVersion={row.version} />
              )}
              {row.abandonBlockedReason === null && (
                <ExecutionAbandonButton
                  executionId={row.executionId}
                  executionVersion={row.version}
                  templateName={row.title}
                />
              )}
            </>
          ) : (
            /* 🔵 못 누르는 사람에게는 **까닭**을 그 자리에 적는다 — 단추만 조용히
               빼면 「왜 이 줄만 아무것도 없지」가 된다. 서버도 같은 문턱으로 다시
               판정한다(assertOrdinaryMutationAuthorized — 셋이 한 문턱이다). */
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              담당 엔지니어 또는 관리자만 절차를 다시 잇거나 그만둘 수 있습니다.
            </p>
          )
        }
      />

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">이전 수리 이력</h2>
        <div className="mt-2">
          <RelatedRepairHistoryPanel relatedHistory={relatedHistory} />
        </div>
      </div>
    </div>
  );
}
