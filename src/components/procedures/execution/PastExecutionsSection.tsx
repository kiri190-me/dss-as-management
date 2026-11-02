import type { ReactNode } from "react";
import ExecutionFoldSection from "./ExecutionFoldSection";
import {
  buildPastExecutionPanel,
  type PastExecutionBadge,
  type PastExecutionCandidate,
  type PastExecutionRow,
} from "@/lib/domain/procedure-execution-past-runs";

/**
 * 「이 건의 다른 절차」 — 큰 카드에 못 선 실행들을 한 줄씩 적는 묶음
 * (2026-11-02, 조각 6).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이 파일은 **아무 단추도 안 그린다**
 * ──────────────────────────────────────────────────────────────────────
 * 단추도 링크도 여기서 만들지 않는다. 있는 것처럼 보이는 자리를 만들면 눌러 본
 * 사람이 아무 일도 안 일어나는 화면을 만난다.
 *
 *  - 그만둔 줄 — 되살리는 길이 아직 없다. 서버가 그 실행의 노드 수정을 아예
 *    거절하므로(「그만둔 실행의 노드는 더 못 건드린다」) 단추를 그려 봤자 전부
 *    거절로 끝난다.
 *  - ⚠️ **도는 줄** — 눌러서 큰 카드를 그쪽으로 옮기는 길도 **아직 없다.** 큰
 *    카드에 설 실행은 getActiveExecutionForCase 가 차례로 하나 고르고(안 끝난 것
 *    먼저, 나중에 시작한 것 먼저) 사람이 고를 수단이 없다. 여기 단추를 먼저
 *    그리면 누르는 곳만 있고 가는 곳이 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 예외는 **받아 온 것 하나**뿐이다 — renderRowAction(2026-11-02, 조각 8)
 * ──────────────────────────────────────────────────────────────────────
 * 마친 실행은 이제 화면 위에 요약 상자로 서지 않고 **이 묶음의 한 줄로 내려온다**
 * (placeExecutionSummary). 그러면서 마친 실행에 손댈 길이 전부 이 줄로 모였으므로,
 * 상자가 내려올 때 단추까지 화면에서 사라지면 안 된다 — 지금 그 길은 둘이다:
 * [실행 그만두기](치운다)와 [절차 다시 잇기](다시 돌게 한다 — 2026-11-02, 조각 9).
 *
 * 🔴 처음 판(같은 날)은 **내려온 그 한 줄에만** 붙였는데, 사용자가 눈으로 보고
 * 바로잡았다 — 「[실행 그만두기]가 [중단 마침]인 해당 건에 대한 [실행 그만두기]
 * 인지 모든 [중단 마침]에 대한 그만두기인지 모르겠어. [중단 마침] 건별로 [실행
 * 그만두기]가 있도록 해주고.」 줄이 여럿일 때 **하나에만** 달려 있으면 그것이
 * 그 줄의 것인지 묶음 전체의 것인지 눈으로 안 갈린다.
 *
 * 그래서 지금은 **누를 것이 있는 줄마다** 붙인다:
 *
 *  - **어느 줄에 붙는가**는 도메인이 정한다(row.abandonBlockedReason ·
 *    row.resumeBlockedReason). 🔴 **둘의 답이 다르다** — 그만두기는 중단 마침 ·
 *    진행 중 둘에, 다시 잇기는 **중단 마침 하나**에 붙는다(2026-11-02 사용자
 *    결정 — 완주는 끝까지 다 한 기록이라 치울 이유도 이을 것도 없고, 도는 실행은
 *    이미 돌고 있다). 그래서 이 파일은 **둘 중 하나라도** 붙을 줄이면 받아 온
 *    것을 놓고, 둘 중 **무엇을** 놓을지는 보는 쪽이 같은 두 값으로 다시 가른다.
 *    여기서 배지를 보고 가르지 않는다 — 잣대가 두 벌이 되면 「그만둔 줄에 또
 *    그만두기」 같은 것이 조용히 생긴다.
 *  - **무엇을 붙이는가**는 실행 화면이 만든다(renderRowAction). 버전·권한을
 *    그쪽이 쥐고 있고, 이 파일은 서버 컴포넌트라 단추를 만들 수도 없다.
 *  - 줄 하나를 **테두리 두른 칸**으로 그린다. 단추가 그 테두리 **안**에 있어야
 *    「이 줄의 것」이 눈에 보인다 — 위 지적의 본체가 그것이다.
 *
 * 받지 않으면(renderRowAction 이 null) 이 묶음에는 누를 것이 하나도 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 판정을 **다시 하지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * 배지도 진행도도 차례도 담을지 말지도 전부 buildPastExecutionPanel(도메인)이
 * 정한다. 이 파일이 하는 일은 둘뿐 — null 이면 아무것도 안 그리고, tone 을 색으로
 * 옮긴다. 머릿수를 여기서 세면 「담을 것이 없으면 안 그린다」가 두 벌이 된다.
 *
 * 색을 **도메인이 아니라 여기서** 정하는 것은 ExecutionFoldSection 의 note 와
 * 같은 규약이다 — 도메인은 무엇이 더 급한지(tone)만 알고 화면을 모른다.
 *
 * 🔵 넷 중 **빨강도 호박색도 없다.** 「중단 마침」은 나무람이 아니라 사람이
 * 판단해서 끊은 것이고, 「그만둠」도 치운 기록일 뿐 잘못이 아니며, 「진행 중」은
 * 멀쩡히 살아 있는 실행이다. 이 화면에서 호박색은 **차단됨**(사람이 막아 둔 것)
 * 하나가 쓰고 있으므로 여기 섞이면 뜻이 흐려진다.
 */
