import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { productModels } from "./product-models";

/**
 * ============================================================================
 * 제품 모델 × 고객사 — "이 모델은 어느 고객사의 것인가"
 * ============================================================================
 * 모델 상세의 `모델 기본정보`에 있던 `제조사` 자리를 `고객사`로 바꾸기로 하면서
 * 생긴 표다. 여기 담기는 것은 접수 건의 기록이 아니라 **모델 마스터에 사람이
 * 골라 둔 설정**이다 — 접수 건이 한 건도 없는 모델에도 고객사를 미리 붙여 둘 수
 * 있고, 접수 건이 생겼다고 해서 여기에 줄이 저절로 늘지도 않는다.
 *
 * ── 🔴 왜 product_models에 customer_id 칸을 하나 더하지 않았나 ──────────
 * 실제 접수 기록을 세어 본 결과, 한 모델이 여러 고객사에 걸쳐 있다:
 *
 *     TG-100 · TG-300 · TG-200          → 각 4곳
 *     TG-350 · TG-150 · TG-250          → 각 2곳
 *     CFK200FH-IC3 · CMK200M-IC2A ·
 *     MBK200-JS3                        → 각 1곳
 *
 * 칸을 하나 두면 TG-100은 4곳 중 하나만 남고 나머지 셋은 **적을 자리가 없다.**
 * "여러 곳"은 나중에 생길지도 모르는 가정이 아니라 지금 자료에 이미 있는
 * 사실이므로, 모델과 고객사를 잇는 표를 따로 둔다.
 *
 * (`product_models.manufacturer`는 이 단계에서 건드리지 않는다. 실측상 104개 중
 * 25개만 값이 있고 그마저 전부 데모 자료지만, 칸을 지우는 것은 되돌릴 수 없는
 * 조작이라 이 마이그레이션에 섞지 않는다 — 더하기만 한다.)
 *
 * ── 🔴 왜 양쪽 다 ON DELETE CASCADE인가 ─────────────────────────────────
 * 완전삭제 경로들은 **이 표의 존재를 모른다.** 직접 읽어 확인한 것:
 *
 *   · mutations/customers-trash.ts의 permanentlyDeleteCustomer — 담당자 →
 *     End-User → 고객사 순으로 손수 지운다. 그 주석에 "삭제 순서는 취향이 아니라
 *     FK RESTRICT가 강제한다"고 적혀 있다.
 *   · mutations/master-data-purge.ts의 purgeExpiredCustomer /
 *     purgeExpiredProductModel — 같은 순서를 자동 정리(purge:master-data)에서
 *     다시 적는다.
 *   · mutations/product-models-trash.ts의 permanentlyDeleteProductModel —
 *     products를 지우고 모델을 지운다.
 *
 * RESTRICT로 걸면: 모델에 **한 번이라도** 연결된 적 있는 고객사는 영영
 * 완전삭제가 안 된다. permanentlyDeleteCustomer가 23503으로 터지고, 매일 도는
 * 자동 정리는 아무도 보지 않는 로그 안에서 거기서 멈춘다. 그걸 피하려면 위
 * 네 경로를 전부 고쳐야 하는데, 그 고침을 다음 사람이 기억해 주기를 기대하는
 * 설계다.
 *
 * CASCADE로 걸면: 고객사(또는 모델)가 사라질 때 연결도 함께 사라지고, 위
 * 경로들은 한 줄도 고치지 않은 채 뜻대로 동작한다. 연결은 사람이 화면에서 다시
 * 고르면 되는 **설정값**이지 원장이 아니므로 이쪽이 맞다.
 *
 * part_minimum_quantities(schema/part-minimum-quantities.ts)가 정확히 같은
 * 근거로 같은 결론을 냈다. 그쪽도 "이 표를 모르는 완전삭제 경로가 23503에
 * 걸린다"가 CASCADE의 이유였다.
 *
 * ── 왜 소프트 삭제 4칸이 없나 ───────────────────────────────────────────
 * 이 표는 "지금 이어져 있다"만 나타낸다. 뺀 연결의 이력을 남길 요구가 없고,
 * 뺐다가 다시 넣는 것은 되살리기가 아니라 **새 줄**이다. 소프트 삭제 4칸 관례
 * (DATABASE_DESIGN.md #8)는 사람이 만든 **마스터 자료**(고객사·모델·부품처럼
 * 실수로 지웠을 때 되살릴 것이 있는 행)에 적용되는 것이지, 두 마스터를 잇기만
 * 하는 표에 적용되는 것이 아니다 — role_permissions도 같은 이유로 4칸이 없다.
 *
 * ── 🔴 조회할 때 소프트 삭제된 고객사를 걸러야 한다 ─────────────────────
 * 이 표에는 is_deleted가 없다. 그런데 **customers에는 있다** — 휴지통에 들어간
 * 고객사는 customers.is_deleted = true인 채로 그대로 남아 있고, FK CASCADE는
 * 완전삭제 때만 움직이므로 이 표의 줄도 그대로 남는다.
 *
 * 그러므로 이 표를 읽는 쪽(2단계의 조회)은 반드시 customers를 조인해
 * `customers.is_deleted = false`로 걸러야 한다. 걸르지 않으면 휴지통에 있는
 * 고객사가 모델 상세에 계속 보인다. product_models 쪽도 같다.
 *
 * ── 왜 (모델, 고객사) 복합 PK가 아니라 대리 키인가 ──────────────────────
 * 이 저장소의 모든 표가 단일 칼럼 PK다(복합 PK를 쓰는 표가 하나도 없다). 게다가
 * 감사 로그의 target_record_id가 NOT NULL uuid라(schema/audit-logs.ts), 누가
 * 언제 어떤 연결을 붙이고 뗐는지 남기려면 행마다 uuid 하나가 필요하다 —
 * role_permissions · part_minimum_quantities가 같은 이유로 같은 모양이다.
 * (모델, 고객사) 짝의 유일성은 아래 유니크 인덱스가 지킨다.
 * ============================================================================
 */
export const productModelCustomers = pgTable(
  "product_model_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productModelId: uuid("product_model_id")
      .notNull()
      .references(() => productModels.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /**
     * 언제 이었는지. updated_at은 없다 — 이 표의 행은 고쳐지지 않는다(연결을
     * 바꾸는 것은 한 줄을 지우고 다른 줄을 넣는 일이다).
     */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 같은 모델에 같은 고객사를 두 번 붙일 수 없다. 화면에서 이미 고른 것을
    // 목록에서 빼더라도, 두 사람이 동시에 같은 고객사를 고르는 경쟁은 여기서만
    // 막힌다.
    uniqueIndex("product_model_customers_model_customer_unique").on(table.productModelId, table.customerId),
  ]
);
