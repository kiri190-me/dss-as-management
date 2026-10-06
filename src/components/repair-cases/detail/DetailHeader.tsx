"use client";

import { Fragment, type ReactNode } from "react";
import { usePathname } from "next/navigation";

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
import { headerFactText, isPrintOnlyPathname } from "./detail-header-display";

/**
 * 수리 건 상세의 머리 카드 — 인수번호 · [폴더 열기] · 상태 배지 · 워크플로 유형 ·
 * 담당 엔지니어 · 고객사 · 모델 · L/N · S/N · 보고서번호.
 *
 * ── 🔴 세로를 한 줄로 줄였다 (2026-10-06) ───────────────────────────────────
 * 사용자 지시다 — 「이 작업의 요점은 머릿말 창의 세로 크기를 최대한 한 줄로
 * 줄이는 것」. 예전에는 세 줄이었다(제목 줄 · 배지 줄 · 두 칸짜리 정의 목록).
 * 지금은 넓은 화면에서 **한 줄**이다:
 *
 *   D261097 [폴더 열기] [배지들]   유상 Matcher · 최희만 수정 · 모델 · L/N · S/N   보고서번호 — 수정
 *
 * 그 한 줄을 만들려고 **작은 이름표(「워크플로 유형」·「담당 엔지니어」·「모델」…)를
 * 화면에서 걷어냈다.** 이름표가 값보다 길어 줄의 절반을 먹고 있었다. 대신 각
 * 조각에 `title` 을 남겨, 무슨 값인지 헷갈리면 마우스를 올려 확인할 수 있다.
 * 보고서번호만 이름표를 남긴다 — 번호가 비면 그 자리에 아무 단서가 없어진다.
 *
 * 🔴 **빈 값은 조각째 빠진다**(headerFactText). `-` 하나가 가운뎃점을 달고
 * 자리를 먹으면 줄인 만큼을 도로 내준다. 워크플로 유형과 담당 엔지니어는 늘
 * 그린다 — 앞은 열거형이라 언제나 값이 있고, 뒤는 미배정이어도 [수정]이 서야
 * 한다(이 카드가 그 값의 유일한 정상 편집 지점이다).
 *
 * 🔴 **좁은 화면에서는 줄바꿈된다.** 바깥 줄도 안쪽 묶음도 전부 wrap 이라,
 * 좁아질수록 보고서번호 → 값 묶음 → [폴더 열기] 차례로 아래로 접힌다.
 *
 * ── 🔴 인쇄 전용 주소에서는 스스로 빠진다 ───────────────────────────────────
 * 이 카드는 레이아웃이 그리므로 `[id]` 아래 **모든** 주소에 따라붙는다. 서비스
 * 보고서 인쇄 미리보기는 고객사로 나가는 문서를 그대로 그리는 자리라, 거기서는
 * 아예 그리지 않는다. 판정은 isPrintOnlyPathname 하나뿐이다(그 파일 머리말에
 * 「왜 통짜 인쇄 숨김이 아닌가」가 적혀 있다).
 *
 * ── 🔴 탭 위에서 그려진다 (2026-10-06) ──────────────────────────────────────
 * 예전에는 「기본 정보」 탭(RepairCaseDetailView) 안에서만 그려져, 다른 탭으로
 * 넘어가면 이 정보가 통째로 사라졌다. 지금은 **[id]/layout.tsx 가 탭 줄보다 위에서
 * 그린다** — 어느 탭을 눌러도 같은 카드가 그대로 남는다. 그래서 이 조각은 서버
 * 컴포넌트인 레이아웃에서 직접 쓰이고, 스스로 "use client" 경계가 된다.
 *
 * 파일 관리 · 검수/승인 탭이 따로 그리던 머리말 상자는 이 카드와 겹쳐서 걷어냈다
 * (2026-10-06). 그 탭들에만 있던 칸(고객사 · 모델)은 여기 한 줄로 들어왔다.
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
  // 훅은 어떤 갈래에서도 같은 차례로 불려야 하므로 이른 반환보다 먼저 부른다.
  const pathname = usePathname();
  const { effective } = useEffectiveRepairCase(resolved);

  // 🔴 인쇄 전용 주소에서는 카드가 통째로 빠진다(위 머리말).
  if (isPrintOnlyPathname(pathname)) return null;

  // resolved 가 null 이 아니면 effective 도 null 이 아니다(useEffectiveRepairCase).
  // 타입을 좁히기 위한 방어적 분기일 뿐, 실제로는 도달하지 않는다.
  if (!effective) return null;

  /**
   * 한 줄에 늘어놓을 값들. 이름표는 `title` 로만 남는다(위 머리말).
   * 앞 둘은 언제나 선다 — 워크플로 유형은 열거형이라 빈 값이 없고, 담당
   * 엔지니어는 미배정이어도 [수정]이 서야 한다.
   */
  const facts: Array<{ key: string; label: string; node: ReactNode }> = [
    {
      key: "workflowType",
      label: "워크플로 유형",
      node: uiText.workflowType[effective.workflowType],
    },
    {
      key: "engineer",
      label: "담당 엔지니어",
      node: (
        <EngineerEditCell
          repairCaseId={effective.id}
          version={effective.version}
          assignedEngineerId={effective.assignedEngineerId}
          engineerName={effective.engineerName}
          canEdit={canEditEngineer}
          referenceData={referenceData}
        />
      ),
    },
  ];

  // 🔴 빈 값(그리고 `-` 같은 자리표시)은 조각째 빠진다 — 자리를 먹지 않는다.
  const optionalFacts: ReadonlyArray<readonly [string, string, string | null]> = [
    ["customerName", "고객사", effective.customerName],
    ["modelName", "모델", effective.modelName],
    ["lotNumber", "L/N", effective.lotNumber],
    ["serialNumber", "S/N", effective.serialNumber],
  ];
  for (const [key, label, raw] of optionalFacts) {
    const text = headerFactText(raw);
    if (text !== null) facts.push({ key, label, node: text });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* 🔴 인수번호 · [폴더 열기] · 상태 배지들이 **한 묶음 한 줄**이다
            (2026-10-06 사용자 지정). 배지가 따로 한 줄을 먹고 있던 것을 여기로
            합쳤다. 묶음도 바깥 줄도 줄바꿈을 허용하므로 좁은 화면에서는 배지들이
            인수번호 밑으로 접힌다.
            🔴 연락서 공유폴더를 탐색기로 연다 — 찾기만 한다(없으면 「아직 없습니다」).
            Windows PC 에서만 그려지고, 인쇄에는 찍히지 않는다. */}
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {effective.intakeNumber}
          </h1>
          <ContactFolderOpenButton repairCaseId={effective.id} />
          <StatusBadge status={effective.effectiveStatus} />
          <PriorityBadge priority={effective.priority} />
          <OverdueBadge isOverdue={effective.effectiveIsOverdue} />
          <HoldBadge isOnHold={effective.holdState?.isOnHold ?? false} />
          <WorkflowOverrideBadge hasOverride={effective.hasWorkflowOverride} />
          <SourceBadge source={effective.source} />
        </div>
        {/* 값만 늘어놓는 묶음 — 뜻은 각 조각의 title 에 있다. 편집 중에는 담당
            엔지니어 자리에 form 이 들어오므로 p 가 아니라 div 다(p 안의 form/div 는
            브라우저가 다시 배치해 hydration 이 깨진다). */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300">
          {facts.map((fact, index) => (
            <Fragment key={fact.key}>
              {index > 0 && (
                <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
                  ·
                </span>
              )}
              <div title={fact.label}>{fact.node}</div>
            </Fragment>
          ))}
        </div>
        {/* 보고서번호만 이름표를 남긴다 — 비어 있을 때 그 자리에 단서가 없어진다.
            여기도 편집 중에 form 이 들어오는 자리라 p 가 아니라 div 다. */}
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
    </div>
  );
}
