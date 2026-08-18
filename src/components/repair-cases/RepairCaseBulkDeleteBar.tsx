"use client";

/**
 * 전체 A/S 현황(/repair-cases)의 삭제 모드 토글 + 선택 상태 바 —
 * SUPER_ADMIN/ADMIN에게만 렌더링 여부가 결정된다(canBulkDelete, 부모인
 * RepairCaseListPage가 세션/역할을 이미 확인해 넘긴다). 순수 표시/콜백
 * 컴포넌트로, 선택 상태나 삭제 요청 자체는 전혀 소유하지 않는다 — 모든
 * state는 RepairCaseListPage가 소유한다(필터/정렬/페이지네이션과 같은
 * 원칙).
 */
export default function RepairCaseBulkDeleteBar({
  canBulkDelete,
  isDeleteMode,
  selectedCount,
  onEnterDeleteMode,
  onCancel,
  onRequestDelete,
}: {
  canBulkDelete: boolean;
  isDeleteMode: boolean;
  selectedCount: number;
  onEnterDeleteMode: () => void;
  onCancel: () => void;
  onRequestDelete: () => void;
}) {
  if (!canBulkDelete) return null;

  if (!isDeleteMode) {
    return (
      <button
        type="button"
        onClick={onEnterDeleteMode}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        삭제 모드
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950">
      <span className="text-sm font-medium text-red-800 dark:text-red-300">
        삭제 모드 — {selectedCount}건 선택됨
      </span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onRequestDelete}
          disabled={selectedCount === 0}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          선택 삭제
        </button>
      </div>
    </div>
  );
}
