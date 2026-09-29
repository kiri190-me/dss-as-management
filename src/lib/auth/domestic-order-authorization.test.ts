import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES } from "@/lib/domain/types";
import {
  canDeleteDomesticOrders,
  canEditDomesticOrders,
  canViewDomesticOrders,
} from "./domestic-order-authorization";
import { canDeleteQuotes, canEditQuotes, canViewQuotes } from "./quote-authorization";
import { baselineLeafLevel, baselinePermissionLevel } from "./permission-baseline";
import { findPermissionArea } from "./permission-areas";
import { selectableLevelsOfLeaf } from "./permission-features";

/**
 * 내자 정리의 역할 정책 — 휴지통(2026-09-11)과 엔지니어 개방(2026-09-29).
 *
 * 실제 관문은 서버 액션의 hasPermission("domesticOrders", "MANAGE") 이고, 그
 * 기본값을 permission-baseline.ts 가 이 함수들로 계산한다. 여기서 지키는 것은
 * "누가 기본으로 보고·고치고·지울 수 있는가"라는 정책 그 자체다.
 */

/**
 * 🔴 2026-09-29 — 사용자가 A/S 엔지니어에게 내자 정리와 견적서를 열었다.
 * 원문: 「엔지니어도 PO/내자에 모두 읽기/쓰기 할 수 있어야 해.」
 *
 * 금액(VAT별도)·입금 여부·부품 단가·작업비가 엔지니어에게 보이고 엔지니어가
 * 고칠 수 있게 된다는 것을 확인받고 내린 결정이다. 아래 단언들은 그 결정을
 * 못 박는다 — **되돌리려면 사용자에게 다시 물어야 한다.**
 */
test("🔴 2026-09-29: 엔지니어는 내자 정리를 보고 고친다 — 사용자 결정", () => {
  assert.equal(canViewDomesticOrders("AS_ENGINEER"), true, "엔지니어가 내자 정리를 못 본다");
  assert.equal(canEditDomesticOrders("AS_ENGINEER"), true, "엔지니어가 내자 정리를 못 고친다");
});

test("🔴 2026-09-29: 엔지니어는 견적서를 보고 고친다 — 같은 결정의 나머지 절반", () => {
  // canViewQuotes 가 canViewDomesticOrders 를 부른다(quote-authorization.ts).
  // 연쇄가 끊기면 여기서 드러난다.
  assert.equal(canViewQuotes("AS_ENGINEER"), true, "엔지니어가 견적서를 못 본다");
  assert.equal(canEditQuotes("AS_ENGINEER"), true, "엔지니어가 견적서를 못 고친다");
});

test("🔴 2026-09-29: 엔지니어에게 삭제·휴지통은 열리지 않았다 — 이 조각의 안전선", () => {
  // 사용자가 정한 것은 「읽기/쓰기」까지다. 보기·고치기가 열렸다는 이유로
  // 삭제까지 따라가면 엔지니어가 세금계산서 발행일·입금 사실이 든 줄을,
  // 그리고 고객사에 실제로 나간 견적서를 지울 수 있게 된다.
  assert.equal(canDeleteDomesticOrders("AS_ENGINEER"), false, "엔지니어에게 내자 정리 삭제가 열렸다");
  assert.equal(canDeleteQuotes("AS_ENGINEER"), false, "엔지니어에게 견적서 삭제가 열렸다");
  assert.notEqual(
    baselinePermissionLevel("domesticOrders", "AS_ENGINEER"),
    "MANAGE",
    "엔지니어의 내자 정리 기본 상한이 관리다 — 휴지통이 열렸다"
  );
  assert.notEqual(
    baselinePermissionLevel("quotes", "AS_ENGINEER"),
    "MANAGE",
    "엔지니어의 견적서 기본 상한이 관리다 — 휴지통이 열렸다"
  );
});

test("🔴 2026-09-29: 재고 담당자는 한 글자도 바뀌지 않았다 — 이번 결정에 없다", () => {
  assert.equal(canViewDomesticOrders("INVENTORY_MANAGER"), false);
  assert.equal(canEditDomesticOrders("INVENTORY_MANAGER"), false);
  assert.equal(canDeleteDomesticOrders("INVENTORY_MANAGER"), false);
  assert.equal(canViewQuotes("INVENTORY_MANAGER"), false);
  assert.equal(canEditQuotes("INVENTORY_MANAGER"), false);
  assert.equal(canDeleteQuotes("INVENTORY_MANAGER"), false);
  for (const areaKey of ["domesticOrders", "quotes", "repairLabor"] as const) {
    assert.equal(
      baselinePermissionLevel(areaKey, "INVENTORY_MANAGER"),
      "NONE",
      `${areaKey}: 재고 담당자에게 없던 권한이 생겼다`
    );
  }
});

test("canDeleteDomesticOrders: 최고관리자·관리자만 — 영업·엔지니어·재고 담당자는 못 지운다", () => {
  assert.equal(canDeleteDomesticOrders("SUPER_ADMIN"), true);
  assert.equal(canDeleteDomesticOrders("ADMIN"), true);
  for (const role of ["SALES", "AS_ENGINEER", "INVENTORY_MANAGER"] as const) {
    assert.equal(canDeleteDomesticOrders(role), false, `${role} 이(가) 내자 정리 줄을 지울 수 있게 됐다`);
  }
});

