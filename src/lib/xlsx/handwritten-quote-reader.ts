import { excelSerialToDateOnly } from "./excel-date";
import {
  MATCHER_QUOTE_CELLS,
  MATCHER_QUOTE_SHEET_NAME,
  MATCHER_WORK_SCOPE_LABELS,
} from "./matcher-quote-template";
import {
  OH_QUOTE_CELLS,
  OH_QUOTE_OVERHAUL_PARTS_LABEL,
  OH_QUOTE_SHEET_NAME,
  OH_QUOTE_WORK_SCOPE_LABELS,
} from "./oh-quote-template";
import { findSpacedLabelRow, LAYOUT_COLUMNS } from "./quote-sheet-layout";
import { QUOTE_CELLS, QUOTE_SHEET_NAME, QUOTE_WORK_SCOPE_LABELS } from "./quote-template";
import { findCell } from "./sheet-patch";
import {
  buildSheetGrid,
  parseSharedStringsWithoutPhonetics,
  readDate1904,
  type GridCell,
  type SheetGrid,
} from "./sheet-grid";
import { parseSheetRows } from "./sheet-rows";
import {
  resolveSheetPart,
  SHARED_STRINGS_PART,
  STYLES_PART,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from "./workbook-parts";
import { decodeXmlCharacterData } from "./xml-entities";
import { ZipArchive } from "./zip-reader";

/**
 * ============================================================================
 * 수기 견적서 엑셀(.xlsx) 읽개 — 붙인 엑셀에서 견적서 칸의 값을 뽑는다 (견적서 ①a)
 * ============================================================================
 * 엑셀 전용 견적서(quotes.is_excel_only)는 사람이 손으로 만든 엑셀을 「수기 견적서 엑셀」
 * 칸에 붙여 발행한다. 그런데 편집 폼의 필수 칸을 사람이 다시 손으로 적고 있었다. 이
 * 모듈은 그 엑셀에서 값을 **뽑아 돌려주기까지만** 한다 — 폼에 채우는 일은 ①b 가 한다.
 * 화면 · DB · 저장소를 모른다. 입력은 파일 바이트 하나다.
 *
 * ── 결과는 두 갈래, 내용 때문에 던지지 않는다 ──────────────────────────────
 *  · `{ ok: true, sheet, sheetIndex, sheetName, sheets, fields, warnings }` — 칸이 비거나
 *    이상하면 그 칸만 null 이고 까닭은 warnings 에 사람이 읽는 문장으로 싣는다.
 *  · `{ ok: false, code, message }` — 옛 .xls · xlsx 가 아님 · 알아볼 시트 없음 · 너무 큼 ·
 *    지정한 시트 없음.
 * 깨진 파일이 어디서 터지든 맨 바깥에서 받아 NOT_XLSX 로 돌려준다.
 *
 * ── 칸 지도는 채우개의 것을 그대로 쓴다 ────────────────────────────────────
 * 수기 엑셀은 앱 양식을 바탕으로 사람이 만든 것이다. 그래서 칸 주소를 여기 다시 적지
 * 않고 QUOTE_CELLS · OH_QUOTE_CELLS · MATCHER_QUOTE_CELLS 를 가져다 쓴다 — 두 벌이면
 * 양식이 바뀌는 날 한쪽만 고쳐진다. 공급가 줄도 채우개와 같은 방법(H열의 띄어 쓴
 * 「공 급 가」 를 공백을 지우고 견준다 — findSpacedLabelRow)으로 찾는다.
 *
 * ── 무엇이 들어 있나 — `sheets` ─────────────────────────────────────────
 * 알아보는 시트 이름은 「내자견적서」 · 「OH견적서」 · 「견적서」다. 그 시트마다 표지를
 * 하나씩 `sheets` 에 싣는다(탭 순서대로): `{ index, name, form, recognizedBy, filled }`.
 * 부르는 쪽은 이 목록을 사람에게 보이고, 사람이 고른 `index` 를 아래 `sheetIndex` 로
 * 돌려주면 된다.
 *
 *  · `form` — **양식에 인쇄된 머리글(D열)로 가른다.** 탭 이름은 사람이 바꿀 수 있지만
 *    머리글은 안 바뀐다. 「OH 및 수리 작업」 · 「OH 부품 비용」 은 O/H 양식에만,
 *    「수리 작업」 은 내자 양식에만, 「조사작업 · 수리작업 · 통전작업」 은 매쳐 양식에만
 *    있다(글자는 채우개가 들고 있는 것을 가져다 쓴다 — 머리말 '칸 지도'와 같은 까닭).
 *    🔴 머리글로 **가를 수 있을 때만** 이름을 앞선다. 못 가르면(② 묶음을 지우고 발행한
 *    견적서가 그렇다) 탭 이름으로 간다 — `recognizedBy` 가 어느 쪽이었는지 말해 준다.
 *  · `filled` — **품목 · 작업 줄의 단가(H) · 금액(I) 칸에 0 이 아닌 금액이 있나.**
 *    🔴 발행번호를 근거로 쓰지 않는다. O/H 시트의 발행번호는 내자 칸을 따라가는
 *    수식(`내자견적서!D11&"-1"`)이라 **언제나 채워져 보인다.** 품명 · 부품 이름도 쓰지
 *    않는다 — 빈 양식에 예시가 인쇄돼 있다(내자 양식의 「1번 부품」, O/H 양식의 O/H 부품
 *    목록). 빈 양식의 그 칸들은 비어 있거나 0 이다(2026-09-17 양식 넷을 실측).
 *    ⚠️ 「작성됐나」는 사람이 고를 때의 **참고**다 — 가름막이 아니라서 목록에는 늘 다 싣는다.
 *    실제로 제너레이터 내자 양식 파일에 함께 든 O/H 시트는 빈 양식인데도 작업비 240만이
 *    인쇄돼 있어 `filled` 가 true 다(그 240만은 진짜로 적혀 있는 금액이다).
 *
 * ── 어느 시트를 읽나 ────────────────────────────────────────────────────
 * `options.sheetIndex` 를 주면 **그 탭을 읽는다**(위 `sheets[].index`). 그 자리에 알아보는
 * 견적서 시트가 없으면 조용히 딴 것을 읽지 않고 SHEET_NOT_FOUND 로 돌려준다.
 *
 * 안 주면 지금까지 하던 대로 혼자 고른다. 제너레이터 내자 양식은 한 통합문서에 내자 ·
 * OH 두 시트를 다 갖고, OH 시트의 발행번호 칸은 위에서 본 수식이라 **둘 다 채워져 보이는
 * 것이 보통**이다.
 *  1) 발행번호 칸이 채워진 시트가 하나면 그것.
 *  2) 여럿이면 통합문서의 활성 시트(workbook.xml 의 workbookView@activeTab — 없으면 0,
 *     첫 탭)가 그 가운데 있으면 그것. 사람이 마지막으로 보던 탭이 그 사람이 쓴 견적서다.
 *  3) 그래도 못 가르면 **탭 순서의 첫 시트**를 고르고 경고를 싣는다.
 *  4) 하나도 안 채워졌으면 활성 시트가 견적서 시트면 그것(경고 없음 — 칸이 비어 있을
 *     뿐이다), 아니면 탭 순서의 첫 견적서 시트 + 경고.
 * 🔴 이 네 갈래는 `activeTab` 이 없는 파일에서 **늘 내자 시트로 떨어진다** — 사람이 OH 를
 * 고를 길이 없었다. 그래서 위의 `sheets` · `sheetIndex` 를 더했다(2026-09-17).
 *
 * ── 견적서 종류 ─────────────────────────────────────────────────────────
 * 「내자견적서」 → DOMESTIC, 「OH견적서」 → OVERHAUL. 🔴 매쳐(「견적서」)는 **null** 이다 —
 * 내자 · OH 양식이 같은 시트 이름이라 시트로 가를 수 없고, DOMESTIC 으로 짐작하면 폼이
 * 사람이 고른 OH 를 내자로 덮을 수 있다. 모르면 비워 두고 그 사실을 경고로 싣는다
 * (2026-09-16 메인 결정 — 「못 빼는 쪽이 기본」과 같은 판단).
 *
 * ── 모델 · L/N · S/N ────────────────────────────────────────────────────
 * 제너레이터 양식 D24 의 `MODEL: …, S/N:…, L/N:…` 한 줄(buildProductInfoLine 이 만드는
 * 모양)일 때만 나눈다. 대소문자 · 콜론 앞뒤 공백 · 전각 콜론 · 순서는 느슨하게 받고, 그
 * 밖의 조각이 하나라도 섞이면 셋 다 비우고 원문을 경고로 싣는다. 매쳐 양식에는 그 줄이
 * 없다(모델은 품명에 들어 있다 — matcher-quote-template.ts 의 MatcherQuoteInput 주석).
 * 🔴 신고증상은 어느 양식에도 칸이 없어 읽지 않는다.
 *
 * ── 발행일자 · 공급가액 ─────────────────────────────────────────────────
 *  · 수식 칸은 저장된 계산값(`<v>`)을 읽는다. Excel 로 저장한 파일에만 있다 — 없으면 null.
 *  · 발행일자: 날짜 서식의 숫자(일련번호)면 `YYYY-MM-DD`, 글자면 알아보는 모양만 받는다.
 *    **UTC 산술만** 쓴다(excel-date.ts · Date.UTC) — 서버 시간대로 하루 밀리지 않는다.
 *    달력에 없는 날은 null + 경고. TODAY() 수식이면 값은 읽되 경고를 싣는다 — 그것은
 *    '발행일'이 아니라 '마지막으로 계산한 날'이다.
 *  · 공급가액: 「공 급 가」 줄의 금액 칸 → 비었으면 요약 칸(D14 · 매쳐 D15). 음수 · 숫자
 *    아님은 null + 경고. 금액은 저장소에서 문자열로 오가므로 `"3500000"` 꼴로 돌려준다
 *    (소수 둘째 자리까지 — validation/quote-input.ts 의 금액 규칙).
 *    글자로 적힌 금액은 흔한 모양만 받는다 — 천 단위 콤마 · 앞의 ₩(￦) · 뒤의 「원」 ·
 *    소수 둘째 자리까지. 받아도 경고를 한 줄 싣는다(사람이 확인하도록). 콤마 자리가 틀린
 *    것 · 음수 · 괄호 음수 · 다른 글자 · 「만」 단위는 null + 경고다(2026-09-16 메인 결정).
 *
 * ── 🔴 안전 — 믿을 수 없는 파일을 서버에서 푼다 ─────────────────────────────
 *  · zip-reader.ts 에는 **상한이 없다**(readEntry 의 maxOutputLength 는 부르는 쪽이
 *    줘야 걸린다). 그래서 이 모듈이 읽는 파트는 전부 `readPart` 한 곳을 지나며, 파트
 *    하나 · 합계 · 엔트리 수에 상한을 건다(HANDWRITTEN_QUOTE_READ_LIMITS). 상한은 zip 에
 *    **적힌** 크기가 아니라 **실제로 풀린** 바이트로 잰다 — 적힌 크기는 거짓말할 수 있다.
 *  · resolveSheetPart(workbook-parts.ts)는 workbook.xml 과 관계 파트를 상한 없이 다시
 *    푼다. 그래서 그 둘을 **먼저 상한 안에서 한 번 풀어 본다** — 같은 바이트는 같은
 *    크기로 풀리므로 뒤의 재읽기도 그 크기를 넘지 않는다.
 *  · xlsx-upload-safety.ts 의 검사를 쓰지 않는 까닭: 매크로 · 외부 링크 · DDE 를 거절
 *    하는데, 이 모듈은 아무것도 실행하거나 따라가지 않고 저장된 값만 읽는다(옛 OH 양식은
 *    외부 링크를 달고 있었다). 그리고 그 검사는 워크시트 밖의 파트를 적힌 크기로만 본다.
 *  · XML 은 기존 정규식 도구로만 읽는다. DTD · 외부 엔티티를 푸는 파서가 없고, 엔티티는
 *    이름 있는 다섯 개와 숫자 참조만 푼다(xml-entities.ts).
 *  · 🔴 후리가나: sheet-text.ts 는 공유문자열의 `<rPh>` 를 걷지 않는다(HANDOFF Y18-5).
 *    여기서는 걷는 쪽(sheet-grid.ts)을 쓴다.
 *  · 값을 로그에 찍지 않는다 — 이 모듈에는 console 이 없다.
 * ============================================================================
 */

export type HandwrittenQuoteSheet = "GENERATOR_DOMESTIC" | "GENERATOR_OH" | "MATCHER";

/** 저장 쪽 QuoteKind(validation/quote-input.ts)와 같은 값. xlsx 층은 앱 층을 가져오지 않는다. */
export type HandwrittenQuoteKind = "DOMESTIC" | "OVERHAUL";

/**
 * 뽑은 값. 이름은 저장 쪽 QuoteFields 의 칸 이름을 따랐다(①b 가 그대로 옮겨 담도록).
 * 모두 null 일 수 있다 — 칸이 비었거나 읽지 못한 것이다(까닭은 warnings).
 */
export type HandwrittenQuoteFields = {
  kind: HandwrittenQuoteKind | null;
  quoteNumber: string | null;
  /** `YYYY-MM-DD`. 실제 달력에 있는 날만. */
  quoteDate: string | null;
  customerNameText: string | null;
  subject: string | null;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  validity: string | null;
  delivery: string | null;
  payment: string | null;
  /** 공급가액(부가세 별도). 0 이상, 소수 둘째 자리까지의 숫자 문자열. */
  manualSupplyAmount: string | null;
};

export type HandwrittenQuoteReadFailureCode =
  | "XLS_LEGACY"
  | "NOT_XLSX"
  | "NO_QUOTE_SHEET"
  | "CONTENT_TOO_LARGE"
  | "SHEET_NOT_FOUND";

/** 그 시트의 양식을 무엇으로 갈랐나 — 양식에 인쇄된 머리글인가, 탭 이름인가(머리말). */
export type HandwrittenQuoteFormSource = "header" | "name";

/**
 * 통합문서에 든 견적서 시트 하나의 표지(머리말 '무엇이 들어 있나'). 값을 읽지는 않는다 —
 * 「어떤 견적서가 들어 있나」를 사람에게 보여 주고 고르게 하려고 싣는다.
 */
export type HandwrittenQuoteSheetInfo = {
  /** 탭 차례(0부터). 이 값을 그대로 `options.sheetIndex` 로 돌려주면 그 시트를 읽는다. */
  index: number;
  /** 탭 이름. */
  name: string;
  /** 어느 양식인가. 머리글로 가른 것이 먼저고, 못 가르면 탭 이름이다. */
  form: HandwrittenQuoteSheet;
  recognizedBy: HandwrittenQuoteFormSource;
  /** 작성된 것으로 보이나 — 품목 · 작업 줄에 0 이 아닌 금액이 있나(머리말). */
  filled: boolean;
};

export type HandwrittenQuoteReadResult =
  | {
      ok: true;
      /** 읽은 시트의 양식. */
      sheet: HandwrittenQuoteSheet;
      /** 읽은 시트의 탭 차례(0부터) · 탭 이름. */
      sheetIndex: number;
      sheetName: string;
      /** 알아본 견적서 시트 전부, 탭 순서대로. 읽은 것 하나만 있는 것이 아니다. */
      sheets: HandwrittenQuoteSheetInfo[];
      fields: HandwrittenQuoteFields;
      warnings: string[];
    }
  | { ok: false; code: HandwrittenQuoteReadFailureCode; message: string };

/**
 * 풀어 읽는 양의 상한. 이 모듈이 푸는 파트는 workbook.xml · 관계 · 공유문자열 · 서식 ·
 * 견적서 시트(많아야 셋)뿐이다. 앱 양식으로 만든 견적서는 통합문서 전체가 100KB 안팎이라
 * 넉넉하다. 넘으면 CONTENT_TOO_LARGE 로 거절한다.
 */
export const HANDWRITTEN_QUOTE_READ_LIMITS = {
  maxZipEntries: 2_000,
  /** 파트 하나를 풀었을 때의 바이트. */
  maxPartBytes: 8 * 1024 * 1024,
  /** 이 모듈이 푼 파트들의 합계 바이트. */
  maxTotalPartBytes: 32 * 1024 * 1024,
} as const;

export type HandwrittenQuoteReadLimits = {
  [K in keyof typeof HANDWRITTEN_QUOTE_READ_LIMITS]: number;
};

export const HANDWRITTEN_QUOTE_FAILURE_MESSAGES: Record<HandwrittenQuoteReadFailureCode, string> = {
  XLS_LEGACY:
    "옛 엑셀 형식(.xls)입니다 — 엑셀에서 [다른 이름으로 저장] › Excel 통합 문서(.xlsx)로 저장해 다시 올려 주세요",
  NOT_XLSX:
    "엑셀 통합 문서(.xlsx)로 읽을 수 없는 파일입니다. 엑셀에서 연 뒤 Excel 통합 문서(.xlsx)로 다시 저장해 올려 주세요.",
  NO_QUOTE_SHEET:
    "견적서 시트(내자견적서 · OH견적서 · 견적서)를 찾지 못했습니다. 앱 양식을 바탕으로 만든 견적서 엑셀인지 확인해 주세요.",
  CONTENT_TOO_LARGE:
    "엑셀 파일 안의 내용이 너무 커서 읽지 않았습니다. 견적서 시트만 남긴 파일로 다시 올려 주세요.",
  SHEET_NOT_FOUND:
    "고르신 시트를 엑셀에서 찾지 못했습니다. 파일이 바뀌었을 수 있습니다 — 파일을 다시 고른 뒤 시트를 골라 주세요.",
};

// ── 양식 셋의 칸 지도 — 채우개의 것을 그대로 ─────────────────────────────

type FieldCells = {
  readonly quoteDate: string;
  readonly quoteNumber: string;
  readonly customerName: string;
  readonly subject: string;
  /** 표 위의 요약 금액(공급가를 가리키는 수식). */
  readonly amount: string;
  readonly validity: string;
  readonly delivery: string;
  readonly payment: string;
  /** `MODEL: …, S/N:…, L/N:…` 한 줄. 매쳐 양식에는 없다. */
  readonly productInfo: string | null;
};

type SheetLayout = {
  sheet: HandwrittenQuoteSheet;
  sheetName: string;
  /** 시트 이름으로 가를 수 없으면 null(매쳐 — 머리말 '견적서 종류'). */
  kind: HandwrittenQuoteKind | null;
  cells: FieldCells;
};

const SHEET_LAYOUTS: readonly SheetLayout[] = [
  { sheet: "GENERATOR_DOMESTIC", sheetName: QUOTE_SHEET_NAME, kind: "DOMESTIC", cells: QUOTE_CELLS },
  { sheet: "GENERATOR_OH", sheetName: OH_QUOTE_SHEET_NAME, kind: "OVERHAUL", cells: OH_QUOTE_CELLS },
  {
    sheet: "MATCHER",
    sheetName: MATCHER_QUOTE_SHEET_NAME,
    kind: null,
    cells: { ...MATCHER_QUOTE_CELLS, productInfo: null },
  },
];

/**
 * 🔴 **양식을 가르는 머리글**(D열, 통째로 견준다). 머리말 '무엇이 들어 있나'.
 *
 * 글자는 채우개가 들고 있는 것을 가져다 쓴다 — 여기 다시 적으면 양식이 바뀌는 날 한쪽만
 * 고쳐진다(머리말 '칸 지도'와 같은 까닭).
 *
 * ⚠️ 여기 없는 것: 두 양식이 함께 쓰는 「인수 조사」 · 「통전검사」 · 「부품 비용」 —
 * 있어도 어느 양식인지 말해 주지 않는다. 가를 수 없으면 탭 이름으로 간다.
 *
 * 양식끼리 글자가 겹치지 않는다 — O/H 의 ② 는 「OH 및 수리 작업」, 내자는 「수리 작업」,
 * 매쳐는 띄어쓰기 없는 「수리작업」 이라 **통째로** 견주면 갈린다.
 */
const FORM_HEADERS: readonly { sheet: HandwrittenQuoteSheet; labels: readonly string[] }[] = [
  {
    sheet: "GENERATOR_OH",
    labels: [OH_QUOTE_WORK_SCOPE_LABELS.REPAIR.label, OH_QUOTE_OVERHAUL_PARTS_LABEL],
  },
  { sheet: "GENERATOR_DOMESTIC", labels: [QUOTE_WORK_SCOPE_LABELS.REPAIR.label] },
  {
    sheet: "MATCHER",
    labels: [
      MATCHER_WORK_SCOPE_LABELS.INVESTIGATION.label,
      MATCHER_WORK_SCOPE_LABELS.REPAIR.label,
      MATCHER_WORK_SCOPE_LABELS.POWER_TEST.label,
    ],
  },
];

/** H열의 합계 머리글. 양식은 `공 급 가` 로 띄워 두었다 — findSpacedLabelRow 가 공백을 지우고 견준다. */
const SUPPLY_LABEL = "공급가";

const MATCHER_KIND_WARNING =
  "매쳐 양식은 내자 · OH 가 같은 시트 이름(견적서)이라 가를 수 없어 견적서 종류를 비워 둡니다 — 종류를 직접 골라 주세요.";

/** Excel 97-2003(.xls)은 OLE2 복합 문서다 — attachment-allowlist.ts 의 OLE2_MAGIC 과 같은 8바이트. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ZIP_LOCAL_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

/** validation/quote-input.ts 의 AMOUNT_PATTERN(정수 13자리 · 소수 2자리)이 받는 가장 큰 값. */
const MAX_AMOUNT = 9_999_999_999_999.99;

/** 1900 체계의 9999-12-31. 그 뒤는 달력 날짜로 쓰지 않는다. */
const MAX_DATE_SERIAL = 2_958_465;

// ── 들어가는 곳 ─────────────────────────────────────────────────────────

/** 안쪽에서 던져 맨 바깥의 한 곳에서 실패 결과로 바꾸는 표지. 밖으로 새지 않는다. */
class ReadFailure extends Error {
  readonly code: HandwrittenQuoteReadFailureCode;

  constructor(code: HandwrittenQuoteReadFailureCode) {
    super(code);
    this.code = code;
  }
}

export function readHandwrittenQuoteWorkbook(
  input: Uint8Array,
  options: {
    limits?: Partial<HandwrittenQuoteReadLimits>;
    /**
     * 읽을 시트의 탭 차례(0부터 — 결과의 `sheets[].index`). 안 주면 읽개가 혼자 고른다
     * (머리말 '어느 시트를 읽나'). 그 자리에 견적서 시트가 없으면 SHEET_NOT_FOUND 다.
     */
    sheetIndex?: number;
  } = {}
): HandwrittenQuoteReadResult {
  const limits: HandwrittenQuoteReadLimits = { ...HANDWRITTEN_QUOTE_READ_LIMITS, ...options.limits };
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  if (startsWith(bytes, OLE2_SIGNATURE)) return failure("XLS_LEGACY");
  if (!startsWith(bytes, ZIP_LOCAL_SIGNATURE)) return failure("NOT_XLSX");

  try {
    return readWorkbook(bytes, limits, options.sheetIndex);
  } catch (error) {
    // 깨진 zip · 깨진 XML 이 어디서 터졌든 여기서 멈춘다(머리말 '던지지 않는다').
    return failure(error instanceof ReadFailure ? error.code : "NOT_XLSX");
  }
}

function failure(code: HandwrittenQuoteReadFailureCode): HandwrittenQuoteReadResult {
  return { ok: false, code, message: HANDWRITTEN_QUOTE_FAILURE_MESSAGES[code] };
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

type Candidate = {
  /** 탭 차례(0부터)와 탭 이름 — 사람이 고를 때 쓰는 표지다. */
  index: number;
  name: string;
  /** 머리글로 가른 양식(못 가르면 탭 이름의 양식)의 칸 지도. */
  layout: SheetLayout;
  recognizedBy: HandwrittenQuoteFormSource;
  filled: boolean;
  sheetXml: string;
  grid: SheetGrid;
};

function infoOf(candidate: Candidate): HandwrittenQuoteSheetInfo {
  return {
    index: candidate.index,
    name: candidate.name,
    form: candidate.layout.sheet,
    recognizedBy: candidate.recognizedBy,
    filled: candidate.filled,
  };
}

function readWorkbook(
  bytes: Buffer,
  limits: HandwrittenQuoteReadLimits,
  sheetIndex: number | undefined
): HandwrittenQuoteReadResult {
  let archive: ZipArchive;
  try {
    archive = ZipArchive.fromBuffer(bytes);
  } catch {
    throw new ReadFailure("NOT_XLSX");
  }
  if (archive.entryCount() > limits.maxZipEntries) throw new ReadFailure("CONTENT_TOO_LARGE");
  // 이름이 같은 엔트리가 둘이면 Excel 이 보는 것과 우리가 읽는 것이 다를 수 있다.
  if (archive.hasDuplicateEntryNames()) throw new ReadFailure("NOT_XLSX");

  const readPart = createBoundedPartReader(archive, limits);

  const workbookXml = readPart(WORKBOOK_PART);
  // resolveSheetPart 가 이 두 파트를 상한 없이 다시 읽는다 — 먼저 상한 안에서 풀어 본다(머리말).
  if (workbookXml === null || readPart(WORKBOOK_RELS_PART) === null) {
    throw new ReadFailure("NOT_XLSX");
  }

  const sharedStrings = parseSharedStringsWithoutPhonetics(readPart(SHARED_STRINGS_PART));
  const date1904 = readDate1904(workbookXml);
  const tabNames = readSheetNames(workbookXml);

  const candidates: Candidate[] = [];
  for (const [index, name] of tabNames.entries()) {
    const byName = SHEET_LAYOUTS.find((candidate) => candidate.sheetName === name);
    // 이름이 같은 탭이 둘이면 뒤엣것은 같은 파트를 가리킨다 — 한 번만 담는다.
    if (!byName || candidates.some((candidate) => candidate.name === name)) continue;

    let part: string;
    try {
      part = resolveSheetPart(archive, name);
    } catch {
      continue; // 관계가 깨진 시트 — 없는 것으로 본다.
    }
    const sheetXml = readPart(part);
    if (sheetXml === null) continue;

    const grid = buildSheetGrid(sheetXml, sharedStrings, date1904);
    // 양식 머리글이 탭 이름을 앞선다 — 가를 수 있을 때만(머리말 '무엇이 들어 있나').
    const fromHeader = formFromHeaders(grid);
    candidates.push({
      index,
      name,
      layout: fromHeader === null ? byName : layoutOf(fromHeader),
      recognizedBy: fromHeader === null ? "name" : "header",
      filled: looksFilled(grid),
      sheetXml,
      grid,
    });
  }
  if (candidates.length === 0) throw new ReadFailure("NO_QUOTE_SHEET");

  const warnings: string[] = [];
  const activeName = tabNames[readActiveTabIndex(workbookXml)] ?? null;
  const chosen =
    sheetIndex === undefined
      ? chooseSheet(candidates, activeName, warnings)
      : pickSheet(candidates, sheetIndex);

  return {
    ok: true,
    sheet: chosen.layout.sheet,
    sheetIndex: chosen.index,
    sheetName: chosen.name,
    sheets: candidates.map(infoOf),
    fields: readFields(chosen, () => readPart(STYLES_PART), warnings),
    warnings,
  };
}

/**
 * 이 모듈의 파트 읽기는 전부 여기를 지난다 — 파트 하나 · 합계 상한(머리말 '안전').
 * 없는 파트는 null. 상한을 넘거나 풀지 못하면 ReadFailure 를 던진다.
 */
function createBoundedPartReader(
  archive: ZipArchive,
  limits: HandwrittenQuoteReadLimits
): (name: string) => string | null {
  let total = 0;
  return (name) => {
    if (!archive.has(name)) return null;
    let bytes: Buffer | null;
    try {
      bytes = archive.readEntry(name, limits.maxPartBytes);
    } catch (error) {
      throw new ReadFailure(isOutputLimitError(error) ? "CONTENT_TOO_LARGE" : "NOT_XLSX");
    }
    if (bytes === null) return null;
    total += bytes.length;
    if (total > limits.maxTotalPartBytes) throw new ReadFailure("CONTENT_TOO_LARGE");
    return bytes.toString("utf8");
  };
}

/** 풀린 크기가 상한을 넘었다 — deflate 는 zlib 의 ERR_BUFFER_TOO_LARGE, 무압축은 zip-reader 의 문장. */
function isOutputLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") return true;
  return error instanceof Error && error.message.includes("exceeds configured output limit");
}

/** 탭 순서대로의 시트 이름. */
function readSheetNames(workbookXml: string): string[] {
  const sheets = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/.exec(workbookXml)?.[1] ?? "";
  return [...sheets.matchAll(/<sheet\b[^>]*>/g)].map((tag) =>
    decodeXmlCharacterData(/\sname="([^"]*)"/.exec(tag[0])?.[1] ?? "")
  );
}

