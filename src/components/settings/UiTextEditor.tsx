"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { DEFAULT_UI_TEXT } from "@/lib/domain/ui-text";
import {
  normalizeUiTextValue,
  UI_TEXT_GROUPS,
  UI_TEXT_MAX_LENGTH,
  type UiTextGroup,
  type UiTextItem,
  type UiTextOverrideRow,
} from "@/lib/domain/ui-text-overrides";
import { checkUiTextOverrideChange } from "@/lib/validation/ui-text-override-input";
import { saveUiTextOverridesAction } from "@/lib/server/actions/ui-text-overrides";

/**
 * ============================================================================
 * 화면 문구 편집기 — 앱 전체의 이름표
 * ============================================================================
 * 여기서 저장한 문구는 루트 레이아웃이 읽어 UiTextProvider 로 내려보내고, 화면들이
 * `uiText.role[...]` 처럼 그 값을 읽어 그린다(domain/ui-text.ts · providers/
 * UiTextProvider.tsx). 즉 이 화면의 저장 단추 하나가 **전 직원이 보는 이름표**를
 * 바꾼다.
 *
 * ── 🔴 색보다 더 또렷하게 알린다 ────────────────────────────────────────
 * 색 편집기(ThemeTokenEditor)도 전 직원 화면을 바꾸지만, 색은 "무엇을 하는
 * 화면인지"를 정하지 않는다. 이름표는 정한다 — 「관리자」를 「운영자」로 바꾸면
 * 사이드바와 사용자 관리 화면이 다른 말을 하기 시작하고, 그 말을 보고 일하는
 * 사람들의 판단이 함께 움직인다. 그래서 경고 상자를 맨 위에 두고, 저장 확인
 * 창에서도 몇 칸이 바뀌는지와 전 직원 적용을 다시 말한다.
 *
 * ── 🔴 편집칸을 만드는 묶음은 등록부 전체가 아니다 ──────────────────────
 * 등록부(UI_TEXT_GROUPS)에는 8묶음이 있지만 **화면이 실제로 읽는 것은 7묶음**
 * 이다(domain/ui-text.ts 의 UiText). 유·무상 구분은 접수 알림 메일 본문에도
 * 나가서 일부러 코드 표를 그대로 읽게 두었다 — 그 묶음에 편집칸을 만들면
 * "저장했는데 화면이 안 바뀐다"가 되고, 관리자에게 그것은 고장과 구별되지
 * 않는다. 그래서 목록을 손으로 적지 않고 **DEFAULT_UI_TEXT 에 그 묶음이 있는
 * 가**로 가른다: 화면이 읽지 않는 묶음은 저절로 떨어져 나가고, 언젠가 그 묶음을
 * 화면이 읽게 되는 날 편집칸도 저절로 생긴다.
 *
 * ── 검증 규칙을 여기 다시 적지 않는다 ───────────────────────────────────
 * 칸마다의 판정을 **서버가 쓰는 함수**(checkUiTextOverrideChange)로 한다. 오류
 * 문장까지 그대로 쓰므로, 화면이 막은 이유와 서버가 거절하는 이유가 어긋날
 * 자리가 없다. 화면에 규칙을 다시 적으면 두 벌이 되고, 한쪽만 고쳐지는 날이 온다.
 *
 * ── 바뀐 것만 보낸다 ────────────────────────────────────────────────────
 * 42칸을 통째로 보내지 않는다. `value: null` 이 "그 자리를 코드 기본 문구로
 * 되돌려라(= 행을 지워라)"는 뜻이고, 안 만진 칸까지 실어 보내면 "행이 없다 =
 * 기본 문구"라는 이 축의 뜻이 요청 모양에서 사라진다.
 * ============================================================================
 */

// ──────────────────────────────────────────────── 편집 가능한 자리(7묶음 42칸)

/** 편집 가능한 한 칸 — 묶음 하나 안의 항목 하나. */
type Slot = { key: string; group: UiTextGroup; item: UiTextItem };

function slotKey(groupKey: string, itemKey: string): string {
  return `${groupKey}:${itemKey}`;
}

/**
 * 편집칸을 만드는 묶음 — **화면이 실제로 읽는 묶음만.**
 *
 * 판정 기준을 DEFAULT_UI_TEXT 에서 가져오는 이유는 위 머리말에 있다. 지금은
 * 유·무상 구분 하나가 여기서 떨어져 나가고, 그 사실은 아래 잠긴 문구 안내가
 * 화면에서 말한다.
 */
