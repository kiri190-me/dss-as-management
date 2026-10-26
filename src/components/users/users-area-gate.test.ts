import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
} from "@/lib/domain/shipment-approval-route";
import { delegateCandidateLabel } from "./approval-route-delegation-view";
import { initialUsersTab, visibleUsersTabKeys, USERS_TAB_KEYS } from "./users-tab-access";

/**
 * ============================================================================
 * 결재선에 올라 있는 사람의 문 — 2026-10-26 눈 확인에서 잡힌 결함
 * ============================================================================
 * 「결재권 위임」 탭을 「조건 없이 늘 보인다」로 만들었는데, **엔지니어는 그 화면에
 * 애초에 들어갈 수가 없었다.** 운영·개발 DB 의 `role_permissions` 에 이렇게
 * 저장돼 있기 때문이다(2026-08-19 에 일부러 끈 설정):
 *
 *     AS_ENGINEER · SALES · INVENTORY_MANAGER   users.view = NONE
 *
 * 코드의 기본 정책은 「로그인한 누구나 read」지만 **저장값이 기본을 이긴다.** 그래서
 * 메뉴에 [사용자 관리]가 아예 안 뜨고, 결재선에 박힌 사람이 자리를 비울 때
 * **관리자에게 부탁하는 수밖에** 없었다 — 「본인도 설정할 수 있다」는 결정과 정면으로
 * 어긋난다.
 *
 * 🔴 **저장값을 되돌려 고치지 않았다.** 되돌리면 엔지니어에게 사용자 목록과 역할
 * 설정이 통째로 열린다. 코드로 **문 하나만** 열었고, 이 파일이 그 문의 모양을
 * 지킨다:
 *
 *   ㉠ 판정이 적힌 곳이 **한 함수**이고, 메뉴 · 안내 화면 · 페이지 셋이 그것을 본다.
 *   ㉡ 그 판정은 **지금 쓰이는 판**만 본다 — 옛 판에 있던 사람은 안 열린다.
 *   ㉢ 열리는 것은 **탭 하나**뿐이다.
 *   ㉣ 🔴 그 사람의 HTML 에 **사용자 목록이 실려 나가지 않는다.**
 *
 * 🔵 「실제로 열리는가/안 열리는가」는 실제 DB 로 돈다
 * (db/mutations/shipment-approval-routes.integration.test.ts 의
 * isOnCurrentShipmentApprovalRoute). 여기서는 **구조**를 지킨다 — 화면 본체는
 * 서버 액션을 가져오는 클라이언트 컴포넌트라 렌더할 수 없다.
 * ============================================================================
 */

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/** 주석은 경위를 적는 자리다 — 지키는 것은 코드뿐이다(이웃 시험과 같은 규칙). */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const flat = (source: string) => source.replace(/\s+/g, " ");

const layoutCode = withoutComments(read("src/app/(app)/layout.tsx"));
const noAccessCode = withoutComments(read("src/app/(app)/no-access/page.tsx"));
const pageCode = withoutComments(read("src/app/(app)/users/page.tsx"));
const screenCode = withoutComments(read("src/components/users/RepresentativeManagementScreen.tsx"));
const sectionCode = withoutComments(
  read("src/components/users/ApprovalRouteDelegationSection.tsx")
);
const areaAccessCode = withoutComments(read("src/lib/auth/users-area-access.ts"));
const routeQueriesCode = withoutComments(read("src/lib/db/queries/shipment-approval-routes.ts"));
const delegationQueriesCode = withoutComments(
  read("src/lib/db/queries/approval-route-delegations.ts")
);
const navigationCode = withoutComments(read("src/lib/navigation.ts"));

