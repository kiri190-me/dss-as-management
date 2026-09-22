import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 머리말 오른쪽 묶음 — 사용자 · 테마 · 「통합 로그인으로」· 「로그아웃」
 * ============================================================================
 * 2026-09-22: 이 넷이 **사이드바 맨 아래에서 머리말 오른쪽 끝으로** 올라왔다.
 * 다른 사내 시스템들(PO 3600 · 계측기 3200)이 전부 그 자리에 두고 있어서 같은
 * 자리로 모으라는 사용자 지시였고, 사이드바 아래는 비우는 쪽으로 정했다.
 *
 * 🔴 그런데 이 자리는 **예전에 실제로 버그가 났던 자리다.** 같은 묶음이 한때
 * 이 머리말에 `md:hidden` 으로 있었고, wrap/shrink 장치가 없어서 폰
 * (360~430px)에서 머리말이 조용히 가로로 넘쳤다 — 넘친 만큼 ☰ 단추가 손가락에
 * 안 잡혀, 폰에서 서랍 링크(A/S 접수까지)에 닿을 수 없었다. 그때의 고침은
 * 「묶음을 사이드바로 옮긴 것」이었지만 **원인은 자리가 아니라 장치의 부재**였다.
 *
 * 그래서 이 파일이 지키는 것은 넷이 머리말에 있다는 사실만이 아니라, **폰에서
 * 폭을 줄이는 장치가 그 자리에 그대로 있는가**다. 그 장치가 사라지면 컴파일도
 * 통과하고 넓은 화면에서는 아무 증상이 없다 — 폰에서만 터진다. 화면을 렌더해도
 * 미디어 쿼리는 풀리지 않으므로, 이 저장소의 관행대로 **원본을 글자로 읽어**
 * 못 박는다(service-menu-bar.test.ts 가 같은 머리말의 다른 면을 같은 방식으로
 * 지킨다).
 *
 * 폭 계산과 실측값은 TopBar.tsx 의 2026-09-22 주석에 적혀 있다.
 * ============================================================================
 */

const repoFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석 안의 말을 걷어낸다. 🔴 이 파일에는 **없어야 한다**는 단언이 많고
 * (SidebarFooter 가 그 넷을 더 이상 그리지 않는다), 이 저장소의 주석은 길어서
 * 「로그아웃」· 「통합 로그인으로」같은 낱말이 주석에만 남아도 그 단언이 조용히
 * 통과하거나 조용히 실패한다.
 */
const withoutComments = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const topBar = withoutComments(repoFile("src/components/layout/TopBar.tsx"));
const sidebarFooter = withoutComments(repoFile("src/components/layout/SidebarFooter.tsx"));
const sidebar = withoutComments(repoFile("src/components/layout/Sidebar.tsx"));
const appShell = withoutComments(repoFile("src/components/layout/AppShell.tsx"));
const themeToggle = withoutComments(repoFile("src/components/layout/ThemeToggle.tsx"));

/** 머리말 오른쪽 묶음의 마크업만 — 메뉴바 뒤부터 </header> 까지. */
const cluster = topBar.slice(topBar.indexOf("{serviceMenu}"), topBar.indexOf("</header>"));

