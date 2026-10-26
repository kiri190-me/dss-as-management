/**
 * ============================================================================
 * 결재가 생긴 **뒤** 포털을 한 번 쿡 찌른다 — 「누구에게 생겼다」 하나만
 * ============================================================================
 * 결재 알림 메일은 포털(dss-auth)이 보낸다. 2026-10-23 까지 그 메일은 밤에 도는
 * **주기 작업**이 사람마다 세 시스템에 「결재할 것 있나요」를 물어 보내는 것이라,
 * 결재가 생긴 순간이 아니라 **그 다음 작업 때** 나갔다. 2026-10-24 사용자 요청
 * (「결재건이 생기자마자 메일이 보내졌으면」)으로, 결재가 저장된 뒤 포털에
 * 「이 사람 몫을 지금 한 번 돌려라」를 알리는 길을 더한다.
 *
 * ── 🔴 이 파일이 하는 일은 「누구에게」를 고르는 것뿐이다 ────────────────
 * 나가는 몸통에는 **포털 번호 말고 아무것도 없다**(portal-inbox.ts 의
 * notifyPortalApprovalCreated 머리말). 건 번호·갈래·제목은 싣지 않는다 —
 * 포털이 제 통로로 그 사람의 결재를 **다시 물어** 안 보낸 것에만 메일을 띄운다.
 *
 * ── 🔴 판정을 새로 짓지 않는다 ─────────────────────────────────────────
 * 「지금 이 건의 차례인 사람」은 한 줄도 여기 적지 않는다. 이미 있는 것을 **인자로
 * 받아** 그대로 부른다:
 *  · 지정이 있는 행 → 그 한 사람. 지정 칸이 곧 「그 단계의 결재자」다
 *    (auth/approval-assignment.ts 의 mayDecideAssignedApproval 이 보는 그 칸).
 *    결재선을 타는 행은 언제나 여기에 해당한다 — 요청 경로가 판과 지정을 함께
 *    넣기 때문이다(mutations/quote-approvals.ts · repair-case-approvals.ts).
 *    🔴 **2026-10-26 부터 그 단계를 위임받은 사람도 누를 수 있다**(결재선 단계
 *    위임 — approval_route_delegations). 그래도 **여기서는 그 사람을 찾지
 *    않는다**: 즉시 알림은 「지정된 한 사람」에게만 간다. 지금 알려진 구멍이고,
 *    위임받은 사람은 종 · 통합 승인함에서는 그 건을 본다(queries/
 *    repair-case-approvals-pending.ts · quote-approvals-pending.ts 가 위임을
 *    함께 본다). 이 자리를 넓히려면 위임 조회를 deps 로 받아야 한다.
 *  · 지정이 없는 검수 결재 → queries/repair-case-approvals.ts 의
 *    listInspectionApproverCandidates. 요청 창의 「누구에게 보낼까요」 후보와
 *    **같은 목록**이고, 그것이 곧 그 결재를 처리할 수 있는 사람들이다.
 *  · 지정이 없는 최종 출하 결재 → 대표·위임 방식이다. 자격 판정은
 *    queries/shipment-delegations.ts 의 resolveShipmentDecideAuthorization **그
 *    함수 그대로** 쓰고, 여기서는 그 함수에 물어볼 **후보만** 모은다(대표 표시가
 *    켜진 사람 + 살아 있는 위임의 대리인). 후보는 넓어도 되고 — 좁히는 일은 그
 *    함수가 한다 — 좁으면 안 된다.
 *  · 지정이 없는 견적서 결재는 **생길 수 없다**(절차가 없으면 요청 자체가
 *    ROUTE_NOT_CONFIGURED 로 거절된다). 그래도 길을 막아 두고 로그만 남긴다.
 *
 * 🔴 **같은 판정을 베껴 적으면 안 된다.** 잘못 좁힌 쪽은 화면에 아무 표시도
 *    남기지 않는다 — 그 사람은 그냥 메일을 못 받고, 아무도 신고하지 않는다.
 *
 * ── 🔴 어떤 일이 있어도 던지지 않는다 ──────────────────────────────────
 * 부르는 자리는 결재가 **이미 저장된 뒤**다(server/actions/*-approvals.ts). 여기서
 * 던지면 저장이 끝난 결재가 사람에게 **실패로 보인다.** DB 를 못 읽든, 포털이
 * 죽었든, 통로가 아직 없든(404) 결과는 같다: 로그 한 줄, 그리고 아무 일 없음.
 * 🔵 못 보낸 메일은 **밤의 주기 작업이 그대로 줍는다.** 그것이 이 설계의
 *    뒷받침이라, 여기에 다시 보내는 장치도 쌓아 두는 칸도 없다.
 *
 * ── 🔴 DB 를 여기서 부르지 않는다 ──────────────────────────────────────
 * 조회를 전부 인자로 받는 것은 portal-approvals.ts · portal-notifications.ts 와
 * 같은 까닭이다: 판단을 DB 없이 그대로 시험할 수 있고, 실제 함수를 꽂는 자리는
 * 서버 액션 한 곳뿐이라 「어디서 불리는가」가 한눈에 보인다.
 * ============================================================================
 */

