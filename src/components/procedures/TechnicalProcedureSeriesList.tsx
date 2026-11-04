import Link from "next/link";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import { ListCard } from "@/components/common/list-card";
import {
  procedureEquipmentTypeLabels,
  procedureTemplateStatusLabels,
  type ProcedureEquipmentType,
} from "@/lib/domain/procedure-template-types";
import type {
  ProcedureTemplateSeries,
  ProcedureTemplateSeriesMember,
} from "@/lib/domain/procedure-template-series";

/**
 * ============================================================================
 * [기술 작업 절차] 목록 — **계열(code)당 한 줄**
 * ============================================================================
 * 사용자 신고(2026-11-04): "같은 이름의 절차들이 버전만 다르게 있으면 오히려
 * 버전 관리가 어려워진다." 접는 규칙 자체는 순수 함수에 있다
 * (@/lib/domain/procedure-template-series). 이 파일은 **접은 결과를 무엇으로
 * 보여 줄지**만 정한다.
 *
 * ── 한 줄이 말해야 하는 것 ──────────────────────────────────────────────
 * 버전 관리에서 사람이 목록에 묻는 것은 둘이다 — "지금 쓰이는 판은 무엇인가",
 * "누가 고치고 있는 중인가". 그래서 칸을 그 둘로 세웠다(지금 게시 · 진행 중
 * 초안). 나머지 판은 세어서 "N판"으로만 적고, 전부 펼쳐 보는 자리는 상세의
 * [버전 목록]이다.
 *
 * ── 🔴 게시본이 둘인 줄기를 감추지 않는다 ───────────────────────────────
 * 🔵 2026-11-04 부터 게시는 같은 계열의 옛 게시본을 **같은 트랜잭션 안에서**
 * [만료됨]으로 내린다. 그래서 게시본이 둘인 줄기는 이제 **새로 만들어지지
 * 않는다** — 떠 있다면 그 규칙이 생기기 전의 줄기다(개발 DB 의 code "7").
 * 그래도 표시를 걷지 않는다: 남아 있는 동안은 "어느 판이 쓰이는지"를 목록에서
 * 알 수 없는 것이 그대로이고, 접기가 **문제를 덮는 일**이 되면 안 된다. 그래서
 * 호박색 표시를 달고 판 번호를 전부 적으며, 치우는 길(한 번 더 게시)을 함께
 * 적는다.
 *
 * ── 🔴 초안은 받은 것만 그린다 ──────────────────────────────────────────
 * 초안을 볼 수 없는 역할에게는 조회가 초안 행을 아예 안 준다. 그래서 여기서
 * 권한을 다시 보지 않는다 — draftMember 가 null 이면 칸은 "-" 이고, "초안이
 * 있다"는 사실조차 화면에 나타나지 않는다.
 *
 * ── 이 파일이 서버 액션을 안 무는 까닭 ──────────────────────────────────
 * 부모(TechnicalProcedureTemplateListScreen)는 휴지통 서버 액션을 직접
 * import 해서 사슬 끝에 `server-only` 가 있다 — 시험에서 import 자체가 던진다.
 * 그려지는 것을 **렌더해서** 재려고 이 조각만 떼어 두었다. 그래서 여기에는
 * 액션도 상태도 없다(부모가 넘긴 것만 그린다).
 * ============================================================================
 */

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

const BADGE_BASE = "inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

/** 여러 게시본이 함께 살아 있는 줄기에 다는 표시. */
const MULTI_PUBLISHED_BADGE =
  "inline-flex shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400";

