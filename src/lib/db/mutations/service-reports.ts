import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
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
 * ── 🔴 감사에는 본문을 담지 않는다 — **영구 삭제 하나만 예외다** ─────────
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
 * 🔴 **그래서 `permanentlyDeleteServiceReport` 만 반대로 간다**(2026-10-28
 * 사용자 결정). 위 문단이 서 있는 다리가 «되짚을 곳은 이 표 자신»인데, 그
 * 함수는 바로 그 행을 없앤다 — 다리가 끊기므로 규칙도 함께 서지 못한다. 그래서
 * 그 한 함수만 지우기 **직전의 행·본문 줄·고른 원인을 한 벌 떠서** 감사에
 * 남긴다. ⚠️ 그 사본도 3년을 산다는 사실은 그대로이고, 위 문단이 걱정하던 바로
 * 그 일이다 — **범위를 넓히지 마라.** CREATE·UPDATE·SOFT_DELETE·RESTORE 는
 * 지금도 네 값뿐이고, 그래야 한다.
 *
 * 🔴 **알고 받아들인 구멍 하나 — 따로 볼 일이다**(2026-10-28 사용자 결정).
 * 접수 건을 영구 삭제하면 그 건의 자료는 CASCADE 로 사라지지만 **이 PURGE 로그의
 * 사본은 따라 지워지지 않는다** — `audit_logs.target_record_id` 는 어느 표든
 * 가리킬 수 있는 칸이라 외래키가 없고, 그래서 접수 건 쪽 삭제가 닿지 못한다.
 * 보고서 본문에는 고객사명과 장비 사정이 섞여 있으므로 **개인정보 정리가 거기서
 * 한 칸 비는 것이 맞다.**
 * 🔵 그래도 남기기로 한 까닭: 되돌릴 수 없게 지운 **법인 직인 문서**가 무엇이었는지는
 * 남아야 하고, 이 조작은 개발자만 쓰는 드문 길이며, 감사 로그 자체가 보호되는 자리다.
 * 🔴 **메울 길은 정해져 있다** — 접수 건 영구 삭제가 그 건의 보고서 PURGE 로그도
 * 함께 지우게 하는 것이다(`mutations/repair-cases.ts` 의 영구 삭제 자리).
 * 이번 조각에 넣지 않은 것은 **범위가 커서**이지 안 해도 되기 때문이 아니다.
 *
 * ── 영구 삭제 — **2026-10-28 에 생겼다** ────────────────────────────────
 * 🔴 **먼저 왜 없었는지부터.** 원래 이 파일에는 `softDelete` 와 `restore` 만
 * 있었고 까닭은 이랬다: 보고서는 **접수 건이 영구 삭제될 때 함께 사라지므로**
 * (`schema/service-reports.ts` 의 «판단 1» — CASCADE) 개인정보 정리는 그 길로
 * 이미 끝나고, 따라서 보고서만 따로 영구 삭제하는 경로를 **미리 만들어 둘 이유가
 * 없다**는 것이었다.
 *
 * 🔴 그 문장은 「해서는 안 된다」가 아니라 **「아직 쓸 데가 없다」**였다. 그래서
 * 2026-10-28 에 사용자가 필요하다고 정했을 때 뒤집을 수 있었다 — 잘못 만든 문서
 * 한 장을 접수 건은 그대로 둔 채 치우는 자리다. 🔴 **위 CASCADE 는 손대지 않았고
 * 그대로 산다.** 이번에 생긴 것은 **보고서 한 장만 따로** 지우는 길이다.
 *
 * 🔴 **본보기는 여기서도 견적서다**(`mutations/quote-trash.ts` 의
 * `permanentlyDeleteQuote`). 휴지통에 든 장만 받는 것도, 사유를 필수로 받는
 * 것도, PURGE 감사 한 줄로 끝내는 것도 그쪽을 그대로 옮겼다. **다른 것은 딱
 * 하나** — 그쪽은 스냅숏에 자유 입력 칸을 **일부러 빼지만**(그 파일의 '감사
 * 로그에 자유 입력 칸은 넣지 않는다'), 여기는 담는다. 까닭은 바로 위 문단이다:
 * 견적서는 지워도 내자 정리 줄에 번호·금액이 남지만, 보고서에는 그런 바깥
 * 사본이 하나도 없다.
 *
 * 🔴 **문턱이 지우기(MANAGE)보다 높다.** 되돌릴 수 없는 데다 법인 직인이 찍혀
 * 고객사로 나간 문서라 **개발자 모드 관문**까지 넘어야 한다
 * (`server/actions/service-reports.ts` 의 `resolveAuthorizedActor`). 이 계층은
 * 기계라 그 판정을 하지 않는다 — 위 '이 계층은 기계다' 그대로다.
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

/**
 * 영구 삭제의 결과. **version 이 없다** — 행이 사라진 뒤에는 「다음 판」이라는
 * 것이 없고, 있는 척하면 화면이 그 숫자를 들고 다음 요청을 보낸다. 견적서의
 * `QuotePurgeResult` 와 같은 모양, 같은 까닭이다(접수 건의
 * `PermanentlyDeleteRepairCaseResult` 도 그렇다).
 */
export type ServiceReportPurgeResult =
  | { ok: true; id: string }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 보고서를 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const NOT_FOUND_MESSAGE = "해당 보고서를 찾을 수 없습니다.";
/**
 * 영구 삭제만 쓰는 문장. 「없는 id · 살아 있는 장 · 이미 지워진 장」 셋을 **한
 * 답으로 묶는다** — 셋을 갈라 말하면 이 창구가 "그 id 가 있긴 한가"를 알려 주는
 * 조회창이 된다(견적서의 `NOT_IN_TRASH_MESSAGE` 와 같은 판단).
 */
const NOT_IN_TRASH_MESSAGE =
  "휴지통에서 해당 보고서를 찾을 수 없습니다. 이미 되살렸거나 지워졌을 수 있습니다.";
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
  return db.transaction((tx) => createServiceReportInTx(tx, params));
}

