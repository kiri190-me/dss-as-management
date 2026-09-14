import type { IntakeEngineerOption } from "@/lib/db/queries/repair-case-references";

/**
 * ============================================================================
 * 담당 엔지니어 드롭다운의 선택지 (순수 함수)
 * ============================================================================
 * 후보(referenceData.engineers)는 삭제되지 않고 승인된 A/S 엔지니어만이다
 * (queries/repair-case-references.ts). 그래서 지금 담당자가 삭제되거나 역할 · 승인
 * 상태가 바뀌면 선택값이 후보에 없어 드롭다운이 「미배정」처럼 보인다 — 실제로는 담당이
 * 있는데.
 *
 * 그 사람을 선택지로 하나 더해 빈칸으로 보이지 않게 한다. 🔴 라벨은 사실만 말한다 —
 * 이 칸이 받는 값(id · 표시 이름 · 후보 목록)으로는 「삭제됨」인지 역할이 바뀐 것인지
 * 가릴 수 없으므로 「(선택 목록에 없음)」이라고만 적는다.
 * ============================================================================
 */

export const OFF_LIST_ENGINEER_PREFIX = "(선택 목록에 없음)";

export type EngineerSelectOption = {
  id: string;
  label: string;
  /** 후보 목록 밖의 지금 담당자인가. */
  isOffList: boolean;
};

export function buildEngineerSelectOptions(
  engineers: readonly IntakeEngineerOption[],
  assignedEngineerId: string | null,
  engineerName: string | null
): EngineerSelectOption[] {
  const options = engineers.map((engineer) => ({ id: engineer.id, label: engineer.name, isOffList: false }));
  if (!assignedEngineerId) return options;
  const assignedKey = assignedEngineerId.toLowerCase();
  if (engineers.some((engineer) => engineer.id.toLowerCase() === assignedKey)) return options;
  return [
    {
      id: assignedEngineerId,
      label: `${OFF_LIST_ENGINEER_PREFIX} ${engineerName ?? "이름을 알 수 없음"}`,
      isOffList: true,
    },
    ...options,
  ];
}
