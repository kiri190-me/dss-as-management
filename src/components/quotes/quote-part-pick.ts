import { partPickPatch } from "@dss/core/ui/inventory/part-picker";
import type { PartPickerPriceRow, PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import { partFieldEntries, partFieldLabeledText } from "@dss/core/ui/inventory/part-picker-rows";

/**
 * ============================================================================
 * 견적서 줄이 **고른 부품을 기억한다** (2026-10-16 사용자 요청 ①·②)
 * ============================================================================
 * 사용자 요청 둘이 같은 뿌리에서 나온다 —
 *
 *  ① 「견적서에 나가지는 않더라도 **작성자에게는 어떤 부품을 고른 건지** 작은 글씨로
 *     상세하게 보이게.」 견적서 줄에 적히는 품명은 **고객사 품명**이라(2026-10-16 요청 A),
 *     적어 놓고 보면 그게 우리 쪽 어느 부품인지 작성자도 알 수 없다.
 *  ② 「그 부품 이름을 지우고 **다른 부품을 같은 자리에 넣으면 단가도** 바뀐 부품의
 *     견적가를 따라가게.」
 *
 * 둘 다 「이 줄이 **어느 부품**에서 왔는가」를 알아야 되는데, **지금 그 값이 어디에도 없다** —
 * 고른 부품은 재고 관리의 부품이고 거기에는 A/S `parts.id`(UUID)가 없어서, 폼이 `part_id` 를
 * **비운다**(QuoteEditForm 의 그 자리 · 고르개 `partPickPatch` 머리말). 그래서 **화면에만 사는
 * 값**을 줄에 하나 더 둔다.
 *
 * ── 🔴 이 값은 **밖으로 나가지 않는다** ─────────────────────────────────────
 * 견적서는 고객사로 나가는 종이다. 우리 품명 · 교산 품번 · 도번은 **작성자가 보는 것**이지
 * 고객사가 받는 것이 아니다. 나가는 길은 셋이고 **전부 칸을 하나씩 적어 옮긴다** —
 * 저장(QuoteEditForm 의 `collectFields` → validation/quote-input.ts → mutations/quotes.ts) ·
 * 인쇄 화면과 미리보기(QuotePrintView) · 엑셀(server/services/quote-workbook.ts). 셋 다
 * `{ ...row }` 로 통째로 붓는 자리가 없어서, 줄에 칸을 더해도 **저절로 새지 않는다.**
 * 🔴 그래도 **시험으로 못 박는다**(quote-part-pick.test.ts) — 언젠가 누가 편하다고 통째로
 *    붓는 날, 그 한 줄이 고객사에 나가는 서류에 우리 품번을 찍는다.
 *
 * ── 🔴 「부품이 바뀌었다」를 **무엇으로 아는가** ─────────────────────────────
 * **글자를 견주지 않는다.** 줄의 품명은 사람이 손으로도 고치는 자유 글자라, 글자가 달라진
 * 것만 보면 「다른 부품을 골랐다」와 「같은 부품인데 이름을 손봤다」가 구별되지 않는다. 그래서
 * **고른 그 순간의 부품 번호**(재고 관리 No.)를 줄에 적어 두고, 다음에 고를 때 **그 번호끼리**
 * 견준다. 번호가 다르면 다른 부품이다 — 글자가 어떻든 상관없다.
 *
 * 🔵 **글자를 고쳐도 번호는 지우지 않는다.** 지우면 「이름만 손보고 같은 부품을 다시 고른」
 *    사람의 금액이 덮인다(아래 ㉡). 대신 **상세를 그릴지**는 글자로 가른다 — 적힌 이름이 그
 *    부품에서 온 이름이 아니게 되면 상세도 그 줄의 설명이 아니다(아래 `quotePickedPartOf`).
 * ============================================================================
 */
export type QuotePickedPart = {
  /** 재고 관리의 부품 번호(No.)를 글자로 — 고르개가 쓰는 그 열쇠다(`PartPickerRow.id`). */
  id: string;
  /**
   * 고른 **그때 줄에 적은 이름**(= 고객사 품명). 🔴 **「바뀌었나」를 재는 값이 아니다** —
   * 그것은 위 `id` 가 한다. 이 값은 **상세를 아직 그려도 되는가**만 가른다.
   */
  nameText: string;
};

/** 이 규칙이 보는 줄의 칸들. 🔵 폼의 `ItemRow` 전부가 아니라 **쓰는 것만** 받는다. */
export type QuotePartPickRow = {
  partNameText: string;
  unitPrice: string;
  pickedPart: QuotePickedPart | null;
};

/**
 * 고른 값을 줄에 부을 조각. 🔴 `unitPrice` 키는 **채울 때만 생긴다**(고르개의 같은 규약) —
 * 부르는 쪽이 `{ ...row, ...patch }` 로 붓기 때문에, 키가 없으면 그 칸은 손대지 않은 채 남는다.
 */
export type QuotePartPickPatch = {
  partNameText: string;
  /**
   * 🔴 **언제나 null 이다.** 고른 것은 재고 관리의 부품이고 그 번호는 A/S `parts.id` 가
   * 아니다 — FK 칸에 넣으면 저장이 거절된다(validation/quote-input.ts 가 UUID 를 본다).
   */
  partId: null;
  pickedPart: QuotePickedPart;
  unitPrice?: string;
};

export type QuotePartPickContext = {
  /** 단가가 적힌 부품들. 못 받아 왔으면 빈 목록이고, 그때는 단가를 건드리지 않는다. */
  prices?: readonly PartPickerPriceRow[];
  /** 이 줄이 `2) OH 부품 비용` 칸으로 갈 줄인가 — 그러면 O/H 견적가를 본다. */
  isOverhaulPart?: boolean;
};

/**
 * 이번에 고른 것이 **지금 줄에 들어 있는 그 부품인가**. 🔴 번호로만 잰다(머리말).
 * 🔵 아직 아무것도 고른 적이 없는 줄(손으로 적었거나 · 저장돼 있던 줄을 펼친 것)은 **다른
 *    부품**으로 본다 — 그 줄의 금액은 「이 부품의 값」이라고 말할 수 있는 근거가 없다.
 */
export function isSamePickedPart(picked: QuotePickedPart | null, option: PartPickerRow): boolean {
  return picked !== null && picked.id === option.id;
}

/**
 * 줄에 적힌 이름이 **고른 그때의 이름 그대로인가**. 🔵 앞뒤 공백은 같은 것으로 본다 —
 * 칸에 공백 하나가 더 붙었다고 「고쳤다」가 되면 안 된다.
 *
 * 🔴 **`options` 를 보지 않는다.** 이 판정은 **줄이 들고 있는 기억**만으로 끝난다 — 아래
 *    `quotePartNameEditPatch` 가 이것으로 단가를 비울지 정하는데, 거기에 목록이 끼면
 *    **재고 관리와 통신이 끊긴 날 적어 둔 금액이 날아간다**(아래 그 머리말).
 */
export function isPickedPartNameKept(
  picked: QuotePickedPart | null,
  nameText: string
): picked is QuotePickedPart {
  return picked !== null && nameText.trim() === picked.nameText;
}

/**
 * ============================================================================
 * 🔴 **부품이 바뀐 때만** 단가가 따라간다 (2026-10-16 요청 ②)
 * ============================================================================
 * 지금까지의 규칙은 「적혀 있으면 덮지 않는다」 하나였다(고르개의 `partPickUnitPrice` ㉠).
 * 🔴 **그 규칙을 버리지 않는다** — 사람이 조정해 둔 금액이 **다른 일로** 덮이면, 바뀐 줄
 * 모르고 그대로 고객사에 나간다. 바뀌는 것은 **한 가지 경우뿐**이다:
 *
 *  ㉠ **다른 부품을 골랐다** → 새 부품의 견적가(O/H 줄이면 O/H 견적가)로 **따라간다.**
 *     까닭: 줄에 적혀 있던 금액은 **앞 부품의 값**이다. 부품이 바뀌었는데 그 금액이 남으면
 *     **다른 부품의 값으로 청구**하게 되고, 빈칸과 달리 그럴듯해 보여 아무도 되묻지 않는다.
 *     🔵 그 값이 「사람이 손으로 고쳐 둔 금액」이었더라도 마찬가지다 — 그 조정도 **앞 부품**
 *        에 대고 한 것이라 새 부품에는 근거가 없다.
 *  ㉡ **같은 부품을 다시 골랐다** → **그대로 둔다**(빈칸이면 지금까지처럼 채운다).
 *     까닭: 바뀐 것이 없다. 사람이 조정해 둔 금액을 「다시 눌렀다」는 이유로 날리면 되돌릴
 *     길이 없고, 같은 줄을 두 번 누르는 일은 실제로 흔하다(후보가 떠 있는 채로 칸을 다시
 *     누르면 바로 그렇게 된다).
 *
 * 🔵 **새 부품에 단가가 없으면(null) 0 을 넣지 않고 비운다** — 사람이 채운다. `0` 을 넣으면
 *    그 부품이 **무상**이라는 뜻이 되어 버린다(`"0"` 은 실제로 무상을 뜻하는 값이다 —
 *    @dss/core 의 part-price-field.ts). 「정하지 않았다」와 「0원이다」는 다른 말이다.
 * 🔵 O/H 줄에 일반 단가를 대신 쓰지 않는 규칙도 그대로다 — 그 판단은 전부 고르개 안에 있다.
 * ============================================================================
 */
export function quotePartPickPatch(
  row: QuotePartPickRow,
  option: PartPickerRow,
  context: QuotePartPickContext = {}
): QuotePartPickPatch {
  const same = isSamePickedPart(row.pickedPart, option);
  const patch = partPickPatch(
    option,
    {
      prices: context.prices,
      isOverhaulPart: context.isOverhaulPart,
      /**
       * 🔴 **여기 한 칸이 ㉠ 과 ㉡ 을 가른다.** 같은 부품이면 적혀 있는 금액을 그대로 건네
       * 고르개가 「덮지 않는다」로 돌아서게 하고, 다른 부품이면 **빈 글자**를 건네 새 부품의
       * 견적가를 받아 온다. 고르개 쪽 규칙은 한 글자도 바꾸지 않았다 — PO/내자가 같은 조각을
       * 쓰기 때문이다(그쪽에는 「바뀌면 따라간다」가 없다).
       */
      currentUnitPrice: same ? row.unitPrice : "",
    },
    "customer"
  );

  const picked: QuotePickedPart = { id: option.id, nameText: patch.partNameText };
  const base: QuotePartPickPatch = {
    partNameText: patch.partNameText,
    partId: null,
    pickedPart: picked,
  };

  if (patch.unitPrice !== undefined) return { ...base, unitPrice: patch.unitPrice };
  /**
   * 🔵 여기까지 왔으면 고르개가 **채우지 않기로** 했다. 같은 부품이면 그대로 두면 되지만,
   * **부품이 바뀐 줄**이라면 남아 있는 금액이 앞 부품의 값이다 — 비운다(0 이 아니다).
   */
  return same ? base : { ...base, unitPrice: "" };
}

/**
 * 품명 칸에 글자를 칠 때 줄에 부을 조각. 🔴 `unitPrice` 키는 **비울 때만 생긴다**(위 고르개와
 * 같은 규약) — 키가 없으면 그 칸은 손대지 않은 채 남는다.
 */
export type QuotePartNameEditPatch = {
  partNameText: string;
  /** 🔴 글자를 치면 재고 연결을 **푼다** — 지금까지 그대로다(QuoteEditForm 의 그 자리). */
  partId: null;
  unitPrice?: string;
};

/**
 * ============================================================================
 * 🔴 **「고른 부품」 상세가 사라지면 단가도 사라진다** (2026-10-16 사용자 요청)
 * ============================================================================
 * 사용자가 한 말: 「선택된 부품이 없으면 단가도 사라지도록 해줘.」 그리고 **「선택된 부품」이
 * 무엇인지**를 사용자가 직접 짚어 주었다 — 「품목 칸의 **밑에 [고른 부품] 하고 작은 글씨가
 * 나오고 있는 상태**를 말한 거야.」
 *
 * 그래서 기준은 **「품명 칸이 비었는가」가 아니다.** 품명을 손으로 고쳐 그 작은 글씨가
 * 사라지는 순간이 곧 「고른 부품이 없어진」 순간이고, 그때 단가도 비운다. 품명을 통째로 지운
 * 경우는 여기에 저절로 들어간다 — 빈 글자가 고른 이름과 같을 수는 없다.
 *
 * ── 🔴 `options` 를 보지 않는 까닭 (지우기와 그리기는 다른 판정이다) ────────
 * 상세를 **그릴지**는 `quotePickedPartOf` 가 정하고, 그 함수는 재고 관리에서 받아 온 목록
 * (`options`)에서 그 부품을 찾아야 한다 — 모르는 것을 지어내지 않기 위해서다. 그래서 **목록을
 * 못 받아 온 날에도** null 을 돌려준다.
 * 🔴 **비울지를 그 함수로 정하면 안 된다.** 재고 관리와 통신이 끊긴 날 품명을 한 글자 고칠
 *    때마다 단가가 사라지고, **적어 둔 금액이 통신 탓에 날아간다**. 「지금 화면에 상세가 안
 *    보인다」와 「이 줄이 어느 부품에서 왔는지 모른다」는 다른 말이다 — 비우는 쪽은 **줄이 들고
 *    있는 기억**(`pickedPart`)과 바뀐 글자만 견준다(`isPickedPartNameKept`).
 *
 * ── 🔴 `pickedPart` 는 건드리지 않는다 ───────────────────────────────────
 * 그 기억은 「이름만 손보고 **같은 부품**을 다시 골랐다」를 알아보는 유일한 열쇠다(위
 * `quotePartPickPatch` 의 ㉡). 지우면 다시 고르는 것이 전부 「다른 부품」이 된다.
 * 🔵 그래서 비운 단가는 **같은 부품을 다시 고르는 것만으로** 견적가가 들어온다(고르개의
 *    「빈칸이면 채운다」). 🔵 고친 품명을 **원래 글자로 되돌리면** 상세는 다시 뜨지만 단가는
 *    비어 있는 그대로다 — 되살리지 않는다. 사라진 것이 저절로 돌아오면 사람이 못 믿는다.
 *
 * ── 🔴 `0` 이 아니라 **빈 글자**다 ───────────────────────────────────────
 * `"0"` 은 **무상**이라는 실제 값이다(@dss/core 의 part-price-field.ts). 「정하지 않았다」와
 * 「0원이다」는 다른 말이고, 0 으로 비우면 그 줄이 0원으로 청구된다.
 *
 * ── 🔵 손으로 적는 길은 그대로다 — 다만 **차례가 있다** ────────────────────
 * 부품 마스터에 없는 것을 손으로 적는 줄은 애초에 `pickedPart` 가 없어서, 품명을 칠 때마다
 * 단가가 빈 글자가 된다. **품명을 다 적은 뒤 단가를 적으면 그대로 남는다** — 단가 칸을 고치는
 * 것은 이 규칙을 타지 않는다(이 함수는 품명 칸의 onChange 에서만 불린다).
 * ============================================================================
 */
export function quotePartNameEditPatch(row: QuotePartPickRow, nameText: string): QuotePartNameEditPatch {
  const base: QuotePartNameEditPatch = { partNameText: nameText, partId: null };
  return isPickedPartNameKept(row.pickedPart, nameText) ? base : { ...base, unitPrice: "" };
}

/** 상세 줄의 머리말. 🔵 「고른 부품」이라고 적어야 **적힌 품명과 다른 글자**인 까닭이 읽힌다. */
export const QUOTE_PICKED_PART_PREFIX = "고른 부품";

/**
 * 작성자에게만 보이는 **고른 부품의 상세** (요청 ①).
 *
 * 🔴 **차례는 `PART_FIELD_ORDER` 가 정한다**(요청 ③ — 「어디서든 같은 순서」): 고객사 품명 ·
 *    품명 · 품명2 · 교산 품번 · 도번. 값이 있는 것만 그린다(`-` 만 적힌 칸도 없는 칸이다).
 * 🔴 **이름표를 단다** — 여기는 고르개의 후보 목록과 달리 줄이 하나뿐이라, 값만 이으면
 *    어느 것이 교산 품번이고 어느 것이 도번인지 알 길이 없다.
 * 🔵 **고객사 품명도 적는다** — 바로 위 칸에 같은 글자가 있지만, 그 칸은 사람이 손으로도
 *    고치는 자유 글자다. 둘이 나란히 보여야 「손으로 고쳤다」가 눈에 띈다.
 */
export function quotePickedPartDetail(option: PartPickerRow): string {
  return partFieldLabeledText(partFieldEntries(option));
}

/**
 * 이 줄의 상세로 그릴 부품. 없으면 null 이다 — null 이면 **아무것도 안 그린다**(지어내지 않는다).
 *
 * null 이 되는 경우 셋:
 *  · 아직 고른 적이 없다(손으로 적었거나 · 저장돼 있던 줄을 펼쳤다)
 *  · 🔴 **고른 뒤 이름을 손으로 고쳤다** — 적힌 이름이 그 부품에서 온 이름이 아니게 되었으니
 *    상세도 그 줄의 설명이 아니다. 그대로 두면 **딴 부품의 품번**을 그 줄의 것으로 읽게 된다.
 *    🔵 그래도 `pickedPart.id` 는 줄에 남아 있다 — 같은 부품을 다시 골랐을 때 금액을 지키는
 *       데 쓴다(머리말 ㉡).
 *  · 🔵 재고 관리에서 목록을 못 받아 왔다(`options` 가 비어 있다) — 모르는 것을 지어내지 않는다.
 *
 * 🔵 **베껴 두지 않고 번호로 되짚는** 까닭: 베끼면 고객사 품명이 채워진 뒤에도 이 줄만 옛 값을
 *    보인다(부품 요청 칸이 `partByNo` 로 같은 일을 하는 그 까닭이다).
 *
 * 🔴 **이름을 견주는 일은 `isPickedPartNameKept` 한 곳**이다 — 단가를 비울지 정하는
 *    `quotePartNameEditPatch` 가 같은 잣대를 쓴다. 두 벌로 적으면 언젠가 갈리고, 갈린 날
 *    「상세는 보이는데 단가가 비었다」(또는 그 반대)가 된다.
 *    🔵 갈리는 것은 **그 뒤 한 줄뿐**이다 — 여기만 목록에서 부품을 찾는다(위 셋째 경우).
 */
export function quotePickedPartOf(
  row: QuotePartPickRow,
  options: readonly PartPickerRow[]
): PartPickerRow | null {
  const picked = row.pickedPart;
  if (!isPickedPartNameKept(picked, row.partNameText)) return null;
  return options.find((option) => option.id === picked.id) ?? null;
}
