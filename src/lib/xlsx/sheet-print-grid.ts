import type { ExcelDateSystem } from "./excel-date";
import { builtInNumberFormat, formatNumber, formatText, koreanLongDate } from "./number-format";
import { parseSheetRows, type SheetRow } from "./sheet-rows";
import { createCellTextReader } from "./sheet-text";
import {
  resolveSheetDrawingPart,
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
 * 채워진 시트를 **화면이 그릴 수 있는 표**로 바꾼다
 * ============================================================================
 * 검사·수리 보고서 미리보기가 쓰는 조각이다. 견적서 미리보기
 * (`components/quotes/QuotePrintView.tsx`)는 양식을 보고 HTML 로 **손수 다시
 * 그린 것**인데, 여기서는 그 방식을 따르지 않는다.
 *
 * 까닭은 두 양식의 생김새가 다르기 때문이다. 견적서는 «흐르는 문서»(제목 ·
 * 회사정보 · 품목표 · 합계)라 손으로 그리는 편이 낫다. **보고서는 격자 서식**이다
 * — 좁은 칸 48개에 병합이 221개고, 그 병합이 `colspan`/`rowspan` 과 1:1 로
 * 대응된다. 손으로 그리면 문서가 두 벌이 되어 언젠가 서로 달라지고, 그날
 * 미리보기와 실제 나가는 파일이 다른 말을 한다.
 *
 * 그래서 이렇게 만든다:
 *
 *     저장된 보고서 → fillServiceReportWorkbook()  ← 이미 있다. 그대로 쓴다
 *                   → **채워진 시트 XML** → 이 파일 → 표 자료 → 화면
 *
 * 미리보기와 xlsx 가 **같은 값 · 같은 자리**에서 나온다. 어긋날 방법이 없다.
 *
 * ── 🔴 무엇을 읽고 무엇을 안 읽나 ───────────────────────────────────────
 * **일반적인 xlsx 뷰어가 아니다.** 이 양식이 실제로 쓰는 것만 다룬다:
 *
 *   읽는다  인쇄 영역 · 병합 · 열 너비 · 행 높이 · 셀 글자 · 테두리 · 가로세로
 *           맞춤 · 줄바꿈 · 글꼴 크기와 굵기 · 그림 앵커 · 인쇄 설정 ·
 *           숫자 서식(`number-format.ts`) · 글자 색 · 칸 배경(rgb 로 적힌 것만)
 *   안 읽는다  테마 색 · 색 번호(indexed) · 틴트 · 무늬 채움 · 기울임/밑줄 ·
 *           조건부 서식 · 회전된 글자 · 대각선 테두리 · 자동 필터 · 틀 고정
 *
 * 안 읽는 것들은 이 양식의 인쇄 영역(`B8:AV64`)에 **하나도 쓰이지 않는다**
 * (실측). 나중에 쓰이게 되면 그 칸이 밋밋하게 나올 뿐 화면은 살아 있다.
 *
 * ── 조건부 서식 · 값의 종류 (2026-09-16, 견적서 ②b 재작업) ─────────────────────
 *   · 칸마다 **값의 종류**(`valueKind` — 수 · 글자 · 참/거짓 · 오류)를 싣는다. 화면이 Excel 의
 *     「일반」 가로 맞춤(수 · 날짜는 오른쪽)을 따라 할 때 쓴다. 칸이 **더해졌을** 뿐이다.
 *   · 🔴 조건부 서식은 **부르는 쪽이 켤 때만** 읽는다(`conditionalFormatting: "apply"` — 견적서
 *     미리보기). 보고서 양식에는 «빈 필수 칸을 빨갛게» 칠하는 규칙이 있어서, 켜면 보고서
 *     미리보기가 달라진다 — 보고서 호출부는 켜지 않는다. 그 규칙의 색이 테마 색 · 색 번호일 수
 *     있어서 조건부 서식에서만 테마(`theme1.xml`)와 색 번호 팔레트를 푼다(아래 「조건부 서식」).
 *
 * ── 사람이 손으로 만든 견적서 엑셀도 그린다 (2026-09-16, 견적서 ②a) ─────────
 * 「엑셀 전용 견적서」의 미리보기가 **수기 견적서 엑셀을 PDF 로 만들었을 때의
 * 모습**을 보여 주려고 넓혔다. 그 파일은 금액 칸에 `"₩"#,##0` 같은 숫자 서식이,
 * 발행일자에 날짜 서식이 걸려 있어서 서식을 안 읽으면 `3500000` · `46262` 가
 * 찍힌다 — 사람이 보기에 다른 문서다. 그래서 숫자 서식 · 글자 색 · 칸 배경을
 * 읽게 되었다.
 *
 *   · 🔴 **보고서 미리보기는 한 글자도 달라지지 않는다.** 보고서 양식의 숫자 칸은
 *     `@`(→ General) 서식 하나뿐이고 정수라 글자가 그대로다. 날짜 칸(`t="d"`)은
 *     예전 길 그대로다. 결과에 칸 둘(`fontColor` · `backgroundColor`)이 **더해졌을**
 *     뿐이고, 그것을 모르는 화면은 전과 같은 모양을 그린다(시험이 못 박는다).
 *   · 사람이 만든 파일은 인쇄 영역이 없을 수 있다. 🔴 **기본은 여전히 던진다**
 *     (아래 「구조를 못 읽으면 던진다」). `{ printArea: "fallback-to-used-range" }`
 *     를 줄 때만 쓰인 범위로 대신 그린다 — 보고서 호출부는 그 인자를 주지 않는다.
 *
 * ── 🔴 모르는 것을 만났을 때 — 던지는 자리와 넘어가는 자리를 갈랐다 ─────
 * 채우개(`service-report-template.ts`)는 라벨이 어긋나면 던진다. 엉뚱한 칸을
 * 채운 문서가 고객사로 나가는 것보다 멈추는 편이 낫기 때문이다. 여기는 **보여
 * 주는 화면**이라 판단이 한 칸 다르다:
 *
 *   · **구조를 못 읽으면 던진다** — 인쇄 영역, `<sheetData>`. 그릴 범위를
 *     모르면 그릴 것이 없고, 짐작해서 엉뚱한 범위를 그리면 사람은 그것을
 *     문서라고 믿는다(숨은 도우미 열이 딸려 나온 미리보기를 보고 "파일도
 *     이렇게 나가나 보다" 하게 된다).
 *   · **서식을 못 읽으면 그 부분만 밋밋하게 그리고 넘어간다** — 테두리·정렬·
 *     글꼴·그림. 도장 하나를 못 꺼냈다고 화면을 죽이면, 사람이 값을 확인하는
 *     일까지 함께 막힌다. 값은 여전히 제자리에 있고, 정본이 필요하면 Excel 을
 *     받으면 된다(`sheet-text.ts` 의 '못 찾은 칸은 조용히 건너뛴다'와 같은
 *     판단).
 *
 * ── 🔴 후리가나(`<rPh>`)를 걷어 낸다 ────────────────────────────────────
 * 이 양식의 공유문자열에는 일본어 후리가나가 딸려 있다. 그대로 읽으면 「비　고」가
 * 「비　고ソナエコウ」로, 「고　객」이 「고　객キャクサキ」로 온다. 화면에 없는 글자가
 * 미리보기에만 찍히면 그것이야말로 «미리보기와 파일이 다른 말을 하는» 상태다.
 * `service-report-choices.ts` 가 이미 같은 함정을 지나갔고 같은 방법으로 푼다 —
 * 원본을 고치는 것이 아니라 **읽으려고 만든 사본**에서 `<rPh>` 를 걷어 낸다.
 *
 * ── 🔴 셀 글자는 `createCellTextReader` 로 읽되 **행 하나씩** 넘긴다 ─────
 * 그 함수는 넘겨받은 XML 에서 `<c r="…">` 을 정규식으로 찾는다. 시트 전체를
 * 넘기면 셀 하나를 읽을 때마다 157KB 를 훑고, 인쇄 영역 안 3,772칸이면
 * **294ms** 다(실측). 행 하나의 XML 만 넘기면 답은 한 글자도 다르지 않으면서
 * **37ms** 로 떨어진다 — 어차피 셀은 자기 행 안에만 있기 때문이다.
 *
 * ── 🔴 병합 칸의 테두리는 **가장자리 셀들에서 모은다** ──────────────────
 * Excel 은 병합 범위의 테두리를 «범위의 가장자리에 놓인 셀들»에 나눠 담는다.
 * 본문 줄(`H31:AU31`)이 그 예다 — 왼쪽 테두리는 `H31` 의 서식에, **오른쪽
 * 테두리는 `AU31`(가려진 칸)의 서식에** 들어 있다(실측: H32 는 s=497,
 * AU32 는 s=471). 왼쪽 위 칸의 서식만 보면 본문 상자의 오른쪽 변이 통째로
 * 사라진다. 그래서 네 변을 각각 그 변에 놓인 칸들에서 훑어 모은다.
 * ============================================================================
 */

export class SheetPrintGridError extends Error {}

/** `thin` · `medium` · `double` … OOXML 이 적어 둔 이름 그대로. 없으면 null. */
export type PrintGridBorderStyle = string | null;

export type PrintGridBorders = {
  top: PrintGridBorderStyle;
  right: PrintGridBorderStyle;
  bottom: PrintGridBorderStyle;
  left: PrintGridBorderStyle;
};

export type PrintGridCell = {
  /** 1부터. 인쇄 영역 밖으로는 안 나간다. */
  row: number;
  column: number;
  colSpan: number;
  rowSpan: number;
  /** 이미 다 풀린 글자. 줄바꿈은 `\n` 하나로 고른다. 빈 칸은 `""`. */
  text: string;
  /** `left` · `center` · `right` … 양식이 안 적었으면 null. */
  align: string | null;
  /** `top` · `center` · `bottom`. 양식이 안 적었으면 null. */
  verticalAlign: string | null;
  wrap: boolean;
  bold: boolean;
  /** pt. 못 읽었으면 null — 화면이 자기 기본값을 쓴다. */
  fontSizePt: number | null;
  borders: PrintGridBorders;
  /**
   * 글자 색 `#RRGGBB`. 🔴 서식에 **rgb 로 적힌 것만** 읽는다 — 테마 색 · 색 번호
   * (indexed) · 틴트가 걸린 색은 모르므로 null(화면의 기본 글자 색). 2026-09-16 에
   * **더한** 칸이다 — 보고서 화면은 이 칸을 모르고도 전과 같은 모양이다.
   */
  fontColor: string | null;
  /** 칸 배경 `#RRGGBB`. **단색(solid) 채움의 rgb 만** — 무늬 · 테마 색은 null. 2026-09-16 에 더한 칸. */
  backgroundColor: string | null;
  /**
   * 칸 값의 종류 — 화면이 Excel 의 「일반」 가로 맞춤(숫자 · 날짜는 오른쪽, 참/거짓 · 오류는
   * 가운데, 글자는 왼쪽)을 따라 할 때 쓴다. 빈 칸은 null. 숫자여도 서식이 `@`(글자)면 "text".
   * 2026-09-16(견적서 ②b 재작업)에 **더한** 칸이다.
   */
  valueKind: PrintGridValueKind | null;
};

/** 칸 값의 종류. 날짜는 Excel 안에서 수라 "number" 다. */
export type PrintGridValueKind = "number" | "text" | "boolean" | "error";

export type PrintGridRow = {
  row: number;
  heightPt: number;
  cells: PrintGridCell[];
};

/**
 * 양식 안에 박힌 그림 한 장의 자리. **인쇄 영역의 왼쪽 위가 원점**이고 단위는 pt.
 *
 * `name` 은 `xl/media/` 안의 파일 이름(`image3.png`)이다 — 그림 바이트는 여기서
 * 나르지 않는다. 미리보기는 서버 컴포넌트가 그린 HTML 이라 바이트를 실으면
 * 문서 전체가 base64 로 부풀고, 그림에는 **법인 직인**이 들어 있어 로그인 없이
 * 흘러도 안 된다. 화면은 이 이름으로 인가가 걸린 라우트에 물어본다.
 */
export type PrintGridPicture = {
  name: string;
  leftPt: number;
  topPt: number;
  widthPt: number;
  heightPt: number;
};

/** 양식이 정해 둔 인쇄 설정. 화면이 `@page` 와 배율에 그대로 쓴다. */
export type PrintGridPageSetup = {
  /** `<pageSetup paperSize>`. 9 = A4. 못 읽으면 null. */
  paperSize: number | null;
  /** 1 = 100%. `<pageSetup scale>` ÷ 100. 없으면 1. */
  scale: number;
  orientation: "portrait" | "landscape";
  /** 인치. `<pageMargins>` 그대로. */
  margins: { left: number; right: number; top: number; bottom: number };
  horizontallyCentered: boolean;
  verticallyCentered: boolean;
};

export type SheetPrintGrid = {
  /** 인쇄 영역. 🔴 **양식에서 읽은 것**이다 — 코드에 박힌 값이 아니다. */
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
  /** 인쇄 영역 안 열들의 너비(pt), 왼쪽부터. `lastColumn - firstColumn + 1` 개. */
  columnWidthsPt: number[];
  /** 배율을 먹이기 **전**의 크기(pt). */
  widthPt: number;
  heightPt: number;
  rows: PrintGridRow[];
  pictures: PrintGridPicture[];
  page: PrintGridPageSetup;
};

export type SheetPrintGridParts = {
  sheetName: string;
  workbookXml: string;
  sheetXml: string;
  sharedStringsXml: string | null;
  /** 없으면 테두리·정렬·글꼴 없이 그린다(위 '밋밋하게 그리고 넘어간다'). */
  stylesXml: string | null;
  /** 없으면 그림 없이 그린다. */
  drawingXml: string | null;
  drawingRelsXml: string | null;
  /**
   * 통합문서의 테마(`xl/theme/theme1.xml`) — 조건부 서식의 색이 테마 색(`theme="0"` 따위)일 때
   * 푼다. 조건부 서식을 읽을 때만 쓰고, 없으면 테마 색은 모르는 색(null)이다. 2026-09-16 에 더한 칸.
   */
  themeXml?: string | null;
};

/**
 * 부르는 쪽이 고르는 것. **안 주면 예전과 한 글자도 다르지 않다.**
 *
 * `printArea` — 그 시트에 인쇄 영역이 없을 때:
 *   · `"required"`(기본) — 던진다. 🔴 보고서는 이것이다: 인쇄 영역이 없는 양식을
 *     짐작해서 그리면 숨은 도우미 열이 딸려 나온 미리보기를 사람이 문서로 믿는다.
 *   · `"fallback-to-used-range"` — 쓰인 범위(`<dimension ref>`, 없으면 실제 칸들)로
 *     대신 그린다. 사람이 손으로 만든 견적서 엑셀처럼 인쇄 영역을 안 잡은 파일을
 *     그릴 때 쓴다 — Excel 도 인쇄 영역이 없으면 쓰인 범위를 인쇄한다.
 *   인쇄 영역이 **있는데 못 읽으면** 어느 쪽이든 던진다(구조를 못 읽은 것이다).
 */
export type SheetPrintGridOptions = {
  printArea?: "required" | "fallback-to-used-range";
  /**
   * 조건부 서식(`<conditionalFormatting>`)의 글자 색 · 칸 배경을 입힐 것인가(2026-09-16, 견적서 ②b
   * 재작업).
   *   · `"ignore"`(기본) — 예전 그대로 안 읽는다. 🔴 보고서는 이것이다: 보고서 양식에는 «빈
   *     필수 칸을 빨갛게» 칠하는 규칙이 있어서, 읽으면 보고서 미리보기가 지금과 달라진다(사람의
   *     판단이 필요한 변화라 여기서 켜지 않는다).
   *   · `"apply"` — 읽을 수 있는 규칙(아래 「조건부 서식」)만 입힌다. 사람이 만든 견적서 엑셀은
   *     「0 이면 흰 글자」 규칙으로 도우미 칸의 ₩0 을 감춘다 — 안 읽으면 Excel 에 없는 ₩0 이
   *     미리보기에만 찍힌다.
   */
  conditionalFormatting?: "ignore" | "apply";
};

// ── 단위 ─────────────────────────────────────────────────────────────────

/**
 * OOXML 의 길이 단위. `1pt = 12700 EMU` 이고 96dpi 에서 `1px = 0.75pt` 다.
 *
 * 그림 앵커의 «칸 안쪽 치우침»만 EMU 로 오고 나머지는 열 너비(px)·행 높이(pt)라,
 * 모두 pt 로 모아 셈한다.
 */
const EMU_PER_POINT = 12700;
const POINTS_PER_PIXEL = 0.75;

/**
 * 🔴 열 너비의 «문자 단위»를 픽셀로 바꿀 때 쓰는 **최대 숫자 폭**.
 *
 * OOXML 의 환산식은 규격에 있다:
 *
 *     pixels = Truncate(((256 × width + Truncate(128 ÷ MDW)) ÷ 256) × MDW)
 *
 * `MDW` 는 통합문서 기본 글꼴에서 숫자 한 자가 차지하는 픽셀 수다. 규격은 값을
 * 파일에 적어 두지 않으므로 어딘가에서 알아내야 한다.
 *
 * **이 양식의 값은 8이고, 양식 스스로가 그것을 알려 준다.** 그림 앵커에는 셀
 * 좌표(`<xdr:from>`)와 절대 좌표(`<a:off>`)가 함께 적혀 있어서 둘을 견주면
 * 열 너비의 실제 픽셀 값이 나온다(실측):
 *
 *   · 「그림 4」 from = 33열 + 11px, a:off.x = 484px → 1~32열 = 473px
 *   · 「그림 6」 from = 43열 +  9px, a:off.x = 632px → 1~42열 = 623px
 *   → 33~42열(너비 1.875) 10칸 = 150px → 15px/칸,  너비 1.75 는 14px/칸
 *   → 위 식에 MDW=8 을 넣으면 정확히 15 와 14 가 나온다(MDW=7 이면 13 과 12).
 *
 * 시험(`sheet-print-grid.test.ts`)이 이 셈을 양식의 앵커로 다시 확인한다 —
 * 숫자가 코드에만 있고 근거가 사라지는 것을 막기 위해서다.
 *
 * ⚠️ 글꼴이 바뀐 양식이 오면 폭이 몇 % 어긋난다. 그래도 **비율은 열끼리 그대로**
 * 유지되고(같은 식을 모든 열에 쓰므로) 화면은 종이에 맞춰 다시 줄이므로,
 * 어긋나 봐야 문서가 조금 좁거나 넓게 보일 뿐 자리가 무너지지는 않는다.
 */
const MAX_DIGIT_WIDTH_PX = 8;

/** `<sheetFormatPr defaultRowHeight>` 가 없을 때의 규격 기본값(pt). */
const DEFAULT_ROW_HEIGHT_PT = 15;

/** `<col>` 이 없는 열의 규격 기본 너비(문자 단위). */
const DEFAULT_COLUMN_WIDTH_CHARS = 8.43;

/**
 * 한 번에 그릴 수 있는 칸 수의 상한.
 *
 * 상한이 아니라 **폭주 방지**다. 인쇄 영역이 통째로 시트 전체(`A1:XFD1048576`)로
 * 잡힌 양식이 오면 셀 수십억 개를 만들다 서버가 멎는다. 이 양식의 인쇄 영역은
 * 47열 × 57행 = 2,679칸이다.
 */
const MAX_GRID_CELLS = 200_000;

// ── 들어가는 문 ──────────────────────────────────────────────────────────

/**
 * 채워진 통합문서(버퍼)에서 그 시트의 인쇄 영역을 표 자료로 읽는다.
 *
 * 🔴 **채우개가 만든 버퍼를 그대로 받는다.** 채우개 안을 들여다보거나 고쳐서
 * 중간 결과를 얻지 않는다 — 그러면 내려받는 파일과 미리보기가 서로 다른 길로
 * 만들어지고, 언젠가 한쪽만 바뀐다. zip 을 한 번 더 여는 값(수십 ms)은 그
 * 보증을 사는 값이다.
 */
export function readSheetPrintGrid(
  workbookXlsx: Buffer,
  sheetName: string,
  options: SheetPrintGridOptions = {}
): SheetPrintGrid {
  const archive = ZipArchive.fromBuffer(workbookXlsx);
  const sheetPart = resolveSheetPart(archive, sheetName);
  const drawingPart = resolveSheetDrawingPart(archive, sheetPart);
  // 테마는 조건부 서식을 읽을 때만 편다 — 안 읽는 호출(보고서)은 예전과 같은 파트만 읽는다.
  const themePart = options.conditionalFormatting === "apply" ? resolveWorkbookThemePart(archive) : null;

  return buildSheetPrintGrid(
    {
      sheetName,
      workbookXml: archive.readText(WORKBOOK_PART),
      sheetXml: archive.readText(sheetPart),
      sharedStringsXml: archive.readTextOrNull(SHARED_STRINGS_PART),
      stylesXml: archive.readTextOrNull(STYLES_PART),
      drawingXml: drawingPart === null ? null : archive.readTextOrNull(drawingPart),
      drawingRelsXml:
        drawingPart === null
          ? null
          : archive.readTextOrNull(drawingPart.replace(/([^/]+)$/, "_rels/$1.rels")),
      themeXml: themePart === null ? null : archive.readTextOrNull(themePart),
    },
    options
  );
}

/**
 * 통합문서의 테마 파트(`xl/theme/theme1.xml`). 이름을 못 박지 않고 workbook.xml 의 관계에서
 * `…/relationships/theme` 를 찾는다. 없으면 null. 2026-09-16 에 더했다.
 */
export function resolveWorkbookThemePart(archive: ZipArchive): string | null {
  const rels = archive.readTextOrNull(WORKBOOK_RELS_PART);
  if (rels === null) return null;
  const tag = /<Relationship\b[^>]*Type="[^"]*\/relationships\/theme"[^>]*>/.exec(rels)?.[0];
  const target = tag === undefined ? undefined : /\sTarget="([^"]+)"/.exec(tag)?.[1];
  if (target === undefined) return null;
  const part = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  return archive.has(part) ? part : null;
}

