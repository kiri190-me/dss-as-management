"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  resolveUiTheme,
  UI_THEME_CONTRAST_FLOOR,
  UI_THEME_CONTRAST_WARN,
  type UiThemeOverrideRow,
} from "@/lib/domain/ui-theme-tokens";
import {
  buildUiThemePrimaryRamp,
  countUiThemePrimaryRampDiff,
  detectUiThemeMainColor,
  findUiThemeMainColor,
  normalizeUiThemePrimarySeed,
  readUiThemePrimaryContrast,
  resolveUiThemeWithPrimaryRamp,
  uiThemePrimaryRampToChanges,
  UI_THEME_MAIN_COLORS,
  UI_THEME_PRIMARY_ON_LIGHT,
  UI_THEME_PRIMARY_RAMP_KEYS,
  type PrimaryRamp,
  type UiThemeMainColor,
  type UiThemePrimaryContrastReading,
} from "@/lib/domain/ui-theme-primary-ramp";
import { saveUiThemeTokensAction } from "@/lib/server/actions/ui-theme-tokens";
import ThemeTokenPreview from "./ThemeTokenPreview";

/**
 * ============================================================================
 * 메인 컬러 고르기 — 색 하나로 강조 램프 11단을 갈아 끼우는 화면
 * ============================================================================
 * 색상 톤 템플릿(ThemeTemplatePicker)이 **중립**을 한 벌 고르는 자리라면, 여기는
 * **강조색 하나**를 고르는 자리다. 저장되는 것은 똑같은 `ui_theme_tokens` 행이고
 * 저장 경로도 같은 서버 액션 하나다 — 이 화면이 따로 아는 것은 없다.
 *
 * ── 🔴 이 화면은 강조색만 바꾼다 ────────────────────────────────────────
 * 바탕·글자·테두리 같은 중립색은 「색상 톤 템플릿」이, 모서리·글자 크기는
 * 「모서리 · 글자 크기」가 맡는다. 적어 두지 않으면 「메인 컬러를 골랐는데 배경은
 * 왜 그대로지」가 고장으로 읽힌다.
 *
 * ── 지금 쓰는 색은 기억해 둔 것이 아니라 대조해 알아낸 것이다 ───────────
 * 「무슨 메인 컬러를 쓰는가」를 따로 저장하지 않는다(domain/ui-theme-primary-ramp.ts
 * 머리말). 색 화면에서 강조색 한 칸만 손으로 고쳐도 여기서는 곧바로 「직접 고른
 * 색입니다」로 바뀐다 — 이름과 값이 어긋날 자리를 만들지 않는다.
 *
 * ── 🔴 주 버튼의 대비는 이 화면이 스스로 잰다 ───────────────────────────
 * 서버가 저장을 거절하는 4쌍에 강조색은 들어 있지 않다. 생성기가 이미 경고선
 * 위로 못 박아 두었으므로 여기서 경고가 나올 일은 없지만, **같은 함수로 한 번 더
 * 재서** 화면에 적는다 — 시험과 화면이 같은 판정을 해야, 나중에 생성기를 손보다
 * 선을 넘겼을 때 두 곳이 함께 드러난다.
 *
 * ── 🔴 이 화면도 구조선 안에서 그려진다 ─────────────────────────────────
 * 감싸는 레이아웃(settings/developer/layout.tsx)이 모든 토큰을 기본값으로
 * 되돌려 놓기 때문에, 저장된 값이 무엇이든 이 화면만은 항상 읽힌다. 견본이 고른
 * 색을 보여줄 수 있는 것은 인라인 style 이 그 컨테이너 선언을 이기기 때문이다
 * (ThemeTokenPreview.tsx).
 * ============================================================================
 */

/** 「직접 고르기」 카드의 자리표. 메인 컬러 키와 겹치지 않는다. */
const CUSTOM_KEY = "custom";

