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
 *
 * ── 통전작업 공수시간만은 비울 수 있다 ──────────────────────────────────
 * 기본 작업비 안에 이미 들어 있는 몫이라 언젠가 값이 필요하지만, T/C 는 아직
 * 모른다. 빈 칸은 `null`("정하지 않음")이고 `0` 이 아니다 — 모르는 것을 0 으로
 * 접지 않는다(schema/repair-labor.ts 의 그 항목).
 *
 * ── 통전 작업 목록에는 공수시간이 없다 ──────────────────────────────────
 * 건명만 본다. 시간을 요구하지 않는 것이 실수가 아니라 규칙이다 — 통전작업의
 * 금액은 `powerTestHours` 하나가 정하고, 목록은 그 안에서 무슨 일을 하는지 적는
 * 글이다(schema/repair-labor.ts 의 power_test_tasks 머리말). **빈 목록도 정상이다.**
 * ============================================================================
 */

const MAX_TASK_NAME = 200;
/** 공수시간 상한. 하루 8시간으로 쳐도 100일이 넘는 작업은 오타로 본다. */
const MAX_HOURS = 999;
/**
 * 통전 작업 목록의 줄 수 상한.
 *
 * 수리 작업 목록에는 상한이 없다 — 그쪽은 줄마다 공수시간이 있어 터무니없는
 * 목록이면 금액에서 곧바로 드러난다. 통전 목록은 **금액에 영향을 주지 않는 글**
 * 이라 그런 제동이 없고, 붙여넣기 사고 한 번이면 수천 줄이 조용히 들어간다.
 *
 * 100 인 이유: 가장 큰 수리 작업 목록이 제너레이터 20건이다(schema/repair-labor.ts).
 * 통전 점검 항목이 그 다섯 배를 넘는 일은 없고, 넘는다면 사람이 손으로 적은 것이
 * 아니라 무언가 잘못 들어온 것이다. 진짜로 모자라면 늘리면 되고, 그 방향의
 * 변경은 이미 저장된 자료를 잃지 않는다.
 */
const MAX_POWER_TEST_TASKS = 100;

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

/**
 * 통전 작업 한 줄. **`hours` 가 없다.**
 *
 * 통전작업의 금액은 `powerTestHours` 하나가 정하고 이 목록은 그 안에서 무슨 일을
 * 하는지 적는 글이다(schema/repair-labor.ts 의 power_test_tasks 머리말). 여기에
 * 시간을 두면 "줄들의 합"과 "powerTestHours" 라는 두 숫자가 같은 금액을 주장한다.
 */
export type PowerTestTaskInput = {
  /** 이미 있는 줄이면 그 id, 새 줄이면 null. */
  id: string | null;
  taskName: string;
};