/**
 * 부품(XML 문자열)만 받아 표 자료를 만든다 — **파일을 만지지 않는다.**
 * 시험이 지어낸 시트로 규칙을 확인할 수 있게 이쪽을 갈라 두었다.
 */
export function buildSheetPrintGrid(
  parts: SheetPrintGridParts,
  options: SheetPrintGridOptions = {}
): SheetPrintGrid {
  /**
   * 🔴 인쇄 영역이 있으면 **예전과 같은 순서**로 검사한다(인쇄 영역 → 칸 수 → 행).
   * 없을 때 던지는 것도 예전 그대로이고, 쓰인 범위로 대신하는 것은 인자를 받았을
   * 때뿐이다 — 보고서 호출부는 인자를 주지 않으므로 한 글자도 달라지지 않는다.
   */
  const declared = readPrintArea(parts.workbookXml, parts.sheetName);
  if (declared === null && options.printArea !== "fallback-to-used-range") {
    throw new SheetPrintGridError(`양식의 "${parts.sheetName}" 시트에 인쇄 영역이 없습니다.`);
  }
  if (declared !== null) assertDrawableSize(declared, "인쇄 영역");

  /**
   * 🔴 행은 **한 번만** 훑는다. `parseSheetRows` 가 `<sheetData>` 를 못 찾으면
   * 던지는데(`SheetRowError`), 그것은 구조를 못 읽은 것이므로 이 파일의 오류로
   * 바꿔 올린다 — 부르는 쪽이 잡아야 할 것이 한 가지이면 된다.
   */
  let sheetRows: SheetRow[];
  try {
    sheetRows = parseSheetRows(parts.sheetXml);
  } catch (err) {
    throw new SheetPrintGridError(
      `양식의 시트를 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const range = declared ?? readUsedRange(parts.sheetXml, sheetRows);
  if (declared === null) assertDrawableSize(range, "쓰인 범위");

  const columnWidthsPx = readColumnWidths(parts.sheetXml);
  const rowHeightsPt = readRowHeights(parts.sheetXml, sheetRows);
  const styles = readStyles(parts.stylesXml);
  const dateSystem = readDateSystem(parts.workbookXml);
  const sheetCells = readSheetCells(sheetRows, parts.sharedStringsXml, range, (raw, type, styleIndex) =>
    displayText(raw, type, styles.numberFormatOf(styleIndex), dateSystem)
  );
  const merges = readMerges(parts.sheetXml, range);
  // 🔴 부르는 쪽이 켰을 때만(보고서는 켜지 않는다 — SheetPrintGridOptions).
  const conditional =
    options.conditionalFormatting === "apply"
      ? readConditionalFormats(parts.sheetXml, parts.stylesXml, parts.themeXml ?? null)
      : null;

  // 가려진 칸(병합의 왼쪽 위가 아닌 칸)은 그리지 않는다.
  const covered = new Set<string>();
  const anchors = new Map<string, MergeRange>();
  for (const merge of merges) {
    anchors.set(cellKey(merge.firstRow, merge.firstColumn), merge);
    for (let row = merge.firstRow; row <= merge.lastRow; row += 1) {
      for (let column = merge.firstColumn; column <= merge.lastColumn; column += 1) {
        if (row === merge.firstRow && column === merge.firstColumn) continue;
        covered.add(cellKey(row, column));
      }
    }
  }

  const rows: PrintGridRow[] = [];
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    const heightPt = rowHeightsPt.get(row) ?? rowHeightsPt.get(0) ?? DEFAULT_ROW_HEIGHT_PT;
    const cells: PrintGridCell[] = [];

    for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
      const key = cellKey(row, column);
      if (covered.has(key)) continue;

      const merge = anchors.get(key);
      const lastRow = merge ? merge.lastRow : row;
      const lastColumn = merge ? merge.lastColumn : column;
      const found = sheetCells.get(key);
      // 조건부 서식은 병합의 왼쪽 위 칸의 값으로 가린다 — Excel 이 보여 주는 값이 그것이다.
      const overlay = conditional === null ? null : conditional(row, column, found);

      cells.push({
        row,
        column,
        colSpan: lastColumn - column + 1,
        rowSpan: lastRow - row + 1,
        text: found?.text ?? "",
        align: styles.alignOf(found?.styleIndex),
        verticalAlign: styles.verticalAlignOf(found?.styleIndex),
        wrap: styles.wrapOf(found?.styleIndex),
        bold: styles.boldOf(found?.styleIndex),
        fontSizePt: styles.fontSizeOf(found?.styleIndex),
        // 🔴 네 변을 각각 그 변에 놓인 칸들에서 모은다(위 머리말).
        borders: collectBorders(sheetCells, styles, row, column, lastRow, lastColumn),
        fontColor: overlay?.fontColor ?? styles.fontColorOf(found?.styleIndex),
        backgroundColor: overlay?.backgroundColor ?? styles.backgroundColorOf(found?.styleIndex),
        valueKind: valueKindOf(found, styles.numberFormatOf(found?.styleIndex ?? null)),
      });
    }

    rows.push({ row, heightPt, cells });
  }

  const columnWidthsPt: number[] = [];
  for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
    columnWidthsPt.push(columnWidthPx(columnWidthsPx, column) * POINTS_PER_PIXEL);
  }

  return {
    firstRow: range.firstRow,
    lastRow: range.lastRow,
    firstColumn: range.firstColumn,
    lastColumn: range.lastColumn,
    columnWidthsPt,
    widthPt: columnWidthsPt.reduce((sum, width) => sum + width, 0),
    heightPt: rows.reduce((sum, row) => sum + row.heightPt, 0),
    rows,
    pictures: readPictures(parts, range, columnWidthsPx, rowHeightsPt),
    page: readPageSetup(parts.sheetXml),
  };
}

// ── 인쇄 영역 ────────────────────────────────────────────────────────────

type CellRange = { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number };
type MergeRange = CellRange;

/**
 * 🔴 그릴 범위는 **양식의 인쇄 영역**이다 — `B8:AV64` 를 코드에 박지 않는다.
 *
 * 한 통합문서에 인쇄 영역이 여럿일 수 있어서(이 파일은 `Repair_Record` 것과
 * `Repair_Report (한글)` 것 둘을 갖고 있다) 시트 이름을 견줘 고른다 —
 * `workbook-parts.ts` 의 `shiftPrintArea` 와 같은 판단이고, 채우개가 줄을 늘릴 때
 * 미는 것도 바로 이 값이다. 그래서 본문이 길어져 행이 늘어난 문서도 늘어난 채로
 * 그려진다.
 *
 * 인쇄 영역은 쉼표로 여러 덩이일 수 있다. 그때는 **첫 덩이만** 그린다 — 두
 * 덩이는 종이 두 장이라는 뜻이고, 그것을 한 장에 이어 붙여 그리면 있지도 않은
 * 문서를 보여 주게 된다. 이 양식은 한 덩이다.
 */
function readPrintArea(workbookXml: string, sheetName: string): CellRange | null {
  const pattern = /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g;

  for (const match of workbookXml.matchAll(pattern)) {
    const reference = unescapeXml(match[1]);
    if (referencedSheetName(reference) !== sheetName) continue;

    const bang = reference.lastIndexOf("!");
    const first = reference.slice(bang + 1).split(",")[0];
    const range = parseRange(first);
    if (!range) {
      throw new SheetPrintGridError(`양식의 인쇄 영역을 읽을 수 없습니다: "${first}"`);
    }
    return range;
  }

  // 없다 — 던질지 쓰인 범위로 대신할지는 부르는 쪽의 인자가 정한다(`buildSheetPrintGrid`).
  return null;
}

/** 폭주 방지(`MAX_GRID_CELLS`). `label` 은 오류 문장에 들어갈 범위의 이름. */
function assertDrawableSize(range: CellRange, label: string): void {
  const cellCount = (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
  if (cellCount > MAX_GRID_CELLS) {
    throw new SheetPrintGridError(`${label}이 ${cellCount}칸입니다. ${MAX_GRID_CELLS}칸까지만 그립니다.`);
  }
}

/**
 * 인쇄 영역 대신 그릴 **쓰인 범위** — `fallback-to-used-range` 를 받았을 때만 온다.
 *
 * 먼저 `<dimension ref>` 를 본다. Excel 이 저장할 때 적어 두는 «쓰인 범위»라, 사람이
 * Excel 에서 만든 파일이면 그대로 맞다. 없거나 못 읽으면 **실제로 있는 칸**(`<c r>`)과
 * 병합을 훑어 모은다. 둘 다 없으면 그릴 것이 없으므로 던진다(구조를 못 읽은 것).
 */
function readUsedRange(sheetXml: string, sheetRows: readonly SheetRow[]): CellRange {
  const dimension = /<dimension\b[^>]*\sref="([^"]+)"/.exec(sheetXml)?.[1];
  const declared = dimension === undefined ? null : parseRange(dimension);
  if (declared !== null) return declared;

  const bounds = { firstRow: Infinity, lastRow: -Infinity, firstColumn: Infinity, lastColumn: -Infinity };
  const include = (row: number, column: number): void => {
    bounds.firstRow = Math.min(bounds.firstRow, row);
    bounds.lastRow = Math.max(bounds.lastRow, row);
    bounds.firstColumn = Math.min(bounds.firstColumn, column);
    bounds.lastColumn = Math.max(bounds.lastColumn, column);
  };

  for (const row of sheetRows) {
    for (const match of row.xml.matchAll(/<c\s+r="([A-Z]+)(\d+)"/g)) {
      include(Number(match[2]), columnToNumber(match[1]));
    }
  }
  for (const match of sheetXml.matchAll(/<mergeCell\b[^>]*\sref="([^"]+)"[^>]*\/>/g)) {
    const merge = parseRange(match[1]);
    if (merge === null) continue;
    include(merge.firstRow, merge.firstColumn);
    include(merge.lastRow, merge.lastColumn);
  }

  if (!Number.isFinite(bounds.firstRow) || !Number.isFinite(bounds.firstColumn)) {
    throw new SheetPrintGridError("시트에 인쇄 영역도 쓰인 칸도 없어 그릴 것이 없습니다.");
  }
  return bounds;
}

/**
 * 통합문서의 날짜 체계. `<workbookPr date1904="1"/>` 이면 1904 체계다 — 같은 날짜가
 * 1462 작은 번호로 적힌다(`excel-date.ts`). 안 읽으면 발행일자가 4년 어긋난다.
 */
function readDateSystem(workbookXml: string): ExcelDateSystem {
  return /<workbookPr\b[^>]*\sdate1904="(?:1|true)"/.test(workbookXml) ? "1904" : "1900";
}

/** `견적서!$A$1:$I$60` 또는 `'내 시트'!$A$1` → 시트 이름. 없으면 null. */
function referencedSheetName(reference: string): string | null {
  const found = /^\s*(?:'((?:[^']|'')*)'|([^!']+))!/.exec(reference);
  if (!found) return null;
  return found[1] !== undefined ? found[1].replace(/''/g, "'") : (found[2] ?? null);
}

/** `$B$8:$AV$64` · `B8` 둘 다. 절대참조 표시는 자리와 상관이 없다. */
function parseRange(text: string): CellRange | null {
  const [rawStart, rawEnd] = text.trim().split(":");
  const start = parseCellAddress(rawStart);
  const end = parseCellAddress(rawEnd ?? rawStart);
  if (!start || !end) return null;

  return {
    firstRow: Math.min(start.row, end.row),
    lastRow: Math.max(start.row, end.row),
    firstColumn: Math.min(start.column, end.column),
    lastColumn: Math.max(start.column, end.column),
  };
}

function parseCellAddress(value: string | undefined): { column: number; row: number } | null {
  if (value === undefined) return null;
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { column: columnToNumber(match[1]), row: Number(match[2]) };
}

/** `A`=1 … `Z`=26, `AA`=27. 26진수인데 0이 없다. */
function columnToNumber(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

// ── 열 너비 · 행 높이 ────────────────────────────────────────────────────

type ColumnWidths = { spans: { min: number; max: number; px: number }[]; defaultPx: number };

/**
 * 🔴 열 너비는 **양식의 `<cols>` 에서 읽는다** — 채우개가 본문 줄을 나눌 때
 * 같은 곳을 읽는 것과 같은 이유다(`readColumnRangeWidth`). 사람이 Excel 에서 열
 * 너비를 고치는 날 화면이 따라가야 한다.
 *
 * 숨긴 열(`hidden="1"`)은 0 이다. 이 양식은 63열부터 숨겨 두었는데, 그것이
 * 인쇄 영역 안에 들어오는 날 도우미 값이 문서에 나타나면 안 된다.
 */
function readColumnWidths(sheetXml: string): ColumnWidths {
  const spans: { min: number; max: number; px: number }[] = [];

  for (const match of sheetXml.matchAll(/<col\b[^>]*\/>/g)) {
    const tag = match[0];
    const min = Number(/\smin="(\d+)"/.exec(tag)?.[1]);
    const max = Number(/\smax="(\d+)"/.exec(tag)?.[1]);
    if (!Number.isInteger(min) || !Number.isInteger(max)) continue;

    const hidden = /\shidden="(?:1|true)"/.test(tag);
    const width = Number(/\swidth="([\d.]+)"/.exec(tag)?.[1]);
    spans.push({
      min,
      max,
      px: hidden ? 0 : charsToPixels(Number.isFinite(width) ? width : DEFAULT_COLUMN_WIDTH_CHARS),
    });
  }

  const defaultChars = Number(/<sheetFormatPr[^>]*\sdefaultColWidth="([\d.]+)"/.exec(sheetXml)?.[1]);
  return {
    spans,
    defaultPx: charsToPixels(Number.isFinite(defaultChars) ? defaultChars : DEFAULT_COLUMN_WIDTH_CHARS),
  };
}

/** 위 `MAX_DIGIT_WIDTH_PX` 의 환산식. */
function charsToPixels(chars: number): number {
  const mdw = MAX_DIGIT_WIDTH_PX;
  return Math.trunc(((256 * chars + Math.trunc(128 / mdw)) / 256) * mdw);
}

function columnWidthPx(widths: ColumnWidths, column: number): number {
  for (const span of widths.spans) {
    if (column >= span.min && column <= span.max) return span.px;
  }
  return widths.defaultPx;
}

/**
 * 행 번호 → 높이(pt). **0번 자리에 기본 높이**를 담아 둔다 — 시트에 `<row>` 가
 * 아예 없는 행(값도 서식도 없는 빈 줄)이 인쇄 영역 안에 있을 수 있다.
 *
 * 높이는 이미 pt 단위다(OOXML `ht`). 숨긴 행은 0 이다.
 */
function readRowHeights(sheetXml: string, sheetRows: readonly SheetRow[]): Map<number, number> {
  const declared = Number(/<sheetFormatPr[^>]*\sdefaultRowHeight="([\d.]+)"/.exec(sheetXml)?.[1]);
  const fallback = Number.isFinite(declared) ? declared : DEFAULT_ROW_HEIGHT_PT;

  const heights = new Map<number, number>([[0, fallback]]);
  for (const row of sheetRows) {
    const openTag = row.xml.slice(0, row.xml.indexOf(">") + 1);
    if (/\shidden="(?:1|true)"/.test(openTag)) {
      heights.set(row.rowNumber, 0);
      continue;
    }
    const height = Number(/\sht="([\d.]+)"/.exec(openTag)?.[1]);
    heights.set(row.rowNumber, Number.isFinite(height) ? height : fallback);
  }
  return heights;
}

// ── 셀 ───────────────────────────────────────────────────────────────────

/**
 * `raw` · `type` 은 2026-09-16(②b 재작업)에 더했다 — 칸 값의 종류(일반 맞춤)와 조건부 서식의
 * 비교에 쓴다. `raw` 는 서식을 먹이기 전의 값(공유문자열은 풀린 글자), 없으면 null.
 */
type SheetCell = { text: string; styleIndex: number | null; raw: string | null; type: string | null };

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/** 셀의 날 글자(없으면 null) · 형식(`t`) · 서식 번호 → 화면에 찍힐 글자. */
type CellTextFormatter = (raw: string | null, type: string | null, styleIndex: number | null) => string;

/**
 * 인쇄 영역 안에서 시트가 실제로 갖고 있는 칸들.
 *
 * 🔴 후리가나를 걷어 낸 공유문자열을 `createCellTextReader` 에 넘긴다(머리말).
 * 🔴 리더에는 **행 하나의 XML** 만 넘긴다(머리말의 실측).
 */
function readSheetCells(
  sheetRows: readonly SheetRow[],
  sharedStringsXml: string | null,
  range: CellRange,
  format: CellTextFormatter
): Map<string, SheetCell> {
  const shared = stripPhoneticRuns(sharedStringsXml);
  const cells = new Map<string, SheetCell>();

  for (const row of sheetRows) {
    if (row.rowNumber < range.firstRow || row.rowNumber > range.lastRow) continue;
    const read = createCellTextReader(row.xml, shared);

    // 주소(`r`)는 늘 첫 속성이다 — `sheet-patch.ts` 의 `findCell` 이 이미 그것을
    // 전제로 셀을 찾고 있고, 이 파일이 읽는 시트는 그 함수가 손본 것이다.
    for (const match of row.xml.matchAll(/<c\s+r="([A-Z]+)(\d+)"([^>]*)>/g)) {
      const column = columnToNumber(match[1]);
      if (column < range.firstColumn || column > range.lastColumn) continue;

      const ref = `${match[1]}${match[2]}`;
      const attributes = match[3];
      const rawStyle = /\ss="(\d+)"/.exec(attributes)?.[1];
      const type = /\st="([^"]*)"/.exec(attributes)?.[1] ?? null;
      const styleIndex = rawStyle === undefined ? null : Number(rawStyle);

      const raw = read(ref);
      cells.set(cellKey(Number(match[2]), column), {
        text: format(raw, type, styleIndex),
        styleIndex,
        raw,
        type,
      });
    }
  }

  return cells;
}

/**
 * 셀에 찍히는 글자.
 *
 * ── ISO 날짜 칸(`t="d"`) — 🔴 예전 길 그대로 ───────────────────────────
 * 보고서 통합문서는 `dateCompatibility="0"` 이라 날짜가 일련번호가 아니라
 * ISO 8601(`t="d"`)로 들어 있고(채우개의 `setIsoDate`), 그대로 두면
 * 「2026-09-02」로 나온다. 이 칸은 서식 코드를 보지 않고 늘 한국어 긴 날짜로 그린다
 * — 보고서의 날짜 칸 넷이 전부 `[$-F800]` 이라 서식을 읽어도 같은 글자이지만,
 * 불변식(보고서 결과 불변)을 코드의 길로도 지키려고 갈라 두었다.
 *
 * ── 🔴 요일까지 그린다 (2026-09-02 사용자 결정) ─────────────────────────
 * 양식이 쓰는 날짜 서식은 `[$-F800]`(**시스템 긴 날짜**) 하나이고, 날짜 칸 넷
 * (`AO8` 발행 · `AK14` 접수 · `AF27` 현품 인수 · `AF28` 조치 완료)이 전부 그것이다.
 * 그것이 무엇으로 보이는지는 파일을 여는 사람의 OS 설정을 따르는데, **사용자가
 * 실제로 쓰는 한국어 Windows 의 Excel 은 요일까지 그린다.** 예전에는 "읽는 사람의
 * OS 를 알 수 없으니 지어내지 않는다"며 「2026년 9월 2일」까지만 적었지만, 그러면
 * 미리보기와 내려받은 파일이 **같은 칸을 다르게 보여 준다** — 이 미리보기가 애초에
 * 없애려던 어긋남이 바로 그것이다.
 *
 * 칸 넷이 같은 서식이라 여기 한 자리만 고치면 넷이 함께 따라온다. 하나만 요일이
 * 붙으면 그것이 더 이상하다.
 *
 * ⚠️ **미리보기에만 걸리는 손질이다.** 내려받는 xlsx 는 이 함수를 지나가지 않고
 * Excel 이 스스로 서식을 그리므로, 채우개(`service-report-template.ts`)에는 고칠
 * 것이 없다. 값(`2026-09-02`)은 양쪽이 한 글자도 다르지 않고 꾸밈만 맞춘 것이다.
 *
 * ⚠️ 양식이 언젠가 보통(transitional) 통합문서로 다시 저장되면 날짜가 일련번호로
 * 바뀐다(`usesIsoDates` 참조). 그때는 아래 숫자 칸의 길로 가서 `[$-F800]` 서식이
 * 같은 「2026년 9월 2일 수요일」을 그린다(`number-format.ts`).
 *
 * ── 숫자 칸 · 글자 칸 — 서식대로 (2026-09-16, 견적서 ②a) ──────────────────
 * 숫자 칸(`t` 없음 · `t="n"`)은 서식 코드대로(`formatNumber`), 글자 칸(`s` ·
 * `inlineStr` · `str`)은 서식의 **글자 구역**이 있을 때만 그 모양으로(`formatText`)
 * 적는다. 🔴 **모르는 서식이면 날 값 그대로다** — 머리말의 「서식을 못 읽으면
 * 밋밋하게 넘어간다」. 참/거짓(`b`) · 오류(`e`)는 예전처럼 날 값이다.
 */
function displayText(
  raw: string | null,
  type: string | null,
  numberFormat: string | null,
  dateSystem: ExcelDateSystem
): string {
  if (raw === null) return "";
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (type === "d") {
    const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (!date) return text;
    return koreanLongDate(Number(date[1]), Number(date[2]), Number(date[3]));
  }

  if (numberFormat === null) return text;

  if (type === null || type === "n") {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return text;
    return formatNumber(value, numberFormat, dateSystem) ?? text;
  }
  if (type === "s" || type === "inlineStr" || type === "str") {
    return formatText(text, numberFormat) ?? text;
  }
  return text;
}

/**
 * 후리가나(`<rPh>`)를 걷어 낸 공유문자열 — **읽으려고 만든 사본**이다. 원본은
 * 손대지 않고, 이 결과는 파일로 다시 나가지 않는다
 * (`service-report-choices.ts` 의 같은 함수와 같은 판단).
 */
function stripPhoneticRuns(sharedStringsXml: string | null): string | null {
  if (sharedStringsXml === null) return null;
  return sharedStringsXml
    .replace(/<rPh\b[^>]*\/>/g, "")
    .replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
}

/** 인쇄 영역과 겹치는 병합들. 삐져나온 쪽은 **잘라서** 담는다. */
function readMerges(sheetXml: string, range: CellRange): MergeRange[] {
  const merges: MergeRange[] = [];

  for (const match of sheetXml.matchAll(/<mergeCell\b[^>]*\sref="([^"]+)"[^>]*\/>/g)) {
    const parsed = parseRange(match[1]);
    if (!parsed) continue;

    const clipped: MergeRange = {
      firstRow: Math.max(parsed.firstRow, range.firstRow),
      lastRow: Math.min(parsed.lastRow, range.lastRow),
      firstColumn: Math.max(parsed.firstColumn, range.firstColumn),
      lastColumn: Math.min(parsed.lastColumn, range.lastColumn),
    };
    // 인쇄 영역 밖의 병합(이 양식은 `BK10:DC10` 같은 도우미가 있다)은 안 그린다.
    if (clipped.firstRow > clipped.lastRow || clipped.firstColumn > clipped.lastColumn) continue;
    merges.push(clipped);
  }

  return merges;
}

// ── 서식 ─────────────────────────────────────────────────────────────────

type XfStyle = {
  borderId: number | null;
  fontId: number | null;
  fillId: number | null;
  numFmtId: number | null;
  parentXfId: number | null;
  align: string | null;
  verticalAlign: string | null;
  wrap: boolean | null;
};

type StyleTable = {
  alignOf(styleIndex: number | null | undefined): string | null;
  verticalAlignOf(styleIndex: number | null | undefined): string | null;
  wrapOf(styleIndex: number | null | undefined): boolean;
  boldOf(styleIndex: number | null | undefined): boolean;
  fontSizeOf(styleIndex: number | null | undefined): number | null;
  bordersOf(styleIndex: number | null | undefined): PrintGridBorders;
  /** 서식 코드. 모르는 번호 · 서식 파일이 없으면 null — 글자는 날 값 그대로. */
  numberFormatOf(styleIndex: number | null | undefined): string | null;
  fontColorOf(styleIndex: number | null | undefined): string | null;
  backgroundColorOf(styleIndex: number | null | undefined): string | null;
};

const EMPTY_BORDERS: PrintGridBorders = { top: null, right: null, bottom: null, left: null };

/**
 * 🔴 `<xf>` 하나를 잡는 정규식. `[^>]*` 를 **탐욕적으로** 쓰면 자체닫힘의 `/` 를
 * 삼킨 뒤 다음 `xf` 까지 한 덩이가 되어 **번호가 밀린다** — 그러면 문서 전체의
 * 서식이 어긋난다(`workbook-parts.ts` 의 `CELL_XF` 가 같은 자리에서 같은 것을
 * 겪었다. 그 상수는 내보내지 않으므로 같은 판단을 여기 다시 적는다).
 */
const XF_PATTERN = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
const BORDER_PATTERN = /<border\b[^>]*?(?:\/>|>[\s\S]*?<\/border>)/g;
const FONT_PATTERN = /<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g;
const FILL_PATTERN = /<fill\b[^>]*?(?:\/>|>[\s\S]*?<\/fill>)/g;

/**
 * `styles.xml` 을 읽어 «서식 번호 → 실제 모양» 을 답해 주는 표.
 *
 * 못 읽으면 **전부 null 을 답하는 표**를 돌려준다 — 테두리도 정렬도 없는 밋밋한
 * 표가 나오지만 값은 제자리에 있다(머리말의 '서식을 못 읽으면 넘어간다').
 */
function readStyles(stylesXml: string | null): StyleTable {
  const blank: StyleTable = {
    alignOf: () => null,
    verticalAlignOf: () => null,
    wrapOf: () => false,
    boldOf: () => false,
    fontSizeOf: () => null,
    bordersOf: () => EMPTY_BORDERS,
    numberFormatOf: () => null,
    fontColorOf: () => null,
    backgroundColorOf: () => null,
  };
  if (stylesXml === null) return blank;

  const cellXfs = readXfBlock(stylesXml, "cellXfs");
  const cellStyleXfs = readXfBlock(stylesXml, "cellStyleXfs");
  if (cellXfs.length === 0) return blank;

  const borders = readBorders(stylesXml);
  const fonts = readFonts(stylesXml);
  const fills = readFills(stylesXml);
  const numberFormats = readNumberFormats(stylesXml);

  const xfOf = (styleIndex: number | null | undefined): XfStyle | null =>
    styleIndex === null || styleIndex === undefined ? null : (cellXfs[styleIndex] ?? null);

  /**
   * 맞춤은 `<xf>` 에 없으면 **이름 있는 서식**(`xfId` → `cellStyleXfs`)에서
   * 물려받는다. 한 칸만 물려받는다 — 그 위로 더 올라가는 통합문서는 이 양식에
   * 없고, 없는 경우를 위해 상속 사슬을 만들면 그것이 또 하나의 짐작이 된다.
   */
  const alignSource = (xf: XfStyle | null): XfStyle | null => {
    if (xf === null) return null;
    if (xf.align !== null || xf.verticalAlign !== null || xf.wrap !== null) return xf;
    if (xf.parentXfId === null) return xf;
    return cellStyleXfs[xf.parentXfId] ?? xf;
  };

  return {
    alignOf: (index) => alignSource(xfOf(index))?.align ?? null,
    verticalAlignOf: (index) => alignSource(xfOf(index))?.verticalAlign ?? null,
    wrapOf: (index) => alignSource(xfOf(index))?.wrap === true,
    boldOf: (index) => {
      const fontId = xfOf(index)?.fontId;
      return fontId === null || fontId === undefined ? false : (fonts[fontId]?.bold ?? false);
    },
    fontSizeOf: (index) => {
      const fontId = xfOf(index)?.fontId;
      return fontId === null || fontId === undefined ? null : (fonts[fontId]?.sizePt ?? null);
    },
    bordersOf: (index) => {
      const borderId = xfOf(index)?.borderId;
      if (borderId === null || borderId === undefined) return EMPTY_BORDERS;
      return borders[borderId] ?? EMPTY_BORDERS;
    },
    /**
     * 🔴 `s` 가 없는 칸은 Excel 에서 **0번 서식**이다. 맞춤 · 테두리는 예전처럼
     * «서식 없음»으로 두지만(0번은 늘 밋밋하다), 숫자 서식은 0번을 따라야 0번이
     * 날짜인 통합문서를 제대로 그린다. 파일이 적은 `<numFmt>` 가 기본 제공 번호보다
     * 이긴다 — 이 저장소 견적서 양식이 41 · 42 를 그렇게 적어 두었다.
     */
    numberFormatOf: (index) => {
      const numFmtId = xfOf(index ?? 0)?.numFmtId ?? 0;
      return numberFormats.get(numFmtId) ?? builtInNumberFormat(numFmtId);
    },
    fontColorOf: (index) => {
      const fontId = xfOf(index)?.fontId;
      return fontId === null || fontId === undefined ? null : (fonts[fontId]?.color ?? null);
    },
    backgroundColorOf: (index) => {
      const fillId = xfOf(index)?.fillId;
      return fillId === null || fillId === undefined ? null : (fills[fillId] ?? null);
    },
  };
}

function readXfBlock(stylesXml: string, tag: "cellXfs" | "cellStyleXfs"): XfStyle[] {
  const block = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(XF_PATTERN)].map((match) => {
    const xf = match[0];
    const openTag = xf.slice(0, xf.indexOf(">") + 1);
    const alignment = /<alignment\b[^>]*\/?>/.exec(xf)?.[0] ?? null;

    return {
      borderId: numberAttribute(openTag, "borderId"),
      fontId: numberAttribute(openTag, "fontId"),
      fillId: numberAttribute(openTag, "fillId"),
      numFmtId: numberAttribute(openTag, "numFmtId"),
      parentXfId: numberAttribute(openTag, "xfId"),
      align: alignment === null ? null : (/\shorizontal="([^"]*)"/.exec(alignment)?.[1] ?? null),
      verticalAlign: alignment === null ? null : (/\svertical="([^"]*)"/.exec(alignment)?.[1] ?? null),
      wrap: alignment === null ? null : /\swrapText="(?:1|true)"/.test(alignment),
    };
  });
}

/**
 * 🔴 이 통합문서는 `conformance="strict"` 라 테두리 이름이 **`start`/`end`** 다
 * (보통 판은 `left`/`right`). 둘 다 알아듣는다 — 한쪽만 보면 이 양식에서는
 * 세로 테두리가 통째로 사라지고, 격자 서식인 보고서는 그 순간 표로 안 보인다.
 * 가로쓰기 문서라 `start` = 왼쪽이다.
 */
function readBorders(stylesXml: string): PrintGridBorders[] {
  const block = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(BORDER_PATTERN)].map((match) => ({
    top: borderSide(match[0], "top"),
    bottom: borderSide(match[0], "bottom"),
    left: borderSide(match[0], "left") ?? borderSide(match[0], "start"),
    right: borderSide(match[0], "right") ?? borderSide(match[0], "end"),
  }));
}

function borderSide(border: string, side: string): PrintGridBorderStyle {
  const tag = new RegExp(`<${side}\\b[^>]*?(?:/>|>)`).exec(border)?.[0];
  if (tag === undefined) return null;
  return /\sstyle="([^"]*)"/.exec(tag)?.[1] ?? null;
}

function readFonts(stylesXml: string): { sizePt: number | null; bold: boolean; color: string | null }[] {
  const block = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(FONT_PATTERN)].map((match) => {
    const size = Number(/<sz\b[^>]*\sval="([\d.]+)"/.exec(match[0])?.[1]);
    const colorTag = /<color\b[^>]*\/?>/.exec(match[0])?.[0];
    return {
      sizePt: Number.isFinite(size) ? size : null,
      // `<b/>` 와 `<b val="1"/>` 둘 다 굵게다. `<b val="0"/>` 은 아니다.
      bold: /<b\b(?![^>]*\sval="(?:0|false)")[^>]*\/?>/.test(match[0]),
      color: colorTag === undefined ? null : rgbColor(colorTag),
    };
  });
}

/**
 * 채움 번호 → 칸 배경. 🔴 **단색(`solid`) 채움만** 읽는다 — 그때의 색은 `fgColor` 다
 * (이름과 달리 배경색이 여기 담긴다). 0번 · 1번(`none` · `gray125`)을 비롯한 무늬
 * 채움과 그라데이션은 null.
 */
function readFills(stylesXml: string): (string | null)[] {
  const block = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(FILL_PATTERN)].map((match) => {
    const pattern = /<patternFill\b[^>]*>/.exec(match[0])?.[0];
    if (pattern === undefined || !/\spatternType="solid"/.test(pattern)) return null;
    const foreground = /<fgColor\b[^>]*\/?>/.exec(match[0])?.[0];
    return foreground === undefined ? null : rgbColor(foreground);
  });
}

/**
 * 파일이 적은 사용자 서식(`<numFmt numFmtId formatCode>`). 서식 코드는 XML 로
 * 탈출돼 있다(`&quot;₩&quot;#,##0`) — 숫자 참조까지 한 번에 푼다.
 */
function readNumberFormats(stylesXml: string): Map<number, string> {
  const formats = new Map<number, string>();
  const block = /<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/.exec(stylesXml);
  if (!block) return formats;

  for (const match of block[1].matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = numberAttribute(match[0], "numFmtId");
    const code = /\sformatCode="([^"]*)"/.exec(match[0])?.[1];
    if (id === null || code === undefined) continue;
    formats.set(id, decodeXmlCharacterData(code));
  }
  return formats;
}

/**
 * `<color rgb="FFFF0000"/>` → `#FF0000`(앞 두 자리는 불투명도라 뗀다).
 *
 * 🔴 **rgb 로 적힌 것만** — 테마 색(`theme`) · 색 번호(`indexed`) · 자동(`auto`)은
 * 통합문서의 테마와 팔레트를 풀어야 알 수 있고, 틴트(`tint`)가 걸리면 밝기를 셈해야
 * 한다. 모르면 null(화면의 기본색) — 짐작한 색을 칠하지 않는다.
 */
function rgbColor(tag: string): string | null {
  const tint = Number(/\stint="([^"]*)"/.exec(tag)?.[1] ?? "0");
  if (tint !== 0) return null;
  const rgb = /\srgb="([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})"/.exec(tag)?.[1];
  return rgb === undefined ? null : `#${rgb.slice(-6).toUpperCase()}`;
}

