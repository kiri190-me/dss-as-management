import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import {
} from "@/lib/auth/workflow-template-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { findWorkflowDraft } from "@/lib/db/mutations/workflow-drafts";
import WorkflowApplyCurrentVersion from "@/components/workflows/WorkflowApplyCurrentVersion";
import WorkflowDraftEntry from "@/components/workflows/WorkflowDraftEntry";
import { getWorkflowTemplateDetail } from "@/lib/db/queries/workflow-templates";
import { loadWorkflowRules } from "@/lib/db/queries/workflow-rules";
import { workflowPublishCaseSentencesFromParams } from "@/lib/domain/workflow-publish-counts-param";
import { db } from "@/lib/db/client";
import { getUiText } from "@/lib/server/ui-text";

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
/**
 * done 쿼리는 초안 편집기에서 폐기·발행 후 이동해 올 때만 붙는다. 그 조작들은
 * 화면을 떠나며 끝나므로 편집기 쪽 메시지가 함께 사라지고, 그러면 "됐나?"를
 * 알 수 없다 — 결과를 도착 화면에서 한 번 더 말해 준다.
 *
 * 발행에는 고정 문구 뒤에 **건수 문장**이 이어 붙는다(`?moved=` · `?stranded=`).
 * 발행 한 번에 진행 중인 접수 건 수십 건이 새 버전으로 옮겨지는데, 그 사실이
 * 어디에도 안 보이면 사람이 모른 채 지나간다. 주소에서 온 값은 믿지 않고
 * domain/workflow-publish-counts-param.ts 가 걸러 준다 — 이상하면 그 문장만
 * 빠지고 고정 문구는 그대로 나온다(오류 화면을 띄울 일이 아니다).
 *
 * `applied` 는 이 화면의 "기존 건을 현재 버전으로 적용" 단추가 돌아오는 자리다.
 * 구성을 고치지 않고 건만 옮기므로 고정 문구가 다르고, 뒤에 붙는 건수 문장은
 * 발행과 **같은 것**을 쓴다 — 같은 두 수이기 때문이다.
 */
const DONE_MESSAGES: Record<string, string> = {
  published: "초안을 발행했습니다. 아래 버전 이력에서 새 버전이 '현재'인지 확인하세요.",
  discarded: "초안을 폐기했습니다. 구성은 발행본 그대로입니다.",
  applied: "기존 접수 건을 현재 버전으로 적용했습니다.",
};

/** 접수 건을 옮기는 조작들 — 이것들만 뒤에 건수 문장이 붙는다(폐기는 아니다). */
const DONE_WITH_CASE_COUNTS = new Set(["published", "applied"]);

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ done?: string; moved?: string | string[]; stranded?: string | string[] }>;
}) {
  const { code } = await params;
  const search = await searchParams;
  const { done } = search;
  const doneMessage =
    done && DONE_MESSAGES[done]
      ? [
          DONE_MESSAGES[done],
          // 건수는 건을 옮긴 조작에만 붙는다 — 폐기는 접수 건을 옮기지 않는다.
          ...(DONE_WITH_CASE_COUNTS.has(done) ? workflowPublishCaseSentencesFromParams(search) : []),
        ].join(" ")
      : null;

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || !(await hasPermission(actingUser, "workflows.view", "READ"))) redirect("/dashboard");

  // 초안은 편집 권한이 있는 사람에게만 읽어 온다 — 아래에서 두 번 쓰이므로
  // 한 번만 묻는다.
  const mayEditDraft = await hasPermission(actingUser, "workflows.editDraft", "WRITE");
  // "기존 건을 현재 버전으로 적용"은 발행과 같은 무게다 — 수십 건의 접수 건이
  // 한 번에 움직인다. 🔴 화면에서 감추는 것만으로는 막은 것이 아니므로,
  // mutation(applyCurrentWorkflowVersionToCases)이 같은 권한을 다시 판정한다.
  const mayPublish = await hasPermission(actingUser, "workflows.publish", "MANAGE");

  const detail = await getWorkflowTemplateDetail(code);
  if (!detail) notFound();

  const currentVersion = detail.versions.find((v) => v.isCurrent && v.status === "PUBLISHED") ?? null;
  const rules = currentVersion ? await loadWorkflowRules(db, currentVersion.id) : null;
  const draft = mayEditDraft ? await findWorkflowDraft(code) : null;

  // 제목의 워크플로 종류 이름과 단계 목록의 상태 배지 — 저장된 문구를 따른다.
  const uiText = await getUiText();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/workflows" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          &larr; 워크플로 관리
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {uiText.workflowType[detail.code]}
        </h1>
        <p className="mt-1 font-mono text-xs text-zinc-400 dark:text-zinc-500">{detail.code}</p>
      </div>

      {doneMessage && (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
        >
          {doneMessage}
        </p>
      )}

      {mayEditDraft && (
        <WorkflowDraftEntry
          templateCode={detail.code}
          hasDraft={draft !== null}
          draftVersionNumber={draft?.versionNumber ?? null}
          canCreate={currentVersion !== null}
        />
      )}

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
        {/*
          위 표의 "접수 건" 칸이 옛 버전에 남아 있는 건을 이미 보여 준다 — 그것을
          지금 판으로 끌어오는 단추를 바로 아래에 둔다. 권한이 없거나 현재 발행
          버전이 없으면 아예 그리지 않는다(적용할 목적지가 없다).
        */}
        {mayPublish && currentVersion && detail.inFlightCases && (
          <WorkflowApplyCurrentVersion
            templateCode={detail.code}
            versionNumber={currentVersion.versionNumber}
            migratableCaseCount={detail.inFlightCases.migratableCaseCount}
            strandedCaseCount={detail.inFlightCases.strandedCaseCount}
          />
        )}
        {detail.caseScopedVersionCount > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            이 워크플로를 바탕으로 만든 <strong>접수 건 전용 변주</strong>가 {detail.caseScopedVersionCount}건 있습니다.
            해당 접수 건에서만 쓰이므로 위 목록에는 넣지 않았습니다 — 그래서 버전 번호가 중간에 건너뛸 수 있습니다.
          </p>
        )}
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
                      {uiText.repairStatus[step.status]}
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
