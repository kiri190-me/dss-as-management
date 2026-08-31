import { sql } from "drizzle-orm";
import {
  boolean,
  pgEnum,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { parts } from "./inventory";
import { productModelKindEnum } from "./product-models";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 견적서 — 고객사로 나간 문서 한 장
 * ============================================================================
 * `[PO/내자] > 견적서` 화면이 만들고 고치는 표다. 한 행이 `내자견적서.xlsx`
 * 한 장에 대응하고, 그 파일을 만드는 일은 src/lib/xlsx/quote-template.ts 가 한다.
 *
 * **이 표는 A/S 진행 상태도, 정산 진행 상황도 아니다.** 장비가 지금 어느 단계에
 * 있는지는 repair_cases 와 워크플로가, 발주에서 입금까지의 흐름은 domestic_orders
 * 가 이미 갖고 있다. 이쪽은 **"우리가 얼마를 불렀는가"라는 한 장의 문서**다.
 * 한 모델에서 견적서가 여러 장 나올 수 있어서(재견적·항목 조정) 수리 건 하나에
 * 이 표의 행이 여럿 달릴 수 있다.
 *
 * ── 이 표의 값은 스냅샷이다. 수리 건을 따라가지 않는다 ──────────────────
 * 고객사·형식·L/N·S/N·고장내역을 `_text` 로 여기에 둔다. domestic_orders 도 같은
 * 다섯을 갖고 있지만 **규칙이 다르다.** 그쪽은 "이 행에 적힌 값이 먼저, 없으면
 * 연결된 수리 건의 값"이라 원본이 고쳐지면 따라 움직인다. 진행 상황표는 지금
 * 사실을 보여 주는 것이 일이니 그게 맞다.
 *
 * 견적서는 반대다. **이미 보낸 문서**라서, 나중에 S/N 오타가 정정되거나 고객사
 * 상호가 바뀌어도 그때 보낸 종이가 따라 바뀌면 안 된다. "그때 무엇이라고 적어
 * 보냈는가"에 답할 수 없게 되기 때문이다. 그래서 불러오기를 누르는 순간 값이
 * 폼에 실제로 복사되고, 저장된 뒤로는 수리 건 쪽을 다시 보지 않는다.
 *
 * 부수 효과로 목록이 조인 없이 그려진다. 목록 한 줄은
 * **견적서번호 · 고객사 · 모델명 · L/N · S/N · 신고증상** 이고, 전부 이 표에 있다
 * (예: `DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생`).
 * 순서를 값 모양으로 짐작하지 말 것 — **WU 접두가 L/N, 숫자만인 쪽이 S/N** 이다.
 * 양식 D24 에 박혀 있던 예시가 그 반대로 읽히게 생겨서 실제로 한 번 틀렸다.
 *
 * ── 수리 건 연결은 비어 있어도 된다 ─────────────────────────────────────
 * repair_case_id 는 NULL 을 허용하고 ON DELETE SET NULL 이다. 접수 전에 먼저
 * 견적을 내는 일이 있고, 수리 없이 부품만 파는 견적도 있다. NOT NULL 로 두면
 * 그런 장을 적을 자리가 없어진다. 그리고 접수 건을 영구 삭제해도 **연결만 끊기고
 * 이 행은 남는다** — attachments 의 증빙 사진, domestic_orders 의 세금계산서와
 * 같은 이유다(각 파일의 '영구 삭제돼도' 항목). 얼마를 불렀는지는 그 거래의
 * 원인이 지워진 뒤에도 남아야 한다.
 *
 * customer_id 는 반대로 RESTRICT 다 — 청구 상대가 통째로 사라지면 이 문서는
 * 누구에게 보낸 것인지 말할 수 없게 된다. repair_cases.customer_id 와 같은 규칙.
 *
 * ── 합계 금액을 담지 않는다 ─────────────────────────────────────────────
 * `SUM(quote_items.quantity * unit_price) + work_cost` 로 언제든 나온다. 칸에
 * 적어 두면 항목을 고칠 때마다 두 벌이 어긋날 자리가 생기고, 어긋났을 때 어느
 * 쪽이 맞는지 답할 방법이 없다. 부가세도 담지 않는다 — 양식이 `=I55*0.1` 로
 * 계산하고, 세율은 시점에 따라 달라지는 값이라 행마다 적을 것이 아니다.
 *
 * ── 금액은 numeric 이다 ─────────────────────────────────────────────────
 * double precision 으로 두면 오차가 쌓여 합계가 세금계산서와 1원씩 어긋난다.
 * Drizzle 은 이 컬럼을 **문자열로 읽는다** — 화면까지 문자열로 옮기고, 숫자를
 * 요구하는 xlsx 엔진에 넘기는 그 한 지점에서만 바꾼다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 연락처 컬럼은 없다. subject · fault_description_text · validity · delivery ·
 * payment 는 사람이 자유롭게 적는 값이라 고객사 사정이 섞일 수 있다 — 로그나
 * 오류 보고로 그대로 내보내지 않는다.
 *
 * **은행계좌는 이 표에 없다.** 양식(D18)에 이미 적혀 있고, 계좌번호를 코드에도
 * DB 에도 두지 않기 위해서다(quote-template.ts 의 같은 항목).
 * ============================================================================
 */
/**
 * 견적서 종류. **두 양식이 실제로 다르다**(memory: 견적서.xlsx 의 내자견적서 /
 * 견적서 OH.xlsx 의 OH견적서). OH 는 발행번호에 `-1`, 품명에 ` + OH` 가 붙고,
 * 작업비에 240만이 더해지고, `2) OH 부품 비용` 그룹이 생기고, 공급가를 만원
 * 단위로 내린다.
 *
 * ── 🔴 O/H 대상 판정과 이 칸은 별개다 ──────────────────────────────────
 * O/H 대상품이어도 **일반 견적서와 OH 견적서를 모두 발행한다**(사용자 확인).
 * domain/overhaul.ts 의 판정은 화면에 알려 주기만 하고, 어느 종류로 낼지는
 * 사람이 이 칸으로 정한다. 판정으로 이 값을 자동으로 정하면 안 된다.
 */
export const quoteKindEnum = pgEnum("quote_kind", ["DOMESTIC", "OVERHAUL"]);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 사람이 손으로 적는다(승인된 결정). 자동 채번하지 않는 이유는 예전부터
     * 쓰던 번호 체계를 시스템이 넘겨받지 않기 위해서다 — 시작 번호를 맞추는
     * 일과, 취소된 견적서 때문에 번호가 비는 상황을 정리하는 일이 함께 따라온다.
     * 중복만 아래 부분 unique 인덱스로 막는다.
     */
    quoteNumber: text("quote_number").notNull(),
    /** 내자(DOMESTIC) 인가 오버홀(OVERHAUL) 인가. 위 quoteKindEnum 주석 참조. */
    kind: quoteKindEnum("kind").notNull().default("DOMESTIC"),
    /** 발행일자 → 양식 D10. 여기에 적힌 날짜가 그대로 문서에 찍힌다. */
    quoteDate: date("quote_date").notNull(),

    // 위 '수리 건 연결은 비어 있어도 된다' 참조.
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    /**
     * 연결을 못 찾은 장의 인수번호를 글자 그대로. 나중에 사람이 보고 이어 붙일
     * 수 있는 유일한 단서이고, 지금 못 찾았다고 버리면 그 단서가 사라진다.
     * domestic_orders.intake_number_text 와 같은 뜻이다.
     */
    intakeNumberText: text("intake_number_text"),

    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),

    /**
     * 발행 시점 스냅샷. 위 '이 표의 값은 스냅샷이다' 참조.
     *
     * customer_name_text 가 NOT NULL 인 것은 이 값이 **실제로 D12 에 찍혀 나가는
     * 글자**이기 때문이다. customer_id 는 비어 있을 수 있어도(마스터에 없는
     * 거래처로 한 장 낼 수 있다) 종이에 적힌 이름이 없는 견적서는 있을 수 없다.
     */
    customerNameText: text("customer_name_text").notNull(),
    modelNameText: text("model_name_text"), // 형식 → D24
    lotNumberText: text("lot_number_text"), // L/N → D24
    serialNumberText: text("serial_number_text"), // S/N → D24
    faultDescriptionText: text("fault_description_text"), // 신고증상 — 목록 여섯째 칸

    /** 품명(건명) → D13. 양식이 D23 에 `=D13` 으로 다시 쓴다. */
    subject: text("subject").notNull(),

    /**
     * 유효기간 · 납기 · 결재조건 → D15/D16/D17.
     * **비어 있는 것이 기본이다** — NULL 이면 양식에 이미 적힌 문구
     * ("발행일로부터 4주" 등)가 그대로 나간다. 기본값을 이 표에 복사해 두면
     * 양식의 문구를 고쳤을 때 두 곳이 어긋난다.
     */
    validity: text("validity"),
    delivery: text("delivery"),
    payment: text("payment"),

    /** 작업비(조사·수리·개조·통전·출하검사) 단가 → H33. 수량은 양식이 1 로 고정한다. */
    workCost: numeric("work_cost", { precision: 15, scale: 2 }).notNull().default("0"),

    /**
     * 위 work_cost 를 만든 근거 둘. **양식으로 나가지 않는다** — 견적서에 찍히는
     * 것은 합계 하나이고, 이 둘은 "그 합계가 어떻게 나왔나"에 답하기 위해 남긴다.
     * 고른 작업 줄들은 quote_repair_tasks 에 있다(schema/repair-labor.ts).
     *
     * ── 어느 장비의 작업 목록으로 골랐나 ──────────────────────────────
     * 목록이 장비 종류마다 통째로 다르다. 안 남기면 다시 열었을 때 어느 목록을
     * 펴야 할지 알 수 없다. NULL 은 **작업을 골라 본 적이 없는 견적서**다 —
     * 이 기능이 생기기 전에 만든 것들이 전부 그렇다.
     *
     * ── 기본 작업비도 그때 값으로 베껴 둔다 ────────────────────────────
     * repair_labor_settings 를 보게 하면 나중에 그 값이 바뀌는 순간 **이미 보낸
     * 견적서의 근거가 소리 없이 달라진다.** 이 표가 고객사·모델명을 `_text` 로
     * 베껴 두는 것과 같은 이유다(이 파일 머리말의 '스냅샷이다').
     */
    laborEquipmentKind: productModelKindEnum("labor_equipment_kind"),
    laborBaseCost: numeric("labor_base_cost", { precision: 15, scale: 2 }),

    // 낙관적 잠금. 목록에서 열어 고치는 화면이 있으므로 처음부터 쓴다.
    version: integer("version").notNull().default(1),

    // 소프트 삭제 4컬럼 (DATABASE_DESIGN.md #8).
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
    /**
     * 같은 번호로 두 장을 만들 수 없다. **부분 인덱스인 것은 일부러다** — 지운
     * 견적서가 번호를 계속 붙들고 있으면, 잘못 만들어 지운 `DSS 2026-077` 때문에
     * 그 번호를 영영 못 쓰게 된다. 사람이 종이에 적어 둔 번호를 시스템이 거부하는
     * 상황은 만들지 않는다.
     */
    uniqueIndex("quotes_quote_number_not_deleted_unique")
      .on(table.quoteNumber)
      .where(sql`is_deleted = false`),
    // 접수 건 상세에서 "이 건으로 나간 견적서들"을 찾는 길.
    index("quotes_repair_case_id_not_deleted_idx")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
    // 목록의 기본 정렬과 기간 필터. 부분 인덱스가 아닌 것은 domestic_orders 의
    // order_issued_date 와 같은 이유다 — 지난 기간을 다시 집계할 때 그 사이에
    // 지워진 장까지 세어야 "그때 무슨 일이 있었는가"를 답할 수 있다.
    index("quotes_quote_date_idx").on(table.quoteDate),
    index("quotes_customer_id_not_deleted_idx")
      .on(table.customerId)
      .where(sql`is_deleted = false`),
  ]
);