describe("㉠ 넷은 머리말에 있고 사이드바 아래에는 없다", () => {
  test("머리말이 사용자 · 테마 · 「통합 로그인으로」· 「로그아웃」을 그린다", () => {
    assert.match(cluster, /\{user\.name\}님 · \{user\.roleLabel\}/, "머리말이 사용자 이름·역할을 적지 않는다");
    assert.match(cluster, /<ThemeToggle compact \/>/, "머리말에 테마 고르개가 없다");
    assert.match(cluster, /통합 로그인으로/, "머리말에 통합 로그인 링크가 없다");
    assert.match(cluster, /로그아웃/, "머리말에 로그아웃이 없다");
    // 링크가 실제로 포털 주소를 쓴다 — 갈 곳이 없으면(데모 모드) 아예 그리지 않는다.
    assert.match(cluster, /\{portalUrl && \(/, "포털 주소가 없을 때도 링크를 그린다");
    assert.match(cluster, /href=\{portalUrl\}/, "링크가 포털 주소를 쓰지 않는다");
    assert.match(topBar, /user: \{ name: string; roleLabel: string \};/, "TopBar 가 사용자를 받지 않는다");
    assert.ok(!/user\?:/.test(topBar), "user 가 선택 인자다 — 로그아웃 없는 껍데기가 조용히 그려질 수 있다");
  });

  test("🔴 AppShell 이 그 둘을 머리말로 내려보낸다 — 사이드바가 아니라", () => {
    const topBarCall = appShell.slice(appShell.indexOf("<TopBar"), appShell.indexOf("/>", appShell.indexOf("<TopBar")));
    assert.match(topBarCall, /user=\{user\}/, "머리말에 사용자를 넘기지 않는다");
    assert.match(topBarCall, /portalUrl=\{portalUrl\}/, "머리말에 포털 주소를 넘기지 않는다");
    // Sidebar 호출부(데스크톱 · 모바일 드로어)에는 둘이 남아 있지 않다 — 넘겨도
    // 받을 곳이 없고, 남아 있으면 「사이드바가 아직 그것을 그리나?」로 읽힌다.
    assert.equal([...sidebar.matchAll(/portalUrl/g)].length, 0, "Sidebar 가 아직 포털 주소를 받는다");
    assert.equal([...sidebar.matchAll(/\buser\b/g)].length, 0, "Sidebar 가 아직 사용자를 받는다");
  });

  test("🔴 로그아웃은 시스템에 **하나**뿐이다 — 머리말과 사이드바 두 곳에 생기지 않는다", () => {
    // 같은 단추가 두 곳에 있으면 그 자체로 결함이다(어느 것을 눌렀는지 모른다).
    for (const [name, source] of [
      ["SidebarFooter", sidebarFooter],
      ["Sidebar", sidebar],
      ["AppShell", appShell],
    ] as const) {
      assert.ok(
        !source.includes("/api/auth/logout"),
        `${name} 이 아직 로그아웃을 그린다 — 머리말과 두 곳이 된다`
      );
    }
    assert.equal(
      [...topBar.matchAll(/\/api\/auth\/logout/g)].length,
      1,
      "머리말 안에서 로그아웃을 두 번 그린다"
    );
  });
});

describe("㉡ 🔴 폰에서 폭을 줄이는 장치 — 사라지면 옛 버그가 되돌아온다", () => {
  test("머리말이 줄을 바꿀 수 있고, 오른쪽 묶음은 폰에서 제 줄을 통째로 갖는다", () => {
    const header = topBar.match(/<header className="([^"]*)"/);
    assert.ok(header, "<header> 를 찾지 못했다");
    assert.ok(
      header[1].split(/\s+/).includes("flex-wrap"),
      "머리말이 nowrap 이다 — 폰에서 들어가지 않는 만큼 화면 밖으로 밀리고, 밀려난 것은 눌리지 않는다"
    );

    const clusterOpen = cluster.match(/<div className="([^"]*)"/);
    assert.ok(clusterOpen, "오른쪽 묶음(<div>)이 없다");
    const classes = clusterOpen[1].split(/\s+/);
    // w-full = 폰에서 제 줄을 통째로 갖는다(첫 줄에는 햄버거 · 시스템 이름 ·
    // 메뉴 단추만 남아 이름이 잘리지 않는다). sm:w-auto = ≥640px 에서는 내용
    // 폭으로 돌아가 오른쪽 끝에 붙는다. flex-wrap = 글꼴이 큰 기기를 위한 안전망.
    for (const needed of ["ml-auto", "w-full", "sm:w-auto", "flex-wrap"]) {
      assert.ok(classes.includes(needed), `오른쪽 묶음에 ${needed} 가 없다`);
    }
  });

  test("🔴 「통합 로그인으로」는 폰에서 「포털」로 줄지만 **말은 남는다**", () => {
    // 긴 이름은 ~106px 이라 그대로 두면 폰 한 줄에 들어가지 않는다. 🔴 지우는
    // 것이 아니다: 눈에 보이는 것만 짧은 말로 바꾸고, 긴 이름은 sr-only 로 남아
    // 낭독기가 여전히 온전한 말을 읽는다(계측기 AppHeader.tsx 의 같은 처방).
    assert.match(
      cluster,
      /<span className="md:hidden" aria-hidden="true">\s*포털\s*<\/span>/,
      "폰에서 보일 짧은 말(「포털」)이 없다"
    );
    assert.match(
      cluster,
      /<span className="sr-only md:not-sr-only">통합 로그인으로<\/span>/,
      "긴 이름이 `sr-only md:not-sr-only` 로 남아 있지 않다 — 폰에서 낭독기가 읽을 말이 사라졌다"
    );
  });

  test("🔴 「로그아웃」은 줄이지 않는다 — 그 말만은 온전해야 한다", () => {
    // 누르면 통합 로그인까지 포함해 모든 시스템에서 나간다. 짧게 줄이거나
    // 아이콘만 남기면 잘못 누른다(계측기도 같은 선을 긋는다).
    const logoutButton = cluster.match(/<button\s+type="submit"[\s\S]*?<\/button>/);
    assert.ok(logoutButton, "로그아웃 단추를 찾지 못했다");
    assert.match(logoutButton[0], />\s*로그아웃\s*</, "로그아웃 단추의 말이 「로그아웃」이 아니다");
    assert.ok(
      !/md:hidden|sr-only/.test(logoutButton[0]),
      "로그아웃을 폰에서 줄이거나 감춘다 — 그 말만은 온전해야 한다"
    );
    assert.match(logoutButton[0], /whitespace-nowrap/, "로그아웃이 좁은 폭에서 두 줄로 접힌다");
  });

  test("🔴 테마는 아이콘 한 줄이다 — 글자 모양은 폰 한 줄에 서지 못한다", () => {
    // 글자 모양(밝게 · 어둡게 · 시스템 설정)은 ~190px 이라 「포털」· 「로그아웃」·
    // 종과 같이 서지 못하고, 묶음이 제 안에서 또 줄을 바꿔 머리말이 폰에서 세
    // 줄이 된다. 그래서 머리말은 compact(아이콘 셋 ~104px)로 부른다.
    assert.match(cluster, /<ThemeToggle compact \/>/, "머리말이 테마를 글자 모양으로 부른다");
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

  test("사용자 이름은 폰에서만 감춘다 — 누르는 것이 아니라 읽는 글자다", () => {
    const nameSpan = cluster.match(/<span\s+title=\{`\$\{user\.name\}님 · \$\{user\.roleLabel\}`\}\s+className="([^"]*)"/);
    assert.ok(nameSpan, "머리말의 사용자 <span> 을 찾지 못했다");
    const classes = nameSpan[1].split(/\s+/);
    assert.ok(classes.includes("hidden"), "폰에서도 이름이 보인다 — ~115px 이라 나머지가 한 줄에 서지 못한다");
    assert.ok(
      classes.some((name) => /^(sm|md|lg):(inline|flex)$/.test(name)),
      "넓은 화면에서도 이름이 안 보인다 — 누구로 로그인했는지 알 길이 없다"
    );
    assert.ok(classes.includes("truncate"), "이름이 길면 이 줄을 밀어낸다 — … 로 끊겨야 한다");
  });
});

describe("㉢ 로그아웃은 여전히 <form> 의 POST 다", () => {
  test("링크가 아니다 — GET 으로 열리는 로그아웃은 남의 페이지에서도 눌린다", () => {
    assert.match(
      cluster,
      /<form action="\/api\/auth\/logout" method="post">/,
      "로그아웃이 <form> POST 가 아니다"
    );
    assert.match(cluster, /<button\s+type="submit"/, "로그아웃이 submit 단추가 아니다");
    // <a href="/api/auth/logout"> 로 바뀐 적이 없는지 — 그 모양이면 다른 사이트에
    // 심은 <img> 나 링크 미리보기만으로도 로그아웃된다.
    assert.ok(
      !/<a[^>]*href="\/api\/auth\/logout"/.test(topBar),
      "로그아웃이 링크가 되었다 — 남의 페이지에서 눌릴 수 있다"
    );
  });
});

describe("㉣ 🔴 사이드바 아래는 비었다 — 그 넷이 되살아나지 않는다", () => {
  test("SidebarFooter 가 사용자 · 테마 · 포털 · 로그아웃을 그리지 않는다", () => {
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
    // 빈 <div> 를 돌려주면 드로어 맨 아래에 까닭 없는 구분선 한 줄과 여백이
    // 남는다 — null 이어야 한다.
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
