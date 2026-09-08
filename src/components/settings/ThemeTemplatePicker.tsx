"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  contrastRatio,
  resolveUiTheme,
  UI_THEME_CONTRAST_BLOCKING,
  UI_THEME_CONTRAST_FLOOR,
  UI_THEME_CONTRAST_PAIRS,
  UI_THEME_CONTRAST_WARN,
  UI_THEME_TOKENS,
  type UiThemeContrastPair,
  type UiThemeOverrideRow,
} from "@/lib/domain/ui-theme-tokens";
import {
  countUiThemeTemplateDiff,
  detectUiThemeTemplate,
  resolveUiThemeWithTemplate,
  uiThemeTemplateToChanges,
  UI_THEME_TEMPLATES,
  type UiThemeTemplate,
} from "@/lib/domain/ui-theme-templates";
import { saveUiThemeTokensAction } from "@/lib/server/actions/ui-theme-tokens";
import ThemeTokenPreview from "./ThemeTokenPreview";

/**
 * ============================================================================
 * 색상 톤 템플릿 고르기 — 색 70값을 한 번에 갈아 끼우는 화면
 * ============================================================================
 * 색 화면(ThemeTokenEditor)이 70칸을 하나씩 고치는 자리라면, 여기는 **미리
 * 맞춰 둔 한 벌**을 골라 넣는 자리다. 저장되는 것은 똑같은 `ui_theme_tokens`
 * 행이고, 저장 경로도 같은 서버 액션 하나다 — 이 화면이 따로 아는 것은 없다.
 *
 * ── 🔴 모서리·글자 크기는 이 화면이 건드리지 않는다 ─────────────────────
 * 톤을 고르는 일과 크기를 고르는 일이 한 단추에 묶이면 「톤만 바꿨는데 글자
 * 크기까지 바뀐」 상태가 되고, 되돌릴 때 무엇이 함께 움직였는지 알 수 없다.
 * 화면에도 그 사실을 적는다 — 적어 두지 않으면 「템플릿을 골랐는데 모서리는
 * 왜 그대로지」가 고장으로 읽힌다.
 *
 * ── 지금 쓰는 톤은 기억해 둔 것이 아니라 대조해 알아낸 것이다 ───────────
 * 「무슨 템플릿을 쓰는가」를 따로 저장하지 않는다(domain/ui-theme-templates.ts
 * 머리말). 색 화면에서 한 칸만 손으로 고쳐도 여기서는 곧바로 「직접 고친
 * 값입니다」로 바뀐다 — 이름과 값이 어긋날 자리를 만들지 않는다.
 *
 * ── 화면이 먼저 말해 주는 것 ────────────────────────────────────────────
 * 서버는 대비 4쌍이 3:1 미만이면 저장을 거절한다. 등록부의 시험이 여섯 템플릿
 * 전부를 그 선 위로 못 박아 두었으므로 여기서 그 경고가 나올 일은 없지만,
 * 저장 단추의 잠김 조건에는 그대로 넣어 둔다 — 시험과 화면이 **같은 판정**을
 * 해야, 나중에 템플릿을 손보다 선을 넘겼을 때 두 곳이 함께 막는다.
 *
 * ── 🔴 이 화면도 구조선 안에서 그려진다 ─────────────────────────────────
 * 감싸는 레이아웃(settings/developer/layout.tsx)이 모든 토큰을 기본값으로
 * 되돌려 놓기 때문에, 저장된 값이 무엇이든 이 화면만은 항상 읽힌다. 견본이
 * 고른 톤을 보여줄 수 있는 것은 인라인 style 이 그 컨테이너 선언을 이기기
 * 때문이다(ThemeTokenPreview.tsx).
 * ============================================================================
 */

/**
 * 카드에 띠로 보여줄 대표색.
 *
 * 24색을 다 늘어놓으면 카드가 아니라 표가 된다. 라이트는 바탕 → 테두리 →
 * 흐린 글자 → 제목 글자 → 위험 단추 순으로, 다크는 그 화면에서 실제로 그
 * 자리를 맡는 단계로 고른다. 「이 톤이 어떤 인상인가」를 다섯 칸으로 말하는
 * 것이 목적이지, 값을 확인하는 자리가 아니다.
 */
