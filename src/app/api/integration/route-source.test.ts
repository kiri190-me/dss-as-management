import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 통합 통로 두 개 — **소스로** 지킨다
 * ============================================================================
 * 이 라우트들은 직접 부를 수 없다(포털의 JWKS 로 서명을 검증하고 DB 를 읽는다).
 * 이 저장소가 그런 라우트를 지키는 방식대로(api/auth/sso/callback/
 * route-source.test.ts) 소스를 읽어 못 박는다. 판정 자체는 실제로 돌려 본다 —
 * lib/auth/portal-service-token.test.ts(토큰) 와
 * lib/server/integration/portal-notifications.test.ts(대상 사용자·권한).
 *
 * 여기서 지키는 것:
 *  1. 토큰 검증이 **먼저** 오고, 실패하면 아무것도 하지 않는다.
 *  2. 🔴 대상 사용자를 **쿼리 문자열에서 읽지 않는다.**
 *  3. 🔴 기준 주소를 **요청 머리말에서 얻지 않는다.**
 *  4. 통로마다 **자기 용도의 토큰**만 받는다.
 *  5. 쓰기는 기존 저장 함수를 그대로 부른다(권한 판정을 새로 쓰지 않는다).
 * ============================================================================
 */

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

const feed = source("src/app/api/integration/notifications/route.ts");
const settings = source("src/app/api/integration/notification-settings/route.ts");

describe("통합 알림 통로", () => {
  test("🔴 토큰 검증이 먼저다 — 실패하면 401 로 끝나고 조회에 닿지 않는다", () => {
    const verifyAt = feed.indexOf("await verifyPortalServiceToken(");
    const rejectAt = feed.indexOf("if (!verified.ok) {");
    const workAt = feed.indexOf("buildPortalNotificationFeed({");
    assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    assert.ok(workAt > rejectAt, "거절하기 전에 알림을 뽑는다");
    assert.match(feed, /status: 401/);
  });

  test("🔴 대상 사용자는 토큰에서만 온다 — 쿼리 문자열을 읽지 않는다", () => {
    for (const forbidden of ["searchParams", "nextUrl.query", "?user=", "params.user"]) {
      assert.ok(!feed.includes(forbidden), `쿼리에서 대상을 읽는 자리가 있다: ${forbidden}`);
    }
    assert.match(feed, /subject: verified\.subject/);
  });

  test("🔴 기준 주소는 환경에서 온다 — Host 머리말을 읽지 않는다", () => {
    assert.match(feed, /baseUrl: getAppBaseUrl\(\)/);
    for (const forbidden of ['headers.get("host")', '"x-forwarded-host"', "request.url"]) {
      assert.ok(!feed.includes(forbidden), `부르는 쪽이 정하는 주소를 쓴다: ${forbidden}`);
    }
  });

  test("알림 읽기 용도의 토큰만 받는다", () => {
    assert.match(feed, /PORTAL_TOKEN_PURPOSES\.notificationsRead/);
    assert.ok(!feed.includes("notificationSettingsWrite"));
  });

  test("계산을 복제하지 않고 listMyNotifications 를 그대로 넘긴다", () => {
    assert.match(feed, /listNotifications: listMyNotifications/);
  });

  test("응답이 캐시되지 않는다", () => {
    assert.match(feed, /"cache-control": "no-store"/);
  });
});

describe("알림 설정 통로", () => {
  test("🔴 읽기와 쓰기가 각각 자기 용도의 토큰만 받는다", () => {
    const getAt = settings.indexOf("export async function GET");
    const putAt = settings.indexOf("export async function PUT");
    assert.ok(getAt > 0 && putAt > getAt);
    const get = settings.slice(getAt, putAt);
    const put = settings.slice(putAt);
    assert.match(get, /PORTAL_TOKEN_PURPOSES\.notificationSettingsRead/);
    assert.ok(!get.includes("notificationSettingsWrite"), "읽기 통로가 쓰기 토큰을 받는다");
    assert.match(put, /PORTAL_TOKEN_PURPOSES\.notificationSettingsWrite/);
    assert.ok(!put.includes("notificationSettingsRead"), "쓰기 통로가 읽기 토큰을 받는다");
  });

  test("🔴 두 메서드 모두 검증 뒤에야 일한다", () => {
    for (const [name, body] of [
      ["GET", settings.slice(settings.indexOf("export async function GET"), settings.indexOf("export async function PUT"))],
      ["PUT", settings.slice(settings.indexOf("export async function PUT"))],
    ] as const) {
      const verifyAt = body.indexOf("await authenticate(request");
      const rejectAt = body.indexOf("if (!verified.ok) return invalidToken();");
      assert.ok(verifyAt > 0, `${name}: 검증하는 자리를 찾지 못했다`);
      assert.ok(rejectAt > verifyAt, `${name}: 검증 결과를 확인하지 않는다`);
    }
  });

  test("🔴 대상 사용자는 토큰에서만 온다", () => {
    for (const forbidden of ["searchParams", "nextUrl.query", "params.user"]) {
      assert.ok(!settings.includes(forbidden), `쿼리에서 대상을 읽는 자리가 있다: ${forbidden}`);
    }
    const matches = settings.match(/subject: verified\.subject/g) ?? [];
    assert.equal(matches.length, 2, "두 메서드 모두 토큰의 sub 를 써야 한다");
  });

  test("🔴 저장은 기존 함수를 그대로 부른다 — 권한 판정을 새로 쓰지 않는다", () => {
    assert.match(settings, /save: saveNotificationSettings/);
    // 판정 함수를 흉내 낸 역할 비교가 라우트에 들어오지 않았는가.
    for (const forbidden of ['=== "ADMIN"', '=== "SUPER_ADMIN"', "role ==="]) {
      assert.ok(!settings.includes(forbidden), `라우트가 권한을 직접 판정한다: ${forbidden}`);
    }
  });

  test("🔴 역할 이름은 사용자 지정 문구를 거쳐 나간다 — 코드 표를 라우트가 읽지 않는다", () => {
    // 2026-09-22: A/S 의 알림 설정 탭을 걷어냈다. 그 탭이 uiText.role 로 바꿔 둔
    // 이름을 보여 주고 있어서, 창구가 코드 기본값을 보내는 어긋남이 가려져
    // 있었다 — 탭이 없어지면 포털에만 옛 이름이 보인다.
    assert.match(settings, /loadRoleText: async \(\) => \(await getUiText\(\)\)\.role/);
    assert.match(settings, /from "@\/lib\/server\/ui-text"/);
    // 서버가 문구를 읽는 자리는 getUiText 하나다 — 창구가 코드 표를 직접 읽거나
    // 자기 나름대로 병합하면 같은 역할이 A/S 와 포털에서 다른 이름으로 보인다.
    for (const forbidden of ["roleLabels", "resolveUiText", "buildUiText"]) {
      assert.ok(!settings.includes(forbidden), `라우트가 문구를 직접 다룬다: ${forbidden}`);
    }
  });

  test("스키마를 건드리지 않는다 — 사람별 설정을 만들지 않는다", () => {
    for (const forbidden of ["notification_user_settings", "userSettings", "insert("]) {
      assert.ok(!settings.includes(forbidden), `새 저장 자리가 생겼다: ${forbidden}`);
    }
  });
});
