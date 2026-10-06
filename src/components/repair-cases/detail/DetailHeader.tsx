"use client";

import {
  HoldBadge,
  OverdueBadge,
  PriorityBadge,
  SourceBadge,
  StatusBadge,
  WorkflowOverrideBadge,
} from "@/components/repair-cases/badges";
import ContactFolderOpenButton from "@/components/repair-cases/detail/ContactFolderOpenButton";
import EngineerEditCell from "@/components/repair-cases/detail/edit/EngineerEditCell";
import ReportNumberEditCell from "@/components/repair-cases/detail/edit/ReportNumberEditCell";
import { useUiText } from "@/components/providers/UiTextProvider";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";

/**
 * 수리 건 상세의 머리 카드 — 인수번호 · [폴더 열기] · 상태 배지 · 워크플로 유형 ·
 * 담당 엔지니어 · 보고서번호.
 *
 * ── 🔴 탭 위에서 그려진다 (2026-10-06) ──────────────────────────────────────
 * 예전에는 「기본 정보」 탭(RepairCaseDetailView) 안에서만 그려져, 다른 탭으로
 * 넘어가면 이 정보가 통째로 사라졌다. 지금은 **[id]/layout.tsx 가 탭 줄보다 위에서
 * 그린다** — 어느 탭을 눌러도 같은 카드가 그대로 남는다. 그래서 이 조각은 서버
 * 컴포넌트인 레이아웃에서 직접 쓰이고, 스스로 "use client" 경계가 된다.
 *
 * ── 🔴 유효 상태는 이 조각이 직접 입힌다 ────────────────────────────────────
 * 옛 구조에서는 RepairCaseDetailView("use client")가 useEffectiveRepairCase 로
 * 만든 EffectiveRepairCase 를 내려 주었다. 레이아웃은 서버라 그 훅을 부를 수 없으므로
 * **원본 ResolvedRepairCase 를 받아 여기서 같은 훅을 부른다** — 워크플로 재정의를
 * 병합하는 자리는 여전히 그 어댑터 하나뿐이고(effective-repair-case.ts 머리말),
 * 화면이 원본과 재정의를 직접 섞지 않는다.
 *
 * Stage E-1부터 원본 resolved.status/isOverdue가 아니라 effectiveStatus/
 * effectiveIsOverdue를 표시한다 — 워크플로 재정의가 있으면 그 결과를,
 * 없으면 원본과 동일한 값을 그대로 보여준다(effective-repair-case.ts 참고).
 *
 * 담당 엔지니어와 보고서번호는 이 카드가 유일한 정상 편집 지점이다(각각 고장
 * 및 서비스 정보 / 인수 정보의 편집 폼에는 더 이상 없다) —
 * canEditEngineer/canEditReportNumber/referenceData는 [id]/layout.tsx가
 * 계산해 그대로 전달한다(판정 함수는 옛 자리와 똑같다: isFieldEditable).
 */
export default function DetailHeader({
  resolved,
  canEditEngineer,
  canEditReportNumber,
  referenceData,
}: {
  resolved: ResolvedRepairCase;
  canEditEngineer: boolean;
  canEditReportNumber: boolean;
  referenceData: IntakeReferenceData | null;
}) {
  const uiText = useUiText();
  const { effective } = useEffectiveRepairCase(resolved);

  // resolved 가 null 이 아니면 effective 도 null 이 아니다(useEffectiveRepairCase).
  // 타입을 좁히기 위한 방어적 분기일 뿐, 실제로는 도달하지 않는다.
  if (!effective) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* 🔴 인수번호와 [폴더 열기]는 **같은 줄**이다(2026-10-06 사용자 지정).
            바깥 줄과 이 묶음 둘 다 줄바꿈을 허용하므로, 좁은 화면에서는 먼저
            보고서번호가 아래로 내려가고 더 좁아지면 단추가 인수번호 밑으로 접힌다 —
            오른쪽 끝 보고서번호와 겹칠 일이 없다.
            🔴 연락서 공유폴더를 탐색기로 연다 — 찾기만 한다(없으면 「아직 없습니다」).
            Windows PC 에서만 그려지고, 인쇄에는 찍히지 않는다. */}
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {effective.intakeNumber}
          </h1>
          <ContactFolderOpenButton repairCaseId={effective.id} />
        </div>
        {/* 편집 중에는 이 자리에 form이 렌더링되므로 p가 아니라 div다
            (p 안의 form/div는 브라우저가 다시 배치해 hydration이 깨진다). */}
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          보고서번호{" "}
          <ReportNumberEditCell
            repairCaseId={effective.id}
            version={effective.version}
            legacyReportNumber={effective.legacyReportNumber}
            canEdit={canEditReportNumber}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={effective.effectiveStatus} />
        <PriorityBadge priority={effective.priority} />
        <OverdueBadge isOverdue={effective.effectiveIsOverdue} />
        <HoldBadge isOnHold={effective.holdState?.isOnHold ?? false} />
        <WorkflowOverrideBadge hasOverride={effective.hasWorkflowOverride} />
        <SourceBadge source={effective.source} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">워크플로 유형</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {uiText.workflowType[effective.workflowType]}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            <EngineerEditCell
              repairCaseId={effective.id}
              version={effective.version}
              assignedEngineerId={effective.assignedEngineerId}
              engineerName={effective.engineerName}
              canEdit={canEditEngineer}
              referenceData={referenceData}
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}
