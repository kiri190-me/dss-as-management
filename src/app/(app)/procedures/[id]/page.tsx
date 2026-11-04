import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProcedureTemplateDetailScreen from "@/components/procedures/ProcedureTemplateDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  getProcedureTemplateDetail,
  listProcedureTemplateVersions,
  listUndeletableProcedureTemplateIds,
} from "@/lib/db/queries/procedure-templates";
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
import { actorMay } from "@/lib/auth/developer-promotion";

export const metadata: Metadata = {
  title: "기술 절차 템플릿 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProcedureTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authSource = getAuthSource();
  if (authSource !== "database") {
    return (
      <PlaceholderPage
        title="기술 절차 템플릿"
        description="추후 이 화면에서 수리 절차 템플릿을 확인할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!actorMay(actingUser, canViewPublishedProcedureTemplates)) {
    return (
      <PlaceholderPage
        title="기술 절차 템플릿"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  if (!UUID_PATTERN.test(id)) notFound();

  const template = await getProcedureTemplateDetail(id);
  if (!template) notFound();

  // AS_ENGINEER (view-published-only) must never see a DRAFT/ARCHIVED
  // template just by knowing/guessing its id — the list already hides
  // these rows, this is the direct-URL backstop.
  //
  // 🔴 이 한 식이 **이 화면에서 "초안을 볼 수 있는가"의 유일한 답**이다. 아래
  // [버전 목록]도 같은 값을 쓴다 — 두 자리에 각각 적으면 어긋나는 날이 오고,
  // 어긋나는 방향은 둘 다 나쁘다: 느슨하면 못 여는 판이 목록에 떠서 누르는 족족
  // 404 가 되고, 빡빡하면 지금 보고 있는 판이 제 목록에서 사라진다.
  const mayViewEveryStatus = actorMay(actingUser, canViewAllProcedureTemplateStatuses);
  if (template.status !== "PUBLISHED" && !mayViewEveryStatus) {
    notFound();
  }

  // 같은 code 줄기의 판 전부(볼 수 있는 것만). 상세에서 판을 갈아타는 길이다 —
  // 목록 화면이 줄기당 한 줄로 접혔으므로(2026-11-04), 판을 고르는 자리는 여기
  // 하나뿐이다.
  const versions = await listProcedureTemplateVersions(template.code, template.category, mayViewEveryStatus);

  // ── 게시 단추의 노출 판정 ──────────────────────────────────────────────
  // 서버(publishProcedureTemplate)가 트랜잭션 안에서 실제로 보는 두 관문을
  // **그대로** 먼저 본다: 거친 관문 canManageTechnicalTemplates 와 분류별
  // 관문 canActorPublishTemplateOfCategory. 이 둘이 아니라 설정 쪽만 보면
  // "단추는 보이는데 누르면 늘 실패"가 만들어진다 — 커밋 af6da9b·1a75ac7 의
  // 반대 방향 같은 병이다.
  //
  // 🔴 여기에 어긋남이 하나 남아 있다. 설정 기반 판정
  // (mayPublishTemplateOfCategory → technicalProcedures.publish)과 위의 두
  // 역할 고정 함수는 서로 다른 답을 낼 수 있다. 관리자가 설정에서
  // technicalProcedures.publish 를 넓혀도 publishProcedureTemplate 은 여전히
  // 역할 고정으로 막기 때문이다(편집 쪽 mutation 은 이미
  // mayEditTemplateOfCategory 로 전환됐지만, 게시 mutation 은 아직이다).
  //
  // 어느 쪽을 최종 권위로 삼을지는 이 화면이 정할 일이 아니므로, 여기서는
  // **둘 다 만족할 때만** 단추를 낸다. 그러면 서버가 거절할 단추는 절대
  // 보이지 않고(거짓 약속 없음), 설정으로 좁히면 화면에서도 사라진다.
  // 설정으로 "넓히는" 것이 실제로 통하게 하려면 publishProcedureTemplate 을
  // mayPublishTemplateOfCategory 로 전환해야 한다 — 별도 결정 사항이다.
  const canPublish =
    actorMay(actingUser, canManageTechnicalTemplates) &&
    actorMay(actingUser, (role) => canActorPublishTemplateOfCategory(role, template.category)) &&
    (await mayPublishTemplateOfCategory(actingUser, template.category));

  // ── [버전 목록]의 [삭제] 노출 판정 (2026-11-04 사용자 요청) ────────────
  // 🔴 편집기의 [초안 버리기]와 **글자 그대로 같은 두 관문**이다
  //    (/procedures/[id]/edit/page.tsx 의 canDiscardDraft). 한쪽만 고치면
  //    "편집기에서는 되는데 상세에서는 안 되는" 단추가 생긴다.
  //     ① 역할 고정 canDeleteTechnicalTemplates — softDeleteProcedureTemplate 이
  //        트랜잭션 안에서 보는 관문 그대로다(분류까지 본다: TECHNICAL_TASK 가
  //        아니면 어떤 역할로도 통과하지 못한다).
  //     ② 설정 technicalProcedures.lifecycle — 목록 화면의 [삭제 모드]가 쓰는 값.
  const canDeleteVersion =
    actorMay(actingUser, (role) => canDeleteTechnicalTemplates(role, template.category)) &&
    (await hasPermission(actingUser, "technicalProcedures.lifecycle", "MANAGE"));

  // 🔴 「쓰이고 있어 못 지우는 판」은 **서버가 센다.** 목록 화면의 [삭제 모드]가
  //    쓰는 것과 **같은 조회**다 — 세는 잣대가 둘이 되면 화면에는 단추가 있는데
  //    서버는 거절하는 날이 온다.
  //    🔵 권한이 없으면 아예 읽지 않는다(쓸 데가 없는 조회를 매번 하지 않게).
  const referencedVersionIds = canDeleteVersion ? [...(await listUndeletableProcedureTemplateIds())] : [];

  return (
    <Suspense fallback={null}>
      <ProcedureTemplateDetailScreen
        template={template}
        versions={versions}
        canManageValidation={await hasPermission(actingUser, "technicalProcedures.validation", "READ")}
        canCreateDraftVersion={await mayCreateDraftVersionOfCategory(actingUser, template.category)}
        canEditDraft={await mayEditTemplateOfCategory(actingUser, template.category)}
        canPublish={canPublish}
        canDeleteVersion={canDeleteVersion}
        referencedVersionIds={referencedVersionIds}
      />
    </Suspense>
  );
}
