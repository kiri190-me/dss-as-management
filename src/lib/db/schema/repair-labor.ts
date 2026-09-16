import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
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
 * ── 🔴 기본 작업비는 이제 **세 공수시간의 합**이다 (2026-09-16 사용자 결정) ─
 * `기본 작업비 = (조사 시간 + 통전 시간 + 서류 시간) × 시간당 단가`.
 * 사람이 기본 작업비를 손으로 적지 않는다 — 세 칸을 적으면 금액이 따라 나온다.
 *
 * 그래서 조사 몫이 더 이상 **나머지**가 아니다. 예전에는 「기본 작업비 − 통전 몫」
 * 이라는 뺄셈으로 조사 몫을 얻었는데, 그 방식은 서류작업처럼 몫이 하나 더 생기는
 * 날 조사 몫이 그것까지 말없이 삼킨다. 이제 셋이 저마다 제 칸을 갖는다.
 *
 * 🔴 **금액 계산이 바뀌는 것은 뒤따르는 조각이다.** 이 조각은 표만 바꿨다 —
 * domain/quote-labor-cost.ts 는 아직 base_cost 를 읽는다. 그 조각이 오기 전까지
 * 두 값(base_cost 와 세 칸의 합)이 같은 금액을 말하고 있어야 한다.
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
    /**
     * 기본 작업비(원). **NULL 이면 정하지 않은 것**이고 합계에 더하지 않는다.
     *
     * 🔴 **2026-09-16 부터 이 칸은 사람이 적는 값도, 계산의 근거도 아니다.**
     * 대신 `(investigation_hours + power_test_hours + document_hours) × hourly_rate`
     * 가 기본 작업비다(위 머리말의 그 항목). 계산을 실제로 갈아 끼우는 것은
     * 뒤따르는 조각이고, 그때까지는 domain/quote-labor-cost.ts 가 여전히 이 칸을
     * 읽는다.
     *
     * 🔴 **그래도 칸을 지우지 않는다.** 여기 든 값(제너레이터·매쳐 350만원 ·
     * T/C 220만원)은 **새 구조로 넘어오기 전의 유일한 근거**다. 지우면 이행이
     * 잘못 계산됐을 때 되짚을 자리가 사라지고, 이미 나간 견적서가 왜 그 금액이었는지
     * 물어볼 곳이 없어진다. 칸은 남기고 쓰지 않는다.
     */
    baseCost: numeric("base_cost", { precision: 15, scale: 2 }),
    /**
     * 조사작업 공수시간 (2026-09-16 에 생긴 칸).
     *
     * 예전에는 이 값이 칸으로 있지 않고 **「기본 작업비 − 통전 몫」이라는 나머지**
     * 였다(2026-09-04 ~ 2026-09-16). 서류작업이 셋째 몫으로 들어오면서 그 나머지가
     * 성립하지 않는다 — 빼지 않은 몫이 하나 더 있으면 조사 몫이 그것까지 삼킨다.
     * 그래서 통전과 똑같은 모양의 제 칸을 갖는다.
     *
     * **NULL 이면 정하지 않은 것**이고 `0` 이 아니다(위 base_cost · 아래
     * power_test_hours 와 같은 규칙). 정하지 않은 장비는 그 몫을 더하지도 빼지도
     * 않는다.
     *
     * 넘어올 때(0100) 그 나머지를 시간으로 되돌려 채웠다 — 개발 DB 기준
     * 제너레이터 21 · 매쳐 21 · T/C 22. **정수로 떨어지지 않거나 0 이하가 되는
     * 줄은 채우지 않고 NULL 로 두었다**: 반올림으로 청구 금액을 조용히 바꾸지
     * 않는다(그 마이그레이션 파일의 주석에 세 규칙이 적혀 있다).
     */
    investigationHours: integer("investigation_hours"),
    /**
     * 통전작업 공수시간.
     *
     * 기본 작업비 안에는 **통전작업이 이미 들어 있다**(2026-09-04 사용자). 제너레이터
     * 350만원 중 14시간 = 140만원이 그 몫이고, 통전작업이 빠지는 견적서는 210만원이
     * 되어야 한다. 그 14 를 코드에 박지 않는 이유는 시간당 단가를 박지 않는 이유와
     * 같다 — 값이 바뀌는 날 금액을 고치는 일이 배포가 된다(이 파일 아래 머리말).
     *
     * **NULL 이면 정하지 않은 것**이고 `0` 이 아니다. T/C 는 통전작업 시간을 아직
     * 모른다. 0 으로 접으면 "통전작업이 0시간인 장비"와 갈라지지 않고, 모르는 채로
     * 차감이 일어나 버린다 — 정하지 않은 장비는 차감하지 않는 편이 맞다
     * (base_cost 가 NULL 을 다루는 규칙과 같다).
     *
     * 2026-09-16 부터는 「기본 작업비 안에 들어 있다」가 말이 아니라 계산 그대로다 —
     * 기본 작업비가 이 시간을 포함한 셋의 합이기 때문이다(위 머리말).
     */
    powerTestHours: integer("power_test_hours"),
    /**
     * 서류작업 공수시간 (2026-09-16 사용자 결정으로 생긴 셋째 몫).
     *
     * 🔴 **셋 중 여기만 `0` 을 받는다.** 조사·통전은 `> 0` 인데 서류는 `>= 0` 이다 —
     * 「서류작업이 없는 장비」가 실제로 있을 수 있고, 그건 "정하지 않았다"가 아니라
     * 사람이 확인해서 내린 답이다. 반면 0시간짜리 조사·통전은 뜻이 서지 않는다
     * (장비를 열어 보지 않고 견적을 내지는 않는다).
     *
     * 그 갈림이 화면과 금액에서 실제로 다른 말을 한다. `0` 이면 「서류작업 제외」가
     * **0원을 뺀 것**이고(quotes.document_excluded 의 "빼기는 했는데 0원"), NULL 이면
     * 뺄 금액을 몰라서 **빼지 못한 것**이다 — 지금 T/C 의 통전작업이 그 상태다.
     *
     * **NULL 이면 정하지 않은 것**이다. 새 개념이라 넘어올 때 세 줄 모두 NULL 로
     * 시작했다 — 정해진 값이 없는 것을 0 으로 채우면 위의 「서류작업이 없는 장비」와
     * 구별되지 않는다.
     */
    documentHours: integer("document_hours"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("repair_labor_settings_kind_unique").on(table.equipmentKind),
    check("repair_labor_settings_hourly_rate_not_negative", sql`${table.hourlyRate} >= 0`),
    // NULL 은 이 CHECK 를 통과한다 — '정하지 않음'은 잘못된 값이 아니라 값의 부재다.
    check("repair_labor_settings_base_cost_not_negative", sql`${table.baseCost} >= 0`),
    // 0시간짜리 통전작업은 뜻이 없다 — 그건 '통전작업이 없다'가 아니라 '정하지
    // 않았다'이고, 그 상태는 NULL 이 담는다. 여기서도 NULL 은 통과한다.
    check("repair_labor_settings_power_test_hours_positive", sql`${table.powerTestHours} > 0`),
    // 조사작업도 통전과 같은 규칙이다 — 0시간짜리 조사작업은 '조사를 하지 않는다'가
    // 아니라 '정하지 않았다'이고, 그 상태는 NULL 이 담는다.
    check(
      "repair_labor_settings_investigation_hours_positive",
      sql`${table.investigationHours} > 0`
    ),
    // 🔴 서류작업만 0 을 받는다 — 위 document_hours 의 그 까닭(「서류작업이 없는
    // 장비」는 정하지 않은 것이 아니라 정해진 답이다). 음수는 여기서도 막는다.
    check(
      "repair_labor_settings_document_hours_not_negative",
      sql`${table.documentHours} >= 0`
    ),
  ]
);

