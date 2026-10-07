import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import { productModelKindShareDocs } from "../schema";
import type { ProductModelKind } from "@/lib/domain/product-model-kind";

/**
 * ============================================================================
 * 제품 종류별 **공유폴더 가리킴** 담기 · 지우기 (2026-10-07)
 * ============================================================================
 * 한 줄은 「이 종류의 공통 서류는 사내 공유폴더의 **저기** 있다」는 가리킴 하나다.
 * **파일도 사본도 들어오지 않는다** — 그래서 여기에는 디스크를 만지는 코드가 한 줄도
 * 없다(schema/product-model-kind-share-docs.ts 머리말).
 *
 * ── 🔴 이 파일은 **DB 만** 본다 ──────────────────────────────────────────
 * 「그 자리에 실제로 있는가」를 보는 일은 서버 액션이 한다
 * (server/actions/product-model-kind-share-docs.ts → storage/repair-docs-entries.ts).
 * 두 일을 한 파일에 섞으면 DB 시험이 공유폴더를 쥐어야 돌게 되고, 공유폴더가 꺼진
 * 개발 PC 에서 아무것도 못 돌린다. 경계는 종류 서류 **올리기** 통로가 그은 선과 같다 —
 * 디스크를 먼저 끝내고, 그 다음에 DB 를 한 트랜잭션으로 친다.
 *
 * ── 🔴 휴지통이 없다 — 감사 로그가 **유일한 흔적**이다 ────────────────────
 * 이 표는 소프트 삭제 4칸을 일부러 두지 않았다(스키마 머리말의 네 까닭). 그래서
 * 지우면 줄이 **정말로 사라진다.** 스키마 머리말이 「다음 조각은 이 표의 삭제를 감사
 * 로그에 반드시 남겨야 한다」고 못 박고 있고, 이 파일이 그 약속을 지킨다:
 *  · 담기 → `CREATE`, `new_value` 에 담은 줄
 *  · 지우기 → `PURGE`, 🔴 **`previous_value` 에 지워진 줄을 통째로** — 되살리는 일이
 *    「경로 한 줄을 다시 적는 일」이므로, 그 한 줄이 여기 남아야 되살릴 수 있다.
 * `PURGE` 를 고른 까닭: 이 저장소에서 `SOFT_DELETE` 는 휴지통으로 **보내는** 일이고,
 * 되돌릴 수 없는 **완전 삭제**는 `PURGE` 다(customers-trash · domestic-orders-trash ·
 * master-data-purge 가 그렇다). 여기 삭제는 후자다. `audit_logs.target_entity` 는 enum
 * 이 아니라 text 라 새 표 이름을 적는 데 마이그레이션이 필요 없다.
 *
 * ── 🔴 중복은 **사람이 읽는 말**로 거절한다 ──────────────────────────────
 * 표에 유니크가 있다 — 같은 종류에 **접어서 같은** 경로는 두 번 담기지 않는다
 * (`lower(regexp_replace(btrim(normalize(relative_path, NFC)), '\s+', ' ', 'g'))`).
 * 그대로 두면 사람에게 `23505` 가 보인다. 그래서 **같은 식으로 먼저 찾아 보고**
 * 사람 말로 막고, 그 사이에 끼어든 요청이 만든 충돌은 `23505` 를 잡아 **같은 말**로
 * 바꾼다. 🔴 접는 식을 여기 **베껴 적지 않고** 한 상수에 두 번 쓴다 — 두 벌로 적으면
 * 인덱스와 갈라지는 날 조회만 통과하고 INSERT 가 터진다.
 *
 * ── 🔴 값을 다듬어 담지 않는다 ───────────────────────────────────────────
 * 경로는 **들어온 글자 그대로** 담는다. 공유폴더에는 공백이 두 칸인 폴더가 실제로
 * 있고, 다듬은 이름으로 이으면 없는 폴더가 된다(domain/share-folder-naming.ts 의
 * 「비교할 때만 다듬고, 이을 때는 디스크의 실제 이름을 쓴다」). 다듬기는 **견줄
 * 때만** 하고, 그 자리가 위의 접는 식이다.
 * ============================================================================
 */

/** 🔴 감사 로그의 `target_entity`. 표 이름 그대로다 — 시험이 이 상수로 줄을 찾는다. */
export const PRODUCT_MODEL_KIND_SHARE_DOCS_AUDIT_ENTITY = "product_model_kind_share_docs";

const DUPLICATE_MESSAGE = "같은 자리를 이미 담아 두었습니다.";
const NOT_FOUND_MESSAGE = "해당 가리킴을 찾을 수 없습니다.";

export type ShareDocEntryKind = "FILE" | "FOLDER";

export type ShareDocMutationResult =
  | { ok: true; id: string }
  | { ok: false; code: "DUPLICATE" | "NOT_FOUND"; message: string };

/**
 * 🔴 **유니크 인덱스와 같은 식**으로 경로를 접는다. 인덱스 정의는
 * schema/product-model-kind-share-docs.ts 에 있고, 이 함수가 그 식을 **한 자리에서만**
 * 다시 쓴다. `\\s+` 의 겹수는 TS → SQL 로 가며 한 겹 줄어 `'\s+'` 가 된다 — 스키마
 * 쪽도 똑같이 적혀 있다.
 */
function foldedPath(value: unknown) {
  return sql`lower(regexp_replace(btrim(normalize(${value}, NFC)), '\\s+', ' ', 'g'))`;
}

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

/** drizzle-orm 이 감싼 PostgresError 는 원본이 `.cause` 에 있다 — 둘 다 본다(이 저장소의 관례). */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

