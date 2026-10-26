import type { ApprovalRouteDelegationDisplayStatus } from "@/lib/domain/approval-route-delegation";

/**
 * ============================================================================
 * 결재권 위임 화면이 쓰는 말 — 그리고 [철회]를 붙일지 가리는 판정 하나
 * ============================================================================
 * 화면 본체(ApprovalRouteDelegationSection.tsx)는 **서버 액션을 직접 가져오는
 * 클라이언트 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에 react-server 조건
 * 없이 도는 `test:components` 에서는 import 자체가 던진다(옆의 승인 절차 탭이
 * 같은 이유로 원본을 글자로만 읽힌다 — approval-route-section.test.ts 머리말).
 *
 * 그래서 **값으로 확인해야 하는 것만** 이 파일로 떼어 두었다. 원본을 글자로만
 * 읽는 시험은 `Record` 리터럴이 거기 적혀 있다는 사실까지만 알고, 그 안에 딱지가
 * 넷 다 들어 있는지·어떤 줄에 단추가 붙는지는 모른다.
 *
 * 🔴 **옛 `DelegationSection.tsx` 의 같은 Record 를 이리로 옮기지 않는다.** 그
 * 화면은 이번에 손대지 않기로 한 범위이고(2026-10-26), 낱말이 두 화면에서 갈리지
 * 않는 것은 시험이 두 파일의 글자를 맞대어 지킨다. 나중에 옛 화면을 손댈 일이
 * 생기면 그때 한 벌로 합치면 된다.
 * ============================================================================
 */

/**
 * 🔴 **옛 위임 화면과 같은 낱말**이어야 한다. 같은 것을 두 탭이 다른 말로 부르면
 * 쓰는 사람은 두 기능이 다른 것을 재고 있다고 읽는다 — 딱지의 뜻은 둘이 정확히
 * 같다(domain/approval-route-delegation.ts 가 타입을 옛 쪽에서 그대로 끌어온다).
 *
 * 🔵 키가 하나 늘면 `tsc` 가 여기서 멈춘다(`Record` 라서). 배열로 적어 두면 그때
 * 아무 일도 일어나지 않고 새 상태만 화면에서 빠진 채로 남는다.
 */
export const APPROVAL_ROUTE_DELEGATION_STATUS_LABELS: Record<
  ApprovalRouteDelegationDisplayStatus,
  string
> = {
  ACTIVE: "활성",
  SCHEDULED: "예정",
  EXPIRED: "만료",
  REVOKED: "철회됨",
};

/** 배지 색도 옛 위임 화면과 같다. 다크 모드 짝을 빼지 말 것 — 이 저장소는 둘 다 쓴다. */
export const APPROVAL_ROUTE_DELEGATION_STATUS_TONE: Record<
  ApprovalRouteDelegationDisplayStatus,
  string
> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  SCHEDULED: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  EXPIRED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REVOKED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

/**
 * 「내가 맡긴 것」 줄에 [되돌리기] 단추를 붙일까.
 *
 * 🔴 **보는 사람이 누구인지는 묻지 않는다.** 이 판정이 쓰이는 목록은 「내가 맡긴
 * 것」 하나뿐이고, 거기 있는 줄은 전부 내가 결재권자다. 맡긴 본인은 권한과 무관하게
 * 언제나 거둬들일 수 있다(mutations/approval-route-delegations.ts). 옛 위임 화면이
 * 보는 사람까지 따지는 것은 그쪽 목록이 **모두의 위임**을 한 표에 담기 때문이고,
 * 여기서 그 조건을 베껴 오면 쓰이지 않는 가지가 하나 생긴다.
 *
 * 🔵 「내가 대신하고 있는 것」에서는 이 함수를 아예 부르지 않는다 — **대리인은 제가
 * 맡은 위임을 거둘 수 없다**(같은 파일: 맡은 사람이 스스로 자격을 버리면 맡긴 사람이
 * 모르는 사이에 그 단계가 다시 멈춘다). 눌러도 거절당하는 단추를 그리면 사람은
 * 그것을 고장으로 읽는다.
 *
 * 되돌린 줄·끝난 줄이 거짓인 까닭은 서버가 그 둘을 거절하기 때문이다. 이미 기간이
 * 끝난 위임을 되돌리는 것은 아무것도 바꾸지 않으면서 「철회됨」 딱지만 붙이는 일이라,
 * 나중에 그 줄이 **왜 끝났는지**(기간이 다 돼서인지 사람이 거둬서인지)를 구별할 수
 * 없게 만든다.
 */
export function mayRevokeApprovalRouteDelegation(
  status: ApprovalRouteDelegationDisplayStatus
): boolean {
  return status === "ACTIVE" || status === "SCHEDULED";
}

/**
 * 고르개 한 줄에 적을 말.
 *
 * 🔴 **이메일이 없을 수 있다.** `users.view` 권한 없이 들어온 사람에게는 서버
 * 페이지가 `null` 로 바꿔 내리기 때문이다(결재선에 올라 있어 열린 사람 —
 * auth/users-area-access.ts). 그때 `이름 (null)` 이나 `이름 ()` 가 찍히면 사람은
 * 자료가 깨진 것으로 읽는다.
 *
 * 🔵 있을 때 함께 적는 까닭은 **이름이 같은 사람**을 가리기 위해서다. 그 구분이
 * 필요한 쪽은 남의 결재권까지 다루는 관리자이고, 자기 것만 맡기는 사람은 고를
 * 사람을 이미 알고 있다.
 */
export function delegateCandidateLabel(candidate: {
  name: string;
  email: string | null;
}): string {
  return candidate.email ? `${candidate.name} (${candidate.email})` : candidate.name;
}

/**
 * 「누가 이 줄을 만들었나」를 사람이 읽는 말로.
 *
 * 🔴 **이름만 보여 주면 이 칸을 둔 까닭이 화면에서 사라진다.** 표에
 * `created_by_user_id` 가 따로 있는 단 하나의 이유가 「본인이 스스로 맡겼나, 권한
 * 있는 관리자가 대신 세웠나」를 가리는 것인데(표·mutation 머리말), 이름만 적으면
 * 그 구분은 결재권자 이름과 **눈으로 맞대어 봐야만** 나온다. 줄이 스무 개면 아무도
 * 안 맞대어 본다.
 *
 * 🔵 「관리자 지정」이라고 적는 근거: 본인이 아닌 사람이 이 줄을 만들 수 있는 길은
 * `users.shipmentRepresentatives` MANAGE 하나뿐이다(mutation 이 본인이 아니면 그
 * 권한만 묻는다). 그래서 「본인이 아니다 = 그 권한을 가진 사람이 세웠다」가 참이다.
 * 🔴 그 인가 규칙을 고치는 날에는 이 글자도 함께 봐야 한다 — 안 그러면 화면이
 * 사실이 아닌 말을 하게 된다.
 */
export function approvalRouteDelegationCreatorLabel(delegation: {
  delegatorUserId: string;
  createdByUserId: string;
  createdByName: string;
}): string {
  return delegation.createdByUserId === delegation.delegatorUserId
    ? `${delegation.createdByName} (본인)`
    : `${delegation.createdByName} (관리자 지정)`;
}
