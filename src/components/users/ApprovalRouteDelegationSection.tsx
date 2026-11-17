"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import { ListCard } from "@/components/common/list-card";
import { showSavePopup } from "@/components/common/SavePopup";
import { DATETIME_LOCAL_INPUT_MAX } from "@/components/common/date-input-limits";
import {
  createApprovalRouteDelegationAction,
  revokeApprovalRouteDelegationAction,
} from "@/lib/server/actions/approval-route-delegations";
import type {
  AllApprovalRouteDelegationsView,
  ApprovalRouteDelegateCandidate,
  ApprovalRouteDelegationRow,
} from "@/lib/db/queries/approval-route-delegations";
import type { PortalApprovalDelegationsView } from "@/lib/db/queries/portal-approval-delegations";
import { deriveApprovalRouteDelegationDisplayStatus } from "@/lib/domain/approval-route-delegation";
import {
  APPROVAL_ROUTE_DELEGATION_STATUS_LABELS,
  APPROVAL_ROUTE_DELEGATION_STATUS_TONE,
  approvalRouteDelegationCreatorLabel,
  delegateCandidateLabel,
  mayRevokeApprovalRouteDelegation,
} from "./approval-route-delegation-view";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";

/**
 * ============================================================================
 * 결재권 위임 탭 — 결재선 단계를 다른 사람이 대신 누르게 맡긴다
 * ============================================================================
 * 표도 통로도 이미 다 서 있다(`approval_route_delegations` ·
 * server/actions/approval-route-delegations.ts · db/queries/… ). 이 화면은 그
 * 통로를 부르기만 한다 — 판정을 여기 한 벌 더 적지 않는다.
 *
 * ── 🔴 옛 「출하 승인 위임」과 **다른 표·다른 때**다 ─────────────────────
 * 옛것(`shipment_approval_delegations`)은 **승인 절차를 아직 짜지 않았을 때** 쓰는
 * 「출하 대표」 대리이고, 이쪽은 **절차를 쓸 때** 결재선 단계를 대신 누른다. 둘이
 * 같은 화면 안에 탭으로 나란히 있어 쓰는 사람이 헷갈리므로, 두 탭 맨 위에 서로를
 * 가르는 한 줄씩을 적어 두었다(옛 쪽은 DelegationSection.tsx 의 같은 자리).
 *
 * ── 왜 조건 없이 늘 보이는가 ───────────────────────────────────────────
 * **누구나 자기 결재권은 맡길 수 있다.** 본인 위임은 권한과 무관하게 열려 있고
 * (mutations/approval-route-delegations.ts), 그렇지 않으면 자리를 비우는 사람이
 * 관리자에게 부탁해야만 하게 된다. 권한이 가르는 것은 **남의 결재권을 대신
 * 맡기는 것** 하나뿐이고, 그래서 이 화면에서 권한으로 여닫는 것도 「누구의
 * 결재권인가」 고르개 하나뿐이다.
 *
 * ── 🔴 「내가 대신하고 있는 것」에는 [되돌리기]가 없다 ────────────────────
 * 대리인은 제가 맡은 위임을 거둘 수 없다(서버가 거절한다). 단추를 그려 두면 눌러도
 * 거절당하고, 사람은 그것을 고장으로 읽는다. 까닭은
 * approval-route-delegation-view.ts 의 판정 함수 주석에 있다.
 *
 * ── 2026-10-26: 세 번째 묶음 「모두의 결재권 위임」 ─────────────────────────
 * 그 전에는 관리자가 A→B 위임을 세워도 **제 화면 어디에도 안 보였다.** 두 목록이
 * 「내가 결재권자」 또는 「내가 대리인」인 줄만 담기 때문이다(세운 사람은 둘 다
 * 아니다). 그래서 방금 만든 것이 목록에 안 나타나 「저장이 안 됐나」로 읽혔고,
 * 되돌릴 권한이 있는데도 그 줄을 집을 길이 없었다.
 *
 * 🔴 **그 묶음의 자료는 권한이 없으면 아예 안 내려온다.** 화면에서 가리는 것이
 * 아니라 없는 것이다 — 판정은 조회 함수 자신이 한다
 * (queries/approval-route-delegations.ts 의 listAllApprovalRouteDelegations).
 *
 * ── 2026-11-17: 네 번째 묶음 「통합 승인함에서 맡긴 결재권 위임」 ────────────
 * 🔴 **출처가 둘이 됐다**(설계 B-4 — 둘 다 살려 둔다). 위의 세 묶음은 전부
 * `approval_route_delegations`(이 화면에서 사람이 맡긴 줄)이고, 네 번째만
 * `portal_approval_delegations`(통합 승인함에서 맡겨 포털이 전파해 준 줄)다.
 *
 * 그 전에는 **승인함에서 맡긴 위임이 이 화면 어디에도 안 보였다.** 전파는 되고
 * 결재 판정도 듣는데(resolveActingApproverUserIds 가 2026-11-16 부터 표 둘을
 * 읽는다) 그리는 코드가 없어서, 사용자는 승인함에서 맡기고 A/S 를 열어 「위임되었다는
 * 내용이 안 뜬다」를 봤다.
 *
 * 🔴 **섞지 않고 따로 둔 까닭**(설계 D-2 가 경고한 자리): 두 출처는 **되돌리는
 * 자리가 다르다.** 한 표에 섞으면 줄마다 [되돌리기]가 붙었다 말았다 하고, 사람은
 * 그것을 고장으로 읽는다. 묶음을 가르면 「여기서 맡긴 것」과 「승인함에서 맡긴 것」이
 * 머리글 하나로 갈리고, 단추 판정은 **묶음 단위**가 된다 — 네 번째 묶음은
 * `renderRevokeAction` 을 아예 부르지 않는다. 그래도 줄만 떼어 봤을 때 출처를 알 수
 * 있도록 **칸 하나(「출처」)를 줄마다** 둔다.
 *
 * 🔴 **그 묶음에는 [되돌리기]가 없다.** 승인함에서 맡긴 줄을 여기서 거두면 포털은
 * 모르므로 다음 전파 한 번에 되살아나고, 사람은 **거뒀다고 믿는데 안 거둬진** 상태가
 * 된다(표 머리말 · 설계 B-12 의 3번). 대신 **어디로 가야 하는지**를 적어 준다 —
 * 주소는 환경변수에서 오고(`APPROVALS_BASE_URL`), **없으면 링크 없이 글자만** 뜬다.
 * ============================================================================
 */

