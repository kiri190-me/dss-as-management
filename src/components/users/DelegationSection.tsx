"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createShipmentDelegationAction, revokeShipmentDelegationAction } from "@/lib/server/actions/shipment-delegations";
import type { RepresentativeManagementUserRow, ShipmentDelegationRow } from "@/lib/db/queries/shipment-delegations";
import { deriveDelegationDisplayStatus } from "@/lib/domain/shipment-delegation-status";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";

const STATUS_LABELS: Record<ReturnType<typeof deriveDelegationDisplayStatus>, string> = {
  ACTIVE: "활성",
  SCHEDULED: "예정",
  EXPIRED: "만료",
  REVOKED: "철회됨",
};

const STATUS_TONE: Record<ReturnType<typeof deriveDelegationDisplayStatus>, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  SCHEDULED: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  EXPIRED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REVOKED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function DelegationSection({
  actingUser,
  isSuperAdmin,
  representatives,
  allUsers,
  delegations,
}: {
  actingUser: ActingUser;
  isSuperAdmin: boolean;
  representatives: RepresentativeManagementUserRow[];
  allUsers: RepresentativeManagementUserRow[];
  delegations: ShipmentDelegationRow[];
}) {
  const router = useRouter();
  const actingUserIsRepresentative = representatives.some((r) => r.id === actingUser.id);
  const canAssign = isSuperAdmin || actingUserIsRepresentative;

  const defaultRepresentativeId = isSuperAdmin ? (representatives[0]?.id ?? "") : actingUser.id;
  const [representativeUserId, setRepresentativeUserId] = useState(defaultRepresentativeId);
  const [delegateUserId, setDelegateUserId] = useState("");
  const now = new Date();
  const [startsAt, setStartsAt] = useState(toDatetimeLocalValue(now));
  const [endsAt, setEndsAt] = useState(toDatetimeLocalValue(new Date(now.getTime() + 24 * 60 * 60 * 1000)));
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);

  const delegateOptions = allUsers.filter((u) => u.id !== representativeUserId);

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    if (!delegateUserId) {
      setFormMessage("대리 승인자를 선택해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setFormMessage(null);
    const result = await createShipmentDelegationAction({
      representativeUserId,
      delegateUserId,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      reason: reason.trim() || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setFormMessage(result.message);
      return;
    }
    setFormMessage("위임을 지정했습니다.");
    setDelegateUserId("");
    setReason("");
    router.refresh();
  }

  async function handleRevoke(delegationId: string) {
    setRevokingId(delegationId);
    setListMessage(null);
    const result = await revokeShipmentDelegationAction({ delegationId });
    setRevokingId(null);
    if (!result.ok) {
      setListMessage(result.message);
      return;
    }
    setListMessage("위임을 철회했습니다.");
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">출하 승인 위임</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        대표가 부재중일 때 기간을 정해 다른 사용자가 최종 출하 승인을 대신 처리하도록 위임할 수 있습니다.
      </p>

      {canAssign ? (
        <form onSubmit={(e) => void handleAssign(e)} className="mt-4 flex flex-col gap-3 rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              대표
              {isSuperAdmin ? (
                <select
                  value={representativeUserId}
                  onChange={(e) => setRepresentativeUserId(e.target.value)}
                  className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {representatives.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {actingUser.name} (본인)
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              대리 승인자
              <select
                required
                value={delegateUserId}
                onChange={(e) => setDelegateUserId(e.target.value)}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                <option value="">선택하세요</option>
                {delegateOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              시작 일시
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              종료 일시
              <input
                type="datetime-local"
                required
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            사유 (선택)
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>

          {formMessage && <p className="text-xs text-amber-700 dark:text-amber-400">{formMessage}</p>}

          <div>
            <button
              type="submit"
              disabled={isSubmitting || !representativeUserId}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isSubmitting ? "처리 중..." : "위임 지정"}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          대표 본인 또는 최고관리자만 위임을 지정할 수 있습니다.
        </p>
      )}

      {listMessage && (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {listMessage}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-2 pr-3 font-medium">대표</th>
              <th className="py-2 pr-3 font-medium">대리 승인자</th>
              <th className="py-2 pr-3 font-medium">기간</th>
              <th className="py-2 pr-3 font-medium">상태</th>
              <th className="py-2 pr-3 font-medium">지정자</th>
              <th className="py-2 pr-3 font-medium">사유</th>
              <th className="py-2 pr-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {delegations.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  아직 위임 이력이 없습니다.
                </td>
              </tr>
            ) : (
              delegations.map((delegation) => {
                const displayStatus = deriveDelegationDisplayStatus(delegation);
                const canRevoke =
                  (displayStatus === "ACTIVE" || displayStatus === "SCHEDULED") &&
                  (isSuperAdmin || actingUser.id === delegation.representativeUserId);
                return (
                  <tr key={delegation.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="py-2 pr-3 text-zinc-900 dark:text-zinc-50">{delegation.representativeName}</td>
                    <td className="py-2 pr-3 text-zinc-900 dark:text-zinc-50">{delegation.delegateName}</td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">
                      {formatTimestamp(delegation.startsAt)} ~ {formatTimestamp(delegation.endsAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[displayStatus]}`}>
                        {STATUS_LABELS[displayStatus]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{delegation.assignedByName}</td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{delegation.reason ?? "-"}</td>
                    <td className="py-2 pr-3">
                      {canRevoke ? (
                        <button
                          type="button"
                          disabled={revokingId === delegation.id}
                          onClick={() => void handleRevoke(delegation.id)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          {revokingId === delegation.id ? "처리 중..." : "철회"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {displayStatus === "REVOKED" || displayStatus === "EXPIRED" ? "-" : "권한 없음"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
