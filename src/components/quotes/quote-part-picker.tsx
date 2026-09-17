"use client";

import type { PartPickerPriceRow, PartPickerRow } from "@/lib/db/queries/inventory";
import { toPriceFieldValue } from "@/lib/domain/quote-part-price";

/**
 * ============================================================================
 * 견적서의 품명 칸에서 부품 마스터를 찾아 고른다 (2026-09-17 사용자 요청)
 * ============================================================================
 * 「부품 비용」(케이블이면 「품목」) 표의 품명 칸은 지금까지 자유 글자였다. 부품
 * 마스터에 있는 부품도 사람이 이름을 다시 쳐야 했고, 그렇게 적힌 줄은 재고의 어느
 * 부품인지 시스템이 모른다(quote_items.part_id 가 NULL 로 남는다).
 *
 * ── 거르기는 **브라우저에서** 한다 ──────────────────────────────────────────
 * 부품 마스터는 백 줄 안쪽이다. 페이지가 목록을 통째로 한 번 내려보내고
 * (queries/inventory.ts 의 getPartPickerList) 여기서 거른다 — 글자마다 서버를
 * 부르면 느리고, 지운 글자만큼 응답이 엇갈려 도착한다. 수리 건 상세의 부품 요청
 * 칸(components/inventory/PartRequestSection.tsx)이 쓰는 방식 그대로다.
 *
 * ── 🔴 재고 · 소유구분 · 내부 비고는 여기 오지 않는다 ───────────────────────
 * 이 조각이 받는 줄(PartPickerRow)에는 그 칸이 **아예 없다.** 화면에서 안 그리는
 * 것으로는 모자란다 — 조회가 이미 실어 보낸 뒤이기 때문이다. 그래서 가벼운 형제
 * 조회를 따로 두었고(같은 파일의 getPartList 는 손대지 않았다), 이 조각은 그
 * 형제가 주는 다섯 칸(id + 네 가지)만 안다.
 *
 * 단가도 같은 경계 안이다 — 나중에 더한 「고르면 단가도 채운다」는 **단가만 담은 별도
 * 목록**(getPartPickerUnitPrices)을 받고, 그 목록에도 재고 · 소유구분 · 비고가 없다.
 *
 * ── 🔴 손으로 적는 길은 그대로다 ────────────────────────────────────────────
 * 고르면 붙고(partId), 글자를 고치면 풀린다(partId = null). 마스터에 없는 부품 ·
 * 케이블 부속은 지금까지처럼 그냥 적으면 되고, 그 줄은 part_id 없이 저장된다.
 * ============================================================================
 */

/**
 * 한 번에 보여 줄 후보의 수. 목록을 다 뿌리면(글자 한 자에 수십 줄) 밑에 있는 줄을
 * 가려 버려 오히려 고르기 어렵다 — 좁혀 치라는 신호로 여기서 끊는다.
 */
export const MAX_PART_SUGGESTIONS = 8;

/**
 * 네 가지로 거른다 — **품명 · 품명2(규격) · 도번 · 교산 품번**. 재고 조회가 서버에서
 * 거르는 네 칸과 같다(queries/inventory.ts 의 getPartList 검색 조건). 같은 네 가지라야
 * 「재고에서 찾던 대로 치면 여기서도 나온다」가 된다.
 *
 * 🔴 빈 글자면 **아무것도 돌려주지 않는다** — 칸을 누르자마자 목록이 통째로 펼쳐지면
 *    밑줄을 가린다. 사람이 무언가 친 뒤에만 후보가 뜬다.
 */
export function filterPartOptions(
  options: readonly PartPickerRow[],
  query: string
): PartPickerRow[] {
  const term = query.trim().toLowerCase();
  if (term === "") return [];
  const matched = options.filter(
    (option) =>
      option.partName.toLowerCase().includes(term) ||
      (option.partSpec ?? "").toLowerCase().includes(term) ||
      (option.drawingNo ?? "").toLowerCase().includes(term) ||
      (option.kyosanPartNo ?? "").toLowerCase().includes(term)
  );
  return matched.slice(0, MAX_PART_SUGGESTIONS);
}

/**
 * ============================================================================
 * 고를 때 단가도 함께 채운다 (2026-09-17 사용자 요청) — 🔴 **주면** 채운다
 * ============================================================================
 * 단가에 필요한 것은 전부 **선택**이다. 안 주면 지금까지 그대로 품명과 연결 둘만
 * 채운다 — 수리 건 상세의 사용 부품 칸(components/repair-cases/detail/edit/
 * UsedPartsEditForm.tsx)이 같은 고르개를 쓰는데, 거기에는 단가 칸이 없다. 이것을
 * 필수로 만들면 그 화면이 컴파일에서 깨진다.
 *
 * ── 🔴 금액이 고객사로 나가는 자리라 지키는 것 셋 ───────────────────────────
 *  ㉠ **적혀 있으면 덮지 않는다** — 사람이 조정해 둔 금액이 고른 순간 말없이 바뀌면,
 *     바뀐 줄 모르고 그대로 나간다. 빈칸일 때만 채운다.
 *  ㉡ **정하지 않은 것을 0 으로 채우지 않는다** — null 은 빈칸으로 두고, `"0"` 은
 *     0 으로 채운다(무상 부품이라는 실제 값이다. domain/quote-part-price.ts 머리말).
 *  ㉢ **O/H 줄에 일반 단가를 대신 쓰지 않는다** — O/H 단가가 없으면 안 채운다. 대신
 *     채우면 틀린 금액이 견적서에 박히고, 빈칸과 달리 아무도 눈치채지 못한다.
 * ============================================================================
 */
