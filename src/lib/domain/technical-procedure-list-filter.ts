import { PROCEDURE_EQUIPMENT_TYPE_CODES, type ProcedureEquipmentType } from "./procedure-template-types";

/**
 * ============================================================================
 * [기술 작업 절차] 목록의 **이름 검색 · 설비 유형 거르기** — 순수 함수 (2026-11-05)
 * ============================================================================
 * 목록이 길어지면서 "찾는 절차가 어디 있는지"를 눈으로 훑어야 했다. 이 모듈은
 * 그 거르기 **규칙만** 들고 있다 — 화면도 상태도 서버도 모른다.
 *
 * ── 🔴 왜 순수 함수로 떼어 냈는가 ───────────────────────────────────────
 * 거르기가 붙는 화면(TechnicalProcedureTemplateListScreen)은 휴지통 서버 액션을
 * 직접 import 해서 사슬 끝에 `server-only` 가 있다 — 시험에서 import 자체가
 * 던진다. 그런데 이 규칙은 **삭제 사고와 직접 닿아 있다**(거른 뒤에 무엇을
 * 고를 수 있는가). 값으로 재지 못하면 안 되는 종류라, 재는 쪽이 닿을 수 있는
 * 자리에 둔다.
 *
 * ── 🔴 서버 질의는 건드리지 않는다 ──────────────────────────────────────
 * listTechnicalProcedureTemplates 는 그대로다. 이 목록은 수백 건 규모가 아니고
 * (TECHNICAL_TASK 계열이 개발 DB 에 세 줄기), 조회를 고치면 같은 조회를 쓰는
 * 다른 자리까지 따라 움직인다. **이미 받아 둔 줄**을 화면에서 걸러 낼 뿐이다.
 *
 * ── 🔴 이름으로만 찾는다 — 코드로는 안 찾는다 ───────────────────────────
 * 2026-11-05 에 절차의 내부 열쇠를 사람 눈에서 걷어냈다
 * (procedure-template-code.ts · procedure-code-hidden-screens.test.ts). 화면에
 * 없는 값으로 줄이 걸리면 "왜 이게 나오지?"가 되고, 반대로 "안 나올 리가 없는
 * 글자를 쳤는데 안 나온다"도 된다. 그래서 **보이는 글자(이름)만** 견준다.
 * 설비 유형은 표에도 카드에도 적혀 있으므로 거르개로 세워도 같은 규칙을 지킨다.
 *
 * ── 다듬기는 이웃과 같은 조리법, 모듈은 따로 ────────────────────────────
 * NFC → 연속 공백 하나 → 앞뒤 걷기 → 대소문자 접기(en-US 로 못 박아 터키어
 * 로케일에서 `i` 가 `İ` 가 되지 않게). 🔵 share-folder-entry-filter.ts 가 같은
 * 조리법을 쓰지만 **그 함수를 가져다 쓰지 않았다**: 그쪽의 다듬기는
 * share-folder-naming.ts 의 "디스크에 이미 있는 이름을 견줄 때의 모양"에
 * 묶여 있어서, 공유폴더 규칙이 바뀌는 날 절차 검색이 함께 움직인다. 둘은 같은
 * 이유로 움직여야 하는 사이가 아니다.
 * ============================================================================
 */

/** 거르개의 「전체」 — 설비 유형 enum 에는 없는, 화면에만 있는 값이다. */
export const PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL = "ALL";

export type ProcedureEquipmentTypeFilter = typeof PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL | ProcedureEquipmentType;

export type TechnicalProcedureListFilter = {
  /** 🔴 사람이 친 **날것**이다. 다듬기는 견줄 때만 한다. */
  nameQuery: string;
  equipmentType: ProcedureEquipmentTypeFilter;
};

/** 화면이 처음 뜨는 자리 — 아무것도 거르지 않는 상태. */
export const TECHNICAL_PROCEDURE_LIST_FILTER_NONE: TechnicalProcedureListFilter = {
  nameQuery: "",
  equipmentType: PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL,
};

/**
 * 거르기가 보는 칸 — 이름과 설비 유형, 그 둘뿐이다. 목록 행
 * (TechnicalProcedureTemplateListRow)과 계열의 대표가 모두 이 모양을 만족한다.
 */
export type TechnicalProcedureFilterable = {
  name: string;
  equipmentType: ProcedureEquipmentType;
};

/**
 * 견줄 모양으로 다듬는다. 친 글자와 줄 이름을 **같은 자리에서** 다듬는다 —
 * 한쪽만 다듬으면 "Mb" 로 "MB" 를 못 찾는다.
 */
export function normalizeProcedureNameQuery(value: string): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleUpperCase("en-US");
}

/**
 * 지금 **거르는 중인가**. 빈 칸과 공백뿐인 칸은 거르지 않는 것으로 본다 —
 * 0건일 때 무슨 말을 할지와, 「거르기 지우기」를 보일지를 가르는 자리다.
 */
export function isTechnicalProcedureListFilterActive(filter: TechnicalProcedureListFilter): boolean {
  return (
    normalizeProcedureNameQuery(filter.nameQuery) !== "" ||
    filter.equipmentType !== PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL
  );
}

