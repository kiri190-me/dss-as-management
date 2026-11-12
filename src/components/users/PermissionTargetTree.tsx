"use client";

import {
  PERMISSION_AREA_GROUPS,
  type PermissionAreaNode,
} from "@/lib/auth/permission-area-groups";
import { featuresOfArea } from "@/lib/auth/permission-features";

/**
 * ============================================================================
 * 역할별 접근 권한 화면의 **왼쪽 대상 목록**
 * ============================================================================
 * 고르는 것은 그대로다(영역 하나 또는 잎 하나). 2026-11-12 에 바뀐 것은
 * **늘어서는 차례와 묶음**뿐이고, 그 둘은 navigation.ts 에서 읽어 온다
 * (lib/auth/permission-area-groups.ts). 저장되는 열쇠·값·기본 정책은 한 글자도
 * 달라지지 않는다.
 *
 * ── 🔴 들여쓰기가 **두 뜻**이다. 같은 모양으로 그리면 안 된다 ─────────────
 * 이 목록에는 성격이 다른 들여쓰기가 둘 있다.
 *
 *   ① 하위메뉴  — 대시보드 아래 주간보고. 부모와 **다른 화면**이다.
 *   ② 하위 기능 — 전체 A/S 현황 아래 「접수 건 조회」. 같은 화면 **안**의 조작이다.
 *
 * 둘을 같은 모양으로 그리면 읽는 사람이 주간보고를 「대시보드 화면 안의 기능」
 * 으로 읽는다. 그래서 눈으로 갈리게 셋을 달리 했다:
 *
 *   하위메뉴   왼쪽에 **세로 선**을 긋고(사이드바가 대시보드 하위메뉴를 그리는
 *              바로 그 모양이다 — layout/Sidebar.tsx), 굵은 글씨와 접기 단추
 *              자리를 **영역 줄 그대로** 둔다. 제 하위 기능을 가질 수 있는,
 *              영역과 같은 급의 줄이기 때문이다.
 *   하위 기능  세로 선 없이 들여쓰기만 하고 보통 글씨다. 지금까지와 같다 —
 *              이 판에서 손대지 않았다.
 *
 * ── 🔴 묶음 머리말은 스크롤에 묻히지 않는다 ─────────────────────────────
 * 이 목록은 높이가 정해진 스크롤 칸이고, 묶음이 생기면서 더 길어졌다. 머리말이
 * 위로 밀려 나가면 「지금 보고 있는 줄이 어느 묶음인가」를 알 수 없어, 묶음을
 * 만든 뜻이 스크롤 한 번에 사라진다. sticky 로 제 묶음이 지나갈 동안 붙여 둔다
 * — 바탕을 반투명으로 두면 아래 줄이 비쳐 글자가 겹치므로 **불투명**이다.
 * ============================================================================
 */
