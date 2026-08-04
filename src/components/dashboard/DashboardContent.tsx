"use client";

import { useMemo } from "react";
import SummaryCard from "@/components/dashboard/SummaryCard";
import LoadingNotice from "@/components/domain/LoadingNotice";
import { computeDashboardSummary } from "@/lib/domain/dashboard-metrics";
import { DEMO_REFERENCE_DATE, formatYearMonth } from "@/lib/domain/demo-clock";
import { useEffectiveRepairCases } from "@/lib/domain/local/workflow/effective-repair-case";

export default function DashboardContent() {
  const { cases, isHydrated } = useEffectiveRepairCases();

  const summary = useMemo(() => computeDashboardSummary(cases, DEMO_REFERENCE_DATE), [cases]);

  const shipmentMonth = formatYearMonth(DEMO_REFERENCE_DATE);

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
