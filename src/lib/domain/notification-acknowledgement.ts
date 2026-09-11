/**
 * ============================================================================
 * 알림 확인 — 확인 기록에 적을 알림 키의 형식과 종류
 * ============================================================================
 * 「눌러서 확인하면 사라지는」 정보성 알림은 사람이 누른 사실을
 * notification_acknowledgements 표에 남긴다(schema/notification-acknowledgements.ts
 * 머리말). 그 표의 행과 파생된 알림을 잇는 것은 **알림 키 하나** —
 * NotificationItem.id 그대로의 문자열이다.
 *
 * 이 파일은 그 키가 저장해도 되는 모양·종류인지만 본다. DB 도 server-only 도 들어오지
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
 * ── 🔴 「눌러서 확인하는 종류」의 키만 통과한다 ───────────────────────────
 * 형식이 맞아도 종류 자리가 ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 없으면 거절한다.
 * 할 일 알림(결재 대기·부품 요청 대기 등)은 **처리해야 사라지는** 알림이다 — 그
 * 키를 확인 기록에 적게 두면, 처리하지 않고 「확인」으로 숨기는 길이 생긴다. 지금
 * 레지스트리는 확인 기록을 정보성 종류에만 대 보지만(db/queries/notifications.ts),
 * 그것 하나에 기대지 않고 적는 쪽 문에서도 막는다.
 *
 * 같은 목록을 종 화면도 본다(NotificationBell 이 줄을 누를 때 확인 액션을 부를지
 * 정한다). 화면·서버 액션·mutation 이 이 파일의 함수 하나를 보므로 셋이 갈라질 수
 * 없다.
 * ============================================================================
 */

import type { NotificationKind } from "./notifications";

/**
 * 눌러서 확인하면 사라지는 종류 — 요청자에게 가는 결재 결과 둘.
 *
 * 🔴 여기에 종류를 더하는 것은 「그 알림을 확인으로 숨겨도 되는가」를 정하는 일이다.
 * 처리하면 저절로 사라지는 할 일 알림을 넣으면, 처리하지 않은 일을 종에서 치울 수
 * 있게 된다. 레지스트리 쪽 load 가 확인 기록을 빼는 것도 함께 붙여야 한다.
 */
export const ACKNOWLEDGEABLE_NOTIFICATION_KINDS = [
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
] as const satisfies readonly NotificationKind[];

/**
 * 눌러서 확인하는 종류인가. 입력이 문자열인 이유는 키에서 떼어 낸 종류 자리(아직
 * 등록된 종류인지도 모르는 글자)와 NotificationItem.kind 를 같은 함수로 보기 위해서다.
 */
export function isAcknowledgeableNotificationKind(kind: string): boolean {
  return (ACKNOWLEDGEABLE_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

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
      /** 키의 종류 자리(첫 `:` 앞). 언제나 눌러서 확인하는 종류다. */
      kind: string;
    }
  | { ok: false; message: string };

const INVALID_KEY_MESSAGE = "알림 정보를 확인할 수 없습니다.";
const NOT_ACKNOWLEDGEABLE_MESSAGE = "눌러서 확인하는 알림이 아닙니다.";

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
  // 형식이 맞아도 할 일 알림의 키는 거절한다(파일 머리말) — 처리하지 않은 일을
  // 「확인」으로 숨기는 길을 만들지 않는다.
  if (!isAcknowledgeableNotificationKind(kind)) return { ok: false, message: NOT_ACKNOWLEDGEABLE_MESSAGE };
  return { ok: true, key: raw, kind };
}
