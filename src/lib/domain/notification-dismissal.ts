/**
 * ============================================================================
 * 알림 **지우기** — 이 브라우저에, 이번 로그인 동안만
 * ============================================================================
 * 종에 뜬 줄을 눈앞에서 치우는 일이다. 🔴 **서버도 DB 도 건드리지 않는다** —
 * 적히는 곳은 이 브라우저의 localStorage 하나뿐이고, 다시 로그인하면 아직
 * 끝나지 않은 일은 **그대로 다시 뜬다**.
 *
 * ── 🔴 「확인 기록」과 다른 개념이다 ─────────────────────────────────────
 * 옆 파일 notification-acknowledgement.ts 의 확인 기록은 **영구**다 — 결재
 * 결과를 눌러 확인하면 notification_acknowledgements 표에 남아 영영 사라진다.
 * 이쪽은 **임시**다. 둘을 섞지 않는다:
 *
 * | | 확인 기록(표) | 지우기(이 파일) |
 * |---|---|---|
 * | 어디에 | 서버 DB | 이 브라우저 |
 * | 언제까지 | 영영 | 다음 로그인까지 |
 * | 누구 것까지 | 그 사람 계정 | 이 브라우저의 이 로그인 |
 * | 남의 시스템 알림 | 🔴 적을 수 없다 | 적을 수 있다 |
 *
 * ── 🔴 왜 「해결됐는지」를 따로 재지 않나 ────────────────────────────────
 * 알림은 DB 에 쌓이지 않는다 — 매 요청 업무 자료에서 다시 계산한다
 * (db/queries/notifications.ts). 해결된 일은 **애초에 목록에 없다.** 그래서
 * 지운 뒤 다시 로그인했을 때 그 줄이 다시 뜨면 그것이 곧 「아직 안 끝났다」는
 * 뜻이다.
 *
 * ── 🔴 순수 계산만 한다 ──────────────────────────────────────────────────
 * `server-only` 도 `window` 도 물지 않는다 — 저장소는 **인자로 받는다**
 * (DismissalStore). 그래야 화면 없이 시험할 수 있고, 저장을 막아 둔 브라우저를
 * 그대로 흉내 낼 수 있다(notification-toast.ts 의 SeenKeyStore 와 같은 방식).
 * ============================================================================
 */

import { isAcknowledgeableNotificationKind } from "./notification-acknowledgement";

/**
 * 지울 수 있는지 가릴 때 보는 **최소한의 모양**.
 *
 * 🔴 `sourceId` 는 「어느 시스템에서 온 줄인가」다. **A/S 자신의 알림은 빈
 * 문자열**이고(notification-bell-items.ts), 포털을 거쳐 온 줄만 값이 있다.
 * A/S 안쪽 모양(NotificationItem)에는 이 칸이 아예 없어서 물음표가 붙어 있다 —
 * 없는 것은 「자기 것」으로 읽는다(화면의 PickedNotification 과 같은 약속이다).
 */
export type DismissableNotification = { kind: string; sourceId?: string };

/**
 * 이 줄을 지워도 되는가. 🔴 **가리는 자리는 여기 하나다** — 화면은 이 함수를
 * 묶음에 그대로 넘겨 단추를 그릴지 정하고, 실제로 지울 때도 같은 함수를 본다.
 *
 * ── 남의 시스템 줄(sourceId 가 있다) → **언제나 가능** ───────────────────
 * 🔴 **종류 이름을 보지 않는다.** 저쪽 시스템의 종류 목록은 이 저장소의 것이
 * 아니고, 저쪽이 이름을 바꾸거나 종류를 늘리는 날 여기 적힌 목록이 조용히
 * 안 맞게 된다 — 아무 오류도 없이 「지워지지 않는 알림」이 생긴다. 애초에
 * 남의 알림을 A/S 가 처리할 길은 없으므로(그 시스템 화면으로 건너가야 한다)
 * 「눈에서 치운다」를 막을 이유도 없다.
 *
 * ── A/S 자기 줄 → **눌러서 확인하는 종류만** ─────────────────────────────
 * 처리해야 사라지는 할 일 알림(결재 대기·부품 요청 대기 등)은 지울 수 없다.
 * 지우게 두면 **처리하지 않은 일을 종에서 치우는 길**이 생긴다 — 확인 기록
 * 쪽이 같은 이유로 같은 목록을 쓰고 있어(ACKNOWLEDGEABLE_NOTIFICATION_KINDS),
 * 그 판정을 그대로 빌린다. 두 곳에 목록을 따로 적으면 한쪽만 늘었을 때 갈린다.
 */
export function canDismissNotification(item: DismissableNotification): boolean {
  if (item.sourceId) return true;
  return isAcknowledgeableNotificationKind(item.kind);
}

/** 지울 수 있는지 가릴 수 있고 **열쇠를 가진** 줄 — 종에 실제로 실리는 모양. */
export type DismissableRow = DismissableNotification & { key: string };

/**
 * 지금 보이는 줄 가운데 **지울 수 있는 것들의 열쇠**. 일괄 지우기가 쓴다.
 *
 * 🔴 「지금 보이는 것」이라 호출부가 **이미 거른 목록**을 넘겨야 한다. 여기서
 * 다시 거르지 않는 이유: 무엇이 보이는지는 화면이 아는 것이고(이미 지운 줄 ·
 * 확인한 줄이 빠져 있다), 이 함수가 그것까지 알면 같은 규칙이 두 곳이 된다.
 */
export function dismissableNotificationKeys(items: readonly DismissableRow[]): string[] {
  return items.filter((item) => canDismissNotification(item)).map((item) => item.key);
}

// ──────────────────────────────────────────── 이 브라우저에 적어 두기

