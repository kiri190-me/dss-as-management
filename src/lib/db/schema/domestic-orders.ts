import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 내자 정리 — 이 표가 무엇이고, 무엇이 아닌가
 * ============================================================================
 * "내자"는 국내 수주를 뜻한다. 이 표는 DSS가 고객사에 보내는 **수주·정산
 * 진행 상황표**의 한 줄이다. 원본은 손으로 관리하던 Excel 시트(`내자 시트`)이고,
 * 그 시트의 22칼럼 중 이 표가 실제로 저장하는 것은 15칼럼뿐이다.
 *
 * **이 표는 A/S 진행 상태를 적는 곳이 아니다.** 장비가 지금 어느 단계에 있는지,
 * 누가 수리하고 있는지는 repair_cases와 워크플로가 이미 정하고 있고, 이 표는
 * 그 옆에서 **발주 → 견적 → 납품 → 세금계산서 → 입금**이라는 돈의 흐름만
 * 따라간다. 두 흐름은 실제로 어긋난다 — 수리가 끝나도 입금은 두 달 뒤일 수 있고,
 * 수리 없이 납품만 있는 줄도 있다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역은 여기 없다 ────────────────────────────
 * 원본 시트에는 그 다섯 칼럼이 있지만 이 표에는 두지 않는다. 전부 이미
 * repair_cases + products + customers 에 있는 값이고, 여기 한 번 더 적으면
 * 그 순간부터 두 벌이 서로 어긋나기 시작한다(모델명 오타를 고쳐도 이 표에는
 * 반영되지 않는 식이다). 화면에는 조인해서 따라오게 한다
 * (queries/domestic-orders.ts). 시트의 `순번`은 사람이 정한 표시 순서라서
 * display_order 로 남기고, 나머지 22칼럼 중 저장하지 않는 것은 그 다섯뿐이다.
 *
 * ── 수리 건 연결은 비어 있어도 된다 ─────────────────────────────────────
 * repair_case_id 는 NULL 을 허용한다. 시트에는 (1) 수리 없이 납품만 있는 줄,
 * (2) 발주는 받았지만 아직 접수 전인 줄이 실제로 섞여 있다. NOT NULL 로 두면
 * 그런 줄을 적을 자리가 없어져, 사람이 다시 Excel 로 돌아가게 된다.
 * 연결을 못 찾은 줄의 인수번호는 intake_number_text 에 **글자 그대로** 남긴다 —
 * 나중에 사람이 보고 이어 붙일 수 있는 유일한 단서이고, 지금 못 찾았다고
 * 버리면 그 단서가 사라진다.
 *
 * ── 수리 건이 영구 삭제돼도 정산 기록은 남는다 ──────────────────────────
 * repair_case_id 는 ON DELETE SET NULL 이다. 접수 건을 영구 삭제하면 **연결만
 * 끊기고** 이 행은 그대로 남는다. attachments 가 같은 이유로 같은 방식을 쓴다
 * (그 파일의 '접수 건이 영구 삭제돼도' 주석 참조) — 거기서는 증빙 사진이,
 * 여기서는 **세금계산서와 입금 사실**이 접수 건과 함께 사라지면 안 되기
 * 때문이다. 회계 기록은 그 거래의 원인이 지워진 뒤에도 남아야 한다.
 * NOT NULL + RESTRICT 로 두면 접수 건 영구 삭제 자체가 DB 레벨에서 막힌다.
 *
 * customer_id 는 반대로 RESTRICT 다. 이 저장소의 다른 표들이 customers 를
 * 가리키는 방식과 같고(repair_cases.customer_id), 고객사 행이 실제로 사라지는
 * 일 자체를 막는 쪽이 맞다 — 정산 상대가 지워지면 이 행은 누구에게 청구한
 * 것인지 말할 수 없게 된다.
 *
 * ── 금액은 numeric 이다 ─────────────────────────────────────────────────
 * double precision 으로 두면 0.1 을 더하는 것만으로도 오차가 쌓여, 합계가
 * 세금계산서와 1원씩 어긋나는 표가 만들어진다. 돈은 십진 그대로 저장한다.
 * numeric(15,2) 는 조 단위까지 들어가는 폭이고, Drizzle 은 이 컬럼을 문자열로
 * 읽는다 — 자바스크립트 number 로 바꾸는 순간 같은 오차가 다시 생기므로
 * 화면까지 문자열로 옮긴다.
 *
 * 부가세는 담지 않는다. 원본 시트의 머리말이 `(부가세미포함)`이라고 못 박고
 * 있고, 세율은 시점에 따라 달라지는 값이라 행마다 적을 것이 아니다.
 *
 * ── version 과 휴지통 4칼럼은 이번 단계에서 쓰지 않는다 ─────────────────
 * 이번 단계는 **조회 전용**이다. 입력·수정·삭제는 다음 단계이고, 그때
 * version(낙관적 잠금)과 소프트 삭제 4칼럼(DATABASE_DESIGN.md #8)이 필요해진다.
 * 지금 함께 넣어 두는 이유는 마이그레이션을 한 번으로 끝내기 위해서다 —
 * 나중에 ALTER 로 붙이면 그때는 실 데이터가 들어 있는 표를 잠그게 된다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 연락처 컬럼은 없다. 다만 progress_note · history_note · etc_note · delivered_by
 * 는 사람이 자유롭게 적는 값이라 담당자 이름이나 고객사 사정이 섞일 수 있다 —
 * 로그나 오류 보고로 그대로 내보내지 않는다.
 * ============================================================================
 */
export const domesticOrders = pgTable(
  "domestic_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL 허용 + ON DELETE SET NULL — 정산 기록이 접수 건보다 오래 산다.
    // 파일 헤더의 '수리 건이 영구 삭제돼도' 항목 참조.
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    // 연결을 못 찾은 줄의 인수번호를 글자 그대로. 시트에 적혀 있던 값을
    // 버리지 않기 위한 자리이지, repair_case_id 의 대체물이 아니다.
    intakeNumberText: text("intake_number_text"),
    // 청구 상대. 수리 건이 없는 줄에도 고객사는 있으므로 repair_cases 를
    // 거치지 않고 직접 가리킨다.
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),
    // 시트의 `순번`. 사람이 정한 표시 순서이고, 정렬의 첫 기준이다.
    // 비어 있는 줄이 있을 수 있어 NULL 을 허용한다.
    displayOrder: integer("display_order"),
    purchaseOrderNumber: text("purchase_order_number"), // 발주서번호
    projectName: text("project_name"), // PJT
    /**
     * 발주발행일. 다음 단계(주간보고)가 이 날짜로 기간을 훑는다 —
     * 아래 domestic_orders_order_issued_date_idx 가 그것을 위한 인덱스다.
     */
    orderIssuedDate: date("order_issued_date"),
    requestedDueDate: date("requested_due_date"), // 납기요청일
    /** 견적발행일. 발주발행일과 함께 주간보고가 쓰는 두 날짜 중 하나다. */
    quoteIssuedDate: date("quote_issued_date"),
    quoteNumber: text("quote_number"), // 견적서번호
    // 시트의 `현황`. 정해진 목록이 아니라 **자유롭게 적는 메모**다(사용자 확인).
    // enum 으로 만들지 않는다 — 실제로 적히는 말이 매번 다르고, 목록으로
    // 가두면 적을 수 없는 상황이 생겨 사람이 다른 칸에 우회해서 적게 된다.
    progressNote: text("progress_note"),
    deliveredDate: date("delivered_date"), // 납품일
    deliveredBy: text("delivered_by"), // 납품자 (사람 이름 — users FK 아님, 시트 그대로의 글자다)
    taxInvoiceDate: date("tax_invoice_date"), // 세금계산서발행일
    // 금액(VAT 별도). numeric 인 이유는 파일 헤더의 '금액은 numeric 이다' 참조.
    amountExcludingVat: numeric("amount_excluding_vat", { precision: 15, scale: 2 }),
    // 입금완료 여부. 시트에서 비어 있는 칸은 "아직 안 들어왔다"는 뜻이라
    // NULL 을 따로 두지 않고 false 를 기본값으로 쓴다.
    paymentCompleted: boolean("payment_completed").notNull().default(false),
    japanRemittanceNote: text("japan_remittance_note"), // 일본 송금
    historyNote: text("history_note"), // 이력
    etcNote: text("etc_note"), // 기타
    // 낙관적 잠금 토큰. 이번 단계에서는 쓰지 않는다(파일 헤더 참조).
    version: integer("version").notNull().default(1),
    // 소프트 삭제 4컬럼 (DATABASE_DESIGN.md #8). 이번 단계에서는 쓰지 않지만,
    // 조회는 처음부터 is_deleted = false 만 본다 — 나중에 삭제를 붙일 때
    // 조회 쪽을 다시 고치지 않기 위해서다.
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // 지운 계정이 사라지지 않도록 RESTRICT — 이 저장소의 다른 표들이 users 를
    // 가리키는 방식과 같다.
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    deleteReason: text("delete_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    // 접수 건 상세에서 "이 건의 정산 줄"을 찾는 조회, 그리고 목록의 조인이
    // 타는 길이다. 부분 인덱스인 것은 이 저장소의 휴지통 패턴이고
    // (attachments_repair_case_id_not_deleted_idx 와 같은 모양), 지워진 행이
    // 인덱스에 남지 않아 목록 조회가 그만큼 가벼워진다.
    index("domestic_orders_repair_case_id_not_deleted_idx")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
    // 주간보고가 발주발행일로 기간을 훑는다. 부분 인덱스가 아닌 것은 일부러다 —
    // 지난 기간을 다시 집계할 때 그 사이에 지워진 행까지 세어야 "그때 무슨 일이
    // 있었는가"를 답할 수 있다.
    index("domestic_orders_order_issued_date_idx").on(table.orderIssuedDate),
  ]
);
