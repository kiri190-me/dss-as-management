"use client";

import { useMemo } from "react";
import SummaryCard from "@/components/dashboard/SummaryCard";
import LoadingNotice from "@/components/domain/LoadingNotice";
import { computeDashboardSummary } from "@/lib/domain/dashboard-metrics";
import { toKstYearMonth } from "@/lib/domain/date-only";
import { mockRepairCases } from "@/lib/domain/mock-data";
import { toResolvedFromMock, type ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { useEffectiveRepairCasesFromBase } from "@/lib/domain/local/workflow/effective-repair-case";

type DashboardContentProps = {
  /**
   * Non-local base rows fetched server-side (database mode) — the exact
   * same listRepairCases() result 전체 A/S 현황(RepairCaseListPage)이 받는
   * 것과 동일한 집합이다. 두 화면이 같은 행을 세게 만드는 것이 이 prop의
   * 존재 이유이므로, 여기에 대시보드 전용으로 필터링·집계된 다른 배열을
   * 넘기면 안 된다. Undefined면 기존 Mock 동작 그대로이며, Mock과 Database
   * 행은 절대 섞이지 않는다(effective-repair-case.ts 참고).
   */
  serverBaseCases?: ResolvedRepairCase[];
};

export default function DashboardContent({ serverBaseCases }: DashboardContentProps) {
  // Only actually used when serverBaseCases is undefined (Mock mode) — kept
  // as a plain, unconditional useMemo (not a conditional hook call) so the
  // hook order below never depends on the serverBaseCases prop. 같은 이유로
  // RepairCaseListPage도 동일한 형태를 쓴다.
  const mockBaseCases = useMemo(() => mockRepairCases.map((c) => toResolvedFromMock(c)), []);
  const baseCases = serverBaseCases ?? mockBaseCases;

  const { cases, isHydrated } = useEffectiveRepairCasesFromBase(baseCases);

  const summary = useMemo(() => computeDashboardSummary(cases), [cases]);

  // 한국 기준 이번 달("YYYY-MM"). 카드는 isHydrated 이후에만 렌더되므로
  // 서버 HTML에는 이 값이 들어가지 않는다 — hydration 불일치가 생길 수 없다.
  const shipmentMonth = toKstYearMonth(new Date());

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  const cards: {
    label: string;
    value: number;
    href: string;
    tone?: "neutral" | "success" | "danger";
  }[] = [
    { label: "현재 입고 수", value: summary.currentIntakeCount, href: "/repair-cases" },
    {
      label: "인수점검 대기",
      value: summary.waitingIntakeInspection,
      href: "/repair-cases?status=WAITING_INTAKE_INSPECTION",
    },
    {
      label: "교산 회신 대기",
      value: summary.waitingKyosanReply,
      href: "/repair-cases?status=WAITING_KYOSAN_REPLY",
    },
    { label: "PO 대기", value: summary.waitingPo, href: "/repair-cases?status=WAITING_PO" },
    {
      label: "부품 수급 대기",
      value: summary.waitingPartsSupply,
      href: "/repair-cases?status=WAITING_PARTS_SUPPLY",
    },
    { label: "수리 중", value: summary.inRepair, href: "/repair-cases?status=IN_REPAIR" },
    {
      label: "출하 승인 대기",
      value: summary.waitingShipmentApproval,
      href: "/repair-cases?status=WAITING_SHIPMENT_APPROVAL",
    },
    {
      label: "출하 대기",
      value: summary.waitingShipment,
      href: "/repair-cases?status=WAITING_SHIPMENT",
    },
    {
      label: "금월 출하 완료",
      value: summary.completedThisMonth,
      href: `/repair-cases?status=SHIPMENT_COMPLETED&shipmentMonth=${shipmentMonth}`,
      tone: "success",
    },
    {
      label: "납기 지연",
      value: summary.overdueCount,
      href: "/repair-cases?overdue=1",
      tone: "danger",
    },
  ];

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <SummaryCard key={card.label} {...card} />
      ))}
    </div>
  );
}
