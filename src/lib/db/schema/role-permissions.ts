import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { roleEnum, users } from "./users";

/**
 * ============================================================================
 * 역할별 접근 권한 설정 (2026-08-19 승인)
 * ============================================================================
 * 관리자가 화면에서 정한 "역할 × 영역 → 수준". 자세한 규칙과 이 설정이 기존
 * 정책과 어떤 관계인지는 src/lib/auth/permission-areas.ts에 적어 두었다.
 *
 * ── 왜 "없으면 상한"인가 ────────────────────────────────────────────────
 * 이 표는 **비어 있는 것이 정상 초기 상태**다. 행이 없는 (역할, 영역)은
 * 지금까지의 정책(permission-baseline.ts)을 그대로 따른다. 설치 시점에 14×5=70행을
 * 미리 채워 넣지 않는 이유는, 그렇게 하면 나중에 코드의 정책이 바뀌었을 때
 * 옛 값이 그것을 덮어써 버리기 때문이다 — 아무도 만진 적 없는 설정이 조용히
 * 정책을 고정시키는 상황을 만들지 않는다.
 *
 * ── 왜 (역할, 영역) 복합키가 아니라 대리 키인가 ─────────────────────────
 * 감사 로그의 target_record_id가 NOT NULL uuid라, 기록을 남기려면 행마다
 * uuid 하나가 있어야 한다. 권한 변경은 반드시 추적할 수 있어야 하는 조작이라
 * 그쪽에 맞췄다. (역할, 영역)의 유일성은 아래 유니크 인덱스가 그대로 지킨다.
 *
 * ── area_key에 왜 enum을 쓰지 않았나 ────────────────────────────────────
 * 영역 목록은 메뉴가 늘면 같이 는다. Postgres enum은 값을 지우기 어렵고
 * (ALTER TYPE ... ADD VALUE는 되돌릴 수 없다) 메뉴 하나 추가할 때마다
 * 마이그레이션이 필요해진다. 유효성은 서버가 PERMISSION_AREAS로 검사하며,
 * 목록에서 사라진 영역의 남은 행은 조회 시 무시된다.
 * ============================================================================
 */
export const permissionLevelEnum = pgEnum("permission_level", ["NONE", "READ", "WRITE", "MANAGE"]);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: roleEnum("role").notNull(),
    areaKey: text("area_key").notNull(),
    level: permissionLevelEnum("level").notNull(),
    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("role_permissions_role_area_unique").on(table.role, table.areaKey)]
);
