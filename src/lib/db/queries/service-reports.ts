import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../client";
import {
  serviceReportCauses,
  serviceReportLines,
  serviceReports,
  users,
} from "../schema";
import { formatServiceReportNumber } from "@/lib/domain/service-report-file-name";
import {
  toServiceReportSaveValues,
  type ServiceReportSaveValues,
} from "@/lib/validation/service-report-save-input";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 검사·수리 보고서 — 읽는 쪽
 * ============================================================================
 * `queries/quotes.ts` 와 같은 자리, 같은 규칙이다. **쓰기 함수가 없다** — 만들고
 * 고치는 일은 트랜잭션과 낙관적 잠금이 필요해 `mutations/service-reports.ts` 가
 * 맡는다.
 *
 * ── 🔴 지워진 보고서는 id 로 찾아도 안 나온다 ───────────────────────────
 * 목록에서 빼는 것만으로는 모자라다. 주소만으로 휴지통에 있는 장을 계속 뽑을 수
 * 있으면 휴지통이 뜻을 잃는다 — `getQuoteForEdit` 과 같은 판단이고, 내려받기
 * 라우트가 지워진 접수 건을 없는 것으로 보는 것과도 같은 자리다.
 *
 * ── 목록은 본문 줄을 끌어오지 않는다 ────────────────────────────────────
 * 한 접수 건에 붙는 보고서는 많아야 몇 장이지만, 본문은 한 장에 수백 줄까지
 * 간다. 목록이 답해야 하는 물음은 "이 건으로 어떤 보고서가 나갔나"이고 거기에는
 * 종류·문서번호·발행일·만든 사람·고친 때면 충분하다. 본문은 한 장을 열 때
 * 읽는다(견적서 목록이 부품 줄을 N+1 로 읽지 않는 것과 같은 규칙).
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 고객사명·발생 장소·「상황」·본문 줄은 고객사 사정이 섞이는 값이다
 * (`schema/service-reports.ts`). **목록에는 하나도 담지 않는다** — 목록을 그리는
 * 데 필요하지 않고, 담으면 로그와 오류 보고에 딸려 나갈 자리가 늘어난다.
 * ============================================================================
 */

export type ServiceReportListItem = {
  id: string;
  /** 수정 폼이 저장할 때 되돌려 보낼 낙관적 잠금 토큰. 목록에 그리지는 않는다. */
  version: number;
  kind: ServiceReportKind;
  /** `No. [앞] - [중간] - [뒤]` 를 한 줄로 이은 것. 빈 조각은 빠진다. */
  reportNumber: string;
  /** "YYYY-MM-DD" */
  issuedOn: string;
  /** 만든 사람의 이름. 계정이 지워졌거나 옛 자료면 null. */
  createdByName: string | null;
  /** 마지막으로 고친 때(ISO 8601). */
  updatedAt: string;
};

/**
 * 이 접수 건으로 나간 보고서들. **지워진 것은 빼고**, 발행일 내림차순 →
 * 만든 시각 내림차순.
 *
 * 정렬 기준이 견적서 목록과 같다: 최근에 낸 것을 먼저 보는 것이 이 화면을 여는
 * 목적이고, 같은 날 두 장을 낸 경우(검사 한 장 + 수리 한 장)가 실제로 있어서
 * 그때 순서가 매번 달라지지 않도록 두 번째 기준을 둔다. 문서번호로 정렬하지
 * 않는 것은 그것이 사람이 손으로 적는 값이라 문자열 정렬이 발행 순서와 어긋날
 * 수 있기 때문이다.
 */