function numberAttribute(tag: string, name: string): number | null {
  const value = Number(new RegExp(`\\s${name}="(\\d+)"`).exec(tag)?.[1]);
  return Number.isInteger(value) ? value : null;
}

/**
 * 병합 칸 하나의 네 변. 각 변에 **실제로 놓인 칸들**을 훑어 처음 만나는 테두리를
 * 쓴다(머리말의 '병합 칸의 테두리는 가장자리 셀들에서 모은다').
 *
 * 병합이 아니면 범위가 한 칸이라 자기 자신의 네 변이 그대로 나온다.
 */
function collectBorders(
  cells: Map<string, SheetCell>,
  styles: StyleTable,
  firstRow: number,
  firstColumn: number,
  lastRow: number,
  lastColumn: number
): PrintGridBorders {
  const sideOf = (row: number, column: number): PrintGridBorders =>
    styles.bordersOf(cells.get(cellKey(row, column))?.styleIndex);

  let top: PrintGridBorderStyle = null;
  let bottom: PrintGridBorderStyle = null;
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    top ??= sideOf(firstRow, column).top;
    bottom ??= sideOf(lastRow, column).bottom;
  }

  let left: PrintGridBorderStyle = null;
  let right: PrintGridBorderStyle = null;
  for (let row = firstRow; row <= lastRow; row += 1) {
    left ??= sideOf(row, firstColumn).left;
    right ??= sideOf(row, lastColumn).right;
  }

  return { top, right, bottom, left };
}

