import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES,
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
} from "@/lib/domain/shipment-approval-route";
import { PART_ISSUE_APPROVAL_ROUTE_SCOPE } from "@/lib/domain/inventory-part-issue-rules";

/**
 * ============================================================================
 * 승인 절차 탭 — 용도를 고르고, 그 용도에만 저장한다
 * ============================================================================
 * 저장 경로는 이미 다 되어 있다(db/mutations/shipment-approval-routes.integration
 * .test.ts 가 실제 DB 로 용도별 판 쌓기·단계 0개 저장까지 못 박는다). 여기서
 * 지키는 것은 **화면이 그 경로를 올바로 부르는가**다:
 *  · 고른 용도의 판을 보여 주고, 저장은 **그 용도로** 간다.
 *  · 용도를 바꿔도 편집 중이던 것이 다른 용도로 새어 나가지 않는다.
 *  · 🔴 **단계 0개로 저장하는 길을 화면이 막지 않는다** — 판은 지우지 않으므로
 *    0개짜리 판을 얹는 것이 절차를 끄는 유일한 출구다. 여기가 잠기면 한 번 켠
 *    「부품 불출」 승인을 되돌릴 방법이 영영 없어진다(=재고가 잠긴 채 남는다).
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * ShipmentApprovalRouteSection 은 **서버 액션을 직접 import 하는 클라이언트
 * 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * test:components 에서는 import 자체가 던진다. 그래서 이웃 시험
 * (inventory/part-issue-approval-screen.test.tsx)과 같은 방법으로 원본을 글자로
 * 읽어 확인하고, 순수한 규칙은 도메인 시험이 값으로 본다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 원본에서 **한 갈래만** 잘라낸다 — 파일 전체에 정규식을 걸면 이웃 갈래에 걸린다. */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const sectionSource = read("src/components/users/ShipmentApprovalRouteSection.tsx");
const screenSource = read("src/components/users/RepresentativeManagementScreen.tsx");
const usersPageSource = read("src/app/(app)/users/page.tsx");
const routeActionSource = read("src/lib/server/actions/shipment-approval-routes.ts");
const routeMutationSource = read("src/lib/db/mutations/shipment-approval-routes.ts");

describe("탭 이름", () => {
  test("🔴 탭은 「승인 절차」다 — 출하만의 것이 아니게 됐다", () => {
    const tabButton = sliceBetween(
      screenSource,
      'onClick={() => setActiveTab("approvalRoute")}',
      "</button>"
    );
    assert.match(flat(tabButton), /> 승인 절차 $/, "탭 이름이 「승인 절차」가 아니다");
    assert.ok(
      !/출하 승인 절차/.test(tabButton),
      "탭 이름에 「출하」가 남아 있다 — 재고 담당자의 절차도 여기서 정한다"
    );
  });

  test("탭 안의 묶음 제목도 「승인 절차」다", () => {
    assert.match(flat(sectionSource), /<h2[^>]*>승인 절차<\/h2>/);
  });
});

describe("용도 고르기", () => {
  test("🔴 고를 수 있는 용도는 도메인의 목록에서 나온다 — 화면이 따로 세지 않는다", () => {
    assert.match(
      flat(sectionSource),
      /import \{[^}]*\bSHIPMENT_APPROVAL_ROUTE_SCOPES\b[^}]*\} from "@\/lib\/domain\/shipment-approval-route"/,
      "용도 목록을 도메인에서 가져오지 않는다"
    );
    assert.match(
      flat(sectionSource),
      /SHIPMENT_APPROVAL_ROUTE_SCOPES\.map\(\(routeScope\) => \( <option key=\{routeScope\} value=\{routeScope\}> \{SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS\[routeScope\]\} <\/option>/,
      "용도 목록을 돌며 이름표로 그리는 자리가 사라졌다"
    );
  });

  test("🔴 이름표는 한 곳에서만 온다 — 코드 값을 화면에 보여 주지 않는다", () => {
    for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      const label = SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[scope];
      assert.ok(
        !new RegExp(`"${label}"`).test(sectionSource),
        `${scope}: 이름표(${label})를 화면에 글자로 박았다 — 이름표가 적힌 곳은 도메인 하나여야 한다`
      );
    }
    // 코드 값이 글자로 적힌 자리는 「처음 보여 줄 용도」 하나뿐이고, 그것도
    // 사람에게 보이는 값이 아니다.
    assert.equal(
      [...sectionSource.matchAll(/"FINAL_SHIPMENT"/g)].length,
      1,
      "코드 값을 여러 곳에 적었다"
    );
    assert.match(
      flat(sectionSource),
      /const DEFAULT_SCOPE: ShipmentApprovalRouteScope = "FINAL_SHIPMENT";/,
      "코드 값이 처음 보여 줄 용도를 정하는 자리 밖에서 쓰인다"
    );
    // 부품 불출 쪽은 이미 이름 붙은 상수가 있다 — 글자로 적으면 오타 하나가
    // 「판이 없다」로 조용히 보인다.
    assert.ok(!/"PART_ISSUE"/.test(sectionSource), "용도를 글자로 적었다");
    assert.match(flat(sectionSource), /\bPART_ISSUE_APPROVAL_ROUTE_SCOPE\b/);
  });

  test("고른 값을 그대로 믿지 않는다 — 도메인의 판정으로 좁힌다", () => {
    assert.match(
      flat(sectionSource),
      /if \(isShipmentApprovalRouteScope\(next\)\) changeScope\(next\);/,
      "고른 값을 형변환만으로 통과시키면 목록에 없는 값도 타입만 지난다"
    );
  });
});

