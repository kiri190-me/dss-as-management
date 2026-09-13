import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// A/S 접수 중 새 고객사를 입력한 이름만으로 최소 마스터 레코드로 만들 수
// 있도록(연락처는 나중에 채움) contact_* 컬럼을 nullable로 완화했다(A/S
// INTAKE 고객사/End-User 자유 입력 체크포인트, 승인된 마이그레이션). name
// 자체는 그대로 필수다 — 접수 화면에서 입력한 문자열이 항상 채워진다.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    // 대표 담당자의 직급·메모 — 2026-09-13 사용자 요청으로 고객사 담당자
    // (customer_contacts)와 같은 칸을 갖추려고 더했다. 선택 입력이고 상한은 입력
    // 검증(validation/customer-update-input.ts)이 지킨다(DB CHECK 없음).
    contactTitle: text("contact_title"),
    contactMemo: text("contact_memo"),
    // 내자 정리 목록에서 이 고객사의 줄에 칠할 배경색. 비어 있으면 색을 칠하지
    // 않는다(대부분의 고객사가 그렇다).
    //
    // 여기 들어가는 값은 "amber" 같은 **팔레트 키**이지 "#FFE4B5" 같은 색
    // 코드가 아니다(domain/customer-row-color.ts). 색 코드를 담아 두면 (1) 나중에
    // "색이 너무 진하다"고 느껴질 때 39개 고객사의 값을 데이터 마이그레이션으로
    // 고쳐야 하고, (2) 밝은 화면과 어두운 화면에 서로 다른 색조를 줄 방법이
    // 없다 — 한 칸에 색이 하나뿐이라서다. 키만 담아 두면 그 두 가지가 전부 코드
    // 수정으로 끝난다.
    //
    // 팔레트에 없는 값이 남아도(색 하나를 나중에 뺀 경우) 화면은 "색 없음"으로
    // 조용히 떨어진다. 그래서 이 컬럼에는 CHECK 제약도, 인덱스도 두지 않는다 —
    // 거르는 조건이 아니라 그리는 값이고, 39행짜리 표다.
    rowColor: text("row_color"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("customers_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
    // 공백/대소문자 정규화 후 이름이 같은 활성 고객사를 막는다 — 접수 화면의
    // "새 고객사로 등록" 흐름이 사람이 봤을 때 사실상 같은 이름으로 중복
    // 마스터 레코드를 만들지 못하게 하는 DB 레벨 최종 방어선이다(실데이터
    // 감사로 현재 데이터에 이 정규화 기준 중복이 없음을 확인한 뒤 추가).
    uniqueIndex("customers_normalized_name_unique")
      .on(sql`lower(regexp_replace(btrim(${table.name}), '\\s+', ' ', 'g'))`)
      .where(sql`is_deleted = false`),
  ]
);

// contact_name/contact_email이 여기 없다 — End-User 다중 담당자 체크포인트
// (감사 승인 완료)부터 End-User의 연락처는 end_user_contacts(1:N)가 유일한
// 정상 표현이다. 이 두 컬럼은 원래도 애플리케이션 코드가 쓴 적이 없었고
// (resolveOrCreateEndUserByName은 항상 {customerId, name}만 삽입했다),
// dev seed 스크립트가 mock 데모 데이터로만 채워둔 상태였다(백필 후 제거 —
// 마이그레이션 파일 참고). phone/department/title은 도입하지 않는다
// (PROJECT_REQUIREMENTS.md/DATABASE_DESIGN.md 어디에도 근거가 없음).
// — 담당자 쪽(end_user_contacts)은 2026-09-13 사용자 요청으로 직급·전화·메모를
// 갖게 됐다(그 표 주석). 이 end_users 표 자체에는 여전히 두지 않는다.
export const endUsers = pgTable(
  "end_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("end_users_customer_id_idx").on(table.customerId),
    index("end_users_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
    // customers와 동일한 정규화 규칙, 단 같은 customer_id 안에서만 유일해야
    // 한다 — 서로 다른 고객사 아래에 같은 이름의 End-User(예: "본사")가
    // 있는 것은 정상이다.
    uniqueIndex("end_users_customer_normalized_name_unique")
      .on(table.customerId, sql`lower(regexp_replace(btrim(${table.name}), '\\s+', ' ', 'g'))`)
      .where(sql`is_deleted = false`),
  ]
);

