import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  repairCases,
  serviceReportCauses,
  serviceReportLines,
  serviceReports,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { formatServiceReportNumber } from "@/lib/domain/service-report-file-name";
import {
  toServiceReportColumns,
  type ServiceReportRecord,
  type ServiceReportSaveValues,
} from "@/lib/validation/service-report-save-input";

/**
 * ============================================================================
 * 검사·수리 보고서 — 만들기·고치기·지우기
 * ============================================================================
 * 본보기는 견적서(`mutations/quotes.ts` + `mutations/quote-trash.ts`)다. 고객사로
 * 나가는 문서를 담는 표라는 성질이 같아서 규칙도 같다.
 *
 * 이 계층은 **기계**다. 누가 고칠 수 있는지는 여기서 묻지 않는다 — 세션·역할·
 * 설정은 부르는 쪽(서버 액션·라우트)이 보고
 * (`auth/service-report-authorization.ts`), 이 파일은 자료의 규칙만 지킨다:
 * 접수 건이 있는가 · 지워졌는가 · 그 사이 누가 고쳤는가. 통합 시험이 인가를
 * 흉내 내지 않고도 자료 규칙을 검증할 수 있는 이유이기도 하다.
 *
 * ── 동시 수정은 version 으로 막는다(견적서와 같은 순서) ─────────────────
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다.
 *  2. 없거나 이미 지워진 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — 화면은 폼을 얼리고 다시 불러오게 한다.
 *  4. 값과 함께 version + 1, updated_at, updated_by 를 쓴다.
 *
 * 잠금을 먼저 잡는 이유: 읽고 나서 쓰기까지 사이에 남이 끼어들면 "둘 다
 * 성공했는데 한쪽 내용이 사라진" 상태가 만들어진다. 이것은 **법인 직인이 찍혀
 * 고객사로 나가는 문서**라, 확인내용이 조용히 덮이면 안 된다.
 *
 * ── 줄과 원인은 통째로 갈아 끼운다 ──────────────────────────────────────
 * 폼은 본문을 통째로 편집한다(`<textarea>` 한 칸이고, 원인은 체크박스 묶음이다).
 * 저장이 받는 것은 "이 보고서의 확인내용은 지금부터 이것이 전부"라는 말이고, 그
 * 말을 그대로 옮기는 방법이 전부 지우고 다시 넣는 것이다 — 견적서의 부품 줄·작업
 * 내역과 같은 판단이다. 하나씩 대조해 넣고 빼는 방식은 같은 결과를 훨씬 어렵게
 * 만들 뿐이고, 그 어려움은 "폼에서 지웠는데 남아 있는 줄" 같은 모양으로 드러난다.
 *
 * ── 🔴 감사에는 본문을 담지 않는다 ──────────────────────────────────────
 * 확인내용·조치·정리·비고, 그리고 **고객사명·발생 장소·「상황」도** 남기지
 * 않는다. 남기는 것은 종류·문서번호·발행일과 어느 접수 건이었나뿐이다.
 *
 * 판단은 내보내기 기록(`mutations/service-report-exports.ts` 의 '값은 담지
 * 않는다')과 같고, 견적서 휴지통이 품명·신고증상을 일부러 고르지 않는 것과도
 * 같은 자리다: 감사 로그는 **3년 보관** 대상이라, 거기에 사본을 한 벌 더 만들면
 * 지워야 할 자료가 두 곳이 된다. 확인내용·조치에는 고객사의 장비 사정이 그대로
 * 섞인다. 감사 로그가 답해야 하는 질문은 "무엇이 적혀 있었나"가 아니라 **"누가
 * 언제 우리 이름으로 어느 문서를 만들고 고쳤나"** 이고, 그 질문에는 이 네 값으로
 * 충분하다. 원본을 되짚을 곳은 이제 감사 로그가 아니라 **이 표 자신**이다.
 *
 * ── 영구 삭제는 없다 ────────────────────────────────────────────────────
 * `softDelete` 와 `restore` 만 있다. 견적서와 같은 이유이고, 여기에는 하나가 더
 * 있다: 보고서는 **접수 건이 영구 삭제될 때 함께 사라진다**
 * (`schema/service-reports.ts` 의 «판단 1» — CASCADE). 개인정보 정리는 그 길로
 * 이미 끝나므로, 보고서만 따로 영구 삭제하는 경로를 미리 만들어 둘 이유가 없다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 아래 도우미들이 같은 트랜잭션 안에서만 쓰이도록 못 박는다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ServiceReportMutationResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type ServiceReportMutationResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: ServiceReportMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 보고서를 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const NOT_FOUND_MESSAGE = "해당 보고서를 찾을 수 없습니다.";
const UNKNOWN_REPAIR_CASE_MESSAGE = "선택한 접수 건을 찾을 수 없습니다.";

/**
 * 감사에 남길 네 값. 🔴 **여기에 칸을 더하기 전에** 위 머리말의 '감사에는 본문을
 * 담지 않는다'를 읽을 것 — 고객사명도 이 목록에 없다.
 */
