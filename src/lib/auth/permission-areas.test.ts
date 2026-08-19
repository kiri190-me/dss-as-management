import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_AREAS,
  PERMISSION_LEVELS,
  isRoleEditableInPermissionSettings,
  lowerPermissionLevel,
  meetsPermissionLevel,
  selectablePermissionLevels,
  type PermissionLevel,
} from "./permission-areas";
import { baselinePermissionLevel } from "./permission-baseline";
import { navItems } from "@/lib/navigation";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

import { canViewCustomers, canEditCustomers } from "./customer-authorization";
import { canViewInventory, canCreateOrEditPart, canProcessPartRequests } from "./inventory-authorization";
import { canViewMyActiveWork } from "./my-active-work-authorization";
import { canViewProductModels, canEditProductModels } from "./product-model-authorization";
import { canViewWorkflowTemplates, canPublishWorkflowTemplates } from "./workflow-template-authorization";

/**
 * 이 파일이 지키려는 것은 하나다 — **화면을 만들었다는 이유로 권한이 달라지지
 * 않는다.** 상한이 지금 코드보다 낮으면 그 자체가 새 제한이고, 높으면 설정으로
 * 없던 권한을 줄 수 있게 된다. 둘 다 있어서는 안 된다.
 */

// ─────────────────────────────────────────────── 영역 목록과 메뉴의 대응

test("권한 영역과 메뉴가 1:1이다", () => {
  // 어긋나면 화면에 나오지 않는 메뉴가 생기거나(설정 불가), 설정은 있는데
  // 갈 곳이 없는 줄이 생긴다.
  const areaKeys = PERMISSION_AREAS.map((area) => area.key).sort();
  const navKeys = navItems.map((item) => item.key).sort();
  assert.deepEqual(areaKeys, navKeys);
});

