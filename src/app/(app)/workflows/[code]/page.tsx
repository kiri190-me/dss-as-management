import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { canViewWorkflowTemplates } from "@/lib/auth/workflow-template-authorization";
import { getWorkflowTemplateDetail } from "@/lib/db/queries/workflow-templates";
import { loadWorkflowRules } from "@/lib/db/queries/workflow-rules";
import { db } from "@/lib/db/client";
import { repairStatusLabels, workflowTypeLabels } from "@/lib/domain/types";

export const metadata: Metadata = {
  title: "워크플로 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const VERSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안",
  PUBLISHED: "발행됨",
  ARCHIVED: "보관됨",
};

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL: "기술",
  BUSINESS: "영업",
  PARTS_SHIPMENT: "부품·출하",
};

const ACTION_LABELS: Record<string, string> = {
  STEP_ADVANCED: "진행",
  STEP_RETURNED: "되돌리기",
  SHIPMENT_COMPLETED: "출하 완료",
};

/**
 * Phase 3 — 한 워크플로의 버전 이력과 현재 발행 버전의 단계 구성.
 *
 * 단계마다 "여기서 어디로 갈 수 있는가"를 함께 보여준다. 단계 목록만으로는
 * 실제 흐름을 알 수 없기 때문이다 — 이 앱의 워크플로는 순서대로 한 칸씩
 * 가는 것이 아니라 전이 규칙이 정하는 대로 움직인다.
 */
export default async function WorkflowDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || !canViewWorkflowTemplates(actingUser.role)) redirect("/dashboard");

  const detail = await getWorkflowTemplateDetail(code);
  if (!detail) notFound();

  const currentVersion = detail.versions.find((v) => v.isCurrent && v.status === "PUBLISHED") ?? null;
  const rules = currentVersion ? await loadWorkflowRules(db, currentVersion.id) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/workflows" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          &larr; 워크플로 관리
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {workflowTypeLabels[detail.code]}
        </h1>
        <p className="mt-1 font-mono text-xs text-zinc-400 dark:text-zinc-500">{detail.code}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">버전 이력</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">버전</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 text-right font-medium">단계</th>
                <th className="px-3 py-2 text-right font-medium">이동 규칙</th>
                <th className="px-3 py-2 text-right font-medium">접수 건</th>
                <th className="px-3 py-2 font-medium">만든 사람</th>
              </tr>
            </thead>
            <tbody>
              {detail.versions.map((version) => (
                <tr key={version.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2 tabular-nums text-zinc-900 dark:text-zinc-50">
                    v{version.versionNumber}
                    {version.isCurrent && (
                      <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-400">
                        현재
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {VERSION_STATUS_LABELS[version.status] ?? version.status}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {version.stepCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {version.transitionCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {version.caseCount}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{version.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!rules ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          발행된 현재 버전이 없습니다. 신규 접수는 이 워크플로에 배정되지 않으며, 과거 접수 건의 이력은
          그대로 남아 있습니다.
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              단계 구성 (v{currentVersion?.versionNumber})
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              각 단계에서 갈 수 있는 곳과, 그 이동을 누가 할 수 있는지입니다.
            </p>
          </div>
          <ol className="flex flex-col gap-2">
            {rules.steps.map((step) => {
              const outgoing = rules.transitions.filter((t) => t.fromStepKey === step.key);
              return (
                <li
                  key={step.key}
                  className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                      {String(step.order).padStart(2, "0")}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{step.label}</span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {repairStatusLabels[step.status]}
                    </span>
                    {step.category && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        담당 {CATEGORY_LABELS[step.category]}
                      </span>
                    )}
                    {!step.isActive && <span className="text-xs text-amber-700 dark:text-amber-500">비활성</span>}
                  </div>

                  {outgoing.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      이 단계에서 나가는 이동 규칙이 없습니다.
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1">
                      {outgoing.map((transition) => (
                        <li key={transition.id} className="text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {ACTION_LABELS[transition.actionCode] ?? transition.actionCode}
                          </span>{" "}
                          &rarr; {rules.stepByKey.get(transition.toStepKey)?.label ?? transition.toStepKey}
                          <span className="ml-2 text-zinc-400 dark:text-zinc-500">
                            {transition.allowedRoles.join(", ")}
                            {transition.requiresAssignedEngineer && " · 담당자만"}
                            {transition.requiresReason && " · 사유 필수"}
                            {transition.requiredApprovalType && " · 승인 필요"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
