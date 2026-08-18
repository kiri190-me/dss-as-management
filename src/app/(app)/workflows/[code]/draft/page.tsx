import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { canEditWorkflowTemplates } from "@/lib/auth/workflow-template-authorization";
import { getWorkflowDraftDetail } from "@/lib/db/queries/workflow-templates";
import { findWorkflowDraft } from "@/lib/db/mutations/workflow-drafts";
import { workflowTypeLabels } from "@/lib/domain/types";
import WorkflowDraftEditor from "@/components/workflows/WorkflowDraftEditor";

export const metadata: Metadata = {
  title: "워크플로 초안 편집 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 초안 편집 화면(Phase 4d). 템플릿당 초안은 하나뿐이므로 URL에 버전 id를 두지
 * 않고 /workflows/[code]/draft 로 고정한다 — 편집 중 주소가 바뀌지 않고,
 * "이어서 편집" 링크도 코드만 알면 만들 수 있다.
 */
export default async function WorkflowDraftPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || !canEditWorkflowTemplates(actingUser.role)) redirect("/dashboard");

  const draftRef = await findWorkflowDraft(code);
  if (!draftRef) notFound();
  const draft = await getWorkflowDraftDetail(draftRef.id);
  if (!draft) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/workflows/${code}`} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          &larr; {workflowTypeLabels[draft.templateCode]}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          초안 편집 (v{draft.versionNumber})
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          발행하기 전까지는 어떤 접수 건에도 영향이 없습니다. 발행하면 <strong>그 이후 접수되는 건부터</strong> 이
          구성이 적용되며, 진행 중인 건은 접수 당시 버전을 그대로 따라갑니다.
        </p>
      </div>

      <WorkflowDraftEditor
        versionId={draft.versionId}
        versionNumber={draft.versionNumber}
        templateCode={draft.templateCode}
        steps={draft.steps}
        validation={draft.validation}
        transitions={draft.transitions}
      />
    </div>
  );
}