/** `bookViews/workbookView@activeTab` — 탭 순서의 0부터. 없으면 0(첫 탭)이 OOXML 의 기본값이다. */
function readActiveTabIndex(workbookXml: string): number {
  const view = /<workbookView\b[^>]*>/.exec(workbookXml)?.[0];
  const value = view === undefined ? undefined : /\sactiveTab="(\d+)"/.exec(view)?.[1];
  return value === undefined ? 0 : Number(value);
}

function layoutOf(sheet: HandwrittenQuoteSheet): SheetLayout {
  const layout = SHEET_LAYOUTS.find((candidate) => candidate.sheet === sheet);
  // FORM_HEADERS 의 세 양식은 SHEET_LAYOUTS 에 다 있다 — 컴파일러를 달래는 자리다.
  if (layout === undefined) throw new ReadFailure("NO_QUOTE_SHEET");
  return layout;
}

/**
 * 양식에 인쇄된 머리글(D열)로 「어느 양식인가」를 가른다. 가르지 못하면 null —
 * 부르는 쪽이 탭 이름으로 간다(머리말 '무엇이 들어 있나').
 *
 * 🔴 **두 양식이 함께 걸리면 가르지 않는다.** 머리글이 앉는 D열은 품목 · 작업 이름이
 * 적히는 열이기도 해서, 사람이 남의 양식 머리글과 똑같은 이름(「수리 작업」)을 항목으로
 * 적을 수 있다. 짐작으로 고르면 **칸 지도가 통째로 어긋난다** — 매쳐 양식은 건명이 D14 로
 * 제너레이터와 한 줄 다르다. 애매하면 탭 이름이라는 다른 근거로 간다.
 */
