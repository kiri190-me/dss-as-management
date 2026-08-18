import { productCategoryLabels, type WorkflowType } from "@/lib/domain/types";

/**
 * 제품 구분은 워크플로 유형으로부터 파생되는 표시 전용 값이다. 사용자가
 * 직접 입력해 워크플로 유형과 모순되는 값을 만들 수 없도록 항상 읽기
 * 전용으로만 보여준다.
 *
 * 유상/무상은 더 이상 여기서 파생하지 않는다 — billing_type이 workflowType과
 * 독립적으로 저장되는 실제 필드가 되면서(A/S INTAKE UX 체크포인트), 실제
 * 선택 UI는 IntakeFormInner.tsx의 별도 필수 드롭다운으로 옮겨졌다.
 */
export default function DerivedProductFields({ workflowType }: { workflowType: WorkflowType }) {
  return (
    <div>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">제품 구분</span>
      <p className="text-sm text-zinc-900 dark:text-zinc-50">
        {productCategoryLabels[workflowType]}
      </p>
    </div>
  );
}
