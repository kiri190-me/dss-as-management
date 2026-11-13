"use client";

import { useMemo, useState, useTransition } from "react";
import { BadgeSample } from "./badge-samples";
import {
  badgeDraftFromView,
  badgeDraftKey,
  badgeViewSignature,
  changedBadgePlacements,
} from "./badge-visibility-draft";
import type { BadgeVisibilityPlacementInput } from "@/lib/db/mutations/badge-visibility-settings";
import type { BadgeVisibilityBadgeView } from "@/lib/db/queries/badge-visibility-settings";

/**
 * ============================================================================
 * [시스템 설정] → [배지 표시] 탭의 **속** (2026-11-13)
 * ============================================================================
 * 화면에 뜨는 작은 알약 모양 표식(배지)을 **자리별로** 끄는 체크상자 29개와 [저장]
 * 하나. 무엇을 끌 수 있는지·어떤 차례인지·어떤 글자인지는 **전부 서버가 넘긴
 * 자료**(buildBadgeVisibilityView)에서 온다 — 등록부를 화면이 다시 읽지 않는다.
 *
 * ── 🔴 왜 바깥(BadgeVisibilitySettings)과 갈라 두는가 ───────────────────
 * 이 조각은 서버 액션을 **직접 가져오지 않는다.** 저장은 `onSave` 로 받는다. 서버
 * 액션을 import 하는 클라이언트 컴포넌트는 `server-only` 사슬을 물어 시험에서
 * **그려 볼 수 없다**(components 목록은 react-server 조건을 켜지 않는다). 그러면
 * 「체크상자가 29개인가」·「전부 꺼도 보기 배지가 남는가」 같은, 이 화면에서 가장
 * 중요한 것들을 글자로만 짐작해야 한다. 같은 까닭으로 갈라 둔 이웃이
 * ProcedureStartPickerPanel 이다.
 *
 * ── 🔴 [저장] 하나로 한꺼번에 ───────────────────────────────────────────
 * 체크상자마다 즉시 저장하지 않는다. 29번을 각각 보내면 ① 서버 왕복이 29번이고
 * ② 중간에 실패한 몇 개만 반영된 상태가 만들어지며 ③ 감사 기록이 29줄로 흩어져
 * "이 사람이 한 번에 무엇을 했는지"가 사라진다. 저장은 한 트랜잭션이다
 * (db/mutations/badge-visibility-settings.ts).
 *
 * 🔴 **바뀐 쌍만 보낸다.** 29개를 통째로 보내면 다른 관리자가 그 사이에 바꿔 둔
 * 자리를 내 화면의 옛 값으로 덮어쓴다(actions/badge-visibility-settings.ts 의 같은 글).
 *
 * ── 🔴 성공은 저장 팝업, 실패는 화면에 남긴다 ───────────────────────────
 * 저장 팝업(common/SavePopup.tsx)은 0.5초 뒤 저절로 닫히는 **성공 전용**이다. 실패를
 * 거기 실으면 읽기 전에 사라진다 — 바로 옆 카드(CustomerStatusOptionSettings)가
 * 선 그 선을 그대로 따른다. 실패 문장은 role="alert" 로 화면에 남는다.
 *
 * ── 🔴 못 고치는 사람에게도 **보여 준다** ───────────────────────────────
 * 체크상자는 비활성으로 그리고 [저장]은 아예 그리지 않는다. 숨기지 않는 까닭은,
 * 끈 배지를 찾으러 온 사람이 지금 무엇이 꺼져 있는지는 봐야 하기 때문이다
 * (settings-tab-access.ts 의 같은 판단).
 *
 * ── 옷은 옆 카드와 맞춘다 ───────────────────────────────────────────────
 * 같은 화면에서 탭 하나를 건너뛰면 나오는 카드가 고객 안내 상태 목록이다. 그 카드가
 * dark: 변종을 쓰지 않으므로 여기서도 쓰지 않는다 — 한 화면 안에서 두 카드가 다른
 * 규칙으로 칠해지면 어느 쪽이 맞는지 알 수 없게 된다.
 * ============================================================================
 */

export type BadgeVisibilitySaveResult = { ok: boolean; message: string };

