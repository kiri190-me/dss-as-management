/**
 * ============================================================================
 * 견적서 저장 — 「정말 바뀌었는가」 (2026-10-31)
 * ============================================================================
 * [저장]을 눌렀을 때 **DB 에 들어 있는 내용**과 **지금 보내온 내용**이 같은지
 * 가른다. 같으면 저장 경로는 한 글자도 쓰지 않고(판 번호도 안 올린다) 결재도
 * 건드리지 않는다 — domain/quote-save-outcome.ts 의 `UNCHANGED`.
 *
 * 🔴 **DB 도 서버도 여기서 만지지 않는다.** 판정이 mutation 안에 묻히면 이 규칙을
 * 재는 시험이 전부 DB 를 타야 하고, 그러면 「`""` 과 `null` 을 같게 보는가」 같은
 * 작은 물음 하나에 통합 테스트 한 벌이 붙는다. domain/quote-approval-rules.ts 가
 * 결재 규칙에 대해 하는 것과 같은 자리다.
 *
 * ── 🔴 어디까지 견주는가 ────────────────────────────────────────────────
 * **저장이 실제로 쓰는 것 전부**다 — 견적서 한 줄의 칸들 + 품목 줄 + 고른 수리
 * 작업 + 작업 내역. 🔴 품목이 빠지면 **금액이 바뀌어도 「안 바뀜」이 된다**(줄을
 * 통째로 갈아 끼우는 구조라 부품 표는 quotes 행에 아무 자취도 남기지 않는다 —
 * mutations/quotes.ts 의 replaceItems).
 *
 * 🔴 **칸 목록을 여기 베껴 적지 않는다.** `quoteColumnsEqual` 은 들어온 쪽
 * (`toColumnValues` 가 만든 묶음)의 **키를 돌면서** 견준다. 그래서 칸이 하나
 * 늘어나면 비교도 저절로 따라 늘어난다 — 베껴 적어 두면 칸을 더한 날 한쪽만
 * 고쳐지고, 그때 증상은 **「그 칸만 고치고 저장하면 아무 일도 안 일어난다」**로
 * 나타난다(오류가 아니라 침묵이라 더 나쁘다).
 *
 * ── 🔴 「같다」의 기준 ──────────────────────────────────────────────────
 *  1. **빈 값은 한 모양이다** — `null` · `undefined` · `""` · 공백만 적힌 글자는
 *     전부 「없음」이다. 검증(validation/quote-input.ts 의 optionalText)이 이미
 *     저장 전에 같은 접기를 하므로, 여기서 접는 것은 **옛 행**과 검증을 거치지
 *     않고 들어간 값까지 같은 잣대로 보기 위해서다. 글자는 앞뒤를 떼고 견준다 —
 *     검증이 trim 해서 넣었으니 DB 쪽은 이미 떼어져 있다.
 *  2. **금액은 값으로 견준다** — `"100"` 과 `"100.00"` 은 **같다**. 🔴 이 한 줄이
 *     없으면 이 기능은 통째로 꺼진다: DB 의 numeric(15,2) 는 `"150000.00"` 으로
 *     돌아오는데 검증은 `"150000"` 을 그대로 내준다(normalizeAmount 는 소수
 *     자리를 채우지 않는다). 글자로 견주면 **손대지 않은 견적서도 늘 「바뀜」**이
 *     되고, 그때 「안 바뀐 저장은 반려하지 않는다」는 결정이 아무 뜻도 없어진다.
 *  3. 🔴 **금액으로 보는 칸은 손으로 꼽는다**(아래 상수 셋). 「숫자처럼 생긴
 *     글자는 숫자로 본다」로 넓히면 **L/N · S/N 이 망가진다** — `"0012"` 와
 *     `"12"` 는 다른 물건이고, 그 둘을 같게 보면 앞의 0을 지운 저장이 조용히
 *     버려진다. 꼽은 목록에서 빠진 칸은 글자로 견주므로 **「바뀜」 쪽으로 기운다**
 *     — 안전한 방향이다(저장을 건너뛰는 일은 없다).
 *  4. **형이 다르면 다르다** — `"100"`(글자)과 `100`(숫자)은 금액 칸이 아니면
 *     다르다. 한 칸이 형을 오가는 일은 없고, 오간다면 그것이 알려져야 할 사실이다.
 *
 * ── 🔴 작업 내역은 **묶음 안의 차례**로 견준다 ──────────────────────────
 * 저장은 작업 내역을 묶음(조사/수리/통전)마다 1부터 번호를 다시 매겨 넣는다
 * (mutations/quotes.ts 의 replaceWorkScopeLines). 그래서 평평한 배열 안에서
 * 묶음끼리의 앞뒤가 바뀌어도 **저장된 결과는 똑같다** — 견주는 것도 저장된 뜻을
 * 따라 묶음별 차례로 본다. 평평한 순서로 견주면 저장해도 아무것도 달라지지 않는
 * 입력이 「바뀜」으로 읽힌다.
 * ============================================================================
 */

