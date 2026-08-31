import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productModelKindEnum } from "./product-models";
import { quotes } from "./quotes";
import { users } from "./users";

/**
 * ============================================================================
 * 수리 작업 비용 — 무엇을 하면 얼마인가
 * ============================================================================
 * 견적서의 **작업비**가 여기서 나온다.
 *
 * ── 🔴 작업비는 부품이 아니라 '작업'에 붙는다 ───────────────────────────
 * 처음에는 부품마다 작업비가 있는 줄 알고 그렇게 만들었다가 **사용자 정정으로
 * 뒤집었다**(2026-08-31). 작업비는 부품이 아니라 **수리 작업 종류**마다 정해져
 * 있고, 값은 `공수시간 × 시간당 단가`다. 오버홀도 그 목록의 한 줄일 뿐이다
 * (제너레이터 `OH` 는 24시간 = 240만원).
 *
 * 그래서 이 표는 부품과 아무 관계가 없다. 같은 부품을 갈아도 어떤 작업으로
 * 처리하느냐에 따라 값이 다르고, 부품을 안 갈아도 작업비만 나가는 일이 있다.
 *
 * ── 장비 종류는 새로 만들지 않는다 ──────────────────────────────────────
 * 제너레이터 · 매쳐 · Total Controller(T/C) 는 이미 product_model_kind 로 있다.
 * 같은 값 셋을 enum 하나 더 만들어 담으면, 늘어날 때마다 두 곳을 고쳐야 하고
 * 언젠가 두 목록이 어긋난다. 그 enum 을 그대로 쓴다.
 *
 * ── 목록은 장비 종류마다 다르다 ─────────────────────────────────────────
 * 제너레이터는 20건(`종단 Amp 교환 작업(열)` 6h … `OH` 24h), 매쳐는 16건
 * (`바리콘 교환 작업` 8h … `VPP_VDC 기판 교환 작업` 6h). 사람이 화면에서 고친다.
 * ============================================================================
 */
export const repairTaskCatalog = pgTable(
  "repair_task_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 어느 장비의 작업인가. 목록이 장비 종류마다 통째로 다르다. */
    equipmentKind: productModelKindEnum("equipment_kind").notNull(),
    /** 건명. 사람이 견적서에서 보고 고르는 글자 그대로다. */
    taskName: text("task_name").notNull(),
    /**
     * 공수시간. 비용은 `hours × hourly_rate` 로 **계산해서 보여 줄 뿐 저장하지
     * 않는다** — 시간당 단가가 오르는 날 저장해 둔 금액이 통째로 낡기 때문이다
     * (계산된 값을 원본 칸에 저장하지 않는다 — 이 저장소가 내자 정리에서 한 번
     * 겪고 타입으로 막아 둔 규칙).
     *
     * 정수 시간이다. 받은 목록 36건이 전부 정수라서 그렇게 둔다. 반나절 단위가
     * 생기면 numeric 으로 넓히면 되고, 그 방향의 변경은 자료를 잃지 않는다.
     */
    hours: integer("hours").notNull(),
    /** 화면에 늘어놓는 차례. 사진의 목록 순서가 그대로 뜻을 갖는다. */
    displayOrder: integer("display_order").notNull(),
    /**
     * 이 줄이 **오버홀 작업**인가.
     *
     * 견적서 종류를 O/H 로 고르면 이 줄이 자동으로 체크되고, 내자로 고르면
     * 풀린다(2026-08-31 사용자 요구).
     *
     * 🔴 **이름으로 알아내지 않는다.** 제너레이터는 `OH`, 매쳐는
     * `O/H(스위칭전원,휴즈 교환) 작업` 이라 글자가 다르고, 앞으로 어떤 이름이
     * 올지도 알 수 없다. 이름을 뒤져 맞히는 코드는 이름이 바뀌는 날 조용히
     * 아무것도 못 찾고, 그러면 O/H 견적서에서 오버홀 작업비가 빠진 채로 나간다.
     * 추측하느니 사람이 표시한다 — 이 저장소가 워크플로 종류에서 같은 판단을 했다
     * (mutations/billing-workflow-target.ts 의 "추측하느니 거절한다").
     */
    isOverhaul: boolean("is_overhaul").notNull().default(false),

    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    // 같은 장비에 같은 건명을 두 줄 두지 않는다 — 견적서에서 어느 쪽을 고른
    // 것인지 사람도 코드도 답할 수 없다. 지운 이름은 다시 쓸 수 있다(부분 unique,
    // 이 저장소의 관례).
    uniqueIndex("repair_task_catalog_kind_name_not_deleted_unique")
      .on(table.equipmentKind, table.taskName)
      .where(sql`is_deleted = false`),
    index("repair_task_catalog_kind_idx").on(table.equipmentKind),
    // 0시간짜리 작업은 목록에 있을 이유가 없다. 음수는 더 말할 것도 없다.
    check("repair_task_catalog_hours_positive", sql`${table.hours} > 0`),
  ]
);