/**
 * 위 함수의 **알맹이** — 이미 열린 트랜잭션 안에서 도는 모양이다 (2026-09-21).
 *
 * 🔴 갈라 둔 까닭: 교산 연락서 이식(`server/services/kyosan-report-import.ts`)은
 * 보고서 한 장 · 사용 부품 · 첨부 · 이식 흔적을 **한 트랜잭션**에 넣어야 한다.
 * `db.transaction` 은 풀에서 새 연결을 잡으므로, 위 함수를 그대로 부르면 바깥
 * 트랜잭션과 **다른 트랜잭션**이 된다 — 바깥이 되돌아가도 보고서만 남는다.
 * 그것이 「절반만 들어간 보고서」이고, 이 조각이 가장 피해야 하는 결과다.
 *
 * 🔴 **동작은 한 글자도 달라지지 않았다.** 위 함수는 이 함수를 트랜잭션으로 감싼
 * 것이 전부이고, 기존 통합 시험이 그 사실을 그대로 검증한다.
 */
export async function createServiceReportInTx(
  tx: Tx,
  params: {
    repairCaseId: string;
    values: ServiceReportSaveValues;
    actorUserId: string;
  }
): Promise<ServiceReportMutationResult> {
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

/**
 * 🔴 **휴지통의 보고서 한 장을 되돌릴 수 없게 지운다** (2026-10-28).
 *
 * 왜 이 함수가 생겼는지는 머리말의 '영구 삭제 — 2026-10-28 에 생겼다' 에 있다.
 * 여기에는 그 결정이 코드에 어떻게 박혔는지만 적는다.
 *
 * ── 🔴 휴지통을 거친 장만 받는다 ────────────────────────────────────────
 * `is_deleted = true` 로 좁힌다. **살아 있는 장을 바로 지우는 길은 없다** —
 * 한 번 휴지통에 넣고 다시 눌러야 한다는 것이 이 조작의 유일한 안전장치이고,
 * 그 길을 열어 두면 안전장치를 건너뛰는 문이 된다(견적서의 '활성 견적서를
 * 바로 지우는 길은 없다'). 살아 있는 장을 넘기면 NOT_FOUND 다.
 *
 * ── 🔴 줄·원인은 DB 가 함께 지운다 ──────────────────────────────────────
 * `service_reports` 를 가리키는 표는 **둘뿐이고 둘 다 ON DELETE CASCADE** 다
 * (`service_report_lines` · `service_report_causes` — 2026-10-28 실측:
 * `drizzle/meta/0120_snapshot.json` 의 foreignKeys 에서 `tableTo` 가 이 표인
 * 것이 그 둘뿐이다). 그래서 **행 하나만 지우면 된다.** 자식을 여기서 먼저
 * 지우지 않는 것은 일부러다 — 스키마가 이미 약속한 일을 코드가 한 번 더 하면
 * 둘 중 하나가 바뀐 날 어느 쪽이 실제로 지웠는지 말할 수 없게 된다(견적서
 * 휴지통의 '딸린 것' 과 같은 판단).
 *
 * ── 🔴 지우기 **전에** 읽고, 같은 트랜잭션에서 남긴다 ───────────────────
 * 본문 줄과 고른 원인은 행이 사라지는 순간 함께 없어지므로 **DELETE 앞에서**
 * 읽어야 한다. 감사 한 줄도 같은 트랜잭션 안이다 — 지우고 나서 따로 적으면
 * 그 사이에 끊겼을 때 **기록만 없는** 상태가 남는다(`insertAuditLog` 가 tx 를
 * 받는 까닭 그대로).
 */
export async function permanentlyDeleteServiceReport(params: {
  serviceReportId: string;
  expectedVersion: number;
  actorUserId: string;
  /** 🔴 **필수다.** 되돌릴 수 없는 조작에는 이유가 남아야 한다 — 빈 사유를 막는
   *  것은 부르는 쪽이고(`readServiceReportPurgeReason`), 여기는 받은 것을 그대로
   *  감사에 싣는다. */
  reason: string;
}): Promise<ServiceReportPurgeResult> {
  return db.transaction(async (tx): Promise<ServiceReportPurgeResult> => {
    /**
     * 🔴 칸을 고르지 않고 **행을 통째로** 읽는다. 다른 함수들이 네 값만 고르는
     * 것과 정반대인데, 그것이 이 함수의 목적이기 때문이다 — 머리말의 '영구 삭제
     * 하나만 예외다'. 칸을 나열하면 나중에 칸이 하나 늘었을 때 **그 칸만 조용히
     * 스냅숏에서 빠지고**, 그 사실은 행이 이미 없어진 뒤에야 드러난다.
     */
    const [current] = await tx
      .select()
      .from(serviceReports)
      .where(
        and(eq(serviceReports.id, params.serviceReportId), eq(serviceReports.isDeleted, true))
      )
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 본문과 원인. 화면·조회가 쓰는 것과 같은 순서로 읽는다 — 감사에 담긴 글을
    // 나중에 사람이 읽을 때 문서에서 보던 차례 그대로여야 한다.
    const lines = await tx
      .select({
        section: serviceReportLines.section,
        lineNo: serviceReportLines.lineNo,
        text: serviceReportLines.text,
      })
      .from(serviceReportLines)
      .where(eq(serviceReportLines.serviceReportId, params.serviceReportId))
      .orderBy(asc(serviceReportLines.section), asc(serviceReportLines.lineNo));

    const causeRows = await tx
      .select({ cause: serviceReportCauses.cause })
      .from(serviceReportCauses)
      .where(eq(serviceReportCauses.serviceReportId, params.serviceReportId))
      .orderBy(asc(serviceReportCauses.cause));

    const deleted = await tx
      .delete(serviceReports)
      // 잠금을 쥐고 있어 실제로는 늘 한 행이지만, 0행 쓰기를 마지막 안전망으로
      // 두는 이 저장소의 관례를 그대로 따른다(견적서 영구 삭제의 같은 자리).
      .where(
        and(
          eq(serviceReports.id, params.serviceReportId),
          eq(serviceReports.isDeleted, true),
          eq(serviceReports.version, params.expectedVersion)
        )
      )
      .returning({ id: serviceReports.id });

    if (deleted.length === 0) {
      return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: "service_reports",
      targetRecordId: params.serviceReportId,
      previousValue: {
        /**
         * 앞의 두 묶음은 **다른 기록과 같은 말**이다 — "누가 언제 우리 이름으로
         * 어느 문서를 다뤘나". 뒤의 셋이 이 함수에만 있는 「무엇이 적혀 있었나」다.
         */
        repairCaseId: current.repairCaseId,
        ...auditSnapshot(current),
        /** 왜 지웠는가. 표의 `delete_reason`(휴지통에 넣을 때 적은 것)과 **다른
         *  값이다** — 그 값은 `columns` 안에 그대로 들어 있다. */
        purgeReason: params.reason,
        /** 행 전부. 위 select 가 칸을 고르지 않는 까닭 참조. */
        columns: serializeServiceReportSnapshot(current),
        lines,
        causes: causeRows.map((row) => row.cause),
      },
      newValue: null,
    });

    return { ok: true, id: params.serviceReportId };
  });
}

/**
 * 스냅숏의 시각 칸을 ISO 글자로 바꾼다 — 다른 휴지통의 PURGE 로그와 **같은
 * 모양**이다(견적서의 `serializeSnapshot`).
 *
 * JSON 으로 실어 보내면 `Date` 는 어차피 ISO 글자가 되지만, 여기서 한 번
 * 드러내 두면 **타입이 글자라고 말해 준다** — 나중에 이 로그를 읽는 코드가
 * `new Date(row.createdAt)` 로 풀어야 한다는 사실이 선언에 남는다.
 */
function serializeServiceReportSnapshot<
  T extends { createdAt: Date; updatedAt: Date; deletedAt: Date | null },
>(row: T) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
