import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import ProcedureExecutionScreen from "@/components/procedures/execution/ProcedureExecutionScreen";
import DatabaseModeOnlyNotice from "@/components/procedures/execution/DatabaseModeOnlyNotice";
import {
  getActiveExecutionForCase,
  getExecutionDetail,
  getExecutionHistory,
  getExecutableTemplateOptions,
  getRelatedRepairHistory,
} from "@/lib/db/queries/procedure-case-execution";

export const metadata: Metadata = {
  title: "표준 절차 실행 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5A — repair-case procedure execution tab. Database-mode only: the
 * feature is genuinely greenfield (procedure_case_executions has a real FK
 * to repair_cases.id, which mock/local-demo ids never satisfy), so a
 * local/mock repair case shows a short explanatory notice instead of a
 * broken local variant, same as this codebase's other DB-only features
 * report their mode requirement rather than silently failing.
 */
export default async function RepairCaseExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const actingUser: ActingUser | null = await resolveActingUserForSession(session);

  if (isLocalId(id)) {
    return <DatabaseModeOnlyNotice />;
  }

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) {
    notFound();
  }

  if (resolved.source !== "DATABASE") {
    return <DatabaseModeOnlyNotice />;
  }

  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  const activeExecution = await getActiveExecutionForCase(resolved.id);

  if (!activeExecution) {
    const templateOptions = await getExecutableTemplateOptions();
    return (
      <ProcedureExecutionScreen
        repairCaseId={resolved.id}
        actingUser={actingUser}
        activeExecution={null}
        templateOptions={templateOptions}
        executionDetail={null}
        history={[]}
        relatedHistory={{ sameProduct: [], sameModelReference: [] }}
      />
    );
  }

  const [executionDetail, history, relatedHistory] = await Promise.all([
    getExecutionDetail(activeExecution.id),
    getExecutionHistory(activeExecution.id),
    resolved.productId
      ? getRelatedRepairHistory(resolved.id, resolved.productId)
      : Promise.resolve({ sameProduct: [], sameModelReference: [] }),
  ]);

  return (
    <ProcedureExecutionScreen
      repairCaseId={resolved.id}
      actingUser={actingUser}
      activeExecution={activeExecution}
      templateOptions={[]}
      executionDetail={executionDetail}
      history={history}
      relatedHistory={relatedHistory}
    />
  );
}