// ── 칸 값의 종류 (2026-09-16, 견적서 ②b 재작업) ─────────────────────────────

/**
 * 칸 값의 종류 — 화면이 Excel 의 「일반」 가로 맞춤을 따라 할 때 쓴다.
 *
 * `t` 속성으로 가른다: 공유문자열 · 인라인 글자 · 수식의 글자 결과(`s` · `inlineStr` · `str`)는
 * 글자, `b` 는 참/거짓, `e` 는 오류, `t="d"`(ISO 날짜)와 `t` 없음 · `n` 은 수. 🔴 수여도 서식이
 * 딱 `@`(글자)면 글자로 친다 — 보고서 양식의 숫자 칸이 그렇고, 그 칸들은 예전처럼 왼쪽이다.
 * 값이 없으면 null(빈 칸 — 맞출 것이 없다).
 */
function valueKindOf(found: SheetCell | undefined, numberFormat: string | null): PrintGridValueKind | null {
  if (found === undefined || found.raw === null || found.raw === "") return null;
  switch (found.type) {
    case "s":
    case "inlineStr":
    case "str":
      return "text";
    case "b":
      return "boolean";
    case "e":
      return "error";
    case "d":
      return "number";
    default:
      if (!Number.isFinite(Number(found.raw))) return "text";
      return numberFormat !== null && numberFormat.trim() === "@" ? "text" : "number";
  }
}

