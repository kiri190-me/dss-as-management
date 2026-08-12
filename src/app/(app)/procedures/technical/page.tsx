import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import TechnicalProcedureTemplateListScreen from "@/components/procedures/TechnicalProcedureTemplateListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { listTechnicalProcedureTemplates } from "@/lib/db/queries/procedure-templates";
import { redirect } from "next/navigation";
import {
  canViewPublishedTechnicalTemplates,
  canViewAllTechnicalTemplateStatuses,
  canManageTechnicalTemplates,
} from "@/lib/auth/technical-procedure-template-authorization";

export const metadata: Metadata = {
  title: "기술 작업 절차 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5C-5B — the TECHNICAL_TASK template library. ADMIN/SUPER_ADMIN see
 * every status and get the create-DRAFT entry point; AS_ENGINEER sees
 * PUBLISHED-only, read-only; SALES/INVENTORY_MANAGER get no access at all
 * (canViewPublishedTechnicalTemplates already excludes both).
 */
export default async function TechnicalProceduresPage() {
  const authSource = getAuthSource();
  if (authSource !== "database") {
    return <PlaceholderPage title="기술 작업 절차" description="추후 이 화면에서 기술 작업 절차를 확인할 수 있습니다." />;
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!canViewPublishedTechnicalTemplates(actingUser.role)) {
    return <PlaceholderPage title="기술 작업 절차" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const templates = await listTechnicalProcedureTemplates(canViewAllTechnicalTemplateStatuses(actingUser.role));

  return <TechnicalProcedureTemplateListScreen templates={templates} canCreate={canManageTechnicalTemplates(actingUser.role)} />;
}
