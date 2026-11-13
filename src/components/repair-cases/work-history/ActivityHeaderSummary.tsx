import { HoldBadge, SourceBadge, StatusBadge, WorkflowOverrideBadge } from "@/components/repair-cases/badges";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";

/**
 * 이 헤더만 EffectiveRepairCase(Stage E-1 유효 상태)를 읽는다 — 타임라인
 * 항목들은 전부 과거 시점 값만 사용하며 이 컴포넌트가 보여주는 "현재" 상태를
 * 절대 대체하지 않는다.
 *
 * ── 🔴 2026-11-13 실측: **이 파일을 부르는 곳이 하나도 없다** ─────────────
 * 배지 표시 설정(조각 3)을 붙이며 호출부를 grep 했더니 `src/` 어디에도 없었다.
 * 「작업 이력」 탭이 실제로 그리는 것은 DatabaseWorkHistoryScreen 하나이고, 그
 * 화면에는 배지가 한 개도 없다 — 탭 위의 머리 카드(DetailHeader)가 상태 배지를
 * 맡고 있다. HANDOFF 에도 「죽은 파일, 지울지 정하면 된다」로 적혀 있다.
 *
 * ── 🔴 같은 날 늦게: 아래 배지 넷은 **자리를 하나도 안 받는다** ───────────
 * 조각 3이 「수리건 상세 — 작업 이력 탭」 자리를 이 넷에 붙여 뒀었는데, 그날
 * 등록부(domain/badge-visibility.ts)에서 **그 자리 자체를 걷어냈다.** 까닭은 위
 * 문단 그대로다 — 그 자리를 그리는 살아 있는 화면이 없어서, 설정 화면에 선 체크상자
 * 넷이 꺼도 아무 일이 안 일어나는 스위치였다. 끈 사람은 기능이 고장 난 것으로 읽는다.
 *
 * 🔵 자리를 안 주면 판정은 **언제나 「보임」**이다(허용되지 않는 쌍의 규칙). 그래서
 * 이 파일이 되살아나도 배지는 예전처럼 그대로 그려진다 — 조용히 사라지는 쪽이 아니다.
 *
 * 🔴 **되살리면서 자리별로 끄고 싶어지거든 등록부에 자리를 먼저 적지 마라.** 순서는
 * ① 이 화면을 실제로 그리는 탭을 만들고 → ② 자리 키를 받아 넘기고 → ③ 등록부에 자리를
 * 더한다. 거꾸로 하면 이번에 되돌린 그 모양(스위치는 있는데 그릴 화면이 없는 상태)이
 * 다시 생긴다. 🔵 지금 이 파일이 자리를 한 글자도 안 들고 있는지는
 * badge-visibility-screens.test.tsx 의 「설정 대상이 **아닌** 화면들」 목록이 지킨다.
 */
export default function ActivityHeaderSummary({ resolved }: { resolved: EffectiveRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber} · 작업 이력
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowOverrideBadge hasOverride={resolved.hasWorkflowOverride} />
          <SourceBadge source={resolved.source} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 수리 상태</dt>
          <dd className="mt-0.5 flex items-center gap-1">
            <StatusBadge status={resolved.effectiveStatus} />
            <HoldBadge isOnHold={resolved.holdState?.isOnHold ?? false} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{resolved.engineerName ?? "미배정"}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        아래 타임라인의 각 항목은 발생 당시의 과거 기록입니다. 위 현재 수리 상태로 대체되지 않습니다.
      </p>
    </div>
  );
}
