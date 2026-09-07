import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProcedureTemplateDetailScreen from "@/components/procedures/ProcedureTemplateDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { getProcedureTemplateDetail } from "@/lib/db/queries/procedure-templates";
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
} from "@/lib/auth/technical-procedure-template-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";

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

  if (!canViewPublishedProcedureTemplates(actingUser.role)) {
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
  if (template.status !== "PUBLISHED" && !canViewAllProcedureTemplateStatuses(actingUser.role)) {
    notFound();
  }

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
    canManageTechnicalTemplates(actingUser.role) &&
    canActorPublishTemplateOfCategory(actingUser.role, template.category) &&
    (await mayPublishTemplateOfCategory(actingUser, template.category));

  return (
    <Suspense fallback={null}>
      <ProcedureTemplateDetailScreen
        template={template}
        canManageValidation={await hasPermission(actingUser, "technicalProcedures.validation", "READ")}
        canCreateDraftVersion={await mayCreateDraftVersionOfCategory(actingUser, template.category)}
        canEditDraft={await mayEditTemplateOfCategory(actingUser, template.category)}
        canPublish={canPublish}
      />
    </Suspense>
  );
}
