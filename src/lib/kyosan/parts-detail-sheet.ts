import { columnLettersToNumber, columnNumberToLetters, type GridCell } from "../xlsx/sheet-grid";
import { collapseWhitespace, isDashPlaceholder, normalizeKey, type GridLike } from "./card-grid";

/**
 * ============================================================================
 * 교산 연락서 판독기 — 「交換部品詳細」 시트 (2026-09-22)
 * ============================================================================
 * 🔴 **연락서 양식이 직접 지시하는 시트다.** Card 시트의 `５．処置` 머리글이
 * 「主原因の部品から選択し、残りは『交換部品詳細』ｼｰﾄに記入して…」 라고 적어 두었다 —
 * 주원인 부품만 Card 에 고르고 **나머지는 이 시트에 적으라**는 뜻이다. 그래서
 * Card 시트만 읽으면 교체 부품이 절반 이상 빠진다.
 *
 * 이 파일은 `card-fields.ts` 와 나란한 자리다 — `SheetGrid` 위에서 순수하게
 * 판독만 한다. DB 도 `server-only` 도 React 도 부르지 않는다.
 *
 * ── 실측 (2026-09-22, 연락서 472장 · 이 시트 636장) ────────────────────
 * 열 수 있었던 통합문서 472장 중 **연락서 469장 전부에** 이 시트가 있다. 남은
 * 3장은 연락서가 아니라 부품 출하증·빈 통합문서로, Card 시트도 없어
 * `readKyosanReport` 가 앞에서 이미 물린다. 그래도 **없으면 빈 목록**으로 둔다 —
 * 판본이 하나 더 나와 이 시트를 빼더라도 이식이 멈추면 안 된다.
 *
 * 시트 이름은 두 갈래다:
 *  · `交換部品詳細`          — 302장 (한 장에 시트 하나)
 *  · `交換部品詳細(RF)` + `交換部品詳細(DC)` — 167장 (한 장에 시트 **둘**)
 * 🔴 (RF)/(DC) 갈래를 한 시트만 읽으면 DC 부의 부품을 통째로 놓친다.
 *
 * ── 🔴 왜 고정 주소·고정 열을 쓰지 않는가 ──────────────────────────────
 * 실측한 머리글 배치가 **세 가지**다. 지시서가 적어 준 것은 그중 하나(C)뿐이었다:
 *
 *   A · 334시트 · 머리글 7행
 *       `B=措置 C=部品名 D=型式 E=仕様書番号 H=数量 I=対象 N=部品名リスト`
 *   B · 159시트 · 머리글 7행 + 40행(143시트) 또는 50행(16시트)
 *       `A=UNIT B=措置 C=部品名 E=型式 G=仕様書番号 I=数量 J=状況`
 *   C · 143시트 · 머리글 16행 + 29행 + 42행
 *       `B=部品名 / 型式 D=仕様書番号 / 型式 G=数量 H=状況`
 *
 * 같은 「수량」이 H · I · G 세 열에 앉고, 머리글 줄이 7 · 16 · 29 · 40 · 42 · 50 에
 * 앉는다. 그러므로 **머리글 줄을 글자로 찾아 그 줄에서 열을 배운다.** 한 시트에
 * 머리글이 여럿이면(묶음이 여럿이면) 각각을 따로 읽는다 — 실측으로 시트당 묶음이
 * 1개(334시트) · 2개(159시트) · 3개(143시트)다.
 *
 * ── 🔴 드롭다운 목록 열을 부품으로 읽지 않는다 ────────────────────────
 * 이 시트에는 사람이 고르는 **부품 이름 목록**이 숨은 열에 통째로 들어 있다 —
 * A 판본은 N 열(`部品名リスト`)과 O 열, B 판본은 N 열, C 판본은 L·M 열이다.
 * 오른쪽으로 훑으면 교산의 부품 대장 100여 가지가 전부 「이 건에서 갈았다」로
 * 들어온다. 그래서 **머리글에 이름이 적힌 열만** 읽고, 이름이 `部品名リスト` ·
 * `変更後リスト` 인 열은 일부러 버린다.
 *
 * ── 🔴 아래쪽 「판본 이력」 표에서 멈춘다 ──────────────────────────────
 * A 판본은 부품 표 **아래에** 양식 개정 이력 표를 달고 있다:
 *     `B=変更実施日 C=変更及び追加内容 K=変更者`
 *     `B=<날짜> C=部品名リスト追加 K=<사람 이름>`
 * `C` 가 부품명 열과 같은 자리라, 멈추지 않으면 `部品名リスト追加` ·
 * `交換部品名リスト化` 같은 글자가 부품으로 들어온다. 실측으로 **2,004줄**이
 * 그렇게 들어왔다(진짜 부품 줄은 1,315줄이다 — 가짜가 더 많았다).
 * 그래서 묶음은 **다음 머리글 줄이나 남의 표 머리글 줄에서 끝난다.**
 *
 * ── 상태값은 부품이 아니다 ─────────────────────────────────────────────
 * 🔴 실측이 지시서와 다르다. 지시서는 `状況`(상황) 칸에 `交換無し` 가 온다고 했지만,
 * 실제로 `状況`·`対象` 칸에 오는 값은 여덟 가지뿐이고 상태값은 없다 —
 * `修理`(779) · `O/H`(231) · `故障・修理`(108) · `予防措置`(56) · `改修`(10) ·
 * `最新仕様Verアップ`(10) · `改修・改造`(9) · 빈칸(112).
 * `交換無し` 는 **`部品名` 칸**에 온다(187줄). 「바꾼 것이 없다」는 상태값이지
 * 물건 이름이 아니므로 줄로 만들지 않는다(`report-terms.ts` 의 「상태값」 절).
 *
 * ── 고장분 · 예방분 ────────────────────────────────────────────────────
 * A·B 판본은 `措置` 칸이 `故障①`…`故障⑩` · `予防①`…`予防⑳` 로 **미리 찍혀 있다** —
 * 거기서 가른다. C 판본에는 `措置` 칸이 없어 `状況` 을 본다(`予防措置` 면 예방분).
 * 🔴 `状況` 은 A·B 판본에서 갈래가 아니다 — `措置=予防⑤` 인데 `状況=修理` 인 줄이
 * 실측 141줄이다. 그래서 `措置` 가 있으면 `状況` 은 보지 않는다.
 *
 * ── 🔴 고객 정보 ───────────────────────────────────────────────────────
 * 돌려주는 값에는 교산 쪽 부품 이름·형식번호가 그대로 들어 있다. 부르는 쪽은
 * 결과를 저장소 안 파일이나 바깥 서비스로 내보내지 않는다.
 * ============================================================================
 */

