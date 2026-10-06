import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProductModelListScreen from "@/components/product-models/ProductModelListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listDeletedProductModels, listProductModels } from "@/lib/db/queries/product-models";
import { countAttachmentsByProductModelKind } from "@/lib/db/queries/product-model-kind-attachments";
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

  if (!(await hasPermission(actingUser, "productModels.view", "READ"))) {
    return <PlaceholderPage title="제품 모델 관리" description="이 화면에 접근할 권한이 없습니다." />;
  }

  // 삭제·복원 권한(기본값: 관리자 이상)이 있는 세션에만 휴지통을 읽는다 —
  // /customers와 같은 규칙이다. 화면에서 감추는 것은 편의일 뿐 경계가
  // 아니므로, 삭제 서버 액션은 이 판정과 무관하게 다시 검사한다.
  const canDelete = await hasPermission(actingUser, "productModels.lifecycle", "MANAGE");
  // 「종류별 공통 서류」 입구가 보일 숫자도 여기서 센다(2026-10-06). 🔴 **서버가
  // 센 수만 내려보낸다** — 서류 목록 자체는 보내지 않는다. 이 화면은 숫자를 적기만
  // 하고, 서류는 종류 서류함(/product-models/kinds/{코드})에서 읽는다.
  //
  // 세는 데 쓰는 권한을 따로 묻지 않는다: 이 수를 보는 조건은 모델 목록을 보는
  // 조건과 같고(둘 다 productModels.view), 그 판정은 바로 위에서 이미 끝났다.
  // 서류를 실제로 열고 받는 것은 각자 다시 판정한다(내려받기 라우트).
  const [rows, trashRows, kindAttachmentCounts] = await Promise.all([
    listProductModels(),
    canDelete ? listDeletedProductModels() : Promise.resolve([]),
    countAttachmentsByProductModelKind(),
  ]);

  return (
    <ProductModelListScreen
      rows={rows}
      trashRows={trashRows}
      canDelete={canDelete}
      kindAttachmentCounts={kindAttachmentCounts}
    />
  );
}