function formFromHeaders(grid: SheetGrid): HandwrittenQuoteSheet | null {
  const labels = new Set<string>();
  for (const row of grid.rowNumbers) {
    const cell = grid.cells(row).get(LAYOUT_COLUMNS.name);
    if (cell === undefined || cell.kind !== "text") continue;
    const text = cell.text.trim();
    if (text !== "") labels.add(text);
  }
  const matched = FORM_HEADERS.filter((form) => form.labels.some((label) => labels.has(label)));
  return matched.length === 1 ? matched[0].sheet : null;
}

/**
 * 「작성된 것으로 보이나」 — 단가(H) · 금액(I) 칸에 0 이 아닌 금액이 하나라도 있나.
 * 🔴 발행번호 · 품명 · 부품 이름은 보지 않는다(머리말 '무엇이 들어 있나'의 까닭 셋).
 */
function looksFilled(grid: SheetGrid): boolean {
  for (const row of grid.rowNumbers) {
    const cells = grid.cells(row);
    if (hasNonZeroAmount(cells.get(LAYOUT_COLUMNS.unitPrice))) return true;
    if (hasNonZeroAmount(cells.get(LAYOUT_COLUMNS.amount))) return true;
  }
  return false;
}

/**
 * 그 칸에 0 이 아닌 금액이 들어 있나. 글자로 적은 금액(「3,500,000」)도 센다 — 양식에
 * 인쇄된 머리글(「단 가」 · 「합 계」 · 「공 급 가」)은 금액 모양이 아니라 걸리지 않는다.
 */
