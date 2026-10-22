import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 계정 묶음 — 사용자 · 테마 · 「통합 로그인으로」· 「로그아웃」이 **어디 있는가**
 * ============================================================================
 * 2026-09-22: 이 넷이 사이드바 맨 아래에서 **머리말 오른쪽 끝으로** 올라왔다.
 * 다른 사내 시스템들(PO 3600 · 계측기 3200)이 전부 그 자리에 두고 있어서 같은
 * 자리로 모으라는 사용자 지시였다. 이 파일은 그때 「넷이 머리말에 있다 + 폰에서
 * 폭을 줄이는 장치가 그대로 있다」를 못 박으려고 생겼다.
 *
 * ── 🔴 2026-10-22 — 그 결정이 **폰에서만** 뒤집혔다 ─────────────────────────
 * 같은 날 다른 시스템 **넷**(재고관리 · 휴가 관리 · 계측기 · PO/내자)이 전부
 * 폰에서 이 넷을 ☰ 서랍으로 내렸고, A/S 만 머리말에 남아 폰에서 두 줄이었다.
 * 그래서 쓰는 분이 같은 기준(「다른 시스템들과 같은 모양」)으로 **반대**를
 * 지시했다 — 768px 미만에서 머리말에 남는 것은 ☰ · 시스템 이름 · 시스템
 * 오가기 단추 · 알림종 넷뿐이고, 계정 넷은 ☰ 서랍 바닥으로 내려간다.
 * 넓은 화면(768px 이상)은 한 글자도 달라지지 않았다.
 *
 * 🔴 **그래서 이 파일이 재는 것이 바뀌었다 — 약하게 만든 것이 아니다.**
 *  · 전에는 「넷이 머리말에 있다」 하나였다.
 *  · 지금은 **「좁은 화면의 머리말에는 없다」와 「☰ 서랍 안에는 있다」 둘**이다.
 * 🔴 둘을 **반드시 함께** 못 박는다. 하나만 재면 「감춘 것」과 「옮긴 것」이
 * 구별되지 않아, 나중에 서랍 쪽을 지워 **폰에서 로그아웃에 닿을 길이 아예
 * 없어져도** 이 파일이 초록으로 통과한다.
 *
 * 🔴 그리고 넷을 그리는 마크업은 **한 조각**이다(AccountControls.tsx). 두 벌로
 * 베끼면 「누구의 이름을 적는가 · 포털 주소가 없으면 어떻게 하는가」가 갈리는데
 * **아무 오류도 나지 않는다** — 폰에서만, 혹은 컴퓨터에서만 다르게 보인다.
 *
 * 폭 계산과 실측값은 TopBar.tsx 의 2026-10-22 주석에 다시 적었다(2026-09-22 의
 * 두 줄 · 97px 셈은 그 자리에서 거짓이 되어 함께 고쳤다).
 *
 * 화면을 렌더해도 미디어 쿼리는 풀리지 않으므로, 이 저장소의 관행대로 **원본을
 * 글자로 읽어** 못 박는다(service-menu-bar.test.ts 가 같은 머리말의 다른 면을
 * 같은 방식으로 지킨다).
 * ============================================================================
 */

const repoFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석 안의 말을 걷어낸다. 🔴 이 파일에는 **없어야 한다**는 단언이 많고
 * (머리말·사이드바가 그 넷을 더 이상 **직접** 그리지 않는다), 이 저장소의
 * 주석은 길어서 「로그아웃」· 「통합 로그인으로」같은 낱말이 주석에만 남아도 그
 * 단언이 조용히 통과하거나 조용히 실패한다.
 */
const withoutComments = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const accountControls = withoutComments(repoFile("src/components/layout/AccountControls.tsx"));
const topBar = withoutComments(repoFile("src/components/layout/TopBar.tsx"));
const sidebarFooter = withoutComments(repoFile("src/components/layout/SidebarFooter.tsx"));
const sidebar = withoutComments(repoFile("src/components/layout/Sidebar.tsx"));
const appShell = withoutComments(repoFile("src/components/layout/AppShell.tsx"));
const themeToggle = withoutComments(repoFile("src/components/layout/ThemeToggle.tsx"));

/** 머리말 오른쪽 묶음의 마크업만 — 메뉴바 뒤부터 </header> 까지. */
const headerCluster = topBar.slice(topBar.indexOf("{serviceMenu}"), topBar.indexOf("</header>"));