const EDITABLE_GROUPS: readonly UiTextGroup[] = UI_TEXT_GROUPS.filter(
  (group) => group.key in DEFAULT_UI_TEXT
);

/**
 * 등록부에는 있지만 화면이 읽지 않는 묶음.
 *
 * 지금은 유·무상 구분 하나뿐이고 그 하나는 아래에서 **이름을 불러** 설명한다.
 * 그 밖의 것이 생기는 날 화면에서 조용히 사라지지 않도록, 남은 것들은 이름만이라도
 * 안내에 적는다 — 편집칸이 없는 것과 존재를 모르는 것은 다르다.
 */
const UNREAD_GROUPS: readonly UiTextGroup[] = UI_TEXT_GROUPS.filter(
  (group) => !(group.key in DEFAULT_UI_TEXT)
);
const UNNAMED_UNREAD_GROUPS = UNREAD_GROUPS.filter((group) => group.key !== "billingType");

const SLOTS: readonly Slot[] = EDITABLE_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ key: slotKey(group.key, item.key), group, item }))
);

// ───────────────────────────────────────────────────────────────── 편집기

type Draft = Record<string, string>;

/** 칸 하나의 판정 결과. 서버가 쓰는 함수가 그대로 만들어 준다. */
type Checked = { value: string | null; error: string | null };

