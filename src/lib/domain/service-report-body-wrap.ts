import { koreanKyosanDocumentText } from "@/lib/kyosan/report-terms";

import { textDisplayWidth, wrapTextToWidth } from "./text-wrap";

/**
 * ============================================================================
 * 보고서 본문이 문서에서 **어디서 줄이 바뀌는가** — 화면과 채우개가 함께 쓴다
 * ============================================================================
 * 작성 화면이 입력칸 옆에 「문서에서 어떻게 나올지」를 실시간으로 그린다
 * (`components/.../ServiceReportBodyPreview.tsx`). 그러려면 줄 나누기 규칙을
 * 브라우저에서도 돌릴 수 있어야 하는데, 그 규칙은 채우개
 * (`xlsx/service-report-template.ts`)에 있었고 그 모듈은 zip 읽기·쓰기를 물고
 * 있어 화면이 값으로 가져올 수 없다.
 *
 * 🔴 **그래서 규칙을 베끼지 않고 여기로 옮겼다.** 채우개는 이제 이 파일을
 * 부른다 — 한 벌뿐이다. 베껴 두면 화면이 「42자에서 나뉜다」고 그려 놓고 문서는
 * 다르게 나누는 날이 오고, 그때 미리보기는 **거짓말**이 되어 없느니만 못하다.
 *
 * ── 여기로 옮겨 온 것 (자리만 옮겼다 · 동작은 한 글자도 안 바뀌었다) ─────
 *   `SERVICE_REPORT_FONT_METRICS` · `contentWrapWidth` · `splitBodyLine`
 *   그리고 확인내용 첫 줄을 붙이는 `findingsLines`(여기서는
 *   `serviceReportFindingsLines` — 기본 문구를 **인자로** 받는 것만 다르다.
 *   그 문구 상수는 양식 쪽 이야기라 채우개에 그대로 두었다).
 *
 *   🔴 2026-10-18 둘째 조각에서 **문서의 모양**도 따라왔다 — 구역 라벨
 *   (`SERVICE_REPORT_BODY_LABELS`) · 맺음 표시(`SERVICE_REPORT_CLOSING_MARK`) ·
 *   구역 사이와 맺음 표시의 여백(`…GAP_ROWS`) · 구역이 먹는 줄 수
 *   (`serviceReportSectionRowCount`). 미리보기가 「최종 결과물처럼」 보이려면
 *   그 글자들이 필요한데, **화면이 지어내면 두 벌이 된다**(라벨의 전각 공백은
 *   눈으로 구별되지 않아 어긋나도 아무도 못 잡는다). 채우개는 이제 여기서
 *   가져다 쓰고 같은 이름으로 **다시 내보낸다** — 부르던 곳은 그대로다.
 *
 * ── 여기 **없는** 것 ────────────────────────────────────────────────────
 * 🔴 본문이 **몇 행에서 시작하는가**(`readSectionStartRows`)는 양식 파일 안에
 * 있고 파일은 서버에만 있다. 그래서 미리보기는 **행 번호를 그리지 않는다.**
 *
 * ⚠️ 2026-10-31 전에는 한계가 하나 더 있었다 — 구역마다 양식이 정한 시작 행이
 * 따로 있어서, 미리보기가 그리는 「구역 사이 한 줄」이 **하한**일 뿐이었다
 * (문서에서는 일곱 줄까지 벌어졌다). 지금은 구역이 이어 붙으므로
 * (`planBodyLayout`) **미리보기의 줄 차례가 곧 문서의 줄 차례**다. 남은 차이는
 * 행 번호와, 맺음 표시 아래 여백뿐이다.
 *
 * ── 🔴 이 파일은 순수하다 ───────────────────────────────────────────────
 * `server-only` · `node:*` · React · DB 를 물지 않는다. 그래야 화면과 서버가
 * 같은 함수를 부를 수 있다.
 * ============================================================================
 */

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 양식에 박힌 글꼴을 재서 굳힌 값 (2026-10-15 실측 · 수리·검사 양식 같음)
 * ────────────────────────────────────────────────────────────────────────
 * 엑셀의 열 너비 단위는 「**통합문서 기본 글꼴**로 `0` 을 몇 자 넣을 수 있는가」다.
 * 그런데 본문·비고 칸에 박힌 글꼴은 기본 글꼴이 **아니다**:
 *
 *   · 기본 글꼴 — `styles.xml` 의 `fonts[0]`(「표준」 스타일) = **ＭＳ Ｐゴシック 11pt**
 *   · 본문 `H31:AU31`~`H59:AU59`, 비고 `H60:AF60`~`H63:AF63`
 *     — 둘 다 같은 서식 글꼴 = **맑은 고딕 9pt**
 *
 * 그래서 `readColumnRangeWidth` 가 돌려주는 「75칸」은 **본문 글꼴 75자가 아니다.**
 * 글자가 더 작으니 같은 자리에 더 들어간다. 그 차이를 안 보고 75 를 그대로 줄
 * 폭으로 쓰면 **실제보다 일찍 줄이 바뀌어** 칸이 덜 찬 채로 인쇄된다
 * (2026-10-15 사용자 지적: 「엑셀 칸 너비 정도로 맞춰 달라」).
 *
 * ── 글자 폭 실측 (Windows 11 · 96dpi · GDI 보냄폭) ──────────────────────
 *   ＭＳ Ｐゴシック 11pt  `0` = **8px**   ← 열 너비 한 칸의 정체
 *   맑은 고딕 9pt        `0` = **7px**,  한글 음절 = **12px**
 *
 * 🔴 한글은 숫자의 **1.71배**다 — **2배가 아니다.** `text-wrap.ts` 는 한글을
 * 2칸으로 세므로 **한글은 재어 보면 늘 모자라게 센다(16.7%).** 그 16.7% 가 곧
 * 안전 여백이다 — 지어낸 값이 아니라 글꼴에서 나온 값이다.
 *
 * ── 안전 여백을 한 자 더 둔다 ───────────────────────────────────────────
 * 위의 16.7% 는 **한글에만** 붙는다. 숫자만 있는 줄은 1칸이 그대로 1자라 여백이
 * 0 이 된다. 그래서 `SAFETY_PX`(숫자 한 자)를 더 뺀다 — 넘치는 쪽으로 틀어지면
 * 인쇄물이 잘리고, 덜 차는 쪽은 보기만 나쁘다.
 */