/** 램프에서 어느 단계가 어느 자리인지. 견본과 안내 문구가 같은 상수를 본다. */
const BUTTON_LIGHT_KEY = "primary-900";
const BUTTON_DARK_KEY = "primary-50";
const MENU_LIGHT_KEY = "primary-100";
const MENU_DARK_KEY = "primary-800";

type Selection = { key: string; name: string; ramp: PrimaryRamp };

export default function MainColorPicker({ saved }: { saved: readonly UiThemeOverrideRow[] }) {
  const router = useRouter();

  /** 지금 저장돼 있는 값이 어느 메인 컬러인가. 어느 것과도 다르면 null. */
  const current = useMemo(() => detectUiThemeMainColor(saved), [saved]);

  /**
   * 지금 저장돼 있는 강조 램프. 아무것도 고르지 않았을 때 견본과 대비가 보는 것이
   * 이것이다.
   *
   * 라이트 값만 읽는다 — 이 화면은 언제나 라이트와 다크에 같은 값을 저장하므로
   * 둘이 갈라지는 것은 색 화면에서 한쪽만 손으로 고친 경우뿐이고, 그때는 이미
   * 「직접 고른 색입니다」로 표시된다.
   */
  const savedRamp = useMemo(() => {
    const resolvedSaved = resolveUiTheme(saved);
    const ramp: Record<string, string> = {};
    for (const key of UI_THEME_PRIMARY_RAMP_KEYS) ramp[key] = resolvedSaved.light[key];
    return ramp;
  }, [saved]);

  /** 고른 것. null 이면 아무것도 고르지 않은 상태 — 견본은 저장된 값 그대로다. */
  const [selectedKey, setSelectedKey] = useState<string | null>(current?.key ?? null);
  /** 직접 고르기 칸의 원문. 사람이 치는 중인 글자가 그대로 들어온다. */
  const [seedText, setSeedText] = useState<string>(savedRamp[BUTTON_LIGHT_KEY]);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /** 직접 고른 씨앗. 형식이 어긋난 동안에는 null 이고, 램프도 만들지 않는다. */
  const seed = useMemo(() => normalizeUiThemePrimarySeed(seedText), [seedText]);
  const customRamp = useMemo(() => (seed ? buildUiThemePrimaryRamp(seed) : null), [seed]);

  const selected: Selection | null = useMemo(() => {
    if (selectedKey === CUSTOM_KEY) {
      return customRamp ? { key: CUSTOM_KEY, name: "직접 고른 색", ramp: customRamp } : null;
    }
    const found = selectedKey ? findUiThemeMainColor(selectedKey) : null;
    return found ? { key: found.key, name: found.name, ramp: found.ramp } : null;
  }, [customRamp, selectedKey]);

  /**
   * 견본과 대비가 함께 보는 한 벌.
   *
   * 🔴 강조색만 덮고 중립·경고색과 모서리·글자 크기는 **저장된 값 그대로** 둔다.
   * 견본이 기본 중립으로 그려지면, 톤을 고쳐 둔 관리자에게는 「메인 컬러가 톤까지
   * 되돌린다」로 읽힌다.
   */
  const resolved = useMemo(
    () => (selected ? resolveUiThemeWithPrimaryRamp(saved, selected.ramp) : resolveUiTheme(saved)),
    [saved, selected]
  );

  const activeRamp = selected ? selected.ramp : savedRamp;
  const readings = useMemo(
    () => readUiThemePrimaryContrast(activeRamp, resolved),
    [activeRamp, resolved]
  );
  const warned = readings.filter(
    (reading) => reading.pair.required && reading.ratio < UI_THEME_CONTRAST_WARN
  );

  /** 지금 저장된 값과 고른 색이 몇 칸 다른가. 저장되는 칸 수와 같다. */
  const changedCount = useMemo(
    () => (selected ? countUiThemePrimaryRampDiff(selected.ramp, saved) : 0),
    [saved, selected]
  );

  const canSave = !isSaving && selected !== null && changedCount > 0;

  function selectPreset(mainColor: UiThemeMainColor) {
    setSelectedKey(mainColor.key);
    setMessage(null);
  }

  function changeSeed(value: string) {
    setSeedText(value);
    // 색을 만지는 순간 「직접 고르기」로 옮겨 간다 — 고르개를 돌렸는데 견본이
    // 안 바뀌면 그것이 곧 고장으로 읽힌다.
    setSelectedKey(CUSTOM_KEY);
    setMessage(null);
  }

  async function save() {
    if (!canSave || !selected) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveUiThemeTokensAction({
        // 강조색 22칸을 전부 싣는다. 기본값과 같아진 칸은 `value: null` 로 나가
        // 저장된 행이 지워진다(domain/ui-theme-primary-ramp.ts).
        changes: uiThemePrimaryRampToChanges(selected.ramp),
      });
      setConfirmOpen(false);
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setMessage({
        type: "success",
        text: `${result.message} 다른 사용자는 다음 화면 이동부터 보입니다.`,
      });
      // 저장 결과를 서버에서 다시 받아야 「지금 쓰는 색」 표시가 실제와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">메인 컬러</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          색 하나를 고르면 강조색 {UI_THEME_PRIMARY_RAMP_KEYS.length}단을 자동으로 만들어{" "}
          <strong>주 버튼</strong>과 <strong>선택된 메뉴</strong>에 적용합니다. 밝기는 지금 앱이 쓰는
          중립 램프의 곡선을 그대로 따르고, 고른 색에서는 색상과 채도만 가져옵니다.
        </p>
      </div>

      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <strong>저장하면 전 직원 화면에 적용됩니다.</strong> 이 값은 특정 사용자 설정이 아니라 앱 전체의
        기본 팔레트입니다. 다른 사용자에게는 다음 화면 이동부터 보입니다. 되돌리려면{" "}
        <strong>회색 (기본)</strong>을 고르고 다시 저장하면 됩니다.
      </p>

      {/*
        🔴 적어 두지 않으면 「메인 컬러를 골랐는데 배경은 왜 그대로지」가 고장으로
        읽힌다. 강조색과 중립색을 한 단추에 묶지 않는 것이 이 화면의 규율이다.
      */}
      <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <strong>이 화면은 강조색만 바꿉니다.</strong> 페이지 바탕·글자·테두리 같은 중립색은{" "}
        <strong>색상 톤 템플릿</strong>에서, 모서리와 글자 크기는{" "}
        <strong>모서리 · 글자 크기</strong>에서 따로 정합니다. 그래서 메인 컬러를 바꿔도 화면의 인상은
        그대로이고, <strong>주 버튼과 선택된 메뉴만</strong> 물듭니다.
      </p>

      <CurrentColorNote current={current} />

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          메인 컬러 고르기 — 고르면 저장하지 않고 아래 견본이 먼저 바뀝니다
        </legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          {UI_THEME_MAIN_COLORS.map((mainColor) => (
            <MainColorCard
              key={mainColor.key}
              mainColor={mainColor}
              isSelected={selectedKey === mainColor.key}
              isCurrent={current?.key === mainColor.key}
              diffCount={countUiThemePrimaryRampDiff(mainColor.ramp, saved)}
              disabled={isSaving}
              onSelect={selectPreset}
            />
          ))}
        </div>
      </fieldset>

      <CustomColorField
        isSelected={selectedKey === CUSTOM_KEY}
        seedText={seedText}
        seed={seed}
        ramp={customRamp}
        disabled={isSaving}
        onSelect={() => {
          setSelectedKey(CUSTOM_KEY);
          setMessage(null);
        }}
        onChange={changeSeed}
      />

      <AccentSample ramp={activeRamp} resolved={resolved} />

      <ThemeTokenPreview light={resolved.light} dark={resolved.dark} />

      <ContrastSummary readings={readings} warned={warned} />

      {message && (
        <p
          role="status"
          className={
            message.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          }
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {selected === null
            ? "메인 컬러를 고르면 저장할 수 있습니다."
            : changedCount === 0
              ? `지금 저장돼 있는 값이 이미 「${selected.name}」입니다. 바뀔 칸이 없습니다.`
              : `「${selected.name}」을(를) 저장하면 강조색 ${changedCount}칸이 바뀝니다.`}
        </p>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!canSave}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
        >
          저장
        </button>
      </div>

      <SaveConfirmDialog
        isOpen={isConfirmOpen}
        isSaving={isSaving}
        selected={selected}
        changedCount={changedCount}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </section>
  );
}

// ──────────────────────────────────────────────────── 지금 쓰는 메인 컬러

function CurrentColorNote({ current }: { current: UiThemeMainColor | null }) {
  if (current) {
    return (
      <p className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        지금 쓰는 메인 컬러는{" "}
        <strong className="text-zinc-900 dark:text-zinc-50">{current.name}</strong> 입니다.
      </p>
    );
  }
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <strong>지금은 직접 고른 색입니다.</strong> 저장된 강조색이 아래 어느 것과도 맞지 않습니다 — 직접
      고르기로 저장했거나, 색 화면에서 강조색을 한 칸이라도 손으로 고치면 이 상태가 됩니다.
    </p>
  );
}

