import "server-only";

import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { attachments, users } from "../schema";
import { PRODUCT_MODEL_KIND_CODES, isProductModelKind, type ProductModelKind } from "@/lib/domain/product-model-kind";
import type {
  ProductModelAttachmentListItem,
  TrashedProductModelAttachmentListItem,
} from "./attachments";

/**
 * ============================================================================
 * 제품 **종류** 공통 서류함 — 종류 하나가 통째로 나눠 쓰는 서류의 조회 (2026-10-06)
 * ============================================================================
 * 모델 하나에 붙는 첨부(queries/attachments.ts 의 listAttachmentsForProductModel)와
 * **같은 모양으로 나란히 둔다.** 그쪽 파일에 끼워 넣지 않은 까닭은 그쪽 머리말이
 * 적어 둔 것과 같다 — 그 함수들은 실기에서 매번 쓰이는 길이고, 주인을 인자로 받게
 * 고치는 순간 이 조회를 손보는 다음 사람이 아무도 의도하지 않은 채 접수 건 · 모델
 * 파일 화면까지 흔들게 된다.
 *
 * ── 🔴 주인은 넷 중 **하나**다 — 이 파일이 지켜야 하는 규율 ───────────────
 * 첨부 표에는 주인 칸이 넷 있다(schema/attachments.ts):
 *
 *     repair_case_id · product_model_id · quote_id · product_model_kind
 *
 * 그리고 CHECK 셋이 「둘 이상이 동시에 차는 일」을 막는다. 이번 칸에 걸리는 것은
 * `attachments_kind_owner_alone` 이고, 그 조건은
 *
 *     product_model_kind IS NULL OR (repair_case_id IS NULL
 *                                    AND product_model_id IS NULL
 *                                    AND quote_id IS NULL)
 *
 * 이다 — 즉 **종류 서류를 만들 때 나머지 세 칸은 반드시 NULL 이어야 한다.** 그래서
 * 아래 조회들은 `product_model_kind = ?` 하나만 걸어도 다른 주인의 파일을 집어
 * 오지 않는다. 섞일 수 있는 행 자체가 DB 에서 만들어지지 않는다.
 *
 * ── 조건절의 모양은 부분 인덱스가 정한다 ─────────────────────────────────
 * `WHERE product_model_kind = ? AND is_deleted = false` **그대로** 적는다. 이
 * 모양이어야 attachments_product_model_kind_not_deleted_idx(부분 인덱스,
 * `WHERE is_deleted = false`)를 탄다 — 조건에서 is_deleted 를 빼거나 변수로
 * 바꾸면 인덱스가 빠지고 휴지통 행까지 훑는 조회가 된다. 휴지통 목록을 **별도
 * 함수**로 둔 것도 앞의 세 주인과 같은 까닭이다.
 *
 * ── 돌려주는 모양은 모델 첨부와 같다 ─────────────────────────────────────
 * 화면(ProductModelKindFilesScreen)이 모델 파일 구역을 본떠 만들어졌고, 사진 크게
 * 보기(AttachmentViewer)와 지우기·되살리기 확인 창을 **고치지 않고 그대로** 쓴다.
 * 타입을 복제하면 한쪽만 바뀌는 날 두 화면이 다른 것을 보여 주므로 별칭으로 둔다.
 * 원본 수정일(original_modified_at)을 함께 싣는 것도 그쪽과 같다 — 「이 양식이
 * 언제 갱신된 것인가」가 중요한 서류라서 이 값을 싣는 통로를 같이 열었다.
 * ============================================================================
 */

export type ProductModelKindAttachmentListItem = ProductModelAttachmentListItem;
export type TrashedProductModelKindAttachmentListItem = TrashedProductModelAttachmentListItem;

/** 종류별 서류 수 — 키는 종류 코드 전부, 값은 안 지워진 서류의 수. */
export type ProductModelKindAttachmentCounts = Record<ProductModelKind, number>;

/**
 * 이 종류에 올라와 있는 서류(휴지통에 있는 것은 뺀다).
 *
 * 종류 코드가 셋 중 하나가 아니면 **빈 배열**이다 — 이웃 조회들이 UUID 모양이
 * 아닌 값에 그러는 것과 같은 규율이다(queries/attachments.ts). 셋 중 하나인지는
 * 화면과 통로가 이미 404 · 400 으로 거절하지만, 조회가 스스로도 좁힌다.
 */
