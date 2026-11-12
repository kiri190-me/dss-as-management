import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MENU_KEYS_WITHOUT_PERMISSION_AREA,
  NOT_IN_MENU_GROUP_KEY,
  NOT_IN_MENU_GROUP_LABEL,
  PERMISSION_AREA_GROUPS,
  PERMISSION_AREA_KEYS_IN_SCREEN_ORDER,
  STANDALONE_GROUP_KEY,
} from "./permission-area-groups";
import { PERMISSION_AREAS } from "./permission-areas";
import { navGroups, navItems } from "../navigation";

/**
 * ============================================================================
 * 역할별 접근 권한 화면의 왼쪽 목록을 **실제 메뉴에 맞춰 재정비**했다 (2026-11-12)
 * ============================================================================
 * 바뀐 것은 **묶음과 차례뿐**이다. 열쇠 · 저장 값 · 기본 정책은 한 글자도 손대지
 * 않았고, 그 사실은 이 파일이 아니라 **고쳐지지 않은 채 그대로 통과하는**
 * permission-areas.test.ts · permission-features.test.ts 가 증명한다.
 *
 * 여기서 가장 중요한 단언은 맨 앞의 「하나도 안 사라졌는가」다. 재배치하다
 * 한 줄을 빠뜨리면 오류가 나지 않는다 — 그 영역만 화면에서 조용히 없어지고,
 * 그러면 운영 DB 에 저장된 그 줄의 값을 되돌릴 길이 화면에서 사라진다.
 * ============================================================================
 */

/** 묶음 안의 하위메뉴까지 평평하게 — 화면에 그려지는 줄 전부. */
function allNodes() {
  return PERMISSION_AREA_GROUPS.flatMap((group) =>
    group.nodes.flatMap(function walk(node): { key: string; notInMenu: boolean; groupKey: string }[] {
      return [
        { key: node.area.key, notInMenu: node.notInMenu === true, groupKey: group.key },
        ...node.children.flatMap(walk),
      ];
    })
  );
}

test("🔴 권한 영역이 **하나도** 사라지지 않았다 — 수로 센다", () => {
  const screen = [...PERMISSION_AREA_KEYS_IN_SCREEN_ORDER];
  const source = PERMISSION_AREAS.map((area) => area.key);

  // 🔵 표본이 비어서 공짜로 통과하지 않게 — 재는 대상이 실제로 있다는 것부터.
  assert.equal(source.length, 21, "권한 영역 수가 달라졌다 — 더했거나 뺐다면 사람이 먼저 볼 것");
  assert.equal(screen.length, source.length, "화면에 그려지는 줄 수가 권한 영역 수와 다르다");
  assert.deepEqual(
    [...screen].sort(),
    [...source].sort(),
    "화면에서 사라졌거나 없던 영역이 생겼다"
  );
  // 두 묶음에 걸쳐 두 번 그려지지도 않는다 — 위 길이 비교만으로는 「하나 빠지고
  // 하나 겹침」이 통과한다.
  assert.equal(new Set(screen).size, screen.length, "같은 영역이 두 번 그려진다");
});

test("🔴 묶음 머리말과 차례는 navigation.ts 에서 온다 — 손으로 한 벌 더 적지 않았다", () => {
  const labelled = PERMISSION_AREA_GROUPS.filter(
    (group) => group.label !== null && group.key !== NOT_IN_MENU_GROUP_KEY
  );
  assert.deepEqual(
    labelled.map((group) => [group.key, group.label]),
    navGroups.map((group) => [group.key, group.label]),
    "묶음의 열쇠·이름표·차례가 메뉴와 다르다"
  );
  // 🔵 못 — 위 단언은 양쪽이 다 비어도 통과한다. 다섯이 실제로 있어야 뜻이 있다.
  assert.equal(labelled.length, 5);
  assert.deepEqual(labelled.map((group) => group.label), [
    "A/S 업무",
    "기술 / 자원",
    "PO / 내자",
    "관리",
    "설정",
  ]);
});

test("🔴 묶음 안의 차례도 메뉴 그대로다 — 감춘 항목과 권한 영역이 아닌 항목만 빠진다", () => {
  const hidden = new Set(navItems.filter((item) => item.hiddenFromMenu).map((item) => item.key));
  const isArea = (key: string) => PERMISSION_AREAS.some((area) => area.key === key);

  for (const navGroup of navGroups) {
    const expected = navGroup.itemKeys.filter((key) => isArea(key) && !hidden.has(key));
    const actual = PERMISSION_AREA_GROUPS.find((group) => group.key === navGroup.key)?.nodes.map(
      (node) => node.area.key
    );
    assert.deepEqual(actual, expected, `${navGroup.key} 묶음의 차례가 메뉴와 다르다`);
  }
});

