"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InventoryTabs from "./InventoryTabs";
import PartIssueApprovalTrail, { formatPartIssueMoment } from "./PartIssueApprovalTrail";
import {
  PART_ISSUE_CANCEL_BACK_LABEL,
  PART_ISSUE_CANCEL_BUTTON_LABEL,
  PART_ISSUE_CANCEL_CONFIRM_LABEL,
  PART_ISSUE_CANCEL_DONE_MESSAGE,
  PART_ISSUE_CANCEL_REASON_LABEL,
  PART_ISSUE_EXECUTION_BLOCKED_NOTICE,
  PART_ISSUE_MINE_LABEL,
  PART_ISSUE_NOTHING_AWAITING_APPROVAL,
  PART_ISSUE_NOTHING_IN_PROGRESS,
  PART_ISSUE_NOTHING_TO_DECIDE,
  PART_ISSUE_NOTHING_TO_EXECUTE,
  PART_ISSUE_PROGRESS_AWAITING_APPROVAL_LABEL,
  PART_ISSUE_PROGRESS_AWAITING_EXECUTION_LABEL,
  PART_ISSUE_SIBLING_PENDING_NOTICE,
} from "./part-issue-approval-texts";
import {
  cancelPartIssueRequestAction,
  decidePartIssueRequestApprovalAction,
  executePartIssueRequestAction,
} from "@/lib/server/actions/inventory-part-issue-requests";
import {
  isPartIssueRequestAwaitingApproval,
  isPartIssueRequestCancellable,
  isPartIssueRequestExecutable,
  type InventoryPartIssueRequestStatus,
} from "@/lib/domain/inventory-part-issue-rules";
import { stockOwnerLabels } from "@/lib/domain/inventory-types";
import type { PartIssueRequestDetail } from "@/lib/db/queries/inventory-part-issue-requests";
import type { ShipmentApprovalRouteStepLabel } from "@/lib/db/queries/shipment-approval-routes";

/**
 * ============================================================================
 * [승인 요청건] 탭 — 결재할 건 · 실행할 건 · 진행 중인 신청
 * ============================================================================
 * 재고 담당자가 [불출]·[사용]을 누르면 그 자리에서 재고가 빠지던 것을, 단계적
 * 승인을 받은 뒤에 빠지게 만드는 절차의 **받는 쪽**이다. 세 묶음이 있다:
 *
 *  (가) 내가 결재할 건 — 지금 내 차례인 신청. 좁히는 것은 조회의 몫이고
 *       (listPartIssueRequestsPendingMyApproval → mayDecideAssignedApproval)
 *       여기서 한 벌 더 좁히지 않는다.
 *  (나) 실행할 건 — 결재가 끝나 재고 담당자가 내보낼 것.
 *  (다) 진행 중인 신청 — 누가 올렸든 결재 중·실행 대기인 신청. 결재·실행
 *       단추가 **없다**. 신청을 올린 사람에게는 (가)(나)가 비어 보이는
 *       것이 정상이라, 이 묶음이 없으면 올린 신청이 사라진 것처럼 보인다.
 *       🔴 (나)가 보이는 세션에서는 (나)에 이미 떠 있는 신청을 여기서 뺀다 —
 *       그 판정과 빼기는 서버(페이지)가 하고, 화면은 받은 목록을 그대로 그린다.
 *       (나)가 안 보이는 세션에서는 빼지 않으므로 「승인 완료 · 실행 대기」
 *       이름표가 여전히 쓰인다.
 *
 * [신청 취소]는 **내 신청**(서버 판정)이고 순수 규칙이 「지금 무를 수 있다」고
 * 할 때만, (나)와 (다)의 카드에 붙는다. (가)에는 붙이지 않는다 — 거기는 결재하는
 * 자리다. 결재 중인 내 신청을 무를 곳은 (다)이고, 승인이 끝난 내 신청은 (나)가
 * 보이는 세션이면 (나)에만 뜨므로(바로 위 🔴) 거기서 무른다.
 * 🔴 무를 수 있는지는 mutation 이 트랜잭션 안에서 다시 본다(신청자 본인만 —
 * 최고관리자 비상구도 없다). 화면의 조건은 단추를 그릴지일 뿐이다.
 *
 * 🔴 **묶음을 함부로 감추지 않는다.** 「지금 할 일이 없다」와 「이 화면이 나와
 * 상관없다」는 다른 말이다. 처리할 건이 0건이면 그렇게 **말하고**, 애초에
 * 결재자도 재고 담당자도 아닌 세션에만 그 묶음을 감춘다(그 판정은 서버가 한다 —
 * 아래 프롭 참조).
 *
 * 🔴 **실패 이유를 뭉개지 않는다.** 서버가 돌려주는 문구를 그대로 보여 준다.
 * 「처리할 수 없습니다」로 접으면 사람은 승인 절차를 만들어야 하는지, 입고를
 * 기다려야 하는지, 새로 고쳐야 하는지 알 수 없다.
 * ============================================================================
 */

