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
  canViewProcedureValidationManagement,
} from "@/lib/auth/procedure-template-authorization";

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

  return (
    <Suspense fallback={null}>
      <ProcedureTemplateDetailScreen
        template={template}
        canManageValidation={canViewProcedureValidationManagement(actingUser.role)}
      />
    </Suspense>
  );
}
