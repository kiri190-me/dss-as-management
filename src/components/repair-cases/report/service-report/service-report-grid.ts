import type { CSSProperties } from "react";

import {
  serviceReportColumnWidthPx,
  type ServiceReportBodyMetrics,
} from "@/lib/domain/service-report-body-wrap";

/**
 * ============================================================================
 * 🔴 글꼴은 **맑은 고딕** — 문서가 쓰는 바로 그 글꼴 (2026-10-18)
 * ============================================================================
 * 사용자 말 그대로: 「글꼴도 조금 더 가독성이 좋은 글꼴로 바꿔줘. 엑셀 글꼴이
 * [맑은 고딕 (본문)] 이거든? 그 글꼴로 해줘.」
 *
 * 앞 조각은 **고정폭 글꼴**(돋움체·굴림체)을 세워 두었다. 까닭은 「반각이 전각의
 * 정확히 절반」이면 문서가 세는 84칸과 화면의 픽셀 폭이 같은 뜻이 되기 때문이고,
 * 그러면 적는 칸이 문서와 **같은 자리에서** 줄을 바꾼다. 그 전제를 이 조각이
 * 버린다 — 맑은 고딕은 영숫자가 **가변폭**이다.
 *
 * ── 🔴 그래서 역할을 나눈다 ─────────────────────────────────────────────
 *   **적는 칸**   — 읽고 쓰기 편한 곳. 줄 바뀌는 자리는 **대략**이다.
 *   **미리보기**  — 줄 바뀌는 자리가 **정확한** 곳. 나누는 일은 글꼴이 아니라
 *                   JS(`domain/service-report-body-wrap.ts`)가 하므로, 글꼴을
 *                   바꿔도 거기 그려지는 줄은 한 글자도 달라지지 않는다.
 * 그 사실은 화면에도 적혀 있다(`ServiceReportBodyFields.tsx` 의 안내문). 안 적으면
 * 화면이 거짓말을 한다.
 *
 * ── 맑은 고딕의 실측 폭 (9pt = 12px 기준, `service-report-body-wrap.ts` 머리말) ──
 *   한글 음절 **12px (1.0em)** · 숫자 `0` **7px (0.583em)**
 *
 * 한글은 정확히 1em 이다. 그래서 **한글만 있는 줄은 42자에서 그대로 바뀐다** —
 * 문서의 84칸이 곧 한글 42자이기 때문이다. 영숫자는 1em 의 절반(0.5em)이 아니라
 * 0.583em 이라, 영숫자가 섞인 줄에서 적는 칸은 문서보다 **일찍** 바뀐다
 * (84칸 어치가 42자 폭에 안 들어간다). 🔴 넘치는 쪽이 아니라 **덜 담는 쪽**이라
 * 안전하다 — `text-wrap.ts`·`service-report-body-wrap.ts` 머리말과 같은 판단이다.
 *
 * ── 🔴 「글꼴 크기는 짝수여야 한다」는 **없앴다** ───────────────────────
 * 앞 조각의 `assertEvenFontSize` 는 **비트맵 글꼴** 때문에 있었다. 돋움체·굴림체는
 * 작은 크기에서 비트맵을 쓰고 비트맵의 글자 폭은 정수 픽셀이라, 13px 로 두면 반각이
 * 6 또는 7 로 반올림되어 2:1 이 깨졌다. 맑은 고딕은 **벡터 글꼴**이고 애초에 2:1 을
 * 기대하지도 않으므로 그 규칙은 지킬 것이 없어졌다. 남겨 두면 「왜 짝수여야 하는가」에
 * 답이 없는 규칙이 되어, 언젠가 13px 이 필요할 때 까닭 모를 예외로 사람을 막는다.
 *
 * ── 폭이 두 가지인 까닭 ─────────────────────────────────────────────────
 *   **적는 칸**  = 한글 `칸 수 ÷ 2` 자가 꼭 들어가는 폭(84칸 → 42자 × 글꼴 크기).
 *                 한글 줄이 문서와 같은 자리에서 바뀌게 하는 값이다.
 *   **미리보기** = 문서의 칸 그 자체(`serviceReportColumnWidthPx` — 본문 열 너비
 *                 75칸 × 8px = **600px**)에 **확대 배율**을 곱한 것. 글꼴·글자
 *                 크기·줄 높이까지 같은 배율로 커지므로 상자 안은 어느 배율에서나
 *                 **실제 결과물과 1:1** 이다.
 *
 * 🔴 두 값이 다른 것은 실수가 아니다. 42자 폭은 「한글 42자」이고 문서 칸 폭은
 * 「문서의 칸」인데, 문서는 그 칸 안에서 42자까지만 쓰도록 **안전 여백 16.7%** 를
 * 두고 나눈다(`contentWrapWidth`). 그 여백이 미리보기에서 눈에 보이는 것이 맞다.
 *
 * ============================================================================
 * 🔴 **폭은 글꼴 크기에서 나온다 — 창 크기를 따라 함께 움직인다** (2026-10-18 넷째)
 * ============================================================================
 * 사용자가 화면을 보고 말했다: 「여유공간이 너무 많네. … 본문 내용을 적는 칸과
 * 미리보기가 본문 창의 가로폭을 다 채우도록 해줘.」 그리고 이어서 「브라우저의
 * 크기에 따라 **적절하게 반응형으로** 가로폭이 조절되도록 해줘.」
 *
 * 🔴 **그냥 넓히면 안 된다.** 적는 칸의 폭은 「한글 42자」라는 뜻을 가진 값이고,
 * 폭만 늘리면 한 줄에 43·44자가 들어가 문서와 **다른 자리에서** 줄이 바뀐다.
 * 넓히는 유일한 안전한 길은 **글꼴 크기와 폭을 같은 비율로 함께 키우는 것**이다:
 *
 *   적는 칸 폭 = 42 × 글꼴 크기 + 테두리   ← 어느 크기에서도 한글 42자
 *   미리보기   = 문서의 칸 × (미리보기 글꼴 ÷ 9pt)  ← 문서를 통째로 확대한 것
 *
 * ── 🔴 그래서 **한 치수도 px 로 적지 않는다** ───────────────────────────
 * 모든 길이가 `calc(비율 × var(--sr-grid-font))` 다. 비율은 「글꼴이 밑값일 때의
 * px ÷ 밑값」이라 **px 함수와 같은 수에서 나온다**(`…ScaledCss` / `…ScaledPx` 가
 * 한 쌍이고, 시험이 둘을 맞춰 본다). 어딘가에 px 을 적어 넣는 순간 폭과 글꼴이
 * 따로 놀기 시작하고, 그날부터 줄 나뉨이 조용히 어긋난다.
 *
 * ── 🔴 글꼴 크기를 **누가 정하는가** — 브라우저가 정한다 ────────────────
 * 자바스크립트로 폭을 재지 않는다. CSS 의 **컨테이너 질의**(`@container` · `cqi`)와
 * `clamp()` 가 한다:
 *
 *   --sr-grid-font: clamp(하한, (칸의 안쪽 폭 − 고정분) ÷ 기울기, 상한)
 *
 * 그 까닭:
 *   ① **연속적이다.** 창을 1px 줄이면 글꼴도 그만큼만 줄어든다. 단계로 끊으면
 *      특정 지점에서만 툭 바뀌는데, 사용자가 바란 것은 「창 크기를 따라」다.
 *   ② **떨리지 않는다.** `ResizeObserver` 로 재서 상태에 넣으면 〈글꼴이 커짐 →
 *      내용이 길어짐 → 세로 스크롤막대 생김 → 폭이 15px 줄어듦 → 글꼴이 작아짐〉
 *      이 되돌이가 될 수 있다. CSS 는 배치 한 번에 풀리고 React 가 다시 그리지도
 *      않는다.
 *   ③ **첫 그림부터 맞다.** 서버가 보낸 HTML 이 그대로 제 크기로 선다 —
 *      재어서 고치는 방식은 붙기 전까지 한 번 작은 모습이 보인다.
 *   ④ **창이 아니라 칸을 잰다.** 사이드바를 접고 펴면 같은 창에서도 칸의 폭이
 *      150px 달라진다. `100cqi` 는 그 칸의 안쪽 폭이다(`100vw` 가 아니다).
 *
 * ── 🔴 상한과 하한, 그리고 아래로 쌓이는 자리 ───────────────────────────
 *   **상한 18px** — 커지면 글자도 커진다. 18px 을 넘기면 8줄짜리 칸 둘이 든 본문
 *     구역이 한 화면에 안 들어가기 시작한다(14px 에서 ~660px, 18px 에서 ~790px).
 *     가로를 채우자고 세로를 잃는 거래라 여기서 끊는다.
 *   **하한 = 나란히 설 수 있는 가장 좁은 폭을 딱 채우는 크기** — 그보다 좁으면
 *     미리보기가 **아래로** 내려가고, 그때는 지금까지와 같은 밑값(14px)으로 선다.
 *   🔴 **미리보기만 조금 더 커진다.** 적는 칸이 상한에 닿은 뒤에도 자리가 남으면
 *     미리보기가 혼자 더 커져 남은 자리를 메운다(상한은 문서의 두 배). 미리보기는
 *     타자를 치는 곳이 아니라 **문서를 확대해 보는 곳**이라 커져도 손해가 없고,
 *     줄 나뉨은 애초에 JS 가 정하므로 한 글자도 달라지지 않는다.
 *
 * 🔴 숫자를 화면에 적지 않는다. 적는 칸·미리보기·배치용 상자가 전부 이 파일의
 * 함수를 부른다.
 *
 * ============================================================================
 * 🔴 **칸 폭은 이 파일에도 없다 — 인자로 들어온다** (2026-10-18 다섯째 조각)
 * ============================================================================
 * 예전에는 양식의 열 너비(75·46.875·8.75)와 줄 폭(84·51)을 도메인 모듈이 상수로
 * 들고 있었고 이 파일이 그것을 가져다 썼다. 사용자가 양식에 **도장만 바꿔
 * 저장했더니 Excel 이 열 너비를 다시 써서**(1.875 → 1.90625) 그 상수가 틀어졌다.
 *
 * 이제 폭은 **서버가 그 건이 쓸 양식에서 읽어** props 로 내려보낸다
 * (`ServiceReportBodyMetrics` — `domain/service-report-body-wrap.ts` 머리말).
 * 그래서 아래 함수 중 폭을 쓰는 것들은 전부 **`metrics` 를 첫 인자로 받는다.**
 * 모듈 꼭대기에서 계산되던 하한·기울기도 같은 이유로 **함수**가 되었다 — 그것들이
 * 상수로 남아 있으면 폭이 바뀌어도 안 따라간다.
 * ============================================================================
 */