/**
 * ============================================================================
 * 견적서에 딸린 부품 줄
 * ============================================================================
 * 양식의 `1) 부품 비용` 칸(D27~D31 · G · H)으로 나가는 줄들이다.
 *
 * ── 다섯 줄 제한은 여기에 없다 ──────────────────────────────────────────
 * 양식의 부품 칸은 27~58행이 아니라 **27~31행 다섯 줄 고정**이고, 인쇄영역이
 * A1:I57 딱 1페이지다. 그렇다고 이 표를 다섯 줄로 막지는 않는다 — 승인된 규칙이
 * "**상세는 시스템 안에 다 남기고, 견적서에는 한 줄로 합산해서 내보낸다**"이기
 * 때문이다. 여섯 개짜리 견적을 다섯 줄로 우겨 넣으면 사람은 두 부품을 손으로
 * 합쳐 적게 되고, 그러면 무엇이 얼마였는지가 어디에도 남지 않는다.
 * 합치는 일은 xlsx 를 만드는 순간에만 일어난다(quote-template.ts 의
 * PARTS_ROLLUP_LABEL).
 *
 * ── 소프트 삭제도 version 도 두지 않는다 ────────────────────────────────
 * domestic_order_due_dates 와 같은 이유다. 이 줄들을 **직접 고치는 경로가 없다** —
 * 저장은 언제나 견적서 한 장을 통째로 저장하는 한 번의 트랜잭션이고, 그 안에서
 * 이 줄들은 통째로 지워지고 다시 들어간다. 동시 수정을 막는 일은 부모의 version
 * 이 이미 하고 있으므로 여기에 또 두면 두 벌이 어긋난다.
 *
 * ON DELETE CASCADE 인 것도 같은 성질에서 나온다: 견적서 없이 남은 부품 줄은
 * "무엇의 부품인가"를 말할 수 없어 그 자체로 뜻이 없다. 부모가 소프트 삭제될
 * 때는 행이 실제로 지워지지 않으므로 CASCADE 는 돌지 않는다.
 * ============================================================================
 */
