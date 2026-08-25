import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { domesticOrders } from "./domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 한 줄에 달리는 납기 요청일들
 * ============================================================================
 * 원래 납기요청일은 domestic_orders 의 칸 하나(requested_due_date)였다. 한 줄에
 * 날짜가 하나뿐이라는 뜻인데, 실제 발주는 그렇지 않다 — **분할 납품**이 있다.
 * 같은 발주 건을 나눠 납품하면 1차분·2차분에 각각 날짜가 붙고, 칸이 하나면
 * 사람은 그 둘을 "2026-01-20, 2026-02-15" 처럼 한 칸에 몰아 적거나(그러면
 * date 컬럼이 아니라 글자가 된다) 아예 못 적고 다시 Excel 로 돌아간다.
 * 그래서 날짜를 **딸린 표**로 뺀다.
 *
 * ── ON DELETE CASCADE 인 이유 ───────────────────────────────────────────
 * 이 날짜는 **그 발주 줄에 딸린 값**이다. 발주 줄이 없으면 "무엇의 납기인가"를
 * 말할 수 없어서, 부모 없이 남은 날짜는 그 자체로 뜻이 없다.
 *
 * 이 저장소가 다른 곳에서 SET NULL / RESTRICT 를 쓰는 것은 그 기록들이
 * **부모보다 오래 살아야 하기 때문**이다 — attachments 의 증빙 사진과
 * domestic_orders 의 세금계산서·입금 사실이 그렇다(각 파일의 '영구 삭제돼도'
 * 항목). 회계 기록은 그 거래의 원인이 지워진 뒤에도 남아야 한다. 납기
 * 요청일에는 그런 성질이 없다: 발주 줄이 사라지면 함께 사라지는 것이 맞고,
 * 남겨 두면 어느 발주의 날짜인지 영영 알 수 없는 고아 행만 쌓인다.
 *
 * 참고로 domestic_orders 의 삭제는 소프트 삭제(is_deleted)라서 화면에서 지운
 * 줄은 이 표를 건드리지 않는다. CASCADE 가 실제로 도는 것은 그 행을 정말로
 * 지울 때뿐이다.
 *
 * ── 소프트 삭제 4칼럼도 version 도 두지 않는다 ─────────────────────────────
 * 이 표에는 **직접 고치는 경로가 없다.** 저장은 언제나 부모 줄을 통째로
 * 저장하는 한 번의 트랜잭션이고, 그 안에서 이 줄들은 통째로 지워지고 다시
 * 들어간다(mutations/domestic-orders.ts). 동시 수정을 막는 일은 부모의
 * version 이 이미 하고 있으므로 여기에 또 두면 두 벌이 어긋난다.
 *
 * ── display_order 는 사람이 정한 차례다 ────────────────────────────────
 * 1차분·2차분처럼 순서가 곧 뜻인 값이라, 날짜순으로 다시 정렬하지 않는다 —
 * 폼에 늘어놓은 차례가 그대로 번호가 되고(저장할 때 1부터 매긴다), 화면은 그
 * 차례대로 읽는다. domestic_orders.display_order 와 같은 이유로 NULL 을
 * 허용한다(옮겨 온 값에 차례가 없을 수 있다).
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * note 는 사람이 자유롭게 적는 칸이라("1차분", "김유진 과장 확인분") 담당자
 * 이름이 섞일 수 있다. 부모 표의 메모 칸들과 같은 규칙이다 — 로그나 오류
 * 보고로 그대로 내보내지 않는다.
 * ============================================================================
 */
export const domesticOrderDueDates = pgTable(
  "domestic_order_due_dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 딸린 값이라 CASCADE 다 — 파일 헤더의 'ON DELETE CASCADE 인 이유' 참조.
    domesticOrderId: uuid("domestic_order_id")
      .notNull()
      .references(() => domesticOrders.id, { onDelete: "cascade" }),
    // 발주서에 적힌 납기 요청일. 날짜 없는 줄은 이 표에 아예 들어오지 않으므로
    // NOT NULL 이다 — "날짜 없는 납기일"은 빈 줄이지 자료가 아니다.
    dueDate: date("due_date").notNull(),
    /** "1차분" 같은 짧은 메모. 여러 날짜를 구분하는 유일한 단서다. */
    note: text("note"),
    /** 사람이 정한 차례. 파일 헤더의 'display_order 는 사람이 정한 차례다'. */
    displayOrder: integer("display_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 목록 조회가 보이는 줄들의 날짜를 한 번에 걷어 오는 길이다(N+1 을 만들지
    // 않으려고 domestic_order_id IN (...) 로 한 번에 읽는다). 부분 인덱스가
    // 아닌 것은 이 표에 is_deleted 가 없기 때문이다.
    index("domestic_order_due_dates_order_id_idx").on(table.domesticOrderId),
  ]
);