test("영역 키는 중복되지 않는다", () => {
  const keys = PERMISSION_AREAS.map((area) => area.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ─────────────────────────────────────────────── 수준 연산

test("meetsPermissionLevel은 사다리 순서를 따른다", () => {
  assert.equal(meetsPermissionLevel("MANAGE", "WRITE"), true);
  assert.equal(meetsPermissionLevel("WRITE", "WRITE"), true);
  assert.equal(meetsPermissionLevel("READ", "WRITE"), false);
  assert.equal(meetsPermissionLevel("NONE", "READ"), false);
});

test("접근 불가는 어떤 요구도 만족하지 못한다", () => {
  for (const required of ["READ", "WRITE", "MANAGE"] as const) {
    assert.equal(meetsPermissionLevel("NONE", required), false, required);
  }
});

test("required가 NONE이면 누구나 만족한다 — 요구가 없다는 뜻이다", () => {
  assert.equal(meetsPermissionLevel("NONE", "NONE"), true);
});

test("lowerPermissionLevel은 낮은 쪽을 고른다", () => {
  assert.equal(lowerPermissionLevel("MANAGE", "READ"), "READ");
  assert.equal(lowerPermissionLevel("READ", "MANAGE"), "READ");
  assert.equal(lowerPermissionLevel("WRITE", "WRITE"), "WRITE");
  assert.equal(lowerPermissionLevel("NONE", "MANAGE"), "NONE");
});

test("드롭다운 선택지는 상한을 넘지 않는다", () => {
  assert.deepEqual(selectablePermissionLevels("READ"), ["NONE", "READ"]);
  assert.deepEqual(selectablePermissionLevels("WRITE"), ["NONE", "READ", "WRITE"]);
  assert.deepEqual(selectablePermissionLevels("MANAGE"), [...PERMISSION_LEVELS]);
  assert.deepEqual(selectablePermissionLevels("NONE"), ["NONE"]);
});

// ─────────────────────────────────────────────── 상한이 지금 정책과 같은가

/** 상한이 required 이상이어야 "지금 되는 일이 계속 된다". */
function assertCeilingAllows(areaKey: string, role: Role, required: PermissionLevel, what: string) {
  const ceiling = baselinePermissionLevel(areaKey, role);
  assert.ok(
    meetsPermissionLevel(ceiling, required),
    `${role}은(는) 지금 ${what}을(를) 할 수 있는데 ${areaKey} 상한이 ${ceiling}이다`
  );
}

test("지금 볼 수 있는 화면은 상한이 최소 읽기다", () => {
  for (const role of ROLE_CODES) {
    if (canViewCustomers(role)) assertCeilingAllows("customers", role, "READ", "고객사 보기");
    if (canViewInventory(role)) assertCeilingAllows("inventory", role, "READ", "재고 보기");
    if (canViewProductModels(role)) assertCeilingAllows("productModels", role, "READ", "제품 모델 보기");
    if (canViewMyActiveWork(role)) assertCeilingAllows("myActiveWork", role, "READ", "내 담당 제품 보기");
    if (canViewWorkflowTemplates(role)) assertCeilingAllows("workflows", role, "READ", "워크플로 보기");
  }
});

test("지금 고칠 수 있는 것은 상한이 최소 쓰기다", () => {
  for (const role of ROLE_CODES) {
    if (canEditCustomers(role)) assertCeilingAllows("customers", role, "WRITE", "고객사 수정");
    if (canEditProductModels(role)) assertCeilingAllows("productModels", role, "WRITE", "제품 모델 수정");
    if (canCreateOrEditPart(role)) assertCeilingAllows("inventory", role, "WRITE", "부품 등록/수정");
  }
});

test("지금 되돌리기 어려운 조작을 할 수 있으면 상한이 관리다", () => {
  for (const role of ROLE_CODES) {
    if (canProcessPartRequests(role)) assertCeilingAllows("inventory", role, "MANAGE", "부품 요청 처리");
    if (canPublishWorkflowTemplates(role)) assertCeilingAllows("workflows", role, "MANAGE", "워크플로 발행");
  }
});

test("지금 못 보는 화면은 상한이 접근 불가다", () => {
  // 반대 방향 — 상한이 열려 있으면 설정으로 없던 권한을 줄 수 있게 된다.
  for (const role of ROLE_CODES) {
    if (!canViewCustomers(role)) {
      assert.equal(baselinePermissionLevel("customers", role), "NONE", `${role} 고객사`);
    }
    if (!canViewMyActiveWork(role)) {
      assert.equal(baselinePermissionLevel("myActiveWork", role), "NONE", `${role} 내 담당 제품`);
    }
  }
});

test("상한은 그 영역에서 의미 있는 최고 수준을 넘지 않는다", () => {
  // 대시보드에 '관리'가 뜨면 고른 사람은 무언가 달라졌다고 믿지만 실제로는
  // 아무것도 달라지지 않는다.
  for (const area of PERMISSION_AREAS) {
    for (const role of ROLE_CODES) {
      const ceiling = baselinePermissionLevel(area.key, role);
      assert.ok(
        meetsPermissionLevel(area.maxMeaningfulLevel, ceiling),
        `${area.key}/${role}: 상한 ${ceiling}이 의미 있는 최고 수준 ${area.maxMeaningfulLevel}을 넘는다`
      );
    }
  }
});

test("최고관리자는 사용자 관리를 관리 수준으로 갖는다 — 설정을 되돌릴 사람이 남아야 한다", () => {
  assert.equal(baselinePermissionLevel("users", "SUPER_ADMIN"), "MANAGE");
});

test("최고관리자에게 닫힌 영역은 '내 담당 제품' 하나뿐이다", () => {
  // 이 화면은 설계상 엔지니어 전용이다 — 관리자 계정은 assigned_engineer_id에
  // 들어가지 않으므로 열어 봐야 늘 빈 목록이다(my-active-work-authorization.ts).
  // 그 하나 말고 다른 영역이 최고관리자에게 닫히면, 그건 상한 계산이 잘못된
  // 것이지 정책이 아니다.
  const closed = PERMISSION_AREAS.filter(
    (area) => baselinePermissionLevel(area.key, "SUPER_ADMIN") === "NONE"
  ).map((area) => area.key);
  assert.deepEqual(closed, ["myActiveWork"]);
});

test("모든 역할이 최소한 하나의 메뉴는 가진다", () => {
  for (const role of ROLE_CODES) {
    const open = PERMISSION_AREAS.filter((area) => baselinePermissionLevel(area.key, role) !== "NONE");
    assert.ok(open.length > 0, `${role}에게 열린 메뉴가 하나도 없다`);
  }
});

test("목록에 없는 영역은 열리지 않는다", () => {
  assert.equal(baselinePermissionLevel("nonexistentArea", "SUPER_ADMIN"), "NONE");
});

// ─────────────────────────────────────────────── 잠금 방지

test("최고관리자 줄은 편집 대상이 아니다", () => {
  assert.equal(isRoleEditableInPermissionSettings("SUPER_ADMIN"), false);
  for (const role of ROLE_CODES.filter((code) => code !== "SUPER_ADMIN")) {
    assert.equal(isRoleEditableInPermissionSettings(role), true, role);
  }
});
