"use client";

import {
  CUSTOMER_ROW_COLORS,
  NO_CUSTOMER_ROW_COLOR_KEY,
  NO_CUSTOMER_ROW_COLOR_LABEL,
  customerRowColorClass,
  resolveCustomerRowColor,
} from "@/lib/domain/customer-row-color";

/**
 * ============================================================================
 * 고객사 줄 배경색 — 고르는 자리와 보여 주는 자리
 * ============================================================================
 * 색은 **눈으로 골라야 한다.** "amber"라는 글자만 늘어놓으면 그것이 어떤 색인지
 * 고르는 순간에는 알 수 없고, 내자 정리 목록을 열어 봐야 알게 된다. 그래서
 * 고르개의 각 칸이 그 색으로 칠해져 있다.
 *
 * 그러면서도 **이름을 함께 적는다** — 색을 구분하기 어려운 사람에게는 그 글자가
 * 유일한 단서이고, 목록의 완료 배지가 회색 옆에 "완료"라고 적어 두는 것과 같은
 * 이유다.
 *
 * 색 → 클래스 변환은 여기서 하지 않는다. 그 판단은 전부
 * domain/customer-row-color.ts 한 곳에 있고, 이 파일은 그 결과를 그릴 뿐이다.
 * ============================================================================
 */

/**
 * 색 견본 한 칸. 색이 없으면 **점선 테두리의 빈 칸**이다 — 실선 빈 칸으로 두면
 * "아직 안 정한 것"과 "흰색을 고른 것"이 같은 모양이 된다(팔레트에 흰색은
 * 없다).
 *
 * 이름표를 함께 달아 둔다. 화면 낭독기에게 색은 아무것도 아니라서, 이 글자가
 * 없으면 견본은 존재하지 않는 것과 같다.
 */
export function CustomerRowColorSwatch({ colorKey }: { colorKey: string | null | undefined }) {
  const color = resolveCustomerRowColor(colorKey);
  const background = customerRowColorClass(colorKey);
  return (
    <span className="inline-flex items-center">
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 shrink-0 rounded-sm ${
          color === null
            ? "border border-dashed border-zinc-400 dark:border-zinc-500"
            : `border border-zinc-300 dark:border-zinc-600 ${background}`
        }`}
      />
      <span className="sr-only">
        목록 배경색 {color?.label ?? NO_CUSTOMER_ROW_COLOR_LABEL}
      </span>
    </span>
  );
}

/** 고르개에 서는 칸 하나. "없음"이 맨 앞이고, 그다음이 팔레트 순서다. */
const OPTIONS: { key: string; label: string }[] = [
  { key: NO_CUSTOMER_ROW_COLOR_KEY, label: NO_CUSTOMER_ROW_COLOR_LABEL },
  ...CUSTOMER_ROW_COLORS.map((color) => ({ key: color.key, label: color.label })),
];

/**
 * 색 고르개. 라디오 버튼 묶음이다 — 겉모습만 칸으로 바꿨을 뿐이라 키보드 화살표로
 * 옮겨 다니는 것도, 하나만 골리는 것도 브라우저가 그대로 해 준다. 직접 만든
 * 버튼 묶음이었다면 그 둘을 손으로 다시 구현해야 한다.
 *
 * 자유 색 고르개(<input type="color">)가 아니다. 저장되는 값이 팔레트 키뿐이라야
 * 나중에 색조를 코드에서 한꺼번에 조절할 수 있다(schema/customers.ts 의
 * row_color 주석).
 */
export function CustomerRowColorPicker({
  value,
  disabled,
  onChange,
}: {
  /** 지금 고른 팔레트 키. 없음은 빈 문자열이다. */
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        목록 배경색
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((option) => {
          const selected = value === option.key;
          const background = customerRowColorClass(option.key);
          return (
            <label
              key={option.key || "__none__"}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-zinc-800 focus-within:ring-2 focus-within:ring-blue-500 dark:text-zinc-200 ${background} ${
                selected
                  ? "border-zinc-900 font-semibold dark:border-zinc-100"
                  : "border-zinc-300 dark:border-zinc-700"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="customer-row-color"
                value={option.key}
                checked={selected}
                onChange={() => onChange(option.key)}
                // 라디오 자체는 감춘다 — 칸 전체가 그 라디오의 이름표라서
                // 아무 데나 눌러도 골라지고, 포커스 테두리는 위의
                // focus-within 이 칸에 그려 준다.
                className="sr-only"
              />
              {/* 칠해진 칸 자체가 견본이지만, "없음" 칸에는 칠할 색이 없다.
                  그 칸에도 같은 자리에 같은 크기의 표시가 있어야 줄이 흐트러지지
                  않는다. */}
              <CustomerRowColorSwatch colorKey={option.key} />
              <span aria-hidden="true">{option.label}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        내자 정리 목록에서 이 고객사의 줄에 칠할 색입니다. 완료 처리된 줄은 회색으로 남습니다.
      </p>
    </fieldset>
  );
}