// ── 조건부 서식 (2026-09-16, 견적서 ②b 재작업) ─────────────────────────────

/**
 * 🔴 **부르는 쪽이 `conditionalFormatting: "apply"` 를 줄 때만** 읽는다(SheetPrintGridOptions —
 * 보고서는 주지 않는다).
 *
 * ── 왜 읽게 되었나 ──────────────────────────────────────────────────────
 * 앱 제너레이터 내자 양식(과 그것으로 사람이 만든 견적서 엑셀)은 「공 급 가」 줄 바로 위, 금액
 * 열에 도우미 칸(`=N45`)을 두고 **「값이 0 이면 흰 글자」**(`cellIs equal 0` → dxf 의
 * `<color theme="0"/>` = 테마의 lt1, 흰색) 규칙으로 감춰 두었다(실측). Excel 은 그 ₩0 을 흰
 * 글자로 그려 PDF 에 안 보이는데, 조건부 서식을 모르는 미리보기는 검정 「₩0」을 찍었다.
 *
 * ── 🔴 읽는 것 · 안 읽는 것 ─────────────────────────────────────────────
 *   읽는다    `cellIs`(같음 · 다름 · 큼 · 작음 · 이상 · 이하 · 사이 · 사이 아님 — 비교 값이
 *             숫자 · 따옴표 글자 · TRUE/FALSE 인 것) · `containsBlanks` · `notContainsBlanks`,
 *             그 서식(dxf)의 **글자 색 · 칸 배경**(rgb · 테마 색 + 틴트 · 색 번호)
 *   안 읽는다  수식 규칙(`expression`) · 칸 참조나 함수가 든 비교 값 · 색 막대 · 색조 · 아이콘 ·
 *             상위/하위 · 중복 · 글자 포함 · 날짜 규칙 · dxf 의 굵기 · 숫자 서식 · 테두리
 * 모르는 규칙은 **아무것도 입히지 않는다**(머리말의 「서식을 못 읽으면 밋밋하게」).
 *
 * 규칙이 여럿 맞으면 우선순위(`priority` 작은 것)가 먼저이고, 속성마다 먼저 정한 규칙이 이긴다.
 * `stopIfTrue` 인 규칙이 맞으면 그 뒤는 보지 않는다(Excel 의 규칙).
 */
