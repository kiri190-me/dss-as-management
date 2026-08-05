"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setShipmentRepresentativeAction } from "@/lib/server/actions/shipment-representatives";
import { roleLabels, accountApprovalStatusLabels } from "@/lib/domain/types";
import type { RepresentativeManagementUserRow } from "@/lib/db/queries/shipment-delegations";

type PendingAction = { userId: string; nextFlag: boolean } | null;

function eligibilityBlockReason(user: RepresentativeManagementUserRow): string | null {
  if (user.approvalStatus !== "APPROVED") return "승인되지 않은 계정은 대표로 지정할 수 없습니다.";
  if (!user.isActive) return "비활성화된 계정은 대표로 지정할 수 없습니다.";
  if (user.isLocked) return "잠긴 계정은 대표로 지정할 수 없습니다.";
  return null;
}

/**
 * users.is_shipment_representative flag list — SUPER_ADMIN can toggle;
 * everyone else sees the same list read-only with an explanation. A
 * LAST_REPRESENTATIVE result from the server prompts a confirmation
 * re-submit rather than silently failing or silently forcing it through.
 */
export default function RepresentativeListSection({
  users,
  isSuperAdmin,
}: {
  users: RepresentativeManagementUserRow[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirmingLastRemoval, setConfirmingLastRemoval] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(userId: string, nextFlag: boolean, confirmLastRepresentativeRemoval: boolean) {
    setPending({ userId, nextFlag });
    setMessage(null);
    const result = await setShipmentRepresentativeAction({
      targetUserId: userId,
      flag: nextFlag,
      confirmLastRepresentativeRemoval,
    });
    setPending(null);
    if (!result.ok) {
      if (result.code === "LAST_REPRESENTATIVE") {
        setConfirmingLastRemoval({ userId, nextFlag });
        return;
      }
      setMessage(result.message);
      return;
    }
    setConfirmingLastRemoval(null);
    setMessage(nextFlag ? "대표로 지정했습니다." : "대표를 해제했습니다.");
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">최종 출하 승인 대표</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {isSuperAdmin
          ? "대표로 지정된 사용자만 최종 출하 승인을 직접 처리할 수 있습니다."
          : "최고관리자만 대표 지정을 변경할 수 있습니다."}
      </p>

      {message && (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {message}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-2 pr-3 font-medium">이름</th>
              <th className="py-2 pr-3 font-medium">이메일</th>
              <th className="py-2 pr-3 font-medium">역할</th>
              <th className="py-2 pr-3 font-medium">계정 상태</th>
              <th className="py-2 pr-3 font-medium">대표 여부</th>
              <th className="py-2 pr-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const blockReason = eligibilityBlockReason(user);
              const isPendingThis = pending?.userId === user.id;
              const isConfirmingThis = confirmingLastRemoval?.userId === user.id;
              const canFlag = user.isShipmentRepresentative || !blockReason;
              const disabled = !isSuperAdmin || !canFlag || isPendingThis;
              const disabledReason = !isSuperAdmin
                ? "최고관리자만 변경할 수 있습니다."
                : !user.isShipmentRepresentative && blockReason
                  ? blockReason
                  : null;

              return (
                <tr key={user.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3 text-zinc-900 dark:text-zinc-50">{user.name}</td>
                  <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{user.email}</td>
                  <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{roleLabels[user.role as keyof typeof roleLabels] ?? user.role}</td>
                  <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">
                    {accountApprovalStatusLabels[user.approvalStatus as keyof typeof accountApprovalStatusLabels] ?? user.approvalStatus}
                    {!user.isActive ? " · 비활성" : ""}
                    {user.isLocked ? " · 잠김" : ""}
                  </td>
                  <td className="py-2 pr-3">
                    {user.isShipmentRepresentative ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        대표
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {isConfirmingThis ? (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          대기 중인 최종 출하 승인 요청이 있습니다. 마지막 대표를 해제하시겠습니까?
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void submit(user.id, false, true)}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            확인하고 해제
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingLastRemoval(null)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => void submit(user.id, !user.isShipmentRepresentative, false)}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          {isPendingThis ? "처리 중..." : user.isShipmentRepresentative ? "대표 해제" : "대표 지정"}
                        </button>
                        {disabledReason && (
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{disabledReason}</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
