"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import { ListCard } from "@/components/common/list-card";
import { setDeveloperFlagAction } from "@/lib/server/actions/developer-flag";
import { roleLabels } from "@/lib/domain/types";
import type { RepresentativeManagementUserRow } from "@/lib/db/queries/shipment-delegations";

type PendingAction = { userId: string; nextFlag: boolean } | null;

/** 켤 수 없는 이유 — 서버(mutations/developer-flag.ts)가 INVALID_USER 로 거절하는 세 조건과 같다. */
function eligibilityBlockReason(user: RepresentativeManagementUserRow): string | null {
  if (user.approvalStatus !== "APPROVED") return "승인되지 않은 계정은 개발자로 표시할 수 없습니다.";
  if (!user.isActive) return "비활성화된 계정은 개발자로 표시할 수 없습니다.";
  if (user.isLocked) return "잠긴 계정은 개발자로 표시할 수 없습니다.";
  return null;
}

/**
 * users.is_developer 표시 목록 — 출하 대표 목록(RepresentativeListSection.tsx)과
 * 같은 모양이다. 사람마다 현재 표시와 켜기/끄기 단추, 그리고 왜 켤 수 없는지.
 *
 * `canManageDeveloperFlag` 는 서버 페이지(users/page.tsx)가
 * mayManageDeveloperFlag(actingUser) 로 계산해 내려보낸 값이다 — 이 화면은
 * 판정을 스스로 하지 않는다. 지금은 이 값이 참인 사람에게만 탭이 보이지만,
 * 문구는 여전히 prop 을 따른다(판정을 문구에 복사하지 않는다).
 *
 * 켜기는 한 번 더 묻는다. 한 번 누르면 그 계정에 최고관리자와 같은 권한이
 * 더해지는 스위치라, 열네 줄 목록에서 옆 줄을 잘못 누른 일을 되돌릴 수는
 * 있어도 없던 일로 만들 수는 없다(감사 기록이 남는다). 끄기는 권한을 걷는
 * 쪽이라 바로 된다 — 대표 목록의 「마지막 대표 해제」 확인과 같은 인라인 모양이다.
 */
export default function DeveloperFlagSection({
  users,
  canManageDeveloperFlag,
}: {
  users: RepresentativeManagementUserRow[];
  canManageDeveloperFlag: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirmingTurnOnUserId, setConfirmingTurnOnUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const developerCount = users.filter((user) => user.isDeveloper).length;

  async function submit(userId: string, nextFlag: boolean) {
    setPending({ userId, nextFlag });
    setMessage(null);
    const result = await setDeveloperFlagAction({ targetUserId: userId, flag: nextFlag });
    setPending(null);
    setConfirmingTurnOnUserId(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(
      nextFlag
        ? "개발자 표시를 켰습니다. 그 사용자의 다음 화면부터 적용됩니다."
        : "개발자 표시를 껐습니다. 그 사용자의 다음 화면부터 적용됩니다."
    );
    router.refresh();
  }

  function roleText(user: RepresentativeManagementUserRow): string {
    return roleLabels[user.role as keyof typeof roleLabels] ?? user.role;
  }

  function renderDeveloperMark(user: RepresentativeManagementUserRow) {
    return user.isDeveloper ? (
      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-400">
        개발자
      </span>
    ) : (
      <span className="text-xs text-zinc-400 dark:text-zinc-500">-</span>
    );
  }

  /** 표와 카드가 같은 단추·같은 사유를 보이도록 여기 한 번만 적는다. */
  function renderActions(user: RepresentativeManagementUserRow) {
    const blockReason = eligibilityBlockReason(user);
    const isPendingThis = pending?.userId === user.id;
    const isConfirmingThis = confirmingTurnOnUserId === user.id;
    // 끄는 것은 누구든 된다 — 자격 검사는 켤 때만이다(서버와 같다).
    const canToggle = user.isDeveloper || !blockReason;
    const disabled = !canManageDeveloperFlag || !canToggle || isPendingThis;
    // 이 자리의 「최고관리자만」은 사실이다 — 이 판정은 승격되지 않는다
    // (auth/developer-flag-authorization.ts). 그래도 판정을 여기 복사하지 않고,
    // 서버 페이지가 내려준 값에 따라 적는다.
    const disabledReason = !canManageDeveloperFlag
      ? "개발자 표시는 최고관리자만 변경할 수 있습니다."
      : !user.isDeveloper && blockReason
        ? blockReason
        : null;

    if (isConfirmingThis) {
      return (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            이 계정에 최고관리자와 같은 권한이 더해지고 개발자 모드 메뉴가 열립니다. 켜시겠습니까?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPendingThis}
              onClick={() => void submit(user.id, true)}
              className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              {isPendingThis ? "처리 중..." : "확인하고 켜기"}
            </button>
            <button
              type="button"
              disabled={isPendingThis}
              onClick={() => setConfirmingTurnOnUserId(null)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              취소
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (user.isDeveloper) void submit(user.id, false);
            else setConfirmingTurnOnUserId(user.id);
          }}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {isPendingThis ? "처리 중..." : user.isDeveloper ? "개발자 표시 끄기" : "개발자 표시 켜기"}
        </button>
        {disabledReason && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{disabledReason}</span>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">개발자 표시</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        표시가 켜진 계정은 자기 역할의 권한에 최고관리자의 권한이 더해지고, 개발자 모드 메뉴가 열립니다.
        역할 자체는 바뀌지 않습니다. 저장하면 그 사용자의 다음 화면부터 적용됩니다 — 다시 로그인할
        필요가 없습니다.
      </p>
      {!canManageDeveloperFlag && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">개발자 표시는 최고관리자만 변경할 수 있습니다.</p>
      )}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">현재 개발자로 표시된 계정: {developerCount}명</p>

      {message && (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {message}
        </p>
      )}

      {/* 행마다 계산되는 상태(확인 중인가, 왜 비활성인가)를 표와 카드가 각자
          계산하면 두 화면이 서로 다른 답을 낸다. 한 곳에서 구해 둘 다 쓴다. */}
      <ResponsiveList
        listId="developer-flags"
        table={
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="py-2 pr-3 font-medium">이름</th>
                <th scope="col" className="py-2 pr-3 font-medium">이메일</th>
                <th scope="col" className="py-2 pr-3 font-medium">역할</th>
                <th scope="col" className="py-2 pr-3 font-medium">개발자 표시</th>
                <th scope="col" className="py-2 pr-3 font-medium">작업</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3 text-zinc-900 dark:text-zinc-50">{user.name}</td>
                  <td className="py-2 pr-3 break-all text-zinc-600 dark:text-zinc-400">{user.email}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{roleText(user)}</td>
                  <td className="py-2 pr-3">{renderDeveloperMark(user)}</td>
                  <td className="py-2 pr-3">{renderActions(user)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
        cards={
          <ul className={LIST_CARD_GRID}>
            {users.map((user) => (
              <ListCard
                key={user.id}
                title={user.name}
                badge={renderDeveloperMark(user)}
                fields={[
                  { label: "이메일", value: user.email },
                  { label: "역할", value: roleText(user) },
                ]}
                actions={renderActions(user)}
              />
            ))}
          </ul>
        }
      />
    </section>
  );
}