/**
 * 🔴 문서(엑셀 양식)의 본문·비고 칸에 박힌 글꼴 그대로 — **맑은 고딕**.
 *
 * 적는 칸과 미리보기가 **둘 다** 이것을 쓴다. 미리보기가 문서와 같은 글꼴이 되어
 * 「진짜 결과물처럼」 보이고, 적는 칸은 사용자가 고른 대로 읽기 좋아진다.
 *
 *   · `Malgun Gothic` — 윈도우에 등록된 영문 이름. 사내 PC 는 전부 여기 걸린다
 *   · `맑은 고딕`     — 한국어 윈도우가 쓰는 현지 이름(영문 이름을 못 찾는 경우)
 *   · `Apple SD Gothic Neo` — 맥에서 가장 가까운 글꼴
 *   · 마지막 `sans-serif` 는 하나도 없는 PC 에서 글이 깨지지 않게 두는 것뿐이다
 */
export const SERVICE_REPORT_GRID_FONT_FAMILY =
  '"Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif';

/**
 * 적는 칸 글꼴의 **밑값** — 오래 보고 치는 자리라 문서보다 크다.
 *
 * 🔴 이제 이 값은 「고정 크기」가 아니라 **비례의 기준(1배)이자 아래로 쌓였을 때의
 * 크기**다. 나란히 설 때는 칸의 폭을 따라 이 값과 상한 사이에서 움직인다.
 */
