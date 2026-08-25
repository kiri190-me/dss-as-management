import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { repairCases, weeklyReportGoals } from "../schema";
import type { WeeklyReportGoalFields } from "@/lib/validation/weekly-report-goal-input";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 추가·수정·삭제·복사
 * ============================================================================
 * 이 계층은 **기계**다. 누가 적을 수 있는지는 여기서 묻지 않는다 —
 * 세션·역할·설정은 서버 액션(server/actions/weekly-report-goals.ts)이 보고, 이
 * 파일은 자료의 규칙만 지킨다(존재하는가 · 그 사이 누가 고쳤는가 · 이미 있는가).
 * mutations/domestic-orders.ts 와 같은 구분이고, 통합 테스트가 인가를 흉내 내지
 * 않고도 자료 규칙을 그대로 검증할 수 있는 이유이기도 하다.
 *
 * ── 동시 수정은 version 으로 막는다 ─────────────────────────────────────
 * 본보기는 mutations/domestic-orders.ts 다. 순서가 곧 규칙이다:
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다.
 *  2. 없는 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — **한 글자도 바꾸지 않고** 돌아간다.
 *     화면은 폼을 얼리고 다시 불러오게 한다.
 *  4. 값과 함께 version + 1, updated_at, updated_by 를 쓴다.
 *
 * 잠금을 먼저 잡는 이유: 읽고 나서 쓰기까지 사이에 남이 끼어들면 "둘 다
 * 성공했는데 한쪽 내용이 사라진" 상태가 만들어진다. 주간보고는 여럿이 함께
 * 보는 화면이라 같은 줄을 두 사람이 고치는 일이 실제로 일어난다.
 *
 * ⚠️ **수정·삭제는 반드시 id 로 좁힌다.** 주(week_start_date)나 수리 건으로
 * 좁힌 update/delete 는 남의 줄까지 함께 건드린다 — 한 줄을 지우는 일이 그 주
 * 상자를 통째로 비우는 일이 되어서는 안 된다.
 *
 * ── 삭제는 바로 지운다 ──────────────────────────────────────────────────
 * 휴지통도 복원도 없다(승인된 결정, schema 헤더의 '휴지통은 두지 않는다').
 * 그래서 이 파일에는 소프트 삭제 경로가 아예 없고, 조회도 is_deleted 를 보지
 * 않는다 — 나중에 휴지통이 필요해지면 그때 4칼럼과 함께 붙인다.
 *
 * ── 복사는 여러 번 눌러도 늘어나지 않는다 ───────────────────────────────
 * 대상 주에 **이미 같은 수리 건이 있으면 건너뛴다.** 그래서 같은 복사를 두 번
 * 눌러도 두 번째는 전부 건너뛰고 아무것도 늘지 않는다(멱등). 이 규칙이 없으면
 * 버튼을 두 번 누른 사람의 상자에 모든 줄이 두 벌씩 들어가고, 그 상태를
 * 되돌리는 방법은 한 줄씩 지우는 것뿐이다.
 *
 * 몇 건을 옮기고 몇 건을 건너뛰었는지 세어 돌려준다 — 다음 단계의 화면이
 * 그것을 그대로 사람에게 알려 준다. "복사했습니다"만 말하면, 아무것도 늘지
 * 않은 화면을 보고 고장을 의심하게 된다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * goal_text 는 사람이 자유롭게 적는 값이라 담당자 이름이 섞일 수 있다
 * (schema 헤더). 이 파일은 실패해도 그 값을 오류 메시지에 담지 않는다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 아래 도우미들이 같은 트랜잭션 안에서 읽도록 못 박는다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type WeeklyReportGoalMutationResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type WeeklyReportGoalMutationResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: WeeklyReportGoalMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 목표를 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";

const NOT_FOUND_MESSAGE = "해당 금주 목표를 찾을 수 없습니다.";

const UNKNOWN_REFERENCE_MESSAGE = "입력값을 확인해 주세요.";

/**
 * 고르려는 수리 건이 실제로 있는가. 없으면 FK 위반(23503)이 나는데, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다 — 어느 칸이 문제인지 말해 주는 편이 낫다.
 *
 * **is_deleted 를 보지 않는 것은 일부러다.** 휴지통에 있는 건에 적어 둔 목표도
 * 조회에 그대로 나오므로(queries/weekly-report-goals.ts 의 '휴지통에 있는 수리
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
function toColumnValues(fields: WeeklyReportGoalFields) {
  return {
    weekStartDate: fields.weekStartDate,
    repairCaseId: fields.repairCaseId,
    goalText: fields.goalText,
    displayOrder: fields.displayOrder,
  };
}

/** 새 목표 줄 하나. version 은 스키마 기본값 1로 시작한다. */
export async function createWeeklyReportGoal(params: {
  fields: WeeklyReportGoalFields;
  actorUserId: string;
}): Promise<WeeklyReportGoalMutationResult> {
  return db.transaction(async (tx): Promise<WeeklyReportGoalMutationResult> => {
    if (!(await repairCaseExists(tx, params.fields.repairCaseId))) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
        message: UNKNOWN_REFERENCE_MESSAGE,
      };
    }

    const [inserted] = await tx
      .insert(weeklyReportGoals)
      .values({
        ...toColumnValues(params.fields),
        createdBy: params.actorUserId,
        // 만든 사람이 곧 마지막으로 고친 사람이다. 여기를 비워 두면 "누가
        // 마지막으로 손댔는가"가 첫 수정 전까지 빈칸으로 남는다.
        updatedBy: params.actorUserId,
      })
      .returning({ id: weeklyReportGoals.id, version: weeklyReportGoals.version });

    return { ok: true, id: inserted.id, version: inserted.version };
  });
}

