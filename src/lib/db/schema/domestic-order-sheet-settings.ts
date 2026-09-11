import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 내자 정리 머리말 설정 — 인사문과 내부 메모 (2026-09-11)
 * ============================================================================
 * [PO/내자] > 내자 정리 화면 맨 위 머리말의 **인사문 · 내부 메모**를 화면에서
 * 고칠 수 있게 담아 두는 표다. 전에는 DomesticOrderListScreen 의 SheetHeading 에
 * 글자로 박혀 있었다. 무엇이 기본 문구이고, 줄·들여쓰기를 어떻게 읽고, 값이 유효한지는
 * 전부 src/lib/domain/domestic-order-sheet-heading.ts 에 있다 — 여기는 그릇이다.
 *
 * ── 행이 딱 하나뿐인 설정 ────────────────────────────────────────────────
 * 본보기는 intake_mail_settings 다. `singleton` 은 언제나 true 이고 유니크 인덱스와
 * 짝지어 **두 줄이 되는 것을 DB 가 막는다** — 머리말이 두 벌이면 화면이 어느
 * 것을 그렸는지 아무도 답할 수 없다.
 *
 * 🔴 그 본보기보다 하나 더 막았다: `singleton` 이 false 인 줄도 CHECK 로 막는다.
 * 불리언 칸의 유니크 인덱스는 true 한 줄과 false 한 줄을 **함께 허락한다** —
 * 유니크만으로는 "두 줄이 안 된다"가 절반만 지켜진다.
 *
 * ── 🔴 설치 시점에 한 줄 넣어 두지 않는다 — 행이 없으면 코드 기본값 ──────
 * **빈 표가 정상 초기 상태**이고, 그때 화면은 이 표를 만들기 전과 한 글자도
 * 다르지 않다(도메인의 DEFAULT_DOMESTIC_ORDER_SHEET_GREETING · _MEMO). 미리 심어
 * 두면 나중에 코드의 기본 문구를 손볼 때 아무도 만진 적 없는 옛 문구가 그것을
 * 덮어써 화면이 따라 바뀌지 않는다 — intake_mail_settings · ui_text_overrides 와
 * 같은 판단이다. 같은 이유로 **기본 문구로 되돌리면 이 행을 지운다**
 * (mutations/domestic-order-sheet-settings.ts).
 *
 * 마이그레이션을 적용하기 **전에도** 화면은 죽지 않는다 — 조회가 42P01(표 없음)을
 * 삼키고 기본 문구로 답한다(queries/domestic-order-sheet-settings.ts).
 *
 * ── 길이 CHECK 는 검증과 같은 값이다 ────────────────────────────────────
 * 인사문 2000자 · 메모 500자. 도메인의 DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS ·
 * _MEMO_MAX_CHARS 와 **같은 수**이고, 둘 다 char_length(코드 포인트 수)로 센다 —
 * 검증도 같은 방식으로 센다. 숫자가 어긋나지 않는지는 도메인 시험이 이 파일의
 * 글자를 읽어 대조한다. 여기서 숫자를 바꾸면 그쪽도 함께 바꿀 것.
 * (스키마 파일은 drizzle-kit 이 따로 읽으므로 `@/` 경로를 import 하지 않는다 —
 * 이 폴더의 다른 파일도 모두 그렇다.)
 *
 * ── 🟡 인사문에는 사람 이름이 들어 있다 ──────────────────────────────────
 * 기본 문구부터 담당자 이름(연락 안내)이 들어 있다. 고객사에 보내는 문서에 사람이
 * 직접 적어 넣는 공지 문구라 가리지 않고 그대로 담고, 바뀔 때마다 감사 로그에 전후
 * 문구가 남는다. 다만 서버 로그(console)에는 값을 싣지 않는다.
 * ============================================================================
 */
export const domesticOrderSheetSettings = pgTable(
  "domestic_order_sheet_settings",
  {
    /**
     * 대리 키. 행이 하나뿐이어도 두는 이유는 ui_text_overrides 와 같다 —
     * audit_logs.target_record_id 가 NOT NULL uuid 라 기록이 가리킬 id 가 있어야 한다.
     */
    id: uuid("id").primaryKey().defaultRandom(),

    /** 언제나 true. 아래 유니크 인덱스 + CHECK 와 짝지어 행을 하나로 묶는다. */
    singleton: boolean("singleton").notNull().default(true),

    /**
     * 인사문. **한 줄 = 문서 한 줄**이고, 줄 앞 공백이 들여쓰기가 된다(두 칸마다
     * 한 단). `{기준일}` 은 그릴 때 서버가 정한 날짜로 바뀐다. 줄 번호("1." "2)")는
     * 사람이 글자 그대로 적는다. 저장되는 값은 도메인의 정규화(줄바꿈 통일 · 줄 끝
     * 공백 · 앞뒤 빈 줄 걷기)를 지난 것이다.
     */
    greetingText: text("greeting_text").notNull(),

    /**
     * 내부 메모. **빈 문자열이면 메모 상자가 아예 보이지 않는다.** 앞의 "내부 메모 —"
     * 이름표는 화면이 붙인다(여기 담기지 않는다).
     */
    internalMemo: text("internal_memo").notNull(),

    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 본다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("domestic_order_sheet_settings_singleton_unique").on(table.singleton),
    check("domestic_order_sheet_settings_singleton_true", sql`${table.singleton}`),
    check(
      "domestic_order_sheet_settings_greeting_text_length",
      sql`char_length(${table.greetingText}) <= 2000`
    ),
    check(
      "domestic_order_sheet_settings_internal_memo_length",
      sql`char_length(${table.internalMemo}) <= 500`
    ),
  ]
);