/**
 * 기간·상태를 그리는 데 필요한 **딱 세 칸**. 두 출처의 줄이 이 모양에서 만난다 —
 * A/S 쪽 `ApprovalRouteDelegationRow` 와 승인함 쪽 `PortalApprovalDelegationRow` 는
 * 나머지 칸이 서로 다르다(저쪽에는 「지정자」도 「되돌린 사람」도 **칸 자체가 없다**).
 *
 * 🔴 **합친 타입이 아니라 좁힌 타입이다.** `A | B` 로 받으면 함수 안에서 어느 쪽인지
 * 가려야 하고, 그 가지가 늘면 같은 날짜가 출처마다 다른 딱지로 보이는 날이 온다.
 * 딱지를 가리는 도메인 함수도 같은 세 칸만 받는다
 * (domain/approval-route-delegation.ts 의 deriveApprovalRouteDelegationDisplayStatus).
 */
type DelegationPeriodRow = Pick<
  ApprovalRouteDelegationRow,
  "startsAt" | "endsAt" | "revokedAt"
>;

function formatTimestamp(date: Date): string {
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 「이 줄은 통합 승인함에서 온 것」 — **줄마다** 적는 딱지.
 *
 * 🔴 묶음 머리글만으로는 모자란다. 표는 가로로 스크롤되고 좁은 폭에서는 카드로
 * 내려가서, 줄 하나를 보고 있을 때 머리글이 화면 밖에 있는 일이 흔하다. 출처를
 * 못 읽으면 [되돌리기]가 없는 것이 **고장인지 규칙인지** 구별되지 않는다
 * (설계 D-2 가 「되돌리려 할 때 찾지 못한다」로 적어 둔 바로 그 자리다).
 *
 * 🔵 상태 딱지와 **다른 모양**(테두리만, 채우지 않음)인 것은 일부러다. 같은 칠한
 * 알약을 한 줄에 둘 두면 둘 다 상태로 읽힌다. 색 이름은 이 파일이 이미 쓰는
 * `zinc` 뿐이다 — 새 색을 들이면 이 저장소에서 어떻게 풀리는지 화면을 띄워 봐야
 * 안다(주석에 적힌 가짜 클래스가 전 페이지를 깨뜨린 적이 있다).
 */
function renderPortalSource() {
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
      통합 승인함
    </span>
  );
}