/** 시트 이름 앞머리. `normalizeKey` 로 누른 뒤 견준다(반각·전각·대소문자 흡수). */
const PARTS_DETAIL_SHEET_PREFIX = "交換部品詳細";

/**
 * 「交換部品詳細」 계열 시트 이름인가. `交換部品詳細` · `交換部品詳細(RF)` ·
 * `交換部品詳細(DC)` 셋이 실측의 전부다. 앞머리 일치를 쓰는 까닭은 (RF)/(DC)
 * 꼬리를 한 줄로 잡기 위해서다 — Card 시트와 달리 여기서는 남의 시트를 잘못
 * 집을 위험이 없다(`交換部品詳細` 로 시작하는 딴 시트가 실측에 없다).
 */
export function isPartsDetailSheetName(sheetName: string): boolean {
  return normalizeKey(sheetName).startsWith(PARTS_DETAIL_SHEET_PREFIX);
}

/** 통합문서의 시트 이름들 중 이 시트들만, 적힌 차례 그대로. */
export function pickPartsDetailSheetNames(sheetNames: readonly string[]): string[] {
  return sheetNames.filter(isPartsDetailSheetName);
}

/** 머리글 칸이 어느 구실을 하는가. `ignore` 는 드롭다운 목록 열, `foreign` 은 남의 표. */
type HeaderRole = "name" | "spec" | "quantity" | "status" | "measure" | "unit" | "ignore" | "foreign";

/**
 * 머리글 글자 → 구실. **정확히 같을 때만** 맞춘다(앞머리 일치가 아니다) —
 * `部品名リスト`(드롭다운 목록)가 `部品名` 으로 잡히면 교산 부품 대장이 통째로
 * 부품으로 들어오고, `単体(So側)型式：`(인수 정보 줄)이 `型式` 로 잡히면 모델명이
 * 부품으로 들어온다. 실측에서 둘 다 실제로 있는 글자다.
 */
const HEADER_ROLES: ReadonlyMap<string, HeaderRole> = new Map([
  // 🔴 드롭다운 목록 열 — 값이 아니라 고를 거리다. 버린다.
  ["部品名リスト", "ignore"],
  ["変更後リスト", "ignore"],
  // 🔴 아래쪽 「판본 이력」 표의 머리글. 여기서 묶음이 끝난다(위 머리말).
  ["変更実施日", "foreign"],
  ["変更及び追加内容", "foreign"],
  ["変更者", "foreign"],
  // 부품 표의 열들. `部品名 / 型式`(C 판본)은 공백을 눌러 `部品名/型式` 이 된다.
  ["部品名/型式", "name"],
  ["部品名", "name"],
  ["仕様書番号/型式", "spec"],
  ["仕様書番号", "spec"],
  ["型式", "spec"],
  ["数量", "quantity"],
  ["状況", "status"],
  ["対象", "status"],
  ["措置", "measure"],
  ["unit", "unit"],
]);

