import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./inventory";
import { repairCases } from "./repair-cases";

/**
 * ============================================================================
 * 수리 건에서 쓴 부품 — "이 건에서 무엇을 갈았나"
 * ============================================================================
 * 통계를 내려다 없는 것이 드러나서 생긴 표다. domain/product-model-breakdown.ts
 * 의 머리말이 그 사정을 이미 적어 두었다 — **"이 시스템에는 '이 건에서 뭐가
 * 고장났나'를 적는 칸이 없다. 가장 가까운 것이 수리하며 요청한 부품이라 그것을
 * 쓰는데 … 부품 요청 기록이 아예 없는 건이 훨씬 많다."**
 *
 * 실측(개발 DB, 2026-09-17):
 *
 *     수리 건                       216건
 *     신고증상이 있는 건            213건 (99%)
 *     부품 요청 기록이 있는 건       36건 (17%)
 *
 * `신고증상별 교환 부품`은 두 축을 곱하는 그림인데 한 축이 99%, 다른 축이 17%
 * 다. 그 상태로 그린 원은 부품 그래프가 아니라 **"부품을 요청서로 받아 간 36건의
 * 그래프"** 이고, 보는 사람은 그 차이를 알 길이 없다. 그래서 사람이 손으로 적을
 * 자리를 만든다.
 *
 * ── 이 표는 원장이 아니라 사람이 적는 기록이다 ──────────────────────────
 * 재고를 움직이지 않는다. 부품을 실제로 꺼내 간 사실은
 * inventory_part_requests · inventory_part_request_items · stock_transactions
 * 가 이미 갖고 있고, 그쪽이 수량·잔량·승인의 원장이다. 이 표는 **그 원장이 비어
 * 있는 건**에 "그래도 이건 갈았다"를 남기는 자리다. 여기에 줄을 넣어도 잔량은
 * 1도 변하지 않는다.
 *
 * 그래서 규칙이 이렇다(사용자 확정):
 *   · **반출 이력이 없는 모든 건**에 적을 수 있다 — 단계와 무관하다. 출하가 끝난
 *     옛 건이야말로 통계에 필요한 자료이므로 단계로 막으면 뜻이 없다.
 *   · 반출 이력이 **있으면** 적을 필요가 없다 — 원장이 이미 답을 갖고 있다.
 *
 * 🔴 **이 둘은 DB 제약이 아니다.** 여기서 막으면 "요청서를 나중에 낸 건"이 이미
 * 적어 둔 줄 때문에 거절되거나, 반대로 이미 있는 줄이 갑자기 위법해진다. 어느
 * 건에 적을 수 있는지는 다음 조각의 화면과 mutation 이 정한다 — 이 표는 그 판단의
 * 결과만 담는다.
 *
 * ── 🔴 왜 part_id 와 part_name_text 를 함께 두는가 ──────────────────────
 * quote_items(schema/quotes.ts)가 쓰는 방식 그대로다. 이 표도 부모에 딸린 줄
 * 목록이라 같은 부류다.
 *
 *   · part_id — 부품 마스터(parts, 76개)에서 고른 것. **통계가 목적이라 같은
 *     부품이 같은 것으로 묶여야 한다.** 글자만 있으면 `RF 모듈` · `RF모듈` ·
 *     `RF module` 이 서로 다른 조각이 되어 원이 부스러진다.
 *   · part_name_text — NOT NULL. 마스터에 없는 부품을 적을 자리다. 옛 건에는
 *     지금 마스터에 없는 부품이 실제로 나오고, part_id 를 NOT NULL 로 두면 그런
 *     건은 **적을 자리가 없어진다** — 그러면 이 표를 만든 까닭이 사라진다.
 *
 * part_id 가 있어도 part_name_text 를 채운다. 마스터의 품명이 나중에 바뀌어도
 * 그때 적은 글자는 남아야 하고, 목록을 조인 없이 그릴 수 있다. quote_items 의
 * 같은 칸이 같은 이유로 그렇게 돼 있다.
 *
 * FK 가 RESTRICT 인 것도 그쪽과 같다 — parts 를 가리키는 이 저장소의 표들이
 * 전부 RESTRICT 이고, parts 자체가 소프트 삭제를 쓰므로 평소에 막힐 일이 없다.
 *
 * 🔴 다만 **완전삭제(purge)에는 이미 있는 틈이 하나 있고, 이 표가 그 틈을 하나
 * 넓힌다.** mutations/master-data-purge.ts 의 purgeExpiredPart 는 부품을 지우기
 * 전에 stock_transactions 와 inventory_part_request_items 두 곳만 세어 보고
 * SKIPPED_REFERENCED 를 돌려준다 — **quote_items.part_id 는 세지 않는다.** 견적서
 * 줄이 가리키는 부품이 보관기간을 넘기면 그 함수는 얌전히 건너뛰는 대신 23503 으로
 * 터진다. 이 표도 같은 처지가 된다. 지금 고치지 않는 것은 이 조각이 표까지이기
 * 때문이고, 고칠 곳은 그 함수의 세는 목록 한 곳이다(지시서 범위 밖이라 보고만 한다).
 *
 * ── 🔴 왜 ON DELETE CASCADE 인가 ────────────────────────────────────────
 * repair_case_id 를 참조하는 표들이 둘로 갈린다(직접 확인한 것):
 *
 *   · SET NULL — 건이 사라져도 남아야 하는 원장: inventory_part_requests ·
 *     repair_case_work_records · stock_transactions · quotes · attachments ·
 *     domestic_orders · status_change_histories …
 *   · CASCADE — 건이 없으면 뜻이 없는 기록:
 *     repair_case_billing_decision_histories · repair_case_customer_status ·
 *     service_reports · weekly_report_*
 *
 * 이 표는 **뒤쪽**이다. 여기 적힌 부품은 그 자체로는 아무것도 아니고 **그 건의
 * 신고증상과 짝지어야** 뜻이 생긴다. 건이 사라지면 짝지을 증상이 없어져 통계에
 * 쓸 수 없는, 주인 없는 부품 이름만 남는다. 재고를 움직인 사실은 위 원장들이 따로
 * 갖고 있으므로 이 줄이 함께 사라져도 잃는 사실이 없다.
 *
 * 그리고 CASCADE 로 두면 기존 완전삭제 경로들이 **이 표를 몰라도 그대로 돈다** —
 * 접수 건 영구삭제와 mutations/master-data-purge.ts 가 한 줄도 바뀌지 않는다.
 * RESTRICT 로 걸면 부품을 한 줄이라도 적은 건은 영영 완전삭제가 안 되고, 그걸
 * 피하려면 그 경로들을 전부 고친 뒤 **다음 사람이 그 고침을 기억해 주기를 기대
 * 해야 한다.** schema/product-model-customers.ts 가 같은 근거로 같은 결론을 냈고
 * (그 머리말 '왜 양쪽 다 ON DELETE CASCADE인가'), part_minimum_quantities 도 같다.
 *
 * ── 왜 소프트 삭제 4칸이 없나 ───────────────────────────────────────────
 * DATABASE_DESIGN.md #8 의 4칸(is_deleted · deleted_at · deleted_by ·
 * delete_reason)을 두지 않는다. **quote_items 에도 없다.** 부모에 딸린 줄 목록
 * 에서 줄을 빼는 것은 되살릴 것이 있는 삭제가 아니라 **목록을 고치는 일**이고,
 * 적어 둔 부품 셋 중 하나를 잘못 적어 뺐다면 다시 넣으면 그만이다. 소프트 삭제는
 * 부모(수리 건)가 이미 지고 있고, 건이 휴지통에 들어가면 그 건의 줄도 함께
 * 통계에서 빠진다 — 읽는 쪽이 repair_cases.is_deleted = false 로 거르면 된다.
 *
 * 그 관례는 사람이 만든 **마스터 자료**(고객사 · 모델 · 부품처럼 실수로 지웠을 때
 * 되살릴 것이 있는 행)에 적용되는 것이다. 여기 적용하면 통계를 내는 모든 질의가
 * 조건 하나를 더 달아야 하고, 어느 날 빠뜨린 질의 하나만 숫자가 달라진다.
 * ============================================================================
 */
