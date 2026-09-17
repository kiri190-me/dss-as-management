import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { setDate, setFormula, setInlineString, setNumber } from "./sheet-patch";
import { createCellTextReader } from "./sheet-text";
import { parseSheetRows, resizeRowBlock, syncDimension, writeSheetRows, type SheetRow } from "./sheet-rows";
import {
  assertAscending,
  clearCellIfPresent,
  dropErrorValueCaches,
  dropExcludedWorkScopeLines,
  findItemBlock,
  findSpacedLabelRow,
  findLabelRow,
  ITEM_MARKER,
  LAYOUT_COLUMNS as COLUMNS,
  NO_WORK_SCOPE_EXCLUSIONS,
  renumberWorkScopeSectionMarks,
  type WorkScopeExclusions,
  type WorkScopeLabels,
} from "./quote-sheet-layout";
import {
  CALC_CHAIN_PART,
  CONTENT_TYPES_PART,
  enableFullCalcOnLoad,
  removeCalcChainOverride,
  removeCalcChainRelationship,
  resolveSheetPart,
  SHARED_STRINGS_PART,
  shiftPrintArea,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from "./workbook-parts";
import { validateQuoteInput, type QuoteInput } from "./quote-template";

/**
 * ============================================================================
 * 매쳐 견적서 — 줄 수가 정해져 있지 않은 양식을 채운다
 * ============================================================================
 * 제너레이터 양식(quote-template.ts, oh-quote-template.ts)은 칸 자리가 고정이라
 * **값만** 넣으면 됐다. 매쳐 양식은 다르다 — 사람이 그때그때 줄을 넣어 만든
 * 문서라 담을 것이 많으면 줄이 늘어야 한다:
 *
 *              매쳐 내자        매쳐 OH
 *   부품          2줄             7줄
 *   조사작업      6줄             6줄
 *   수리작업      2줄             3줄
 *   통전작업      6줄             6줄
 *
 * **내자와 OH 는 같은 판이고 줄 수만 다르다.** 그래서 채우개도 하나다. 어느
 * 파일을 열지만 견적서 종류가 정한다(storage/quote-template.ts).
 *
 * ── 🔴 행을 코드에 박지 않는다 ──────────────────────────────────────────
 * 위 표대로 같은 양식인데도 `조사작업` 이 내자는 34행, OH 는 39행이다. 행 번호를
 * 박아 두면 양식을 한 줄만 고쳐도 **엉뚱한 칸에 값이 앉는다**. 그래서 D열의
 * 머리글(`부품 비용`·`조사작업`…)을 찾아 자리를 정하고, 그 아래로 C열이 `-` 인
 * 줄이 이어지는 만큼을 그 묶음으로 본다.
 *
 * ── 🔴 아래에서부터 고친다 ──────────────────────────────────────────────
 * 위 묶음을 먼저 늘리면 아래 묶음의 시작 행이 이미 밀려 있어 엉뚱한 줄을 잡는다.
 * 통전 → 수리 → 조사 → 부품 순으로 고치고, 각 단계가 돌려준 이동량으로 나머지
 * 자리를 셈한다(다시 훑지 않는다 — 새로 복제된 줄은 아직 `-` 가 비어 있어서
 * 머리글 훑기로는 세어지지 않는다).
 *
 * ── 수식은 옮겨진 자리로 다시 쓴다 ──────────────────────────────────────
 * sheet-rows.ts 는 일부러 수식을 건드리지 않는다. 이 양식의 수식은 우리가 아는
 * 일곱 개뿐이라 여기서 다시 써 넣는다:
 *
 *   D15(금액) = I{공급가}                     ← 표 위의 요약. 자리는 안 움직인다.
 *   I{부품줄}  = H*G                          ← 줄마다
 *   I{작업비}  = H{작업비}
 *   I{공급가}  = SUM(I{부품첫줄}:I{공급가-1})
 *   I{부가세}  = I{공급가}*0.1
 *   I{합계}    = SUM(I{공급가}:I{부가세})
 *
 * `D25 = D14`(본문 제목)는 둘 다 우리가 미는 구간보다 위라 그대로 둔다.
 *
 * ⚠️ **부품 줄의 공유 수식을 보통 수식으로 갈아 끼운다.** OH 양식의 I28 이
 * `<f t="shared" ref="I28:I34">` 로 아래 여섯 줄을 거느리고 있어서, 줄 수가
 * 바뀌면 그 `ref` 가 실제와 어긋난다. 어긋난 공유 수식은 Excel 이 파일을 열 때
 * 거부하는 사유다. 줄마다 제 수식을 쓰면 거느릴 것이 없어진다.
 *
 * ── 인쇄 영역도 함께 민다 ───────────────────────────────────────────────
 * 이 양식은 `_xlnm.Print_Area` 가 합계보다 네 줄 아래까지 잡혀 있다. 줄이 늘면
 * 여기도 밀어야 한다 — 안 밀면 **합계 세 줄이 인쇄에서 잘린다.** 화면에서는
 * 멀쩡해 보이므로 미리보기로는 못 잡는 종류의 사고다.
 *
 * ── 계좌·회사 정보는 손대지 않는다 ──────────────────────────────────────
 * D20(은행계좌)과 3~7행은 양식에 적혀 있는 그대로 나간다. 계좌번호를 코드나
 * DB 에 두지 않기 위해서다(quote-template.ts 와 같은 판단).
 * ============================================================================
 */

/** 값을 채우는 시트. 내자·OH 양식 둘 다 이 이름이다. */
export const MATCHER_QUOTE_SHEET_NAME = "견적서";

/**
 * 머리 칸. 제너레이터 양식과 **한 줄씩 어긋난다**(제너레이터는 품명이 D13,
 * 매쳐는 D14). 실측한 값이라 추측으로 늘리지 말 것.
 */
export const MATCHER_QUOTE_CELLS = {
  quoteDate: "D10",
  quoteNumber: "D11",
  customerName: "D12",
  subject: "D14",
  /** 표 위의 요약 금액. 양식이 `=I54` 로 합계를 받아 쓴다. */
  amount: "D15",
  validity: "D17",
  delivery: "D18",
  payment: "D19",
} as const;

/** D열에서 찾는 머리글. 양식의 글자 그대로다. */
const BLOCK_LABELS = {
  parts: "부품 비용",
  labor: "작업 비용",
  INVESTIGATION: "조사작업",
  REPAIR: "수리작업",
  POWER_TEST: "통전작업",
  /**
   * 🔴 **머리글이 아니다 — `2) 수리작업` 아래의 `-` 항목 줄이다.** 빈 OH 양식에만
   * 인쇄돼 있고 빈 내자 양식에는 없다(2026-09-17 양식 둘의 C · D열 실측):
   *
   *   빈 OH 양식                    빈 내자 양식
   *   r46 C=∅   D=수리작업           r41 C=∅   D=수리작업
   *   r47 C=`-` D=바리콘 교환         r42 C=`-` D=고정 콘덴서 교환
   *   r48 C=`-` D=고정 콘덴서 추가     r43 C=`-` D=VDC 개조작업
   *   r49 C=`-` D=OH작업       ←     r44 C=∅   D=통전작업
   *   r50 C=∅   D=통전작업
   *
   * 🔴 그래서 **채우개가 덮어쓴다** — `fillScopeSection` 이 수리작업 묶음의 `-` 줄
   * 셋을 `workScope.REPAIR` 로 통째로 갈아 끼우므로, 앱이 채운 매쳐 OH 견적서에는
   * 이 글자가 남지 않는다. 남는 것은 **사람이 손으로 쓴 견적서**뿐이다.
   *
   * 채우개가 찾아 쓰는 글자는 아니지만 **양식에 인쇄된 D열 글자라 여기 한 곳에
   * 적는다**(아래 MATCHER_OVERHAUL_WORK_LABEL 머리말).
   */
  overhaulWork: "OH작업",
} as const;

/**
 * 🔴 **매쳐 양식의 작업 내역 머리글은 위 BLOCK_LABELS 한 곳에만 적혀 있다.**
 *
 * 화면이 쓸 기본 목록을 읽는 쪽(`storage/quote-template.ts`)이 이 값을 가져다
 * 쓴다 — 거기에 글자를 다시 적으면 한쪽만 고쳐지는 날이 오고, 그때 증상은
 * "화면에 뜨는 작업 내역과 파일에 적히는 작업 내역이 다른" 것이다.
 *
 * 매쳐 양식은 셋 다 머리글이 짧아 통째로 견준다(제너레이터의 `통전검사[출하검사]`
 * 처럼 뒤에 덧붙은 글자가 없다).
 */
export const MATCHER_WORK_SCOPE_LABELS: WorkScopeLabels = {
  INVESTIGATION: { label: BLOCK_LABELS.INVESTIGATION, match: "exact" },
  REPAIR: { label: BLOCK_LABELS.REPAIR, match: "exact" },
  POWER_TEST: { label: BLOCK_LABELS.POWER_TEST, match: "exact" },
};

/**
 * 🔴 **매쳐 OH 양식에만 인쇄돼 있는 수리작업 항목 줄.** 내자 양식에는 이 줄이 없다 —
 * 양식 둘을 직접 열어 확인했다(2026-09-17, 위 BLOCK_LABELS.overhaulWork 의 덤프).
 *
 * 수기 견적서 읽개(handwritten-quote-reader.ts)가 **매쳐 내자와 OH 를 가르는 유일한
 * 근거**로 쓴다 — 두 양식은 시트 이름이 「견적서」로 같고 머리 칸 지도도 같아서,
 * 시트 이름으로도 칸 자리로도 갈리지 않는다.
 *
 * 🔴 **어디까지 믿을 수 있나 — 제너레이터 O/H 의 OH_QUOTE_OVERHAUL_PARTS_LABEL 과는
 * 성격이 다르다.** 그쪽은 양식에 박힌 **머리글**이라 그 양식인 한 반드시 남지만, 이쪽은
 * `2) 수리작업` 아래의 **항목 줄**이라 지워질 수 있다:
 *  · 사람이 손으로 쓴 매쳐 OH 견적서 — 빈 양식에 인쇄돼 있는 줄을 그대로 두므로 남는다
 *    (사용자의 실제 견적서 둘에도 남아 있었다). **이 이름표가 듣는 자리는 여기다.**
 *  · 🔴 앱 채우개로 만든 매쳐 OH 견적서 — `fillScopeSection` 이 수리작업 줄을 통째로
 *    갈아 끼우므로 **남지 않는다.** 그 파일은 내자와 내용이 한 글자도 다르지 않아
 *    어떤 읽개도 가를 수 없고, 읽개는 내자로 읽는다(2026-09-17 실측 — 읽개 시험의
 *    `MATCHER:OVERHAUL` 왕복 항목에 그 까닭을 적어 두었다).
 *  · 사람이 그 줄을 지우고 쓴 견적서도 마찬가지다 — 「없음」이 내자라는 보장은 아니다.
 *
 * 여기 한 곳에만 적는다 — 읽개가 글자를 스스로 적으면 양식이 바뀌는 날 한쪽만
 * 고쳐진다(위 작업 내역 머리글과 같은 까닭).
 */
export const MATCHER_OVERHAUL_WORK_LABEL: string = BLOCK_LABELS.overhaulWork;

/**
 * H열에서 찾는 합계 머리글. 양식은 `공 급 가`·`합     계` 처럼 글자 사이를
 * 띄워 모양을 맞춰 두었다 — 공백을 지우고 견준다.
 */
const TOTAL_LABELS = { supply: "공급가", vat: "부가세", total: "합계" } as const;

/**
 * 세 묶음의 번호 모양(B열). 제너레이터의 `① ② ③` 과 다르다 — 조사작업을 지우면
 * 이 모양대로 당긴다(quote-sheet-layout.ts 의 renumberWorkScopeSectionMarks).
 */
const MATCHER_SECTION_MARKS = ["1)", "2)", "3)"] as const;

/**
 * `2. 작업 비용` 아래에 적히는 세 묶음. 키는 저장 쪽 구분과 같다
 * (validation/quote-input.ts 의 `QUOTE_WORK_SCOPE_SECTIONS`). 여기서 그 모듈을
 * 가져오지 않는 이유는, xlsx 층이 앱 층을 모르는 채로 남아 있어야 이 파일들을
 * 다른 곳에 떼어 쓸 수 있기 때문이다.
 */
export type MatcherWorkScope = {
  INVESTIGATION: readonly string[];
  REPAIR: readonly string[];
  POWER_TEST: readonly string[];
};

/**
 * 매쳐 양식은 OH 부품 칸이 따로 없다 — **부품이 한 목록**이다. 부르는 쪽이
 * 일반 부품과 O/H 부품을 합쳐 `parts` 로 넘긴다.
 *
 * `modelName`·`serialNumber`·`lotNumber` 는 쓰지 않는다. 제너레이터 양식에는
 * `MODEL: …, S/N:…` 을 적는 줄(D24)이 있지만 매쳐 양식에는 없고, 그 정보는 이미
 * 품명(D14)에 들어 있다(domain/quote-subject.ts).
 */
export type MatcherQuoteInput = QuoteInput & {
  workScope: MatcherWorkScope;
  /**
   * 켜면 「통전작업」 구역을 **머리글까지 문서에서 지운다.** 통전작업을 하지
   * 않아 작업비에서 그 몫을 뺐는데 문서에는 통전 시험 항목이 그대로 찍혀 나가면,
   * 하지 않은 시험을 했다고 적어 보내는 셈이다.
   *
   * 🔴 **번호를 당길 것이 없다.** 제너레이터 양식은 세 묶음 아래에 「④ 서류작업」
   * 이 하나 더 있어서, ③ 을 지우면 그 ④ 를 ③ 으로 당겨야 번호가 안 건너뛴다
   * (quote-sheet-layout.ts 의 `renumberPaperworkBlock`). 이 양식은 위 BLOCK_LABELS
   * 대로 `1) 조사작업 · 2) 수리작업 · 3) 통전작업` 에서 끝나므로, 맨 뒤인 3) 이
   * 빠지면 `1) 2)` 로 그대로 이어진다. 양식 넷을 실측해 확인했다 — 매쳐 둘에는
   * 서류작업 줄이 없다.
   *
   * 기본은 꺼짐이고, **주지 않으면 결과가 한 바이트도 달라지지 않는다.**
   * (제너레이터 양식의 같은 신호는 quote-template.ts 의 `GeneratorQuoteInput`.)
   */
  powerTestExcluded?: boolean;
  /**
   * 켜면 「조사작업」 구역을 **머리글까지 문서에서 지운다.** 사람이 조사 칸을 손대서
   * 비운 채 저장한 견적서다(quotes.investigation_excluded, 2026-09-15).
   *
   * 🔴 **이번에는 번호를 당긴다** — 맨 위를 지우므로 `2) 수리작업 · 3) 통전작업` 이
   * `1) · 2)` 가 되어야 한다(MATCHER_SECTION_MARKS). 기본은 꺼짐이고, **주지 않으면
   * 결과가 한 바이트도 달라지지 않는다.**
   */
  investigationExcluded?: boolean;
};

export function fillMatcherQuoteWorkbook(templateXlsx: Buffer, input: MatcherQuoteInput): Buffer {
  validateQuoteInput(input);

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, MATCHER_QUOTE_SHEET_NAME);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);

  const filled = fillSheet(
    archive.readText(sheetPart),
    archive.readTextOrNull(SHARED_STRINGS_PART),
    input
  );

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    // 행이 밀렸으니 계산 사슬은 통째로 낡았다. Excel 이 열 때 다시 만든다
    // (quote-template.ts 의 '재계산을 Excel 에 맡긴다').
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: toUtf8(filled.xml) });
    } else if (name === WORKBOOK_PART) {
      const workbook = shiftPrintArea(
        enableFullCalcOnLoad(bytes.toString("utf8")),
        MATCHER_QUOTE_SHEET_NAME,
        filled.rowShift
      );
      entries.push({ name, data: toUtf8(workbook) });
    } else if (hasCalcChain && name === CONTENT_TYPES_PART) {
      entries.push({ name, data: toUtf8(removeCalcChainOverride(bytes.toString("utf8"))) });
    } else if (hasCalcChain && name === WORKBOOK_RELS_PART) {
      entries.push({ name, data: toUtf8(removeCalcChainRelationship(bytes.toString("utf8"))) });
    } else {
      entries.push({ name, data: bytes });
    }
  }

  return writeZip(entries);
}

