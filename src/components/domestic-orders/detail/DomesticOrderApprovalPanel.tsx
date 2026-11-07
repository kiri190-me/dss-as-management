"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { showSavePopup } from "@/components/common/SavePopup";
import ApprovalRouteDiagram, { markForRouteStep } from "@/components/approvals/ApprovalRouteDiagram";
import DatabaseApprovalCard, {
  type DatabaseApprovalActionButton,
} from "@/components/repair-cases/approval/DatabaseApprovalCard";
import type { DatabaseDisplayApprovalStatus } from "@/components/repair-cases/approval/DatabaseApprovalStatusBadge";
import DomesticOrderApprovalDialog from "./DomesticOrderApprovalDialog";
import DomesticOrderApprovalHistory from "./DomesticOrderApprovalHistory";
import {
  DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE,
  DOMESTIC_ORDER_APPROVAL_STALE_NOTICE,
} from "./domestic-order-approval-texts";
import {
  approvalFollowsRoute,
  delegatedFromUserIdFor,
  mayDecideAssignedApproval,
  NO_ROUTE_DELEGATIONS,
  standsInForAssignedApprover,
} from "@/lib/auth/approval-assignment";
import type { DomesticOrderApprovalRecordRow } from "@/lib/db/queries/domestic-order-approvals";
import type {
  ShipmentApprovalRouteStepLabel,
  ShipmentApprovalRouteStepList,
} from "@/lib/db/queries/shipment-approval-routes";
import {
  DOMESTIC_ORDER_APPROVAL_LABEL,
  DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE,
  isDomesticOrderApprovalRequestable,
} from "@/lib/domain/domestic-order-approval-rules";
import type { ShipmentApprovalState } from "@/lib/domain/local/workflow/shipment-approval-checklist";
import { isRouteStepSkippedForRequester } from "@/lib/domain/shipment-approval-route";
import {
  decideDomesticOrderApprovalAction,
  requestDomesticOrderApprovalAction,
} from "@/lib/server/actions/domestic-order-approvals";

/**
 * ============================================================================
 * 기타건 상세 [승인] 탭 — 수리 건의 「최종 출하 승인」 카드 **그대로**
 * ============================================================================
 * 🔴 **사용자가 스크린샷으로 모양을 지정했다**(2026-11-06 — 「이런 형태의 승인탭이
 * 되었으면 좋겠어. 결재선이 그림으로 나타나고」). 그래서 새로 그리지 않고 수리 건의
 * 최종 출하 승인 카드가 쓰는 조각을 **그대로 가져다 쓴다**:
 *  · 껍데기   — repair-cases/approval/DatabaseApprovalCard(머리 + 상태 배지 + 두 칸
 *               표 + 사유 둘 + 단추 줄 + 노란 띠(blockedNotice))
 *  · 결재선 그림 — components/approvals/ApprovalRouteDiagram(2026-11-06 에 그 카드에서
 *               공용으로 뽑아냈다. 🔴 **베껴서 두 벌을 만들지 않는다.**)
 *
 * 🔵 **폴더가 `repair-cases/` 인 조각을 가져다 쓰는 것이 어색해 보이지만**, 그 이름은
 * 처음 쓰임새의 흔적일 뿐이고 껍데기 자체에는 접수 건의 것이 한 톨도 없다(표 이름
 * `shipment_approval_routes` 가 출하 전용이 아닌 것과 같은 사정). 옮기면 그 폴더를
 * 가리키는 시험·주석 열 곳이 함께 움직여야 해서, 지금은 **이름을 그대로 두고 뜻을
 * 주석으로 적는다.**
 *
 * ── 🔴 수리 건 카드와 **일부러 다른 것 셋** ─────────────────────────────
 *  1. **「사내 목표 완료일」 줄이 없다.** 기타건에는 대응하는 값이 없다(2026-11-06
 *     사용자 확인 — 「없으니까 빼도 돼」). 빈 값으로 두지 않고 **줄 자체를 뺀다** —
 *     「-」 하나를 남기면 사람은 「아직 안 적었다」로 읽는다.
 *  2. **「처리 자격」 갈래가 없다.** 그 문장은 「출하 대표인가 / 위임을 받았는가」를
 *     말하는데 기타건에는 그 자리가 없다. 기타건은 **언제나 결재선을 타므로**
 *     이 칸은 늘 「결재선 진행」이다.
 *  3. **앞 단계 조건이 없다.** 접수 건의 출하 승인은 수리 검수 승인이 끝나야 올릴 수
 *     있지만 기타건에는 그 앞 단계가 아예 없다 — 진행 중인 요청이 있을 때만 막힌다.
 *
 * ── 🔴 결재선 판이 0개일 때 ─────────────────────────────────────────────
 * 조용한 빈 카드로 두지 않는다. 노란 띠(blockedNotice)에 **무엇이 없고 어디서
 * 만드는지**를 적고 올리기 단추를 그리지 않는다. 그 글자는 서버가 요청을 거절하며
 * 돌려주는 말과 **같은 상수 하나**다.
 *
 * ── 🔴 화면이 감추는 것은 관문이 아니다 ─────────────────────────────────
 * 아래 단추 계산은 **편의**다. 서버 액션이 세션·계정 자격·지정 관문을 매번 처음부터
 * 다시 본다. 판정을 이 파일에 새로 적지 않는 것이 그 다음 규칙이다 — 지정 관문·위임은
 * auth/approval-assignment.ts 의 함수를 그대로 부른다.
 * ============================================================================
 */

