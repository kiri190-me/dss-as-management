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
import { customers } from "./customers";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 고객 안내 창구 — 고객사가 밖에서 보는 현황판과, 거기로 들어온 수리 의뢰
 * ============================================================================
 *
 * 지금 고객사는 「수리의뢰서.xlsx」를 메일로 보내고 진행 상황은 전화로 묻는다.
 * 그 둘을 고객사 전용 비밀 주소 하나로 옮긴다 — 들어가면 맡긴 물건의 현황이
 * 보이고, 거기서 새 의뢰서를 넣는다.
 *
 * ── 네트워크 경계 ───────────────────────────────────────────────────────
 *
 * 그 화면은 **회사 밖 호스팅**(dss-home)에 있고 이 시스템은 사내 NAS에만 있다.
 * **사내로 들어오는 연결은 하나도 만들지 않는다** — 의뢰를 가져오는 것도,
 * 링크를 심는 것도, 현황을 내보내는 것도 전부 이쪽이 먼저 거는 연결이다.
 * 그래서 밖이 통째로 털려도 공격자는 사내망 문 앞까지 오지 못한다.
 *
 * ── 이 파일의 표 넷 ─────────────────────────────────────────────────────
 *
 *  customer_repair_links         고객사별 비밀 주소. **주인은 이쪽이다**
 *  customer_repair_requests      밖에서 당겨온 의뢰(아직 접수가 아니다)
 *  customer_status_options       고객에게 보여줄 상태 목록(관리자 관리)
 *  repair_case_customer_status   접수 한 건의 고객 안내 상태 + 비고
 * ============================================================================
 */

/**
 * 고객사별 비밀 주소.
 *
 * ■ 주인이 이쪽인 이유
 *
 * 링크는 담당자가 **진짜 고객사 목록에서 골라** 발급한다. 밖에서 만들게 하면
 * 고객사 이름을 자유 입력으로 받게 되고, 그 순간 외부 입력이 고객사 마스터에
 * 닿는 길이 열린다. 여기서 만들어 밖으로 밀어 넣으면 그 길이 아예 없다.
 *
 * ■ 밖으로 나가는 것은 이 행의 `id`뿐이다
 *
 * `customers.id`는 내보내지 않는다. 공개 서버는 인터넷에 열려 있어 언젠가
 * 털린다고 가정해야 하고, 그때 사내 고객사 식별자가 함께 새면 안 된다.
 * 밖에서는 이 `id`를 `nas_link_id`라 부르며, 그것 말고 고객사에 대해 아는 것은
 * 화면에 띄울 이름 하나뿐이다.
 *
 * ■ 평문 토큰은 어디에도 저장하지 않는다
 *
 * sha256만 남긴다. 32바이트 난수라 사전 공격 대상이 아니어서 느린 해시가 필요
 * 없다. 평문은 발급 순간 화면에 한 번 뜨고 사라진다 — 잃어버리면 재발급만
 * 가능하고 복구는 원리상 불가능하다.
 */