export type AddProductModelKindShareDocInput = {
  productModelKind: ProductModelKind;
  entryKind: ShareDocEntryKind;
  /** 🔴 루트 기준 상대 경로. **들어온 글자 그대로** 담는다(머리말). */
  relativePath: string;
  /** 비면(NULL) 화면이 경로의 마지막 마디를 쓴다. 🔴 빈 문자열은 DB CHECK 가 막는다. */
  label: string | null;
  actorUserId: string;
};

/**
 * 가리킴 한 줄을 담는다. 줄과 감사 로그가 **한 트랜잭션**이다 — 담겼는데 기록이 없는
 * 상태가 생기지 않는다.
 */
export async function addProductModelKindShareDoc(
  input: AddProductModelKindShareDocInput
): Promise<ShareDocMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      // 유니크가 DB 에서도 막지만, 오류 문구를 사람이 읽을 수 있게 여기서 먼저 본다.
      const [duplicate] = await tx
        .select({ id: productModelKindShareDocs.id })
        .from(productModelKindShareDocs)
        .where(
          and(
            eq(productModelKindShareDocs.productModelKind, input.productModelKind),
            sql`${foldedPath(productModelKindShareDocs.relativePath)} = ${foldedPath(input.relativePath)}`
          )
        );
      if (duplicate) {
        return { ok: false as const, code: "DUPLICATE" as const, message: DUPLICATE_MESSAGE };
      }

      const [created] = await tx
        .insert(productModelKindShareDocs)
        .values({
          productModelKind: input.productModelKind,
          entryKind: input.entryKind,
          relativePath: input.relativePath,
          label: input.label,
          createdBy: input.actorUserId,
        })
        .returning({ id: productModelKindShareDocs.id });

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "CREATE",
        targetEntity: PRODUCT_MODEL_KIND_SHARE_DOCS_AUDIT_ENTITY,
        targetRecordId: created.id,
        newValue: {
          productModelKind: input.productModelKind,
          entryKind: input.entryKind,
          relativePath: input.relativePath,
          label: input.label,
        },
      });

      return { ok: true as const, id: created.id };
    });
  } catch (error) {
    // 먼저 본 뒤에 끼어든 요청이 같은 자리를 담았다 — 사람에게는 같은 말이어야 한다.
    if (isUniqueViolation(error)) {
      return { ok: false, code: "DUPLICATE", message: DUPLICATE_MESSAGE };
    }
    throw error;
  }
}

export type RemoveProductModelKindShareDocInput = {
  id: string;
  /**
   * 🔴 **그 종류의 줄인지 함께 본다.** 권한은 종류마다 다르지 않지만, 화면이 보낸
   * 종류와 줄의 종류가 어긋나면 그것은 「다른 칸을 지우고 있다」는 뜻이다 — 지우고
   * 엉뚱한 화면을 다시 그리느니 **없는 것과 같이** 답한다.
   */
  productModelKind: ProductModelKind;
  actorUserId: string;
};

/**
 * 가리킴 한 줄을 **정말로** 지운다(휴지통이 없다 — 머리말).
 *
 * 🔴 지우기 전에 줄을 통째로 읽어 `previous_value` 에 담는다. 그것이 유일한 흔적이다.
 */
export async function removeProductModelKindShareDoc(
  input: RemoveProductModelKindShareDocInput
): Promise<ShareDocMutationResult> {
  return db.transaction(async (tx) => {
    // 🔴 칸을 **이름으로 적어** 읽는다 — `select()` 전체 조회는 표에 칸이 느는 날
    //    적용 전까지 조용히 깨진다(이 저장소에서 겪었다).
    const [current] = await tx
      .select({
        id: productModelKindShareDocs.id,
        productModelKind: productModelKindShareDocs.productModelKind,
        entryKind: productModelKindShareDocs.entryKind,
        relativePath: productModelKindShareDocs.relativePath,
        label: productModelKindShareDocs.label,
        displayOrder: productModelKindShareDocs.displayOrder,
        createdBy: productModelKindShareDocs.createdBy,
        createdAt: productModelKindShareDocs.createdAt,
      })
      .from(productModelKindShareDocs)
      .where(
        and(
          eq(productModelKindShareDocs.id, input.id),
          eq(productModelKindShareDocs.productModelKind, input.productModelKind)
        )
      );
    if (!current) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: NOT_FOUND_MESSAGE };
    }

    const deleted = await tx
      .delete(productModelKindShareDocs)
      .where(eq(productModelKindShareDocs.id, input.id))
      .returning({ id: productModelKindShareDocs.id });
    if (deleted.length === 0) {
      // 읽은 뒤 누군가 먼저 지웠다 — 감사 로그를 두 번 남기지 않는다.
      return { ok: false as const, code: "NOT_FOUND" as const, message: NOT_FOUND_MESSAGE };
    }

    await insertAuditLog(tx, {
      actorUserId: input.actorUserId,
      actionType: "PURGE",
      targetEntity: PRODUCT_MODEL_KIND_SHARE_DOCS_AUDIT_ENTITY,
      targetRecordId: input.id,
      // 🔴 **지워진 줄을 통째로.** 되살리는 일은 이 값으로 한 줄을 다시 적는 일이다.
      previousValue: {
        id: current.id,
        productModelKind: current.productModelKind,
        entryKind: current.entryKind,
        relativePath: current.relativePath,
        label: current.label,
        displayOrder: current.displayOrder,
        createdBy: current.createdBy,
        createdAt: current.createdAt.toISOString(),
      },
      newValue: null,
    });

    return { ok: true as const, id: input.id };
  });
}
