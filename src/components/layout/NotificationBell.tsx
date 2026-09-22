"use client";

import { useState, useSyncExternalStore } from "react";
import { NotificationBell as SharedNotificationBell } from "@dss/ui";
import type { NotificationBellItem } from "@dss/ui";
import { countNotificationTargets, type NotificationItem } from "@/lib/domain/notifications";
import { toNotificationBellItems } from "@/lib/domain/notification-bell-items";
import { isAcknowledgeableNotificationKind } from "@/lib/domain/notification-acknowledgement";
import {
  NOTIFICATION_PANEL_OPENED_EVENT,
  NOTIFICATION_PERMISSION_CHANGED_EVENT,
  buildNotificationSelfTestToast,
  describeBrowserNotificationStatus,
  describeNotificationToastOutcome,
  resolveBrowserNotificationStatus,
  type BrowserNotificationStatus,
} from "@/lib/domain/notification-toast";
import { showBrowserNotificationToast } from "./BrowserNotifications";

/**
 * ============================================================================
 * 헤더의 종 알림 — 겉은 공용 묶음(@dss/ui), 속은 A/S 의 사정
 * ============================================================================
 * 사이드바의 결재 배지는 **숫자 하나**라 "3건 있다"까지만 말한다. 무엇인지
 * 보려면 목록 페이지를 열어서 다시 찾아야 한다. 종은 건별로 펼쳐 보여 주고
 * 그 건의 상세로 바로 보낸다.
 *
 * ── 🔴 그리는 일은 묶음이 한다 ──────────────────────────────────────────
 * 사내 시스템이 여섯인데(A/S · 포털 · 계측기 · 개선요청 · PO/내자 · 휴가) 종은
 * A/S 에만 있었다. 「어느 시스템에 있든 종 하나를 열면 모든 시스템의 알림이
 * 보인다」로 가기로 해서, 종의 겉모습은 @dss/ui 로 뺐고 다른 네 사이트가 이미
 * 같은 것을 달았다. 이 파일은 그 묶음 종의 **껍데기**다 — 단추도, 펼침 패널도,
 * 목록 마크업도 여기 없다.
 *
 * 묶음 종은 <details>/<summary> 라 여닫기를 **브라우저가** 한다. 그래서 여기
 * 있던 isOpen 상태와 바깥 클릭·Esc 닫기 효과가 사라졌다(묶음의 BellBehavior 가
 * 한다). 덤으로 정적 렌더 시험이 **펼친 속까지** 그대로 본다.
 *
 * ── 종류를 모른다 ───────────────────────────────────────────────────────
 * 이 컴포넌트에는 "결재"라는 말이 한 군데도 없고, 종류를 보고 갈라지는 분기도
 * 없다. 알림 종류가 늘어도 여기는 고치지 않는다 — 종류는
 * db/queries/notifications.ts 의 레지스트리에 등록한다.
 *
 * 그 규칙은 NotificationBell.test.tsx 가 이 파일의 소스를 직접 읽어 지킨다.
 *
 * 종류마다 다른 **이름**은 도메인의 NOTIFICATION_KIND_META 를 읽어 옮겨 담는
 * 자리(domain/notification-bell-items.ts)가 싣는다. **색**은 더 이상 이쪽이
 * 정하지 않는다 — 묶음이 종류 코드를 해시해 제 색 칸을 고른다. 클래스 이름을
 * 그대로 건네면 Tailwind v4 가 node_modules 를 훑지 않아 색이 조용히 사라진다.
 *
 * ── 눌러서 확인하는 알림 ────────────────────────────────────────────────
 * 결재 결과처럼 처리할 것이 없는 정보성 알림은 줄을 누르면 「확인함」을 적고 종에서
 * 뺀다. 🔴 묶음은 **모든 줄에서** 확인 함수를 부른다 — 「눌러서 확인하는 줄인가」는
 * 묶음이 알 수 없는 A/S 안쪽 사정이라, 도메인 판정
 * (isAcknowledgeableNotificationKind) **한 곳**으로 여기서 가린다
 * (handleNotificationPicked). 이동은 평범한 <a href> 가 하므로 확인 저장을
 * 기다리지 않고, 저장이 실패해도 막히지 않는다 — 실패하면 그 줄이 다시 나타날 뿐이다.
 *
 * ── 묶음에 올 수 없는 것은 footer 로 넣는다 ─────────────────────────────
 * 브라우저 알림 권한 안내와 「시험 알림」 단추는 `navigator`·사람마다 갈라 쓰는
 * localStorage·이 사이트의 아이콘 경로를 문다. 묶음은 제 시험으로 그것들을
 * 금지하므로(그쪽 no-network.test.ts), 자리(`footer`)만 내주고 사이트가 제 것을
 * 끼워 넣는다. 🔴 함수가 아니라 **노드**를 넘긴다.
 *
 * ── 모바일 폭 ───────────────────────────────────────────────────────────
 * TopBar.tsx 의 주석에 적힌 사고(오른쪽 묶음이 폰에서 헤더를 가로로 넘치게
 * 만들어 햄버거조차 누르기 어려웠던 일) 때문에, 종은 햄버거와 같은 아이콘 버튼
 * 하나를 넘지 않고 `ml-auto shrink-0` 으로 오른쪽 끝에 붙어 눌리지 않는다.
 * 펼침 패널이 화면 밖으로 나가지 않게 폭을 제한하는 일은 묶음의 CSS 가 한다.
 * ============================================================================
 */