export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /** 사람이 폼에 늘어놓은 차례. 저장할 때 1부터 다시 매긴다. */
    lineNo: integer("line_no").notNull(),
    /**
     * 재고에서 고른 부품. **NULL 이 정상이다** — 재고에 없는 품목이나 외주
     * 가공비를 부품 줄로 적을 수 있고, 인수번호로 불러온 '사용한 부품'은
     * 참고용이라 사람이 그대로 쓰지 않을 수도 있다.
     *
     * RESTRICT 인 것은 이 저장소가 parts 를 가리키는 다른 표들과 같은 규칙이고,
     * parts 자체가 소프트 삭제를 쓰므로 실제로 막힐 일은 없다.
     */
    partId: uuid("part_id").references(() => parts.id, { onDelete: "restrict" }),
    /**
     * 실제로 D27~D31 에 찍혀 나가는 글자. part_id 가 있어도 이 칸을 쓴다 —
     * 부품 마스터의 품명이 나중에 바뀌어도 이미 보낸 견적서는 그대로여야 한다
     * (부모 표의 '스냅샷이다'와 같은 이유).
     */
    partNameText: text("part_name_text").notNull(),
    /**
     * 이 줄이 `2) OH 부품 비용` 칸에 들어가는가.
     *
     * OH 견적서 양식에는 부품 그룹이 **둘**이다 — `1) 부품 비용`(27~31행)과
     * `2) OH 부품 비용`(34~46행). 두 그룹은 같은 표에 살지만 자리가 다르고,
     * 어느 쪽인지는 사람이 정한다(오버홀 부품을 일반 수리 부품으로 청구하는
     * 일도, 그 반대도 있다).
     *
     * 내자 견적서에는 이 그룹이 없으므로 그쪽에서는 언제나 false 다.
     */
    isOverhaulPart: boolean("is_overhaul_part").notNull().default(false),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quote_items_quote_id_line_no_unique").on(table.quoteId, table.lineNo),
    index("quote_items_quote_id_idx").on(table.quoteId),
    index("quote_items_part_id_idx").on(table.partId),
    check("quote_items_quantity_positive", sql`${table.quantity} > 0`),
    // 0원 줄은 허용한다 — 무상 교체 부품을 견적서에 적어 보이는 일이 실제로 있다.
    check("quote_items_unit_price_not_negative", sql`${table.unitPrice} >= 0`),
  ]
);

