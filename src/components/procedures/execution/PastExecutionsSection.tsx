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
 * 🔴 읽기 전용이다 — 누를 것이 하나도 없다
 * ──────────────────────────────────────────────────────────────────────
 * 단추도 링크도 안 그린다. 있는 것처럼 보이는 자리를 만들면 눌러 본 사람이 아무
 * 일도 안 일어나는 화면을 만난다.
 *
 *  - 끝난 줄 — 되살리는 길이 이 조각에 없다. 그만둔 실행은 서버가 노드 수정을
 *    아예 거절하므로(「그만둔 실행의 노드는 더 못 건드린다」) 단추를 그려 봤자
 *    전부 거절로 끝난다.
 *  - ⚠️ **도는 줄** — 눌러서 큰 카드를 그쪽으로 옮기는 길도 **아직 없다.** 큰
 *    카드에 설 실행은 getActiveExecutionForCase 가 차례로 하나 고르고(안 끝난 것
 *    먼저, 나중에 시작한 것 먼저) 사람이 고를 수단이 없다. 여기 단추를 먼저
 *    그리면 누르는 곳만 있고 가는 곳이 없다.
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

function PastExecutionLine({ row }: { row: PastExecutionRow }) {
  return (
    <li data-past-execution className="flex flex-col gap-1 border-t border-zinc-100 py-2 first:border-t-0 first:pt-0 dark:border-zinc-800">
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
    </li>
  );
}

export default function PastExecutionsSection({ candidates }: { candidates: PastExecutionCandidate[] }) {
  const panel = buildPastExecutionPanel(candidates);
  // 🔴 담을 줄이 한 줄도 없으면 묶음을 **아예 안 그린다**(조각 4 의 「담을 카드가
  // 없는 묶음은 안 그린다」 그대로). 도메인이 null 을 돌려주면 그릴 것이 없다는
  // 뜻이고, 여기서 머릿수를 다시 세지 않는다.
  if (!panel) return null;

  return (
    <ExecutionFoldSection group={panel.fold}>
      <ul className="flex flex-col">
        {panel.rows.map((row) => (
          <PastExecutionLine key={row.executionId} row={row} />
        ))}
      </ul>
    </ExecutionFoldSection>
  );
}
