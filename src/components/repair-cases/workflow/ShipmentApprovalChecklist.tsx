import Link from "next/link";

import {
  buildShipmentApprovalChecklist,
  isShipmentApprovalChecklistComplete,
  type ShipmentApprovalChecklistItem,
  type ShipmentApprovalState,
} from "@/lib/domain/local/workflow/shipment-approval-checklist";

const STATE_LABEL: Record<ShipmentApprovalState, string> = {
  NOT_REQUESTED: "미요청",
  PENDING: "결재 대기",
  APPROVED: "승인됨",
  REJECTED: "반려됨",
  STALE: "재승인 필요",
};

const STATE_BADGE: Record<ShipmentApprovalState, string> = {
  NOT_REQUESTED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  PENDING: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  APPROVED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  STALE: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

/**
 * "출하까지 남은 결재" — 출하 완료를 할 수 있는 단계에 서 있을 때만 보인다.
 *
 * ── 왜 이 줄이 생겼나 ───────────────────────────────────────────────────
 * 출하 완료 버튼은 막힌 이유를 이미 말하고 있었다("최종 출하 승인이 완료되어야
 * 합니다"). 그런데 그 말만으로는 두 가지를 알 수 없다: **어디서** 받는지,
 * 그리고 그 앞에 **수리 검수 승인**이 먼저 필요하다는 것. 그래서 안내대로
 * 승인 화면에 가서 출하 승인을 요청하면 거기서 두 번째로 막혔다. 실제로 그
 * 자리에 9건이 쌓여 있었다.
 *
 * ── 왜 마지막 단계에서만 보이나 ─────────────────────────────────────────
 * 승인은 요청 당시의 version에 묶이고 그 version은 **단계를 진행할 때도**
 * 올라간다. 미리 받아 두면 오히려 무효가 된다. 그러니 "출하 완료를 할 수 있는
 * 단계"에 도착했을 때 보여 주는 것이 맞고, 그때가 결재를 받을 때다.
 *
 * 순수 표시 컴포넌트다 — 상태 계산은 도메인 함수가 하고, 실제 판정은 서버가
 * 다시 한다.
 */
export default function ShipmentApprovalChecklist({
  repairCaseId,
  approvals,
  currentVersion,
}: {
  repairCaseId: string;
  approvals: { approvalType: string; latest: { status: string; repairCaseVersionAtRequest: number } | null }[];
  currentVersion: number;
}) {
  const items = buildShipmentApprovalChecklist({ approvals, currentVersion });
  const isComplete = isShipmentApprovalChecklistComplete(items);

  return (
    <section
      className={`flex flex-col gap-2 rounded-md border p-3 ${
        isComplete
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40"
          : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">출하까지 남은 결재</h3>
        <Link
          href={`/repair-cases/${repairCaseId}/approval`}
          className="ml-auto text-xs font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
        >
          승인 화면에서 처리 →
        </Link>
      </div>

      <ol className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <ChecklistRow key={item.approvalType} item={item} order={index + 1} />
        ))}
      </ol>

      {isComplete ? (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          두 결재가 모두 완료됐습니다. 아래에서 출하 완료 처리를 할 수 있습니다.
        </p>
      ) : (
        <p className="text-xs text-amber-900 dark:text-amber-200">
          워크플로 단계의 <strong className="font-semibold">&ldquo;출하 승인됨&rdquo;</strong>은 교산 쪽 출하 승인을
          받았다는 기록이고, 출하 완료에 필요한 것은 <strong className="font-semibold">위 결재</strong>입니다. 순서대로
          받아야 하며, <strong className="font-semibold">결재 사이에 단계를 진행하거나 접수 정보를 수정하면</strong>{" "}
          앞 결재가 무효가 되어 다시 받아야 합니다.
        </p>
      )}
    </section>
  );
}

function ChecklistRow({ item, order }: { item: ShipmentApprovalChecklistItem; order: number }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{order}</span>
      <span className="text-zinc-800 dark:text-zinc-100">{item.label}</span>
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[item.state]}`}>
        {STATE_LABEL[item.state]}
      </span>
      {item.blockedByPrevious && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">앞 결재가 끝나야 요청할 수 있습니다</span>
      )}
      {item.state === "STALE" && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          승인 이후 접수 건이 바뀌었습니다 — 다시 요청해야 합니다
        </span>
      )}
    </li>
  );
}
