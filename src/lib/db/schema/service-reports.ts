import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 검사·수리 보고서 — 고객사로 나간 문서 한 장
 * ============================================================================
 * 접수 건 상세의 `보고서 > 검사·수리 보고서` 화면이 만들고 고치는 표다. 한 행이
 * `검사보고서.xlsx` / `수리보고서.xlsx` 한 장에 대응하고, 그 파일을 만드는 일은
 * src/lib/xlsx/service-report-template.ts 가 한다. 칸의 이름과 뜻은 화면이 이미
 * 들고 있는 값(`domain/service-report-form.ts` 의 `ServiceReportFormValues`)과
 * 그것을 받는 검증(`validation/service-report-input.ts`)에서 그대로 왔다 —
 * **이 표가 새로 발명한 칸은 없다.**
 *
 * 본보기는 견적서(`quotes.ts`)다. 고객사로 나가는 문서를 담는 표라는 성질이
 * 같아서 규칙도 같다: **글자 스냅샷 · 낙관적 잠금 · 소프트 삭제 · 만든이/고친이.**
 * 견적서 머리말의 '이 표의 값은 스냅샷이다'가 여기에도 그대로 적용된다 — 이미
 * 보낸 문서는 원본이 정정돼도 따라 바뀌면 안 된다.
 *
 * ── 아래 넷은 **사용자가 승인한 결정**이다. 되돌리기 전에 이 문단을 읽을 것 ──
 *
 * 1) **repair_case_id 는 NOT NULL 이고 ON DELETE CASCADE 다.**
 *    견적서와 정반대인데, 두 문서의 처지가 다르기 때문이다. 견적서는 접수 전에도
 *    나가고 수리 없이 부품만 파는 장도 있어서 접수 건 없이 존재할 수 있다.
 *    보고서는 **늘 접수 건에 딸린 문서**다 — 무엇을 검사·수리했는지 없이 보고서만
 *    있는 상태가 없다.
 *
 *    CASCADE 인 까닭은 개인정보다. 보관기간이 지나 접수 건을 영구 삭제할 때 보고서만
 *    남으면, 지웠어야 할 고객사 이름·발생 장소가 **그 자리에만 살아남는다.** 정리가
 *    끝났다고 믿는데 실제로는 안 끝난 상태가 가장 나쁘다.
 *
 * 2) **고객사·제품을 FK 가 아니라 글자로만 담는다.**
 *    견적서는 접수 건 없이도 존재할 수 있어서 `customer_id` 를 걸어 두었지만,
 *    보고서는 언제나 접수 건에 붙어 있다 — 마스터로 가는 길이 이미 접수 건을 통해
 *    나 있으므로 FK 를 하나 더 걸 이유가 없다. 그리고 글자로만 담으면 나중에 고객사
 *    상호가 바뀌어도 **이미 낸 보고서의 글자가 안 바뀐다**(견적서의 그 규칙과 같다).
 *
 * 3) **「작성 중 / 발행함」 같은 상태 칸을 두지 않는다.**
 *    상태 칸을 만드는 순간 "발행한 것을 고칠 수 있나 · 고치면 무엇이 남나 ·
 *    되돌릴 수 있나"라는 결정이 줄줄이 따라온다. 지금 그 물음에 답할 근거가 없고,
 *    없는 채로 칸만 만들면 아무도 안 쓰는 칸이 하나 남는다. 필요해지는 날 더한다.
 *
 * 4) **문서번호에 유일성을 걸지 않는다.**
 *    견적서는 `quote_number` 에 부분 unique 인덱스를 걸었지만, 보고서 번호는
 *    세 조각(`No. [앞] - [중간] - [뒤]`)이고 가운데 `Z494` 같은 조각이 무엇을
 *    뜻하는지 **아직 모른다.** 규칙을 모르는 채로 유일성을 못 박으면, 사람이 종이에
 *    적어 둔 실제 번호를 시스템이 거부하는 일이 생긴다. 규칙을 알게 되는 날 건다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 고객사명 · 발생 장소 · 「상황」 두 칸 · 본문 줄은 사람이 자유롭게 적는 값이라
 * 고객사 사정이 섞인다. 로그나 오류 보고로 그대로 내보내지 않는다.
 * ============================================================================
 */

