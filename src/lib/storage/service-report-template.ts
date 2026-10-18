import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { WORKFLOW_TYPE_CODES, type WorkflowType } from "@/lib/domain/types";
import { workflowKindOf, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 검사 보고서 · 수리 보고서 원본 양식을 읽는 단 하나의 자리
 * ============================================================================
 * `storage/quote-template.ts` 와 **같은 규칙, 다른 파일**이다. 규칙이 같은 것은
 * 이유가 같아서다 — 원본 xlsx 에 법인 직인 그림이 들어 있어 저장소에 커밋하지
 * 않고, 경로를 환경변수로 받고, 캐시하지 않고(양식을 바꾼 뒤 서버를 다시
 * 띄우기 전까지 옛 양식이 나가는 상태를 만들지 않는다), 프로그램은 절대 쓰지
 * 않는다.
 *
 * ── 파일을 나눈 이유 ────────────────────────────────────────────────────
 * `quote-template.ts` 는 스스로를 "견적서 원본 양식을 읽는 단 하나의 자리"로
 * 선언해 두었고, 실제로 견적서 도메인(`QuoteTemplateKey`·
 * `QUOTE_WORK_SCOPE_SECTIONS`·세 채우개의 작업내역 머리글)을 끌어다 쓴다.
 * 거기에 보고서 경로를 얹으면 보고서 출력이 견적서 도메인 타입에 묶인다 —
 * 서로 아무 관계도 없는 두 문서가 한쪽을 고칠 때마다 함께 흔들린다.
 * 규칙이 같은 이웃 파일로 두는 편이 싸다.
 *
 * ============================================================================
 * 🔴 양식은 넷이다 — 문서 종류(검사 · 수리) × 제품 종류(매쳐 · 제너레이터)
 * ============================================================================
 * 2026-10-18 이전에는 문서 종류로 **둘**만 골랐다. 그런데 매쳐 건과 제너레이터
 * 건은 **담당 엔지니어가 다르고, 양식에 그 사람의 도장이 박혀 있다.** 둘이 같은
 * 파일을 읽는 동안 매쳐 건 보고서에 제너레이터 담당자의 도장이 찍혀 나갔다.
 *
 * 네 양식의 **칸 구조는 같다**(실측). 다른 것은 담당자 도장 그림 하나뿐이므로
 * 채우개(`xlsx/service-report-template.ts`)는 한 벌 그대로다 — 바뀐 것은 어느
 * 파일을 **읽을지**뿐이다.
 *
 * ── 🔴 대응을 적는 자리는 여기 하나뿐이다 ───────────────────────────────
 * `TEMPLATE_PRODUCT_KIND_BY_WORKFLOW_KIND` 가 그 표다. 부르는 쪽(내려받기 통로 ·
 * 연락서 폴더 통로 · 미리보기 화면 · 작성 화면 · 도장 그림 통로)이 각자 판단하면
 * 언젠가 갈라지고, 그때 증상은 「어느 통로로 뽑느냐에 따라 도장이 다르다」라서
 * 아무 오류도 나지 않는다.
 *
 * ── 🔴 T/C 는 제너레이터 양식이다 (2026-10-18 사용자 결정) ───────────────
 * 제품 종류는 셋인데 양식은 둘이다. Total Controller 가 제너레이터 쪽으로 가는
 * 것은 복사 실수가 아니라 결정이다 — 보고서의 「품명 구분」(`H20`)이 이미 같은
 * 갈래로 묶여 있다(`domain/service-report-form.ts` 의
 * `PRODUCT_CATEGORY_DOCUMENT_TEXTS`). **고치지 말 것.**
 *
 * ── 🔴 제품 축은 **워크플로 종류**에서 온다 — 모델 마스터가 아니다 ───────
 * `product_models.kind` 는 비어 있는 모델이 많고 같은 장비가 들어올 때마다 다른
 * 종류로 다뤄진 사례가 있다. 쓰는 것은 **접수할 때 사람이 고른 종류**다
 * (`domain/product-model-kind.ts` 의 같은 판단).
 *
 * ── 🔴 모르는 종류는 **지어내지 않고 던진다** ───────────────────────────
 * `workflowKindOf` 는 접미사를 못 찾으면 조용히 `GENERATOR` 를 돌려준다. DB enum
 * 에는 아직 레거시 `MATCHER`(유·무상 접미사가 없는 옛 값)가 남아 있어서
 * (`db/workflow-type-column.ts`), 그 값을 그대로 태우면 **매쳐 건에 제너레이터
 * 담당자의 도장이 찍힌다** — 이 변경이 막으려던 바로 그 사고다. 그래서 먼저
 * `WORKFLOW_TYPE_CODES` 로 걸러 모르는 값이면 던진다. 보고서가 한 장 안 나가는
 * 것이 **엉뚱한 사람 도장이 찍힌 보고서가 고객사로 나가는 것**보다 낫다.
 * (그런 접수 건은 0건이다 — 2026-08-19 실측. 이 문은 그 사실이 깨지는 날을 위한
 * 것이다.)
 * ============================================================================
 */

export class ServiceReportTemplateError extends Error {}

/**
 * 양식이 갈리는 제품 축. 🔴 **제품 종류 셋이 아니라 둘이다** — 양식 파일이
 * 둘이기 때문이다(T/C 는 제너레이터 양식을 쓴다. 위 머리말).
 */
export const SERVICE_REPORT_TEMPLATE_PRODUCT_KINDS = ["MATCHER", "GENERATOR"] as const;
export type ServiceReportTemplateProductKind =
  (typeof SERVICE_REPORT_TEMPLATE_PRODUCT_KINDS)[number];

/**
 * 🔴 **종류 → 양식.** 이 표가 저장소에 하나뿐이다(위 머리말의 '대응을 적는
 * 자리는 여기 하나뿐이다'). `Record<WorkflowKind, …>` 이라 **제품 종류가 하나
 * 늘면 tsc 가 여기를 잡는다.**
 */
const TEMPLATE_PRODUCT_KIND_BY_WORKFLOW_KIND: Record<
  WorkflowKind,
  ServiceReportTemplateProductKind
> = {
  MATCHER: "MATCHER",
  GENERATOR: "GENERATOR",
  // 🔴 제너레이터와 같은 양식이다 — 위 머리말의 'T/C 는 제너레이터 양식이다'.
  TOTAL_CONTROLLER: "GENERATOR",
};

/**
 * ============================================================================
 * 설정 넷 — 그리고 🔴 **옛 설정 둘로 물러서기**
 * ============================================================================
 * 이름은 견적서 양식의 관례를 따른다(`storage/quote-template.ts` 의
 * `MATCHER_QUOTE_TEMPLATE_PATH` · `MATCHER_OH_QUOTE_TEMPLATE_PATH`) — **갈래
 * 이름을 앞에 붙인다.**
 *
 * 🔴 **새 설정이 비어 있으면 옛 설정을 쓴다.** 까닭은 배포 순서다: 운영
 * 환경변수에 새 이름 넷을 넣기 **전에** 이 코드가 먼저 배포될 수 있고, 그때
 * 물러설 자리가 없으면 보고서가 통째로 멈춘다. 물러섰을 때 나가는 것은
 * **2026-10-18 이전과 똑같은 문서**이므로(옛 양식 둘이 그대로 있다) 나빠지는
 * 것은 없다 — 매쳐·제너레이터가 같은 도장을 쓰던 그 상태로 돌아갈 뿐이다.
 *
 * 🔴 **옛 이름 둘을 지우지 않는다.** 지우는 순간 이 물러서기가 사라진다.
 * ============================================================================
 */
const TEMPLATE_ENV: Record<
  ServiceReportTemplateProductKind,
  Record<ServiceReportKind, string>
> = {
  MATCHER: {
    INSPECTION: "MATCHER_INSPECTION_REPORT_TEMPLATE_PATH",
    REPAIR: "MATCHER_REPAIR_REPORT_TEMPLATE_PATH",
  },
  GENERATOR: {
    INSPECTION: "GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH",
    REPAIR: "GENERATOR_REPAIR_REPORT_TEMPLATE_PATH",
  },
};

/** 🔴 물러설 자리. 위 '물러서기' — **지우지 말 것.** */
const LEGACY_TEMPLATE_ENV: Record<ServiceReportKind, string> = {
  INSPECTION: "INSPECTION_REPORT_TEMPLATE_PATH",
  REPAIR: "REPAIR_REPORT_TEMPLATE_PATH",
};

const TEMPLATE_LABEL: Record<ServiceReportKind, string> = {
  INSPECTION: "검사 보고서",
  REPAIR: "수리 보고서",
};

/** 설정이 빠졌을 때 어느 양식인지 말해 주려고 둔다(견적서 양식의 `label` 과 같다). */
const PRODUCT_KIND_LABEL: Record<ServiceReportTemplateProductKind, string> = {
  MATCHER: "매쳐",
  GENERATOR: "제너레이터",
};

/** 설정된 값. 없거나 공백뿐이면 `null`. */
function configuredPath(variable: string): string | null {
  const configured = process.env[variable];
  if (!configured || configured.trim().length === 0) return null;
  return configured.trim();
}

/**
 * 접수 건의 workflowType → 양식의 제품 축. 🔴 **모르는 값이면 던진다** — 위
 * 머리말의 '모르는 종류는 지어내지 않고 던진다'.
 */
export function serviceReportTemplateProductKindOf(
  workflowType: string
): ServiceReportTemplateProductKind {
  // 🔴 `workflowKindOf` 에 바로 넘기지 않는다. 그 함수는 접미사를 못 찾으면
  //    조용히 `GENERATOR` 를 돌려주므로, 레거시 `MATCHER` 가 제너레이터 도장을
  //    달고 나간다. 먼저 목록으로 거른다.
  if (!(WORKFLOW_TYPE_CODES as readonly string[]).includes(workflowType)) {
    throw new ServiceReportTemplateError(
      "이 접수 건의 종류(매쳐·제너레이터)를 알 수 없어 보고서 양식을 고를 수 없습니다. 접수 건의 종류를 확인해 주세요."
    );
  }
  return TEMPLATE_PRODUCT_KIND_BY_WORKFLOW_KIND[workflowKindOf(workflowType as WorkflowType)];
}

/** 주소 마디로 실려 온 글자가 양식의 제품 축인가. 🔴 경로로 쓰기 전에 거른다. */
export function isServiceReportTemplateProductKind(
  value: unknown
): value is ServiceReportTemplateProductKind {
  return (
    typeof value === "string" &&
    (SERVICE_REPORT_TEMPLATE_PRODUCT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * 설정된 양식 경로. 새 설정이 비면 **옛 설정으로 물러서고**(위 '물러서기'),
 * 둘 다 비면 던진다 — 조용히 기본 경로로 넘어가면 아무도 없는 자리를 가리킨 채
 * "파일을 찾을 수 없습니다"만 반복하게 된다.
 */
export function resolveServiceReportTemplatePath(
  kind: ServiceReportKind,
  productKind: ServiceReportTemplateProductKind
): string {
  const variable = TEMPLATE_ENV[productKind]?.[kind];
  const legacyVariable = LEGACY_TEMPLATE_ENV[kind];
  if (variable === undefined || legacyVariable === undefined) {
    throw new ServiceReportTemplateError(
      `보고서 종류가 잘못됐습니다: ${String(kind)} / ${String(productKind)}`
    );
  }

  // 🔴 새 설정 → 옛 설정 차례. 이 한 줄이 '물러서기'다.
  const configured = configuredPath(variable) ?? configuredPath(legacyVariable);
  if (configured === null) {
    throw new ServiceReportTemplateError(
      `${variable}가 설정되지 않았습니다. ${PRODUCT_KIND_LABEL[productKind]} ${TEMPLATE_LABEL[kind]} 원본 양식 경로를 .env.local에 지정해야 합니다.`
    );
  }
  return path.resolve(configured);
}

/**
 * 양식 바이트. 못 읽으면 ServiceReportTemplateError 로 바꿔 던진다 —
 * **경로를 사용자에게 보여 주지 않기 위해서**다(오류 메시지가 디스크 구조를
 * 알려 주는 창구가 되면 안 된다. 첨부 다운로드 라우트와 견적서 양식의 같은 판단).
 */
export async function readServiceReportTemplate(
  kind: ServiceReportKind,
  productKind: ServiceReportTemplateProductKind
): Promise<Buffer> {
  const templatePath = resolveServiceReportTemplatePath(kind, productKind);
  try {
    return await readFile(templatePath);
  } catch (err) {
    // 경로는 서버 로그에만 남긴다.
    console.error("[service-report-template] 원본 양식을 읽지 못했다", {
      kind,
      productKind,
      templatePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ServiceReportTemplateError(
      `${PRODUCT_KIND_LABEL[productKind]} ${TEMPLATE_LABEL[kind]} 원본 양식을 읽을 수 없습니다. 관리자에게 문의해 주세요.`
    );
  }
}

/**
 * 그 **접수 건**의 양식 바이트. 부르는 쪽이 제품 축을 스스로 셈하지 않게 하려고
 * 둔다 — 위 머리말의 '대응을 적는 자리는 여기 하나뿐이다'. 종류를 알 수 없으면
 * 여기서 던진다(같은 `ServiceReportTemplateError` 라 부르는 쪽의 처리가 그대로다).
 */
export async function readServiceReportTemplateForCase(
  kind: ServiceReportKind,
  workflowType: string
): Promise<Buffer> {
  return readServiceReportTemplate(kind, serviceReportTemplateProductKindOf(workflowType));
}
