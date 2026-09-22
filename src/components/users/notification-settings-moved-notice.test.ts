import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 알림 설정은 포털로 떠났다 — 남은 한 줄을 지킨다
 * ============================================================================
 * 2026-09-22: 「사용자 관리」의 알림 설정 탭을 걷어냈다. 그 화면은 통합 로그인
 * 포털(dss-auth)의 `/admin/notifications` 로 옮겨 갔고, 🔴 **자료와 저장 통로는
 * A/S 에 그대로 남아 있다**(api/integration/notification-settings).
 *
 * 탭이 조용히 사라지면 관리자는 알림 설정을 어디서 고치는지 모른다. 그래서 화면
 * 맨 아래에 이사 안내 한 줄이 남았고, 이 시험이 그 한 줄을 지킨다. 지킬 것 넷:
 *
 *   ㉠ 안내와 링크가 화면에 있다.
 *   ㉡ 🔴 **주소를 글자로 박지 않는다** — `getSsoIssuer()` 를 거친다. 포털 주소는
 *      환경마다 다르다(개발 PC · NAS). 박아 두면 NAS 에서 개발 PC 를 가리킨다.
 *   ㉢ 🔴 **관리자 이상일 때만 주소가 내려간다** — 탭이 보였던 조건과 같다. 판정은
 *      서버 페이지에 있고 화면은 받은 값만 본다(클라이언트가 판정을 들고 있으면
 *      서버와 갈릴 길이 다시 생긴다 — developer-flag.test.ts 가 같은 줄을 긋는다).
 *   ㉣ 탭은 **넷**이고 `"notifications"` 키가 어디에도 남아 있지 않다.
 *
 * ── 왜 components.txt 인가 ──────────────────────────────────────────────
 * 원본을 글자로 읽는 시험이라 세 목록 어디서든 돌지만, 같은 두 파일
 * (RepresentativeManagementScreen.tsx · users/page.tsx)을 읽는 이웃
 * (approval-route-section.test.ts · UserDeletionParts.test.tsx)이 이미
 * components.txt 에 있다. 화면 원본을 지키는 시험이 한 목록에 모여 있으면 화면을
 * 고친 사람이 돌릴 목록이 하나다. DB 도 환경변수도 쓰지 않으므로 그 목록의 제약
 * (부트스트랩 없음 · server-only 모듈 불가)에 걸릴 것이 없다 — 이 파일은
 * `readFileSync` 만 쓴다.
 * ============================================================================
 */

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/**
 * 주석은 경위를 적는 자리다 — 지키는 것은 **코드**뿐이다.
 *
 * 🔴 줄 주석을 지울 때 앞이 `:` 인 `//` 는 건드리지 않는다. 이 저장소의 다른
 * 시험들이 쓰는 `/\/\/.*$/gm` 을 그대로 가져오면 `http://…` 의 `//` 부터 줄 끝까지
 * 함께 사라져서, 아래 「주소를 글자로 박지 않았다」가 **박아 놓아도 통과한다.**
 * 눈에 보이지 않는 채로 단언만 무력해지는 종류라 아래 자기 점검 시험으로 못 박았다.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SCREEN = "src/components/users/RepresentativeManagementScreen.tsx";
const PAGE = "src/app/(app)/users/page.tsx";

const screen = read(SCREEN);
const page = read(PAGE);
const screenCode = withoutComments(screen);
const pageCode = withoutComments(page);

describe("㉠ 이사 안내 한 줄", () => {
  test("안내 문구와 링크가 화면에 있다", () => {
    assert.match(screenCode, /알림 설정은 통합 로그인 포털로 이사했습니다/);
    assert.match(screenCode, /여섯 시스템을 한 곳에서 고칩니다/);
    assert.match(screenCode, /알림 설정 열기/);
    assert.match(screenCode, /href=\{notificationSettingsPortalUrl\}/);
  });

  test("🔴 탭이 아니다 — 어느 탭을 보고 있어도 늘 보인다", () => {
    // 탭을 눌러야 보이는 안내는 탭을 남기는 것과 같다. 안내 블록이 **마지막
    // activeTab 판정보다 뒤**에 있으면 어떤 탭 분기 안에도 들어갈 수 없다.
    const noticeAt = screenCode.indexOf("{notificationSettingsPortalUrl && (");
    const lastTabBranchAt = screenCode.lastIndexOf("activeTab ===");
    assert.ok(noticeAt > 0, "안내 블록을 찾지 못했다");
    assert.ok(lastTabBranchAt > 0, "탭 분기를 찾지 못했다");
    assert.ok(
      noticeAt > lastTabBranchAt,
      "안내가 탭 분기 안에 들어갔다 — 눌러야 보이는 안내는 탭을 남기는 것과 같다"
    );
  });

  test("새 탭으로 열지 않는다 — 이 저장소의 포털 링크 관행이다", () => {
    // layout/SidebarFooter.tsx 의 「통합 로그인으로」도 같은 창에서 연다.
    assert.ok(!/target="_blank"/.test(screenCode), "포털 링크만 새 탭으로 연다");
  });
});

describe("㉡ 주소를 글자로 박지 않는다", () => {
  test("🔴 이 시험의 주석 제거기가 주소를 삼키지 않는다 — 단언이 거짓말을 하지 않게", () => {
    assert.match(
      withoutComments('const u = "http://localhost:3100/admin"; // 주석'),
      /"http:\/\/localhost:3100\/admin"/,
      "줄 주석 규칙이 URL 의 // 부터 삼킨다 — 아래 단언들이 무력해진다"
    );
    assert.ok(!withoutComments("const a = 1; // 지워질 줄 주석").includes("지워질 줄 주석"));
    assert.ok(!withoutComments("/** 여러 줄\n * 주석 */\nconst a = 1;").includes("여러 줄"));
  });

  test("🔴 포털 주소는 getSsoIssuer() 에서 온다", () => {
    assert.match(pageCode, /from "@\/lib\/config\/sso"/);
    assert.match(
      pageCode,
      /\$\{getSsoIssuer\(\)\}\/admin\/notifications/,
      "포털 주소를 config/sso.ts 에서 얻지 않는다"
    );
  });

  test("🔴 두 파일 어디에도 박힌 주소가 없다 — NAS 에서 개발 PC 를 가리키게 된다", () => {
    for (const [label, source] of [
      ["서버 페이지", pageCode],
      ["화면", screenCode],
    ] as const) {
      for (const forbidden of ["3100", "localhost", "http://", "https://", "192.168."]) {
        assert.ok(!source.includes(forbidden), `${label}: 주소를 글자로 박았다 — ${forbidden}`);
      }
    }
    // 화면은 경로조차 모른다 — 받은 주소를 href 에 걸기만 한다.
    assert.ok(
      !screenCode.includes("/admin/notifications"),
      "화면이 포털의 경로를 알고 있다 — 주소를 만드는 자리는 서버 페이지 하나다"
    );
  });
});