const LIGHT_SWATCH_KEYS: readonly string[] = [
  "background",
  "zinc-200",
  "zinc-500",
  "zinc-900",
  "red-600",
];
const DARK_SWATCH_KEYS: readonly string[] = [
  "background",
  "zinc-900",
  "zinc-700",
  "zinc-400",
  "red-400",
];

/** 템플릿 하나가 정하는 색의 수. 등록부에서 세므로 안내 문구가 늘 실제와 같다. */
const TEMPLATE_COLOR_COUNT = UI_THEME_TOKENS.filter((token) => token.kind === "color").length;

/** 저장을 실제로 거절시키는 짝인가. 등록부의 목록에서 그대로 만든다. */
const BLOCKING_PAIR_KEYS: ReadonlySet<string> = new Set(
  UI_THEME_CONTRAST_BLOCKING.map((pair) => `${pair.scope}:${pair.fgKey}:${pair.bgKey}`)
);

function isBlockingPair(pair: UiThemeContrastPair): boolean {
  return BLOCKING_PAIR_KEYS.has(`${pair.scope}:${pair.fgKey}:${pair.bgKey}`);
}

export default function ThemeTemplatePicker({ saved }: { saved: readonly UiThemeOverrideRow[] }) {
  const router = useRouter();

  /** 지금 저장돼 있는 값이 어느 템플릿인가. 어느 것과도 다르면 null. */
  const current = useMemo(() => detectUiThemeTemplate(saved), [saved]);

  /**
   * 고른 톤. null 이면 아무것도 고르지 않은 상태 — 견본은 지금 저장된 값을
   * 그대로 보여준다. 처음에는 지금 쓰는 톤을 골라 둔다(직접 고친 값이면 null).
   */
  const [selected, setSelected] = useState<UiThemeTemplate | null>(current);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /**
   * 견본과 대비가 함께 보는 한 벌.
   *
   * 🔴 색만 템플릿 값으로 덮고 모서리·글자 크기는 **저장된 값 그대로** 둔다.
   * 견본이 기본 모서리로 그려지면, 모서리를 고쳐 둔 관리자에게는 「템플릿이
   * 모서리까지 되돌린다」로 읽힌다.
   */
  const resolved = useMemo(
    () => (selected ? resolveUiThemeWithTemplate(saved, selected) : resolveUiTheme(saved)),
    [saved, selected]
  );

  const contrastReadings = useMemo(
    () =>
      UI_THEME_CONTRAST_PAIRS.map((pair) => {
        const values = pair.scope === "dark" ? resolved.dark : resolved.light;
        return {
          pair,
          ratio: contrastRatio(values[pair.fgKey], values[pair.bgKey]),
          blocking: isBlockingPair(pair),
        };
      }),
    [resolved]
  );

  const blockedReadings = contrastReadings.filter(
    (reading) => reading.blocking && reading.ratio < UI_THEME_CONTRAST_FLOOR
  );
  const warnReadings = contrastReadings.filter(
    (reading) => reading.ratio >= UI_THEME_CONTRAST_FLOOR && reading.ratio < UI_THEME_CONTRAST_WARN
  );

  /** 지금 저장된 값과 고른 톤이 몇 칸 다른가. 저장되는 칸 수와 같다. */
  const changedCount = useMemo(
    () => (selected ? countUiThemeTemplateDiff(selected, saved) : 0),
    [saved, selected]
  );

  const canSave = !isSaving && selected !== null && changedCount > 0 && blockedReadings.length === 0;

  function select(template: UiThemeTemplate) {
    setSelected(template);
    setMessage(null);
  }

  async function save() {
    if (!canSave || !selected) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveUiThemeTokensAction({
        // 색 70칸을 전부 싣는다. 기본값과 같아진 칸은 `value: null` 로 나가
        // 저장된 행이 지워진다(domain/ui-theme-templates.ts).
        changes: uiThemeTemplateToChanges(selected),
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
      // 저장 결과를 서버에서 다시 받아야 「지금 쓰는 톤」 표시가 실제와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">색상 톤 템플릿</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          미리 맞춰 둔 색 한 벌을 골라 앱 전체의 인상을 한 번에 바꿉니다. 템플릿 하나가 색{" "}
          {TEMPLATE_COLOR_COUNT}개의 라이트·다크 값을 모두 정합니다.
        </p>
      </div>

      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <strong>저장하면 전 직원 화면에 적용됩니다.</strong> 이 값은 특정 사용자 설정이 아니라 앱 전체의
        기본 팔레트입니다. 다른 사용자에게는 다음 화면 이동부터 보입니다. 되돌리려면{" "}
        <strong>기본</strong>을 고르고 다시 저장하면 됩니다.
      </p>

      {/*
        🔴 적어 두지 않으면 「템플릿을 골랐는데 모서리는 왜 그대로지」가 고장으로
        읽힌다. 톤과 크기를 한 단추에 묶지 않는 것이 이 화면의 규율이다.
      */}
      <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <strong>이 화면은 색만 바꿉니다.</strong> 모서리와 글자 크기는 템플릿에 들어 있지 않아, 무엇을
        고르든 지금 값 그대로 남습니다. 그 둘은{" "}
        <strong>개발자 모드 목차 → 모서리 · 글자 크기</strong>에서 따로 정합니다. 색을 한 칸씩 손보려면{" "}
        <strong>색</strong> 화면을 쓰세요 — 거기서 한 칸이라도 고치면 이 화면은{" "}
        <strong>직접 고친 값입니다</strong>로 바뀝니다.
      </p>

      <CurrentToneNote current={current} />

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          톤 고르기 — 고르면 저장하지 않고 아래 견본이 먼저 바뀝니다
        </legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          {UI_THEME_TEMPLATES.map((template) => (
            <TemplateCard
              key={template.key}
              template={template}
              isSelected={selected?.key === template.key}
              isCurrent={current?.key === template.key}
              diffCount={countUiThemeTemplateDiff(template, saved)}
              disabled={isSaving}
              onSelect={select}
            />
          ))}
        </div>
      </fieldset>

      <ThemeTokenPreview light={resolved.light} dark={resolved.dark} />

      <ContrastSummary
        readings={contrastReadings}
        warnReadings={warnReadings}
        blockedReadings={blockedReadings}
      />

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
            ? "톤을 고르면 저장할 수 있습니다."
            : changedCount === 0
              ? `지금 저장돼 있는 값이 이미 「${selected.name}」입니다. 바뀔 칸이 없습니다.`
              : `「${selected.name}」을(를) 저장하면 색 ${changedCount}칸이 바뀝니다.`}
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
        template={selected}
        changedCount={changedCount}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────── 지금 쓰는 톤

function CurrentToneNote({ current }: { current: UiThemeTemplate | null }) {
  if (current) {
    return (
      <p className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        지금 쓰는 톤은 <strong className="text-zinc-900 dark:text-zinc-50">{current.name}</strong>{" "}
        입니다.
      </p>
    );
  }
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <strong>지금은 직접 고친 값입니다.</strong> 저장된 색이 여섯 템플릿 어느 것과도 맞지 않습니다 —
      색 화면에서 한 칸이라도 손으로 고치면 이 상태가 됩니다. 여기서 톤을 하나 골라 저장하면 색{" "}
      <strong>전부</strong>가 그 톤으로 덮입니다.
    </p>
  );
}

// ─────────────────────────────────────────────────────────── 카드

function TemplateCard({
  template,
  isSelected,
  isCurrent,
  diffCount,
  disabled,
  onSelect,
}: {
  template: UiThemeTemplate;
  isSelected: boolean;
  isCurrent: boolean;
  diffCount: number;
  disabled: boolean;
  onSelect: (template: UiThemeTemplate) => void;
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
          name="ui-theme-template"
          value={template.key}
          checked={isSelected}
          disabled={disabled}
          onChange={() => onSelect(template)}
          className="h-4 w-4 shrink-0 accent-zinc-900 disabled:cursor-not-allowed dark:accent-zinc-50"
        />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {template.name}
        </span>
        {isCurrent && (
          <span className="rounded-sm bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            지금 쓰는 톤
          </span>
        )}
        {!isCurrent && diffCount > 0 && (
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            지금 값과 {diffCount}칸 다름
          </span>
        )}
      </span>

      <SwatchStrip label="라이트" template={template} keys={LIGHT_SWATCH_KEYS} scopeIndex={0} />
      <SwatchStrip label="다크" template={template} keys={DARK_SWATCH_KEYS} scopeIndex={1} />

      <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {template.description}
      </span>
    </label>
  );
}

/**
 * 색 견본 띠 한 줄.
 *
 * 값은 등록부를 지난 hex 여섯 자리뿐이고, React 가 style 프로퍼티로 넣으므로
 * 문자열이 규칙을 탈출할 자리가 없다(ThemeTokenPreview 와 같은 처리).
 */
function SwatchStrip({
  label,
  template,
  keys,
  scopeIndex,
}: {
  label: string;
  template: UiThemeTemplate;
  keys: readonly string[];
  scopeIndex: 0 | 1;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="flex gap-1">
        {keys.map((key) => {
          const pair = template.colors[key];
          if (!pair) return null;
          const value = pair[scopeIndex];
          return (
            <span
              key={key}
              title={`${key} — ${value}`}
              style={{ backgroundColor: value }}
              className="h-5 w-5 rounded-sm border border-zinc-300 dark:border-zinc-600"
            />
          );
        })}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────── 대비

function ContrastSummary({
  readings,
  warnReadings,
  blockedReadings,
}: {
  readings: readonly { pair: UiThemeContrastPair; ratio: number; blocking: boolean }[];
  warnReadings: readonly { pair: UiThemeContrastPair; ratio: number }[];
  blockedReadings: readonly { pair: UiThemeContrastPair; ratio: number }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {blockedReadings.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <p>
            <strong>이 톤은 서버가 저장을 거절합니다.</strong> 글자와 바탕의 대비가{" "}
            {UI_THEME_CONTRAST_FLOOR}:1 미만이면 화면 자체를 읽을 수 없게 되어, 되돌리러 올 화면도 함께
            사라집니다.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {blockedReadings.map((reading) => (
              <li key={`${reading.pair.scope}:${reading.pair.fgKey}:${reading.pair.bgKey}`}>
                {reading.pair.label} — {reading.ratio.toFixed(2)}:1
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnReadings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p>
            <strong>본문 읽기가 조금 불편할 수 있는 짝이 {warnReadings.length}개 있습니다.</strong>{" "}
            {UI_THEME_CONTRAST_WARN}:1 은 WCAG AA 본문 기준이고, 여기에 못 미쳐도 저장은 됩니다.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {warnReadings.map((reading) => (
              <li key={`${reading.pair.scope}:${reading.pair.fgKey}:${reading.pair.bgKey}`}>
                {reading.pair.label} — {reading.ratio.toFixed(2)}:1
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          대비 {readings.length}쌍 전부 보기 — 화면에서 실제로 겹쳐 놓이는 짝만 잽니다
        </summary>
        <div className="overflow-x-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
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
                <tr
                  key={`${reading.pair.scope}:${reading.pair.fgKey}:${reading.pair.bgKey}`}
                  className="border-t border-zinc-200 dark:border-zinc-800"
                >
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
                    <ContrastVerdict ratio={reading.ratio} blocking={reading.blocking} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ContrastVerdict({ ratio, blocking }: { ratio: number; blocking: boolean }) {
  if (ratio < UI_THEME_CONTRAST_FLOOR) {
    return (
      <span className="text-red-700 dark:text-red-400">
        {blocking ? "저장 거절 — 화면을 읽을 수 없습니다" : "너무 낮습니다"}
      </span>
    );
  }
  if (ratio < UI_THEME_CONTRAST_WARN) {
    return <span className="text-amber-700 dark:text-amber-400">낮습니다</span>;
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
  template,
  changedCount,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isSaving: boolean;
  template: UiThemeTemplate | null;
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
      aria-labelledby="ui-theme-template-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="ui-theme-template-dialog-title" className="text-sm font-semibold">
        색상 톤 템플릿 저장
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {template ? (
          <>
            <strong className="text-zinc-900 dark:text-zinc-50">{template.name}</strong> 으로 색{" "}
            {changedCount}칸을 바꿉니다. <strong>모든 사용자</strong>의 화면이 다음 화면 이동부터 이
            톤으로 그려집니다.
          </>
        ) : (
          <>고른 톤이 없습니다.</>
        )}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        모서리와 글자 크기는 바뀌지 않습니다. 되돌리려면 <strong>기본</strong>을 고르고 다시 저장하면
        되고, 화면이 읽히지 않을 만큼 어긋났다면 주소창에{" "}
        <code className="font-mono">/api/theme/bypass</code>를 쳐서 이 브라우저만 원래 화면으로 볼 수
        있습니다.
      </p>

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
          disabled={isSaving || template === null}
          aria-busy={isSaving}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSaving ? "저장 중..." : "저장"}
        </button>
      </div>
    </dialog>
  );
}
