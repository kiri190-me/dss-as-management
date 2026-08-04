export default function DraftStatusLine({ savedAtLabel }: { savedAtLabel: string | null }) {
  return (
    <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
      {savedAtLabel ? `마지막 저장: ${savedAtLabel}` : "아직 저장된 임시 작성 내용이 없습니다."}
    </p>
  );
}
