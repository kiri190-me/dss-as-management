import { approvalFollowsRoute, standsInForAssignedApprover } from "@/lib/auth/approval-assignment";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";
import type { ShipmentApprovalRouteStepList } from "@/lib/db/queries/shipment-approval-routes";

const APPROVAL_TYPE_LABELS: Record<ApprovalRecordRow["approvalType"], string> = {
  REPAIR_INSPECTION: "수리 검수 승인",
  FINAL_SHIPMENT: "최종 출하 승인",
};

const STATUS_EVENT_LABELS: Record<ApprovalRecordRow["status"], string> = {
  REQUESTED: "승인 요청",
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
 * 그 줄이 탄 판의 「n/m단계」. 결재선을 타지 않은 줄에는 `null` 이고, 그때는
 * 아무것도 그리지 않는다.
 *
 * 🔴 **단계 수는 그 줄에 적힌 판으로 센다.** 관리자가 절차를 바꾸면 새 판이
 * 얹히고 진행 중이던 건은 옛 판을 끝까지 따라가므로, 이력에는 서로 다른 판을 탄
 * 줄이 섞인다. 현재 판으로 세면 다 끝난 옛 줄이 「2/4단계」로 보여 아직 두 사람이
 * 더 남은 것처럼 읽힌다.
 *
 * 판을 못 찾았으면(0단계) 앞자리만 적는다 — 「2/」 같은 반쪽짜리를 보여 주지
 * 않는 것은 승인 카드와 같다.
 */
function routeStepLabel(record: ApprovalRecordRow, totalSteps: number): string | null {
  if (!approvalFollowsRoute(record)) return null;
  if (record.routeStepOrder === null) return null;
  return `결재선 ${record.routeStepOrder}${totalSteps > 0 ? `/${totalSteps}` : ""}단계`;
}

/**
 * Database-mode counterpart to ApprovalEventTimeline.tsx. Each
 * repair_case_approvals row is itself a permanent request record (no
 * separate events table — see the schema file), so one entry per row
 * already reconstructs the full history; a decided row additionally shows
 * its decision line.
 *
 * ── 🔴 이 화면은 결재 기록이다 ─────────────────────────────────────────────
 * 나중에 「이 건 누가 승인했지」를 되짚는 자리다. 그래서 **누구 차례였는지**와
 * **그 차례를 다른 사람이 대신했는지**가 줄에 남아야 한다. 남지 않으면
 * 최고관리자가 비상구로 처리한 건과 지정된 사람이 자기 차례에 처리한 건이
 * 구분되지 않는다 — 위임으로 대신한 건에는 배지가 남는데 비상구로 넘어간 건에는
 * 아무 표시도 없던 것이 이 화면의 결함이었다.
 */
export default function DatabaseApprovalEventTimeline({
  records,
  routeSteps = [],
}: {
  records: ApprovalRecordRow[];
  /**
   * 이력의 줄들이 가리키는 결재선 판들. 서버(page.tsx)가 한 번에 읽어 온다.
   * 기본값이 빈 배열인 것은 「판을 못 찾음」과 같은 뜻이다 — 단계 수 없이 앞자리만
   * 적는다.
   */
  routeSteps?: ShipmentApprovalRouteStepList[];
}) {
  // 판 id → 그 판의 전체 단계 수. 화면 안에서만 쓰는 지도라 Map 이어도 된다
  // (클라이언트로 내려보내는 값이 아니다 — 그쪽에는 배열로 온다).
  const totalStepsByRoute = new Map(routeSteps.map((route) => [route.routeId, route.steps.length]));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {/*
        기본은 접힘이다 — <details> 에 open 을 달지 않는 것이 그 뜻이다.
        이 구역은 [검수/승인] 탭의 주인공이 아니라 지난 일의 기록이라,
        펼침 상태는 자바스크립트가 아니라 브라우저에 맡긴다(저장소 관례).
      */}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-50">승인 이력</summary>

        {records.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 승인 관련 이력이 없습니다.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {records.map((record) => {
              const stepLabel = routeStepLabel(
                record,
                (record.routeId && totalStepsByRoute.get(record.routeId)) || 0
              );
              return (
                <li key={record.id} className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {APPROVAL_TYPE_LABELS[record.approvalType]} · {STATUS_EVENT_LABELS[record.status]}
                      {stepLabel && (
                        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          {stepLabel}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatTimestamp(record.status === "REQUESTED" ? record.requestedAt : (record.decidedAt ?? record.requestedAt))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    요청자: {record.requestedByName}
                    {record.decidedByName && <> · 처리자: {record.decidedByName}</>}
                    {/*
                      🔴 「지정: ○○○」은 결재선 전용이 아니다 — 검수 승인도 요청할 때
                      「누구에게 보낼까요」를 고를 수 있고, 그 지정 역시 남아야 한다.
                      그래서 판을 보지 않고 지정 칸 하나만 본다.
                    */}
                    {record.assignedApproverName && <> · 지정: {record.assignedApproverName}</>}
                    {record.delegatedFromName && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                        위임 승인 처리
                      </span>
                    )}
                    {/*
                      지정된 사람과 실제로 처리한 사람이 다를 때만. 위임 배지와 같은
                      모양(둥근 알약)에 색만 주의 계열로 다르다 — 위임 행은 지정이
                      NULL 이라 둘이 함께 뜨는 일은 없지만, 겹쳐도 깨지지 않는다.
                    */}
                    {standsInForAssignedApprover(record.assignedApproverUserId, record.decidedByUserId) && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        지정자 대신 처리
                      </span>
                    )}
                  </p>
                  {record.requestReason && (
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">요청 사유: &ldquo;{record.requestReason}&rdquo;</p>
                  )}
                  {record.decisionReason && (
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">결정 사유: &ldquo;{record.decisionReason}&rdquo;</p>
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
