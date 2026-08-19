"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PERMISSION_AREAS,
  isRoleEditableInPermissionSettings,
  permissionLevelLabels,
  permissionLevelRank,
  type PermissionLevel,
} from "@/lib/auth/permission-areas";
import {
  areaLevelFromLeaves,
  featuresOfArea,
  findPermissionFeature,
  hasFeatures,
  levelHintOfLeaf,
  selectableLevelsOfLeaf,
} from "@/lib/auth/permission-features";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";
import { saveRolePermissionsAction } from "@/lib/server/actions/role-permissions";

export type RolePermissionView = {
  effective: Record<string, PermissionLevel>;
  baseline: Record<string, PermissionLevel>;
  areaEffective: Record<string, PermissionLevel>;
};

export type RolePermissionScreenData = {
  roles: Record<Role, RolePermissionView>;
  canWiden: boolean;
};

type Draft = Record<Role, Record<string, PermissionLevel>>;

/**
 * ============================================================================
 * 역할별 접근 권한 설정 화면
 * ============================================================================
 * NAS의 공유폴더 권한창과 같은 구조다 — 왼쪽에서 **대상**(메뉴/기능)을 하나
 * 고르고, 오른쪽에서 그 대상에 대한 **모든 역할**의 권한을 한 표에서 정한다.
 *
 * ── 왜 이 배치인가 ─────────────────────────────────────────────────────
 * 이전 화면은 역할 탭을 고르고 메뉴 14줄을 가로로 길게 늘어놓았다. 한 화면에
 * 담기지 않아 가로 스크롤이 생겼고, "이 기능을 누가 쓸 수 있나"라는 가장 흔한
 * 질문에 답하려면 탭을 네 번 오가며 기억해야 했다. 대상을 하나로 좁히면 역할이
 * 다섯 줄뿐이라 표가 짧아지고, 그 질문이 한눈에 답해진다.
 *
 * ── 고르는 값과 저장되는 값이 같다 ──────────────────────────────────────
 * 표에서 고르는 것은 잎(하위 기능) 하나의 수준이고, 저장·판정도 같은 단위다.
 * 메뉴 줄에는 값을 두지 않는다 — 메뉴 수준은 하위 기능의 최대값으로 **계산**되며,
 * 왼쪽 트리에 표시만 된다. 메뉴와 하위를 따로 저장하면 "메뉴는 읽기인데 하위는
 * 쓰기"가 만들어지고, 그때 무엇이 이기는지 설명할 방법이 없다.
 *
 * ── 고를 수 없는 칸은 만들지 않는다 ─────────────────────────────────────
 * 열은 그 기능에서 의미 있는 수준만 만든다('삭제·복원'이면 접근 불가와 관리
 * 둘뿐이다). 그리고 기본 정책보다 높은 값은 최고관리자에게만 열린다 — 관리자에게
 * 보여 주고 저장할 때 깎으면, 고른 사람은 무언가 됐다고 믿는다.
 * ============================================================================
 */
