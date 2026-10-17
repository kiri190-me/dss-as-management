"use client";

import {
  CUSTOMER_PORTAL_FORMS,
  findPortalFormById,
} from "@/lib/domain/customer-portal-forms";

/**
 * ============================================================================
 * 고객 안내 양식 — 고르는 자리와 보여 주는 자리
 * ============================================================================
 * 「고객 안내 현황」은 고객사마다 **다른 표**를 그린다. 어느 표인가를 정하는 값이
 * `customers.portal_form_id` 이고, 이 파일이 그 칸을 사람이 고르는 자리다.
 *
 * ── 🔴 왜 손으로 고르게 하는가 (2026-10-17) ─────────────────────────────
 * 그 전까지는 **코드에 박아 둔 고객사 이름**으로 가렸다. 이름은 쓰는 분이 화면에서
 * 언제든 바꾸는 값이라, 2026-10-17 에 세 곳의 이름이 정식 상호로 바뀌자 코드가 알던
 * 이름 중 운영에 남은 것이 0개가 되어 **표 셋이 통째로 사라졌다.** 오류가 아니라
 * 「아무것도 없음」이라 원인이 보이지 않는다. 이제 새 고객사가 생기거나 이름이
 * 바뀌어도 **코드를 안 고치고** 이 자리에서 지정한다.
 *
 * ── 🔴 목록을 여기 베껴 적지 않는다 ─────────────────────────────────────
 * 고를 수 있는 양식은 등록부(domain/customer-portal-forms.ts 의
 * CUSTOMER_PORTAL_FORMS)에서 가져오고, **보이는 글자도 그 양식이 가진
 * `label`** 이다. 화면에 옮겨 적으면 양식이 늘 때 두 곳을 고쳐야 하고, 한쪽만
 * 고쳐지는 날 아무 오류도 나지 않는다(ui-theme-tokens.ts 가 같은 까닭을 적어 두었다).
 *
 * ── 🔴 「없음」이 정상이다 ──────────────────────────────────────────────
 * 현황표를 주고받는 고객사는 셋뿐이고, **나머지 전부가 「없음」이다.** 그래서
 * 「없음」을 맨 앞에 두고 그 뜻을 한 줄로 적는다 — 「아직 안 골랐다」처럼 결함으로
 * 읽히면 안 고쳐도 되는 고객사를 하나씩 열어 보게 된다.
 *
 * 짜임새(라디오 묶음 · 「없음」이 맨 앞 · 설명 한 줄 · fieldset 으로 한꺼번에 끄기)는
 * 같은 표의 같은 성질 칸인 CustomerRowColorField.tsx 를 그대로 따른다. 다른 점은
 * 하나다 — 색은 **눈으로** 골라야 해서 칸마다 견본을 칠하지만, 양식은 이름으로
 * 고르는 값이라 칠할 것이 없다. 그래서 라디오를 감추지 않고 그대로 보인다.
 * ============================================================================
 */

/**
 * 「없음」의 값. 폼 안에서 양식은 글자 하나로 다루는데(라디오의 value 는 문자열뿐)
 * DB 에서 「없음」은 `null` 이다. 그 둘을 잇는 자리가 빈 문자열이고, 저장할 때
 * 다시 `null` 로 돌아간다.
 */
export const NO_CUSTOMER_PORTAL_FORM_KEY = "";

/** 「없음」의 이름표. 고르개와 읽기 화면이 **같은 말**을 쓴다. */
export const NO_CUSTOMER_PORTAL_FORM_LABEL = "없음";

/**
 * 「없음」이 왜 정상인지 알려 주는 한 줄. 고르개와 읽기 화면에서 같은 글자를
 * 쓰려고 여기 둔다.
 */
export const CUSTOMER_PORTAL_FORM_HELP_TEXT =
  "현황표를 주고받는 고객사만 양식을 고릅니다. 대부분의 고객사는 「없음」이 정상이며, 그 고객사는 「고객 안내 현황」에 나오지 않습니다.";

/** 고르개에 서는 칸. 「없음」이 맨 앞이고, 그다음이 등록부 차례 그대로다. */
const OPTIONS: { key: string; label: string }[] = [
  { key: NO_CUSTOMER_PORTAL_FORM_KEY, label: NO_CUSTOMER_PORTAL_FORM_LABEL },
  ...CUSTOMER_PORTAL_FORMS.map((form) => ({ key: form.id, label: form.label })),
];

/**
 * 저장된 값을 사람이 읽는 이름으로. 🔴 등록부에서 못 찾는 값은 「없음」이다 —
 * 표를 그리는 길(resolvePortalFormForCustomer)이 그 값을 「양식 없음」으로 다루므로,
 * 화면이 다른 말을 하면 보이는 것과 실제가 어긋난다.
 */
export function customerPortalFormLabel(portalFormId: string | null | undefined): string {
  return findPortalFormById(portalFormId)?.label ?? NO_CUSTOMER_PORTAL_FORM_LABEL;
}

/**
 * 양식 고르개. 라디오 묶음이라 키보드 화살표로 옮겨 다니는 것도, 하나만 골리는
 * 것도 브라우저가 해 준다(CustomerRowColorField 의 같은 판단).
 *
 * 무엇을 골랐는지는 `value` 하나가 정한다 — 빈 문자열이면 「없음」, 등록부의 id 면
 * 그 양식이다. 따로 기억하는 상태가 없어서 화면에 골라져 보이는 것과 저장될 값이
 * 어긋날 자리가 없다.
 */
export function CustomerPortalFormPicker({
  value,
  disabled,
  onChange,
}: {
  /** 지금 고른 값 — 등록부의 양식 id, 또는 「없음」(빈 문자열). */
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  /**
   * 저장된 값이 등록부에 없을 때. 🔴 그 값을 **조용히 「없음」으로 바꾸지 않는다** —
   * 바꾸면 다른 칸만 고친 저장 한 번에 사람이 모르는 사이 값이 지워진다. 대신
   * 아무 칸도 골라져 있지 않은 채로 두고 무슨 일인지 아래에 적는다. 이 모양은
   * 양식을 등록부에서 하나 걷어낸 뒤에만 생긴다.
   */
  const unknown =
    value !== NO_CUSTOMER_PORTAL_FORM_KEY && findPortalFormById(value) === null;

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        고객 안내 양식
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((option) => {
          const selected = value === option.key;
          return (
            <label
              key={option.key || "__none__"}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-zinc-800 focus-within:ring-2 focus-within:ring-blue-500 dark:text-zinc-200 ${
                selected
                  ? "border-zinc-900 font-semibold dark:border-zinc-100"
                  : "border-zinc-300 dark:border-zinc-700"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="customer-portal-form"
                value={option.key}
                checked={selected}
                onChange={() => onChange(option.key)}
                className="h-3.5 w-3.5 shrink-0 accent-zinc-900 disabled:cursor-not-allowed dark:accent-zinc-50"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>

      {unknown && (
        <p
          role="status"
          className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          지금 저장된 양식({value})은 더 이상 쓰지 않는 양식입니다. 이 고객사는 「고객 안내
          현황」에 나오지 않습니다 — 위에서 다시 골라 주세요.
        </p>
      )}

      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {CUSTOMER_PORTAL_FORM_HELP_TEXT}
      </p>
    </fieldset>
  );
}