function auditSnapshot(columns: {
  kind: string;
  reportNumberPrefix: string | null;
  reportNumberMiddle: string;
  reportNumberTail: string;
  issuedOn: string;
}) {
  return {
    kind: columns.kind,
    reportNumber: formatServiceReportNumber({
      prefix: columns.reportNumberPrefix ?? undefined,
      middle: columns.reportNumberMiddle,
      tail: columns.reportNumberTail,
    }),
    issuedOn: columns.issuedOn,
  };
}

/**
 * 딸릴 접수 건이 실제로 있는가. 없으면 FK 위반(23503)이 나는데, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다.
 *
 * **`is_deleted` 를 보지 않는 것은 일부러다.** 견적서의 `checkReferences` 와 같은
 * 판단이다 — 보고서를 만든 뒤에 접수 건이 휴지통으로 갔을 수 있고, 그때 오타
 * 하나를 고치려는 저장이 그 연결 때문에 막히면 **화면에 보이는 값을 저장할 수
 * 없는 상태**가 된다. 지워진 건에서 새 보고서를 시작하지 못하게 막는 일은 부르는
 * 쪽이 한다(내려받기 라우트가 `resolveRepairCaseForServer` 로 이미 그렇게 한다).
 */
async function repairCaseExists(tx: Tx, repairCaseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);
  return Boolean(row);
}

/**
 * 이 보고서의 본문 줄을 **받은 목록 그대로** 만든다 — 전부 지우고 다시 넣는다.
 *
 * ⚠️ **반드시 service_report_id 로 좁힌다.** 조건 없는 delete 는 이 표를 통째로
 * 비운다 — 한 장의 본문을 고치는 일이 모든 보고서의 본문을 지우는 일이 되어서는
 * 안 된다.
 *
 * ⚠️ **반드시 부르는 쪽의 트랜잭션 안에서만** 부른다(tx 를 받는 이유). 부모
 * 저장이 CONFLICT 로 끝나는 길에서는 아예 불리지 않아야 한다.
 *
 * 🔴 빈 줄도 그대로 넣는다 — 걸러 내는 것은 이 함수도, 사전도 하지 않는다
 * (`validation/service-report-save-input.ts` 의 `toLineRows`).
 */
async function replaceLines(tx: Tx, serviceReportId: string, record: ServiceReportRecord) {
  await tx.delete(serviceReportLines).where(eq(serviceReportLines.serviceReportId, serviceReportId));
  if (record.lines.length === 0) return;

  await tx.insert(serviceReportLines).values(
    record.lines.map((line) => ({
      serviceReportId,
      section: line.section,
      lineNo: line.lineNo,
      text: line.text,
    }))
  );
}

/** 고른 원인도 같은 방식으로 갈아 끼운다 — 체크를 푼 원인이 남아 있으면 안 된다. */
async function replaceCauses(tx: Tx, serviceReportId: string, record: ServiceReportRecord) {
  await tx
    .delete(serviceReportCauses)
    .where(eq(serviceReportCauses.serviceReportId, serviceReportId));
  if (record.causes.length === 0) return;

  await tx
    .insert(serviceReportCauses)
    .values(record.causes.map((cause) => ({ serviceReportId, cause })));
}

