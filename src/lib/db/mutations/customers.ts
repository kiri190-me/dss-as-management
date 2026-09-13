import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../client";
import { customers } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

/**
 * drizzle-orm wraps the driver's PostgresError in its own error class (the
 * original is on `.cause`), so the Postgres error `code` is not always on
 * the caught error itself — check both. Same reasoning/precedent as
 * repair-cases.ts's own isUniqueViolation.
 */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

export type UpdateCustomerResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type UpdateCustomerResult =
  | { ok: true; id: string; updatedAt: string }
  | { ok: false; code: UpdateCustomerResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Customer master edit (Customer Management phase 1). Row-locks the target
 * (`for("update")`, same convention as repair-case-flowchart mutations),
 * re-checks `expectedUpdatedAt` for optimistic concurrency — customers has
 * no integer `version` column (unlike repair_cases), so this reuses the
 * updated_at-timestamp-comparison pattern already established for
 * repair_case_flowcharts' edit actions rather than adding a new column.
 *
 * Duplicate-name protection mirrors resolveOrCreateCustomerByName
 * (repair-cases.ts): a pre-update JS scan over active customers (excluding
 * self) using the same isExactNormalizedMatch normalization the DB's own
 * unique index (customers_normalized_name_unique) uses, PLUS a
 * catch-unique-violation fallback for the race where two edits rename
 * different customers to the same normalized name concurrently — the
 * second one to commit gets a clean VALIDATION_ERROR instead of an
 * uncaught 23505.
 *
 * 그 23505 대비가 실제로 돌려면 UPDATE 를 세이브포인트(tx.transaction) 안에서 해야
 * 한다 — postgres-js 는 트랜잭션 안에서 난 오류를 catch 로 잡아도 콜백이 끝난 뒤 다시
 * 던진다(createCustomer 주석). 세이브포인트 없이는 진 쪽이 날것의 23505 로 터졌다.
 *
 * repair_cases.contact*_snapshot columns are never touched here — this
 * mutation only ever writes to the customers table itself, so existing
 * per-intake contact snapshots stay exactly as recorded regardless of any
 * later customer-master contact edit (see repair-cases.ts schema comment).
 */
export async function updateCustomer(params: {
  customerId: string;
  expectedUpdatedAt: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /**
   * 내자 정리 목록의 줄 배경색 — 팔레트 키이거나 null 이다
   * (domain/customer-row-color.ts). 저장할 칸이 하나 늘었을 뿐이라서
   * expectedUpdatedAt 대조와 이름 중복 검사는 그대로다.
   */
  rowColor: string | null;
}): Promise<UpdateCustomerResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 고객사를 찾을 수 없습니다." };
    }

    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 고객사 정보를 수정했습니다. 새로고침 후 다시 시도하세요.",
      };
    }

    const others = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.isDeleted, false), ne(customers.id, params.customerId)));
    const duplicate = others.find((c) => isExactNormalizedMatch(c.name, params.name));
    if (duplicate) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { name: "이미 존재하는 고객사명입니다." },
        message: "입력값을 확인해 주세요.",
      };
    }

    // 🔴 세이브포인트 안에서 한다 — 위 함수 주석. 되감기는 이 UPDATE 몫뿐이다.
    try {
      const updated = await tx.transaction(async (savepoint) => {
        const [row] = await savepoint
          .update(customers)
          .set({
            name: params.name,
            contactName: params.contactName,
            contactEmail: params.contactEmail,
            contactPhone: params.contactPhone,
            rowColor: params.rowColor,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, params.customerId))
          .returning({ id: customers.id, updatedAt: customers.updatedAt });
        return row;
      });

      return { ok: true, id: updated.id, updatedAt: updated.updatedAt.toISOString() };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          fieldErrors: { name: "이미 존재하는 고객사명입니다." },
          message: "입력값을 확인해 주세요.",
        };
      }
      throw err;
    }
  });
}

export type CreateCustomerResult =
  | { ok: true; id: string }
  | { ok: false; code: "VALIDATION_ERROR"; fieldErrors: Record<string, string>; message: string };

const DUPLICATE_NAME_RESULT: CreateCustomerResult = {
  ok: false,
  code: "VALIDATION_ERROR",
  fieldErrors: { name: "이미 존재하는 고객사명입니다." },
  message: "입력값을 확인해 주세요.",
};