/**
 * 🔴 **금액(numeric) 칸** — 값으로 견주는 자리. 스키마의 `numeric(15,2)` 칸과
 * 같은 목록이어야 하고(schema/quotes.ts), 이 파일의 시험이 「`"0"` 과 `"0.00"`
 * 이 같은가」로 그 뜻을 못 박는다.
 *
 * 🔴 **품목의 단가와 수리 작업의 시간당 단가는 여기 없다** — 그 둘은 칸 묶음이
 * 아니라 줄 안에 있어서 아래 전용 비교가 따로 집는다. 한 목록에 섞으면 「칸 이름이
 * 같으면 같은 규칙」이라는 착각이 생긴다.
 */
export const QUOTE_AMOUNT_COLUMN_KEYS = [
  "workCost",
  "laborBaseCost",
  "laborPowerTestDeduction",
  "manualSupplyAmount",
] as const;

const AMOUNT_COLUMN_KEY_SET: ReadonlySet<string> = new Set(QUOTE_AMOUNT_COLUMN_KEYS);

/** 품목 줄 — 저장이 실제로 쓰는 칸만(차례는 배열 순서가 곧 line_no 라 담지 않는다). */
export type QuoteComparableItem = {
  partId: string | null;
  kind: string;
  partNameText: string;
  partSpecText: string | null;
  isOverhaulPart: boolean;
  quantity: number | null;
  unitPrice: string | null;
  inventoryPartNo: number | null;
};

/** 고른 수리 작업 한 줄 — 저장이 실제로 쓰는 칸만. */
export type QuoteComparableRepairTask = {
  taskId: string | null;
  taskNameText: string;
  hours: number;
  hourlyRate: string;
};

/** 작업 내역 한 줄. 차례는 **묶음 안에서** 배열 순서 그대로다(머리말). */
export type QuoteComparableWorkScopeLine = {
  section: string;
  text: string;
};

/**
 * 견주는 한 벌. `columns` 는 **저장이 쓰는 칸 묶음 그대로**다 —
 * `toColumnValues(fields)` 가 만든 것과 DB 행에서 같은 이름으로 집어 온 것.
 */
export type QuoteContentSnapshot = {
  columns: Readonly<Record<string, unknown>>;
  items: readonly QuoteComparableItem[];
  repairTasks: readonly QuoteComparableRepairTask[];
  workScopeLines: readonly QuoteComparableWorkScopeLine[];
};

/**
 * 비어 있음을 한 모양으로 접는다 — `null` · `undefined` · `""` · 공백만 적힌
 * 글자는 전부 `null`. 글자가 아니면(불리언 · 숫자) 그대로 돌려준다.
 *
 * domain/domestic-order-list.ts 의 foldBlankToNull 과 같은 규칙이다. 그 함수를
 * 그대로 쓰지 않는 것은 받는 것이 `string | null | undefined` 라서다 — 여기서는
 * 칸 값이 무엇으로 올지 미리 좁힐 수 없다(불리언 · 숫자 · uuid 가 섞인다).
 */
function foldBlank(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 금액 한 칸의 **표준형**. 소수점 뒤의 남는 0 과 앞의 남는 0 을 떼고, 부호가
 * 없는 0 은 `"0"` 하나로 만든다. `"100"` · `"100.00"` · `"0100.0"` 이 모두
 * `"100"` 이 된다.
 *
 * 🔴 **`Number` 로 바꾸지 않는다.** 금액은 numeric(15,2) 라 자릿수가 부동소수의
 * 안전 범위를 넘을 수 있고, 한 번 넘으면 **틀린 쪽이 「같다」로 보인다**(서로
 * 다른 두 금액이 같은 부동소수로 떨어진다). 글자를 글자로 다듬는 편이 안전하다.
 *
 * 🔴 **모양을 모르는 글자는 있는 그대로 돌려준다** — 지어내지 않는다. 그러면 그
 * 값은 글자로 견주어져 「바뀜」 쪽으로 기울고, 그쪽이 안전한 방향이다.
 */
export function canonicalQuoteAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : null;
  if (text === null) return null;
  if (text === "") return null;
  const matched = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  // 숫자 모양이 아니다(콤마 · 지수 표기 · 글자). 있는 그대로 견준다.
  if (!matched || (matched[2] === "" && (matched[3] ?? "") === "")) return text;
  const whole = matched[2].replace(/^0+(?=\d)/, "") || "0";
  const fraction = (matched[3] ?? "").replace(/0+$/, "");
  const digits = fraction === "" ? whole : `${whole}.${fraction}`;
  // -0 · +0 은 0 하나다. 부호만 다른 0 을 「바뀜」으로 읽으면 안 된다.
  if (/^0(\.0*)?$/.test(digits)) return "0";
  return matched[1] === "-" ? `-${digits}` : digits;
}

/** 금액이 아닌 값 하나가 같은가 — 빈 값을 접은 뒤 그대로 견준다(머리말의 1 · 4). */
function sameValue(left: unknown, right: unknown): boolean {
  return foldBlank(left) === foldBlank(right);
}