/**
 * End-User 다중 담당자(체크포인트, 감사 승인 완료) — 하나의 End-User가
 * 여러 담당자를 가질 수 있다. contact_name은 NOT NULL이다(이 행 자체의
 * 존재 이유가 "누군가를 가리키는 것"이므로 이름 없는 담당자 행은 의미가
 * 없다) — end_users/customers의 contact_name이 nullable이었던 것과는
 * 다른 이유다(그쪽은 "고객사/End-User 자체는 있지만 담당자를 아직 모름").
 * contact_email은 선택 입력(이메일을 아직 모를 수 있음).
 *
 * 직급(title)·전화(phone)·메모(memo)는 2026-09-13 사용자 요청으로 더했다 —
 * 처음에는 요구사항 문서에 근거가 없어 두지 않았고 "필요해지면 별도의 추가
 * 마이그레이션으로 도입한다"고 적어 두었던 바로 그 경우다. 칸 이름과 규칙은
 * 고객사 담당자(customer_contacts)와 같다 — 모두 선택 입력이고, 길이 상한은
 * 입력 검증(validation/end-user-input.ts, 상한은 customer-contact-input.ts 의
 * 상수)이 지킨다(DB CHECK 없음). 부서(department)는 요청에 없어 두지 않는다.
 *
 * repair_cases.contact*_snapshot과는 완전히 독립이다 — 이 테이블이나
 * end_users/customers의 어떤 mutation도 repair_cases를 절대 쓰지 않는다
 * (그 반대도 마찬가지). 접수 시점 스냅샷은 그 시점 그대로 영구 보존된다.
 */
export const endUserContacts = pgTable(
  "end_user_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endUserId: uuid("end_user_id")
      .notNull()
      .references(() => endUsers.id, { onDelete: "restrict" }),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email"),
    // 2026-09-13 사용자 요청 — customer_contacts 와 같은 칸(위 표 주석).
    title: text("title"),
    phone: text("phone"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8) — included
    // from day one like every other table here, even though no restore/trash
    // UI ships in the first implementation phase (same "schema-ready, UI
    // deferred" state customers/end_users are already in).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("end_user_contacts_end_user_id_idx").on(table.endUserId),
    index("end_user_contacts_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
  ]
);

/**
 * 고객사 다중 담당자(사용자 요청 2026-09-13) — 고객사 하나에 담당자를 여러 명
 * 둘 수 있다.
 *
 * ── 대표 담당자 칸과의 관계 ─────────────────────────────────────────────
 * customers.contact_name/contact_email/contact_phone은 「대표 담당자」로 그대로
 * 남는다. 이 표는 그 칸과 **따로** 있는 목록이다(사용자 결정). 둘을 섞지
 * 않는다 — 대표 담당자가 이 목록의 한 줄로 저절로 들어오지 않고, 목록의 한
 * 줄이 대표 담당자 칸을 바꾸지도 않는다. 기존 대표 담당자 값은 이 표로
 * 옮기지 않았다(백필 없음 — end_user_contacts 도입 때와 다르다).
 *
 * ── 칸 ──────────────────────────────────────────────────────────────────
 * contact_name은 NOT NULL이다 — end_user_contacts와 같은 이유다(이 행의 존재
 * 이유가 누군가를 가리키는 것이다). 나머지는 모두 선택이다. 고객사 담당자는
 * 사용자 요청(2026-09-13)으로 직급(title)·전화·메모를 둔다 — 같은 날의 뒤이은
 * 요청으로 end_user_contacts 와 대표 담당자 칸(customers.contact_title/
 * contact_memo)도 같은 칸을 갖추게 됐다. 부서는 요청에 없어 두지 않는다. 길이 상한은 입력 검증
 * (validation/customer-contact-input.ts)이 지킨다 — customers·end_user_contacts
 * 와 마찬가지로 DB CHECK는 두지 않는다.
 *
 * ── 접수 건 스냅숏과 독립 ───────────────────────────────────────────────
 * repair_cases.contact*_snapshot과는 완전히 독립이다 — 이 표의 어떤 mutation도
 * repair_cases를 쓰지 않는다(그 반대도 마찬가지). 접수 시점 스냅숏은 그 시점
 * 그대로 영구 보존된다.
 *
 * ── 개인정보 ────────────────────────────────────────────────────────────
 * 이름·직급·전화·이메일·메모는 개인정보다. 서버 로그에도, audit_logs의
 * previous_value/new_value에도 값을 싣지 않는다 — customers-trash.ts가 대표
 * 담당자 칸과 end_user_contacts에 대해 지키는 규칙과 같다.
 */
export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    contactName: text("contact_name").notNull(),
    title: text("title"),
    phone: text("phone"),
    email: text("email"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("customer_contacts_customer_id_idx").on(table.customerId),
    index("customer_contacts_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
  ]
);
