import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import ServiceReportForm from "@/components/repair-cases/report/service-report/ServiceReportForm";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { toKstDateOnly } from "@/lib/domain/date-only";
import { repairCaseDetailHrefs } from "@/lib/domain/repair-case-detail-tabs";
import { createServiceReportFormValues } from "@/lib/domain/service-report-form";
import { serviceReportKindFromParam } from "@/lib/domain/service-report-kind-param";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readServiceReportTemplate } from "@/lib/storage/service-report-template";
import { SERVICE_REPORT_MAX_REMARK_ROWS } from "@/lib/validation/service-report-input";
import {
  readServiceReportChoices,
  type ServiceReportChoices,
} from "@/lib/xlsx/service-report-choices";
import {
  SERVICE_REPORT_CAUSE_LABELS,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_MAX_BODY_ROWS,
} from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * /repair-cases/{id}/report/service-report — 검사·수리 보고서를 채우는 화면
 * ============================================================================
 * 「보고서」 탭 **아래에 붙는 자식 주소**다. 탭 강조는 최장 일치로 정해지므로
 * (`domain/repair-case-detail-tabs.ts` 의 `resolveActiveTabHref`) 이 자식
 * 주소에서도 「보고서」 탭이 강조된 채로 남는다 — 진단 Flowchart 의
 * `/diagnosis/[flowchartId]` 와 같은 구조다.
 *
 * ── 🔴 드롭다운 목록은 양식에서 읽는다 ─────────────────────────────────
 * 「상황」과 「품명」의 목록을 화면 코드에 베껴 두면, 사람이 Excel 에서 항목을
 * 하나 더한 날 화면만 뒤처진다. 그 어긋남은 아무 오류도 내지 않는다 — 아무도
 * 못 고르는 항목이 될 뿐이라 몇 달이 지나도 모른다.
 *
 * 검사·수리 두 양식은 같은 통합문서라 목록이 같다. 한 번만 읽는다.
 *
 * ── 🔴 양식을 못 읽어도 화면은 살아 있어야 한다 ────────────────────────
 * 경로가 설정 안 됐거나 파일이 없으면 `readServiceReportTemplate` 이 던진다.
 * 서버 컴포넌트에서 던지면 **화면이 통째로 죽어** 사람은 빈 오류 페이지를 본다.
 * 그래서 여기서 잡아 목록 없이 그리고, 무슨 일인지 한 줄로 알려 준다. 내려받기
 * 버튼도 함께 잠근다 — 어차피 라우트가 503 을 준다.
 *
 * 🔴 **오류 메시지에 경로를 담지 않는다.** 오류가 디스크 구조를 알려 주는
 * 창구가 되면 안 된다(`storage/service-report-template.ts` 의 같은 판단).
 * 경로는 그쪽이 서버 로그에만 남긴다.
 *
 * ── `?kind=` 는 **시작값만** 정한다 ─────────────────────────────────────
 * 「보고서」 탭의 갈림길 화면이 `?kind=INSPECTION` · `?kind=REPAIR` 를 붙여
 * 보낸다. 세 가지를 지킨다:
 *
 *   · 🔴 **주소를 그대로 믿지 않는다.** 손으로 고칠 수 있는 자리라 두 값 중
 *     하나일 때만 쓴다(`serviceReportKindFromParam`). 아니면 폼 씨앗의 기본값이다.
 *   · **화면 안에서 바꾸는 길은 그대로다.** 여기서 정하는 것은 처음 고를 값뿐이다.
 *   · ⚠️ **브라우저 임시보관이 이긴다.** 임시보관에 든 종류는 사람이 고른
 *     것이므로, 주소의 값은 임시보관이 없을 때만 쓰인다 — 폼이
 *     `edited ?? restoredDraft?.values ?? initialValues` 로 갈라 두었고, 주소는
 *     그중 **맨 마지막 칸**인 `initialValues` 에만 얹힌다.
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "검사·수리 보고서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const TEMPLATE_UNAVAILABLE_MESSAGE =
  "양식을 읽을 수 없어 목록을 불러오지 못했습니다. 관리자에게 문의해 주세요.";

