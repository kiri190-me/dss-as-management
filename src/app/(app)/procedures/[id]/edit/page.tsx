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
import { getProcedureTemplateForEditor, compareDraftWithParent, getFieldAddedStepsForDraft } from "@/lib/db/queries/procedure-template-editor";
import { getProcedureTemplateHistoryView } from "@/lib/db/queries/procedure-template-history";
import { listNextProcedureLinkCandidates } from "@/lib/db/queries/procedure-templates";
import {
  mayEditTemplateOfCategory,
  mayCreateDraftVersionOfCategory,
  mayDeleteTemplateOfCategory,
  mayPublishTemplateOfCategory,
  mayViewSomeTemplate,
  mayViewTemplateOfCategory,
  mayViewEveryTemplateStatusOfCategory,
} from "@/lib/auth/technical-procedure-capabilities";
// 🔵 2026-11-27 — `actorMay` 와 `hasPermission` 이 이 화면에서 사라졌다. 역할 고정
//    함수도, 설정을 직접 묻는 줄도 **한 곳도 안 남았다**는 뜻이다 — 판정은 전부 위
//    창구들을 거친다. 여기에 둘 중 하나를 다시 들이면 서버와 어긋날 자리가 생긴다.

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
 *   - unauthorized actors (below mayViewEveryTemplateStatusOfCategory —
 *     same notFound-hides-existence backstop the detail route already
 *     uses. 🔴 2026-11-27 부터 기술 절차 가지는 **설정**이 정한다; 그전에는
 *     역할 고정 canViewAllProcedureTemplateStatuses 였고 그래서 설정으로
 *     열어 준 엔지니어가 제 초안을 못 열었다)
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

  // 🔴 2026-11-27 — 상세 화면 page.tsx 의 같은 자리와 **글자 그대로 같다**(그쪽 주석에
  //    까닭 전문). 행을 읽기 전이라 분류를 모르므로 거친 관문이고, 분류별 관문은 아래에서.
  if (!(await mayViewSomeTemplate(actingUser))) {
    return <PlaceholderPage title="기술 절차 편집기" description="이 화면에 접근할 권한이 없습니다." />;
  }

  if (!UUID_PATTERN.test(id)) notFound();

  const template = await getProcedureTemplateForEditor(id);
  if (!template) notFound();

  // 🔴 분류별 관문 — 기술 절차는 설정이, 나머지 분류는 공용 정책이 판정한다.
  if (!(await mayViewTemplateOfCategory(actingUser, template.category))) notFound();

  // 🔴 2026-11-27(ㄱ안) — 역할 고정 canViewAllProcedureTemplateStatuses 에서 **분류별**
  // 판정으로 바뀌었다. 이 줄이 「만들기를 열어 준 사람이 만든 직후 404 를 보는」 자리였다:
  // 만들기 창이 성공하면 곧바로 이 route 로 밀어 넣는데(CreateTechnicalTemplateForm 의
  // router.push), 방금 만든 행은 DRAFT 라 여기서 걸렸다.
  // 🔵 상세 화면 page.tsx 와 **같은 함수**다. 전체 서비스·참고용 가지는 종전 그대로.
  if (template.status !== "PUBLISHED" && !(await mayViewEveryTemplateStatusOfCategory(actingUser, template.category))) {
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
  // 🔴 상세 화면 page.tsx 의 canPublish 와 **글자 그대로 같은 관문**이다. 한
  // 글자라도 달라지면 "상세에서는 보이는데 편집기에서는 안 보이는"(또는 그
  // 반대의) 단추가 생기고, 사람은 권한이 오락가락한다고 읽는다.
  //
  // 🔴 2026-11-27 — 셋이 하나가 되었다. 그 전까지 역할 고정 둘과 설정 하나를
  // AND 로 묶었던 까닭과, 지금 그럴 필요가 없어진 까닭은
  // src/app/(app)/procedures/[id]/page.tsx 의 같은 자리 주석에 전문이 있다.
  const canPublish = await mayPublishTemplateOfCategory(actingUser, template.category);

  // ── [초안 버리기]의 노출 판정 (줄기 B-⑥) ───────────────────────────────
  // 게시 단추와 **같은 모양**으로, 서버(softDeleteProcedureTemplate)가 트랜잭션
  // 안에서 실제로 보는 **그 함수**를 그대로 부른다. 상세 화면 page.tsx 의
  // canDeleteVersion 과도 글자 그대로 같아야 한다 — 다르면 "상세에서는 되는데
  // 편집기에서는 안 되는" 단추가 생긴다.
  //
  // 🔴 2026-11-27 — 둘이 하나가 되었다(까닭 전문은 상세 화면의 같은 자리 주석).
  // 🔵 **분류 조건은 안 풀렸다** — 그 함수가 TECHNICAL_TASK 를 먼저 묻는다.
  const canDiscardDraft = await mayDeleteTemplateOfCategory(actingUser, template.category);

  // 🔵 현장에서 더한 단계(줄기 B-⑧)는 **여기서 읽는다** — 화면이 제 손으로 다시
  //    묻지 않는다. 조회 자체가 「이 초안이 DRAFT 인가」와 「같은 줄기인가」를
  //    보므로(getFieldAddedStepsForDraft), 게시된 절차나 남의 줄기에서는 빈
  //    목록이 돌아오고 탭도 안 선다. 셋을 함께 받는 것은 서로 안 기대기 때문이다.
  // 🔵 「다음 절차」 후보(줄기 B ④ 조각 ②) — 거르는 일은 조회가 한다
  //    (게시본 · 기술작업 · 참고용 아님 · 자기 계열 제외). 화면이 다시 거르지
  //    않는 까닭은, 잣대가 둘이 되면 고를 수 있는데 저장이 거절하는 날이 오기
  //    때문이다. 자기 계열을 빼려면 code 가 필요해 template 을 읽은 뒤에 부른다.
  const [historyView, comparison, fieldAddedSteps, nextProcedureCandidates] = await Promise.all([
    getProcedureTemplateHistoryView(template.id),
    compareDraftWithParent(template.id),
    getFieldAddedStepsForDraft(template.id),
    listNextProcedureLinkCandidates(template.code),
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
        nextProcedureCandidates={nextProcedureCandidates}
      />
    </Suspense>
  );
}