/** 지정 관문을 판정하는 데 필요한 만큼의 「지금 보고 있는 사람」. */
export type DomesticOrderApprovalActingUser = {
  id: string;
  /** 역할 문자열. 승격 판정(개발자 표시)까지 함수가 맡는다. */
  role: string;
  isDeveloper: boolean;
};

type DialogState = "REQUEST" | "APPROVED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "기타건 출하 승인 요청",
  APPROVED: "기타건 출하 승인",
  REJECTED: "기타건 출하 반려",
};

const DONE_MESSAGES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "승인을 요청했습니다.",
  APPROVED: "승인 처리했습니다.",
  REJECTED: "반려 처리했습니다.",
};

/**
 * 도메인이 쓰는 상태 이름을 **배지가 쓰는 이름**으로 옮긴다 — 둘은 대기 상태를
 * 다르게 부른다(`PENDING` ↔ `REQUESTED`). 수리 건 카드의 displayStatusOf 가 하는
 * 일과 글자 그대로 같고, 그래서 같은 배지·같은 색이 나온다.
 */
function toBadgeStatus(state: ShipmentApprovalState): DatabaseDisplayApprovalStatus {
  return state === "PENDING" ? "REQUESTED" : state;
}

export default function DomesticOrderApprovalPanel({
  domesticOrderId,
  state,
  latest,
  history,
  routeSteps,
  isRouteConfigured,
  currentRouteSteps,
  actingUser,
  actingApproverUserIds,
  canRequestApproval,
}: {
  domesticOrderId: string;
  /**
   * 🔴 서버가 정한 상태를 그대로 받는다 — 여기서 다시 계산하지 않는다. 판정은
   * resolveApprovalState 한 곳에만 있고(접수 건 승인 카드가 쓰는 그 함수다), 두 곳에
   * 적으면 화면은 「승인 완료」라는데 기록은 「낡았다」고 답하는 날이 온다.
   */
  state: ShipmentApprovalState;
  /** 가장 최근 승인 줄. 한 번도 올린 적이 없으면 null. */
  latest: DomesticOrderApprovalRecordRow | null;
  history: readonly DomesticOrderApprovalRecordRow[];
  /** 이력의 줄들이 가리키는 판들 — 「n/m단계」를 그 줄의 판으로 세기 위해서다. */
  routeSteps: readonly ShipmentApprovalRouteStepList[];
  /**
   * 🔴 지금 「기타건 최종 출하 승인」 결재선이 쓰이고 있는가(판이 있고 단계가 1개
   * 이상). 거짓이면 서버가 요청을 ROUTE_NOT_CONFIGURED 로 거절하므로, 단추 대신
   * **무엇을 해야 하는지**를 내민다.
   */
  isRouteConfigured: boolean;
  /**
   * 현재 판의 단계들 — **아직 올리지 않았을 때** 누구를 거치는지 보여 준다.
   *
   * 🔴 진행 중인 줄은 이것을 쓰지 않는다. 그 줄은 요청 시점에 붙잡아 둔 **옛 판**을
   * 끝까지 따라가므로, 현재 판으로 그리면 관리자가 절차를 바꾼 날 그림과 「n/m단계」가
   * 서로 다른 말을 한다.
   */
  currentRouteSteps: readonly ShipmentApprovalRouteStepLabel[];
  actingUser: DomesticOrderApprovalActingUser;
  /**
   * 🔴 지금 보고 있는 사람이 **대신할 수 있는 결재자 id 전부**(맨 앞은 본인).
   * 결재선 단계 위임(`approval_route_delegations`)을 서버(page.tsx)가 읽어 내려준다 —
   * 클라이언트가 DB 를 읽게 두지 않는다. 🔴 **힌트일 뿐이다.**
   */
  actingApproverUserIds: readonly string[];
  /**
   * 🔴 **올릴 수 있는 사람인가** — `domesticOrders` WRITE. 서버(page.tsx)가 보고
   * 내려준다. 🔵 **승인·반려 쪽에는 이 열쇠를 걸지 않는다** — 결재선에 올라간 사람이
   * 곧 그 단계의 결재자라는 것이 이 기능의 설계이고, 서버도 그렇게 판정한다.
   */
  canRequestApproval: boolean;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = toBadgeStatus(state);
  // 🔴 위임이 걸리는 것은 결재선 **단계**뿐이다 — 서버(decideDomesticOrderApproval)가
  // 같은 함수로 같게 가른다. 기타건 결재는 언제나 결재선을 타므로 실제로는 언제나
  // 왼쪽이다.
  const followsRoute = latest !== null && approvalFollowsRoute(latest);
  const routeDelegations = followsRoute ? actingApproverUserIds : NO_ROUTE_DELEGATIONS;
  // 지정 관문 — 서버가 실제로 강제하는 것과 **같은 함수**를 부른다.
  const assignedGateOpen = mayDecideAssignedApproval(
    latest?.assignedApproverUserId ?? null,
    actingUser,
    routeDelegations
  );
  // 지정된 사람이 따로 있는데 내가 그 자리에 서 있는가 — 「그래도 되는가」는 위
  // 관문이 이미 답했고, 이것은 **모양**만 묻는 판정이다.
  const standingInForAssignee = standsInForAssignedApprover(
    latest?.assignedApproverUserId ?? null,
    actingUser.id
  );
  // 그 자리에 서 있는 **까닭**이 위임인가 최고관리자 비상구인가. 서버가 기록에 적을
  // 값을 정하는 **그 함수**를 그대로 부른다 — 안내 문구와 기록이 서로 다른 말을 하지
  // 않게 하려는 것이다.
  const delegatedFromUserId = delegatedFromUserIdFor(
    latest?.assignedApproverUserId ?? null,
    actingUser.id,
    routeDelegations
  );

  // 「2/3단계」의 뒷자리. 🔴 **그 줄에 적힌 판**으로 센다 — 현재 판으로 세면 관리자가
  // 절차를 바꾼 뒤 진행 중이던 건이 엉뚱한 단계 수로 보인다.
  const pinnedRouteSteps =
    (latest?.routeId && routeSteps.find((route) => route.routeId === latest.routeId)?.steps) || [];
  const routeTotalSteps = pinnedRouteSteps.length;

  const actions: DatabaseApprovalActionButton[] = [];
  let disabledReason: string | null = null;
  let blockedNotice: string | null = null;

  if (isDomesticOrderApprovalRequestable(state)) {
    if (!isRouteConfigured) {
      // 🔴 **결재선 판이 0개다.** 조용한 빈 카드로 두지 않는다 — 단추 대신 무엇을
      //    해야 하는지를 노란 띠에 적는다. 글자는 서버가 거절하며 돌려주는 말과
      //    같은 상수 하나다.
      blockedNotice = DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE;
    } else if (canRequestApproval) {
      actions.push({
        key: "request",
        label: state === "NOT_REQUESTED" ? "출하 승인 요청" : "출하 재요청",
        onClick: () => setDialogState("REQUEST"),
      });
      if (state === "STALE") {
        // 🔴 「승인 완료」와 갈라 보이게 하는 두 번째 장치다. 이력에는 「승인」 줄이
        //    그대로 있어서, 이 문장이 없으면 그 줄을 보고 승인이 아직 살아 있다고 읽는다.
        blockedNotice = DOMESTIC_ORDER_APPROVAL_STALE_NOTICE;
      }
    } else {
      disabledReason = "내자 정리를 수정할 수 있는 사용자만 승인을 올릴 수 있습니다.";
    }
  } else if (state === "PENDING") {
    if (!assignedGateOpen) {
      // 단추를 감추기만 하면 사람은 왜 못 누르는지 모른다 — 누구 차례인지 이름을 적는다.
      disabledReason = latest?.assignedApproverName
        ? `이 요청은 ${latest.assignedApproverName} 님에게 지정되어 있습니다.`
        : "이 요청은 지정된 승인자만 처리할 수 있습니다.";
    } else {
      // 🔴 비상구를 **누르기 전에** 말한다. 지정 관문이 열렸는데 지정된 사람이 따로
      //    있다는 것은 지금 보고 있는 사람이 남의 자리에 서 있다는 뜻이다.
      //    🔴 **까닭이 둘이라 말도 둘이다**(2026-10-26): 그 단계를 위임받았거나,
      //    최고관리자 비상구이거나. 위임받은 사람에게 「최고관리자 권한으로」라고 하면
      //    거짓이고, 그 사람은 자기가 왜 누를 수 있는지 끝내 모른다.
      if (standingInForAssignee) {
        blockedNotice = delegatedFromUserId
          ? `지금 차례는 ${latest?.assignedApproverName ?? "다른 승인자"} 님입니다. 위임받은 결재권으로 대신 처리합니다.`
          : `지금 차례는 ${latest?.assignedApproverName ?? "다른 승인자"} 님입니다. 최고관리자 권한으로 대신 처리합니다.`;
      }
      actions.push(
        { key: "approve", label: "출하 승인", onClick: () => setDialogState("APPROVED") },
        { key: "reject", label: "출하 반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    }
  } else if (state === "APPROVED") {
    disabledReason = "이미 승인 완료되어 추가 처리를 할 수 없습니다.";
  }

  async function handleConfirm(reason: string | null) {
    if (!dialogState || isSubmitting) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? await requestDomesticOrderApprovalAction({ domesticOrderId, reason })
        : await decideDomesticOrderApprovalAction({
            domesticOrderId,
            decision: dialogState,
            reason,
          });
    setIsSubmitting(false);
    if (!result.ok) {
      // 🔴 거절 이유에는 결재선이 없다는 안내처럼 사람이 읽고 움직여야 할 말이 그대로
      //    실려 온다 — 「실패했습니다」로 줄이지 않는다.
      setStatusMessage(result.message);
      return;
    }
    setStatusMessage(null);
    showSavePopup({ message: DONE_MESSAGES[dialogState], redirectTo: null });
    setDialogState(null);
    // 상태·이력은 서버가 그린다 — 손으로 옮기지 않고 다시 묻는다.
    router.refresh();
  }

  /**
   * 진행 한 줄 — 「결재선 2/3단계 · 지금 차례: ○○○」.
   *
   * 🔴 수리 건 카드에는 이 자리에 「처리 자격」(대표·위임) 갈래가 함께 있다. 기타건에는
   * 그 자리가 없으므로(파일 머리말의 「일부러 다른 것」 2번) **언제나 결재선 진행**이다.
   * 아직 올리지 않았으면 그 대신 「지금 결재선」 단계 수를 적는다 — 빈 칸을 두지 않는다.
   */
  const routeProgress =
    followsRoute && latest?.routeStepOrder !== null && latest?.routeStepOrder !== undefined
      ? `결재선 ${latest.routeStepOrder}${routeTotalSteps > 0 ? `/${routeTotalSteps}` : ""}단계${
          displayStatus === "REQUESTED"
            ? ` · 지금 차례: ${latest.assignedApproverName ?? "확인할 수 없습니다"}`
            : ""
        }`
      : isRouteConfigured
        ? `아직 올리지 않았습니다. 올리면 ${currentRouteSteps.length}단계를 거칩니다.`
        : "승인 절차가 없어 올릴 수 없습니다.";

  /**
   * 그림을 그릴 단계들 — 이름과 함께 **그 칸의 상태**까지 미리 정해 둔다.
   *
   * 🔴 진행 중인 줄은 **그 줄에 적힌 판**을, 아직 올리지 않았으면 **지금 판**을 쓴다.
   * 두 자리를 섞으면 관리자가 절차를 바꾼 날 진행 중인 건이 남의 판으로 그려진다.
   *
   * 🔴 「이 단계를 건너뛰는가」를 화면이 새로 적지 않는다 — 서버가 사슬을 이을 때 보는
   * 것과 **같은 함수**다(isRouteStepSkippedForRequester). 두 곳에 적으면 화면은
   * 「완료」라는데 서버는 아무도 결재하지 않은 칸이 되는 날이 온다.
   */
  const diagramSource = followsRoute ? pinnedRouteSteps : currentRouteSteps;
  const previewSteps = diagramSource.map((step) => ({
    ...step,
    ...markForRouteStep(
      step.stepOrder,
      latest?.routeStepOrder ?? 0,
      displayStatus,
      isRouteStepSkippedForRequester(step.approverUserId, latest?.requestedByUserId ?? null)
    ),
  }));

  const extra = (
    /*
      🔴 `break-keep`(word-break: keep-all)을 **상자에** 건다. word-break 는 물려받는
      속성이라 한 자리에 걸면 안의 문장이 모두 어절 경계에서만 접힌다 — 한글은 기본
      규칙으로 어절 중간에서 잘린다. 수리 건 카드의 같은 상자와 같은 처리다.

      🔴 **「사내 목표 완료일」 줄은 없다** — 기타건에 대응하는 값이 없다(2026-11-06
      사용자 확인). 빈 값으로 남기지 않고 줄 자체를 뺀다.
    */
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 break-keep rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2 dark:bg-zinc-800/60">
      {/*
        🔴 이 칸은 카드 폭을 **다 쓴다**(그림이 이미 쓰는 방식과 같다). 카드 안에서 또
        반으로 쪼개면 한 줄에 들어갈 문장이 두세 줄로 접힌다.
      */}
      <div className="sm:col-span-2">
        <dt className="text-xs text-zinc-500 dark:text-zinc-400">결재선 진행</dt>
        <dd className="text-zinc-900 dark:text-zinc-50">{routeProgress}</dd>
      </div>
      {/*
        🔴 **결재선 그림은 공용 조각이다**(components/approvals/ApprovalRouteDiagram) —
        수리 건의 최종 출하 승인 카드가 쓰는 그 그림 그대로다. 단계가 0개면 아예 그리지
        않는다(이름표만 있는 빈 칸을 세우지 않기 위해서다).
      */}
      {previewSteps.length > 0 && <ApprovalRouteDiagram steps={previewSteps} />}
    </dl>
  );

  return (
    <div className="flex flex-col gap-4">
      {/*
        🔴 이 탭에 온 사람이 가장 먼저 묻는 것 — 「승인을 받아야 완료 처리가 되나」.
        2026-11-07 부터 답이 **그렇다**로 바뀌었으므로(사용자 결정) 카드 위에 한 줄로
        못 박는다. 글자는 texts 파일 하나에 있고, 거기 머리말에 **어제까지 정반대의
        말이 서 있었다**는 사실과 까닭이 적혀 있다.
      */}
      <p className="break-keep rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE}
      </p>

      <DatabaseApprovalCard
        title={DOMESTIC_ORDER_APPROVAL_LABEL}
        record={latest}
        displayStatus={displayStatus}
        extra={extra}
        blockedNotice={blockedNotice}
        actions={actions}
        disabledReason={disabledReason}
        // 확인 창이 떠 있는 동안에는 보이지 않는다 — 창 뒤에서 지난 결과가 새 결과처럼
        // 읽히지 않게 하려는 것이다(수리 건 카드와 같은 처리).
        statusMessage={dialogState ? null : statusMessage}
      />

      {/*
        읽어 주기 통로. 값이 없을 때도 빈 문자열로 **항상 DOM 에 남아 있어야** 내용이
        바뀔 때 읽힌다. 절대배치(sr-only)라 자리를 먹지 않는다.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {statusMessage ?? ""}
      </p>

      <DomesticOrderApprovalHistory records={history} routeSteps={routeSteps} />

      <DomesticOrderApprovalDialog
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
