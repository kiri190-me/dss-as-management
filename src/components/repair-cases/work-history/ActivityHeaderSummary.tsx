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
 * 🔴 그래도 아래 배지 넷에 자리(`repairCaseDetailActivity`)를 붙여 둔 까닭은,
 * 등록부(domain/badge-visibility.ts)가 그 네 쌍을 「수리건 상세 — 작업 이력 탭」
 * 으로 이미 적어 두었고 설정 화면에 체크상자가 서 있기 때문이다. 자리를 안 붙이면
 * **이 파일이 되살아나는 날 그 네 스위치만 조용히 안 듣는다.**
 * 🔴 **다만 지금은 그 네 스위치를 꺼도 화면에서 달라지는 것이 없다** — 파일을
 * 되살릴지 지울지는 사람이 정할 일이라 여기서 건드리지 않았다.
 */
export default function ActivityHeaderSummary({ resolved }: { resolved: EffectiveRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber} · 작업 이력
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowOverrideBadge
            hasOverride={resolved.hasWorkflowOverride}
            placeKey="repairCaseDetailActivity"
          />
          <SourceBadge source={resolved.source} placeKey="repairCaseDetailActivity" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 수리 상태</dt>
          <dd className="mt-0.5 flex items-center gap-1">
            <StatusBadge status={resolved.effectiveStatus} placeKey="repairCaseDetailActivity" />
            <HoldBadge
              isOnHold={resolved.holdState?.isOnHold ?? false}
              placeKey="repairCaseDetailActivity"
            />
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
