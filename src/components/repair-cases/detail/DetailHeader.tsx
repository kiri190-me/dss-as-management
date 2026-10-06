"use client";

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
 * 수리 건 상세의 머리 카드 — 인수번호 · [폴더 열기] · 상태 배지 · 유형 · 고객사 ·
 * 모델 · L/N · S/N · 담당 엔지니어 · 보고서번호.
 *
 * ── 🔴 세로는 줄이되, 무엇이 무엇인지는 보이게 (2026-10-06) ─────────────────
 * 사용자 지시다 — 「이 작업의 요점은 머릿말 창의 세로 크기를 최대한 한 줄로
 * 줄이는 것」. 예전에는 세 줄이었다(제목 줄 · 배지 줄 · 두 칸짜리 정의 목록).
 *
 * 그 한 줄을 만들면서 이름표를 **전부 없앴더니** 값만 가운뎃점으로 줄줄이
 * 늘어서서 사용자가 「지금은 뭐가 뭔지 모르겠어」라고 했다. 그래서 같은 날
 * 다시 고쳤다 — **값마다 연한 배경 알약을 입히고 그 안에 짧은 이름표를 넣는다.**
 *
 *   D261097 [폴더 열기] [배지들]
 *     (유형 유상 Matcher) (고객사 주성 엔지니어링) (모델 CMK300M-JS2) (L/N …) (S/N …)
 *                                        담당 최희만 수정   보고서번호 — 수정
 *
 * 🔴 **가운뎃점 구분자는 없앴다** — 알약의 테두리가 그 일을 한다. 둘 다 두면
 * 지저분하다. 이름표는 짧게 자른다(「워크플로 유형」이 아니라 「유형」) — 이름표가
 * 값보다 길면 줄의 절반을 도로 먹는다.
 *
 * 🔴 **알약 배경은 상태 배지와 같은 회색 단계다.** 처음에는 한 단계 연하게 깔았는데
 * (밝은 화면 50 / 어두운 화면 800 의 반투명), 사용자가 화면을 보면서 「배경 색이
 * 조금 더 찐했으면 좋겠어」라고 해서 한 칸 올렸다 — 밝은 화면 100, 어두운 화면 800.
 * 🔴 바탕이 진해진 만큼 **밝은 화면의 이름표도 한 칸 진하게** 했다(회색 500 →
 * 600). 500 을 그대로 두면 바탕 100 위에서 명암비가 4.45:1 로, 12px 글자에
 * 요구되는 4.5:1 아래로 내려간다 — 이름표가 묻힌다. 어두운 화면은 400 그대로
 * 충분하다(5.7:1). 안쪽 여백만은 배지보다 좁게 잡아(좌우 1.5) 가로를 아낀다 —
 * 이름표가 늘어난 만큼을 조금이라도 돌려받는다.
 *
 * 🔴 **이름표가 보이므로 `title` 은 뺐다.** 예전에는 값만 보이던 자리라 뜻을
 * 마우스로 확인해야 했지만, 지금은 같은 글자가 화면에 그대로 있다. 같은 말을
 * 두 벌로 들고 있으면 한쪽만 고쳐질 뿐이다.
 *
 * 🔴 **빈 값은 조각째 빠진다**(headerFactText). `-` 하나가 알약을 쓰고 자리를
 * 먹으면 줄인 만큼을 도로 내준다. 이름표만 남은 빈 알약도 생기지 않는다.
 * 유형은 열거형이라 언제나 값이 있어 늘 그린다.
 *
 * 🔴 **담당 엔지니어는 알약을 안 입는다.** 사용자 지시로 보고서번호 **왼쪽**,
 * 같은 오른쪽 묶음에 같은 결로 선다 — 둘 다 [수정]을 달고 있어 값만 있는
 * 알약들과 성격이 다르다. 대신 「담당」이라는 이름표는 붙였다: 「최희만 수정」만
 * 있으면 그 사람이 담당인지 접수자인지 알 수 없다. 미배정이어도 늘 그린다 —
 * 이 카드가 그 값의 유일한 정상 편집 지점이다.
 *
 * 🔴 **좁은 화면에서는 줄바꿈된다.** 바깥 줄도 안쪽 묶음도 전부 wrap 이고,
 * 오른쪽 묶음은 자동 왼쪽 여백으로 밀어 두어 아래로 접혀도 오른쪽에 붙는다.
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
   * 알약 하나하나. 이름표는 **화면에 보이는 글자**다(위 머리말 — `title` 은 뺐다).
   * 유형은 열거형이라 빈 값이 없어 늘 선다.
   */
  const facts: Array<{ key: string; label: string; value: string }> = [
    {
      key: "workflowType",
      label: "유형",
      value: uiText.workflowType[effective.workflowType],
    },
  ];

  // 🔴 빈 값(그리고 `-` 같은 자리표시)은 조각째 빠진다 — 이름표만 남은 빈 알약이
  // 자리를 먹지 않는다.
  const optionalFacts: ReadonlyArray<readonly [string, string, string | null]> = [
    ["customerName", "고객사", effective.customerName],
    ["modelName", "모델", effective.modelName],
    ["lotNumber", "L/N", effective.lotNumber],
    ["serialNumber", "S/N", effective.serialNumber],
  ];
  for (const [key, label, raw] of optionalFacts) {
    const text = headerFactText(raw);
    if (text !== null) facts.push({ key, label, value: text });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* 세 묶음 — 인수번호/배지 · 값 알약 · [수정] 둘. 가로가 모자라면 묶음째
          아래로 접힌다. 자리 배분은 마지막 묶음의 자동 왼쪽 여백이 맡는다
          (양끝 정렬이 아니다 — 그러면 접혔을 때 마지막 묶음이 왼쪽으로 가 버린다). */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
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
        {/* 🔴 값 알약 묶음 — 조각마다 연한 배경과 짧은 이름표를 쓴다. 가운뎃점
            구분자는 없다(알약이 가른다). 배경은 상태 배지가 쓰는 회색과 같은 단계고
            (사용자가 화면을 보고 「더 찐하게」), 안쪽 여백만 배지보다 좁다. */}
        <div className="flex flex-wrap items-baseline gap-1.5">
          {facts.map((fact) => (
            <span
              key={fact.key}
              className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800"
            >
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{fact.label}</span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{fact.value}</span>
            </span>
          ))}
        </div>
        {/* 🔴 [수정]을 단 둘은 오른쪽 묶음에 같은 결로 선다 — 담당 엔지니어가
            보고서번호 **왼쪽**이다(2026-10-06 사용자 지정). 알약을 입히지 않는다.
            자동 왼쪽 여백이라 이 묶음만 아래로 접혀도 오른쪽에 붙는다.
            편집 중에는 두 자리에 form 이 들어오므로 p 가 아니라 div 다(p 안의
            form/div 는 브라우저가 다시 배치해 hydration 이 깨진다). */}
        <div className="ml-auto flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
          <div>
            담당{" "}
            <EngineerEditCell
              repairCaseId={effective.id}
              version={effective.version}
              assignedEngineerId={effective.assignedEngineerId}
              engineerName={effective.engineerName}
              canEdit={canEditEngineer}
              referenceData={referenceData}
            />
          </div>
          <div>
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
    </div>
  );
}
