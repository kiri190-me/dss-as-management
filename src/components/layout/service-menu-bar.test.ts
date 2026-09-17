import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ServiceMenuBar } from "@dss/ui";

/**
 * ============================================================================
 * 서비스 메뉴바가 이 저장소에 **붙은 자리**를 못 박는다
 * ============================================================================
 * 띠 자체(@dss/ui)는 그쪽 저장소의 시험이 본다. 여기서 지키는 것은 이 저장소가
 * 그것을 어떻게 쓰느냐다 — 어디에 앉혔는지, 「지금 여기」로 무엇을 넘기는지,
 * 노치 인셋을 누가 갖는지, 종이에 나오지 않는지.
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

test("🔴 띠는 머리말 **위**에 앉는다 — TopBar 를 감싼 print:hidden 블록 바로 앞", () => {
  const barAt = appShell.indexOf("<ServiceMenuBar");
  const topBarAt = appShell.indexOf("<TopBar");
  assert.ok(barAt > 0, "AppShell 이 ServiceMenuBar 를 그리지 않는다");
  assert.ok(barAt < topBarAt, "띠가 머리말보다 뒤에 있다");
  assert.equal(
    /<header[\s>]/.test(withoutComments(appShell)),
    false,
    "머리말 안에 끼워 넣었다 — 위에 독립된 띠로 앉혀야 한다(머리말은 TopBar 것이다)"
  );
  // 세로 flex 안에서 눌리지 않게 + 종이에는 나오지 않게.
  assert.match(appShell.slice(barAt, topBarAt), /className="shrink-0 print:hidden"/);
});

test("🔴 layout 이 목록과 「지금 여기」를 서버에서 풀어 내려보낸다", () => {
  assert.match(appLayout, /const serviceMenu = await readServiceMenu\(\);/);
  assert.match(appLayout, /serviceMenu\.length > 0 \? getSsoClientId\(\) : null/);
  assert.match(appLayout, /services=\{serviceMenu\}/);
  assert.match(appLayout, /currentServiceId=\{currentServiceId\}/);
  assert.match(appShell, /services=\{drawableServices\}/);
  assert.match(appShell, /currentServiceId=\{currentServiceId\}/);
});

test("🔴 생김새를 부르는 줄이 있고, 노치 인셋 파일이 그 **뒤**에 온다", () => {
  const stylesAt = appLayout.indexOf('import "@dss/ui/styles.css";');
  const insetAt = appLayout.indexOf('import "./service-menu-inset.css";');
  assert.ok(stylesAt > 0, "@dss/ui 의 CSS 를 부르지 않는다 — 띠가 모양 없이 뜬다");
  assert.ok(insetAt > stylesAt, "인셋 파일이 @dss/ui 기본값보다 먼저 온다");

  const inset = repoFile("src/app/(app)/service-menu-inset.css");
  assert.match(inset, /--dss-menu-inset-top:\s*env\(safe-area-inset-top\)/);
});

// ── 노치 인셋은 맨 위 요소 하나만 가진다 ────────────────────────────────────

test("🔴 TopBar 는 더 이상 노치 인셋을 갖지 않는다 — 두 곳에 두면 아이폰에서 두 번 밀린다", () => {
  const header = topBar.match(/<header className="([^"]*)"/);
  assert.ok(header, "TopBar 의 <header> 를 찾지 못했다");
  assert.equal(
    header[1].includes("safe-area-inset-top"),
    false,
    "머리말이 아직 인셋을 들고 있다"
  );
  // 옮겼을 뿐 없앤 것이 아니다: 띠가 없을 때는 AppShell 이 같은 패딩을
  // 이 <header> 에 그대로 걸어 준다.
  assert.match(
    appShell,
    /hasServiceMenu \? "print:hidden" : "print:hidden \[&>header\]:pt-\[env\(safe-area-inset-top\)\]"/
  );
  assert.equal(
    withoutComments(appShell).split("env(safe-area-inset-top)").length - 1,
    1,
    "AppShell 이 인셋을 두 군데에서 건다 — 실제로 거는 자리는 하나여야 한다"
  );
});

// ── 인쇄 ────────────────────────────────────────────────────────────────────

test("🔴 인쇄에는 나오지 않는다 — @dss/ui 의 CSS 와 이 저장소의 print:hidden 두 겹", () => {
  const css = repoFile("vendor/dss-ui/src/service-menu/service-menu.css");
  assert.match(css, /@media print \{\s*\.dss-menu \{\s*display: none !important;/);
  assert.match(appShell.slice(appShell.indexOf("<ServiceMenuBar")), /print:hidden/);
});