/**
 * 고객사 관리 화면의 [고객사 추가] (2026-09-13).
 *
 * ── 접수 화면의 resolveOrCreateCustomerByName 과 다른 점 ────────────────
 * 그쪽은 이름이 같으면 **조용히 기존 고객사를 돌려준다** — 접수하는 사람에게는
 * "그 고객사로 접수된다"가 맞는 결과다. 관리 화면에서는 틀린 결과다: 새로
 * 만들었다고 믿고 상세 화면에 들어가 연락처를 고치면 남의 고객사를 고치게 된다.
 * 그래서 여기서는 같은 이름을 **거절한다**.
 *
 * ── 중복 방어는 updateCustomer 와 같은 두 겹이다 ─────────────────────────
 * 활성 고객사를 훑는 isExactNormalizedMatch 사전 검사 + 그 사이의 경쟁을 잡는
 * 유니크 위반(23505, cause 까지) 대비. 둘 다 같은 VALIDATION_ERROR 로 돌아간다.
 * 휴지통에 있는 같은 이름은 막지 않는다 — customers_normalized_name_unique 가
 * 활성 고객사만 보고, 이름 수정도 같은 규칙이다(복원할 때 NAME_TAKEN 으로 걸린다).
 *
 * ── 감사 로그에 연락처는 넣지 않는다 ────────────────────────────────────
 * customers-trash.ts 와 같은 규칙이다 — contact_name/email/phone 은 개인정보다.
 */
export async function createCustomer(params: {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** 팔레트 키이거나 null(domain/customer-row-color.ts). */
  rowColor: string | null;
  actorUserId: string;
}): Promise<CreateCustomerResult> {
  const name = params.name.trim();
  if (name === "") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { name: "고객사명을 입력해 주세요." },
      message: "입력값을 확인해 주세요.",
    };
  }

  return db.transaction(async (tx): Promise<CreateCustomerResult> => {
    const active = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.isDeleted, false));
    if (active.some((existing) => isExactNormalizedMatch(existing.name, name))) {
      return DUPLICATE_NAME_RESULT;
    }

    // 🔴 INSERT 는 **세이브포인트 안에서** 한다(tx.transaction). postgres-js 는
    // 트랜잭션 안에서 난 쿼리 오류를 기억해 두었다가, 우리가 catch 로 잡아
    // 정상 결과를 돌려줘도 콜백이 끝난 뒤 그 오류를 **다시 던진다**
    // (node_modules/postgres/cjs/src/index.js 의 scope → uncaughtError). 그러면
    // 경쟁에서 진 쪽이 "이미 존재하는 고객사명"이 아니라 날것의 23505 로 터진다
    // — 동시 추가 시험이 실제로 그렇게 실패했다. 세이브포인트는 자기 몫의 오류를
    // 따로 기억하고 되감으므로 바깥 트랜잭션은 멀쩡히 남고, 감사 로그도 그대로
    // 같은 트랜잭션에 쓴다. intake-master-resolution.ts 가 같은 이유로 같은 모양이다.
    let created: { id: string; name: string; rowColor: string | null; createdAt: Date };
    try {
      created = await tx.transaction(async (savepoint) => {
        const [row] = await savepoint
          .insert(customers)
          .values({
            name,
            contactName: params.contactName,
            contactEmail: params.contactEmail,
            contactPhone: params.contactPhone,
            rowColor: params.rowColor,
          })
          .returning({
            id: customers.id,
            name: customers.name,
            rowColor: customers.rowColor,
            createdAt: customers.createdAt,
          });
        return row;
      });
    } catch (err) {
      // 위 사전 검사와 이 INSERT 사이에 같은 이름이 먼저 들어온 경쟁. 부분 유니크
      // 인덱스가 최종 방어선이고, 여기서 사람이 읽을 수 있는 말로 바꾼다.
      if (isUniqueViolation(err)) return DUPLICATE_NAME_RESULT;
      throw err;
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: "customers",
      targetRecordId: created.id,
      previousValue: null,
      newValue: {
        id: created.id,
        name: created.name,
        rowColor: created.rowColor,
        createdAt: created.createdAt.toISOString(),
      },
    });

    return { ok: true, id: created.id };
  });
}