/** 모바일 드로어의 마크업만 — 그 조건부 블록부터 <main> 앞까지. */
const mobileDrawer = appShell.slice(appShell.indexOf("{mobileNavOpen && ("), appShell.indexOf("<main"));

/**
 * AccountControls 가 variant 마다 쓰는 **바깥 상자** 클래스.
 *
 * 🔴 `const WRAPPER` 부터 찾는다 — 같은 파일에 variant 로 갈리는 표가 더 있어서
 * (단추를 칸 폭에 맞추는 것들), 이름 없이 찾으면 엉뚱한 표를 읽고도 통과한다.
 */
function wrapperClasses(variant: "header" | "drawer"): string[] {
  const found = accountControls.match(new RegExp(`const WRAPPER[\\s\\S]*?\\b${variant}: "([^"]*)"`));
  assert.ok(found, `AccountControls 의 ${variant} 모양 클래스를 찾지 못했다`);
  return found[1].split(/\s+/);
}

describe("㉠ 넷은 **한 조각**이다 — 머리말과 서랍이 같은 것을 쓴다", () => {
  test("AccountControls 가 사용자 · 테마 · 「통합 로그인으로」· 「로그아웃」을 그린다", () => {
    assert.match(accountControls, /\{user\.name\}님 · \{user\.roleLabel\}/, "사용자 이름·역할을 적지 않는다");
    assert.match(accountControls, /<ThemeToggle compact \/>/, "테마 고르개가 없다");
    assert.match(accountControls, /통합 로그인으로/, "통합 로그인 링크가 없다");
    assert.match(accountControls, /로그아웃/, "로그아웃이 없다");
    // 링크가 실제로 포털 주소를 쓴다 — 갈 곳이 없으면(데모 모드) 아예 그리지 않는다.
    assert.match(accountControls, /\{portalUrl && \(/, "포털 주소가 없을 때도 링크를 그린다");
    assert.match(accountControls, /href=\{portalUrl\}/, "링크가 포털 주소를 쓰지 않는다");
    // 🔴 user 는 필수다. 선택 인자가 되면 「로그아웃이 안 보이는 껍데기」가
    // 조용히 그려질 수 있다(AppShell · TopBar 가 같은 선을 긋는다).
    assert.match(accountControls, /user: \{ name: string; roleLabel: string \};/, "사용자를 받지 않는다");
    assert.ok(!/user\?:/.test(accountControls), "user 가 선택 인자다 — 로그아웃 없는 껍데기가 조용히 그려질 수 있다");
    assert.match(topBar, /user: \{ name: string; roleLabel: string \};/, "TopBar 가 사용자를 받지 않는다");
    assert.ok(!/user\?:/.test(topBar), "TopBar 의 user 가 선택 인자다");
  });

  test("🔴 그 마크업이 **다른 어디에도 없다** — 두 벌이 되면 한쪽만 고쳐진다", () => {
    // 갈리면 폰과 컴퓨터가 서로 다른 것을 그리는데 **아무 오류도 나지 않는다.**
    // 같은 함정으로 모바일 드로어가 접근 권한 설정을 통째로 무시하던 일이
    // 실제로 있었다(2026-08-31, AppShell.tsx 의 accessibleAreaKeys 주석).
    for (const [name, source] of [
      ["TopBar", topBar],
      ["AppShell", appShell],
      ["Sidebar", sidebar],
      ["SidebarFooter", sidebarFooter],
    ] as const) {
      for (const gone of ["/api/auth/logout", "통합 로그인으로", "<ThemeToggle", "user.name"]) {
        assert.ok(!source.includes(gone), `${name} 이 ${gone} 을 직접 그린다 — AccountControls 와 두 벌이 된다`);
      }
    }
    assert.equal(
      [...accountControls.matchAll(/\/api\/auth\/logout/g)].length,
      1,
      "AccountControls 안에서 로그아웃을 두 번 그린다"
    );
  });

  test("머리말과 서랍이 둘 다 그 조각을 부른다 — 같은 user · portalUrl 로", () => {
    assert.match(topBar, /import AccountControls from "\.\/AccountControls";/, "머리말이 그 조각을 가져오지 않는다");
    assert.match(appShell, /import AccountControls from "\.\/AccountControls";/, "AppShell 이 그 조각을 가져오지 않는다");
    assert.match(
      headerCluster,
      /<AccountControls variant="header" user=\{user\} portalUrl=\{portalUrl\} \/>/,
      "머리말이 계정 묶음을 그리지 않거나 다른 값을 넘긴다"
    );
    assert.match(
      mobileDrawer,
      /<AccountControls variant="drawer" user=\{user\} portalUrl=\{portalUrl\} \/>/,
      "☰ 서랍이 계정 묶음을 그리지 않거나 다른 값을 넘긴다"
    );
    // AppShell 은 같은 값을 머리말에도 넘긴다 — 사이드바가 아니라.
    const topBarCall = appShell.slice(appShell.indexOf("<TopBar"), appShell.indexOf("/>", appShell.indexOf("<TopBar")));
    assert.match(topBarCall, /user=\{user\}/, "머리말에 사용자를 넘기지 않는다");
    assert.match(topBarCall, /portalUrl=\{portalUrl\}/, "머리말에 포털 주소를 넘기지 않는다");
    assert.equal([...sidebar.matchAll(/portalUrl/g)].length, 0, "Sidebar 가 아직 포털 주소를 받는다");
    assert.equal([...sidebar.matchAll(/\buser\b/g)].length, 0, "Sidebar 가 아직 사용자를 받는다");
  });
});

describe("㉡ 🔴 좁은 화면 — 머리말에는 **없고** ☰ 서랍에는 **있다** (둘이 짝이다)", () => {
  test("🔴 머리말 쪽은 768px 미만에서 사라진다", () => {
    const classes = wrapperClasses("header");
    assert.ok(
      classes.includes("hidden"),
      "폰 머리말에 계정 넷이 그대로 남는다 — 2026-10-22 에 내리기로 한 바로 그것이다"
    );
    assert.ok(
      classes.includes("md:flex"),
      "넓은 화면에서도 안 보인다 — 768px 이상은 한 글자도 달라지면 안 된다"
    );
  });

  test("🔴 그리고 **같은 넷이 ☰ 서랍 안에 실제로 있다** — 감춘 것이 아니라 옮긴 것이다", () => {
    // 🔴 이 단언이 위와 짝이다. 위 하나만 재면, 서랍 쪽을 지워 **폰에서
    // 로그아웃·테마·포털에 닿을 길이 통째로 없어져도** 초록으로 통과한다.
    const drawerAt = mobileDrawer.indexOf("<AccountControls");
    assert.ok(drawerAt > 0, "☰ 서랍에 계정 묶음이 없다 — 폰에서 로그아웃에 닿을 길이 사라졌다");
    // 그 서랍은 폰 전용이다(넓은 화면에서는 통째로 그려지지 않는다).
    assert.match(mobileDrawer, /fixed inset-0 z-40 flex md:hidden print:hidden/, "서랍이 폰 전용이 아니다");
    // 메뉴 **다음**, 서랍 바닥이다.
    assert.ok(
      mobileDrawer.indexOf("<Sidebar") < drawerAt,
      "계정 묶음이 메뉴보다 위에 있다 — 서랍 바닥이 그 자리다"
    );
    // 🔴 서랍 쪽 모양에는 `hidden` 이 없다 — 있으면 「서랍에 있다」가 거짓이 된다.
    const classes = wrapperClasses("drawer");
    assert.ok(!classes.includes("hidden"), "서랍 안에서도 감춰 둔다 — 마크업만 있고 보이지는 않는다");
    assert.ok(classes.includes("flex"), "서랍 쪽 묶음이 flex 가 아니다 — 세로로 서지 않는다");
    assert.ok(classes.includes("flex-col"), "서랍 안에서 가로로 늘어선다 — 256px 폭에서 넘친다");
  });

  test("🔴 폰 머리말에 남는 것은 넷뿐 — ☰ · 시스템 이름 · 시스템 오가기 · 알림종", () => {
    // ☰ 는 맨 왼쪽, 폰 전용.
    const hamburger = topBar.match(/aria-label="메뉴 열기"[\s\S]{0,400}?className="([^"]*)"/);
    assert.ok(hamburger, "☰ 를 찾지 못했다");
    assert.ok(hamburger[1].split(/\s+/).includes("md:hidden"), "☰ 가 넓은 화면에도 남는다");
    assert.ok(topBar.indexOf("메뉴 열기") < topBar.indexOf("DSS A/S 관리 시스템"), "☰ 가 시스템 이름보다 뒤에 있다");
    // 시스템 이름은 폰에서도 보인다(감추지 않는다).
    const nameSpan = topBar.match(/<span className="([^"]*)">\s*DSS A\/S 관리 시스템\s*<\/span>/);
    assert.ok(nameSpan, "머리말에서 시스템 이름을 그리는 <span> 을 찾지 못했다");
    for (const hiding of ["hidden", "sr-only"]) {
      assert.ok(!nameSpan[1].split(/\s+/).includes(hiding), `폰에서 시스템 이름을 감춘다(${hiding})`);
    }
    // 시스템 오가기 단추와 알림종.
    assert.match(topBar, /<div className="shrink-0">\{serviceMenu\}<\/div>/, "시스템 오가기 자리가 없다");
    assert.match(headerCluster, /<NotificationBell /, "머리말에 알림종이 없다");
  });

  test("🔴 오른쪽 묶음이 폰에서 **제 줄을 통째로 갖지 않는다** — 종이 둘째 줄로 내려간다", () => {
    // 2026-09-22 에는 그 장치(`w-full sm:w-auto`)가 옳았다. 그 줄에 글자 넷이
    // 함께 서 있었기 때문이다. 지금 그 줄에 남은 것은 **알림종 하나**라,
    // 폭이 100% 면 종 혼자 둘째 줄로 내려가 머리말이 여전히 두 줄이 된다 —
    // 내리기로 한 까닭이 그대로 되살아난다.
    const clusterOpen = headerCluster.match(/<div className="([^"]*)"/);
    assert.ok(clusterOpen, "오른쪽 묶음(<div>)이 없다");
    const classes = clusterOpen[1].split(/\s+/);
    for (const gone of ["w-full", "sm:w-auto"]) {
      assert.ok(!classes.includes(gone), `오른쪽 묶음에 ${gone} 가 남아 있다 — 폰에서 알림종이 제 줄로 내려간다`);
    }
    // 종은 여전히 줄의 **오른쪽 끝**이다 — 펼침 패널이 종에 오른쪽 끝을 맞춰
    // 왼쪽으로 펼쳐지므로(폭 min(20rem, 100vw-2rem)) 종이 가운데면 패널 왼쪽이
    // 화면 밖으로 잘린다.
    assert.ok(classes.includes("ml-auto"), "오른쪽 묶음이 줄 끝에 붙지 않는다");
    assert.match(
      headerCluster,
      /<NotificationBell [^>]*\/>\s*<\/div>/,
      "종이 오른쪽 묶음의 맨 끝이 아니다 — 폰에서 펼침 패널 왼쪽이 잘린다"
    );
  });
});

