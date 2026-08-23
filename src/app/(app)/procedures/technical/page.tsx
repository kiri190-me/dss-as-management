import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import TechnicalProcedureTemplateListScreen from "@/components/procedures/TechnicalProcedureTemplateListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  listDeletedTechnicalProcedureTemplates,
  listTechnicalProcedureTemplates,
  listUndeletableProcedureTemplateIds,
} from "@/lib/db/queries/procedure-templates";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

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
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("technicalProcedures");

  const authSource = getAuthSource();
  if (authSource !== "database") {
    return <PlaceholderPage title="기술 작업 절차" description="추후 이 화면에서 기술 작업 절차를 확인할 수 있습니다." />;
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!(await hasPermission(actingUser.role, "technicalProcedures.view", "READ"))) {
    return <PlaceholderPage title="기술 작업 절차" description="이 화면에 접근할 권한이 없습니다." />;
  }

  // 초안까지 보이는 것과 초안을 고칠 수 있는 것은 같은 권한이다 — 볼 수 없는
  // 초안을 고칠 수는 없고, 고칠 수 있는데 안 보이면 화면이 쓸모없다.
  const mayEditDraft = await hasPermission(actingUser.role, "technicalProcedures.editDraft", "WRITE");

  // 삭제·복원 권한(기본값: 관리자 이상)이 있는 세션에만 휴지통과 "지금 지울 수
  // 없는 절차" 목록을 읽는다 — 다른 마스터 화면과 같은 규칙이다. 화면에서
  // 감추는 것은 편의일 뿐 경계가 아니므로, 삭제 mutation은 이 판정과 무관하게
  // 트랜잭션 안에서 역할과 **분류**를 다시 본다.
  const canDelete = await hasPermission(actingUser.role, "technicalProcedures.lifecycle", "MANAGE");
  const [templates, trashTemplates, undeletableIds] = await Promise.all([
    listTechnicalProcedureTemplates(mayEditDraft),
    canDelete ? listDeletedTechnicalProcedureTemplates() : Promise.resolve([]),
    canDelete ? listUndeletableProcedureTemplateIds() : Promise.resolve(new Set<string>()),
  ]);

  return (
    <TechnicalProcedureTemplateListScreen
      templates={templates}
      canCreate={mayEditDraft}
      canDelete={canDelete}
      trashTemplates={trashTemplates}
      undeletableIds={[...undeletableIds]}
    />
  );
}
