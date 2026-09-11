/**
 * ============================================================================
 * 견적서가 고른 수리 작업 — 「작업 id → 수량」
 * ============================================================================
 * 같은 작업을 **여러 번** 더해 작업비를 늘릴 수 있다(2026-09-11 사용자 요청).
 * 예전에는 작업마다 켜고 끄는 것만 됐다(`Set<id>`). 이제 화면의 상태는
 * `작업 id → 수량(≥ 1)` 이고, 이 파일이 그 상태를 다루는 규칙을 전부 갖는다 —
 * 화면은 부르기만 한다.
 *
 * ── 🔴 저장 모양은 바뀌지 않는다 — 수량만큼 **줄로 편다** ─────────────────
 * `quote_repair_tasks` 는 줄마다 한 작업이고, 유니크는 `(quote_id, line_no)` 뿐이라
 * 같은 `task_id` 여러 줄을 이미 담을 수 있다. 그래서 수량 칸을 새로 만들지 않고
 * 수량 N 을 **같은 작업 N 줄**로 편다. 그러면 합계(`sumQuoteLaborCost`)·서버
 * 검증·DB 는 한 글자도 고치지 않고 맞는다. 다시 열 때는 줄을 `task_id` 별로 세어
 * 수량으로 되살린다.
 *
 * 줄의 차례는 **카탈로그 차례 그대로**이고 같은 작업은 붙어 있다. 수량이 모두
 * 1 이면 예전(`Set`)과 **한 글자도 다르지 않은 줄**이 나온다 — 옛 견적서를 열어
 * 그대로 저장해도 아무것도 바뀌지 않는 자리가 여기다.
 *
 * ── 🔴 수량은 작업비에만 들어간다. 문구는 그대로다 ───────────────────────
 * 문서의 「2) 수리작업」 줄은 **고른 작업 이름을 한 번씩** 적는다. 수량이 몇이든
 * `× N` 같은 꼬리를 붙이지 않는다(2026-09-11 사용자: "작업비만 추가되는 거고,
 * 문구는 변하지 않는다"). 그래서 이름 목록은 수량을 보지 않는다.
 *
 * ── 수량 0 은 없다 ──────────────────────────────────────────────────────
 * 상태에는 수량 ≥ 1 인 것만 담는다. 빼려면 체크를 푼다 — 체크는 켜져 있는데
 * 수량이 0 인 줄이 생기면, 화면은 고른 것처럼 보이는데 합계에는 없다.
 * ============================================================================
 */

/** 한 작업의 수량 하한. 이보다 작게는 줄지 않는다 — 빼려면 체크를 푼다. */
export const MIN_REPAIR_TASK_QUANTITY = 1;

/**
 * 한 작업의 수량 상한. 한 견적서에서 같은 작업을 이보다 많이 청구할 일은 없고,
 * 잘못 누른 단추가 줄을 수백 개 만들지 않게 막는다.
 */
export const MAX_REPAIR_TASK_QUANTITY = 99;

/** 작업 id → 수량. 수량 ≥ 1 인 것만 담는다. */
export type RepairTaskQuantities = ReadonlyMap<string, number>;

/** 카탈로그의 작업 한 줄에서 여기서 쓰는 것만. `RepairTaskRow` 가 그대로 맞는다. */
export type RepairTaskCatalogEntry = {
  id: string;
  taskName: string;
  hours: number;
  isOverhaul: boolean;
};

/**
 * 저장·합계로 넘기는 한 줄. 예전 `selectedTasks` 와 **같은 모양·같은 키 차례**다
 * (`sumQuoteLaborCost` 의 `SelectedRepairTask` + `taskId`).
 */
export type RepairTaskLine = {
  taskId: string;
  taskName: string;
  hours: number;
  hourlyRate: string;
};

/**
 * 수량을 [하한, 상한] 안의 정수로. 숫자로 읽을 수 없으면 하한이다 — 켜 둔 작업이
 * 이상한 값 하나로 사라지면 사람은 자기가 뺀 줄 안다.
 */
export function clampRepairTaskQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return MIN_REPAIR_TASK_QUANTITY;
  const whole = Math.trunc(quantity);
  return Math.min(MAX_REPAIR_TASK_QUANTITY, Math.max(MIN_REPAIR_TASK_QUANTITY, whole));
}

/** 그 작업의 수량. 고르지 않았으면 0. */
export function repairTaskQuantityOf(quantities: RepairTaskQuantities, taskId: string): number {
  return quantities.get(taskId) ?? 0;
}