function toUtf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

/** 시트를 채운다. `rowShift` 는 표 아래가 통틀어 몇 줄 밀렸는지 — 인쇄 영역이 쓴다. */
function fillSheet(
  sheetXml: string,
  sharedStringsXml: string | null,
  input: MatcherQuoteInput
): { xml: string; rowShift: number } {
  const read = createCellTextReader(sheetXml, sharedStringsXml);
  const templateRows = parseSheetRows(sheetXml);

  // 없애기로 한 묶음. 켤 수 있는 것은 조사작업·통전작업이다 — 수리작업은 양식에
  // 기본 목록이 있어 빠질 일이 없다(domain 의 isRepairSectionDropped 가 매쳐엔 늘 거짓).
  const excluded: WorkScopeExclusions = {
    ...NO_WORK_SCOPE_EXCLUSIONS,
    INVESTIGATION: input.investigationExcluded === true,
    POWER_TEST: input.powerTestExcluded === true,
  };
  // 없앤 묶음의 줄은 여기서 비워진다 — 사라진 자리 아래 남의 줄에 적지 않도록.
  const workScope = dropExcludedWorkScopeLines(input.workScope, excluded);

  // ── 1) 양식에서 자리를 찾는다 ──────────────────────────────────────
  const parts = findItemBlock(templateRows, read, BLOCK_LABELS.parts);
  const laborRow = findLabelRow(templateRows, read, COLUMNS.name, BLOCK_LABELS.labor);
  const investigation = findItemBlock(templateRows, read, BLOCK_LABELS.INVESTIGATION);
  const repair = findItemBlock(templateRows, read, BLOCK_LABELS.REPAIR);
  const powerTest = findItemBlock(templateRows, read, BLOCK_LABELS.POWER_TEST);
  const supplyRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.supply);
  const vatRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.vat);
  const totalRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.total);

  // 아래 자리 셈은 이 차례를 전제로 한다. 양식이 뒤바뀌면 조용히 어긋난 문서를
  // 만드는 대신 여기서 멈춘다.
  assertAscending([
    [BLOCK_LABELS.parts, parts.headerRow],
    [BLOCK_LABELS.labor, laborRow],
    [BLOCK_LABELS.INVESTIGATION, investigation.headerRow],
    [BLOCK_LABELS.REPAIR, repair.headerRow],
    [BLOCK_LABELS.POWER_TEST, powerTest.headerRow],
    [TOTAL_LABELS.supply, supplyRow],
    [TOTAL_LABELS.vat, vatRow],
    [TOTAL_LABELS.total, totalRow],
  ]);

  // ── 2) 줄 수를 맞춘다 — 반드시 아래에서부터 ────────────────────────
  let rows: SheetRow[] = [...templateRows];
  const powerTestCount = workScope.POWER_TEST.length;
  const repairCount = workScope.REPAIR.length;
  const investigationCount = workScope.INVESTIGATION.length;
  const partCount = input.parts.length;

  /**
   * 🔴 통전작업을 없앨 때는 **머리글 행부터** 한 줄 더 세어 통째로 0줄로 만든다.
   * 그래야 돌려받는 이동량에 머리글 한 줄이 들어가고, 아래에서 셈하는 `rowShift`
   * 가 맞는다 — 여기서 한 줄을 빠뜨리면 공급가·부가세·합계가 엉뚱한 칸에 박힌다.
   */
  const resizedPowerTest = excluded.POWER_TEST
    ? resizeRowBlock(rows, {
        firstRow: powerTest.headerRow,
        currentCount: powerTest.count + 1,
        targetCount: 0,
      })
    : resizeRowBlock(rows, {
        firstRow: powerTest.firstRow,
        currentCount: powerTest.count,
        targetCount: powerTestCount,
      });
  rows = resizedPowerTest.rows;

  const resizedRepair = resizeRowBlock(rows, {
    firstRow: repair.firstRow,
    currentCount: repair.count,
    targetCount: repairCount,
  });
  rows = resizedRepair.rows;

  // 조사작업을 없앨 때도 통전작업과 같다 — 머리글 행부터 한 줄 더 세어 0줄로 만든다
  // (그 한 줄이 이동량에 들어가야 아래 공급가·부가세·합계가 제자리에 온다).
  const resizedInvestigation = excluded.INVESTIGATION
    ? resizeRowBlock(rows, {
        firstRow: investigation.headerRow,
        currentCount: investigation.count + 1,
        targetCount: 0,
      })
    : resizeRowBlock(rows, {
        firstRow: investigation.firstRow,
        currentCount: investigation.count,
        targetCount: investigationCount,
      });
  rows = resizedInvestigation.rows;

  const resizedParts = resizeRowBlock(rows, {
    firstRow: parts.firstRow,
    currentCount: parts.count,
    targetCount: partCount,
  });
  rows = resizedParts.rows;

  // ── 3) 옮겨진 자리를 셈한다 ────────────────────────────────────────
  // 부품이 밀면 그 아래 전부가 밀리고, 조사가 밀면 수리 아래가 밀린다.
  const afterParts = resizedParts.delta;
  const afterInvestigation = afterParts + resizedInvestigation.delta;
  const afterRepair = afterInvestigation + resizedRepair.delta;
  const rowShift = afterRepair + resizedPowerTest.delta;

  const at = {
    partsFirst: parts.firstRow,
    labor: laborRow + afterParts,
    investigationFirst: investigation.firstRow + afterParts,
    repairFirst: repair.firstRow + afterInvestigation,
    powerTestFirst: powerTest.firstRow + afterRepair,
    supply: supplyRow + rowShift,
    vat: vatRow + rowShift,
    total: totalRow + rowShift,
  };

  let xml = syncDimension(writeSheetRows(sheetXml, rows), rows);

  // ── 4) 값을 채운다 ────────────────────────────────────────────────
  xml = setDate(xml, MATCHER_QUOTE_CELLS.quoteDate, input.quoteDate);
  xml = setInlineString(xml, MATCHER_QUOTE_CELLS.quoteNumber, input.quoteNumber.trim());
  xml = setInlineString(xml, MATCHER_QUOTE_CELLS.customerName, input.customerName.trim());
  xml = setInlineString(xml, MATCHER_QUOTE_CELLS.subject, input.subject.trim());

  // 값을 준 것만 바꾼다. 안 주면 양식의 기본 문구가 그대로 남는다.
  const optional = [
    [input.validity, MATCHER_QUOTE_CELLS.validity],
    [input.delivery, MATCHER_QUOTE_CELLS.delivery],
    [input.payment, MATCHER_QUOTE_CELLS.payment],
  ] as const;
  for (const [value, cell] of optional) {
    if (value !== undefined) xml = setInlineString(xml, cell, value.trim());
  }

  input.parts.forEach((part, index) => {
    const row = at.partsFirst + index;
    // 복제된 줄은 `-` 까지 비워져 있다(sheet-rows.ts 의 blankRow). 줄마다 다시 쓴다.
    xml = setInlineString(xml, `${COLUMNS.marker}${row}`, ITEM_MARKER);
    xml = setInlineString(xml, `${COLUMNS.name}${row}`, part.name.trim());
    xml = setNumber(xml, `${COLUMNS.quantity}${row}`, part.quantity);
    xml = setNumber(xml, `${COLUMNS.unitPrice}${row}`, part.unitPrice);
    // 위 '공유 수식을 보통 수식으로' 참조.
    xml = setFormula(
      xml,
      `${COLUMNS.amount}${row}`,
      `${COLUMNS.unitPrice}${row}*${COLUMNS.quantity}${row}`
    );
  });

  xml = setNumber(xml, `${COLUMNS.quantity}${at.labor}`, 1);
  xml = setNumber(xml, `${COLUMNS.unitPrice}${at.labor}`, input.workCost);
  xml = setFormula(xml, `${COLUMNS.amount}${at.labor}`, `${COLUMNS.unitPrice}${at.labor}`);

  // 없앤 묶음은 목록이 비어 있어 아무 일도 일어나지 않는다 — 자리가 사라졌으므로
  // 적을 것도 없다(dropExcludedWorkScopeLines).
  xml = fillScopeSection(xml, at.investigationFirst, workScope.INVESTIGATION);
  xml = fillScopeSection(xml, at.repairFirst, workScope.REPAIR);
  xml = fillScopeSection(xml, at.powerTestFirst, workScope.POWER_TEST);

  // 조사작업을 지웠으면 그 아래 2) 수리작업 · 3) 통전작업의 번호를 하나씩 당긴다.
  // 맨 뒤 3) 만 지웠으면 자리가 바뀐 묶음이 없어 손대지 않는다. 머리글 행은 줄 수를
  // 맞춘 뒤의 자리다.
  xml = renumberWorkScopeSectionMarks(
    xml,
    excluded,
    {
      INVESTIGATION: investigation.headerRow + afterParts,
      REPAIR: repair.headerRow + afterInvestigation,
      POWER_TEST: powerTest.headerRow + afterRepair,
    },
    MATCHER_SECTION_MARKS
  );

  /**
   * 통전작업 마지막 줄과 공급가 사이의 금액 칸을 비운다. 이 자리는 양식이
   * 남겨 둔 여유 줄이고 합계 범위 안에 든다 — OH 양식의 견본에는 손으로 적은
   * 조정액(-6,000)이 남아 있었다. 우리 문서에는 우리 자료에 있는 것만 적힌다.
   *
   * 통전작업을 없앴으면 **머리글까지 사라졌으므로 한 줄 더 위**에서 시작한다.
   * 그 한 줄을 건너뛰면 밀려 올라온 여유 줄의 금액이 그대로 살아남는다.
   */
  const belowPowerTest = excluded.POWER_TEST
    ? powerTest.headerRow + afterRepair
    : at.powerTestFirst + powerTestCount;
  for (let row = belowPowerTest; row < at.supply; row += 1) {
    xml = clearCellIfPresent(xml, `${COLUMNS.amount}${row}`);
  }

  // ── 5) 옮겨진 자리로 수식을 다시 쓴다 ─────────────────────────────
  xml = setFormula(xml, MATCHER_QUOTE_CELLS.amount, `${COLUMNS.amount}${at.supply}`);
  xml = setFormula(
    xml,
    `${COLUMNS.amount}${at.supply}`,
    `SUM(${COLUMNS.amount}${at.partsFirst}:${COLUMNS.amount}${at.supply - 1})`
  );
  xml = setFormula(xml, `${COLUMNS.amount}${at.vat}`, `${COLUMNS.amount}${at.supply}*0.1`);
  xml = setFormula(
    xml,
    `${COLUMNS.amount}${at.total}`,
    `SUM(${COLUMNS.amount}${at.supply}:${COLUMNS.amount}${at.vat})`
  );

  return { xml: dropErrorValueCaches(xml), rowShift };
}

function fillScopeSection(sheetXml: string, firstRow: number, lines: readonly string[]): string {
  let xml = sheetXml;
  lines.forEach((line, index) => {
    const row = firstRow + index;
    xml = setInlineString(xml, `${COLUMNS.marker}${row}`, ITEM_MARKER);
    xml = setInlineString(xml, `${COLUMNS.name}${row}`, line.trim());
  });
  return xml;
}
