import "server-only";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../client";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import {
  customers,
  products,
  repairCases,
  repairCaseWorkRecords,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { resolveRepairStatusFromStep } from "../mappers/repair-status";
import type { RepairStatus, WorkflowType, WorkRecordKind } from "@/lib/domain/types";
import { myWorkRecordWindowStart } from "@/lib/domain/my-work-record-months";

/**
 * 「내 작업기록」 — 로그인한 사람이 **본인이 적은** 작업기록을 달별로 보는 화면의
 * 조회. 「내 담당 제품」(repair-cases-mine.ts)과 한 화면에 탭으로 붙지만 모으는
 * 것이 전혀 다르다:
 *
 *   · 내 담당 제품 = **지금 나에게 배정된** 미출하 건
 *   · 내 작업기록 = **내가 적은** 기록 — 배정이 그 뒤 남에게 넘어갔어도, 출하가
 *     끝났어도, 건이 지워졌어도 내가 적은 사실은 내 것이다(설계 결정).
 *
 * 그래서 담당 여부(assigned_engineer_id)로도, 출하 완료 여부로도, 건의 삭제
 * 여부로도 거르지 않는다. 거르는 것은 셋뿐이다 — 내가 쓴 것인가(author_user_id),
 * 무효 처리되지 않았는가(invalidated_at IS NULL), 12개월 창 안인가.
 *
 * 🔴 **보안: 받는 인자는 `actorId` 하나뿐이다.** 부르는 쪽
 * (repair-cases/mine/work-records/page.tsx)이 세션에서 서버 측에서 풀어 넘긴다.
 * `engineerId` 처럼 「남의 것을 보게 하는 인자」를 **절대 만들지 마라** — 그런
 * 인자가 하나 생기는 순간 주소를 바꿔 치는 것만으로 남의 작업기록을 읽을 수 있게
 * 된다. 이 규율은 repair-cases-mine.ts 머리말과 같다. 다른 사람의 기록을 함께
 * 보는 감독용 화면이 필요해지면 **별도의 기능**으로, 제 권한 심사를 달고 만든다.
 */

export type MyWorkRecordRow = {
  id: string;
  /** ISO 8601(UTC, `Z`). 달 묶기와 표시는 전부 한국시간으로 domain/my-work-record-months.ts 가 한다. */
  createdAt: string;
  recordKind: WorkRecordKind;
  memo: string;
  /**
   * 🔴 null 이면 **건이 영구 삭제된 것**이다(repair_case_work_records.repair_case_id
   * 는 ON DELETE SET NULL). 기록 자체는 살아남으므로 메모와 시각은 그대로 보여
   * 주되, 가리킬 건이 없으므로 아래 건 정보는 전부 null 이고 링크도 걸지 않는다.
   */
  repairCaseId: string | null;
  intakeNumber: string | null;
  customerName: string | null;
  /** 🔴 products.model_name — 모델 마스터(product_models)가 아니라 **그 건에 실제로 들어온 제품**의 모델명이다(repair-cases-mine.ts 와 같은 조인). */
  modelName: string | null;
  status: RepairStatus | null;
  /** 소프트 삭제(repair_cases.is_deleted)된 건. 기록은 그대로 보이되 화면이 그 사실을 드러내고 링크를 걸지 않는다. */
  isCaseDeleted: boolean;
};

type JoinRow = {
  id: string;
  createdAt: Date | string;
  recordKind: WorkRecordKind;
  memo: string;
  repairCaseId: string | null;
  intakeNumber: string | null;
  customerName: string | null;
  modelName: string | null;
  isCaseDeleted: boolean | null;
  /** 건이 없으면(영구 삭제) 전부 null 이라 아래 셋 다 nullable 이다. */
  workflowTypeCode: WorkflowType | null;
  currentWorkflowStepKey: string | null;
  currentWorkflowStepRepairStatus: RepairStatus | null;
};

function toMyWorkRecordRow(row: JoinRow): MyWorkRecordRow {
  return {
    id: row.id,
    createdAt: new Date(row.createdAt).toISOString(),
    recordKind: row.recordKind,
    memo: row.memo,
    repairCaseId: row.repairCaseId,
    intakeNumber: row.intakeNumber,
    customerName: row.customerName,
    modelName: row.modelName,
    // 건이 붙어 있을 때만 상태를 푼다. 상태가 비어 있으면 기본값을 지어내지
    // 않고 던지는 것이 이 저장소의 규칙이다(mappers/repair-status.ts) — 조용히
    // 다른 상태인 척하면 잘못된 데이터가 아무에게도 드러나지 않는다.
    status:
      row.repairCaseId && row.workflowTypeCode && row.currentWorkflowStepKey
        ? resolveRepairStatusFromStep({
            repairCaseId: row.repairCaseId,
            workflowType: row.workflowTypeCode,
            currentStepKey: row.currentWorkflowStepKey,
            stepRepairStatus: row.currentWorkflowStepRepairStatus,
          })
        : null,
    isCaseDeleted: row.isCaseDeleted === true,
  };
}

/**
 * `actorId` 가 적은 작업기록 전부, **이번 달을 포함해 최근 12개월**, 새것부터.
 *
 * 창의 경계는 한국시간 기준이다(myWorkRecordWindowStart) — UTC 자정으로 자르면
 * 창 첫날 아침(한국시간 00:00~09:00)에 적은 것이 빠진다.
 *
 * 조인은 전부 LEFT JOIN 이다. 건이 영구 삭제된 기록(repair_case_id IS NULL)을
 * **떨어뜨리지 않기 위해서**다 — INNER JOIN 으로 적으면 그런 줄이 아무 소리 없이
 * 사라져, 정작 그 기록을 적은 사람에게만 안 보이게 된다.
 */
export async function listMyWorkRecords(actorId: string, now: Date = new Date()): Promise<MyWorkRecordRow[]> {
  const rows = await db
    .select({
      id: repairCaseWorkRecords.id,
      createdAt: repairCaseWorkRecords.createdAt,
      recordKind: repairCaseWorkRecords.recordKind,
      memo: repairCaseWorkRecords.memo,
      repairCaseId: repairCaseWorkRecords.repairCaseId,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      modelName: products.modelName,
      isCaseDeleted: repairCases.isDeleted,
      workflowTypeCode: workflowTypeCodeColumn(),
      currentWorkflowStepKey: workflowSteps.key,
      currentWorkflowStepRepairStatus: workflowSteps.repairStatus,
    })
    .from(repairCaseWorkRecords)
    .leftJoin(repairCases, eq(repairCaseWorkRecords.repairCaseId, repairCases.id))
    .leftJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(products, eq(repairCases.productId, products.id))
    .leftJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .leftJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .leftJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(
      and(
        eq(repairCaseWorkRecords.authorUserId, actorId),
        isNull(repairCaseWorkRecords.invalidatedAt),
        gte(repairCaseWorkRecords.createdAt, myWorkRecordWindowStart(now))
      )
    )
    .orderBy(desc(repairCaseWorkRecords.createdAt), desc(repairCaseWorkRecords.id));

  return rows.map((row) => toMyWorkRecordRow(row as JoinRow));
}