import "server-only";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";

/** 결재 행에서 이 파일이 보는 것은 둘뿐이다 — 살아 있는 요청인가, 누구에게인가. */
type ApprovalRowForNotice = {
  status: string;
  assignedApproverUserId: string | null;
};

/** 어느 갈래든 똑같이 쓰는 뒷부분 — 포털 번호로 바꿔 한 번 찌르기. */
export type ApprovalNoticeSendDeps = {
  /**
   * A/S 사용자 한 명의 포털 번호(`users.sso_subject`). 포털 계정과 이어지지 않은
   * 로컬 계정이면 `null` 이고, 그것은 오류가 아니다 — queries/users.ts 의
   * getSsoSubjectForUser 를 그대로 꽂는다.
   */
  readPortalSubject: (userId: string) => Promise<string | null>;
  /** 포털에 알린다. server/integration/portal-inbox.ts 의 notifyPortalApprovalCreated. */
  notifyPortal: (approverSubjects: readonly string[]) => Promise<boolean>;
};

/** 지정이 없는 결재의 「자격 있는 사람들」을 찾는 데 쓰는 조회들. */
export type ApprovalNoticeRecipientDeps = {
  /** queries/repair-case-approvals.ts 의 listInspectionApproverCandidates. */
  listInspectionApprovers: () => Promise<readonly { id: string }[]>;
  /**
   * queries/shipment-delegations.ts 의 listUsersForRepresentativeManagement.
   * 🔴 여기서 쓰는 것은 **후보 모으기**뿐이다 — 대표 표시가 켜진 사람을 뽑는다.
   */
  listRepresentativeCandidates: () => Promise<readonly { id: string; isShipmentRepresentative: boolean }[]>;
  /**
   * queries/shipment-delegations.ts 의 listShipmentDelegations. 역시 **후보
   * 모으기**다 — 살아 있는(ACTIVE) 위임의 대리인을 뽑는다. 기간이 지났는지·
   * 대표가 아직 자격이 있는지는 아래 resolveShipmentDecide 가 가른다.
   */
  listDelegations: () => Promise<readonly { delegateUserId: string; status: string }[]>;
  /** queries/shipment-delegations.ts 의 resolveShipmentDecideAuthorization. */
  resolveShipmentDecide: (userId: string) => Promise<{ allowed: boolean }>;
};

export type RepairCaseApprovalNoticeDeps = ApprovalNoticeSendDeps &
  ApprovalNoticeRecipientDeps & {
    /** queries/repair-case-approvals.ts 의 getCurrentApprovalsForCase. */
    readCurrentApprovals: (
      repairCaseId: string
    ) => Promise<readonly { approvalType: RepairCaseApprovalType; latest: ApprovalRowForNotice | null }[]>;
  };

export type QuoteApprovalNoticeDeps = ApprovalNoticeSendDeps & {
  /** queries/quote-approvals.ts 의 getQuoteApprovalProgress. */
  readQuoteProgress: (quoteId: string) => Promise<{ latest: ApprovalRowForNotice | null } | null>;
};

