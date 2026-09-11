/**
 * ============================================================================
 * 알림 확인 — 확인 기록에 적을 알림 키의 형식
 * ============================================================================
 * 「눌러서 확인하면 사라지는」 정보성 알림은 사람이 누른 사실을
 * notification_acknowledgements 표에 남긴다(schema/notification-acknowledgements.ts
 * 머리말). 그 표의 행과 파생된 알림을 잇는 것은 **알림 키 하나** —
 * NotificationItem.id 그대로의 문자열이다.
 *
 * 이 파일은 그 키가 저장해도 되는 모양인지만 본다. DB 도 server-only 도 들어오지
 * 않는 순수 함수라, 서버 액션(입구)과 mutation(저장 직전)이 **같은 함수**를 부른다
 * — 두 곳에 규칙을 따로 적어 두면 한쪽만 고쳐졌을 때 입구는 통과시키고 저장은
 * 거절하는(또는 그 반대) 일이 생긴다.
 *
 * ── 왜 형식을 이렇게 좁게 보는가 ─────────────────────────────────────────
 * 이 키는 화면이 보내 온다. 서버 액션은 누구나 아무 문자열로나 부를 수 있으므로,
 * 여기서 좁히지 않으면 확인 기록 표가 「아무 글이나 적어 두는 칸」이 된다. 이
 * 저장소의 알림 id 는 전부 `종류:나머지` 모양이고(domain/notifications.ts 의 build
 * 함수들), 나머지 자리에 들어가는 것은 uuid·enum 코드·그 사이의 `:` 뿐이다.
 * 그래서 허용하는 글자를 그만큼으로 묶는다:
 *
 *  · 종류 — 대문자로 시작하는 대문자·숫자·밑줄(NOTIFICATION_KINDS 의 모양)
 *  · `:` 하나로 가른 뒤
 *  · 나머지 — 영문 대소문자·숫자·`:`·`-`·`_` 한 글자 이상
 *  · 전체 1~200자(표의 CHECK 와 같은 상한)
 *
 * 공백·한글·`%`·`\` 같은 것이 들어간 키는 **다듬지 않고 거절한다.** 키는 사람이
 * 적는 글이 아니라 파생 쪽이 만든 식별자라, 앞뒤 공백을 떼어 저장하면 파생된
 * 알림의 id 와 글자가 달라져 영영 걸러지지 않는 행이 된다.
 *
 * ── 🔴 이 조각에서는 「어느 종류인가」를 묻지 않는다 ─────────────────────
 * 확인할 수 있는 종류(요청자에게 가는 「승인 완료」·「반려됨」)는 **다음 조각에서
 * 생긴다.** 지금은 형식만 보고, 종류 자리는 떼어서(`kind`) 돌려주기만 한다. 다음
 * 조각은 아래 표시한 자리에서 「확인할 수 있는 종류」 목록과 대조하면 된다 —
 * 처리하면 저절로 사라지는 할 일 알림(결재 대기 등)에 확인 기록이 쌓이는 것을
 * 막는 문이 그것이다.
 * ============================================================================
 */

/** 알림 키의 최대 길이. 표의 CHECK(`char_length(notification_key) BETWEEN 1 AND 200`)와 같다. */
export const NOTIFICATION_ACKNOWLEDGEMENT_KEY_MAX_LENGTH = 200;

/**
 * `종류:나머지`. 종류는 대문자로 시작하는 대문자·숫자·밑줄, 나머지는 영숫자·`:`·`-`·`_`.
 * 허용 글자가 전부 ASCII 라 JS 의 `.length` 와 Postgres 의 `char_length` 가 같은 값을 낸다.
 */
const NOTIFICATION_ACKNOWLEDGEMENT_KEY_PATTERN = /^([A-Z][A-Z0-9_]*):[A-Za-z0-9:_-]+$/;

export type NotificationAcknowledgementKeyCheck =
  | {
      ok: true;
      /** 검증을 지난 키 — 받은 문자열 그대로다(다듬지 않는다). */
      key: string;
      /** 키의 종류 자리(첫 `:` 앞). 다음 조각이 「확인할 수 있는 종류」와 대조할 값이다. */
      kind: string;
    }
  | { ok: false; message: string };

const INVALID_KEY_MESSAGE = "알림 정보를 확인할 수 없습니다.";

/**
 * 확인 기록에 적어도 되는 알림 키인가. 입력은 `unknown` 이다 — 서버 액션의 인자는
 * 화면이 보낸 그대로라 문자열이라는 보장부터 없다.
 */
export function checkNotificationAcknowledgementKey(
  raw: unknown
): NotificationAcknowledgementKeyCheck {
  if (typeof raw !== "string") return { ok: false, message: INVALID_KEY_MESSAGE };
  if (raw.length === 0 || raw.length > NOTIFICATION_ACKNOWLEDGEMENT_KEY_MAX_LENGTH) {
    return { ok: false, message: INVALID_KEY_MESSAGE };
  }
  const match = NOTIFICATION_ACKNOWLEDGEMENT_KEY_PATTERN.exec(raw);
  if (!match) return { ok: false, message: INVALID_KEY_MESSAGE };

  const kind = match[1];
  // ── 다음 조각의 자리 ──────────────────────────────────────────────────
  // 여기서 `kind` 를 「확인할 수 있는 종류」 목록과 대조한다. 이 조각에서는 그
  // 목록이 아직 없으므로(종류가 다음 조각에서 생긴다) 형식만 본다.
  return { ok: true, key: raw, kind };
}