export default function BadgeVisibilityPanel({
  badges,
  canManage,
  onSave,
}: {
  /** 🔴 차례도 글자도 서버가 정한다(queries/badge-visibility-settings.ts). */
  badges: BadgeVisibilityBadgeView[];
  /**
   * 🔴 「시스템 설정」의 **관리** 수준이 있는가. 서버 페이지가 계산해 내려보내고,
   * 서버 액션과 mutation 이 **같은 열쇠로 다시** 본다 — 단추를 감추는 것은 막은
   * 것이 아니다(auth/badge-visibility-authorization.ts).
   */
  canManage: boolean;
  onSave: (placements: BadgeVisibilityPlacementInput[]) => Promise<BadgeVisibilitySaveResult>;
}) {
  const signature = useMemo(() => badgeViewSignature(badges), [badges]);
  const [state, setState] = useState(() => ({ signature, draft: badgeDraftFromView(badges) }));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 서버 값이 실제로 달라졌을 때만 기준선을 새로 잡는다(badge-visibility-draft.ts 의
  // badgeViewSignature 주석). 렌더 중 setState 는 React 가 권하는 "프롭이 바뀔 때 상태
  // 맞추기" 모양이다 — 이 렌더는 버려지고 곧바로 새 값으로 다시 그려진다.
  if (state.signature !== signature) {
    setState({ signature, draft: badgeDraftFromView(badges) });
  }
  const draft = state.draft;

  const changed: BadgeVisibilityPlacementInput[] = changedBadgePlacements(badges, draft);

  function toggle(badgeKey: string, placeKey: string): void {
    const key = badgeDraftKey(badgeKey, placeKey);
    setState((previous) => ({
      signature: previous.signature,
      draft: { ...previous.draft, [key]: !previous.draft[key] },
    }));
  }

  function save(): void {
    startTransition(async () => {
      const result = await onSave(changed);
      // 성공은 바깥이 저장 팝업으로 알린다. 여기 남는 것은 실패뿐이다(머리말).
      setMessage(result.ok ? null : result.message);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-5">
      <header>
        <h2 className="text-base font-bold text-zinc-900">배지 표시</h2>
        {/* 🔴 「자리별」이라는 사실이 이 한 줄에 있어야 한다 — 체크를 푼 사람이
            그 배지가 모든 화면에서 사라졌다고 믿으면, 다른 화면에 그대로 있는 것을
            보고 고장으로 읽는다. 보기 배지가 설정을 안 따른다는 사실도 함께 적는다
            (적어 두지 않으면 "껐는데 여기엔 보인다"가 또 하나의 고장으로 읽힌다). */}
        <p className="mt-1 text-sm text-zinc-600">
          체크를 풀면 <strong className="text-zinc-900">그 자리에서만</strong> 배지가 사라집니다.
          같은 배지라도 다른 자리는 그대로 보입니다. 아래 이름 옆에 보이는 배지는 모양을 보여
          주는 것이라, 설정과 상관없이 늘 보입니다 — 끈 배지를 다시 찾을 수 있어야 하기
          때문입니다.
        </p>
      </header>

      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          {message}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-zinc-200">
        {badges.map((badge) => (
          <li key={badge.badgeKey} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* 🔴 보기 배지는 자리를 받지 않는다 — 설정 판정 밖이다(badge-samples.tsx). */}
              <BadgeSample badgeKey={badge.badgeKey} />
              <span className="text-sm font-bold text-zinc-900">{badge.label}</span>
            </div>
            <p className="text-xs text-zinc-600">{badge.description}</p>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {badge.places.map((place) => (
                <label
                  key={place.placeKey}
                  className="flex items-center gap-2 text-sm text-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={draft[badgeDraftKey(badge.badgeKey, place.placeKey)]}
                    disabled={!canManage || pending}
                    onChange={() => toggle(badge.badgeKey, place.placeKey)}
                    className="h-4 w-4 rounded border-zinc-300 disabled:opacity-50"
                  />
                  {place.label}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="flex justify-end">
          <button
            type="button"
            // 바꾼 것이 없으면 누를 수 없다 — 누르면 "변경된 내용이 없습니다"만
            // 돌아오고, 그 답은 사람이 무언가 잘못했다는 신호처럼 읽힌다.
            disabled={pending || changed.length === 0}
            onClick={save}
            className="rounded bg-primary-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            저장
          </button>
        </div>
      ) : null}
    </section>
  );
}
