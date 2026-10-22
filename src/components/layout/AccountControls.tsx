"use client";

import ThemeToggle from "./ThemeToggle";

/**
 * ============================================================================
 * 계정 묶음 — 사용자 이름·역할 · 테마 · 「통합 로그인으로」· 「로그아웃」
 * ============================================================================
 * 이 넷은 **한 조각**이다. 그릴 자리가 둘(넓은 화면의 머리말 오른쪽 끝 ·
 * 폰의 ☰ 서랍 바닥)이지만, 마크업을 두 벌로 베껴 적지 않는다.
 *
 * 🔴 베껴 적으면 안 되는 까닭: 여기 달린 것은 **누가 무엇을 보는가**이기도
 * 하다(사용자 이름과 역할 이름, 포털 주소가 없으면 링크를 아예 안 그리는 규칙).
 * 두 벌이 되면 한쪽만 고쳐지고, 그 어긋남은 **아무 오류도 내지 않는다** —
 * 폰에서만, 혹은 컴퓨터에서만 다르게 보이고 신고로만 드러난다. 같은 함정으로
 * 모바일 드로어가 접근 권한 설정을 통째로 무시하던 일이 실제로 있었다
 * (2026-08-31, AppShell.tsx 의 accessibleAreaKeys 주석).
 *
 * 🔵 그래서 variant 가 정하는 것은 **그리는 모습뿐**이다 — 가로줄이냐 세로줄이냐,
 * 어느 폭에서 보이느냐. 무엇을 그리는지, 무엇을 적는지, 어떤 차례인지는
 * 두 자리가 완전히 같다.
 *
 * ── 2026-10-22 — 넷이 폰에서 머리말을 떠나 ☰ 서랍으로 내려갔다 ─────────────
 * 사내 시스템 넷(재고관리 · 휴가 관리 · 계측기 · PO/내자)이 같은 날 전부 그
 * 모양이 됐고, A/S 만 머리말에 넷이 남아 폰에서 두 줄이었다. 자세한 경위와
 * 폭 계산은 TopBar.tsx 의 같은 날짜 주석에 있다.
 * ============================================================================
 */

/**
 * 「통합 로그인으로」와 「로그아웃」이 **같은 상자**로 보이게 하는 생김새.
 *
 * 🔴 한 상수인 까닭: 둘은 나란히 서는 단추라, 테두리·여백·글자 크기가 한쪽만
 * 바뀌면 크기가 다른 상자 둘이 붙어 선 것처럼 보인다. 테마 고르개가 compact
 * 모양에서 테두리를 두지 않는 것도 같은 까닭이다(ThemeToggle.tsx 의 주석).
 */
const CONTROL_BUTTON =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs whitespace-nowrap text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/**
 * 묶음 자신의 모양.
 *
 * `header` 🔴 **768px 미만에서는 아예 보이지 않는다**(`hidden md:flex`). 폰에서
 *          머리말에 남는 것은 ☰ · 시스템 이름 · 시스템 오가기 단추 · 알림종
 *          넷뿐이고(2026-10-22 쓰는 분 결정), 이 묶음은 같은 폭에서 ☰ 서랍
 *          안의 `drawer` 쪽이 대신 그린다. 🔴 `hidden` 이라 폰에서는 낭독기에도
 *          잡히지 않는데, 그래도 되는 이유는 **서랍 안에 같은 것이 그대로
 *          있기** 때문이다 — 서랍 쪽을 지우면 폰에서 로그아웃에 닿을 길이
 *          통째로 사라진다. 그 둘을 함께 못 박는 시험이
 *          header-account-cluster.test.ts 다.
 *          `flex-wrap` 은 안전망이다: 768~900px 구간에서 머리말이 두 줄이 될
 *          수 있는데, 글꼴이 큰 기기에서 그래도 모자라면 이 묶음이 제 안에서
 *          줄을 바꿀 뿐 가로로 넘치지 않는다.
 *
 * `drawer` 서랍 바닥에 세로로 선다. 🔴 `mt-auto` 를 쓰지 않는다 —
 *          margin-top:auto 는 남는 자리가 있을 때만 내려 주고 메뉴가 서랍보다
 *          길어지는 순간 0 으로 풀려, 구분선 위 간격이 **가장 필요한 때**
 *          사라진다(재고관리 6fe1db5 가 같은 함정에 빠졌다가 빈 칸막이로
 *          고쳤다). 여기는 칸막이조차 필요 없다: 바로 위 형제인 Sidebar 가
 *          이미 `flex-1 min-h-0` 이라 남는 자리를 전부 가져가고(메뉴가 길면
 *          그 안의 nav 가 스스로 구른다), 이 묶음은 제 높이만큼 바닥에 남는다.
 *          `shrink-0` 은 그 바닥 자리를 어떤 높이에서도 내주지 않기 위한 것이다.
 */
const WRAPPER: Record<AccountControlsVariant, string> = {
  header: "hidden flex-wrap items-center gap-2 md:flex",
  drawer: "flex shrink-0 flex-col items-stretch gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800",
};

/**
 * 세로줄(서랍)에서는 단추가 칸 폭을 꽉 채우고 글자가 가운데에 선다 — 글자만
 * 한 작은 단추가 왼쪽에 붙어 있으면 서랍 안에서 누를 자리를 찾기 어렵다.
 * 가로줄(머리말)에서는 제 글자 폭 그대로다.
 *
 * 🔴 링크에 `block` 이 함께 붙는 까닭: `<a>` 는 inline 이라 그대로 두면 폭도
 * 가운데 정렬도 먹지 않는다. `<button>` 은 이미 inline-block 이라 `w-full`
 * 하나로 충분하다.
 */
