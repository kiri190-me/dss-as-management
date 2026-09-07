import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 화면 토큰 오버라이드 — 관리자가 바꾼 색·모서리·글자 크기만 담는 표
 * ============================================================================
 * 코드를 고치지 않고 앱의 색·모서리·글자 크기를 바꾸는 축의 저장 자리다. 무엇을
 * 바꿀 수 있는지(등록부)·값이 유효한지(검증기)·어떤 CSS가 되는지(직렬화)는 전부
 * src/lib/domain/ui-theme-tokens.ts에 있다. 여기 있는 것은 **기본값과 다른 것만**
 * 담아 두는 그릇 하나다.
 *
 * 칸 구성은 이 저장소의 「설정 표」 표준을 그대로 따른다 — role_permissions ·
 * notification_kind_settings · notification_role_settings · intake_mail_settings와
 * 같이 `id / 키 / 값 / updated_by / updated_at` 다섯 칸뿐이다. created_at도,
 * 소프트삭제 칸(is_deleted·deleted_at·deleted_by)도 두지 않는다. 설정은 "언제
 * 처음 생겼는가"가 의미를 갖지 않고(기본값으로 되돌리는 것이 곧 행 삭제다),
 * 지운 설정을 휴지통에서 되살릴 일도 없다 — 되돌리는 방법은 다시 저장하는 것이다.
 *
 * ── 왜 열 둘(light_value·dark_value)이 아니라 행 둘 + scope인가 ──────────
 * 한 토큰을 한 행에 담고 라이트/다크를 열로 나누면, "라이트만 바꿨다"를
 * `dark_value = NULL`로 표현해야 한다. 그러면 **"행이 없다 = 기본값"이라는 이
 * 저장소의 규칙 위에 "칸이 NULL = 기본값"이 한 겹 더 얹힌다** — 같은 뜻을 두
 * 가지 방법으로 적게 되고, 둘이 어긋난 상태(행은 있는데 두 칸이 다 NULL)가
 * 만들어질 수 있다. 행 둘이면 라이트를 되돌릴 때 라이트 행만 지우면 되고, 두
 * 행이 다 지워지면 그 토큰은 완전히 기본값이다. 규칙이 하나뿐이고,
 * notification_role_settings가 (종류, 역할)로 하는 일과 똑같은 모양이 된다.
 *
 * 감사 로그 쪽에서도 이 모양이어야 한다. audit_logs.target_record_id는 행
 * 하나를 가리키므로, 행이 (토큰, 스코프) 하나면 로그가 "다크의 zinc-900을
 * 바꿨다"를 정확히 가리킨다. 열 둘이면 한 행의 previousValue/newValue에
 * 라이트·다크가 섞여 들어가, 로그만 읽어서는 어느 쪽을 바꾼 것인지 구별할 수
 * 없다.
 *
 * 스코프를 나중에 늘릴 수도 있다(인쇄용·고대비 등) — 열이 아니라 값이므로
 * 마이그레이션 없이 는다.
 *
 * ── token_key는 논리 키이지 CSS 변수 이름이 아니다 ──────────────────────
 * 여기 들어가는 것은 "zinc-900" · "background" · "radius-md" 같은 논리 키뿐이다.
 * 실제 변수 이름 "--color-zinc-900"은 **코드 등록부(UI_THEME_TOKENS)의 cssVar
 * 상수에만** 있다. DB에 든 문자열이 그대로 CSS로 나가는 길을 아예 만들지 않기
 * 위해서다 — 이름을 문자열 연결로 조립하면(`"--color-" + token_key`) DB에 들어간
 * 아무 문자열이나 선택자 안으로 흘러든다. 등록부에서 찾지 못한 키는 병합에서도
 * 직렬화에서도 조용히 버려지므로, 출력에 나타날 방법 자체가 없다. 덤으로
 * Tailwind가 변수 이름을 바꾸는 날이 와도 등록부 한 줄만 고치면 되고 DB는
 * 그대로다.
 *
 * ── token_key·scope에 왜 enum을 쓰지 않았나 ─────────────────────────────
 * role_permissions.area_key · notification_*_settings.kind_key와 같은 판단이다.
 * Postgres enum은 값을 지우기 어렵고(ALTER TYPE ... ADD VALUE는 되돌릴 수 없다)
 * 토큰이 하나 늘 때마다 마이그레이션이 필요해진다 — 그러면 "코드 배열 한 줄로
 * 토큰을 늘린다"는 이 구조의 값이 반감된다. **scope도 같은 이유로 text다**:
 * 인쇄용·고대비 스코프가 생기는 날 표 정의를 건드리지 않는다. 유효성은 서버가
 * 등록부로 본다.
 *
 * ── scoped:false인 토큰은 scope가 항상 "both"다 ─────────────────────────
 * 모서리·글자 크기는 테마에 따라 달라질 이유가 없다(다크에서만 모서리가
 * 둥글어질 까닭이 없고, 나눠 두면 한쪽만 고쳐진 채 남는 길만 열린다). 그래서
 * 그 토큰들은 "both" 행 하나만 갖고, 서버가 다른 스코프를 거절한다(4단계).
 * 이것을 DB 제약(CHECK)으로 걸지 않는 이유는, 어느 토큰이 scoped인지의 판정이
 * **등록부에 있고 등록부는 코드**이기 때문이다. 제약으로 옮겨 적으면 두 벌이
 * 되고, 토큰 하나를 scoped:true로 바꾸는 날 코드와 DB가 조용히 어긋난다.
 * 그렇게 들어온 어긋난 행은 조회(resolveUiTheme)가 무시한다.
 *
 * ── 행을 미리 심지 않는다 ───────────────────────────────────────────────
 * role_permissions·notification_*_settings와 같다. **빈 표가 정상 초기 상태**이고,
 * 행이 없는 (토큰, 스코프)는 코드의 기본값을 그대로 따른다. 설치 시점에 35개
 * 토큰을 미리 채워 넣으면, 나중에 기본 팔레트를 손볼 때 아무도 만진 적 없는 옛
 * 값이 그것을 덮어써 아무 화면도 따라 바뀌지 않는다. 등록부에서 사라진 키의 남은
 * 행도 조회가 무시한다.
 *
 * ── 🔴 이 표가 비어 있으면 앱은 이 기능이 없던 때와 완전히 같이 동작한다 ──
 * 마이그레이션을 적용하기 **전에도** 마찬가지다 — 조회가 42P01(표 없음)을
 * 삼키고 "오버라이드 없음"으로 답한다(3단계). 그래서 이 축은 어느 지점에서
 * 멈춰도 화면이 지금과 똑같고, 되돌릴 일이 없는 배포가 된다.
 * ============================================================================
 */
export const uiThemeTokens = pgTable(
  "ui_theme_tokens",
  {
    /**
     * 대리 키. (token_key, scope) 복합 기본키를 쓰지 않는 이유는
     * role_permissions와 같다 — audit_logs.target_record_id가 NOT NULL uuid라,
     * 기록을 남기려면 행마다 uuid 하나가 있어야 한다. 유일성은 아래 유니크
     * 인덱스가 그대로 지킨다.
     */
    id: uuid("id").primaryKey().defaultRandom(),
    /** 등록부의 논리 키. 예: "zinc-900" · "background" · "radius-md" · "text-sm" */
    tokenKey: text("token_key").notNull(),
    /** "light" | "dark" | "both". scoped:false인 토큰은 "both"만 온다. */
    scope: text("scope").notNull(),
    /** 정규화를 지난 값. 색은 "#18181b", 길이는 "0.375rem" 꼴. */
    value: text("value").notNull(),
    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ui_theme_tokens_key_scope_unique").on(table.tokenKey, table.scope)]
);
