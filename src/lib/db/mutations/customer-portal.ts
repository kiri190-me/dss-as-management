import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import { customerStatusOptions, repairCaseCustomerStatus } from "../schema";

/**
 * ============================================================================
 * 고객 안내 창구 — 기록
 * ============================================================================
 *
 * 남은 것은 setCustomerStatuses 하나다. 고객사 전용 주소를 발급·회수하고 밖에서
 * 당겨온 의뢰를 넣던 기록 넷(issueCustomerLink · revokeCustomerLink ·
 * insertPulledRequests · recordPortalSync)은 2026-10-04 에 걷어냈다 — 그 기능이
 * 운영에서 한 번도 돈 적이 없다. 🔴 표(`customer_repair_links` ·
 * `customer_repair_requests` · `customer_portal_sync_log`)와 그 안의 행은
 * 그대로 둔다(사용자 결정 2026-10-04).
 *
 * ── 🔴 저장은 **여러 줄을 한 번에**다 (사용자 지시 2026-10-07) ──────────────
 *
 * 화면의 [저장]이 표의 줄마다 하나였던 것을 화면에 하나로 바꾸면서, 기록도 줄
 * 하나를 받던 `setCustomerStatus` 에서 줄 묶음을 받는 `setCustomerStatuses` 로
 * 바꿨다. 줄 하나짜리 길을 함께 남겨 두지 않았다 — 같은 일을 하는 길이 둘이면
 * 둘은 갈린다(한쪽만 감사 기록 모양이 바뀌는 식으로). 줄이 하나인 저장은 이
 * 함수에 줄 하나를 넘기는 것과 정확히 같다.
 *
 * 🔴 **한 트랜잭션이고, 한 줄이라도 어긋나면 아무것도 저장하지 않는다.** 반만
 * 저장되면 사람은 「저장됐다」고 믿고 그대로 엑셀을 만들어 고객사에 보낸다 —
 * 표와 저장된 파일이 갈리는 그 어긋남은 아무도 눈치채지 못한 채 굳는다. 어긋난
 * 줄이 **어느 줄인지**는 `failures` 로 전부 돌려준다(한 줄만이 아니다 — 사람이
 * 고칠 곳을 한 번에 봐야 한다).
 *
 * 🔴 **낙관적 잠금은 줄마다 그대로 돈다.** 한 번에 저장한다고 해서 version 을
 * 느슨하게 보지 않는다(아래 applyCustomerStatusRow).
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MutationResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "INVALID"; message: string };

const VERSION_CONFLICT_MESSAGE =
  "다른 사람이 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.";
const NOT_FOUND_MESSAGE = "해당 기록을 찾을 수 없습니다.";
const INVALID_OPTION_MESSAGE = "사용할 수 없는 상태입니다.";
const DUPLICATE_ROW_MESSAGE = "같은 접수 건이 두 번 들어왔습니다.";
/**
 * 🔴 실패했을 때 사람이 가장 먼저 알아야 하는 사실. 「저장하지 못했습니다」만
 * 말하면 **반쯤 저장된 것은 아닌지**를 알 수 없고, 그 의심은 표를 다시 처음부터
 * 맞춰 보게 만든다.
 */
const NOTHING_SAVED_MESSAGE =
  "한 줄이라도 어긋나면 아무것도 저장하지 않습니다 — 이번에 저장된 줄은 없습니다.";

/** 저장할 줄 하나. 화면의 표 한 줄이 그대로 이 꼴이 된다. */
export type CustomerStatusRow = {
  repairCaseId: string;
  statusOptionId: string | null;
  note: string | null;
  /** 고객사 양식에서 손으로 적은 값들. `undefined` = 건드리지 않음. */
  formValues?: Record<string, string>;
  expectedVersion: number | null;
};

/** 어긋난 줄 하나. 🔴 어느 줄인지(id)와 왜인지(message)를 함께 들고 나간다. */
export type CustomerStatusRowFailure = {
  repairCaseId: string;
  code: "NOT_FOUND" | "CONFLICT" | "INVALID";
  message: string;
};

export type SetCustomerStatusesResult =
  | { ok: true; saved: number }
  | { ok: false; message: string; failures: CustomerStatusRowFailure[] };

/**
 * 트랜잭션을 되돌리는 길. drizzle 은 콜백이 **던져야** 되돌린다 — 실패를 값으로
 * 돌려주면 그대로 commit 된다. 접수 만들기(mutations/repair-cases.ts)가 쓰는
 * 방식과 같다.
 */
class CustomerStatusRollback extends Error {
  constructor(readonly failures: CustomerStatusRowFailure[]) {
    super("CUSTOMER_STATUS_ROLLBACK");
  }
}

