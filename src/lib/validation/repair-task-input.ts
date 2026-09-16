import { WORKFLOW_KIND_CODES, type WorkflowKind } from "@/lib/domain/workflow-kind";
import { parseAmountValue } from "./part-unit-price-input";

/**
 * ============================================================================
 * 수리 작업 비용 입력 검증 — 형식만 본다
 * ============================================================================
 * DB 도 세션도 여기서 만지지 않는다. 순수 함수만 두어야 단위 시험이 붙는다.
 *
 * ── 금액 규칙은 여기서 다시 쓰지 않는다 ─────────────────────────────────
 * 시간당 단가는 part-unit-price-input.ts 의 `parseAmountValue` 를 그대로 쓴다.
 * 쉼표·자릿수·지수 표기 규칙이 갈라지면 한쪽만 고쳐지는 날 견적서 금액이 조용히
 * 어긋난다.
 *
 * ── 🔴 기본 작업비(base_cost)는 더 이상 이 검증을 지나지 않는다 ──────────
 * 2026-09-16 부터 기본 작업비는 사람이 적는 값이 아니라 **세 공수시간의 합 × 시간당
 * 단가**다(domain/quote-labor-cost.ts). 그래서 화면이 그 값을 보내지 않고, 이 함수도
 * 받지 않는다. 🔴 **칸과 값은 DB 에 그대로 남는다** — 저장이 그 칸을 건드리지 않을
 * 뿐이다(schema/repair-labor.ts 의 base_cost 주석, mutations/repair-labor.ts 의 upsert).
 *
 * ── 공수시간은 정수다 ───────────────────────────────────────────────────
 * 받은 목록 36건이 전부 정수다(schema/repair-labor.ts). 작업 목록의 0 과 음수는
 * 막는다 — 0시간짜리 작업은 목록에 있을 이유가 없고, 그런 줄이 섞이면 견적서에서
 * 고를 수 있는데 값은 0이라 사람이 "왜 안 올라가지"를 묻게 된다.
 *
 * ── 세 갈래의 공수시간은 비울 수 있다 ───────────────────────────────────
 * 기본 작업비 안에 이미 들어 있는 몫이라 언젠가 값이 필요하지만, 아직 모르는 장비가
 * 있다(서류는 세 장비 모두, 통전은 T/C). 빈 칸은 `null`("정하지 않음")이고 `0` 이
 * 아니다 — 모르는 것을 0 으로 접지 않는다(schema/repair-labor.ts 의 그 항목들).
 *
 * 🔴 **셋 중 서류만 `0` 을 받는다.** 조사·통전은 `> 0`, 서류는 `>= 0` 이다 —
 * 「서류작업이 없는 장비」는 정하지 않은 것이 아니라 사람이 확인해서 내린 답이다.
 * 이 잣대는 DB CHECK 와 **글자 그대로 짝**이어야 한다(schema/repair-labor.ts) —
 * 여기서 통과한 값이 DB 에서 터지면 사람은 "일시적으로 처리할 수 없습니다"를 듣는다.
 *
 * ── 작업 건명 목록은 갈래마다 하나씩, 셋이다 ────────────────────────────
 * 조사 · 통전 · 서류가 **같은 모양**의 목록을 갖는다(건명만, 공수시간 없음). 시간을
 * 요구하지 않는 것이 실수가 아니라 규칙이다 — 갈래의 금액은 그 갈래 공수시간 하나가
 * 정하고, 목록은 그 안에서 무슨 일을 하는지 적는 글이다(schema/repair-labor.ts 의
 * power_test_tasks 머리말). **빈 목록도 정상이다.**
 *
 * 🔴 결과는 `Record<RepairLaborScope, …>` 다. 갈래 하나를 빠뜨린 저장은 그 목록을
 * 통째로 지우므로, **셋이 다 실렸다는 것이 타입에서 보장돼야 한다.**
 * ============================================================================
 */