/**
 * 확인 기록을 적는 함수 — 서버 액션 acknowledgeNotificationAction
 * (server/actions/notification-acknowledgements.ts)과 같은 모양이다.
 *
 * 🔴 이 파일은 그 서버 액션을 직접 가져오지 않고 **받아서** 쓴다. 서버 액션 파일은
 * `server-only` 사슬(세션·DB)을 물고 있어서, 여기서 가져오면 이 파일을 정적 렌더로
 * 시험하는 NotificationBell.test.tsx 가 가져오는 순간 죽는다. 받아서 쓰면 시험은 가짜
 * 함수를 넘겨 「누가 언제 부르는가」를 그대로 볼 수 있다.
 */
export type AcknowledgeNotification = (input: { notificationKey: string }) => Promise<{ ok: boolean }>;

/**
 * 확인을 가르고 적는 데 필요한 **최소한의 모양**.
 *
 * A/S 의 NotificationItem 과 묶음이 돌려주는 NotificationBellItem 이 둘 다 이것을
 * 만족한다(옮겨 담을 때 id 와 kind 를 그대로 싣는다 — notification-bell-items.ts).
 * 그래서 아래 두 함수는 어느 쪽을 받아도 같은 판단을 한다.
 */
export type PickedNotification = { id: string; kind: string };

/**
 * 줄 하나를 눌렀을 때 할 일. **이동은 하지 않는다** — 묶음의 줄은 평범한
 * <a href> 라 브라우저가 알아서 나간다.
 *
 * 🔴 묶음은 **모든 줄에서** 이 경로로 들어온다. 확인할지 말지는 도메인 판정 한
 * 곳이 정한다 — 종류 이름을 여기 적거나 종류로 갈라지지 않는다(이 파일 머리말).
 * 할 일 알림은 이 판정에서 거짓이라 확인 액션이 불리지 않는다.
 *
 * 🔴 확인은 기다리지 않는다 — onAcknowledge 는 저장을 **시작만** 하고 곧바로
 * 돌아오고, 그것이 던져도 이동은 그대로 간다.
 */
export function handleNotificationPicked(
  item: PickedNotification,
  handlers: { onAcknowledge?: (item: PickedNotification) => void }
): void {
  if (!handlers.onAcknowledge || !isAcknowledgeableNotificationKind(item.kind)) return;
  try {
    handlers.onAcknowledge(item);
  } catch {
    // 확인을 못 적어도 이동은 막지 않는다 — 알림이 종에 남을 뿐이다.
  }
}