/** 금액 한 칸이 같은가 — 표준형으로 바꾼 뒤 견준다(머리말의 2). */
function sameAmount(left: unknown, right: unknown): boolean {
  return canonicalQuoteAmount(left) === canonicalQuoteAmount(right);
}

/**
 * 칸 묶음이 같은가.
 *
 * 🔴 **도는 키는 `next`(들어온 쪽) 것이다.** 그쪽이 「이 저장이 실제로 쓰는 칸」의
 * 목록이기 때문이다(`toColumnValues`). `current` 에는 쓰지 않는 칸(id · version ·
 * is_deleted · created_at …)이 함께 실려 오는데, 그것들은 저장이 건드리지 않으므로
 * 견줄 것도 아니다.
 *
 * 🔴 `next` 에만 있고 `current` 에 없는 이름은 `undefined` 와 견주게 되어 거의
 * 언제나 「바뀜」이 된다 — 안전한 방향이다(저장을 건너뛰지 않는다).
 */
export function quoteColumnsEqual(
  next: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>
): boolean {
  for (const key of Object.keys(next)) {
    const equal = AMOUNT_COLUMN_KEY_SET.has(key)
      ? sameAmount(next[key], current[key])
      : sameValue(next[key], current[key]);
    if (!equal) return false;
  }
  return true;
}

/**
 * 품목 줄들이 같은가 — **차례까지** 같아야 한다. 설명 줄이 어느 품목 묶음 위에
 * 붙는지가 곧 그 줄의 뜻이라(schema/quotes.ts 의 quoteItemKindEnum), 순서가
 * 바뀐 것은 바뀐 것이다.
 */
export function quoteItemsEqual(
  next: readonly QuoteComparableItem[],
  current: readonly QuoteComparableItem[]
): boolean {
  if (next.length !== current.length) return false;
  return next.every((line, index) => {
    const other = current[index];
    return (
      sameValue(line.partId, other.partId) &&
      sameValue(line.kind, other.kind) &&
      sameValue(line.partNameText, other.partNameText) &&
      sameValue(line.partSpecText, other.partSpecText) &&
      line.isOverhaulPart === other.isOverhaulPart &&
      sameValue(line.quantity, other.quantity) &&
      // 🔴 단가만 금액이다. 수량 · 부품 번호는 integer 라 양쪽 다 숫자로 온다.
      sameAmount(line.unitPrice, other.unitPrice) &&
      sameValue(line.inventoryPartNo, other.inventoryPartNo)
    );
  });
}

/** 고른 수리 작업이 같은가 — 품목과 같이 **차례까지** 본다(line_no 가 배열 순서다). */
export function quoteRepairTasksEqual(
  next: readonly QuoteComparableRepairTask[],
  current: readonly QuoteComparableRepairTask[]
): boolean {
  if (next.length !== current.length) return false;
  return next.every((task, index) => {
    const other = current[index];
    return (
      sameValue(task.taskId, other.taskId) &&
      sameValue(task.taskNameText, other.taskNameText) &&
      sameValue(task.hours, other.hours) &&
      sameAmount(task.hourlyRate, other.hourlyRate)
    );
  });
}

/** 묶음별로 나눠 담되 **들어온 차례 그대로** — 저장이 번호를 매기는 방식과 같다. */
function groupWorkScopeLines(
  lines: readonly QuoteComparableWorkScopeLine[]
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const line of lines) {
    const bucket = grouped.get(line.section);
    if (bucket) bucket.push(line.text);
    else grouped.set(line.section, [line.text]);
  }
  return grouped;
}

/** 작업 내역이 같은가 — **묶음 안의 차례**로 견준다(머리말의 마지막 절). */
export function quoteWorkScopeLinesEqual(
  next: readonly QuoteComparableWorkScopeLine[],
  current: readonly QuoteComparableWorkScopeLine[]
): boolean {
  const nextBySection = groupWorkScopeLines(next);
  const currentBySection = groupWorkScopeLines(current);
  const sections = new Set([...nextBySection.keys(), ...currentBySection.keys()]);
  for (const section of sections) {
    const nextTexts = nextBySection.get(section) ?? [];
    const currentTexts = currentBySection.get(section) ?? [];
    if (nextTexts.length !== currentTexts.length) return false;
    if (nextTexts.some((text, index) => !sameValue(text, currentTexts[index]))) return false;
  }
  return true;
}

/**
 * 🔴 **저장해도 달라질 것이 하나도 없는가.** 참이면 저장 경로는 UPDATE 도,
 * 판 번호 올리기도, 줄 갈아 끼우기도, 결재 자동 반려도 하지 않는다.
 *
 * 넷을 모두 넘어야 참이다 — 하나라도 빠지면 그 자리의 변경이 조용히 버려진다.
 */
export function isQuoteContentUnchanged(
  next: QuoteContentSnapshot,
  current: QuoteContentSnapshot
): boolean {
  return (
    quoteColumnsEqual(next.columns, current.columns) &&
    quoteItemsEqual(next.items, current.items) &&
    quoteRepairTasksEqual(next.repairTasks, current.repairTasks) &&
    quoteWorkScopeLinesEqual(next.workScopeLines, current.workScopeLines)
  );
}
