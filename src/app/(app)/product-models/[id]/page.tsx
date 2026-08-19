import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProductModelDetailScreen from "@/components/product-models/ProductModelDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getProductModelDetailById } from "@/lib/db/queries/product-models";
import { listRepairCasesByProductModelId } from "@/lib/db/queries/repair-cases";

export const metadata: Metadata = {
  title: "제품 모델 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Product Model Master detail (모델 기본정보 + 모델 통계 + 등록 장비 + A/S 이력).
 * The route segment is now product_models.id — a real surrogate key, not
 * the model_name string the phase-1 read-only version used (that route was
 * explicitly a stand-in until a real master table existed; it now does).
 * canViewProductModels gates the whole page; canEditProductModels
 * (narrower, SUPER_ADMIN/ADMIN only) is passed down as a UX hint only —
 * updateProductModelAction re-verifies it independently regardless of what
 * this page decided to render.
 */
export default async function ProductModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="제품 모델 상세"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    redirect("/login");
  }

  if (!(await hasPermission(actingUser.role, "productModels.view", "READ"))) {
    return <PlaceholderPage title="제품 모델 상세" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const detail = await getProductModelDetailById(id);
  if (!detail) {
    notFound();
  }

  const repairCases = await listRepairCasesByProductModelId(detail.id);

  return (
    <ProductModelDetailScreen
      detail={detail}
      repairCases={repairCases}
      canEdit={await hasPermission(actingUser.role, "productModels.edit", "WRITE")}
    />
  );
}
