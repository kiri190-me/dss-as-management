import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ServiceMenuBar } from "@dss/ui";

/**
 * ============================================================================
 * 서비스 메뉴바가 이 저장소에 **붙은 자리**를 못 박는다
 * ============================================================================
 * 메뉴바 자체(@dss/ui)는 그쪽 저장소의 시험이 본다. 여기서 지키는 것은 이
 * 저장소가 그것을 어떻게 쓰느냐다 — 어디에 앉혔는지, 「지금 여기」로 무엇을
 * 넘기는지, 노치 인셋을 누가 갖는지, 폰에서 머리말이 넘치지 않는지, 종이에
 * 나오지 않는지.
 *
 * 🔴 2026-09-18 부터 메뉴바는 머리말 **위**가 아니라 **안**에 앉는다(회색 층이
 * 하나 더 생겨 답답하다는 사용자 지적). 아래 시험들이 그 자리를 못 박는다.
 *
 * 띠는 조각을 **직접 불러** 나온 요소 나무를 본다(react-dom 없이). 이 목록의
 * 시험은 react-server 조건으로 도는데 그 조건에서는 react-dom/server 가 스스로
 * 막히고, 이 조각은 상태도 훅도 없는 순수 함수라 그냥 부르면 된다.
 * ============================================================================
 */

/** 이 앱의 client_id — 포털에 등록된 이름이자 ID 토큰의 aud 다. */
const THIS_SERVICE_ID = "rf-service-system";

const SERVICES = [
  { id: THIS_SERVICE_ID, name: "A/S 관리", url: "http://10.0.0.5:3000", icon: "🔧" },
  { id: "njlee", name: "계측기", url: "http://10.0.0.5:3200" },
  { id: "dss-improvements", name: "개선요청", url: "http://10.0.0.5:3300" },
];

type RenderedElement = { type: unknown; props: Record<string, unknown> };