const SERVICE_REPORT_FONT_METRICS = {
  /** 통합문서 기본 글꼴(ＭＳ Ｐゴシック 11pt)의 `0` — 열 너비 한 칸이 이것이다. */
  normalDigitPx: 8,
  /** 본문·비고 칸 글꼴(맑은 고딕 9pt)의 `0` — 우리가 세는 한 칸이 이것이다. */
  contentDigitPx: 7,
  /** 엑셀이 열 너비 식에 넣는 셀 안쪽 여백(좌 2 + 우 2 + 눈금선 1). */
  cellPaddingPx: 5,
  /** 🔴 안전 여백 — 본문 글꼴 숫자 한 자. 위 머리말의 까닭. */
  safetyPx: 7,
} as const;

/**
 * 🔴 엑셀 열 너비 합(기본 글꼴 기준)을 **본문 글꼴 기준 줄 폭**으로 바꾼다.
 *
 *   픽셀      = 열 너비 합 × 8
 *   줄 폭     = ⌊(픽셀 − 5 − 7) ÷ 7⌋
 *
 * 이 양식에서는 이렇게 나온다:
 *   · 본문 `H:AU` 75칸  → 600px → **84칸**(한글 42자). 엑셀이 실제로 담는 양은
 *     한글 49자((600−5)÷12)이므로 42자는 그보다 **덜 차는 쪽**이다.
 *   · 비고 `H:AF` 46.875칸 → 375px → **51칸**(한글 25자). 비고는 아직 나누지
 *     않지만(줄 수를 넘으면 던진다) 나눌 날의 값이 이것이다.
 *
 * 순수 함수다 — 글꼴을 재지 않고 위에 굳힌 상수만 쓴다.
 */
export function contentWrapWidth(columnWidth: number): number {
  const { normalDigitPx, contentDigitPx, cellPaddingPx, safetyPx } = SERVICE_REPORT_FONT_METRICS;
  const usablePx = columnWidth * normalDigitPx - cellPaddingPx - safetyPx;
  const width = Math.floor(usablePx / contentDigitPx);
  // 🔴 `wrapTextToWidth` 는 2칸 미만을 거절한다. 양식이 망가져도 그 앞에서 막는다.
  if (!(width >= 2)) {
    throw new Error(`본문 칸이 너무 좁습니다: 열 너비 ${columnWidth} → ${width}칸`);
  }
  return width;
}

/**
 * 한 줄을 칸의 가로폭에 맞춰 나눈다.
 *
 * 줄 안의 줄바꿈(`\n`)은 **먼저 갈라 놓는다.** 그것을 공백처럼 다루면 사람이
 * 나눠 쓴 두 줄이 한 줄로 붙어 버리고, 붙은 자리는 아무도 눈치채지 못한다.
 */