/** 신청 한 건과, 그 건을 그리는 데 필요한 서버 쪽 자료. */
export type PartIssueApprovalRequestView = {
  detail: PartIssueRequestDetail;
  /**
   * 🔴 이 신청이 타고 있는 **판**의 단계들(이름 포함). 「현재 판」이 아니다 —
   * 서버가 결재 행의 routeId 로 읽어 내려보낸다. 못 찾으면 `null`.
   */
  routeSteps: ShipmentApprovalRouteStepLabel[] | null;
  /**
   * 같은 부품 요청에 **아직 결재 중인 다른 신청**의 수. 신청은 재고를 예약하지
   * 않으므로 둘이 합쳐 남은 수량을 넘길 수 있고, 그때 뒤엣것이 실행에서 막힌다.
   */
  siblingPendingCount: number;
  /**
   * 🔴 지금 세션이 올린 신청인가. **서버가 판정해** 싣는다 — 화면은 세션이
   * 누구인지 모르고, 추측하면(이름 비교 등) 동명이인·대리 세션에서 틀린다.
   */
  isMine: boolean;
};

/**
 * 카드 안에 펼친 입력 칸 — 🔴 **화면 전체에 하나뿐이다.** 결재(승인·반려)와
 * [신청 취소]를 한 상태에 담아, 두 칸이 동시에 펼쳐지는 일(같은 카드든 다른
 * 카드든)을 모양으로 막는다. 하나를 열면 다른 하나는 저절로 닫힌다. 사유 칸
 * (reason)도 그래서 하나를 같이 쓴다.
 */
type CardDraft =
  | { kind: "DECISION"; issueRequestId: string; decision: "APPROVED" | "REJECTED" }
  | { kind: "CANCEL"; issueRequestId: string };

/**
 * 이 카드에 [신청 취소]를 붙이는가 — 내 신청(서버 판정)이고, 순수 규칙이 「지금
 * 무를 수 있다」고 할 때만. 🔴 규칙은 mutation 이 보는 것과 같은 함수 하나다
 * (isPartIssueRequestCancellable). 신청 상태를 글자로 다시 적지 않는다.
 */
function offersCancel(view: PartIssueApprovalRequestView): boolean {
  return view.isMine && isPartIssueRequestCancellable(view.detail.status);
}