export async function listAttachmentsForProductModelKind(
  kind: string
): Promise<ProductModelKindAttachmentListItem[]> {
  if (!isProductModelKind(kind)) return [];

  const rows = await db
    .select({
      id: attachments.id,
      category: attachments.category,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      previewPath: attachments.previewPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      malwareScanStatus: attachments.malwareScanStatus,
      description: attachments.description,
      uploadedById: attachments.uploadedBy,
      uploadedByName: users.name,
      uploadedAt: attachments.uploadedAt,
      originalModifiedAt: attachments.originalModifiedAt,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    // 🔴 부분 인덱스를 타는 모양 그대로다(파일 머리말). is_deleted = false 를 빼면
    // 지워진 서류가 목록에 다시 나타난다.
    .where(and(eq(attachments.productModelKind, kind), eq(attachments.isDeleted, false)))
    .orderBy(desc(attachments.uploadedAt));

  return rows.map((row) => ({
    ...row,
    uploadedAt: row.uploadedAt.toISOString(),
    // 모르는 파일은 null 그대로다 — 올린 날짜로 메우면 화면이 아무 오류 없이
    // 거짓을 말한다(모델 첨부 조회와 같은 규율).
    originalModifiedAt: row.originalModifiedAt?.toISOString() ?? null,
  }));
}

/**
 * 휴지통에 든 종류 서류. 앞의 주인들과 같은 이유로 목록 조회와 분리했고,
 * `deleted_by` 가 nullable 이라 LEFT JOIN 인 것도 같다 — 지운 사람을 알 수 없는
 * 행이 화면에서 사라지면 되살릴 방법이 없다.
 */
export async function listTrashedAttachmentsForProductModelKind(
  kind: string
): Promise<TrashedProductModelKindAttachmentListItem[]> {
  if (!isProductModelKind(kind)) return [];

  const deleter = alias(users, "deleter");

  const rows = await db
    .select({
      id: attachments.id,
      category: attachments.category,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      previewPath: attachments.previewPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      malwareScanStatus: attachments.malwareScanStatus,
      description: attachments.description,
      uploadedById: attachments.uploadedBy,
      uploadedByName: users.name,
      uploadedAt: attachments.uploadedAt,
      deletedAt: attachments.deletedAt,
      deletedByName: deleter.name,
      deleteReason: attachments.deleteReason,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    .leftJoin(deleter, eq(deleter.id, attachments.deletedBy))
    .where(and(eq(attachments.productModelKind, kind), eq(attachments.isDeleted, true)))
    .orderBy(desc(attachments.deletedAt));

  return rows.map((row) => ({
    ...row,
    uploadedAt: row.uploadedAt.toISOString(),
    // 앞의 주인들과 같은 방어 — is_deleted = true 인 행이므로 deleted_at 은 채워져
    // 있지만, 비어 있어도 화면이 깨지지 않아야 되살릴 수 있다.
    deletedAt: (row.deletedAt ?? row.uploadedAt).toISOString(),
  }));
}

/**
 * 종류마다 올라와 있는 서류 수 — 「제품 모델 관리」 목록 위의 입구가 쓴다.
 *
 * 🔴 **세는 일은 서버에서 한 번에 끝낸다.** 종류마다 조회를 세 번 쏘지 않고 한
 * 질의로 묶는다(GROUP BY). 화면이 목록을 받아 다시 세는 길도 두지 않는다 —
 * 그러면 서류 수를 보려고 서류 목록 전부를 브라우저까지 실어 보내게 된다.
 *
 * 한 건도 없는 종류는 GROUP BY 결과에 아예 나오지 않으므로 **0 으로 채워 둔 표에
 * 덮어쓴다.** 그래야 키가 늘 셋이고, 화면이 「없는 종류」와 「0건인 종류」를
 * 가릴 필요가 없다.
 */
export async function countAttachmentsByProductModelKind(): Promise<ProductModelKindAttachmentCounts> {
  const counts = Object.fromEntries(
    PRODUCT_MODEL_KIND_CODES.map((code) => [code, 0])
  ) as ProductModelKindAttachmentCounts;

  const rows = await db
    .select({ kind: attachments.productModelKind, value: count() })
    .from(attachments)
    .where(
      and(
        // 휴지통에 있는 서류는 세지 않는다 — 입구의 숫자와 서류함을 열었을 때
        // 보이는 줄 수가 달라지면 안 된다. 부분 인덱스와 같은 조건이다.
        eq(attachments.isDeleted, false),
        // 🔴 이 한 줄이 **표의 거의 전부를 건너뛴다.** 이 칸은 주인이 종류일 때만
        // 차고, 첨부의 대부분은 접수 건 · 모델 · 견적서의 것이라 NULL 이다. 빼면
        // 그 NULL 들이 한 덩어리로 묶여 돌아오고(쓰이지도 않는 값이다) 세는 일이
        // 표 크기를 따라 커진다.
        isNotNull(attachments.productModelKind)
      )
    )
    .groupBy(attachments.productModelKind);

  for (const row of rows) {
    // 목록 밖의 값이 DB 에 있을 수는 없지만(enum 이 막는다) 표에 없는 키로 칸을
    // 만들지 않는다 — 화면은 키가 늘 셋이라고 믿는다.
    if (row.kind !== null && isProductModelKind(row.kind)) {
      counts[row.kind] = Number(row.value);
    }
  }

  return counts;
}
