import type { Metadata } from "next";
import SummaryCard from "@/components/dashboard/SummaryCard";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import { computeDashboardSummary } from "@/lib/domain/dashboard-metrics";
import { DEMO_REFERENCE_DATE, formatYearMonth } from "@/lib/domain/demo-clock";
import { mockRepairCases } from "@/lib/domain/mock-data";

export const metadata: Metadata = {
  title: "대시보드 | DSS A/S 관리 시스템",
};

export default function DashboardPage() {
  const summary = computeDashboardSummary(mockRepairCases, DEMO_REFERENCE_DATE);
  const shipmentMonth = formatYearMonth(DEMO_REFERENCE_DATE);

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
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          대시보드
        </h1>
        <DemoReferenceNotice />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <SummaryCard key={card.label} {...card} />
        ))}
      </div>
    </div>
  );
}