function hasNonZeroAmount(cell: GridCell | undefined): boolean {
  if (cell === undefined) return false;
  if (cell.kind === "number") return cell.value !== 0;
  const found = AMOUNT_TEXT.exec(cell.text.trim());
  return found !== null && /[1-9]/.test(`${found[1]}${found[2] ?? ""}`);
}

/** 사람이 고른 시트. 그 자리에 견적서 시트가 없으면 조용히 딴 것을 읽지 않는다(머리말). */
function pickSheet(candidates: readonly Candidate[], sheetIndex: number): Candidate {
  if (!Number.isInteger(sheetIndex)) throw new ReadFailure("SHEET_NOT_FOUND");
  const chosen = candidates.find((candidate) => candidate.index === sheetIndex);
  if (chosen === undefined) throw new ReadFailure("SHEET_NOT_FOUND");
  return chosen;
}

/** 머리말 '어느 시트를 읽나' 의 네 갈래 그대로 — 사람이 시트를 지정하지 않았을 때다. */
function chooseSheet(candidates: readonly Candidate[], activeName: string | null, warnings: string[]): Candidate {
  if (candidates.length === 1) return candidates[0];

  const active = candidates.find((candidate) => candidate.name === activeName);
  const filled = candidates.filter(
    (candidate) => textAt(candidate.grid, candidate.layout.cells.quoteNumber) !== null
  );
  const names = (list: readonly Candidate[]) => list.map((candidate) => candidate.name).join(" · ");

  if (filled.length === 1) return filled[0];
  if (filled.length > 1) {
    if (active !== undefined && filled.includes(active)) return active;
    warnings.push(
      `발행번호가 채워진 견적서 시트가 여럿(${names(filled)})이고 활성 시트로도 가를 수 없어, 탭 순서의 첫 시트 「${filled[0].name}」를 읽었습니다 — 맞는 시트인지 확인해 주세요.`
    );
    return filled[0];
  }

  if (active !== undefined) return active;
  warnings.push(
    `견적서 시트가 여럿(${names(candidates)})인데 발행번호가 모두 비어 있어, 탭 순서의 첫 시트 「${candidates[0].name}」를 읽었습니다.`
  );
  return candidates[0];
}