/**
 * 확인 저장을 뒤에서 시작한다 — 줄은 **먼저** 종에서 빼고(hide), 저장이 실패하면
 * 되돌린다(restore).
 *
 * 먼저 빼는 이유: 누르면 곧바로 다른 화면으로 옮겨 가는데, 서버가 준 목록은 저장이
 * 끝나고 다시 계산될 때까지 그 줄을 그대로 들고 있다. 기다렸다가 빼면 옮겨 간 화면의
 * 종에 방금 누른 줄이 잠깐 남는다. 저장이 성사되면 서버 액션이 종을 다시 계산하게
 * 하므로(revalidatePath) 그 뒤로는 서버가 준 목록에도 그 줄이 없다.
 *
 * 🔴 묶음 종으로 갈아끼운 뒤로는 **누른 줄이 눈에서 곧바로 사라지지는 않는다.**
 * 이동이 <a href> 라 브라우저가 곧장 다음 화면으로 넘어가기 때문이다(상태를 고쳐도
 * 그릴 틈이 없다). 그래도 이 갈래를 그대로 두는 이유는 두 가지다 — 확인 기록을
 * 적는 일 자체가 여기서 시작되고, 같은 화면에 머무는 경우(같은 주소를 다시 누르는
 * 등)에는 여전히 이 목록 거르기가 종과 배지를 맞춰 준다.
 *
 * 결과를 기다리지 않고 곧바로 돌아온다 — 이동을 붙잡지 않기 위해서다.
 */
export function acknowledgeInBackground(
  item: PickedNotification,
  acknowledge: AcknowledgeNotification,
  view: { hide: (id: string) => void; restore: (id: string) => void }
): void {
  view.hide(item.id);
  const restore = () => view.restore(item.id);
  let pending: Promise<{ ok: boolean }>;
  try {
    pending = acknowledge({ notificationKey: item.id });
  } catch {
    restore();
    return;
  }
  void Promise.resolve(pending).then((result) => {
    if (!result?.ok) restore();
  }, restore);
}

/** 창처럼 사건을 던질 수 있는 것. 시험에서는 진짜 EventTarget 을 넣는다. */
export type NotificationPanelAnnounceHost = { dispatchEvent(event: Event): boolean };

/**
 * 🔴 종을 여는 순간 "지금 다시 세라"고 알린다.
 *
 * 여기 그려지는 목록은 서버 렌더 때 한 번 계산돼 내려온 값이라, 그대로 두면
 * 마지막으로 센 뒤에 생긴 알림이 안 보인다. 종을 여는 것은 **사람이 지금 알림을
 * 보겠다는 행동**이므로 그 자리에서 한 번 다시 세게 한다.
 *
 * 실제로 다시 세는 일은 BrowserNotifications 가 한다 — 화면의 다른 가지에 있어
 * 이 state 가 닿지 않으므로 창 전체 신호로 잇는다(권한 신호와 같은 방법이고,
 * 이름은 도메인에 한 번만 적혀 있다). 그쪽은 이 신호를 **권한과 무관하게**
 * 듣는다: 브라우저 알림을 안 받는 사람도 종은 보기 때문이다.
 *
 * 🔴 **닫을 때는 불리지 않는다.** 그것을 가리는 일은 이제 묶음이 한다 — 묶음의
 * `onOpen` 은 펼쳐진 순간에만 불린다(접는 것은 다 봤다는 행동이라 서버를 두드릴
 * 이유가 없다). 여닫기를 연달아 해도 듣는 쪽의 최소 간격이 막는다.
 *
 * 🔴 묶음도 제 창 사건(BELL_OPENED_EVENT)을 같은 순간에 던지지만, **그것을 듣는
 * 코드는 A/S 에 없다.** 여기는 이미 있는 신호를 그대로 쓴다 — 듣는 쪽
 * (BrowserNotifications)을 고치지 않기 위해서다.
 */
export function announceNotificationPanelOpened(host: NotificationPanelAnnounceHost): void {
  try {
    host.dispatchEvent(new Event(NOTIFICATION_PANEL_OPENED_EVENT));
  } catch {
    // 신호를 못 보내도 지금 있는 목록은 그대로 보인다 — 다음 주기에 따라잡는다.
  }
}

