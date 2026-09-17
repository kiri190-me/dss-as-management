"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { savePartMinimumQuantitiesAction } from "@/lib/server/actions/part-minimum-quantities";
import { parseMinimumQuantityValue } from "@/lib/validation/part-minimum-quantity-input";
import {
  UNIT_PRICE_FIELD_ERROR_KEY,
  parseUnitPriceValue,
} from "@/lib/validation/part-unit-price-input";
import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 이 부품의 단가와 소유 구분별 한계수량 — 지금 수량 바로 옆에서 정한다
 * ============================================================================
 * 재고 보유 표(PartBalanceGrid) **바로 아래**에 붙는다. 별도 대화창으로 빼지
 * 않은 것이 이 구역의 요점이다 — 한계수량도 단가도 지금 얼마나 있는지를 보고
 * 정하는 값인데, 다른 창에서 넣게 하면 그 숫자를 못 보고 정하게 된다.
 *
 * ── 🔴 단가는 표 밖에, 부품마다 하나 (2026-09-17 사용자 정정) ───────────
 * 예전에는 소유 구분 줄마다 단가 칸이 하나씩, 넷이 있었다. **소유구분에 따라
 * 부품의 단가가 달라지지 않는다**는 것이 업무상 사실이라 그 축을 없앴다
 * (schema/part-unit-prices.ts 머리말). 그래서 단가 칸은 표 위에 **하나**만
 * 그리고, 표에는 한계수량만 남는다.
 *
 * 🔴 **한계수량 줄 넷은 그대로다.** 그쪽은 소유구분마다 값이 갈리는 것이 맞다 —
 * DSS 재고는 스무 개를 채워 두고 시험용은 두 개면 되는 식이다. 한 구역에서 축이
 * 다른 두 값을 편집하는 것이 지금 모양이고, 그래서 단가를 표 밖에 둔다: 표 안에
 * 두면 넷 중 하나에만 걸리는 값처럼 보인다.
 *
 * ── 한 구역, 한 단추 ────────────────────────────────────────────────────
 * 단가를 별도 구역으로 빼지 않았다(2026-08-28 승인). 저장 단추가 둘이 되고,
 * 저장은 **한 트랜잭션**이라 반쯤 저장되는 일이 없다
 * (mutations/part-minimum-quantities.ts 의 savePartOwnerSettings).
 *
 * ── 소유자 넷을 언제나 모두 그린다 ──────────────────────────────────────
 * 재고 행이 없는 소유자도 `지금 0` 으로 나온다. part_stock_balances 는 입고가
 * 있어야 행이 생기므로, 그 표만 그리면 "우리 것이 하나도 없다"는 소유자에게는
 * 값을 걸 자리 자체가 없다.
 *
 * ── 🔴 비운 칸과 0 은 다른 뜻이다 ───────────────────────────────────────
 * 한계수량: 비움 = 알림 없음 / 0 = 바닥나면 알려 달라.
 * 단가:     비움 = 정하지 않음 / 0 = 무상 부품.
 * 둘 다 비우면 **행을 지운다**. 0 으로 저장해 버리면 "정하지 않음"을 다시
 * 표현할 방법이 사라지고, 단가 쪽은 견적서가 정하지 않은 부품을 0원으로
 * 청구하게 된다(schema/part-unit-prices.ts 머리말).
 *
 * ── 오류 키가 겹치지 않게 한다 ──────────────────────────────────────────
 * 한계수량 오류는 소유자 코드를 키로 쓴다. 서버가 단가 오류에는
 * UNIT_PRICE_FIELD_ERROR_KEY 를 쓰고, 여기서 그 키로 단가 칸 밑에 문장을 붙인다 —
 * 안 그러면 단가가 틀렸는데 한계수량 칸에 빨간 글씨가 뜬다.
 *
 * ── 권한은 서버가 판정해 내려보낸다 ─────────────────────────────────────
 * 화면은 역할을 보지 않는다. 서버 컴포넌트가 capabilities 로 한 번 해석해 boolean
 * 하나(canEdit)만 준다. 권한이 없으면 입력칸도 저장 단추도 아예 그리지 않고
 * **값은 그대로 보인다** — 감추는 것은 안내이지 차단이 아니고, 차단은 mutation 이
 * 다시 한다.
 *
 * ⚠️ sr-only 를 쓰지 않는다. 이 저장소는 숨은 글자가 페이지를 아래로 굴리는
 * 고장을 세 번 겪었다 — 라벨이 필요하면 보이는 글자로 적는다.
 * ============================================================================
 */

