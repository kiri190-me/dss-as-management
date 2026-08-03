import { exceptionStatusLabels, type ExceptionStatus } from "@/lib/domain/types";

/**
 * 예외 상태는 워크플로 진행(WorkflowProgress)과 완전히 별개의 축이다.
 * 이 컴포넌트는 워크플로 단계 컴포넌트와 형제(sibling)로만 렌더링하며,
 * 특정 단계의 상태로 병합하지 않는다.
 */
export default function ExceptionStatusNotice({
  exceptionStatus,
}: {
  exceptionStatus: ExceptionStatus | null;
}) {
  if (!exceptionStatus) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <p className="font-medium">예외 상태: {exceptionStatusLabels[exceptionStatus]}</p>
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        이 예외 상태는 워크플로 진행 단계와 독립적으로 부여됩니다.
      </p>
    </div>
  );
}