export const customerRepairLinks = pgTable(
  "customer_repair_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    tokenHash: text("token_hash").notNull(),

    /** "구매팀용" 처럼 사람이 알아보게 적어 두는 메모. */
    label: text("label"),

    /**
     * 회수. 행을 지우지 않는 이유: 이미 들어온 의뢰가 이 링크를 가리키고 있고,
     * "어느 링크로 들어왔나"는 나중에 유출을 조사할 때 필요한 정보다.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, {
      onDelete: "restrict",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("customer_repair_links_token_hash_unique").on(table.tokenHash),
    // 한 고객사에 살아 있는 링크는 하나만. 둘이면 어느 것을 회수해야 하는지
    // 사람이 판단해야 하고, 현황을 내보낼 때도 어디로 보낼지 갈린다.
    uniqueIndex("customer_repair_links_active_customer_unique")
      .on(table.customerId)
      .where(sql`revoked_at IS NULL`),
  ]
);

/**
 * 밖에서 당겨온 수리 의뢰.
 *
 * ■ 이것은 접수(repair_cases)가 아니다
 *
 * 접수에는 `workflowType`(유상/무상 × 제품 3종)과 `billingType`이 필수인데
 * 이건 상업적 판단이라 고객이 알 수 없다. 제품모델도 마스터에 맞춰야 한다.
 * 그래서 이 표는 **담당자가 옮겨 적을 내용을 고객이 대신 채워 준 것**이고,
 * 접수로 만드는 것은 사람이 한다. 자동 전환은 원리상 불가능하다.
 *
 * ■ 고객사 마스터 오염이 구조적으로 불가능하다
 *
 * `customer_id`가 not null인데 그 값이 **링크에서만** 온다 — 링크는 담당자가
 * 진짜 목록에서 고른 것이다. 고객이 친 글자에서 고객사로 가는 경로가 코드에
 * 존재하지 않는다. 전환할 때도 고정된 `customerId`로 가고
 * `resolveOrCreateCustomerByName()`을 타지 않는다.
 *
 * ■ 칸 이름이 「수리의뢰서.xlsx」를 그대로 따른다
 *
 * 담당자와 고객사가 이미 그 양식으로 대화하고 있어서, 이름을 바꾸면 같은 것을
 * 두 이름으로 부르게 된다.
 */
export const customerRepairRequests = pgTable(
  "customer_repair_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * 공개 쪽 `repair_requests.id`.
     *
     * **중복 수입을 막는 유일한 근거다.** 당겨오기는 "받았다"고 알려주기 전에
     * 죽으면 같은 건을 다시 받는데(그렇게 만든 것이다 — 잃는 것보다 겹치는
     * 편이 낫다), 그 겹침을 이 unique가 흡수한다.
     */
    sourceId: uuid("source_id").notNull(),

    customerLinkId: uuid("customer_link_id")
      .notNull()
      .references(() => customerRepairLinks.id, { onDelete: "restrict" }),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    /** 어느 양식으로 받았나. 지금은 RF 하나뿐이고 나중에 제품군별로 갈린다. */
    formKind: text("form_kind").notNull().default("RF"),

    // ───── 고객 정보 ─────
    companyName: text("company_name").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),

    // ───── 수리 의뢰 품 정보 ─────
    productModelName: text("product_model_name").notNull(),
    lotNumber: text("lot_number").notNull(),
    serialNumber: text("serial_number").notNull(),
    endUser: text("end_user").notNull(),
    returnAddress: text("return_address"),

    // ───── 설비 RF System 정보 (PC1~PC3 × Generator/Matcher) ─────
    chamberInfo: text("chamber_info"),
    pc1GeneratorLotNumber: text("pc1_generator_lot_number"),
    pc1GeneratorModel: text("pc1_generator_model"),
    pc1MatcherLotNumber: text("pc1_matcher_lot_number"),
    pc1MatcherModel: text("pc1_matcher_model"),
    pc2GeneratorLotNumber: text("pc2_generator_lot_number"),
    pc2GeneratorModel: text("pc2_generator_model"),
    pc2MatcherLotNumber: text("pc2_matcher_lot_number"),
    pc2MatcherModel: text("pc2_matcher_model"),
    pc3GeneratorLotNumber: text("pc3_generator_lot_number"),
    pc3GeneratorModel: text("pc3_generator_model"),
    pc3MatcherLotNumber: text("pc3_matcher_lot_number"),
    pc3MatcherModel: text("pc3_matcher_model"),

    // ───── 고장내용 상세 ─────
    alarmName: text("alarm_name"),
    symptomDescription: text("symptom_description").notNull(),
    processSourcePower: text("process_source_power"),
    processBiasPower: text("process_bias_power"),
    issuePower: text("issue_power"),
    normalPosition: text("normal_position"),
    issuePosition: text("issue_position"),
    customerActions: text("customer_actions"),

    // ───── 고객사측 추가 확인 사항 (양식의 ①~⑥) ─────
    issueProcessScope: text("issue_process_scope"),
    issueIntermittency: text("issue_intermittency"),
    issueTiming: text("issue_timing"),
    issueProcessCondition: text("issue_process_condition"),
    chamberCounts: text("chamber_counts"),
    customerInspectionDetail: text("customer_inspection_detail"),

    // ───── 처리 상태 ─────
    /**
     * `NEW` → `CONVERTING` → `CONVERTED` / `REJECTED`.
     *
     * `CONVERTING`이 있는 이유: 두 사람이 동시에 「접수 만들기」를 누르면
     * 접수가 둘 생긴다. 전환은 이 칸을 원자적으로 선점하고 시작한다
     * (`WHERE status='NEW'`가 0행이면 이미 누군가 잡은 것이다).
     *
     * pgEnum을 쓰지 않는다 — enum 값은 나중에 뺄 수 없다. 문자열 + check가
     * 같은 일을 하면서 되돌릴 수 있다.
     */
    status: text("status").notNull().default("NEW"),

    /**
     * 전환된 접수. `on delete set null`인 이유는 `attachments`와 같다 —
     * 접수를 영구 삭제해도 "이런 의뢰가 있었다"는 기록은 남아야 한다.
     */
    convertedRepairCaseId: uuid("converted_repair_case_id").references(
      () => repairCases.id,
      { onDelete: "set null" }
    ),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedBy: uuid("converted_by").references(() => users.id, {
      onDelete: "restrict",
    }),

    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    rejectReason: text("reject_reason"),

    /** 고객이 밖에서 보낸 시각. 우리가 가져온 시각과 다르다. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    pulledAt: timestamp("pulled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_repair_requests_source_id_unique").on(table.sourceId),
    check(
      "customer_repair_requests_status_check",
      sql`${table.status} IN ('NEW', 'CONVERTING', 'CONVERTED', 'REJECTED')`
    ),
    // 알림과 목록이 매번 도는 조회 — 아직 처리 안 한 것.
    index("customer_repair_requests_new_idx")
      .on(table.submittedAt)
      .where(sql`status = 'NEW'`),
    index("customer_repair_requests_customer_id_idx").on(table.customerId),
  ]
);

/**
 * 고객에게 보여줄 상태 목록 — 관리자가 관리한다.
 *
 * ■ 왜 고정 목록(enum)이 아닌가
 *
 * 사용자가 기본 일곱을 정하면서 "다른 내용을 추가할 수도 있도록"이라고 했다.
 * enum이면 값을 더할 때마다 마이그레이션이고, 뺄 수는 아예 없다.
 *
 * ■ 지우지 않고 비활성만 한다
 *
 * 이미 그 상태를 쓴 접수가 있다. 지우면 그 접수의 상태가 사라지거나 FK가
 * 막는다. 비활성은 "앞으로 고르지 못한다"이지 "지난 것을 없앤다"가 아니다.
 * (이 저장소의 `exception_statuses`가 같은 판단을 하고 있다.)
 *
 * ■ 사내 워크플로 상태와 다른 어휘다
 *
 * `repair_status`(인수점검 대기·교산 회신 대기…)는 사내 업무 단계이고, 이쪽은
 * 고객에게 하는 안내다. 겹치는 말이 있어도(수리 중) 같은 것이 아니다 —
 * 사용자가 "실제 수리품 현황과는 다를 수 있다"고 못 박았다.
 */
export const customerStatusOptions = pgTable(
  "customer_status_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** 화면에 그대로 나가는 글자. 코드가 아니라 이것이 곧 표시값이다. */
    label: text("label").notNull(),

    /** 드롭다운에 뜨는 순서. 작을수록 위. */
    displayOrder: integer("display_order").notNull().default(0),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    // 살아 있는 것 중에서만 유일하다. 비활성으로 내린 이름은 나중에 다시
    // 쓸 수 있어야 한다(이 저장소의 부분 unique 관례와 같다).
    uniqueIndex("customer_status_options_active_label_unique")
      .on(table.label)
      .where(sql`is_active = true`),
  ]
);