function isElement(value: unknown): value is RenderedElement {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

/** 나온 나무에서 <a> 만 차례대로 줍는다. */
function links(node: unknown, found: RenderedElement[] = []): RenderedElement[] {
  if (Array.isArray(node)) {
    for (const child of node) links(child, found);
    return found;
  }
  if (!isElement(node)) return found;
  if (node.type === "a") found.push(node);
  links(node.props.children, found);
  return found;
}

const repoFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");

/** 주석 안의 말(이 저장소는 주석이 길다)이 아래 단언에 걸리지 않게 걷어낸다. */
const withoutComments = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const appShell = repoFile("src/components/layout/AppShell.tsx");
const topBar = repoFile("src/components/layout/TopBar.tsx");
const appLayout = repoFile("src/app/(app)/layout.tsx");

// ── 띠가 그리는 것 ──────────────────────────────────────────────────────────

test("🔴 지금 사이트(rf-service-system) 칸만 눌린 상태로 그려진다", () => {
  const rendered = ServiceMenuBar({ services: SERVICES, currentServiceId: THIS_SERVICE_ID });
  const anchors = links(rendered);

  assert.equal(anchors.length, 3);
  assert.deepEqual(
    anchors.map((anchor) => anchor.props["data-service-id"]),
    [THIS_SERVICE_ID, "njlee", "dss-improvements"],
    "받은 차례 그대로 그리지 않는다"
  );
  assert.deepEqual(
    anchors.map((anchor) => anchor.props["data-current"]),
    ["true", "false", "false"]
  );
  assert.deepEqual(
    anchors.map((anchor) => anchor.props["aria-current"]),
    ["page", undefined, undefined],
    "색 말고 aria-current 로도 「지금 여기」를 알려야 한다"
  );
});

test("목록이 비면 아무것도 그리지 않는다 — 빈 띠도 남기지 않는다(포털 배포 전 상태)", () => {
  assert.equal(ServiceMenuBar({ services: [], currentServiceId: THIS_SERVICE_ID }), null);
});

// ── 이 저장소가 붙인 자리 ───────────────────────────────────────────────────

test("🔴 메뉴바는 머리말 **안**에 앉는다 — 제목 다음, 알림종 앞", () => {
  // AppShell 은 조각을 만들어 TopBar 의 serviceMenu prop 으로 내려보낸다.
  const topBarAt = appShell.indexOf("<TopBar");
  const barAt = appShell.indexOf("<ServiceMenuBar");
  assert.ok(topBarAt > 0, "AppShell 이 머리말을 그리지 않는다");
  assert.ok(barAt > topBarAt, "메뉴바가 머리말 밖(위)에 있다 — 안으로 들어가야 한다");
  assert.match(appShell, /serviceMenu=\{/, "머리말에 내려보내지 않는다");
  // 머리말 위 회색 띠가 아니라 머리말 안에 얹히는 모습이어야 한다.
  assert.match(appShell.slice(barAt), /variant="inline"/);
  assert.equal(
    withoutComments(appShell).includes("shrink-0 print:hidden"),
    false,
    "세로 flex 안에 독립된 띠로 앉히던 때의 클래스가 남아 있다"
  );

  // 그리는 **자리**는 머리말이 정한다: 제목 뒤, 알림종 앞(넓은 화면에서
  // 통째로 비어 있던 가운데다).
  const bare = withoutComments(topBar);
  const titleAt = bare.indexOf("{title &&");
  const menuAt = bare.indexOf("{serviceMenu}");
  const bellAt = bare.indexOf("<NotificationBell");
  assert.ok(menuAt > 0, "머리말이 메뉴바를 그리지 않는다");
  assert.ok(titleAt > 0 && titleAt < menuAt, "제목보다 앞에 그린다");
  assert.ok(menuAt < bellAt, "알림종보다 뒤에 그린다");
});

test("🔴 폰에서 햄버거와 알림종이 밀려나지 않는다 — 메뉴바는 남는 자리만 쓴다", () => {
  const bare = withoutComments(topBar);

  // `flex-1`(= flex: 1 1 0%)은 기준 폭이 0 이라 햄버거·제목·종이 제 폭을 먼저
  // 가져간 **뒤 남은 만큼만** 차지한다. `min-w-0` 은 안의 목록이 길어도 이 칸이
  // 제 내용 폭까지 부풀지 못하게 막는다(목록은 자기 안에서 가로로 굴러간다).
  // 둘 중 하나라도 빠지면 목록이 길어질 때 오른쪽 종부터 화면 밖으로 밀린다.
  assert.match(bare, /<div className="min-w-0 flex-1">\{serviceMenu\}<\/div>/);

  // 이 머리말의 못 박힌 선: 메뉴바 뒤(오른쪽)에 놓이는 것은 아이콘 버튼
  // 하나뿐이다. 글자 묶음이 다시 들어오면 폰에서 햄버거가 안 눌린다
  // (TopBar.tsx 머리말 주석의 사고).
  const tagsAfterMenu = [...bare.slice(bare.indexOf("{serviceMenu}")).matchAll(/<([A-Za-z][\w.]*)/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(tagsAfterMenu, ["NotificationBell"]);
});

test("🔴 폰에서는 이름을 감추고 아이콘만 보인다 — 칸 하나가 아이콘 하나 폭이다", () => {
  // 그 동작은 @dss/ui 가 CSS 로 한다(그쪽 시험이 자세히 본다). 여기서는 이
  // 저장소가 기대는 그 규칙이 실제로 실려 있는지만 확인한다 — 없으면 폰에서
  // 칸마다 이름까지 싣고 머리말 자리를 다투게 된다.
  const css = repoFile("vendor/dss-ui/src/service-menu/service-menu.css");

  assert.match(css, /@media not all and \(min-width: 768px\)/);
  assert.match(css, /\.dss-menu--inline \.dss-menu__name \{/);
  // 이름은 눈에서만 감춘다 — 낭독기는 그대로 읽어야 한다.
  assert.match(css, /clip-path: inset\(50%\)/);
});

test("🔴 폰에서는 시스템 이름도 감춘다 — 그 자리가 메뉴바로 간다", () => {
  // 위 「아이콘만」 규칙까지 걸어도 폰에서 메뉴 칸이 잘려 보였다(사용자 폰
  // 사진). 남는 자리를 실제로 먹던 것은 머리말의 시스템 이름 글자라, 같은
  // 폭에서 그것도 감춘다.
  const bare = withoutComments(topBar);
  const nameSpan = bare.match(/<span className="([^"]*)">\s*DSS A\/S 관리 시스템\s*<\/span>/);
  assert.ok(nameSpan, "머리말에서 시스템 이름을 그리는 <span> 을 찾지 못했다");
  const classes = nameSpan[1].split(/\s+/);

  // 좁은 화면: 눈에서 감춘다.
  assert.ok(classes.includes("sr-only"), "좁은 화면에서 이름이 그대로 보인다 — 메뉴 칸이 잘린다");
  // 넓은 화면: 그대로 보인다(지금까지의 모습).
  assert.ok(classes.includes("md:not-sr-only"), "넓은 화면에서 이름이 되돌아오지 않는다");

  // 🔴 마크업에서 사라지지는 않는다 — 낭독기와 검색에는 남아야 한다.
  // hidden(=display:none) 계열이면 링크도 제목도 없는 머리말이 된다.
  assert.equal(classes.includes("hidden"), false, "display:none 으로 지웠다 — 낭독기에서도 사라진다");
  assert.ok(
    bare.includes("DSS A/S 관리 시스템"),
    "이름 글자를 마크업에서 통째로 뺐다"
  );
});

test("🔴 이름을 감추는 기준점이 메뉴바의 「아이콘만」 기준점과 같다", () => {
  // 어긋나면 그 사이 폭에서 「이름은 없는데 메뉴는 글자」인 어정쩡한 상태가
  // 생긴다. 머리말 쪽은 Tailwind 의 `md:`(=min-width: 768px), 메뉴바 쪽은
  // 그 여집합인 `not all and (min-width: 768px)` 이라 둘이 정확히 맞물린다.
  const css = repoFile("vendor/dss-ui/src/service-menu/service-menu.css");
  const menuBreakpoint = css.match(/@media not all and \(min-width: (\d+)px\)/);
  assert.ok(menuBreakpoint, "메뉴바의 「아이콘만」 기준점을 찾지 못했다");
  assert.equal(menuBreakpoint[1], "768", "메뉴바 기준점이 768px 이 아니다");

  // 머리말이 쓰는 `md:` 가 그 768px 인지 — Tailwind 기본값을 이 저장소가
  // 덮어썼다면 여기서 걸린다.
  const globals = repoFile("src/app/globals.css");
  const overridden = /--breakpoint-md:\s*(?!768px)/.test(globals);
  assert.equal(overridden, false, "이 저장소가 md 기준점을 768px 이 아닌 값으로 덮었다");

  const bare = withoutComments(topBar);
  // 이름을 되돌리는 것도, 「/ 화면이름」을 보이는 것도 같은 `md:` 다.
  assert.match(bare, /className="[^"]*\bmd:not-sr-only\b[^"]*">\s*DSS A\/S 관리 시스템/);
});

test("🔴 layout 이 목록과 「지금 여기」를 서버에서 풀어 내려보낸다", () => {
  assert.match(appLayout, /const serviceMenu = await readServiceMenu\(\);/);
  assert.match(appLayout, /serviceMenu\.length > 0 \? getSsoClientId\(\) : null/);
  assert.match(appLayout, /services=\{serviceMenu\}/);
  assert.match(appLayout, /currentServiceId=\{currentServiceId\}/);
  assert.match(appShell, /services=\{services\}/);
  assert.match(appShell, /currentServiceId=\{currentServiceId\}/);
});

test("🔴 생김새를 부르는 줄이 있고, 노치 인셋 파일은 **없다**", () => {
  assert.ok(
    appLayout.includes('import "@dss/ui/styles.css";'),
    "@dss/ui 의 CSS 를 부르지 않는다 — 메뉴바가 모양 없이 뜬다"
  );

  // 그 파일은 메뉴바가 화면 맨 위에 회색 띠로 앉아 있던 동안 노치 인셋을
  // 띠로 옮기던 것이다. 머리말 안으로 들어온 지금은 맨 위 요소가 다시
  // 머리말이라 인셋도 머리말이 갖는다(아래 시험) — 이 파일이 남아 있으면
  // 인셋을 가진 요소가 둘이 된다.
  assert.equal(
    withoutComments(appLayout).includes("service-menu-inset.css"),
    false,
    "인셋 파일을 아직 부른다"
  );
  assert.equal(
    existsSync(join(process.cwd(), "src/app/(app)/service-menu-inset.css")),
    false,
    "그 파일이 아직 남아 있다 — 무엇이 참인지 다음 사람이 읽을 수 없다"
  );
});

// ── 노치 인셋은 맨 위 요소 하나만 가진다 ────────────────────────────────────

test("🔴 노치 인셋은 머리말이 **혼자** 갖는다 — 둘이 가지면 아이폰에서 두 번 밀린다", () => {
  // 맨 위 요소가 갖는다. 메뉴바가 머리말 안으로 들어오면서 맨 위는 다시
  // <header> 가 되었다 — 한때 띠가 맨 위였을 때 AppShell 로 옮겨 갔던 그
  // 패딩이 여기로 돌아왔다.
  const header = topBar.match(/<header className="([^"]*)"/);
  assert.ok(header, "TopBar 의 <header> 를 찾지 못했다");
  assert.ok(
    header[1].includes("pt-[env(safe-area-inset-top)]"),
    "머리말이 인셋을 갖지 않는다 — 아이폰에서 제목이 노치 밑으로 들어간다"
  );
  assert.equal(
    withoutComments(topBar).split("safe-area-inset-top").length - 1,
    1,
    "머리말 안에서 인셋을 두 번 건다"
  );

  // AppShell 에는 위쪽 인셋이 한 줄도 남지 않았다(아래쪽 pb- 인셋은 별개다).
  assert.equal(
    withoutComments(appShell).includes("safe-area-inset-top"),
    false,
    "AppShell 이 아직 위쪽 인셋을 건다 — 인셋을 가진 요소는 하나여야 한다"
  );
});

// ── 인쇄 ────────────────────────────────────────────────────────────────────

test("🔴 인쇄에는 나오지 않는다 — @dss/ui 의 CSS 와 이 저장소의 print:hidden 두 겹", () => {
  const css = repoFile("vendor/dss-ui/src/service-menu/service-menu.css");
  assert.match(css, /@media print \{\s*\.dss-menu \{\s*display: none !important;/);
  // 메뉴바 자신에게 한 겹, 머리말을 감싼 칸에 한 겹.
  assert.match(appShell.slice(appShell.indexOf("<ServiceMenuBar")), /print:hidden/);
  assert.match(appShell, /<div className="print:hidden">\s*<TopBar/);
});
