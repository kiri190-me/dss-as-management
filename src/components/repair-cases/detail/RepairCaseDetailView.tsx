"use client";

import { useState } from "react";
import LoadingNotice from "@/components/domain/LoadingNotice";
import DetailHeader from "@/components/repair-cases/detail/DetailHeader";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import IntakeInfoSection from "@/components/repair-cases/detail/IntakeInfoSection";
import ProductInfoSection from "@/components/repair-cases/detail/ProductInfoSection";
import FaultServiceSection from "@/components/repair-cases/detail/FaultServiceSection";
import WorkflowProgress from "@/components/repair-cases/detail/WorkflowProgress";
import WorkflowControlPanel from "@/components/repair-cases/workflow/WorkflowControlPanel";
import DatabaseWorkflowControlPanel from "@/components/repair-cases/workflow/DatabaseWorkflowControlPanel";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import type { CurrentHoldState, WorkflowHistoryEntry } from "@/lib/db/queries/workflow-history";
import type { CurrentApprovalState } from "@/lib/db/queries/repair-case-approvals";
import { editableFieldsForRoleInSection } from "@/lib/auth/repair-case-edit-authorization";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";

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
 */
export default function RepairCaseDetailView({
  resolved,
  related,
  actingUser,
  referenceData,
  workflowHistory,
  workflowHoldState,
  currentApprovals,
}: {
  resolved: ResolvedRepairCase;
  related: RelatedMatch[];
  actingUser: ActingUser | null;
  referenceData: IntakeReferenceData | null;
  /** Only populated (non-null) for a DATABASE-sourced row — see [id]/page.tsx. */
  workflowHistory: WorkflowHistoryEntry[] | null;
  workflowHoldState: CurrentHoldState | null;
  currentApprovals: CurrentApprovalState[] | null;
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

  function handleDone() {
    setEditingSection(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader resolved={effective} />
      <ExceptionStatusNotice exceptionStatus={effective.exceptionStatus} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntakeInfoSection
          resolved={effective}
          editableFields={intakeFields}
          editingSection={editingSection}
          referenceData={referenceData}
          onStartEdit={() => setEditingSection("INTAKE")}
          onDone={handleDone}
        />
        <ProductInfoSection
          resolved={effective}
          related={related}
          editableFields={productFields}
          editingSection={editingSection}
          onStartEdit={() => setEditingSection("PRODUCT")}
          onDone={handleDone}
        />
      </div>
      <FaultServiceSection
        resolved={effective}
        editableFields={faultServiceFields}
        editingSection={editingSection}
        referenceData={referenceData}
        onStartEdit={() => setEditingSection("FAULT_SERVICE")}
        onDone={handleDone}
      />
      <WorkflowProgress workflowType={effective.workflowType} currentWorkflowStepKey={effective.effectiveWorkflowStepKey} />
      {resolved.source === "DATABASE" && workflowHistory && workflowHoldState && currentApprovals ? (
        <DatabaseWorkflowControlPanel
          resolved={resolved}
          actingUser={actingUser}
          history={workflowHistory}
          holdState={workflowHoldState}
          currentApprovals={currentApprovals}
        />
      ) : (
        <WorkflowControlPanel effective={effective} actingUser={actingUser} />
      )}
    </div>
  );
}
