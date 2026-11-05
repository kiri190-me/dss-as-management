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
 * **셀 격자 흐름도**의 블록 머리글 — `1. 반사파(Reflect) 관련 알람 발생`
 * ──────────────────────────────────────────────────────────────────────
 * `(MB) 수리` 한 장이 증상 11개를 **한 시트 안에서** 블록으로 나눠 그린다. 그 블록의
 * 머리글이 이 꼴이고, 앞의 `숫자.` 를 떼어 낸 것이 절차 이름이 된다
 * (`[MB] 반사파(Reflect) 관련 알람 발생`).
 *
 * 🔴 **이름 짓는 자리를 여기 둔 까닭**: 위 `SHEET_NAME_RE`(시트 이름의 `(숫자)`)와
 * `trimCoNumberedLabel`(겸임 표기의 꼬리말)도 같은 일을 한다. 절차 이름을 짓는
 * 규칙이 세 파일에 흩어지면, 다듬는 방식이 갈려 목록에서 **같은 결로 안 보인다.**
 *
 * 🔴 **돌려주는 번호는 워크북의 단계 번호가 아니다.** 이 시트 안에서만 뜻이 있는
 * 증상 차례다 — 아래 `planCellGridProcedures` 가 그것을 `stageNumber` 로 쓰지 않는
 * 까닭이 거기 적혀 있다.
 *
 * 🔵 번호 뒤가 비어 있으면(`3.` 만 있는 칸) 머리글로 안 본다 — 이름이 없는 절차를
 * 만들 수는 없다.
 */
const BLOCK_HEADING_RE = /^\s*(\d+)\s*\.\s*(\S[\s\S]*?)\s*$/;

export function splitBlockHeading(text: string | null | undefined): {
  blockNumber: string;
  label: string;
} | null {
  if (!text) return null;
  const match = text.replace(/\r\n/g, "\n").match(BLOCK_HEADING_RE);
  if (!match) return null;
  return { blockNumber: match[1], label: match[2].trim() };
}

/**
 * 계획이 들고 다니는 **제 블록**의 자리표.
 *
 * 🔴 한 시트가 절차 여럿을 만드는 길은 전에도 있었지만(겸임 복제본), 그쪽은 **내용이
 * 같은 사본**이라 시트만 알면 됐다. 이쪽은 블록마다 **내용이 다르므로** 계획이
 * 「시트의 어느 줄 범위인가」를 들고 다녀야 한다 — 안 들고 다니면 만드는 쪽이 그
 * 대응을 다시 추측해야 하고, 그 추측은 블록 순서가 바뀌는 날 조용히 어긋난다.
 *
 * 🔵 상자·이음 **내용은 안 담는다.** 담으면 계획과 읽개 두 곳에 같은 것이 생긴다 —
 * 여기는 열쇠(`headerRef`)만 들고, 내용은 읽개가 돌려준 블록에서 찾는다.
 */
export type ProcedurePlanCellBlock = {
  /** `A3` — 그 블록의 머리글 칸. 블록을 되찾는 열쇠다. */
  headerRef: string;
  headerRow: number;
  endRow: number;
  /** 머리글 칸 글자 그대로 — 다듬기 전 원문이라 사람이 규칙을 검산할 수 있다. */
  rawHeaderText: string;
  /** 시트 안의 증상 차례. 🔴 워크북의 단계 번호가 아니다. */
  blockNumber: string;
};

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
  /**
   * 🔴 **`(MB) 수리` 는 2026-11-05 에 이 표에서 빠졌다.** 「셀 격자로 그린 흐름도라
   * 읽개가 따로 필요하다」는 `DEFERRED_CELL_BASED` 줄이 여기 있었고, 그 읽개
   * (`cell-grid-flowchart.ts`)가 생기면서 **할 일이 끝났다.** 이제 그 시트는 아래
   * `resolveSheetExclusion` 이 **재서** 「셀 격자 흐름도가 있다」로 통과시킨다.
   *
   * 🔵 갈래 자체(`DEFERRED_CELL_BASED`)는 **안 지운다.** 다음에 또 다른 꼴의 시트가
   * 나오면 그 줄을 여기 적어야 하고, 갈래가 없으면 「흐름도가 없다」로 묻힌다.
   */
]);

/**
 * 이 시트를 기술 작업 절차로 만들 것인가. 만들지 않는다면 **까닭 갈래와 함께** 돌려준다.
 *
 * ── 차례가 알맹이다 ───────────────────────────────────────────────────
 * ① **사람이 정한 것**이 먼저다. 되돌릴 수 있는 결정이고, 데이터를 재서 뒤집으면 안 된다.
 * ② 🔴 그다음이 **셀 격자 흐름도**다. 도형이 0개여도 흐름도가 있는 시트가 있다
 *    (`(MB) 수리`). 이 갈래가 아래 측정보다 **앞에 있어야** 한다 — 뒤에 두면
 *    「도형 0 → 흐름도가 없다」로 먼저 걸려 영영 안 읽힌다.
 * ③ 마지막이 **도형 측정**이다.
 *
 * 🔵 `drawing` 도 `cellGrid` 도 안 넘기면 그 갈래를 **안 본다**(「문제 없음」이 아니라
 * 「안 봄」이다).
 */
