import type { PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import {
  toPartPickerRow,
  type InventoryOhTemplate,
  type InventoryPart,
  type InventoryStockRequest,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 견적서의 「인수번호로 불러오기」가 쓰는 두 목록 — 🔴 **재고 관리에서 온다** (2026-10-16)
 * ============================================================================
 * 출고된 부품과 O/H 템플릿은 2026-10 조각 10~12 에서 **재고 관리로 옮겨갔다.** 그래서
 * A/S 제 표(`inventory_part_request_items` · `oh_part_template_*`)에는 더 이상 아무것도
 * 쌓이지 않고, 그 표를 읽던 견적서는 **빈 결과**를 받아 「이 건에 나간 부품이 없다」고
 * 말하고 있었다(사용자 신고: 「반출이 확인된 부품이 견적서에 안 뜬다」 · 「OH 템플릿을
 * 못 불러온다」). 받아 오는 길은 `src/lib/server/quote-intake-lookup.ts` 가 내고,
 * **받아 온 것을 어떻게 읽는가**는 여기 둔다 — 그래야 망도 DB 도 없는 시험이 붙는다.
 * 이웃한 `inventory-gateway.ts` ↔ `server/inventory-gateway.ts` 와 같은 가름이다.
 *
 * ── 🔴 「반출이 확인된」 = 그 건의 신청 줄 중 `issued > 0` ───────────────────
 * 요청만 하고 아직 안 나간 부품을 견적에 올리면 **쓰지도 않은 값을 청구**한다. 옛 A/S
 * 질의가 `issued_quantity > 0` 으로 거르던 그 뜻 그대로다.
 *
 * ── 🔴 묶는 축이 **하나 줄었다** — 부품 번호 하나다 ─────────────────────────
 * 옛 질의는 **(부품, 소유구분)** 짝으로 묶었다. 같은 부품이 DSS 것과 교산 것으로 따로
 * 나갔으면 두 줄로 보여야 했기 때문이다. 재고 관리에서는 **소유가 다르면 부품 번호가
 * 다르다**(저쪽 API.md 2절 · `toPartPickerRows` 의 「소유를 고르지 않는다」) — 번호
 * 하나가 곧 (부품, 소유구분) 짝이라 축이 저절로 하나가 된다. 줄이 합쳐지는 것이
 * 아니라 **애초에 다른 번호로 와서 다른 줄로 남는다.**
 * 🔵 같은 부품이 **여러 신청에 걸쳐** 나간 것은 지금 규칙 그대로 **합쳐서 한 줄**이다.
 *
 * ── 🔴 적히는 이름을 여기서 정하지 않는다 ───────────────────────────────────
 * 견적서 줄에 적히는 이름은 **고객사 품명**이고(2026-10-16 사용자 결정), 그 이름이 없는
 * 줄은 **담기지 않는다.** 그 두 가지를 재는 자는 이미 부품 고르개에 있다
 * (`partPickName` · `canPickPartOption` 의 `nameSource="customer"`). 여기서 같은 판정을
 * 다시 적으면 자가 두 벌이 되어 언젠가 갈린다 — **한쪽은 고를 수 있다고 그리고 다른
 * 쪽은 빈 이름을 넣는다.** 그래서 이 파일은 고르개가 받는 줄(`PartPickerRow`)을 **그대로
 * 들려 보내고**, 재는 일은 화면(QuoteEditForm)이 그 함수들로 한다.
 * 🔵 그 함수들이 사는 `part-picker.tsx` 는 react 를 문다 — 이 파일에서 부를 수 없고,
 *    부를 까닭도 없다(이 파일은 순수하게 남는다).
 *
 * ── 🔴 되짚지 못한 줄도 **목록에서 지우지 않는다** ──────────────────────────
 * 부품 마스터에서 못 찾은 출고 줄(그 사이 재고에서 지워진 부품)과 재고에 안 이어진
 * 템플릿 줄(`linked: false`)은 **담을 수 없다** — 적을 이름도 붙일 금액도 없다. 그래도
 * 목록에는 남긴다: **나간 부품이 목록에서 사라지면 사람은 청구를 빠뜨린다.** 「있는데 못
 * 담는다」와 「아예 없다」는 다른 말이다(고르개가 막힌 줄을 감추지 않는 그 까닭 그대로).
 * ============================================================================
 */

/**
 * 되짚지 못한 출고 줄에 적는 말. 🔴 「고객사 품명을 설정해 주세요」와 **다른 말이어야 한다** —
 * 앞은 재고 관리에서 그 칸을 채우면 풀리는 일이고, 이것은 **부품 자체가 거기 없는** 일이라
 * 사람이 할 일이 다르다. 뭉치면 있지도 않은 부품의 고객사 품명을 찾아 헤맨다.
 */
export const USED_PART_NOT_IN_INVENTORY_MESSAGE =
  "재고 관리의 부품 목록에서 찾지 못했습니다 — 담을 수 없습니다";

/**
 * 재고 마스터에 **안 이어진** 템플릿 줄에 적는 말(`linked: false`). 🔴 부품 요청 칸이 같은
 * 줄을 두고 하는 말과 **같은 뜻**이다 — 담기지 않고, 그 사실을 사람에게 알린다.
 */
export const OH_TEMPLATE_PART_NOT_LINKED_MESSAGE =
  "재고 마스터에 이어져 있지 않습니다 — 담을 수 없습니다";

/** 금액 한 칸. 🔴 **`0`(무상)과 「안 정함」을 가른다** — `?? 0` 도 `|| null` 도 쓰지 않는다. */
function money(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * 이 건에 **출고된** 부품 한 줄.
 *
 * 🔵 금액을 글자로 들고 다니는 까닭: 견적서 폼의 단가 칸이 DB 의 numeric(글자로 읽힌다)과
 *    **같은 길**로 다룬다(`toPriceFieldValue` · `isPriceUnset`). 숫자로 내려보내면 그 자리만
 *    따로 셈하는 길이 생긴다.
 */
export type QuoteUsedPart = {
  /**
   * 담긴 줄을 **다시 안 담게** 하는 열쇠이자 목록의 React key. 🔴 **부품 번호 하나로 센다**
   * (위 머리말 — 소유구분 축이 없어졌다). 되짚지 못한 줄은 번호가 없어 이름으로 가른다.
   */
  sourceKey: string;
  /**
   * 부품 고르개가 받는 줄 **그대로**. 🔴 `null` 이면 **부품 마스터에서 못 찾은 줄**이다
   * (그 사이 재고 관리에서 지워졌거나, 저쪽이 번호를 안 준 줄). 담을 수 없고, 그래도
   * 목록에는 남는다(머리말).
   */
  option: PartPickerRow | null;
  /** 신청 줄에 적혀 있던 이름. 🔴 `option` 이 없을 때 사람에게 보여 줄 **유일한 글자**다. */
  requestedName: string;
  /**
   * 어느 소유에서 나갔는가 — 🔴 **재고 관리가 준 글자 그대로** 쓴다(상태 글자와 같은 규율).
   * 🔵 이 값은 고르개 줄(`option`)에 담지 않는다. 거기에 담으면 **모든 부품**의 소유가
   *    견적서로 나가는데, 여기 적히는 것은 **이 건에 실제로 나간 줄**의 것뿐이다.
   */
  ownerLabel: string;
  /** 🔴 **나간 수량**이다(요청 수량이 아니다). 여러 신청에 걸쳐 나갔으면 합친 값. */
  quantity: number;
  /** 그 부품의 **견적가**. 🔴 `null` 은 「정하지 않았다」이고 `"0"`(무상)과 다르다. */
  unitPrice: string | null;
};

/** O/H 템플릿 한 줄. */
export type QuoteOhTemplatePart = {
  /** 담긴 줄을 다시 안 담게 하는 열쇠. 🔴 **차례로 센다** — 안 이어진 줄에는 번호가 없다. */
  sourceKey: string;
  /** 템플릿에 적혀 있는 이름 그대로. 🔴 안 이어진 줄에서 사람에게 보여 줄 유일한 글자다. */
  templateName: string;
  /** 되짚은 부품. 🔴 `null` 이면 **재고 마스터에 안 이어진 줄**이다(머리말). */
  option: PartPickerRow | null;
  quantity: number;
  /**
   * 그 부품의 **O/H 견적가**. 🔴 **없으면 `null` 이고, 일반 견적가로 때우지 않는다** —
   * 때우면 틀린 금액이 견적서에 박히고 빈칸과 달리 아무도 눈치채지 못한다(고르개의 ㉢ ·
   * `toPartPickerPriceRows` 가 지키는 그 규칙 그대로).
   */
  overhaulUnitPrice: string | null;
};

export type QuoteOhTemplate = {
  /** 저쪽이 적어 둔 템플릿 이름. 화면이 「이 장비의 O/H 부품 템플릿 — …」로 그린다. */
  name: string;
  parts: QuoteOhTemplatePart[];
};

/**
 * 이 건의 반출 신청들 → **출고된 부품 목록**.
 *
 * 🔴 **`issued > 0` 인 줄만** 센다(머리말). 🔴 같은 부품이 여러 신청에 걸쳐 나갔으면
 * **합쳐 한 줄**이고, 수량은 나간 수량의 합이다.
 *
 * 🔵 차례는 **품명순**이다 — 옛 질의가 `order by parts.part_name` 이던 그대로다. 저쪽은
 *    신청한 시각순으로 주는데, 그 차례를 그대로 쓰면 같은 건을 두 번 불러온 사이에 신청이
 *    하나 늘었다는 이유로 목록이 통째로 뒤섞인다.
 */
export function toQuoteUsedParts(
  requests: readonly InventoryStockRequest[],
  parts: readonly InventoryPart[]
): QuoteUsedPart[] {
  const partByNo = new Map(parts.map((part) => [part.no, part]));
  const merged = new Map<string, QuoteUsedPart>();

  for (const request of requests) {
    for (const line of request.lines) {
      // 🔴 「반출이 확인된」의 뜻이 이 한 줄이다 — 요청만 하고 안 나간 줄은 세지 않는다.
      if (line.issued <= 0) continue;

      const part = line.no === null ? undefined : partByNo.get(line.no);
      const sourceKey = line.no === null ? `issued:gone:${line.name}` : `issued:${line.no}`;
      const existing = merged.get(sourceKey);
      if (existing) {
        existing.quantity += line.issued;
        continue;
      }
      merged.set(sourceKey, {
        sourceKey,
        option: part === undefined ? null : toPartPickerRow(part),
        requestedName: line.name,
        ownerLabel: part === undefined ? "" : part.owner.label || part.owner.code,
        quantity: line.issued,
        unitPrice: part === undefined ? null : money(part.quotePrice),
      });
    }
  }

  return [...merged.values()].sort((a, b) =>
    (a.option?.partName ?? a.requestedName).localeCompare(b.option?.partName ?? b.requestedName, "ko")
  );
}

/**
 * 이 장비에 이어 둔 템플릿 → **O/H 부품 목록**.
 *
 * 🔴 **차례는 템플릿에 늘어놓은 순서 그대로**다. 양식의 부품 순서가 뜻을 갖는다(휴즈 22개가
 *    셋째 줄인 데는 이유가 있다 — 옛 `oh_part_templates` 스키마가 적어 둔 그 까닭).
 * 🔴 **안 이어진 줄(`linked: false`)도 버리지 않는다** — 담기지 않을 뿐이다(머리말).
 *
 * 🔵 이어 둔 템플릿이 **없는** 것(`null`)은 오류가 아니다 — 그대로 `null` 을 돌려준다.
 */
export function toQuoteOhTemplate(
  template: InventoryOhTemplate | null,
  parts: readonly InventoryPart[]
): QuoteOhTemplate | null {
  if (template === null) return null;
  const partByNo = new Map(parts.map((part) => [part.no, part]));

  return {
    name: template.name,
    parts: template.items.map((item, index) => {
      // 🔴 `linked` 와 번호를 **둘 다** 본다 — 한쪽 약속이 깨지는 날 없는 번호로 되짚지 않게
      //    (저쪽 파서가 같은 잣대로 `linked` 를 접는다).
      const part = item.linked && item.no !== null ? partByNo.get(item.no) : undefined;
      return {
        sourceKey: `ohtpl:${index}`,
        templateName: item.name,
        option: part === undefined ? null : toPartPickerRow(part),
        quantity: item.quantity,
        // 🔴 O/H 견적가가 없으면 빈칸이다 — 일반 견적가로 때우지 않는다(위 타입 주석).
        overhaulUnitPrice: part === undefined ? null : money(part.overhaulQuotePrice),
      };
    }),
  };
}
