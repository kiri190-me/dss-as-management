import type { RequestedDueDateLinkOutcome } from "@/lib/domain/requested-due-date-link";
import type { DeliveredDateLinkOutcome } from "@/lib/domain/delivered-date-link";

/**
 * ============================================================================
 * 🔴 「저장은 됐는데 수리 건이 못 따라갔다」를 **하나도 흘리지 않고** 모은다
 * ============================================================================
 * 내자 정리의 한 저장이 묶는 칸이 **둘**이다 — 납기요청일 ↔ 고객 요청 납기일
 * (2026-10-30), 납품일 ↔ 실제 출하일(2026-11-08). 한 저장이 둘 다 고칠 수 있고,
 * **둘 다 못 따라갈 수도 있다.**
 *
 * 🔴 그때 하나만 띄우면 나머지 하나는 조용히 사라진다. 사람이 보고 있는 화면은
 * 「저장했습니다」만 떠 있고 반대쪽은 옛 값 그대로인데, 다음에 그 화면을 열면
 * 자기가 고친 적 없는 날짜가 거기 있다 — 두 도메인 파일이 똑같이 못 박아 둔 그
 * 상황이다(「linked: false 를 조용히 버리지 마라」).
 *
 * 그래서 띄우는 쪽은 **이 함수가 모아 준 글 전부**를 받는다. 저장하는 자리가
 * 셋이라(납기요청일 칸 · 납품 칸 · `줄 수정` 폼) 각자 모으면 한 곳이 하나를
 * 빠뜨리고, 그 증상은 「어느 화면에서 고쳤느냐에 따라 알림이 오기도 안 오기도
 * 한다」가 된다.
 *
 * 🔵 **차례는 납기요청일 → 납품일**이다. 화면의 칸 차례와 같다(발주 묶음이 먼저,
 * 납품 묶음이 나중) — 알림에 적힌 차례가 화면의 차례와 다르면 어느 칸 이야기인지
 * 한 번 더 찾아야 한다.
 * ============================================================================
 */
export function domesticOrderLinkNotices(result: {
  requestedDueDateLink?: RequestedDueDateLinkOutcome;
  deliveredDateLink?: DeliveredDateLinkOutcome;
}): string[] {
  const notices: string[] = [];
  const due = result.requestedDueDateLink;
  if (due && !due.linked) notices.push(due.message);
  const delivered = result.deliveredDateLink;
  if (delivered && !delivered.linked) notices.push(delivered.message);
  return notices;
}

/**
 * 모은 글 여럿을 알림 상자 하나에 담을 **한 덩어리**로. 빈 줄 하나로 띄운다 —
 * 두 문장이 붙어 버리면 한 사실처럼 읽힌다.
 *
 * 🔵 담을 것이 없으면 null 이고, 그때 부르는 쪽은 평소의 저장 팝업을 띄운다.
 */
export function domesticOrderLinkNoticeText(notices: readonly string[]): string | null {
  if (notices.length === 0) return null;
  return notices.join("\n\n");
}