/**
 * 머리글 줄로 치려면 한 줄에 아는 글자가 몇 개 있어야 하는가. 둘이면 남의 표도
 * 알아본다(`変更実施日`+`変更及び追加内容`+`変更者` 는 셋이다).
 */
const HEADER_MIN_LABELS = 2;

/**
 * 한 묶음에서 아래로 몇 줄까지 볼 것인가. 실측 최대 폭은 57줄(A 판본의 두 묶음)
 * 이고, 실제 자료는 머리글 아래 20줄 안에 있다. 세 배 남겨 둔 멈춤막이다 —
 * 정상적으로는 언제나 다음 머리글이나 시트 끝에서 먼저 끝난다.
 */
const PARTS_BLOCK_MAX_ROWS = 200;

/**
 * 🔴 `部品名` 칸에 부품 이름 대신 적히는 **상태값**들. 「바꾼 것이 없다」는 뜻이라
 * 부품 줄로 만들지 않는다. 실측 187줄이 `交換無し` 이고, 나머지는 같은 뜻의
 * 표기 변이에 대비한 것이다. `report-terms.ts` 의 「상태값」 절과 같은 낱말이다.
 */
const STATE_ONLY_NAMES: ReadonlySet<string> = new Set([
  normalizeKey("交換無し"),
  normalizeKey("交換なし"),
  normalizeKey("交換無"),
]);

/** 예방분을 가리키는 앞머리. `措置=予防⑤` 는 NFKC 로 `予防5` 가 된다. */
const PREVENTIVE_PREFIX = normalizeKey("予防");

export type KyosanDetailPartKind = "fault" | "preventive";

/** 「交換部品詳細」 시트에서 읽은 부품 한 줄. */
export type KyosanDetailPart = {
  /**
   * 부품 이름. 🔴 `部品名` 칸이 비고 규격 칸만 적힌 줄에서는 **규격 글자**다
   * (실측 11줄 — D210102 의 `COM-CA-DNS` 가 그렇다). 이름이 하나도 없으면 줄을
   * 만들지 않으므로 여기는 언제나 값이 있다.
   */
  name: string;
  /** `型式`·`仕様書番号` 칸. 없으면 null. 이름으로 올려 쓴 줄에서도 null 이다. */
  spec: string | null;
  kind: KyosanDetailPartKind;
  /**
   * 🔴 `数量` 칸의 수. **적히지 않은 줄은 null** 이다(실측 30/1,315줄) — 부르는
   * 쪽이 1 로 본다. 0 이하·정수가 아닌 값도 null 로 둔다(`repair_case_used_parts`
   * 의 CHECK 가 0 이하를 막는다).
   */
  quantity: number | null;
  /** `状況`·`対象` 칸 글자 그대로. 없으면 null. */
  status: string | null;
  /** `措置` 칸 글자 그대로(`故障③`·`予防①`). 없으면 null. */
  measure: string | null;
  /** 어느 시트에서 왔는가 — (RF)/(DC) 를 가르는 데 쓴다. */
  sheetName: string;
  /** `C17` 꼴. 보고와 시험에서 어디를 읽었는지 말하려고 들고 있다. */
  address: string;
};

/** 한 줄에서 알아본 머리글 글자들 — 구실 → 열 번호들(오름차순). */
type RowLabels = { count: number; byRole: Map<HeaderRole, number[]> };

function readRowLabels(grid: GridLike, row: number): RowLabels {
  const byRole = new Map<HeaderRole, number[]>();
  let count = 0;
  for (const [letters, cell] of grid.cells(row)) {
    if (cell.kind !== "text") continue;
    const role = HEADER_ROLES.get(normalizeKey(cell.text));
    if (role === undefined) continue;
    count += 1;
    const columns = byRole.get(role) ?? [];
    columns.push(columnLettersToNumber(letters));
    byRole.set(role, columns);
  }
  for (const columns of byRole.values()) columns.sort((a, b) => a - b);
  return { count, byRole };
}

/** 부품 표의 머리글 줄인가 — 품명 열과 수량 열이 **둘 다** 있어야 한다. */
function isPartsHeaderRow(labels: RowLabels): boolean {
  return labels.count >= HEADER_MIN_LABELS && labels.byRole.has("name") && labels.byRole.has("quantity");
}