describe("㉢ 넓은 화면(768px 이상)은 한 글자도 달라지지 않았다", () => {
  test("머리말 쪽은 여전히 가로 한 줄이고, 차례도 그대로다", () => {
    const classes = wrapperClasses("header");
    for (const needed of ["items-center", "gap-2", "flex-wrap"]) {
      assert.ok(classes.includes(needed), `머리말 쪽 묶음에 ${needed} 가 없다`);
    }
    assert.ok(!classes.includes("flex-col"), "넓은 화면에서 계정 넷이 세로로 쌓인다 — 머리말 높이가 깨진다");
    // 차례: 이름 → 테마 → 통합 로그인으로 → 로그아웃.
    const order = ["{user.name}님", "<ThemeToggle", "통합 로그인으로", "로그아웃"].map((needle) =>
      accountControls.indexOf(needle)
    );
    for (const at of order) assert.ok(at > 0, "계정 넷 중 하나를 찾지 못했다");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "계정 넷의 차례가 바뀌었다");

    // 바깥 묶음(종까지 포함)은 줄 끝에 붙고, 줄이 바뀌어도 오른쪽에 붙는다.
    const clusterOpen = headerCluster.match(/<div className="([^"]*)"/);
    assert.ok(clusterOpen, "오른쪽 묶음(<div>)이 없다");
    const clusterClasses = clusterOpen[1].split(/\s+/);
    for (const needed of ["ml-auto", "flex", "flex-wrap", "justify-end", "gap-2"]) {
      assert.ok(clusterClasses.includes(needed), `오른쪽 묶음에 ${needed} 가 없다`);
    }
    // 머리말 자신이 줄을 바꿀 수 있어야 한다 — 768~900px 구간에서 넷이 다시
    // 이 줄에 서는데, 거기서 줄을 바꾸는 것이 이 장치다. nowrap 이면 들어가지
    // 않는 만큼 화면 밖으로 밀리고, 밀려난 것은 손가락에 안 잡힌다.
    const header = topBar.match(/<header className="([^"]*)"/);
    assert.ok(header, "<header> 를 찾지 못했다");
    assert.ok(header[1].split(/\s+/).includes("flex-wrap"), "머리말이 nowrap 이다");
  });

  test("🔴 「통합 로그인으로」는 이제 **한 벌**이다 — 폰용 짧은 말과 숨긴 긴 이름이 함께 사라졌다", () => {
    // 2026-09-22~2026-10-22 에는 글자가 둘이었다: 폰에서 보일 「포털」과,
    // 낭독기를 위해 sr-only 로 숨겨 둔 긴 이름. 긴 이름이 ~106px 이라 폰
    // 머리말 한 줄에 들어가지 않아서였다. 🔴 그 까닭이 사라졌다 — 머리말 쪽은
    // 768px 이상에서만 그려지고(그 폭에서는 그때도 긴 이름이었다), 폰에서
    // 그리는 서랍은 안쪽 폭이 232px 이라 긴 이름이 그대로 선다. 그래서 눈으로
    // 읽는 사람과 낭독기가 **같은 말**을 듣게 하나로 돌렸다.
    assert.ok(!accountControls.includes("포털"), "폰용 짧은 말이 남아 있다 — 이제 보일 자리가 없다");
    assert.ok(
      !/sr-only/.test(accountControls),
      "낭독기용으로 숨긴 글자가 남아 있다 — 보이는 말과 읽히는 말이 둘로 갈린다"
    );
    assert.match(accountControls, />\s*통합 로그인으로\s*</, "링크의 말이 「통합 로그인으로」가 아니다");
  });

  test("🔴 「로그아웃」은 줄이지 않는다 — 그 말만은 온전해야 한다", () => {
    // 누르면 통합 로그인까지 포함해 모든 시스템에서 나간다. 짧게 줄이거나
    // 아이콘만 남기면 잘못 누른다(계측기 · 재고관리도 같은 선을 긋는다).
    const logoutButton = accountControls.match(/<button type="submit"[\s\S]*?<\/button>/);
    assert.ok(logoutButton, "로그아웃 단추를 찾지 못했다");
    assert.match(logoutButton[0], />\s*로그아웃\s*</, "로그아웃 단추의 말이 「로그아웃」이 아니다");
    assert.ok(
      !/md:hidden|sr-only/.test(logoutButton[0]),
      "로그아웃을 좁은 화면에서 줄이거나 감춘다 — 그 말만은 온전해야 한다"
    );
    assert.match(accountControls, /whitespace-nowrap/, "단추 글자가 좁은 폭에서 두 줄로 접힌다");
  });

  test("🔴 테마는 아이콘 한 줄이다 — 머리말에서도 서랍에서도 같은 모양", () => {
    // 글자 모양(밝게 · 어둡게 · 시스템 설정)은 ~190px 이라 머리말 한 줄에서
    // 다른 것들과 같이 서지 못한다. 서랍에서는 들어가기는 하지만, 자리를
    // 옮기는 조각이 생김새까지 바꾸면 「폰에서만 다르다」가 또 하나 생긴다.
    assert.equal(
      [...accountControls.matchAll(/<ThemeToggle compact \/>/g)].length,
      1,
      "테마를 두 번 그리거나 모양을 갈라 부른다"
    );
    // 🔴 그 compact 는 **가로 한 줄**이어야 한다. 2026-09-22 까지는 세로였고
    // (접힌 사이드바가 유일한 호출부였다), 세로면 아이콘 셋이 96px 높이가 되어
    // 56px 짜리 머리말을 깨뜨린다.
    const compactClasses = themeToggle.match(/className=\{compact \? "([^"]*)"/);
    assert.ok(compactClasses, "ThemeToggle 의 compact 모양 클래스를 찾지 못했다");
    assert.ok(
      !compactClasses[1].split(/\s+/).includes("flex-col"),
      "테마 아이콘이 세로로 쌓인다 — 머리말 높이가 96px 로 늘어난다"
    );
    // 고른 것이 무엇인지와 각 단추가 무엇인지는 모양과 무관하게 남는다.
    assert.match(themeToggle, /aria-pressed=\{mode === option\.mode\}/, "고른 테마를 알리지 않는다");
    assert.match(themeToggle, /aria-label=\{option\.label\}/, "테마 단추에 이름이 없다");
    assert.equal(
      [...themeToggle.matchAll(/mode: "(light|dark|system)"/g)].length,
      3,
      "테마가 셋(밝음 · 어둠 · 시스템)이 아니다"
    );
  });

  test("사용자 이름은 길어도 줄을 밀어내지 않는다 — … 로 끊긴다", () => {
    const nameSpan = accountControls.match(/<span\s+title=\{`\$\{user\.name\}님 · \$\{user\.roleLabel\}`\}\s+className="([^"]*)"/);
    assert.ok(nameSpan, "사용자 <span> 을 찾지 못했다");
    const classes = nameSpan[1].split(/\s+/);
    assert.ok(classes.includes("truncate"), "이름이 길면 이 줄을 밀어낸다 — … 로 끊겨야 한다");
    assert.ok(classes.some((name) => /^max-w-/.test(name)), "이름 폭에 상한이 없다 — truncate 가 걸릴 자리가 없다");
    // 🔴 2026-10-22 에 `hidden md:inline` 이 빠졌다. 폰에서 감추던 장치인데
    // 묶음 자체가 폰에서 안 보이므로 할 일이 없어졌고, 서랍에서는 **보여야**
    // 한다. 넓은 화면의 모습은 달라지지 않는다(flex 자식이라 inline 도 block
    // 으로 평평해진다 — 그 클래스는 애초에 아무 일도 하지 않고 있었다).
    assert.ok(!classes.includes("hidden"), "서랍 안에서도 이름을 감춘다 — 누구로 로그인했는지 알 길이 없다");
  });
});