describe("㉠ 메뉴와 페이지가 같은 판정을 본다", () => {
  test("🔴 판정이 적힌 곳은 한 함수다 — 메뉴 · 안내 화면 · 페이지 셋이 그것을 부른다", () => {
    // 두 벌로 적히면 「메뉴에는 뜨는데 눌러도 쫓겨난다」(또는 그 반대)가 되고,
    // 그 어긋남은 오류를 내지 않아 사람이 포기할 때까지 조용하다.
    for (const [label, source] of [
      ["레이아웃(사이드바)", layoutCode],
      ["안내 화면(지금 이용할 수 있는 메뉴)", noAccessCode],
      ["/users 페이지", pageCode],
    ] as const) {
      assert.match(
        source,
        /from "@\/lib\/auth\/users-area-access"/,
        `${label}: 공통 판정을 가져오지 않는다`
      );
      assert.match(flat(source), /resolveUsersAreaAccess\(/, `${label}: 공통 판정을 부르지 않는다`);
    }
  });

  test("🔴 메뉴와 페이지가 같은 값을 본다 — mayEnterUsersArea", () => {
    assert.match(
      flat(layoutCode),
      /mayEnterUsersArea: usersAreaAccess\.mayEnterUsersArea,/,
      "레이아웃이 그 값을 메뉴 쪽으로 안 넘긴다"
    );
    assert.match(
      flat(noAccessCode),
      /mayEnterUsersArea: usersAreaAccess\.mayEnterUsersArea,/,
      "안내 화면이 그 값을 안 넘긴다"
    );
    assert.match(
      flat(pageCode),
      /if \(!usersAreaAccess\.mayEnterUsersArea\) \{ redirect\(/,
      "페이지가 같은 값으로 막지 않는다"
    );
  });

  test("🔴 옛 영역 가드를 **대신**한다 — 둘을 함께 두면 거기서 먼저 쫓겨난다", () => {
    assert.ok(
      !/requireAreaAccess\(/.test(pageCode),
      "페이지가 아직 영역 가드로도 막는다 — 결재선으로 들어온 사람이 거기서 쫓겨난다"
    );
    // 막혔을 때 가는 곳은 그 함수와 같은 안내 화면이어야 한다(까닭을 읽는 자리다).
    assert.match(flat(pageCode), /redirect\(`\/no-access\?area=\$\{encodeURIComponent\(USERS_AREA_KEY\)\}`\)/);
  });

  test("🔴 메뉴 항목은 그 값 하나로 정해진다 — 설정값을 한 번 더 합치지 않는다", () => {
    assert.match(
      flat(navigationCode),
      /if \(item\.key === USERS_NAV_KEY\) return flags\.mayEnterUsersArea;/,
      "메뉴 필터가 그 값 하나로 정하지 않는다"
    );
  });

  test("🔴 `hiddenFromMenu` 가 여전히 이긴다 — 이 길이 감춘 메뉴를 되살리지 않는다", () => {
    // 노출을 넓히는 쪽이 감추기를 되살리면 「권한을 열었더니 이관한 메뉴가
    // 돌아왔다」가 되고, 그때 사람은 그 화면을 다시 쓰기 시작한다. 순서로 지킨다.
    const code = flat(navigationCode);
    const hiddenAt = code.indexOf("if (item.hiddenFromMenu) return false;");
    const devAt = code.indexOf("if (item.key === DEVELOPER_MODE_NAV_KEY)");
    const usersAt = code.indexOf("if (item.key === USERS_NAV_KEY)");
    assert.ok(hiddenAt > 0, "감춘 항목 검사를 찾지 못했다");
    assert.ok(usersAt > hiddenAt, "새 길이 감춘 항목 검사보다 앞으로 왔다");
    assert.ok(devAt > hiddenAt, "개발자 모드 길이 감춘 항목 검사보다 앞으로 왔다");
  });
});

describe("㉡ 지금 쓰이는 판만 본다", () => {
  test("🔴 표 전체가 아니라 **현재 판**의 단계만 센다", () => {
    assert.match(
      flat(areaAccessCode),
      /isOnCurrentShipmentApprovalRoute\(userId\)/,
      "결재선 판정을 부르지 않는다"
    );
    assert.match(
      flat(routeQueriesCode),
      /inArray\( shipmentApprovalRouteSteps\.routeId, currentRouteIdsSubquery\(EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\) \)/,
      "표 전체를 보고 있다 — 한 번이라도 올랐던 사람이 영원히 열린다"
    );
  });

  test("「현재 판」의 규칙이 옆 조회와 같다 — 용도 안에서 version 이 가장 큰 판", () => {
    assert.match(
      flat(routeQueriesCode),
      /selectDistinctOn\(\[shipmentApprovalRoutes\.scope\], \{ id: shipmentApprovalRoutes\.id \}\) \.from\(shipmentApprovalRoutes\) \.where\(inArray\(shipmentApprovalRoutes\.scope, \[\.\.\.scopes\]\)\) \.orderBy\(shipmentApprovalRoutes\.scope, desc\(shipmentApprovalRoutes\.version\)\)/,
      "현재 판을 고르는 규칙이 달라졌다"
    );
    // 🔵 두 적음이 **같은 답**을 주는지는 실제 DB 로 맞대어 본다
    //    (db/mutations/shipment-approval-routes.integration.test.ts).
    assert.match(
      flat(routeQueriesCode),
      /\.where\(eq\(shipmentApprovalRoutes\.scope, scope\)\) \.orderBy\(desc\(shipmentApprovalRoutes\.version\)\) \.limit\(1\)/,
      "옆 조회의 규칙이 달라졌다 — 맞댈 기준이 사라졌다"
    );
  });

  test("🔴 레이아웃이 조회를 줄 세우지 않는다 — 모든 화면이 그 왕복을 치른다", () => {
    assert.match(
      flat(layoutCode),
      /const \[accessibleAreaKeys, usersAreaAccess\] = await Promise\.all\(\[ listAccessibleAreaKeys\(user\), resolveUsersAreaAccess\(user\), \]\);/,
      "새 조회가 기존 조회와 같은 묶음으로 가지 않는다"
    );
    // 요청 한 번에 한 번만 실제로 묻는다 — 레이아웃과 페이지가 각각 부른다.
    // 🔴 열쇠가 글자 하나여야 캐시가 맞는다(사람 객체를 넘기면 한 번도 안 맞는다).
    assert.match(flat(areaAccessCode), /cache\(async \(userId: string\)/, "요청 단위로 묶지 않는다");
  });

  test("데모 모드에서는 묻지 않는다 — 레이아웃이 던지면 모든 화면이 깨진다", () => {
    assert.match(
      flat(areaAccessCode),
      /if \(getAuthSource\(\) !== "database"\) return false;/,
      "데이터베이스 모드가 아닐 때 닫히는 쪽으로 물러서지 않는다"
    );
  });

  test("🔴 세는 용도를 글자로 적지 않았다 — [승인 절차] 탭이 그리는 목록과 한 벌이다", () => {
    // 2026-10-26 눈 확인: 사용자가 [승인 절차] 탭에서 이름을 다 뺐는데도 메뉴가
    // 남아 있었다. 그 탭이 그리는 용도가 둘뿐이라 부품 불출 판에 남은 이름은 **뺄
    // 화면이 없었기** 때문이다. 목록이 두 벌로 적히면 한쪽만 바뀌는 날이 오고,
    // 그때 다시 「닫는 길이 없는 문」이 생긴다.
    assert.match(
      flat(routeQueriesCode),
      /currentRouteIdsSubquery\(EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\)/,
      "문이 세는 용도가 그 상수에서 오지 않는다"
    );
    assert.match(
      flat(routeQueriesCode),
      /import \{ EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES, type ShipmentApprovalRouteScope, \} from "@\/lib\/domain\/shipment-approval-route";/,
      "상수를 도메인에서 가져오지 않는다"
    );
    // 🔴 조회 파일 어디에도 용도의 **코드 값**이 글자로 없다. 하나라도 적히면
    //    목록이 두 벌이 되기 시작한 것이다(지금은 전부 상수와 인자로만 다룬다).
    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      assert.ok(
        !routeQueriesCode.includes(`"${scope}"`),
        `용도를 글자로 적었다: ${scope} — 목록이 두 벌이 된다`
      );
    }
    // 🔵 재는 것이 비어 있지 않은지. 안 세는 용도가 하나도 없으면 위 단언들은
    //    「좁혔다」를 재는 것이 아니라 아무것도 아닌 것이 된다.
    assert.ok(
      SHIPMENT_APPROVAL_ROUTE_SCOPES.length > EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES.length,
      "표의 용도와 고칠 수 있는 용도가 같아졌다 — 이 좁히기에 뜻이 없어졌다"
    );
    assert.deepEqual(
      [...EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES],
      ["FINAL_SHIPMENT", "QUOTE"],
      "고칠 수 있는 용도가 바뀌었다 — 그러면 메뉴가 열리는 근거도 함께 바뀐다"
    );
    // 🔵 「부품 불출 결재선에만 있으면 안 열린다」가 **실제로** 그런지는 실제 DB 로
    //    돈다(db/mutations/shipment-approval-routes.integration.test.ts).
  });
});

describe("㉢ 열리는 것은 탭 하나뿐이다", () => {
  const ADMIN = {
    canViewUsersAdminTabs: true,
    hasRolePermissions: true,
    canManageDeveloperFlag: true,
  };
  const ENGINEER_ON_ROUTE = {
    canViewUsersAdminTabs: false,
    hasRolePermissions: false,
    canManageDeveloperFlag: false,
  };

  test("🔴 재려는 것이 비어 있지 않다 — 탭 열쇠가 다섯이다", () => {
    assert.deepEqual(
      [...USERS_TAB_KEYS],
      ["representatives", "approvalRoute", "routeDelegation", "permissions", "developer"]
    );
  });

  test("🔴 권한 없이 들어온 사람에게는 탭이 하나다", () => {
    assert.deepEqual(visibleUsersTabKeys(ENGINEER_ON_ROUTE), ["routeDelegation"]);
    assert.equal(initialUsersTab(ENGINEER_ON_ROUTE), "routeDelegation");
  });

  test("권한이 있는 사람에게는 탭 다섯이 그대로다", () => {
    assert.deepEqual(visibleUsersTabKeys(ADMIN), [...USERS_TAB_KEYS]);
    assert.equal(initialUsersTab(ADMIN), "representatives");
  });

  test("🔴 관리 탭 둘이 그 값 하나로 함께 움직인다 — 다른 탭을 건드리지 않는다", () => {
    const withPermission = visibleUsersTabKeys({ ...ADMIN, canViewUsersAdminTabs: true });
    const without = visibleUsersTabKeys({ ...ADMIN, canViewUsersAdminTabs: false });
    assert.deepEqual(
      withPermission.filter((key) => !without.includes(key)),
      ["representatives", "approvalRoute"],
      "그 값이 움직이는 탭이 둘이 아니다"
    );
  });

  test("🔴 처음 보여 줄 탭은 보이는 것 가운데 첫째다 — 빈 화면이 생기지 않는다", () => {
    for (const canViewUsersAdminTabs of [false, true]) {
      for (const hasRolePermissions of [false, true]) {
        for (const canManageDeveloperFlag of [false, true]) {
          const flagSet = { canViewUsersAdminTabs, hasRolePermissions, canManageDeveloperFlag };
          assert.ok(
            visibleUsersTabKeys(flagSet).includes(initialUsersTab(flagSet)),
            `처음 탭이 안 보이는 탭이다: ${JSON.stringify(flagSet)}`
          );
        }
      }
    }
  });

  test("🔴 탭이 하나뿐이면 탭 줄을 안 그린다", () => {
    // 한 칸짜리 탭 줄은 「나머지가 안 그려졌다」로 읽힌다. 묶음 자신이 제목을
    // 들고 있어 잃는 것도 없다.
    assert.match(flat(screenCode), /\{visibleTabs\.length > 1 && \(/, "탭 줄이 늘 그려진다");
    assert.match(flat(sectionCode), /<h2[^>]*>결재권 위임<\/h2>/, "묶음에 제목이 없다");
  });

  test("머리말도 그 사람에게 맞는 말을 한다 — 「대표 지정」은 거짓말이 된다", () => {
    assert.match(
      flat(screenCode),
      /\{canViewUsersAdminTabs \? "최종 출하 승인 대표 지정과 대리 승인\(위임\)을 관리합니다\." : "자리를 비우는 동안 내 결재 단계를 대신 처리할 사람을 지정합니다\."\}/,
      "머리말이 보는 사람에 따라 갈리지 않는다"
    );
  });
});

describe("㉣ 사용자 목록이 새어 나가지 않는다", () => {
  test("🔴 관리 탭의 자료는 그 권한이 있을 때만 **읽는다**", () => {
    // 클라이언트 컴포넌트에 넘긴 값은 그리지 않아도 HTML 에 실려 나간다 —
    // 탭을 안 그리는 것만으로는 아무것도 못 막는다.
    for (const [label, call] of [
      ["계정 목록", "listUsersForRepresentativeManagement()"],
      ["모두의 출하 대표 위임", "listShipmentDelegations()"],
      ["결재선 후보(이메일 + 포털 번호)", "listSelectableApproverCandidates()"],
    ] as const) {
      assert.ok(
        flat(pageCode).includes(`canViewUsersAdminTabs ? ${call} : Promise.resolve([])`),
        `${label}: 권한 없이도 읽는다`
      );
    }
    assert.match(
      flat(pageCode),
      /canViewUsersAdminTabs \? Promise\.all\( EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\.map\(/,
      "결재선 판(승인자 이름)을 권한 없이도 읽는다"
    );
  });

  test("🔴 「대리 결재자」 고르개는 이름까지만 내려간다", () => {
    assert.match(
      flat(screenCode),
      /allUsers=\{delegateCandidates\}/,
      "결재권 위임 묶음이 아직 전체 계정 목록을 받는다"
    );
    assert.match(
      flat(sectionCode),
      /allUsers: ApprovalRouteDelegateCandidate\[\];/,
      "그 묶음의 prop 타입이 좁혀져 있지 않다"
    );
    // 좁은 조회가 싣는 칸은 셋뿐이다 — 역할도 포털 번호도 없다.
    assert.match(
      flat(delegationQueriesCode),
      /\.select\(\{ id: users\.id, name: users\.name, email: users\.email \}\)/,
      "좁은 조회가 더 많은 칸을 싣는다"
    );
    for (const forbidden of ["ssoSubject", "users.role"]) {
      assert.ok(
        !flat(delegationQueriesCode).includes(forbidden),
        `좁은 조회가 ${forbidden} 까지 싣는다`
      );
    }
  });

  test("🔴 이메일은 관리 권한이 있을 때만 내려간다", () => {
    assert.match(
      flat(pageCode),
      /email: canViewUsersAdminTabs \? candidate\.email : null,/,
      "권한 없이 들어온 사람에게도 이메일이 내려간다"
    );
    // 없을 때 `이름 (null)` 이 찍히지 않는다 — 값으로 본다.
    assert.equal(delegateCandidateLabel({ name: "홍길동", email: null }), "홍길동");
    assert.equal(delegateCandidateLabel({ name: "홍길동", email: "a@b.test" }), "홍길동 (a@b.test)");
  });

  test("🔴 「모두의 결재권 위임」은 그대로 막혀 있다 — 이 문이 그것까지 열지 않는다", () => {
    // 그 묶음은 조회 자신이 MANAGE 를 묻는다(앞 조각). 결재선으로 들어온 사람에게는
    // 거절되어 자료가 null 이고, 그러면 묶음이 아예 없다.
    assert.match(
      flat(delegationQueriesCode),
      /if \(!\(await hasPermission\(actor, "users\.shipmentRepresentatives", "MANAGE"\)\)\) \{ return \{ ok: false, reason: "FORBIDDEN" \}; \}/,
      "모두의 목록의 인가가 사라졌다"
    );
    assert.match(flat(sectionCode), /\{allRouteDelegations && \( <>/, "묶음이 자료로 여닫히지 않는다");
  });
});
