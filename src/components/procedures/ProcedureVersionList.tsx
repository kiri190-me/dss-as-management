import Link from "next/link";
import {
  procedureTemplateStatusLabels,
  type ProcedureTemplateStatus,
} from "@/lib/domain/procedure-template-types";

/**
 * ============================================================================
 * [절차 상세] 안의 **버전 목록**
 * ============================================================================
 * 사용자가 말한 것(2026-11-04): "[절차 상세]에 들어가면 현재 게시되어 있는
 * 플로우차트를 확인할 수 있도록 해주고, 개정 진행중이던 초안이 목록으로 떠서
 * 그 목록을 누르면 초안에 대한 [절차 상세]를 볼 수 있도록 해줘."
 *
 * 그래서 판을 **목록에서 고르는 자리를 상세로 옮겼다.** 목록 화면은 줄기당 한
 * 줄이 되고(TechnicalProcedureSeriesList), 그 줄기의 모든 판은 여기 모인다.
 *
 * ── 🔴 새 라우트를 만들지 않는다 ────────────────────────────────────────
 * 지금 상세 페이지(/procedures/[id])는 상태를 가리지 않고 어느 id 든 받는다.
 * 그래서 각 줄은 그냥 그 판의 상세로 가는 링크다. "초안 전용 상세"를 따로 만들면
 * 같은 화면이 둘이 되고, 한쪽만 고치는 날이 온다.
 *
 * ── 지금 보는 판은 링크가 아니다 ────────────────────────────────────────
 * 제자리로 가는 링크는 눌러도 아무 일이 안 일어나는데, 사람은 눌린 것이 안 먹혔다고
 * 읽는다. 그 줄만 링크를 걷고 `aria-current="page"` 로 표시한다 — 눈으로도,
 * 읽어 주는 장치로도 "여기"가 어디인지 같은 말이 나온다.
 *
 * ── 🔴 권한은 부르는 쪽이 본다 ──────────────────────────────────────────
 * 초안·보관본을 볼 수 없는 역할에게는 **그 줄이 아예 넘어오지 않는다**(페이지가
 * listProcedureTemplateVersions 에 includeAllStatuses=false 를 넘긴다). 여기서
 * 다시 거르지 않는 까닭은 거르는 곳이 둘이 되면 어긋나기 때문이다. 이 조각은
 * 받은 것을 그대로 그린다.
 *
 * ── 이름이 판마다 다를 수 있다 ──────────────────────────────────────────
 * 초안에서는 이름을 고칠 수 있어서, 개정하며 이름을 바꾼 판이 섞일 수 있다.
 * 지금 보는 판과 **다를 때만** 그 판의 이름을 함께 적는다 — 늘 적으면 같은 글자가
 * 세로로 반복되어 다른 줄을 못 보게 된다.
 * ============================================================================
 */

const STATUS_BADGE: Record<ProcedureTemplateStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export type ProcedureVersionListRow = {
  id: string;
  name: string;
  version: number;
  status: ProcedureTemplateStatus;
  createdAt: string;
  publishedAt: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

/** 게시본은 게시일이, 나머지는 생성일이 그 판을 설명하는 날짜다. */
function dateLabel(row: ProcedureVersionListRow): string {
  if (row.status === "PUBLISHED" && row.publishedAt) return `게시 ${formatDate(row.publishedAt)}`;
  return `생성 ${formatDate(row.createdAt)}`;
}

export default function ProcedureVersionList({
  versions,
  currentTemplateId,
}: {
  /** 이 줄기에서 볼 수 있는 모든 판. 판 번호 내림차순으로 넘어온다. */
  versions: ProcedureVersionListRow[];
  currentTemplateId: string;
}) {
  // 페이지가 넘기는 것을 잊었거나(기본값 []), 조회가 빈손으로 왔을 때 빈 상자를
  // 남기지 않는다 — 지금 보고 있는 판 자신은 언제나 그 목록에 들어 있어야
  // 하므로, 비어 있다는 것은 "판이 없다"가 아니라 "안 넘어왔다"는 뜻이다.
  if (versions.length === 0) return null;

  const current = versions.find((row) => row.id === currentTemplateId) ?? null;
  const publishedCount = versions.filter((row) => row.status === "PUBLISHED").length;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        버전 목록 <span className="font-normal text-zinc-500 dark:text-zinc-400">({versions.length}판)</span>
      </h2>
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        같은 절차(코드)의 모든 판입니다. 누르면 그 판의 상세로 이동합니다.
        {publishedCount > 1 && (
          <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">
            게시본이 {publishedCount}개입니다 — 게시는 이전 게시본을 자동으로 내리지 않습니다.
          </span>
        )}
      </p>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {versions.map((row) => {
          const isCurrent = row.id === currentTemplateId;
          const body = (
            <span className="flex flex-wrap items-center gap-2">
              <span className="w-10 shrink-0 font-mono text-sm text-zinc-700 dark:text-zinc-300">v{row.version}</span>
              <span
                className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}
              >
                {procedureTemplateStatusLabels[row.status]}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-500">{dateLabel(row)}</span>
              {current && row.name !== current.name && (
                <span className="truncate text-xs text-zinc-400 dark:text-zinc-600">{row.name}</span>
              )}
              {isCurrent && (
                <span className="ml-auto inline-flex shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  지금 보는 판
                </span>
              )}
            </span>
          );

          return (
            <li key={row.id}>
              {isCurrent ? (
                <div aria-current="page" className="bg-blue-50/40 px-3 py-2 dark:bg-blue-950/30">
                  {body}
                </div>
              ) : (
                <Link
                  href={`/procedures/${row.id}`}
                  className="block px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