describe("㉣ 로그아웃은 여전히 <form> 의 POST 다", () => {
  test("링크가 아니다 — GET 으로 열리는 로그아웃은 남의 페이지에서도 눌린다", () => {
    assert.match(
      accountControls,
      /<form action="\/api\/auth\/logout" method="post">/,
      "로그아웃이 <form> POST 가 아니다"
    );
    assert.match(accountControls, /<button type="submit"/, "로그아웃이 submit 단추가 아니다");
    // <a href="/api/auth/logout"> 로 바뀐 적이 없는지 — 그 모양이면 다른 사이트에
    // 심은 <img> 나 링크 미리보기만으로도 로그아웃된다.
    assert.ok(
      !/<a[^>]*href="\/api\/auth\/logout"/.test(accountControls),
      "로그아웃이 링크가 되었다 — 남의 페이지에서 눌릴 수 있다"
    );
  });
});

describe("㉤ 🔴 서랍 바닥에 붙는 장치 — 메뉴가 길어져도 풀리지 않는다", () => {
  test("🔴 `mt-auto` 가 아니다 — 그것은 자리가 모자라는 순간 0 으로 풀린다", () => {
    // margin-top:auto 는 남는 자리가 있을 때만 내려 준다. 메뉴가 서랍보다
    // 길어지는 순간(가로로 눕힌 폰 · 글자 크기를 키운 기기 · 메뉴가 더 느는 날)
    // 0 으로 풀려 구분선 위 간격이 **가장 필요한 때** 사라지는데, 오류는 한 줄도
    // 안 나고 눈에만 드러난다(재고관리 6fe1db5 가 같은 함정에 빠졌다).
    assert.ok(!wrapperClasses("drawer").includes("mt-auto"), "서랍 바닥 붙이기를 mt-auto 로 한다");
    // 바닥으로 미는 것은 **바로 위 형제**다: Sidebar 가 남는 자리를 전부
    // 가져가고(flex-1), 그 안의 메뉴가 스스로 구른다(overflow-y-auto). 그래서
    // 자리가 남든 메뉴가 길든 이 묶음은 바닥에 남는다.
    assert.match(sidebar, /<div className="flex min-h-0 flex-1 flex-col overflow-hidden">/, "Sidebar 가 남는 자리를 가져가지 않는다");
    assert.match(sidebar, /<nav className="[^"]*\boverflow-y-auto\b/, "메뉴가 길어질 때 구르지 않는다");
    assert.ok(wrapperClasses("drawer").includes("shrink-0"), "서랍이 좁아질 때 계정 묶음이 눌린다");
  });

  test("🔴 노치 인셋은 **서랍 상자**가 갖는다 — 계정 묶음으로 옮기지 않는다", () => {
    // 없으면 맨 아래 단추(이제 「로그아웃」이다)가 홈 인디케이터/제스처 바에
    // 겹쳐 눌리지 않는다 — 이 저장소에서 실제로 겪은 일이다.
    assert.match(
      mobileDrawer,
      /<aside className="[^"]*\bpb-\[env\(safe-area-inset-bottom\)\]/,
      "서랍 상자가 아래쪽 노치 인셋을 잃었다 — 맨 아래 단추가 홈 인디케이터에 겹친다"
    );
    assert.ok(
      !accountControls.includes("safe-area-inset"),
      "계정 묶음이 인셋을 따로 갖는다 — 두 곳이 가지면 그만큼 두 번 밀린다"
    );
  });

  test("다크 모드 짝 — 옮긴 조각의 밝은 색마다 어두운 짝이 있다", () => {
    // 🔴 이 저장소에는 다크 모드가 있다(본보기로 삼은 재고관리에는 없다).
    // 짝을 빠뜨리면 어두운 화면에서만 구분선이 사라지거나 글자가 안 읽힌다.
    for (const [light, dark] of [
      ["border-zinc-200", "dark:border-zinc-800"],
      ["border-zinc-300", "dark:border-zinc-700"],
      ["text-zinc-700", "dark:text-zinc-300"],
      ["text-zinc-600", "dark:text-zinc-400"],
      ["hover:bg-zinc-100", "dark:hover:bg-zinc-800"],
    ] as const) {
      if (!accountControls.includes(light)) continue;
      assert.ok(accountControls.includes(dark), `${light} 에 어두운 짝(${dark})이 없다`);
    }
  });
});

