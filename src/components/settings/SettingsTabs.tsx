"use client";

import { useState } from "react";
import CustomerStatusOptionSettings from "@/components/customer-portal/CustomerStatusOptionSettings";
import BadgeVisibilitySettings from "./BadgeVisibilitySettings";
import {
  SETTINGS_TAB_KEYS,
  SETTINGS_TAB_LABELS,
  initialSettingsTab,
  type SettingsTabKey,
} from "./settings-tab-access";
import type { BadgeVisibilityBadgeView } from "@/lib/db/queries/badge-visibility-settings";

/**
 * ============================================================================
 * [시스템 설정]의 탭 줄 (2026-11-13)
 * ============================================================================
 * 2026-11-13 까지 이 화면은 카드 하나(고객 안내 상태 목록)를 그냥 그렸다. 「배지
 * 표시」가 들어오면서 탭 둘이 됐고, 모양은 [사용자 관리]의 탭 줄을 그대로 가져왔다
 * (components/users/RepresentativeManagementScreen.tsx) — 밑줄 두께·여백·고른 탭의
 * 색까지 같다. 한 앱 안에서 탭이 화면마다 다르게 생기면 사람은 둘을 다른 종류의
 * 것으로 읽는다.
 *
 * 🔴 **차례와 이름은 순수 모듈이 쥔다**(settings-tab-access.ts). 여기에 글자를 적으면
 * 탭 단추와 탭 내용이 각자 따지게 된다.
 *
 * 🔴 **첫 탭이 「고객 안내 상태 목록」이다.** 탭이 생기기 전까지 이 화면에 들어오던
 * 사람이 보던 것이 그 카드이고, 그 카드의 동작·권한·모양은 한 글자도 바뀌지 않았다 —
 * 제 권한(customerPortal 의 관리)을 그대로 받아 그대로 그린다.
 *
 * 🔴 **두 탭 다 조건 없이 보인다.** 권한이 가르는 것은 탭 안의 고치기뿐이다
 * (settings-tab-access.ts 머리말).
 * ============================================================================
 */
export default function SettingsTabs({
  statusOptions,
  canManageStatusOptions,
  badges,
  canManageBadges,
}: {
  statusOptions: { id: string; label: string; displayOrder: number; isActive: boolean }[];
  /** 🔴 고객 안내 현황의 **관리** 수준. 이 조각이 들어오기 전과 같은 값이다. */
  canManageStatusOptions: boolean;
  badges: BadgeVisibilityBadgeView[];
  /** 🔴 시스템 설정의 **관리** 수준(auth/badge-visibility-authorization.ts). */
  canManageBadges: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(() => initialSettingsTab());

  return (
    <div className="flex flex-col gap-6">
      {/* 가로로 넘칠 수 있어 이 줄 안에서만 밀리게 한다(사용자 관리 탭 줄과 같다). */}
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {SETTINGS_TAB_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === key
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {SETTINGS_TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {/* 🔴 **마지막 갈래가 「고객 안내 상태 목록」이다.** 어떤 까닭으로든 탭 키가
          둘 다 아닌 값이 되면 이 조각이 그려진다 — 탭이 생기기 전의 화면이 바닥으로도
          맞다(사용자 관리 화면이 모두가 가진 탭을 바닥에 두는 것과 같은 판단). */}
      {activeTab === "badgeVisibility" ? (
        <BadgeVisibilitySettings badges={badges} canManage={canManageBadges} />
      ) : (
        <CustomerStatusOptionSettings options={statusOptions} canManage={canManageStatusOptions} />
      )}
    </div>
  );
}
