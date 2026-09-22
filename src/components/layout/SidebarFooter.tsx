"use client";

type SidebarFooterProps = {
  /**
   * **모양만** 정한다 — 좁은 아이콘 세로줄로 그릴지(true), 넓은 모양으로
   * 그릴지(false). "지금 사이드바가 눈에 보이는가"를 따르므로, 마우스
   * 머무름으로 펼쳐진 동안에도 false(= 넓은 모양)다. ☰ 옆 글자를 **그릴지
   * 말지**도 이 값이 정한다(내용은 isPinnedOpen 이 정한다).
   *
   * ☰ 의 말과는 무관하다. 왜 갈랐는지는 아래 파일 주석 참조.
   */
  isCompact: boolean;
  /**
   * ☰ 가 실제로 뒤집는 것 — **고정 펼침(pin)이 지금 켜져 있는가**. ☰ 의
   * 라벨 · title · aria-expanded · 옆 글자의 **내용**만 이 값을 본다(글자를
   * 그릴지 말지는 isCompact 다). 모양과 갈린 이유는 아래 파일 주석 참조.
   *
   * 기본값 true = "펼쳐져 고정된 상태". 이 prop 을 넘기지 않는 호출부(모바일
   * 드로어)는 늘 펼쳐져 있고 접는 개념이 없으므로 그쪽이 맞는 기본값이다 —
   * false 로 두면 폰에서 ☰ 의 말이 뒤집힌다.
   */
  isPinnedOpen?: boolean;
  /**
   * Omitted for the mobile drawer (which has no collapse concept of its own
   * — it's already always "expanded" and closes via its own backdrop/close
   * button).
   *
   * 🔴 2026-09-22 부터 이 조각에 남은 것이 ☰ 한 줄뿐이라, 이것을 넘기지
   * 않는 호출부에서는 **아무것도 그리지 않는다**(null). 아래 파일 주석 참조.
   */
  onToggleCollapsed?: () => void;
};

/**
 * 사이드바(데스크톱 <aside> · 모바일 드로어) 맨 아래 — 지금은 **☰ 접기/펼치기
 * 한 줄뿐이다.**
 *
 * ════════════════════════════════════════════════════════════════════════
 * 🔴 2026-09-22 — 여기 있던 넷이 머리말로 올라갔다
 * ════════════════════════════════════════════════════════════════════════
 * 사용자 정보(이름 · 역할) · 테마(밝게 · 어둡게 · 시스템 설정) ·
 * 「통합 로그인으로」 · 「로그아웃」 넷이 **머리말 오른쪽 끝**(TopBar.tsx)으로
 * 옮겨 갔다 — 다른 사내 시스템들(PO 3600 · 계측기 3200)이 전부 그 자리에
 * 두고 있어서 같은 자리로 모으라는 사용자 지시였고, 사이드바 아래는
 * **비우는 쪽**으로 사용자가 정했다.
 *
 * 🔴 **그 넷을 여기로 되돌리지 마라.** 되돌리면 같은 것이 머리말과 사이드바
 * 두 곳에 생긴다(로그아웃 단추가 둘이 되는 것은 그 자체로 결함이다). 머리말
 * 쪽이 폰에서 넘치는 것이 걱정이라면 TopBar.tsx 의 2026-09-22 주석에 폭을
 * 지키는 장치 넷과 실측값이 적혀 있다 — 그것을 고치는 것이 맞는 자리다.
 *
 * 그래서 이 조각은 `onToggleCollapsed` 를 받지 못하면 **null 을 돌려준다.**
 * 그 값을 넘기지 않는 호출부는 모바일 드로어 하나이고(드로어에는 접는 개념이
 * 없다), 예전에는 그 드로어에도 이 아래쪽에 넷이 그려져 있었다. 지금 그
 * 자리에 남을 것은 아무것도 없으므로 **위 구분선(border-t)과 여백까지 함께**
 * 사라져야 한다 — 남기면 드로어 맨 아래에 까닭 없는 회색 선 한 줄과 빈 칸이
 * 남는다.
 *
 * ── 값이 **둘**인 이유 (`isCompact` vs `isPinnedOpen`) ─────────────────
 * 한때 이 둘은 `isCollapsed` 하나였다. 서로 다른 질문이라 갈랐다. 다시
 * 합치지 마라 — 합치면 아래 둘 중 하나가 반드시 깨진다.
 *
 *  - `isCompact` = "지금 사이드바가 눈에 안 보이는가" → **모양**을 정한다
 *    (☰ 행의 정렬, ☰ 옆 글자의 유무). 사이드바는 마우스를 올리거나 초점이
 *    들어오면 폭이 늘어 펼쳐지는데, 그때 메뉴는 넓게 그려지므로 이 줄도
 *    같이 넓어야 한다. 안 그러면 펼쳐진 사이드바의 아래쪽만 아이콘
 *    하나로 남는다.
 *
 *  - `isPinnedOpen` = "☰ 로 **고정 펼침**이 켜져 있는가" → ☰ 의 **말**을
 *    정한다(라벨 · title · aria-expanded · 옆 글자의 **내용**). 단추의 말은
 *    그 단추가 실제로 뒤집는 것을 가리켜야 하는데, ☰ 가 뒤집는 것은
 *    "보이는가"가 아니라 "고정인가"다.
 *
 * 왜 ☰ 만 고정 여부를 따르는가: ☰ 를 누르려면 마우스를 사이드바로
 * 가져가야 하고, 그 순간 이미 머무름으로 펼쳐져 있다. 여기에 "지금
 * 보이는가"(= isCompact)를 넘기면 ☰ 가 늘 `사이드바 접기` 라고 적힌 채로
 * 눌리고, 눌리면 오히려 펼쳐 고정되어 본문이 오른쪽으로 밀린다 — 적힌
 * 말과 정반대로 움직인다. aria-expanded 도 같은 이유로 고정 여부를 따른다.
 */
export default function SidebarFooter({ isCompact, isPinnedOpen = true, onToggleCollapsed }: SidebarFooterProps) {
  // 🔴 그릴 것이 ☰ 뿐이라, 그 단추가 없는 호출부(모바일 드로어)에서는 이
  // 조각 자체가 사라진다 — 구분선도 여백도 남기지 않는다(위 파일 주석).
  if (!onToggleCollapsed) {
    return null;
  }

  return (
    <div className={`flex flex-col border-t border-zinc-200 dark:border-zinc-800 ${isCompact ? "p-2" : "p-3"}`}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={isPinnedOpen ? "사이드바 접기" : "사이드바 펼치기"}
        aria-label={isPinnedOpen ? "사이드바 접기" : "사이드바 펼치기"}
        aria-expanded={isPinnedOpen}
        className={`flex items-center rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 ${isCompact ? "justify-center" : "gap-2"}`}
      >
        <span aria-hidden="true">☰</span>
        {/* 글자의 **존재**는 모양(isCompact)을, 글자의 **내용**은 고정
            여부(isPinnedOpen)를 따른다. 좁은 세로줄에서는 글자를 놓을 폭이
            없어 아이콘 하나로 그린다(그때도 title/aria-label 로 같은 말이
            남는다). */}
        {!isCompact && <span className="text-xs">{isPinnedOpen ? "사이드바 접기" : "사이드바 펼치기"}</span>}
      </button>
    </div>
  );
}
