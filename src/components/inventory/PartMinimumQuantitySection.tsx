"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePartMinimumQuantitiesAction } from "@/lib/server/actions/part-minimum-quantities";
import { parseMinimumQuantityValue } from "@/lib/validation/part-minimum-quantity-input";
import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 한계수량 — 지금 수량 바로 옆에서 정한다
 * ============================================================================
 * 재고 보유 표(PartBalanceGrid) **바로 아래**에 붙는다. 별도 대화창으로 빼지
 * 않은 것이 이 구역의 요점이다 — 한계수량을 정하려면 지금 얼마나 있는지를 봐야
 * 하는데, 다른 창에서 넣게 하면 그 숫자를 못 보고 정하게 된다.
 *
 * ── 소유자 넷을 언제나 모두 그린다 ──────────────────────────────────────
 * 재고 행이 없는 소유자도 `지금 0` 으로 나온다. part_stock_balances 는 입고가
 * 있어야 행이 생기므로, 그 표만 그리면 "우리 것이 하나도 없다"는 소유자에게는
 * 한계수량을 걸 자리 자체가 없다 — 그런데 그것이 바로 가장 알려야 할 경우다.
 *
 * ── 넷을 한 번에 저장한다 ───────────────────────────────────────────────
 * 저장 단추 하나. mutation 이 한 트랜잭션으로 처리하므로 반쯤 저장되는 일이 없다.
 *
 * ── 권한은 서버가 판정해 내려보낸다 ─────────────────────────────────────
 * 화면은 역할을 보지 않는다. 서버 컴포넌트가 capabilities 로 한 번 해석해 boolean
 * 하나(canEdit)만 준다(auth/inventory-capabilities.ts 의 그 길). 권한이 없으면
 * 입력칸도 저장 단추도 아예 그리지 않고 **값은 그대로 보인다** — 감추는 것은
 * 안내이지 차단이 아니고, 차단은 mutation 이 다시 한다.
 *
 * ⚠️ sr-only 를 쓰지 않는다. 이 저장소는 숨은 글자가 페이지를 아래로 굴리는
 * 고장을 세 번 겪었다 — 라벨이 필요하면 보이는 글자로 적는다.
 * ============================================================================
 */

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

export default function PartMinimumQuantitySection({
  partId,
  rows,
  canEdit,
}: {
  partId: string;
  rows: PartMinimumQuantityRowView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  // 서버가 준 값이 언제나 바탕이고, state 에는 **사람이 고친 칸만** 담는다.
  // 저장한 값을 state 에서 지우지 않으므로 새로고침이 도착하기 전에 방금 친
  // 숫자가 잠깐 사라지는 일이 없다.
  const [edits, setEdits] = useState<Partial<Record<StockOwner, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const byOwner = new Map(rows.map((row) => [row.owner, row]));

  function savedValueOf(owner: StockOwner): string {
    return toInputValue(byOwner.get(owner)?.minimumQuantity ?? null);
  }

  function valueOf(owner: StockOwner): string {
    return edits[owner] ?? savedValueOf(owner);
  }

  const hasChanges = STOCK_OWNER_CODES.some((owner) => valueOf(owner).trim() !== savedValueOf(owner));
  // 화면에서 미리 거른다. 서버가 다시 검사하므로 이것은 안내일 뿐이다 —
  // 같은 순수 함수를 부르므로 화면에서 통과한 값이 서버에서 거절되지 않는다.
  const hasInvalidValue = STOCK_OWNER_CODES.some((owner) => !parseMinimumQuantityValue(valueOf(owner)).ok);

  async function handleSubmit() {
    if (isSubmitting || !hasChanges || hasInvalidValue) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setFieldErrors({});

    const result = await savePartMinimumQuantitiesAction({
      partId,
      entries: STOCK_OWNER_CODES.map((owner) => ({ owner, minimumQuantity: valueOf(owner) })),
    });

    setIsSubmitting(false);
    if (!result.ok) {
      if ("fieldErrors" in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
      setErrorMessage(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">한계수량</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {canEdit
            ? "비워 두면 알림 없음 · 이 수량 밑으로 떨어지면 종 알림이 뜹니다"
            : "이 수량 밑으로 떨어지면 종 알림이 뜹니다"}
        </p>
      </div>

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
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "저장 중..." : "한계수량 저장"}
          </button>
        </div>
      )}
    </div>
  );
}