export default function ApprovalRouteDelegationSection({
  actingUser,
  canManageRepresentatives,
  allUsers,
  routeDelegations,
  allRouteDelegations,
  portalDelegations,
  approvalsDelegationUrl,
}: {
  actingUser: ActingUser;
  /**
   * 🔴 「남의 결재권까지 맡길 수 있는가」다 —
   * `hasPermission(actor, "users.shipmentRepresentatives", "MANAGE")` 의 답이고,
   * 서버 페이지가 계산해 내려보낸다(이 화면은 클라이언트라 await 할 수 없다).
   * 서버 mutation 이 **같은 열쇠·같은 수준**으로 다시 판정하므로, 이 값은 고르개를
   * 그릴지만 정한다.
   */
  canManageRepresentatives: boolean;
  /**
   * 대리 결재자로 세울 수 있는 사람들 — **이름과 id 까지만**이다. 자격의 최종 판정은
   * 저장할 때 서버가 다시 한다(고르는 사이에 계정이 잠길 수 있다).
   *
   * 🔴 이 탭은 `users.view` 권한 **없이도** 열리므로(auth/users-area-access.ts)
   * 전체 계정 목록을 받지 않는다 — 거기엔 사내 전원의 이메일·역할·잠김 여부가
   * 들어 있고, 클라이언트 컴포넌트에 넘긴 값은 그리지 않아도 HTML 에 실려 나간다.
   * 🔵 이메일은 관리 권한이 있을 때만 채워져 온다(서버 페이지가 가른다).
   */
  allUsers: ApprovalRouteDelegateCandidate[];
  /**
   * 「내가 맡긴 것」과 「내가 대신하고 있는 것」. 🔴 시각은 `Date` 그대로 받는다 —
   * 상태를 가리는 도메인 함수가 `Date` 를 받고, 글자로 바꿨다 화면에서 다시 읽는
   * 왕복은 틀릴 거리만 늘린다(queries/approval-route-delegations.ts 의 같은 주석).
   */
  routeDelegations: {
    given: ApprovalRouteDelegationRow[];
    received: ApprovalRouteDelegationRow[];
  };
  /**
   * 🔴 **모두의 줄. `null` 이면 묶음을 아예 그리지 않는다** — 감추는 것이 아니라
   * 없는 것이다(이 화면의 「역할별 접근 권한」 탭이 자료가 null 이면 탭 자체를 안
   * 그리는 것과 같은 방식).
   *
   * 🔴 **화면이 판정해서 null 이 되는 것이 아니다.** 조회 함수가 제 손으로
   * `users.shipmentRepresentatives` MANAGE 를 묻고 거절하며, 서버 페이지는 그 거절을
   * null 로 옮겨 적을 뿐이다. 그래서 이 화면에 권한 판정이 한 줄도 없다.
   */
  allRouteDelegations: AllApprovalRouteDelegationsView | null;
  /**
   * 🔴 **통합 승인함에서 맡긴 줄.** 위 셋과 **다른 표**다
   * (queries/portal-approval-delegations.ts — `portal_approval_delegations`).
   *
   * 🔴 **늘 내려온다. null 이 없다** — 보는 사람 자신이 맡겼거나 맡은 줄뿐이라
   * 권한으로 가릴 것이 없고(위 `allRouteDelegations` 와 다른 점이다), 비어 있는
   * 것이 정상이다. 아직 승인함을 안 쓰는 사람에게는 세 목록이 전부 빈 채로 온다.
   *
   * 🔴 **이 화면은 이 자료를 읽기만 한다.** 지정도 철회도 승인함의 일이라 서버
   * 액션이 아예 없다 — 여기서 거두면 포털은 모르고, 다음 전파 한 번에 되살아난다.
   */
  portalDelegations: PortalApprovalDelegationsView;
  /**
   * 통합 승인함의 **결재권 위임 화면** 주소. 🔴 **`null` 이면 링크를 안 그린다 —
   * 안내 글자는 그대로 남는다**(config/sso.ts 의 getApprovalsDelegationUrlOrNull).
   *
   * 환경변수(`APPROVALS_BASE_URL`)가 없는 기계가 있다. 그때 화면이 깨지거나
   * 안내가 통째로 사라지면, 승인함에서 맡긴 위임을 **어디서 거둬야 하는지** 알
   * 길이 없어진다 — 여기서는 거둘 수 없고 그 사실만 적혀 있게 되기 때문이다.
   *
   * 🔴 주소를 화면에 글자로 박지 않는다. 박으면 주소가 바뀌는 날 오류 없이
   * 엉뚱한 데로 간다(이 화면의 포털 링크 관행 — RepresentativeManagementScreen.tsx).
   */
  approvalsDelegationUrl: string | null;
}) {
  const router = useRouter();

  // 🔴 상태 넷(활성·예정·만료·철회됨)은 저장되지 않고 **읽을 때** 계산된다
  // (domain/approval-route-delegation.ts). 그래서 지금 시각이 필요하고, 그리는
  // 때마다 새로 읽는다 — 한 번 담아 두면 화면을 열어 둔 채 기간이 끝나도 계속
  // 「활성」으로 남는다. 옛 위임 화면이 Date.now() 를 기본값으로 쓰는 것과 같은 자리다.
  const now = new Date();

  // 🔴 처음 고른 값은 **언제나 본인**이다. 관리 권한이 있어도 그렇다 — 가장 흔한
  // 쓰임이 자기 자리를 맡기는 것이고, 남의 이름이 먼저 떠 있으면 그대로 저장해
  // 엉뚱한 사람의 결재권이 넘어간다.
  const [delegatorUserId, setDelegatorUserId] = useState(actingUser.id);
  const [delegateUserId, setDelegateUserId] = useState("");
  const [startsAt, setStartsAt] = useState(toDatetimeLocalValue(now));
  const [endsAt, setEndsAt] = useState(
    toDatetimeLocalValue(new Date(now.getTime() + 24 * 60 * 60 * 1000))
  );
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  // 🔵 「모두의」 묶음은 기본으로 **살아 있는 줄만** 보여 준다. 끝난 줄은 해가 갈수록
  // 쌓이기만 하고(줄을 지우는 길이 없다) 할 수 있는 일도 없어서, 펼쳐야 보이는 쪽이
  // 맞다. 조회가 상한까지 걸어 두므로 펼쳐도 끝없이 길어지지는 않는다.
  const [showFinished, setShowFinished] = useState(false);
  // 🔵 승인함에서 온 줄의 접기는 **따로** 기억한다. 한 상태를 둘이 나눠 쓰면 한쪽을
  // 펴려다 다른 쪽까지 펴지고, 두 묶음은 서로 다른 때 들여다보는 것이라 그 묶음이
  // 쓸모가 없다. 두 묶음이 같은 글자(「끝난 위임 보기」)를 쓰므로 더 헷갈린다.
  const [showPortalFinished, setShowPortalFinished] = useState(false);

  // 🔴 거르는 조건은 **표의 CHECK 와 같은 하나**뿐이다(`…_different_users`: 맡긴
  // 사람과 대신하는 사람이 같은 줄은 뜻이 없다). 보는 사람 자신을 여기서 빼지
  // 않는다 — **관리자가 자기를 대리인으로 세우는 것을 막지 않기로 했다**
  // (2026-10-26 사용자 결정). 누가 세웠는지는 `created_by_user_id` 에 줄마다 남아
  // 나중에 전부 추려 볼 수 있고, 그것이 막는 자리 대신 두기로 한 기록이다.
  const delegateOptions = allUsers.filter((user) => user.id !== delegatorUserId);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!delegateUserId) {
      setFormMessage("대리 결재자를 선택해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setFormMessage(null);
    const result = await createApprovalRouteDelegationAction({
      delegatorUserId,
      delegateUserId,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      reason: reason.trim() || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      // 🔴 거절 사유는 **읽어야 하는 글**이라 화면에 남긴다. 저장 팝업은 0.5초 뒤
      // 저절로 닫히므로 거기 실으면 못 읽고 지나간다(common/SavePopup.tsx).
      setFormMessage(result.message);
      return;
    }
    setDelegateUserId("");
    setReason("");
    router.refresh();
    showSavePopup({ message: "결재권 위임을 지정했습니다.", redirectTo: null });
  }

  async function handleRevoke(delegationId: string) {
    setRevokingId(delegationId);
    setListMessage(null);
    const result = await revokeApprovalRouteDelegationAction({ delegationId });
    setRevokingId(null);
    if (!result.ok) {
      setListMessage(result.message);
      return;
    }
    setListMessage("결재권 위임을 되돌렸습니다.");
    router.refresh();
  }

  function periodText(delegation: DelegationPeriodRow): string {
    // 🔴 끝은 **포함하지 않는다**(반열린 구간). 화면에 적는 것은 저장된 시각 그대로고,
    // 「9월 30일까지」를 10월 1일 0시로 적는 것은 사람의 몫이다 — 여기서 하루를 빼
    // 보여 주면 저장된 값과 보이는 값이 갈려 다음에 고칠 때 또 하루가 밀린다.
    return `${formatTimestamp(delegation.startsAt)} ~ ${formatTimestamp(delegation.endsAt)}`;
  }

  function renderStatus(delegation: DelegationPeriodRow) {
    const displayStatus = deriveApprovalRouteDelegationDisplayStatus(delegation, now);
    return (
      <span
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_ROUTE_DELEGATION_STATUS_TONE[displayStatus]}`}
      >
        {APPROVAL_ROUTE_DELEGATION_STATUS_LABELS[displayStatus]}
      </span>
    );
  }

  /**
   * 되돌릴 수 있는가는 상태 하나로 갈린다 — 이 목록은 전부 내가 결재권자이고,
   * 맡긴 본인은 언제나 거둬들일 수 있다. 표와 카드가 각자 따지면 한쪽에만 단추가
   * 남는 날이 오므로 여기 한 번만 적는다(옛 위임 화면의 같은 자리와 같은 판단).
   */
  function renderRevokeAction(delegation: ApprovalRouteDelegationRow) {
    const displayStatus = deriveApprovalRouteDelegationDisplayStatus(delegation, now);
    if (!mayRevokeApprovalRouteDelegation(displayStatus)) {
      return <span className="text-[11px] text-zinc-400 dark:text-zinc-500">-</span>;
    }
    return (
      <button
        type="button"
        disabled={revokingId === delegation.id}
        onClick={() => void handleRevoke(delegation.id)}
        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {revokingId === delegation.id ? "처리 중..." : "되돌리기"}
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">결재권 위임</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        승인 절차(결재선)를 쓰는 결재에서, 내 단계를 다른 사람이 대신 처리하도록 맡깁니다.
      </p>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="mt-4 flex flex-col gap-3 rounded-md border border-zinc-100 p-3 dark:border-zinc-800"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            누구의 결재권
            {canManageRepresentatives ? (
              <select
                value={delegatorUserId}
                onChange={(e) => setDelegatorUserId(e.target.value)}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                {allUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {delegateCandidateLabel(user)}
                  </option>
                ))}
              </select>
            ) : (
              // 🔴 권한이 없으면 고르개를 **아예 그리지 않는다.** 잠긴 고르개를 두면
              // 남의 이름이 목록에 실려 나가고, 고를 수 없는 까닭도 알 수 없다.
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {actingUser.name} (본인)
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            대리 결재자
            <select
              required
              value={delegateUserId}
              onChange={(e) => setDelegateUserId(e.target.value)}
              className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">선택하세요</option>
              {delegateOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {delegateCandidateLabel(user)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            시작 일시
            <input
              type="datetime-local"
              // 연도를 네 자리로 묶는다(date-input-limits.ts) — 없으면 연도 칸이
              // 여섯 자리를 받는다(2026-11-05 에 이 칸에서 실측:
              // `202611-11-05 오전 10:21`).
              // 🔴 날짜 칸의 DATE_INPUT_MAX 를 여기 주면 안 된다 — 시각이 없는
              //    값은 이 칸이 안 받아 상한이 통째로 무시된다.
              max={DATETIME_LOCAL_INPUT_MAX}
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
              max={DATETIME_LOCAL_INPUT_MAX}
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
            disabled={isSubmitting || !delegatorUserId}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            {isSubmitting ? "처리 중..." : "위임 지정"}
          </button>
        </div>
      </form>

      {listMessage && (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {listMessage}
        </p>
      )}

      <h3 className="mt-5 text-xs font-semibold text-zinc-900 dark:text-zinc-50">내가 맡긴 것</h3>
      {routeDelegations.given.length === 0 ? (
        <p className="mt-2 rounded-lg border border-zinc-200 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          아직 맡긴 결재권이 없습니다.
        </p>
      ) : (
        <div className="mt-2">
          <ResponsiveList
            listId="approval-route-delegations-given"
            table={
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th scope="col" className="py-2 px-3 font-medium">대리 결재자</th>
                    <th scope="col" className="py-2 px-3 font-medium">기간</th>
                    <th scope="col" className="py-2 px-3 font-medium">상태</th>
                    <th scope="col" className="py-2 px-3 font-medium">지정자</th>
                    <th scope="col" className="py-2 px-3 font-medium">사유</th>
                    <th scope="col" className="py-2 px-3 font-medium">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {routeDelegations.given.map((delegation) => (
                    <tr
                      key={delegation.id}
                      className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegateName}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                      <td className="py-2 px-3">{renderStatus(delegation)}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{approvalRouteDelegationCreatorLabel(delegation)}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                      <td className="py-2 px-3">{renderRevokeAction(delegation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            cards={
              <ul className={LIST_CARD_GRID}>
                {routeDelegations.given.map((delegation) => (
                  <ListCard
                    key={delegation.id}
                    title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                    badge={renderStatus(delegation)}
                    fields={[
                      { label: "기간", value: periodText(delegation) },
                      { label: "지정자", value: approvalRouteDelegationCreatorLabel(delegation) },
                      { label: "사유", value: delegation.reason },
                    ]}
                    actions={renderRevokeAction(delegation)}
                  />
                ))}
              </ul>
            }
          />
        </div>
      )}

      <h3 className="mt-5 text-xs font-semibold text-zinc-900 dark:text-zinc-50">
        내가 대신하고 있는 것
      </h3>
      {/* 🔴 읽기 전용이다 — 대리인은 제가 맡은 위임을 거둘 수 없다(서버가 거절한다).
          거둬야 할 일이 생기면 맡긴 사람이나 권한 있는 관리자가 거둔다. */}
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        맡은 위임은 스스로 되돌릴 수 없습니다. 맡긴 분이나 관리자에게 요청해 주세요.
      </p>
      {routeDelegations.received.length === 0 ? (
        <p className="mt-2 rounded-lg border border-zinc-200 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          대신하고 있는 결재권이 없습니다.
        </p>
      ) : (
        <div className="mt-2">
          <ResponsiveList
            listId="approval-route-delegations-received"
            table={
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th scope="col" className="py-2 px-3 font-medium">결재권자</th>
                    <th scope="col" className="py-2 px-3 font-medium">기간</th>
                    <th scope="col" className="py-2 px-3 font-medium">상태</th>
                    <th scope="col" className="py-2 px-3 font-medium">지정자</th>
                    <th scope="col" className="py-2 px-3 font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {routeDelegations.received.map((delegation) => (
                    <tr
                      key={delegation.id}
                      className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegatorName}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                      <td className="py-2 px-3">{renderStatus(delegation)}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{approvalRouteDelegationCreatorLabel(delegation)}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            cards={
              <ul className={LIST_CARD_GRID}>
                {routeDelegations.received.map((delegation) => (
                  <ListCard
                    key={delegation.id}
                    title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                    badge={renderStatus(delegation)}
                    fields={[
                      { label: "기간", value: periodText(delegation) },
                      { label: "지정자", value: approvalRouteDelegationCreatorLabel(delegation) },
                      { label: "사유", value: delegation.reason },
                    ]}
                  />
                ))}
              </ul>
            }
          />
        </div>
      )}

      {/* 🔴 관리 권한이 없으면 자료가 null 이고, 그러면 이 묶음은 **없다**.
          화면이 판정해서 가리는 것이 아니다 — 조회가 거절한 것을 서버 페이지가
          null 로 옮겨 적었을 뿐이다(프롭 주석). */}
      {allRouteDelegations && (
        <>
          <h3 className="mt-6 border-t border-zinc-200 pt-5 text-xs font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
            모두의 결재권 위임
          </h3>
          {/* 🔵 위의 두 묶음과 **겹치는 줄이 있다**. 내가 맡긴 것·대신하고 있는 것은
              여기에도 그대로 들어오는데, 걸러 내면 「전부 보인다」가 거짓이 되고
              사람은 빠진 줄을 찾느라 헤맨다. 겹친다는 사실을 적어 두는 쪽을 골랐다.

              🔴 **「모든 사람의 결재권 위임을 봅니다」라고 적혀 있던 것을 고쳤다**(2026-11-17).
              이 묶음이 받는 자료는 `listAllApprovalRouteDelegations` 하나, 곧 **이 집 표**
              (`approval_route_delegations`)뿐이다. 같은 날 네 번째 묶음이 생기면서 출처가
              둘이 됐는데(머리말) 설명문만 그대로여서, 관리자는 승인함에서 맡긴 줄을 **한 줄도
              못 보고도 「다 봤다」고 믿게** 된다 — 그 믿음이 틀렸다는 것을 알려 주는 오류는
              한 줄도 안 난다.

              🔵 네 번째 묶음을 **머리글 그대로** 부르지 않는 까닭: 그 글자는 이 파일에 **한 번만**
              나와야 한다. portal-approval-delegation-section.test.ts 가 그 글자에서 원본을 잘라
              「승인함 묶음에는 [되돌리기]가 없다」를 재기 때문에, 여기 같은 글자를 적으면 자르는
              자리가 이 묶음 한가운데로 올라와 그 단언이 **공짜로 통과**한다.

              🔵 「아래」라고 쓸 수 있는 까닭은 **차례가 시험에 묶여 있어서**다(같은 파일의 「세 번째
              묶음보다 앞에 끼어들었다」). 🔴 같은 기능이 재고관리에서는 차례가 **반대**다 — 거기선
              승인함 묶음이 「모두의」보다 **위**에 있다(dss-inventory 의 DelegationSection.tsx
              (라)·(마)). 저쪽 글자를 베껴 오면 없는 자리를 가리키게 된다. */}
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            관리 권한이 있어 이 화면에서 맡긴 결재권 위임을 남의 것까지 전부 봅니다. 위의 두 묶음에
            뜬 줄도 여기에 다시 보입니다. 다만 통합 승인함에서 맡긴 위임은 여기 없습니다 — 다른
            표라서 아래 「통합 승인함」 묶음에만 보입니다.
          </p>

          {allRouteDelegations.live.length === 0 ? (
            <p className="mt-2 rounded-lg border border-zinc-200 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              지금 살아 있는 결재권 위임이 없습니다.
            </p>
          ) : (
            <div className="mt-2">
              <ResponsiveList
                listId="approval-route-delegations-all"
                table={
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        <th scope="col" className="py-2 px-3 font-medium">결재권자</th>
                        <th scope="col" className="py-2 px-3 font-medium">대리 결재자</th>
                        <th scope="col" className="py-2 px-3 font-medium">기간</th>
                        <th scope="col" className="py-2 px-3 font-medium">상태</th>
                        <th scope="col" className="py-2 px-3 font-medium">지정자</th>
                        <th scope="col" className="py-2 px-3 font-medium">사유</th>
                        <th scope="col" className="py-2 px-3 font-medium">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRouteDelegations.live.map((delegation) => (
                        <tr
                          key={delegation.id}
                          className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                        >
                          <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegatorName}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegateName}</td>
                          <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                          <td className="py-2 px-3">{renderStatus(delegation)}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{approvalRouteDelegationCreatorLabel(delegation)}</td>
                          <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                          <td className="py-2 px-3">{renderRevokeAction(delegation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
                cards={
                  <ul className={LIST_CARD_GRID}>
                    {allRouteDelegations.live.map((delegation) => (
                      <ListCard
                        key={delegation.id}
                        title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                        badge={renderStatus(delegation)}
                        fields={[
                          { label: "기간", value: periodText(delegation) },
                          { label: "지정자", value: approvalRouteDelegationCreatorLabel(delegation) },
                          { label: "사유", value: delegation.reason },
                        ]}
                        actions={renderRevokeAction(delegation)}
                      />
                    ))}
                  </ul>
                }
              />
            </div>
          )}

          {/* 끝난 줄은 접어 둔다 — 쌓이기만 하고 할 수 있는 일이 없다. 조회가 상한을
              걸어 두므로 펼쳐도 끝없이 길어지지 않는다. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowFinished((previous) => !previous)}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {showFinished
                ? "끝난 위임 접기"
                : `끝난 위임 보기 (${allRouteDelegations.finished.length}건${allRouteDelegations.finishedTruncated ? "+" : ""})`}
            </button>
          </div>

          {showFinished && (
            <div className="mt-2">
              {/* 🔴 잘렸다는 것을 반드시 말해 준다. 말하지 않으면 「이게 전부」로 읽히고,
                  없는 줄을 찾는 사람이 감사 로그까지 가야 한다는 것도 모른다.
                  건수를 글자로 박지 않는다 — 상한은 조회가 정하고 함께 내려보낸다. */}
              {allRouteDelegations.finishedTruncated && (
                <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  끝난 위임은 최근 {allRouteDelegations.finishedLimit}건만 보여 줍니다. 그보다 앞의
                  기록은 감사 로그에 남아 있습니다.
                </p>
              )}
              {allRouteDelegations.finished.length === 0 ? (
                <p className="rounded-lg border border-zinc-200 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  끝나거나 되돌린 결재권 위임이 없습니다.
                </p>
              ) : (
                <ResponsiveList
                  listId="approval-route-delegations-all-finished"
                  table={
                    <table className="w-full min-w-[820px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                          <th scope="col" className="py-2 px-3 font-medium">결재권자</th>
                          <th scope="col" className="py-2 px-3 font-medium">대리 결재자</th>
                          <th scope="col" className="py-2 px-3 font-medium">기간</th>
                          <th scope="col" className="py-2 px-3 font-medium">상태</th>
                          <th scope="col" className="py-2 px-3 font-medium">지정자</th>
                          <th scope="col" className="py-2 px-3 font-medium">되돌린 사람</th>
                          <th scope="col" className="py-2 px-3 font-medium">사유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allRouteDelegations.finished.map((delegation) => (
                          <tr
                            key={delegation.id}
                            className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                          >
                            <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegatorName}</td>
                            <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegateName}</td>
                            <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                            <td className="py-2 px-3">{renderStatus(delegation)}</td>
                            <td className="py-2 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{approvalRouteDelegationCreatorLabel(delegation)}</td>
                            {/* 기간이 다 돼 끝난 줄은 되돌린 사람이 없다 — 그 둘을 한 칸에서 가른다. */}
                            <td className="py-2 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{delegation.revokedByName ?? "-"}</td>
                            <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                  cards={
                    <ul className={LIST_CARD_GRID}>
                      {allRouteDelegations.finished.map((delegation) => (
                        <ListCard
                          key={delegation.id}
                          title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                          badge={renderStatus(delegation)}
                          fields={[
                            { label: "기간", value: periodText(delegation) },
                            { label: "지정자", value: approvalRouteDelegationCreatorLabel(delegation) },
                            { label: "되돌림", value: delegation.revokedByName },
                            { label: "사유", value: delegation.reason },
                          ]}
                        />
                      ))}
                    </ul>
                  }
                />
              )}
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════
          네 번째 묶음 — 통합 승인함에서 맡긴 결재권 위임 (2026-11-17)
          🔴 위 셋과 **다른 표**다. 자료는 늘 내려오고(권한으로 가릴 남의 줄이
          없다) 비어 있는 것이 정상이라, `allRouteDelegations` 처럼 자료로
          여닫지 않는다 — 아직 승인함을 안 쓰는 사람에게 묶음이 통째로 사라지면
          「승인함에서 맡기면 여기 뜬다」를 알 길이 없다.
          ════════════════════════════════════════════════════════════════ */}
      <h3 className="mt-6 border-t border-zinc-200 pt-5 text-xs font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
        통합 승인함에서 맡긴 결재권 위임
      </h3>
      {/* 🔴 두 출처를 **글자로** 갈라 준다. 위의 목록과 아래 목록이 어느 자리에서
          맡긴 것인지 적어 두지 않으면, 되돌리려 할 때 어디를 열어야 할지 모른다
          (설계 D-2). 되돌리기 단추가 아래에만 없는 까닭도 같은 한 줄이 말해 준다. */}
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        위의 목록은 이 화면에서 맡긴 것이고, 아래는 통합 승인함에서 맡긴 것입니다. 아래 줄은
        여기서 되돌릴 수 없습니다 —{" "}
        {approvalsDelegationUrl ? (
          // 🔴 새 탭으로 열지 않는다 — 이 저장소의 포털 링크 관행이다
          //    (이 화면 맨 아래의 「알림 설정 열기」도 같은 창에서 연다).
          <a
            href={approvalsDelegationUrl}
            className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            통합 승인함에서 거둘 수 있습니다
          </a>
        ) : (
          // 🔴 주소가 없는 기계에서도 **갈 곳은 말해 준다.** 안내까지 사라지면
          //    「되돌릴 수 없다」만 남아, 어디서 거둬야 하는지 알 길이 없다.
          <span>통합 승인함에서 거둘 수 있습니다</span>
        )}
        .
      </p>

      <h4 className="mt-4 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
        승인함에서 내가 맡긴 것
      </h4>
      {portalDelegations.given.length === 0 ? (
        <p className="mt-2 rounded-lg border border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          통합 승인함에서 맡긴 결재권이 없습니다.
        </p>
      ) : (
        <div className="mt-2">
          <ResponsiveList
            listId="portal-approval-delegations-given"
            table={
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th scope="col" className="py-2 px-3 font-medium">대리 결재자</th>
                    <th scope="col" className="py-2 px-3 font-medium">기간</th>
                    <th scope="col" className="py-2 px-3 font-medium">상태</th>
                    <th scope="col" className="py-2 px-3 font-medium">출처</th>
                    <th scope="col" className="py-2 px-3 font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {portalDelegations.given.map((delegation) => (
                    <tr
                      key={delegation.id}
                      className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegateName}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                      <td className="py-2 px-3">{renderStatus(delegation)}</td>
                      <td className="py-2 px-3">{renderPortalSource()}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            cards={
              <ul className={LIST_CARD_GRID}>
                {portalDelegations.given.map((delegation) => (
                  <ListCard
                    key={delegation.id}
                    title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                    badge={renderStatus(delegation)}
                    fields={[
                      { label: "기간", value: periodText(delegation) },
                      { label: "출처", value: renderPortalSource() },
                      { label: "사유", value: delegation.reason },
                    ]}
                  />
                ))}
              </ul>
            }
          />
        </div>
      )}

      <h4 className="mt-4 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
        승인함에서 내가 대신하고 있는 것
      </h4>
      {portalDelegations.received.length === 0 ? (
        <p className="mt-2 rounded-lg border border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          통합 승인함에서 맡은 결재권이 없습니다.
        </p>
      ) : (
        <div className="mt-2">
          <ResponsiveList
            listId="portal-approval-delegations-received"
            table={
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th scope="col" className="py-2 px-3 font-medium">결재권자</th>
                    <th scope="col" className="py-2 px-3 font-medium">기간</th>
                    <th scope="col" className="py-2 px-3 font-medium">상태</th>
                    <th scope="col" className="py-2 px-3 font-medium">출처</th>
                    <th scope="col" className="py-2 px-3 font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {portalDelegations.received.map((delegation) => (
                    <tr
                      key={delegation.id}
                      className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegatorName}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                      <td className="py-2 px-3">{renderStatus(delegation)}</td>
                      <td className="py-2 px-3">{renderPortalSource()}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            cards={
              <ul className={LIST_CARD_GRID}>
                {portalDelegations.received.map((delegation) => (
                  <ListCard
                    key={delegation.id}
                    title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                    badge={renderStatus(delegation)}
                    fields={[
                      { label: "기간", value: periodText(delegation) },
                      { label: "출처", value: renderPortalSource() },
                      { label: "사유", value: delegation.reason },
                    ]}
                  />
                ))}
              </ul>
            }
          />
        </div>
      )}

      {/* 끝난 줄은 접어 둔다 — 「모두의」 묶음과 같은 판단이다(쌓이기만 하고 할 수
          있는 일이 없다). 🔵 여기서는 두 방향을 한 목록에 담는다: 결재권자와 대리
          결재자를 두 칸으로 나란히 보여 주므로 줄만 봐도 어느 쪽인지 읽힌다. */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowPortalFinished((previous) => !previous)}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {showPortalFinished
            ? "끝난 위임 접기"
            : `끝난 위임 보기 (${portalDelegations.finished.length}건${portalDelegations.finishedTruncated ? "+" : ""})`}
        </button>
      </div>

      {showPortalFinished && (
        <div className="mt-2">
          {/* 🔴 잘렸다는 것을 반드시 말해 준다 — 「모두의」 묶음과 같은 까닭이고,
              건수를 글자로 박지 않는 것도 같다(상한은 조회가 정해 함께 내려보낸다).
              🔵 두 조회가 **같은 상수**를 쓴다(queries/approval-route-delegations.ts
              의 FINISHED_DELEGATION_LIMIT) — 묶음마다 「최근 N건」의 N 이 다르면
              사람은 그것을 결함으로 읽는다. */}
          {portalDelegations.finishedTruncated && (
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              끝난 위임은 최근 {portalDelegations.finishedLimit}건만 보여 줍니다. 그보다 앞의
              기록은 통합 승인함에 남아 있습니다.
            </p>
          )}
          {portalDelegations.finished.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              끝나거나 거둔 위임이 없습니다.
            </p>
          ) : (
            <ResponsiveList
              listId="portal-approval-delegations-finished"
              table={
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th scope="col" className="py-2 px-3 font-medium">결재권자</th>
                      <th scope="col" className="py-2 px-3 font-medium">대리 결재자</th>
                      <th scope="col" className="py-2 px-3 font-medium">기간</th>
                      <th scope="col" className="py-2 px-3 font-medium">상태</th>
                      <th scope="col" className="py-2 px-3 font-medium">출처</th>
                      <th scope="col" className="py-2 px-3 font-medium">사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portalDelegations.finished.map((delegation) => (
                      <tr
                        key={delegation.id}
                        className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800"
                      >
                        <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegatorName}</td>
                        <td className="py-2 px-3 whitespace-nowrap text-zinc-900 dark:text-zinc-50">{delegation.delegateName}</td>
                        <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{periodText(delegation)}</td>
                        <td className="py-2 px-3">{renderStatus(delegation)}</td>
                        <td className="py-2 px-3">{renderPortalSource()}</td>
                        <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">{delegation.reason || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
              cards={
                <ul className={LIST_CARD_GRID}>
                  {portalDelegations.finished.map((delegation) => (
                    <ListCard
                      key={delegation.id}
                      title={`${delegation.delegatorName} → ${delegation.delegateName}`}
                      badge={renderStatus(delegation)}
                      fields={[
                        { label: "기간", value: periodText(delegation) },
                        { label: "출처", value: renderPortalSource() },
                        { label: "사유", value: delegation.reason },
                      ]}
                    />
                  ))}
                </ul>
              }
            />
          )}
        </div>
      )}
    </section>
  );
}
