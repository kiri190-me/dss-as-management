import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { repairCases, weeklyReportDeliveries } from "../schema";
import type { WeeklyReportDeliveryFields } from "@/lib/validation/weekly-report-delivery-input";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 — 추가·수정·삭제
 * ============================================================================
 * 이 계층은 **기계**다. 누가 적을 수 있는지는 여기서 묻지 않는다 —
 * 세션·역할·설정은 서버 액션(server/actions/weekly-report-deliveries.ts)이 보고,
 * 이 파일은 자료의 규칙만 지킨다(존재하는가 · 그 사이 누가 고쳤는가).
 * mutations/weekly-report-goals.ts 와 같은 구분이고, 통합 테스트가 인가를 흉내
 * 내지 않고도 자료 규칙을 그대로 검증할 수 있는 이유이기도 하다.
 *
 * ── 동시 수정은 version 으로 막는다 ─────────────────────────────────────
 * 본보기는 mutations/weekly-report-goals.ts 다. 순서가 곧 규칙이다:
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다.
 *  2. 없는 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — **한 글자도 바꾸지 않고** 돌아간다.
 *     화면은 폼을 얼리고 다시 불러오게 한다.
 *  4. 값과 함께 version + 1, updated_at, updated_by 를 쓴다.
 *
 * 잠금을 먼저 잡는 이유: 읽고 나서 쓰기까지 사이에 남이 끼어들면 "둘 다
 * 성공했는데 한쪽 내용이 사라진" 상태가 만들어진다. 주간보고는 여럿이 함께
 * 보는 화면이라 같은 줄의 비고를 두 사람이 고치는 일이 실제로 일어난다.
 *
 * ⚠️ **수정·삭제는 반드시 id 로 좁힌다.** 주(week_start_date)나 수리 건으로
 * 좁힌 update/delete 는 남의 줄까지 함께 건드린다 — 한 줄을 지우는 일이 그 주
 * 표를 통째로 비우는 일이 되어서는 안 된다.
 *
 * ── 삭제도 version 을 본다 ──────────────────────────────────────────────
 * 휴지통도 복원도 없다(승인된 결정, schema 헤더의 '휴지통은 두지 않는다').
 * 그래서 이 파일에는 소프트 삭제 경로가 아예 없다. 되돌릴 수 없는 조작이라
 * **삭제에서도 version 을 대조한다** — 낡은 화면에서 누른 '삭제'는 그 사이 남이
 * 적어 둔 비고를 함께 지우는 일이 되고, 지우는 사람이 보고 있던 줄과 실제로
 * 지워지는 줄이 다르면 그것이 곧 자료 손실이다.
 *
 * ── 한 주에 같은 건이 두 줄인 것을 막지 않는다 ──────────────────────────
 * DB 에도 여기에도 (week, repair_case) 유일 제약이 없다. 실제 표에 같은 장비가
 * 두 줄로 오르는 경우가 있고(분할 납품처럼 비고가 서로 다른 줄), 막아 두면 그
 * 사람은 한 칸에 두 문장을 몰아 적게 된다. 실수로 두 번 고른 줄은 지우면 된다 —
 * 되살릴 수 없는 자료가 아니다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * note 는 사람이 자유롭게 적는 값이라 담당자 이름이 섞일 수 있다(schema 헤더).
 * 이 파일은 실패해도 그 값을 오류 메시지에 담지 않는다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 아래 도우미가 같은 트랜잭션 안에서 읽도록 못 박는다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type WeeklyReportDeliveryMutationResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type WeeklyReportDeliveryMutationResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: WeeklyReportDeliveryMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 줄을 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";

const NOT_FOUND_MESSAGE = "해당 납입 예정 건을 찾을 수 없습니다.";

const UNKNOWN_REFERENCE_MESSAGE = "입력값을 확인해 주세요.";

/**
 * 고르려는 수리 건이 실제로 있는가. 없으면 FK 위반(23503)이 나는데, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다 — 어느 칸이 문제인지 말해 주는 편이 낫다.
 *
 * **is_deleted 를 보지 않는 것은 일부러다.** 휴지통에 있는 건의 줄도 조회에
 * 그대로 나오므로(queries/weekly-report-deliveries.ts 의 '휴지통에 있는 수리
 * 건도'), 여기서 막으면 화면에 보이는 줄을 저장할 수 없는 상태가 만들어진다.
 */
async function repairCaseExists(tx: Tx, repairCaseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);
  return Boolean(row);
}

/** 저장이 실제로 쓰는 칸 묶음. 추가와 수정이 **같은 표**를 쓰게 한 곳에 둔다. */
function toColumnValues(fields: WeeklyReportDeliveryFields) {
  return {
    weekStartDate: fields.weekStartDate,
    repairCaseId: fields.repairCaseId,
    note: fields.note,
    displayOrder: fields.displayOrder,
  };
}