/**
 * 새 보고서 한 장. version 은 스키마 기본값 1로 시작한다.
 *
 * 한 장 + 줄들 + 원인들이 **한 트랜잭션**이다 — 줄을 넣다 실패하면 방금 만든 장도
 * 함께 없던 일이 된다. 본문만 빠진 보고서가 남는 편이 훨씬 나쁘다: 목록에는
 * 정상으로 보이는데 열어 보면 확인내용이 없는 장이 된다.
 */
export async function createServiceReport(params: {
  repairCaseId: string;
  values: ServiceReportSaveValues;
  actorUserId: string;
}): Promise<ServiceReportMutationResult> {
  const converted = toServiceReportColumns(params.values);
  if (!converted.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: converted.fieldErrors,
      message: "보고서 내용을 확인해 주세요.",
    };
  }
  const record = converted.data;

  return db.transaction(async (tx): Promise<ServiceReportMutationResult> => {
    if (!(await repairCaseExists(tx, params.repairCaseId))) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: UNKNOWN_REPAIR_CASE_MESSAGE },
        message: UNKNOWN_REPAIR_CASE_MESSAGE,
      };
    }

    const [inserted] = await tx
      .insert(serviceReports)
      .values({
        ...record.columns,
        repairCaseId: params.repairCaseId,
        createdBy: params.actorUserId,
        // 만든 사람이 곧 마지막으로 고친 사람이다. 비워 두면 "누가 마지막으로
        // 손댔는가"가 첫 수정 전까지 빈칸으로 남는다.
        updatedBy: params.actorUserId,
      })
      .returning({ id: serviceReports.id, version: serviceReports.version });

    await replaceLines(tx, inserted.id, record);
    await replaceCauses(tx, inserted.id, record);

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: "service_reports",
      targetRecordId: inserted.id,
      // 만들기라 이전 값이 없다.
      newValue: { repairCaseId: params.repairCaseId, ...auditSnapshot(record.columns) },
    });

    return { ok: true, id: inserted.id, version: inserted.version };
  });
}

