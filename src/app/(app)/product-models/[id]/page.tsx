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
import { listCustomerOptions } from "@/lib/db/queries/customers";
import {
  getProductModelDetailById,
  listRequestedPartsByProductModelId,
  listUsedPartsByProductModelId,
  toProductModelDetailForScreen,
} from "@/lib/db/queries/product-models";
import { listShareDocsForProductModel } from "@/lib/db/queries/product-model-share-docs";
import { listRepairCasesByProductModelId } from "@/lib/db/queries/repair-cases";
import { toPartPickerOptions } from "@/lib/domain/inventory-gateway";
import {
  buildFaultPartInventoryIndex,
  toFaultPartRows,
} from "@/lib/domain/product-model-fault-parts";
import { buildUsedPartNameIndex } from "@/lib/domain/used-part-display";
import { fetchInventoryParts } from "@/lib/server/inventory-gateway";
import { fetchIssuedFaultPartRows } from "@/lib/server/product-model-issued-parts";

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

  if (!(await hasPermission(actingUser, "productModels.view", "READ"))) {
    return <PlaceholderPage title="제품 모델 상세" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const detail = await getProductModelDetailById(id);
  if (!detail) {
    notFound();
  }

  // 사진·도면을 **올리고 지우는** 권한. 보는 것은 위 productModels.view 로 이미
  // 판정했다(다운로드 라우트도 보기에는 view 를 묻는다) — 좁히는 것은 바꾸는
  // 쪽뿐이다. 화면은 이 boolean 만 받고 역할을 스스로 보지 않는다. 실제 차단은
  // 업로드 라우트와 서버 액션이 각자 다시 한다.
  //
  // 아래 자료 조회보다 **먼저** 묻는다 — 고객사 후보 목록을 내려보낼지 말지가
  // canEdit 에 달려 있기 때문이다(다음 묶음의 마지막 줄).
  const [canEdit, canManageFiles] = await Promise.all([
    hasPermission(actingUser, "productModels.edit", "WRITE"),
    hasPermission(actingUser, "productModels.files", "WRITE"),
  ]);

  // A/S 이력 구역이 쓰는 재료들과, 사진·도면 구역이 쓰는 두 목록, 가리킴 목록,
  // 그리고 수정 폼의 고객사 콤보박스가 고를 목록. 서로 기다릴 이유가 없어 함께
  // 띄운다. 전부 읽기 전용이다.
  //
  // 🔴 고객사 후보는 **수정할 수 있는 세션에만** 내려보낸다. 상세 화면은
  // "use client" 라 여기서 넘긴 값이 그대로 브라우저까지 실려 가는데, 그 목록을
  // 읽는 것은 ProductModelEditForm 하나뿐이고 그 폼은 canEdit 일 때만 뜬다 —
  // 아무도 열 수 없는 폼을 위해 고객사 대장 전체를 모든 열람자의 브라우저로
  // 보낼 이유가 없다(이 파일이 units 를 덜어 낸 것과 같은 판단이다). 권한 자체를
  // 새로 만들지는 않았다: productModels.edit 하나로 폼도 후보 목록도 함께
  // 열린다. 최종 차단은 언제나처럼 updateProductModelAction 이 다시 한다.
  //
  // 🔴 **공유폴더(디스크)를 여기서 읽지 않는다.** 가리킴 목록(shareDocs)은 표에 적힌
  // 경로 줄일 뿐이라 DB 한 번이고, 그 자리에 실제로 무엇이 있는지를 들여다보는 일은
  // 화면이 뜬 뒤 클라이언트가 통로로 따로 묻는다
  // (components/product-models/ModelShareFolderPicker). NAS 가 느린 날 이 화면 자체가
  // 안 뜨는 것을 막는 선이고, 종류별 서류함 page.tsx 가 그은 선과 같다.
  //
  // 🔴 **재고 관리 통로가 이 묶음에 하나 더 있다**(2026-10-29). [고장 부품] 그래프의
  // 이름표가 「고객사 품명 (품번)」이 되면서 그 이름을 재고 관리에서 가져온다 —
  // A/S 의 부품 표에도 사용 부품 줄에도 고객사 품명 칸이 **없다**
  // (domain/used-part-display.ts 머리말의 「왜 이름을 재고 관리에서 가져오는가」).
  // 🔵 **못 받아 와도 이 화면은 그대로 뜬다** — 아래 색인이 비고 모든 줄이 품번으로
  // 떨어질 뿐이다. 그래서 실패를 따로 다루지 않고 같은 묶음에 태운다(수리 건 상세가
  // 같은 통로를 같은 방식으로 부른다).
  //
  // 🔴 **그 통로와 달리 둘째 통로는 실패를 그냥 넘기면 안 된다**(2026-10-29).
  // fetchIssuedFaultPartRows 는 그래프의 셋째 입력(반출 확인된 부품)을 **건마다** 물어
  // 모은다. 위 부품 목록을 못 받으면 이름만 품번으로 떨어지지만, 이쪽을 못 받으면
  // **줄 자체가 사라진다** — 그래서 「못 센 건이 몇인가」를 세어 화면까지 날라야 한다
  // (아래 faultPartIssuedLookup).
  //
  // 🔴 **접수 건 목록만 먼저 읽는다**(2026-10-29). [고장 부품] 그래프의 셋째 입력
  // (반출 확인된 부품)을 모으려면 **그 건들의 인수번호**가 먼저 있어야 하고, 그 모으는
  // 일이 통로를 여러 번 두드리는 일이라 이 묶음에서 가장 오래 걸린다 —
  // 묶음 **뒤에** 이어 붙이면 그 시간이 통째로 더해진다. 🔵 앞으로 빼면 DB 한 번
  // (수십 ms)만 먼저 치르고 나머지와 **겹쳐서** 돈다.
  // 🔴 **새 DB 조회를 만들지 않았다** — 인수번호는 이 목록이 이미 들고 있다.
  const repairCases = await listRepairCasesByProductModelId(detail.id);

  const [
    requestedParts,
    usedParts,
    issuedParts,
    inventoryParts,
    attachments,
    trashedAttachments,
    customerOptions,
    shareDocs,
  ] = await Promise.all([
    listRequestedPartsByProductModelId(detail.id),
    listUsedPartsByProductModelId(detail.id),
    fetchIssuedFaultPartRows(repairCases),
    fetchInventoryParts(),
    listAttachmentsForProductModel(detail.id),
    listTrashedAttachmentsForProductModel(detail.id),
    canEdit ? listCustomerOptions() : Promise.resolve([]),
    listShareDocsForProductModel(detail.id),
  ]);

  /**
   * [고장 부품] 그래프가 셀 줄 — 🔴 **요청 부품 · 사용 부품 · 반출 확인된 부품을 더한
   * 것**이다(2026-10-29 사용자 요청: 「리페어 리포트에서 읽어들인 것들과 [a/s시스템]에서
   * 부품요청 한 부품들을 **포함해서**」, 그리고 같은 날 셋째로 「반출 확인된 부품」).
   * 어느 하나를 다른 것으로 갈아 끼운 것이 아니다.
   *
   * 🔴 **합치는 일을 서버에서 한다.** 이름표를 만드는 규칙이 연락서 판독기를 물고
   *    있고 상세 화면은 "use client" 라, 화면에서 합치면 그 판독기가 통째로 브라우저
   *    묶음에 실린다(domain/product-model-fault-parts.ts 머리말). 화면에는
   *    **만들어진 글자**만 내려간다.
   * 🔴 **겹치면 다 센다** — 그 판단의 까닭도 저 파일 머리말에 있다.
   */
  const faultParts = toFaultPartRows(
    { requested: requestedParts, used: usedParts, issued: issuedParts.rows },
    buildUsedPartNameIndex(toPartPickerOptions(inventoryParts))
  );

  /**
   * 🔴 **조각을 누르면 펼칠 재고 관리 줄** (2026-10-29 사용자 요청: 「고장 부품을 누르면
   * 그 아랫부분에 **그 부품의 전체 이름과 현재 재고 등을** 구체적으로」).
   *
   * 🔴 **새 조회를 하지 않는다** — 바로 위에서 이름표를 만드느라 이미 받아 온 그 목록
   *    (`inventoryParts`)을 그대로 쓴다. 통로는 이 화면에 여전히 한 번이다.
   * 🔴 **좁혀서 넘긴다.** 위 `toPartPickerOptions` 는 재고·소유·비고를 **떼어 내는** 길이라
   *    (그쪽 머리말 — 견적서·사용 부품 화면의 경계다) 여기서는 쓸 수 없다. 대신 그래프에
   *    실제로 뜬 열쇠의 줄만 골라 담는다(`buildFaultPartInventoryIndex` 머리말).
   * 🔴 **거르기 전 전체 줄**을 넘긴다. 년/월 거르기는 전부 화면 안의 계산이라, 기간을
   *    바꿀 때 서버를 다시 부르지 않는다 — 걸러서 넘기면 다른 달을 고른 순간 재고가 사라진다.
   */
  const faultPartInventory = buildFaultPartInventoryIndex(inventoryParts, faultParts);

  /**
   * 🔴 **못 센 건이 몇인가**를 화면까지 나른다. 반출 쪽만 「일부만 받아 오는」 일이
   * 생기는데(건마다 통로를 한 번씩 두드린다), 그 사실을 안 적으면 사람이 적은 수를
   * 보고 **「이 모델은 이 부품이 적게 고장난다」**는 틀린 결론을 낸다.
   * 🔵 줄(`rows`)은 위에서 이미 썼으므로 여기서는 **수만** 내려보낸다 — 상세 화면은
   *    "use client" 라 넘긴 값이 그대로 브라우저까지 실려 간다.
   */
  const faultPartIssuedLookup = {
    uncountedCaseCount: issuedParts.uncountedCaseCount,
    timedOutCaseCount: issuedParts.timedOutCaseCount,
    timeBudgetMs: issuedParts.timeBudgetMs,
  };

  // `등록 장비` 표가 사라져 units 를 읽는 화면이 없다. 상세 화면은 "use client"
  // 라 여기서 넘긴 값이 그대로 브라우저까지 실려 가므로, 아무도 읽지 않는 배열은
  // 여기서 덜어 낸다. 재입고(반복 수리) 장비 수는 조회가 이 배열로부터 이미
  // 계산해 둔 값이라 그대로 나온다.
  return (
    <ProductModelDetailScreen
      detail={toProductModelDetailForScreen(detail)}
      repairCases={repairCases}
      faultParts={faultParts}
      faultPartIssuedLookup={faultPartIssuedLookup}
      faultPartInventory={faultPartInventory}
      canEdit={canEdit}
      customerOptions={customerOptions}
      attachments={attachments}
      trashedAttachments={trashedAttachments}
      shareDocs={shareDocs}
      canManageFiles={canManageFiles}
    />
  );
}