/** 새 납입 예정 줄 하나. version 은 스키마 기본값 1로 시작한다. */
export async function createWeeklyReportDelivery(params: {
  fields: WeeklyReportDeliveryFields;
  actorUserId: string;
}): Promise<WeeklyReportDeliveryMutationResult> {
  return db.transaction(async (tx): Promise<WeeklyReportDeliveryMutationResult> => {
    if (!(await repairCaseExists(tx, params.fields.repairCaseId))) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
        message: UNKNOWN_REFERENCE_MESSAGE,
      };
    }

    const [inserted] = await tx
      .insert(weeklyReportDeliveries)
      .values({
        ...toColumnValues(params.fields),
        createdBy: params.actorUserId,
        // 만든 사람이 곧 마지막으로 고친 사람이다. 여기를 비워 두면 "누가
        // 마지막으로 손댔는가"가 첫 수정 전까지 빈칸으로 남는다.
        updatedBy: params.actorUserId,
      })
      .returning({ id: weeklyReportDeliveries.id, version: weeklyReportDeliveries.version });

    return { ok: true, id: inserted.id, version: inserted.version };
  });
}

/**
 * 줄 하나를 고친다 — 실제로 고쳐지는 것은 대개 **비고**다.
 *
 * 그런데도 주(week_start_date)와 수리 건·차례까지 함께 받는 이유는 금주 목표와
 * 같다: 사람이 "이 줄은 다음 주 것이었다"거나 "다른 건에 잘못 달았다"를 고칠
 * 길이 있어야 한다. 비고만 고치는 경로를 따로 두지 않는 것도 같은 판단이다 —
 * 나눠 두면 잠금·version 대조·updated_by 기록이 여러 벌이 되고, 그중 하나만
 * 고쳐지는 날이 온다. 비고만 바꾸고 싶은 화면은 나머지 칸을 읽은 그대로 다시
 * 실어 보내면 된다.
 */
export async function updateWeeklyReportDelivery(params: {
  id: string;
  expectedVersion: number;
  fields: WeeklyReportDeliveryFields;
  actorUserId: string;
}): Promise<WeeklyReportDeliveryMutationResult> {
  return db.transaction(async (tx): Promise<WeeklyReportDeliveryMutationResult> => {
    const [current] = await tx
      .select({ id: weeklyReportDeliveries.id, version: weeklyReportDeliveries.version })
      .from(weeklyReportDeliveries)
      // ⚠️ id 로만 좁힌다(파일 헤더).
      .where(eq(weeklyReportDeliveries.id, params.id))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    if (!(await repairCaseExists(tx, params.fields.repairCaseId))) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
        message: UNKNOWN_REFERENCE_MESSAGE,
      };
    }

    const [updated] = await tx
      .update(weeklyReportDeliveries)
      .set({
        ...toColumnValues(params.fields),
        version: sql`${weeklyReportDeliveries.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      // 잠금을 쥐고 있으므로 version 조건 없이도 안전하지만, 그대로 한 번 더
      // 적는다 — 이 저장소의 다른 mutation 들이 0행 갱신을 마지막 안전망으로
      // 쓰는 방식과 같고, 잠금 방식을 나중에 바꿔도 이 조건은 남는다.
      .where(
        and(
          eq(weeklyReportDeliveries.id, params.id),
          eq(weeklyReportDeliveries.version, params.expectedVersion)
        )
      )
      .returning({ id: weeklyReportDeliveries.id, version: weeklyReportDeliveries.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 줄 하나를 **바로 지운다.** 휴지통도 복원도 없다(승인된 결정).
 *
 * version 을 그래도 대조하는 이유는 파일 헤더의 '삭제도 version 을 본다' 에 있다 —
 * 되돌릴 수 없는 조작에서 보고 있던 줄과 지워지는 줄이 다르면 그것이 곧 자료
 * 손실이다.
 *
 * ⚠️ **반드시 id 로 좁힌다.** 주나 수리 건으로 좁힌 delete 는 그 주 표를 통째로
 * 비운다.
 */
export async function deleteWeeklyReportDelivery(params: {
  id: string;
  expectedVersion: number;
}): Promise<WeeklyReportDeliveryMutationResult> {
  return db.transaction(async (tx): Promise<WeeklyReportDeliveryMutationResult> => {
    const [current] = await tx
      .select({ id: weeklyReportDeliveries.id, version: weeklyReportDeliveries.version })
      .from(weeklyReportDeliveries)
      .where(eq(weeklyReportDeliveries.id, params.id))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const [deleted] = await tx
      .delete(weeklyReportDeliveries)
      .where(
        and(
          eq(weeklyReportDeliveries.id, params.id),
          eq(weeklyReportDeliveries.version, params.expectedVersion)
        )
      )
      .returning({ id: weeklyReportDeliveries.id, version: weeklyReportDeliveries.version });

    if (!deleted) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 지워진 줄의 version 을 그대로 돌려준다 — 화면이 "무엇이 사라졌는가"를
    // 방금 들고 있던 값과 맞춰 볼 수 있게 하기 위해서다.
    return { ok: true, id: deleted.id, version: deleted.version };
  });
}