/**
 * `localStorage` 처럼 생긴 것. 실물을 직접 부르지 않는 이유는 옆 파일
 * (notification-toast.ts 의 SeenKeyStore)과 같다 — 시험에서 **터지는 저장소**를
 * 흉내 낼 수 있고, 이 파일이 브라우저 전역에 손대지 않아 Node 에서 그대로 돈다.
 *
 * 🔴 `length`·`key()` 까지 받는 이유는 **옛 열쇠를 치우기 위해서**다(아래
 * pruneOldDismissalKeys). 그 둘이 없으면 무엇이 쌓여 있는지 알 길이 없다.
 */
export type DismissalStore = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** 열쇠의 앞머리. `v1` 은 적어 두는 모양이 바뀌면 올린다 — 옛 값이 조용히 무시된다. */
const PREFIX = "dss.notifications.dismissed.v1.";

/**
 * 🔴 **사람과 로그인 시각으로 갈린다.** 둘 다 섞는 까닭이 각각 있다:
 *
 *  - `userId` — 한 컴퓨터를 여럿이 나눠 쓰면(사무실 공용 PC) 앞사람이 지운
 *    것을 뒷사람이 물려받아서는 안 된다. 뒷사람에게는 그것이 처음 보는 일이다.
 *  - `issuedAt` — 이 세션이 **만들어진 때**(= 로그인 시각, auth/session.ts).
 *    다시 로그인하면 이 값이 달라져 **열쇠가 통째로 바뀐다** — 지운 기록을
 *    지우는 일을 따로 하지 않아도 저절로 빈 상태가 된다. 세션은 8시간 고정이고
 *    연장되지 않으므로 사람은 하루에 최소 한 번 새 값을 받는다.
 *
 * 🔴 `issuedAt` 은 **서버가 내려준다**(레이아웃이 readSession 으로 읽는다).
 * 화면이 쿠키를 풀지 않는다 — 세션 쿠키는 httpOnly 라 애초에 읽을 수 없고,
 * 읽을 수 있다 해도 서명을 확인하는 자리는 서버 하나여야 한다.
 */
export function notificationDismissalStorageKey(session: {
  userId: string;
  issuedAt: number;
}): string {
  return `${PREFIX}${session.userId}.${session.issuedAt}`;
}

/** 그 사람의 열쇠들이 공통으로 가진 앞머리. 옛 것을 가려내는 데 쓴다. */
export function notificationDismissalKeyPrefixForUser(userId: string): string {
  return `${PREFIX}${userId}.`;
}

/**
 * 적어 둔 열쇠를 읽는다. **어떤 경우에도 던지지 않는다.**
 *
 * 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 저장소에 손대는 것 자체가
 * 터진다. 못 읽었으면 **빈 목록**이다 — 「아무것도 안 지웠다」쪽으로 기운다.
 * 반대로 기울면(못 읽었는데 뭔가 지워진 것으로 치면) 알림이 사라진다.
 */
export function readDismissedNotificationKeys(
  store: DismissalStore | null,
  storageKey: string
): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(storageKey);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (!parsed.every((value): value is string => typeof value === "string")) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** 적어 둔다. 읽기와 같은 이유로 **어떤 경우에도 던지지 않는다**(저장 공간이 꽉 찬 경우 포함). */
export function writeDismissedNotificationKeys(
  store: DismissalStore | null,
  storageKey: string,
  keys: readonly string[]
): void {
  if (!store) return;
  try {
    store.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // 못 적어 두면 새로고침했을 때 지운 줄이 되살아날 뿐이다 — 알림이 사라지는
    // 쪽이 아니라 남는 쪽이라 조용할지언정 위험하지 않다.
  }
}

/**
 * **같은 사람의 옛 열쇠**를 치운다. 지금 쓰는 것 하나만 남긴다.
 *
 * 🔴 열쇠에 로그인 시각이 섞여 있어 **로그인할 때마다 새 칸이 하나 생긴다.**
 * 하루 한두 번이라도 몇 해가 쌓이면 이 브라우저에 쓰지 않는 칸이 수백 개가
 * 된다 — 아무도 읽지 않는데 저장 공간만 먹고, 꽉 차면 다른 기능의 저장까지
 * 실패한다.
 *
 * 🔴 **다른 사람의 열쇠는 건드리지 않는다.** 공용 PC 에서 옆자리 사람이 아직
 * 그 세션을 쓰고 있을 수 있고(다른 브라우저 프로필·다른 창), 남의 것을 치우는
 * 일은 이 함수가 판단할 것이 아니다. 그 사람 것은 **그 사람이 다음에
 * 로그인할 때** 이 함수가 치운다.
 *
 * 던지지 않는다. 치운 열쇠를 돌려주는 것은 시험이 「무엇을 치웠나」를 볼 수
 * 있게 하기 위한 것이다.
 */
export function pruneOldDismissalKeys(
  store: DismissalStore | null,
  owner: { prefix: string; keep: string }
): string[] {
  if (!store) return [];
  const 치울것: string[] = [];
  try {
    // 🔴 **먼저 모으고 나중에 지운다.** 지우면서 훑으면 뒤 칸의 번호가 당겨져
    //    한 칸씩 건너뛴다 — 절반만 치워지고 아무도 모른다.
    for (let index = 0; index < store.length; index += 1) {
      const name = store.key(index);
      if (name === null) continue;
      if (!name.startsWith(owner.prefix)) continue;
      if (name === owner.keep) continue;
      치울것.push(name);
    }
    for (const name of 치울것) {
      store.removeItem(name);
    }
  } catch {
    // 못 치워도 지금 로그인은 제 열쇠로 멀쩡히 돈다 — 다음 로그인에 다시 해 본다.
  }
  return 치울것;
}
