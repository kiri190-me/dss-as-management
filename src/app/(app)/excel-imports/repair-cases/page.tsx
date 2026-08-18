import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import RepairCaseExcelImportScreen from "@/components/excel-imports/RepairCaseExcelImportScreen";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getExcelImportPreviewPage } from "@/lib/db/queries/excel-import-preview";
import { parseExcelImportPreviewFilter } from "@/lib/domain/excel-import-preview-filter";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "수리품 목록 Excel 이관 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function RepairCaseExcelImportPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; page?: string; notice?: string; filter?: string }>;
}) {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("repairCaseExcelImport");

  if (getAuthSource() !== "database") {
    return <PlaceholderPage title="수리품 목록 Excel 이관" description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다." />;
  }
  const session = await readSession();
  if (!session) redirect("/login");
  const actor = await resolveActingUserForSession(session);
  if (!actor) redirect("/login");
  if (!canManageExcelImports(actor.role)) {
    return <PlaceholderPage title="수리품 목록 Excel 이관" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const params = await searchParams;
  const notice = params.notice === "created" || params.notice === "reused" || params.notice === "reset" || params.notice === "refresh" ? params.notice : undefined;
  if (!params.batch) return <RepairCaseExcelImportScreen preview={null} notice={notice} />;
  if (!UUID_PATTERN.test(params.batch)) {
    return <RepairCaseExcelImportScreen preview={null} notice={notice} previewError="Preview를 찾을 수 없습니다." />;
  }
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const filter = parseExcelImportPreviewFilter(params.filter);
  const result = await getExcelImportPreviewPage({ batchId: params.batch, actorUserId: actor.id, page, filter });
  if (!result.ok) {
    const message = result.code === "DATABASE_UNAVAILABLE" ? "Preview를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." : "Preview를 찾을 수 없거나 접근할 권한이 없습니다.";
    return <RepairCaseExcelImportScreen preview={null} notice={notice} previewError={message} />;
  }
  return <RepairCaseExcelImportScreen preview={result.value} notice={notice} />;
}