test("🔴 사용자가 짚은 어긋남 넷이 고쳐졌다", () => {
  const order = [...PERMISSION_AREA_KEYS_IN_SCREEN_ORDER];
  const at = (key: string) => {
    const index = order.indexOf(key);
    assert.notEqual(index, -1, `${key} 가 화면에 없다`);
    return index;
  };

  // ① [사용자 관리]는 중간이 아니라 맨 끝 [설정] 묶음이다.
  const settingsGroup = PERMISSION_AREA_GROUPS.find((group) => group.key === "systemSettings");
  assert.ok(settingsGroup?.nodes.some((node) => node.area.key === "users"));
  assert.ok(at("users") > at("customers"), "사용자 관리가 아직 고객사 관리보다 앞이다");
  assert.ok(at("users") > at("technicalProcedures"));

  // ② [관리](고객사·제품 모델)는 [기술 / 자원](기술 작업 절차)보다 **뒤**다.
  assert.ok(at("technicalProcedures") < at("customers"), "관리가 기술/자원보다 앞이다");
  assert.ok(at("technicalProcedures") < at("productModels"));

  // ③ 메일 설정 ↔ 시스템 설정의 차례가 메뉴와 같다 — 시스템 설정이 먼저다.
  assert.ok(at("settings") < at("mailSettings"), "메일 설정과 시스템 설정이 아직 뒤바뀌어 있다");

  // ④ 재고 관리는 [기술 / 자원] 안에 그대로 서 있지 않다 — 아래 「메뉴에 없는 항목」.
  const techGroup = PERMISSION_AREA_GROUPS.find((group) => group.key === "techResources");
  assert.deepEqual(techGroup?.nodes.map((node) => node.area.key), ["technicalProcedures"]);
});

test("🔴 메뉴에 없는 항목은 맨 아래에 따로 묶이고, 그 사실이 줄마다 표시된다", () => {
  const last = PERMISSION_AREA_GROUPS[PERMISSION_AREA_GROUPS.length - 1];
  assert.equal(last.key, NOT_IN_MENU_GROUP_KEY, "메뉴에 없는 항목 묶음이 맨 끝이 아니다");
  assert.equal(last.label, NOT_IN_MENU_GROUP_LABEL);
  assert.equal(last.notInMenu, true, "화면이 안내 문구를 붙일 근거가 사라졌다");
  assert.deepEqual(last.nodes.map((node) => node.area.key), ["inventory"]);
  assert.ok(
    last.nodes.every((node) => node.notInMenu === true),
    "줄 쪽 표시가 없다 — 묶음 머리말을 지나쳐 읽는 사람에게는 보이지 않는다"
  );

  // 🔴 숨기지 않는다는 것이 결정의 요점이다. 열쇠는 살아 있고(수리 건 상세의
  //    [부품 반출 신청] 칸이 지금도 inventory.requests 를 관문으로 쓴다),
  //    메뉴에만 없다. 화면에서 빼면 저장된 값을 되돌릴 길이 없어진다.
  assert.ok(PERMISSION_AREA_KEYS_IN_SCREEN_ORDER.includes("inventory"));

  // 🔵 그리고 그 줄들은 **메뉴에 있는 줄과 섞이지 않는다** — 섞이면 표시만 남고
  //    「따로 묶었다」가 거짓이 된다.
  for (const node of allNodes()) {
    assert.equal(
      node.notInMenu,
      node.groupKey === NOT_IN_MENU_GROUP_KEY,
      `${node.key}: 표시와 묶음이 어긋난다`
    );
  }
});

test("🔴 개발자 모드는 권한 항목으로 생기지 않았다 — 메뉴에만 있고 설정에는 없는 유일한 항목이다", () => {
  assert.equal(PERMISSION_AREA_KEYS_IN_SCREEN_ORDER.includes("developerMode"), false);
  assert.equal(
    PERMISSION_AREA_GROUPS.some((group) =>
      group.nodes.some((node) => node.area.key === "developerMode")
    ),
    false
  );
  // 🔴 「메뉴에 있는데 권한 영역이 없음」은 그 하나뿐이어야 한다. 둘째가 생기면
  //    설정으로 열 수 없는 화면이 하나 더 생겼다는 뜻이라 사람이 먼저 봐야 한다.
  assert.deepEqual([...MENU_KEYS_WITHOUT_PERMISSION_AREA], ["developerMode"]);
});

test("🔴 주간보고는 대시보드의 **하위메뉴**로 들어간다 — 나란히 서지 않는다", () => {
  const standalone = PERMISSION_AREA_GROUPS[0];
  assert.equal(standalone.key, STANDALONE_GROUP_KEY);
  assert.equal(standalone.label, null, "단독 줄에 없는 묶음 이름을 지어 붙였다");
  assert.deepEqual(standalone.nodes.map((node) => node.area.key), ["dashboard"]);
  assert.deepEqual(standalone.nodes[0].children.map((node) => node.area.key), ["weeklyReport"]);

  // 하위메뉴는 **어느 묶음의 제 줄로도** 나오지 않는다 — 나오면 같은 영역이 두 번
  // 그려지고, 그때 두 줄의 고름 상태가 갈린다.
  for (const group of PERMISSION_AREA_GROUPS) {
    assert.equal(
      group.nodes.some((node) => node.area.key === "weeklyReport"),
      false,
      `${group.key} 에 주간보고가 제 줄로 들어가 있다`
    );
  }
});

test("🔵 빈 묶음은 아예 만들지 않는다 — 머리말만 남은 칸이 생기지 않게", () => {
  for (const group of PERMISSION_AREA_GROUPS) {
    assert.ok(group.nodes.length > 0, `${group.key} 가 빈 묶음이다`);
  }
  // 묶음 수 = 단독 하나 + 메뉴 묶음 다섯 + 메뉴에 없는 항목 하나.
  assert.equal(PERMISSION_AREA_GROUPS.length, 7);
});
