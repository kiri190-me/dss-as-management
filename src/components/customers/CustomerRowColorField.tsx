"use client";

import { useState } from "react";

import {
  CUSTOMER_ROW_COLORS,
  CUSTOMER_ROW_DARK_SURFACE,
  CUSTOMER_ROW_LIGHT_SURFACE,
  NO_CUSTOMER_ROW_COLOR_KEY,
  NO_CUSTOMER_ROW_COLOR_LABEL,
  computeCustomerRowCustomTones,
  customerRowColorClass,
  customerRowColorStyle,
  isCustomerRowColorGrayish,
  isCustomerRowColorKey,
  normalizeCustomerRowCustomColor,
  readCustomerRowCustomContrast,
  resolveCustomerRowColor,
  type CustomerRowCustomContrastReading,
  type CustomerRowCustomTones,
} from "@/lib/domain/customer-row-color";
import { UI_THEME_CONTRAST_WARN } from "@/lib/domain/ui-theme-tokens";

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
 * 색 → 클래스 변환도, 직접 고른 색의 색조 계산도 여기서 하지 않는다. 그 판단은
 * 전부 domain/customer-row-color.ts 한 곳에 있고, 이 파일은 그 결과를 그릴 뿐이다.
 * ============================================================================
 */

/**
 * 색 견본 한 칸. 색이 없으면 **점선 테두리의 빈 칸**이다 — 실선 빈 칸으로 두면
 * "아직 안 정한 것"과 "흰색에 가까운 색을 고른 것"이 같은 모양이 된다.
 *
 * 직접 고른 색이면 클래스가 CSS 변수를 읽으므로 style 을 함께 붙인다 — 그래서
 * 견본도 줄과 똑같이 밝은/어두운 화면에 따라 색이 바뀐다.
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
        style={customerRowColorStyle(colorKey)}
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
 * 「직접 고르기」 라디오의 value. 팔레트 키·색 코드와 겹치지 않는다. 폼은 이 값을
 * 읽지 않는다 — 고른 색은 onChange 로 올라간다.
 */
const CUSTOM_OPTION_VALUE = "__custom__";

/**
 * 직접 고르기를 처음 열었을 때 색 판에 놓이는 색. 뜻은 없다 — 아무것도 고르지
 * 않은 상태에서 「직접 고르기」를 눌렀을 때 곧바로 견본이 보이게 하는 자리표다.
 */
const DEFAULT_CUSTOM_SEED = "#ffe4b5";

/**
 * 색 고르개. 팔레트 칸들은 라디오 버튼 묶음이다 — 겉모습만 칸으로 바꿨을 뿐이라
 * 키보드 화살표로 옮겨 다니는 것도, 하나만 골리는 것도 브라우저가 그대로 해 준다.
 * 직접 만든 버튼 묶음이었다면 그 둘을 손으로 다시 구현해야 한다.
 *
 * ── 열 가지 밖의 색은 「직접 고르기」로 (2026-09-13 사용자 요청) ─────────
 * 개발자 모드 [메인 컬러]의 「직접 고르기」와 같은 모양이다 — 라디오 + 색 판 +
 * 색 코드 입력이고, 색을 만지는 순간 「직접 고르기」로 옮겨 간다. 저장되는 것은
 * 고른 색 코드 하나이고, 줄에 칠할 옅은 색조는 domain/customer-row-color.ts 가
 * 그 한 색에서 계산한다(그 파일 머리말).
 *
 * ── 무엇을 골랐는지는 value 하나가 정한다 ────────────────────────────────
 * 빈 문자열이면 없음, 팔레트 키면 그 칸, 그 밖의 글자면 「직접 고르기」다. 따로
 * 기억하는 "고른 칸" 상태가 없어서, 화면에 골라져 보이는 것과 저장될 값이 어긋날
 * 자리가 없다. 색 코드를 치다가 형식이 어긋나면 친 글자가 그대로 올라가고, 그대로
 * 저장하려 하면 서버 검증이 거절해 이 칸 밑에 오류가 뜬다 — 마지막으로 맞았던
 * 색을 몰래 저장하지 않는다.
 */
export function CustomerRowColorPicker({
  value,
  disabled,
  onChange,
}: {
  /**
   * 지금 고른 값 — 팔레트 키, 색 코드(형식이 맞으면 정리된 소문자, 치는 중이면
   * 친 글자 그대로), 또는 없음(빈 문자열).
   */
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const isCustom = value !== NO_CUSTOMER_ROW_COLOR_KEY && !isCustomerRowColorKey(value);
  /**
   * 색 코드 칸의 원문. 팔레트로 옮겨 갔다가 돌아와도 치던 글자가 남아 있게
   * value 와 따로 들고 있다.
   */
  const [customText, setCustomText] = useState(isCustom ? value : DEFAULT_CUSTOM_SEED);

  function changeCustom(text: string) {
    setCustomText(text);
    onChange(normalizeCustomerRowCustomColor(text) ?? text);
  }

  function selectCustom() {
    // 칸을 비워 둔 채 라디오를 누르면 빈 문자열(= 없음)이 올라가 아무 일도 안
    // 일어난 것처럼 보인다. 그때만 자리표 색으로 채운다.
    changeCustom(customText.trim() === "" ? DEFAULT_CUSTOM_SEED : customText);
  }

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
      <CustomColorField
        isSelected={isCustom}
        text={customText}
        disabled={disabled}
        onSelect={selectCustom}
        onChange={changeCustom}
      />
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        내자 정리 목록에서 이 고객사의 줄에 칠할 색입니다. 완료 처리된 줄은 회색으로 남습니다.
      </p>
    </fieldset>
  );
}

// ───────────────────────────────────────────────────────── 직접 고르기

