import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES } from "@/lib/domain/types";
import {
  canDeleteDomesticOrders,
  canEditDomesticOrders,
  canViewDomesticOrders,
} from "./domestic-order-authorization";
import { canDeleteQuotes } from "./quote-authorization";
import { baselineLeafLevel, baselinePermissionLevel } from "./permission-baseline";
import { findPermissionArea } from "./permission-areas";
import { selectableLevelsOfLeaf } from "./permission-features";

/**
 * 내자 정리의 역할 정책 — 특히 휴지통(2026-09-11).
 *
 * 실제 관문은 서버 액션의 hasPermission("domesticOrders", "MANAGE") 이고, 그
 * 기본값을 permission-baseline.ts 가 이 함수들로 계산한다. 여기서 지키는 것은
 * "누가 기본으로 지울 수 있는가"라는 정책 그 자체다.
 */

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
});

test("🔴 역할별 기본 수준 — 최고관리자·관리자만 관리로 올랐고, 나머지는 휴지통 전과 같다", () => {
  // 설정을 아무도 만지지 않은 상태의 실효 수준이 이 값이다 — resolver 는 저장된
  // 값이 없으면 baselineLeafLevel 을 그대로 쓴다(permission-resolver.ts).
  // 메뉴(baselinePermissionLevel)와 잎(baselineLeafLevel) 두 창구가 같은 답을
  // 해야 한다: 이 메뉴는 하위 기능이 없어 메뉴가 곧 잎이다.
  const expected = {
    SUPER_ADMIN: "MANAGE",
    ADMIN: "MANAGE",
    SALES: "WRITE",
    AS_ENGINEER: "NONE",
    INVENTORY_MANAGER: "NONE",
  } as const;
  assert.deepEqual(Object.keys(expected).sort(), [...ROLE_CODES].sort(), "역할 목록이 바뀌었다 — 이 표를 다시 볼 것");
  for (const role of ROLE_CODES) {
    assert.equal(baselinePermissionLevel("domesticOrders", role), expected[role], `${role} 메뉴 상한`);
    assert.equal(baselineLeafLevel("domesticOrders", role), expected[role], `${role} 잎 상한`);
  }
});

test("권한 설정 화면은 이 메뉴에 관리 칸을 내놓고, 설명이 관리가 무엇인지 말한다", () => {
  assert.deepEqual(selectableLevelsOfLeaf("domesticOrders"), ["NONE", "READ", "WRITE", "MANAGE"]);
  const area = findPermissionArea("domesticOrders");
  assert.ok(area, "내자 정리 영역이 없다");
  assert.ok(area.description.includes("관리는 휴지통"), `설명이 관리 수준을 말하지 않는다: ${area.description}`);
});
