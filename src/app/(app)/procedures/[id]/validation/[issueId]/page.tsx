import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ValidationIssueDetailScreen from "@/components/procedures/validation/ValidationIssueDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  getValidationIssueDetail,
  getValidationResolutionHistory,
  listTemplateNodesForBinding,
} from "@/lib/db/queries/procedure-validation-resolutions";
import { hasPermission } from "@/lib/auth/permission-resolver";

export const metadata: Metadata = {
  title: "검증 이슈 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProcedureValidationIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string; issueId: string }>;
}) {
  const { id, issueId } = await params;

  const authSource = getAuthSource();
  if (authSource !== "database") {
    return <PlaceholderPage title="검증 이슈 상세" description="추후 이 화면에서 검증 이슈를 확인할 수 있습니다." />;
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!(await hasPermission(actingUser, "technicalProcedures.validation", "READ"))) {
    return <PlaceholderPage title="검증 이슈 상세" description="이 화면에 접근할 권한이 없습니다." />;
  }

  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(issueId)) notFound();

  const issue = await getValidationIssueDetail(issueId);
  if (!issue || issue.procedureTemplateId !== id) notFound();

  const [history, nodeOptions] = await Promise.all([
    getValidationResolutionHistory(issueId),
    listTemplateNodesForBinding(issue.procedureTemplateId),
  ]);

  return (
    <ValidationIssueDetailScreen
      issue={issue}
      history={history}
      nodeOptions={nodeOptions}
      canResolve={await hasPermission(actingUser, "technicalProcedures.validation", "WRITE")}
    />
  );
}
