import {
  readServiceReportTemplate,
  serviceReportTemplateProductKindOf,
  ServiceReportTemplateError,
  type ServiceReportTemplateProductKind,
} from "@/lib/storage/service-report-template";
import {
  describeServiceReportBlockers,
  validateServiceReportFields,
} from "@/lib/validation/service-report-input";
import { readSheetPrintGrid, type SheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";
import {
  fillServiceReportWorkbook,
  SERVICE_REPORT_SHEET_NAME,
  SERVICE_REPORT_TITLES,
  type ServiceReportKind,
} from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 보고서 한 장을 **화면이 그릴 수 있는 격자**로 바꾼다 — 미리보기 둘이 함께 쓴다
 * ============================================================================
 * 사슬은 예전부터 하나였다(`report/service-report/print/page.tsx` 가 쓰던 그것):
 *
 *   요청 본문 → validateServiceReportFields → readServiceReportTemplate…
 *            → fillServiceReportWorkbook → readSheetPrintGrid → 격자
 *
 * 2026-10-19 에 **부르는 자리가 둘**이 되었다:
 *
 *   · 저장된 장   `/repair-cases/{건}/report/service-report/print?id=…` (서버 컴포넌트)
 *   · 🔴 **저장하지 않은 값**  `POST /api/repair-cases/{건}/service-report/preview-grid`
 *     — 작성 화면이 아직 저장하지 않은 폼 값을 보내고, 그 값으로 그린 문서를 돌려받는다.
 *
 * 그래서 사슬을 이 한 자리로 모았다. 두 벌로 두면 **「저장 전에 본 문서」와 「저장
 * 뒤에 본 문서」가 다른 말을 하는** 날이 오는데, 그 어긋남은 아무 오류도 내지
 * 않는다 — 사람은 둘 다 «그 문서»라고 믿는다.
 *
 * ── 🔴 저장은 여기서 일어나지 않는다 ────────────────────────────────────
 * 이 파일은 **DB 를 모른다.** 표도, 조회도, mutation 도 가져오지 않는다. 미리보기가
 * 사람 몰래 저장하면 「저장을 누르지 않은 채 봐 본다」가 성립하지 않는다 —
 * 시험 삼아 쳐 본 글이 남으면 안 된다(2026-10-19 사용자 요구의 핵심).
 *
 * ── 🔴 양식 고르기를 우회하지 않는다 ────────────────────────────────────
 * 양식은 넷이다(문서 종류 × 매쳐·제너레이터) 그리고 담당자 **도장이 다르다**. 제품
 * 축은 접수 건의 `workflowType` 에서 나오고, 고르는 규칙은 storage 한 자리에만
 * 있다(`storage/service-report-template.ts`). 종류를 알 수 없으면 거기서 던지고
 * 우리는 `TEMPLATE_UNAVAILABLE` 로 바꿔 올린다 — 엉뚱한 사람 도장이 찍힌 미리보기를
 * 보여 주는 것보다 못 그리는 편이 낫다.
 *
 * 🔴 **도장 그림 주소도 같은 자리에서 나온다**(`templateImageBase`). 격자를 뽑아낸
 * 바로 그 양식을 가리켜야 한다 — 그러지 않으면 격자는 매쳐 양식에서 왔는데 도장만
 * 제너레이터 양식에서 와서, 아무 오류 없이 **엉뚱한 사람 도장**이 찍힌다.
 *
 * ── 🔴 실패는 코드로 돌려주고, **경로는 담지 않는다** ────────────────────
 * 부르는 쪽이 사람에게 할 말을 정한다(화면은 화면의 말, 통로는 통로의 말). 여기서
 * 돌려주는 `message` 에는 경로가 한 글자도 없다 — `ServiceReportTemplateError` 가
 * 그것을 지키고(storage 쪽), 그 밖의 오류는 사람에게 보여 줄 말을 따로 짓는다.
 * 원래 오류는 `cause` 에 담아 **부르는 쪽이 서버 로그에만** 남긴다 — 🔴 응답에
 * 실으면 셀 주소·경로가 그대로 브라우저로 나간다.
 * ============================================================================
 */

/** 못 그린 까닭. 부르는 쪽이 이 코드로 사람에게 할 말을 고른다. */
export type ServiceReportPreviewGridFailureCode =
  | "INVALID_INPUT"
  | "TEMPLATE_UNAVAILABLE"
  | "RENDER_FAILED";

export type ServiceReportPreviewGridResult =
  | {
      ok: true;
      /** 채워진 시트를 그대로 읽은 표 자료. 화면은 여기 담긴 것만 그린다. */
      grid: SheetPrintGrid;
      /** 「수리보고서」·「검사보고서」 — 화면 안내에만 쓴다(문서에는 양식의 제목이 이미 있다). */
      kindLabel: string;
      /** 🔴 **격자를 뽑아낸 그 양식**의 그림 라우트 앞부분. 뒤에 그림 파일 이름이 붙는다. */
      templateImageBase: string;
    }
  | {
      ok: false;
      code: ServiceReportPreviewGridFailureCode;
      /** 사람에게 보여 줄 수 있는 말. 🔴 경로가 담기지 않는다. */
      message: string;
      /** 칸별 오류. `INVALID_INPUT` 일 때만 있다. */
      fieldErrors?: Record<string, string>;
      /** 🔴 **서버 로그에만** 쓴다. 응답에 실으면 셀 주소·경로가 밖으로 나간다. */
      cause?: unknown;
    };

const RENDER_FAILED_MESSAGE = "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.";

/**
 * 도장 그림을 꺼내 오는 라우트의 앞부분.
 *
 * 🔴 주소를 부르는 쪽마다 적지 않는다 — 라우트 폴더 이름을 바꾸는 날 한쪽만
 * 고쳐지고, 그때 증상은 «도장만 안 나오는 미리보기»라 아무 오류도 나지 않는다.
 */
export function serviceReportTemplateImageBase(
  kind: ServiceReportKind,
  productKind: ServiceReportTemplateProductKind
): string {
  return `/api/service-reports/template-image/${kind}/${productKind}/`;
}

/**
 * 양식의 제목에서 화면용 이름을 만든다. 전각 공백은 문서의 자간을 벌리려고 넣은
 * 것이라 **화면에서만** 걷어낸다.
 */
export function serviceReportScreenTitle(templateTitle: string): string {
  return templateTitle.split("　").join("");
}

/**
 * 보고서 한 장(요청 본문 모양)을 격자로.
 *
 * `payload` 는 `buildServiceReportRequestBody` 가 만든 모양이다 — **저장된 장에서
 * 왔든 아직 저장하지 않은 폼에서 왔든 같다.** 그것이 이 함수가 둘을 함께 받을 수
 * 있는 까닭이고, 두 미리보기가 같은 문서를 보여 주는 보증이기도 하다.
 */
export async function buildServiceReportPreviewGrid(
  payload: unknown,
  /** 접수 건의 종류. 매쳐·제너레이터 중 어느 양식을 쓸지가 여기서 갈린다. */
  workflowType: string
): Promise<ServiceReportPreviewGridResult> {
  const validated = validateServiceReportFields(payload);
  if (!validated.ok) {
    /**
     * 저장은 **적다 만 보고서도 받는다**(`validation/service-report-save-input.ts`).
     * 본문이 한 줄도 없는 장이 실제로 있고, 그 장은 문서로 만들 수 없다.
     *
     * 🔴 칸별 오류 **메시지**는 그대로 사람에게 보여 줄 말이 아니다(숫자가 섞인
     * 개발자용 문장 — UI_GUIDELINE 11). 대신 **막힌 칸의 이름**을 말한다. 칸별
     * 오류는 따로 실어 보내, 받는 쪽이 화면이면 칸마다 붙여 줄 수 있게 한다.
     */
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: describeServiceReportBlockers(validated.fieldErrors),
      fieldErrors: validated.fieldErrors,
    };
  }
  const input = validated.data;

  try {
    // 🔴 제품 축을 먼저 정한다 — 격자와 도장이 **같은 양식**에서 나와야 한다.
    const productKind = serviceReportTemplateProductKindOf(workflowType);
    const workbook = fillServiceReportWorkbook(
      await readServiceReportTemplate(input.kind, productKind),
      input
    );
    return {
      ok: true,
      grid: readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME),
      kindLabel: serviceReportScreenTitle(SERVICE_REPORT_TITLES[input.kind]),
      templateImageBase: serviceReportTemplateImageBase(input.kind, productKind),
    };
  } catch (err) {
    if (err instanceof ServiceReportTemplateError) {
      // 🔴 err.message 에는 경로가 들어 있지 않다(storage 쪽이 그렇게 만든다).
      return { ok: false, code: "TEMPLATE_UNAVAILABLE", message: err.message, cause: err };
    }
    // 양식이 바뀌어 라벨이 어긋나면 채우개가 던진다. 🔴 그 말은 셀 주소가 섞인
    // 개발자용 문장이라 사람에게 그대로 보이지 않는다 — `cause` 로만 올린다.
    return { ok: false, code: "RENDER_FAILED", message: RENDER_FAILED_MESSAGE, cause: err };
  }
}