test("지우는 역할은 견적서를 지우는 역할과 같은 집합이다 — 불러 쓰지 않으므로 여기서 대조한다", () => {
  // domestic-order-authorization.ts 가 canDeleteQuotes 를 부르지 않는 이유는 그
  // 파일의 주석(순환 import). 대신 두 목록이 갈라지면 여기서 드러난다.
  for (const role of ROLE_CODES) {
    assert.equal(canDeleteDomesticOrders(role), canDeleteQuotes(role), role);
  }
});

test("지울 수 있으면 고칠 수도 있다 — 못 고치는 화면에서 지우기만 되는 역할은 없다", () => {
  for (const role of ROLE_CODES) {
    if (canDeleteDomesticOrders(role)) {
      assert.equal(canEditDomesticOrders(role), true, `${role}: 지우기는 되는데 고치기는 안 된다`);
      assert.equal(canViewDomesticOrders(role), true, `${role}: 지우기는 되는데 보기는 안 된다`);
    }
  }
});

test("지울 수 없는 역할의 기본 상한은 관리가 아니다 — 설정 없이는 휴지통이 열리지 않는다", () => {
  for (const role of ROLE_CODES) {
    if (canDeleteDomesticOrders(role)) continue;
    assert.notEqual(
      baselinePermissionLevel("domesticOrders", role),
      "MANAGE",
      `${role}: 지울 수 없는 역할의 상한이 관리다`
    );
  }
  // 영업은 여전히 쓰기다 — 휴지통이 생겼다고 추가·수정이 줄어들면 안 된다.
  assert.equal(baselinePermissionLevel("domesticOrders", "SALES"), "WRITE");
  // 엔지니어도 쓰기다(2026-09-29) — 관리로 올라가지 않았다는 것은 위 반복문이 본다.
  assert.equal(baselinePermissionLevel("domesticOrders", "AS_ENGINEER"), "WRITE");
});

test("🔴 역할별 기본 수준 — 최고관리자·관리자만 관리이고, 엔지니어는 2026-09-29 에 쓰기가 됐다", () => {
  // 설정을 아무도 만지지 않은 상태의 실효 수준이 이 값이다 — resolver 는 저장된
  // 값이 없으면 baselineLeafLevel 을 그대로 쓴다(permission-resolver.ts).
  // 메뉴(baselinePermissionLevel)와 잎(baselineLeafLevel) 두 창구가 같은 답을
  // 해야 한다: 이 메뉴는 하위 기능이 없어 메뉴가 곧 잎이다.
  const expected = {
    SUPER_ADMIN: "MANAGE",
    ADMIN: "MANAGE",
    SALES: "WRITE",
    // 🔴 2026-09-29 사용자 결정으로 NONE → WRITE 가 됐다. 금액·입금 여부가
    // 보이고 고칠 수 있게 되는 것을 알고 내린 결정이다. MANAGE 가 아니다 —
    // 삭제·휴지통은 열리지 않았다.
    AS_ENGINEER: "WRITE",
    INVENTORY_MANAGER: "NONE",
  } as const;
  assert.deepEqual(Object.keys(expected).sort(), [...ROLE_CODES].sort(), "역할 목록이 바뀌었다 — 이 표를 다시 볼 것");
  for (const role of ROLE_CODES) {
    assert.equal(baselinePermissionLevel("domesticOrders", role), expected[role], `${role} 메뉴 상한`);
    assert.equal(baselineLeafLevel("domesticOrders", role), expected[role], `${role} 잎 상한`);
  }
});

test("🔴 역할별 기본 수준 — 견적서와 작업 비용도 같은 결정을 따라왔다", () => {
  // 견적서는 canViewDomesticOrders 를 부르고(quote-authorization.ts), 작업 비용은
  // 견적서를 부른다(permission-baseline.ts 의 repairLabor). 연쇄가 어디서든
  // 끊기면 세 표 중 하나가 어긋나 여기서 걸린다.
  const expectedQuotes = {
    SUPER_ADMIN: "MANAGE",
    ADMIN: "MANAGE",
    SALES: "WRITE",
    AS_ENGINEER: "WRITE", // 🔴 2026-09-29
    INVENTORY_MANAGER: "NONE",
  } as const;
  // 작업 비용에는 쓰기가 없다 — 값을 고치면 앞으로의 모든 견적 금액이 바뀌므로
  // 고치는 것은 관리뿐이다(permission-areas.ts). 그래서 엔지니어는 보기까지다.
  const expectedRepairLabor = {
    SUPER_ADMIN: "MANAGE",
    ADMIN: "MANAGE",
    SALES: "READ",
    AS_ENGINEER: "READ", // 🔴 2026-09-29 — 보기만이다. 값 수정은 관리자 이상.
    INVENTORY_MANAGER: "NONE",
  } as const;
  for (const role of ROLE_CODES) {
    assert.equal(baselinePermissionLevel("quotes", role), expectedQuotes[role], `${role} 견적서`);
    assert.equal(baselineLeafLevel("quotes", role), expectedQuotes[role], `${role} 견적서 잎`);
    assert.equal(baselinePermissionLevel("repairLabor", role), expectedRepairLabor[role], `${role} 작업 비용`);
  }
});

test("권한 설정 화면은 이 메뉴에 관리 칸을 내놓고, 설명이 관리가 무엇인지 말한다", () => {
  assert.deepEqual(selectableLevelsOfLeaf("domesticOrders"), ["NONE", "READ", "WRITE", "MANAGE"]);
  const area = findPermissionArea("domesticOrders");
  assert.ok(area, "내자 정리 영역이 없다");
  assert.ok(area.description.includes("관리는 휴지통"), `설명이 관리 수준을 말하지 않는다: ${area.description}`);
});
