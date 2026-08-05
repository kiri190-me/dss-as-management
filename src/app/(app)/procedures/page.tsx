import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProcedureTemplateListScreen from "@/components/procedures/ProcedureTemplateListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { listProcedureTemplates } from "@/lib/db/queries/procedure-templates";
import {
  canViewAllProcedureTemplateStatuses,
  canViewPublishedProcedureTemplates,
} from "@/lib/auth/procedure-template-authorization";

export const metadata: Metadata = {
  title: "기술 절차 템플릿 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 2 read-only procedure-template list. Same "no meaning outside
 * database mode" pattern as /users — this feature is entirely a
 * database-mode capability (imported from the Excel workbook, Phase 1/2
 * reports). SALES/INVENTORY_MANAGER get the placeholder, matching this
 * task's permission table (no access unless an existing project rule
 * already grants it, and none does).
 */
export default async function ProceduresPage() {
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

  const templates = await listProcedureTemplates(canViewAllProcedureTemplateStatuses(actingUser.role));

  return <ProcedureTemplateListScreen templates={templates} />;
}
