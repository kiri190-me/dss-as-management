import Link from "next/link";
import { SourceBadge } from "@/components/repair-cases/badges";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";

export default function ProductHistoryNotice({ matches }: { matches: RelatedMatch[] }) {
  if (matches.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
    >
      <p className="font-medium">
        동일한 Model + L/N + S/N을 가진 기존 접수 건이 {matches.length}건 있습니다.
      </p>
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        이 안내는 로컬 데모 데이터를 포함한 데모용 단순 매칭이며, 실제 운영 매칭
        로직이 아닙니다.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {matches.map((match) => (
          <li key={match.id}>
            <Link
              href={`/repair-cases/${match.id}`}
              target="_blank"
              className="inline-flex items-center gap-2 underline-offset-2 hover:underline"
            >
              {match.intakeNumber}
              <SourceBadge source={match.source} />
              <span className="text-xs">접수일 {match.receivedAt}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