export default function UiTextEditor({ saved }: { saved: readonly UiTextOverrideRow[] }) {
  const router = useRouter();

  /** 지금 저장돼 있는 문구(칸마다 하나). 오버라이드가 없는 칸은 코드 기본 문구다. */
  const savedValues = useMemo(() => savedValuesOf(saved), [saved]);

  const [draft, setDraft] = useState<Draft>(() => ({ ...savedValues }));
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /**
   * 칸마다의 판정. 화면이 들고 있는 것은 사람이 친 **원문**이고, 저장에 실리는 것은
   * 여기서 정규화된 값이다(앞뒤 공백을 다듬고 연속 공백을 하나로 줄인 값).
   *
   * 🔴 서버가 부르는 함수를 그대로 부른다 — 오류 문장까지 서버의 것이다.
   */
  const checked = useMemo(() => {
    const result: Record<string, Checked> = {};
    for (const slot of SLOTS) {
      const outcome = checkUiTextOverrideChange({
        groupKey: slot.group.key,
        itemKey: slot.item.key,
        value: draft[slot.key],
      });
      result[slot.key] = outcome.ok
        ? { value: outcome.change.value, error: null }
        : { value: null, error: outcome.message };
    }
    return result;
  }, [draft]);

  /** 형식이 틀린 칸. 하나라도 있으면 저장이 잠긴다. */
  const invalidSlots = useMemo(
    () => SLOTS.filter((slot) => checked[slot.key].error !== null),
    [checked]
  );

  /** 저장돼 있는 문구와 달라진 칸. 요청에 실릴 것이 정확히 이것이다. */
  const changedSlots = useMemo(
    () =>
      SLOTS.filter((slot) => {
        const value = checked[slot.key].value;
        return value !== null && value !== savedValues[slot.key];
      }),
    [checked, savedValues]
  );

  /** 묶음 머리에 붙는 「기본값과 다른 칸」 수 — 편집 중인 값 기준이다. */
  const offDefaultCountByGroup = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of EDITABLE_GROUPS) counts[group.key] = 0;
    for (const slot of SLOTS) {
      const value = checked[slot.key].value;
      if (value !== null && value !== slot.item.defaultText) counts[slot.group.key] += 1;
    }
    return counts;
  }, [checked]);

  /**
   * 처음 열었을 때 펼쳐 둘 묶음 — **지금 저장돼 있는 문구가 기본값과 다른 묶음.**
   *
   * 42칸을 한 번에 펼치면 화면이 길어져 무엇이 있는지 훑을 수가 없다. 접어 두면
   * 묶음 머리 7줄이 그대로 목차가 되고(이름 · 어느 화면에 나오는지 · 칸 수 ·
   * 바뀐 칸 수), 처음 연 사람은 무엇을 바꿀 수 있는지부터 본다. 이미 손대 둔
   * 묶음만 펼치는 것은 되돌리러 오는 사람을 위한 것이다 — 아무것도 저장돼 있지
   * 않은 지금은 전부 접힌 채로 열린다.
   *
   * 저장돼 있는 값으로만 정하므로 편집 중에는 값이 바뀌지 않는다. 사람이 접고 편
   * 것을 다시 뒤엎지 않기 위해서다.
   */
  const initiallyOpenGroups = useMemo(() => {
    const keys = new Set<string>();
    for (const slot of SLOTS) {
      if (savedValues[slot.key] !== slot.item.defaultText) keys.add(slot.group.key);
    }
    return keys;
  }, [savedValues]);

  const canSave = !isSaving && changedSlots.length > 0 && invalidSlots.length === 0;

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
   * 코드 기본 문구로 채운다. 저장을 눌러야 저장된 행이 실제로 지워진다.
   *
   * 🔴 색 편집기는 화면이 둘이라 「이 화면 전부」가 곧 「색만」이었다. 여기는 7묶음이
   * 한 화면에 다 있으므로 이 단추의 범위가 **편집할 수 있는 문구 전부**다 — 단추
   * 이름과 아래 설명이 그 사실을 말한다.
   */
  function fillWithDefaults() {
    setDraft(() => {
      const next: Draft = {};
      for (const slot of SLOTS) next[slot.key] = slot.item.defaultText;
      return next;
    });
    setMessage(null);
  }

  async function save() {
    if (!canSave) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveUiTextOverridesAction({
        changes: changedSlots.map((slot) => {
          const value = checked[slot.key].value;
          return {
            groupKey: slot.group.key,
            itemKey: slot.item.key,
            // 기본 문구로 돌아온 칸은 값을 저장하지 않고 **행을 지운다**. 기본값과
            // 같은 문구를 굳이 남기면, 나중에 코드의 기본 문구를 손볼 때 옛 문구가
            // 오버라이드로 굳어 아무 화면도 따라 바뀌지 않는다.
            value: value === slot.item.defaultText ? null : value,
          };
        }),
      });
      setConfirmOpen(false);
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setMessage({ type: "success", text: result.message });
      // 저장 결과(행이 지워진 칸 등)를 서버에서 다시 받아야 화면의 "저장돼 있는
      // 문구"가 실제와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">화면 문구</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          코드를 고치지 않고 앱 곳곳에 박혀 있는 이름표를 바꿉니다. {EDITABLE_GROUPS.length}묶음{" "}
          {SLOTS.length}문구를 편집할 수 있습니다. 표 머리·배지·필터 단추 같은{" "}
          <strong>한 줄 자리</strong>에 들어가는 문구라 줄바꿈과 탭은 넣을 수 없고, 최대{" "}
          {UI_TEXT_MAX_LENGTH}자입니다.
        </p>
      </div>

      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <strong>저장하면 전 직원 화면의 이름표가 바뀝니다.</strong> 이 값은 특정 사용자 설정이 아니라 앱
        전체가 쓰는 말입니다 — 「관리자」를 다른 말로 바꾸면 사이드바도, 사용자 관리도, 담당자 배정
        드롭다운도 그 말로 바뀝니다. 다른 사용자에게는 다음 화면 이동부터 보입니다. 되돌리려면{" "}
        <strong>모든 문구를 기본값으로</strong>를 누르고 다시 저장하면 됩니다.
      </p>

      <LockedTextNotice />

      {EDITABLE_GROUPS.map((group) => (
        <details
          key={group.key}
          open={initiallyOpenGroups.has(group.key)}
          className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="cursor-pointer px-3 py-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {group.label}
            </span>
            <span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {group.items.length}문구
            </span>
            <OffDefaultBadge count={offDefaultCountByGroup[group.key]} />
            <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {group.usage}
            </span>
          </summary>
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <ItemTable
              group={group}
              draft={draft}
              checked={checked}
              savedValues={savedValues}
              disabled={isSaving}
              onChange={setSlot}
            />
          </div>
        </details>
      ))}

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
          {message.type === "success" && " 다른 사용자는 다음 화면 이동부터 보입니다."}
        </p>
      )}

      {invalidSlots.length > 0 && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          넣을 수 없는 문구가 {invalidSlots.length}칸 있습니다. 빨갛게 표시된 칸을 고쳐야 저장할 수
          있습니다.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {changedSlots.length === 0
            ? "변경된 내용이 없습니다."
            : `${changedSlots.length}개 문구가 바뀌었습니다. 저장해야 적용됩니다.`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fillWithDefaults}
            disabled={isSaving}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            모든 문구를 기본값으로
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

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        <strong>되돌리기</strong>는 편집 중인 문구를 지금 저장돼 있는 문구로 돌립니다(서버에 아무것도
        보내지 않습니다). <strong>모든 문구를 기본값으로</strong>는 이 화면의{" "}
        {EDITABLE_GROUPS.length}묶음 {SLOTS.length}문구를 <strong>남김없이</strong> 코드 기본 문구로
        채우며 — 지금 접혀 있는 묶음도 함께입니다 — <strong>저장을 눌러야</strong> 저장된 문구가 실제로
        지워집니다.
      </p>

      <SaveConfirmDialog
        isOpen={isConfirmOpen}
        isSaving={isSaving}
        changedSlots={changedSlots}
        checked={checked}
        savedValues={savedValues}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────── 잠긴 문구 안내

/**
 * 여기서 바꿀 수 없는 문구 셋.
 *
 * 🔴 편집칸을 만들지 않는 것만으로는 부족하다. 없는 것은 화면에서 **찾을 수가
 * 없어서**, 관리자는 「제품 구분이 왜 안 보이지」 하며 목록을 몇 번이고 훑게
 * 된다. 무엇이 없는지와 왜 없는지를 적어 두면 그 시간이 통째로 사라진다.
 *
 * 셋의 성격이 서로 다르다는 것도 함께 말한다 — 앞의 둘은 **일부러 잠근 것**이고,
 * 예외 상태는 잠긴 것이 아니라 **주인이 다른 자리**에 있다.
 */
function LockedTextNotice() {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <p className="font-semibold text-zinc-700 dark:text-zinc-300">
        여기서 바꿀 수 없는 문구가 셋 있습니다.
      </p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1.5 pl-4">
        <li>
          <strong>제품 구분</strong>(Matcher · Generator · Total Controller) — 그 문구 값이 곧{" "}
          <strong>검색 비교값</strong>입니다. 바꾸는 순간 기존 필터가 아무것도 찾지 못하는데 오류도 나지
          않아, 화면만 보고는 고장난 줄조차 알 수 없습니다.
        </li>
        <li>
          <strong>유·무상 구분</strong>(유상 · 일부유상 · 무상 · 추후결정) —{" "}
          <strong>접수 알림 메일 본문에도 나가는 문구</strong>입니다. 화면과 메일이 서로 다른 말을 하는
          길을 막으려고 여기서는 열지 않았습니다.
        </li>
        <li>
          <strong>예외 상태</strong>(보류 · 부품 대기 · 폐기 …) — 여기서 못 바꾸는 것이 아니라{" "}
          <strong>자리가 다릅니다.</strong> 데이터베이스의{" "}
          <code className="font-mono">exception_statuses</code> 표가 그 문구의 주인이고, 화면 3곳이 이미
          그 표를 읽습니다. 그 표를 화면에서 편집하는 자리는 아직 없습니다.
        </li>
        {UNNAMED_UNREAD_GROUPS.length > 0 && (
          <li>
            <strong>{UNNAMED_UNREAD_GROUPS.map((group) => group.label).join(" · ")}</strong> — 등록부에는
            있지만 화면이 읽지 않는 묶음입니다. 여기서 바꿔도 화면에 나오지 않으므로 편집칸을 만들지
            않았습니다.
          </li>
        )}
      </ul>
    </div>
  );
}