/** 묶음이 여기서 끝나는가 — 다음 머리글 줄이거나 남의 표 머리글 줄이다. */
function isBlockBoundaryRow(labels: RowLabels): boolean {
  return labels.byRole.has("foreign") || labels.count >= HEADER_MIN_LABELS;
}

/**
 * 칸 하나 → 값 글자. 빈칸 채움(`-`·`―`)은 값이 아니므로 null.
 * 숫자 칸은 그대로 숫자 글자로 돌려준다(`数量` 이 그렇게 온다).
 */
function cellText(grid: GridLike, row: number, column: number | undefined): string | null {
  if (column === undefined) return null;
  const cell: GridCell | undefined = grid.cells(row).get(columnNumberToLetters(column));
  if (!cell) return null;
  if (cell.kind === "number") return String(cell.value);
  const text = collapseWhitespace(cell.text);
  return text === "" || isDashPlaceholder(text) ? null : text;
}

/** 열들을 왼쪽부터 보아 처음 나오는 값. `型式` 이 `仕様書番号` 보다 왼쪽이다. */
function firstText(grid: GridLike, row: number, columns: readonly number[]): string | null {
  for (const column of columns) {
    const text = cellText(grid, row, column);
    if (text !== null) return text;
  }
  return null;
}

/** 수량 글자 → 1 이상의 정수, 아니면 null(부르는 쪽이 1 로 본다). */
function toQuantity(text: string | null): number | null {
  if (text === null) return null;
  const parsed = Number(text.normalize("NFKC").replace(/,/g, ""));
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * 고장분인가 예방분인가. `措置` 가 있으면 그것만 본다 — A·B 판본에서 `状況` 은
 * 갈래가 아니다(위 머리말). `措置` 가 없는 C 판본에서는 `状況` 을 본다.
 */
function toPartKind(measure: string | null, status: string | null): KyosanDetailPartKind {
  const source = measure ?? status;
  if (source !== null && normalizeKey(source).startsWith(PREVENTIVE_PREFIX)) return "preventive";
  return "fault";
}

/**
 * 시트 하나에서 부품 줄들을 읽는다. 머리글을 못 찾으면 **빈 배열** — 던지지
 * 않는다(469장을 한 번에 돌리는 쪽이 한 장 때문에 멈추면 안 된다).
 */
export function readPartsDetailSheet(grid: GridLike, sheetName: string): KyosanDetailPart[] {
  const labelsByRow = new Map<number, RowLabels>();
  for (const row of grid.rowNumbers) labelsByRow.set(row, readRowLabels(grid, row));

  const lastRow = grid.rowNumbers.length === 0 ? 0 : grid.rowNumbers[grid.rowNumbers.length - 1];
  const parts: KyosanDetailPart[] = [];

  for (const headerRow of grid.rowNumbers) {
    const header = labelsByRow.get(headerRow);
    if (!header || !isPartsHeaderRow(header)) continue;

    const nameColumn = header.byRole.get("name")?.[0];
    const specColumns = header.byRole.get("spec") ?? [];
    const quantityColumn = header.byRole.get("quantity")?.[0];
    const statusColumn = header.byRole.get("status")?.[0];
    const measureColumn = header.byRole.get("measure")?.[0];

    const stopRow = Math.min(lastRow, headerRow + PARTS_BLOCK_MAX_ROWS);
    for (let row = headerRow + 1; row <= stopRow; row++) {
      const labels = labelsByRow.get(row);
      if (labels && isBlockBoundaryRow(labels)) break;

      const name = cellText(grid, row, nameColumn);
      const spec = firstText(grid, row, specColumns);
      // 품명도 규격도 없으면 사람이 안 적은 줄이다(양식이 미리 그려 둔 빈 줄).
      if (name === null && spec === null) continue;
      // 🔴 「交換無し」 는 부품이 아니다(위 머리말).
      if (name !== null && STATE_ONLY_NAMES.has(normalizeKey(name))) continue;

      const measure = cellText(grid, row, measureColumn);
      const status = cellText(grid, row, statusColumn);
      parts.push({
        // 품명이 비면 규격을 이름으로 올려 쓴다 — 그러지 않으면 그 줄이 사라진다.
        name: name ?? (spec as string),
        spec: name === null ? null : spec,
        kind: toPartKind(measure, status),
        quantity: toQuantity(cellText(grid, row, quantityColumn)),
        status,
        measure,
        sheetName,
        address: `${columnNumberToLetters(nameColumn ?? 1)}${row}`,
      });
    }
  }

  return parts;
}
