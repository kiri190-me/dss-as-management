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

/**
 * `@media …` 한 덩어리를 **중괄호 짝을 세어** 통째로 떼어낸다.
 *
 * 정규식으로 `@media …\{[\s\S]*?\}` 를 잡으면 안쪽 규칙의 첫 `}` 에서 끊긴다.
 * 이 시험이 보려는 것은 「그 media 안에 무엇이 있고 **무엇이 없는가**」라
 * (예: 폰에서 감추는 것이 단추 이름뿐이고 목록 이름은 아니라는 것) 블록
 * 전체가 정확히 필요하다.
 */
function mediaBlock(css: string, header: string): string {
  const at = css.indexOf(header);
  assert.ok(at >= 0, `CSS 에서 ${header} 를 찾지 못했다`);
  const open = css.indexOf("{", at);
  assert.ok(open > at, `${header} 뒤에 블록이 없다`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`${header} 블록이 닫히지 않았다`);
}

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

test("🔴 폰에서 햄버거와 알림종이 밀려나지 않는다 — 줄어드는 것은 시스템 이름 하나뿐이다", () => {
  const bare = withoutComments(topBar);

  // 🔴 `shrink-0` 이다. 여기 한때 `min-w-0 flex-1` 이 있었는데, 그것은 **가로로
  // 늘어선 목록**에 남는 자리를 다 내주던 장치였다(기준 폭 0 + 남는 자리 다
  // 갖기). 메뉴바가 드롭다운이 되면서(@dss/ui 730780c) 이 칸에 들어오는 것은
  // **단추 하나**라 늘려 줄 까닭이 없고, 늘려 두면 「여기 늘어나는 무언가가
  // 있다」는 틀린 신호가 된다. 펼친 목록은 이 칸 밖으로 떠서(absolute) 그려져
  // 줄 폭을 한 톨도 먹지 않는다.
  assert.match(bare, /<div className="shrink-0">\{serviceMenu\}<\/div>/);

  // 🔴 그래서 이 줄에서 **눌릴 수 있는 것은 시스템 이름 글자 하나뿐**이어야
  // 한다. 아이콘 버튼 셋(햄버거 · 메뉴 단추 · 알림종)이 전부 shrink-0 이라야
  // 폭이 모자랄 때 글자가 … 로 줄 뿐, 버튼이 손가락에 안 잡히는 크기로
  // 깎이거나 화면 밖으로 밀려나지 않는다(TopBar.tsx 머리말 주석의 사고).
  const hamburger = bare.match(/aria-label="메뉴 열기"[\s\S]{0,400}?className="([^"]*)"/);
  assert.ok(hamburger, "햄버거 버튼을 찾지 못했다");
  assert.ok(
    hamburger[1].split(/\s+/).includes("shrink-0"),
    "햄버거가 shrink-0 이 아니다 — 좁은 폭에서 w-9 가 깎여 손가락에 안 잡힌다"
  );
  // 알림종은 제 파일에서 `ml-auto shrink-0` 을 갖는다(래퍼를 여기 두면 펼침
  // 패널의 기준이 두 겹이 되므로 이 머리말은 감싸지 않는다).
  assert.match(
    repoFile("src/components/layout/NotificationBell.tsx"),
    /className="[^"]*\bml-auto\b[^"]*\bshrink-0\b[^"]*"/,
    "알림종이 ml-auto shrink-0 을 잃었다 — 오른쪽 끝에 붙지 않거나 눌려 깎인다"
  );

  // 이 머리말의 못 박힌 선: 메뉴바 뒤(오른쪽)에 놓이는 것은 아이콘 버튼
  // 하나뿐이다. 글자 묶음이 다시 들어오면 폰에서 햄버거가 안 눌린다
  // (TopBar.tsx 머리말 주석의 사고).
  const tagsAfterMenu = [...bare.slice(bare.indexOf("{serviceMenu}")).matchAll(/<([A-Za-z][\w.]*)/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(tagsAfterMenu, ["NotificationBell"]);
});

