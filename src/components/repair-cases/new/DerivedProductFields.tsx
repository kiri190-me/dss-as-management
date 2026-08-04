import { paidOrWarrantyLabels, productCategoryLabels, type WorkflowType } from "@/lib/domain/types";

/**
 * 제품 구분 / 유상·무상은 워크플로 유형으로부터 파생되는 표시 전용 값이다.
 * 사용자가 직접 입력해 워크플로 유형과 모순되는 값을 만들 수 없도록 항상
 * 읽기 전용으로만 보여준다.
 */
export default function DerivedProductFields({ workflowType }: { workflowType: WorkflowType }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">제품 구분</span>
        <p className="text-sm text-zinc-900 dark:text-zinc-50">
          {productCategoryLabels[workflowType]}
        </p>
      </div>
      <div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">유상/무상</span>
        <p className="text-sm text-zinc-900 dark:text-zinc-50">
          {paidOrWarrantyLabels[workflowType]}
        </p>
      </div>
    </div>
  );
}