describe("🔴 저장은 고른 용도로만 간다", () => {
  test("저장이 보내는 용도는 화면 상태다 — 글자로 못 박혀 있지 않다", () => {
    assert.match(
      flat(sectionSource),
      /saveShipmentApprovalRouteAction\(\{ scope, approverUserIds: steps, \}\)/,
      "저장이 고른 용도와 그 용도의 목록을 보내지 않는다"
    );
  });

  test("🔴 편집 중이던 목록이 용도별로 갈라져 있다 — 다른 용도로 새어 나갈 길이 없다", () => {
    // 목록을 하나만 두고 용도만 갈아 끼우면, 출하 결재선을 짜다가 용도를 바꾸고
    // [저장]을 누른 순간 그 사람들이 부품 불출 절차로 저장된다. 불출 절차는
    // 만들어지는 순간 재고의 [불출]·[사용]을 잠근다.
    assert.match(
      flat(sectionSource),
      /useState<Record<ShipmentApprovalRouteScope, string\[\]>>\(savedByScope\)/,
      "편집 중이던 목록이 용도별로 갈라져 있지 않다"
    );
    assert.match(
      flat(sectionSource),
      /const steps = draftByScope\[scope\];/,
      "저장할 목록과 고른 용도가 같은 열쇠에서 나오지 않는다"
    );
    assert.match(
      flat(sectionSource),
      /setDraftByScope\(\(previous\) => \(\{ \.\.\.previous, \[scope\]: next \}\)\)/,
      "편집이 고른 용도의 자리에 들어가지 않는다"
    );
  });

  test("새 자료가 내려와도 **바뀐 용도만** 되돌린다", () => {
    // 한 용도를 저장했다고 다른 용도의 편집 중이던 목록까지 되돌리면, 사람은
    // 자기가 짜던 것이 왜 사라졌는지 알 수 없다.
    assert.match(flat(sectionSource), /const staleScopes = SHIPMENT_APPROVAL_ROUTE_SCOPES\.filter\(/);
    assert.match(flat(sectionSource), /for \(const routeScope of staleScopes\) next\[routeScope\] = savedByScope\[routeScope\];/);
  });

  test("저장하는 동안에는 용도를 바꿀 수 없다 — 결과 문구가 엉뚱한 절차에 붙지 않는다", () => {
    const scopeSelect = sliceBetween(
      sectionSource,
      'id="shipment-approval-route-scope"',
      "</select>"
    );
    assert.match(flat(scopeSelect), /disabled=\{isSaving\}/);
  });
});

describe("🔴 단계 0개로 저장하는 길", () => {
  test("저장 단추를 잠그는 조건은 「저장 중인가」 하나다", () => {
    // 단계 수로 잠그면 0개짜리 판을 얹을 수 없고, 그 순간 한 번 켠 절차를 끌
    // 방법이 사라진다(판은 지우지 않는다 — append-only).
    assert.match(
      flat(sectionSource),
      /disabled=\{isSaving\} onClick=\{\(\) => void handleSave\(\)\}/,
      "저장 단추의 잠금 조건이 달라졌다 — 단계 수를 보고 잠그면 절차를 끌 수 없다"
    );
  });

  test("저장 앞의 검사는 도메인 함수 하나뿐이다 — 개수로 앞질러 막지 않는다", () => {
    const handleSave = sliceBetween(sectionSource, "async function handleSave()", "const scopeLabel");
    assert.match(flat(handleSave), /validateShipmentApprovalRouteSteps\(steps\)/);
    assert.ok(
      !/steps\.length/.test(handleSave),
      "저장 경로가 단계 수를 스스로 보고 있다 — 0개를 막는 자리가 생길 수 있다"
    );
  });

  test("비우는 중이라는 것을 화면이 말해 준다 — 그것이 절차를 끄는 출구다", () => {
    assert.match(
      flat(sectionSource),
      /이대로 저장하면 승인 절차가 꺼집니다/,
      "저장돼 있던 절차를 비웠을 때 무슨 일이 일어나는지 말해 주지 않는다"
    );
  });
});

describe("🔴 안내는 용도마다 다르다", () => {
  test("빈 상태 문구를 화면이 글자로 들고 있지 않다", () => {
    assert.match(
      flat(sectionSource),
      /SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES\[scope\]/,
      "빈 절차 안내가 용도를 따라가지 않는다"
    );
    assert.ok(
      !/출하 대표로 지정된/.test(sectionSource),
      "출하만을 말하는 문장이 화면에 글자로 남아 있다 — 부품 불출에서는 거짓말이 된다"
    );
  });

  test("🔴 부품 불출에서는 재고 화면이 달라진다는 것을 미리 말해 준다", () => {
    const notice = sliceBetween(
      sectionSource,
      "{scope === PART_ISSUE_APPROVAL_ROUTE_SCOPE && (",
      ")}"
    );
    // 단추 이름은 재고 쪽이 쓰는 그 상수다 — 각자 적으면 같은 단추가 화면마다
    // 다른 이름으로 불린다.
    assert.match(flat(notice), /\$\{PART_ISSUE_REQUEST_BUTTON_LABEL\}/);
    assert.ok(
      !/불출 승인 요청/.test(notice),
      "단추 이름을 글자로 박았다 — 이름이 적힌 곳은 part-issue-approval-texts.ts 하나여야 한다"
    );
    assert.match(flat(notice), /\[불출\]·\[사용\]/, "무엇이 바뀌는지 말해 주지 않는다");
  });

  test("「지금 켜져 있는가」는 서버와 같은 함수로 본다", () => {
    assert.match(
      flat(sectionSource),
      /import \{[^}]*\bisPartIssueApprovalRouteInForce\b[^}]*\} from "@\/lib\/domain\/inventory-part-issue-rules"/,
      "서버가 [불출]에 문을 달 때 보는 그 함수를 화면이 보지 않는다"
    );
    assert.match(
      flat(sectionSource),
      /isPartIssueApprovalRouteInForce\(routes\[PART_ISSUE_APPROVAL_ROUTE_SCOPE\]\)/,
      "편집 중인 목록으로 「지금 이렇습니다」를 말하면 거짓말이 된다 — 저장된 판을 봐야 한다"
    );
  });

  test("용도마다 실제로 다른 말을 한다 — 값으로 확인한다", () => {
    assert.notEqual(
      SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES.FINAL_SHIPMENT,
      SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES[PART_ISSUE_APPROVAL_ROUTE_SCOPE]
    );
    assert.match(
      SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES[PART_ISSUE_APPROVAL_ROUTE_SCOPE],
      /불출/,
      "부품 불출의 안내가 그 용도의 일을 말하지 않는다"
    );
  });
});

