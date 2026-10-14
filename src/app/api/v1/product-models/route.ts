import { NextResponse, type NextRequest } from "next/server";

import { NO_STORE, checkSharedApiToken } from "@/lib/api/shared-token";
import { listProductModelsForExternalLookup } from "@/lib/db/queries/external-product-models";

/**
 * ============================================================================
 * GET /api/v1/product-models — 제품 모델 목록 (읽기 전용)
 * ============================================================================
 * 부르는 쪽: 재고 관리로 옮긴 O/H 부품 템플릿 화면의 「모델 잇기」 고르개.
 * 모델 마스터의 주인은 A/S 다. 자격은 공유 토큰 하나다 —
 * `lib/api/shared-token.ts` 의 머리 주석.
 *
 *   200  { generatedAt, count, models: [{ id, modelName }] }  모델명 순
 *   401  { error: "unauthorized" }
 *   503  { error: "api_closed" }
 *
 * 지운 모델은 빠진다. 왜 기존 `listUnlinkedProductModels` 를 쓰지 않는지는
 * `lib/db/queries/external-product-models.ts` 의 주석에 있다.
 *
 * 🔴 `id` 는 A/S 의 `product_models.id` 다. 받는 쪽은 이 id 로 모델을 잇는다 —
 * 모델명으로 이으면 A/S 에서 이름을 고치는 날 끊긴다.
 *
 * 설명서: `API_FOR_INTERNAL_SYSTEMS.md`.
 * ============================================================================
 */
export async function GET(request: NextRequest) {
  const denied = checkSharedApiToken(request);
  if (denied) return denied;

  const models = await listProductModelsForExternalLookup();

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), count: models.length, models },
    { headers: NO_STORE }
  );
}
