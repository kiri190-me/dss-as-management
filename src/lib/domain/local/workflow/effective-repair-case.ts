"use client";

import { useMemo } from "react";
import { DEMO_REFERENCE_DATE } from "../../demo-clock";
import { isRepairCaseOverdue, type RepairStatus } from "../../types";
import { resolveAllRepairCases, type ResolvedRepairCase } from "../resolved-repair-case";
import { useLocalRepairCases } from "../use-local-repair-cases";
import { useWorkflowStore } from "./use-workflow-data";
import type { HoldState, LocalWorkflowState } from "./workflow-types";

/**
 * 기존 resolved-repair-case.ts(toResolvedFromMock/toResolvedFromLocal)는
 * 서버 컴포넌트에서도 쓰이는 순수 함수로 남아 있어야 하므로 여기서 워크플로
 * localStorage를 읽지 않는다 — 이 파일이 "원본 정규화(ResolvedRepairCase)"와
 * "워크플로 재정의 적용" 두 단계를 분리하는 유일한 지점이다. 어떤 UI 컴포넌트도
 * override를 직접 병합하지 않는다 — 전부 이 어댑터/훅을 통해서만 얻는다.
 */
export type EffectiveRepairCase = ResolvedRepairCase & {
  effectiveStatus: RepairStatus;
  effectiveWorkflowStepKey: string;
  effectiveActualShipmentDate: string | null;
  effectiveIsOverdue: boolean;
  holdState: HoldState | null;
  hasWorkflowOverride: boolean;
};

export function applyWorkflowOverride(
  resolved: ResolvedRepairCase,
  override: LocalWorkflowState | undefined,
  referenceDate: Date = DEMO_REFERENCE_DATE
): EffectiveRepairCase {
  if (!override) {
    return {
      ...resolved,
      effectiveStatus: resolved.status,
      effectiveWorkflowStepKey: resolved.currentWorkflowStepKey,
      effectiveActualShipmentDate: resolved.actualShipmentDate,
      effectiveIsOverdue: resolved.isOverdue,
      holdState: null,
      hasWorkflowOverride: false,
    };
  }

  const effectiveStatus = override.currentStatus;
  const effectiveIsOverdue = isRepairCaseOverdue(
    { status: effectiveStatus, internalTargetShipmentDate: resolved.internalTargetShipmentDate },
    referenceDate
  );

  return {
    ...resolved,
    effectiveStatus,
    effectiveWorkflowStepKey: override.currentWorkflowStepKey,
    effectiveActualShipmentDate: override.shipmentCompletedAt?.slice(0, 10) ?? resolved.actualShipmentDate,
    effectiveIsOverdue,
    holdState: override.holdState,
    hasWorkflowOverride: true,
  };
}

function findOverride(states: readonly LocalWorkflowState[], repairCaseId: string): LocalWorkflowState | undefined {
  return states.find((s) => s.repairCaseId === repairCaseId);
}

/** 상세/검수·승인/파일 관리처럼 이미 확보한 단일 ResolvedRepairCase에 재정의를 입힌다. */
export function useEffectiveRepairCase(resolved: ResolvedRepairCase | null): {
  effective: EffectiveRepairCase | null;
  isHydrated: boolean;
  isMalformed: boolean;
} {
  const workflowStore = useWorkflowStore();

  const effective = useMemo(() => {
    if (!resolved) return null;
    const override = findOverride(workflowStore.states, resolved.id);
    return applyWorkflowOverride(resolved, override);
  }, [resolved, workflowStore.states]);

  return { effective, isHydrated: workflowStore.isHydrated, isMalformed: workflowStore.isMalformed };
}

/** 대시보드/전체 현황처럼 mock+local 전체 목록이 필요한 화면에서 쓰는 단일 진입점이다. */
export function useEffectiveRepairCases(): {
  cases: EffectiveRepairCase[];
  isHydrated: boolean;
  isMalformed: boolean;
} {
  const { cases: localCases, isHydrated: localHydrated } = useLocalRepairCases();
  const workflowStore = useWorkflowStore();

  const cases = useMemo(() => {
    const resolved = resolveAllRepairCases(localCases);
    return resolved.map((r) => applyWorkflowOverride(r, findOverride(workflowStore.states, r.id)));
  }, [localCases, workflowStore.states]);

  return {
    cases,
    isHydrated: localHydrated && workflowStore.isHydrated,
    isMalformed: workflowStore.isMalformed,
  };
}
