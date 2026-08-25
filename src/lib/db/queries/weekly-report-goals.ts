import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  products,
  repairCases,
  weeklyReportGoals,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import { foldWeeklyReportKind, type WeeklyReportKind } from "@/lib/domain/weekly-report";
import type { WorkflowType } from "@/lib/domain/types";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 읽는 쪽
 * ============================================================================
 * **SELECT 만 있다.** 저장·삭제·복사는 트랜잭션과 낙관적 잠금이 필요해
 * mutations/weekly-report-goals.ts 가 맡는다(이 저장소의 queries/mutations 구분).
 * 같은 화면의 집계를 읽는 queries/weekly-report.ts 와 나란한 자리이고, 방식도
 * 그쪽에 맞춘다.
 *
 * ── 앞부분은 저장돼 있지 않다. 여기서 조인해 온다 ───────────────────────
 * 상자에 인쇄되는 `[INVENIA] D260706_RFK300FH-AD1_2111171_WT7351` 는
 * weekly_report_goals 에 없다 — 저장하지 않기로 했다
 * (schema/weekly-report-goals.ts 헤더). 그래서 이 조회는 목표 줄마다 수리 건과
 * 고객사·제품을 함께 읽어 **재료를 그대로 넘기고**, 이어 붙이는 일은
 * domain/weekly-report-goal.ts 의 buildGoalPrefix 가 한다. 여기서 SQL 의
 * concat 으로 접으면 "왜 이 줄에 `__` 가 생겼나"를 시험할 자리가 사라진다 —
 * queries/weekly-report.ts 가 상태 분류를 CASE 로 접지 않은 것과 같은 판단이다.
 *
 * ── RFG/MB 도 저장돼 있지 않다 ──────────────────────────────────────────
 * 어느 상자로 갈지는 수리 건의 워크플로 종류가 정한다. 그 접기는 이미
 * domain 의 foldWeeklyReportKind 가 하고 있으므로 여기서는 **부르기만** 한다.
 * 이 값을 조회에서 붙여 주는 이유는 화면이 상자 둘을 그릴 때 매번 같은 접기를
 * 다시 하지 않게 하기 위해서다.
 *
 * ── 조인은 INNER JOIN 이다 ──────────────────────────────────────────────
 * repair_case_id 가 NOT NULL 이고 repair_cases 는 customers·products 를 필수로
 * 가리키므로, LEFT JOIN 으로 적어도 늘 같은 결과가 나온다. 그래도 INNER 로
 * 적는 것은 **연결이 끊긴 줄이 조용히 빈칸으로 나오지 않게** 하기 위해서다 —
 * 그런 줄이 생겼다면 자료가 깨진 것이고, 빈칸으로 그리는 대신 사라지는 편이
 * 눈에 띈다(내자 정리는 연결 없는 줄이 **정상**이라 반대로 LEFT JOIN 이다).
 *
 * ── 휴지통에 있는 수리 건도 그대로 보여 준다 ────────────────────────────
 * repair_cases.is_deleted 를 보지 않는다. 지난주에 목표를 적어 둔 건이 이번 주에
 * 휴지통으로 갔다면, 그 사실은 지난주 상자에서 줄이 사라지는 것이 아니라
 * 그대로 남아 있는 것으로 드러나야 한다 — 지난주에 무슨 계획이었는지는 그
 * 건을 지웠다고 해서 달라지는 사실이 아니다. 영구 삭제된 건은 CASCADE 로 목표
 * 줄까지 함께 사라진다(스키마 헤더).
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * goal_text 는 사람이 자유롭게 적는 값이라 담당자 이름이 섞일 수 있다
 * (스키마 헤더의 PII 항목). 부르는 쪽은 이 행을 그대로 로그에 남기지 않는다.
 * ============================================================================
 */

/** 화면이 목표 줄 하나를 그리는 데 필요한 값 전부. 전부 직렬화 가능한 값이다. */
export type WeeklyReportGoalRow = {
  id: string;
  /** "YYYY-MM-DD" — 그 주 월요일. date 컬럼이라 문자열로 온다. */
  weekStartDate: string;
  repairCaseId: string;
  /** 사람이 친 유일한 값. */
  goalText: string;
  displayOrder: number | null;
  /** 낙관적 잠금 토큰. 폼이 그대로 다시 실어 보낸다. */
  version: number;
  /** 정렬의 두 번째 기준(domain 의 sortWeeklyReportGoals). */
  createdAt: Date;
  /** 아래 다섯은 앞부분(buildGoalPrefix)의 재료다 — 저장된 값이 아니다. */
  customerName: string;
  intakeNumber: string;
  modelName: string;
  lotNumber: string | null;
  serialNumber: string | null;
  /** RFG/MB 로 접기 전의 원본 종류. */
  workflowType: WorkflowType;
  /** 어느 상자인가 — 수리 건의 종류가 정한다(파일 헤더). */
  kind: WeeklyReportKind;
};

