import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES,
  SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES,
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
} from "@/lib/domain/shipment-approval-route";

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
 *    승인 절차를 되돌릴 방법이 영영 없어진다.
 *  · 🔴 **「부품 불출」은 이 탭에 없다**(2026-10-18) — 고르개에도, 서버 페이지가
 *    읽는 목록에도, 저장 경로에도 없다. 저장된 판은 표에 그대로 있고 화면이
 *    읽지 않을 뿐이다. 까닭은 domain/shipment-approval-route.ts 의
 *    EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES 머리말에 있다.
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
      /import \{[^}]*\bEDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\b[^}]*\} from "@\/lib\/domain\/shipment-approval-route"/,
      "용도 목록을 도메인에서 가져오지 않는다"
    );
    assert.match(
      flat(sectionSource),
      /EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\.map\(\(routeScope\) => \( <option key=\{routeScope\} value=\{routeScope\}> \{SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS\[routeScope\]\} <\/option>/,
      "용도 목록을 돌며 이름표로 그리는 자리가 사라졌다"
    );
  });

  test("🔴 고르개에 「부품 불출」이 없다 — 넓은 목록을 쓰면 다시 생긴다", () => {
    // 2026-10-18: 재고 관리가 별도 시스템으로 떨어져 나가 그 결재선은 그쪽에서
    // 정한다. 여기 남겨 두면 어느 쪽이 참인지 알 수 없고, 여기서 고쳐도 효과가
    // 없다. **넓은 목록(SHIPMENT_APPROVAL_ROUTE_SCOPES)을 이 화면이 다시 쓰기
    // 시작하면 부품 불출이 조용히 되살아난다** — 그래서 쓰지 않는 것을 못 박는다.
    assert.ok(
      !/\bSHIPMENT_APPROVAL_ROUTE_SCOPES\b/.test(sectionSource),
      "화면이 표의 용도 전부를 쓰고 있다 — 고르개에 부품 불출이 되살아난다"
    );
    // 🔴 이름표가 **글자로 박혀 있지 않은지**는 위 「이름표는 한 곳에서만 온다」가
    // 이미 본다(따옴표까지 맞춰서). 여기서 주석의 낱말까지 금지하면 「왜 뺐는지」를
    // 적을 자리가 없어진다 — 다음 사람이 반드시 묻는 그 까닭이다.
    // 고를 수 있는 값이 실제로 둘뿐인지는 값으로 본다(원본 글자가 아니라).
    assert.deepEqual([...EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES], ["FINAL_SHIPMENT", "QUOTE"]);
  });

  test("🔴 저장된 부품 불출 판은 이 화면까지 내려오지도 않는다 — 안 보이는 것과 안 나가는 것은 다르다", () => {
    // 용도별 현재 판을 담는 자리의 **키 타입**이 좁아야 한다. 넓은 채로 두면
    // 서버 페이지가 그 판까지 읽어 HTML 에 실어 보낸다(화면에 안 그려도 나간다).
    assert.match(
      flat(sectionSource),
      /export type ShipmentApprovalRoutesByScope = Record< EditableShipmentApprovalRouteScope, ShipmentApprovalRouteView \| null >;/,
      "용도별 현재 판의 키가 좁혀지지 않았다"
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
      /const DEFAULT_SCOPE: EditableShipmentApprovalRouteScope = "FINAL_SHIPMENT";/,
      "코드 값이 처음 보여 줄 용도를 정하는 자리 밖에서 쓰인다"
    );
    // 🔴 부품 불출은 글자로도, 이름 붙은 상수로도 이 화면에 남아 있지 않다
    // (2026-10-18 에 탭에서 빠졌다). 상수가 남아 있으면 그 용도를 가리키는 갈래가
    // 아직 있다는 뜻이다.
    assert.ok(!/"PART_ISSUE"/.test(sectionSource), "용도를 글자로 적었다");
    assert.ok(
      !/\bPART_ISSUE_APPROVAL_ROUTE_SCOPE\b/.test(sectionSource),
      "부품 불출 용도를 가리키는 갈래가 화면에 남아 있다"
    );
  });

  test("고른 값을 그대로 믿지 않는다 — 도메인의 판정으로 좁힌다", () => {
    assert.match(
      flat(sectionSource),
      /if \(isEditableShipmentApprovalRouteScope\(next\)\) changeScope\(next\);/,
      "고른 값을 형변환만으로 통과시키면 목록에 없는 값도 타입만 지난다"
    );
    // 🔴 넓은 쪽(「표에 넣을 수 있는가」)으로 물으면 부품 불출이 다시 통과한다.
    assert.ok(
      !/isShipmentApprovalRouteScope\(/.test(sectionSource),
      "화면이 「표에 넣을 수 있는가」로 묻고 있다 — 「여기서 고칠 수 있는가」여야 한다"
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
    // [저장]을 누른 순간 그 사람들이 견적서 절차로 저장된다.
    assert.match(
      flat(sectionSource),
      /useState<Record<EditableShipmentApprovalRouteScope, string\[\]>>\(savedByScope\)/,
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
    assert.match(
      flat(sectionSource),
      /const staleScopes = EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\.filter\(/
    );
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

  test("🔴 재고 화면을 설명하던 글이 남아 있지 않다 — 없는 용도를 가리키게 된다", () => {
    // 2026-10-18 에 「부품 불출」이 이 탭에서 빠지면서, 그 용도에만 붙던 안내
    // (「재고 화면의 [불출]·[사용]이 … 으로 바뀝니다」)도 함께 걷어냈다. 남겨
    // 두면 고를 수 없는 용도를 설명하는 글이 되고, 읽는 사람은 어디서 고치는지
    // 찾다가 못 찾는다.
    assert.ok(
      !/\[불출\]·\[사용\]/.test(sectionSource),
      "재고 단추를 설명하는 글이 남아 있다"
    );
    assert.ok(
      !/불출 승인 요청/.test(sectionSource),
      "재고 단추 이름이 남아 있다"
    );
  });

  test("🔴 재고 쪽 모듈을 더 이상 가져오지 않는다", () => {
    // 이 탭이 재고 쪽을 가져오던 자리가 둘이었다(단추 이름표 · 「지금 켜져
    // 있는가」 판정). 용도가 빠졌으니 가져올 까닭도 없다 — 남겨 두면 재고를
    // 걷어내는 다음 조각에서 이 화면이 이유 없이 끌려 들어온다.
    assert.ok(
      !/@\/lib\/domain\/inventory-part-issue-rules/.test(sectionSource),
      "재고 규칙 모듈을 아직 가져온다"
    );
    assert.ok(
      !/components\/inventory\/part-issue-approval-texts/.test(sectionSource),
      "재고 문구 모듈을 아직 가져온다"
    );
  });

  test("용도마다 실제로 다른 말을 한다 — 값으로 확인한다", () => {
    // 🔴 이 탭이 쓰는 둘만 본다. 부품 불출의 안내는 도메인에 남아 있지만(Record 가
    // 모든 용도를 요구한다) 이 화면이 보여 줄 일은 없다.
    assert.notEqual(
      SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES.FINAL_SHIPMENT,
      SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES.QUOTE
    );
    for (const scope of EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES) {
      assert.ok(
        SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES[scope].trim().length > 0,
        `${scope}: 빈 절차 안내가 비어 있다`
      );
    }
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

describe("🔴 탭의 저장 경로도 부품 불출을 받지 않는다", () => {
  test("서버 액션이 「고칠 수 있는 용도만」 받는 입구를 부른다", () => {
    // 고르개에서만 치우면 안 된다 — 서버 액션은 네트워크 경계 너머에서 불리므로
    // 손으로 만든 요청이 그대로 통과한다.
    assert.match(
      flat(routeActionSource),
      /const validated = validateEditableShipmentApprovalRouteInput\(input\)/,
      "서버 액션이 표의 용도 전부를 받는 입구를 쓰고 있다"
    );
  });

  test("🔴 mutation 쪽 입구는 그대로 셋을 받는다 — 좁히면 사용자 삭제가 조용히 깨진다", () => {
    // 계정을 지우면 그 사람이 올라 있던 결재선마다 새 판을 얹는데, 거기엔
    // 'PART_ISSUE' 가 섞여 있다(db/mutations/user-deletion.ts →
    // saveShipmentApprovalRouteInTx → validateShipmentApprovalRouteInput).
    // 입력이 unknown 이라 **타입 검사로는 드러나지 않는다.**
    assert.match(
      flat(routeMutationSource),
      /scope: ShipmentApprovalRouteScope/,
      "mutation 의 용도 타입이 좁혀졌다 — 저장된 부품 불출 판을 이어 쓸 수 없게 된다"
    );
    const inputSource = read("src/lib/validation/shipment-approval-route-input.ts");
    assert.match(
      flat(inputSource),
      /if \(!isShipmentApprovalRouteScope\(scope\)\)/,
      "mutation 이 쓰는 검증이 좁혀졌다 — 사용자 삭제가 깨진다"
    );
  });
});

describe("서버 페이지 · 인가", () => {
  test("🔴 고칠 수 있는 용도 전부의 현재 판을 읽어 내려보낸다 — 한 용도만 읽으면 나머지는 「없음」으로 보인다", () => {
    assert.match(
      flat(usersPageSource),
      /EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES\.map\( async \(scope\) => \[scope, await getCurrentShipmentApprovalRoute\(scope\)\] as const \)/,
      "용도 목록을 돌며 읽는 자리가 사라졌다"
    );
    assert.ok(
      !/getCurrentShipmentApprovalRoute\("/.test(usersPageSource),
      "용도를 글자로 적었다 — 새 용도를 더할 때 이 자리가 조용히 빠진다"
    );
    // 🔴 넓은 목록으로 되돌아가면 부품 불출 판을 다시 읽어 HTML 에 실어 보낸다.
    assert.ok(
      !/\bSHIPMENT_APPROVAL_ROUTE_SCOPES\b/.test(usersPageSource),
      "서버 페이지가 표의 용도 전부를 읽고 있다 — 부품 불출 판이 다시 내려간다"
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
