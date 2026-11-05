import type { ProcedureEquipmentType } from "@/lib/domain/procedure-template-types";

/**
 * 워크북의 **시트 한 장 → 기술 작업 절차 몇 개**인가를 정하는 자리.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 1:1 이 아닌가
 * ──────────────────────────────────────────────────────────────────────
 * 흐름도 시트의 이름에는 `(RFG) (1)…` 처럼 **장비 머리말**과 **단계 번호**가 함께
 * 붙어 있다. 대개 시트 한 장이 단계 하나지만, **한 시트가 여러 단계를 겸하는** 경우가
 * 있다. 그 시트는 맨 윗줄(머리글 칸)에 자기 번호 뒤에 대괄호로 「이 번호들에서도
 * 같은 작업을 다시 한다」는 겸임 표기를 달아 둔다.
 *
 * 2026-11-05 사용자 결정: 겸임으로 적힌 번호는 **가리키는 것이 아니라 제 절차를
 * 가진다.** 같은 흐름도 내용을 가진 **별도 절차**로 복제한다 — 수리소에서 그 번호의
 * 작업을 따로 실행하고 따로 기록하기 때문이다.
 *   🔴 **폐기된 설계**: 2026-11-05 중간에 「겸임 번호는 원본 시트의 절차를 가리킨다」로
 *   잡았다가 같은 날 뒤집혔다. 번호 → 시트를 손으로 적은 대응표는 **쓰지 않는다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 대응표를 코드에 안 적고 **엑셀에서 읽는** 까닭
 * ──────────────────────────────────────────────────────────────────────
 * 겸임 번호와 그 이름은 전부 머리글 칸 글자에서 나온다. 손으로 적은 표를 두면
 * 엑셀이 개정될 때 조용히 어긋난다(틀려도 오류가 안 나고 「절차가 하나 없다」로만
 * 보인다). 읽어서 세우면 시트가 바뀌는 날 결과도 따라 바뀐다.
 */

/** `(RFG) (1)고장 접수 확인` · `(MB) 통전검사` — 머리말과 (있으면) 단계 번호. */
const SHEET_NAME_RE = /^\(\s*(RFG|MB)\s*\)\s*(?:\(\s*(\d+)\s*\)\s*)?(.*)$/;

/**
 * 머리글 칸의 겸임 표기 — `[`와 `]` 사이에 `(번호) 이름` 이 쉼표로 늘어선다.
 * 대괄호 **밖**의 번호는 그 시트 자신의 번호라 여기서 잡히면 안 되므로
 * 대괄호 덩어리를 먼저 떼어 내고 그 안에서만 번호를 센다.
 */
const CO_NUMBER_GROUP_RE = /\[([^\]]*)\]/g;
const CO_NUMBER_ITEM_RE = /\(\s*(\d+)\s*\)\s*([^,\]]*)/g;

/**
 * 겸임 이름의 **꼬리 설명**을 떼어 낸다.
 *
 * 겸임 표기는 이름이 아니라 문장으로 적혀 있는 칸이 있다 — 「…할 때에도 같은 작업을
 * 다시 한다」는 설명이 이름 뒤에 그대로 이어 붙는다. 절차 이름에 그 문장이 들어가면
 * 목록에서 한 줄을 통째로 먹는다. 「…시 에도」가 그 문장이 시작되는 지점이라
 * 거기서 자른다(2026-11-05 사용자가 그 번호의 이름을 직접 정해 준 것과 같은 결과).
 *
 * 🔴 **표본 하나에서 세운 규칙이다.** 다른 시트에 다른 꼬리말이 나오면 안 잘린다 —
 * 그래서 자르기 전 원문을 `rawCoNumberedLabel` 에 남겨 드라이런이 함께 찍는다.
 */
