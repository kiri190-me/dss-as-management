import { approvalFollowsRoute, standsInForAssignedApprover } from "@/lib/auth/approval-assignment";
import type { QuoteApprovalRecordRow } from "@/lib/db/queries/quote-approvals";
import type { ShipmentApprovalRouteStepList } from "@/lib/db/queries/shipment-approval-routes";
import { QUOTE_APPROVAL_EMPTY_HISTORY_TEXT } from "./quote-approval-texts";

/**
 * ============================================================================
 * 견적서 결재 이력 — 누가 언제 무엇을 했고 무슨 말을 남겼나
 * ============================================================================
 * repair-cases/approval/DatabaseApprovalEventTimeline 과 같은 자리이고 같은
 * 규칙을 따른다. 다른 점은 둘이다:
 *  · 승인 **종류가 하나뿐**이라 종류 이름표가 없다(견적서 승인 하나).
 *  · 🔴 **위임의 갈래가 하나뿐**이다 — 견적서 결재는 언제나 결재선을 타므로
 *    결재선 **단계** 위임(`approval_route_delegations`)만 걸리고, 접수 건 쪽의
 *    「출하 대표」 위임은 이 자리에 올 수 없다. 2026-10-26 전까지는 그 단계
 *    위임조차 결재에 연결돼 있지 않아 여기 「위임이 없다」고 적혀 있었다. 지금은
 *    대신 누른 줄에 **누구 자리였는지 이름**이 붙는다(quoteDecidedByLabel).
 *    「지정자 대신 처리」 배지는 그대로다 — 배지만 있고 그 이름이 없으면
 *    최고관리자가 비상구로 처리한 줄이라는 뜻이다.
 *
 * 🔴 **표시만 한다.** 이 화면은 아무 문도 여닫지 않는다 — 결재가 끝나기 전에도
 * 견적서는 발행된다(2026-09-18 사용자 결정).
 *
 * 🔴 **단계 수는 그 줄에 적힌 판으로 센다.** 관리자가 절차를 바꾸면 새 판이
 * 얹히고 진행 중이던 건은 옛 판을 끝까지 따라가므로, 이력에는 서로 다른 판을 탄
 * 줄이 섞인다. 현재 판으로 세면 다 끝난 옛 줄이 「2/4단계」로 보여 아직 두
 * 사람이 더 남은 것처럼 읽힌다.
 *
 * 순수한 조각이다 — 서버 액션을 물지 않는다. 그래서 화면 시험이 그대로 렌더해
 * 볼 수 있다(QuoteApprovalPanel 은 액션을 물어 그러지 못한다).
 * ============================================================================
 */

const STATUS_EVENT_LABELS: Record<QuoteApprovalRecordRow["status"], string> = {
  REQUESTED: "결재 요청",
  APPROVED: "승인",
  REJECTED: "반려",
};