describe("㉥ 🔴 사이드바 아래는 여전히 비었다 — 그 넷이 거기로 되살아나지 않았다", () => {
  test("SidebarFooter 가 사용자 · 테마 · 포털 · 로그아웃을 그리지 않는다", () => {
    // 🔴 2026-10-22 에 넷이 폰에서 아래로 내려갔지만, 내려간 자리는 **여기가
    // 아니라 모바일 드로어 자신**이다. 이 조각은 데스크톱 사이드바에서도
    // 그려지므로 여기에 넣으면 넓은 화면에서 머리말과 겹친다.
    for (const gone of ["ThemeToggle", "portalUrl", "user.name", "user.roleLabel", "로그아웃", "통합 로그인으로"]) {
      assert.ok(!sidebarFooter.includes(gone), `SidebarFooter 에 ${gone} 이 남아 있다`);
    }
    // 아이콘 · 첫 글자 배지처럼 그 넷만 쓰던 것도 함께 사라졌다.
    assert.ok(!sidebarFooter.includes("FooterIcons"), "로그아웃 아이콘을 아직 가져온다");
    assert.ok(!sidebarFooter.includes("function glyph"), "사용자 배지의 첫 글자 함수가 남아 있다");
  });

  test("🔴 남은 것은 ☰ 한 줄이고, 그것이 없는 호출부에서는 껍데기도 남지 않는다", () => {
    // ☰ 는 데스크톱 사이드바의 접기/펼치기다 — 그 자리는 그대로 산다.
    assert.match(sidebarFooter, /aria-expanded=\{isPinnedOpen\}/, "☰ 의 펼침 상태가 사라졌다");
    assert.match(sidebarFooter, /사이드바 접기/, "☰ 의 말이 사라졌다");
    // 🔴 모바일 드로어는 ☰ 를 넘기지 않는다(접는 개념이 없다). 그때 이 조각이
    // 빈 <div> 를 돌려주면 메뉴와 계정 묶음 사이에 까닭 없는 구분선 한 줄과
    // 여백이 낀다 — null 이어야 한다.
    assert.match(
      sidebarFooter,
      /if \(!onToggleCollapsed\) \{\s*return null;/,
      "☰ 가 없을 때 빈 껍데기(구분선 · 여백)를 그린다"
    );
    // 구분선은 ☰ 를 그릴 때만 나온다 — 위 이른 반환 뒤에 있어야 한다.
    const earlyReturn = sidebarFooter.indexOf("return null;");
    assert.ok(earlyReturn > 0 && sidebarFooter.indexOf("border-t") > earlyReturn, "구분선이 이른 반환보다 앞에 있다");
  });
});
