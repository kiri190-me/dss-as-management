"use client";

import Link from "next/link";
import type { RepairCaseRow } from "@/lib/domain/repair-case-rows";
import type { SortColumn, SortState } from "@/lib/domain/repair-case-filters";
import { OverdueBadge, PriorityBadge, StatusBadge } from "./badges";

type RepairCaseTableProps = {
  rows: RepairCaseRow[];
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
};

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

function SortableHeader({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
}) {
  const isActive = sort.column === column;
  const ariaSort = isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const indicator = isActive ? (sort.direction === "asc" ? "▲" : "▼") : "";

  return (
    <th scope="col" className={thBaseClass} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSortChange(column)}
        className="flex items-center gap-1 whitespace-nowrap hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        {label}
        <span className="text-[10px]">{indicator}</span>
      </button>
    </th>
  );
}

export default function RepairCaseTable({ rows, sort, onSortChange }: RepairCaseTableProps) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 md:block dark:border-zinc-800">
      <table className="w-full min-w-[1600px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th
              scope="col"
              className={`${thBaseClass} sticky top-0 left-0 z-20`}
            >
              <button
                type="button"
                onClick={() => onSortChange("intakeNumber")}
                className="flex items-center gap-1 whitespace-nowrap hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                인수번호
                <span className="text-[10px]">
                  {sort.column === "intakeNumber" ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                </span>
              </button>
            </th>
            <SortableHeader column="receivedAt" label="인수일" sort={sort} onSortChange={onSortChange} />
            <th scope="col" className={thBaseClass}>제품 구분</th>
            <th scope="col" className={thBaseClass}>유상/무상</th>
            <th scope="col" className={thBaseClass}>Model</th>
            <th scope="col" className={thBaseClass}>L/N</th>
            <th scope="col" className={thBaseClass}>S/N</th>
            <SortableHeader column="customerName" label="고객사" sort={sort} onSortChange={onSortChange} />
            <th scope="col" className={thBaseClass}>End-User</th>
            <SortableHeader column="status" label="현재 상태" sort={sort} onSortChange={onSortChange} />
            <SortableHeader column="priority" label="우선순위" sort={sort} onSortChange={onSortChange} />
            <th scope="col" className={thBaseClass}>담당 엔지니어</th>
            <SortableHeader
              column="customerRequestedDueDate"
              label="고객 요청 납기일"
              sort={sort}
              onSortChange={onSortChange}
            />
            <th scope="col" className={thBaseClass}>사내 목표 출하일</th>
            <th scope="col" className={thBaseClass}>납기 지연 여부</th>
            <th scope="col" className={thBaseClass}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium whitespace-nowrap dark:bg-zinc-900">
                <Link
                  href={`/repair-cases/${row.id}`}
                  className="text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                >
                  {row.intakeNumber}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{row.receivedAt}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.productCategory}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.paidOrWarranty}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.modelName}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.lotNumber}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.serialNumber}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.customerName}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.endUserName ?? "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <PriorityBadge priority={row.priority} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{row.engineerName ?? "미배정"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.customerRequestedDueDate ?? "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.internalTargetShipmentDate ?? "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <OverdueBadge isOverdue={row.isOverdue} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link
                  href={`/repair-cases/${row.id}`}
                  className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  상세
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
