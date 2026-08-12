import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProcedureTemplateEditorScreen from "@/components/procedures/ProcedureTemplateEditorScreen";
import CreateDraftVersionButton from "@/components/procedures/editor/CreateDraftVersionButton";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { getProcedureTemplateForEditor, compareDraftWithParent } from "@/lib/db/queries/procedure-template-editor";
import { getProcedureTemplateHistoryView } from "@/lib/db/queries/procedure-template-history";
import {
  canViewAllProcedureTemplateStatuses,
  canViewPublishedProcedureTemplates,
} from "@/lib/auth/procedure-template-authorization";
import { canActorEditTemplateOfCategory, canActorCreateDraftVersionOfCategory } from "@/lib/auth/technical-procedure-template-authorization";

export const metadata: Metadata = {
  title: "기술 절차 편집기 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Phase 4A controlled editor route. Every rejection case this task
 * requires is enforced here, server-side, before any editor UI ever
 * renders — never left to a client-side guard:
 *   - reference-only templates (no graph to edit at all)
 *   - unauthorized actors (below canViewAllProcedureTemplateStatuses —
 *     same notFound-hides-existence backstop the detail route already
 *     uses for AS_ENGINEER)
 *   - direct editing of a PUBLISHED template (landing screen offers "새
 *     DRAFT 버전 만들기" instead of ever rendering the editor against it)
 *   - invalid/deleted templates (UUID shape check, then a real row check)
 *
 * The mutation layer (procedure-template-editor.ts) re-verifies every one
 * of these independently anyway — this route's checks are the fast UX
 * path, never the sole enforcement boundary.
 */
export default async function ProcedureTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authSource = getAuthSource();
  if (authSource !== "database") {
    return <PlaceholderPage title="기술 절차 편집기" description="추후 이 화면에서 절차 템플릿을 편집할 수 있습니다." />;
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!canViewPublishedProcedureTemplates(actingUser.role)) {
    return <PlaceholderPage title="기술 절차 편집기" description="이 화면에 접근할 권한이 없습니다." />;
  }

  if (!UUID_PATTERN.test(id)) notFound();

  const template = await getProcedureTemplateForEditor(id);
  if (!template) notFound();

  if (template.status !== "PUBLISHED" && !canViewAllProcedureTemplateStatuses(actingUser.role)) {
    notFound();
  }

  if (template.isReferenceOnly) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={`/procedures/${template.id}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
          ← {template.name} 상세로
        </Link>
        <PlaceholderPage title="참고용 템플릿" description="참고용 템플릿은 실행 가능한 절차 노드가 없어 편집할 수 없습니다." />
      </div>
    );
  }

  if (template.status === "ARCHIVED") {
    return (
      <div className="flex flex-col gap-3">
        <Link href={`/procedures/${template.id}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
          ← {template.name} 상세로
        </Link>
        <PlaceholderPage title="보관된 템플릿" description="보관(ARCHIVED)된 템플릿은 편집할 수 없습니다." />
      </div>
    );
  }

  if (template.status === "PUBLISHED") {
    return (
      <div className="flex flex-col gap-4">
        <Link href={`/procedures/${template.id}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
          ← {template.name} 상세로
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{template.name}</h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              게시된 템플릿은 직접 편집할 수 없습니다. 편집하려면 새 DRAFT 버전을 만드세요 — 원본은 그대로 유지됩니다.
            </p>
          </div>
          {canActorCreateDraftVersionOfCategory(actingUser.role, template.category) ? (
            <CreateDraftVersionButton templateId={template.id} />
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-600">새 버전 작성 권한이 없습니다.</span>
          )}
        </div>
      </div>
    );
  }

  // status === "DRAFT" from here on.
  const canEdit = canActorEditTemplateOfCategory(actingUser.role, template.category);
  const [historyView, comparison] = await Promise.all([getProcedureTemplateHistoryView(template.id), compareDraftWithParent(template.id)]);

  return (
    <Suspense fallback={null}>
      <ProcedureTemplateEditorScreen template={template} historyView={historyView} comparison={comparison} canEdit={canEdit} />
    </Suspense>
  );
}
