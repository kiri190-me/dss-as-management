"use client";

import { useState } from "react";
import LoadingNotice from "@/components/domain/LoadingNotice";
import NoticePopup from "@/components/common/NoticePopup";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import IntakeInfoSection from "@/components/repair-cases/detail/IntakeInfoSection";
import ProductInfoSection from "@/components/repair-cases/detail/ProductInfoSection";
import DomesticOrderDatesSection from "@/components/repair-cases/detail/DomesticOrderDatesSection";
import FaultServiceSection from "@/components/repair-cases/detail/FaultServiceSection";
import WorkflowProgress from "@/components/repair-cases/detail/WorkflowProgress";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { editableFieldsForRoleInSection, isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
/* 🔴 2026-10-27 에 `components/inventory/` 에서 **이 폴더로 옮겨 왔다.** 그 폴더에는 옛 재고
   화면이 함께 살고 있었고, 그것을 걷어내면서 이 칸까지 폴더째 지워질 뻔했다 — 이 칸은 옛 재고
   표를 한 줄도 읽지 않는 **새 통로**(server/actions/inventory-stock-requests · domain/
   inventory-gateway) 전용이고, 그리는 자리도 수리 건 상세 하나뿐이라 여기가 제자리다. */
import PartRequestSection from "@/components/repair-cases/detail/PartRequestSection";
import type { PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import type { RequestCaseContext } from "@/lib/db/queries/repair-cases";
import type {
  InventoryOhTemplate,
  InventoryPart,
  InventoryResult,
  InventoryStockRequestForScreen,
} from "@/lib/domain/inventory-gateway";
import type { DerivedServiceSummary } from "@/lib/db/queries/repair-case-work-records";
import PendingBillingDecisionCard from "@/components/repair-cases/detail/PendingBillingDecisionCard";
import UsedPartsSection from "@/components/repair-cases/detail/UsedPartsSection";
import type { RepairCaseUsedPartsView } from "@/lib/db/queries/repair-case-used-parts";
import type { RepairCaseDomesticOrderIssueDateRow } from "@/lib/domain/domestic-order-issue-date-edit";

/**
 * mock(서버 조회)과 local(클라이언트 조회) 두 경로가 모두 이 컴포넌트 하나로
 * 수렴한다. Stage E-1부터 이 컴포넌트가 워크플로 재정의를 적용하는 단일
 * 지점이다 — useEffectiveRepairCase가 계산한 effective 값만 하위 컴포넌트에
 * 전달하며, 그 아래 어떤 컴포넌트도 원본 resolved와 override를 직접
 * 병합하지 않는다.
 *
 * Section-based editing (repair-case editing task): `editingSection` is
 * owned here, the single source of truth enforcing "only one section may be
 * in edit mode at a time" — sections receive it read-only and call
 * onStartEdit/onDone to request a transition, never set it directly.
 * Editing is only ever offered for a DATABASE-sourced row (MOCK/LOCAL_DEMO
 * have no server-side edit path); each section's `editableFields` is
 * computed from the centralized authorization helper — hiding a section's
 * Edit button here is a UX convenience only, never the enforcement
 * boundary (update-repair-case.ts's Server Action re-checks independently).
 *
 * Phase 5C-1: this screen ("기본 정보") no longer renders the workflow
 * control panel — the executable-actions UI (WorkflowControlPanel /
 * DatabaseWorkflowControlPanel) moved to the "작업내용" screen
 * (repair-cases/[id]/execution/page.tsx), which now owns fetching
 * workflowHistory/holdState/currentApprovals itself. WorkflowProgress
 * (read-only stage visualization) stays here.
 */
export default function RepairCaseDetailView({
  resolved,
  related,
  relatedActionSummaries,
  productModelLinkId,
  actingUser,
  referenceData,
  partRequestData,
  derivedServiceSummary,
  domesticOrderDueDates,
  isDueDateNear,
  isDueDateInverted,
  domesticOrderIssueDates,
  canWriteDomesticOrderIssueDates,
  usedParts,
  usedPartOptions,
  usedPartDisplayNames,
}: {
  resolved: ResolvedRepairCase;
  related: RelatedMatch[];
  /**
   * 이력 줄의 `조치 내용` — 건 id → 작업기록에서 도출한 값(없으면 null).
   * 접수 건의 칼럼이 아니라 상세 화면 본문과 **같은 소스**(작업기록의
   * DIAGNOSIS_REPAIR_SUMMARY 최신 줄)에서 한 번에 가져온 것이라 RelatedMatch
   * 안이 아니라 이 짝 지도로 온다, see [id]/page.tsx.
   */
  relatedActionSummaries: Record<string, string | null>;
  /**
   * 제품 정보의 `Model` 을 눌러 갈 제품 모델 상세의 id. **null 이면 링크를 만들지
   * 않고 글자 그대로 둔다** — 모델 마스터가 안 붙은 개체 · 휴지통에 든 모델 ·
   * 데모 건(MOCK/LOCAL_DEMO) · 제품 모델을 볼 권한이 없는 세션이 전부 여기서
   * null 이다. 판정도 조회도 [id]/page.tsx 가 하고, 화면은 있고 없고만 본다.
   */
  productModelLinkId: string | null;
  actingUser: ActingUser | null;
  referenceData: IntakeReferenceData | null;
  /**
   * 「부품 요청」 칸의 재료. 부품 요청 쓰기 권한이 있는 사람이 DATABASE 소스 건을 볼 때만
   * 채워진다, see [id]/page.tsx.
   *
   * 🔴 **2026-10-15 부터 전부 재고 관리에서 온다** — A/S 제 표를 읽지 않는다. 그래서 세 칸이
   * `InventoryResult` 다: 「없다」와 **「못 받아 왔다」**가 다른 값이어야 화면이 빈 목록을
   * 「재고에 하나도 없다」로 그리지 않는다.
   */
  partRequestData: {
    caseContext: RequestCaseContext | null;
    parts: InventoryResult<InventoryPart[]>;
    /** 🔵 `value: null` 은 **이어 둔 템플릿이 없다**는 뜻이고 오류가 아니다. */
    ohTemplate: InventoryResult<InventoryOhTemplate | null>;
    /**
     * 🔵 누가 올렸든 이 건의 반출 신청 전부(재고 관리에서 직접 올린 것까지).
     * 🔴 **포털 번호가 빠진 모양**이다 — 서버가 「내가 올린 줄인가」(`mine`)만 재어 넣는다.
     */
    requests: InventoryResult<InventoryStockRequestForScreen[]>;
    /** 포털 번호가 없는 사람은 올릴 수 없다 — 까닭을 그대로 들고 온다. */
    requesterGate: { ok: true } | { ok: false; message: string };
  } | null;
  /** record_kind 분류 체크포인트 — DATABASE 소스 건에만 존재, see [id]/page.tsx. */
  derivedServiceSummary: DerivedServiceSummary | null;
  /**
   * 이 건에 연결된 **내자 정리 줄들의 납기요청일 전부**(지워지지 않은 줄만).
   * 인수 정보의 `고객 요청 납기일`이 비어 있을 때 대신 그릴 날짜의 재료이고,
   * 없는 것이 정상이라 빈 배열이 기본이다(MOCK/LOCAL_DEMO 건은 언제나 빈
   * 배열 — domestic_orders 자체가 DATABASE 쪽 표다).
   *
   * ⚠️ **여기서 하나로 접지 않는다.** 여럿 중 무엇을 보여 줄지는
   * domain/requested-due-date-link.ts가 주간보고와 같은 함수로 정한다 — 화면이
   * 미리 고르면 그 규칙이 두 벌이 되고, 그날 두 화면이 같은 자료를 다른 날짜로
   * 보여 준다.
   */
  domesticOrderDueDates: readonly string[];
  /**
   * 이 건이 「납기 임박」인가 — 「인수 정보」의 고객 요청 납기일 글자를 굵은
   * 붉은색으로 만든다(2026-10-19). 🔴 **서버가 재 온다**([id]/page.tsx): "오늘"을
   * 화면에서 만들면 hydration 이 어긋나고, 조건을 적으면 종 알림과 두 말이 된다.
   * 머리 카드의 같은 배지는 레이아웃이 따로 같은 함수로 재 온다(그 쪽은 이 화면의
   * prop 을 볼 수 없다 — 레이아웃과 탭은 서로 props 를 주고받지 않는다).
   */
  isDueDateNear: boolean;
  /**
   * 이 건이 「납기 역전」인가 — **사내 목표 출하일이 고객 요청 납기일보다 늦다**
   * (2026-10-29). 같은 「인수 정보」의 고객 요청 납기일을 굵은 붉은색으로 만들고,
   * 그 아래에 「납기 요청일 협의가 필요합니다.」를 한 줄 붙인다. 🔴 **이미 나간
   * 건에는 뜨지 않는다**(2026-10-30 사용자 결정 — 할 일이 없는 말이고, 지난 건마다
   * 붉은 글이 뜨면 살아 있는 경고가 묻힌다). 「납기 임박」이 빠지는 자리와 같다.
   *
   * 🔴 위 isDueDateNear 와 **다른 사실**이고 둘이 함께 참일 수 있다 — 겹치면 둘 다
   * 보인다(사용자 결정). 🔴 **서버가 재 온다**([id]/page.tsx): 판정이 빌려 온 날짜까지
   * 보므로(고객 요청 납기일이 비면 연결된 내자의 가장 이른 하루) 화면마다 다시
   * 엮으면 같은 건이 화면마다 다른 날짜로 재진다. 머리 카드는 이 사실을 그리지
   * 않는다 — 이번 요구는 날짜 칸에 대한 것이고, 배지는 더하지 않았다.
   */
  isDueDateInverted: boolean;
  /**
   * 「내자 정리 발행일」 구역의 재료 — 이 건에 연결된 내자 줄들의 **견적발행일 ·
   * 발주발행일**(지워지지 않은 줄만).
   *
   * 🔴 **null 과 빈 배열은 다른 뜻이다.** null 은 "내자 자료를 볼 수 없다"(또는
   * 애초에 domestic_orders 가 없는 MOCK/LOCAL_DEMO 건)라 **구역 자체를 그리지
   * 않는다**. 빈 배열은 "볼 수 있고, 연결된 줄이 없다"라 구역은 그려지고 안내 한
   * 줄이 붙는다. 판정도 조회도 [id]/page.tsx 가 하고, 볼 수 없는 사람에게는 조회
   * 자체가 돌지 않는다.
   *
   * ⚠️ 여기서 하나로 접지 않는다 — domesticOrderDueDates 와 같은 이유다(위 주석).
   * 어느 줄을 그릴지는 domain/repair-case-domestic-order-dates.ts 가 주간보고와
   * 같은 pickWeeklyReportOrderDates 로 정한다.
   *
   * 한 줄에는 그릴 두 날짜 말고 **고칠 대상을 가리키는 셋**(id · 내자 줄의
   * version · quoteId)이 함께 실려 온다(2026-09-29) — 화면에 그리는 값이 아니라
   * 저장이 어느 줄을 어떻게 다룰지 정하는 재료다.
   */
  domesticOrderIssueDates: readonly RepairCaseDomesticOrderIssueDateRow[] | null;
  /**
   * 「내자 정리 발행일」의 두 날짜를 **고칠 수 있는 사람인가**(domesticOrders
   * WRITE). 🔴 위 목록을 볼 수 있는가(READ)와 **다른 축**이라 따로 받는다 —
   * 거짓이면 구역은 그려지되 수정 단추가 없다. 판정은 [id]/page.tsx 가 하고,
   * 화면이 감춘 것은 경계가 아니다(서버 액션이 다시 묻는다).
   */
  canWriteDomesticOrderIssueDates: boolean;
  /**
   * 「사용 부품」 칸의 재료 — 손으로 적어 둔 줄들과, **서버가 내린** "이 건에 적을
   * 수 있는가"(writeGate). DATABASE 소스 건에만 있고 나머지는 null 이라 칸 자체가
   * 그려지지 않는다, see [id]/page.tsx.
   */
  usedParts: RepairCaseUsedPartsView | null;
  /**
   * 「사용 부품」 품명 칸에서 찾아 고를 부품(B-2). 🔴 **2026-10-16 부터 재고 관리에서
   * 온다** — 재고 · 소유 · 비고는 서버가 떼어 내고 보낸다(domain/inventory-gateway.ts 의
   * toPartPickerRows). 거르기는 브라우저에서 한다.
   *
   * 🔴 **갈래가 그대로 온다** — 위 `partRequestData` 의 세 칸과 같은 까닭이다. 못 받아 온
   * 것을 빈 목록으로 바꾸면 화면이 「재고에 부품이 하나도 없다」고 거짓말한다.
   */
  usedPartOptions: InventoryResult<readonly PartPickerRow[]>;
  /**
   * 「사용 부품」 줄마다 **보여 줄 글자** — 줄 id → `고객사 품명 (품번)` 또는 `품번`.
   * 🔴 **서버가 만든다**(domain/used-part-display.ts, [id]/page.tsx). 화면이 다시
   * 합치지 않는다 — [고장 부품] 그래프도 같은 규칙을 쓸 자리라, 합치는 곳이 둘이 되면
   * 같은 부품이 화면마다 다른 이름으로 보인다.
   * 🔴 **저장된 글자는 바뀌지 않는다** — 줄의 `partNameText` 는 그대로 품번이고,
   * 수정 폼은 그 글자를 칸에 넣는다.
   */
  usedPartDisplayNames: Record<string, string>;
}) {
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);
  const [editingSection, setEditingSection] = useState<RepairCaseEditSection | null>(null);
  /**
   * 🔴 고객 요청 납기일은 저장됐는데 **내자 정리의 납기요청일이 못 따라갔을 때**의
   * 글(2026-10-30). 띄우는 자리가 인수 정보 구역이 아니라 여기인 까닭: 저장에
   * 성공하면 편집 폼이 닫히면서 통째로 사라지는데(언마운트), 이 알림은 사람이 읽고
   * 닫을 때까지 떠 있어야 한다.
   */
  const [requestedDueDateNotLinked, setRequestedDueDateNotLinked] = useState<string | null>(null);

  if (!isHydrated || !effective) {
    return <LoadingNotice />;
  }

  const canEditAtAll = resolved.source === "DATABASE" && actingUser !== null;

  function fieldsFor(section: RepairCaseEditSection): readonly string[] | null {
    if (!canEditAtAll || !actingUser) return null;
    const fields = editableFieldsForRoleInSection(actingUser.role, section);
    return fields.length > 0 ? fields : null;
  }

  const intakeFields = fieldsFor("INTAKE");
  const productFields = fieldsFor("PRODUCT");
  const faultServiceFields = fieldsFor("FAULT_SERVICE");

  function handleDone() {
    setEditingSection(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 🔴 머리 카드(DetailHeader)는 여기에 없다 — 2026-10-06부터 [id]/layout.tsx 가
          탭 줄보다 위에서 그린다. 여기서 한 번 더 그리면 「기본 정보」 탭에서만
          카드가 둘로 보인다. */}
      <ExceptionStatusNotice exceptionStatus={effective.exceptionStatus} />
      {/* 🔴 저장은 됐는데 내자 정리의 납기요청일이 **그대로**인 경우(2026-10-30).
          사람이 닫아야 닫히는 알림이라야 한다 — 0.5초 저장 팝업으로 띄우면 읽기 전에
          사라지고, 그러면 두 화면이 다른 날짜를 보이는 채로 남는다. 서버가 돌려준
          까닭을 그대로 적는다(domain/requested-due-date-link.ts 가 그 글의 주인이다). */}
      {requestedDueDateNotLinked !== null && (
        <NoticePopup
          title="내자 정리의 납기요청일은 바뀌지 않았습니다"
          lines={[requestedDueDateNotLinked]}
          onClose={() => setRequestedDueDateNotLinked(null)}
        />
      )}
      {resolved.source === "DATABASE" && effective.billingType === "PENDING_DECISION" && (
        <PendingBillingDecisionCard
          repairCaseId={effective.id}
          expectedVersion={effective.version}
          canResolve={actingUser !== null && isFieldEditable(actingUser.role, "billingType")}
        />
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntakeInfoSection
          resolved={effective}
          editableFields={intakeFields}
          editingSection={editingSection}
          referenceData={referenceData}
          domesticOrderDueDates={domesticOrderDueDates}
          isDueDateNear={isDueDateNear}
          isDueDateInverted={isDueDateInverted}
          onRequestedDueDateNotLinked={setRequestedDueDateNotLinked}
          onStartEdit={() => setEditingSection("INTAKE")}
          onDone={handleDone}
        />
        <ProductInfoSection
          resolved={effective}
          related={related}
          relatedActionSummaries={relatedActionSummaries}
          productModelLinkId={productModelLinkId}
          editableFields={productFields}
          editingSection={editingSection}
          referenceData={referenceData}
          onStartEdit={() => setEditingSection("PRODUCT")}
          onDone={handleDone}
        />
      </div>
      {/* 인수 정보의 `고객 요청 납기일`이 이미 내자 정리에서 빌려 오는 값이라,
          내자에서 오는 두 날짜를 그 바로 아래에 두면 같은 맥락으로 읽힌다. 기술
          내용(고장 및 서비스 정보)보다 앞에 두어 상업 쪽 정보끼리 붙인다.
          위 격자 안에 세 번째 칸으로 넣지 않은 이유: 격자가 2열이라 오른쪽에 빈
          칸이 생기고, 칸 둘뿐인 이 구역이 제품 정보와 높이를 맞추느라 늘어난다.
          🔴 null 이면 아예 없다 — 내자 자료를 볼 수 없는 세션이다(위 prop 주석). */}
      {domesticOrderIssueDates && (
        <DomesticOrderDatesSection
          repairCaseId={effective.id}
          rows={domesticOrderIssueDates}
          canEdit={canWriteDomesticOrderIssueDates}
        />
      )}
      <FaultServiceSection
        resolved={effective}
        editableFields={faultServiceFields}
        editingSection={editingSection}
        derivedServiceSummary={derivedServiceSummary}
        onStartEdit={() => setEditingSection("FAULT_SERVICE")}
        onDone={handleDone}
      />
      <WorkflowProgress workflowType={effective.workflowType} currentWorkflowStepKey={effective.effectiveWorkflowStepKey} />
      {usedParts && (
        <UsedPartsSection
          repairCaseId={effective.id}
          version={effective.version}
          rows={usedParts.rows}
          hasPartRequestHistory={usedParts.hasPartRequestHistory}
          writeGate={usedParts.writeGate}
          partOptions={usedPartOptions}
          displayNames={usedPartDisplayNames}
        />
      )}
      {partRequestData && partRequestData.caseContext && (
        <PartRequestSection
          repairCaseId={partRequestData.caseContext.id}
          parts={partRequestData.parts}
          ohTemplate={partRequestData.ohTemplate}
          requests={partRequestData.requests}
          requesterGate={partRequestData.requesterGate}
        />
      )}
    </div>
  );
}