/**
 * 펼친 칸 맨 아래 — 컴퓨터·폰 알림창을 쓸 수 있는지, 못 쓴다면 왜인지.
 *
 * 상태 → 문구/단추 판정은 도메인(notification-toast.ts)에 있고 여기는 그대로
 * 그린다. 그래서 정적 렌더로 상태마다 따로 검사할 수 있다.
 *
 * 아무 말도 안 하는 상태가 둘이다 — 이미 허락받았을 때(정상이라 할 말이 없다)와
 * 아직 브라우저에 물어보기 전(UNKNOWN, 서버 렌더)이다. 서버에서 그리지 않는
 * 것이 중요하다: 서버는 이 기기가 보안 접속인지 알 수 없어서, 미리 무언가를
 * 적어 두면 하이드레이션 뒤에 글자가 바뀐다.
 */
export function BrowserNotificationNotice({
  status,
  onAsk,
}: {
  status: BrowserNotificationStatus;
  onAsk: () => void;
}) {
  const notice = describeBrowserNotificationStatus(status);
  if (notice.message === null && !notice.canAsk) return null;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      {notice.canAsk ? (
        <>
          <button
            type="button"
            onClick={onAsk}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            알림 받기
          </button>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            새 알림이 생기면 컴퓨터·폰 알림창에 띄웁니다.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{notice.message}</p>
      )}
    </div>
  );
}

/**
 * 🔴 `시험 알림` — 왜 안 뜨는지 화면이 말해 주는 자리.
 *
 * 알림이 안 뜬다는 신고는 원인이 화면 밖에 있어서 코드로 좇기가 어렵다. 실제로
 * 여러 세션 동안 못 잡은 것이 하나 있었다 — 안드로이드 Chrome은 페이지에서
 * 직접 만드는 알림을 금지하고 `Illegal constructor`를 던지는데, 그것을 빈
 * catch가 삼켜서 폰에서는 아무 일도 안 일어나고 아무 흔적도 안 남았다.
 *
 * 이 단추가 그 침묵을 없앤다. 누르면 알림을 실제로 한 번 띄우고 **그 자리에**
 * 결과를 적는다 — 떴으면 어느 통로로 떴는지, 못 떴으면 왜 못 떴는지. 다음에
 * 같은 신고가 오면 코드를 뒤지지 말고 이것부터 눌러 보면 된다.
 *
 * 띄울 수 있는 상태(GRANTED)에서만 그린다. 허락도 안 받은 상태에서 그리면
 * "권한이 없습니다"만 반복해서 알려 주는 단추가 되는데, 그 안내는 이미 바로
 * 위 BrowserNotificationNotice가 하고 있다.
 *
 * 뜬 결과를 판정하는 말(문구)은 도메인이 정한다 — 여기는 받은 글자를 그릴 뿐이라
 * 정적 렌더로 검사할 수 있다.
 */
export function NotificationSelfTest({
  status,
  onTest,
  result,
}: {
  status: BrowserNotificationStatus;
  onTest: () => void;
  /** 방금 눌러 본 결과. 아직 안 눌렀으면 null. */
  result: string | null;
}) {
  if (status !== "GRANTED") return null;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <button
        type="button"
        onClick={onTest}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        시험 알림
      </button>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {result ?? "눌러 보면 이 기기에서 알림이 뜨는지, 안 뜨면 왜 안 뜨는지 여기에 적습니다."}
      </p>
    </div>
  );
}

/**
 * 묶음 종의 `footer` 자리에 들어가는 A/S 의 것 — 위 둘을 **이 차례로** 묶는다.
 *
 * 둘이 한꺼번에 보이는 상태는 없다(권한 안내는 아직 못 띄우는 상태에서, 시험
 * 단추는 띄울 수 있는 상태에서만 그린다). 그래도 한 조각으로 묶어 두는 것은,
 * 묶음이 내주는 자리가 **하나**이고 그 안의 차례를 여기서 정해야 하기 때문이다.
 */
export function NotificationBellFooter({
  status,
  onAsk,
  onTest,
  selfTestResult,
}: {
  status: BrowserNotificationStatus;
  onAsk: () => void;
  onTest: () => void;
  selfTestResult: string | null;
}) {
  return (
    <>
      <BrowserNotificationNotice status={status} onAsk={onAsk} />
      <NotificationSelfTest status={status} onTest={onTest} result={selfTestResult} />
    </>
  );
}