/**
 * ============================================================================
 * 장비 종류마다의 시간당 단가와 기본 작업비
 * ============================================================================
 * ── 시간당 단가를 코드에 박지 않는다 ────────────────────────────────────
 * 지금은 10만원이지만 올라간다. 박아 두면 오를 때마다 사람이 코드를 고쳐야 하고,
 * 그건 견적 금액을 바꾸는 일을 배포로 만드는 것이다.
 *
 * ── 🔴 기본 작업비는 **더하는 값**이다 ──────────────────────────────────
 * `작업비 = 기본 작업비 + Σ(고른 작업의 공수시간 × 시간당 단가)`.
 * 제너레이터 350만원 · T/C 220만원(2026-08-31 사용자 제시). 매쳐는 아직 정해지지
 * 않아 **NULL 이다.**
 *
 * NULL 은 "정하지 않았다"이고 `0` 은 "기본 작업비가 없다"는 실제 값이다. NULL 을
 * 0 으로 접으면 정하지 않은 장비가 조용히 기본값 없이 청구되고, 그 사실을 아무도
 * 모른다 — 화면이 "정하지 않았습니다"라고 말할 수 있어야 한다
 * (schema/part-unit-prices.ts 의 그 규칙과 같다).
 *
 * ── 장비 종류마다 한 줄 ─────────────────────────────────────────────────
 * 행이 없으면 시간당 단가조차 알 수 없어 계산이 서지 않는다. 그래서 세 종류의
 * 줄을 처음부터 만들어 두고, 모르는 것은 base_cost 를 NULL 로 둔다.
 * ============================================================================
 */
export const repairLaborSettings = pgTable(
  "repair_labor_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    equipmentKind: productModelKindEnum("equipment_kind").notNull(),
    /** 시간당 작업비(원). 지금 셋 다 100000. */
    hourlyRate: numeric("hourly_rate", { precision: 15, scale: 2 }).notNull(),
    /** 기본 작업비(원). **NULL 이면 정하지 않은 것**이고 합계에 더하지 않는다. */
    baseCost: numeric("base_cost", { precision: 15, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("repair_labor_settings_kind_unique").on(table.equipmentKind),
    check("repair_labor_settings_hourly_rate_not_negative", sql`${table.hourlyRate} >= 0`),
    // NULL 은 이 CHECK 를 통과한다 — '정하지 않음'은 잘못된 값이 아니라 값의 부재다.
    check("repair_labor_settings_base_cost_not_negative", sql`${table.baseCost} >= 0`),
  ]
);

/**
 * ============================================================================
 * 견적서가 고른 수리 작업 — 그 한 장이 무엇으로 그 금액이 되었는가
 * ============================================================================
 * 견적서의 `work_cost` 는 **합계 하나**뿐이다. 무엇을 골라서 그 값이 되었는지를
 * 남기지 않으면, 다시 열었을 때 금액만 있고 근거가 사라진다 — 고객사가 "이
 * 작업비가 뭐냐"고 물을 때 답할 것이 없다.
 *
 * ── 🔴 스냅샷이다. 카탈로그를 따라가지 않는다 ───────────────────────────
 * 건명·공수시간·시간당 단가를 **여기에 베껴 둔다.** task_id 로 카탈로그를 보게
 * 하면, 나중에 시간당 단가가 오르거나 공수시간이 고쳐지는 순간 **이미 보낸
 * 견적서의 근거가 소리 없이 바뀐다.** quotes 표가 고객사·모델명을 `_text` 로
 * 베껴 두는 것과 같은 이유이고, 그 판단은 schema/quotes.ts 머리말에 있다.
 *
 * `task_id` 는 참고용이다 — 카탈로그에서 지운 작업이면 NULL 이 되지 않고
 * RESTRICT 로 막히지만, 이 표의 삭제는 소프트라 실제로 막힐 일은 없다.
 * ============================================================================
 */
export const quoteRepairTasks = pgTable(
  "quote_repair_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /** 고른 차례. 저장할 때 1부터 다시 매긴다. */
    lineNo: integer("line_no").notNull(),
    /** 카탈로그의 그 줄. 참고용이고, 금액 계산은 아래 베껴 둔 값으로 한다. */
    taskId: uuid("task_id").references(() => repairTaskCatalog.id, { onDelete: "restrict" }),
    /** 그때 그 작업의 이름. 카탈로그에서 이름이 바뀌어도 이 견적서는 그대로다. */
    taskNameText: text("task_name_text").notNull(),
    /** 그때의 공수시간. */
    hours: integer("hours").notNull(),
    /** 그때의 시간당 작업비(원). 이 줄의 금액은 hours × 이 값이다. */
    hourlyRate: numeric("hourly_rate", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quote_repair_tasks_quote_line_unique").on(table.quoteId, table.lineNo),
    index("quote_repair_tasks_quote_id_idx").on(table.quoteId),
    check("quote_repair_tasks_hours_positive", sql`${table.hours} > 0`),
    check("quote_repair_tasks_hourly_rate_not_negative", sql`${table.hourlyRate} >= 0`),
  ]
);