export const SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX = 14;
/** 적는 칸의 줄 높이 — 밑값 기준(`text-sm` 의 기본값과 같다). 글꼴과 함께 커진다. */
export const SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX = 20;

/**
 * 🔴 적는 칸 글꼴의 **상한**.
 *
 * 폭을 채우자고 끝없이 키우면 세로로 덜 들어온다 — 8줄짜리 칸 둘이 든 본문 구역의
 * 높이가 밑값에서 ~660px, 여기서 ~790px 다. 20px 을 넘으면 1080px 화면에서 본문
 * 구역 하나가 화면을 다 먹는다. 그 거래의 경계로 18px 을 잡았다.
 *
 * ⚠️ 이 값을 올리면 더 넓은 화면까지 가로가 채워지고 글자가 그만큼 커진다. 바꾸려면
 * 여기 한 줄이면 되지만, **눈으로 보고** 정할 일이다.
 */
export const SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX = 18;

/** pt → px. 96dpi 에서 `1px = 0.75pt` 다. 소수점 둘째 자리까지 둔다. */
function pointsToPx(points: number): number {
  return Math.round((points / 0.75) * 100) / 100;
}

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 미리보기의 치수 — **채워진 문서를 읽어서 잰 값**이다 (2026-10-18 실측)
 * ────────────────────────────────────────────────────────────────────────
 * 미리보기 화면(`/repair-cases/{id}/report/service-report/print`)이 쓰는 것과 같은
 * 격자(`xlsx/sheet-print-grid.ts` 의 `readSheetPrintGrid`)로 수리 양식을 채워 읽었다:
 *
 *   본문 칸 `H31:AU31`~  글꼴 **9pt** · 가로 **left**(맺음 표시 줄만 center) ·
 *                        세로 center · 행 높이 **14.1pt** · 좌우 테두리 thin ·
 *                        첫 행 위가 **double** · 마지막 행 아래가 thin
 *   라벨 칸 `C31:G31`~   가로 **center** · 오른쪽 테두리 thin(본문과의 칸막이)
 *   비고 칸 `H60:AF60`~  글꼴 9pt · 가로 **center** · 행 높이 **15pt**
 *
 * 지어낸 값이 하나도 없다. 🔴 **브라우저가 알 수 없는 것은 여전히 안 그린다** —
 * 구역이 문서의 몇 행에서 시작하는지, 머리 항목, 맺음 표시 아래 두 줄
 * (`ServiceReportBodyPreview.tsx` 머리말).
 *
 * 🔴 아래 값들은 **배율 1배(= 문서 그대로)** 일 때의 px 다. 화면에서는 전부
 * `미리보기 글꼴 ÷ 9pt` 배로 커진다.
 */