export async function listServiceReportsForRepairCase(
  repairCaseId: string
): Promise<ServiceReportListItem[]> {
  const rows = await db
    .select({
      id: serviceReports.id,
      version: serviceReports.version,
      kind: serviceReports.kind,
      reportNumberPrefix: serviceReports.reportNumberPrefix,
      reportNumberMiddle: serviceReports.reportNumberMiddle,
      reportNumberTail: serviceReports.reportNumberTail,
      issuedOn: serviceReports.issuedOn,
      createdByName: users.name,
      updatedAt: serviceReports.updatedAt,
    })
    .from(serviceReports)
    // 만든 사람이 지워진 계정일 수 있다 — 그렇다고 보고서가 목록에서 사라지면
    // 안 되므로 왼쪽 조인이다.
    .leftJoin(users, eq(users.id, serviceReports.createdBy))
    .where(and(eq(serviceReports.repairCaseId, repairCaseId), eq(serviceReports.isDeleted, false)))
    .orderBy(desc(serviceReports.issuedOn), desc(serviceReports.createdAt));

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    kind: row.kind,
    reportNumber: formatServiceReportNumber({
      prefix: row.reportNumberPrefix ?? undefined,
      middle: row.reportNumberMiddle,
      tail: row.reportNumberTail,
    }),
    issuedOn: row.issuedOn,
    createdByName: row.createdByName,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export type ServiceReportDetail = {
  id: string;
  repairCaseId: string;
  /** 🔴 저장할 때 되돌려 보낼 낙관적 잠금 토큰. 폼을 열 때 함께 읽어야 그 사이의 변경을 놓치지 않는다. */
  version: number;
  /**
   * 화면이 폼에 그대로 부을 값.
   *
   * 🔴 `findingsIntro` 만 `string | null` 이다 — 「안 줌」과 「일부러 비움」이 서로
   * 다른 뜻이라 여기서 `''` 로 뭉개면 안 된다. 화면에 부을 때
   * `serviceReportFormValues(values, 정형문구)` 로 한 번만 푼다
   * (`validation/service-report-save-input.ts`).
   */
  values: ServiceReportSaveValues;
};

/**
 * 보고서 한 장을 통째로 — 줄과 원인까지.
 *
 * 지워진 장은 `null` 이다. 위 머리말의 '지워진 보고서는 id 로 찾아도 안 나온다'.
 */
export async function getServiceReportForEdit(id: string): Promise<ServiceReportDetail | null> {
  const [row] = await db
    .select()
    .from(serviceReports)
    .where(and(eq(serviceReports.id, id), eq(serviceReports.isDeleted, false)))
    .limit(1);

  if (!row) return null;

  /**
   * 🔴 **구역 안의 차례대로** 읽는다. 빈 줄도 한 번호를 차지하므로, 이 순서를
   * 지켜야 사람이 띄워 둔 문단이 그대로 돌아온다(`schema/service-reports.ts` 의
   * '빈 줄을 버리면 안 된다').
   */
  const lines = await db
    .select({
      section: serviceReportLines.section,
      lineNo: serviceReportLines.lineNo,
      text: serviceReportLines.text,
    })
    .from(serviceReportLines)
    .where(eq(serviceReportLines.serviceReportId, id))
    .orderBy(asc(serviceReportLines.section), asc(serviceReportLines.lineNo));

  /**
   * 고른 원인. `cause` 로 정렬하면 **Postgres 가 enum 을 선언 순서로 견준다** —
   * 그 순서가 곧 양식 29·30행의 체크박스 배치이고, 화면이 그리는 순서다
   * (`serviceReportCauseOptions`). 알파벳 순으로 흩어지지 않는다.
   */
  const causes = await db
    .select({ cause: serviceReportCauses.cause })
    .from(serviceReportCauses)
    .where(eq(serviceReportCauses.serviceReportId, id))
    .orderBy(asc(serviceReportCauses.cause));

  return {
    id: row.id,
    repairCaseId: row.repairCaseId,
    version: row.version,
    // 칸 → 폼 되돌리기는 저장할 때 쓴 사전이 그대로 한다. 두 방향이 한 파일에
    // 마주 놓여 있어야 어긋나지 않는다(그 파일의 '왜 두 방향이 한 파일에 있나').
    values: toServiceReportSaveValues({
      columns: row,
      lines,
      causes: causes.map((entry) => entry.cause),
    }),
  };
}