export const repairCaseUsedParts = pgTable(
  "repair_case_used_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "cascade" }),
    /** 사람이 폼에 늘어놓은 차례. 저장할 때 1부터 다시 매긴다 — quote_items.line_no 와 같다. */
    lineNo: integer("line_no").notNull(),
    /**
     * 부품 마스터에서 고른 것. **NULL 이 정상이다** — 마스터에 없는 부품을 글자로
     * 적는 길이 이 표의 존재 이유 절반이다. 위 머리말 '왜 part_id 와
     * part_name_text 를 함께 두는가' 참조.
     */
    partId: uuid("part_id").references(() => parts.id, { onDelete: "restrict" }),
    /**
     * 화면에 보이고 통계에 묶이는 글자. part_id 를 골랐어도 채운다 — 마스터의
     * 품명이 나중에 바뀌어도 그때 적은 것은 그대로여야 하고, 목록이 조인 없이
     * 그려진다(quote_items.part_name_text 와 같은 까닭).
     */
    partNameText: text("part_name_text").notNull(),
    /**
     * 몇 개를 갈았나. 사용자가 "수량도 적는다"로 정했다.
     *
     * NOT NULL 이고 0보다 커야 한다 — quote_items 쪽이 NULL 을 허용하게 된 것은
     * 금액 없는 **설명 줄** 하나 때문이었고(schema/quotes.ts 의 quoteItemKindEnum
     * 머리말), 이 표에는 그런 줄이 없다. 0개 갈았다는 줄은 적지 않은 것과 같으므로
     * 들어올 길을 열어 두지 않는다.
     */
    quantity: integer("quantity").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * 한 건 안에서 줄 번호는 겹치지 않는다. 두 사람이 같은 건을 동시에 저장하는
     * 경쟁은 여기서만 막힌다 — quote_items_quote_id_line_no_unique 와 같은 모양이다.
     *
     * repair_case_id 단독 인덱스를 따로 두지 않은 것은 이 유니크 인덱스의 **앞
     * 칼럼이 repair_case_id** 라 건별 조회가 그대로 이 인덱스를 탄다.
     */
    uniqueIndex("repair_case_used_parts_repair_case_id_line_no_unique").on(table.repairCaseId, table.lineNo),
    /** 부품 하나가 어느 건들에 쓰였나 — 통계가 이쪽으로도 모은다. */
    index("repair_case_used_parts_part_id_idx").on(table.partId),
    /** 수량은 0 이하일 수 없다. 이름 짓는 방식은 quote_items_quantity_positive 를 따랐다. */
    check("repair_case_used_parts_quantity_positive", sql`${table.quantity} > 0`),
  ]
);
