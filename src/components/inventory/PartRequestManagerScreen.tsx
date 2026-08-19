"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import InventoryTabs from "./InventoryTabs";
import IssuePartRequestDialog from "./IssuePartRequestDialog";
import RejectPartRequestDialog from "./RejectPartRequestDialog";
import PartiallyCloseRequestDialog from "./PartiallyCloseRequestDialog";
import HoldPartRequestDialog from "./HoldPartRequestDialog";
import { releasePartRequestHoldAction } from "@/lib/server/actions/inventory-part-requests";
import { generateClientUuid } from "@/lib/client-uuid";
import { useRouter } from "next/navigation";
import {
  isRequestHoldable,
  isRequestHoldReleasable,
} from "@/lib/auth/inventory-authorization";
import type { ManagerPartRequestRow, IssuableBalanceRow } from "@/lib/db/queries/inventory-part-requests";
import {
  INVENTORY_PART_REQUEST_STATUS_CODES,
  inventoryPartRequestStatusLabels,
  stockOwnerLabelOrUnspecified,
  type InventoryPartRequestStatus,
} from "@/lib/domain/inventory-types";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";

type DialogAction = "ISSUE" | "REJECT" | "PARTIALLY_CLOSE" | "HOLD";
type DialogState = { requestId: string; action: DialogAction } | null;

/**
 * 상태마다 색을 준다. 요청 관리는 "지금 손댈 것이 무엇인가"를 훑는 화면이라,
 * 처리 대기 중인 것과 이미 끝난 것이 한눈에 갈려야 한다.
 */
const statusBadgeClass: Record<InventoryPartRequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  PARTIALLY_ISSUED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  FULLY_ISSUED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  PARTIALLY_CLOSED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  CANCELLED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  // 보류는 "멈춰 있다"가 한눈에 보여야 한다 — 대기(주황)와 헷갈리면 처리해야
  // 할 것으로 착각한다.
  ON_HOLD: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

/**
 * 이 요청에 지금 할 수 있는 조작.
 *
 * 화면 힌트일 뿐이고 서버가 각자 다시 검사한다(inventory-part-requests.ts).
 * 카드와 표가 같은 답을 보이도록 한 곳에서 계산한다 — 두 곳에 적으면 한쪽만
 * 고쳐지는 날이 온다.
 */
function availableActions(request: ManagerPartRequestRow): DialogAction[] {
  const totalIssued = request.items.reduce((sum, i) => sum + i.issuedQuantity, 0);
  const totalRemaining = request.items.reduce(
    (sum, i) => sum + Math.max(0, i.requestedQuantity - i.issuedQuantity),
    0
  );

  const actions: DialogAction[] = [];
  // repairCaseId===null이면 접수 건이 영구 삭제된 것이다 — 서버가 NOT_FOUND로
  // 거절하므로, 반드시 실패할 버튼을 내밀지 않는다.
  if (
    request.repairCaseId !== null &&
    (request.status === "PENDING" || request.status === "PARTIALLY_ISSUED")
  ) {
    actions.push("ISSUE");
  }
  if (request.status === "PENDING" && totalIssued === 0) actions.push("REJECT");
  if (request.status === "PARTIALLY_ISSUED" && totalIssued > 0 && totalRemaining > 0) {
    actions.push("PARTIALLY_CLOSE");
  }
  // 보류는 아직 끝나지 않은 요청에만 건다. 보류 중에는 위의 조작들이 상태
  // 조건에서 이미 걸러지므로(ON_HOLD는 어느 목록에도 없다) 여기 남는 것은
  // '보류 해제'뿐이다 — 그건 별도 버튼이라 이 목록에 넣지 않는다.
  if (isRequestHoldable({ status: request.status })) actions.push("HOLD");
  return actions;
}

/**
 * 요청 일시는 짧게 — 목록에서 알아야 하는 것은 "언제쯤"이지 초 단위가 아니다.
 * 종전 toLocaleString은 "2026. 8. 18. 오후 12:00:00"(24자)이라 열 하나를
 * 통째로 잡아먹었다. 연도는 남긴다: 재고 요청은 해를 넘겨 남아 있는 것이 있어서,
 * 월·일만 보이면 작년 것과 구별되지 않는다. 정확한 값은 title로 붙인다.
 */
function formatRequestedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const actionLabels: Record<DialogAction, string> = {
  ISSUE: "불출",
  REJECT: "거절",
  PARTIALLY_CLOSE: "부분 불출 종료",
  HOLD: "보류",
};

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
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const router = useRouter();

  /**
   * 보류 해제는 사유를 받지 않으므로 다이얼로그 없이 바로 부른다 — 푸는 것은
   * "다시 진행한다"는 뜻뿐이라 적을 것이 없다.
   */
  async function releaseHold(requestId: string) {
    if (releasingId) return;
    setReleasingId(requestId);
    const result = await releasePartRequestHoldAction({
      requestId,
      idempotencyKey: generateClientUuid(),
    });
    setReleasingId(null);
    if (result.ok) router.refresh();
  }

  const balancesMap = useMemo(() => new Map(Object.entries(balancesByPartId)), [balancesByPartId]);

  const filtered = requests.filter((r) => statusFilter === "ALL" || r.status === statusFilter);
  const selectedRequest = dialog ? requests.find((r) => r.id === dialog.requestId) ?? null : null;

  function openDialog(requestId: string, action: DialogAction) {
    setDialog({ requestId, action });
  }

  return (
    <div className="flex flex-col gap-4">
      <InventoryTabs active="REQUESTS" />
      <div className="flex flex-wrap items-center gap-2">
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

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 px-3 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          해당하는 요청이 없습니다.
        </p>
      ) : (
        <ResponsiveList
          listId="part-requests"
          meta={
            <span className="mr-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {filtered.length}건
            </span>
          }
          table={
            <RequestTable
              requests={filtered}
              onAction={openDialog}
              onReleaseHold={releaseHold}
              releasingId={releasingId}
            />
          }
          cards={
            <ul className={LIST_CARD_GRID}>
              {filtered.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onAction={openDialog}
                  onReleaseHold={releaseHold}
                  releasingId={releasingId}
                />
              ))}
            </ul>
          }
        />
      )}

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
      {selectedRequest && dialog?.action === "HOLD" && (
        <HoldPartRequestDialog isOpen onClose={() => setDialog(null)} requestId={selectedRequest.id} intakeNumber={selectedRequest.intakeNumber} />
      )}
      {selectedRequest && dialog?.action === "PARTIALLY_CLOSE" && (
        <PartiallyCloseRequestDialog isOpen onClose={() => setDialog(null)} requestId={selectedRequest.id} intakeNumber={selectedRequest.intakeNumber} />
      )}
    </div>
  );
}

/**
 * 모델과 S/N을 각각 한 줄에 둔다.
 *
 * 전에는 "모델 / S/N"을 한 줄에 이어 붙였는데, 둘 다 길어서 폭이 좁아지면
 * 아무 데서나 접혔다 — 접힌 자리가 모델 중간인지 S/N 시작인지 알 수 없어서
 * 오히려 두 줄이 된 쪽이 읽기 나빴다. 라벨을 붙여 각자 한 줄을 주면 접힘이
 * 생기더라도 어느 값의 연속인지가 분명하다.
 */
function ModelSerial({ modelName, serialNumber }: { modelName: string; serialNumber: string }) {
  return (
    <dl className="flex flex-col gap-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      <div className="flex gap-1.5">
        <dt className="w-7 shrink-0">모델</dt>
        <dd className="break-all text-zinc-600 dark:text-zinc-300">{modelName}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="w-7 shrink-0">S/N</dt>
        <dd className="break-all text-zinc-600 dark:text-zinc-300">{serialNumber}</dd>
      </div>
    </dl>
  );
}

/**
 * 보류 사유. 관리자 화면에도 보여 준다 — 다른 사람이 보류해 둔 것을 보고
 * "왜 멈춰 있는지" 이력을 뒤지게 하지 않기 위해서다.
 */