/**
 * 작업 건명 목록의 갈래 — 조사 · 통전 · 서류.
 *
 * 🔴 **quote_work_scope_section 을 그대로 쓰지 않는다.** 이름도 값도 닮았지만
 * (INVESTIGATION · REPAIR · POWER_TEST) 그쪽은 **견적서 문서의 `1) 2) 3)` 구역**이라
 * 수리작업(REPAIR)이 들어 있고 서류작업(DOCUMENT)이 없다. 같은 값 셋이 아니라
 * 겹치는 값 셋이다. 하나로 합치면 이 표에 REPAIR 가 들어올 수 있게 되고(그 줄은
 * 공수시간을 정할 자리가 없어 금액이 서지 않는다), 저쪽에는 문서에 구역이 없는
 * DOCUMENT 가 생긴다.
 *
 * 위 repair_task_catalog 머리말의 「장비 종류는 새로 만들지 않는다」와 어긋나지
 * 않는다 — 그때는 값 셋이 **같았다.** 여기서는 다르다.
 */
export const repairLaborScopeEnum = pgEnum("repair_labor_scope", [
  "INVESTIGATION",
  "POWER_TEST",
  "DOCUMENT",
]);

/**
 * ============================================================================
 * 작업 건명 목록 — 조사 · 통전 · 서류로 **무엇을 하는가**
 * ============================================================================
 * 장비 종류마다의 작업 건명 목록이다. **공수시간이 없다.**
 *
 * ── 🔴 표 이름은 `power_test_tasks`(통전)인데, 이제 셋을 담는다 ──────────
 * 통전작업 목록으로 시작한 표다. 2026-09-16 에 조사작업 · 서류작업 목록이 **같은
 * 모양으로**(건명 + 차례 + 소프트 삭제) 생기면서, 표를 셋으로 늘리는 대신 `scope`
 * 칸을 두어 한 표에 담았다. 나누면 화면 · 조회 · 뮤테이션 · 시험이 세 벌이 되고,
 * 한 곳을 고칠 때 세 곳을 고쳐야 한다.
 *
 * 이름을 바꾸지 않은 것도 일부러다 — 코드 · 마이그레이션 · 감사 기록에 그 이름이
 * 흩어져 있고, 바꿔서 얻는 것이 "이름이 맞다" 말고는 없다. 대신 **이 표를 읽는
 * 코드는 언제나 scope 를 걸러야 한다.** 안 걸면 통전 화면에 조사·서류 건명이
 * 섞여 나온다.
 *
 * ── 🔴 이 표는 글이고, 금액은 옆 표가 정한다 ────────────────────────────
 * 갈래마다의 값은 `repair_labor_settings` 의 그 갈래 공수시간 하나가 정한다
 * (`investigation_hours` · `power_test_hours` · `document_hours` × `hourly_rate`).
 * 이 목록은 그 한 덩어리 안에서 **무슨 일을 하는지**를 적어 두는 자리다 — 사람이
 * 보고, 앞으로 견적서 문서에 적힐 글이다.
 *
 * 그래서 줄마다 시간을 두지 않는다. 두면 "줄들의 합"과 "그 갈래의 공수시간"이라는
 * 서로 다른 두 숫자가 같은 금액을 주장하게 되고, 어긋나는 날 어느 쪽이 참인지
 * 답할 수 없다. **줄별 시간 배분은 필요 없다고 사용자가 정했다(2026-09-04,
 * 2026-09-16 에 조사·서류도 같은 모양으로).**
 *
 * ── 🔴 왜 repair_task_catalog 에 섞지 않는가 ────────────────────────────
 * 두 가지가 막는다.
 *
 *  1. 그 표는 `CHECK (hours > 0)` 으로 공수시간을 **반드시** 요구한다. 시간 없는
 *     통전 항목을 넣으려면 그 규칙을 느슨하게 해야 하고, 그러면 **0시간짜리
 *     수리 작업이 들어올 길이 함께 열린다** — 견적서에서 고를 수는 있는데 값이
 *     0인 줄이 생긴다.
 *  2. 견적서 화면이 그 표를 읽어 "고를 수리 작업" 목록을 그린다. 섞으면 통전
 *     항목이 그 선택지에 딸려 나오고, 사람이 그걸 고르면 시간이 없어 0원짜리
 *     줄이 견적서에 박힌다.
 *
 * 표를 나누면 둘 다 없는 문제가 된다. 대신 장비 종류 enum 은 그대로 나눠 쓴다 —
 * 이유는 위 repair_task_catalog 머리말의 「장비 종류는 새로 만들지 않는다」와 같다.
 * ============================================================================
 */