/**
 * 이 브라우저가 지금 알림을 띄울 수 있는가 — 서버 렌더와 어긋나지 않게 알아내는 방법.
 *
 * 렌더 중에 `Notification`을 직접 만지면 서버에서 터진다(이 파일은 클라이언트
 * 컴포넌트지만 서버에서 한 번 그려진다). useSyncExternalStore에 서버용
 * 스냅샷("모른다")과 브라우저용 스냅샷을 따로 주면, 서버·하이드레이션 때는
 * 모르는 것으로 그리고 그 뒤에 실제 값으로 한 번 맞춰진다 —
 * EditSectionActions.tsx가 클립보드 유무에 쓰는 그 방법 그대로다.
 *
 * 돌려주는 값이 문자열 하나라서 렌더마다 새 객체가 생기지 않는다(객체를
 * 돌려주면 참조가 매번 달라져 무한 렌더가 된다). 세 함수 모두 모듈 수준에 두어
 * 렌더마다 새로 만들지 않는다.
 */
const subscribeToNothing = () => () => {};

function readBrowserNotificationStatus(): BrowserNotificationStatus {
  if (typeof window === "undefined") return "UNKNOWN";
  const hasNotificationApi = typeof window.Notification !== "undefined";
  return resolveBrowserNotificationStatus({
    isSecureContext: window.isSecureContext === true,
    hasNotificationApi,
    permission: hasNotificationApi ? window.Notification.permission : null,
  });
}

const unknownOnServer = (): BrowserNotificationStatus => "UNKNOWN";

/** 알림이 하나도 없을 때 펼친 칸에 적는 말. 🔴 묶음은 기본값을 두지 않는다. */
const EMPTY_LABEL = "처리할 알림이 없습니다.";

