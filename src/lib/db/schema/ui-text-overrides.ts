import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 화면 문구 오버라이드 — 관리자가 바꾼 고정 문구만 담는 표
 * ============================================================================
 * 코드를 고치지 않고 화면의 고정 문구(역할 이름·상태 배지·유무상 구분 …)를 바꾸는
 * 축의 저장 자리다. 무엇을 바꿀 수 있는지(등록부)·값이 유효한지(검증기)·기본값과
 * 어떻게 합쳐지는지(병합)는 전부 src/lib/domain/ui-text-overrides.ts 에 있다.
 * 여기 있는 것은 **기본 문구와 다른 것만** 담아 두는 그릇 하나다.
 *
 * 칸 구성은 이 저장소의 「설정 표」 표준을 그대로 따른다 — ui_theme_tokens ·
 * role_permissions · notification_kind_settings · notification_role_settings ·
 * intake_mail_settings 와 같이 `id / 키 / 값 / updated_by / updated_at` 다섯
 * 칸뿐이다. created_at 도, 소프트삭제 칸(is_deleted·deleted_at·deleted_by)도 두지
 * 않는다. 설정은 "언제 처음 생겼는가"가 의미를 갖지 않고(기본값으로 되돌리는 것이
 * 곧 행 삭제다), 지운 설정을 휴지통에서 되살릴 일도 없다 — 되돌리는 방법은 다시
 * 저장하는 것이다.
 *
 * ── 🔴 왜 scope 같은 칸이 없는가 ────────────────────────────────────────
 * ui_theme_tokens 에는 (token_key, scope) 두 칸이 키를 이룬다. 색은 라이트와
 * 다크에서 서로 다른 값을 가질 수 있기 때문이다. **문구에는 그런 축이 없다** —
 * 라이트 화면의 "최고관리자"와 다크 화면의 "최고관리자"가 다를 이유가 없고,
 * 인쇄용이라고 역할 이름이 바뀌지도 않는다. 쓰지도 않을 칸을 미리 만들어 두면
 * "그럼 무엇을 넣어야 하나"라는 질문이 저장·조회·편집 화면 세 곳에 생기고,
 * 아무도 답을 모르는 채 "both" 같은 값이 관례로 굳는다. 키는 (묶음, 항목)
 * 둘이면 충분하다.
 *
 * ── group_key·item_key 는 등록부의 논리 키다 ────────────────────────────
 * group_key 는 types.ts 의 표 이름에서 Labels 를 뗀 것("role" · "repairStatus"),
 * item_key 는 그 표의 코드("SUPER_ADMIN" · "IN_REPAIR")다. 여기 든 문자열이 화면
 * 어딘가로 그대로 흘러 나가는 길은 없다 — 등록부에서 찾지 못한 (묶음, 항목)은
 * 병합(resolveUiText)이 조용히 버리므로, 화면에 나타날 방법 자체가 없다.
 *
 * ── group_key·item_key 에 왜 enum 을 쓰지 않았나 ────────────────────────
 * ui_theme_tokens.token_key · role_permissions.area_key ·
 * notification_*_settings.kind_key 와 같은 판단이다. Postgres enum 은 값을
 * 지우기 어렵고(ALTER TYPE ... ADD VALUE 는 되돌릴 수 없다) **문구가 하나 늘 때마다
 * 마이그레이션이 필요해진다** — 그러면 "코드 배열 한 줄로 문구를 늘린다"는 이
 * 구조의 값이 반감된다. 유효성은 서버가 등록부로 본다.
 *
 * ── 행을 미리 심지 않는다 ───────────────────────────────────────────────
 * **빈 표가 정상 초기 상태**이고, 행이 없는 (묶음, 항목)은 코드의 기본 문구를
 * 그대로 따른다. 설치 시점에 46개 문구를 미리 채워 넣으면, 나중에 types.ts 의
 * 기본 문구를 손볼 때 아무도 만진 적 없는 옛 문구가 그것을 덮어써 아무 화면도
 * 따라 바뀌지 않는다. 등록부에서 사라진 키의 남은 행도 병합이 무시한다.
 *
 * ── 🔴 이 표가 비어 있으면 앱은 이 기능이 없던 때와 완전히 같이 동작한다 ──
 * 마이그레이션을 적용하기 **전에도** 마찬가지다 — 조회가 42P01(표 없음)을 삼키고
 * "오버라이드 없음"으로 답한다. 그래서 이 축은 어느 지점에서 멈춰도 화면이 지금과
 * 똑같고, 되돌릴 일이 없는 배포가 된다.
 * ============================================================================
 */
export const uiTextOverrides = pgTable(
  "ui_text_overrides",
  {
    /**
     * 대리 키. (group_key, item_key) 복합 기본키를 쓰지 않는 이유는
     * ui_theme_tokens · role_permissions 와 같다 — audit_logs.target_record_id 가
     * NOT NULL uuid 라, 기록을 남기려면 행마다 uuid 하나가 있어야 한다. 유일성은
     * 아래 유니크 인덱스가 그대로 지킨다.
     */
    id: uuid("id").primaryKey().defaultRandom(),
    /** 등록부의 묶음 키. 예: "role" · "repairStatus" · "billingType" */
    groupKey: text("group_key").notNull(),
    /** 그 묶음 안의 항목 키. 예: "SUPER_ADMIN" · "IN_REPAIR" · "PAID" */
    itemKey: text("item_key").notNull(),
    /** 정규화(앞뒤 다듬기 + 연속 공백 줄이기)를 지난 한 줄짜리 문구. */
    value: text("value").notNull(),
    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ui_text_overrides_group_item_unique").on(table.groupKey, table.itemKey)]
);
