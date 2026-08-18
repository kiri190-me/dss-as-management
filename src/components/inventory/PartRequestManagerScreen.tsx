"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import InventoryTabs from "./InventoryTabs";
import IssuePartRequestDialog from "./IssuePartRequestDialog";
import RejectPartRequestDialog from "./RejectPartRequestDialog";
import PartiallyCloseRequestDialog from "./PartiallyCloseRequestDialog";
import type { ManagerPartRequestRow, IssuableBalanceRow } from "@/lib/db/queries/inventory-part-requests";
import { INVENTORY_PART_REQUEST_STATUS_CODES, inventoryPartRequestStatusLabels, stockOwnerLabelOrUnspecified, type InventoryPartRequestStatus } from "@/lib/domain/inventory-types";

type DialogState = { requestId: string; action: "ISSUE" | "REJECT" | "PARTIALLY_CLOSE" } | null;

/** 부품 요청 관리 — SUPER_ADMIN/ADMIN/INVENTORY_MANAGER only (server-gated in page.tsx; SALES and AS_ENGINEER never reach this screen). */
export default function PartRequestManagerScreen({
  requests,
  balancesByPartId,
}: {
  requests: ManagerPartRequestRow[];
  balancesByPartId: Record<string, IssuableBalanceRow[]>;
}) {
  const [statusFilter, setStatusFilter] = useState<InventoryPartRequestStatus | "ALL">("ALL");
  const [dialog, setDialog] = useState<DialogState>(null);

  const balancesMap = useMemo(() => new Map(Object.entries(balancesByPartId)), [balancesByPartId]);

  const filtered = requests.filter((r) => statusFilter === "ALL" || r.status === statusFilter);
  const selectedRequest = dialog ? requests.find((r) => r.id === dialog.requestId) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <InventoryTabs active="REQUESTS" />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">부품 요청 관리</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as InventoryPartRequestStatus | "ALL")}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="ALL">전체 상태</option>
          {INVENTORY_PART_REQUEST_STATUS_CODES.map((status) => (
            <option key={status} value={status}>
              {inventoryPartRequestStatusLabels[status]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">요청 일시</th>
              <th className="px-3 py-2">인수번호</th>
              <th className="px-3 py-2">고객</th>
              <th className="px-3 py-2">모델 / S/N</th>
              <th className="px-3 py-2">요청 엔지니어</th>
              <th className="px-3 py-2">요청 항목</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  해당하는 요청이 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((request) => {
                const totalIssued = request.items.reduce((sum, i) => sum + i.issuedQuantity, 0);
                const totalRemaining = request.items.reduce((sum, i) => sum + Math.max(0, i.requestedQuantity - i.issuedQuantity), 0);
                // Shipment-lock removal policy: status-only now — see
                // canIssuePartRequest (inventory-authorization.ts), which
                // the server independently enforces regardless of this UI hint.
                // repairCaseId===null means the case has been permanently
                // purged (repair-case permanent-delete schema foundation
                // checkpoint) — issuePartRequest rejects that server-side
                // (NOT_FOUND, nothing left to issue against), so the button
                // is hidden here rather than offering an action guaranteed
                // to fail.
                const canIssue =
                  request.repairCaseId !== null &&
                  (request.status === "PENDING" || request.status === "PARTIALLY_ISSUED");
                const canReject = request.status === "PENDING" && totalIssued === 0;
                const canPartiallyClose = request.status === "PARTIALLY_ISSUED" && totalIssued > 0 && totalRemaining > 0;
                return (
                  <tr key={request.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{new Date(request.createdAt).toLocaleString("ko-KR")}</td>
                    <td className="px-3 py-2">
                      {request.repairCaseId !== null ? (
                        <Link href={`/repair-cases/${request.repairCaseId}`} className="text-blue-700 hover:underline dark:text-blue-400">
                          {request.intakeNumber}
                        </Link>
                      ) : (
                        <span className="text-zinc-500 dark:text-zinc-400">{request.intakeNumber}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{request.customerName}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                      {request.modelName} / {request.serialNumber}
                    </td>
                    <td className="px-3 py-2">{request.requestedByName}</td>
                    <td className="px-3 py-2 text-xs">
                      <ul className="flex flex-col gap-0.5">
                        {request.items.map((item) => (
                          <li key={item.id}>
                            {item.partName} ({stockOwnerLabelOrUnspecified(item.owner)}) — 요청 {item.requestedQuantity} / 불출 {item.issuedQuantity} (가용 {item.totalAvailableQuantity})
                            <span className="block text-zinc-500 dark:text-zinc-400">항목 메모: {item.note ?? "-"}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium">{inventoryPartRequestStatusLabels[request.status]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {canIssue && (
                          <button
                            type="button"
                            onClick={() => setDialog({ requestId: request.id, action: "ISSUE" })}
                            className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                          >
                            불출
                          </button>
                        )}
                        {canReject && (
                          <button
                            type="button"
                            onClick={() => setDialog({ requestId: request.id, action: "REJECT" })}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            거절
                          </button>
                        )}
                        {canPartiallyClose && (
                          <button
                            type="button"
                            onClick={() => setDialog({ requestId: request.id, action: "PARTIALLY_CLOSE" })}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            부분 불출 종료
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedRequest && dialog?.action === "ISSUE" && (
        <IssuePartRequestDialog
          isOpen
          onClose={() => setDialog(null)}
          request={selectedRequest}
          balancesByPartId={balancesMap}
        />
      )}
      {selectedRequest && dialog?.action === "REJECT" && (
        <RejectPartRequestDialog isOpen onClose={() => setDialog(null)} requestId={selectedRequest.id} intakeNumber={selectedRequest.intakeNumber} />
      )}
      {selectedRequest && dialog?.action === "PARTIALLY_CLOSE" && (
        <PartiallyCloseRequestDialog isOpen onClose={() => setDialog(null)} requestId={selectedRequest.id} intakeNumber={selectedRequest.intakeNumber} />
      )}
    </div>
  );
}
