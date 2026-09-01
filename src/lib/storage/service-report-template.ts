import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
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
 * ============================================================================
 */

export class ServiceReportTemplateError extends Error {}

const TEMPLATE_ENV: Record<ServiceReportKind, string> = {
  INSPECTION: "INSPECTION_REPORT_TEMPLATE_PATH",
  REPAIR: "REPAIR_REPORT_TEMPLATE_PATH",
};

const TEMPLATE_LABEL: Record<ServiceReportKind, string> = {
  INSPECTION: "검사 보고서",
  REPAIR: "수리 보고서",
};

/**
 * 설정된 양식 경로. 없거나 빈 값이면 던진다 — 조용히 기본 경로로 넘어가면
 * 아무도 없는 자리를 가리킨 채 "파일을 찾을 수 없습니다"만 반복하게 된다.
 */
export function resolveServiceReportTemplatePath(kind: ServiceReportKind): string {
  const variable = TEMPLATE_ENV[kind];
  if (variable === undefined) {
    throw new ServiceReportTemplateError(`보고서 종류가 잘못됐습니다: ${String(kind)}`);
  }

  const configured = process.env[variable];
  if (!configured || configured.trim().length === 0) {
    throw new ServiceReportTemplateError(
      `${variable}가 설정되지 않았습니다. ${TEMPLATE_LABEL[kind]} 원본 양식 경로를 .env.local에 지정해야 합니다.`
    );
  }
  return path.resolve(configured.trim());
}

/**
 * 양식 바이트. 못 읽으면 ServiceReportTemplateError 로 바꿔 던진다 —
 * **경로를 사용자에게 보여 주지 않기 위해서**다(오류 메시지가 디스크 구조를
 * 알려 주는 창구가 되면 안 된다. 첨부 다운로드 라우트와 견적서 양식의 같은 판단).
 */
export async function readServiceReportTemplate(kind: ServiceReportKind): Promise<Buffer> {
  const templatePath = resolveServiceReportTemplatePath(kind);
  try {
    return await readFile(templatePath);
  } catch (err) {
    // 경로는 서버 로그에만 남긴다.
    console.error("[service-report-template] 원본 양식을 읽지 못했다", {
      kind,
      templatePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ServiceReportTemplateError(
      `${TEMPLATE_LABEL[kind]} 원본 양식을 읽을 수 없습니다. 관리자에게 문의해 주세요.`
    );
  }
}