/**
 * 보고서 종류. **두 양식이 실제로 다르다** — 검사 보고서에는 「정리」 구역도
 * 「조치 완료」 칸도 없고, 검증이 그 둘을 보내면 거절한다
 * (`validation/service-report-input.ts` 의 '종류와 어긋나는 값').
 *
 * 🔴 값이 `ServiceReportKind`(`xlsx/service-report-template.ts`)와 같은지는
 * `service-reports-parity.test.ts` 가 못 박는다. 여기에 값을 더하면 그 시험이
 * 먼저 깨진다 — 양식이 모르는 종류의 보고서가 저장되는 것을 막기 위해서다.
 */
export const serviceReportKindEnum = pgEnum("service_report_kind", ["INSPECTION", "REPAIR"]);

/**
 * 「발생 년월일」(`AK17`)을 날짜로 적었나 글자로 적었나.
 *
 * 양식이 견본으로 `―――` 를 적어 두었을 만큼 **날짜를 모르는 건이 흔하다.**
 * 그래서 채우개도 `Date | string` 을 둘 다 받는다. 저장할 때 둘을 한 칸에 뭉개면
 * 다시 열었을 때 사람이 날짜 칸에 적었는지 글자 칸에 적었는지 알 수 없어, 화면이
 * 어느 쪽 입력칸을 펴야 할지 정하지 못한다.
 *
 * 🔴 **NULL 이 정상이고, 뜻이 있다** — 「발생 년월일」을 아예 적지 않은 보고서다.
 * 화면은 늘 둘 중 하나를 골라 두지만(기본은 `DATE`), 서버로 오는 값은 `occurredOn`
 * 한 칸뿐이고 비어 있으면 날짜도 글자도 없다. 그때 억지로 `DATE` 를 적어 두면
 * "날짜로 적었는데 비어 있다"와 "아예 안 적었다"가 같아진다.
 */
export const serviceReportOccurredOnModeEnum = pgEnum("service_report_occurred_on_mode", [
  "DATE",
  "TEXT",
]);

