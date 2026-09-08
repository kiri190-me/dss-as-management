"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  contrastRatio,
  normalizeUiThemeValue,
  UI_THEME_CONTRAST_BLOCKING,
  UI_THEME_CONTRAST_FLOOR,
  UI_THEME_CONTRAST_PAIRS,
  UI_THEME_CONTRAST_WARN,
  UI_THEME_TOKENS,
  type UiThemeContrastPair,
  type UiThemeOverrideRow,
  type UiThemeScope,
  type UiThemeToken,
} from "@/lib/domain/ui-theme-tokens";
import {
  scopeFitsUiThemeToken,
  uiThemeDefaultFor,
} from "@/lib/validation/ui-theme-token-input";
import { saveUiThemeTokensAction } from "@/lib/server/actions/ui-theme-tokens";
import ThemeTokenPreview from "./ThemeTokenPreview";

/**
 * ============================================================================
 * 화면 토큰 편집기 — 앱 전체의 색·모서리·글자 크기
 * ============================================================================
 * 여기서 저장한 값은 루트 레이아웃이 <head> 에 <style> 한 장으로 심고, 앱의 모든
 * 화면이 그 변수를 거쳐 그려진다(domain/ui-theme-tokens.ts 머리말). 즉 이 화면의
 * 저장 단추 하나가 **전 직원의 화면**을 바꾼다 — 그래서 다른 설정 화면보다
 * 미리 말해 주는 것이 많다.
 *
 * ── 🔴 화면은 둘, 편집기는 하나 ─────────────────────────────────────────
 * 색 화면(theme/colors)과 모서리·글자 크기 화면(theme/shapes)이 **같은 이
 * 컴포넌트**를 쓰고, `group` 이 어느 칸을 그릴지만 정한다. 편집기를 둘로
 * 복사하면 저장·대비·미리보기 로직이 두 벌이 되고, 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 줄어드는 것은 **그리는 칸**뿐이다. 대비 계산과 미리보기는 언제나 등록부
 * 전체(35개 토큰·11쌍)로 한다 — 색 화면에서 바탕색 하나를 바꿔도 그 판정에는
 * 이 화면에 없는 글자색이 함께 필요하고, 미리보기 역시 한 벌이 다 있어야
 * 그려진다.
 *
 * ── 되돌리는 길이 셋이고, 셋의 뜻이 전부 다르다 ─────────────────────────
 *   · **되돌리기** — 편집 중인 값을 *지금 저장돼 있는 값*으로 돌린다. 서버에
 *     아무것도 보내지 않는다.
 *   · **전부 기본값으로** — 편집 중인 값을 *코드 기본값*으로 채운다. 저장을
 *     눌러야 저장된 행이 실제로 지워진다.
 *   · **우회 쿠키**(/api/theme/bypass) — 이 브라우저 한 대만 오버라이드 이전
 *     화면을 본다. 저장된 값은 그대로다.
 * NotificationSettings.tsx 가 앞의 둘을 같은 뜻으로 나눠 두었고, 그 구분을
 * 그대로 따른다 — 두 단추의 뜻이 섞이면 "되돌렸는데 왜 그대로냐"가 된다.
 *
 * ── 바뀐 것만 보낸다 ────────────────────────────────────────────────────
 * 화면의 칸을 통째로 보내지 않는다. 서버 액션의 입력은 "사람이 만진 것"이고,
 * `value: null` 이 "그 자리를 기본값으로 되돌려라(= 행을 지워라)"는 뜻이다.
 * 안 만진 값까지 실어 보내면 "행이 없다 = 기본값"이라는 이 축의 뜻이 요청
 * 모양에서 사라진다.
 *
 * ── 화면이 먼저 말해 주는 것 ────────────────────────────────────────────
 * 서버는 대비 3:1 미만인 조합 넷을 거절한다. 그 거절을 눌러 본 뒤에 알게 되면
 * 무엇이 문제인지 화면에서 알 길이 없으므로, **누르기 전에** 같은 규칙으로
 * 재서 알린다(같은 순수 함수 contrastRatio 를 쓴다 — 두 벌의 계산이 어긋날
 * 자리가 없다). 형식이 틀린 값도 마찬가지로 여기서 먼저 막는다.
 *
 * ── 🔴 이 편집기는 구조선 안에서 그려진다 ───────────────────────────────
 * 감싸는 컨테이너(settings/developer/layout.tsx 의 `#ui-theme-lifeboat`)가 모든
 * 토큰을 기본값으로 되돌려 놓기 때문에, 저장된 값이 무엇이든 이 화면만은 항상
 * 읽힌다. 그 래퍼가 페이지가 아니라 **레이아웃**에 있어서 하위 화면들도 함께
 * 그 안에 들어간다 — 색을 고치러 들어간 화면이 자기가 저장한 색을 뒤집어쓰면
 * 되돌리러 온 사람이 되돌릴 화면을 못 본다. 미리보기가
 * 편집 중인 색을 보여줄 수 있는 것은 인라인 style 이 그 컨테이너 선언을 이기기
 * 때문이고, 그래서 구조선 CSS 에 `!important` 를 쓰지 않는다.
 * ============================================================================
 */

