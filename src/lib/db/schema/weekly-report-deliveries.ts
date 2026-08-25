import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 — 사람이 고르는 것은 '어느 건인가'와 '비고' 둘뿐이다
 * ============================================================================
 * 원본 엑셀 현황판에는 `RFG 납입 예정 건` · `MB 납입 예정 건` 두 표가 좌우로
 * 있고, 칸은 여덟이다:
 *
 *     인수 번호 | 형식 | S/N | L/N | 고객사 | 납입 예정 | 입고 요청일 | 비고
 *     D251107   | CFK300FH-IC2 | 2204129 | WT8799 | ICD | (빈칸) | (빈칸) | (빈칸)
 *
 * 이 표가 담는 것은 **그 여덟 중 둘**뿐이다 — 어느 수리 건인가(repair_case_id)와
 * 비고(note). 나머지 여섯은 전부 따라오는 값이라 저장하지 않는다:
 *
 *   인수번호·형식·S/N·L/N·고객사  ← 연결된 수리 건(repair_cases → products·customers)
 *   RFG / MB (어느 표로 갈지)       ← 수리 건의 워크플로 종류(foldWeeklyReportKind)
 *   납입 예정                       ← repair_cases.internal_target_shipment_date
 *   입고 요청일                     ← 내자 정리의 납기요청일 중 **가장 이른 것**
 *
 * ── 따라오는 값을 베껴 두지 않는 이유 ───────────────────────────────────
 * 바로 옆 weekly_report_goals 가 정확히 같은 판단을 했고(그 파일 헤더의 '앞부분을
 * 저장하지 않는 이유'), 근거도 같다: 여기 베껴 두면 나중에 수리 건의 형식이나
 * 사내 목표 출하일이 고쳐졌을 때 **이 표만 옛 값으로 남는다.** 그러면 같은
 * 장비가 화면 두 곳에서 서로 다른 이름·다른 날짜로 불리고, 어느 쪽이 맞는지
 * 아무도 답할 수 없다.
 *
 * 내자 정리(schema/domestic-orders.ts 의 '여기에도 있다')는 같은 값을 자기 칸에
 * 두기로 반대 판단을 했는데, 그 표에는 **수리 건 연결이 없는 줄**이 실제로 있어
 * 조인해 올 곳 자체가 없기 때문이다. 여기는 repair_case_id 가 NOT NULL 이라
 * 재료가 언제나 있다.
 *
 * `입고 요청일`을 이 표의 칸으로 두지 않는 것도 같은 이유다. 그 값은
 * domestic_order_due_dates 의 min 이고, 발주 줄에 날짜가 하나 더 붙거나 지워지면
 * 곧바로 달라져야 하는 값이다 — 여기 베껴 두면 내자 정리에서 날짜를 고친 사람과
 * 주간보고를 보는 사람이 서로 다른 날짜를 보게 된다.
 *
 * ── ON DELETE CASCADE 인 이유 ───────────────────────────────────────────
 * 납입 예정 줄은 **그 수리 건에 딸린 값**이다. 건이 사라지면 "무엇을 납입한다는
 * 말인가"를 답할 수 없어서, 부모 없이 남은 줄은 그 자체로 뜻이 없다 —
 * weekly_report_goals 와 domestic_order_due_dates 가 같은 이유로 같은 방식을
 * 쓴다(각 파일 헤더).
 *
 * 내자 정리(domestic_orders.repair_case_id)가 SET NULL 인 것과 갈리는 지점이
 * 여기다. 그쪽이 남는 이유는 세금계산서와 입금 사실이 **접수 건보다 오래 살아야
 * 하는 회계 기록**이기 때문인데, 이 표에는 그런 성질이 없다: "이번 주에 이 건을
 * 납입할 예정"은 그 건이 없어지면 함께 없어지는 말이고, 남겨 두면 어느 건의
 * 예정인지 영영 알 수 없는 고아 행만 쌓인다.
 *
 * NOT NULL + RESTRICT 로 두는 길도 있지만, 그러면 지난주에 적어 둔 한 줄 때문에
 * 접수 건 영구 삭제가 DB 레벨에서 막힌다 — 이 표가 할 일이 아니다.
 *
 * ── note 만 NULL 을 허용한다 ────────────────────────────────────────────
 * 옆 표의 goal_text 는 NOT NULL 이다. 금주 목표 줄은 **그 문장이 곧 줄의
 * 내용**이라 비면 `[INVENIA] D260706_...:` 로 끝나는, 아무 말도 하지 않는 줄이
 * 되기 때문이다.
 *
 * 납입 예정 건은 반대다. 이 줄의 내용은 **"이 건이 이번 주 납입 예정 목록에 있다"**
 * 는 사실 자체이고, 그것은 repair_case_id 하나로 이미 다 적힌다. 실제 원본
 * 엑셀에서도 비고 칸은 대부분 비어 있다(예시 줄이 그렇다) — 적을 말이 있을 때만
 * 적는 칸이다. 그래서 여기서 NOT NULL 로 두면 사람이 적을 말이 없는데도 무언가를
 * 채워 넣게 되고, 그 자리에 `-` 나 공백 한 칸 같은 뜻 없는 값이 쌓인다.
 *
 * 비어 있음의 표준형은 **NULL 하나**다. 빈 문자열과 공백만 적힌 값은 저장 전에
 * NULL 로 접힌다(validation/weekly-report-delivery-input.ts) — 두 가지 '없음'이
 * 섞이면 화면과 조회가 서로 다른 방식으로 빈칸을 판정하게 된다.
 *
 * ── 주는 월요일에 시작한다 ──────────────────────────────────────────────
 * week_start_date 에는 언제나 **그 주 월요일(한국 기준)** 이 들어간다. 금주 목표와
 * **같은 주 고르개를 쓰므로**(승인된 결정) 두 표의 week_start_date 는 같은 규칙으로
 * 접혀야 하고, 그래서 접는 함수도 하나를 함께 쓴다(domain/weekly-report-goal.ts 의
 * mondayOfDateOnly). 아무 날짜나 받아 두면 같은 주가 여러 값으로 갈려 한 주가
 * 두 벌이 된다.
 *
 * `date` 컬럼이라 시각도 시간대도 담기지 않는다. 이 값을 다시 `new Date()` 로
 * 파싱하면 UTC 자정이 되어 한국에서 하루 밀린다는 것이 이 저장소가 실제로 겪은
 * 함정이고(domain/date-only.ts 헤더), 그래서 이 칸의 값은 끝까지 문자열로 다닌다.
 *
 * ── 휴지통은 두지 않는다 ────────────────────────────────────────────────
 * 줄 삭제는 **바로 지운다**(옆 표와 같은 결정). 소프트 삭제 4칼럼
 * (DATABASE_DESIGN.md #8)이 없는 이유가 그것이다. 이 표의 한 줄은 "이번 주 목록에
 * 이 건을 올려 둔다"는 표시이지 되돌릴 수 없으면 곤란한 기록이 아니고, 잘못
 * 지웠으면 그 건을 다시 고르면 된다.
 *
 * version 은 반대로 **처음부터 둔다.** 주간보고는 여럿이 함께 보는 화면이라 같은
 * 줄의 비고를 두 사람이 동시에 고치는 일이 실제로 일어나고, 그때 뒤에 저장한
 * 쪽이 앞사람의 문장을 조용히 덮으면 안 된다. **삭제도 이 값을 대조한다** —
 * 되돌릴 수 없는 조작이라, 낡은 화면에서 누른 삭제가 그 사이 남이 적어 둔 비고를
 * 함께 지우면 안 된다(mutations/weekly-report-deliveries.ts).
 *
 * ── display_order 는 사람이 정한 차례다 ─────────────────────────────────
 * 표 안에서 어느 줄이 위에 오는지는 사람이 정한다. 인수번호순으로 다시 세우지
 * 않는다 — 먼저 나갈 것을 위에 올려 두는 것이 이 표의 쓰임이다.
 * weekly_report_goals.display_order 와 같은 이유로 NULL 을 허용하고, 조회는
 * `display_order asc, created_at asc` 로 읽는다(NULL 은 뒤로 간다).
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * note 는 사람이 자유롭게 적는 칸이라("김유진 과장 확인 후 출고", "고객사 요청으로
 * 연기") 담당자 이름이나 고객사 사정이 섞일 수 있다. 다른 표의 메모 칸들과 같은
 * 규칙이다 — 로그나 오류 보고로 그대로 내보내지 않는다.
 * ============================================================================
 */
export const weeklyReportDeliveries = pgTable(
  "weekly_report_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 그 주 **월요일**(한국 기준). 파일 헤더의 '주는 월요일에 시작한다' 참조. */
    weekStartDate: date("week_start_date").notNull(),
    /**
     * 어느 수리 건인가. 여덟 칸 중 여섯이 이 연결에서 나오므로 **NOT NULL** 이다 —
     * 연결 없는 납입 예정 줄은 화면에 그릴 수 없는 줄이다.
     *
     * 딸린 값이라 CASCADE 다(파일 헤더의 'ON DELETE CASCADE 인 이유').
     */
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "cascade" }),
    /**
     * 비고. 여덟 칸 중 **사람이 치는 유일한 값**이고, 이 표에서 유일하게 NULL 을
     * 허용하는 칸이다(파일 헤더의 'note 만 NULL 을 허용한다').
     *
     * 정해진 목록으로 만들지 않는다 — 내자 정리의 `현황`, 금주 목표의 goal_text 와
     * 같은 판단이다. 실제로 적히는 말이 매번 다르고, 목록으로 가두면 적을 수 없는
     * 상황이 생겨 사람이 다른 칸에 우회해서 적게 된다.
     */
    note: text("note"),
    /** 표 안에서의 차례. 파일 헤더의 'display_order 는 사람이 정한 차례다'. */
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
    // 화면은 언제나 "이 주의 납입 예정 줄 전부"를 묻는다. 이 표에서 가장 많이
    // 타는 길이다.
    index("weekly_report_deliveries_week_start_date_idx").on(table.weekStartDate),
    // 조회가 줄에 붙은 수리 건 정보와 내자 날짜를 한 번에 걷어 온다 — N+1 을
    // 만들지 않으려고 repair_case_id IN (...) 로 읽는다.
    index("weekly_report_deliveries_repair_case_id_idx").on(table.repairCaseId),
  ]
);