/** 목록 한 줄이 쓰는 칸. 조회 행(TechnicalProcedureTemplateListRow)이 이 모양을 만족한다. */
export type TechnicalProcedureSeriesRow = ProcedureTemplateSeriesMember & {
  name: string;
  equipmentType: ProcedureEquipmentType;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  publishedAt: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

/** 게시본이 둘 이상일 때 "v1 · v2" 처럼 판 번호를 전부 적는다 — 어느 판들이 함께 떠 있는지가 알맹이다. */
function publishedVersionList(series: ProcedureTemplateSeries<TechnicalProcedureSeriesRow>): string {
  return series.members
    .filter((m) => m.status === "PUBLISHED")
    .map((m) => `v${m.version}`)
    .join(" · ");
}

function PublishedCell({ series }: { series: ProcedureTemplateSeries<TechnicalProcedureSeriesRow> }) {
  if (!series.publishedMember) {
    // 🔴 "게시 없음"을 빈 칸으로 두지 않는다. 빈 칸은 "모른다"로 읽히는데,
    // 여기서는 **한 번도 게시한 적이 없다**는 분명한 사실이다.
    return <span className="text-xs text-zinc-400 dark:text-zinc-600">게시 없음</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Link
        href={`/procedures/${series.publishedMember.id}`}
        className={`${BADGE_BASE} ${STATUS_BADGE.PUBLISHED} hover:underline`}
      >
        v{series.publishedMember.version}
      </Link>
      {series.publishedCount > 1 && (
        <span className={MULTI_PUBLISHED_BADGE} title="한 절차에 게시본은 하나여야 합니다 — 상세에서 쓸 판을 한 번 더 게시하면 나머지가 [만료됨]으로 내려갑니다">
          게시본 {series.publishedCount}개 — {publishedVersionList(series)}
        </span>
      )}
    </span>
  );
}

function DraftCell({ series }: { series: ProcedureTemplateSeries<TechnicalProcedureSeriesRow> }) {
  if (!series.draftMember) return <span className="text-xs text-zinc-400 dark:text-zinc-600">-</span>;
  return (
    <Link
      href={`/procedures/${series.draftMember.id}`}
      className={`${BADGE_BASE} ${STATUS_BADGE.DRAFT} hover:underline`}
      aria-label={`${series.representative.name} 초안 v${series.draftMember.version} 상세`}
    >
      v{series.draftMember.version} {procedureTemplateStatusLabels.DRAFT}
    </Link>
  );
}

function VersionCountCell({ series }: { series: ProcedureTemplateSeries<TechnicalProcedureSeriesRow> }) {
  return (
    <span className="flex flex-col">
      <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{series.members.length}판</span>
      {series.archivedCount > 0 && (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
          {procedureTemplateStatusLabels.ARCHIVED} {series.archivedCount}
        </span>
      )}
    </span>
  );
}

export default function TechnicalProcedureSeriesList({
  series,
}: {
  series: ProcedureTemplateSeries<TechnicalProcedureSeriesRow>[];
}) {
  return (
    <ResponsiveList
      listId="technical-procedures"
      measureKey={[series.length, false]}
      table={
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">설비 유형</th>
              <th className="px-3 py-2 font-medium">지금 게시</th>
              <th className="px-3 py-2 font-medium">진행 중 초안</th>
              <th className="px-3 py-2 font-medium">판 수</th>
              <th className="px-3 py-2 font-medium">노드 / 분기 수</th>
              <th className="px-3 py-2 font-medium">생성 / 게시일</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr
                key={s.code}
                className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/procedures/${s.representative.id}`}
                    className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {s.representative.name}
                  </Link>
                  <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{s.code}</div>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {procedureEquipmentTypeLabels[s.representative.equipmentType]}
                </td>
                <td className="px-3 py-2">
                  <PublishedCell series={s} />
                </td>
                <td className="px-3 py-2">
                  <DraftCell series={s} />
                </td>
                <td className="px-3 py-2">
                  <VersionCountCell series={s} />
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {s.representative.nodeCount} / {s.representative.edgeCount}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">
                  {formatDate(s.representative.createdAt)} / {formatDate(s.representative.publishedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      cards={
        <ul className={LIST_CARD_GRID}>
          {series.map((s) => (
            <ListCard
              key={s.code}
              href={`/procedures/${s.representative.id}`}
              title={s.representative.name}
              badge={
                <span className={`${BADGE_BASE} ${STATUS_BADGE[s.representative.status]}`}>
                  {procedureTemplateStatusLabels[s.representative.status]} v{s.representative.version}
                </span>
              }
              fields={[
                { label: "코드", value: <span className="font-mono">{s.code}</span> },
                { label: "설비", value: procedureEquipmentTypeLabels[s.representative.equipmentType] },
                // 🔴 카드 제목이 이미 링크다. 그 안에 또 링크를 두면 <a> 가
                // 겹쳐 하이드레이션이 깨지므로, 카드에서는 판 번호를 글자로만
                // 적는다(누르는 자리는 표 보기와 상세의 [버전 목록]에 있다).
                {
                  label: "지금 게시",
                  value: s.publishedMember
                    ? `v${s.publishedMember.version}${s.publishedCount > 1 ? ` (게시본 ${s.publishedCount}개 — ${publishedVersionList(s)})` : ""}`
                    : "게시 없음",
                },
                {
                  label: "초안",
                  value: s.draftMember ? `v${s.draftMember.version} ${procedureTemplateStatusLabels.DRAFT}` : "-",
                },
                {
                  label: "판 수",
                  value: `${s.members.length}판${s.archivedCount > 0 ? ` (${procedureTemplateStatusLabels.ARCHIVED} ${s.archivedCount})` : ""}`,
                },
                {
                  label: "노드/분기",
                  value: (
                    <span className="tabular-nums">
                      {s.representative.nodeCount} / {s.representative.edgeCount}
                    </span>
                  ),
                },
                { label: "생성", value: formatDate(s.representative.createdAt) },
              ]}
            />
          ))}
        </ul>
      }
    />
  );
}