// ── 칸 읽기 ─────────────────────────────────────────────────────────────

function readFields(
  chosen: Candidate,
  readStyles: () => string | null,
  warnings: string[]
): HandwrittenQuoteFields {
  const { cells } = chosen.layout;
  const text = (ref: string) => textAt(chosen.grid, ref);

  if (chosen.layout.sheet === "MATCHER") warnings.push(MATCHER_KIND_WARNING);
  const quoteDate = readQuoteDate(chosen, readStyles, warnings);
  const product = readProductInfo(chosen, warnings);
  const manualSupplyAmount = readSupplyAmount(chosen, warnings);

  return {
    kind: chosen.layout.kind,
    quoteNumber: text(cells.quoteNumber),
    quoteDate,
    customerNameText: text(cells.customerName),
    subject: text(cells.subject),
    modelNameText: product.modelNameText,
    lotNumberText: product.lotNumberText,
    serialNumberText: product.serialNumberText,
    validity: text(cells.validity),
    delivery: text(cells.delivery),
    payment: text(cells.payment),
    manualSupplyAmount,
  };
}

function cellAt(grid: SheetGrid, ref: string): GridCell | null {
  const found = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!found) return null;
  return grid.cells(Number(found[2])).get(found[1]) ?? null;
}

/** 칸의 글자. 숫자 칸(발행번호를 숫자로 친 경우 등)은 숫자 그대로 글자로. 빈 글자는 null. */
function textAt(grid: SheetGrid, ref: string): string | null {
  const cell = cellAt(grid, ref);
  if (cell === null) return null;
  const raw = cell.kind === "text" ? cell.text : String(cell.value);
  const trimmed = raw.replace(/\r\n?/g, "\n").trim();
  return trimmed === "" ? null : trimmed;
}