test("🔴 펼친 목록이 잘리지 않는다 — 머리말과 그 조상에 overflow: hidden 이 없다", () => {
  // 드롭다운 목록은 단추 아래로 **떠서**(position:absolute) 그려진다. 감싸는
  // 머리말이나 그 조상에 overflow: hidden 이 한 줄이라도 있으면 목록이 잘려
  // 아무것도 고를 수 없게 된다(@dss/ui README 3절 「붙일 때 챙길 것」).
  const header = topBar.match(/<header className="([^"]*)"/);
  assert.ok(header, "TopBar 의 <header> 를 찾지 못했다");
  assert.equal(
    /\boverflow-(hidden|clip)\b/.test(header[1]),
    false,
    "머리말이 제 안을 잘라낸다 — 펼친 목록이 머리말 높이에서 잘린다"
  );

  // AppShell 에서 머리말을 감싸는 칸은 <div className="print:hidden"> 하나이고,
  // overflow-hidden 은 그 **형제**인 본문 줄에 걸려 있다(목록은 그 줄을 덮고
  // 그려진다). 머리말 쪽 래퍼에 그것이 옮겨 붙으면 여기서 걸린다.
  assert.match(withoutComments(appShell), /<div className="print:hidden">\s*<TopBar/);

  // 쌓임 맥락: @dss/ui 가 목록에 주는 z-index: 50 은 **가장 가까운 쌓임 맥락**
  // 안에서만 뜻이 있다. 머리말이나 그 위 칸이 z-index·transform·filter·
  // isolate 로 제 맥락을 만들면 목록이 본문 밑으로 내려갈 수 있다.
  assert.equal(
    /\b(z-\[?\d|transform|isolate|filter|backdrop-)/.test(header[1]),
    false,
    "머리말이 제 쌓임 맥락을 만든다 — 펼친 목록의 z-index 가 그 안에 갇힌다"
  );
});

test("🔴 폰에서 감추는 것은 **단추**의 이름뿐이다 — 펼친 목록의 이름은 폰에서도 보인다", () => {
  // 🔴 이 시험은 한때 「폰에서는 칸마다 아이콘만 보인다」였다. 그 말은 메뉴바가
  // 머리말 안에서 **칸을 가로로 늘어놓던** 때의 이야기이고, 드롭다운이 된
  // 지금(@dss/ui 730780c)은 거짓이다 — 감추는 판단이 **단추 하나**
  // (.dss-menu__summary 의 .dss-menu__label)로 옮겨 갔고, 펼친 목록의 이름
  // (.dss-menu__name)은 폰에서도 그대로 보인다. 목록은 머리말 폭을 다투지
  // 않고 떠서 그려지며, 이모지만 늘어선 목록은 고를 수가 없기 때문이다.
  //
  // 겨냥을 옮기지 않아도 예전 정규식은 여전히 통과했다 —
  // `.dss-menu--inline .dss-menu__name {` 이 새 CSS 에도 있지만 그것은 폰에서
  // 감추는 규칙이 아니라 긴 이름을 … 로 끊는 규칙이다. 그래서 여기서는
  // **media 블록 안**을 본다.
  const css = repoFile("vendor/dss-ui/src/service-menu/service-menu.css");
  const phone = mediaBlock(css, "@media not all and (min-width: 768px)");

  // 단추의 이름은 **눈에서만** 감춘다 — 낭독기는 그대로 읽어야 한다.
  assert.match(
    phone,
    /\.dss-menu--inline \.dss-menu__label \{[^}]*clip-path: inset\(50%\)/,
    "폰에서 드롭다운 단추의 이름을 감추지 않는다 — 단추가 이름까지 싣고 머리말 자리를 다툰다"
  );
  assert.equal(
    /\.dss-menu__name/.test(phone),
    false,
    "펼친 목록의 이름까지 폰에서 감춘다 — 이모지만 남은 목록에서는 고를 수가 없다"
  );

  // 아이콘은 선택값이라, 아이콘이 없는 서비스에 있으면 단추가 🔗 하나가 된다.
  // 그때만 이름 첫 글자가 대신 켜진다(@dss/ui 의 serviceInitial).
  assert.match(phone, /\.dss-menu__summary\[data-has-icon="false"\] \.dss-menu__initial/);
});