// ────────────────────────────────────────────────── 편집 가능한 자리(59칸)

/** 편집 가능한 한 칸. 토큰 하나가 scoped 면 두 칸, 아니면 한 칸이 된다. */
type Slot = { key: string; token: UiThemeToken; scope: UiThemeScope };

function slotKey(tokenKey: string, scope: UiThemeScope): string {
  return `${tokenKey}:${scope}`;
}

const SLOTS: readonly Slot[] = UI_THEME_TOKENS.flatMap((token) =>
  (token.scoped ? (["light", "dark"] as const) : (["both"] as const)).map((scope) => ({
    key: slotKey(token.key, scope),
    token,
    scope: scope as UiThemeScope,
  }))
);

const SCOPE_LABELS: Record<UiThemeScope, string> = {
  light: "라이트",
  dark: "다크",
  both: "공용",
};

/**
 * 색 묶음. zinc·red 를 램프로 묶고, **그 밖의 색은 남김없이 마지막 묶음**으로
 * 떨어진다 — 등록부에 색이 하나 늘었을 때 어느 묶음에도 못 들어가 화면에서
 * 조용히 사라지는 일이 없어야 한다.
 */
const COLOR_TOKENS = UI_THEME_TOKENS.filter((token) => token.kind === "color");
const ZINC_TOKENS = COLOR_TOKENS.filter((token) => token.key.startsWith("zinc-"));
const RED_TOKENS = COLOR_TOKENS.filter((token) => token.key.startsWith("red-"));
const OTHER_COLOR_TOKENS = COLOR_TOKENS.filter(
  (token) => !token.key.startsWith("zinc-") && !token.key.startsWith("red-")
);
const RADIUS_TOKENS = UI_THEME_TOKENS.filter((token) => token.kind === "radius");
const FONT_SIZE_TOKENS = UI_THEME_TOKENS.filter((token) => token.kind === "fontSize");
/** 색도 모서리도 글자 크기도 아닌 것. 지금은 비어 있고, 비면 그려지지 않는다. */
const OTHER_SHAPE_TOKENS = UI_THEME_TOKENS.filter(
  (token) => token.kind !== "color" && token.kind !== "radius" && token.kind !== "fontSize"
);

/**
 * 화면 하나가 맡는 묶음.
 *
 * 🔴 등록부를 **남김없이** 둘로 가른다 — 색이면 색 화면, 아니면 모서리·글자
 * 크기 화면이다. 어느 화면에도 안 걸리는 토큰이 생기면 그 값은 편집할 길이
 * 없어지고, 색 묶음이 마지막 묶음으로 남김없이 떨어지게 해 둔 것과 같은
 * 이유다(위 COLOR_TOKENS 주석).
 */
export type ThemeTokenGroup = "colors" | "shapes";

/**
 * 그 화면에 그려지는 칸. **여기 든 칸만** 저장 대상이고, 「이 화면 전부
 * 기본값으로」가 채우는 것도, 바뀐 칸 수와 저장 단추의 잠김 판정이 세는 것도
 * 이것이다 — 색 화면에서 누른 단추가 모서리·글자 크기까지 조용히 지우면,
 * 누른 사람은 색만 되돌린 줄 안다.
 */