export type PartPickPriceContext = {
  /**
   * 단가가 적혀 있는 부품들(queries/inventory.ts 의 getPartPickerUnitPrices).
   * **안 주면 단가를 채우지 않는다.** 여기 없는 부품은 "단가를 정하지 않았다"이다.
   */
  prices?: readonly PartPickerPriceRow[];
  /** 이 줄이 `2) OH 부품 비용` 칸으로 갈 줄인가 — 그러면 O/H 단가를 본다. */
  isOverhaulPart?: boolean;
  /** 지금 단가 칸에 적혀 있는 글자. 🔴 비어 있지 않으면 채우지 않는다. */
  currentUnitPrice?: string;
};

/**
 * 이 부품을 고른 줄의 단가 칸에 **넣을 글자**. 넣지 않을 때는 null 이다.
 *
 * null 을 돌려주는 경우 넷 — 셋은 일부러 그런 것이고 하나는 줄 데이터가 없는 것이다:
 *
 *  · 단가 칸에 이미 값이 있다(㉠ 덮지 않는다)
 *  · 단가 목록을 받지 못했다(고르개를 단가 없이 쓰는 화면)
 *  · 그 부품에 줄이 없다 = 일반 · O/H 둘 다 정하지 않았다(㉡)
 *  · 볼 쪽 단가가 null 이다 — 🔴 O/H 줄인데 O/H 단가가 없으면 **여기서 끝난다**.
 *    일반 단가로 넘어가지 않는다(㉢)
 */
export function partPickUnitPrice(partId: string, context: PartPickPriceContext = {}): string | null {
  const { prices, isOverhaulPart = false, currentUnitPrice = "" } = context;
  // ㉠ 사람이 적어 둔 금액이 먼저다. 목록을 보기도 전에 돌아선다.
  if (currentUnitPrice.trim() !== "") return null;
  if (!prices) return null;

  const row = prices.find((price) => price.partId === partId);
  if (!row) return null;

  // 🔴 줄의 출처가 아니라 **줄에 붙은 OH 표시**가 고른다 — 한 견적서 안에 두 종류가
  // 섞여 있고, 사람이 그 표시를 손으로 켜고 끈다(domain/quote-part-price.ts 머리말).
  const price = isOverhaulPart ? row.overhaulUnitPrice : row.unitPrice;
  if (price === null) return null;

  const text = toPriceFieldValue(price);
  // toPriceFieldValue 는 숫자로 읽히지 않는 값을 빈 글자로 돌려준다. 빈 글자를 넣는 것은
  // 아무것도 안 하는 것과 같으니 애초에 안 넣는다("0" 은 "0" 으로 남는다 — ㉡).
  return text === "" ? null : text;
}

/**
 * 고른 부품을 줄에 적을 값. **품명과 재고 연결**은 언제나 채우고, 단가는 위 규칙에
 * 맞을 때만 얹는다. 수량과 규격 칸(케이블)은 건드리지 않는다.
 *
 * 🔴 `unitPrice` 키는 **채울 때만 생긴다.** 부르는 쪽이 이 값을 줄에 덮어쓰기로 붓기
 * 때문에(`{ ...row, ...patch }`), null 이나 빈 글자를 넣어 돌려주면 적혀 있던 금액이
 * 지워진다. 키가 없으면 그 칸은 손대지 않은 채로 남는다.
 *
 * 품명은 마스터의 품명 그대로다 — 부품 요청 칸이 장바구니에 담는 값과 같게 둔다
 * (PartRequestSection 의 addToCart). 담긴 뒤에는 손으로 고칠 수 있고, 고치면 연결이
 * 풀린다(그 규칙은 폼의 onChange 에 있다).
 */
export function partPickPatch(
  option: PartPickerRow,
  context: PartPickPriceContext = {}
): { partNameText: string; partId: string; unitPrice?: string } {
  const picked = { partNameText: option.partName, partId: option.id };
  const unitPrice = partPickUnitPrice(option.id, context);
  return unitPrice === null ? picked : { ...picked, unitPrice };
}

/**
 * 후보 한 줄의 꼬리표 — 품명 말고 **무엇으로 찾았는지**가 보여야 같은 이름이 여럿일 때
 * 고를 수 있다. 비어 있는 칸은 자리만 차지하므로 빼고 잇는다.
 */
export function partOptionDetail(option: PartPickerRow): string {
  return [option.partSpec, option.drawingNo, option.kyosanPartNo]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value !== "")
    .join(" · ");
}

/**
 * 품명 칸 밑에 뜨는 후보 목록.
 *
 * 🔴 `onMouseDown` 에서 기본 동작을 막는다 — 막지 않으면 후보를 누르는 순간 입력 칸이
 *    먼저 포커스를 잃어(onBlur) 목록이 닫히고, 그러면 `onClick` 이 닿을 곳이 없어진다.
 *    「눌리지 않는 목록」이 되는 흔한 함정이라 여기서 못 박는다.
 */
export function QuotePartSuggestionList({
  options,
  onPick,
  listLabel,
}: {
  options: readonly PartPickerRow[];
  onPick: (option: PartPickerRow) => void;
  /** 이 목록이 어느 줄의 것인가 — 줄 번호는 부르는 쪽이 정한다(종류별로 세는 그 번호). */
  listLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <ul
      aria-label={listLabel}
      className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {options.map((option) => {
        const detail = partOptionDetail(option);
        return (
          <li key={option.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(option)}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="text-zinc-900 dark:text-zinc-50">{option.partName}</span>
              {detail !== "" && (
                <span className="ml-2 text-zinc-500 dark:text-zinc-400">{detail}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