/**
 * 사람 번호 목록 → 포털 번호 목록 → 한 번의 왕복.
 *
 * 🔴 **포털 번호가 없는 사람은 부르지 않고 로그에 남긴다.** 이 집은 포털과
 * 이어지지 않은 로컬 계정을 허용하고(설계서 F-3), 그 사람은 통합 결재 메일을 못
 * 받는다 — 이미 알려진 구멍이다. 조용히 빠지면 「메일이 안 와요」가 들어왔을 때
 * 코드부터 뒤지게 되므로, **그 사람의 A/S 사용자 번호**를 적어 둔다. 이름도
 * 메일 주소도 포털 번호도 적지 않는다(이 묶음의 로그 규약 — portal-inbox.ts).
 */
async function sendToUsers(
  userIds: readonly string[],
  deps: ApprovalNoticeSendDeps
): Promise<void> {
  // 같은 사람이 두 번 들어와도 한 번만 묻는다.
  const wanted = Array.from(new Set(userIds.filter((id) => id !== "")));
  if (wanted.length === 0) return;

  const subjects: string[] = [];
  const unlinked: string[] = [];
  // 사람 수가 적다(대표는 한둘이고, 검수 자격자도 사내 규모로 열 남짓이다).
  // 그래서 한꺼번에 묻는 전용 조회를 새로 만들지 않고 이미 있는 한 명짜리 조회를
  // 그대로 쓴다 — 새 조회를 만들면 「삭제된 계정 제외」 같은 조건이 두 벌이 된다.
  const found = await Promise.all(wanted.map((userId) => deps.readPortalSubject(userId)));
  found.forEach((subject, at) => {
    if (subject) subjects.push(subject);
    else unlinked.push(wanted[at]);
  });

  if (unlinked.length > 0) {
    console.warn(
      "[sso] 포털 계정과 이어지지 않아 결재 메일을 보낼 수 없습니다:",
      unlinked.join(",")
    );
  }
  if (subjects.length === 0) return;

  await deps.notifyPortal(subjects);
}

/**
 * 「지금 이 결재의 차례인 사람들」. 지정이 있으면 한 사람, 없으면 자격 있는
 * 사람 모두다(파일 머리말의 「판정을 새로 짓지 않는다」).
 */
async function resolveRecipients(
  kind: RepairCaseApprovalType | "QUOTE_APPROVAL",
  assignedApproverUserId: string | null,
  deps: ApprovalNoticeRecipientDeps
): Promise<string[]> {
  // 지정이 있으면 거기서 끝이다 — 결재선을 타는 행은 전부 이 길로 간다.
  // 🔴 최고관리자 비상구(mayDecideAssignedApproval)를 여기서 펴지 않는다. 그것은
  //    「막히면 대신 처리할 수 있다」는 뒷문이지 「메일을 받아야 할 사람」이
  //    아니다 — 펴면 결재가 생길 때마다 최고관리자 전원에게 메일이 간다.
  if (assignedApproverUserId) return [assignedApproverUserId];

  if (kind === "REPAIR_INSPECTION") {
    const candidates = await deps.listInspectionApprovers();
    return candidates.map((one) => one.id);
  }

  if (kind === "FINAL_SHIPMENT") {
    // 후보를 모은다 — 대표 표시가 켜진 사람 + 살아 있는 위임의 대리인.
    // 🔴 **넓게 모은다.** 좁히는 일은 아래 resolveShipmentDecide 가 하고, 여기서
    //    좁히면 그 함수가 보는 조건(기간·대표의 현재 자격·계정 상태)이 두 벌이 된다.
    const [users, delegations] = await Promise.all([
      deps.listRepresentativeCandidates(),
      deps.listDelegations(),
    ]);
    const pool = new Set<string>();
    for (const user of users) if (user.isShipmentRepresentative) pool.add(user.id);
    for (const delegation of delegations) {
      if (delegation.status === "ACTIVE") pool.add(delegation.delegateUserId);
    }
    if (pool.size === 0) return [];

    const decided = await Promise.all(
      Array.from(pool).map(async (userId) => ({
        userId,
        allowed: (await deps.resolveShipmentDecide(userId)).allowed,
      }))
    );
    return decided.filter((one) => one.allowed).map((one) => one.userId);
  }

  // 🔴 지정 없는 견적서 결재는 생길 수 없다 — 절차(결재선)가 없으면 요청 자체가
  //    거절되고, 절차가 있으면 지정이 언제나 채워진다(mutations/quote-approvals.ts).
  //    그래도 조용히 넘기지 않고 적어 둔다: 그런 행이 실제로 생겼다면 저장 경로가
  //    깨진 것이고, 그때 눈에 띄는 유일한 자리가 이 줄이다.
  console.warn("[sso] 지정이 없는 견적서 결재 행이 있어 결재 메일 대상을 정할 수 없습니다.");
  return [];
}

