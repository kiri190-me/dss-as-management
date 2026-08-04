import { HoldBadge, OverdueBadge, SourceBadge } from "@/components/repair-cases/badges";

/**
 * Stage F-1 전용 순수 프레젠테이션 컴포넌트다. 훅을 쓰지 않고, localStorage나
 * 세션 쿠키를 읽지 않으며, mock/local 접수 건을 직접 조회하지 않는다.
 * 모든 값은 호출부(향후 ReportScreen, use-report-data.ts 결과를 가공한 값)가
 * 이미 계산해 props로 넘겨준다 — 이 컴포넌트는 RepairCaseReportData 전체를
 * 알 필요가 없다(현재 상태 라벨/워크플로 단계 라벨처럼 이미 문자열로 해석된
 * 값만 받는다). 리댁션 적용, window.print() 호출도 이 컴포넌트의 책임이
 * 아니다.
 */

const neutralBadgeClass =
  "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * activity/format.ts의 formatActivityDateTime은 파싱 실패 시 원본 문자열을
 * 그대로 반환하지만, 보고서 헤더에서는 그 상태를 "정보 없음"으로 명확히
 * 드러내야 한다(Stage F-1 요구사항). 그 차이 때문에 공용 포매터를 고치는
 * 대신 이 파일 전용의 작은 포매터를 따로 둔다. 항상 인자로 받은 generatedAt만
 * 파싱하며, 인자 없는 new Date()로 "지금"을 대체값으로 쓰지 않는다.
 */
function formatGeneratedAt(generatedAt: string): string {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return "정보 없음";
  }
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type ReportHeaderSummaryProps = {
  intakeNumber: string;
  reportTitle: string;
  generatedAt: string;
  generatedByName: string | null;
  currentStatusLabel: string;
  currentWorkflowStepLabel: string;
  source: "MOCK" | "LOCAL_DEMO";
  proposedFilename: string;
  isOnHold: boolean;
  isOverdue: boolean;
};

export default function ReportHeaderSummary({
  intakeNumber,
  reportTitle,
  generatedAt,
  generatedByName,
  currentStatusLabel,
  currentWorkflowStepLabel,
  source,
  proposedFilename,
  isOnHold,
  isOverdue,
}: ReportHeaderSummaryProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {intakeNumber} · {reportTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={source} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 수리 상태</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className={neutralBadgeClass}>{currentStatusLabel}</span>
            <HoldBadge isOnHold={isOnHold} />
            <OverdueBadge isOverdue={isOverdue} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 워크플로 단계</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{currentWorkflowStepLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">생성 일시</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{formatGeneratedAt(generatedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">생성자</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{generatedByName ?? "정보 없음"}</dd>
        </div>
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">제안 파일명</dt>
          <dd className="mt-0.5 font-mono text-xs break-all select-text text-zinc-900 sm:text-sm dark:text-zinc-50">
            {proposedFilename}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        브라우저 인쇄 기반 데모 보고서입니다. 실제 서버 생성 PDF가 아닙니다.
      </p>
    </div>
  );
}
