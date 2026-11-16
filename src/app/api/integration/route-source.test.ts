import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 통합 통로 넷 — **소스로** 지킨다
 * ============================================================================
 * 이 라우트들은 직접 부를 수 없다(포털의 JWKS 로 서명을 검증하고 DB 를 읽는다).
 * 이 저장소가 그런 라우트를 지키는 방식대로(api/auth/sso/callback/
 * route-source.test.ts) 소스를 읽어 못 박는다. 판정 자체는 실제로 돌려 본다 —
 * lib/auth/portal-service-token.test.ts(토큰) 와
 * lib/server/integration/portal-notifications.test.ts(대상 사용자·권한) 와
 * lib/server/integration/portal-approvals.test.ts(승인함 목록) 와
 * lib/server/integration/portal-delegation-push.test.ts(위임 받아 적기).
 *
 * 여기서 지키는 것:
 *  1. 토큰 검증이 **먼저** 오고, 실패하면 아무것도 하지 않는다.
 *  2. 🔴 대상 사용자를 **쿼리 문자열에서 읽지 않는다.**
 *  3. 🔴 기준 주소를 **요청 머리말에서 얻지 않는다.**
 *  4. 통로마다 **자기 용도의 토큰**만 받는다.
 *  5. 쓰기는 기존 저장 함수를 그대로 부른다(권한 판정을 새로 쓰지 않는다).
 *
 * 🔴 **넷째(위임)는 2번이 다르다.** 앞 셋은 「이 사람의 알림·결재」를 내주는 통로라
 * 대상을 토큰의 `sub` 에서만 꺼내는 것이 가장 중요한 울타리였는데, 위임 통로는
 * **포털이 남의 위임을 써 주는** 자리라 대상이 몸통에 온다(토큰의 `sub` 는 부른
 * 주체다). 그 통로의 울타리는 토큰의 **쓰임새**로 옮겨가 있다 — 아래 넷째 묶음.
 * ============================================================================
 */

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

const feed = source("src/app/api/integration/notifications/route.ts");
const settings = source("src/app/api/integration/notification-settings/route.ts");
const approvals = source("src/app/api/integration/approvals/route.ts");

/**
 * 🔴 **주석을 걷어낸 코드만.** 위임 통로의 머리말에는 규약이 통째로 적혀 있어
 * (`not_applicable` · `error_description` · 금지된 이름들이 전부 설명으로 나온다),
 * 주석을 둔 채로 세면 **「없어야 한다」가 영영 실패하고 「있어야 한다」는 주석만으로
 * 통과한다.** 이 저장소에서 실제로 겪은 모양이다
 * (server/actions/portal-delegation-wiring.test.ts 의 같은 헬퍼).
 */
