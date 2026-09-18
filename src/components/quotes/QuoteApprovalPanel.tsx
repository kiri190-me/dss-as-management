"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { showSavePopup } from "@/components/common/SavePopup";
import QuoteApprovalDialog from "./QuoteApprovalDialog";
import QuoteApprovalHistory from "./QuoteApprovalHistory";
import QuoteApprovalStatusBadge from "./QuoteApprovalStatusBadge";
import {
  QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE,
  QUOTE_APPROVAL_OUTDATED_NOTICE,
  QUOTE_APPROVAL_ROUTE_MISSING_NOTICE,
  QUOTE_APPROVAL_STATE_DESCRIPTIONS,
} from "./quote-approval-texts";
import { mayDecideAssignedApproval, standsInForAssignedApprover } from "@/lib/auth/approval-assignment";
import type { QuoteApprovalState } from "@/lib/domain/quote-approval-rules";
import type { QuoteApprovalRecordRow } from "@/lib/db/queries/quote-approvals";
import type { ShipmentApprovalRouteStepList } from "@/lib/db/queries/shipment-approval-routes";
import {
  decideQuoteApprovalAction,
  requestQuoteApprovalAction,
} from "@/lib/server/actions/quote-approvals";

/**
 * ============================================================================
 * [견적서 결재] 탭 — 올리고 · 처리하고 · 되짚는 자리
 * ============================================================================
 * repair-cases/approval 의 승인 카드들과 같은 결이다: 상태 한 마디 · 지금 할 수
 * 있는 일 · 지난 기록. 다른 점은 셋이다.
 *
 *  · 승인 **종류가 하나뿐**이다(견적서 승인). 그래서 카드가 둘이 아니라 상자
 *    하나이고, 격자에 나란히 놓을 일이 없다.
 *  · 🔴 **아무 문도 여닫지 않는다.** 결재가 끝나기 전에도 견적서는 발행된다
 *    (2026-09-18 사용자 결정). 서버 쪽 세 파일(actions · mutations · queries)의
 *    머리말이 같은 말을 적어 두었고, 이 화면도 발행 단추를 잠그지 않는다 —
 *    발행 단추는 [견적서 수정] 탭에 그대로 있고 이 탭의 어떤 값도 그 단추에
 *    닿지 않는다.
 *  · 받을 사람을 **고르지 않는다.** 결재선이 1단계 승인자를 스스로 지정하므로
 *    (mutations/quote-approvals.ts) 요청 창에 「누구에게 보낼까요」가 없다.
 *
 * ── 🔴 화면이 감추는 것은 관문이 아니다 ─────────────────────────────────
 * 아래 단추 계산은 **편의**다. 서버 액션이 세션·계정 자격·지정 관문을 매번
 * 처음부터 다시 본다(actions/quote-approvals.ts). 그래서 여기서 조금 넓게
 * 열려 있어도 안전하고, 반대로 여기서 감췄다고 해서 막힌 것도 아니다.
 *
 * 판정을 이 파일에 새로 적지 않는 것이 그 다음 규칙이다 — 지정 관문은
 * auth/approval-assignment.ts 의 함수를 그대로 부른다. 두 곳에 적으면 「단추는
 * 보이는데 누르면 거절」이나 그 반대가 되고, 후자는 화면에 아무 표시도 남기지
 * 않아 더 나쁘다.
 * ============================================================================
 */

/** 지정 관문을 판정하는 데 필요한 만큼의 「지금 보고 있는 사람」. */
export type QuoteApprovalActingUser = {
  id: string;
  /** 역할 문자열. 승격 판정(개발자 표시)까지 함수가 맡는다. */
  role: string;
  isDeveloper: boolean;
};

/** 결재선 미리보기 한 줄 — 몇 번째이고 누구인가. */
export type QuoteApprovalRouteStepPreview = {
  stepOrder: number;
  approverName: string;
};