const MAX_TASK_NAME = 200;
/** 공수시간 상한. 하루 8시간으로 쳐도 100일이 넘는 작업은 오타로 본다. */
const MAX_HOURS = 999;
/**
 * 한 갈래 작업 목록의 줄 수 상한.
 *
 * 수리 작업 목록에는 상한이 없다 — 그쪽은 줄마다 공수시간이 있어 터무니없는
 * 목록이면 금액에서 곧바로 드러난다. 갈래 목록은 **금액에 영향을 주지 않는 글**
 * 이라 그런 제동이 없고, 붙여넣기 사고 한 번이면 수천 줄이 조용히 들어간다.
 *
 * 100 인 이유: 가장 큰 수리 작업 목록이 제너레이터 20건이다(schema/repair-labor.ts).
 * 점검 항목이 그 다섯 배를 넘는 일은 없고, 넘는다면 사람이 손으로 적은 것이
 * 아니라 무언가 잘못 들어온 것이다. 진짜로 모자라면 늘리면 되고, 그 방향의
 * 변경은 이미 저장된 자료를 잃지 않는다.
 */
const MAX_SCOPE_TASKS = 100;

/**
 * 작업 건명 목록의 갈래 — 조사 · 통전 · 서류.
 *
 * 🔴 **schema/repair-labor.ts 의 `repair_labor_scope` enum 과 같은 값이어야 한다.**
 * 여기 따로 적어 두는 것은 화면(클라이언트 컴포넌트)이 이 값을 써야 하기 때문이다 —
 * 스키마 파일을 가져오면 drizzle 이 통째로 브라우저 묶음에 실린다. 어긋나면 뮤테이션의
 * `scope:` 대입에서 타입이 먼저 막는다.
 *
 * 차례가 화면의 탭 차례이고, 기본 작업비를 세는 차례이기도 하다(조사 → 통전 → 서류).
 */
export const REPAIR_LABOR_SCOPES = ["INVESTIGATION", "POWER_TEST", "DOCUMENT"] as const;
export type RepairLaborScope = (typeof REPAIR_LABOR_SCOPES)[number];

/** 사람에게 보이는 갈래 이름. 오류 문구와 탭 이름이 이 한 곳에서 나온다. */
export const repairLaborScopeLabels: Record<RepairLaborScope, string> = {
  INVESTIGATION: "조사",
  POWER_TEST: "통전",
  DOCUMENT: "서류",
};

/**
 * 갈래마다의 공수시간 하한.
 *
 * 🔴 **서류만 0 이다** — schema/repair-labor.ts 의 세 CHECK 와 글자 그대로 짝이다
 * (`investigation_hours > 0` · `power_test_hours > 0` · `document_hours >= 0`).
 */
export const REPAIR_LABOR_HOURS_MIN: Record<RepairLaborScope, number> = {
  INVESTIGATION: 1,
  POWER_TEST: 1,
  DOCUMENT: 0,
};

/** 갈래별 공수시간이 실려 오는 칸 이름. 오류 열쇠도 같은 이름이다. */
export const REPAIR_LABOR_HOURS_FIELDS: Record<RepairLaborScope, string> = {
  INVESTIGATION: "investigationHours",
  POWER_TEST: "powerTestHours",
  DOCUMENT: "documentHours",
};

/** 갈래별 작업 목록이 실려 오는 칸 이름. 오류 열쇠도 같은 이름이다. */
export const REPAIR_LABOR_TASKS_FIELDS: Record<RepairLaborScope, string> = {
  INVESTIGATION: "investigationTasks",
  POWER_TEST: "powerTestTasks",
  DOCUMENT: "documentTasks",
};

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
 * 조사 · 통전 · 서류 목록의 한 줄. **`hours` 가 없다.**
 *
 * 갈래의 금액은 그 갈래 공수시간 하나가 정하고 이 목록은 그 안에서 무슨 일을
 * 하는지 적는 글이다(schema/repair-labor.ts 의 power_test_tasks 머리말). 여기에
 * 시간을 두면 "줄들의 합"과 "그 갈래의 공수시간"이라는 두 숫자가 같은 금액을 주장한다.
 */
export type LaborScopeTaskInput = {
  /** 이미 있는 줄이면 그 id, 새 줄이면 null. */
  id: string | null;
  taskName: string;
};