export type RepairLaborFields = {
  equipmentKind: WorkflowKind;
  hourlyRate: string;
  /** null 은 "정하지 않음" — 합계에 더하지 않는다. */
  baseCost: string | null;
  /**
   * 통전작업 공수시간. null 은 "정하지 않음"이고 `0` 이 아니다 — T/C 는 아직
   * 모른다(schema/repair-labor.ts 의 그 항목).
   */
  powerTestHours: number | null;
  tasks: RepairTaskInput[];
  /**
   * 통전 작업 건명 목록. **비어 있는 것은 정상이다** — T/C 는 아직 하나도 없다.
   * 오류가 아니라 그냥 빈 목록이고, `powerTestHours` 의 null("정하지 않음")과는
   * 다른 이야기다.
   */
  powerTestTasks: PowerTestTaskInput[];
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

  // 통전작업 공수시간도 **비울 수 있다.** 빈 칸이 "아직 정하지 않았다"이고, T/C 는
  // 실제로 아직 모른다. 0 을 받아 주면 "통전작업이 0시간인 장비"와 갈라지지 않아
  // 모르는 것이 조용히 0 으로 접힌다(기본 작업비와 같은 판단).
  //
  // 값이 있으면 작업 목록의 공수시간과 **같은 잣대**로 본다 — 두 곳이 갈리면
  // 한쪽에서 막히는 값이 다른 쪽으로 들어와 DB CHECK 에서야 걸린다.
  let powerTestHours: number | null = null;
  const rawPowerTestHours =
    typeof raw.powerTestHours === "string" ? raw.powerTestHours.trim() : raw.powerTestHours;
  if (
    rawPowerTestHours !== null &&
    rawPowerTestHours !== undefined &&
    rawPowerTestHours !== ""
  ) {
    // 숫자와 숫자 글자만 본다. `Number(true)` 가 1 로 통과하는 길을 막는다.
    const value =
      typeof rawPowerTestHours === "number"
        ? rawPowerTestHours
        : typeof rawPowerTestHours === "string"
          ? Number(rawPowerTestHours)
          : Number.NaN;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_HOURS) {
      fieldErrors.powerTestHours = `통전작업 공수시간은 1 이상 ${MAX_HOURS} 이하의 정수여야 합니다.`;
    } else {
      powerTestHours = value;
    }
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

  // ── 통전 작업 목록 ──────────────────────────────────────────────────────
  // 건명만 본다. 🔴 공수시간을 요구하지 않는다 — 이 목록에는 시간이 없다.
  const powerTestTaskList: PowerTestTaskInput[] = [];
  const rawPowerTestTasks = raw.powerTestTasks;
  if (rawPowerTestTasks === null || rawPowerTestTasks === undefined) {
    // 칸 자체가 안 온 경우는 **빈 목록**으로 본다(powerTestHours 가 안 왔을 때
    // null 로 두는 것과 같은 판단). 목록을 지우는 것과 구별되지 않지만, 이 화면은
    // 어느 탭에서 눌러도 한 벌 전부를 보내므로 실제로 갈릴 일이 없다.
  } else if (!Array.isArray(rawPowerTestTasks)) {
    fieldErrors.powerTestTasks = "통전 작업 목록을 확인할 수 없습니다.";
  } else if (rawPowerTestTasks.length > MAX_POWER_TEST_TASKS) {
    // 사람이 손으로 적을 수 있는 양을 한참 넘었다(MAX_POWER_TEST_TASKS 주석).
    fieldErrors.powerTestTasks = `통전 작업은 ${MAX_POWER_TEST_TASKS}건을 넘을 수 없습니다.`;
  } else {
    const seenPowerTestNames = new Set<string>();
    rawPowerTestTasks.forEach((entry, index) => {
      const at = (field: string) => `powerTestTasks.${index}.${field}`;
      const line = index + 1;
      if (typeof entry !== "object" || entry === null) {
        fieldErrors[`powerTestTasks.${index}`] = `${line}번째 줄을 확인할 수 없습니다.`;
        return;
      }
      const row = entry as Record<string, unknown>;

      const taskName = typeof row.taskName === "string" ? row.taskName.trim() : "";
      if (taskName === "") {
        fieldErrors[at("taskName")] = `${line}번째 통전 작업의 건명을 입력해 주세요.`;
      } else if (taskName.length > MAX_TASK_NAME) {
        fieldErrors[at("taskName")] =
          `${line}번째 통전 작업의 건명은 ${MAX_TASK_NAME}자를 넘을 수 없습니다.`;
      } else if (seenPowerTestNames.has(taskName)) {
        // 표의 부분 unique 색인과 짝을 맞춘다 — 여기서 안 막으면 DB 오류로
        // 터지고, 사람은 어느 줄이 문제인지 못 듣는다.
        fieldErrors[at("taskName")] = `${line}번째 통전 작업의 건명이 위와 겹칩니다.`;
      } else {
        seenPowerTestNames.add(taskName);
      }

      let id: string | null = null;
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
          fieldErrors[at("id")] = `${line}번째 통전 작업을 확인할 수 없습니다.`;
        } else id = row.id;
      }

      powerTestTaskList.push({ id, taskName });
    });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    data: {
      equipmentKind,
      hourlyRate,
      baseCost,
      powerTestHours,
      tasks,
      powerTestTasks: powerTestTaskList,
    },
  };
}
