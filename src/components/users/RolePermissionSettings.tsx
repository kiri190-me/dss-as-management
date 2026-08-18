"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PERMISSION_AREAS,
  isRoleEditableInPermissionSettings,
  permissionLevelDescriptions,
  permissionLevelLabels,
  selectablePermissionLevels,
  type PermissionLevel,
} from "@/lib/auth/permission-areas";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";
import { saveRolePermissionsAction } from "@/lib/server/actions/role-permissions";

export type RolePermissionView = {
  /** 지금 통하는 값(설정이 없으면 상한과 같다). */
  effective: Record<string, PermissionLevel>;
  /** 이 역할이 가질 수 있는 최고 수준 — 드롭다운이 여기서 잘린다. */
  ceiling: Record<string, PermissionLevel>;
};

/**
 * ============================================================================
 * 역할별 접근 권한 설정 화면 (NAS 공유폴더 권한창 방식)
 * ============================================================================
 * 왼쪽에 메뉴 14개가 전부 나열되고, 각 줄마다
 *   - 체크박스: 이 메뉴에 들어갈 수 있는가
 *   - 드롭다운: 들어가서 무엇을 할 수 있는가
 * 를 정한다.
 *
 * ── 체크박스와 드롭다운이 같은 값인 이유 ────────────────────────────────
 * 저장되는 값은 수준 하나뿐이다. 체크 해제 = 접근 불가(NONE), 체크 = 읽기
 * 이상. 둘을 따로 저장하면 "메뉴에 못 들어가는데 쓰기 권한은 있다"가
 * 만들어지고, 그런 상태는 화면에서 설명할 방법이 없다. 체크를 다시 켜면
 * 그 역할의 상한으로 돌아간다 — 껐다 켰더니 권한이 줄어 있는 일이 없도록.
 *
 * ── 상한 위는 아예 만들지 않는다 ────────────────────────────────────────
 * 드롭다운에는 상한까지만 나온다. 고를 수 있는데 저장하면 깎이는 것보다,
 * 애초에 없는 편이 정직하다. 대신 줄마다 상한을 글자로 적어 둔다 — 왜 '관리'가
 * 없는지 묻지 않아도 되도록.
 *
 * ── 저장 전에는 아무것도 바뀌지 않는다 ──────────────────────────────────
 * 역할 탭을 옮기면 편집 중이던 내용은 사라진다. 여러 역할을 동시에 편집해
 * 한꺼번에 저장하는 방식은 "무엇이 저장될지"를 화면에서 읽기 어렵게 만든다.
 * ============================================================================
 */