/**
 * 목표 줄 하나를 고친다.
 *
 * 주(week_start_date)와 수리 건까지 함께 받는 이유: 사람이 "이 줄은 다음 주
 * 것이었다"거나 "다른 건에 잘못 달았다"를 고칠 길이 있어야 한다. 한 칸씩
 * 고치는 경로를 따로 두지 않는 것은 내자 정리와 같은 판단이다 — 나눠 두면
 * 잠금·version 대조·updated_by 기록이 여러 벌이 된다.
 */
export async function updateWeeklyReportGoal(params: {
  id: string;
  expectedVersion: number;
  fields: WeeklyReportGoalFields;
  actorUserId: string;
}): Promise<WeeklyReportGoalMutationResult> {
  return db.transaction(async (tx): Promise<WeeklyReportGoalMutationResult> => {
    const [current] = await tx
      .select({ id: weeklyReportGoals.id, version: weeklyReportGoals.version })
      .from(weeklyReportGoals)
      // ⚠️ id 로만 좁힌다(파일 헤더).
      .where(eq(weeklyReportGoals.id, params.id))
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
      .update(weeklyReportGoals)
      .set({
        ...toColumnValues(params.fields),
        version: sql`${weeklyReportGoals.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      // 잠금을 쥐고 있으므로 version 조건 없이도 안전하지만, 그대로 한 번 더
      // 적는다 — 이 저장소의 다른 mutation 들이 0행 갱신을 마지막 안전망으로
      // 쓰는 방식과 같고, 잠금 방식을 나중에 바꿔도 이 조건은 남는다.
      .where(
        and(
          eq(weeklyReportGoals.id, params.id),
          eq(weeklyReportGoals.version, params.expectedVersion)
        )
      )
      .returning({ id: weeklyReportGoals.id, version: weeklyReportGoals.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 목표 줄 하나를 **바로 지운다.** 휴지통도 복원도 없다(승인된 결정).
 *
 * version 을 그래도 대조하는 이유: 낡은 화면에서 누른 '삭제'는 그 사이 남이
 * 고쳐 놓은 문장을 지우는 일이 된다. 지우는 사람이 보고 있던 줄과 실제로
 * 지워지는 줄이 다르면, 되돌릴 방법이 없는 이 조작에서는 그것이 곧 자료
 * 손실이다.
 *
 * ⚠️ **반드시 id 로 좁힌다.** 주나 수리 건으로 좁힌 delete 는 그 주 상자를
 * 통째로 비운다.
 */
export async function deleteWeeklyReportGoal(params: {
  id: string;
  expectedVersion: number;
}): Promise<WeeklyReportGoalMutationResult> {
  return db.transaction(async (tx): Promise<WeeklyReportGoalMutationResult> => {
    const [current] = await tx
      .select({ id: weeklyReportGoals.id, version: weeklyReportGoals.version })
      .from(weeklyReportGoals)
      .where(eq(weeklyReportGoals.id, params.id))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const [deleted] = await tx
      .delete(weeklyReportGoals)
      .where(
        and(
          eq(weeklyReportGoals.id, params.id),
          eq(weeklyReportGoals.version, params.expectedVersion)
        )
      )
      .returning({ id: weeklyReportGoals.id, version: weeklyReportGoals.version });

    if (!deleted) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 지워진 줄의 version 을 그대로 돌려준다 — 화면이 "무엇이 사라졌는가"를
    // 방금 들고 있던 값과 맞춰 볼 수 있게 하기 위해서다.
    return { ok: true, id: deleted.id, version: deleted.version };
  });
}

/**
 * ── 지난주 줄을 다른 주로 복사 ──────────────────────────────────────────
 * 목표는 주마다 크게 달라지지 않는다 — 지난주에 '견적서 발행'이던 건은 이번 주
 * 에도 대개 같은 자리에 있다. 매주 스무 줄을 다시 치게 하면 사람은 다시 엑셀로
 * 돌아간다.
 */
export type WeeklyReportGoalCopyResult =
  | {
      ok: true;
      /** 실제로 만들어진 줄 수. */
      copied: number;
      /** 대상 주에 이미 같은 수리 건이 있어 건너뛴 줄 수. */
      skipped: number;
    }
  | { ok: false; code: "VALIDATION_ERROR"; message: string };

const COPY_SOURCE_EMPTY_MESSAGE = "가져올 주간에 저장된 목표가 없습니다.";

/**
 * `fromWeekStart` 의 줄들을 `toWeekStart` 로 옮겨 적는다.
 *
 * 옮기는 것은 **repair_case_id · goal_text · display_order** 셋뿐이다. version 은
 * 새 줄이므로 1부터 다시 시작하고, 만든 사람은 **복사한 사람**이다 — 원본을
 * 적은 사람을 그대로 베끼면 "내가 적지 않은 줄에 내 이름이 붙는" 것이 아니라
 * 그 반대로 "이번 주 상자를 만든 사람이 누구인지 알 수 없는" 상태가 된다.
 *
 * ── 이미 있는 수리 건은 건너뛴다 ────────────────────────────────────────
 * 대상 주에 같은 수리 건의 줄이 이미 있으면 그 줄은 옮기지 않는다. 사람이
 * 이번 주 목표를 몇 줄 먼저 적어 둔 뒤 복사를 눌러도 그 문장이 덮이지 않고,
 * 같은 복사를 두 번 눌러도 두 번째는 아무것도 늘지 않는다(멱등).
 *
 * **덮어쓰기를 고르지 않은 이유**: 이 조작의 뜻은 "빠진 것을 채워 달라"이지
 * "이번 주에 적은 것을 지난주 것으로 되돌려 달라"가 아니다. 덮어쓰면 방금 적은
 * 문장이 말없이 사라지고, 이 표에는 그것을 되찾을 이력이 없다.
 *
 * ⚠️ **한 트랜잭션 안에서 읽고 쓴다.** 읽은 뒤 쓰기 전에 남이 같은 건을 넣으면
 * 같은 주에 같은 수리 건이 두 줄 생긴다. 그 창을 좁히려고 대상 주의 기존 줄을
 * 같은 트랜잭션에서 읽는다.
 *
 * 원본 주에 줄이 하나도 없으면 VALIDATION_ERROR 다 — "0건 복사"를 성공으로
 * 돌려주면, 사람은 아무것도 늘지 않은 화면을 보고 고장을 의심한다.
 */
export async function copyWeeklyReportGoals(params: {
  fromWeekStart: string;
  toWeekStart: string;
  actorUserId: string;
}): Promise<WeeklyReportGoalCopyResult> {
  return db.transaction(async (tx): Promise<WeeklyReportGoalCopyResult> => {
    const sourceRows = await tx
      .select({
        repairCaseId: weeklyReportGoals.repairCaseId,
        goalText: weeklyReportGoals.goalText,
        displayOrder: weeklyReportGoals.displayOrder,
      })
      .from(weeklyReportGoals)
      .where(eq(weeklyReportGoals.weekStartDate, params.fromWeekStart))
      // 차례를 그대로 옮긴다 — 조회가 읽는 순서와 같다.
      .orderBy(asc(weeklyReportGoals.displayOrder), asc(weeklyReportGoals.createdAt));

    if (sourceRows.length === 0) {
      return { ok: false, code: "VALIDATION_ERROR", message: COPY_SOURCE_EMPTY_MESSAGE };
    }

    const existingRows = await tx
      .select({ repairCaseId: weeklyReportGoals.repairCaseId })
      .from(weeklyReportGoals)
      .where(
        and(
          eq(weeklyReportGoals.weekStartDate, params.toWeekStart),
          inArray(
            weeklyReportGoals.repairCaseId,
            sourceRows.map((row) => row.repairCaseId)
          )
        )
      );
    const alreadyThere = new Set(existingRows.map((row) => row.repairCaseId));

    // 원본 주에 같은 수리 건이 두 줄 있는 경우까지 여기서 접는다 — 그런 줄은
    // 첫 줄만 옮기고 나머지는 건너뛴다. 접지 않으면 대상 주에 같은 건이 두 줄
    // 생겨, 다음 복사가 그 둘을 다시 건너뛰는 상태가 굳어진다.
    const toInsert: { repairCaseId: string; goalText: string; displayOrder: number | null }[] = [];
    let skipped = 0;
    for (const row of sourceRows) {
      if (alreadyThere.has(row.repairCaseId)) {
        skipped += 1;
        continue;
      }
      alreadyThere.add(row.repairCaseId);
      toInsert.push(row);
    }

    if (toInsert.length === 0) return { ok: true, copied: 0, skipped };

    const inserted = await tx
      .insert(weeklyReportGoals)
      .values(
        toInsert.map((row) => ({
          weekStartDate: params.toWeekStart,
          repairCaseId: row.repairCaseId,
          goalText: row.goalText,
          displayOrder: row.displayOrder,
          createdBy: params.actorUserId,
          updatedBy: params.actorUserId,
        }))
      )
      .returning({ id: weeklyReportGoals.id });

    return { ok: true, copied: inserted.length, skipped };
  });
}