export const serviceReports = pgTable(
  "service_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * 이 보고서가 딸린 접수 건. 위 머리말의 «판단 1» — NOT NULL 이고 CASCADE 다.
     * 보고서는 접수 건 없이 존재하지 않고, 접수 건을 영구 삭제할 때 함께 사라져야
     * 개인정보 정리가 실제로 끝난다.
     */
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "cascade" }),

    /** 검사(INSPECTION)인가 수리(REPAIR)인가. 위 serviceReportKindEnum 주석 참조. */
    kind: serviceReportKindEnum("kind").notNull(),

    // ── 머리 ────────────────────────────────────────────────────────────

    /**
     * `No. [앞] - [중간] - [뒤]`. 양식이 세 칸이라 표도 세 칸이다 — 합쳐서 담으면
     * 다시 열었을 때 어디서 끊어야 할지 알 수 없다.
     *
     * 앞 조각만 비어 있어도 된다. 가운데·뒤는 검증이 필수로 보므로 NOT NULL 이다
     * (`validation/service-report-input.ts` 의 `reportNumber.middle`·`tail`).
     * 🔴 **유일성은 걸지 않는다** — 위 머리말의 «판단 4».
     */
    reportNumberPrefix: text("report_number_prefix"),
    reportNumberMiddle: text("report_number_middle").notNull(),
    reportNumberTail: text("report_number_tail").notNull(),

    /** 발행일. 여기 적힌 날짜가 그대로 문서에 찍힌다. 목록의 기본 정렬축이다. */
    issuedOn: date("issued_on").notNull(),

    /**
     * 고객사명 → 문서에 실제로 찍히는 글자. 견적서의 `customer_name_text` 와 같은
     * 이유로 NOT NULL 이다 — 종이에 적힌 이름이 없는 보고서는 있을 수 없다.
     * 위 머리말의 «판단 2» 대로 여기에 `customer_id` 는 없다.
     */
    customerNameText: text("customer_name_text").notNull(),
    /** 「고객」 칸 — 고객사 안의 담당 부서·담당자처럼 사람이 따로 적는 값. */
    customerText: text("customer_text"),

    receivedOn: date("received_on"),
    occurrencePlace: text("occurrence_place"),
    occurrencePlaceDetail: text("occurrence_place_detail"),

    /**
     * 「발생 년월일」 세 칸. 위 serviceReportOccurredOnModeEnum 주석 참조 —
     * mode 가 `DATE` 면 `occurred_on_date` 를, `TEXT` 면 `occurred_on_text` 를
     * 본다. mode 가 NULL 이면 둘 다 비어 있다(적지 않은 보고서).
     */
    occurredOnMode: serviceReportOccurredOnModeEnum("occurred_on_mode"),
    occurredOnDate: date("occurred_on_date"),
    /** 날짜를 모를 때 적는 글자. 양식의 견본이 `―――` 다. */
    occurredOnText: text("occurred_on_text"),

    /** 「품명」 첫째 줄(`H19`) — 양식의 드롭다운에서 고른 값. 앞 공백이 글머리표라 다듬지 않는다. */
    productName: text("product_name"),
    /** 「품명」 둘째 줄(`H20`). */
    productCategory: text("product_category"),

    /**
     * 형식 · L/N · S/N. 견적서와 같이 `_text` 로 **글자 스냅샷**이다 — 접수 건의
     * 값이 나중에 정정돼도 이미 낸 보고서는 그대로여야 한다.
     * 🔴 순서를 값 모양으로 짐작하지 말 것: **WU 접두가 L/N, 숫자만인 쪽이 S/N.**
     */
    modelNameText: text("model_name_text"),
    lotNumberText: text("lot_number_text"),
    serialNumberText: text("serial_number_text"),

    /**
     * 제조 년·월과 사용 년수·개월수. 검증이 **0 이상의 정수**만 받는다
     * (`optionalWholeNumber`). 화면은 S/N 7자리(`YYMMNNN`)에서 제조년월을,
     * 제조년월과 접수일에서 사용 기간을 셈해 **빈 칸에만** 채운다 — 사람이 명판을
     * 보고 적은 값은 덮지 않는다.
     *
     * 🔴 사용 개월수가 0이면 화면은 **빈 칸**으로 둔다(2026-09-02 사용자 결정,
     * 원본 발행본이 그 자리에 `-` 를 적었다). 그러니 여기 NULL 은 "0개월"일 수도
     * 있고 "안 셌다"일 수도 있다 — 이 칸으로 사용 기간을 다시 셈하지 말 것.
     */
    manufacturedYear: integer("manufactured_year"),
    manufacturedMonth: integer("manufactured_month"),
    usedYears: integer("used_years"),
    usedMonths: integer("used_months"),

    /**
     * 「상황」 두 칸(`H21`·`H23`). 🔴 **앞 공백을 다듬지 않는다** — 양식 드롭다운의
     * 원본이 `" ・ 수리의뢰"` 처럼 글머리표를 달고 있어서, 다듬으면 문서의 모양이
     * 달라진다(`validation/service-report-input.ts` 의 `optionalRawText`).
     */
    situationRequest: text("situation_request"),
    situationDetail: text("situation_detail"),

    // ── 조치 네 가지 ────────────────────────────────────────────────────

    onSiteRepair: boolean("on_site_repair").notNull().default(false),
    replacementDelivery: boolean("replacement_delivery").notNull().default(false),

    /**
     * 「현품 인수」 — 🔴 **체크와 날짜는 따로다.**
     *
     * 채우개는 `goodsReceipt !== undefined` 로 체크를 찍는다. 즉 **날짜도 번호도
     * 없이 체크만 된 상태가 정상**이고("날짜는 모르지만 현품은 받았다"), 실제로
     * 있다. 날짜의 NULL 여부로 체크를 되살리면 그 상태가 사라져 문서에서 체크가
     * 빠진다. 그래서 체크를 **자기 칸으로** 둔다.
     */
    goodsReceiptChecked: boolean("goods_receipt_checked").notNull().default(false),
    goodsReceiptOn: date("goods_receipt_on"),
    goodsReceiptNumber: text("goods_receipt_number"),

    /**
     * 「조치 완료」 — 🔴 **수리 보고서에만 쓰인다.** 검사 보고서에 이 값을 보내면
     * 검증이 거절한다. 위 goods_receipt 와 같은 이유로 체크와 날짜가 따로다.
     */
    completionChecked: boolean("completion_checked").notNull().default(false),
    completionOn: date("completion_on"),

    /** 「수리 번호」(`AO28`). */
    repairNumber: text("repair_number"),

    // ── 본문 머리글 ─────────────────────────────────────────────────────

    /**
     * 🔴🔴 **「안 줌」과 「일부러 비움」이 서로 다른 뜻인 칸이다. NOT NULL 도 기본값도
     * 걸지 말 것.**
     *
     *   · `NULL`  = 안 줌     → 채우개가 정형 문구를 넣는다
     *                          (`SERVICE_REPORT_FINDINGS_INTRO` =
     *                           「인수품에 대하여 이하의 항목을 확인하였습니다.」)
     *   · `''`    = 일부러 비움 → 아무것도 안 들어간다
     *
     * 채우개가 `body.findingsIntro ?? SERVICE_REPORT_FINDINGS_INTRO` 로 판정하기
     * 때문이다. 화면은 이 칸을 정형 문구로 미리 채워 내놓으므로, 사람이 그 칸을
     * **지웠다는 것은 "이 문장을 넣지 마시오"라는 뜻**이다.
     *
     * 두 값을 같게 저장하면(빈 글자를 NULL 로 바꾸거나, NOT NULL DEFAULT 를 걸어
     * 빈 글자를 못 넣게 하면) **사람이 지운 문장이 다시 열었을 때 문서에서
     * 되살아난다.** 오류도 경고도 없이 그렇게 된다 — 고객사로 나간 뒤에야 안다.
     *
     * 저장하는 쪽도 같은 규칙을 지켜야 한다: 빈 글자를 `NULL` 로 정규화하지 말 것.
     */
    findingsIntro: text("findings_intro"),

    // ── 공통 꼬리(견적서와 같다) ────────────────────────────────────────

    /** 낙관적 잠금. 목록에서 열어 고치는 화면이 있으므로 처음부터 쓴다. */
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
     * 접수 건 상세에서 "이 건으로 나간 보고서들"을 찾는 길. 견적서의
     * `quotes_repair_case_id_not_deleted_idx` 와 같은 자리, 같은 부분 조건이다 —
     * 그 화면은 지워진 보고서를 보여 주지 않으므로 인덱스도 그것만 담는다.
     */
    index("service_reports_repair_case_id_not_deleted_idx")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
    /**
     * 목록의 기본 정렬과 기간 필터. **부분 인덱스가 아닌 것은 일부러다** —
     * 견적서의 `quotes_quote_date_idx` 와 같은 이유로, 지난 기간을 다시 집계할 때
     * 그 사이에 지워진 장까지 세어야 "그때 무슨 일이 있었는가"를 답할 수 있다.
     */
    index("service_reports_issued_on_idx").on(table.issuedOn),
  ]
);