/** 문서의 본문·비고 칸 글꼴 크기 — 맑은 고딕 **9pt** 다. 96dpi 에서 12px. */
export const SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX = pointsToPx(9);
/** 문서의 본문 행 높이 — **14.1pt**. */
export const SERVICE_REPORT_GRID_PREVIEW_LINE_HEIGHT_PX = pointsToPx(14.1);
/** 문서의 비고 행 높이 — **15pt**. 본문보다 조금 넓다. */
export const SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX = pointsToPx(15);

/**
 * 🔴 미리보기 글꼴의 **상한** — 문서의 두 배(= 200% 확대)다.
 *
 * 적는 칸이 상한에 닿은 뒤에도 자리가 남으면 미리보기가 혼자 더 커진다. 그래도
 * 끝이 있어야 해서 둔 값이고, 「문서를 두 배로 확대해 본다」는 말로 설명된다.
 */
export const SERVICE_REPORT_GRID_MAX_PREVIEW_FONT_SIZE_PX =
  2 * SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX;

/**
 * 엑셀이 칸 **왼쪽**에 두는 안쪽 여백. 왼쪽 맞춤 글자가 칸막이에 붙지 않게 하는
 * 것이고, 값은 열 너비 식에 들어가는 여백(좌 2 + 우 2 + 눈금선 1)의 왼쪽 몫이다
 * (`service-report-body-wrap.ts` 의 `SERVICE_REPORT_FONT_METRICS.cellPaddingPx`).
 */
export const SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX = 2;

/**
 * 🔴 공용 입력칸(`editInputClass`)이 글 둘레에 두르는 **좌우** 두께.
 * `px-3`(12px) 둘 + `border`(1px) 둘. 상한은 테두리 상자 기준이라 더해 준다.
 *
 * ⚠️ **글꼴을 따라 커지지 않는다** — 여백과 테두리는 문서가 아니라 화면의 것이다.
 * 그래서 글 폭(42자)만 비례하고 이 값은 그대로 더해진다.
 */
export const SERVICE_REPORT_GRID_INPUT_FRAME_PX = 26;
/** 같은 입력칸의 **위아래** 두께 — `py-1.5`(6px) 둘 + `border`(1px) 둘. */
const INPUT_VERTICAL_FRAME_PX = 14;

/** 미리보기 상자의 **좌우 테두리** 1px 둘. 이것도 글꼴을 따라 커지지 않는다. */
export const SERVICE_REPORT_GRID_PREVIEW_BORDER_PX = 2;

/** 나란히 설 때 적는 칸과 미리보기 사이(`@6xl:gap-6` = 1.5rem). */
export const SERVICE_REPORT_GRID_ROW_GAP_PX = 24;

/**
 * 🔴 적는 칸과 미리보기가 **나란히 설 수 있는 가장 좁은 칸 폭**.
 *
 * Tailwind 의 컨테이너 눈금 `@6xl`(72rem = 1152px) 그대로다. 수를 지어내지 않고
 * 있는 눈금에 맞춘 까닭은, 가름의 자리를 CSS 에 적는 길이 **클래스 이름뿐**이라
 * 임의의 px 을 쓰면 그 수가 이 파일과 클래스 문자열 두 곳에 살게 되기 때문이다.
 *
 * 🔴 **하한 글꼴은 여기서 나온다** — 이 폭을 딱 채우는 크기가 곧 가장 작은 글꼴이다
 * (`SERVICE_REPORT_GRID_MIN_FONT_SIZE_PX`). 그래서 가름의 자리에서 가로가 비지
 * 않고, 더 좁아지면 글자가 더 작아지는 대신 **아래로 쌓인다**.
 */
export const SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX = 1152;

/**
 * 적는 칸의 글 폭 — **한글 `칸 수 ÷ 2` 자가 꼭 들어가는 폭**이다.
 *
 * 맑은 고딕에서 한글 한 자는 정확히 1em 이므로 `칸 수 ÷ 2 × 글꼴 크기` 가 곧
 * 한글 42자의 폭이고, 한글로만 찬 줄은 문서와 **같은 자리에서** 바뀐다.
 *
 *   본문 84칸 → 42자 × 글꼴 크기   비고 51칸 → 25.5자 × 글꼴 크기
 *
 * 🔴 **글꼴 크기가 인자인 것이 이 함수의 전부다.** 폭을 키우고 싶으면 글꼴을 키워야
 * 하고, 그러면 한글 42자 기준이 저절로 지켜진다.
 *
 * ⚠️ 영숫자는 0.5em 이 아니라 0.583em 이라 섞인 줄은 **문서보다 일찍** 바뀐다 —
 * 머리말의 「역할을 나눈다」. 정확한 자리는 옆의 미리보기가 보여 준다.
 */
export function serviceReportGridInputContentPx(columns: number, fontSizePx: number): number {
  return (columns / 2) * fontSizePx;
}

/** 적는 칸의 폭 상한 — 글이 놓이는 폭에 여백·테두리를 더한 값. */
export function serviceReportGridInputMaxWidthPx(
  columns: number,
  fontSizePx: number = SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
): number {
  return serviceReportGridInputContentPx(columns, fontSizePx) + SERVICE_REPORT_GRID_INPUT_FRAME_PX;
}

