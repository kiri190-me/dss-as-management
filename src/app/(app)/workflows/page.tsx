import type { Metadata } from "next";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import { ListCard } from "@/components/common/list-card";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listWorkflowTemplateSummaries } from "@/lib/db/queries/workflow-templates";
import { workflowTypeLabels } from "@/lib/domain/types";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "워크플로 관리 | DSS A/S 관리 시스템",
};

// 버전·단계·접수 건 수를 매 요청 시점에 세므로 정적 캐시 대상이 아니다.
export const dynamic = "force-dynamic";

/**
 * Phase 3 — 워크플로 기본 틀 조회. 읽기 전용이며, 편집/발행은 Phase 4·5다.
 *
 * 접수 건 수를 함께 보여주는 이유는 편집 판단의 첫 정보이기 때문이다.
 * 250건이 걸린 워크플로와 0건짜리 아카이브 워크플로를 같은 무게로 다룰 수 없다.
 */
export default async function WorkflowsPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("workflows");

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || !(await hasPermission(actingUser, "workflows.view", "READ"))) redirect("/dashboard");

  const templates = await listWorkflowTemplateSummaries();
  const active = templates.filter((t) => !t.isArchived);
  const archived = templates.filter((t) => t.isArchived);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">워크플로 관리</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          접수 건이 따라 흐르는 단계 구성과 이동 규칙입니다. 발행된 버전의 구성은 바꿀 수 없고, 새 버전을
          만들어 발행하는 방식으로 변경합니다.
        </p>
      </div>

      <WorkflowTable title="사용 중" rows={active} />
      {archived.length > 0 && (
        <WorkflowTable
          title="사용 안 함"
          description="발행된 현재 버전이 없어 신규 접수가 배정되지 않습니다. 과거 접수 건의 이력은 그대로 남아 있습니다."
          rows={archived}
        />
      )}
    </div>
  );
}

function WorkflowTable({
  title,
  description,
  rows,
}: {
  title: string;
  description?: string;
  rows: Awaited<ReturnType<typeof listWorkflowTemplateSummaries>>;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {description && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      <ResponsiveList
        listId="workflows"
        table={
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">워크플로</th>
              <th className="px-3 py-2 font-medium">현재 버전</th>
              <th className="px-3 py-2 text-right font-medium">단계</th>
              <th className="px-3 py-2 text-right font-medium">이동 규칙</th>
              <th className="px-3 py-2 text-right font-medium">진행 중 접수 건</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link
                    href={`/workflows/${row.code}`}
                    className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                  >
                    {workflowTypeLabels[row.code]}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">{row.code}</span>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {row.currentVersionNumber === null ? "없음" : `v${row.currentVersionNumber}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{row.stepCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {row.transitionCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                  {row.activeCaseCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        }
        cards={
          <ul className={LIST_CARD_GRID}>
            {rows.map((row) => (
              <ListCard
                key={row.code}
                href={`/workflows/${row.code}`}
                title={workflowTypeLabels[row.code]}
                badge={
                  <span className="shrink-0 whitespace-nowrap rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {row.currentVersionNumber === null ? "버전 없음" : `v${row.currentVersionNumber}`}
                  </span>
                }
                fields={[
                  { label: "코드", value: <span className="font-mono">{row.code}</span> },
                  { label: "단계", value: <span className="tabular-nums">{row.stepCount}</span> },
                  { label: "이동 규칙", value: <span className="tabular-nums">{row.transitionCount}</span> },
                  {
                    label: "진행 중",
                    value: <span className="tabular-nums">{row.activeCaseCount}건</span>,
                  },
                ]}
              />
            ))}
          </ul>
        }
      />
    </section>
  );
}
