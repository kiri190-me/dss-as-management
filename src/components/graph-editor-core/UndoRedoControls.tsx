"use client";

/**
 * 편집기 도구모음의 [이전]/[앞으로] 버튼 — 순수 표시 전용이다(어떤 되돌리기
 * 체계인지 전혀 모른다). 두 편집기가 함께 쓰므로 graph-editor-core에 있다.
 *
 * canUndo/canRedo의 출처는 화면마다 다르다: 절차 편집기는 저장 전 변경이 있으면
 * 클라이언트 스냅샷 스택(graph-editor-core/undo-stack.ts)을, 다 되돌린 뒤에는
 * 서버 이력(procedure-template-history.ts)을 쓴다. 진단 Flowchart 편집기는
 * 서버 이력이 없어 클라이언트 스택만 쓴다. 어느 쪽이든 이 컴포넌트는 넘겨받은
 * 값 그대로 렌더링할 뿐, 스스로 상태를 만들지 않는다.
 *
 * 요청이 진행 중이면(둘은 같은 대상에 대해 동시에 일어날 수 없다) 양쪽 다 비활성.
 */
export default function UndoRedoControls({
  canUndo,
  canRedo,
  isUndoing,
  isRedoing,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const busy = isUndoing || isRedoing;
  return (
    <>
      <button type="button" onClick={onUndo} disabled={!canUndo || busy} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
        {isUndoing ? "되돌리는 중..." : "이전"}
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo || busy} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
        {isRedoing ? "다시 적용 중..." : "앞으로"}
      </button>
    </>
  );
}
