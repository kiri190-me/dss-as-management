import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 알림 확인 기록 — 「누가 · 어느 알림을 · 언제 확인했나」
 * ============================================================================
 * 종 알림은 저장하지 않고 매 요청마다 업무 자료에서 파생한다
 * (domain/notifications.ts · db/queries/notifications.ts 머리말). 지금까지의 알림은
 * 전부 「처리하면 저절로 사라지는 할 일」이라 읽음 상태를 적어 둘 곳이 필요 없었다.
 *
 * 이 표는 그 반대편 — **「무슨 일이 있었다」는 정보성 알림**을 위한 것이다. 결재
 * 요청자에게 가는 「승인 완료」·「반려됨」처럼, 알림 자체는 업무 자료에서 여전히
 * 파생되지만 **처리해서 사라지게 할 방법이 없는** 종류는 사람이 눌러 확인한 사실을
 * 어딘가 적어 둬야 한다. 적어 두는 자리가 여기다. 알림을 저장하는 표가 아니다 —
 * 파생된 알림 중 **이미 확인한 것을 걸러 내는** 표다.
 *
 * 확인 기록이 브라우저가 아니라 DB 에 있으므로, 한 기기에서 누르면 다른 기기의
 * 종에서도 함께 사라진다(사용자 결정 2026-09-11).
 *
 * ── notification_key 는 NotificationItem.id 그대로다 ─────────────────────
 * 예: `APPROVAL_GRANTED:…`(다음 조각에서 생길 종류의 모양). 파생된 알림과 이 표의
 * 행을 잇는 것은 이 문자열 하나뿐이라, 같은 일에 대해 매번 **같은 id 가 나오는
 * 것**이 파생 쪽의 약속이다.
 * 형식은 domain/notification-acknowledgement.ts 가 저장 전에 보고, 아래 CHECK 는
 * 길이만 지키는 최종 방어선이다. 어느 종류가 확인 대상인지(종류 목록)는 DB 가
 * 알지 못한다 — 종류가 늘 때마다 마이그레이션이 필요해지지 않도록 enum 을 쓰지
 * 않았다(ui_text_overrides.group_key 등과 같은 판단).
 *
 * ── 🔴 user_id 만 ON DELETE CASCADE 인 이유 ───────────────────────────────
 * 이 저장소의 표들은 사람 참조에 거의 전부 RESTRICT 를 건다 — 감사 흔적(누가
 * 결재했나·누가 바꿨나)이 사람보다 먼저 사라지면 안 되기 때문이다. **이 표에는 그
 * 이유가 없다.** 확인 기록은 업무 기록이 아니라 한 사람의 화면 상태(종에서 무엇을
 * 이미 봤나)이고, 그 사람이 없어지면 가리킬 화면도 없다. 여기서 RESTRICT 를 걸면
 * 사람 행을 지우려는 작업이 「알림을 눌러 본 적이 있다」는 이유만으로 막힌다.
 * 그래서 사람과 함께 사라지게 둔다. (사용자는 평소 소프트삭제만 하므로 실제로
 * CASCADE 가 도는 것은 하드 삭제 때뿐이다.)
 *
 * 같은 이유로 감사 로그(audit_logs)도 남기지 않는다 — 알림을 눌러 본 일은 업무
 * 자료를 한 칸도 움직이지 않는다(mutations/notification-acknowledgements.ts).
 *
 * ── 지우지 않는다(지금은) ───────────────────────────────────────────────
 * 쌓이는 양은 사람당 하루 몇 줄이다. 정보성 알림은 최근 7일 안의 것만 띄우므로 창
 * 밖으로 밀려난 확인 기록은 더는 쓸모가 없지만, **이 조각에서는 삭제 규칙을
 * 만들지 않는다** — 보관 정책(SECURITY_POLICY.md)과 함께 나중에 정한다. 남아 있는
 * 행이 해를 끼치지는 않는다: 조회가 언제나 「지금 띄우려는 알림의 키」로 좁혀
 * 묻기 때문에, 창 밖의 행은 읽히지도 않는다.
 *
 * updated_at 도 소프트삭제 칸도 없다 — 한 번 확인한 것은 고칠 것이 없고, 되돌리는
 * 길(「다시 안 읽음으로」)도 두지 않는다.
 * ============================================================================
 */
export const notificationAcknowledgements = pgTable(
  "notification_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 확인한 사람. 🔴 CASCADE 인 이유는 머리말. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 확인한 알림의 NotificationItem.id. 1~200자(CHECK). */
    notificationKey: text("notification_key").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 같은 알림을 두 번 눌러도 한 줄이다 — mutation 이 ON CONFLICT DO NOTHING 으로
    // 이 유니크에 기댄다. 조회(listAcknowledgedNotificationKeys)가 언제나 user_id 로
    // 먼저 좁히므로 이 인덱스의 앞 칸이 그 조회를 그대로 받는다(따로 인덱스를 두지
    // 않는다). CASCADE 삭제가 user_id 로 행을 찾을 때도 같다.
    uniqueIndex("notification_acknowledgements_user_key_unique").on(
      table.userId,
      table.notificationKey
    ),
    check(
      "notification_acknowledgements_key_length",
      sql`char_length(notification_key) BETWEEN 1 AND 200`
    ),
  ]
);