export function splitBodyLine(line: string, width: number): string[] {
  return line.split(/\r\n?|\n/u).flatMap((piece) => wrapTextToWidth(piece, width));
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * 🔴 양식의 칸 폭 — **서버가 읽어 화면으로 넘긴다** (2026-10-18 다섯째 조각)
 * ════════════════════════════════════════════════════════════════════════
 * 여기에 숫자가 **있었다**(`SERVICE_REPORT_BODY_COLUMN_WIDTH = 75` 등 셋). 채우개는
 * 예나 지금이나 양식의 `<cols>` 를 그때그때 읽는데(`readColumnRangeWidth`),
 * 브라우저에는 그 파일이 없으니 화면만 굳힌 값을 본다 — 대신 시험이 둘을 맞춰
 * 보게 해 두었다. 「양식이 바뀐 날 시험이 먼저 깨진다」는 계획이었고, 실제로
 * 깨질 일이 일어났다:
 *
 *   사용자가 양식 넷에 **도장만 바꿔 저장**했는데 Excel 이 열 너비를 제 기준으로
 *   다시 썼다 — 본문 열 `1.875 → 1.90625`, 즉 `H:AU` **75칸 → 76.25칸**
 *   (줄 폭으로는 84칸 → 85칸). 손댄 적 없는 값이 저절로 바뀐 것이다.
 *
 * 🔴 **한 번으로 끝날 일이 아니다.** 양식 레이아웃을 고칠 때마다 되풀이된다.
 * 그래서 숫자를 고쳐 가며 따라가는 대신 **화면도 양식에서 받는다**:
 *
 *   작성 화면(서버) ── `readServiceReportColumnWidths(그 건이 쓸 양식)`
 *                   └→ `serviceReportBodyMetrics(…)` ──props──▶ 미리보기 · 적는 칸
 *
 * 🔴 **읽고 환산하는 셈은 채우개의 것 그대로다**(`readColumnRangeWidth` ·
 * `contentWrapWidth`). 화면용으로 한 벌 더 만들면 또 갈라진다.
 *
 * ⚠️ 그래서 이 파일에는 이제 **폭 숫자가 하나도 없다.** 아래 타입과 함수만 있고,
 * 값은 전부 부르는 쪽이 양식에서 읽어 넣는다.
 * ════════════════════════════════════════════════════════════════════════
 */

/**
 * 양식에서 읽은 **엑셀 열 너비**(통합문서 기본 글꼴 기준) 세 가지.
 *
 * 🔴 줄 폭(84·85칸)이 **아니다** — 그 환산은 `contentWrapWidth` 가 한다.
 */
export type ServiceReportColumnWidths = {
  /** 본문 내용 칸. 지금 양식에서는 `H`~`AU`. */
  body: number;
  /** 비고 칸. 지금 양식에서는 `H`~`AF` — 본문보다 좁다. */
  remark: number;
  /** 본문 라벨 칸(`확　내`/`인　용` 이 찍히는 칸). 지금 양식에서는 `C`~`G`. */
  label: number;
  /**
   * 🔴 본문 내용 칸이 **몇 열인가**(지금 양식에서는 `H`~`AU` = 40).
   *
   * 폭(`body`)만으로는 모자라서 2026-10-31 에 더했다. 맺음 표시가 가운데에서
   * **세 열** 오른쪽에 앉는데(`SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT`), 그
   * **열 수**를 길이로 바꾸려면 한 열이 얼마인지 알아야 한다 — 미리보기는 양식
   * 파일을 못 읽으므로 서버가 세어 넘긴다.
   */
  bodyColumns: number;
};

/**
 * 화면이 폭을 셀 때 쓰는 **한 벌** — 열 너비와, 그것에서 나온 줄 폭.
 *
 * 미리보기 상자 폭 · 줄 나누기 칸 수 · 적는 칸 폭 · 비고 폭 · 라벨 칸 폭이 전부
 * 여기서 나온다. 굳힌 숫자를 쓰는 자리가 화면에 하나도 없게 하려는 것이다.
 */
export type ServiceReportBodyMetrics = {
  /** 양식에서 읽은 열 너비 그대로. 미리보기 상자의 **크기**가 여기서 나온다. */
  columns: ServiceReportColumnWidths;
  /** 본문 한 줄에 들어가는 칸 수. 옛 양식 84(한글 42자) · 새 양식 85. */
  bodyWrapWidth: number;
  /** 비고 한 줄에 들어가는 칸 수. 옛 양식 51 · 새 양식 52. */
  remarkWrapWidth: number;
  /**
   * 🔴 맺음 표시 앞에 비워 두는 **너비**(열 너비 단위 — `columns` 와 같은 자).
   *
   * 미리보기가 맺음 표시 줄에 줄 **왼쪽 여백**이고, 문서에서는 그 줄의 병합이
   * `H:AU` 대신 `N:AU` 로 좁혀지는 것과 같은 뜻이다
   * (`serviceReportClosingMarkIndentWidth` 머리말).
   */
  closingMarkIndentWidth: number;
};

/**
 * 열 너비 한 벌 → 화면이 쓰는 치수 한 벌.
 *
 * 🔴 **서버에서 부른다.** `contentWrapWidth` 는 칸이 말이 안 되게 좁으면 던지는데,
 * 브라우저가 그리는 도중에 던지면 화면이 통째로 죽는다. 서버에서 부르면 그 던짐이
 * 작성 화면의 「양식을 읽을 수 없습니다」 길로 그대로 들어간다(`page.tsx`).
 */
export function serviceReportBodyMetrics(
  columns: ServiceReportColumnWidths
): ServiceReportBodyMetrics {
  return {
    columns,
    bodyWrapWidth: contentWrapWidth(columns.body),
    remarkWrapWidth: contentWrapWidth(columns.remark),
    closingMarkIndentWidth: serviceReportClosingMarkIndentWidth(columns),
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * 🔴 맺음 표시는 **가운데에서 세 열 오른쪽**이다 (2026-10-31 사용자 결정)
 * ════════════════════════════════════════════════════════════════════════
 * 사용자: 「~이상~을 지금 위치보다 3열정도 우측에 위치하게 해줘.」 → 엑셀에서
 * 눈으로 확인한 뒤 「이정도면 적당한 것 같아. 이제 미리보기도 고치도록 하자」.
 *
 * ── 🔴 왜 열 수를 **두 배**로 비우는가 ──────────────────────────────────
 * 맺음 표시는 **가운데 맞춤**이다. 그래서 보이는 자리는 「앞을 얼마나 비웠나」의
 * **절반**만 오른쪽으로 간다 — 세 열을 옮기려면 **여섯 열**을 비워야 한다.
 *
 *   문서  — 그 줄의 병합을 `H:AU`(40열)에서 `N:AU`(34열)로 좁힌다. 가운데가
 *           `(8+47)/2 = 27.5` 열에서 `(14+47)/2 = 30.5` 열로 간다.
 *   화면  — 맺음 표시 줄에 **왼쪽 여백**을 그 여섯 열만큼 준다. 글은 남은 폭에서
 *           가운데 맞춤이므로 가운데가 `여백/2` 만큼, 즉 세 열 오른쪽으로 간다.
 *
 * 둘이 **같은 수에서 나온다.** 🔴 화면에 「15%」 같은 수를 따로 적지 말 것 —
 * 그 15% 는 `6 ÷ 40` 이라서, 이 상수를 올리는 날 화면만 옛 자리에 남는다.
 *
 * ⚠️ 열이 고르다는 가정이 하나 들어 있다(여섯 열의 너비 = 전체 ÷ 40 × 6).
 * 지금 양식 넷은 `<col min="8" max="47" width="1.90625"/>` 한 덩이라 고르다 —
 * 어긋나는 날 채우개 시험(`readColumnRangeWidth` 로 잰 값과 맞춰 본다)이 먼저
 * 깨진다.
 * ════════════════════════════════════════════════════════════════════════
 */
export const SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT = 3;

/** 맺음 표시 앞에 비워 두는 **열 수** — 가운데 맞춤이라 옮길 열 수의 두 배다. */
export const SERVICE_REPORT_CLOSING_MARK_INDENT_COLUMNS =
  SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT * 2;

/**
 * 비워 두는 열 수를 **너비**로 바꾼다 — 단위는 `ServiceReportColumnWidths` 와 같다.
 *
 * 🔴 **본문 칸보다 넓어질 수 없다.** 그러면 맺음 표시가 칸 밖으로 나가므로,
 * 짐작해서 줄이는 대신 던진다(채우개도 같은 자리에서 던진다).
 */
export function serviceReportClosingMarkIndentWidth(columns: ServiceReportColumnWidths): number {
  if (!(columns.bodyColumns > SERVICE_REPORT_CLOSING_MARK_INDENT_COLUMNS)) {
    throw new Error(
      `본문 칸이 ${columns.bodyColumns}열뿐이라 맺음 표시를 ` +
        `${SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT}열 옮길 수 없습니다.`
    );
  }
  return (columns.body * SERVICE_REPORT_CLOSING_MARK_INDENT_COLUMNS) / columns.bodyColumns;
}

/**
 * 🔴 엑셀 열 너비(기본 글꼴 문자 단위) → **화면 픽셀**.
 *
 * 열 너비 한 칸은 통합문서 기본 글꼴의 숫자 한 자이고 이 양식에서는 8px 이다
 * (`SERVICE_REPORT_FONT_METRICS.normalDigitPx` — 위 머리말의 실측). Excel 이
 * 종이에 그릴 때 쓰는 픽셀은 96dpi 기준이라 **CSS 픽셀과 1:1** 이다. 그래서
 * 이 값을 그대로 `width` 에 주면 미리보기 상자가 문서의 칸과 같은 크기가 된다:
 *
 *   옛 양식 — 본문 75칸 → **600px** · 비고 46.875칸 → 375px · 라벨 8.75칸 → 70px
 *   새 양식 — 본문 76.25칸 → **610px** · 비고 47.65625칸 → 381px · 라벨 → 69px
 *
 * ⚠️ 인자는 **열 너비**(`ServiceReportColumnWidths` 의 값)이지 줄 폭
 * (`bodyWrapWidth` = 84·85칸)이 아니다. 둘 다 그냥 수라서 바꿔 넣어도 조용히
 * 지나간다 — 이름을 보고 넣을 것.
 */
export function serviceReportColumnWidthPx(columnWidth: number): number {
  return Math.round(columnWidth * SERVICE_REPORT_FONT_METRICS.normalDigitPx);
}

/**
 * 「확인내용」에 실제로 찍히는 줄 — 정형 문구가 첫 줄이다.
 *
 * 🔴 `findings` 가 비면 통째로 빈다. 그래야 "본문이 한 줄도 없습니다" 검사가
 * 정형 문구 때문에 통과해 버리는 일이 없고, 소개할 항목 없이 소개 문장만 찍힌
 * 문서도 안 나간다.
 *
 * 🔴 **「안 줌」을 푸는 일은 여기서 하지 않는다.** 채우개는 `undefined` 를
 * `SERVICE_REPORT_FINDINGS_INTRO` 로 바꿔서 넘기고, 화면은 그 문구가 이미 칸에
 * 들어 있는 글자를 그대로 넘긴다. 기본값을 여기 적어 두면 양식 쪽 상수가
 * 두 벌이 된다.
 */
export function serviceReportFindingsLines(
  findings: readonly string[],
  intro: string
): readonly string[] {
  if (findings.length === 0) return [];
  return intro === "" ? findings : [intro, ...findings];
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * 🔴 문서의 **모양** — 라벨 · 맺음 표시 · 여백
 * ════════════════════════════════════════════════════════════════════════
 * 아래 다섯은 채우개(`xlsx/service-report-template.ts`)에서 자리만 옮겨 온
 * 것이고 그 모듈이 같은 이름으로 다시 내보낸다. 옮긴 까닭은 머리말에 있다 —
 * 작성 화면의 미리보기가 **이 글자 그대로** 그려야 하는데, 채우개는 zip 을 물고
 * 있어 브라우저가 값으로 가져올 수 없다.
 * ════════════════════════════════════════════════════════════════════════
 */

/**
 * 본문 구역의 라벨 — **양식의 글상자에 있던 모양 그대로 두 줄짜리다.**
 *
 * 원본 `Text Box 9` 는 라벨을 세로로 흘려 적어 두었다. 「확인내용」은 **두 줄**
 * (`확　내` / `인　용`)이고 「조치」·「정리」는 한 줄이다. 「확인내용」을 한 줄로
 * 펴서 적으면 우리가 만든 문서만 다른 모양이 된다.
 *
 * 🔴 **공백이 라벨마다 다르다.** 원본에서 코드 포인트째 옮긴 것이다:
 *
 *   `확　내` = `D655 3000 B0B4`   ← 전각 공백(U+3000)
 *   `인　용` = `C778 3000 C6A9`   ← 전각 공백(U+3000)
 *   `조  치` = `C870 0020 0020 CE58`  ← 보통 공백(U+0020) **둘**
 *   `정  리` = `C815 0020 0020 B9AC`  ← 보통 공백(U+0020) **둘**
 *
 * 왜 다른지는 모른다. 통일하지 않는다 — 원본이 그렇다. 전각 공백은 코드에서
 * 눈에 안 보이므로 `　` 으로 적어 둔다(보통 공백과 섞이면 아무도 못 잡는다).
 *
 * ⚠️ 넷 다 `textDisplayWidth` 로 **6칸**이다(전각 2 + 전각 2 + 전각 2, 또는
 * 전각 2 + 반각 1 + 반각 1 + 전각 2). 미리보기의 라벨 열 폭이 거기서 나온다.
 */
export const SERVICE_REPORT_BODY_LABELS = {
  findings: ["확　내", "인　용"],
  actions: ["조  치"],
  summary: ["정  리"],
} as const;

/**
 * 라벨 열이 먹는 칸 수 — **라벨 글자에서 잰다**(넷 다 6칸이다).
 *
 * 미리보기의 왼쪽 칸 폭이 여기서 나온다. 숫자를 적어 두면 라벨이 길어진 날
 * 글자가 잘리고, 잘린 것은 「원래 그런가 보다」로 지나간다.
 */
export const SERVICE_REPORT_BODY_LABEL_WIDTH = Math.max(
  ...Object.values(SERVICE_REPORT_BODY_LABELS)
    .flat()
    .map((line) => textDisplayWidth(line))
);

/**
 * 본문 마지막 줄 다음에 오는 맺음 표시.
 *
 * 🔴 **양식의 글상자에 있던 글자를 코드 포인트째 옮긴 것**이다
 * (`U+FF5E U+C774 U+3000 U+C0C1 U+FF5E`) — 물결표는 반각 `~` 가 아니라 전각
 * `～` 이고 사이의 공백은 전각(U+3000)이다. 보통 글자로 적으면 자간이 달라져
 * 다른 문서처럼 보인다(제목의 전각 공백과 같은 이유).
 *
 * 자리는 **마지막 내용 줄에서 한 줄 띄운 줄**, 본문 내용 열이다
 * (`SERVICE_REPORT_CLOSING_GAP_ROWS`). 양식의 글상자는 이 글자를 상자 밑바닥에
 * 두었지만 상자는 크기가 고정이라 본문이 길어지면 어긋난다. 셀에 두면 본문이 몇
 * 줄이든 늘 끝에 붙는다.
 *
 * ── 🔴 문서에서는 **가로로도 조금 오른쪽**이다 (2026-10-31) ────────────
 * 사용자가 「~이상~을 지금 위치보다 3열정도 우측에」로 정해서, 채우개는 그 줄의
 * 병합을 `H:AU` 에서 `N:AU` 로 줄이고 거기에 쓴다(가운데 맞춤이라 보이는 자리가
 * 세 열 오른쪽으로 간다 — `xlsx/service-report-template.ts` 의
 * `serviceReportClosingMarkColumn`).
 *
 * ⚠️ **미리보기는 그 가로 치우침을 안 그린다** — 지금도 상자 한가운데다. 세로
 * 차례(어느 줄에 오는가)는 문서와 같고, 가로만 다르다. 맞추려면 맺음 표시 줄에
 * 왼쪽 여백 `6/40`(= 15%)을 주면 된다.
 */
export const SERVICE_REPORT_CLOSING_MARK = "～이　상～";

/**
 * 🔴 구역과 구역 **사이에 들어가는 빈 줄**의 수 — 본문 길이와 상관없이 늘 이만큼.
 *
 * 처음 이 값을 둔 까닭(2026-09-02 사용자 결정)은 **하한**이었다. 그때는 구역이
 * 양식이 정한 행에서 시작했고, 내용이 넘쳐 아래 구역을 밀어낼 때만 두 구역이
 * 딱 붙었다. 실측으로 그 자리가 이렇게 나왔다:
 *
 *   42        | -종단 AMP 압착금구 고장 확인   ← 확인내용 마지막 줄
 *   43 조  치 | • 종단 AMP 입력 보호 휴즈 교환  ← 붙어서 구분이 안 된다
 *
 * 🔴 **2026-10-31 에 그 위가 바뀌었다** — 구역은 더 이상 양식이 정한 행에서
 * 시작하지 않고 **앞 구역 바로 다음에 이 빈 줄 하나만 두고** 이어 붙는다
 * (`xlsx/service-report-template.ts` 의 `planBodyLayout` 머리말). 그래서 이 값은
 * 하한이 아니라 **사이의 전부**가 되었다. 수는 그대로 1 이다.
 *
 * ⚠️ 이 한 줄도 본문 용량을 먹는다 — 전체가 블록을 넘으면 `growBodyBlock` 이
 * 여느 때처럼 줄을 끼워 넣는다. 여기서 따로 할 일은 없다.
 */
export const SERVICE_REPORT_SECTION_GAP_ROWS = 1;

/**
 * 🔴 맺음 표시(`～이　상～`) **위**에 비워 두는 줄 수 — **세 줄**(2026-10-31).
 *
 * 예전에는 맺음 표시가 마지막 내용 줄에 딱 붙어 있었고, 2026-09-02 에 **한 줄**이
 * 되었다(실기에서 쓰던 사람이 발행본과 견주어 짚은 자리다). 2026-10-31 에
 * 사용자가 「본문의 가장 마지막 줄에서 3행을 띄우고 ~이 상~ 이 표시되도록」으로
 * 다시 정했다 — 구역 사이가 한 줄로 좁아지면서 맺음 표시도 본문에 붙어 보였기
 * 때문이다. 「3행을 띄운다」의 두 읽기(빈 줄 셋 vs 셋째 줄에 맺음) 중 **빈 줄
 * 셋**으로 확정했다:
 *
 *   53        | 정리 마지막 줄
 *   54        |
 *   55        |                 ← 빈 줄 셋
 *   56        |
 *   57        | ～이　상～
 *
 * ⚠️ 구역 사이의 빈 줄(`SERVICE_REPORT_SECTION_GAP_ROWS`)과 **따로** 산다.
 * 그쪽은 구역과 구역 사이이고, 이쪽은 본문 전체가 끝난 다음이다. 수가 달라진
 * 지금은 더 그렇다 — 하나로 합치지 말 것.
 */
export const SERVICE_REPORT_CLOSING_GAP_ROWS = 3;

/**
 * 🔴 맺음 표시 **아래**로 본문 블록 안에 남겨 두는 줄 수 — **세 줄**(2026-10-31).
 *
 * 2026-09-02 에는 두 줄이었다(발행본이 그랬다). 2026-10-31 에 사용자가 「양식
 * 아래에 비는 줄이 있다면 3행 정도를 제외하고 없애도 될 것 같아」로 정하면서
 * 셋이 되었고, **뜻이 함께 바뀌었다**:
 *
 *   · 예전 — 「적어도 두 줄은 블록 안에 남겨 둔다」. 블록(양식의 29줄)은 그대로라
 *     짧은 보고서에서는 맺음 표시 아래로 열 줄 넘게 비어 있었다.
 *   · 지금 — 「맺음 표시 아래는 **딱 이만큼**이고, 블록의 마지막 줄이 곧 세 줄째다」.
 *     남는 줄은 `shrinkBodyBlock` 이 걷어내고 비고·담당·승인·문서번호가 그만큼
 *     위로 올라온다(`fillSheet` 의 `rowShift` — 이제 음수가 될 수 있다).
 *
 * 🔴 **이것도 본문 용량이다.** 자리가 모자라면 여느 때처럼 줄을 끼워 넣는다
 * (`fillSheet` 의 `neededRows`). 그러니 맺음 표시가 블록의 마지막 줄에 앉는 일은
 * 없다 — 상자의 아래 테두리가 걸린 그 줄은 늘 맺음 표시 **아래 세 줄째**다.
 */
export const SERVICE_REPORT_CLOSING_TRAILING_ROWS = 3;

/**
 * 그 구역이 차지하는 줄 수. 줄이 없는 구역은 통째로 건너뛰므로 0이다.
 *
 * 🔴 **라벨 줄 수가 내용 줄 수보다 많으면 라벨 쪽이 이긴다.** 「확인내용」의
 * 라벨은 두 줄(`확　내`/`인　용`)인데 확인 내용이 한 줄뿐인 건이 있을 수 있다.
 * 그때 다음 구역을 바로 다음 줄에서 시작하면 「조치」의 라벨이 `인　용` 자리에
 * 앉는다 — 라벨 열은 한 칸이라 둘 중 하나만 남고, 문서에는 「확인내용」이
 * 「확　내」 반쪽으로 찍힌다. 내용 칸 한 줄이 비는 것은 눈에 잘 안 띄지만
 * 반쪽 라벨은 바로 보인다. 그래서 **라벨이 온전한 쪽**을 고른다.
 *
 * 채우개의 `sectionRowCount` 가 이것을 부른다 — 한 벌뿐이다.
 */
export function serviceReportSectionRowCount(lineCount: number, labelLineCount: number): number {
  if (lineCount === 0) return 0;
  return Math.max(lineCount, labelLineCount);
}

/** 미리보기 한 구역 — 왼쪽 이름과, **나뉜 뒤**의 줄들. */
export type ServiceReportPreviewSection = {
  /** 화면에 적는 구역 이름. 문서의 라벨 글상자 모양(`확　내`/`인　용`)이 아니다. */
  title: string;
  /**
   * 🔴 문서의 라벨 열에 **세로로** 찍히는 글자 — `SERVICE_REPORT_BODY_LABELS`
   * 그대로다. 위의 `title` 은 화면에서 부르는 이름이고 이쪽이 문서에 찍히는 것.
   */
  labelLines: readonly string[];
  /** 문서의 한 줄 = 여기 한 칸. */
  lines: readonly string[];
};

/**
 * 적은 글이 문서에서 어떤 줄들이 되는가.
 *
 * 채우개가 하는 것과 **같은 차례**다:
 *   ① 교산 연락서 낱말을 한글로(`koreanKyosanDocumentText` — 채우개의
 *      `koreanServiceReportInput` 이 **줄 수를 세기도 전에** 하는 일이다.
 *      빠뜨리면 일본어를 붙여 넣은 줄에서 미리보기와 문서가 갈린다)
 *   ② 확인내용 첫 줄에 정형 문구를 붙이고(`serviceReportFindingsLines`)
 *   ③ 칸 폭에 맞춰 나눈다(`splitBodyLine`)
 *
 * 🔴 **줄이 한 줄도 없는 구역은 통째로 빠진다** — 채우개도 그렇다
 * (`sectionRowCount` 가 0 을 돌려주고 그 구역은 배치되지 않는다).
 *
 * ⚠️ 구역이 문서의 **몇 행**에서 시작하는지는 그리지 않는다(머리말의 '여기
 * 없는 것'). 구역 사이의 빈 줄·맺음 표시도 마찬가지다.
 *
 * 🔴 `width` 에 **기본값이 없다.** 예전에는 굳힌 84칸이 기본값이었는데, 그러면
 * 양식이 바뀐 날 폭을 안 넘긴 자리만 조용히 옛 값으로 나뉜다 — 그 조용함이
 * 미리보기를 거짓말로 만든다(위 '양식의 칸 폭' 머리말). 부르는 쪽이 그 건의
 * 양식에서 읽은 `bodyWrapWidth` 를 반드시 준다.
 */
export function serviceReportBodyPreviewSections(
  body: {
    findingsIntro: string;
    findings: readonly string[];
    actions: readonly string[];
    summary: readonly string[];
  },
  width: number
): ServiceReportPreviewSection[] {
  const document = (lines: readonly string[]): readonly string[] =>
    lines.map(koreanKyosanDocumentText);

  const sections: {
    title: string;
    labelLines: readonly string[];
    source: readonly string[];
  }[] = [
    {
      title: "확인내용",
      labelLines: SERVICE_REPORT_BODY_LABELS.findings,
      source: serviceReportFindingsLines(
        document(body.findings),
        koreanKyosanDocumentText(body.findingsIntro)
      ),
    },
    { title: "조치", labelLines: SERVICE_REPORT_BODY_LABELS.actions, source: document(body.actions) },
    { title: "정리", labelLines: SERVICE_REPORT_BODY_LABELS.summary, source: document(body.summary) },
  ];

  return sections
    .filter((section) => section.source.length > 0)
    .map((section) => ({
      title: section.title,
      labelLines: section.labelLines,
      lines: section.source.flatMap((line) => splitBodyLine(line, width)),
    }));
}

/** 미리보기가 그리는 문서의 한 줄. */
export type ServiceReportPreviewRow = {
  /** 라벨 열에 찍히는 글자. 라벨이 없는 줄은 빈 글자다. */
  label: string;
  /** 본문 내용 열에 찍히는 글자. 빈 줄은 빈 글자다. */
  text: string;
  /** 🔴 맺음 표시 줄 — 문서에서 **가운데 맞춤**이다(그 줄만 서식이 다르다). */
  closing: boolean;
};

/**
 * 구역들을 **문서의 줄 차례로** 편다 — 미리보기가 그대로 그리는 모양이다.
 *
 * 채우개가 하는 것과 같은 차례다:
 *   ① 구역 하나가 먹는 줄 수 = `serviceReportSectionRowCount`
 *      (🔴 라벨이 내용보다 길면 라벨 쪽이 이긴다 — 확인내용 한 줄짜리는 두 줄)
 *   ② 구역과 구역 사이에 `SERVICE_REPORT_SECTION_GAP_ROWS` 줄
 *   ③ 마지막 내용 줄에서 `SERVICE_REPORT_CLOSING_GAP_ROWS` 줄 띄우고 맺음 표시
 *
 * ⚠️ **행 번호는 그리지 않는다**(머리말의 '여기 없는 것'). 맺음 표시 아래의 세
 * 줄(`SERVICE_REPORT_CLOSING_TRAILING_ROWS`)도 그리지 않는다 — 그것은 «블록이
 * 얼마나 커야 하는가»이지 «무엇이 찍히는가»가 아니다.
 *
 * 🔴 ②의 사이는 이제 **하한이 아니라 그대로**다(2026-10-31). 문서도 구역을 이어
 * 붙인다 — 미리보기가 그린 줄 차례가 문서의 줄 차례와 같다.
 *
 * 🔴 구역이 하나도 없으면 **아무것도 없다.** 맺음 표시만 덩그러니 그리면 적기
 * 전부터 문서가 있는 것처럼 보인다(채우개도 본문이 비면 던진다).
 */
export function serviceReportBodyPreviewRows(
  sections: readonly ServiceReportPreviewSection[]
): ServiceReportPreviewRow[] {
  if (sections.length === 0) return [];

  const blank = (): ServiceReportPreviewRow => ({ label: "", text: "", closing: false });
  const rows: ServiceReportPreviewRow[] = [];

  sections.forEach((section, index) => {
    if (index > 0) {
      for (let gap = 0; gap < SERVICE_REPORT_SECTION_GAP_ROWS; gap += 1) rows.push(blank());
    }
    const count = serviceReportSectionRowCount(section.lines.length, section.labelLines.length);
    for (let row = 0; row < count; row += 1) {
      rows.push({
        label: section.labelLines[row] ?? "",
        text: section.lines[row] ?? "",
        closing: false,
      });
    }
  });

  for (let gap = 0; gap < SERVICE_REPORT_CLOSING_GAP_ROWS; gap += 1) rows.push(blank());
  rows.push({ label: "", text: SERVICE_REPORT_CLOSING_MARK, closing: true });
  return rows;
}

/** 비고 미리보기의 한 줄. */
export type ServiceReportPreviewRemarkLine = {
  text: string;
  /** 🔴 문서의 비고 칸보다 긴 줄. 나뉘지 않고 **칸 밖으로 흘러나가거나 잘린다**. */
  overflows: boolean;
};

/**
 * 비고가 문서에서 어떤 줄들이 되는가.
 *
 * 🔴 **비고는 나누지 않는다.** 채우개가 비고 줄을 그대로 한 행에 한 줄씩 쓰고
 * (`fillSheet` 의 비고 자리), 폭을 넘는 줄은 Excel 이 칸 밖으로 흘리거나 자른다.
 * 그래서 여기서 나눠 그리면 **문서에 없는 줄바꿈을 보여 주는 거짓말**이 된다 —
 * 대신 폭을 넘는 줄에 표시만 단다.
 *
 * 🔴 `width` 에 기본값이 없는 까닭은 위 `serviceReportBodyPreviewSections` 와 같다.
 */
export function serviceReportRemarkPreviewLines(
  lines: readonly string[],
  width: number
): ServiceReportPreviewRemarkLine[] {
  return lines.map((line) => {
    const text = koreanKyosanDocumentText(line);
    return { text, overflows: textDisplayWidth(text) > width };
  });
}