export default function PartIssueApprovalScreen({
  pending,
  executable,
  inProgress,
  showApprovalSection,
  showExecutionSection,
  showProgressSection,
  progressExcludesExecutable,
}: {
  /** 내가 지금 결재해야 할 신청들 — 오래 기다린 것부터. */
  pending: PartIssueApprovalRequestView[];
  /** 승인이 끝나 실행할 수 있는 신청들. */
  executable: PartIssueApprovalRequestView[];
  /**
   * 결재 중·실행 대기인 신청 — 누가 올렸든. 오래된 것부터. 읽기 전용.
   * `progressExcludesExecutable` 이 참이면 `executable` 에 든 신청은 이미 빠져 있다.
   */
  inProgress: PartIssueApprovalRequestView[];
  /**
   * 🔴 서버가 `inProgress` 에서 [실행할 건]과 겹치는 신청을 뺐는가. 빈 상태 문구가
   * 이것으로 갈린다 — 뺐다면 「실행을 기다리는 신청이 없다」는 틀린 말이다.
   */
  progressExcludesExecutable: boolean;
  /**
   * 🔴 「이 사람이 애초에 결재자인가 / 재고 담당자인가 / 재고 메뉴를 볼 수
   * 있는가」는 **서버가 판정해** 내려보낸다. 화면이 역할을 보고 정하면 관리자가
   * 설정으로 연 권한이 반영되지 않는다(inventory-capabilities.ts 머리말과 같은 이유).
   */
  showApprovalSection: boolean;
  showExecutionSection: boolean;
  showProgressSection: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 신청마다 마지막 결과 한 줄 — 성공이든 **서버가 거절한 이유든** 같은 자리다. */
  const [messages, setMessages] = useState<Record<string, string>>({});
  /**
   * 그 신청의 마지막 결과가 [신청 취소]에서 나왔는가. 🔴 결과 한 줄을 **누른
   * 카드에만** 싣기 위한 표시다. 같은 신청이 (가)와 (다)에 함께 뜰 수 있다 —
   * 최고관리자는 결재 대기 건을 전부 (가)에서 보므로 자기가 올린 신청도 거기
   * 뜬다. 이 표시가 없으면 한쪽에서 누른 결과가 두 카드에 똑같이 찍힌다.
   */
  const [cancelResultIds, setCancelResultIds] = useState<Record<string, boolean>>({});

  function setMessage(issueRequestId: string, message: string, fromCancel = false) {
    setMessages((prev) => ({ ...prev, [issueRequestId]: message }));
    setCancelResultIds((prev) => ({ ...prev, [issueRequestId]: fromCancel }));
  }

  /**
   * 카드에 실을 결과 한 줄 — `fromCancel` 과 같은 쪽에서 나온 결과만 돌려준다.
   * (가) 카드는 취소 결과를, (다)의 취소 카드는 결재 결과를 싣지 않는다. (나)
   * 카드는 [불출 실행]과 [신청 취소]가 한 카드에 있으므로 이것을 거치지 않는다.
   */
  function resultLineFor(issueRequestId: string, fromCancel: boolean): string | null {
    const message = messages[issueRequestId];
    if (message === undefined) return null;
    return (cancelResultIds[issueRequestId] ?? false) === fromCancel ? message : null;
  }

  async function submitDecision() {
    if (draft?.kind !== "DECISION" || busyId) return;
    setBusyId(draft.issueRequestId);
    const result = await decidePartIssueRequestApprovalAction({
      issueRequestId: draft.issueRequestId,
      decision: draft.decision,
      reason: reason.trim() ? reason : null,
    });
    setBusyId(null);
    if (!result.ok) {
      // 서버 문구 그대로 — 반려 사유 누락도, 남이 먼저 처리한 것도 여기로 온다.
      setMessage(draft.issueRequestId, result.message);
      return;
    }
    setMessage(
      draft.issueRequestId,
      draft.decision === "APPROVED" ? "승인했습니다." : "반려했습니다."
    );
    setDraft(null);
    setReason("");
    router.refresh();
  }

  async function execute(issueRequestId: string) {
    if (busyId) return;
    setBusyId(issueRequestId);
    /*
      🔴 **신청 id 하나만 보낸다.** 무엇을 얼마나 빼는지는 신청 항목에 이미 적혀
      있고, 화면이 수량이나 잔량 행을 함께 보내면 「승인받은 것과 다른 것이
      나갔다」가 가능해진다. 서버 액션에도 그것을 받을 자리가 없다 — 이 모양을
      깨지 말 것.
    */
    const result = await executePartIssueRequestAction({ issueRequestId });
    setBusyId(null);
    if (!result.ok) {
      // 🔴 재고가 모자라 막혔을 때 **신청이 살아 있다**는 사실을 함께 말한다.
      // 서버가 트랜잭션째 되돌리므로 신청은 그대로 APPROVED 로 남는데, 실패만
      // 보여 주면 사라진 줄 알고 처음부터 다시 올리게 된다.
      setMessage(
        issueRequestId,
        result.code === "INSUFFICIENT_STOCK"
          ? `${result.message} ${PART_ISSUE_EXECUTION_BLOCKED_NOTICE}`
          : result.message
      );
      return;
    }
    setMessage(issueRequestId, "불출을 실행했습니다.");
    router.refresh();
  }

  async function submitCancel() {
    if (draft?.kind !== "CANCEL" || busyId) return;
    const issueRequestId = draft.issueRequestId;
    setBusyId(issueRequestId);
    /*
      🔴 신청 id 와 사유만 보낸다. 「신청자 본인인가」·「지금 무를 수 있는가」는
      mutation 이 트랜잭션 안에서 다시 본다 — 화면이 가진 판정(offersCancel)은
      단추를 그릴지일 뿐이다.
    */
    const result = await cancelPartIssueRequestAction({
      issueRequestId,
      reason: reason.trim() ? reason : null,
    });
    setBusyId(null);
    if (!result.ok) {
      // 서버 문구 그대로 — 그사이 결재가 끝났거나 실행된 것도, 본인이 아닌 것도
      // 여기로 온다. 칸은 열어 둔다(사유를 다시 적지 않게).
      setMessage(issueRequestId, result.message, true);
      return;
    }
    setMessage(issueRequestId, PART_ISSUE_CANCEL_DONE_MESSAGE, true);
    setDraft(null);
    setReason("");
    router.refresh();
  }

  /** 이 카드에 [신청 취소] 칸이 펼쳐져 있는가. */
  function cancelDraftOpenOn(view: PartIssueApprovalRequestView): boolean {
    return draft?.kind === "CANCEL" && draft.issueRequestId === view.detail.id;
  }

  /*
    [신청 취소] 단추와 그 칸 — (나)·(다) 두 묶음이 같은 것을 쓴다. 붙일지는
    부르는 쪽이 offersCancel 로 정한다. 🔴 되돌리는 동작이라 회색 테두리다 —
    반려(빨강)와 헷갈리지 않게. 브라우저 확인 창은 쓰지 않는다(결재 칸과 같은
    모양으로 카드 안에 펼친다).
  */
  function renderCancelButton(view: PartIssueApprovalRequestView): React.ReactNode {
    return (
      <button
        type="button"
        disabled={busyId !== null}
        onClick={() => {
          setReason("");
          setDraft({ kind: "CANCEL", issueRequestId: view.detail.id });
        }}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {PART_ISSUE_CANCEL_BUTTON_LABEL}
      </button>
    );
  }

  function renderCancelDraft(): React.ReactNode {
    return (
      <div className="flex w-full flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          {PART_ISSUE_CANCEL_REASON_LABEL}
          <textarea
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void submitCancel()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {busyId !== null ? "처리 중..." : PART_ISSUE_CANCEL_CONFIRM_LABEL}
          </button>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => {
              setDraft(null);
              setReason("");
            }}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {PART_ISSUE_CANCEL_BACK_LABEL}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <InventoryTabs active="APPROVALS" />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">불출 승인 요청건</h1>

      {/* 세 묶음이 **모두** 감춰질 때만 — 하나라도 보이면 이 화면은 나와 상관있다. */}
      {!showApprovalSection && !showExecutionSection && !showProgressSection && (
        <p className="rounded-lg border border-zinc-200 px-3 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          이 화면에서 처리할 수 있는 권한이 없습니다.
        </p>
      )}

      {showApprovalSection && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            내가 결재할 건 <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{pending.length}건</span>
          </h2>
          {pending.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {PART_ISSUE_NOTHING_TO_DECIDE}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((view) => (
                <RequestCard
                  key={view.detail.id}
                  view={view}
                  message={resultLineFor(view.detail.id, false)}
                  actions={
                    draft?.kind === "DECISION" && draft.issueRequestId === view.detail.id ? (
                      <div className="flex w-full flex-col gap-2">
                        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {draft.decision === "REJECTED" ? "반려 사유 (필수)" : "승인 의견 (선택)"}
                          <textarea
                            rows={2}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => void submitDecision()}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                              draft.decision === "REJECTED"
                                ? "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                                : "bg-primary-900 text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
                            }`}
                          >
                            {busyId !== null ? "처리 중..." : draft.decision === "REJECTED" ? "반려 확정" : "승인 확정"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => {
                              setDraft(null);
                              setReason("");
                            }}
                            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => {
                            setReason("");
                            setDraft({ kind: "DECISION", issueRequestId: view.detail.id, decision: "APPROVED" });
                          }}
                          className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => {
                            setReason("");
                            setDraft({ kind: "DECISION", issueRequestId: view.detail.id, decision: "REJECTED" });
                          }}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          반려
                        </button>
                      </>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {showExecutionSection && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            실행할 건{" "}
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{executable.length}건</span>
          </h2>
          {executable.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {PART_ISSUE_NOTHING_TO_EXECUTE}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {executable.map((view) => (
                <RequestCard
                  key={view.detail.id}
                  view={view}
                  message={messages[view.detail.id] ?? null}
                  actions={
                    /*
                      [신청 취소] 칸이 펼쳐지면 그 칸이 단추 자리를 대신한다 — 결재 칸과
                      같은 모양이고, 무르려던 카드에서 [불출 실행]이 함께 눌리지 않게.
                    */
                    offersCancel(view) && cancelDraftOpenOn(view) ? (
                      renderCancelDraft()
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => void execute(view.detail.id)}
                          className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
                        >
                          {busyId === view.detail.id ? "처리 중..." : "불출 실행"}
                        </button>
                        {offersCancel(view) && renderCancelButton(view)}
                      </>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {showProgressSection && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            진행 중인 신청{" "}
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{inProgress.length}건</span>
          </h2>
          {inProgress.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {progressExcludesExecutable ? PART_ISSUE_NOTHING_AWAITING_APPROVAL : PART_ISSUE_NOTHING_IN_PROGRESS}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {inProgress.map((view) =>
                /*
                  🔴 결재·실행은 싣지 않는다 — 위 두 묶음의 몫이고, 같은 신청이 위에도
                  떠 있으면 거기서 처리한다. 싣는 것은 **내 신청의 [신청 취소]** 하나뿐이다
                  (결재 중인 내 신청을 무를 곳이 여기다). 결과 한 줄도 취소를 누른 이
                  카드에만, 취소에서 나온 것만 싣는다 — 같은 문장이 두 번 보이지 않게.
                  그 밖의 카드는 예전 그대로 단추도 결과 줄도 없다.
                */
                offersCancel(view) ? (
                  <RequestCard
                    key={view.detail.id}
                    view={view}
                    actions={cancelDraftOpenOn(view) ? renderCancelDraft() : renderCancelButton(view)}
                    message={resultLineFor(view.detail.id, true)}
                    showProgress
                  />
                ) : (
                  <RequestCard key={view.detail.id} view={view} actions={null} message={null} showProgress />
                )
              )}
            </ul>
          )}
        </section>
      )}

      {/*
        읽어 주기 통로. 값이 없을 때도 빈 문자열로 **항상 DOM 에 남아 있어야**
        내용이 바뀔 때 읽힌다.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {Object.values(messages).join(" ")}
      </p>
    </div>
  );
}

/**
 * 「진행 중인 신청」 카드가 지금 어디까지 왔는지. 🔴 판정은 순수 규칙 두 개가
 * 한다 — 그 묶음을 모으는 조회(listPartIssueRequestsInProgress)가 상태를 고를
 * 때 쓰는 것과 같은 함수다. 그 사이에 신청이 끝나 버렸으면(목록을 읽은 뒤
 * 실행·반려·취소됨) `null` 이고, 이름표를 붙이지 않는다 — 「결재 중」이라고
 * 틀리게 말하느니 말하지 않는다.
 */
function progressStatusLabel(status: InventoryPartIssueRequestStatus): string | null {
  if (isPartIssueRequestAwaitingApproval(status)) return PART_ISSUE_PROGRESS_AWAITING_APPROVAL_LABEL;
  if (isPartIssueRequestExecutable(status)) return PART_ISSUE_PROGRESS_AWAITING_EXECUTION_LABEL;
  return null;
}

/** 신청 한 건 — 무엇을 얼마나 · 어디에 쓸 것인지 · 결재선 진행 · 단추. */
function RequestCard({
  view,
  actions,
  message,
  showProgress = false,
}: {
  view: PartIssueApprovalRequestView;
  actions: React.ReactNode;
  message: string | null;
  /**
   * 상태 이름표(「결재 중」·「승인 완료 · 실행 대기」)와 「내 신청」 표시를
   * 붙인다. 🔴 「진행 중인 신청」 묶음만 켠다 — 위 두 묶음의 카드는 묶음 이름이
   * 이미 상태를 말하고 있으므로 모양을 바꾸지 않는다.
   */
  showProgress?: boolean;
}) {
  const { detail } = view;
  const statusLabel = showProgress ? progressStatusLabel(detail.status) : null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {detail.repairCaseId !== null && detail.intakeNumber ? (
              <Link
                href={`/repair-cases/${detail.repairCaseId}`}
                className="text-blue-700 hover:underline dark:text-blue-400"
              >
                {detail.intakeNumber}
              </Link>
            ) : (
              /* 사용처만 있는 직접 사용이다 — 접수 건이 없는 것이 정상값이다. */
              (detail.destinationNote ?? "사용처 미지정")
            )}
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {detail.partRequestId !== null ? "부품 요청 기반 불출" : "직접 사용"} · 신청자{" "}
            {detail.requestedByName} · {formatPartIssueMoment(detail.requestedAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showProgress && view.isMine && (
            <span className="shrink-0 whitespace-nowrap rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {PART_ISSUE_MINE_LABEL}
            </span>
          )}
          {statusLabel !== null && (
            <span
              className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${
                isPartIssueRequestAwaitingApproval(detail.status)
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
              }`}
            >
              {statusLabel}
            </span>
          )}
          {actions}
        </div>
      </div>

      {detail.requestReason && (
        <p className="break-keep rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
          신청 사유: “{detail.requestReason}”
        </p>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-zinc-400 dark:text-zinc-500">
            <th scope="col" className="pb-1 text-left font-normal">품목</th>
            <th scope="col" className="pb-1 text-left font-normal">소유 / 위치</th>
            <th scope="col" className="w-16 pb-1 text-right font-normal">승인 수량</th>
            <th scope="col" className="w-16 pb-1 text-right font-normal">현재 잔량</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((item) => {
            // 지금 잔량으로도 모자라면 실행이 막힌다 — 누르기 전에 보여 준다.
            // 판정은 여기서 열지 않는다(실행 mutation 이 잠그고 다시 본다).
            const short = item.currentQuantity < item.quantity;
            return (
              <tr key={item.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-2 text-zinc-800 dark:text-zinc-100">
                  {item.partName}
                  {item.partSpec && (
                    <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{item.partSpec}</span>
                  )}
                </td>
                <td className="py-1 pr-2 text-zinc-600 dark:text-zinc-300">
                  {stockOwnerLabels[item.owner]} / {item.location}
                </td>
                <td className="py-1 text-right tabular-nums text-zinc-800 dark:text-zinc-100">{item.quantity}</td>
                <td
                  className={`py-1 text-right tabular-nums ${
                    short ? "font-medium text-red-700 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {item.currentQuantity}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {view.siblingPendingCount > 0 && (
        <p className="break-keep rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {PART_ISSUE_SIBLING_PENDING_NOTICE} (결재 중 {view.siblingPendingCount}건)
        </p>
      )}

      <PartIssueApprovalTrail approvals={detail.approvals} routeSteps={view.routeSteps} />

      {message && <p className="text-xs text-zinc-500 dark:text-zinc-400">{message}</p>}
    </li>
  );
}
