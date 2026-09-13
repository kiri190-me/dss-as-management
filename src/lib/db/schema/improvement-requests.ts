import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 개선 요청 — 누구나 적는 글 한 줄 (2026-09-13)
 * ============================================================================
 * 설정 › 「개선 요청」 화면의 그릇이다. 모든 사용자가 글을 적고, 목록은 모두가
 * 본다. 상태를 어떻게 옮기고 누가 무엇을 할 수 있는지는 전부
 * src/lib/domain/improvement-request.ts 에 있다 — 여기는 그 규칙이 깨진 행이
 * 들어오지 못하게 막는 마지막 방어선이다.
 *
 * ── 상태는 셋이다 ───────────────────────────────────────────────────────
 * 접수(OPEN) → 진행중(IN_PROGRESS) → 해결(RESOLVED). 상태를 바꾸는 사람은
 * 관리자 · 최고관리자 · 개발자이고, **어느 방향으로든** 바꿀 수 있다(되돌리기
 * 포함, 접수에서 곧바로 해결도 된다). 순서를 강제하는 전이표를 두지 않는 것이
 * 승인된 설계다 — 글 한 줄의 진행 표시라 잘못 눌렀으면 되돌리면 된다.
 *
 * ── 🔴 상태와 네 칸은 같은 말이어야 한다 ────────────────────────────────
 * in_progress_by/at · resolved_by/at 는 **누가 언제 그 상태로 옮겼는가**다.
 * 아래 CHECK 셋이 지키는 규칙은 도메인의 planImprovementRequestStatusChange 가
 * 계산하는 규칙과 **글자 그대로 같다.** 한쪽만 고치면 화면은 저장을 시도하고 DB 는
 * 23514 로 거절해, 사람에게는 이유 없는 실패만 남는다.
 *
 *  · 쌍은 함께 있다 — by 만 있고 at 이 없는 행, 그 반대도 없다.
 *  · 접수(OPEN)면 네 칸 모두 NULL 이다.
 *  · 진행중(IN_PROGRESS)이면 in_progress 쌍이 있고 resolved 쌍은 NULL 이다.
 *  · 해결(RESOLVED)이면 resolved 쌍이 있다. in_progress 쌍은 **있어도 없어도
 *    된다** — 진행중을 거쳐 왔으면 그 기록이 남고, 접수에서 곧바로 해결했으면
 *    비어 있다. 해결로 옮길 때 그 기록을 지우지 않는 것은 「누가 맡아서
 *    했는가」가 해결 뒤에 오히려 가장 궁금한 값이기 때문이다.
 *
 * ── 길이 CHECK 는 검증과 같은 수다 ──────────────────────────────────────
 * 본문은 1~2000자. 도메인의 IMPROVEMENT_REQUEST_BODY_MAX_CHARS 와 **같은 수**이고,
 * 둘 다 char_length(코드 포인트 수)로 센다. 숫자가 어긋나지 않는지는 검증 시험
 * (validation/improvement-request-input.test.ts)이 이 파일의 글자를 읽어 대조한다.
 * 여기서 숫자를 바꾸면 그쪽도 함께 바꿀 것.
 *
 * 상수를 가져다 쓰지 않고 숫자를 적은 이유: 스키마 파일은 drizzle-kit 이 따로
 * 읽으므로 `@/` 경로를 import 하지 않고, 도메인 층도 가져오지 않는다 — 이 폴더의
 * 다른 파일이 모두 그렇다(domestic-order-sheet-settings.ts 의 같은 자리).
 *
 * ── 휴지통은 두지 않는다 ────────────────────────────────────────────────
 * 지우기는 **바로 지운다**(승인된 결정). 소프트 삭제 4칼럼(DATABASE_DESIGN.md
 * #8)이 없는 이유가 그것이다. 글 한 줄은 되돌릴 수 없으면 곤란한 기록이 아니고,
 * 무엇이 언제 지워졌는지는 감사 로그가 남긴다(PURGE).
 *
 * ── version 은 처음부터 둔다 ────────────────────────────────────────────
 * 작성자가 글을 고치는 동안 관리자가 상태를 바꾸는 일이 실제로 일어난다. 그때 뒤에
 * 저장한 쪽이 앞사람의 변경을 조용히 덮으면 안 된다 — 특히 「진행중이 된 글은
 * 작성자도 못 고친다」는 규칙이, 먼저 읽어 둔 화면에서 저장하는 순간 뚫린다.
 * 칸을 나중에 더하는 마이그레이션을 한 번 덜 하려고 지금 만든다.
 *
 * ── users FK 는 전부 RESTRICT ──────────────────────────────────────────
 * 이 저장소의 다른 표들이 users 를 가리키는 방식과 같다 — 글을 적었거나 상태를
 * 옮긴 계정이 사라지면 「누가」가 끊긴다.
 *
 * ── 메뉴 칸은 열쇠이고 CHECK 가 없다 (2026-09-13) ──────────────────────
 * menu_key 는 「이 요청이 어느 메뉴 아래의 일인가」다. 메뉴 **이름이 아니라**
 * navigation.ts 의 navItems `key` 를 담는다 — 사이드바 이름표가 바뀌어도 기록이
 * 따라간다. 고를 수 있는 값과 열쇠 → 이름은 domain/improvement-request.ts 가 정한다.
 *
 *  · NULL = 「메뉴 지정 안 함」 — 이 칸이 생기기 전에 적힌 글이다. 기본값을 두지
 *    않는 것도 그래서다: 옛 글에 아무 메뉴나 채워 넣으면 사실이 아닌 기록이 된다.
 *  · DB CHECK 를 두지 않는다. 메뉴 열쇠는 메뉴가 늘고 줄 때마다 바뀌는 목록이라,
 *    CHECK 로 박으면 메뉴 하나를 더할 때마다 마이그레이션이 따라붙고, 메뉴 하나를
 *    뺄 때는 그 열쇠를 가진 옛 글 때문에 새 CHECK 를 걸 수 없다. 고객사 줄 색
 *    (customers.row_color)과 같은 방식이다 — 검증이 쓸 때만 막고
 *    (validation/improvement-request-input.ts), 없어진 열쇠는 화면이
 *    「(없어진 메뉴)」로 읽는다.
 *  · 인덱스를 두지 않는다 — 작은 표이고, 메뉴로 거르기는 화면이 받은 목록 위에서 한다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * body 는 자유 입력이라 사람 이름이나 고객사 사정이 섞일 수 있다. 다른 표의 메모
 * 칸들과 같은 규칙이다 — 로그나 오류 보고로 그대로 내보내지 않는다.
 * ============================================================================
 */

/**
 * 🔴 값 목록은 domain/improvement-request.ts 의 IMPROVEMENT_REQUEST_STATUSES 와
 * **글자 그대로 같아야 한다**(스키마가 도메인 층을 가져오지 않는 이 저장소의
 * 관례다). 갈라지지 않도록 그 파일의 시험이 둘을 맞춰 본다.
 */
export const improvementRequestStatusEnum = pgEnum("improvement_request_status", [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
]);

export const improvementRequests = pgTable(
  "improvement_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 사람이 적는 글. 1~2000자(파일 헤더의 '길이 CHECK 는 검증과 같은 수다'). */
    body: text("body").notNull(),
    /**
     * 어느 메뉴 아래의 일인가 — navItems 의 key(이름이 아니다). NULL = 메뉴 지정 안 함
     * (이 칸이 생기기 전의 글). 기본값·CHECK·인덱스를 두지 않는 까닭은 파일 헤더의
     * '메뉴 칸은 열쇠이고 CHECK 가 없다'.
     */
    menuKey: text("menu_key"),
    status: improvementRequestStatusEnum("status").notNull().default("OPEN"),
    /** 진행중으로 옮긴 사람과 때. 파일 헤더의 '상태와 네 칸은 같은 말이어야 한다'. */
    inProgressBy: uuid("in_progress_by").references(() => users.id, { onDelete: "restrict" }),
    inProgressAt: timestamp("in_progress_at", { withTimezone: true }),
    /** 해결로 옮긴 사람과 때. */
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** 작성자. 「접수 상태인 자기 글만 고칠 수 있다」가 이 칸을 본다. */
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 낙관적 잠금 토큰. 파일 헤더의 'version 은 처음부터 둔다' 참조. */
    version: integer("version").notNull().default(1),
  },
  (table) => [
    // 목록은 언제나 최근 글부터 읽는다 — 이 표에서 가장 많이 타는 길이다.
    index("improvement_requests_created_at_idx").on(table.createdAt),
    check(
      "improvement_requests_body_length",
      sql`char_length(${table.body}) BETWEEN 1 AND 2000`
    ),
    // 쌍은 함께 있다 — by 만 있고 at 이 없는 행, 그 반대도 없다.
    check(
      "improvement_requests_in_progress_pair",
      sql`(${table.inProgressBy} IS NULL AND ${table.inProgressAt} IS NULL) OR (${table.inProgressBy} IS NOT NULL AND ${table.inProgressAt} IS NOT NULL)`
    ),
    check(
      "improvement_requests_resolved_pair",
      sql`(${table.resolvedBy} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.resolvedBy} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`
    ),
    // 상태와 칸이 맞는다 — 도메인의 planImprovementRequestStatusChange 와 같은 규칙.
    // 쌍 CHECK 가 at 칸을 함께 묶지만, 이 CHECK 만 읽어도 규칙이 보이도록 네 칸을
    // 모두 적는다.
    check(
      "improvement_requests_status_columns",
      sql`
        (${table.status} = 'OPEN'
          AND ${table.inProgressBy} IS NULL AND ${table.inProgressAt} IS NULL
          AND ${table.resolvedBy} IS NULL AND ${table.resolvedAt} IS NULL)
        OR
        (${table.status} = 'IN_PROGRESS'
          AND ${table.inProgressBy} IS NOT NULL AND ${table.inProgressAt} IS NOT NULL
          AND ${table.resolvedBy} IS NULL AND ${table.resolvedAt} IS NULL)
        OR
        (${table.status} = 'RESOLVED'
          AND ${table.resolvedBy} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)
      `
    ),
  ]
);