/**
 * `<select>` 가 돌려준 글자를 거르개 값으로 읽는다. 모르는 값은 **「전체」**다 —
 * 거르개가 알 수 없는 값으로 굳어 목록이 통째로 비는 것보다, 안 거르는 쪽이
 * 사람이 손쓸 수 있는 상태다(fail-open 이지만 여기서 새는 것은 **보기**뿐이고
 * 삭제는 아래 고르기 규칙이 따로 막는다).
 */
export function parseProcedureEquipmentTypeFilter(value: string): ProcedureEquipmentTypeFilter {
  return (PROCEDURE_EQUIPMENT_TYPE_CODES as readonly string[]).includes(value)
    ? (value as ProcedureEquipmentType)
    : PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL;
}

/** 이 줄이 걸리는가 — 설비 유형은 **같아야** 하고, 이름은 **부분 일치**다(둘 다 만족해야 한다). */
export function matchesTechnicalProcedureListFilter(
  row: TechnicalProcedureFilterable,
  filter: TechnicalProcedureListFilter
): boolean {
  if (filter.equipmentType !== PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL && row.equipmentType !== filter.equipmentType) {
    return false;
  }
  const needle = normalizeProcedureNameQuery(filter.nameQuery);
  if (needle === "") return true;
  return normalizeProcedureNameQuery(row.name).includes(needle);
}

/**
 * 판(버전) 줄에서 걸리는 것만 남긴다 — **삭제 모드가 그리는 목록**이다.
 * 차례는 그대로다: 서버가 준 차례(생성일 내림차순)를 흔들지 않는다. 🔴 그 차례가
 * 곧 Shift 범위의 차례이므로, 여기서 다시 정렬하면 보이는 순서와 고르는 순서가
 * 어긋난다.
 */
export function filterTechnicalProcedureRows<T extends TechnicalProcedureFilterable>(
  rows: readonly T[],
  filter: TechnicalProcedureListFilter
): T[] {
  return rows.filter((row) => matchesTechnicalProcedureListFilter(row, filter));
}

/**
 * 계열 줄에서 걸리는 것만 남긴다 — **평소 목록**이다.
 *
 * 🔴 **대표의 이름으로** 견준다. 평소 목록은 계열당 한 줄이고 그 줄에 적히는
 * 이름은 대표 판의 것이다(TechnicalProcedureSeriesList). 판마다 이름이 다를 수
 * 있는데(개정하며 이름을 바꾼 판이 실제로 있다), 안 보이는 옛 판의 이름으로
 * 줄이 걸리면 "쳤는데 왜 이 줄이?"가 된다. **보이는 글자로 걸린다**가 이 화면의
 * 한 가지 규칙이다.
 *
 * 🔴 접기 자체는 **거르기 전 전체**로 한다(부르는 쪽이 그렇게 넘긴다). 거른 뒤에
 * 접으면 이름이 안 걸린 판이 빠지면서 대표가 바뀌고, 줄이 가리키는 상세가
 * 검색어에 따라 달라진다.
 */
export function filterTechnicalProcedureSeries<S extends { representative: TechnicalProcedureFilterable }>(
  series: readonly S[],
  filter: TechnicalProcedureListFilter
): S[] {
  return series.filter((one) => matchesTechnicalProcedureListFilter(one.representative, filter));
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 **화면에서 사라진 것의 고르기를 푼다** — 삭제 사고를 막는 자리
 * ────────────────────────────────────────────────────────────────────────────
 * 삭제 모드에서 몇 개를 고른 뒤 검색어를 바꾸면, 고른 것 중 일부가 화면에서
 * 사라진다. 그 선택을 그대로 두면 [선택 삭제]가 **사람이 보고 있지도 않은
 * 판**까지 가져간다. 되돌릴 수 있는(15일 휴지통) 종류이기는 하나, "몇 건을
 * 지우는지를 눈으로 셀 수 있어야 한다"는 이 저장소의 규칙
 * (common/select-all-checkbox.tsx 머리말)이 그 자리에서 깨진다.
 *
 * 🔵 이웃 두 화면(고객사 · 제품 모델)은 **다른 길**을 갔다 — 거기서는 검색어
 * 밖의 선택이 남고, 삭제 모드 바의 「N개 선택됨」과 확인 창의 이름 목록이 그
 * 사실을 말해 준다. 여기서는 푸는 쪽을 골랐다: 이 목록은 **같은 이름의 판이
 * 여러 줄** 서는 유일한 자리라(계열당 한 줄을 푼 것이 삭제 모드다), 확인 창의
 * 이름만으로는 어느 판이 딸려 왔는지 가릴 수 없다.
 *
 * 받은 Set 은 건드리지 않는다.
 */
export function pruneSelectionToVisible(
  selected: ReadonlySet<string>,
  visibleIds: Iterable<string>
): Set<string> {
  const visible = new Set(visibleIds);
  const next = new Set<string>();
  for (const id of selected) {
    if (visible.has(id)) next.add(id);
  }
  return next;
}