const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

export type PartMinimumQuantityRowView = {
  owner: StockOwner;
  /** 그 소유자의 위치를 모두 합한 지금 수량. 재고 행이 없으면 0 이다. */
  currentQuantity: number;
  /** 저장된 한계수량. null 이면 정하지 않은 것이다(0 과 다르다). */
  minimumQuantity: number | null;
};

/** 저장된 값을 입력칸 문자열로. null(정하지 않음)은 빈 칸이고, 0 은 "0" 이다. */
function toInputValue(minimumQuantity: number | null): string {
  return minimumQuantity === null ? "" : String(minimumQuantity);
}

/**
 * DB 의 "125000.00" 을 입력칸에 보여 줄 "125000" 으로. 소수부가 있으면 남긴다.
 * 사람이 친 그대로 보이게 하기 위한 것이라, 저장할 때는 이 문자열이 다시
 * 검증을 거쳐 numeric 으로 들어간다.
 */
function toPriceInputValue(unitPrice: string | null): string {
  if (unitPrice === null) return "";
  // 정수부 13자리 + 소수 2자리는 Number 로 정확히 표현된다(1e15 < 2^53).
  const parsed = Number(unitPrice);
  return Number.isFinite(parsed) ? String(parsed) : unitPrice;
}

export default function PartMinimumQuantitySection({
  partId,
  rows,
  unitPrice,
  canEdit,
}: {
  partId: string;
  rows: PartMinimumQuantityRowView[];
  /**
   * 이 부품의 단가. **부품마다 하나다** — 소유구분별이 아니다. null 이면 정하지
   * 않은 것이고("0"(무상)과 다르다), numeric 이라 문자열로 온다("125000.00").
   */
  unitPrice: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  // 서버가 준 값이 언제나 바탕이고, state 에는 **사람이 고친 칸만** 담는다.
  // 저장한 값을 state 에서 지우지 않으므로 새로고침이 도착하기 전에 방금 친
  // 숫자가 잠깐 사라지는 일이 없다.
  const [edits, setEdits] = useState<Partial<Record<StockOwner, string>>>({});
  const [priceEdit, setPriceEdit] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const byOwner = new Map(rows.map((row) => [row.owner, row]));

  function savedValueOf(owner: StockOwner): string {
    return toInputValue(byOwner.get(owner)?.minimumQuantity ?? null);
  }
  const savedPrice = toPriceInputValue(unitPrice);

  function valueOf(owner: StockOwner): string {
    return edits[owner] ?? savedValueOf(owner);
  }
  const priceValue = priceEdit ?? savedPrice;

  const hasChanges =
    priceValue.trim() !== savedPrice ||
    STOCK_OWNER_CODES.some((owner) => valueOf(owner).trim() !== savedValueOf(owner));
  // 화면에서 미리 거른다. 서버가 다시 검사하므로 이것은 안내일 뿐이다 —
  // 같은 순수 함수를 부르므로 화면에서 통과한 값이 서버에서 거절되지 않는다.
  const hasInvalidValue =
    !parseUnitPriceValue(priceValue).ok ||
    STOCK_OWNER_CODES.some((owner) => !parseMinimumQuantityValue(valueOf(owner)).ok);
  const priceFieldError = fieldErrors[UNIT_PRICE_FIELD_ERROR_KEY];

  async function handleSubmit() {
    if (isSubmitting || !hasChanges || hasInvalidValue) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setFieldErrors({});

    const result = await savePartMinimumQuantitiesAction({
      partId,
      entries: STOCK_OWNER_CODES.map((owner) => ({ owner, minimumQuantity: valueOf(owner) })),
      // 🔴 언제나 보낸다(빈 문자열이라도). 보내지 않으면 서버는 "단가는 건드리지
      // 말라"로 읽으므로, 사람이 칸을 비워 지우려 한 것이 조용히 무시된다.
      unitPrice: priceValue,
    });

    setIsSubmitting(false);
    if (!result.ok) {
      if ("fieldErrors" in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
      setErrorMessage(result.message);
      return;
    }
    router.refresh();
    // 부품에 딸린 값을 고쳤으므로 팝업 뒤 재고 목록으로 넘어간다(common/SavePopup.tsx).
    showSavePopup({ message: "한계수량·단가를 저장했습니다.", redirectTo: "/inventory" });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">단가 · 한계수량</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {canEdit
            ? "단가를 비우면 정하지 않음(0 은 무상) · 한계수량을 비우면 알림 없음"
            : "이 수량 밑으로 떨어지면 종 알림이 뜹니다"}
        </p>
      </div>

      {/* ── 단가는 부품마다 하나다 ───────────────────────────────────────
          소유 구분 표 밖에 둔다. 안에 두면 넷 중 한 줄에만 걸리는 값처럼 보이는데,
          실제로는 누구 것이든 같은 값으로 청구한다(2026-09-17 사용자 정정). */}
      <div className="mt-3">
        {/* 라벨은 입력 칸 위에 둔다(UI_GUIDELINE.md 4항). 소유 구분 표는 칸이
            줄마다라 머리글로 대신하지만, 이 칸은 홀로 서 있으므로 라벨을 붙인다. */}
        <label
          htmlFor="part-unit-price"
          className="block text-xs text-zinc-500 dark:text-zinc-400"
        >
          단가 (원, VAT 별도)
        </label>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          {canEdit ? (
            <input
              id="part-unit-price"
              type="text"
              inputMode="decimal"
              value={priceValue}
              onChange={(event) => setPriceEdit(event.target.value)}
              placeholder="정하지 않음"
              className="w-40 rounded-md border border-zinc-200 bg-white px-2 py-1 text-right text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
            />
          ) : (
            <span id="part-unit-price" className="tabular-nums text-sm text-zinc-900 dark:text-zinc-50">
              {unitPrice === null ? "-" : `₩${AMOUNT_FORMAT.format(Number(unitPrice))}`}
            </span>
          )}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            소유 구분과 무관하게 이 부품 하나의 값입니다.
          </span>
        </div>
        {priceFieldError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{priceFieldError}</p>
        )}
      </div>

      <h3 className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        소유 구분별 한계수량
      </h3>

      <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">소유 구분</th>
              <th className="px-3 py-2 text-right">지금</th>
              <th className="px-3 py-2 text-right">한계수량</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {STOCK_OWNER_CODES.map((owner) => {
              const row = byOwner.get(owner);
              const currentQuantity = row?.currentQuantity ?? 0;
              const savedMinimum = row?.minimumQuantity ?? null;
              // 부족 표시는 **저장된** 한계수량으로 판단한다 — 아직 저장하지 않은
              // 숫자로 표시하면 화면이 실제로 걸려 있는 알림과 다른 말을 한다.
              const isShort = savedMinimum !== null && currentQuantity < savedMinimum;
              const fieldError = fieldErrors[owner];

              return (
                <tr key={owner} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-50">{stockOwnerLabels[owner]}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      isShort ? "font-semibold text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {currentQuantity}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={valueOf(owner)}
                        onChange={(event) =>
                          setEdits((previous) => ({ ...previous, [owner]: event.target.value }))
                        }
                        placeholder="없음"
                        aria-label={`${stockOwnerLabels[owner]} 한계수량`}
                        className="w-24 rounded-md border border-zinc-200 bg-white px-2 py-1 text-right text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
                      />
                    ) : (
                      <span className="tabular-nums text-zinc-900 dark:text-zinc-50">
                        {savedMinimum === null ? "-" : savedMinimum}
                      </span>
                    )}
                    {fieldError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldError}</p>}
                  </td>
                  <td className="px-3 py-2">
                    {isShort && (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                        부족
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      {canEdit && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !hasChanges || hasInvalidValue}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
          >
            {isSubmitting ? "저장 중..." : "저장"}
          </button>
        </div>
      )}
    </div>
  );
}