type ConditionalOverlay = (
  row: number,
  column: number,
  cell: SheetCell | undefined
) => { fontColor: string | null; backgroundColor: string | null } | null;

type CfOperand = { kind: "number"; value: number } | { kind: "text"; value: string } | { kind: "boolean"; value: boolean };

type CfValue = CfOperand | { kind: "blank" } | { kind: "unknown" };

type DxfStyle = { fontColor: string | null; backgroundColor: string | null };

type CfRule = {
  ranges: CellRange[];
  test: (value: CfValue) => boolean;
  dxf: DxfStyle;
  priority: number;
  stopIfTrue: boolean;
};

const CF_OPERATORS = new Set([
  "equal",
  "notEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "notBetween",
]);

function readConditionalFormats(
  sheetXml: string,
  stylesXml: string | null,
  themeXml: string | null
): ConditionalOverlay | null {
  const dxfs = readDxfs(stylesXml, readThemeColors(themeXml), readIndexedPalette(stylesXml));
  const rules: CfRule[] = [];

  // `<x14:conditionalFormatting>`(확장 목록 안)은 이 정규식에 걸리지 않는다 — 안 읽는다.
  for (const block of sheetXml.matchAll(/<conditionalFormatting\b([^>]*)>([\s\S]*?)<\/conditionalFormatting>/g)) {
    const sqref = /\ssqref="([^"]*)"/.exec(block[1])?.[1] ?? "";
    const ranges = sqref
      .split(/\s+/)
      .map((piece) => (piece === "" ? null : parseRange(piece)))
      .filter((range): range is CellRange => range !== null);
    if (ranges.length === 0) continue;

    for (const rule of block[2].matchAll(/<cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/g)) {
      const attributes = rule[1];
      const dxfId = numberAttribute(attributes, "dxfId");
      const dxf = dxfId === null ? undefined : dxfs[dxfId];
      if (dxf === undefined || (dxf.fontColor === null && dxf.backgroundColor === null)) continue;

      const test = ruleTest(
        /\stype="([^"]*)"/.exec(attributes)?.[1] ?? "",
        /\soperator="([^"]*)"/.exec(attributes)?.[1] ?? null,
        [...(rule[2] ?? "").matchAll(/<formula>([\s\S]*?)<\/formula>/g)].map((match) => decodeXmlCharacterData(match[1]))
      );
      if (test === null) continue;

      rules.push({
        ranges,
        test,
        dxf,
        priority: numberAttribute(attributes, "priority") ?? Number.MAX_SAFE_INTEGER,
        stopIfTrue: /\sstopIfTrue="(?:1|true)"/.test(attributes),
      });
    }
  }
  if (rules.length === 0) return null;
  rules.sort((a, b) => a.priority - b.priority);

  return (row, column, cell) => {
    let fontColor: string | null = null;
    let backgroundColor: string | null = null;
    let value: CfValue | undefined;
    for (const rule of rules) {
      if (!rule.ranges.some((range) => inRange(range, row, column))) continue;
      value ??= cfValueOf(cell);
      if (!rule.test(value)) continue;
      fontColor ??= rule.dxf.fontColor;
      backgroundColor ??= rule.dxf.backgroundColor;
      if (rule.stopIfTrue) break;
    }
    return fontColor === null && backgroundColor === null ? null : { fontColor, backgroundColor };
  };
}