/**
 * 접수 여러 건의 고객 안내 상태를 **한 트랜잭션으로** 정한다.
 *
 * ■ 낙관적 잠금 — 줄마다 그대로다
 *
 * 담당자 둘이 같은 건을 동시에 고칠 때 뒤엣것이 앞엣것을 조용히 덮으면 안 된다.
 * 이 저장소가 접수 수정에서 쓰는 방식과 같다 — `WHERE id = ? AND version = ?`로
 * 고치면서 version 을 올리고, 0행이면 없어진 것인지 남이 먼저 고친 것인지를
 * 한 번 더 물어 구분한다.
 *
 * `expectedVersion`이 null 이면 "아직 행이 없다"는 뜻이라 새로 만든다. 그
 * 순간에 다른 사람이 먼저 만들었다면 unique 가 막고 CONFLICT 로 돌려준다.
 *
 * ■ 🔴 전부 저장되거나, 아무것도 저장되지 않거나
 *
 * 줄을 하나씩 보되 **한 줄이라도 어긋나면 던져서 통째로 되돌린다.** 어긋난 줄을
 * 만난 자리에서 멈추지 않고 끝까지 돌아 `failures` 를 모으는 까닭: 사람이
 * 고쳐야 할 줄이 셋이면 셋을 한 번에 봐야 한다. 한 줄씩 알려 주면 저장을 세 번
 * 눌러야 하고, 그 사이에 또 누가 고친다.
 *
 * 🔴 여기서 모으는 실패는 SQL 오류가 **아니다** — 「version 이 안 맞아 0행」이다.
 * 그래서 다음 줄의 질의가 멈추지 않는다(Postgres 는 오류가 난 트랜잭션에서만
 * 뒤 질의를 거절한다).
 *
 * ■ 🔴 `formValues` 를 안 넘기는 것과 `{}` 를 넘기는 것은 다르다
 *
 * 고객사 양식 표에서 손으로 적는 값들이다. **넘기지 않으면(undefined) 있던
 * 값을 그대로 둔다.** 양식을 모르는 저장 길이 이 값을 싣지 않고 올 수 있으므로,
 * 안 넘긴 것을 "비우라"로 읽으면 담당자가 비고 한 줄을 고칠 때마다 적어 둔 값이
 * 통째로 사라진다 — 아무 오류도 없이. `{}` 를 넘기면 그때는 "다 지웠다"는
 * 뜻이라 그대로 비운다.
 */
export async function setCustomerStatuses(params: {
  rows: CustomerStatusRow[];
  actorUserId: string;
}): Promise<SetCustomerStatusesResult> {
  const { rows, actorUserId } = params;
  if (rows.length === 0) return { ok: true, saved: 0 };

  /*
   * 🔴 같은 접수가 두 번 들어오면 **막는다.** 그대로 두면 첫 줄이 version 을
   * 올리고 둘째 줄이 그 때문에 충돌로 잡혀, 사람은 고치지도 않은 줄이 충돌했다는
   * 말을 듣는다. 화면에서는 일어날 수 없는 모양이라 INVALID 로 돌려준다.
   */
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.repairCaseId)) {
      return {
        ok: false,
        message: NOTHING_SAVED_MESSAGE,
        failures: [
          { repairCaseId: row.repairCaseId, code: "INVALID", message: DUPLICATE_ROW_MESSAGE },
        ],
      };
    }
    seen.add(row.repairCaseId);
  }

  /*
   * 고를 수 있는 상태인가. 🔴 줄마다 묻지 않고 **쓰인 상태들을 한 번에** 묻는다 —
   * 줄이 서른이어도 질의는 하나다.
   *
   * 비활성으로 내린 상태를 새로 고를 수는 없다. 이미 그 값을 쓰고 있는 건은
   * 그대로 두되(비활성은 "앞으로 고르지 못한다"이다), 새로 고르는 길은 막는다.
   */
  const optionIds = [
    ...new Set(rows.map((row) => row.statusOptionId).filter((id): id is string => id !== null)),
  ];
  if (optionIds.length > 0) {
    const usable = await db
      .select({ id: customerStatusOptions.id })
      .from(customerStatusOptions)
      .where(
        and(
          inArray(customerStatusOptions.id, optionIds),
          eq(customerStatusOptions.isActive, true)
        )
      );
    const usableIds = new Set(usable.map((option) => option.id));
    const failures = rows
      .filter((row) => row.statusOptionId !== null && !usableIds.has(row.statusOptionId))
      .map((row) => ({
        repairCaseId: row.repairCaseId,
        code: "INVALID" as const,
        message: INVALID_OPTION_MESSAGE,
      }));
    if (failures.length > 0) {
      return { ok: false, message: NOTHING_SAVED_MESSAGE, failures };
    }
  }

  try {
    return await db.transaction(async (tx) => {
      const failures: CustomerStatusRowFailure[] = [];
      for (const row of rows) {
        const result = await applyCustomerStatusRow(tx, row, actorUserId);
        if (!result.ok) {
          failures.push({
            repairCaseId: row.repairCaseId,
            code: result.code,
            message: result.message,
          });
        }
      }
      // 🔴 값으로 돌려주면 commit 된다. 되돌리려면 던져야 한다.
      if (failures.length > 0) throw new CustomerStatusRollback(failures);
      return { ok: true as const, saved: rows.length };
    });
  } catch (error) {
    if (error instanceof CustomerStatusRollback) {
      return { ok: false, message: NOTHING_SAVED_MESSAGE, failures: error.failures };
    }
    throw error;
  }
}