/**
 * ============================================================================
 * 보고서 본문 한 줄
 * ============================================================================
 * `quote_work_scope_lines` 를 그대로 본뜬 모양이다(구역 + 줄 번호 + 글자).
 * 소프트 삭제도 `version` 도 두지 않는 까닭이 그쪽과 같다: **이 줄들을 직접 고치는
 * 경로가 없다.** 저장은 언제나 보고서 한 장을 통째로 저장하는 한 번의 트랜잭션이고,
 * 그 안에서 이 줄들은 통째로 지워지고 다시 들어간다. 동시 수정을 막는 일은 부모의
 * `version` 이 이미 하고 있다.
 *
 * ── 🔴 빈 줄을 버리면 안 된다 ───────────────────────────────────────────
 * `text` 가 빈 글자(`''`)인 줄은 **문서에서 한 줄 띄우라는 뜻**이다. 사람이 Enter 를
 * 두 번 친 것이고, 채우개가 "줄 사이를 띄우고 싶으면 빈 문자열을 한 줄 넣는다"로
 * 정해 두었다(`domain/service-report-form.ts` 의 `serviceReportLines`,
 * `validation/service-report-input.ts` 의 `textLines` — 둘 다 가운데 빈 줄을
 * 살린다). 저장할 때 `text !== ''` 로 걸러내면 **문서의 문단 나누기가 통째로
 * 사라진다.** 오류가 아니라 모양이 달라지는 것이라 아무도 못 알아챈다.
 *
 * 그래서 `text` 는 NOT NULL 이되 **빈 글자가 정상 값**이다. 줄 번호는 구역 안에서
 * 1부터 다시 매기고, 빈 줄도 한 번호를 차지한다 — 그래야 몇 줄을 띄웠는지가 남는다.
 * ============================================================================
 */
export const serviceReportLineSectionEnum = pgEnum("service_report_line_section", [
  "FINDINGS",
  "ACTIONS",
  "SUMMARY",
  "REMARK",
]);

