"use client";

import { useMemo } from "react";
import { DEMO_REFERENCE_DATE } from "../../demo-clock";
import { mockRepairCases } from "../../mock-data";
import { isRepairCaseOverdue, type RepairStatus } from "../../types";
import { toResolvedFromLocal, toResolvedFromMock, type ResolvedRepairCase } from "../resolved-repair-case";
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

/**
 * Stage G-2: the single reusable primitive every list-style screen must go
 * through. Takes an explicit, already-resolved "base" case array — the
 * non-local rows, either Mock (existing behavior) or Database (Stage G-2
 * list integration) — and layers in browser-local cases + workflow
 * overrides exactly once. `baseCases` must never itself already contain a
 * mix of Mock and Database rows; callers choose exactly one source.
 */
export function useEffectiveRepairCasesFromBase(baseCases: ResolvedRepairCase[]): {
  cases: EffectiveRepairCase[];
  isHydrated: boolean;
  isMalformed: boolean;
} {
  const { cases: localCases, isHydrated: localHydrated } = useLocalRepairCases();
  const workflowStore = useWorkflowStore();

  const cases = useMemo(() => {
    const resolvedLocal = localCases.map((c) => toResolvedFromLocal(c));
    const allResolved = [...baseCases, ...resolvedLocal];
    return allResolved.map((r) => applyWorkflowOverride(r, findOverride(workflowStore.states, r.id)));
  }, [baseCases, localCases, workflowStore.states]);

  return {
    cases,
    isHydrated: localHydrated && workflowStore.isHydrated,
    isMalformed: workflowStore.isMalformed,
  };
}

/**
 * 대시보드/전체 현황(Mock 모드)처럼 mock+local 전체 목록이 필요한 화면에서 쓰는
 * 기존 공개 진입점이다. Stage G-2 이후에도 동작은 완전히 동일하다 — 내부적으로
 * mock base case 배열을 한 번 계산해 useEffectiveRepairCasesFromBase에
 * 위임할 뿐, override 알고리즘을 별도로 복제하지 않는다.
 */
export function useEffectiveRepairCases(): {
  cases: EffectiveRepairCase[];
  isHydrated: boolean;
  isMalformed: boolean;
} {
  const mockBaseCases = useMemo(() => mockRepairCases.map((c) => toResolvedFromMock(c)), []);
  return useEffectiveRepairCasesFromBase(mockBaseCases);
}
