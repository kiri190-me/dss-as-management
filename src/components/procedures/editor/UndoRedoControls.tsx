"use client";

/**
 * Phase 5C-5C UI — the editor toolbar's [이전]/[앞으로] buttons. Purely
 * presentational: canUndo/canRedo always come from the server-derived
 * historyView (see procedure-template-history.ts's own doc comment) —
 * never a client-memory undo stack, never optimistic state that could
 * diverge from the server. Disabled whenever unavailable OR a request is
 * already in flight (either button, since Undo and Redo are mutually
 * exclusive in-flight operations against the same template).
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