export default function RolePermissionSettings({
  actingRole,
  initial,
}: {
  actingRole: Role;
  initial: Record<Role, RolePermissionView>;
}) {
  const router = useRouter();
  const editableRoles = ROLE_CODES.filter(isRoleEditableInPermissionSettings);
  const [selectedRole, setSelectedRole] = useState<Role>(editableRoles[0]);
  const [draft, setDraft] = useState<Record<string, PermissionLevel>>(() => ({
    ...initial[editableRoles[0]].effective,
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const view = initial[selectedRole];
  const isReadOnlyRole = !isRoleEditableInPermissionSettings(selectedRole);

  const changedKeys = useMemo(
    () => PERMISSION_AREAS.filter((area) => draft[area.key] !== view.effective[area.key]).map((area) => area.key),
    [draft, view]
  );

  function switchRole(role: Role) {
    setSelectedRole(role);
    setDraft({ ...initial[role].effective });
    setMessage(null);
  }

  function setLevel(areaKey: string, level: PermissionLevel) {
    setDraft((prev) => ({ ...prev, [areaKey]: level }));
  }

  function toggleAccess(areaKey: string, checked: boolean) {
    // 켤 때는 상한으로 되돌린다. 껐다 켠 결과가 '읽기'로 고정되면, 원래 관리
    // 권한이던 역할이 조용히 강등된다.
    setLevel(areaKey, checked ? view.ceiling[areaKey] : "NONE");
  }

  async function save() {
    if (isSaving) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveRolePermissionsAction({ role: selectedRole, levels: draft });
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setMessage({ type: "success", text: result.message });
      // 저장 결과(상한으로 깎였거나 기본으로 되돌아간 값)를 서버에서 다시 받아야
      // 화면이 실제 상태와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">역할별 접근 권한</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          역할마다 어느 메뉴에 들어갈 수 있고 거기서 무엇을 할 수 있는지 정합니다. 이 설정은{" "}
          <strong>권한을 좁히는 데만</strong> 쓰입니다 — 각 역할이 원래 가진 권한보다 넓게 줄 수는 없습니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {ROLE_CODES.map((role) => {
          const isEditable = isRoleEditableInPermissionSettings(role);
          return (
            <button
              key={role}
              type="button"
              onClick={() => switchRole(role)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                selectedRole === role
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {roleLabels[role]}
              {!isEditable && <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">(고정)</span>}
            </button>
          );
        })}
      </div>

      {isReadOnlyRole && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          최고관리자의 권한은 바꿀 수 없습니다. 모든 역할을 잠갔을 때 되돌릴 사람이 반드시 남아 있어야 하기
          때문입니다.
        </p>
      )}

      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            message.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          }
        >
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                메뉴
              </th>
              <th scope="col" className="w-24 px-3 py-2 text-center font-medium">
                접근
              </th>
              <th scope="col" className="w-56 px-3 py-2 font-medium">
                권한
              </th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_AREAS.map((area) => {
              const ceiling = view.ceiling[area.key];
              const level = draft[area.key] ?? "NONE";
              const isBlockedByPolicy = ceiling === "NONE";
              const isChanged = changedKeys.includes(area.key);
              const options = selectablePermissionLevels(ceiling).filter((candidate) => candidate !== "NONE");

              return (
                <tr
                  key={area.key}
                  className={`border-t border-zinc-200 align-top dark:border-zinc-800 ${
                    isChanged ? "bg-blue-50/60 dark:bg-blue-950/20" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">{area.label}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{area.description}</span>
                      {isBlockedByPolicy && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          이 역할에는 원래 없는 메뉴입니다 — 여기서 열 수 없습니다.
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${area.label} 접근 허용`}
                      checked={level !== "NONE"}
                      disabled={isReadOnlyRole || isBlockedByPolicy || isSaving}
                      onChange={(e) => toggleAccess(area.key, e.target.checked)}
                      className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`${area.label} 권한 수준`}
                      value={level === "NONE" ? "" : level}
                      disabled={isReadOnlyRole || isBlockedByPolicy || level === "NONE" || isSaving}
                      onChange={(e) => setLevel(area.key, e.target.value as PermissionLevel)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    >
                      {level === "NONE" && <option value="">접근 불가</option>}
                      {options.map((candidate) => (
                        <option key={candidate} value={candidate}>
                          {permissionLevelLabels[candidate]}
                        </option>
                      ))}
                    </select>
                    {!isBlockedByPolicy && (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        기본 정책 상한: {permissionLevelLabels[ceiling]}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        {(["NONE", "READ", "WRITE", "MANAGE"] as const).map((level) => (
          <div key={level} className="flex gap-2">
            <dt className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">{permissionLevelLabels[level]}</dt>
            <dd className="text-zinc-500 dark:text-zinc-400">{permissionLevelDescriptions[level]}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {changedKeys.length === 0
            ? "변경된 항목이 없습니다."
            : `${changedKeys.length}개 항목이 바뀌었습니다. 저장해야 적용됩니다.`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft({ ...view.effective });
              setMessage(null);
            }}
            disabled={isReadOnlyRole || isSaving || changedKeys.length === 0}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            되돌리기
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isReadOnlyRole || isSaving || changedKeys.length === 0}
            aria-busy={isSaving}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {selectedRole === actingRole && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          지금 사용 중인 역할을 편집하고 있습니다. &lsquo;사용자 관리&rsquo;를 낮추면 이 화면에 다시 들어올 수
          없으므로 저장이 거부됩니다.
        </p>
      )}
    </section>
  );
}
