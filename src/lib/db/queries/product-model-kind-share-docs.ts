import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { productModelKindShareDocs, users } from "../schema";
import { isProductModelKind } from "@/lib/domain/product-model-kind";

/**
 * ============================================================================
 * 제품 종류별 **공유폴더 가리킴** 조회 — 「이 종류가 가리키는 자리들」 (2026-10-07)
 * ============================================================================
 * 한 줄은 「이 종류의 공통 서류는 사내 공유폴더의 **저기** 있다」는 가리킴 하나다.
 * **파일도 사본도 들어오지 않는다** — 실물은 공유폴더에 그대로 있다
 * (schema/product-model-kind-share-docs.ts 머리말).
 *
 * 쓰는 자리는 둘이다: 「제품 모델 관리」의 종류 서류함 화면과, 수리 건 상세에서 그
 * 건의 종류로 여는 칸. 둘 다 **같은 차례**로 본다.
 *
 * ── 🔴 차례는 `display_order, created_at` 이다 ────────────────────────────
 * 표에 그 차례 그대로의 인덱스가 서 있다
 * (`product_model_kind_share_docs_kind_order_idx`). `display_order` 가 NULL 인 줄은
 * **PostgreSQL 의 ASC 가 뒤로 보낸다**(NULLS LAST) — 차례를 정해 둔 줄이 먼저 오고
 * 나머지가 등록 순으로 따라온다. 🔴 **JS 로 다시 정렬하지 않는다**: 한글 이름의
 * 정렬 규칙이 postgres 와 달라, 고친 것도 없는데 차례가 바뀐다.
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

export type ProductModelKindShareDocListItem = {
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
 * 한 종류의 가리킴 전부를 **보이는 차례 그대로**.
 *
 * 종류 코드가 셋 중 하나가 아니면 **빈 배열**이다 — 이웃 조회들이 목록 밖의 값에
 * 그러는 것과 같은 규율이다(queries/product-model-kind-attachments.ts). 셋 중
 * 하나인지는 화면과 통로가 이미 404 · 400 으로 거절하지만, 조회가 스스로도 좁힌다.
 */
export async function listShareDocsForProductModelKind(
  kind: string
): Promise<ProductModelKindShareDocListItem[]> {
  if (!isProductModelKind(kind)) return [];

  const rows = await db
    .select({
      id: productModelKindShareDocs.id,
      entryKind: productModelKindShareDocs.entryKind,
      relativePath: productModelKindShareDocs.relativePath,
      label: productModelKindShareDocs.label,
      displayOrder: productModelKindShareDocs.displayOrder,
      createdById: productModelKindShareDocs.createdBy,
      createdByName: users.name,
      createdAt: productModelKindShareDocs.createdAt,
    })
    .from(productModelKindShareDocs)
    // 적어 둔 사람은 RESTRICT FK 라 반드시 살아 있는 행이다 — INNER JOIN 으로 족하다.
    .innerJoin(users, eq(users.id, productModelKindShareDocs.createdBy))
    .where(eq(productModelKindShareDocs.productModelKind, kind))
    // 🔴 인덱스에 적힌 차례 그대로다(머리말). NULL 은 postgres 가 뒤로 보낸다.
    .orderBy(asc(productModelKindShareDocs.displayOrder), asc(productModelKindShareDocs.createdAt));

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
