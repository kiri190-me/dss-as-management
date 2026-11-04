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
import { actorMay } from "@/lib/auth/developer-promotion";
import { getProcedureTemplateForEditor, compareDraftWithParent, getFieldAddedStepsForDraft } from "@/lib/db/queries/procedure-template-editor";
import { getProcedureTemplateHistoryView } from "@/lib/db/queries/procedure-template-history";
import {
  canViewAllProcedureTemplateStatuses,
  canViewPublishedProcedureTemplates,
} from "@/lib/auth/procedure-template-authorization";
import {
  mayEditTemplateOfCategory,
  mayCreateDraftVersionOfCategory,
  mayPublishTemplateOfCategory,
} from "@/lib/auth/technical-procedure-capabilities";
import {
  canManageTechnicalTemplates,
  canActorPublishTemplateOfCategory,
  canDeleteTechnicalTemplates,
} from "@/lib/auth/technical-procedure-template-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";

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

  if (!actorMay(actingUser, canViewPublishedProcedureTemplates)) {
    return <PlaceholderPage title="기술 절차 편집기" description="이 화면에 접근할 권한이 없습니다." />;
  }

  if (!UUID_PATTERN.test(id)) notFound();

  const template = await getProcedureTemplateForEditor(id);
  if (!template) notFound();

  if (template.status !== "PUBLISHED" && !actorMay(actingUser, canViewAllProcedureTemplateStatuses)) {
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
          {(await mayCreateDraftVersionOfCategory(actingUser, template.category)) ? (
            <CreateDraftVersionButton templateId={template.id} />
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-600">새 버전 작성 권한이 없습니다.</span>
          )}
        </div>
      </div>
    );
  }

  // status === "DRAFT" from here on.
  const canEdit = await mayEditTemplateOfCategory(actingUser, template.category);

  // ── 게시 단추의 노출 판정 (줄기 B-④) ──────────────────────────────────
  // 🔴 상세 화면 page.tsx 의 canPublish 와 **글자 그대로 같은 세 관문**이다.
  // 한 글자라도 달라지면 "상세에서는 보이는데 편집기에서는 안 보이는"(또는
  // 그 반대의) 단추가 생기고, 사람은 권한이 오락가락한다고 읽는다. 왜 셋을
  // 모두 보는지(역할 고정 둘 + 설정 하나가 서로 다른 답을 낼 수 있다)는
  // src/app/(app)/procedures/[id]/page.tsx 의 같은 자리 주석에 적혀 있다 —
  // 그 어긋남을 어느 쪽으로 정리할지는 아직 결정되지 않았고, 이 조각도
  // 정하지 않는다. 둘 다 만족할 때만 내면 서버가 거절할 단추는 보이지 않는다.
  const canPublish =
    actorMay(actingUser, canManageTechnicalTemplates) &&
    actorMay(actingUser, (role) => canActorPublishTemplateOfCategory(role, template.category)) &&
    (await mayPublishTemplateOfCategory(actingUser, template.category));

  // ── [초안 버리기]의 노출 판정 (줄기 B-⑥) ───────────────────────────────
  // 게시 단추와 **같은 모양**으로 둘을 모두 본다:
  //  ① 역할 고정 canDeleteTechnicalTemplates — softDeleteProcedureTemplate 이
  //     트랜잭션 안에서 실제로 보는 관문 그대로다(분류까지 본다:
  //     TECHNICAL_TASK 가 아니면 어떤 역할로도 통과하지 못한다).
  //  ② 설정 technicalProcedures.lifecycle — 목록 화면(/procedures/technical)의
  //     [삭제 모드]가 쓰는 그 값. 관리자가 설정에서 좁히면 두 화면이 함께 닫혀야
  //     한다. 한쪽만 보면 "목록에서는 안 보이는데 편집기에서는 보이는" 단추가 생긴다.
  // 둘 다 만족할 때만 내므로, 서버가 거절할 단추는 보이지 않는다.
  const canDiscardDraft =
    actorMay(actingUser, (role) => canDeleteTechnicalTemplates(role, template.category)) &&
    (await hasPermission(actingUser, "technicalProcedures.lifecycle", "MANAGE"));

  // 🔵 현장에서 더한 단계(줄기 B-⑧)는 **여기서 읽는다** — 화면이 제 손으로 다시
  //    묻지 않는다. 조회 자체가 「이 초안이 DRAFT 인가」와 「같은 줄기인가」를
  //    보므로(getFieldAddedStepsForDraft), 게시된 절차나 남의 줄기에서는 빈
  //    목록이 돌아오고 탭도 안 선다. 셋을 함께 받는 것은 서로 안 기대기 때문이다.
  const [historyView, comparison, fieldAddedSteps] = await Promise.all([
    getProcedureTemplateHistoryView(template.id),
    compareDraftWithParent(template.id),
    getFieldAddedStepsForDraft(template.id),
  ]);

  return (
    <Suspense fallback={null}>
      <ProcedureTemplateEditorScreen
        template={template}
        historyView={historyView}
        comparison={comparison}
        canEdit={canEdit}
        canPublish={canPublish}
        canDiscardDraft={canDiscardDraft}
        fieldAddedSteps={fieldAddedSteps}
      />
    </Suspense>
  );
}