/** 있는 보고서 한 장. 위 '동시 수정은 version 으로 막는다' 순서를 그대로 따른다. */
export async function updateServiceReport(params: {
  id: string;
  expectedVersion: number;
  values: ServiceReportSaveValues;
  actorUserId: string;
}): Promise<ServiceReportMutationResult> {
  const converted = toServiceReportColumns(params.values);
  if (!converted.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: converted.fieldErrors,
      message: "보고서 내용을 확인해 주세요.",
    };
  }
  const record = converted.data;

  return db.transaction(async (tx): Promise<ServiceReportMutationResult> => {
    const [existing] = await tx
      .select({
        id: serviceReports.id,
        version: serviceReports.version,
        isDeleted: serviceReports.isDeleted,
        repairCaseId: serviceReports.repairCaseId,
        kind: serviceReports.kind,
        reportNumberPrefix: serviceReports.reportNumberPrefix,
        reportNumberMiddle: serviceReports.reportNumberMiddle,
        reportNumberTail: serviceReports.reportNumberTail,
        issuedOn: serviceReports.issuedOn,
      })
      .from(serviceReports)
      .where(eq(serviceReports.id, params.id))
      .limit(1)
      .for("update");

    // 지워진 장은 목록에 없다. 화면에 없는 것을 고치려는 요청에는 "찾을 수 없다"가
    // 정확한 답이다 — 수정이 되살리기를 겸하면 지운 기록이 조용히 되살아난다.
    if (!existing || existing.isDeleted) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }
    if (existing.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 🔴 **접수 건은 옮기지 않는다.** 보고서는 언제나 처음 붙은 건에 딸린 문서이고
    //    (`schema/service-reports.ts` 의 «판단 1»), 옮길 수 있게 하면 "이 건으로
    //    나간 보고서" 목록이 조용히 달라진다. 그래서 이 함수는 repair_case_id 를
    //    받지도, 쓰지도 않는다.
    const [updated] = await tx
      .update(serviceReports)
      .set({
        ...record.columns,
        version: sql`${serviceReports.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      .where(eq(serviceReports.id, params.id))
      .returning({ id: serviceReports.id, version: serviceReports.version });

    // version 대조를 통과한 뒤에만 줄을 건드린다 — CONFLICT 로 끝난 저장은 본문을
    // 한 줄도 지우지 않는다(같은 트랜잭션이므로 위에서 이미 반환됐다).
    await replaceLines(tx, params.id, record);
    await replaceCauses(tx, params.id, record);

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "service_reports",
      targetRecordId: params.id,
      previousValue: auditSnapshot(existing),
      newValue: { repairCaseId: existing.repairCaseId, ...auditSnapshot(record.columns) },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 휴지통으로 보낸다. 목록에서 사라지고, id 로도 열 수 없다
 * (`queries/service-reports.ts` 가 둘 다 `is_deleted` 로 좁힌다).
 *
 * 🔴 줄과 원인은 **그대로 남는다.** 자식 표가 ON DELETE CASCADE 지만 소프트 삭제는
 * 행을 실제로 지우지 않으므로 CASCADE 가 돌지 않는다 — 되살리면 본문도 그대로
 * 돌아온다(견적서 휴지통의 같은 항목). 다만 원인 집계는 부모의 `is_deleted` 를
 * 조인해서 걸러야 한다(`schema/service-reports.ts`).
 */
export async function softDeleteServiceReport(params: {
  serviceReportId: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string | null;
}): Promise<ServiceReportMutationResult> {
  return db.transaction(async (tx): Promise<ServiceReportMutationResult> => {
    const [current] = await tx
      .select({
        id: serviceReports.id,
        version: serviceReports.version,
        kind: serviceReports.kind,
        reportNumberPrefix: serviceReports.reportNumberPrefix,
        reportNumberMiddle: serviceReports.reportNumberMiddle,
        reportNumberTail: serviceReports.reportNumberTail,
        issuedOn: serviceReports.issuedOn,
        // 고객사명·발생 장소·본문은 일부러 고르지 않는다 — 위 머리말의 '감사에는
        // 본문을 담지 않는다'.
      })
      .from(serviceReports)
      .where(and(eq(serviceReports.id, params.serviceReportId), eq(serviceReports.isDeleted, false)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const [updated] = await tx
      .update(serviceReports)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: params.actorUserId,
        deleteReason: params.reason,
        version: sql`${serviceReports.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      .where(eq(serviceReports.id, params.serviceReportId))
      .returning({ id: serviceReports.id, version: serviceReports.version });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "SOFT_DELETE",
      targetEntity: "service_reports",
      targetRecordId: current.id,
      previousValue: { ...auditSnapshot(current), isDeleted: false },
      newValue: { isDeleted: true, deleteReason: params.reason },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 휴지통에서 되살린다.
 *
 * 견적서와 달리 **되살리기를 막는 겹침이 없다** — 문서번호에 유일성을 걸지
 * 않았기 때문이다(`schema/service-reports.ts` 의 «판단 4»: 번호 가운데 조각이
 * 무엇을 뜻하는지 아직 모른다). 그래서 version 만 대조하면 된다.
 */
export async function restoreServiceReport(params: {
  serviceReportId: string;
  expectedVersion: number;
  actorUserId: string;
}): Promise<ServiceReportMutationResult> {
  return db.transaction(async (tx): Promise<ServiceReportMutationResult> => {
    const [current] = await tx
      .select({
        id: serviceReports.id,
        version: serviceReports.version,
        kind: serviceReports.kind,
        reportNumberPrefix: serviceReports.reportNumberPrefix,
        reportNumberMiddle: serviceReports.reportNumberMiddle,
        reportNumberTail: serviceReports.reportNumberTail,
        issuedOn: serviceReports.issuedOn,
      })
      .from(serviceReports)
      .where(and(eq(serviceReports.id, params.serviceReportId), eq(serviceReports.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const [updated] = await tx
      .update(serviceReports)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        version: sql`${serviceReports.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      .where(eq(serviceReports.id, params.serviceReportId))
      .returning({ id: serviceReports.id, version: serviceReports.version });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "RESTORE",
      targetEntity: "service_reports",
      targetRecordId: current.id,
      previousValue: { isDeleted: true },
      newValue: { ...auditSnapshot(current), isDeleted: false },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}
