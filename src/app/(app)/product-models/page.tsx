import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProductModelListScreen from "@/components/product-models/ProductModelListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { canViewProductModels } from "@/lib/auth/product-model-authorization";
import { listProductModels } from "@/lib/db/queries/product-models";

export const metadata: Metadata = {
  title: "제품 모델 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Product Model Management list — now sourced from the real product_models
 * master table (migration 0030), not a raw products.model_name grouping.
 * Same "database mode only" gate as /customers. canViewProductModels is
 * SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES — INVENTORY_MANAGER gets the same
 * PlaceholderPage "no permission" fallback every other role-gated page
 * uses. Editing (수정 button) is a separate, narrower canEditProductModels
 * gate, decided per-row on the detail page — this list page never edits.
 */
export default async function ProductModelsPage() {
  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="제품 모델 관리"
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

  if (!canViewProductModels(actingUser.role)) {
    return <PlaceholderPage title="제품 모델 관리" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const rows = await listProductModels();

  return <ProductModelListScreen rows={rows} />;
}