const GROUP_SLOTS: Record<ThemeTokenGroup, readonly Slot[]> = {
  colors: SLOTS.filter((slot) => slot.token.kind === "color"),
  shapes: SLOTS.filter((slot) => slot.token.kind !== "color"),
};

/** 저장을 실제로 거절시키는 짝인가. 등록부의 목록에서 그대로 만든다. */
const BLOCKING_PAIR_KEYS: ReadonlySet<string> = new Set(
  UI_THEME_CONTRAST_BLOCKING.map((pair) => `${pair.scope}:${pair.fgKey}:${pair.bgKey}`)
);

function isBlockingPair(pair: UiThemeContrastPair): boolean {
  return BLOCKING_PAIR_KEYS.has(`${pair.scope}:${pair.fgKey}:${pair.bgKey}`);
}

// ───────────────────────────────────────────────────────────────── 편집기

type Draft = Record<string, string>;

export default function ThemeTokenEditor({
  saved,
  group,
}: {
  saved: readonly UiThemeOverrideRow[];
  /** 이 화면이 그리는 묶음. 계산 범위가 아니라 **그리는 범위**를 정한다. */
  group: ThemeTokenGroup;
}) {
  const router = useRouter();

  /** 이 화면이 그리는 칸. 저장·되돌리기·판정이 전부 이 목록을 기준으로 돈다. */
  const groupSlots = GROUP_SLOTS[group];

  /** 지금 저장돼 있는 값(칸마다 하나). 오버라이드가 없는 칸은 코드 기본값이다. */
  const savedValues = useMemo(() => savedValuesOf(saved), [saved]);

  const [draft, setDraft] = useState<Draft>(() => ({ ...savedValues }));
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /**
   * 칸마다 정규화한 값. null 이면 형식이 틀린 것이다.
   *
   * 화면이 들고 있는 것은 사람이 친 **원문**이고(중간까지 친 `#18` 같은 것도
   * 들어온다), 판정·미리보기·저장은 전부 이 정규화된 값으로 한다. 서버가 쓰는
   * 함수와 같은 함수다.
   */
  const normalized = useMemo(() => {
    const result: Record<string, string | null> = {};
    for (const slot of SLOTS) {
      result[slot.key] = normalizeUiThemeValue(slot.token, draft[slot.key]);
    }
    return result;
  }, [draft]);

  /**
   * 형식이 틀린 칸. **이 화면의 칸만** 본다 — 다른 화면의 값은 사람이 만질 수
   * 없어 애초에 틀릴 수 없고, 그래서 그 범위를 이 화면 안으로 좁혀도 잃는
   * 것이 없다.
   */
  const invalidSlots = useMemo(
    () => groupSlots.filter((slot) => normalized[slot.key] === null),
    [groupSlots, normalized]
  );

  /** 저장돼 있는 값과 달라진 칸. 요청에 실릴 것이 정확히 이것이다. */
  const changedSlots = useMemo(
    () =>
      groupSlots.filter((slot) => {
        const value = normalized[slot.key];
        return value !== null && value !== savedValues[slot.key];
      }),
    [groupSlots, normalized, savedValues]
  );

  /**
   * 편집 중인 값으로 본 라이트/다크 한 벌. 미리보기와 대비 판정이 같은 것을
   * 본다. 형식이 틀린 칸은 저장돼 있는 값으로 메운다 — 글자를 지우는 중에
   * 견본이 깨지거나 대비 계산이 던지면, 고치는 중인 사람에게는 그것이 고장으로
   * 읽힌다.
   *
   * 🔴 화면이 무엇을 그리든 **등록부 전체**로 만든다. 대비는 이 화면에 없는
   * 칸과 겹쳐 재야 하고(글자색은 색 화면에 있어도 바탕은 다른 묶음일 수 있다),
   * 미리보기도 한 벌이 다 있어야 그려진다.
   */
  const resolved = useMemo(() => {
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    for (const token of UI_THEME_TOKENS) {
      if (token.scoped) {
        light[token.key] = valueOrSaved(token, "light", normalized, savedValues);
        dark[token.key] = valueOrSaved(token, "dark", normalized, savedValues);
      } else {
        const shared = valueOrSaved(token, "both", normalized, savedValues);
        light[token.key] = shared;
        dark[token.key] = shared;
      }
    }
    return { light, dark };
  }, [normalized, savedValues]);

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

  const canSave =
    !isSaving && changedSlots.length > 0 && invalidSlots.length === 0 && blockedReadings.length === 0;

  function setSlot(slot: Slot, value: string) {
    setDraft((prev) => ({ ...prev, [slot.key]: value }));
    setMessage(null);
  }

  /** 저장하지 않은 편집을 버린다. 서버에 아무것도 보내지 않는다. */
  function revert() {
    setDraft({ ...savedValues });
    setMessage(null);
  }

  /**
   * 코드 기본값으로 채운다. 저장을 눌러야 저장된 행이 지워진다.
   *
   * 🔴 **이 화면에 그려진 칸만** 채운다. 59칸 전부를 채우면 색 화면에서 누른
   * 것이 모서리·글자 크기까지 함께 지우고, 누른 사람은 색만 되돌린 줄 안다 —
   * 그 값들은 이 화면에 보이지도 않으므로 지워졌다는 사실조차 알 수 없다.
   */
  function fillWithDefaults() {
    setDraft((prev) => {
      const next: Draft = { ...prev };
      for (const slot of groupSlots) next[slot.key] = uiThemeDefaultFor(slot.token, slot.scope);
      return next;
    });
    setMessage(null);
  }

  async function save() {
    if (!canSave) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveUiThemeTokensAction({
        changes: changedSlots.map((slot) => {
          const value = normalized[slot.key];
          const isBackToDefault = value === uiThemeDefaultFor(slot.token, slot.scope);
          return {
            tokenKey: slot.token.key,
            scope: slot.scope,
            // 기본값으로 돌아온 칸은 값을 저장하지 않고 **행을 지운다**. 기본값과
            // 같은 값을 굳이 남기면, 나중에 기본 팔레트를 손볼 때 옛 기본값이
            // 오버라이드로 굳어 아무 화면도 따라 바뀌지 않는다.
            value: isBackToDefault ? null : value,
          };
        }),
      });
      setConfirmOpen(false);
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setMessage({ type: "success", text: result.message });
      // 저장 결과(행이 지워진 칸 등)를 서버에서 다시 받아야 화면의 "저장돼
      // 있는 값"이 실제와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  const isColors = group === "colors";

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {isColors ? "색" : "모서리 · 글자 크기"}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {isColors ? (
            <>
              코드를 고치지 않고 앱 전체의 색을 바꿉니다. 색 {COLOR_TOKENS.length}개를 라이트와 다크로
              따로 저장하므로, 이 화면에서 편집할 수 있는 자리는 {groupSlots.length}칸입니다.
            </>
          ) : (
            <>
              코드를 고치지 않고 앱 전체의 모서리와 글자 크기를 바꿉니다. 모서리{" "}
              {RADIUS_TOKENS.length}개와 글자 크기 {FONT_SIZE_TOKENS.length}개를 라이트·다크 공용으로
              저장하므로, 이 화면에서 편집할 수 있는 자리는 {groupSlots.length}칸입니다.
            </>
          )}
        </p>
      </div>

      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <strong>저장하면 전 직원 화면에 적용됩니다.</strong> 이 값은 특정 사용자 설정이 아니라 앱 전체의
        기본 팔레트입니다. 다른 사용자에게는 다음 화면 이동부터 보입니다. 되돌리려면{" "}
        <strong>이 화면 전부 기본값으로</strong>를 누르고 다시 저장하면 되고, 화면이 읽히지 않을 만큼
        어긋났다면 주소창에 <code className="font-mono">/api/theme/bypass</code>를 쳐서 이 브라우저만
        원래 화면으로 볼 수 있습니다.
      </p>

      {isColors && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <strong>이번 판에서 바꿀 수 있는 색은 중립(zinc)·경고(red)와 페이지 바탕·본문 글자입니다.</strong>{" "}
          앱이 쓰는 나머지 색(amber · blue · emerald · green · violet · sky)과 흰색·검은색은 아직 열려
          있지 않아, 여기서 무엇을 바꿔도 그 색으로 그려진 자리는 그대로입니다 — 앱 전체 색 사용의
          14%쯤입니다.
        </p>
      )}

      {/*
        미리보기는 두 화면 모두에 둔다 — 모서리와 글자 크기도 견본에서 바로
        보이고, 그 값들은 색과 함께 놓고 봐야 판단이 된다.
      */}
      <ThemeTokenPreview light={resolved.light} dark={resolved.dark} />

      {/*
        🔴 대비 표는 색 화면에만 그린다. 모서리·글자 크기 화면에서 바꾸는 값은
        대비를 한 칸도 움직이지 못하므로, 늘 같은 숫자만 늘어놓는 표가 된다.
        **재는 것을 줄인 것이 아니다** — contrastReadings 는 두 화면 모두에서
        등록부 전체로 계산되고, 저장을 막는 판정(blockedReadings)도 그대로다.
      */}
      {isColors && <ContrastReport readings={contrastReadings} />}

      {isColors ? (
        <details
          open
          className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            색 <ChangedBadge count={changedCountOf(changedSlots, COLOR_TOKENS)} />
          </summary>
          <div className="flex flex-col gap-4 border-t border-zinc-200 p-3 dark:border-zinc-800">
            <ColorGroup
              title="중립 (zinc) — 글자·바탕·테두리"
              tokens={ZINC_TOKENS}
              draft={draft}
              normalized={normalized}
              savedValues={savedValues}
              disabled={isSaving}
              onChange={setSlot}
            />
            <ColorGroup
              title="경고 (red) — 삭제·오류·기한 초과"
              tokens={RED_TOKENS}
              draft={draft}
              normalized={normalized}
              savedValues={savedValues}
              disabled={isSaving}
              onChange={setSlot}
            />
            <ColorGroup
              title="페이지 바탕과 본문 글자"
              tokens={OTHER_COLOR_TOKENS}
              draft={draft}
              normalized={normalized}
              savedValues={savedValues}
              disabled={isSaving}
              onChange={setSlot}
            />
          </div>
        </details>
      ) : (
        <>
          <details
            open
            className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
          >
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              모서리 <ChangedBadge count={changedCountOf(changedSlots, RADIUS_TOKENS)} />
            </summary>
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <LengthGroup
                tokens={RADIUS_TOKENS}
                hint="0 부터 2rem 까지. rem 과 px 을 쓸 수 있고, 0 만 단위를 생략할 수 있습니다."
                draft={draft}
                normalized={normalized}
                savedValues={savedValues}
                disabled={isSaving}
                onChange={setSlot}
              />
            </div>
          </details>

          <details
            open
            className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
          >
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              글자 크기 <ChangedBadge count={changedCountOf(changedSlots, FONT_SIZE_TOKENS)} />
            </summary>
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <LengthGroup
                tokens={FONT_SIZE_TOKENS}
                hint="0.625rem 부터 1.5rem 까지. px 은 쓸 수 없습니다 — 브라우저·OS 의 글자 확대 설정이 통하지 않게 됩니다."
                draft={draft}
                normalized={normalized}
                savedValues={savedValues}
                disabled={isSaving}
                onChange={setSlot}
              />
            </div>
          </details>

          {/*
            등록부에 색도 모서리도 글자 크기도 아닌 종류가 늘어난 날, 그 칸이
            어느 화면에도 안 나오면 편집할 길이 사라진다(GROUP_SLOTS 는 이미
            그 칸을 이 화면 몫으로 세고 있다). 지금은 비어 있어 그려지지 않는다.
          */}
          {OTHER_SHAPE_TOKENS.length > 0 && (
            <details
              open
              className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                그 밖 <ChangedBadge count={changedCountOf(changedSlots, OTHER_SHAPE_TOKENS)} />
              </summary>
              <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
                <LengthGroup
                  tokens={OTHER_SHAPE_TOKENS}
                  hint="이 값의 형식은 등록부(domain/ui-theme-tokens.ts)의 규칙을 따릅니다."
                  draft={draft}
                  normalized={normalized}
                  savedValues={savedValues}
                  disabled={isSaving}
                  onChange={setSlot}
                />
              </div>
            </details>
          )}
        </>
      )}

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

      {invalidSlots.length > 0 && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          형식이 맞지 않는 값이 {invalidSlots.length}칸 있습니다. 빨갛게 표시된 칸을 고쳐야 저장할 수
          있습니다.
        </p>
      )}

      {blockedReadings.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <p>
            <strong>이 조합은 서버가 저장을 거절합니다.</strong> 글자와 바탕의 대비가{" "}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {changedSlots.length === 0
            ? "변경된 내용이 없습니다."
            : `${changedSlots.length}칸이 바뀌었습니다. 저장해야 적용됩니다.`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fillWithDefaults}
            disabled={isSaving}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            이 화면 전부 기본값으로
          </button>
          <button
            type="button"
            onClick={revert}
            disabled={isSaving || changedSlots.length === 0}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            되돌리기
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canSave}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            저장
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <strong>되돌리기</strong>는 편집 중인 값을 지금 저장돼 있는 값으로 돌립니다(서버에 아무것도 보내지
        않습니다). <strong>이 화면 전부 기본값으로</strong>는 <strong>이 화면에 있는 칸만</strong> 코드
        기본값으로 채우며(다른 화면의 값은 건드리지 않습니다), <strong>저장을 눌러야</strong> 저장된 값이
        실제로 지워집니다.
      </p>

      <SaveConfirmDialog
        isOpen={isConfirmOpen}
        isSaving={isSaving}
        changedSlots={changedSlots}
        normalized={normalized}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── 대비 표

