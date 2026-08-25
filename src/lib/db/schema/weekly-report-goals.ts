import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 사람이 매주 한 줄씩 적는 것
 * ============================================================================
 * 원본 엑셀 현황판 오른쪽에는 `RFG 금주 목표` · `MB 금주 목표` 두 상자가 있고,
 * 그 안에 이런 줄이 늘어서 있다:
 *
 *     [INVENIA] D260706_RFK300FH-AD1_2111171_WT7351: 견적서 발행
 *      └고객사   └인수번호  └형식      └L/N     └S/N   └여기만 사람이 친다
 *
 * 이 표가 담는 것은 **오른쪽 끝 한 조각**뿐이다(goal_text). 나머지는 전부
 * 수리 건에서 읽어 그때그때 만든다(domain/weekly-report-goal.ts 의
 * buildGoalPrefix).
 *
 * ── 앞부분을 저장하지 않는 이유 ─────────────────────────────────────────
 * 고객사명·인수번호·형식·L/N·S/N 을 여기 베껴 두면, 나중에 수리 건의 형식이나
 * S/N 이 고쳐졌을 때 **목표 줄만 옛 값으로 남는다.** 그러면 같은 장비가 화면
 * 두 곳에서 서로 다른 이름으로 불리고, 어느 쪽이 맞는지 아무도 답할 수 없다.
 *
 * 내자 정리는 같은 다섯 값을 **자기 칸에 두기로** 반대 판단을 했는데
 * (schema/domestic-orders.ts 의 '여기에도 있다'), 그 이유는 그 표에 **수리 건
 * 연결이 없는 줄**이 실제로 있어서 조인해 올 곳 자체가 없기 때문이다. 여기는
 * 그렇지 않다 — repair_case_id 가 NOT NULL 이라 앞부분을 만들 재료가 언제나
 * 있다. 재료가 있는 쪽에서 굳이 두 벌을 만들 이유는 없다.
 *
 * RFG 상자로 갈지 MB 상자로 갈지도 저장하지 않는다. 그것은 수리 건의 워크플로
 * 종류가 정하고(domain/weekly-report.ts 의 foldWeeklyReportKind), 종류가 바뀌면
 * 목표 줄도 따라 옮겨 가는 것이 맞다.
 *
 * ── ON DELETE CASCADE 인 이유 ───────────────────────────────────────────
 * 목표 줄은 **그 수리 건에 딸린 값**이다. 건이 사라지면 "무엇의 목표인가"를
 * 말할 수 없어서, 부모 없이 남은 목표는 그 자체로 뜻이 없다 —
 * domestic_order_due_dates 가 같은 이유로 같은 방식을 쓴다(그 파일 헤더).
 *
 * 내자 정리(domestic_orders.repair_case_id)가 SET NULL 인 것과 갈리는 지점이
 * 여기다. 그쪽이 남는 이유는 **정산 기록이 접수 건보다 오래 살아야 하기
 * 때문**이다 — 세금계산서와 입금 사실은 그 거래의 원인이 지워진 뒤에도 남아야
 * 하는 회계 기록이다. 금주 목표에는 그런 성질이 없다: "이번 주에 견적서를
 * 내겠다"는 그 건이 없어지면 함께 없어지는 말이고, 남겨 두면 어느 건의
 * 목표인지 영영 알 수 없는 고아 행만 쌓인다.
 *
 * NOT NULL + RESTRICT 로 두는 길도 있지만, 그러면 접수 건 영구 삭제가 DB
 * 레벨에서 막힌다 — 지난주에 적어 둔 한 줄 때문에 건을 못 지우게 되는 것은
 * 이 표가 할 일이 아니다.
 *
 * ── 주는 월요일에 시작한다 ──────────────────────────────────────────────
 * week_start_date 에는 언제나 **그 주 월요일(한국 기준)** 이 들어간다. 원본
 * 상자의 머리말이 `08월24일 주간 목표` 이고 08월24일이 월요일이다. 아무 날짜나
 * 받아 두면 같은 주가 여러 값으로 갈려 "지난주 목록"이 두 벌이 되므로,
 * 월요일로 접는 일은 저장 전에 끝난다(domain 의 mondayOfDateOnly, 그리고
 * validation/weekly-report-goal-input.ts).
 *
 * `date` 컬럼이라 시각도 시간대도 담기지 않는다. 이 값을 다시 `new Date()` 로
 * 파싱하면 UTC 자정이 되어 한국에서 하루 밀린다는 것이 이 저장소가 실제로 겪은
 * 함정이고(domain/date-only.ts 헤더), 그래서 이 칸의 값은 끝까지 문자열로
 * 다닌다.
 *
 * ── 휴지통은 두지 않는다 ────────────────────────────────────────────────
 * 줄 삭제는 **바로 지운다**(승인된 결정). 소프트 삭제 4칼럼(DATABASE_DESIGN.md
 * #8)이 없는 이유가 그것이다. 이 표의 한 줄은 사람이 한 문장 적은 메모이지
 * 되돌릴 수 없으면 곤란한 기록이 아니고, 되살릴 길이 필요하면 그 주에 한 줄을
 * 다시 적으면 된다.
 *
 * version 은 반대로 **처음부터 둔다.** 같은 주의 같은 줄을 두 사람이 동시에
 * 고치는 일이 실제로 일어날 수 있고(주간보고는 여럿이 함께 보는 화면이다),
 * 그때 뒤에 저장한 쪽이 앞사람의 문장을 조용히 덮으면 안 된다.
 *
 * ── display_order 는 사람이 정한 차례다 ─────────────────────────────────
 * 상자 안에서 어느 줄이 위에 오는지는 사람이 정한다. 인수번호순으로 다시
 * 세우지 않는다 — 급한 것을 위에 올려 두는 것이 이 상자의 쓰임이다.
 * domestic_orders.display_order 와 같은 이유로 NULL 을 허용하고, 조회는
 * `display_order asc, created_at asc` 로 읽는다(NULL 은 뒤로 간다).
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * goal_text 는 사람이 자유롭게 적는 칸이라("교산의 부품견적 대기 중",
 * "김유진 과장 확인 후 발행") 담당자 이름이나 고객사 사정이 섞일 수 있다.
 * 다른 표의 메모 칸들과 같은 규칙이다 — 로그나 오류 보고로 그대로 내보내지
 * 않는다.
 * ============================================================================
 */
export const weeklyReportGoals = pgTable(
  "weekly_report_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 그 주 **월요일**(한국 기준). 파일 헤더의 '주는 월요일에 시작한다' 참조. */
    weekStartDate: date("week_start_date").notNull(),
    /**
     * 어느 수리 건의 목표인가. 앞부분(고객사·인수번호·형식·L/N·S/N)과 RFG/MB
     * 구분이 전부 이 연결에서 나오므로 **NOT NULL** 이다 — 연결 없는 목표 줄은
     * 화면에 그릴 수 없는 줄이다.
     *
     * 딸린 값이라 CASCADE 다(파일 헤더의 'ON DELETE CASCADE 인 이유').
     */
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "cascade" }),
    /**
     * 사람이 치는 유일한 값. `견적서 발행`, `수리 완료`,
     * `견적서 발행 (교산의 부품견적 대기 중)` 처럼 짧은 한 줄이다.
     *
     * 정해진 목록으로 만들지 않는다 — 내자 정리의 `현황`과 같은 판단이다
     * (schema/domestic-orders.ts 의 progress_note). 실제로 적히는 말이 매번
     * 다르고, 목록으로 가두면 적을 수 없는 상황이 생겨 사람이 다른 칸에
     * 우회해서 적게 된다.
     */
    goalText: text("goal_text").notNull(),
    /** 상자 안에서의 차례. 파일 헤더의 'display_order 는 사람이 정한 차례다'. */
    displayOrder: integer("display_order"),
    /** 낙관적 잠금 토큰. 파일 헤더의 '휴지통은 두지 않는다' 참조. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // 지운 계정이 사라지지 않도록 RESTRICT — 이 저장소의 다른 표들이 users 를
    // 가리키는 방식과 같다.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    // 화면은 언제나 "이 주의 목표 전부"를 묻는다. 주 고르기 목록도 이 칼럼을
    // 훑으므로, 이 표에서 가장 많이 타는 길이다.
    index("weekly_report_goals_week_start_date_idx").on(table.weekStartDate),
    // 복사가 "대상 주에 이미 같은 수리 건이 있는가"를 묻고, 조회가 목표 줄에
    // 붙은 수리 건 정보를 한 번에 걷어 온다(N+1 을 만들지 않으려고
    // repair_case_id IN (...) 로 읽는다).
    index("weekly_report_goals_repair_case_id_idx").on(table.repairCaseId),
  ]
);