export type RepairLaborFields = {
  equipmentKind: WorkflowKind;
  hourlyRate: string;
  /**
   * 조사작업 공수시간. null 은 "정하지 않음"이고 `0` 이 아니다.
   * 🔴 기본 작업비 칸(base_cost)은 이 한 벌에 **없다** — 이 파일 머리말의 그 항목.
   */
  investigationHours: number | null;
  /**
   * 통전작업 공수시간. null 은 "정하지 않음"이고 `0` 이 아니다 — T/C 는 아직
   * 모른다(schema/repair-labor.ts 의 그 항목).
   */
  powerTestHours: number | null;
  /**
   * 서류작업 공수시간. null 은 "정하지 않음"이고 **`0` 은 「서류작업이 없는 장비」라는
   * 실제 값**이다(셋 중 여기만 0 을 받는다).
   */
  documentHours: number | null;
  tasks: RepairTaskInput[];
  /**
   * 갈래별 작업 건명 목록. **세 갈래가 언제나 다 들어 있다** — 하나를 빠뜨리면 저장이
   * 그 목록을 통째로 소프트 삭제하므로, Record 로 두어 타입이 먼저 막게 한다.
   * 비어 있는 갈래는 **빈 배열**이고, 그건 오류가 아니라 그냥 빈 목록이다.
   */
  scopeTasks: Record<RepairLaborScope, LaborScopeTaskInput[]>;
};

export type ValidateRepairLaborResult =
  | { ok: true; data: RepairLaborFields }
  | { ok: false; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 갈래 하나의 공수시간을 읽는다. **화면과 서버가 같은 이 함수를 쓴다.**
 *
 * 🔴 두 곳이 갈리면 화면에서 통과한 값이 서버에서, 심하면 **DB CHECK 에서** 터진다 —
 * 사람은 "일시적으로 처리할 수 없습니다"를 듣고 되지 않는 일을 다시 누른다.
 *
 * 빈 칸(`""` · 공백 · null · undefined)은 **`null`("정하지 않음")** 이고 `0` 이 아니다.
 */
export function parseRepairLaborHours(
  scope: RepairLaborScope,
  raw: unknown
): { ok: true; value: number | null } | { ok: false; message: string } {
  const min = REPAIR_LABOR_HOURS_MIN[scope];
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  if (trimmed === null || trimmed === undefined || trimmed === "") return { ok: true, value: null };

  // 숫자와 숫자 글자만 본다. `Number(true)` 가 1 로 통과하는 길을 막는다.
  const value =
    typeof trimmed === "number"
      ? trimmed
      : typeof trimmed === "string"
        ? Number(trimmed)
        : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > MAX_HOURS) {
    return {
      ok: false,
      message: `${repairLaborScopeLabels[scope]}작업 공수시간은 ${min} 이상 ${MAX_HOURS} 이하의 정수여야 합니다.`,
    };
  }
  return { ok: true, value };
}