/**
 * 한 주의 목표 줄 전부.
 *
 * 정렬은 `display_order asc, created_at asc` 다 — NULL 은 Postgres 기본대로
 * 뒤로 간다. domain 의 sortWeeklyReportGoals 가 같은 차례를 다시 만들 수 있게
 * 맞춰 둔 것이라, 화면이 목록을 다시 정렬해도 순서가 뒤바뀌지 않는다.
 *
 * weekStart 는 **월요일이어야 한다.** 월요일로 접는 일은 부르는 쪽이 이미
 * 끝냈다고 보고(validation/weekly-report-goal-input.ts, domain 의
 * mondayOfDateOnly) 여기서 다시 접지 않는다 — 두 곳에서 접으면 한쪽만
 * 고쳐지는 날이 온다.
 */
export async function listWeeklyReportGoals(weekStart: string): Promise<WeeklyReportGoalRow[]> {
  const rows = await db
    .select({
      id: weeklyReportGoals.id,
      weekStartDate: weeklyReportGoals.weekStartDate,
      repairCaseId: weeklyReportGoals.repairCaseId,
      goalText: weeklyReportGoals.goalText,
      displayOrder: weeklyReportGoals.displayOrder,
      version: weeklyReportGoals.version,
      createdAt: weeklyReportGoals.createdAt,
      customerName: customers.name,
      intakeNumber: repairCases.intakeNumber,
      modelName: products.modelName,
      lotNumber: products.lotNumber,
      serialNumber: products.serialNumber,
      workflowType: workflowTypeCodeColumn(),
    })
    .from(weeklyReportGoals)
    .innerJoin(repairCases, eq(weeklyReportGoals.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    // workflowTypeCodeColumn 은 템플릿·버전을 거쳐 종류 코드를 만든다 —
    // queries/weekly-report.ts 가 타는 것과 같은 길이라 두 조회의 종류가
    // 어긋날 수 없다.
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(eq(weeklyReportGoals.weekStartDate, weekStart))
    .orderBy(asc(weeklyReportGoals.displayOrder), asc(weeklyReportGoals.createdAt));

  return rows.map((row) => ({ ...row, kind: foldWeeklyReportKind(row.workflowType) }));
}

/**
 * 목표 줄이 하나라도 있는 주의 목록 — **최근 주가 먼저**다.
 *
 * 다음 단계의 화면이 주 고르기(그리고 '지난주 줄 복사')에 쓴다. 사람이 실제로
 * 찾는 것은 이번 주와 지난주이므로 내림차순이 기본이고, 오름차순이 필요하면
 * 부르는 쪽이 뒤집는다 — 두 벌의 조회를 두지 않는다.
 *
 * 줄 수를 함께 돌려주는 이유: 복사하기 전에 "몇 줄을 가져오는가"를 보여 줄 수
 * 있어야 한다. 그 숫자를 알려고 주마다 목록을 다시 읽으면 주 고르기 하나에
 * 조회가 열 번 넘게 나간다.
 */
export type WeeklyReportGoalWeek = {
  /** "YYYY-MM-DD" — 그 주 월요일. */
  weekStartDate: string;
  goalCount: number;
};

export async function listWeeklyReportGoalWeeks(): Promise<WeeklyReportGoalWeek[]> {
  const rows = await db
    .select({
      weekStartDate: weeklyReportGoals.weekStartDate,
      // count(*) 는 bigint 라 postgres 드라이버가 문자열로 읽는다 — 그대로
      // 넘기면 화면에서 "12" > "9" 같은 문자열 비교가 되므로 여기서 int 로
      // 자른다. 한 주의 목표 줄이 int 를 넘는 일은 없다.
      goalCount: sql<number>`count(*)::int`,
    })
    .from(weeklyReportGoals)
    .groupBy(weeklyReportGoals.weekStartDate)
    .orderBy(desc(weeklyReportGoals.weekStartDate));

  return rows;
}