export default function RolePermissionSettings({
  actingRole,
  data,
}: {
  actingRole: Role;
  data: RolePermissionScreenData;
}) {
  const router = useRouter();

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(PERMISSION_AREAS.filter((area) => hasFeatures(area.key)).map((area) => area.key))
  );
  const [selectedKey, setSelectedKey] = useState<string>(() => firstLeafKey());
  const [draft, setDraft] = useState<Draft>(() => initialDraft(data));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const changedRoles = useMemo(() => changedRolesOf(draft, data), [draft, data]);
  const changedCount = useMemo(
    () =>
      changedRoles.reduce(
        (sum, role) =>
          sum +
          Object.keys(draft[role]).filter((key) => draft[role][key] !== data.roles[role].effective[key])
            .length,
        0
      ),
    [changedRoles, draft, data]
  );

  /** 초안 기준으로 다시 계산한 메뉴 수준 — 왼쪽 트리의 표시를 저장 전에도 맞춘다. */
  function areaLevelOf(areaKey: string, role: Role): PermissionLevel {
    return areaLevelFromLeaves(areaKey, (leafKey) => draft[role][leafKey] ?? "NONE");
  }

  /** 이 노드를 쓸 수 있는 역할 수 — 트리에서 한눈에 규모를 보여 준다. */
  function openRoleCount(key: string): number {
    const isArea = !key.includes(".");
    return ROLE_CODES.filter((role) =>
      isArea ? areaLevelOf(key, role) !== "NONE" : (draft[role][key] ?? "NONE") !== "NONE"
    ).length;
  }

  function setLevel(leafKey: string, role: Role, level: PermissionLevel) {
    setDraft((prev) => ({ ...prev, [role]: { ...prev[role], [leafKey]: level } }));
    setMessage(null);
  }

  function applyToArea(areaKey: string, mode: "close" | "default") {
    setDraft((prev) => {
      const next: Draft = { ...prev };
      for (const role of ROLE_CODES) {
        if (!isRoleEditableInPermissionSettings(role)) continue;
        const roleDraft = { ...next[role] };
        for (const feature of featuresOfArea(areaKey)) {
          if (findPermissionFeature(feature.key)?.fixed) continue;
          roleDraft[feature.key] =
            mode === "close" ? "NONE" : data.roles[role].baseline[feature.key] ?? "NONE";
        }
        next[role] = roleDraft;
      }
      return next;
    });
    setMessage(null);
  }

  function reset() {
    setDraft(initialDraft(data));
    setMessage(null);
  }

  async function save() {
    if (isSaving || changedRoles.length === 0) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveRolePermissionsAction({
        changes: changedRoles.map((role) => ({ role, levels: draft[role] })),
      });
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setMessage({ type: "success", text: result.message });
      // 저장 결과(기본으로 되돌아갔거나 깎인 값)를 서버에서 다시 받아야 화면이
      // 실제 상태와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  const selectedFeature = findPermissionFeature(selectedKey);
  const selectedArea = PERMISSION_AREAS.find(
    (area) => area.key === (selectedFeature?.areaKey ?? selectedKey)
  );
  const isAreaSelected = !selectedKey.includes(".");

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">역할별 접근 권한</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          왼쪽에서 메뉴나 기능을 고르고, 오른쪽 표에서 역할마다 무엇까지 할 수 있는지 정합니다.
          {data.canWiden ? (
            <>
              {" "}
              최고관리자이므로 <strong>기본 정책보다 넓게</strong> 줄 수도 있습니다.
            </>
          ) : (
            <> 기본 정책보다 넓게 주는 것은 최고관리자만 할 수 있습니다.</>
          )}
        </p>
      </div>

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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
        {/* ── 왼쪽: 대상 트리 ─────────────────────────────────────── */}
        <nav
          aria-label="권한 대상"
          className="max-h-[28rem] overflow-y-auto rounded-lg border border-zinc-200 p-1 text-sm dark:border-zinc-800"
        >
          <ul className="flex flex-col">
            {PERMISSION_AREAS.map((area) => {
              const children = featuresOfArea(area.key);
              const isOpen = expanded.has(area.key);
              return (
                <li key={area.key}>
                  <div className="flex items-center">
                    {children.length > 0 ? (
                      <button
                        type="button"
                        aria-label={`${area.label} ${isOpen ? "접기" : "펼치기"}`}
                        aria-expanded={isOpen}
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(area.key)) next.delete(area.key);
                            else next.add(area.key);
                            return next;
                          })
                        }
                        className="w-5 shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedKey(area.key)}
                      aria-current={selectedKey === area.key ? "true" : undefined}
                      className={`flex flex-1 items-center justify-between gap-2 rounded px-2 py-1 text-left ${
                        selectedKey === area.key
                          ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <span className="truncate font-medium">{area.label}</span>
                      <RoleCountBadge count={openRoleCount(area.key)} selected={selectedKey === area.key} />
                    </button>
                  </div>

                  {isOpen && children.length > 0 && (
                    <ul className="flex flex-col">
                      {children.map((feature) => (
                        <li key={feature.key} className="flex items-center">
                          <span className="w-5 shrink-0" />
                          <button
                            type="button"
                            onClick={() => setSelectedKey(feature.key)}
                            aria-current={selectedKey === feature.key ? "true" : undefined}
                            className={`ml-3 flex flex-1 items-center justify-between gap-2 rounded px-2 py-1 text-left ${
                              selectedKey === feature.key
                                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
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
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ── 오른쪽: 고른 대상 × 역할 ────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {isAreaSelected ? selectedArea?.label : `${selectedArea?.label} › ${selectedFeature?.label}`}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {isAreaSelected ? selectedArea?.description : selectedFeature?.description}
            </p>
          </div>

          {isAreaSelected && hasFeatures(selectedKey) ? (
            <AreaSummary
              areaKey={selectedKey}
              areaLevelOf={areaLevelOf}
              onSelectFeature={setSelectedKey}
              onApply={applyToArea}
              disabled={isSaving}
            />
          ) : (
            <LeafTable
              leafKey={selectedKey}
              draft={draft}
              data={data}
              actingRole={actingRole}
              disabled={isSaving}
              onChange={setLevel}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {changedCount === 0
            ? "변경된 항목이 없습니다."
            : `${changedCount}개 항목(역할 ${changedRoles.length}개)이 바뀌었습니다. 저장해야 적용됩니다.`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={isSaving || changedCount === 0}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            되돌리기
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || changedCount === 0}
            aria-busy={isSaving}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {changedRoles.includes(actingRole) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          지금 사용 중인 역할({roleLabels[actingRole]})을 편집하고 있습니다. &lsquo;사용자 관리&rsquo;를
          닫으면 이 화면에 다시 들어올 수 없으므로 저장이 거부됩니다.
        </p>
      )}
    </section>
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

/**
 * 메뉴를 고른 경우. 메뉴에는 값이 없으므로(하위의 최대값으로 계산된다) 여기서는
 * 계산 결과를 보여 주고, 하위 전체에 한 번에 적용하는 두 가지 조작만 둔다.
 *
 * '전부 읽기로' 같은 조작을 두지 않는 이유: 하위마다 고를 수 있는 수준이 달라서
 * (조회는 읽기까지, 발행은 관리뿐) 어떤 칸은 뜻대로 되고 어떤 칸은 엉뚱한 값이
 * 된다. 뜻이 분명한 두 가지만 남긴다.
 */
function AreaSummary({
  areaKey,
  areaLevelOf,
  onSelectFeature,
  onApply,
  disabled,
}: {
  areaKey: string;
  areaLevelOf: (areaKey: string, role: Role) => PermissionLevel;
  onSelectFeature: (key: string) => void;
  onApply: (areaKey: string, mode: "close" | "default") => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        메뉴 자체에는 값을 두지 않습니다. 아래 수준은 <strong>하위 기능 중 가장 높은 값</strong>이며,
        메뉴가 열려 있는지(접근 불가가 아닌지)를 결정합니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-1 font-medium">
                역할
              </th>
              <th scope="col" className="py-1 font-medium">
                이 메뉴에서 가능한 최고 수준
              </th>
            </tr>
          </thead>
          <tbody>
            {ROLE_CODES.map((role) => {
              const level = areaLevelOf(areaKey, role);
              return (
                <tr key={role} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1.5 pr-3">{roleLabels[role]}</td>
                  <td className="py-1.5">
                    <span className={level === "NONE" ? "text-zinc-400 dark:text-zinc-500" : ""}>
                      {permissionLevelLabels[level]}
                      {level === "NONE" && " — 메뉴가 보이지 않습니다"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onApply(areaKey, "close")}
          disabled={disabled}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          하위 기능 전부 닫기
        </button>
        <button
          type="button"
          onClick={() => onApply(areaKey, "default")}
          disabled={disabled}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          하위 기능 전부 기본값으로
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">최고관리자 줄은 바뀌지 않습니다.</span>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">하위 기능</p>
        <ul className="flex flex-wrap gap-1">
          {featuresOfArea(areaKey).map((feature) => (
            <li key={feature.key}>
              <button
                type="button"
                onClick={() => onSelectFeature(feature.key)}
                className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {feature.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 잎 하나 × 역할 전부. 이 표가 실제로 저장되는 값을 정한다. */
function LeafTable({
  leafKey,
  draft,
  data,
  actingRole,
  disabled,
  onChange,
}: {
  leafKey: string;
  draft: Draft;
  data: RolePermissionScreenData;
  actingRole: Role;
  disabled: boolean;
  onChange: (leafKey: string, role: Role, level: PermissionLevel) => void;
}) {
  const feature = findPermissionFeature(leafKey);
  const levels = selectableLevelsOfLeaf(leafKey);
  const isFixed = Boolean(feature?.fixed);

  return (
    <div className="flex flex-col gap-3">
      {isFixed && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          이 기능은 설정으로 여닫을 수 없습니다. 여기를 잠글 수 있게 하면, 잘못 저장한 순간 권한을
          되돌릴 사람이 아무도 남지 않습니다.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">
                역할
              </th>
              {levels.map((level) => (
                <th key={level} scope="col" className="px-2 py-1 text-center font-medium">
                  {permissionLevelLabels[level]}
                </th>
              ))}
              <th scope="col" className="py-1 pl-2 text-left font-medium">
                기본 정책
              </th>
            </tr>
          </thead>
          <tbody>
            {ROLE_CODES.map((role) => {
              const editableRole = isRoleEditableInPermissionSettings(role);
              const current = draft[role][leafKey] ?? "NONE";
              const baseline = data.roles[role].baseline[leafKey] ?? "NONE";
              const changed = current !== data.roles[role].effective[leafKey];

              return (
                <tr
                  key={role}
                  className={`border-t border-zinc-200 dark:border-zinc-800 ${
                    changed ? "bg-blue-50/60 dark:bg-blue-950/20" : ""
                  }`}
                >
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {roleLabels[role]}
                    {!editableRole && <span className="ml-1 text-xs text-zinc-400">고정</span>}
                    {role === actingRole && <span className="ml-1 text-xs text-amber-600">현재</span>}
                  </th>

                  {levels.map((level) => {
                    // 기본 정책보다 높은 값은 최고관리자만 저장할 수 있다. 관리자에게는
                    // 아예 만들지 않는다 — 고를 수 있는데 깎이면 됐다고 믿게 된다.
                    const widening = permissionLevelRank(level) > permissionLevelRank(baseline);
                    const blocked = widening && !data.canWiden;
                    return (
                      <td key={level} className="px-2 py-1.5 text-center">
                        <input
                          type="radio"
                          name={`${leafKey}:${role}`}
                          aria-label={`${roleLabels[role]} — ${permissionLevelLabels[level]}`}
                          checked={current === level}
                          disabled={disabled || isFixed || !editableRole || blocked}
                          onChange={() => onChange(leafKey, role, level)}
                          className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-30"
                        />
                        {widening && !blocked && (
                          <span
                            title="기본 정책보다 넓게 주는 값입니다"
                            className="ml-1 align-middle text-[10px] text-amber-600 dark:text-amber-400"
                          >
                            ▲
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td className="py-1.5 pl-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {permissionLevelLabels[baseline]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 수준마다 무엇이 되는지 — 고르는 사람이 짐작하지 않아도 되게 한다. */}
      {!isFixed && levels.some((level) => levelHintOfLeaf(leafKey, level)) && (
        <dl className="flex flex-col gap-1 rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
          {levels
            .filter((level) => level !== "NONE")
            .map((level) => {
              const hint = levelHintOfLeaf(leafKey, level);
              if (!hint) return null;
              return (
                <div key={level} className="flex gap-2">
                  <dt className="w-20 shrink-0 font-medium text-zinc-700 dark:text-zinc-300">
                    {permissionLevelLabels[level]}
                  </dt>
                  <dd className="text-zinc-600 dark:text-zinc-400">{hint}</dd>
                </div>
              );
            })}
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium text-zinc-700 dark:text-zinc-300">접근 불가</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">이 기능을 쓸 수 없습니다.</dd>
          </div>
        </dl>
      )}

      {data.canWiden && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="text-amber-600 dark:text-amber-400">▲</span> 표시는 기본 정책보다 넓게 주는
          값입니다. 지금 코드가 막고 있는 동작이 실제로 열리는지는 기능마다 다릅니다.
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── 순수 도우미

function firstLeafKey(): string {
  const first = PERMISSION_AREAS[0];
  const children = featuresOfArea(first.key);
  return children.length > 0 ? children[0].key : first.key;
}

function initialDraft(data: RolePermissionScreenData): Draft {
  return Object.fromEntries(
    ROLE_CODES.map((role) => [role, { ...data.roles[role].effective }])
  ) as Draft;
}

function changedRolesOf(draft: Draft, data: RolePermissionScreenData): Role[] {
  return ROLE_CODES.filter((role) => {
    if (!isRoleEditableInPermissionSettings(role)) return false;
    const effective = data.roles[role].effective;
    return Object.keys(draft[role]).some((key) => draft[role][key] !== effective[key]);
  });
}