/**
 * 접수 건 결재(검수 · 최종 출하)가 생긴 뒤 포털을 찌른다.
 *
 * 🔴 **방금 넣은 행을 인자로 받지 않고 지금 상태를 다시 읽는다.** 그래야 세
 * 자리가 한 함수로 끝난다 — 처음 요청 · 반려 뒤 재요청 · 결재선이 다음 단계로
 * 나아간 자리. 특히 마지막은 「승인」 행동의 결과로 **다른 사람에게 새 차례**가
 * 생기는 자리라 쉽게 빠뜨린다. 가장 최근 행이 REQUESTED 가 아니면(승인으로 끝,
 * 반려) 아무것도 하지 않는다 — 그때는 아무의 차례도 아니다.
 *
 * @returns 아무것도 돌려주지 않는다. 🔴 **부르는 쪽이 결과를 보고 할 수 있는
 *          일이 없다** — 결재는 이미 저장됐고, 못 보냈으면 주기 작업이 줍는다.
 */
export async function notifyRepairCaseApprovalCreated(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  deps: RepairCaseApprovalNoticeDeps
): Promise<void> {
  try {
    const current = await deps.readCurrentApprovals(repairCaseId);
    const latest = current.find((one) => one.approvalType === approvalType)?.latest ?? null;
    if (!latest || latest.status !== "REQUESTED") return;

    const recipients = await resolveRecipients(approvalType, latest.assignedApproverUserId, deps);
    await sendToUsers(recipients, deps);
  } catch (error) {
    // 🔴 여기까지 온 것은 조회가 깨졌거나 알 수 없는 오류뿐이다(포털 쪽 실패는
    //    notifyPortal 안에서 이미 삼켜진다). 어느 쪽이든 사람에게는 아무 일도
    //    없어야 한다 — 결재는 저장됐다.
    console.error(
      "[sso] 결재 생성 알림을 준비하지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
  }
}

/**
 * 견적서 결재가 생긴 뒤 포털을 찌른다. 접수 건 쪽과 같은 규칙이다 — 지금 상태를
 * 다시 읽고, 가장 최근 행이 REQUESTED 일 때만 알린다(그래서 처음 요청 · 재요청 ·
 * 다음 단계가 한 함수로 끝난다).
 */
export async function notifyQuoteApprovalCreated(
  quoteId: string,
  deps: QuoteApprovalNoticeDeps
): Promise<void> {
  try {
    const progress = await deps.readQuoteProgress(quoteId);
    const latest = progress?.latest ?? null;
    if (!latest || latest.status !== "REQUESTED") return;

    // 견적서 결재는 언제나 지정이 있다. 없으면 resolveRecipients 가 빈 목록과
    // 로그 한 줄을 돌려준다 — 그래서 여기에 가를 것이 없다.
    const recipients = await resolveRecipients("QUOTE_APPROVAL", latest.assignedApproverUserId, {
      // 🔴 견적서 결재는 지정 없는 길이 없으므로 아래 셋은 **불릴 수 없다.**
      //    그래도 자리를 비워 두지 않고 「불리면 빈 목록」으로 채운다 — 나중에
      //    지정 없는 길이 생기는 날 조용히 아무에게도 안 가는 대신, 위의 경고가
      //    로그에 남는다.
      listInspectionApprovers: async () => [],
      listRepresentativeCandidates: async () => [],
      listDelegations: async () => [],
      resolveShipmentDecide: async () => ({ allowed: false }),
    });
    await sendToUsers(recipients, deps);
  } catch (error) {
    console.error(
      "[sso] 견적서 결재 생성 알림을 준비하지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
  }
}
