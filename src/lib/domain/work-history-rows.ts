import { mockUsers, mockWorkHistories } from "./mock-data";
import type { WorkHistory } from "./types";

export type WorkHistoryRow = WorkHistory & { engineerName: string };

export function buildWorkHistoryRows(repairCaseId: string): WorkHistoryRow[] {
  return mockWorkHistories
    .filter((entry) => entry.repairCaseId === repairCaseId)
    .map((entry) => {
      const engineer = mockUsers.find((u) => u.id === entry.engineerId);
      return { ...entry, engineerName: engineer?.name ?? "미배정" };
    });
}