type DialogState = "REQUEST" | "APPROVED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "견적서 결재 올리기",
  APPROVED: "견적서 승인",
  REJECTED: "견적서 반려",
};

const DONE_MESSAGES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "결재를 올렸습니다.",
  APPROVED: "승인 처리했습니다.",
  REJECTED: "반려 처리했습니다.",
};

/**
 * 🔴 결재를 **다시 올릴 수 있는** 상태들.
 *
 * 서버가 막는 것은 「이미 처리 대기 중인 요청이 있을 때」 하나뿐이므로
 * (ALREADY_REQUESTED) 진행 중이 아니면 언제든 올릴 수 있다. 그런데도 `APPROVED`
 * 를 뺀 것은 **지금 이 내용 그대로 승인이 살아 있는** 상태라서다 — 거기서 또
 * 올리면 방금 받은 승인을 스스로 지우는 꼴이 된다. 내용을 고치면 상태가
 * `APPROVED_OUTDATED` 로 넘어가고, 그때 다시 열린다.
 */
const REQUESTABLE_STATES: readonly QuoteApprovalState[] = [
  "NOT_REQUESTED",
  "REJECTED",
  "APPROVED_OUTDATED",
];

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

export default function QuoteApprovalPanel({
  quoteId,
  state,
  latest,
  history,
  routeSteps,
  isRouteConfigured,
  currentRouteSteps,
  actingUser,
}: {
  quoteId: string;
  /**
   * 🔴 서버가 정한 상태를 그대로 받는다 — 여기서 다시 계산하지 않는다. 판정은
   * domain/quote-approval-rules.ts 의 resolveQuoteApprovalState 한 곳에만 있고,
   * 두 곳에 적으면 화면은 「승인 완료」라는데 기록은 「낡았다」고 답하는 날이 온다.
   */
  state: QuoteApprovalState;
  /** 가장 최근 결재 줄. 한 번도 올린 적이 없으면 null. */
  latest: QuoteApprovalRecordRow | null;
  history: readonly QuoteApprovalRecordRow[];
  /** 이력의 줄들이 가리키는 판들 — 「n/m단계」를 그 줄의 판으로 세기 위해서다. */
  routeSteps: readonly ShipmentApprovalRouteStepList[];
  /**
   * 🔴 지금 「견적서 승인」 결재선이 쓰이고 있는가(판이 있고 단계가 1개 이상).
   * 거짓이면 서버가 요청을 ROUTE_NOT_CONFIGURED 로 거절하므로, 단추 대신
   * **무엇을 해야 하는지**를 내민다.
   */
  isRouteConfigured: boolean;
  /** 현재 판의 단계들 — 올리기 전에 누구를 거치는지 보여 준다. */
  currentRouteSteps: readonly QuoteApprovalRouteStepPreview[];
  actingUser: QuoteApprovalActingUser;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 지정 관문 — 서버가 실제로 강제하는 것과 **같은 함수**를 부른다.
  // 지정이 없으면(null) 언제나 참이다.
  const assignedGateOpen = mayDecideAssignedApproval(latest?.assignedApproverUserId ?? null, actingUser);
  // 지정된 사람이 따로 있는데 내가 그 자리에 서 있는가 — 최고관리자 비상구다.
  // 「그래도 되는가」는 위 관문이 이미 답했고, 이것은 **모양**만 묻는 판정이다.
  const standingInForAssignee = standsInForAssignedApprover(
    latest?.assignedApproverUserId ?? null,
    actingUser.id
  );

  const canRequest = isRouteConfigured && REQUESTABLE_STATES.includes(state);
  const canDecide = state === "PENDING" && assignedGateOpen;

  // 진행 중인 줄의 「n/m단계」. 🔴 **그 줄에 적힌 판**으로 센다 — 현재 판으로
  // 세면 관리자가 절차를 바꾼 뒤 진행 중이던 건이 엉뚱한 단계 수로 보인다.
  const pendingTotalSteps =
    (latest?.routeId &&
      routeSteps.find((route) => route.routeId === latest.routeId)?.steps.length) ||
    0;
  const pendingStepLabel =
    state === "PENDING" && latest?.routeStepOrder !== null && latest?.routeStepOrder !== undefined
      ? `결재선 ${latest.routeStepOrder}${pendingTotalSteps > 0 ? `/${pendingTotalSteps}` : ""}단계`
      : null;

  let decideBlockedReason: string | null = null;
  if (state === "PENDING" && !assignedGateOpen) {
    // 단추를 감추기만 하면 사람은 왜 못 누르는지 모른다 — 누구에게 갔는지 적는다.
    decideBlockedReason = latest?.assignedApproverName
      ? `지금 차례는 ${latest.assignedApproverName} 님입니다. 그 사람이 처리하면 다음 단계로 넘어갑니다.`
      : "이 요청은 지정된 결재자만 처리할 수 있습니다.";
  }

  async function handleConfirm(reason: string | null) {
    if (!dialogState || isSubmitting) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? await requestQuoteApprovalAction({ quoteId, reason })
        : await decideQuoteApprovalAction({ quoteId, decision: dialogState, reason });
    setIsSubmitting(false);
    if (!result.ok) {
      // 🔴 창을 닫지 않는다. 서버가 거절한 이유는 **창 안이 아니라 상자 안**에
      //    뜨지만, 창을 닫아 버리면 사람이 적어 둔 사유까지 함께 사라진다.
      //    거절 이유에는 결재선이 없다는 안내(ROUTE_NOT_CONFIGURED)처럼 사람이
      //    읽고 움직여야 할 말이 그대로 실려 온다 — 「실패했습니다」로 줄이지 않는다.
      setErrorMessage(result.message);
      setDialogState(null);
      return;
    }
    setErrorMessage(null);
    showSavePopup({ message: DONE_MESSAGES[dialogState], redirectTo: null });
    setDialogState(null);
    // 상태·이력은 서버가 그린다 — 손으로 옮기지 않고 다시 묻는다.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        🔴 이 탭에 온 사람이 가장 먼저 오해하는 것 — 「결재를 받아야 발행되나」.
        맨 위에 한 줄로 못 박는다(2026-09-18 사용자 결정).
      */}
      <p className="break-keep rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE}
      </p>

      {/*
        🔴 `break-keep`(word-break: keep-all)을 상자에 건다 — 물려받는 속성이라
        여기 한 자리에 걸면 안의 한국어 문장이 전부 어절 경계에서만 접힌다.
        한글은 기본 규칙으로 어절 중간에서 잘린다(승인 카드가 같은 이유로 같은
        속성을 쓴다).
      */}
      <section className="flex flex-col gap-3 break-keep rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">견적서 승인</h2>
          <div className="flex items-center gap-2">
            {pendingStepLabel && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{pendingStepLabel}</span>
            )}
            <QuoteApprovalStatusBadge state={state} />
          </div>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {QUOTE_APPROVAL_STATE_DESCRIPTIONS[state]}
        </p>

        {/*
          🔴 「승인됨」과 갈라 보이게 하는 두 번째 장치다. 배지 색과 글자만으로는
          **왜** 그런지가 남지 않는다 — 이력에는 「승인」 줄이 그대로 있어서, 이
          문장이 없으면 그 줄을 보고 승인이 아직 살아 있다고 읽는다.
        */}
        {state === "APPROVED_OUTDATED" && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {QUOTE_APPROVAL_OUTDATED_NOTICE}
          </p>
        )}

        {/*
          🔴 결재선이 없으면 서버가 요청을 거절한다. 그러니 **누르기 전에** 무엇을
          해야 하는지 말한다 — 「실패했습니다」로 끝내지 않는다.
        */}
        {!isRouteConfigured && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {QUOTE_APPROVAL_ROUTE_MISSING_NOTICE}
          </p>
        )}

        {/*
          비상구를 **누르기 전에** 말한다. 지정 관문이 열렸는데 지정된 사람이 따로
          있다는 것은, 지금 보고 있는 사람이 최고관리자 권한으로 남의 자리에 서
          있다는 뜻이다(mayDecideAssignedApproval 의 유일한 예외다).
        */}
        {canDecide && standingInForAssignee && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {`지금 차례는 ${latest?.assignedApproverName ?? "다른 결재자"} 님입니다. 최고관리자 권한으로 대신 처리합니다.`}
          </p>
        )}

        {/*
          올리기 전에 누구를 거치는지. 판이 없으면 위 안내가 그 자리를 대신한다.

          🔴 **진행 중일 때는 그리지 않는다.** 진행 중인 건은 요청 시점에 붙잡아
          둔 **옛 판**을 끝까지 따라가는데(mutations/quote-approvals.ts), 그 옆에
          「지금 결재선」을 나란히 놓으면 관리자가 절차를 바꾼 날 둘이 서로 다른
          이름을 말한다. 진행 중에 필요한 것은 위의 「n/m단계」와 아래의 「지정
          결재자」이고, 그 둘은 그 건이 실제로 타고 있는 판에서 나온다.
        */}
        {state !== "PENDING" && isRouteConfigured && currentRouteSteps.length > 0 && (
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              지금 결재선 ({currentRouteSteps.length}단계)
            </p>
            <p className="mt-0.5 text-sm text-zinc-900 dark:text-zinc-50">
              {currentRouteSteps
                .map((step) => `${step.stepOrder}. ${step.approverName}`)
                .join("  →  ")}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="요청자" value={latest?.requestedByName ?? null} />
          <Field label="처리자" value={latest?.decidedByName ?? null} />
          <Field label="지정 결재자" value={latest?.assignedApproverName ?? null} />
          <Field label="요청 시각" value={formatTimestamp(latest?.requestedAt ?? null)} />
          <Field label="결정 시각" value={formatTimestamp(latest?.decidedAt ?? null)} />
        </dl>
        <Field label="요청 사유" value={latest?.requestReason ?? null} />
        <Field label="결정 사유" value={latest?.decisionReason ?? null} />

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {canRequest && (
            <button
              type="button"
              onClick={() => setDialogState("REQUEST")}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {state === "NOT_REQUESTED" ? "결재 올리기" : "다시 올리기"}
            </button>
          )}
          {canDecide && (
            <>
              <button
                type="button"
                onClick={() => setDialogState("APPROVED")}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                승인
              </button>
              <button
                type="button"
                onClick={() => setDialogState("REJECTED")}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                반려
              </button>
            </>
          )}
          {decideBlockedReason && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{decideBlockedReason}</p>
          )}
          {state === "APPROVED" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              이미 승인되어 더 처리할 것이 없습니다.
            </p>
          )}
        </div>

        {/* 서버가 거절한 이유. 창을 닫은 뒤 이 자리에 남는다. */}
        {errorMessage && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        )}
      </section>

      {/*
        읽어 주기 통로. 값이 없을 때도 빈 문자열로 **항상 DOM 에 남아 있어야**
        내용이 바뀔 때 읽힌다(승인 화면의 같은 자리).
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {errorMessage ?? ""}
      </p>

      <QuoteApprovalHistory records={history} routeSteps={routeSteps} />

      <QuoteApprovalDialog
        isOpen={dialogState !== null}
        title={dialogState ? DIALOG_TITLES[dialogState] : ""}
        // 🔴 반려에만 사유가 필수다 — 서버도 같은 자리에서 거절한다.
        requireReason={dialogState === "REJECTED"}
        isSubmitting={isSubmitting}
        onConfirm={(reason) => void handleConfirm(reason)}
        onCancel={() => setDialogState(null)}
      />
    </div>
  );
}