export const powerTestTasks = pgTable(
  "power_test_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 어느 장비의 작업인가. 목록이 장비 종류마다 통째로 다르다. */
    equipmentKind: productModelKindEnum("equipment_kind").notNull(),
    /**
     * 조사 · 통전 · 서류 중 어느 목록의 줄인가.
     *
     * 🔴 **기본값을 두지 않는다.** 두면 갈래를 적지 않은 줄이 조용히 한쪽 목록에
     * 끼고, 그 사실을 아무도 모른다 — 0089 가 결재선 scope 에서 한 판단과 같다
     * (기본값을 달아 기존 행을 채운 뒤 곧바로 뗐다). 이 칸이 생기기 전에 있던
     * 줄은 전부 통전작업이므로 0100 이행에서 POWER_TEST 가 되었다.
     */
    scope: repairLaborScopeEnum("scope").notNull(),
    /** 건명. 사람이 화면에서 보고, 앞으로 문서에 적힐 글자 그대로다. */
    taskName: text("task_name").notNull(),
    /** 화면에 늘어놓는 차례. 순서대로 하는 일이라 차례가 뜻을 갖는다. */
    displayOrder: integer("display_order").notNull(),

    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    // 같은 장비의 **같은 갈래**에 같은 건명을 두 줄 두지 않는다 — 같은 일을 두 번
    // 적은 것인지 다른 일인지 사람도 코드도 답할 수 없다. 지운 이름은 다시 쓸 수
    // 있다(부분 unique, 이 저장소의 관례 — 위 repair_task_catalog 와 같은 모양).
    //
    // 🔴 **scope 가 유니크에 들어간 것이 핵심이다.** 빼면 같은 장비의 조사 목록과
    // 통전 목록에 같은 이름을 쓸 수 없다 — 「외관 및 내부 검사」처럼 두 갈래에 다
    // 있을 법한 이름이 멀쩡한데도 거부된다.
    uniqueIndex("power_test_tasks_kind_scope_name_not_deleted_unique")
      .on(table.equipmentKind, table.scope, table.taskName)
      .where(sql`is_deleted = false`),
    index("power_test_tasks_kind_idx").on(table.equipmentKind),
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
