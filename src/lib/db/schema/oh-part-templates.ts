import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { parts } from "./inventory";
import { productModels } from "./product-models";
import { users } from "./users";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 기종마다 "오버홀이면 이 부품들"
 * ============================================================================
 * 지금은 이 목록이 **견적서 OH 양식의 숨은 열**에 산다(`OH견적서` 시트 P~AD열
 * 34~46행, `K11` 에 기종 코드를 넣으면 IFS 로 그 기종 것이 나타난다). 그
 * 방식의 문제는 셋이다:
 *
 *  1. 부품을 하나 고치려면 **숨긴 열을 다시 펴서** 엑셀을 고쳐야 한다.
 *  2. 기종이 늘면 수식(`IFS`)을 직접 고쳐야 하고, 실제로 목록에 있는 `302` 는
 *     그 수식에 빠져 있어 **고르면 빈칸이 나온다.**
 *  3. 재고(`parts`)와 이어져 있지 않아, 부품 요청을 넣을 때 사람이 이름을 보고
 *     다시 찾아야 한다.
 *
 * 그래서 자기 표로 옮긴다. 옮기고 나면 **재고 관리 화면에서 고칠 수 있고**,
 * 부품 요청에서 한 번에 담을 수 있다.
 *
 * ── 기종 코드는 사람이 잇는다 ───────────────────────────────────────────
 * `15 · 20 · 301 · 302` 가 어느 제품 모델인지는 코드가 알 수 없다(사용자도
 * 자동 대응은 두지 않기로 했다). 그래서 oh_part_template_models 로 **사람이
 * 직접 잇는다.** 모델 하나는 템플릿 하나에만 붙는다 — 두 템플릿에 걸리면
 * "이 모델의 O/H 부품"이 두 가지가 되어 어느 쪽을 담을지 답할 수 없다.
 *
 * ── 부품 연결은 있으면 좋은 것이지 필수가 아니다 ────────────────────────
 * `part_id` 는 NULL 을 허용한다. 양식에서 옮겨 온 이름 중에는 재고 마스터에
 * 없는 것이 있고(`유량계` 처럼), 그렇다고 그 줄을 버리면 템플릿이 반쪽이 된다.
 * 연결이 없으면 부품 요청에 담을 때 **이름만 담고 사람에게 알린다.**
 *
 * ── 삭제는 소프트다 ─────────────────────────────────────────────────────
 * 템플릿은 사람이 만든 설정이고 되돌릴 수 있어야 한다. 항목(items)과 모델 연결은
 * 템플릿에 딸린 값이라 ON DELETE CASCADE 이고, 소프트 삭제일 때는 돌지 않는다
 * (domestic_order_due_dates 와 같은 판단).
 * ============================================================================
 */
export const ohPartTemplates = pgTable(
  "oh_part_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 양식의 `K11` 에 넣던 기종 코드(15 · 20 · 301 · 302). 숫자로 보이지만
     * **글자로 둔다** — 사람이 정한 분류표의 이름이지 셈하는 값이 아니고,
     * 앞으로 `301A` 같은 것이 생기지 못할 이유가 없다.
     */
    code: text("code").notNull(),
    /** 사람이 알아보는 이름. 코드만으로는 무엇인지 알 수 없다. */
    name: text("name").notNull(),
    note: text("note"),

    version: integer("version").notNull().default(1),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    // 지운 템플릿의 코드는 다시 쓸 수 있다 — 이 저장소의 부분 unique 관례
    // (quotes 의 발행번호와 같은 모양).
    uniqueIndex("oh_part_templates_code_not_deleted_unique")
      .on(table.code)
      .where(sql`is_deleted = false`),
  ]
);

/**
 * 템플릿에 든 부품 한 줄. 차례(display_order)는 **폼에 늘어놓은 순서**이고,
 * 저장하는 쪽이 1부터 매긴다 — 양식의 부품 순서가 그대로 뜻을 갖는다
 * (휴즈 22개가 셋째 줄인 것에는 이유가 있다).
 */
export const ohPartTemplateItems = pgTable(
  "oh_part_template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => ohPartTemplates.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    /**
     * 재고 마스터 연결. **NULL 이 정상이다**(파일 머리말의 '있으면 좋은 것').
     * RESTRICT 는 이 저장소가 parts 를 가리키는 다른 표들과 같은 규칙이고,
     * parts 가 소프트 삭제를 쓰므로 실제로 막힐 일은 없다.
     */
    partId: uuid("part_id").references(() => parts.id, { onDelete: "restrict" }),
    /** 양식에 적혀 있던 이름 그대로. part_id 가 있어도 이 칸을 쓴다. */
    partNameText: text("part_name_text").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oh_part_template_items_template_order_unique").on(table.templateId, table.displayOrder),
    index("oh_part_template_items_template_id_idx").on(table.templateId),
    index("oh_part_template_items_part_id_idx").on(table.partId),
    check("oh_part_template_items_quantity_positive", sql`${table.quantity} > 0`),
  ]
);

/**
 * 제품 모델 ↔ 템플릿. 사람이 재고 관리 화면에서 잇는다(파일 머리말).
 *
 * `product_model_id` 에 unique 를 거는 것이 이 표의 요점이다 — 모델 하나는
 * 템플릿 하나에만 붙는다. 둘에 걸리면 "이 모델의 O/H 부품"이 두 가지가 되고,
 * 부품 요청에서 무엇을 담을지 답할 수 없다.
 */
export const ohPartTemplateModels = pgTable(
  "oh_part_template_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => ohPartTemplates.id, { onDelete: "cascade" }),
    productModelId: uuid("product_model_id")
      .notNull()
      .references(() => productModels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("oh_part_template_models_model_unique").on(table.productModelId),
    index("oh_part_template_models_template_id_idx").on(table.templateId),
  ]
);
