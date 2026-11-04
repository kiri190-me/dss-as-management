import { computeWorkflowProgress, type WorkflowProgressStep } from "@/lib/domain/workflow-progress";

const stateLabels = {
  completed: "완료",
  current: "현재 단계",
  future: "예정",
} as const;

const stateClasses = {
  completed: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950",
  current: "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-800",
  future: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
} as const;

const noticeClassName =
  "mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400";

/**
 * Stage E-1부터 currentWorkflowStepKey는 원본 ResolvedRepairCase가 아니라
 * 호출부(RepairCaseDetailView)가 effective-repair-case.ts로 계산한 유효
 * 단계를 명시적으로 전달한다 — 이 컴포넌트 자체는 워크플로 재정의를 알지
 * 못한다(단일 병합 지점 원칙을 지키기 위해 resolved 전체를 받지 않는다).
 *
 * ── 🔴 2026-11-04: 그릴 단계 목록도 **받아서** 그린다 ──────────────────────
 * 여기서 mock-data.ts 의 `workflowSteps` 를 직접 import 하고 있었다. 그 배열은
 * 2026-08 에 한 번 옮겨 적은 **코드에 박힌 표**라, [워크플로 관리]에서 단계
 * 이름을 바꾸거나 단계를 더하고 빼도 이 칸은 한 글자도 안 바뀌었다(사용자
 * 신고). 판정은 멀쩡했다 — 단추를 켜고 끄는 쪽과 서버 거절은 이미 DB 규칙을
 * 본다. 틀린 것은 **이 칸의 그림 하나**였고, 그래서 오류가 한 번도 안 났다.
 *
 * 목록은 그 접수 건의 **workflow_version_id** 에 달린 단계다([id]/page.tsx 가
 * loadWorkflowRulesForCase 로 읽어 내려보낸다). 🔴 진행 중인 건이 접수 시점의
 * 판본에 머무는 것은 **의도된 정책**이므로, 발행만 하고 [기존 접수 건을 현재
 * 버전으로 적용]을 누르지 않았으면 여기에는 여전히 옛 단계가 보인다 — 그것이
 * 맞는 그림이다.
 *
 * 🔴 조회가 `server-only` 라 이 부품이 직접 부를 수 없다(부르면 build 에서
 * 터진다). 그래서 서버 페이지가 읽고 **그릴 세 칸만** prop 으로 내려보낸다.
 */
export default function WorkflowProgress({
  steps,
  currentWorkflowStepKey,
}: {
  /**
   * 🔴 **null 과 빈 배열은 다른 뜻이다.**
   *   - null  = 이 건의 워크플로 판본 자체를 못 읽었다(판본 행이 없다 · 애초에
   *             DB 건이 아니다). 자료 쪽 고장이다.
   *   - []    = 판본은 읽었는데 그릴 단계가 하나도 없다. [워크플로 관리]에서
   *             단계를 다 지웠거나, 단계에 상태(repair_status)가 안 붙어 조회가
   *             걸러 냈을 때다(db/queries/workflow-rules.ts 의 filter).
   * 둘 다 **빈 상자를 그리지 않는다** — 빈 상자는 사람이 "고장"으로 읽는데,
   * 무엇이 고장인지는 알려 주지 않는다.
   */
  steps: readonly WorkflowProgressStep[] | null;
  currentWorkflowStepKey: string;
}) {
  const problem =
    steps === null
      ? "이 접수 건에 연결된 워크플로 판본을 읽지 못했습니다. 관리자에게 알려 주세요."
      : steps.length === 0
        ? "이 워크플로 판본에 표시할 단계가 없습니다. [워크플로 관리]에서 단계 구성을 확인해 주세요."
        : null;

  // 목록이 없으면 아래 셈을 돌리지 않는다. 빈 목록을 그대로 넘기면
  // "현재 단계 정보(...)가 이 워크플로에 존재하지 않습니다"가 뜨는데, 그 글은
  // 단계 키가 틀렸다는 뜻이라 진짜 까닭(단계가 0개)을 가린다.
  const result = problem === null ? computeWorkflowProgress(steps ?? [], currentWorkflowStepKey) : null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 진행</h2>

      {problem !== null && <p className={noticeClassName}>{problem}</p>}

      {result !== null && !result.valid && <p className={noticeClassName}>{result.warning}</p>}

      {result !== null && (
        <ol className="mt-3 flex flex-col gap-2">
          {result.steps.map((step) => {
            const state = "state" in step ? step.state : null;
            return (
              <li
                key={step.key}
                className={`flex items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                  state ? stateClasses[state] : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <span className="text-zinc-900 dark:text-zinc-50">
                  {step.order}. {step.label}
                </span>
                {state && (
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {stateLabels[state]}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