describe("🔴 서버 문구도 갈라졌다", () => {
  test("「출하 승인 절차를 변경할 권한이 없습니다」가 남아 있지 않다", () => {
    for (const [name, source] of [
      ["서버 액션", routeActionSource],
      ["mutation", routeMutationSource],
    ] as const) {
      assert.ok(
        !/출하 승인 절차를 변경할 권한이 없습니다/.test(source),
        `${name}: 출하만을 말하는 거절 문구가 남아 있다 — 이제 부품 불출도 이 절차를 탄다`
      );
      assert.match(
        flat(source),
        /"승인 절차를 변경할 권한이 없습니다\."/,
        `${name}: 거절 문구가 사라졌다`
      );
    }
  });

  test("🔴 비웠을 때의 안내는 용도를 따라간다 — 화면과 같은 자리에서 온다", () => {
    assert.match(
      flat(routeActionSource),
      /`승인 절차를 비웠습니다\. \$\{SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES\[validated\.scope\]\}`/,
      "비웠을 때의 문구가 용도를 따라가지 않는다"
    );
    assert.ok(
      !/지금은 출하 대표로 지정된 사용자가/.test(routeActionSource),
      "출하만을 말하는 문장이 서버 액션에 글자로 남아 있다"
    );
  });

});

describe("서버 페이지 · 인가", () => {
  test("🔴 용도 전부의 현재 판을 읽어 내려보낸다 — 한 용도만 읽으면 나머지는 「없음」으로 보인다", () => {
    assert.match(
      flat(usersPageSource),
      /SHIPMENT_APPROVAL_ROUTE_SCOPES\.map\( async \(scope\) => \[scope, await getCurrentShipmentApprovalRoute\(scope\)\] as const \)/,
      "용도 목록을 돌며 읽는 자리가 사라졌다"
    );
    assert.ok(
      !/getCurrentShipmentApprovalRoute\("/.test(usersPageSource),
      "용도를 글자로 적었다 — 새 용도를 더할 때 이 자리가 조용히 빠진다"
    );
  });

  test("🔴 인가는 화면이 계산하지 않는다 — 서버 페이지가 내려보낸 값 하나다", () => {
    assert.ok(
      !/hasPermission/.test(sectionSource),
      "클라이언트가 인가를 스스로 판정하려 한다"
    );
    assert.match(flat(sectionSource), /canManageRepresentatives: boolean;/);
    // 🔴 용도가 늘어도 「절차를 정하는 권한」은 하나다. 용도별 판정을 만들면
    // 이미 저장된 역할별 권한 설정이 새 영역만 빈 채로 남는다.
    assert.ok(
      !/canManage[A-Za-z]*Scope|permissionByScope/.test(sectionSource),
      "용도별 권한 판정이 생겼다 — 절차를 정하는 권한은 하나여야 한다"
    );
  });
});
