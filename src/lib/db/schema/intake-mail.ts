import {
  boolean,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 접수 알림 메일 설정 — 켤지, 누가 받을지, 뭐라고 쓸지
 * ============================================================================
 * A/S 접수가 만들어지면 전사원에게 메일을 보낸다. 그 메일의 **규칙**을 담는
 * 표들이다(메일 자체는 여기 남지 않는다).
 *
 * ── 왜 표가 둘인가 ──────────────────────────────────────────────────────
 * notification_kind_settings / notification_role_settings 를 가른 것과 같은
 * 판단이다. **"껐다"와 "아무도 안 고름"은 다른 일이다.** 한 표에 접으면 껐다
 * 켤 때 고른 수신자가 사라진다.
 *
 * ── 🔴 수신자가 비어 있으면 아무에게도 보내지 않는다 ─────────────────────
 * "고르지 않았으니 전원"이 아니다. 반대로 두면 표를 만든 그 순간부터, 또는
 * 누가 마지막 수신자를 지운 순간부터 **전 직원에게 메일이 나가기 시작한다.**
 * 잘못 나간 메일은 되돌릴 수 없으므로, 모르는 상태의 기본값은 "안 보냄"이어야
 * 한다. 발송 쪽(2단계)이 이 규칙을 지킨다.
 *
 * ── 문구는 왜 세 칸뿐인가 ───────────────────────────────────────────────
 * 제목 형식 · 머리말 · 꼬리말. 가운데 자료 부분(제품·증상·유무상·O/H·과거
 * 이력)은 코드가 만든다(domain/intake-mail-body.ts). 표까지 자유 편집으로
 * 열면 값이 빠지거나 틀린 이름표가 붙는데, 그걸 알아채는 건 전사원에게 나간
 * 뒤다.
 * ============================================================================
 */

/**
 * 한 행만 있는 설정. 행이 없으면 코드의 기본값이 답한다
 * (domain/intake-mail-body.ts 의 DEFAULT_INTAKE_MAIL_TEMPLATE, 발송은 꺼짐).
 *
 * 설치 시점에 미리 한 줄 넣어 두지 않는 이유는 role_permissions ·
 * notification_*_settings 와 같다 — 아무도 만진 적 없는 옛 값이 나중에 바뀐
 * 코드 기본값을 덮어써 버린다.
 *
 * `singleton` 은 항상 true 다. 유니크 인덱스와 짝지어 **행이 둘이 되는 것을
 * DB 가 막는다** — 설정이 두 벌이면 어느 것으로 보냈는지 아무도 답할 수 없다.
 */
export const intakeMailSettings = pgTable(
  "intake_mail_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    singleton: boolean("singleton").notNull().default(true),

    /** 접수 때 자동으로 보낼지. 기본은 꺼짐 — SMTP 설정 전에 켜져 있으면 실패 기록만 쌓인다. */
    isEnabled: boolean("is_enabled").notNull().default(false),

    /** 제목 형식. `{{인수번호}}` 같은 치환자를 쓸 수 있다. */
    subjectTemplate: text("subject_template").notNull(),
    /** 자료 위 인사말. 빈 문자열이면 그 줄이 아예 빠진다. */
    introText: text("intro_text").notNull(),
    /** 자료 아래 맺음말. 빈 문자열이면 그 줄이 아예 빠진다. */
    outroText: text("outro_text").notNull(),

    /**
     * 메일 맨 아래에 붙는 서명(HTML). 관리자가 Outlook 등에서 복사해 붙여넣고,
     * **저장 시점에 정화된 것만** 들어온다(domain/mail-signature-html.ts).
     *
     * 이미지는 여기 담기지 않는다 — `<img src="cid:로고">` 처럼 참조만 있고
     * 실물은 아래 intake_mail_signature_images 에 있다.
     */
    signatureHtml: text("signature_html").notNull().default(""),

    /** 누가 마지막으로 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 본다. */
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("intake_mail_settings_singleton_unique").on(table.singleton)]
);

/**
 * 고른 수신자. **행이 있는 사람만 받는다.**
 *
 * 역할이 아니라 사람으로 고르는 이유: 같은 역할 안에서도 받을 사람과 안 받을
 * 사람이 갈린다(사용자 결정, 2026-08-31). 역할로 묶으면 한 사람을 빼려고
 * 역할 전체를 끄게 된다.
 *
 * 계정이 지워지면 이 행도 함께 사라진다(cascade) — 없는 사람에게 보내려다
 * 실패하는 것보다, 수신자 목록에서 조용히 빠지는 편이 맞다. 대신 화면은
 * 남은 수신자 수를 늘 보여 준다.
 */
export const intakeMailRecipients = pgTable(
  "intake_mail_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** 누가 이 사람을 수신자로 넣었는지. */
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("intake_mail_recipients_user_unique").on(table.userId)]
);

/**
 * 서명에 넣는 이미지(로고 등).
 *
 * ── 왜 DB 에 바이트를 넣는가 — 첨부파일과 다르게 ────────────────────────
 * 이 저장소의 첨부(attachments)는 일부러 디스크(UPLOADS_DIR)에 두고 bytea 를
 * 쓰지 않는다. 그건 **한 건에 여러 장, 장당 20MB** 짜리 얘기다. 서명 이미지는
 * 로고 몇 장, 장당 수십 KB 이고 전 시스템에 몇 개뿐이라 성격이 다르다.
 *
 * DB 에 두면 얻는 것: NAS 로 옮길 때 경로를 맞출 일이 없고, 백업이 DB 하나로
 * 끝나며, 파일은 남았는데 행이 없거나 그 반대인 상태가 생기지 않는다.
 * 크기는 저장 전에 막는다(validation/intake-mail-settings-input.ts).
 *
 * ── cid 가 열쇠다 ───────────────────────────────────────────────────────
 * 메일에 이미지를 동봉하고 본문이 `<img src="cid:이것">` 으로 가리킨다. 외부
 * URL 은 NAS 가 인터넷에서 안 보이고, data: URI 는 Gmail·Outlook 이 막는다.
 * 그래서 cid 가 사실상 유일한 방법이다.
 */
export const intakeMailSignatureImages = pgTable(
  "intake_mail_signature_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * 본문이 가리키는 이름. `<img src="cid:...">` 의 그 값이다.
     * 사람이 서명 HTML 에 직접 적으므로 읽을 수 있는 짧은 이름을 쓴다.
     */
    cid: text("cid").notNull(),

    /** 올릴 때의 파일 이름. 화면 목록에서 어느 그림인지 알아보는 용도다. */
    fileName: text("file_name").notNull(),
    /** image/png · image/jpeg · image/gif 만 받는다(입력 검증에서 막는다). */
    mimeType: text("mime_type").notNull(),
    /** 실제 바이트. */
    content: customType<{ data: Buffer; driverData: Buffer }>({
      dataType: () => "bytea",
    })("content").notNull(),
    /** 바이트 수. 목록에서 크기를 보여 주고 합계를 막을 때 쓴다. */
    sizeBytes: integer("size_bytes").notNull(),

    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 같은 cid 가 둘이면 어느 그림이 붙을지 아무도 답할 수 없다.
    uniqueIndex("intake_mail_signature_images_cid_unique").on(table.cid),
  ]
);