export default async function ServiceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** 같은 이름이 두 번 올 수 있는 자리라 배열도 받는다 — 판단은 도메인 함수가 한다. */
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const { id } = await params;
  const { kind: kindParam } = await searchParams;

  // 상위 (app) 레이아웃이 이미 세션을 확인하지만, 이 화면은 고객사로 나가는
  // 문서를 짓는 자리라 방어적으로 한 번 더 본다. 살아 있는 계정을 다시 읽는
  // 것도 라우트와 같은 이유다 — 강등·정지된 계정이 예전 세션으로 남아 있는
  // 상태에서 폼을 다 채우고 나서 403 을 받는 것보다 낫다.
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  let choices: ServiceReportChoices | null = null;
  let templateError: string | null = null;
  try {
    // 두 양식이 같은 통합문서라 한 번만 읽는다.
    choices = readServiceReportChoices(await readServiceReportTemplate("REPAIR"));
  } catch (err) {
    // 🔴 err.message 를 그대로 내보내지 않는다 — 양식이 바뀌었을 때 나오는 말은
    // 셀 주소가 섞인 개발자용 문장이다(UI_GUIDELINE 11). 자세한 것은 서버 로그다.
    console.error("[service-report-page] 양식의 드롭다운 목록을 읽지 못했다", {
      repairCaseId: resolved.id,
      error: err instanceof Error ? err.message : String(err),
    });
    templateError = TEMPLATE_UNAVAILABLE_MESSAGE;
  }

  const initialValues = createServiceReportFormValues({
    repairCase: resolved,
    // 발행일의 기본값. 서버에서 만들어 넘겨야 서버 렌더와 브라우저가 어긋나지 않는다.
    today: toKstDateOnly(new Date()),
    findingsIntro: SERVICE_REPORT_FINDINGS_INTRO,
    // 🔴 형식에서 뽑은 품명은 **이 목록 안에 있을 때만** 골라진다. 양식을 못
    //    읽었으면 빈 목록이 가고, 그러면 아무것도 안 고른다(사람이 고른다).
    productNames: choices?.productNames ?? [],
    // 🔴 갈림길 화면이 고른 종류. 못 고른 값은 `null` 로 오고, 그때는 키를 안 준
    //    것과 같아 씨앗의 기본값이 그대로 쓰인다 — 기본값의 사본을 만들지 않는다.
    kind: serviceReportKindFromParam(kindParam) ?? undefined,
  });

  return (
    <ServiceReportForm
      repairCaseId={resolved.id}
      // 🔴 임시보관 열쇠에 쓸 **id 하나만** 넘긴다. 사무실 공용 PC 를 여럿이
      //    나눠 쓰므로 사람마다 갈라 적어야 하는데, 그러자고 이름·역할·이메일까지
      //    클라이언트로 내려보낼 이유는 없다(위 '오류 메시지에 경로를 담지
      //    않는다'와 같은 판단 — 필요 없는 것은 안 보낸다).
      actingUserId={actingUser.id}
      intakeNumber={resolved.intakeNumber}
      reportHref={repairCaseDetailHrefs(resolved.id).report}
      initialValues={initialValues}
      // 🔴 상한은 상수에서 온다. 화면이 숫자를 들고 있으면 양식이 늘어난 날
      // 화면만 뒤처지고, 증상은 "왜 안 되는지 모르겠는 400"이 된다.
      limits={{
        maxBodyRows: SERVICE_REPORT_MAX_BODY_ROWS,
        maxRemarkRows: SERVICE_REPORT_MAX_REMARK_ROWS,
      }}
      choices={choices}
      // 🔴 원인 라벨도 채우개에서 온다. 화면이 사본을 들고 있으면 양식의 라벨이
      //    바뀐 날 화면과 문서가 서로 다른 이름을 부른다 — 오류가 안 나서
      //    아무도 모른다.
      causeLabels={SERVICE_REPORT_CAUSE_LABELS}
      templateError={templateError}
    />
  );
}