function ContrastReport({
  readings,
}: {
  readings: readonly { pair: UiThemeContrastPair; ratio: number; blocking: boolean }[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <p className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        대비 — 편집 중인 값으로 잰 값입니다. 화면에서 실제로 겹쳐 놓이는 짝만 잽니다.
      </p>
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
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
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-zinc-700 dark:text-zinc-300">
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
      <p className="border-t border-zinc-200 px-3 py-2 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {UI_THEME_CONTRAST_WARN}:1 미만은 본문 읽기가 불편해집니다(WCAG AA 기준).{" "}
        {UI_THEME_CONTRAST_FLOOR}:1 미만은 <strong>서버가 저장을 거절합니다</strong> — 거절되는 짝은{" "}
        {UI_THEME_CONTRAST_BLOCKING.length}개뿐이고, 나머지는 경고에 그칩니다.
      </p>
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

// ─────────────────────────────────────────────────────────── 색 편집 묶음

type FieldGroupProps = {
  tokens: readonly UiThemeToken[];
  draft: Draft;
  normalized: Record<string, string | null>;
  savedValues: Record<string, string>;
  disabled: boolean;
  onChange: (slot: Slot, value: string) => void;
};

/**
 * 램프 한 벌. 줄이 단계(50 → 950), 칸이 라이트와 다크다.
 *
 * 폰에서 표가 넓어도 **페이지 전체가 가로로 스크롤되면 안 된다** — 넓은 것은
 * 자기 컨테이너 안에서만 스크롤한다(이 저장소 목록 화면들의 방식).
 */
function ColorGroup({ title, tokens, draft, normalized, savedValues, disabled, onChange }: FieldGroupProps & { title: string }) {
  if (tokens.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{title}</h3>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-1 pr-3 text-left font-medium">
                색
              </th>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                라이트
              </th>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                다크
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.key} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{token.label}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {token.key}
                  </span>
                  <span className="mt-0.5 block max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                    {token.usage}
                  </span>
                </th>
                {(["light", "dark"] as const).map((scope) => {
                  const slot: Slot = { key: slotKey(token.key, scope), token, scope };
                  return (
                    <td key={scope} className="px-2 py-2">
                      <ColorField
                        slot={slot}
                        raw={draft[slot.key]}
                        normalized={normalized[slot.key]}
                        saved={savedValues[slot.key]}
                        disabled={disabled}
                        onChange={onChange}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 색 한 칸. 고르개와 글자 입력을 **함께** 둔다 — 고르개는 정확한 값을 적을 수
 * 없고(마우스로는 `#18181b` 를 집을 수 없다), 글자 입력은 색을 볼 수 없다.
 */
function ColorField({
  slot,
  raw,
  normalized,
  saved,
  disabled,
  onChange,
}: {
  slot: Slot;
  raw: string;
  normalized: string | null;
  saved: string;
  disabled: boolean;
  onChange: (slot: Slot, value: string) => void;
}) {
  const fallback = uiThemeDefaultFor(slot.token, slot.scope);
  const label = `${slot.token.label} ${SCOPE_LABELS[slot.scope]}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={`${label} 색 고르개`}
          // 고르개는 유효한 hex 만 표시할 수 있다. 글자를 고치는 중이라 값이
          // 아직 형식에 안 맞으면 기본값을 보여 준다 — 옆의 글자 입력이 원문을
          // 그대로 들고 있으므로 무엇을 치고 있었는지는 사라지지 않는다.
          value={normalized ?? fallback}
          disabled={disabled}
          onChange={(event) => onChange(slot, event.target.value.toLowerCase())}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
        />
        <input
          type="text"
          aria-label={`${label} 색 코드`}
          value={raw}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange(slot, event.target.value)}
          className={`w-24 rounded-md border px-2 py-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
            normalized === null
              ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400"
              : "border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
          }`}
        />
      </div>
      <FieldNote
        normalized={normalized}
        saved={saved}
        fallback={fallback}
        invalidHint="#rrggbb 여섯 자리만 됩니다"
      />
    </div>
  );
}

// ──────────────────────────────────────────────── 모서리·글자 크기 묶음

/** 라이트/다크를 나누지 않는 값들. 한 줄에 한 칸이다. */
function LengthGroup({ tokens, hint, draft, normalized, savedValues, disabled, onChange }: FieldGroupProps & { hint: string }) {
  // 빈 묶음은 그리지 않는다(ColorGroup 과 같은 처리). 머리글만 있고 줄이 하나도
  // 없는 표는 "불러오지 못했다"로 읽힌다.
  if (tokens.length === 0) return null;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[24rem] border-collapse text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-1 pr-3 text-left font-medium">
                이름
              </th>
              <th scope="col" className="py-1 text-left font-medium">
                값 (라이트·다크 공용)
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => {
              const slot: Slot = { key: slotKey(token.key, "both"), token, scope: "both" };
              const fallback = uiThemeDefaultFor(token, "both");
              const value = normalized[slot.key];
              return (
                <tr key={token.key} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{token.label}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                      {token.key}
                    </span>
                    <span className="mt-0.5 block max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                      {token.usage}
                    </span>
                  </th>
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      <input
                        type="text"
                        aria-label={token.label}
                        value={draft[slot.key]}
                        spellCheck={false}
                        autoComplete="off"
                        disabled={disabled}
                        onChange={(event) => onChange(slot, event.target.value)}
                        className={`w-28 rounded-md border px-2 py-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                          value === null
                            ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400"
                            : "border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                        }`}
                      />
                      <FieldNote
                        normalized={value}
                        saved={savedValues[slot.key]}
                        fallback={fallback}
                        invalidHint={hint}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
    </div>
  );
}

/**
 * 칸 아래 한 줄. **기본값이 무엇인지**와 **지금 기본값에서 벗어났는지**,
 * 그리고 아직 저장하지 않았는지를 한자리에서 말한다.
 */
function FieldNote({
  normalized,
  saved,
  fallback,
  invalidHint,
}: {
  normalized: string | null;
  saved: string;
  fallback: string;
  invalidHint: string;
}) {
  if (normalized === null) {
    return <span className="text-[10px] text-red-700 dark:text-red-400">{invalidHint}</span>;
  }

  const isDefault = normalized === fallback;
  const isUnsaved = normalized !== saved;

  return (
    <span
      className={
        isDefault
          ? "text-[10px] text-zinc-400 dark:text-zinc-500"
          : "text-[10px] text-amber-700 dark:text-amber-400"
      }
    >
      {isDefault ? "기본값" : `기본 ${fallback}`}
      {isUnsaved ? " · 저장 안 됨" : ""}
    </span>
  );
}

function ChangedBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {count}칸 바뀜
    </span>
  );
}

// ────────────────────────────────────────────────────────── 저장 확인 창

/**
 * 되돌리기 어려운 동작은 다이얼로그로 두 번 확인한다(UI_GUIDELINE 5절).
 * 이 저장소의 다른 확인 창들과 같은 native <dialog> 패턴이다.
 */
function SaveConfirmDialog({
  isOpen,
  isSaving,
  changedSlots,
  normalized,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isSaving: boolean;
  changedSlots: readonly Slot[];
  normalized: Record<string, string | null>;
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

  const shown = changedSlots.slice(0, 8);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="ui-theme-save-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="ui-theme-save-dialog-title" className="text-sm font-semibold">
        화면 토큰 저장
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {changedSlots.length}칸을 저장합니다. <strong>모든 사용자</strong>의 화면이 다음 화면 이동부터
        이 값으로 그려집니다.
      </p>

      <ul className="mt-3 max-h-48 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
        {shown.map((slot) => {
          const value = normalized[slot.key];
          const isBackToDefault = value === uiThemeDefaultFor(slot.token, slot.scope);
          return (
            <li key={slot.key} className="border-t border-zinc-200 py-1 first:border-t-0 dark:border-zinc-800">
              <span className="text-zinc-900 dark:text-zinc-50">{slot.token.label}</span>
              {slot.token.scoped ? ` (${SCOPE_LABELS[slot.scope]})` : ""} —{" "}
              <span className="font-mono">{value}</span>
              {isBackToDefault ? " · 기본값으로 되돌립니다" : ""}
            </li>
          );
        })}
        {changedSlots.length > shown.length && (
          <li className="border-t border-zinc-200 py-1 dark:border-zinc-800">
            그 밖에 {changedSlots.length - shown.length}칸
          </li>
        )}
      </ul>

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
          disabled={isSaving}
          aria-busy={isSaving}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSaving ? "저장 중..." : "저장"}
        </button>
      </div>
    </dialog>
  );
}

// ───────────────────────────────────────────────────────────── 순수 도우미

/**
 * 저장된 행을 칸별 값으로 편다. 오버라이드가 없는 칸은 코드 기본값이다.
 *
 * 등록부에 없는 키·형식이 틀린 값·토큰의 성격과 맞지 않는 스코프는 **버린다** —
 * 조회(resolveUiTheme)와 루트 레이아웃이 똑같이 버리는 행이라, 여기서만 살려
 * 두면 화면은 "저장돼 있다"고 말하는데 실제 앱에는 적용되지 않은 값이 된다.
 */
function savedValuesOf(rows: readonly UiThemeOverrideRow[]): Record<string, string> {
  const byKey = new Map(UI_THEME_TOKENS.map((token) => [token.key, token]));
  const values: Record<string, string> = {};
  for (const slot of SLOTS) values[slot.key] = uiThemeDefaultFor(slot.token, slot.scope);

  for (const row of rows) {
    const token = byKey.get(row.tokenKey);
    if (!token) continue;
    if (!scopeFitsUiThemeToken(token, row.scope)) continue;
    const value = normalizeUiThemeValue(token, row.value);
    if (value === null) continue;
    values[slotKey(token.key, row.scope)] = value;
  }

  return values;
}

/** 편집 중인 값. 형식이 틀린 동안에는 저장돼 있는 값으로 메운다. */
function valueOrSaved(
  token: UiThemeToken,
  scope: UiThemeScope,
  normalized: Record<string, string | null>,
  savedValues: Record<string, string>
): string {
  const key = slotKey(token.key, scope);
  return normalized[key] ?? savedValues[key];
}

function changedCountOf(changedSlots: readonly Slot[], tokens: readonly UiThemeToken[]): number {
  const keys = new Set(tokens.map((token) => token.key));
  return changedSlots.filter((slot) => keys.has(slot.token.key)).length;
}
