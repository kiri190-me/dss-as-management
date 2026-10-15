import "server-only";
import { getProductModelIdForProduct } from "@/lib/db/queries/repair-cases";
import { getRequestCaseContext } from "@/lib/db/queries/inventory-part-requests";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
import {
  NO_PORTAL_ID_MESSAGE,
  type InventoryOhTemplate,
  type InventoryResult,
} from "@/lib/domain/inventory-gateway";
import {
  fetchInventoryOhTemplate,
  fetchInventoryParts,
  fetchInventoryStockRequestsByIntake,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 수리 건 상세 「부품 요청」 칸의 재료 — 🔴 **전부 재고 관리에서 온다** (2026-10-15)
 * ============================================================================
 * A/S DB 에서 읽는 것은 **이 건의 맥락 하나**(`getRequestCaseContext`)와 **올리는 사람의
 * 포털 번호**뿐이다. 부품 목록 · O/H 템플릿 · 올린 신청은 저쪽 통로에서 받는다. A/S 의 재고
 * 표는 한 줄도 읽지 않는다 — 운영에서 쓰이지 않고 있었고, 다음 조각에서 걷어낸다.
 *
 * 🔵 **페이지가 아니라 여기 둔 까닭**: `[id]/page.tsx` 는 이미 열 가지 조회가 지나는 자리라,
 *    이 칸의 재료까지 그 안에서 풀면 「어디까지가 이 칸의 일인가」가 흐려진다. 조각 13 에서
 *    옛 표를 걷어낼 때 고칠 자리도 이 파일 하나로 모인다.
 *
 * 🔴 **셋을 나란히 부른다**(`Promise.all`). 차례로 기다리면 저쪽이 느린 날 이 화면이
 *    통로 수만큼 느려진다 — 서로 기다릴 까닭이 없는 조회다.
 * 🔴 **못 받아 온 것을 빈 목록으로 바꾸지 않는다.** 결과를 `InventoryResult` 그대로
 *    내려보내고, 「없다」와 「모른다」를 화면이 다르게 그린다.
 * ============================================================================
 */
export async function loadPartRequestSectionData(params: {
  repairCaseId: string;
  intakeNumber: string;
  /** 제품 **개체**의 id. 없는 건이 있다(mock 에서 온 건·개체가 안 붙은 건). */
  productId: string | null;
  actingUserId: string;
}) {
  // 🔵 제품 모델이 안 붙은 개체는 O/H 템플릿을 **물을 열쇠가 없다** — 저쪽을 부르지 않고
  //    「이어 둔 템플릿이 없다」로 둔다. 오류가 아니라 사실이다.
  const productModelId = params.productId === null ? null : await getProductModelIdForProduct(params.productId);

  const ohTemplatePromise: Promise<InventoryResult<InventoryOhTemplate | null>> =
    productModelId === null
      ? Promise.resolve({ status: "ok", value: null })
      : fetchInventoryOhTemplate(productModelId);

  const [caseContext, requesterSub, parts, ohTemplate, requests] = await Promise.all([
    getRequestCaseContext(params.repairCaseId),
    // 🔴 포털 번호 **자체는 화면으로 내려보내지 않는다** — 있고 없고만 보낸다. 신원 증명에
    //    쓰이는 값이라 props 에 실으면 모든 화면에서 브라우저로 나간다(저쪽 저장소의
    //    `approval/directory.ts` 가 같은 까닭으로 `selectable` 한 칸만 내려보낸다).
    getSsoSubjectForUser(params.actingUserId),
    fetchInventoryParts(),
    ohTemplatePromise,
    fetchInventoryStockRequestsByIntake(params.intakeNumber),
  ]);

  return {
    caseContext,
    parts,
    ohTemplate,
    requests,
    requesterGate: requesterSub
      ? ({ ok: true } as const)
      : ({ ok: false, message: NO_PORTAL_ID_MESSAGE } as const),
  };
}