/**
 * 미리보기 상자의 폭 — **문서의 칸 그 자체**에 확대 배율을 곱한 것.
 *
 * @param columnWidth 그 칸의 **엑셀 열 너비**(`metrics.columns.body` 등 — 서버가
 *   양식에서 읽어 넘긴 값). 🔴 줄 폭(84·85)이 아니다 — 둘 다 그냥 수라서 바꿔
 *   넣어도 조용히 지나간다.
 * @param previewFontSizePx 미리보기 글꼴 크기. 기본값(9pt)이면 **문서 그대로**다:
 *   옛 양식 본문 75칸 → **600px** · 비고 46.875칸 → 375px · 라벨 8.75칸 → 70px
 */
export function serviceReportGridDocumentBoxPx(
  columnWidth: number,
  previewFontSizePx: number = SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX
): number {
  return serviceReportGridPreviewScaledPx(
    serviceReportColumnWidthPx(columnWidth),
    previewFontSizePx
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * 🔴 글꼴 크기를 나르는 CSS 변수 — **폭과 글꼴을 한 값에 묶는 고리**
 * ════════════════════════════════════════════════════════════════════════
 * 길이를 `calc(비율 × var(--sr-grid-font))` 로 적으면, 글꼴이 바뀌는 순간 폭도
 * 같은 비율로 바뀐다. 둘이 따로 놀 길이 애초에 없어진다.
 *
 * 변수가 없는 자리(시험에서 조각만 그려 볼 때 등)에서는 **밑값**으로 떨어진다 —
 * 그때는 지금까지와 똑같은 모습이다.
 * ════════════════════════════════════════════════════════════════════════
 */

/** 적는 칸 글꼴 크기가 담기는 변수. */
export const SERVICE_REPORT_GRID_FONT_VAR = "--sr-grid-font";
/** 미리보기 글꼴 크기가 담기는 변수. */
export const SERVICE_REPORT_GRID_PREVIEW_FONT_VAR = "--sr-grid-preview-font";
/** 아래로 쌓였을 때 쓸 후보값. */
const STACKED_FONT_VAR = "--sr-grid-font-stacked";
/** 나란히 섰을 때 쓸 후보값. */
const ROW_FONT_VAR = "--sr-grid-font-row";

/** 적는 칸 글꼴 크기를 가리키는 CSS 값(변수 + 밑값). */
export const SERVICE_REPORT_GRID_FONT_CSS = `var(${SERVICE_REPORT_GRID_FONT_VAR}, ${SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX}px)`;
/** 미리보기 글꼴 크기를 가리키는 CSS 값(변수 + 문서 크기). */
export const SERVICE_REPORT_GRID_PREVIEW_FONT_CSS = `var(${SERVICE_REPORT_GRID_PREVIEW_FONT_VAR}, ${SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX}px)`;

/** CSS 에 적는 비율 — 소수점 여섯 자리. 24px 에서도 오차가 1/1000 px 미만이다. */
function roundRatio(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 같은 비율을 CSS 식에 끼워 넣을 글자로. */
function ratioText(value: number): string {
  return String(roundRatio(value));
}

/**
 * 적는 칸 글꼴에 **비례하는 길이**의 CSS 식.
 *
 * @param basePx 글꼴이 **밑값(14px)** 일 때의 px. 비율은 `basePx ÷ 밑값` 이라
 *   `serviceReportGridInputScaledPx` 와 같은 수에서 나온다.
 */
export function serviceReportGridInputScaledCss(basePx: number): string {
  const multiple = basePx / SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX;
  return `calc(${ratioText(multiple)} * ${SERVICE_REPORT_GRID_FONT_CSS})`;
}

/** 같은 길이의 **값** — 시험이 위의 식과 맞춰 보는 짝이다. */
export function serviceReportGridInputScaledPx(basePx: number, fontSizePx: number): number {
  return (basePx / SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX) * fontSizePx;
}

/**
 * 미리보기 글꼴에 **비례하는 길이**의 CSS 식.
 *
 * @param basePx **문서 그대로일 때의 px**(글꼴 9pt = 12px 기준). 미리보기는 문서를
 *   통째로 확대·축소한 것이라, 칸 폭·줄 높이·안쪽 여백이 전부 이 한 식을 탄다.
 */
export function serviceReportGridPreviewScaledCss(basePx: number): string {
  const multiple = basePx / SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX;
  return `calc(${ratioText(multiple)} * ${SERVICE_REPORT_GRID_PREVIEW_FONT_CSS})`;
}

/** 같은 길이의 **값**. */
export function serviceReportGridPreviewScaledPx(
  basePx: number,
  previewFontSizePx: number
): number {
  return (basePx / SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX) * previewFontSizePx;
}

/** 적는 칸의 글 폭 CSS — `칸 수 ÷ 2` 자의 한글이 꼭 들어가는 폭. */
export function serviceReportGridInputContentCss(columns: number): string {
  return serviceReportGridInputScaledCss(
    serviceReportGridInputContentPx(columns, SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX)
  );
}

/** 적는 칸의 폭 상한 CSS — 글 폭 + 여백·테두리(여백은 안 커진다). */
export function serviceReportGridInputMaxWidthCss(columns: number): string {
  return `calc(${serviceReportGridInputContentCss(columns)} + ${SERVICE_REPORT_GRID_INPUT_FRAME_PX}px)`;
}

/** 미리보기 상자의 폭 CSS — 문서의 칸 × 배율. */
export function serviceReportGridDocumentBoxCss(columnWidth: number): string {
  return serviceReportGridPreviewScaledCss(serviceReportColumnWidthPx(columnWidth));
}

/**
 * 미리보기 상자 **전체**(라벨 칸 + 본문 칸 + 좌우 테두리)의 폭.
 *
 * 🔴 테두리 2px 는 배율을 안 탄다 — 그래서 고정분으로 따로 더한다. 빠뜨리면 딱
 * 맞춰 놓은 줄이 2px 넘쳐 미리보기에 가로 스크롤막대가 뜬다.
 */
export function serviceReportGridPreviewBoxWidthPx(
  metrics: ServiceReportBodyMetrics,
  previewFontSizePx: number
): number {
  return (
    serviceReportGridDocumentBoxPx(metrics.columns.label, previewFontSizePx) +
    serviceReportGridDocumentBoxPx(metrics.columns.body, previewFontSizePx) +
    SERVICE_REPORT_GRID_PREVIEW_BORDER_PX
  );
}

/** 미리보기 글꼴 크기 — 적는 칸과 **같은 비율**로 움직인다(밑값에서 9pt). */
export function serviceReportGridPreviewFontSizePx(fontSizePx: number): number {
  return (
    SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX *
    (fontSizePx / SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX)
  );
}

/**
 * 🔴 본문 줄 하나가 **그 글꼴 크기에서** 먹는 폭 — 적는 칸 + 사이 + 미리보기.
 *
 * 글꼴 크기를 정하는 식이 이 함수의 **역산**이다. 둘을 따로 적으면 한쪽만 고쳐지는
 * 날이 오고, 그날 가로가 남거나 넘친다.
 */
export function serviceReportGridRowWidthPx(
  metrics: ServiceReportBodyMetrics,
  fontSizePx: number
): number {
  return (
    serviceReportGridInputMaxWidthPx(metrics.bodyWrapWidth, fontSizePx) +
    SERVICE_REPORT_GRID_ROW_GAP_PX +
    serviceReportGridPreviewBoxWidthPx(metrics, serviceReportGridPreviewFontSizePx(fontSizePx))
  );
}

/** 줄의 폭 중 **글꼴을 안 따라가는 부분** — 입력칸 테두리 + 사이 + 상자 테두리. */
const ROW_FIXED_PX =
  SERVICE_REPORT_GRID_INPUT_FRAME_PX +
  SERVICE_REPORT_GRID_ROW_GAP_PX +
  SERVICE_REPORT_GRID_PREVIEW_BORDER_PX;

/**
 * 글꼴 1px 당 늘어나는 폭. 위 함수에서 뽑는다 — 수를 두 번 적지 않는다.
 *
 * 🔴 **상수가 아니라 함수다.** 양식의 칸 폭이 바뀌면 이 기울기도 바뀌어야 하는데,
 * 모듈이 뜰 때 한 번 재어 두면 그날로 어긋난다.
 */
function rowSlopePx(metrics: ServiceReportBodyMetrics): number {
  return (
    (serviceReportGridRowWidthPx(metrics, SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX) - ROW_FIXED_PX) /
    SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
  );
}

/** 미리보기 글꼴 1px 당 늘어나는 상자 폭(테두리 뺀 것). 위와 같은 이유로 함수다. */
function previewSlopePx(metrics: ServiceReportBodyMetrics): number {
  return (
    (serviceReportGridPreviewBoxWidthPx(metrics, SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX) -
      SERVICE_REPORT_GRID_PREVIEW_BORDER_PX) /
    SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX
  );
}

/** 그 폭을 **딱 채우는** 글꼴 크기 — `serviceReportGridRowWidthPx` 의 역산이다. */
export function serviceReportGridFontSizeForRowWidth(
  metrics: ServiceReportBodyMetrics,
  widthPx: number
): number {
  return (widthPx - ROW_FIXED_PX) / rowSlopePx(metrics);
}

/**
 * 🔴 적는 칸 글꼴의 **하한** — 나란히 설 수 있는 가장 좁은 폭을 딱 채우는 크기.
 *
 * 지어낸 값이 아니라 `@6xl`(1152px)에서 역산한 값이다(옛 양식에서 ≈ 12.2px,
 * 미리보기로는 ≈ 10.5px). 더 좁아지면 글자를 더 줄이는 대신 **미리보기를 아래로
 * 내린다** — 그 아래에서는 지금까지와 같은 밑값(14px)으로 선다.
 *
 * 🔴 상수였던 것이 함수가 되었다 — 칸 폭이 바뀌면 이 값도 따라가야 한다.
 */
export function serviceReportGridMinFontSizePx(metrics: ServiceReportBodyMetrics): number {
  return serviceReportGridFontSizeForRowWidth(metrics, SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX);
}

/**
 * 🔴 **나란히 섰을 때**의 적는 칸 글꼴 — 칸의 안쪽 폭(`100cqi`)에서 역산한다.
 *
 *   글꼴 = (칸 폭 − 고정분) ÷ 기울기,  하한과 상한 사이로 자른다
 *
 * 이 식이 곧 `serviceReportGridRowWidthPx` 의 역산이라, 상한에 닿기 전까지는
 * **가로가 한 px 도 남지 않는다.**
 */
export function serviceReportGridRowFontCss(metrics: ServiceReportBodyMetrics): string {
  const fill = `calc((100cqi - ${ROW_FIXED_PX}px) / ${ratioText(rowSlopePx(metrics))})`;
  return `clamp(${ratioText(serviceReportGridMinFontSizePx(metrics))}px, ${fill}, ${SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX}px)`;
}

/**
 * **아래로 쌓였을 때**의 적는 칸 글꼴 — 밑값 그대로다.
 *
 * 🔴 여기서까지 폭을 채우려고 키우면 「창을 좁혔더니 글자가 커진다」가 된다. 쌓이는
 * 자리는 좁은 화면이라 세로가 더 아쉽고, 무엇보다 **지금까지와 같은 모습**이다.
 */
export function serviceReportGridStackedFontCss(): string {
  return `${SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX}px`;
}

/**
 * 🔴 미리보기 글꼴 — 적는 칸과 **같은 비율**로 움직이다가, 적는 칸이 상한에 닿은
 * 뒤에는 **혼자 더 커져** 남은 가로를 메운다.
 *
 *   하한 = 적는 칸에 비례하는 크기(= 지금까지의 관계)
 *   가운데 = 남은 자리 ÷ 상자 기울기 = (칸 폭 − 고정분 − 적는 칸 글 폭) ÷ 기울기
 *   상한 = 문서의 두 배
 *
 * ⚠️ 적는 칸이 상한에 **닿기 전**에는 가운데 값이 하한과 **정확히 같다**(식을 펴
 * 보면 약분된다). 그래서 평소에는 지금까지와 같은 14:12 비율이고, 상한에 닿은
 * 뒤에만 벌어진다. 아래로 쌓였을 때는 가운데가 하한보다 작아져 하한이 이긴다.
 */
export function serviceReportGridPreviewFontCss(metrics: ServiceReportBodyMetrics): string {
  const proportional = `calc(${ratioText(
    SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX / SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
  )} * ${SERVICE_REPORT_GRID_FONT_CSS})`;
  const fill = `calc((100cqi - ${ROW_FIXED_PX}px - ${serviceReportGridInputContentCss(
    metrics.bodyWrapWidth
  )}) / ${ratioText(previewSlopePx(metrics))})`;
  return `clamp(${proportional}, ${fill}, ${SERVICE_REPORT_GRID_MAX_PREVIEW_FONT_SIZE_PX}px)`;
}

/**
 * 🔴 줄 하나에 얹는 **치수 한 벌** — 후보값 셋을 변수로 심는다.
 *
 * 왜 후보가 둘(`…-stacked` / `…-row`)인가: 인라인 style 은 클래스보다 세므로 CSS
 * 쪽에서 덮어쓸 수 없다. 그래서 값 둘을 미리 심어 두고 **어느 것을 쓸지만** 클래스가
 * 고른다(`SERVICE_REPORT_GRID_ROW_CLASS`). 식 자체는 전부 이 파일에서 나온다.
 */
export function serviceReportGridScaleStyle(metrics: ServiceReportBodyMetrics): CSSProperties {
  return {
    [STACKED_FONT_VAR]: serviceReportGridStackedFontCss(),
    [ROW_FONT_VAR]: serviceReportGridRowFontCss(metrics),
    [SERVICE_REPORT_GRID_PREVIEW_FONT_VAR]: serviceReportGridPreviewFontCss(metrics),
  } as CSSProperties;
}

/**
 * 🔴 폭을 재는 **자**가 되는 칸. `100cqi` 는 이 칸의 안쪽 폭이다.
 *
 * 창(`100vw`)이 아니라 칸을 재는 까닭: 사이드바를 접고 펴면 같은 창에서도 쓸 수 있는
 * 폭이 150px 달라진다. 창으로 재면 그때마다 어긋난다.
 */
export const SERVICE_REPORT_GRID_CONTAINER_CLASS = "@container";

/**
 * 🔴 적는 칸과 미리보기가 들어가는 **줄**.
 *
 *   · 기본은 세로로 쌓임 — 좁은 화면에서 가로로 미는 화면을 만들지 않는다
 *   · `@6xl`(1152px = `SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX`)부터 나란히
 *   · 나란할 때는 글꼴을 칸 폭에서 뽑은 값으로 바꾼다
 *   · 세로 맞춤은 기본값(stretch)이다 — 🔴 미리보기 상자가 옆의 적는 칸들만큼
 *     **길어진다**. `items-start` 를 붙이면 그 늘어남이 사라진다
 *
 * ⚠️ Tailwind 는 소스를 **글자로** 훑어 클래스를 만든다. 그래서 클래스 하나하나가
 * 따옴표 안에 **온전히** 들어 있어야 한다(아래처럼 줄을 나눠 잇는 것은 괜찮지만,
 * `@6xl:` 와 `flex-row` 를 갈라 놓거나 변수로 끼워 넣으면 안 된다). 어기면 그
 * 클래스가 CSS 에서 사라지고, 오류 없이 **영영 쌓인 채로** 보인다.
 */
export const SERVICE_REPORT_GRID_ROW_CLASS =
  "flex flex-col gap-4 @6xl:flex-row @6xl:gap-6 " +
  "[--sr-grid-font:var(--sr-grid-font-stacked)] @6xl:[--sr-grid-font:var(--sr-grid-font-row)]";

/**
 * 미리보기 본문 글자의 모양 — 문서의 본문 칸과 **같은 글꼴·같은 비율의 줄 높이**.
 *
 * 🔴 줄 높이를 **배수**로 적는다(14.1pt ÷ 9pt). 그래야 확대해도 글자와 행이 같은
 * 비율로 커져 상자 안이 계속 문서와 1:1 이다.
 */
export const serviceReportGridPreviewTextStyle: CSSProperties = {
  fontFamily: SERVICE_REPORT_GRID_FONT_FAMILY,
  fontSize: SERVICE_REPORT_GRID_PREVIEW_FONT_CSS,
  lineHeight: roundRatio(
    SERVICE_REPORT_GRID_PREVIEW_LINE_HEIGHT_PX / SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX
  ),
};

/** 비고 칸은 행이 조금 높다(15pt) — 그 한 가지만 다르다. */
export const serviceReportGridRemarkPreviewTextStyle: CSSProperties = {
  ...serviceReportGridPreviewTextStyle,
  lineHeight: roundRatio(
    SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX / SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX
  ),
};

/**
 * 🔴 적는 칸에 **반드시 함께** 붙는 클래스 — 높이가 내용을 따라 늘어난다.
 *
 * 세로 스크롤막대가 뜨면 그만큼(윈도우 크롬 15px ≒ 한글 한 자) 글 폭이 줄어
 * **줄이 한 자 일찍 바뀐다.** 폭을 아무리 맞춰도 여덟 줄을 넘기는 순간 어긋나는
 * 것이다. 스크롤막대를 숨기면 글이 안 보이는 줄이 생기므로, 아예 **생기지 않게**
 * 칸이 늘어나게 한다. 옆의 미리보기도 어차피 내용만큼 길어서 쪽 높이는 그대로다.
 *
 * 🔴 글꼴이 맑은 고딕으로 바뀌어도 **그대로 쓸모가 있다.** 2:1 때문에 둔 장치가
 * 아니라 «적는 칸이 제 폭을 지키는가» 때문에 둔 장치이기 때문이다.
 *
 * ⚠️ `field-sizing` 을 모르는 브라우저에서는 지금까지처럼 스크롤막대가 뜬다
 * (그때만 한 자 일찍 바뀐다 — 넘치는 쪽이 아니라 덜 담는 쪽이라 안전하다).
 */
export const SERVICE_REPORT_GRID_INPUT_CLASS = "[field-sizing:content]";

/**
 * 적는 칸의 글자 모양 + 폭 상한 + 최소 높이.
 *
 * 🔴 **상한이지 고정 폭이 아니다.** `editInputClass` 의 `w-full` 이 그대로라
 * 좁은 화면에서는 화면을 따라 줄어든다(가로 스크롤이 생기지 않는다).
 *
 * 🔴 **치수가 전부 글꼴 크기에서 나온다** — 글꼴은 변수 하나(`--sr-grid-font`)이고
 * 폭·줄 높이·최소 높이가 그 변수에 비례한다. 그래서 창이 넓어져 글꼴이 커져도
 * 한 줄에 들어가는 한글 글자 수는 **42자 그대로**다.
 *
 * @param columns 문서가 그 칸에서 세는 칸 수(`metrics.bodyWrapWidth` 등)
 * @param rows 비어 있을 때 보이는 줄 수. `field-sizing:content` 는 `rows` 를
 *   무시하므로 같은 높이를 **최소 높이**로 적어 준다.
 */
export function serviceReportGridInputStyle(columns: number, rows: number): CSSProperties {
  return {
    fontFamily: SERVICE_REPORT_GRID_FONT_FAMILY,
    fontSize: SERVICE_REPORT_GRID_FONT_CSS,
    lineHeight: serviceReportGridInputScaledCss(SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX),
    maxWidth: serviceReportGridInputMaxWidthCss(columns),
    minHeight: `calc(${serviceReportGridInputScaledCss(
      rows * SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX
    )} + ${INPUT_VERTICAL_FRAME_PX}px)`,
  };
}
