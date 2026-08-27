"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  isRoleEditableInNotificationSettings,
  type NotificationSettingsScreenData,
} from "@/lib/domain/notification-settings";
import type { NotificationKind } from "@/lib/domain/notifications";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";
import { saveNotificationSettingsAction } from "@/lib/server/actions/notification-settings";

type Draft = Record<string, { enabled: boolean; roles: Record<Role, boolean> }>;

/**
 * ============================================================================
 * 알림 설정 화면
 * ============================================================================
 * 줄이 알림 종류, 칸이 역할이다. 왼쪽 `사용` 스위치가 종류 자체를 켜고 끄고,
 * 오른쪽 다섯 칸이 어느 역할이 받는지를 정한다.
 *
 * ── 종류를 화면에서 만들거나 지울 수 없다 ───────────────────────────────
 * 종류는 코드가 정한다(domain/notifications.ts의 NOTIFICATION_KINDS). 화면에서
 * 만들게 하면 "그 알림을 무엇으로부터 계산하나"를 정할 방법이 없다 — 이 앱의
 * 알림은 저장된 행이 아니라 업무 데이터에서 매 요청마다 다시 계산되는 것이라
 * (queries/notifications.ts), 계산 규칙 없는 종류는 이름만 있고 아무것도
 * 세지 않는 껍데기가 된다. 그래서 여기서 할 수 있는 일은 이미 있는 종류를
 * **켜고 끄고, 누가 받는지 정하는 것**뿐이다. 지우기 대신 끄기를 두는 이유도
 * 같다 — 끈 종류는 역할 설정을 그대로 안고 기다리다가 켜는 순간 돌아온다.
 *
 * ── `사용`과 `모든 역할 해제`는 다르다 ──────────────────────────────────
 * 다섯 칸을 전부 지워도 `사용`을 끈 것과 같아지지 않는다. 전자는 "이 역할들은
 * 원래 대상이 아니다"이고 후자는 "이 알림을 당분간 아무에게도 보내지 않는다"
 * 이며, 무엇보다 전자는 되돌릴 때 원래 누가 받았는지가 남지 않는다. 표를 둘로
 * 나눠 둔 근거가 schema/notification-settings.ts에 적혀 있다.
 *
 * ── 최고관리자 칸은 잠겨 있다 ───────────────────────────────────────────
 * 서버가 다시 막지만(mutations/notification-settings.ts), 할 수 없는 일을 누를
 * 수 있게 두지 않는다 — 역할별 접근 권한 설정이 최고관리자 줄을 잠가 두는
 * 것과 같은 모양이다.
 * ============================================================================
 */