function codeOnly(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const delegations = codeOnly("src/app/api/integration/delegations/route.ts");

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

describe("통합 승인함 통로", () => {
  test("🔴 토큰 검증이 먼저다 — 실패하면 401 로 끝나고 조회에 닿지 않는다", () => {
    const verifyAt = approvals.indexOf("await verifyPortalServiceToken(");
    const rejectAt = approvals.indexOf("if (!verified.ok) {");
    const workAt = approvals.indexOf("buildPortalApprovalInbox({");
    assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    assert.ok(workAt > rejectAt, "거절하기 전에 결재 목록을 뽑는다");
    assert.match(approvals, /status: 401/);
    // 토큰을 꺼내는 자리도 `Authorization` 머리말 하나다 — 쿼리로 받으면 그 값이
    // 접근 로그에 그대로 남는다.
    assert.match(approvals, /readBearerToken\(request\.headers\.get\("authorization"\)\)/);
  });

  test("🔴 대상 사용자는 토큰에서만 온다 — ?sub= 를 붙여도 읽을 자리가 없다", () => {
    // 이게 가장 중요한 울타리다. 뚫리면 토큰 하나로 아무의 결재함이나 열린다.
    for (const forbidden of [
      "searchParams",
      "nextUrl",
      "?sub=",
      'get("sub")',
      "params.sub",
      "request.url",
      "request.json",
    ]) {
      assert.ok(!approvals.includes(forbidden), `부르는 쪽이 대상을 고를 자리가 있다: ${forbidden}`);
    }
    assert.match(approvals, /subject: verified\.subject/);
  });

  test("🔴 기준 주소는 환경에서 온다 — Host 머리말을 읽지 않는다", () => {
    assert.match(approvals, /baseUrl: getAppBaseUrl\(\)/);
    for (const forbidden of ['headers.get("host")', '"x-forwarded-host"', "request.url"]) {
      assert.ok(!approvals.includes(forbidden), `부르는 쪽이 정하는 주소를 쓴다: ${forbidden}`);
    }
  });

  test("알림 설정용 토큰으로는 열리지 않는다", () => {
    // 🔴 지금은 알림 읽기 토큰을 그대로 요구한다(라우트 머리말의 까닭 — 쓰임새
    // 글자는 포털과의 약속이라 `dss-auth` 가 먼저 구워야 바꿀 수 있다). 쓰임새를
    // 옮기는 날 이 줄이 함께 바뀐다.
    assert.match(approvals, /PORTAL_TOKEN_PURPOSES\.notificationsRead/);
    for (const forbidden of ["notificationSettingsRead", "notificationSettingsWrite"]) {
      assert.ok(!approvals.includes(forbidden), `설정용 토큰을 받는다: ${forbidden}`);
    }
  });

  test("🔴 자격 판정을 새로 쓰지 않는다 — 기존 조회 셋을 그대로 넘긴다", () => {
    assert.match(approvals, /listRepairCaseApprovals: listRepairCasesPendingMyApproval/);
    assert.match(approvals, /listQuoteApprovals: listQuoteApprovalsPendingMyApproval/);
    // 🔴 **이 한 줄이 기타건 결재를 통합 승인함에 세우는 전부다**(2026-11-06).
    //    포털은 「누구에게 생겼다」만 받고 내용은 이 통로로 **되물어** 간다 — 미는 쪽만
    //    달고 여기를 빠뜨리면 포털이 202 를 주고 로그도 깨끗한데 알림은 영영 안 간다.
    //    그 실패는 A/S 안에서 아무 표시도 남기지 않으므로 글자로 못 박는다.
    assert.match(
      approvals,
      /listDomesticOrderApprovals: listDomesticOrderApprovalsPendingMyApproval/
    );
    // 라우트가 스스로 SQL 을 쓰거나 역할을 비교하면 판정이 두 벌이 된다.
    for (const forbidden of ["db.select", "drizzle-orm", '=== "ADMIN"', '=== "SUPER_ADMIN"', "role ==="]) {
      assert.ok(!approvals.includes(forbidden), `라우트가 직접 판정한다: ${forbidden}`);
    }
  });

  test("🔴 읽기 전용이다 — 승인·반려를 실행하는 길이 없다", () => {
    // [승인하기] 는 href 가 가리키는 A/S 화면으로 건너가기만 한다(2026-10-23 결정).
    for (const method of ["export async function POST", "export async function PUT", "export async function PATCH", "export async function DELETE"]) {
      assert.ok(!approvals.includes(method), `쓰는 메서드가 생겼다: ${method}`);
    }
    assert.match(approvals, /export async function GET/);
  });

  test("응답이 캐시되지 않는다", () => {
    assert.match(approvals, /"cache-control": "no-store"/);
  });
});

describe("결재권 위임을 받아 적는 통로", () => {
  // 🔴 **포털이 써 주는** 자리다(설계 B-12, 2026-11-16). 앞 셋과 방향이 반대라
  // 울타리도 다르다 — 아래 주석들이 그 차이를 짚는다. 판정은 실제로 돌려 본다
  // (lib/server/integration/portal-delegation-push.test.ts).
  //
  // 🔵 이 묶음만 **주석을 걷어낸 소스**를 본다(codeOnly). 표본이 비지 않았는지
  // 먼저 확인한다 — 걷어내다 통째로 날리면 아래 「없어야 한다」가 전부 공짜로 통과한다.

  test("🔵 표본이 비어 있지 않다 — 주석을 걷어낸 뒤에도 라우트 코드가 남아 있다", () => {
    assert.ok(delegations.trim().length > 500, "주석을 걷어내니 아무것도 안 남았다");
    assert.ok(!delegations.includes("============"), "주석이 덜 걷혔다");
  });

  test("🔴 토큰 검증이 먼저다 — 실패하면 401 로 끝나고 몸통을 읽지도 않는다", () => {
    const verifyAt = delegations.indexOf("await verifyPortalServiceToken(");
    const rejectAt = delegations.indexOf("if (!verified.ok) {");
    const readBodyAt = delegations.indexOf("await request.json()");
    const workAt = delegations.indexOf("applyPortalDelegationPush(");
    assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    assert.ok(readBodyAt > rejectAt, "거절하기 전에 몸통을 읽는다");
    assert.ok(workAt > readBodyAt, "거절하기 전에 저장한다");
    assert.match(delegations, /status: 401/);
    assert.match(
      delegations,
      /readBearerToken\(request\.headers\.get\("authorization"\)\)/,
      "토큰을 머리말이 아닌 데서 꺼낸다 — 쿼리는 접근 로그에 그대로 남는다"
    );
  });

  test("🔴 **쓰기 전용 쓰임새**만 받는다 — 종을 그리려고 구운 토큰으로 결재권을 맡길 수 없다", () => {
    // 이게 이 통로의 가장 중요한 울타리다. 앞 셋은 대상이 토큰 안에서만 와서
    // 「남의 것을 볼 수 없음」이 토큰 모양으로 지켜졌는데, 여기는 대상이 몸통에
    // 오므로 **토큰의 쓰임새**가 그 자리를 대신한다.
    assert.match(delegations, /PORTAL_TOKEN_PURPOSES\.delegationsWrite/);
    for (const forbidden of [
      "notificationsRead",
      "notificationSettingsRead",
      "notificationSettingsWrite",
    ]) {
      assert.ok(!delegations.includes(forbidden), `다른 통로의 토큰을 받는다: ${forbidden}`);
    }
  });

  test("🔴 대상은 **몸통 하나**에서만 온다 — 쿼리 문자열도 토큰의 sub 도 읽지 않는다", () => {
    // 입구가 둘이 되면 어느 쪽이 이기는지를 세 시스템이 다르게 구현한다.
    for (const forbidden of ["searchParams", "nextUrl", "params.sub", "request.url"]) {
      assert.ok(!delegations.includes(forbidden), `입구가 하나가 아니다: ${forbidden}`);
    }
    // 🔴 **토큰의 `sub` 로 줄을 쓰면 안 된다.** 검증기가 sub 없는 토큰을 거절하므로
    //    포털이 아무나 한 사람을 싣는데, 그 값을 위임 당사자로 쓰면 포털이 어느
    //    계정으로 토큰을 구웠느냐에 따라 **엉뚱한 사람의 결재권**이 넘어간다.
    //    🔵 앞 셋과 정반대의 단언이다(그쪽은 `subject: verified.subject` 를 요구한다).
    assert.ok(
      !delegations.includes("verified.subject"),
      "🔴 토큰의 sub 로 위임 당사자를 정한다 — 엉뚱한 사람의 결재권이 넘어간다"
    );
  });

  test("🔴 모양 검사와 저장을 라우트가 새로 쓰지 않는다 — 기존 함수를 그대로 꽂는다", () => {
    assert.match(delegations, /parsePortalDelegationPush\(body\)/);
    assert.match(delegations, /lookupUserIdsBySubjects: listUserIdsBySsoSubjects/);
    assert.match(delegations, /storeDelegation: storePortalApprovalDelegation/);
    assert.match(delegations, /revokeDelegation: revokePortalApprovalDelegation/);
    // 🔴 **열쇠 변환을 새로 만들지 않는다.** 조각 3a 가 만든 조회가 「지워진 계정을
    // 뺀다」까지 지키고 있어서, 라우트가 제 나름대로 찾으면 그 규칙이 빠진다.
    for (const forbidden of ["db.select", "drizzle-orm", "ssoSubject", "eq("]) {
      assert.ok(!delegations.includes(forbidden), `라우트가 직접 질의한다: ${forbidden}`);
    }
  });

  test("🔴 `not_applicable` 을 라우트가 만들지 않는다 — 판단한 그대로 200 으로 내보낸다", () => {
    // 라우트가 그 글자를 직접 적기 시작하면 「해당 없음」의 조건이 두 곳이 된다.
    assert.ok(
      !delegations.includes("not_applicable"),
      "라우트가 outcome 을 스스로 만든다 — 판단이 두 곳이 됐다"
    );
    assert.match(delegations, /NextResponse\.json\(\{ outcome \}/);
  });

  test("🔴 오류 몸통이 통로 규약대로다 — 세 시스템이 글자 그대로 같아야 한다", () => {
    // 이 집의 다른 통로는 `{ error, message }` 를 쓴다. 여기만 다른 것은 받는 쪽이
    // 사람이 아니라 포털이고, 그 규약이 `error_description` 이기 때문이다.
    assert.match(delegations, /error_description/);
    assert.ok(
      !/\{ error: "[a-z_]+", message:/.test(delegations),
      "규약과 다른 오류 몸통이 섞였다"
    );
    for (const expected of ["invalid_token", "invalid_request", "server_error"]) {
      assert.ok(delegations.includes(expected), `오류 이름이 빠졌다: ${expected}`);
    }
    assert.match(delegations, /status: 400/);
    assert.match(delegations, /status: 500/);
  });

  test("🔴 결재 판정에 연결하지 않는다 — 이 표를 읽어 결재를 가르는 것은 조각 8 이다", () => {
    for (const forbidden of [
      "resolveActingApproverUserIds",
      "actingApproverUserIds",
      "resolvePortalRouteDelegations",
    ]) {
      assert.ok(!delegations.includes(forbidden), `받는 통로가 판정을 건드린다: ${forbidden}`);
    }
  });

  test("받아 적는 길은 POST 하나다", () => {
    assert.match(delegations, /export async function POST/);
    for (const method of [
      "export async function GET",
      "export async function PUT",
      "export async function PATCH",
      "export async function DELETE",
    ]) {
      assert.ok(!delegations.includes(method), `다른 메서드가 생겼다: ${method}`);
    }
  });

  test("응답이 캐시되지 않는다 — 재시도가 옛 답을 받으면 안 된다", () => {
    assert.match(delegations, /"cache-control": "no-store"/);
  });
});