/**
 * 저장된 줄들에서 수량을 되살린다 — `task_id` 별로 센다.
 *
 * `task_id` 가 null 인 줄(카탈로그에서 이어지지 않은 옛 줄)은 셀 수 없어 건너뛴다.
 * 카탈로그에 **지금은 없는** id 도 그대로 센다 — 예전 `Set` 이 그랬듯, 목록에 없는
 * id 는 줄로 펼 때 걸러진다(`expandRepairTaskLines`). 여기서 카탈로그를 보지 않는다.
 *
 * 🔴 **상한으로 자르지 않는다.** 저장된 줄은 이미 보낸 견적서의 근거라, 여기서
 * 자르면 열어서 그대로 저장하는 것만으로 줄과 금액이 소리 없이 줄어든다.
 */
export function restoreRepairTaskQuantities(
  saved: readonly { taskId: string | null }[]
): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const line of saved) {
    if (line.taskId === null) continue;
    quantities.set(line.taskId, (quantities.get(line.taskId) ?? 0) + 1);
  }
  return quantities;
}

/**
 * 체크를 켜고 끈다. 켜면 수량 1 로 들어가고(이미 있으면 그대로), 끄면 빠진다.
 * 늘 **새 Map** 을 돌려준다 — 화면 상태를 제자리에서 고치지 않는다.
 */
export function setRepairTaskChecked(
  quantities: RepairTaskQuantities,
  taskId: string,
  checked: boolean
): Map<string, number> {
  const next = new Map(quantities);
  if (!checked) next.delete(taskId);
  else if (!next.has(taskId)) next.set(taskId, MIN_REPAIR_TASK_QUANTITY);
  return next;
}

/**
 * 수량을 바꾼다. [하한, 상한] 으로 자른다 — − 단추로 0 이 되지 않는다.
 * 고르지 않은 작업이면 **아무것도 바꾸지 않는다**: 수량 단추는 체크된 작업에만
 * 보이고, 수량을 바꾸는 것이 체크를 켜는 길이 되면 규칙이 둘이 된다.
 */
export function setRepairTaskQuantity(
  quantities: RepairTaskQuantities,
  taskId: string,
  quantity: number
): Map<string, number> {
  const next = new Map(quantities);
  if (next.has(taskId)) next.set(taskId, clampRepairTaskQuantity(quantity));
  return next;
}

/**
 * 수량만큼 **줄로 편다** — 카탈로그 차례 그대로, 같은 작업은 붙어서.
 *
 * 카탈로그에 없는 id 는 줄이 되지 않는다(예전 `Set` 과 같다). 시간당 단가는
 * 그 장비의 **지금 값**을 줄마다 베껴 둔다 — 저장할 때 그대로 스냅샷이 된다.
 */
export function expandRepairTaskLines(
  tasks: readonly RepairTaskCatalogEntry[],
  quantities: RepairTaskQuantities,
  hourlyRate: string
): RepairTaskLine[] {
  const lines: RepairTaskLine[] = [];
  for (const task of tasks) {
    const quantity = repairTaskQuantityOf(quantities, task.id);
    for (let i = 0; i < quantity; i++) {
      lines.push({ taskId: task.id, taskName: task.taskName, hours: task.hours, hourlyRate });
    }
  }
  return lines;
}

/**
 * 문서의 「2) 수리작업」에 적힐 이름들 — 고른 작업을 **한 번씩**, 카탈로그 차례대로.
 *
 * 🔴 수량을 보지 않는다. `× N` 도 붙이지 않는다(이 파일 머리말 — 문구는 그대로다).
 */
export function selectedRepairTaskNames(
  tasks: readonly RepairTaskCatalogEntry[],
  quantities: RepairTaskQuantities
): string[] {
  return tasks.filter((task) => quantities.has(task.id)).map((task) => task.taskName);
}

/**
 * 견적서 종류에 따라 오버홀 작업을 넣고 뺀다.
 *
 * · O/H 견적서 — 오버홀 작업이 **없으면 수량 1 로** 넣고, 이미 있으면 **수량을
 *   건드리지 않는다**(사람이 2 로 올려 둔 것을 종류를 다시 고른다고 1 로 되돌리지
 *   않는다).
 * · 그 밖 — 뺀다.
 *
 * 오버홀로 표시된 작업이 하나도 없는 장비면 **null** — 따라 움직일 줄이 없다는
 * 뜻이고, 화면은 아무것도 하지 않는다. 이름으로 맞히지 않는다
 * (schema/repair-labor.ts 의 is_overhaul).
 */
export function applyOverhaulQuantities(
  tasks: readonly RepairTaskCatalogEntry[],
  quantities: RepairTaskQuantities,
  isOverhaulQuote: boolean
): Map<string, number> | null {
  const overhaulIds = tasks.filter((task) => task.isOverhaul).map((task) => task.id);
  if (overhaulIds.length === 0) return null;

  const next = new Map(quantities);
  for (const id of overhaulIds) {
    if (!isOverhaulQuote) next.delete(id);
    else if (!next.has(id)) next.set(id, MIN_REPAIR_TASK_QUANTITY);
  }
  return next;
}
