import type { ExceptionStatus } from "@/lib/domain/types";
import { useUiText } from "@/components/providers/UiTextProvider";

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
  /*
    문구는 DB 의 exception_statuses.label 에서 온다 — 그 표에 code·label 이
    이미 있는데 이 화면이 코드 표를 읽고 있어서 진실이 둘이었다. 그 이중 진실을
    닫은 것이고, 코드 표(types.ts 의 exceptionStatusLabels)는 지운 것이 아니라
    **기본값·되돌림용**으로 남아 있다: DB 에 그 코드의 행이 없거나 마이그레이션
    전이면 그 값이 그대로 나온다(domain/ui-text.ts).

    RepairCaseDetailView("use client") 아래에서만 렌더되므로 훅을 쓸 수 있다.
  */
  const uiText = useUiText();

  if (!exceptionStatus) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <p className="font-medium">예외 상태: {uiText.exceptionStatus[exceptionStatus]}</p>
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        이 예외 상태는 워크플로 진행 단계와 독립적으로 부여됩니다.
      </p>
    </div>
  );
}
