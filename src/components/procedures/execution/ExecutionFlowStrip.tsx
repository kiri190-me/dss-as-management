import type { ReactNode } from "react";
import {
  MINIMAP_BACKWARD_STEPS,
  MINIMAP_FORWARD_STEPS,
  type MinimapLevel,
  type MinimapStep,
  type ProcedureExecutionMinimap,
} from "@/lib/domain/procedure-execution-minimap";
import {
  procedureCaseExecutionNodeStatusLabels,
  type ProcedureCaseExecutionNodeStatus,
} from "@/lib/domain/procedure-case-execution-types";
import { formatFlowEdgeLabel } from "./execution-branch-choice";

/**
 * 「지금 어디쯤인가」를 짚는 **작은 흐름 그림** 한 띠. 요약 카드와 「지금 할 일」
 * 큰 카드 **사이**에 선다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 아팠는가
 * ──────────────────────────────────────────────────────────────────────
 * 절차를 **만들 때는 플로우차트로 그리는데 쓸 때는 목록만** 보였다. 판단 노드가
 * 8할인 절차라, 수리하는 사람이 「여기서 NG 면 어디로 가는가」를 머릿속으로 다시
 * 그려야 했다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 편집기 그림(ProcedureFlowGraph)을 가져다 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 그쪽은 React Flow 로 1000줄이 넘고 드래그·경로점·선택이 딸려 온다 — 실행
 * 화면에 끌어들이면 수리하는 사람이 **절차 그림을 건드릴 수 있게** 되고,
 * 휴대폰에서는 쓰지도 못한다. 여기 있는 것은 읽기 전용 글상자 몇 개뿐이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **칸은** 눌러도 아무 일이 없다
 * ──────────────────────────────────────────────────────────────────────
 * 칸에는 단추도 링크도 없다. 「칸을 눌러서 그 단계로 건너뛰기」는 쓸모 있어
 * 보이지만, 좁은 띠 안에서 **되돌릴 수 없어 보이는 일**이 한 번 누르면 일어나는
 * 모양이 된다.
 *
 * 🔵 2026-11-02(조각 10)부터 자리를 옮기는 길이 생기기는 했다 — 다만 띠의 칸이
 * 아니라 **상자 머리줄의 [전체 단계 보기]** 가 여는 창에서다(ExecutionStepsDialog).
 * 거기서는 절차 전체와 상태를 보고, 고르고, 못 옮기면 까닭을 읽고 나서 누른다.
 * 그 단추들은 이 파일이 만들지 않고 **슬롯(`actions`)으로 받는다** — 아래
 * ExecutionFlowStrip 의 그 인자 주석에 까닭이 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 가로로 넘치고 세로로는 안 자란다
 * ──────────────────────────────────────────────────────────────────────
 * 수리는 현장에서 폰으로 본다. 칸은 한 줄로만 늘어서고(가로 스크롤), 갈래가
 * 벌어져도 **옆으로** 벌어진다 — 세로로 자라면 바로 아래 큰 카드가 화면 밖으로
 * 밀린다. 칸 높이는 갈래 이름 줄을 늘 잡아 두어 어느 경우에도 같다.
 */

/**
 * 띠가 칸 하나에 쓰는 것 **전부**. ExecutionNodeDetail 을 그대로 받지 않고
 * 좁혀 적는 까닭: 조회 타입을 들이면 server-only 사슬이 따라 들어와 이 띠를
 * 렌더해 보는 시험이 import 에서 바로 던진다. 넓은 타입이 좁은 타입 자리에
 * 들어가는 것은 그대로 되므로 화면 쪽은 아무것도 달라지지 않는다.
 */
export type FlowStripNode = {
  id: string;
  procedureTemplateNodeId: string | null;
  orderIndex: number;
  title: string;
  status: ProcedureCaseExecutionNodeStatus;
};

type ChipTone = "CURRENT" | "DONE" | "BLOCKED" | "AHEAD";

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  CURRENT: "border-2 border-primary-900 bg-white text-zinc-900 dark:border-primary-50 dark:bg-zinc-900 dark:text-zinc-50",
  // 끝난 칸은 흐리게 — 「아직 할 일」과 한눈에 갈려야 한다.
  DONE: "border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-500",
  BLOCKED: "border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  AHEAD: "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