export function resolveSheetExclusion(
  sheetName: string,
  drawing?: { shapeCount: number; connectorCount: number },
  cellGrid?: { blockCount: number }
): SheetExclusion | null {
  const decided = DECIDED_SHEET_EXCLUSIONS.get(sheetName);
  if (decided) return decided;
  if (cellGrid && cellGrid.blockCount > 0) return null;
  if (!drawing) return null;
  if (drawing.shapeCount === 0 || drawing.connectorCount === 0) {
    return {
      category: "NO_FLOWCHART",
      detail:
        `도형 ${drawing.shapeCount}개 · 연결선 ${drawing.connectorCount}개` +
        (cellGrid ? " · 셀 격자 블록 0개" : "") +
        " — 도형 흐름도가 아니다.",
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
  /**
   * 🔵 **셀 격자 시트에서 나온 계획만** 채워진다. 도형 시트는 null 이고, 그 값이 곧
   * 「어느 읽개로 읽을 것인가」다(technical-task-workbook.ts 가 이것을 보고 고른다).
   */
  cellBlock: ProcedurePlanCellBlock | null;
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
 *
 * 🔴 `cellBlocks` 가 **하나라도 있으면** 그 시트는 셀 격자 시트다 — 시트 단위 계획
 * 하나가 아니라 **블록마다 하나씩** 세운다(아래 `planCellGridProcedures`). 겸임 표기는
 * 그 길에서 안 본다: 겸임은 「한 시트의 같은 흐름도를 여러 단계가 함께 쓴다」는 말인데,
 * 셀 격자 시트는 블록마다 내용이 **다르다.**
 */
export function planProceduresForSheet(
  sheetName: string,
  titleText: string | null,
  drawing?: { shapeCount: number; connectorCount: number },
  cellBlocks?: readonly ProcedurePlanCellBlock[]
): TechnicalTaskProcedurePlan[] {
  const match = sheetName.match(SHEET_NAME_RE);
  if (!match) return [];

  const prefix = match[1];
  const stageNumber = match[2] ?? null;
  const label = match[3].trim();
  const equipmentType = equipmentTypeOf(prefix);
  // 제외는 **시트 단위**다 — 한 시트에서 나온 복제본들도 함께 빠진다.
  const excluded = resolveSheetExclusion(sheetName, drawing, cellBlocks && {
    blockCount: cellBlocks.length,
  });

  if (cellBlocks && cellBlocks.length > 0) {
    return planCellGridProcedures({ prefix, sheetLabel: label, equipmentType, sheetName, cellBlocks, excluded });
  }

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
    cellBlock: null,
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
        cellBlock: null,
      });
    }
  }
  return plans;
}

/**
 * ============================================================================
 * **셀 격자 시트 한 장 → 블록마다 절차 하나** (2026-11-05)
 * ============================================================================
 * `(MB) 수리` 한 장이 증상 11개를 품고 있고, 블록마다 **다른 흐름도**가 그려져 있다.
 *
 * ── 🔴 한 시트가 절차 여럿을 만드는 **두 번째** 길이다 ──────────────────
 * 먼저 있던 길은 겸임 복제본(`(RFG) (7)` → 7·9·10)인데, 그쪽은 **같은 내용의 사본**
 * 셋이다. 여기는 **내용이 블록마다 다르다** — 그래서 계획이 `cellBlock` 으로 제 줄
 * 범위를 들고 다닌다.
 *
 * ── 🔴 블록 번호를 `stageNumber` 로 **쓰지 않는다** ────────────────────
 * 이 시트의 블록 번호는 1~11 인데, 워크북의 **단계 번호도 1~12** 다. 그대로 쓰면
 * `buildStageNumberIndex` 가 1~11 을 전부 **충돌**로 보고 표에서 빼 버린다. 그러면
 * `(4)`→`(5)` 같은 기존 절차의 이어가기가 「그 번호의 절차가 없다」가 되어
 * **이미 만들어 둔 열넷이 못 이어진다.** 오류는 안 나고 잇기 단계의 셈만 조용히
 * 달라진다 — 이 시트를 읽어 들이면서 **가장 크게 깨질 수 있었던 자리**가 여기다.
 *
 * 🔵 블록 번호는 `cellBlock.blockNumber` 와 노드 코드 앞가지에 남는다. 사람이
 * 「엑셀의 3번 증상이 이 절차」를 맞대어 보는 데 그 둘이면 충분하다.
 */
function planCellGridProcedures(params: {
  prefix: string;
  /** 시트 이름에서 머리말을 뗀 것 — `(MB) 수리` 의 `수리`. 노드 코드 앞가지에 쓴다. */
  sheetLabel: string;
  equipmentType: ProcedureEquipmentType;
  sheetName: string;
  cellBlocks: readonly ProcedurePlanCellBlock[];
  excluded: SheetExclusion | null;
}): TechnicalTaskProcedurePlan[] {
  const { prefix, sheetLabel, equipmentType, sheetName, cellBlocks, excluded } = params;
  const sheetSlug = sheetLabel.replace(/[\s()（）]/g, "");
  return cellBlocks.map((block) => {
    const heading = splitBlockHeading(block.rawHeaderText);
    // 🔵 블록은 읽개가 이미 갈라 놓았다. 여기서 한 번 더 가르는 까닭은 **이름을
    //    짓는 규칙이 이 파일에 있어야** 하기 때문이다(`splitBlockHeading` 머리말).
    const label = heading?.label ?? block.rawHeaderText.trim();
    return {
      // 🔴 null 이다 — 바로 위 머리말의 「블록 번호를 단계 번호로 쓰지 않는다」.
      stageNumber: null,
      name: `[${prefix}] ${label}`,
      label,
      equipmentType,
      sourceWorksheet: sheetName,
      nodeCodePrefix: `${prefix.toLowerCase()}${sheetSlug}${block.blockNumber}`,
      duplicateOfStageNumber: null,
      rawCoNumberedLabel: null,
      excluded,
      cellBlock: block,
    };
  });
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