export function validateRepairLaborFields(raw: Record<string, unknown>): ValidateRepairLaborResult {
  const fieldErrors: Record<string, string> = {};

  const equipmentKind = raw.equipmentKind;
  if (!isWorkflowKind(equipmentKind)) {
    return { ok: false, fieldErrors: { equipmentKind: "장비 종류를 확인할 수 없습니다." } };
  }

  // 시간당 단가는 **비울 수 없다.** 없으면 고른 작업이 전부 0원이 되고 세 몫도 셀 수
  // 없어, 계산이 된 것처럼 보이는데 값만 0인 상태가 된다.
  let hourlyRate = "";
  const parsedRate = parseAmountValue(raw.hourlyRate);
  if (!parsedRate.ok) {
    fieldErrors.hourlyRate = "시간당 작업비는 0 이상의 금액(소수점 두 자리까지)이어야 합니다.";
  } else if (parsedRate.value === null) {
    fieldErrors.hourlyRate = "시간당 작업비를 입력해 주세요.";
  } else {
    hourlyRate = parsedRate.value;
  }

  // ── 세 갈래의 공수시간 ──────────────────────────────────────────────────
  // 셋 다 **비울 수 있다.** 빈 칸이 "아직 정하지 않았다"이고, 그 상태를 표현할 방법이
  // 없으면 값이 안 정해진 장비를 담을 수 없다(서류는 세 장비 모두가 그렇다).
  // 잣대는 갈래마다 다르다 — 서류만 0 을 받는다(parseRepairLaborHours).
  const hours: Record<RepairLaborScope, number | null> = {
    INVESTIGATION: null,
    POWER_TEST: null,
    DOCUMENT: null,
  };
  for (const scope of REPAIR_LABOR_SCOPES) {
    const parsed = parseRepairLaborHours(scope, raw[REPAIR_LABOR_HOURS_FIELDS[scope]]);
    if (parsed.ok) hours[scope] = parsed.value;
    else fieldErrors[REPAIR_LABOR_HOURS_FIELDS[scope]] = parsed.message;
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

      const hoursValue = typeof row.hours === "number" ? row.hours : Number(row.hours);
      if (!Number.isInteger(hoursValue) || hoursValue <= 0 || hoursValue > MAX_HOURS) {
        fieldErrors[at("hours")] = `${line}번째 작업의 공수시간은 1 이상 ${MAX_HOURS} 이하의 정수여야 합니다.`;
      }

      let id: string | null = null;
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
          fieldErrors[at("id")] = `${line}번째 작업을 확인할 수 없습니다.`;
        } else id = row.id;
      }

      // 사람이 화면에서 표시한다. 이름으로 맞히지 않는다(schema/repair-labor.ts).
      tasks.push({ id, taskName, hours: hoursValue, isOverhaul: row.isOverhaul === true });
    });
  }

  // ── 갈래별 작업 목록 셋 ─────────────────────────────────────────────────
  // 건명만 본다. 🔴 공수시간을 요구하지 않는다 — 이 목록들에는 시간이 없다.
  // 🔴 같은 건명이라도 **갈래가 다르면 겹침이 아니다** — 표의 유니크가
  // `(장비, scope, 건명)` 이기 때문이다. 그래서 겹침 판정도 갈래 안에서만 한다.
  const scopeTasks: Record<RepairLaborScope, LaborScopeTaskInput[]> = {
    INVESTIGATION: [],
    POWER_TEST: [],
    DOCUMENT: [],
  };
  for (const scope of REPAIR_LABOR_SCOPES) {
    const field = REPAIR_LABOR_TASKS_FIELDS[scope];
    const label = repairLaborScopeLabels[scope];
    const rawList = raw[field];
    if (rawList === null || rawList === undefined) {
      // 칸 자체가 안 온 경우는 **빈 목록**으로 본다(공수시간이 안 왔을 때 null 로 두는
      // 것과 같은 판단). 목록을 지우는 것과 구별되지 않지만, 이 화면은 어느 탭에서
      // 눌러도 한 벌 전부를 보내므로 실제로 갈릴 일이 없다.
      continue;
    }
    if (!Array.isArray(rawList)) {
      fieldErrors[field] = `${label} 작업 목록을 확인할 수 없습니다.`;
      continue;
    }
    if (rawList.length > MAX_SCOPE_TASKS) {
      // 사람이 손으로 적을 수 있는 양을 한참 넘었다(MAX_SCOPE_TASKS 주석).
      fieldErrors[field] = `${label} 작업은 ${MAX_SCOPE_TASKS}건을 넘을 수 없습니다.`;
      continue;
    }

    const seenScopeNames = new Set<string>();
    rawList.forEach((entry, index) => {
      const at = (name: string) => `${field}.${index}.${name}`;
      const line = index + 1;
      if (typeof entry !== "object" || entry === null) {
        fieldErrors[`${field}.${index}`] = `${line}번째 줄을 확인할 수 없습니다.`;
        return;
      }
      const row = entry as Record<string, unknown>;

      const taskName = typeof row.taskName === "string" ? row.taskName.trim() : "";
      if (taskName === "") {
        fieldErrors[at("taskName")] = `${line}번째 ${label} 작업의 건명을 입력해 주세요.`;
      } else if (taskName.length > MAX_TASK_NAME) {
        fieldErrors[at("taskName")] =
          `${line}번째 ${label} 작업의 건명은 ${MAX_TASK_NAME}자를 넘을 수 없습니다.`;
      } else if (seenScopeNames.has(taskName)) {
        // 표의 부분 unique 색인과 짝을 맞춘다 — 여기서 안 막으면 DB 오류로
        // 터지고, 사람은 어느 줄이 문제인지 못 듣는다.
        fieldErrors[at("taskName")] = `${line}번째 ${label} 작업의 건명이 위와 겹칩니다.`;
      } else {
        seenScopeNames.add(taskName);
      }

      let id: string | null = null;
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
          fieldErrors[at("id")] = `${line}번째 ${label} 작업을 확인할 수 없습니다.`;
        } else id = row.id;
      }

      scopeTasks[scope].push({ id, taskName });
    });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    data: {
      equipmentKind,
      hourlyRate,
      investigationHours: hours.INVESTIGATION,
      powerTestHours: hours.POWER_TEST,
      documentHours: hours.DOCUMENT,
      tasks,
      scopeTasks,
    },
  };
}