// ─────────────────────────────────────────────────────────── 카드

function MainColorCard({
  mainColor,
  isSelected,
  isCurrent,
  diffCount,
  disabled,
  onSelect,
}: {
  mainColor: UiThemeMainColor;
  isSelected: boolean;
  isCurrent: boolean;
  diffCount: number;
  disabled: boolean;
  onSelect: (mainColor: UiThemeMainColor) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${
        isSelected
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-800"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <input
          type="radio"
          name="ui-theme-main-color"
          value={mainColor.key}
          checked={isSelected}
          disabled={disabled}
          onChange={() => onSelect(mainColor)}
          className="h-4 w-4 shrink-0 accent-zinc-900 disabled:cursor-not-allowed dark:accent-zinc-50"
        />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {mainColor.name}
        </span>
        {isCurrent && (
          <span className="rounded-sm bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            지금 쓰는 색
          </span>
        )}
        {!isCurrent && diffCount > 0 && (
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            지금 값과 {diffCount}칸 다름
          </span>
        )}
      </span>

      <RampStrip ramp={mainColor.ramp} />

      <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {mainColor.description}
      </span>
    </label>
  );
}

/**
 * 램프 11단을 띠 하나로.
 *
 * 값은 등록부를 지난 hex 여섯 자리뿐이고, React 가 style 프로퍼티로 넣으므로
 * 문자열이 규칙을 탈출할 자리가 없다(ThemeTokenPreview 와 같은 처리).
 */
function RampStrip({ ramp }: { ramp: PrimaryRamp }) {
  return (
    <span className="flex gap-0.5">
      {UI_THEME_PRIMARY_RAMP_KEYS.map((key) => (
        <span
          key={key}
          title={`${key} — ${ramp[key]}`}
          style={{ backgroundColor: ramp[key] }}
          className="h-5 flex-1 rounded-sm border border-zinc-300 dark:border-zinc-600"
        />
      ))}
    </span>
  );
}

// ───────────────────────────────────────────────────────── 직접 고르기

function CustomColorField({
  isSelected,
  seedText,
  seed,
  ramp,
  disabled,
  onSelect,
  onChange,
}: {
  isSelected: boolean;
  seedText: string;
  seed: string | null;
  ramp: PrimaryRamp | null;
  disabled: boolean;
  onSelect: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${
        isSelected
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-800"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <input
          type="radio"
          name="ui-theme-main-color"
          value={CUSTOM_KEY}
          checked={isSelected}
          disabled={disabled}
          onChange={onSelect}
          className="h-4 w-4 shrink-0 accent-zinc-900 disabled:cursor-not-allowed dark:accent-zinc-50"
        />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">직접 고르기</span>
      </span>

      <span className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label="메인 컬러 고르개"
          // 고르개는 유효한 hex 만 표시할 수 있다. 글자를 고치는 중이라 값이 아직
          // 형식에 안 맞으면 검정을 보여 준다 — 옆의 글자 입력이 원문을 그대로
          // 들고 있으므로 무엇을 치고 있었는지는 사라지지 않는다.
          value={seed ?? "#000000"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
        />
        <input
          type="text"
          aria-label="메인 컬러 색 코드"
          value={seedText}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`w-28 rounded-md border px-2 py-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
            seed === null
              ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400"
              : "border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
          }`}
        />
        {seed === null && (
          <span className="text-[10px] text-red-700 dark:text-red-400">
            #rrggbb 여섯 자리만 됩니다
          </span>
        )}
      </span>

      {ramp && <RampStrip ramp={ramp} />}

      <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        고른 색에서 <strong>색상과 채도만</strong> 씁니다. 밝기는 중립 램프의 곡선이 정하므로, 아주 밝은
        색을 골라도 주 버튼은 흰 글자가 읽히는 깊이까지 어두워집니다.
      </span>
    </label>
  );
}

// ────────────────────────────────────────────── 강조색이 바뀌는 자리 견본

/**
 * 메인 컬러가 실제로 바뀌는 두 자리(주 버튼 · 선택된 메뉴)를 라이트·다크 넷으로
 * 그린다.
 *
 * 🔴 유틸리티 클래스가 아니라 **인라인 색**으로 그린다. 다크 모드 문서 안에서는
 * 어떤 컨테이너로 감싸도 그 안을 「라이트인 척」하게 만들 수 없어서
 * (ThemeTokenPreview.tsx 머리말), 클래스로 그리면 지금 테마 쪽 두 칸만 맞고
 * 나머지 둘은 거짓이 된다. 여기서 보여 줄 것은 「이 색과 저 글자가 겹친다」 하나뿐이라
 * 색을 직접 얹는 편이 정확하다.
 */
function AccentSample({
  ramp,
  resolved,
}: {
  ramp: PrimaryRamp;
  resolved: { light: Record<string, string>; dark: Record<string, string> };
}) {
  const onLight = UI_THEME_PRIMARY_ON_LIGHT;
  const onDark = resolved.dark["zinc-900"];
  const menuTextLight = resolved.light["zinc-900"];
  const menuTextDark = resolved.dark["zinc-50"];

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          메인 컬러가 바뀌는 자리
        </h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          앱에서 강조색이 쓰이는 곳은 이 둘뿐입니다. 지금 테마와 상관없이 라이트·다크 양쪽을 함께
          보여 줍니다.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SampleFrame title="라이트" background={resolved.light.background}>
          <span
            className="inline-block rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: ramp[BUTTON_LIGHT_KEY], color: onLight }}
          >
            주 단추
          </span>
          <span
            className="block rounded-md px-3 py-2 text-sm font-medium"
            style={{
              backgroundColor: ramp[MENU_LIGHT_KEY],
              borderLeft: `2px solid ${ramp[BUTTON_LIGHT_KEY]}`,
              color: menuTextLight,
            }}
          >
            선택된 메뉴
          </span>
        </SampleFrame>

        <SampleFrame title="다크" background={resolved.dark.background}>
          <span
            className="inline-block rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: ramp[BUTTON_DARK_KEY], color: onDark }}
          >
            주 단추
          </span>
          <span
            className="block rounded-md px-3 py-2 text-sm font-medium"
            style={{
              backgroundColor: ramp[MENU_DARK_KEY],
              borderLeft: `2px solid ${ramp[BUTTON_DARK_KEY]}`,
              color: menuTextDark,
            }}
          >
            선택된 메뉴
          </span>
        </SampleFrame>
      </div>
    </div>
  );
}

function SampleFrame({
  title,
  background,
  children,
}: {
  title: string;
  background: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <p className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {title}
      </p>
      <div className="flex flex-col gap-2 p-3" style={{ backgroundColor: background }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── 대비

function ContrastSummary({
  readings,
  warned,
}: {
  readings: readonly UiThemePrimaryContrastReading[];
  warned: readonly UiThemePrimaryContrastReading[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {warned.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <p>
            <strong>주 버튼의 글씨가 읽히지 않습니다.</strong> 이 색은 저장하지 마세요 — 서버는 강조색의
            대비를 막지 않으므로, 저장하면 전 직원의 주 버튼에서 글자가 사라집니다.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {warned.map((reading) => (
              <li key={reading.pair.key}>
                {reading.pair.label} — {reading.ratio.toFixed(2)}:1
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <p className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          대비 — 강조색이 글자와 겹치는 자리만 잽니다.
        </p>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[26rem] border-collapse text-sm">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th scope="col" className="py-1 pr-3 text-left font-medium">
                  글자 / 바탕
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  대비
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  판정
                </th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading) => (
                <tr key={reading.pair.key} className="border-t border-zinc-200 dark:border-zinc-800">
                  <th
                    scope="row"
                    className="py-1.5 pr-3 text-left font-normal text-zinc-700 dark:text-zinc-300"
                  >
                    {reading.pair.label}
                  </th>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {reading.ratio.toFixed(2)}:1
                  </td>
                  <td className="py-1.5 text-xs">
                    <ContrastVerdict ratio={reading.ratio} required={reading.pair.required} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-zinc-200 px-3 py-2 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {UI_THEME_CONTRAST_WARN}:1 은 WCAG AA 본문 기준입니다. 주 버튼 두 짝은 램프를 만들 때{" "}
          <strong>재서 그 위로 맞추므로</strong> 여기서 경고가 나올 일이 없고, 선택된 메뉴는 색에 따라
          낮아질 수 있지만 글씨가 사라지지는 않습니다.
        </p>
      </div>
    </div>
  );
}

function ContrastVerdict({ ratio, required }: { ratio: number; required: boolean }) {
  if (ratio < UI_THEME_CONTRAST_FLOOR) {
    return <span className="text-red-700 dark:text-red-400">너무 낮습니다</span>;
  }
  if (ratio < UI_THEME_CONTRAST_WARN) {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        {required ? "주 버튼 글씨가 읽히지 않습니다" : "낮습니다"}
      </span>
    );
  }
  return <span className="text-zinc-500 dark:text-zinc-400">충분합니다</span>;
}

// ────────────────────────────────────────────────────────── 저장 확인 창

/**
 * 되돌리기 어려운 동작은 다이얼로그로 두 번 확인한다(UI_GUIDELINE 5절).
 * 이 저장소의 다른 확인 창들과 같은 native <dialog> 패턴이다.
 */
function SaveConfirmDialog({
  isOpen,
  isSaving,
  selected,
  changedCount,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isSaving: boolean;
  selected: Selection | null;
  changedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="ui-theme-main-color-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="ui-theme-main-color-dialog-title" className="text-sm font-semibold">
        메인 컬러 저장
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {selected ? (
          <>
            <strong className="text-zinc-900 dark:text-zinc-50">{selected.name}</strong> 으로 강조색{" "}
            {changedCount}칸을 바꿉니다. <strong>모든 사용자</strong>의 주 버튼과 선택된 메뉴가 다음 화면
            이동부터 이 색으로 그려집니다.
          </>
        ) : (
          <>고른 색이 없습니다.</>
        )}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        중립색(바탕·글자·테두리)과 모서리·글자 크기는 바뀌지 않습니다. 되돌리려면{" "}
        <strong>회색 (기본)</strong>을 고르고 다시 저장하면 되고, 화면이 읽히지 않을 만큼 어긋났다면
        주소창에 <code className="font-mono">/api/theme/bypass</code>를 쳐서 이 브라우저만 원래 화면으로
        볼 수 있습니다.
      </p>

      {selected && (
        <div className="mt-3">
          <RampStrip ramp={selected.ramp} />
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSaving || selected === null}
          aria-busy={isSaving}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSaving ? "저장 중..." : "저장"}
        </button>
      </div>
    </dialog>
  );
}