export default function PermissionTargetTree({
  selectedKey,
  onSelect,
  expandedKeys,
  onToggleExpanded,
  openRoleCount,
}: {
  selectedKey: string;
  onSelect: (key: string) => void;
  /** 펼쳐 둔 **영역** 열쇠들. 묶음이 생겨도 이 상태의 뜻은 그대로다. */
  expandedKeys: ReadonlySet<string>;
  onToggleExpanded: (areaKey: string) => void;
  /** 이 노드를 쓸 수 있는 역할 수 — 초안 기준이라 부모가 계산해서 넘긴다. */
  openRoleCount: (key: string) => number;
}) {
  function renderArea(node: PermissionAreaNode) {
    const features = featuresOfArea(node.area.key);
    const isOpen = expandedKeys.has(node.area.key);
    const isSelected = selectedKey === node.area.key;

    return (
      <li key={node.area.key}>
        <div className="flex items-center">
          {features.length > 0 ? (
            <button
              type="button"
              aria-label={`${node.area.label} ${isOpen ? "접기" : "펼치기"}`}
              aria-expanded={isOpen}
              onClick={() => onToggleExpanded(node.area.key)}
              className="w-5 shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            type="button"
            data-permission-area={node.area.key}
            onClick={() => onSelect(node.area.key)}
            aria-current={isSelected ? "true" : undefined}
            className={`flex flex-1 items-center justify-between gap-2 rounded px-2 py-1 text-left ${
              isSelected
                ? "bg-primary-900 text-zinc-50 dark:bg-primary-100 dark:text-zinc-900"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <span className="truncate font-medium">
              {node.area.label}
              {/* 🔴 묶음 머리말만으로는 모자란다 — 줄 하나를 눌러 놓고 오른쪽 표만
                  보는 사람은 머리말을 지나쳐 읽는다. 그 사람이 「관리로 열었다」고
                  믿는 것을 막는 것이 이 꼬리표다. */}
              {node.notInMenu && (
                <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] font-normal text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                  메뉴에 없음
                </span>
              )}
            </span>
            <RoleCountBadge count={openRoleCount(node.area.key)} selected={isSelected} />
          </button>
        </div>

        {/* ② 하위 기능 — 같은 화면 안의 조작. 세로 선을 긋지 않는다(파일 머리말). */}
        {isOpen && features.length > 0 && (
          <ul className="flex flex-col">
            {features.map((feature) => (
              <li key={feature.key} className="flex items-center">
                <span className="w-5 shrink-0" />
                <button
                  type="button"
                  data-permission-leaf={feature.key}
                  onClick={() => onSelect(feature.key)}
                  aria-current={selectedKey === feature.key ? "true" : undefined}
                  className={`ml-3 flex flex-1 items-center justify-between gap-2 rounded px-2 py-1 text-left ${
                    selectedKey === feature.key
                      ? "bg-primary-900 text-zinc-50 dark:bg-primary-100 dark:text-zinc-900"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="truncate">
                    {feature.label}
                    {feature.fixed && <span className="ml-1 text-xs opacity-60">고정</span>}
                  </span>
                  <RoleCountBadge
                    count={openRoleCount(feature.key)}
                    selected={selectedKey === feature.key}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ① 하위메뉴 — 다른 화면. 세로 선으로 ② 와 가른다(파일 머리말). */}
        {node.children.length > 0 && (
          <ul
            data-permission-submenu-of={node.area.key}
            className="ml-5 flex flex-col border-l border-zinc-200 pl-1 dark:border-zinc-800"
          >
            {node.children.map(renderArea)}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav
      aria-label="권한 대상"
      className="max-h-[28rem] overflow-y-auto rounded-lg border border-zinc-200 p-1 text-sm dark:border-zinc-800"
    >
      {PERMISSION_AREA_GROUPS.map((group) => (
        <section key={group.key} aria-label={group.label ?? undefined}>
          {/* 머리말이 null 인 묶음은 사이드바에서도 머리말 없이 단독으로 선다
              (지금은 대시보드). 없는 이름을 여기서 지어 붙이면 그것이 곧 두 벌로
              적힌 말이 된다 — permission-area-groups.ts 의 그 문단. */}
          {group.label !== null && (
            <h3 className="sticky top-0 z-10 -mx-1 bg-zinc-100 px-3 py-1 text-xs font-bold tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {group.label}
            </h3>
          )}
          {group.notInMenu && (
            <p className="px-3 py-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              사이드바 메뉴에 나오지 않는 항목입니다. 여기서 넓혀도 <strong>메뉴가 생기지는
              않습니다</strong> — 다른 화면 안에서 쓰이는 권한일 수 있으니 오른쪽 설명을 보고
              정하세요.
            </p>
          )}
          <ul className="flex flex-col">{group.nodes.map(renderArea)}</ul>
        </section>
      ))}
    </nav>
  );
}

/** 몇 개 역할이 이 대상을 쓸 수 있는지. 트리에서 규모를 한눈에 보여 준다. */
function RoleCountBadge({ count, selected }: { count: number; selected: boolean }) {
  return (
    <span
      title={`${count}개 역할이 사용할 수 있습니다`}
      className={`shrink-0 rounded-full px-1.5 text-[11px] tabular-nums ${
        selected
          ? "bg-zinc-700 text-zinc-100 dark:bg-zinc-300 dark:text-zinc-800"
          : count === 0
            ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {count}
    </span>
  );
}