function toneOf(status: ProcedureCaseExecutionNodeStatus, isCurrent: boolean): ChipTone {
  if (isCurrent) return "CURRENT";
  if (status === "COMPLETED" || status === "SKIPPED") return "DONE";
  if (status === "BLOCKED") return "BLOCKED";
  return "AHEAD";
}

/**
 * 칸 하나. 번호 · 상태 · 짧은 제목.
 *
 * 제목은 두 줄에서 자르고 잘린 전체는 title 로 뜬다 — 이 저장소가 긴 글을
 * 다루는 방식 그대로다(RepairCaseCardList 와 같다). 🔴 자르지 않으면 칸 높이가
 * 제목 길이에 끌려다니고, 띠가 세로로 자란다.
 */
function FlowChip({ node, isCurrent }: { node: FlowStripNode; isCurrent: boolean }) {
  return (
    <div
      data-flow-chip
      data-flow-chip-current={isCurrent ? "true" : undefined}
      className={`flex w-32 shrink-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 ${CHIP_TONE_CLASS[toneOf(node.status, isCurrent)]}`}
    >
      <span className="flex items-baseline gap-1 text-[10px] leading-none">
        {node.orderIndex > 0 && <span className="font-semibold tabular-nums">{node.orderIndex}</span>}
        <span className="truncate font-medium">
          {isCurrent ? "지금" : procedureCaseExecutionNodeStatusLabels[node.status]}
        </span>
      </span>
      <span className="line-clamp-2 text-[11px] leading-tight" title={node.title}>
        {node.title}
      </span>
    </div>
  );
}

/** 칸 사이의 화살표. 갈래 이름은 칸 위에 붙으므로 여기엔 글자가 없다. */
function FlowArrow() {
  return (
    <span aria-hidden className="flex shrink-0 items-center px-0.5 text-sm text-zinc-400 dark:text-zinc-600">
      →
    </span>
  );
}

/**
 * 칸 하나와 그 위의 갈래 이름 줄. 이름이 없어도 줄은 **늘 자리를 잡는다** —
 * 갈래가 있는 칸과 없는 칸이 섞여도 띠 높이가 안 흔들리게.
 *
 * 이름을 화살표가 아니라 칸 위에 두고, 화살표가 오는 쪽(다음 쪽이면 왼쪽, 지난
 * 쪽이면 오른쪽)에 붙여 세운다. 갈래가 둘로 벌어진 자리에서는 화살표에 글자를
 * 달 자리가 없기 때문이다 — 화살표를 갈래 수만큼 그리면 칸이 세로로 쌓인다.
 */
function FlowStepColumn({
  step,
  direction,
}: {
  step: MinimapStep<FlowStripNode>;
  direction: "BACKWARD" | "FORWARD";
}) {
  const label = formatFlowEdgeLabel(step.via);
  return (
    <div className={`flex shrink-0 flex-col gap-0.5 ${direction === "FORWARD" ? "items-start" : "items-end"}`}>
      <span className="h-4 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
        {label && <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{label}</span>}
      </span>
      <FlowChip node={step.node} isCurrent={false} />
    </div>
  );
}

/**
 * 한 걸음. 갈래가 벌어진 걸음은 점선 상자로 묶어 **여럿 중 하나**임을 보인다 —
 * 묶지 않으면 옆으로 늘어선 칸이 「차례로 간다」로 읽힌다.
 */
function FlowLevel({
  level,
  direction,
}: {
  level: MinimapLevel<FlowStripNode>;
  direction: "BACKWARD" | "FORWARD";
}) {
  if (level.steps.length === 1) {
    return <FlowStepColumn step={level.steps[0]} direction={direction} />;
  }

  return (
    <div
      data-flow-branch-group
      className="flex shrink-0 items-stretch gap-1 rounded-md border border-dashed border-zinc-300 px-1 dark:border-zinc-700"
    >
      {level.steps.map((step) => (
        <FlowStepColumn key={step.node.id} step={step} direction={direction} />
      ))}
      {level.omittedCount > 0 && (
        <span className="flex items-center px-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          외 {level.omittedCount}
        </span>
      )}
    </div>
  );
}

/** 「지금」 칸도 갈래 이름 줄만큼 띄워 다른 칸과 바닥을 맞춘다. */
function CurrentColumn({ node }: { node: FlowStripNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <span className="h-4 leading-4" />
      <FlowChip node={node} isCurrent />
    </div>
  );
}