export function trimCoNumberedLabel(raw: string): string {
  const cut = raw.replace(/\s*시\s*에도[\s\S]*$/, "").trim();
  return cut.length > 0 ? cut : raw.trim();
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 빼는 시트의 **까닭 갈래** — 셋을 한 낱말로 뭉치면 안 된다
 * ──────────────────────────────────────────────────────────────────────
 * 뜻이 전부 다르고, 다음에 그 줄을 읽는 사람이 해야 할 일도 전부 다르다:
 *   - `USER_EXCLUDED`      사람의 결정이다. 데이터는 멀쩡하고 **되돌릴 수 있다.**
 *   - `NO_FLOWCHART`       데이터가 그렇다. 되돌릴 거리가 없다.
 *   - `DEFERRED_CELL_BASED` 🔴 **뺀 것이 아니라 아직 안 한 것이다.** 그냥 「제외」로
 *     적어 두면 다음 단계에서 아무도 안 찾는다.
 */
export const SHEET_EXCLUSION_CATEGORY_CODES = [
  "USER_EXCLUDED",
  "NO_FLOWCHART",
  "DEFERRED_CELL_BASED",
] as const;
export type SheetExclusionCategory = (typeof SHEET_EXCLUSION_CATEGORY_CODES)[number];

export const sheetExclusionCategoryLabels: Record<SheetExclusionCategory, string> = {
  USER_EXCLUDED: "사용자가 뺐다",
  NO_FLOWCHART: "흐름도가 없다",
  DEFERRED_CELL_BASED: "아직 안 했다 — 3단계",
};

export type SheetExclusion = {
  category: SheetExclusionCategory;
  detail: string;
};

/**
 * 🔴 **사람이 정한 것만** 여기 적는다. 데이터를 보면 알 수 있는 것(도형이 없다
 * 따위)은 적지 않고 아래 `resolveSheetExclusion` 이 **그 자리에서 재서** 가린다 —
 * 손으로 적어 두면 엑셀이 바뀌는 날 조용히 어긋난다.
 *
 * 🔵 제외가 하나씩 늘 때마다 코드 여기저기에 박지 않고 **이 표 한 곳**에만 더한다.
 */
export const DECIDED_SHEET_EXCLUSIONS: ReadonlyMap<string, SheetExclusion> = new Map<string, SheetExclusion>([
  [
    "(MB) 외관 및 내부 검사",
    {
      category: "USER_EXCLUDED",
      detail: "2026-11-05 사용자 결정. 연결선이 0개라 흐름도로 읽을 것이 없다는 것을 드라이런에서 보고 뺐다.",
    },
  ],
  [
    "(MB) 출하완료",
    {
      // 🔴 이 시트는 도형도 연결선도 있다 — 「흐름도가 없다」로 분류하면 안 된다.
      category: "USER_EXCLUDED",
      detail: "2026-11-05 사용자 결정. 데이터가 모자라서가 아니라 사람의 결정이고, 되돌릴 수 있다.",
    },
  ],
  [
    "(MB) 수리",
    {
      category: "DEFERRED_CELL_BASED",
      detail:
        "도형이 아니라 **셀 테두리로 그린 흐름도**다(증상 11개). 읽개가 따로 필요해서 3단계에서 한다 — 뺀 것이 아니다.",
    },
  ],
]);

/**
 * 이 시트를 기술 작업 절차로 만들 것인가. 만들지 않는다면 **까닭 갈래와 함께** 돌려준다.
 *
 * 차례가 중요하다 — **사람이 정한 것이 먼저**다. `(MB) 수리` 는 도형이 0개라 아래
 * 측정 규칙에도 걸리지만, 그쪽으로 분류되면 「흐름도가 없다」가 되어 3단계에서
 * 아무도 안 찾는다.
 *
 * 🔵 `drawing` 을 안 넘기면 측정 갈래를 **안 본다**(「문제 없음」이 아니라 「안 봄」이다).
 */
export function resolveSheetExclusion(
  sheetName: string,
  drawing?: { shapeCount: number; connectorCount: number }
): SheetExclusion | null {
  const decided = DECIDED_SHEET_EXCLUSIONS.get(sheetName);
  if (decided) return decided;
  if (!drawing) return null;
  if (drawing.shapeCount === 0 || drawing.connectorCount === 0) {
    return {
      category: "NO_FLOWCHART",
      detail: `도형 ${drawing.shapeCount}개 · 연결선 ${drawing.connectorCount}개 — 도형 흐름도가 아니다.`,
    };
  }
  return null;
}

export type TechnicalTaskProcedurePlan = {
  /** 시트 이름(또는 겸임 표기)에서 읽은 단계 번호. 번호가 없는 시트면 null. */
  stageNumber: string | null;
  /** `[RFG] 고장 접수 확인` — 목록에 그대로 뜨는 이름. */
  name: string;
  /**
   * 머리말을 뗀 이름(`고장 접수 확인`).
   *
   * 🔵 **자동으로 더하는 시작 노드의 제목**이 이 값이다. 노드 상자 안에 들어가는
   * 글이라 길이가 곧 상자 크기이고, `[RFG]` 는 그 절차를 연 사람이 이미 화면 위에서
   * 보고 있는 글자다 — 상자 안에서 한 번 더 읽을 까닭이 없다.
   */
  label: string;
  equipmentType: ProcedureEquipmentType;
  sourceWorksheet: string;
  /**
   * 노드 코드의 앞가지.
   *
   * `procedure_template_nodes` 의 유일 제약은 **(템플릿, 노드코드)** 라 절차가 다르면
   * 같은 값을 써도 DB 는 막지 않는다. 그래도 복제본마다 다르게 짓는다 — 같은 모양의
   * 절차가 셋이 되는 날, 로그에 찍힌 노드 코드만 보고 어느 절차의 줄인지 가려야 한다.
   */
  nodeCodePrefix: string;
  /** 겸임 번호에서 나온 **복제 절차**면 원본 시트의 단계 번호. 원본이면 null. */
  duplicateOfStageNumber: string | null;
  /** 겸임 표기에서 읽은 원문(복제본만) — 이름으로 줄이기 전 글자. */
  rawCoNumberedLabel: string | null;
  /**
   * 🔴 비어 있지 않으면 **만들지 않는다.** 그래도 계획 목록에서 줄을 지우지 않는다 —
   * 조용히 빠지면 「왜 저 시트는 절차가 없지?」에 아무도 답을 못 한다.
   */
  excluded: SheetExclusion | null;
};

function equipmentTypeOf(prefix: string): ProcedureEquipmentType {
  // 머리말 두 가지가 그대로 enum 값이다(PROCEDURE_EQUIPMENT_TYPE_CODES: RFG·MB·COMMON).
  // 화면 글자 "RF Generator" · "Matching Box" 는 procedureEquipmentTypeLabels 가 붙인다.
  return prefix === "MB" ? "MB" : "RFG";
}

/**
 * 시트 한 장이 만들 절차들을 세운다. 첫 번째가 원본, 뒤는 겸임 번호의 복제본이다.
 *
 * `titleText` 는 그 시트 머리글 칸의 글자다(없으면 null). 겸임 표기는 거기에만 있다.
 * 머리말(`(RFG)`/`(MB)`)이 없는 시트는 흐름도 절차 시트가 아니므로 빈 배열이다 —
 * 부르는 쪽이 「계획 없음」으로 보고한다.
 */
export function planProceduresForSheet(
  sheetName: string,
  titleText: string | null,
  drawing?: { shapeCount: number; connectorCount: number }
): TechnicalTaskProcedurePlan[] {
  const match = sheetName.match(SHEET_NAME_RE);
  if (!match) return [];

  const prefix = match[1];
  const stageNumber = match[2] ?? null;
  const label = match[3].trim();
  const equipmentType = equipmentTypeOf(prefix);
  // 제외는 **시트 단위**다 — 한 시트에서 나온 복제본들도 함께 빠진다.
  const excluded = resolveSheetExclusion(sheetName, drawing);
  const primary: TechnicalTaskProcedurePlan = {
    stageNumber,
    name: `[${prefix}] ${label}`,
    label,
    equipmentType,
    sourceWorksheet: sheetName,
    // 번호가 없는 시트(MB 쪽이 전부 그렇다)는 이름을 줄여 쓴다 — 전부 `mbx` 로 두면
    // 로그에 찍힌 노드 코드만 보고 어느 절차의 줄인지 가릴 수 없다.
    nodeCodePrefix: `${prefix.toLowerCase()}${stageNumber ?? label.replace(/[\s()（）]/g, "")}`,
    duplicateOfStageNumber: null,
    rawCoNumberedLabel: null,
    excluded,
  };

  const plans = [primary];
  const seenNumbers = new Set<string>(stageNumber ? [stageNumber] : []);
  for (const group of (titleText ?? "").matchAll(CO_NUMBER_GROUP_RE)) {
    const inner = group[1];
    for (const item of inner.matchAll(CO_NUMBER_ITEM_RE)) {
      const number = item[1];
      // 자기 번호가 대괄호 안에 또 적힌 경우(와 같은 번호가 두 번 적힌 경우)는
      // 복제본을 만들지 않는다 — 같은 번호의 절차가 둘이 되면 어느 쪽을 가리켜야
      // 하는지 영영 못 가린다.
      if (seenNumbers.has(number)) continue;
      seenNumbers.add(number);
      const raw = item[2].trim();
      if (raw.length === 0) continue;
      const coLabel = trimCoNumberedLabel(raw);
      plans.push({
        stageNumber: number,
        name: `[${prefix}] ${coLabel}`,
        label: coLabel,
        equipmentType,
        sourceWorksheet: sheetName,
        nodeCodePrefix: `${prefix.toLowerCase()}${number}`,
        duplicateOfStageNumber: stageNumber,
        rawCoNumberedLabel: raw,
        excluded,
      });
    }
  }
  return plans;
}

/**
 * 워크북 전체의 **단계 번호 → 절차** 표. 흐름도 노드의 `(번호)` 참조를 풀 때 쓴다.
 *
 * 🔴 같은 번호가 둘 이상 나오면 **담지 않고 충돌로 돌려준다.** 먼저 온 것을 쓰면
 * 「어느 쪽인지 모르는데 하나를 골랐다」가 되고, 그 선택은 어디에도 안 남는다.
 */
export function buildStageNumberIndex(plans: readonly TechnicalTaskProcedurePlan[]): {
  byStageNumber: Map<string, TechnicalTaskProcedurePlan>;
  conflicts: string[];
} {
  const byStageNumber = new Map<string, TechnicalTaskProcedurePlan>();
  const conflicts: string[] = [];
  for (const plan of plans) {
    if (!plan.stageNumber) continue;
    if (byStageNumber.has(plan.stageNumber)) {
      conflicts.push(plan.stageNumber);
      continue;
    }
    byStageNumber.set(plan.stageNumber, plan);
  }
  for (const number of conflicts) byStageNumber.delete(number);
  return { byStageNumber, conflicts: [...new Set(conflicts)] };
}