export default function NotificationSettings({ data }: { data: NotificationSettingsScreenData }) {
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>(() => initialDraft(data));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const changedKinds = useMemo(() => changedKindsOf(draft, data), [draft, data]);
  const changedCount = useMemo(() => changedCellCount(draft, data), [draft, data]);

  function setKindEnabled(kind: NotificationKind, enabled: boolean) {
    setDraft((prev) => ({ ...prev, [kind]: { ...prev[kind], enabled } }));
    setMessage(null);
  }

  function setRoleReceives(kind: NotificationKind, role: Role, receives: boolean) {
    setDraft((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], roles: { ...prev[kind].roles, [role]: receives } },
    }));
    setMessage(null);
  }

  /** 저장하지 않은 편집을 버린다. */
  function reset() {
    setDraft(initialDraft(data));
    setMessage(null);
  }

  /**
   * 코드의 기본값으로 되돌린다. 되돌리기(위)와 다르다 — 이쪽은 지금 저장돼
   * 있는 설정까지 지우겠다는 뜻이고, 저장을 눌러야 실제로 지워진다.
   */
  function restoreDefaults() {
    setDraft(
      Object.fromEntries(
        data.kinds.map((row) => [
          row.kind,
          {
            enabled: row.defaultEnabled,
            roles: Object.fromEntries(
              ROLE_CODES.map((role) => [role, row.roles[role].defaultReceives])
            ) as Record<Role, boolean>,
          },
        ])
      )
    );
    setMessage(null);
  }

  async function save() {
    if (isSaving || changedKinds.length === 0) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveNotificationSettingsAction({
        changes: changedKinds.map((kind) => ({
          kind,
          enabled: draft[kind].enabled,
          roles: draft[kind].roles,
        })),
      });
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setMessage({ type: "success", text: result.message });
      // 저장 결과(기본값과 같아져 행이 지워진 칸 등)를 서버에서 다시 받아야
      // 화면이 실제 상태와 같아진다.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">알림 설정</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          알림 종류마다 <strong>사용 여부</strong>와 <strong>어느 역할이 받을지</strong>를 정합니다. 종류
          자체는 시스템이 정하며 여기서 만들거나 지울 수 없습니다 — 잠시 멈추려면{" "}
          <strong>사용</strong>을 끄면 되고, 그동안에도 역할 설정은 그대로 남아 있다가 다시 켜는 순간
          돌아옵니다.
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

      <div className="overflow-x-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-1 pr-3 text-left font-medium">
                알림 종류
              </th>
              <th scope="col" className="px-2 py-1 text-center font-medium">
                사용
              </th>
              {ROLE_CODES.map((role) => (
                <th key={role} scope="col" className="px-2 py-1 text-center font-medium">
                  {roleLabels[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.kinds.map((row) => {
              const current = draft[row.kind];
              const kindChanged = current.enabled !== row.enabled;
              return (
                <tr
                  key={row.kind}
                  className={`border-t border-zinc-200 align-top dark:border-zinc-800 ${
                    isKindRowChanged(draft, row) ? "bg-blue-50/60 dark:bg-blue-950/20" : ""
                  }`}
                >
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.label}</span>
                    <span className="mt-0.5 block max-w-md text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      {row.description}
                    </span>
                  </th>

                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${row.label} 사용`}
                      checked={current.enabled}
                      disabled={isSaving}
                      onChange={(event) => setKindEnabled(row.kind, event.target.checked)}
                      className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-30"
                    />
                    <DefaultMarker on={current.enabled} isDefault={current.enabled === row.defaultEnabled} />
                    {kindChanged && !current.enabled && (
                      <span className="mt-0.5 block text-[10px] text-amber-700 dark:text-amber-400">
                        아무에게도 안 감
                      </span>
                    )}
                  </td>

                  {ROLE_CODES.map((role) => {
                    const editable = isRoleEditableInNotificationSettings(role);
                    const cell = row.roles[role];
                    const checked = current.roles[role];
                    return (
                      <td key={role} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${row.label} — ${roleLabels[role]}`}
                          checked={checked}
                          // 종류를 끄면 역할 칸은 손대지 못하게 한다. 끈 상태에서
                          // 역할을 고르면 무언가 달라졌다고 믿게 되지만 실제로는
                          // 아무 알림도 가지 않는다. 값 자체는 그대로 남아 있어
                          // 다시 켜면 편집할 수 있다.
                          disabled={isSaving || !editable || !current.enabled}
                          onChange={(event) => setRoleReceives(row.kind, role, event.target.checked)}
                          className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-30"
                        />
                        {!editable ? (
                          <span
                            title="최고관리자가 받는 알림은 끌 수 없습니다"
                            className="mt-0.5 block text-[10px] text-zinc-400 dark:text-zinc-500"
                          >
                            고정
                          </span>
                        ) : (
                          <DefaultMarker on={checked} isDefault={checked === cell.defaultReceives} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <span className="text-amber-600 dark:text-amber-400">▲</span> 기본값보다 넓게 준 칸,{" "}
        <span className="text-amber-600 dark:text-amber-400">▼</span> 기본값에서 뺀 칸입니다. 표시가 없으면
        기본값 그대로이며, 그런 칸은 저장해도 행이 남지 않습니다 — 나중에 기본 규칙이 바뀌면 그 칸은
        새 규칙을 따라갑니다.
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        역할 설정은 <strong>윗단 필터</strong>입니다. 켜 두어도 그 사람이 실제 대상일 때만 알림이 갑니다 —
        결재 대기는 그 건의 결재자(대표 자격·위임)에게만 갑니다.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {changedCount === 0
            ? "변경된 항목이 없습니다."
            : `${changedCount}개 항목(알림 ${changedKinds.length}종)이 바뀌었습니다. 저장해야 적용됩니다.`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={restoreDefaults}
            disabled={isSaving}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            전부 기본값으로
          </button>
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
    </section>
  );
}

/**
 * 기본값에서 벗어난 칸 표시. 역할별 접근 권한 설정이 기본 정책보다 넓은 값에
 * ▲를 붙이는 것과 같은 장치이고, 여기서는 켠 쪽과 끈 쪽이 둘 다 있으므로
 * 방향까지 알려 준다.
 */
function DefaultMarker({ on, isDefault }: { on: boolean; isDefault: boolean }) {
  if (isDefault) return null;
  return (
    <span
      title={on ? "기본값에는 없던 대상입니다" : "기본값에서 뺀 대상입니다"}
      className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400"
    >
      {on ? "▲" : "▼"}
    </span>
  );
}

// ───────────────────────────────────────────────────────────── 순수 도우미

function initialDraft(data: NotificationSettingsScreenData): Draft {
  return Object.fromEntries(
    data.kinds.map((row) => [
      row.kind,
      {
        enabled: row.enabled,
        roles: Object.fromEntries(ROLE_CODES.map((role) => [role, row.roles[role].receives])) as Record<
          Role,
          boolean
        >,
      },
    ])
  );
}

function isKindRowChanged(draft: Draft, row: NotificationSettingsScreenData["kinds"][number]): boolean {
  const current = draft[row.kind];
  if (current.enabled !== row.enabled) return true;
  return ROLE_CODES.some((role) => current.roles[role] !== row.roles[role].receives);
}

function changedKindsOf(draft: Draft, data: NotificationSettingsScreenData): NotificationKind[] {
  return data.kinds.filter((row) => isKindRowChanged(draft, row)).map((row) => row.kind);
}

function changedCellCount(draft: Draft, data: NotificationSettingsScreenData): number {
  return data.kinds.reduce((sum, row) => {
    const current = draft[row.kind];
    const kindDelta = current.enabled === row.enabled ? 0 : 1;
    const roleDelta = ROLE_CODES.filter((role) => current.roles[role] !== row.roles[role].receives).length;
    return sum + kindDelta + roleDelta;
  }, 0);
}
