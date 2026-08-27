import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { roleEnum, users } from "./users";

/**
 * ============================================================================
 * 알림 설정 — 종류를 켜고 끄기 + 어느 역할이 받는가
 * ============================================================================
 * 종 알림에는 저장된 알림 행이 없다(db/queries/notifications.ts). 여기 저장하는
 * 것은 알림 자체가 아니라 **알림을 누구에게 보일지 정하는 규칙**이다.
 *
 * ── 왜 표가 둘인가 — "껐다"와 "모든 역할이 안 받는다"는 다른 일이다 ────────
 * 한 표에 (종류, 역할) 행만 두고 "종류 끄기"를 '모든 역할을 끔'으로 대신할 수
 * 있을 것 같지만, 그러면 되돌릴 수 없다. 끌 때 다섯 역할의 값을 전부 false로
 * 덮어써 버리므로 **다시 켤 때 원래 누가 받았는지가 사라진다** — 부품 요청
 * 알림을 잠깐 껐다 켜면 엔지니어·영업까지 받게 되거나(전부 true로 복구),
 * 아무도 못 받게 된다(전부 false로 남음). 어느 쪽이든 관리자가 끄기 전에 보던
 * 화면과 다른 상태가 된다.
 *
 * 뜻도 다르다. 종류를 끄는 것은 "이 알림을 당분간 아무에게도 보내지 않는다"는
 * 한시적 조치이고, 역할을 빼는 것은 "이 역할은 원래 이 알림의 대상이 아니다"는
 * 항구적 규칙이다. 한 칸에 접으면 화면이 그 둘을 구별해 보여 줄 수 없다.
 *
 * 그래서 종류 스위치는 자기 표(notification_kind_settings)에 따로 둔다. 종류를
 * 껐다 켜도 아래 역할 표는 한 줄도 건드려지지 않는다.
 *
 * ── 왜 비어 있는 것이 정상 초기 상태인가 ────────────────────────────────
 * role_permissions와 같은 판단이다. 행이 없는 (종류) · (종류, 역할)은 코드가
 * 정한 기본값을 그대로 따른다(domain/notification-settings.ts). 설치 시점에
 * 2×5=10행을 미리 채워 넣지 않는 이유는, 그렇게 하면 나중에 코드의 기본값이
 * 바뀌었을 때 아무도 만진 적 없는 옛 값이 그것을 덮어써 버리기 때문이다.
 * 표를 만들었다는 이유만으로 알림이 하나도 안 가는 상태가 되어서도 안 된다.
 *
 * ── 왜 (종류) / (종류, 역할) 복합키가 아니라 대리 키인가 ─────────────────
 * role_permissions와 같은 이유다 — 감사 로그의 target_record_id가 NOT NULL
 * uuid라, 기록을 남기려면 행마다 uuid 하나가 있어야 한다. 알림 대상을 바꾸는
 * 것은 "누가 밀린 일을 보게 되는가"를 바꾸는 조작이라 추적할 수 있어야 한다.
 * 유일성은 아래 유니크 인덱스가 그대로 지킨다.
 *
 * ── kind_key에 왜 enum을 쓰지 않았나 ────────────────────────────────────
 * role_permissions.area_key가 text인 것과 같은 판단이다. 알림 종류는 앞으로
 * 는다(재고 부족, 가입 승인 대기 …). Postgres enum은 값을 지우기 어렵고
 * (ALTER TYPE ... ADD VALUE는 되돌릴 수 없다) 종류 하나 추가할 때마다
 * 마이그레이션이 필요해진다 — 그러면 "종류를 늘려도 화면을 안 고친다"는
 * 이 구조의 값이 반감된다. 종류를 코드 배열 하나(NOTIFICATION_KINDS)로 늘리는
 * 것과 DB 타입을 함께 고치는 것은 무게가 다르다. 유효성은 서버가
 * NOTIFICATION_KINDS로 검사하며, 목록에서 사라진 종류의 남은 행은 조회 시
 * 무시된다.
 * ============================================================================
 */

/**
 * 종류 자체의 켜기/끄기. 행이 없으면 켜진 것이다.
 *
 * 이 스위치는 최고관리자에게도 적용된다 — 역할 스위치와 달리 이것은 "이 알림을
 * 당분간 아무에게도 보내지 않는다"는 뜻이고, 누군가 예외로 남으면 그 뜻이
 * 성립하지 않는다. 한 번 누르면 되고 같은 자리에서 바로 되돌릴 수 있으며,
 * 아래 역할 표가 그대로 남아 있어 켜는 순간 원래 대상으로 돌아온다.
 */
export const notificationKindSettings = pgTable(
  "notification_kind_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kindKey: text("kind_key").notNull(),
    isEnabled: boolean("is_enabled").notNull(),
    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notification_kind_settings_kind_unique").on(table.kindKey)]
);

/**
 * 종류 × 역할. 행이 없으면 코드의 기본값이 답한다.
 *
 * ⚠️ 이 스위치는 **윗단 필터**다. 여기서 켜져 있다고 알림이 가는 것이 아니라,
 * 여기서 꺼져 있으면 가지 않는다. 각 종류의 원래 판정(결재 알림이라면 "그 사람이
 * 그 건의 결재자인가")은 종전대로 그 조회가 계속한다 — 둘 다 참이어야 알림이
 * 간다. 자세한 것은 domain/notification-settings.ts 머리말에 적어 두었다.
 */
export const notificationRoleSettings = pgTable(
  "notification_role_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kindKey: text("kind_key").notNull(),
    role: roleEnum("role").notNull(),
    /** 이 역할이 이 종류를 받는가. */
    receives: boolean("receives").notNull(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notification_role_settings_kind_role_unique").on(table.kindKey, table.role)]
);