describe("㉢ 관리자 이상일 때만 주소가 내려간다", () => {
  test("🔴 판정은 서버 페이지가 한다 — 탭이 보였던 조건과 같다", () => {
    assert.match(pageCode, /from "@\/lib\/auth\/notification-settings-authorization"/);
    assert.match(
      pageCode,
      /actorMay\(actingUser, canManageNotificationSettings\)/,
      "탭이 보였던 조건(관리자 이상)과 다른 식으로 가린다"
    );
    // 통합 로그인 모드가 아니면 갈 곳이 없다 — 눌러도 아무 일이 없거나 설정이
    // 없다며 터진다((app)/layout.tsx 가 포털 링크에 같은 줄을 긋는다).
    assert.match(pageCode, /getLoginMode\(\) === "sso"/);
    // 권한이 없거나 갈 곳이 없으면 **주소 자체가 내려가지 않는다.**
    assert.match(pageCode, /: null;/);
    assert.match(pageCode, /notificationSettingsPortalUrl=\{notificationSettingsPortalUrl\}/);
  });

  test("🔴 화면은 스스로 판정하지 않는다", () => {
    for (const forbidden of [
      "actorMay(",
      "hasPermission(",
      "canManageNotificationSettings",
      'role === "ADMIN"',
      'role === "SUPER_ADMIN"',
    ]) {
      assert.ok(!screenCode.includes(forbidden), `화면이 판정을 스스로 한다: ${forbidden}`);
    }
  });

  test("필수 prop 이다 — 선택이면 빠뜨려도 컴파일이 통과한다", () => {
    assert.match(screenCode, /notificationSettingsPortalUrl: string \| null;/);
    assert.ok(!/notificationSettingsPortalUrl\?:/.test(screenCode), "선택 prop 이다");
  });
});

describe("㉣ 탭은 넷이고 알림 설정 탭은 없다", () => {
  test("🔴 탭 단추가 정확히 넷이고 키가 그대로다", () => {
    // 개수를 「넷 이하」 같은 바닥선으로 두지 않는다 — 정확한 개수인 것이 이
    // 단언의 값이다. 탭이 하나 늘거나 되살아나면 여기서 걸려 사람이 본다.
    const keys = [...screenCode.matchAll(/setActiveTab\("(\w+)"\)/g)].map(([, key]) => key);
    assert.deepEqual(keys, ["representatives", "approvalRoute", "permissions", "developer"]);
  });

  test("🔴 유니언에 `notifications` 키가 없다 — 다른 네 키는 글자 하나 안 바뀌었다", () => {
    assert.match(
      screenCode,
      /"representatives" \| "approvalRoute" \| "permissions" \| "developer"/,
      "탭 키 유니언이 바뀌었다"
    );
    assert.ok(!/"notifications"/.test(screenCode), "알림 설정 탭 키가 남아 있다");
  });

  test("🔴 걷어낸 두 파일이 되살아나지 않았다", () => {
    // 되살리려면 이 시험을 먼저 지워야 한다 — 그때 「같은 것을 두 곳에서 고칠
    // 수 있는」 상태로 돌아간다는 사실을 사람이 한 번 보게 된다.
    for (const gone of [
      "src/components/users/NotificationSettings.tsx",
      "src/lib/server/actions/notification-settings.ts",
    ]) {
      assert.equal(existsSync(join(process.cwd(), gone)), false, `${gone} 이 돌아왔다`);
    }
    assert.ok(!/NotificationSettings\b/.test(screenCode), "화면이 걷어낸 조각을 다시 부른다");
    assert.ok(!screenCode.includes("notificationSettings:"), "화면이 설정 자료를 다시 받는다");
    assert.ok(
      !pageCode.includes("buildNotificationSettingsView"),
      "서버 페이지가 화면용 설정 자료를 다시 읽는다 — 그 조회는 포털 창구의 것이다"
    );
  });

  test("🔴 포털 창구는 그대로 살아 있다 — 지운 것은 화면뿐이다", () => {
    // 이 시험이 지키는 것은 「탭이 없다」이고, 그것이 「기능이 없다」로 번지면
    // 포털의 알림 설정 화면이 죽는다. 통로 하나가 그 경계다.
    const route = read("src/app/api/integration/notification-settings/route.ts");
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function PUT/);
    assert.match(route, /loadView: buildNotificationSettingsView/);
    assert.match(route, /save: saveNotificationSettings/);
  });
});