function inRange(range: CellRange, row: number, column: number): boolean {
  return row >= range.firstRow && row <= range.lastRow && column >= range.firstColumn && column <= range.lastColumn;
}

/** 규칙 하나 → 값 시험. 모르는 규칙이면 null. */
function ruleTest(type: string, operator: string | null, formulas: readonly string[]): ((value: CfValue) => boolean) | null {
  if (type === "containsBlanks") return (value) => isBlankForCf(value);
  if (type === "notContainsBlanks") return (value) => !isBlankForCf(value);
  if (type !== "cellIs" || operator === null || !CF_OPERATORS.has(operator)) return null;

  const operands = formulas.map(parseCfOperand);
  const needed = operator === "between" || operator === "notBetween" ? 2 : 1;
  if (operands.length < needed || operands.slice(0, needed).some((operand) => operand === null)) return null;
  const [first, second] = operands as CfOperand[];

  return (value) => {
    if (value.kind === "unknown") return false; // 오류 칸 · ISO 날짜 — 견주지 않는다
    const against = (operand: CfOperand) => compareCf(value.kind === "blank" ? blankAs(operand) : value, operand);
    switch (operator) {
      case "equal":
        return against(first) === 0;
      case "notEqual":
        return against(first) !== 0;
      case "greaterThan":
        return against(first) > 0;
      case "greaterThanOrEqual":
        return against(first) >= 0;
      case "lessThan":
        return against(first) < 0;
      case "lessThanOrEqual":
        return against(first) <= 0;
      default: {
        // 사이 · 사이 아님 — Excel 은 두 값의 순서를 가리지 않는다(작은 쪽 ~ 큰 쪽).
        const [low, high] = compareCf(first, second) <= 0 ? [first, second] : [second, first];
        const inside = against(low) >= 0 && against(high) <= 0;
        return operator === "between" ? inside : !inside;
      }
    }
  };
}

/** 비교 값 — 숫자 · 따옴표 글자(`""` 는 `"`) · TRUE/FALSE 만. 칸 참조 · 함수는 모른다(null). */
function parseCfOperand(formula: string): CfOperand | null {
  const text = formula.trim();
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) return { kind: "number", value: Number(text) };
  const quoted = /^"((?:[^"]|"")*)"$/.exec(text);
  if (quoted) return { kind: "text", value: quoted[1].replace(/""/g, '"') };
  if (/^(?:TRUE|FALSE)$/i.test(text)) return { kind: "boolean", value: text.toUpperCase() === "TRUE" };
  return null;
}

/** 조건부 서식이 보는 칸의 값 — 서식을 먹이기 전의 값이다(Excel 도 값으로 견준다). */
function cfValueOf(cell: SheetCell | undefined): CfValue {
  if (cell === undefined || cell.raw === null || cell.raw === "") return { kind: "blank" };
  switch (cell.type) {
    case "s":
    case "inlineStr":
    case "str":
      return { kind: "text", value: cell.raw };
    case "b":
      return { kind: "boolean", value: cell.raw === "1" || cell.raw.toLowerCase() === "true" };
    case "e":
    case "d":
      return { kind: "unknown" };
    default: {
      const value = Number(cell.raw);
      return Number.isFinite(value) ? { kind: "number", value } : { kind: "text", value: cell.raw };
    }
  }
}

/** 「공백 포함」 — Excel 의 `LEN(TRIM(칸))=0`. 수는 비지 않았다. */
function isBlankForCf(value: CfValue): boolean {
  if (value.kind === "blank") return true;
  return value.kind === "text" && value.value.trim() === "";
}

/** 🔴 빈 칸은 견주는 값의 종류로 읽힌다 — 숫자면 0, 글자면 "", 참/거짓이면 FALSE(Excel 규칙). */
function blankAs(operand: CfOperand): CfOperand {
  if (operand.kind === "number") return { kind: "number", value: 0 };
  if (operand.kind === "text") return { kind: "text", value: "" };
  return { kind: "boolean", value: false };
}

/** Excel 의 값 순서 — 수 < 글자 < 참/거짓. 글자는 대소문자를 가리지 않는다. */
function compareCf(a: CfOperand, b: CfOperand): number {
  const rank = { number: 0, text: 1, boolean: 2 } as const;
  if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
  if (a.kind === "number" && b.kind === "number") return a.value === b.value ? 0 : a.value < b.value ? -1 : 1;
  if (a.kind === "boolean" && b.kind === "boolean") return Number(a.value) - Number(b.value);
  const left = String(a.value).toLowerCase();
  const right = String(b.value).toLowerCase();
  return left === right ? 0 : left < right ? -1 : 1;
}

const DXF_PATTERN = /<dxf\b[^>]*?(?:\/>|>[\s\S]*?<\/dxf>)/g;

/**
 * 조건부 서식의 서식표(`<dxfs>`). 글자 색과 칸 배경만. 🔴 dxf 의 단색 채움은 **`bgColor`** 에
 * 담긴다(칸 서식의 채움이 `fgColor` 인 것과 반대다 — Excel 이 그렇게 적는다).
 */
function readDxfs(stylesXml: string | null, theme: readonly (string | null)[], palette: readonly string[]): DxfStyle[] {
  const block = stylesXml === null ? undefined : /<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(stylesXml)?.[1];
  if (block === undefined) return [];

  return [...block.matchAll(DXF_PATTERN)].map((match) => {
    const dxf = match[0];
    const fontColorTag = /<font\b[^>]*>[\s\S]*?(<color\b[^>]*\/?>)[\s\S]*?<\/font>/.exec(dxf)?.[1];
    const pattern = /<patternFill\b([^>]*)>([\s\S]*?)<\/patternFill>/.exec(dxf);
    let backgroundColor: string | null = null;
    if (pattern !== null) {
      const patternType = /\spatternType="([^"]*)"/.exec(pattern[1])?.[1] ?? "solid";
      if (patternType === "solid") {
        const colorTag = /<bgColor\b[^>]*\/?>/.exec(pattern[2])?.[0] ?? /<fgColor\b[^>]*\/?>/.exec(pattern[2])?.[0];
        backgroundColor = colorTag === undefined ? null : resolveColor(colorTag, theme, palette);
      }
    }
    return {
      fontColor: fontColorTag === undefined ? null : resolveColor(fontColorTag, theme, palette),
      backgroundColor,
    };
  });
}

/**
 * `<color …/>` 하나 → `#RRGGBB`. rgb · 테마 색(`theme`) · 색 번호(`indexed`)를 풀고 틴트를 먹인다.
 * `auto` · 모르는 번호는 null. 🔴 **조건부 서식에서만 쓴다** — 칸 서식의 색은 예전처럼
 * `rgbColor`(rgb 만)로 읽어 보고서 격자가 달라지지 않는다.
 */
function resolveColor(tag: string, theme: readonly (string | null)[], palette: readonly string[]): string | null {
  const tint = Number(/\stint="([^"]*)"/.exec(tag)?.[1] ?? "0");
  let base: string | null = null;
  const rgb = /\srgb="([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})"/.exec(tag)?.[1];
  const themeIndex = numberAttribute(tag, "theme");
  const indexed = numberAttribute(tag, "indexed");
  if (rgb !== undefined) base = rgb.slice(-6).toUpperCase();
  else if (themeIndex !== null) base = theme[themeIndex] ?? null;
  else if (indexed !== null) base = palette[indexed] ?? null;
  if (base === null) return null;
  return `#${Number.isFinite(tint) && tint !== 0 ? applyTint(base, tint) : base}`;
}

