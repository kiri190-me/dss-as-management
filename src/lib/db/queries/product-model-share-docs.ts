import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "../client";
import { productModelShareDocs, productModels, users } from "../schema";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * ============================================================================
 * 제품 **모델별** 공유폴더 가리킴 조회 — 「이 모델이 가리키는 자리들」 (2026-10-07)
 * ============================================================================
 * 한 줄은 「이 모델(예: MBK200-JS2)의 서류는 사내 공유폴더의 **저기** 있다」는 가리킴
 * 하나다. **파일도 사본도 들어오지 않는다** — 실물은 공유폴더에 그대로 있다
 * (schema/product-model-share-docs.ts 머리말).
 *
 * 종류별 조회(queries/product-model-kind-share-docs.ts)와 **주인만 다르다.** 저쪽
 * 주인은 enum 값이고 이쪽 주인은 `product_models` 의 **행**이다. 그 한 가지 차이가
 * 아래 두 가지를 낳는다:
 *  · 주인이 있는지 **DB 에 물어야** 한다(저쪽은 `isProductModelKind` 한 줄이었다).
 *  · 주인이 **휴지통에 들어갈 수 있다** — 그때는 없는 것과 같이 다룬다(아래 함수).
 *
 * ── 🔴 차례는 `display_order, created_at` 이다 ────────────────────────────
 * 표에 그 차례 그대로의 인덱스가 서 있다(`product_model_share_docs_model_order_idx`).
 * `display_order` 가 NULL 인 줄은 **PostgreSQL 의 ASC 가 뒤로 보낸다**(NULLS LAST) —
 * 차례를 정해 둔 줄이 먼저 오고 나머지가 등록 순으로 따라온다. 🔴 **JS 로 다시
 * 정렬하지 않는다**: 한글 이름의 정렬 규칙이 postgres 와 달라, 고친 것도 없는데
 * 차례가 바뀐다.
 *
 * ── 🔴 루트를 모른다 ─────────────────────────────────────────────────────
 * 돌려주는 것은 **루트 기준 상대 경로**뿐이다. 루트는 설정값 하나이고
 * (storage/repair-docs-archive.ts), 그것을 이어 붙이는 일은 화면도 이 조회도 하지
 * 않는다 — 여는 쪽(탐색기 도우미)이 제 손에 든 루트로 잇는다.
 *
 * ── 이름이 비면 화면이 경로의 마지막 마디를 쓴다 ─────────────────────────
 * `label` 은 NULL 일 수 있고, 빈 문자열은 DB CHECK 가 막는다. 그래서 여기서도
 * **NULL 을 그대로** 내보낸다 — 조회가 경로에서 이름을 지어내면 「사람이 적은
 * 이름」과 「없어서 대신 쓴 이름」을 화면이 가릴 수 없다.
 * ============================================================================
 */

export type ProductModelShareDocListItem = {
  id: string;
  /** `FILE` · `FOLDER` — 여는 쪽의 동작이 갈린다(파일은 연결 프로그램, 폴더는 탐색기). */
  entryKind: "FILE" | "FOLDER";
  /** 🔴 공유폴더 루트 **기준 상대 경로**. 마디 구분은 `/` 다. */
  relativePath: string;
  /** 사람이 붙인 이름. 🔴 **NULL 이면 화면이 경로의 마지막 마디를 쓴다**(위 머리말). */
  label: string | null;
  displayOrder: number | null;
  createdById: string;
  createdByName: string;
  /** ISO 문자열 — 화면이 Date 를 직렬화하다 깨지지 않게 여기서 바꾼다. */
  createdAt: string;
};

/**
 * 가리킴을 **담고 지우고 고를** 수 있는 모델인가.
 *
 * 🔴 **휴지통에 있는 모델은 없는 것과 같다.** 버려진 모델에 자리를 담으면 아무도
 * 보지 않는 줄이 남고, 15일 뒤 자동 정리가 모델을 지울 때 함께 사라진다
 * (mutations/master-data-purge.ts 의 purgeExpiredProductModel). 그 줄을 만들 길을
 * 여기서 막는다.
 *
 * 판정은 모델 첨부 올리기가 쓰는 것과 **같은 조건**이다
 * (queries/attachments.ts 의 getProductModelAttachmentUploadTarget:
 * `id = ? AND is_deleted = false`). 그 함수를 빌려 쓰지 않고 같은 조건을 여기 두는
 * 까닭은 이름이다 — 「첨부 올리기가 향할 모델」과 「가리킴을 담을 모델」은 같은
 * 조건을 쓰는 **다른 물음**이고, 한쪽의 조건이 바뀌는 날 다른 쪽이 조용히 따라가면
 * 안 된다(통로 머리말의 「왜 공통 함수로 뽑지 않고 나란히 두는가」와 같은 판단).
 *
 * UUID 모양이 아니면 **DB 를 묻지 않는다** — 없는 것과 같은 답이다.
 */
export async function getShareDocProductModel(productModelId: string): Promise<{ id: string } | null> {
  if (!isValidUuid(productModelId)) return null;

  const [row] = await db
    .select({ id: productModels.id })
    .from(productModels)
    .where(and(eq(productModels.id, productModelId), eq(productModels.isDeleted, false)))
    .limit(1);

  return row ?? null;
}

/**
 * 한 모델의 가리킴 전부를 **보이는 차례 그대로**.
 *
 * UUID 모양이 아니면 **빈 배열**이다 — 이웃 조회들이 목록 밖의 값에 그러는 것과 같은
 * 규율이다(queries/product-model-kind-share-docs.ts 는 종류 코드에 그렇게 한다).
 *
 * 🔴 **모델이 휴지통에 있는지는 여기서 보지 않는다.** 이 함수는 「그 모델의 줄」을
 * 그대로 돌려준다 — 휴지통에 든 모델을 여는 화면(휴지통·감사)이 그 줄을 보아야 할 수
 * 있고, 담고 지우는 길은 위 `getShareDocProductModel` 이 이미 막는다. 읽기와 쓰기의
 * 문턱을 섞지 않는다.
 */
export async function listShareDocsForProductModel(
  productModelId: string
): Promise<ProductModelShareDocListItem[]> {
  if (!isValidUuid(productModelId)) return [];

  const rows = await db
    .select({
      id: productModelShareDocs.id,
      entryKind: productModelShareDocs.entryKind,
      relativePath: productModelShareDocs.relativePath,
      label: productModelShareDocs.label,
      displayOrder: productModelShareDocs.displayOrder,
      createdById: productModelShareDocs.createdBy,
      createdByName: users.name,
      createdAt: productModelShareDocs.createdAt,
    })
    .from(productModelShareDocs)
    // 적어 둔 사람은 RESTRICT FK 라 반드시 살아 있는 행이다 — INNER JOIN 으로 족하다.
    .innerJoin(users, eq(users.id, productModelShareDocs.createdBy))
    .where(eq(productModelShareDocs.productModelId, productModelId))
    // 🔴 인덱스에 적힌 차례 그대로다(머리말). NULL 은 postgres 가 뒤로 보낸다.
    .orderBy(asc(productModelShareDocs.displayOrder), asc(productModelShareDocs.createdAt));

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