const BADGE_CLASS: Record<PastExecutionBadge["tone"], string> = {
  // 끝까지 갔다 — 같은 화면의 「절차를 마쳤습니다」(ExecutionLifecycleActions)와
  // 같은 계열이라 두 글자가 서로를 받쳐 준다.
  SUCCESS: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  // 사람이 판단해서 끊었다 — 눈에는 들어오되 경고로 읽히면 안 된다.
  INFO: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  // 치운 것 — 「지나온 길」의 건너뜀 딱지와 같은 무채색.
  MUTED: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  // 아직 살아 있다 — 보라. 🔵 파랑(sky)과 **옆에 놓고도 갈리는** 색이어야 해서
  // 남색(indigo)이 아니라 보라를 골랐다. 이 저장소가 이미 쓰는 색이다
  // (개발자 딱지 · 체크리스트 연결됨 · 보류 사유).
  ACTIVE: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

/** 요약 카드의 「…에 시작」과 같은 모양으로 적는다 — 한 화면에 날짜 꼴이 둘이면 안 된다. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

/**
 * 그 줄에 붙일 것을 **줄 하나를 받아** 만들어 주는 함수. 실행 화면이 내려보낸다 —
 * 줄마다 다른 것(실행 id · 버전 · 이름)을 쥐어 줘야 하므로 통짜 노드 하나로는 안
 * 된다. 🔴 「어느 줄에 붙일지」는 이 함수가 아니라 도메인이 정한다
 * (row.abandonBlockedReason) — 아래 호출부 참조.
 */
export type PastExecutionRowActionRenderer = (row: PastExecutionRow) => ReactNode;

function PastExecutionLine({ row, action }: { row: PastExecutionRow; action: ReactNode | null }) {
  return (
    // 🔴 줄마다 **제 테두리**를 두른다(2026-11-02, 조각 8 보완). 전에는 가는 구분선
    // 하나로 나뉜 평평한 목록이었는데, 줄 안에 단추가 생기자 그 단추가 어느 줄의
    // 것인지 눈으로 안 갈렸다 — 사용자가 바로 그것을 지적했다. 칸이 닫혀 있으면
    // 「이 칸 안의 단추」로 읽힌다.
    <li data-past-execution className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-past-execution-badge={row.badge.outcome}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[row.badge.tone]}`}
        >
          {row.badge.label}
        </span>
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{row.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {/* 진행도는 **글자까지** 도메인이 만들어 온다 — 「3 / 22」만 받아서 여기서
            말을 붙이면 분모가 무엇인지가 화면마다 달라진다. */}
        <span data-past-execution-progress className="tabular-nums">
          {row.progressLabel}
        </span>
        {/* 🔵 시각 하나와 그것이 무엇인지. 끝난 줄은 「…마침 / …님이 그만둠」,
            아직 도는 줄은 「…님이 시작」이다 — 무엇의 시각인지는 도메인이 글자로
            정해 온다(whenNote). */}
        <span>
          {formatWhen(row.whenAt)} {row.whenNote}
        </span>
        {row.startedNote && <span>{row.startedNote}</span>}
      </div>
      {/* 🔵 사유는 그만둔 줄에만 있다. 「잘못 불러와서 치운 것」과 「고객이 수리를
          취소한 것」은 다음에 할 일이 정반대라, 이 글자가 없으면 그 둘을 가를
          수단이 화면에 하나도 없다(abandonProcedureExecution 의 같은 주석). */}
      {row.abandonReason && (
        <p data-past-execution-reason className="whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
          사유: {row.abandonReason}
        </p>
      )}
      {/* 🔵 누를 것이 있는 줄에만 뜬다 — 지금 그것은 [절차 다시 잇기]와
          [실행 그만두기] 둘이고, 줄마다 붙는 수가 다르다(0~2개).
          **줄 테두리 안**이고 줄 글자 아래라, 이 칸의 것임이 눈에 보인다. */}
      {action && <div className="mt-1 flex flex-wrap items-center gap-2">{action}</div>}
    </li>
  );
}

export default function PastExecutionsSection({
  candidates,
  renderRowAction = null,
}: {
  candidates: PastExecutionCandidate[];
  /**
   * 누를 것이 있는 **줄마다** 불린다. 안 주면 이 묶음에는 누를 것이 하나도 없다.
   * 🔴 「누를 것이 있는가」는 이 함수가 아니라 도메인이 정한다 — 아래 호출부.
   */
  renderRowAction?: PastExecutionRowActionRenderer | null;
}) {
  const panel = buildPastExecutionPanel(candidates);
  // 🔴 담을 줄이 한 줄도 없으면 묶음을 **아예 안 그린다**(조각 4 의 「담을 카드가
  // 없는 묶음은 안 그린다」 그대로). 도메인이 null 을 돌려주면 그릴 것이 없다는
  // 뜻이고, 여기서 머릿수를 다시 세지 않는다.
  if (!panel) return null;

  return (
    <ExecutionFoldSection group={panel.fold}>
      <ul className="flex flex-col gap-2">
        {panel.rows.map((row) => (
          <PastExecutionLine
            key={row.executionId}
            row={row}
            /* 🔴 「누를 것이 있는가」를 배지로 다시 가르지 않는다 — 도메인이
               까닭 둘을 돌려주면 그 답을 따를 뿐이다. 둘 **다** 차 있는 줄에만
               아무것도 안 놓는다(완주 · 그만둠). 하나라도 비어 있으면 받아 온
               것을 놓고, 그 안에서 무엇을 그릴지는 같은 두 값이 또 가른다. */
            action={
              (row.resumeBlockedReason === null || row.abandonBlockedReason === null) && renderRowAction
                ? renderRowAction(row)
                : null
            }
          />
        ))}
      </ul>
    </ExecutionFoldSection>
  );
}