test("🔴 폰에서도 시스템 이름이 보인다 — 메뉴가 단추 하나로 줄어 자리가 났다", () => {
  // 🔴 이 시험은 한때 정반대(「폰에서는 시스템 이름도 감춘다」)였다. 감췄던
  // 이유는 오직 자리다 — 가로로 늘어선 메뉴 칸 셋(아이콘만 해도 ~123px)이
  // 폰에서 잘려 보였고(2026-09-18 사용자 폰 사진), 그 자리를 실제로 먹던 것이
  // 이름 글자였다. 메뉴가 드롭다운 단추 하나가 되면서 그 이유가 사라졌다:
  // 360px 기준 32(px-4) + 36(햄버거) + ~133(이름) + ~57(단추) + 36(종)
  // + 36(gap-3 × 3) ≈ 330px — 30px 이 남는다(TopBar.tsx 의 계산 주석).
  const bare = withoutComments(topBar);
  const nameSpan = bare.match(/<span className="([^"]*)">\s*DSS A\/S 관리 시스템\s*<\/span>/);
  assert.ok(nameSpan, "머리말에서 시스템 이름을 그리는 <span> 을 찾지 못했다");
  const classes = nameSpan[1].split(/\s+/);

  assert.equal(
    classes.includes("sr-only"),
    false,
    "폰에서 이름을 다시 감춘다 — 감출 이유였던 가로 목록은 이제 없다"
  );
  assert.equal(classes.includes("hidden"), false, "display:none 으로 지웠다 — 낭독기에서도 사라진다");

  // 🔴 되돌리면서 함께 건 안전장치. 위 계산은 글꼴 폴백(한글은 Geist 에 없다)에
  // 기대고 있으므로, 이 줄에서 **줄어들어도 되는 것은 이 글자 하나**로 정하고
  // (나머지는 전부 shrink-0) 모자라면 … 로 끊는다. 이것이 빠지면 좁은 기기에서
  // 다시 아이콘 버튼이 밀려나 안 눌리는 옛 사고로 돌아간다.
  assert.ok(classes.includes("truncate"), "이름이 넘칠 때 … 로 끊기지 않는다 — 버튼이 밀려난다");
  assert.ok(classes.includes("min-w-0"), "min-w-0 이 없으면 flex 항목이 제 글자 폭 밑으로 줄지 않아 truncate 가 동하지 않는다");

  assert.ok(bare.includes("DSS A/S 관리 시스템"), "이름 글자를 마크업에서 통째로 뺐다");
});

test("🔴 메뉴 단추가 아이콘만 되는 기준점이 이 저장소의 `md` 와 같다", () => {
  // 어긋나면 그 사이 폭에서 머리말과 단추가 서로 다른 화면 크기를 가정한다.
  // 메뉴바 쪽은 `not all and (min-width: 768px)` — Tailwind `md:` 의 정확한
  // 여집합이라 0.5px 틈이 생기지 않는다.
  const css = repoFile("vendor/dss-ui/src/service-menu/service-menu.css");
  const menuBreakpoint = css.match(/@media not all and \(min-width: (\d+)px\)/);
  assert.ok(menuBreakpoint, "메뉴 단추의 「아이콘만」 기준점을 찾지 못했다");
  assert.equal(menuBreakpoint[1], "768", "메뉴바 기준점이 768px 이 아니다");

  // 머리말이 쓰는 `md:` 가 그 768px 인지 — Tailwind 기본값을 이 저장소가
  // 덮어썼다면 여기서 걸린다.
  const globals = repoFile("src/app/globals.css");
  const overridden = /--breakpoint-md:\s*(?!768px)/.test(globals);
  assert.equal(overridden, false, "이 저장소가 md 기준점을 768px 이 아닌 값으로 덮었다");

  // 머리말에서 같은 폭을 쓰는 것: 햄버거를 감추는 곳(md:hidden)과 「/ 화면이름」
  // 을 되살리는 곳(md:inline). 🔴 시스템 이름은 더 이상 이 목록에 없다 —
  // 폰에서도 보이기 때문이다(위 시험).
  const bare = withoutComments(topBar);
  assert.match(bare, /aria-label="메뉴 열기"[\s\S]{0,400}?className="[^"]*\bmd:hidden\b/);
  assert.match(bare, /className="[^"]*\bmd:inline\b[^"]*">\s*\{title\}/);
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
