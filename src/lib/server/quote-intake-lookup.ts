import "server-only";
import { lookupIntakeForQuote, type QuoteIntakeCase } from "@/lib/db/queries/quotes";
import { getProductModelIdForProduct } from "@/lib/db/queries/repair-cases";
import type { InventoryOhTemplate, InventoryResult } from "@/lib/domain/inventory-gateway";
import {
  toQuoteOhTemplate,
  toQuoteUsedParts,
  type QuoteOhTemplate,
  type QuoteUsedPart,
} from "@/lib/domain/quote-intake-parts";
import {
  fetchInventoryOhTemplate,
  fetchInventoryParts,
  fetchInventoryStockRequestsByIntake,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 견적서의 「인수번호로 불러오기」 — 🔴 부품은 **재고 관리에서** 받아 온다 (2026-10-16)
 * ============================================================================
 * A/S DB 에서 읽는 것은 **그 수리 건의 머리 몇 칸**(고객사 · 모델명 · L/N · S/N · 신고증상)과
 * **제품 개체 id** 뿐이다(`lookupIntakeForQuote`). 출고된 부품과 O/H 템플릿은 저쪽 통로에서
 * 받는다 — 2026-10 조각 10~12 에서 그 둘이 재고 관리로 옮겨갔고, A/S 의 재고 표에는 더 이상
 * 아무것도 쌓이지 않는다. 받아 온 것을 **어떻게 읽는가**는 순수 쪽
 * (`lib/domain/quote-intake-parts.ts`)에 있고, 여기는 망과 차례만 다룬다.
 *
 * ── 🔵 질의 모듈이 아니라 여기 둔 까닭 ──────────────────────────────────────
 * `lib/db/queries/quotes.ts` 는 **DB 질의 모듈**이다. 거기서 바깥 시스템을 부르면 그 파일의
 * 성격이 무너지고, 시험이 DB 를 세워 재는 방식과도 맞지 않는다. 수리 건 상세의 「부품 요청」
 * 칸이 같은 까닭으로 `part-request-section-data.ts` 를 두었고, **조각 13 에서 옛 표를 걷어낼
 * 때 고칠 자리가 한 곳으로 모이는** 이점도 같다.
 *
 * ── 🔴 셋을 나란히 부른다 ───────────────────────────────────────────────────
 * 서로 기다릴 까닭이 없는 조회다. 차례로 기다리면 저쪽이 느린 날 견적서 불러오기가 통로
 * 수만큼 느려진다(부품 요청 칸이 하는 그대로).
 *
 * ── 🔴 「못 받아 왔다」를 「없다」로 바꾸지 않는다 ───────────────────────────
 * 재고 관리가 꺼져 있거나 통신이 끊기면 **빈 목록이 아니라 「모른다」**다. 뭉개면 화면이
 * 「이 건은 나간 부품이 없다」고 말하고, 사람은 그 말을 믿고 **청구를 빠뜨린다.** 그래서
 * 결과를 `InventoryResult` 그대로 들고 올라간다.
 *
 * ── 🔴 **상단 정보는 재고 관리와 무관하다** ─────────────────────────────────
 * 고객사 · 모델명 · L/N · S/N · 신고증상은 A/S DB 의 값이다. 저쪽이 꺼져 있어도 그대로
 * 채워져야 한다 — 한 통로가 실패했다고 불러오기 전체를 실패로 만들지 않는다.
 * ============================================================================
 */
export type QuoteIntakeLookup = Omit<QuoteIntakeCase, "productId"> & {
  /**
   * 이 건에 **출고된** 부품. 🔴 `unreachable` 은 「나간 부품이 없다」가 **아니다**(머리말).
   * 화면이 둘을 다르게 그린다.
   */
  usedParts: InventoryResult<QuoteUsedPart[]>;
  /**
   * 이 장비의 제품 모델에 이어 둔 O/H 부품 템플릿. 🔵 **`value: null` 이 정상이다** —
   * 모델을 안 이어 두었거나 O/H 템플릿이 없는 기종이면 없다. 역시 「없다」와 「못 받아
   * 왔다」가 다른 값이다.
   */
  ohTemplate: InventoryResult<QuoteOhTemplate | null>;
};

export async function loadQuoteIntakeLookup(intakeNumber: string): Promise<QuoteIntakeLookup | null> {
  const found = await lookupIntakeForQuote(intakeNumber);
  // 🔵 못 찾은 것은 오류가 아니다 — 아직 접수되지 않은 건으로 먼저 견적을 내는 일이 있다.
  if (found === null) return null;

  const { productId, ...header } = found;

  /**
   * 🔴 **열쇠는 A/S 의 `product_models.id`** 다(저쪽 API.md 6-1절) — 모델 **이름**으로는
   * 찾지 않는다. 🔵 제품 모델이 안 붙은 개체는 **물을 열쇠가 없다** — 저쪽을 부르지 않고
   * 「이어 둔 템플릿이 없다」로 둔다. 오류가 아니라 사실이다(부품 요청 칸과 같은 판단).
   */
  const productModelId = productId === null ? null : await getProductModelIdForProduct(productId);
  const ohTemplatePromise: Promise<InventoryResult<InventoryOhTemplate | null>> =
    productModelId === null
      ? Promise.resolve({ status: "ok", value: null })
      : fetchInventoryOhTemplate(productModelId);

  const [parts, template, requests] = await Promise.all([
    fetchInventoryParts(),
    ohTemplatePromise,
    fetchInventoryStockRequestsByIntake(header.intakeNumber),
  ]);

  /**
   * 🔴 **부품 마스터를 못 받아 왔으면 두 목록 다 「못 받아 왔다」**다. 신청 줄과 템플릿 줄에
   * 붙는 고객사 품명 · 견적가 · 소유가 전부 그 마스터에서 오기 때문이다 — 없는 채로 묶어
   * 내려보내면 화면이 **「전부 고객사 품명이 없어 담을 수 없다」**고 그리고, 사람은 재고
   * 관리에 가서 멀쩡히 적혀 있는 이름을 찾아 헤맨다. 모르는 것은 모른다고 말한다.
   */
  const usedParts: InventoryResult<QuoteUsedPart[]> =
    parts.status !== "ok"
      ? parts
      : requests.status !== "ok"
        ? requests
        : { status: "ok", value: toQuoteUsedParts(requests.value, parts.value) };

  const ohTemplate: InventoryResult<QuoteOhTemplate | null> =
    parts.status !== "ok"
      ? parts
      : template.status !== "ok"
        ? template
        : { status: "ok", value: toQuoteOhTemplate(template.value, parts.value) };

  return { ...header, usedParts, ohTemplate };
}