/**
 * 줄 하나를 **이미 열려 있는 트랜잭션 안에서** 기록한다.
 *
 * 🔴 스스로 트랜잭션을 열지 않는다 — 부르는 쪽이 「전부 아니면 아무것도」를
 * 지키려면 모든 줄이 같은 트랜잭션 안에 있어야 한다.
 */
async function applyCustomerStatusRow(
  tx: Tx,
  row: CustomerStatusRow,
  actorUserId: string
): Promise<MutationResult<{ version: number }>> {
  const { repairCaseId, statusOptionId, note, formValues, expectedVersion } = row;

  if (expectedVersion === null) {
    const inserted = await tx
      .insert(repairCaseCustomerStatus)
      .values({
        repairCaseId,
        statusOptionId,
        note,
        // 새로 만드는 줄에는 안 넘긴 것과 빈 것이 같다 — 어차피 없던 값이다.
        formValues: formValues ?? {},
        updatedBy: actorUserId,
      })
      // 그사이 남이 먼저 만들었으면 조용히 넘어가고 아래에서 0행으로 잡힌다.
      .onConflictDoNothing({ target: repairCaseCustomerStatus.repairCaseId })
      .returning({ version: repairCaseCustomerStatus.version });

    if (inserted.length === 0) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    await insertAuditLog(tx, {
      actorUserId,
      actionType: "CREATE",
      targetEntity: "repair_case_customer_status",
      targetRecordId: repairCaseId,
      newValue: { statusOptionId, note, formValues: formValues ?? {} },
    });

    return { ok: true, value: { version: inserted[0].version } };
  }

  const [previous] = await tx
    .select({
      statusOptionId: repairCaseCustomerStatus.statusOptionId,
      note: repairCaseCustomerStatus.note,
      formValues: repairCaseCustomerStatus.formValues,
    })
    .from(repairCaseCustomerStatus)
    .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));

  const updated = await tx
    .update(repairCaseCustomerStatus)
    .set({
      statusOptionId,
      note,
      // 🔴 안 넘겼으면 `.set()` 에 키 자체를 넣지 않는다. `formValues: undefined`
      //    를 넣어도 drizzle 이 빼 주기는 하지만, 그 사실에 기대면 다음 사람이
      //    `?? null` 한 글자를 붙이는 순간 남의 값이 지워진다.
      ...(formValues === undefined ? {} : { formValues }),
      updatedBy: actorUserId,
      updatedAt: sql`now()`,
      version: sql`${repairCaseCustomerStatus.version} + 1`,
    })
    .where(
      and(
        eq(repairCaseCustomerStatus.repairCaseId, repairCaseId),
        eq(repairCaseCustomerStatus.version, expectedVersion)
      )
    )
    .returning({ version: repairCaseCustomerStatus.version });

  if (updated.length === 0) {
    // 0행은 두 가지다 — 행이 없어졌거나, 남이 먼저 고쳐 version 이 올라갔거나.
    // 구분하지 않으면 사람이 무엇을 해야 할지 모른다.
    const [stillExists] = await tx
      .select({ id: repairCaseCustomerStatus.id })
      .from(repairCaseCustomerStatus)
      .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));

    return {
      ok: false,
      code: stillExists ? "CONFLICT" : "NOT_FOUND",
      message: stillExists ? VERSION_CONFLICT_MESSAGE : NOT_FOUND_MESSAGE,
    };
  }

  await insertAuditLog(tx, {
    actorUserId,
    actionType: "UPDATE",
    targetEntity: "repair_case_customer_status",
    targetRecordId: repairCaseId,
    previousValue: previous ?? null,
    // 안 넘긴 것은 안 바뀐 것이라 새 값에도 적지 않는다 — 적으면 감사 기록이
    // "이번에 비웠다"로 읽힌다.
    newValue: { statusOptionId, note, ...(formValues === undefined ? {} : { formValues }) },
  });

  return { ok: true, value: { version: updated[0].version } };
}