export default function NotificationBell({
  items = [],
  acknowledge,
}: {
  items?: readonly NotificationItem[];
  /**
   * 확인 기록을 적는 서버 액션. 넘기지 않으면 눌러서 확인하는 줄도 이동만 하고
   * 종에서 빠지지 않는다(저장하지 않은 것을 뺀 것처럼 보이게 하지 않는다).
   */
  acknowledge?: AcknowledgeNotification;
}) {
  /**
   * 눌러서 확인했고 저장이 진행 중이거나 끝난 줄. 서버가 준 목록이 다시 계산되기
   * 전까지 여기 든 줄은 그리지도 세지도 않는다(acknowledgeInBackground 주석).
   * 저장이 실패하면 빠진다 — 그 줄이 다시 나타난다.
   */
  const [acknowledgedIds, setAcknowledgedIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleItems =
    acknowledgedIds.size === 0 ? items : items.filter((item) => !acknowledgedIds.has(item.id));

  const detectedStatus = useSyncExternalStore(
    subscribeToNothing,
    readBrowserNotificationStatus,
    unknownOnServer
  );
  /**
   * 방금 물어보고 알게 된 답. 위 스냅샷에는 구독할 것이 없어서(권한이 바뀌었다고
   * 알려 주는 표준 신호가 모든 브라우저에 있지는 않다) 물어본 직후의 답만
   * 여기에 따로 담아 덮어쓴다.
   */
  const [statusAfterAsking, setStatusAfterAsking] = useState<BrowserNotificationStatus | null>(null);
  const notificationStatus = statusAfterAsking ?? detectedStatus;
  /** `시험 알림`을 눌러 본 결과. 아직 안 눌렀으면 null. */
  const [selfTestResult, setSelfTestResult] = useState<string | null>(null);

  // 🔴 세는 규칙은 묶음이 모른다 — 받은 숫자를 그대로 찍는다. 그래서 **옮겨 담기
  // 전 원본**에서 여기가 센다(묶음 타입에는 targetKey 가 없다). 사이드바 배지와
  // 같은 순수 헬퍼를 쓰므로 두 배지가 다른 말을 할 수 없다. 방금 눌러 확인한
  // 줄은 세지 않는다(목록과 배지가 같은 말을 해야 한다).
  const count = countNotificationTargets(visibleItems.map((item) => item.targetKey));

  function handleAcknowledge(item: PickedNotification) {
    if (!acknowledge) return;
    acknowledgeInBackground(item, acknowledge, {
      hide: (id) => setAcknowledgedIds((prev) => new Set(prev).add(id)),
      restore: (id) =>
        setAcknowledgedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
    });
  }

  /**
   * 🔴 권한은 **사람이 이 단추를 눌렀을 때만** 묻는다.
   *
   * 페이지가 열리자마자 예고 없이 물으면 대개 거절당하고, 한 번 거절하면
   * 브라우저 설정을 뒤져야 되돌릴 수 있다. 단추는 물어볼 수 있는 상태에서만
   * 그려지므로(describeBrowserNotificationStatus) 여기 닿는 것은 사람이 실제로
   * 누른 경우뿐이다.
   */
  async function handleAskForNotificationPermission() {
    try {
      await window.Notification.requestPermission();
    } catch {
      // 요청 자체가 조용히 막히는 브라우저가 있다. 아래에서 지금 상태를 다시
      // 읽어 화면에 반영한다 — 눌렀는데 아무 일도 없는 것처럼 보이지 않게.
    }

    const status = readBrowserNotificationStatus();
    setStatusAfterAsking(status);

    if (status === "GRANTED") {
      // 실제로 알림창을 띄우는 쪽(BrowserNotifications)은 화면의 다른 가지에
      // 있어서 이 state가 닿지 않는다. 알려 주지 않으면 방금 허락했는데도
      // 다음 주기(1분)까지 모른다.
      try {
        window.dispatchEvent(new Event(NOTIFICATION_PERMISSION_CHANGED_EVENT));
      } catch {
        // 신호를 못 보내도 저쪽이 다음 주기에 스스로 알아챈다.
      }
    }
  }

  /**
   * 🔴 알림을 실제로 한 번 띄워 보고 결과를 화면에 적는다.
   *
   * 실제로 띄우는 일은 BrowserNotifications.tsx가 한다 — 브라우저 알림 API를
   * 부르는 자리는 그 파일 하나라는 규칙을 여기서도 지킨다. 그쪽은 던지지 않고
   * **까닭을 돌려주므로**, 이 화면이 그것을 그대로 적을 수 있다.
   */
  async function handleNotificationSelfTest() {
    setSelfTestResult("알림을 띄우는 중…");
    const outcome = await showBrowserNotificationToast(buildNotificationSelfTestToast());
    setSelfTestResult(describeNotificationToastOutcome(outcome));
  }

  return (
    <SharedNotificationBell
      items={toNotificationBellItems(visibleItems)}
      count={count}
      // 🔴 `ml-auto shrink-0` 은 묶음 종에 **그대로** 건넨다. TopBar 에 래퍼를
      //    하나 더 두면 펼침 패널의 기준(position: relative)이 두 겹이 된다
      //    (TopBar.tsx 의 그 자리 주석). shrink-0 이 빠지면 좁은 폭에서 아이콘이
      //    깎여 손가락에 안 잡힌다 — 그 선은 service-menu-bar.test.ts 가 지킨다.
      className="ml-auto shrink-0"
      // 🔴 colorScheme 은 넘기지 않는다. 기본값 "host" 가 사이트를 따라가는데,
      //    A/S 의 다크는 <html class="dark"> 라 그것이 정확히 맞는 값이다.
      //
      // 🔴 알림이 0건이어도 종을 그린다 — 묶음의 기본값(그리지 않음)과 다르다.
      //    머리말의 아이콘 자리가 들쭉날쭉하면 안 되고, 아래 footer 는 알림이
      //    없을 때도 보여야 한다(권한 안내가 바로 그 자리다).
      showWhenEmpty
      emptyLabel={EMPTY_LABEL}
      onOpen={() => announceNotificationPanelOpened(window)}
      // 🔴 묶음은 **모든 줄에서** 이것을 부른다. 가리는 일은 A/S 가 한다.
      onAcknowledge={(picked: NotificationBellItem) =>
        handleNotificationPicked(picked, {
          onAcknowledge: acknowledge ? handleAcknowledge : undefined,
        })
      }
      footer={
        <NotificationBellFooter
          status={notificationStatus}
          onAsk={() => void handleAskForNotificationPermission()}
          onTest={() => void handleNotificationSelfTest()}
          selfTestResult={selfTestResult}
        />
      }
    />
  );
}