// ───────────────────────────────────────────────────────── 묶음 하나의 표

/**
 * 묶음 한 벌. 왼쪽이 **원래 문구**(그 자리가 무엇인지), 오른쪽이 지금 문구다.
 *
 * 폰에서 표가 넓어도 **페이지 전체가 가로로 스크롤되면 안 된다** — 넓은 것은 자기
 * 컨테이너 안에서만 스크롤한다(이 저장소 목록 화면들의 방식).
 */
function ItemTable({
  group,
  draft,
  checked,
  savedValues,
  disabled,
  onChange,
}: {
  group: UiTextGroup;
  draft: Draft;
  checked: Record<string, Checked>;
  savedValues: Record<string, string>;
  disabled: boolean;
  onChange: (slot: Slot, value: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        <thead className="text-xs text-zinc-500 dark:text-zinc-400">
          <tr>
            <th scope="col" className="py-1 pr-3 text-left font-medium">
              기본 문구
            </th>
            <th scope="col" className="py-1 text-left font-medium">
              화면에 나올 문구
            </th>
          </tr>
        </thead>
        <tbody>
          {group.items.map((item) => {
            const slot: Slot = { key: slotKey(group.key, item.key), group, item };
            const state = checked[slot.key];
            return (
              <tr
                key={item.key}
                className="border-t border-zinc-200 align-top dark:border-zinc-800"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {item.defaultText}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {item.key}
                  </span>
                  {item.usage && (
                    <span className="mt-0.5 block max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {item.usage}
                    </span>
                  )}
                </th>
                <td className="py-2">
                  <div className="flex max-w-xs flex-col gap-1">
                    <input
                      type="text"
                      aria-label={`${group.label} — ${item.defaultText}`}
                      value={draft[slot.key]}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={disabled}
                      onChange={(event) => onChange(slot, event.target.value)}
                      className={`w-full rounded-md border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                        state.error !== null
                          ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400"
                          : "border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                      }`}
                    />
                    <FieldNote
                      error={state.error}
                      value={state.value}
                      defaultText={item.defaultText}
                      saved={savedValues[slot.key]}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 칸 아래 한 줄. **왜 막혔는지** 또는 **기본값에서 벗어났는지**와 아직 저장하지
 * 않았는지를 한자리에서 말한다.
 *
 * 막힌 이유는 서버가 만든 문장을 그대로 쓴다 — 화면이 따로 적으면 두 벌이 된다.
 */
function FieldNote({
  error,
  value,
  defaultText,
  saved,
}: {
  error: string | null;
  value: string | null;
  defaultText: string;
  saved: string;
}) {
  if (error !== null) {
    return (
      <span className="text-[11px] leading-snug text-red-700 dark:text-red-400">{error}</span>
    );
  }

  const isDefault = value === defaultText;
  const isUnsaved = value !== saved;

  return (
    <span
      className={
        isDefault
          ? "text-[10px] text-zinc-400 dark:text-zinc-500"
          : "text-[10px] text-amber-700 dark:text-amber-400"
      }
    >
      {isDefault ? "기본 문구 그대로" : "기본 문구와 다름"}
      {isUnsaved ? " · 저장 안 됨" : ""}
    </span>
  );
}

function OffDefaultBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      기본값과 다른 칸 {count}개
    </span>
  );
}

// ────────────────────────────────────────────────────────── 저장 확인 창

/**
 * 되돌리기 어려운 동작은 다이얼로그로 두 번 확인한다(UI_GUIDELINE 5절).
 * 이 저장소의 다른 확인 창들과 같은 native <dialog> 패턴이다.
 *
 * 바뀌는 문구를 「원래 → 새 문구」로 늘어놓는다. 이름표는 값 자체가 뜻이라,
 * 몇 칸인지만 말하고 넘어가면 무엇을 승인하는지 알 수 없다.
 */
function SaveConfirmDialog({
  isOpen,
  isSaving,
  changedSlots,
  checked,
  savedValues,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isSaving: boolean;
  changedSlots: readonly Slot[];
  checked: Record<string, Checked>;
  savedValues: Record<string, string>;
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
      aria-labelledby="ui-text-save-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="ui-text-save-dialog-title" className="text-sm font-semibold">
        화면 문구 저장
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {changedSlots.length}개 문구를 저장합니다. <strong>전 직원 화면</strong>의 이름표가 다음 화면
        이동부터 이 문구로 바뀝니다.
      </p>

      <ul className="mt-3 max-h-48 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
        {shown.map((slot) => {
          const value = checked[slot.key].value;
          const isBackToDefault = value === slot.item.defaultText;
          return (
            <li
              key={slot.key}
              className="border-t border-zinc-200 py-1 first:border-t-0 dark:border-zinc-800"
            >
              <span className="text-zinc-500 dark:text-zinc-400">{slot.group.label}</span> ·{" "}
              <span className="line-through">{savedValues[slot.key]}</span> →{" "}
              <span className="text-zinc-900 dark:text-zinc-50">{value}</span>
              {isBackToDefault ? " · 기본 문구로 되돌립니다" : ""}
            </li>
          );
        })}
        {changedSlots.length > shown.length && (
          <li className="border-t border-zinc-200 py-1 dark:border-zinc-800">
            그 밖에 {changedSlots.length - shown.length}개 문구
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
 * 저장된 행을 칸별 문구로 편다. 오버라이드가 없는 칸은 코드 기본 문구다.
 *
 * 등록부에 없는 키·형식이 틀린 값·**이 화면이 그리지 않는 묶음**의 행은 버린다 —
 * 읽기 쪽(resolveUiText)이 똑같이 버리거나 화면이 읽지 않는 행이라, 여기서만 살려
 * 두면 편집기는 "저장돼 있다"고 말하는데 실제 앱에는 나타나지 않는 문구가 된다.
 */
function savedValuesOf(rows: readonly UiTextOverrideRow[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const slot of SLOTS) values[slot.key] = slot.item.defaultText;

  for (const row of rows) {
    const key = slotKey(row.groupKey, row.itemKey);
    if (!(key in values)) continue;
    const value = normalizeUiTextValue(row.value);
    if (value === null) continue;
    values[key] = value;
  }

  return values;
}