/**
 * 접수 한 건의 **고객 안내 상태**.
 *
 * ■ repair_cases에 칸을 더하지 않고 표를 나눈 이유 셋
 *
 * 1. 사용자가 못 박았듯 **이 값은 실제 진행과 다를 수 있다.** 별도 표로 두면
 *    그 분리가 관례가 아니라 구조가 된다 — 워크플로 상태와 섞일 수 없다.
 * 2. `repair_cases`는 8개 표와 조인되어 목록·상세·대시보드가 전부 쓴다.
 *    칸을 더하면 그 조인이 함께 넓어진다.
 * 3. `updateRepairCase()`의 구역별 허용 목록(엄격한 화이트리스트)을 건드리지
 *    않는다.
 *
 * ■ 행이 없으면 "정하지 않음"이다
 *
 * 고객 화면에는 `-`로 나간다. 워크플로 상태에서 자동으로 채우지 않는다 —
 * 그러면 "사람이 정한다"는 전제가 첫날부터 무너지고, 사내 진행 단계가
 * 그대로 밖으로 나가게 된다.
 */
export const repairCaseCustomerStatus = pgTable(
  "repair_case_customer_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "cascade" }),

    /**
     * 고른 상태. null이면 비고만 적어 둔 것이다 — 상태는 아직 못 정했는데
     * 남길 말은 있는 경우가 실제로 있다.
     */
    statusOptionId: uuid("status_option_id").references(
      () => customerStatusOptions.id,
      { onDelete: "restrict" }
    ),

    /** 비고. 고객 화면에 그대로 나간다. */
    note: text("note"),

    /** 낙관적 잠금. 두 담당자가 같은 건을 동시에 고칠 때 뒤엣것이 앞엣것을 조용히 덮지 않게. */
    version: integer("version").notNull().default(1),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    // 접수 한 건에 하나뿐이다.
    uniqueIndex("repair_case_customer_status_case_unique").on(table.repairCaseId),
  ]
);

/**
 * 마지막으로 밖에 내보낸 시각 — 스냅샷 동기화의 기록.
 *
 * 표가 아니라 링크 행에 칸으로 둘 수도 있었지만, 링크는 담당자가 만드는 것이고
 * 이건 기계가 적는 것이라 섞지 않는다. 지금은 「지금 내보내기」가 언제 돌았는지
 * 화면에 보여주는 데만 쓴다.
 */
export const customerPortalSyncLog = pgTable("customer_portal_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerLinkId: uuid("customer_link_id")
    .notNull()
    .references(() => customerRepairLinks.id, { onDelete: "cascade" }),
  itemCount: integer("item_count").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 씨앗으로 넣을 기본 일곱. 사용자가 정한 말을 그대로 쓴다. */
export const DEFAULT_CUSTOMER_STATUS_LABELS = [
  "점검대기",
  "점검중",
  "PO대기중",
  "수리 대기",
  "수리 중",
  "수리 완료",
  "출하대기",
] as const;