/**
 * ============================================================================
 * 견적서에 적히는 작업 내역 — 무엇을 했는가(할 것인가)
 * ============================================================================
 * 매쳐 견적서의 `2. 작업 비용` 아래에 세 묶음으로 적힌다:
 *
 *   1) 조사작업   외관 및 내부 검사 · 파라메타 체크 · …
 *   2) 수리작업   바리콘 교환 · 고정 콘덴서 추가 · …
 *   3) 통전작업   정격 출력 시험 · 에이징시험 · …
 *
 * ── 왜 견적서마다 저장하나 ──────────────────────────────────────────────
 * 조사·통전은 대체로 늘 같지만 **줄을 더하거나 고칠 수 있어야 한다**(2026-08-31
 * 사용자 요구). 고칠 수 있는 값을 양식에서만 읽으면 그 장의 사정을 담을 곳이
 * 없고, 다시 열었을 때 사람이 적어 둔 줄이 사라진다.
 *
 * 수리작업은 견적서가 고른 수리 작업(quote_repair_tasks)에서 처음 채워지지만,
 * **그 뒤로는 따로 산다** — 청구하는 작업과 문서에 적는 문장이 늘 1:1은 아니고
 * (한 작업을 두 줄로 설명하거나, 청구하지 않는 부수 작업을 적기도 한다),
 * 사람이 고친 문장을 고른 작업이 다시 덮으면 안 된다.
 *
 * ── 스냅샷이다 ──────────────────────────────────────────────────────────
 * 글자를 그대로 담는다. 나중에 작업 목록의 건명이 바뀌어도 **이미 보낸 견적서는
 * 그대로여야 한다** — 이 파일 머리말의 그 규칙과 같다.
 * ============================================================================
 */
export const quoteWorkScopeSectionEnum = pgEnum("quote_work_scope_section", [
  "INVESTIGATION",
  "REPAIR",
  "POWER_TEST",
]);

export const quoteWorkScopeLines = pgTable(
  "quote_work_scope_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /** 세 묶음 중 어디에 적히는가. 양식의 `1) 2) 3)` 이 그대로 이 축이다. */
    section: quoteWorkScopeSectionEnum("section").notNull(),
    /** 묶음 안에서의 차례. 저장할 때 1부터 다시 매긴다. */
    lineNo: integer("line_no").notNull(),
    /** 문서에 찍히는 글자 그대로. */
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quote_work_scope_lines_quote_section_line_unique").on(
      table.quoteId,
      table.section,
      table.lineNo
    ),
    index("quote_work_scope_lines_quote_id_idx").on(table.quoteId),
  ]
);