/**
 * 테마의 색표(`<a:clrScheme>`) → 테마 색 번호 차례. 🔴 SpreadsheetML 의 번호는 앞의 두 쌍이
 * 뒤바뀐다: 0 = lt1(배경 · 흰색), 1 = dk1(글자 · 검정), 2 = lt2, 3 = dk2, 4~9 = accent1~6,
 * 10 = hlink, 11 = folHlink. 시스템 색(`sysClr`)은 적어 둔 `lastClr` 를 쓴다.
 */
function readThemeColors(themeXml: string | null): (string | null)[] {
  const scheme = themeXml === null ? undefined : /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(themeXml)?.[1];
  if (scheme === undefined) return [];
  const colorOf = (name: string): string | null => {
    const inner = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme)?.[1];
    if (inner === undefined) return null;
    const value =
      /<a:srgbClr\b[^>]*\sval="([0-9A-Fa-f]{6})"/.exec(inner)?.[1] ??
      /<a:sysClr\b[^>]*\slastClr="([0-9A-Fa-f]{6})"/.exec(inner)?.[1];
    return value === undefined ? null : value.toUpperCase();
  };
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(
    colorOf
  );
}

/**
 * 색 번호(`indexed`) → 색. Excel 의 기본 팔레트(0~63, 64 = 시스템 글자색 검정, 65 = 시스템
 * 배경색 흰색)이고, 통합문서가 `<colors><indexedColors>` 로 바꿔 두었으면 그것을 쓴다.
 */
const DEFAULT_INDEXED_PALETTE: readonly string[] = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
  "000000", "FFFFFF",
];

function readIndexedPalette(stylesXml: string | null): readonly string[] {
  const block = stylesXml === null ? undefined : /<indexedColors\b[^>]*>([\s\S]*?)<\/indexedColors>/.exec(stylesXml)?.[1];
  if (block === undefined) return DEFAULT_INDEXED_PALETTE;
  const custom = [...block.matchAll(/<rgbColor\b[^>]*\srgb="([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})"/g)].map((match) =>
    match[1].slice(-6).toUpperCase()
  );
  return custom.length === 0 ? DEFAULT_INDEXED_PALETTE : [...custom, ...DEFAULT_INDEXED_PALETTE.slice(custom.length)];
}

/**
 * 틴트 — 색의 밝기(HLS 의 L)를 옮긴다(ECMA-376 의 셈). 음수면 어둡게 `L × (1 + t)`, 양수면
 * 밝게 `L × (1 − t) + t`.
 */
function applyTint(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / delta + 2) / 6 : ((r - g) / delta + 4) / 6;
  }
  const tinted = Math.min(1, Math.max(0, tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint));

  const channel = (p: number, q: number, t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  let rgb: number[];
  if (saturation === 0) rgb = [tinted, tinted, tinted];
  else {
    const q = tinted < 0.5 ? tinted * (1 + saturation) : tinted + saturation - tinted * saturation;
    const p = 2 * tinted - q;
    rgb = [channel(p, q, hue + 1 / 3), channel(p, q, hue), channel(p, q, hue - 1 / 3)];
  }
  return rgb
    .map((value) => Math.round(value * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// ── 그림 ─────────────────────────────────────────────────────────────────

/**
 * 양식 안에 박힌 그림들의 자리.
 *
 * 🔴 **그림 파일만 담는다.** 이 양식에는 `image1.emf`·`image2.emf` 도 있지만 그것은
 * **엑셀 단추(ActiveX)** 에 붙은 것이고 인쇄에 나오지 않는다. 게다가 브라우저는
 * EMF 를 못 읽는다. 걸러 내는 방법은 이름을 견주는 것이 아니라 **어느 파트가
 * 가리키는가**다 — 시트의 그림 파트(`drawing2.xml`)가 가리키는 것은 도장 두 장
 * 뿐이고, EMF 는 도형 파트(`vmlDrawing2.vml`)가 따로 가리킨다.
 *
 * `twoCellAnchor` 만 읽는다 — 이 양식이 쓰는 것이 그것뿐이다. 다른 앵커
 * (`oneCellAnchor`·`absoluteAnchor`)를 만나면 그 그림만 건너뛴다.
 */
function readPictures(
  parts: SheetPrintGridParts,
  range: CellRange,
  columnWidths: ColumnWidths,
  rowHeights: Map<number, number>
): PrintGridPicture[] {
  if (parts.drawingXml === null || parts.drawingRelsXml === null) return [];

  const media = readDrawingImageTargets(parts.drawingRelsXml);
  if (media.size === 0) return [];

  // 인쇄 영역의 왼쪽 위(원점).
  const originPx = columnLeftPx(columnWidths, range.firstColumn);
  const originPt = rowTopPt(rowHeights, range.firstRow);
  const widthPt = columnLeftPx(columnWidths, range.lastColumn + 1) * POINTS_PER_PIXEL - originPx * POINTS_PER_PIXEL;
  const heightPt = rowTopPt(rowHeights, range.lastRow + 1) - originPt;

  const pictures: PrintGridPicture[] = [];
  const anchors = parts.drawingXml.matchAll(
    /<xdr:twoCellAnchor\b[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g
  );

  for (const anchor of anchors) {
    const block = anchor[1];
    if (!block.includes("<xdr:pic>")) continue;

    const relId = /<a:blip\b[^>]*\sr:embed="([^"]+)"/.exec(block)?.[1];
    const name = relId === undefined ? undefined : media.get(relId);
    if (name === undefined) continue;

    const from = parseAnchorPoint(block, "from");
    const to = parseAnchorPoint(block, "to");
    if (!from || !to) continue;

    // 앵커의 열·행은 **0부터** 센다(`shiftDrawingAnchorRows` 와 같은 규칙).
    const leftPt =
      (columnLeftPx(columnWidths, from.column + 1) - originPx) * POINTS_PER_PIXEL +
      from.columnOffset / EMU_PER_POINT;
    const rightPt =
      (columnLeftPx(columnWidths, to.column + 1) - originPx) * POINTS_PER_PIXEL +
      to.columnOffset / EMU_PER_POINT;
    const topPt = rowTopPt(rowHeights, from.row + 1) - originPt + from.rowOffset / EMU_PER_POINT;
    const bottomPt = rowTopPt(rowHeights, to.row + 1) - originPt + to.rowOffset / EMU_PER_POINT;

    // 인쇄 영역 밖에 있는 그림은 안 그린다 — 이 양식은 같은 도장을 숨은 도우미
    // 열(68열)에도 한 장 더 붙여 두었다.
    if (rightPt <= 0 || bottomPt <= 0 || leftPt >= widthPt || topPt >= heightPt) continue;

    pictures.push({
      name,
      leftPt,
      topPt,
      widthPt: Math.max(rightPt - leftPt, 0),
      heightPt: Math.max(bottomPt - topPt, 0),
    });
  }

  return pictures;
}

/** 그림 파트의 관계 파일에서 «rId → 파일 이름». 그림이 아닌 관계는 안 담는다. */
function readDrawingImageTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();

  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = match[0];
    if (!/\/relationships\/image"/.test(tag)) continue;

    const id = /\sId="([^"]+)"/.exec(tag)?.[1];
    const target = /\sTarget="([^"]+)"/.exec(tag)?.[1];
    if (id === undefined || target === undefined) continue;

    const name = target.split("/").pop();
    if (name === undefined || name === "") continue;
    targets.set(id, name);
  }

  return targets;
}

function parseAnchorPoint(
  block: string,
  side: "from" | "to"
): { column: number; columnOffset: number; row: number; rowOffset: number } | null {
  const inner = new RegExp(`<xdr:${side}>([\\s\\S]*?)</xdr:${side}>`).exec(block)?.[1];
  if (inner === undefined) return null;

  const value = (tag: string): number | null => {
    const found = new RegExp(`<xdr:${tag}>(-?\\d+)</xdr:${tag}>`).exec(inner)?.[1];
    return found === undefined ? null : Number(found);
  };

  const column = value("col");
  const row = value("row");
  if (column === null || row === null) return null;
  return { column, columnOffset: value("colOff") ?? 0, row, rowOffset: value("rowOff") ?? 0 };
}

/** 1열부터 `column` 바로 앞까지의 너비 합(px). */
function columnLeftPx(widths: ColumnWidths, column: number): number {
  let total = 0;
  for (let index = 1; index < column; index += 1) total += columnWidthPx(widths, index);
  return total;
}

/** 1행부터 `row` 바로 앞까지의 높이 합(pt). */
function rowTopPt(heights: Map<number, number>, row: number): number {
  const fallback = heights.get(0) ?? DEFAULT_ROW_HEIGHT_PT;
  let total = 0;
  for (let index = 1; index < row; index += 1) total += heights.get(index) ?? fallback;
  return total;
}

// ── 인쇄 설정 ────────────────────────────────────────────────────────────

/**
 * 🔴 종이·여백·배율도 **양식에서 읽는다.** 이 양식은 A4 세로 94%, 여백은 좌
 * 0.787in · 우 0.551in · 위 0.512in · 아래 0.394in 이고 가로세로 가운데다. 값을
 * 화면에 적어 두면 양식을 고친 날 미리보기만 옛 배율로 남는다.
 */
function readPageSetup(sheetXml: string): PrintGridPageSetup {
  const setup = /<pageSetup\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? "";
  const margins = /<pageMargins\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? "";
  const options = /<printOptions\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? "";

  const scale = Number(/\sscale="(\d+)"/.exec(setup)?.[1]);
  const paperSize = Number(/\spaperSize="(\d+)"/.exec(setup)?.[1]);
  const margin = (name: string, fallback: number): number => {
    const value = Number(new RegExp(`\\s${name}="([\\d.]+)"`).exec(margins)?.[1]);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    paperSize: Number.isInteger(paperSize) ? paperSize : null,
    // 배율이 없으면 100% 다. `fitToPage` 는 이 양식이 안 쓰므로 읽지 않는다.
    scale: Number.isFinite(scale) && scale > 0 ? scale / 100 : 1,
    orientation: /\sorientation="landscape"/.test(setup) ? "landscape" : "portrait",
    // 없을 때의 값은 Excel 의 기본 여백(인치)이다.
    margins: {
      left: margin("left", 0.7),
      right: margin("right", 0.7),
      top: margin("top", 0.75),
      bottom: margin("bottom", 0.75),
    },
    horizontallyCentered: /\shorizontalCentered="(?:1|true)"/.test(options),
    verticallyCentered: /\sverticalCentered="(?:1|true)"/.test(options),
  };
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // & 는 마지막이다 — 먼저 풀면 `&amp;lt;` 가 `<` 로 잘못 풀린다.
    .replace(/&amp;/g, "&");
}
