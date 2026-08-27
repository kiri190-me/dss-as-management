import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProductModelDetailScreen from "@/components/product-models/ProductModelDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  listAttachmentsForProductModel,
  listTrashedAttachmentsForProductModel,
} from "@/lib/db/queries/attachments";
import {
  getProductModelDetailById,
  listRequestedPartsByProductModelId,
  toProductModelDetailForScreen,
} from "@/lib/db/queries/product-models";
import { listRepairCasesByProductModelId } from "@/lib/db/queries/repair-cases";

export const metadata: Metadata = {
  title: "제품 모델 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Product Model Master detail (모델 기본정보 + 모델 통계 + 사진·도면 + A/S 이력).
 * `등록 장비` 표는 사용자 결정으로 없앴다 — 근거와 알고 감수한 것은
 * ProductModelDetailScreen 의 헤더 주석에 적어 두었다.
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

  // A/S 이력 구역이 쓰는 두 재료와, 사진·도면 구역이 쓰는 두 목록. 서로 기다릴
  // 이유가 없어 함께 띄운다. 넷 다 읽기 전용이고 같은 product_models.id 로 좁힌다.
  const [repairCases, requestedParts, attachments, trashedAttachments] = await Promise.all([
    listRepairCasesByProductModelId(detail.id),
    listRequestedPartsByProductModelId(detail.id),
    listAttachmentsForProductModel(detail.id),
    listTrashedAttachmentsForProductModel(detail.id),
  ]);

  // 사진·도면을 **올리고 지우는** 권한. 보는 것은 위 productModels.view 로 이미
  // 판정했다(다운로드 라우트도 보기에는 view 를 묻는다) — 좁히는 것은 바꾸는
  // 쪽뿐이다. 화면은 이 boolean 만 받고 역할을 스스로 보지 않는다. 실제 차단은
  // 업로드 라우트와 서버 액션이 각자 다시 한다.
  const [canEdit, canManageFiles] = await Promise.all([
    hasPermission(actingUser.role, "productModels.edit", "WRITE"),
    hasPermission(actingUser.role, "productModels.files", "WRITE"),
  ]);

  // `등록 장비` 표가 사라져 units 를 읽는 화면이 없다. 상세 화면은 "use client"
  // 라 여기서 넘긴 값이 그대로 브라우저까지 실려 가므로, 아무도 읽지 않는 배열은
  // 여기서 덜어 낸다. 재입고(반복 수리) 장비 수는 조회가 이 배열로부터 이미
  // 계산해 둔 값이라 그대로 나온다.
  return (
    <ProductModelDetailScreen
      detail={toProductModelDetailForScreen(detail)}
      repairCases={repairCases}
      requestedParts={requestedParts}
      canEdit={canEdit}
      attachments={attachments}
      trashedAttachments={trashedAttachments}
      canManageFiles={canManageFiles}
    />
  );
}
