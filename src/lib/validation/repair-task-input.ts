import { WORKFLOW_KIND_CODES, type WorkflowKind } from "@/lib/domain/workflow-kind";
import { parseAmountValue } from "./part-unit-price-input";

/**
 * ============================================================================
 * 수리 작업 비용 입력 검증 — 형식만 본다
 * ============================================================================
 * DB 도 세션도 여기서 만지지 않는다. 순수 함수만 두어야 단위 시험이 붙는다.
 *
 * ── 금액 규칙은 여기서 다시 쓰지 않는다 ─────────────────────────────────
 * 시간당 단가와 기본 작업비는 part-unit-price-input.ts 의 `parseAmountValue` 를
 * 그대로 쓴다. 쉼표·자릿수·지수 표기 규칙이 갈라지면 한쪽만 고쳐지는 날 견적서
 * 금액이 조용히 어긋난다.
 *
 * ── 공수시간은 정수다 ───────────────────────────────────────────────────
 * 받은 목록 36건이 전부 정수다(schema/repair-labor.ts). 0 과 음수는 막는다 —
 * 0시간짜리 작업은 목록에 있을 이유가 없고, 그런 줄이 섞이면 견적서에서 고를 수
 * 있는데 값은 0이라 사람이 "왜 안 올라가지"를 묻게 된다.
 * ============================================================================
 */

const MAX_TASK_NAME = 200;
/** 공수시간 상한. 하루 8시간으로 쳐도 100일이 넘는 작업은 오타로 본다. */
const MAX_HOURS = 999;

export function isWorkflowKind(value: unknown): value is WorkflowKind {
  return typeof value === "string" && (WORKFLOW_KIND_CODES as readonly string[]).includes(value);
}

export type RepairTaskInput = {
  /** 이미 있는 줄이면 그 id, 새 줄이면 null. */
  id: string | null;
  taskName: string;
  hours: number;
  /** 오버홀 작업인가. 견적서 종류가 O/H 면 자동으로 체크되는 줄이다. */
  isOverhaul: boolean;
};

export type RepairLaborFields = {
  equipmentKind: WorkflowKind;
  hourlyRate: string;
  /** null 은 "정하지 않음" — 합계에 더하지 않는다. */
  baseCost: string | null;
  tasks: RepairTaskInput[];
};

export type ValidateRepairLaborResult =
  | { ok: true; data: RepairLaborFields }
  | { ok: false; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRepairLaborFields(raw: Record<string, unknown>): ValidateRepairLaborResult {
  const fieldErrors: Record<string, string> = {};

  const equipmentKind = raw.equipmentKind;
  if (!isWorkflowKind(equipmentKind)) {
    return { ok: false, fieldErrors: { equipmentKind: "장비 종류를 확인할 수 없습니다." } };
  }

  // 시간당 단가는 **비울 수 없다.** 없으면 고른 작업이 전부 0원이 되어, 계산이
  // 된 것처럼 보이는데 값만 0인 상태가 된다. 기본 작업비와 다른 점이다.
  let hourlyRate = "";
  const parsedRate = parseAmountValue(raw.hourlyRate);
  if (!parsedRate.ok) {
    fieldErrors.hourlyRate = "시간당 작업비는 0 이상의 금액(소수점 두 자리까지)이어야 합니다.";
  } else if (parsedRate.value === null) {
    fieldErrors.hourlyRate = "시간당 작업비를 입력해 주세요.";
  } else {
    hourlyRate = parsedRate.value;
  }

  // 기본 작업비는 **비울 수 있다.** 빈 칸이 "아직 정하지 않았다"이고, 그 상태를
  // 표현할 방법이 없으면 매쳐처럼 값이 안 정해진 장비를 담을 수 없다.
  let baseCost: string | null = null;
  const parsedBase = parseAmountValue(raw.baseCost);
  if (!parsedBase.ok) {
    fieldErrors.baseCost = "기본 작업비는 0 이상의 금액(소수점 두 자리까지)이어야 합니다.";
  } else {
    baseCost = parsedBase.value;
  }

  const tasks: RepairTaskInput[] = [];
  const rawTasks = raw.tasks;
  if (!Array.isArray(rawTasks)) {
    fieldErrors.tasks = "작업 목록을 확인할 수 없습니다.";
  } else {
    const seenNames = new Set<string>();
    rawTasks.forEach((entry, index) => {
      const at = (field: string) => `tasks.${index}.${field}`;
      const line = index + 1;
      if (typeof entry !== "object" || entry === null) {
        fieldErrors[`tasks.${index}`] = `${line}번째 줄을 확인할 수 없습니다.`;
        return;
      }
      const row = entry as Record<string, unknown>;

      const taskName = typeof row.taskName === "string" ? row.taskName.trim() : "";
      if (taskName === "") {
        fieldErrors[at("taskName")] = `${line}번째 작업의 건명을 입력해 주세요.`;
      } else if (taskName.length > MAX_TASK_NAME) {
        fieldErrors[at("taskName")] = `${line}번째 작업의 건명은 ${MAX_TASK_NAME}자를 넘을 수 없습니다.`;
      } else if (seenNames.has(taskName)) {
        // 같은 건명이 둘이면 견적서에서 어느 쪽을 고른 것인지 답할 수 없다.
        fieldErrors[at("taskName")] = `${line}번째 작업의 건명이 위와 겹칩니다.`;
      } else {
        seenNames.add(taskName);
      }

      const hours = typeof row.hours === "number" ? row.hours : Number(row.hours);
      if (!Number.isInteger(hours) || hours <= 0 || hours > MAX_HOURS) {
        fieldErrors[at("hours")] = `${line}번째 작업의 공수시간은 1 이상 ${MAX_HOURS} 이하의 정수여야 합니다.`;
      }

      let id: string | null = null;
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
          fieldErrors[at("id")] = `${line}번째 작업을 확인할 수 없습니다.`;
        } else id = row.id;
      }

      // 사람이 화면에서 표시한다. 이름으로 맞히지 않는다(schema/repair-labor.ts).
      tasks.push({ id, taskName, hours, isOverhaul: row.isOverhaul === true });
    });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { equipmentKind, hourlyRate, baseCost, tasks } };
}
