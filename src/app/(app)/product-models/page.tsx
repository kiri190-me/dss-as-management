import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProductModelListScreen from "@/components/product-models/ProductModelListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listProductModels } from "@/lib/db/queries/product-models";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

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
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("productModels");

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

  if (!(await hasPermission(actingUser.role, "productModels.view", "READ"))) {
    return <PlaceholderPage title="제품 모델 관리" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const rows = await listProductModels();

  return <ProductModelListScreen rows={rows} />;
}