/**
 * 「직접 고르기」 칸. 모양과 움직임은 MainColorPicker 의 CustomColorField 를
 * 따른다. 다른 점은 둘이다:
 *   · 바깥이 <label> 이 아니라 <div> 다. 이 칸에는 견본과 대비 숫자까지 들어
 *     있어서, 통째로 라디오의 이름표로 삼으면 화면 낭독기가 그 전부를 라디오
 *     이름으로 읽는다. 이름표는 「직접 고르기」 글자에만 건다.
 *   · 라디오가 위 팔레트 칸들과 **같은 묶음**(name)이다 — 화살표로 팔레트에서
 *     직접 고르기까지 이어서 옮겨 다닐 수 있다.
 */
function CustomColorField({
  isSelected,
  text,
  disabled,
  onSelect,
  onChange,
}: {
  isSelected: boolean;
  text: string;
  disabled: boolean;
  onSelect: () => void;
  onChange: (value: string) => void;
}) {
  /** 형식이 맞는 동안만 색이 있다. 어긋나면 견본도 대비도 그리지 않는다. */
  const seed = normalizeCustomerRowCustomColor(text);
  const tones = seed ? computeCustomerRowCustomTones(seed) : null;
  const grayish = seed ? isCustomerRowColorGrayish(seed) : false;
  // 비어 있으면 형식 오류가 아니라 "없음"이다(고르개 머리말) — 빨간 글자로
  // 나무라지 않는다.
  const showFormatError = seed === null && text.trim() !== "";

  return (
    <div
      className={`mt-2 flex flex-col gap-2 rounded-md border p-2 ${
        isSelected ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-700"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <label
        className={`inline-flex items-center gap-1.5 text-xs text-zinc-800 dark:text-zinc-200 ${
          isSelected ? "font-semibold" : ""
        } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          type="radio"
          name="customer-row-color"
          value={CUSTOM_OPTION_VALUE}
          checked={isSelected}
          onChange={onSelect}
          className="h-3.5 w-3.5 shrink-0 accent-zinc-900 disabled:cursor-not-allowed dark:accent-zinc-50"
        />
        직접 고르기
      </label>

      <span className="flex flex-wrap items-center gap-1.5">
        <input
          type="color"
          aria-label="목록 배경색 고르개"
          // 고르개는 유효한 hex 만 표시할 수 있다. 글자를 고치는 중이라 값이 아직
          // 형식에 안 맞으면 검정을 보여 준다 — 옆의 글자 입력이 원문을 그대로
          // 들고 있으므로 무엇을 치고 있었는지는 사라지지 않는다.
          value={seed ?? "#000000"}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent disabled:cursor-not-allowed dark:border-zinc-700"
        />
        <input
          type="text"
          aria-label="목록 배경색 색 코드"
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className={`w-28 rounded-md border px-2 py-1 font-mono text-xs disabled:cursor-not-allowed ${
            showFormatError
              ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400"
              : "border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
          }`}
        />
        {showFormatError && (
          <span className="text-[10px] text-red-700 dark:text-red-400">#rrggbb 여섯 자리만 됩니다</span>
        )}
      </span>

      {tones && <CustomColorPreview tones={tones} />}

      {grayish && (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          회색에 가까운 색입니다. 내자 정리의 완료된 줄(회색)과 헷갈릴 수 있습니다.
        </p>
      )}

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        고른 색에서 <strong>색상과 채도만</strong> 씁니다. 밝기는 위 열 가지 색과 같은 자리로
        맞추므로, 진한 색을 골라도 줄은 옅게 칠해지고 글씨는 그대로 읽힙니다.
      </p>
    </div>
  );
}

/**
 * 줄이 밝은 화면·어두운 화면에서 어떻게 보이는지 — 평소와 마우스를 얹었을 때를
 * 대비 숫자와 함께 그린다.
 *
 * 🔴 클래스가 아니라 **인라인 색**으로 그린다. 어두운 화면 문서 안에서는 어떤
 * 컨테이너로 감싸도 그 안을 「밝은 화면인 척」하게 만들 수 없어서, 클래스로 그리면
 * 지금 화면 쪽 견본만 맞고 나머지는 거짓이 된다(MainColorPicker 의 AccentSample 과
 * 같은 까닭). 색은 전부 도메인이 만든 소문자 hex 여섯 자리다.
 */
function CustomColorPreview({ tones }: { tones: CustomerRowCustomTones }) {
  const readings = readCustomerRowCustomContrast(tones);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <PreviewFrame
        title="밝은 화면"
        surface={CUSTOMER_ROW_LIGHT_SURFACE}
        readings={readings.filter((reading) => reading.scope === "light")}
      />
      <PreviewFrame
        title="어두운 화면"
        surface={CUSTOMER_ROW_DARK_SURFACE}
        readings={readings.filter((reading) => reading.scope === "dark")}
      />
    </div>
  );
}

function PreviewFrame({
  title,
  surface,
  readings,
}: {
  title: string;
  surface: string;
  readings: readonly CustomerRowCustomContrastReading[];
}) {
  return (
    <div className="overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
      <p className="border-b border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
        {title}
      </p>
      <div className="flex flex-col gap-1 p-1.5" style={{ backgroundColor: surface }}>
        {readings.map((reading) => (
          <span
            key={reading.state}
            className="flex flex-wrap items-baseline justify-between gap-x-2 rounded px-2 py-1 text-xs"
            style={{ backgroundColor: reading.bg, color: reading.fg }}
          >
            <span>{reading.label}</span>
            <span className="font-mono tabular-nums">
              글자 대비 {reading.ratio.toFixed(2)}:1
              {reading.ratio < UI_THEME_CONTRAST_WARN ? " · 낮음" : ""}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