export const serviceReportLines = pgTable(
  "service_report_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceReportId: uuid("service_report_id")
      .notNull()
      .references(() => serviceReports.id, { onDelete: "cascade" }),
    /**
     * 문서의 어느 구역에 적히는가.
     *
     * `FINDINGS`(확인내용) · `ACTIONS`(조치) · `SUMMARY`(정리)는 요청 본문의
     * `body.findings` · `body.actions` · `body.summary` 와 짝이고, `REMARK`(비고)만
     * 본문 바깥의 `remark` 다. 비고를 여기 함께 두는 것은 **모양이 똑같기 때문**이다
     * — 줄 목록이고, 빈 줄이 뜻을 갖고, 통째로 저장된다. 표를 하나 더 만들면 같은
     * 규칙을 두 곳에서 지켜야 한다.
     *
     * 🔴 `SUMMARY` 는 수리 보고서에만 있다(검사 보고서에 보내면 검증이 거절한다).
     * 🔴 이름이 화면·검증과 같은지는 `service-reports-parity.test.ts` 가 못 박는다.
     */
    section: serviceReportLineSectionEnum("section").notNull(),
    /** 구역 안에서의 차례. 저장할 때 1부터 다시 매긴다. */
    lineNo: integer("line_no").notNull(),
    /**
     * 문서에 찍히는 글자 그대로. 🔴 **빈 글자가 정상 값**이다 — 위 머리말의
     * '빈 줄을 버리면 안 된다'. 줄 안의 공백도 다듬지 않는다(들여쓰기는 사람이
     * 뜻을 담아 넣은 것이다).
     */
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("service_report_lines_report_section_line_unique").on(
      table.serviceReportId,
      table.section,
      table.lineNo
    ),
    index("service_report_lines_service_report_id_idx").on(table.serviceReportId),
  ]
);

/**
 * ============================================================================
 * 보고서가 고른 원인 하나
 * ============================================================================
 * 양식 29·30행의 원인 체크박스 열 가지 중 **고른 것만** 한 줄씩 들어간다.
 *
 * ── 왜 boolean 열 개가 아니라 표인가 ────────────────────────────────────
 * 열 개를 칸으로 두면 **"부품불량이 몇 건인가"를 셀 수 없다.** 칸이 늘어날 때마다
 * 집계 질의를 고쳐야 하고, 열 칸을 각각 세는 질의는 사람이 읽지도 고치지도 못한다.
 * 표로 두면 `GROUP BY cause` 한 줄이다.
 *
 * 이 시스템에는 **이미 고장 유형을 집계해 보여 주는 화면이 있다**
 * (`domain/fault-symptom-breakdown.ts`). 보고서의 원인도 같은 길로 갈 값이므로,
 * 그때 표 모양을 바꾸는 마이그레이션을 치르지 않도록 처음부터 표로 만든다.
 *
 * 부모가 소프트 삭제될 때는 행이 실제로 지워지지 않으므로 CASCADE 는 돌지 않는다 —
 * 집계는 `service_reports.is_deleted` 를 조인해서 걸러야 한다.
 * ============================================================================
 */

/**
 * 원인 열 가지.
 *
 * 🔴 **`SERVICE_REPORT_CAUSES`(`xlsx/service-report-template.ts`)와 개수도 값도
 * 순서도 같아야 한다.** 그쪽이 원본이고 여기는 사본이다 — 이 파일이 그 모듈을
 * 값으로 가져오지 않는 것은, 그 모듈이 `zip-reader.ts` 를 거쳐 `node:fs` 를 끌고
 * 오기 때문이다(`domain/service-report-form.ts` 머리말의 같은 항목).
 *
 * 사본이 생겼으니 어긋날 자리도 생겼다. 그것을 `service-reports-parity.test.ts` 가
 * **두 쪽을 서로 견주어** 막는다 — 시험에도 값을 베껴 적지 않는다. 어느 한쪽만
 * 고쳐지면 시험이 먼저 깨진다.
 */
export const serviceReportCauseEnum = pgEnum("service_report_cause", [
  "MANUFACTURING_DEFECT",
  "PART_DEFECT",
  "AGING",
  "TRANSPORT_DAMAGE",
  "STORAGE_DAMAGE",
  "SPEC_SHORTFALL",
  "INSPECTION_MISS",
  "MISHANDLING",
  "NOT_REPRODUCED",
  "OTHER",
]);

export const serviceReportCauses = pgTable(
  "service_report_causes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceReportId: uuid("service_report_id")
      .notNull()
      .references(() => serviceReports.id, { onDelete: "cascade" }),
    /** 고른 원인 하나. 고르지 않은 원인은 행이 없다. */
    cause: serviceReportCauseEnum("cause").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * 같은 원인을 두 번 담지 않는다 — 체크는 하나뿐이라 두 행은 뜻이 없고, 집계할
     * 때 한 건이 두 번 세어진다(검증도 중복을 조용히 하나로 본다).
     */
    uniqueIndex("service_report_causes_report_cause_unique").on(
      table.serviceReportId,
      table.cause
    ),
    index("service_report_causes_service_report_id_idx").on(table.serviceReportId),
  ]
);
