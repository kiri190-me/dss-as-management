"use client";

import { useState } from "react";
import type { OhTemplateRow } from "@/lib/db/queries/oh-part-templates";
import LoadingNotice from "@/components/domain/LoadingNotice";
import DetailHeader from "@/components/repair-cases/detail/DetailHeader";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import IntakeInfoSection from "@/components/repair-cases/detail/IntakeInfoSection";
import ProductInfoSection from "@/components/repair-cases/detail/ProductInfoSection";
import FaultServiceSection from "@/components/repair-cases/detail/FaultServiceSection";
import WorkflowProgress from "@/components/repair-cases/detail/WorkflowProgress";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { editableFieldsForRoleInSection, isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import PartRequestSection from "@/components/inventory/PartRequestSection";
import type { PartListRow } from "@/lib/db/queries/inventory";
import type { OwnPartRequestRow, RequestCaseContext } from "@/lib/db/queries/inventory-part-requests";
import type { StockOwner } from "@/lib/domain/inventory-types";
import type { DerivedServiceSummary } from "@/lib/db/queries/repair-case-work-records";
import PendingBillingDecisionCard from "@/components/repair-cases/detail/PendingBillingDecisionCard";

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
  actingUser,
  referenceData,
  partRequestData,
  derivedServiceSummary,
  domesticOrderDueDates,
}: {
  resolved: ResolvedRepairCase;
  related: RelatedMatch[];
  actingUser: ActingUser | null;
  referenceData: IntakeReferenceData | null;
  /** Phase 5B-3 — only populated for an AS_ENGINEER viewing a DATABASE-backed case, see [id]/page.tsx. */
  partRequestData: {
    caseContext: RequestCaseContext | null;
    availableParts: PartListRow[];
    /** 이 장비 모델에 이어진 O/H 부품 템플릿. 없으면 null 이다. */
    ohTemplate: OhTemplateRow | null;
    ownerAvailabilityByPartId: Record<string, Partial<Record<StockOwner, number>>>;
    ownRequests: OwnPartRequestRow[];
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
}) {
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);
  const [editingSection, setEditingSection] = useState<RepairCaseEditSection | null>(null);

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
  const canEditEngineer = canEditAtAll && actingUser !== null && isFieldEditable(actingUser.role, "assignedEngineerId");
  // 보고서번호도 담당 엔지니어와 같은 방식이다 — 상단 카드가 유일한 편집
  // 지점이고, 권한 판단은 인수 정보 섹션과 같은 필드 매트릭스를 그대로 쓴다.
  const canEditReportNumber =
    canEditAtAll && actingUser !== null && isFieldEditable(actingUser.role, "legacyReportNumber");

  function handleDone() {
    setEditingSection(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader
        resolved={effective}
        canEditEngineer={canEditEngineer}
        canEditReportNumber={canEditReportNumber}
        referenceData={referenceData}
      />
      <ExceptionStatusNotice exceptionStatus={effective.exceptionStatus} />
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
          onStartEdit={() => setEditingSection("INTAKE")}
          onDone={handleDone}
        />
        <ProductInfoSection
          resolved={effective}
          related={related}
          editableFields={productFields}
          editingSection={editingSection}
          referenceData={referenceData}
          onStartEdit={() => setEditingSection("PRODUCT")}
          onDone={handleDone}
        />
      </div>
      <FaultServiceSection
        resolved={effective}
        editableFields={faultServiceFields}
        editingSection={editingSection}
        derivedServiceSummary={derivedServiceSummary}
        onStartEdit={() => setEditingSection("FAULT_SERVICE")}
        onDone={handleDone}
      />
      <WorkflowProgress workflowType={effective.workflowType} currentWorkflowStepKey={effective.effectiveWorkflowStepKey} />
      {partRequestData && partRequestData.caseContext && (
        <PartRequestSection
          repairCaseId={partRequestData.caseContext.id}
          availableParts={partRequestData.availableParts}
          ohTemplate={partRequestData.ohTemplate}
          ownerAvailabilityByPartId={partRequestData.ownerAvailabilityByPartId}
          ownRequests={partRequestData.ownRequests}
        />
      )}
    </div>
  );
}