const LINK_FILL: Record<AccountControlsVariant, string> = {
  header: "",
  drawer: " block w-full text-center",
};
const BUTTON_FILL: Record<AccountControlsVariant, string> = {
  header: "",
  drawer: " w-full",
};

type AccountControlsVariant = "header" | "drawer";

type AccountControlsProps = {
  /**
   * 지금 로그인한 사람. 「이름님 · 역할」로 적는다.
   *
   * 🔴 필수다. 선택 인자가 되면 **로그아웃이 안 보이는 껍데기**가 조용히
   * 그려질 수 있다 — AppShell 과 TopBar 가 같은 까닭으로 물음표를 붙이지
   * 않는다(그 파일들의 prop 주석).
   */
  user: { name: string; roleLabel: string };
  /**
   * 통합 로그인(dss-auth) 앱 목록 주소. null 이면(데모 모드) 「통합 로그인으로」를
   * 아예 그리지 않는다 — 갈 곳이 없는 링크는 눌러도 아무 일이 없다.
   *
   * 이 시스템 **밖으로** 나가는 주소라 next/link 가 아니라 평범한 `<a>` 다.
   */
  portalUrl?: string | null;
  /** 그릴 자리 — 넓은 화면의 머리말 오른쪽 끝인가, 폰 ☰ 서랍의 바닥인가. */
  variant: AccountControlsVariant;
};

export default function AccountControls({ user, portalUrl = null, variant }: AccountControlsProps) {
  return (
    <div className={WRAPPER[variant]}>
      {/*
        누구로 로그인했는지. 🔴 2026-10-22 까지 여기에 「폰에서는 감춘다」가
        걸려 있었다(`hidden md:inline`). 그 까닭은 오직 자리였다 — 머리말 한
        줄에서 ~115px 을 되찾아야 나머지 셋이 섰다. 지금은 묶음 **자체**가
        폰에서 머리말에 서지 않고 서랍 안에서는 자리가 넉넉하므로, 그 조건이
        사라졌다. 넓은 화면에서 보이는 모습은 한 톨도 달라지지 않는다
        (flex 자식이라 inline 도 block 으로 평평해진다 — md 이상에서 쓰던
        `md:inline` 은 애초에 아무 일도 하지 않고 있었다).

        길이를 가두는 두 낱말은 그대로 둔다: 이름이 길어도 이 줄(머리말)을
        밀어내지 않고 … 로 끊겨야 한다.
      */}
      <span
        title={`${user.name}님 · ${user.roleLabel}`}
        className="max-w-[12rem] truncate text-xs text-zinc-600 dark:text-zinc-400"
      >
        {user.name}님 · {user.roleLabel}
      </span>
      {/*
        테마. 아이콘 셋(밝게 · 어둡게 · 시스템 설정)이고, 고른 것은
        `aria-pressed` 와 배경색으로 알린다.

        🔵 서랍에서도 **같은 compact 모양**이다. 서랍 안쪽 폭이 232px 이라
        글자 모양(~190px)도 들어가기는 하지만, 이 조각이 하는 일은
        **자리를 옮기는 것**이지 생김새를 바꾸는 것이 아니다 — 모양까지
        갈리면 「폰에서만 다르게 보인다」가 또 하나 생긴다.
      */}
      <ThemeToggle compact />
      {portalUrl && (
        <a href={portalUrl} className={`${CONTROL_BUTTON}${LINK_FILL[variant]}`}>
          {/*
            🔴 2026-10-22 까지 이 자리에는 글자가 **둘**이었다: 폰에서 보일
            짧은 말(「포털」)과, 낭독기를 위해 숨겨 둔 긴 이름. 긴 이름이
            ~106px 이라 폰 머리말 한 줄에 들어가지 않아서였다.

            그 까닭이 사라졌다. 머리말 쪽(header)은 **768px 이상에서만**
            그려지는데 그 폭에서는 예전에도 긴 이름이 보였고, 폰에서 그리는
            쪽(drawer)은 안쪽 폭이 232px 이라 긴 이름이 그대로 선다. 그래서
            짧은 말과 숨긴 글자를 **둘 다 걷어내고 하나로** 돌렸다 —
            눈으로 읽는 사람과 낭독기가 같은 말을 듣는다.
            🔵 재고관리의 서랍도 같은 자리에서 긴 이름을 그대로 쓴다.
          */}
          통합 로그인으로
        </a>
      )}
      {/*
        🔴 로그아웃은 **<form> 의 POST** 다. 링크로 바꾸지 마라 — 까닭은
        @dss/ui 의 ServiceMenuBar.tsx:36 머리말과 이 저장소의
        api/auth/logout/route.ts 에 적혀 있다(GET 으로 열 수 있는 로그아웃은
        남의 페이지에 심은 <img> 로도 눌린다).

        🔴 그리고 이 말은 **짧게 줄이지 않는다.** 누르면 통합 로그인까지
        포함해 모든 시스템에서 나가므로 그 말만은 온전해야 한다(계측기도
        재고관리도 같은 선을 긋는다).
      */}
      <form action="/api/auth/logout" method="post">
        <button type="submit" className={`${CONTROL_BUTTON}${BUTTON_FILL[variant]}`}>
          로그아웃
        </button>
      </form>
    </div>
  );
}