/** 그 칸의 수식 글자. 수식이 없거나 칸이 없으면 null. 공유 수식의 딸린 칸(`<f …/>`)은 빈 글자. */
function formulaAt(sheetXml: string, ref: string): string | null {
  let raw: string;
  try {
    raw = findCell(sheetXml, ref).raw;
  } catch {
    return null;
  }
  const found = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(raw);
  return found ? decodeXmlCharacterData(found[1] ?? "") : null;
}

/** 그 칸의 서식 번호(`s`). 적혀 있지 않으면 0. 칸을 못 찾으면 null(모름). */
function styleIndexAt(sheetXml: string, ref: string): number | null {
  try {
    const style = findCell(sheetXml, ref).style;
    return style === null ? 0 : Number(style);
  } catch {
    return null;
  }
}

// ── 발행일자 ────────────────────────────────────────────────────────────

function readQuoteDate(chosen: Candidate, readStyles: () => string | null, warnings: string[]): string | null {
  const ref = chosen.layout.cells.quoteDate;
  const cell = cellAt(chosen.grid, ref);
  const formula = formulaAt(chosen.sheetXml, ref);

  if (cell === null) {
    if (formula !== null) {
      warnings.push(
        `발행일자 칸(${ref})에 저장된 계산값이 없어 비워 두었습니다 — 엑셀에서 파일을 열어 저장한 뒤 다시 올려 주세요.`
      );
    }
    return null;
  }
  if (formula !== null && /\b(?:TODAY|NOW)\s*\(/i.test(formula)) {
    warnings.push(
      `발행일자 칸(${ref})이 오늘 날짜 수식(${formula})이라, 파일을 마지막으로 계산한 날의 날짜를 읽었습니다 — 발행일자를 확인해 주세요.`
    );
  }

  if (cell.kind === "number") {
    if (numberFormatKindOf(readStyles(), styleIndexAt(chosen.sheetXml, ref)) === "not-date") {
      warnings.push(`발행일자 칸(${ref})의 숫자(${cell.value})가 날짜 서식이 아니라 비워 두었습니다.`);
      return null;
    }
    const date = serialToDateOnly(cell.value, chosen.grid.date1904);
    if (date === null) {
      warnings.push(`발행일자 칸(${ref})의 날짜 일련번호(${cell.value})가 달력에 없는 날이라 비워 두었습니다.`);
    }
    return date;
  }

  const parsed = parseQuoteDateText(cell.text);
  if (parsed.kind === "date") return parsed.date;
  warnings.push(
    parsed.kind === "not-a-calendar-day"
      ? `발행일자 「${cell.text}」는 달력에 없는 날이라 비워 두었습니다.`
      : `발행일자 「${cell.text}」를 날짜로 알아보지 못해 비워 두었습니다(알아보는 모양: 2026-09-15 · 2026.09.15 · 2026. 9. 15. · 2026년 9월 15일).`
  );
  return null;
}

/** 일련번호 → `YYYY-MM-DD`. 달력으로 쓸 수 없는 번호(1900 의 가짜 2월 29일 포함)는 null. */
function serialToDateOnly(serial: number, date1904: boolean): string | null {
  const minimum = date1904 ? 0 : 1;
  if (!Number.isFinite(serial) || serial < minimum || serial > MAX_DATE_SERIAL) return null;
  const date = excelSerialToDateOnly(serial, date1904 ? "1904" : "1900");
  return date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export type QuoteDateTextResult =
  | { kind: "date"; date: string }
  | { kind: "not-a-calendar-day" }
  | { kind: "unrecognized" };

/**
 * 글자로 적힌 발행일자. 알아보는 모양만 받는다:
 *  · `2026-09-15` · `2026.09.15` · `2026/9/15` · `2026. 9. 15.`(구분자는 한 가지로)
 *  · `2026년 9월 15일`
 *  · `2026-09-15T00:00:00`(ISO — `t="d"` 칸이 이렇게 적힌다). 시각 · 시간대는 버린다.
 * 모양은 맞는데 달력에 없는 날(2월 30일 · 13월)은 따로 알린다.
 */
export function parseQuoteDateText(text: string): QuoteDateTextResult {
  const value = text.trim();

  const separated = /^(\d{4})\s*([-./])\s*(\d{1,2})\s*\2\s*(\d{1,2})\s*\.?$/.exec(value);
  if (separated) return calendarDay(separated[1], separated[3], separated[4]);

  const iso = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (iso) return calendarDay(iso[1], iso[2], iso[3]);

  const korean = /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/.exec(value);
  if (korean) return calendarDay(korean[1], korean[2], korean[3]);

  return { kind: "unrecognized" };
}

/** UTC 로만 맞춰 본다 — 서버 시간대가 끼어들 틈이 없다. */
function calendarDay(yearText: string, monthText: string, dayText: string): QuoteDateTextResult {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  // Date.UTC 는 0~99 년을 1900 년대로 옮긴다 — 그 앞의 해는 발행일자로 받지 않는다.
  if (year < 1900) return { kind: "unrecognized" };

  const probe = new Date(Date.UTC(year, month - 1, day));
  const exists =
    month >= 1 &&
    month <= 12 &&
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  if (!exists) return { kind: "not-a-calendar-day" };

  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return { kind: "date", date: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` };
}

type NumberFormatKind = "date" | "not-date" | "unknown";

/** 기본 제공 날짜 서식 번호 — 14~17 · 22(날짜+시각), 27~36 · 50~58(동아시아 날짜). 18~21 · 45~47 은 시각이다. */
const BUILTIN_DATE_FORMAT_IDS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/** 이 번호부터는 통합문서가 스스로 정의한 서식이다. 그 아래의 나머지는 기본 제공 숫자 · 시각 서식. */
const FIRST_CUSTOM_FORMAT_ID = 164;

/**
 * 그 칸의 숫자 서식이 날짜인가. styles.xml 이 없거나 칸의 서식을 짚을 수 없으면 "unknown" —
 * 그때는 날짜로 읽는다(발행일자 칸에 든 숫자다). 확실히 날짜가 아닐 때만 막는다.
 */
function numberFormatKindOf(stylesXml: string | null, styleIndex: number | null): NumberFormatKind {
  if (stylesXml === null || styleIndex === null) return "unknown";
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1];
  if (cellXfs === undefined) return "unknown";

  // 자체닫힘 `<xf …/>` 와 자식이 있는 `<xf …>…</xf>` 를 함께 센다(workbook-parts.ts 의 CELL_XF 와 같은 모양).
  const xf = [...cellXfs.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)][styleIndex]?.[0];
  if (xf === undefined) return "unknown";
  const openTag = /^<xf\b[^>]*>/.exec(xf)?.[0] ?? xf;
  const numFmtId = Number(/\snumFmtId="(\d+)"/.exec(openTag)?.[1] ?? "0");

  const custom = readCustomFormatCode(stylesXml, numFmtId);
  if (custom !== null) return isDateFormatCode(custom) ? "date" : "not-date";
  if (BUILTIN_DATE_FORMAT_IDS.has(numFmtId)) return "date";
  return numFmtId < FIRST_CUSTOM_FORMAT_ID ? "not-date" : "unknown";
}

function readCustomFormatCode(stylesXml: string, numFmtId: number): string | null {
  for (const tag of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    if (Number(/\snumFmtId="(\d+)"/.exec(tag[0])?.[1]) !== numFmtId) continue;
    const code = /\sformatCode="([^"]*)"/.exec(tag[0])?.[1];
    return code === undefined ? null : decodeXmlCharacterData(code);
  }
  return null;
}

/** 따옴표 글자 · `\x` · `[…]`(색 · 로캘 · 경과 시간)를 걷고 연(y) · 일(d)이 남으면 날짜 서식이다. */
function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[yd]/i.test(bare);
}

// ── 모델 · L/N · S/N ────────────────────────────────────────────────────

export type ProductInfoParts = {
  modelNameText: string | null;
  serialNumberText: string | null;
  lotNumberText: string | null;
};

const PRODUCT_INFO_PIECE = /^(MODEL|S\s*[/／]\s*N|L\s*[/／]\s*N)\s*[:：]\s*([\s\S]*)$/i;

/**
 * `MODEL: …, S/N:…, L/N:…` 한 줄을 나눈다. 모양이 아니면 null.
 *  · 조각은 쉼표(전각 포함) · 줄바꿈으로 가른다. 순서는 상관없다.
 *  · 조각마다 `MODEL` · `S/N` · `L/N` 중 하나 + 콜론(전각 포함). 대소문자 · 콜론 앞뒤 공백은 느슨하게.
 *  · 없는 조각은 null(buildProductInfoLine 은 빈 조각을 통째로 뺀다). 값이 빈 조각도 null.
 *  · 🔴 그 밖의 조각이 하나라도 섞이거나 같은 이름이 두 번 나오면 모양이 아니다 — 무엇이
 *    어느 칸인지 짐작해 채우지 않는다.
 */
export function splitProductInfoLine(line: string): ProductInfoParts | null {
  const pieces = line
    .split(/[,，\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
  if (pieces.length === 0) return null;

  const parts: ProductInfoParts = { modelNameText: null, serialNumberText: null, lotNumberText: null };
  const seen = new Set<string>();
  for (const piece of pieces) {
    const found = PRODUCT_INFO_PIECE.exec(piece);
    if (!found) return null;
    const key = found[1].replace(/\s+/g, "").replace("／", "/").toUpperCase();
    if (seen.has(key)) return null;
    seen.add(key);

    const value = found[2].trim();
    const text = value === "" ? null : value;
    if (key === "MODEL") parts.modelNameText = text;
    else if (key === "S/N") parts.serialNumberText = text;
    else parts.lotNumberText = text;
  }
  return parts;
}

function readProductInfo(chosen: Candidate, warnings: string[]): ProductInfoParts {
  const none: ProductInfoParts = { modelNameText: null, serialNumberText: null, lotNumberText: null };
  const ref = chosen.layout.cells.productInfo;
  if (ref === null) return none;

  const line = textAt(chosen.grid, ref);
  if (line === null) return none;
  const parts = splitProductInfoLine(line);
  if (parts === null) {
    warnings.push(
      `모델 칸(${ref})이 「MODEL: …, S/N:…, L/N:…」 모양이 아니라 모델명 · L/N · S/N 을 비워 두었습니다. 원문: 「${line}」`
    );
    return none;
  }
  return parts;
}

// ── 공급가액 ────────────────────────────────────────────────────────────

/**
 * 「공 급 가」 줄의 금액 칸 계산값 → 없으면 요약 칸 계산값. 값이 있는데 쓸 수 없는 값
 * (음수 · 글자)이면 요약 칸으로 넘어가지 않는다 — 요약 칸은 그 칸을 가리키는 수식이다.
 */
function readSupplyAmount(chosen: Candidate, warnings: string[]): string | null {
  const summaryRef = chosen.layout.cells.amount;
  const supplyRef = findSupplyCellRef(chosen);
  const refs = supplyRef === null ? [summaryRef] : [supplyRef, summaryRef];

  for (const ref of refs) {
    const cell = cellAt(chosen.grid, ref);
    if (cell !== null) return amountOf(cell, ref, warnings);
  }

  const formulaRefs = refs.filter((ref) => formulaAt(chosen.sheetXml, ref) !== null);
  if (formulaRefs.length > 0) {
    warnings.push(
      `공급가 칸(${formulaRefs.join(" · ")})에 저장된 계산값이 없어 공급가액을 비워 두었습니다 — 엑셀에서 파일을 열어 저장한 뒤 다시 올려 주세요.`
    );
  }
  return null;
}

function findSupplyCellRef(chosen: Candidate): string | null {
  try {
    const row = findSpacedLabelRow(
      parseSheetRows(chosen.sheetXml),
      (ref) => textAt(chosen.grid, ref),
      LAYOUT_COLUMNS.unitPrice,
      SUPPLY_LABEL
    );
    return `${LAYOUT_COLUMNS.amount}${row}`;
  } catch {
    return null; // 그 줄이 없다 — 요약 칸만 본다.
  }
}

function amountOf(cell: GridCell, ref: string, warnings: string[]): string | null {
  if (cell.kind === "text") return amountOfText(cell.text, ref, warnings);
  const value = cell.value;
  if (value < 0) {
    warnings.push(`공급가 칸(${ref})이 음수(${value})라 공급가액을 비워 두었습니다.`);
    return null;
  }
  if (value > MAX_AMOUNT) {
    warnings.push(`공급가 칸(${ref})의 금액(${value})이 너무 커서 공급가액을 비워 두었습니다.`);
    return null;
  }

  const cents = Math.round(value * 100);
  // 합계 수식의 부동소수 찌꺼기(2050000.0000000002 따위)는 말없이 걷는다. 진짜 셋째 자리는 알린다.
  if (Math.abs(cents / 100 - value) > 1e-6) {
    warnings.push(`공급가 칸(${ref})의 금액(${value})을 소수 둘째 자리까지 반올림했습니다.`);
  }
  return formatCents(cents);
}

/**
 * 글자로 적힌 금액의 받는 모양 — 머리말 '공급가액'. 정수부는 콤마 없는 숫자이거나 **세 자리마다
 * 콤마**(`3,50,000` 은 안 된다), 소수는 둘째 자리까지. 부호 · 괄호 · 다른 글자가 들어갈 틈이 없다.
 */
const AMOUNT_TEXT = /^[₩￦]?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*원?$/;

/** validation/quote-input.ts 의 AMOUNT_PATTERN 과 같은 정수부 자릿수 상한. */
const MAX_AMOUNT_INTEGER_DIGITS = 13;

/**
 * 글자 금액 → 숫자 문자열. Number 를 거치지 않고 글자로 다룬다(콤마 · 앞자리 0 · 소수 끝의 0 을
 * 걷는다). 받아도 경고를 한 줄 싣는다 — 사람이 확인해야 하는 값이다.
 */
function amountOfText(text: string, ref: string, warnings: string[]): string | null {
  const found = AMOUNT_TEXT.exec(text.trim());
  if (!found) {
    warnings.push(`공급가 칸(${ref})이 숫자가 아니라 공급가액을 비워 두었습니다. 원문: 「${text}」`);
    return null;
  }

  const integer = found[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (integer.length > MAX_AMOUNT_INTEGER_DIGITS) {
    warnings.push(`공급가 칸(${ref})의 금액(「${text}」)이 너무 커서 공급가액을 비워 두었습니다.`);
    return null;
  }
  const fraction = (found[2] ?? "").replace(/0+$/, "");
  const amount = fraction === "" ? integer : `${integer}.${fraction}`;

  warnings.push(
    `공급가 칸(${ref})의 금액이 글자로 적혀 있어 숫자로 읽었습니다 — 「${text}」 → ${amount}. 금액을 확인해 주세요.`
  );
  return amount;
}

/** 0 이상의 센트 → `"3500000"` · `"1234.5"` · `"1234.05"`. 지수 표기가 나오지 않는다. */
function formatCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  if (rest === 0) return String(Math.abs(whole));
  return `${Math.abs(whole)}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}