function HoldReason({ hold }: { hold: ManagerPartRequestRow["hold"] }) {
  if (!hold) return null;
  return (
    <div className="rounded-md bg-violet-50 px-2 py-1.5 text-[11px] dark:bg-violet-950/40">
      <p className="text-violet-900 dark:text-violet-200">{hold.reason}</p>
      <p className="mt-0.5 text-violet-700/70 dark:text-violet-300/70">
        {hold.heldByName} · {formatRequestedAt(hold.heldAt)}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: InventoryPartRequestStatus }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass[status]}`}
    >
      {inventoryPartRequestStatusLabels[status]}
    </span>
  );
}

/**
 * 요청 항목 — 이 화면에서 실제로 판단 근거가 되는 자료다.
 *
 * 전에는 항목마다 "요청 3 / 불출 0 / 가용 12"를 라벨과 함께 인라인으로 늘어놓아
 * 항목이 둘 이상이면 같은 숫자끼리 세로로 맞지 않았다. 머리글을 한 번만 두고
 * 숫자를 열에 세우면, 항목이 몇 개든 "남은 게 있는 줄"을 세로로 훑을 수 있다.
 *
 * 남음은 요청−불출이라 화면에서 계산한다. 사람이 뺄셈하게 두면 그 자리가 실수가
 * 나는 자리다.
 */
function RequestItems({ items }: { items: ManagerPartRequestRow["items"] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] text-zinc-400 dark:text-zinc-500">
          <th scope="col" className="pb-1 text-left font-normal">품목</th>
          <th scope="col" className="w-9 pb-1 text-right font-normal">요청</th>
          <th scope="col" className="w-9 pb-1 text-right font-normal">불출</th>
          <th scope="col" className="w-9 pb-1 text-right font-normal">남음</th>
          <th scope="col" className="w-9 pb-1 text-right font-normal">가용</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const remaining = Math.max(0, item.requestedQuantity - item.issuedQuantity);
          // 가용이 남은 수량보다 적으면 지금 다 내보낼 수 없다 — 다이얼로그를
          // 열기 전에 보여야 헛걸음을 막는다.
          const short = remaining > 0 && item.totalAvailableQuantity < remaining;
          return (
            <tr key={item.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="py-1 pr-2">
                <span className="text-zinc-800 dark:text-zinc-100">{item.partName}</span>
                <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                  {stockOwnerLabelOrUnspecified(item.owner)}
                  {item.note ? ` · ${item.note}` : ""}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                {item.requestedQuantity}
              </td>
              <td
                className={`py-1 text-right tabular-nums ${
                  item.issuedQuantity > 0
                    ? "text-zinc-700 dark:text-zinc-200"
                    : "text-zinc-300 dark:text-zinc-600"
                }`}
              >
                {item.issuedQuantity}
              </td>
              <td
                className={`py-1 text-right tabular-nums ${
                  remaining > 0
                    ? "font-medium text-amber-700 dark:text-amber-400"
                    : "text-zinc-300 dark:text-zinc-600"
                }`}
              >
                {remaining}
              </td>
              <td
                className={`py-1 text-right tabular-nums ${
                  short ? "font-medium text-red-700 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {item.totalAvailableQuantity}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ActionButtons({
  request,
  onAction,
  onReleaseHold,
  releasing,
  size,
}: {
  request: ManagerPartRequestRow;
  onAction: (requestId: string, action: DialogAction) => void;
  onReleaseHold: (requestId: string) => void;
  releasing: boolean;
  size: "card" | "table";
}) {
  const actions = availableActions(request);

  // 보류 중이면 할 수 있는 것은 해제뿐이다.
  if (isRequestHoldReleasable({ status: request.status })) {
    return (
      <button
        type="button"
        disabled={releasing}
        onClick={() => onReleaseHold(request.id)}
        className="rounded-md border border-violet-300 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
      >
        {releasing ? "처리 중..." : "보류 해제"}
      </button>
    );
  }

  if (actions.length === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">처리할 것 없음</span>;
  }
  const base = size === "card" ? "px-2.5 py-1 text-xs" : "px-2 py-1 text-xs";
  return (
    <div className={size === "card" ? "flex flex-wrap gap-1.5" : "flex flex-col gap-1"}>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onAction(request.id, action)}
          className={`rounded-md ${base} ${
            action === "ISSUE"
              ? "bg-zinc-900 font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              : action === "REJECT"
                ? "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                : action === "HOLD"
                  ? "border border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {actionLabels[action]}
        </button>
      ))}
    </div>
  );
}

function RequestCard({
  request,
  onAction,
  onReleaseHold,
  releasingId,
}: {
  request: ManagerPartRequestRow;
  onAction: (requestId: string, action: DialogAction) => void;
  onReleaseHold: (requestId: string) => void;
  releasingId: string | null;
}) {
  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 bg-white focus-within:ring-2 focus-within:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          {request.repairCaseId !== null ? (
            <Link
              href={`/repair-cases/${request.repairCaseId}`}
              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              {request.intakeNumber}
            </Link>
          ) : (
            <span className="font-medium text-zinc-500 dark:text-zinc-400">
              {request.intakeNumber}
              <span className="ml-1 text-[11px]">(삭제된 접수 건)</span>
            </span>
          )}
          <StatusBadge status={request.status} />
        </div>

        <ModelSerial modelName={request.modelName} serialNumber={request.serialNumber} />
        {/* 고객·요청자·일시는 판단 근거가 아니라 식별 정보다. 한 줄로 접어
            자리를 아끼고, 잘린 값은 마우스를 올리면 보인다. */}
        <p
          title={`${request.requestedByName} · ${new Date(request.createdAt).toLocaleString("ko-KR")}`}
          className="truncate text-[11px] text-zinc-500 dark:text-zinc-400"
        >
          {request.requestedByName} · {formatRequestedAt(request.createdAt)}
        </p>
      </div>

      {request.hold && (
        <div className="px-3 pb-2">
          <HoldReason hold={request.hold} />
        </div>
      )}

      <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <RequestItems items={request.items} />
      </div>

      <div className="mt-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
        <ActionButtons request={request} onAction={onAction} onReleaseHold={onReleaseHold} releasing={releasingId === request.id} size="card" />
      </div>
    </li>
  );
}

/** 요청이 많을 때 훑는 용도. 종전 표를 그대로 두되 상태에 색을 준다. */
function RequestTable({
  requests,
  onAction,
  onReleaseHold,
  releasingId,
}: {
  requests: ManagerPartRequestRow[];
  onAction: (requestId: string, action: DialogAction) => void;
  onReleaseHold: (requestId: string) => void;
  releasingId: string | null;
}) {
  return (
      <table className="w-full min-w-[64rem] text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th scope="col" className="px-3 py-2">요청 일시</th>
            <th scope="col" className="px-3 py-2">인수번호</th>
            <th scope="col" className="px-3 py-2">모델 / S/N</th>
            <th scope="col" className="px-3 py-2">요청 엔지니어</th>
            <th scope="col" className="px-3 py-2">요청 항목</th>
            <th scope="col" className="px-3 py-2">상태</th>
            <th scope="col" className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
              <td
                title={new Date(request.createdAt).toLocaleString("ko-KR")}
                className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-zinc-600 dark:text-zinc-300"
              >
                {formatRequestedAt(request.createdAt)}
              </td>
              <td className="px-3 py-2">
                {request.repairCaseId !== null ? (
                  <Link href={`/repair-cases/${request.repairCaseId}`} className="text-blue-700 hover:underline dark:text-blue-400">
                    {request.intakeNumber}
                  </Link>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">{request.intakeNumber}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <ModelSerial modelName={request.modelName} serialNumber={request.serialNumber} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{request.requestedByName}</td>
              {/* 이 열이 판단 근거다 — 폭을 넉넉히 준다. */}
              <td className="w-[22rem] px-3 py-2">
                <RequestItems items={request.items} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <StatusBadge status={request.status} />
                  {request.hold && (
                    <div className="max-w-[16rem]">
                      <HoldReason hold={request.hold} />
                    </div>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                <ActionButtons request={request} onAction={onAction} onReleaseHold={onReleaseHold} releasing={releasingId === request.id} size="table" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
  );
}