function StripShell({ children, note, actions }: { children?: ReactNode; note?: string; actions?: ReactNode }) {
  return (
    <section
      data-execution-flow-strip
      className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* 🔵 머리줄은 **접힌다**(flex-wrap). 폰 폭에서는 제목 한 줄, 단추 둘이 그
          아래로 내려간다 — 단추를 한 줄에 억지로 끼우면 글자가 잘린다. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">절차 흐름</h3>
        <div className="flex flex-wrap items-center gap-2">
          {!note && !actions && (
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              지난 {MINIMAP_BACKWARD_STEPS}걸음 · 다음 {MINIMAP_FORWARD_STEPS}걸음까지
            </span>
          )}
          {actions}
        </div>
      </div>
      {note ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{note}</p> : children}
    </section>
  );
}

/**
 * 그림을 못 그릴 때 그 자리에 적는 한 줄. 🔴 까닭마다 글이 다르다 — 「이 절차가
 * 안 이어져 있다」와 「지금 할 일이 없다」는 사람이 해야 할 다음 행동이 다르다.
 */
function hiddenNoteFor(reason: "NO_LINKED_STEPS_AT_ALL" | "NO_CURRENT_TASK"): string {
  return reason === "NO_LINKED_STEPS_AT_ALL"
    ? "이 절차는 단계끼리 선으로 이어져 있지 않아 흐름을 그릴 수 없습니다 — [전체 단계 보기]에서 전체를 보고 옮길 수 있습니다."
    : "지금 할 일이 없어 흐름을 그릴 수 없습니다 — [전체 단계 보기]에서 전체를 보고 옮길 수 있습니다.";
}

export default function ExecutionFlowStrip({
  minimap,
  actions,
}: {
  minimap: ProcedureExecutionMinimap<FlowStripNode>;
  /**
   * 🔴 상자 머리줄에 서는 단추들(2026-11-02, 조각 10 — [전체 단계 보기] ·
   * [추가 작업 등록]). **슬롯으로 받는** 까닭은 둘 다 서버 액션을 직접 부르는
   * 클라이언트 부품이라, 여기서 import 하면 이 띠를 **그려서 재는** 시험이
   * import 에서 바로 던지기 때문이다(조각 7 의 graphSlot 과 같은 수법).
   */
  actions?: ReactNode;
}) {
  // 🔴 절차 전체에 이을 선이 없거나 지금 할 일 자체가 없으면 **그림을** 안
  // 그린다. 빈 네모 하나를 세우는 것은 「그림이 있는데 비어 있다」는 거짓말이다.
  //
  // 🔴 다만 **담을 단추가 있으면 상자는 남는다**(2026-11-02, 조각 10). 그 둘은
  // 흐름이 안 그려질 때야말로 필요하다 — 그리다 만 절차(실측 「원복 검사」는 노드
  // 22개에 선이 7개)에서는 띠가 늘 안 뜨는데, 그때 전체를 보고 자리를 옮길 길이
  // 화면에서 통째로 사라지면 안 된다.
  if (minimap.kind === "HIDDEN") {
    if (!actions) return null;
    return <StripShell actions={actions} note={hiddenNoteFor(minimap.reason)} />;
  }

  if (minimap.kind === "NOTE") {
    return (
      <StripShell
        actions={actions}
        note={
          minimap.reason === "CURRENT_IS_EXTRA_TASK"
            ? "이 작업은 절차 그림 밖에서 더해진 추가 작업이라 이어지는 단계가 없습니다."
            : "이 절차는 단계끼리 선으로 이어져 있지 않습니다 — [전체 단계 보기]에서 전체를 볼 수 있습니다."
        }
      />
    );
  }

  // 지난 쪽은 **먼 걸음부터** 그린다 — 모을 때는 가까운 것부터 쌓였다.
  const backward = [...minimap.backward].reverse();

  return (
    <StripShell actions={actions}>
      <div className="mt-1 overflow-x-auto pb-1">
        <div className="flex w-max items-stretch">
          {backward.map((level, index) => (
            <div key={`backward-${index}`} className="flex items-stretch">
              <FlowLevel level={level} direction="BACKWARD" />
              <FlowArrow />
            </div>
          ))}
          <CurrentColumn node={minimap.current} />
          {minimap.forward.map((level, index) => (
            <div key={`forward-${index}`} className="flex items-stretch">
              <FlowArrow />
              <FlowLevel level={level} direction="FORWARD" />
            </div>
          ))}
        </div>
      </div>
    </StripShell>
  );
}