function formatTimestamp(iso: string): string {
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

/**
 * 「처리자」 한 마디 — 위임으로 대신 누른 줄이면 **누구 자리였는지**까지 적는다.
 * 아직 처리되지 않은 줄은 `null`(그리는 쪽이 그 자리를 비운다).
 *
 * 🔴 **두 이름이 다 있어야 기록이 복원된다**(2026-10-20 사용자 결정). 누른 사람만
 * 적으면 「왜 저 사람이 눌렀지」가 남지 않고, 맡긴 사람만 적으면 실제로 손을 댄
 * 사람을 영영 못 찾는다 — 표가 두 칸을 함께 남기는 이유 그대로다.
 *
 * 🔴 **괄호가 없는 것에도 뜻이 있다.** 「지정자 대신 처리」 배지가 붙었는데 이
 * 괄호가 없으면 **최고관리자가 비상구로** 처리한 줄이다. 위임으로 대신 누른 줄과
 * 그 줄을 가르는 표시는 이 이름 하나뿐이다(비상구는 위임이 아니라서 표의
 * `delegated_from_user_id` 가 비어 있다 — auth/approval-assignment.ts).
 *
 * 접수 건 쪽 승인 카드(DatabaseApprovalCard 의 decidedByLabel)와 같은 모양이고,
 * 말만 「승인」이 아니라 「처리」다 — 이 자리에는 반려 줄도 온다.
 */
export function quoteDecidedByLabel(
  record: Pick<QuoteApprovalRecordRow, "decidedByName" | "delegatedFromName"> | null
): string | null {
  if (!record?.decidedByName) return null;
  if (!record.delegatedFromName) return record.decidedByName;
  return `${record.decidedByName} (${record.delegatedFromName} 님 자리를 위임받아 처리)`;
}

/**
 * 그 줄이 탄 판의 「n/m단계」. 결재선을 타지 않은 줄에는 `null` 이고, 그때는
 * 아무것도 그리지 않는다. 판을 못 찾았으면(0단계) 앞자리만 적는다 — 「2/」 같은
 * 반쪽짜리를 보여 주지 않는다.
 */
function routeStepLabel(record: QuoteApprovalRecordRow, totalSteps: number): string | null {
  if (!approvalFollowsRoute(record)) return null;
  if (record.routeStepOrder === null) return null;
  return `결재선 ${record.routeStepOrder}${totalSteps > 0 ? `/${totalSteps}` : ""}단계`;
}

export default function QuoteApprovalHistory({
  records,
  routeSteps = [],
}: {
  records: readonly QuoteApprovalRecordRow[];
  /**
   * 이력의 줄들이 가리키는 결재선 판들. 서버(페이지)가 한 번에 읽어 온다.
   * 기본값이 빈 배열인 것은 「판을 못 찾음」과 같은 뜻이다 — 단계 수 없이
   * 앞자리만 적는다.
   */
  routeSteps?: readonly ShipmentApprovalRouteStepList[];
}) {
  // 판 id → 그 판의 전체 단계 수. 화면 안에서만 쓰는 지도다(클라이언트로
  // 내려보내는 값이 아니다 — 그쪽에는 배열로 온다. Map 은 경계를 넘지 못한다).
  const totalStepsByRoute = new Map(routeSteps.map((route) => [route.routeId, route.steps.length]));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {/*
        기본은 펼침이다 — 이 탭에서 이력은 곁다리가 아니라 주인공의 한쪽이다.
        「누가 언제 승인했나」를 되짚으러 오는 자리이므로 한 번 더 누르게 하지
        않는다. 접고 펴는 상태는 자바스크립트가 아니라 브라우저에 맡긴다(저장소 관례).
      */}
      <details open>
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          결재 이력
        </summary>

        {records.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {QUOTE_APPROVAL_EMPTY_HISTORY_TEXT}
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {records.map((record) => {
              const stepLabel = routeStepLabel(
                record,
                (record.routeId && totalStepsByRoute.get(record.routeId)) || 0
              );
              return (
                <li
                  key={record.id}
                  className="break-keep rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {STATUS_EVENT_LABELS[record.status]}
                      {stepLabel && (
                        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          {stepLabel}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatTimestamp(
                        record.status === "REQUESTED"
                          ? record.requestedAt
                          : (record.decidedAt ?? record.requestedAt)
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    요청자: {record.requestedByName}
                    {record.decidedByName && <> · 처리자: {quoteDecidedByLabel(record)}</>}
                    {record.assignedApproverName && <> · 지정: {record.assignedApproverName}</>}
                    {/*
                      지정된 사람과 실제로 처리한 사람이 다를 때만 — 최고관리자가
                      비상구로 대신 처리한 줄이다. 표시가 없으면 지정된 사람이
                      자기 차례에 처리한 건과 구분되지 않는다. 판정은 여기서
                      새로 적지 않고 auth/approval-assignment.ts 의 함수를 부른다.
                    */}
                    {standsInForAssignedApprover(
                      record.assignedApproverUserId,
                      record.decidedByUserId
                    ) && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        지정자 대신 처리
                      </span>
                    )}
                  </p>
                  {record.requestReason && (
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                      요청 사유: &ldquo;{record.requestReason}&rdquo;
                    </p>
                  )}
                  {record.decisionReason && (
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                      결정 사유: &ldquo;{record.decisionReason}&rdquo;
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </details>
    </section>
  );
}
