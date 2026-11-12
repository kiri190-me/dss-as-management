import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { ROLE_CODES, type Role } from "@/lib/domain/types";
import {
  canDeleteDomesticOrders,
  canEditDomesticOrders,
  canViewDomesticOrders,
} from "./domestic-order-authorization";
import { baselineLeafLevel, baselinePermissionLevel } from "./permission-baseline";
import { meetsPermissionLevel, type PermissionLevel } from "./permission-areas";
import {
  PERMISSION_LEAF_KEYS,
  areaLevelFromLeaves,
  featuresOfArea,
  findPermissionFeature,
  isPermissionLeafKey,
  isSettingsEnforced,
  selectableLevelsOfLeaf,
} from "./permission-features";
import {
  DOMESTIC_ORDER_DETAIL_TAB_KEYS,
  DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS,
  isDomesticOrderDetailTabOpen,
  requiredKeysOfDomesticOrderDetailTab,
  type DomesticOrderDetailTabKey,
} from "./domestic-order-detail-tab-permissions";

/**
 * ============================================================================
 * 내자 정리 권한을 잎 넷으로 쪼갰다 + 기타건 상세의 탭마다 권한 (2026-11-12, 둘째)
 * ============================================================================
 * 사용자 요구: 「기타건 상세 등 **안에 탭이 있는 화면의 탭들**에 대한 접근 권한도
 * 세세하게 설정할 수 있도록」.
 *
 * ── 🔴 왜 메뉴를 쪼개는 일부터 했는가 ───────────────────────────────────
 * 기타건 상세의 [발주서]·[승인] 탭에는 탭 단위 검사가 **0건**이었다. 두 페이지가
 * `requireAreaAccessForCurrentUser("domesticOrders")` 를 걸고 있었지만 그것은
 * **이 화면에 들어올 수 있는가**이고(레이아웃이 이미 같은 줄을 건다), 같은 열쇠를
 * 한 번 더 물으면 **언제나 참**이라 들어온 사람 사이를 가르지 못한다. 가르려면
 * **입장권보다 좁은 열쇠**가 있어야 하는데, 그때 `domesticOrders` 에는 하위 기능이
 * 없어 메뉴 키 자체가 유일한 잎이었다.
 *
 * ── 🔴 그래서 **넷을 한꺼번에** 만들었다 ────────────────────────────────
 * 잎을 하나만 더하면 메뉴 키가 잎 목록에서 빠지고 메뉴 수준이 **잎들의 최대값**이
 * 되는데, 읽기짜리 잎 하나만 있는 상태에서는 그 최대값이 READ 에 묶인다 — 내자
 * 정리의 쓰기·삭제가 **전원에게 조용히 막힌다**(2026-11-12 실측: 잎 하나만 넣었을
 * 때 다섯 역할 전부 NONE, 상한 case 를 더해도 전부 READ, 게다가 자재 담당자에게는
 * 거꾸로 열렸다).
 *
 * ── 이 파일이 못 박는 것 ────────────────────────────────────────────────
 *  ① 🔴 **쪼개기 전후로 한 역할도 달라지지 않았다** — 다섯 역할 × 영역 수준.
 *  ② 🔴 **권한 키가 죽지 않았다** — 잎 넷이 실재하고, 총수가 맞고, 메뉴는 그대로다.
 *  ③ 기본값을 손으로 적지 않았다 — *-authorization.ts 를 불러서 구한다.
 *  ④ 🔴 **탭마다의 열쇠가 입장권보다 좁다** — 그래야 가름이 선다.
 *  ⑤ 🔴 닫으면 탭이 사라지고, 그 판정이 화면·서버 **한 함수**에서 나온다.
 *  ⑥ 🔴 마이그레이션이 **동작을 바꾸지 않는 펼침**이고 지우는 문장이 아니다.
 *
 * 🔵 「막히는 사람」이 아니라 **「지금 되는 일이 그대로 되는가」**를 잰다 — 이 조각의
 * 위험은 권한이 새는 쪽이 아니라 **조용히 닫히는 쪽**이다.
 * ============================================================================
 */

/** 🔴 **쪼개기 전에 실측한 값**(2026-11-12). 이 표가 이 파일의 기준점이다. */
const AREA_LEVEL_BEFORE_SPLIT: Record<Role, PermissionLevel> = {
  SUPER_ADMIN: "MANAGE",
  ADMIN: "MANAGE",
  SALES: "WRITE",
  AS_ENGINEER: "WRITE",
  INVENTORY_MANAGER: "NONE",
};

/** 🔴 차례까지 글자 그대로. 넷이고, 이 차례가 권한 화면의 줄 차례다. */
const DOMESTIC_ORDER_LEAF_KEYS = [
  "domesticOrders.view",
  "domesticOrders.edit",
  "domesticOrders.lifecycle",
  "domesticOrders.approval",
] as const;

/** 설정이 하나도 없을 때의 잎 수준. 아래 ①이 이 값에서 영역 수준을 만든다. */
function baselineOf(role: Role) {
  return (leafKey: string) => baselineLeafLevel(leafKey, role);
}

describe("① 🔴 쪼개기 전후로 **한 역할도 달라지지 않았다**", () => {
  test("표본이 비어 있지 않다 — 역할 다섯을 실제로 훑는다", () => {
    assert.equal(ROLE_CODES.length, 5, "역할 수가 달라졌다 — 이 파일의 표를 다시 잴 것");
    assert.deepEqual(Object.keys(AREA_LEVEL_BEFORE_SPLIT).sort(), [...ROLE_CODES].sort());
  });

  test("🔴 영역 수준(= 잎들의 최대값)이 쪼개기 전 값과 같다", () => {
    // 🔴 이것이 이 조각에서 가장 중요한 한 줄이다. 메뉴에 들어갈 수 있는가
    // (requireAreaAccessForCurrentUser)도, 수준을 묻는 모든 자리도 이 값을 본다
    // (permission-resolver.ts 가 levels[area] 를 areaLevelFromLeaves 로 만든다).
    for (const role of ROLE_CODES) {
      assert.equal(
        areaLevelFromLeaves("domesticOrders", baselineOf(role)),
        AREA_LEVEL_BEFORE_SPLIT[role],
        `${role}: 쪼갠 뒤 내자 정리의 실효 수준이 달라졌다`
      );
    }
  });

  test("🔴 메뉴 상한도 그대로다 — 권한 화면의 드롭다운이 좁아지지 않았다", () => {
    // `rawBaseline` 의 `case "domesticOrders"` 를 지우면 여기서 NONE 이 되어 걸린다.
    for (const role of ROLE_CODES) {
      assert.equal(
        baselinePermissionLevel("domesticOrders", role),
        AREA_LEVEL_BEFORE_SPLIT[role],
        `${role}: 메뉴 상한이 달라졌다`
      );
    }
  });

  test("🔴 관문마다 **통과하는 역할 집합**이 그대로다 — 읽기 · 쓰기 · 관리 셋", () => {
    // 쪼개기 전에는 셋 다 같은 값 하나(X)에 `X >= 필요수준` 을 물었다. 쪼갠 뒤에는
    // 잎마다 묻는 수준이 고정이다 — 두 쪽의 **답이 같은지**를 역할마다 맞댄다.
    for (const role of ROLE_CODES) {
      const before = AREA_LEVEL_BEFORE_SPLIT[role];
      const leafLevel = baselineOf(role);
      assert.equal(
        meetsPermissionLevel(leafLevel("domesticOrders.view"), "READ"),
        meetsPermissionLevel(before, "READ"),
        `${role}: 읽기 관문의 답이 달라졌다`
      );
      assert.equal(
        meetsPermissionLevel(leafLevel("domesticOrders.edit"), "WRITE"),
        meetsPermissionLevel(before, "WRITE"),
        `${role}: 쓰기 관문의 답이 달라졌다`
      );
      assert.equal(
        meetsPermissionLevel(leafLevel("domesticOrders.lifecycle"), "MANAGE"),
        meetsPermissionLevel(before, "MANAGE"),
        `${role}: 관리 관문의 답이 달라졌다`
      );
      // 🔵 [승인] 탭에는 그 전까지 **아무 검사도 없었다** — 화면에 들어온 사람이면
      //    누구나 봤다. 그러니 「들어올 수 있었는가」(= READ)가 그때의 가시성이다.
      assert.equal(
        meetsPermissionLevel(leafLevel("domesticOrders.approval"), "READ"),
        meetsPermissionLevel(before, "READ"),
        `${role}: [승인] 탭을 보던 사람이 달라졌다`
      );
    }
  });

  test("🔴 표본이 공짜가 아니다 — 역할마다 실제로 갈리는 칸이 있다", () => {
    // 전부 같은 값이면 위 단언들이 무엇도 재지 못한다. 세 수준이 실제로 갈리는지 본다.
    const levels = ROLE_CODES.map((role) => AREA_LEVEL_BEFORE_SPLIT[role]);
    assert.ok(levels.includes("MANAGE"), "관리인 역할이 없다");
    assert.ok(levels.includes("WRITE"), "쓰기인 역할이 없다");
    assert.ok(levels.includes("NONE"), "닫힌 역할이 없다");
  });
});

describe("② 🔴 권한 키가 죽지 않았다", () => {
  test("내자 정리의 잎은 넷이고 차례도 그대로다", () => {
    assert.deepEqual(
      featuresOfArea("domesticOrders").map((feature) => feature.key),
      [...DOMESTIC_ORDER_LEAF_KEYS]
    );
    for (const leafKey of DOMESTIC_ORDER_LEAF_KEYS) {
      assert.ok(isPermissionLeafKey(leafKey), `${leafKey} 가 저장되는 키가 아니다`);
    }
  });

  test("🔴 메뉴 키는 더 이상 잎이 아니다 — 그래서 마이그레이션(0127)이 필요했다", () => {
    assert.equal(
      isPermissionLeafKey("domesticOrders"),
      false,
      "메뉴 키가 아직 잎이다 — 쪼개기가 안 됐거나 되돌아갔다"
    );
  });

  test("🔴 메뉴 자체는 그대로 있다 — 사이드바와 권한 화면에서 사라지지 않았다", () => {
    const menuLeaves = PERMISSION_LEAF_KEYS.filter((key) => key.startsWith("domesticOrders"));
    assert.deepEqual(menuLeaves, [...DOMESTIC_ORDER_LEAF_KEYS]);
    // 🔵 메뉴 수준이 계산되는 것은 ①이 본다 — 여기서는 「잎이 하나라도 있는가」다.
    assert.ok(featuresOfArea("domesticOrders").length > 0, "메뉴에 잎이 하나도 없다");
  });

  test("🔴 저장되는 잎의 총수는 51 — 하나가 빠지고 넷이 들어왔다(순증 +3)", () => {
    assert.equal(PERMISSION_LEAF_KEYS.length, 51);
    assert.equal(new Set(PERMISSION_LEAF_KEYS).size, PERMISSION_LEAF_KEYS.length, "키가 겹친다");
  });

  test("🔴 이웃 메뉴의 키는 한 글자도 안 건드렸다", () => {
    // 같은 날 오전 조각이 만든 셋과, 탭 열쇠로 쓰이는 이웃들.
    for (const leafKey of [
      "repairCases.view",
      "repairCases.workHistory",
      "repairCases.serviceReports",
      "repairCases.approval",
      "quotes",
      "miscCases",
    ]) {
      assert.ok(isPermissionLeafKey(leafKey), `${leafKey} 가 사라졌다`);
    }
  });
});

describe("③ 기본값을 손으로 적지 않았다 — 정책 함수를 그대로 나눠 부른다", () => {
  test("🔴 네 잎의 기본값이 *-authorization.ts 의 답과 역할마다 같다", () => {
    for (const role of ROLE_CODES) {
      assert.equal(
        baselineLeafLevel("domesticOrders.view", role),
        canViewDomesticOrders(role) ? "READ" : "NONE",
        `${role}: 조회 기본값이 정책 함수와 다르다`
      );
      assert.equal(
        baselineLeafLevel("domesticOrders.edit", role),
        canEditDomesticOrders(role) ? "WRITE" : "NONE",
        `${role}: 수정 기본값이 정책 함수와 다르다`
      );
      assert.equal(
        baselineLeafLevel("domesticOrders.lifecycle", role),
        canDeleteDomesticOrders(role) ? "MANAGE" : "NONE",
        `${role}: 삭제·복원 기본값이 정책 함수와 다르다`
      );
      // 🔴 [승인] 탭은 **지금 그 탭을 보던 사람 전부**에게 열려 있어야 한다.
      //    결재 자격 함수를 끌어다 쓰면 「지금 보이는 사람이 계속 보인다」가 깨진다.
      assert.equal(
        baselineLeafLevel("domesticOrders.approval", role),
        canViewDomesticOrders(role) ? "READ" : "NONE",
        `${role}: 승인 탭 기본값이 「내자를 볼 수 있는 사람」과 다르다`
      );
    }
  });

  test("🔴 상한 계산을 빠뜨리지 않았다 — default 로 떨어지면 NONE 이다", () => {
    for (const leafKey of DOMESTIC_ORDER_LEAF_KEYS) {
      assert.notEqual(
        baselineLeafLevel(leafKey, "SUPER_ADMIN"),
        "NONE",
        `${leafKey} 의 case 가 permission-baseline 에 없다`
      );
    }
  });

  test("이름표와 고를 수 있는 수준 — 골라도 아무것도 안 달라지는 칸을 만들지 않았다", () => {
    const expected: Record<string, { label: string; levels: PermissionLevel[] }> = {
      "domesticOrders.view": { label: "내자 정리 조회", levels: ["NONE", "READ"] },
      "domesticOrders.edit": { label: "내자 정리 수정", levels: ["NONE", "WRITE"] },
      "domesticOrders.lifecycle": { label: "삭제·복원", levels: ["NONE", "MANAGE"] },
      "domesticOrders.approval": { label: "승인", levels: ["NONE", "READ"] },
    };
    for (const [leafKey, want] of Object.entries(expected)) {
      const feature = findPermissionFeature(leafKey);
      assert.ok(feature, `${leafKey} 를 못 찾았다`);
      assert.equal(feature.label, want.label, `${leafKey} 의 이름표`);
      assert.deepEqual(selectableLevelsOfLeaf(leafKey), want.levels, `${leafKey} 의 선택지`);
      assert.ok(feature.description.length > 0, `${leafKey}: 설명이 비었다`);
    }
  });

  test("🔴 [승인] 잎의 설명이 **어느 탭인지** 말한다 — 닫는 사람이 읽는 글이다", () => {
    const feature = findPermissionFeature("domesticOrders.approval");
    assert.ok(feature);
    assert.ok(feature.description.includes("탭"), "설명이 탭 이야기를 하지 않는다");
    assert.ok(feature.description.includes("기타건"), "어느 화면의 탭인지 말하지 않는다");
  });

  test("🔴 네 잎 전부 설정이 최종 판정이라고 화면이 말해도 된다", () => {
    for (const leafKey of DOMESTIC_ORDER_LEAF_KEYS) {
      assert.equal(isSettingsEnforced(leafKey), true, `${leafKey}: 넓혀도 안 열린다고 화면이 말하게 된다`);
    }
    assert.equal(isSettingsEnforced("domesticOrders"), true, "메뉴가 전환 중으로 보인다");
  });
});

describe("④ 🔴 탭의 열쇠가 **입장권보다 좁다** — 그래야 가름이 선다", () => {
  test("가릴 수 있는 탭은 셋이다 — 넷 중 [기본정보] 하나만 빠진다", () => {
    assert.equal(DOMESTIC_ORDER_DETAIL_TAB_KEYS.length, 3);
    assert.deepEqual([...DOMESTIC_ORDER_DETAIL_TAB_KEYS].sort(), ["approval", "purchaseOrders", "quotes"]);
    // 🔴 [기본정보]를 가리킬 칸이 표에 없다 — 들어왔는데 첫 탭이 없는 상태를 만들지 않는다.
    assert.equal(
      DOMESTIC_ORDER_DETAIL_TAB_KEYS.some((key) => (key as string) === "root"),
      false,
      "표에 root 칸이 생겼다 — [기본정보]를 가릴 수 있게 됐다"
    );
  });

  test("🔴 어느 탭도 **입장권과 같은 글자**를 쓰지 않는다", () => {
    // 🔴 이 조각이 고친 결함 그 자체다. 2026-11-06 에는 [발주서]·[승인]이 입장권과
    //    같은 `domesticOrders` 뿐이어서 **아무것도 재지 못하는 ✓** 였다.
    let counted = 0;
    for (const tab of DOMESTIC_ORDER_DETAIL_TAB_KEYS) {
      for (const requirement of DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS[tab].anyOf) {
        assert.notEqual(
          requirement.key,
          "domesticOrders",
          `${tab}: 열쇠가 입장권(메뉴 키)과 같다 — 들어온 사람은 언제나 통과한다`
        );
        assert.ok(isPermissionLeafKey(requirement.key), `${tab}: 트리에 없는 키 ${requirement.key}`);
        assert.equal(requirement.level, "READ", `${tab}: 탭에 들어가는 문턱이 읽기가 아니다`);
        counted += 1;
      }
    }
    assert.equal(counted, 3, "표의 열쇠 수가 달라졌다 — 사람이 한 번 더 볼 것");
  });

  test("탭마다의 짝 — 견적서는 `quotes`, 발주서는 조회 잎, 승인은 승인 잎", () => {
    assert.deepEqual(DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS, {
      quotes: { anyOf: [{ key: "quotes", level: "READ" }] },
      purchaseOrders: { anyOf: [{ key: "domesticOrders.view", level: "READ" }] },
      approval: { anyOf: [{ key: "domesticOrders.approval", level: "READ" }] },
    });
  });

  test("🔴 [발주서]는 수리 건 상세의 같은 탭과 **한 열쇠**다 — 같은 서류함이다", async () => {
    const { REPAIR_CASE_DETAIL_TAB_PERMISSIONS } = await import("./repair-case-detail-tab-permissions");
    assert.deepEqual(
      REPAIR_CASE_DETAIL_TAB_PERMISSIONS.purchaseOrders,
      DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS.purchaseOrders,
      "두 화면이 같은 발주서 폴더를 서로 다른 정책으로 가린다"
    );
  });
});

describe("⑤ 🔴 닫으면 탭이 사라진다 — 그리고 주소를 직접 쳐도 막힌다", () => {
  /** 적힌 잎만 그 수준이고 나머지는 접근 불가인 세계. */
  function levels(map: Record<string, PermissionLevel>) {
    return (key: string): PermissionLevel => map[key] ?? "NONE";
  }

  test("표본 확인 — 세 탭 다 열쇠가 하나씩이다", () => {
    for (const tab of DOMESTIC_ORDER_DETAIL_TAB_KEYS) {
      assert.equal(requiredKeysOfDomesticOrderDetailTab(tab).length, 1, `${tab}: 열쇠가 하나가 아니다`);
    }
  });

  test("🔴 열면 보이고, 닫으면 숨는다 — 세 탭 전부", () => {
    // 🔵 화면(레이아웃)도 서버(각 page.tsx)도 이 함수 하나에 닿는다
    //    (auth/domestic-order-detail-tab-access.ts) — 거짓이면 탭이 안 그려지고,
    //    같은 답으로 page.tsx 가 안내 상자를 돌려준다.
    for (const tab of DOMESTIC_ORDER_DETAIL_TAB_KEYS) {
      const [key] = requiredKeysOfDomesticOrderDetailTab(tab);
      assert.equal(isDomesticOrderDetailTabOpen(tab, levels({ [key]: "READ" })), true, `${tab}: 열어도 안 열린다`);
      assert.equal(isDomesticOrderDetailTabOpen(tab, levels({})), false, `${tab}: 닫아도 안 닫힌다`);
      assert.equal(
        isDomesticOrderDetailTabOpen(tab, levels({ [key]: "NONE" })),
        false,
        `${tab}: [접근 불가]인데 열린다`
      );
    }
  });

  test("🔴 한 탭을 닫아도 다른 탭은 그대로다 — 금지가 옆으로 새지 않는다", () => {
    const allOpen: Record<string, PermissionLevel> = {
      quotes: "READ",
      "domesticOrders.view": "READ",
      "domesticOrders.approval": "READ",
    };
    for (const tab of DOMESTIC_ORDER_DETAIL_TAB_KEYS) {
      const [key] = requiredKeysOfDomesticOrderDetailTab(tab);
      const narrowed = { ...allOpen, [key]: "NONE" as PermissionLevel };
      for (const other of DOMESTIC_ORDER_DETAIL_TAB_KEYS) {
        assert.equal(
          isDomesticOrderDetailTabOpen(other, levels(narrowed)),
          other !== tab,
          `${key} 를 닫았더니 [${other}] 탭까지 움직였다`
        );
      }
    }
  });

  test("🔴 **가름이 실제로 선다** — 조회만 닫은 사람은 들어오고 [발주서]만 못 본다", () => {
    // 🔴 이 조각의 핵심 주장이다. 입장권은 메뉴 수준(= 잎들의 최대값)이고 탭은 잎
    //    하나를 본다 — 조회가 닫혀도 다른 잎이 열려 있으면 **상세 화면 자체는 열린다.**
    const leafLevels: Record<string, PermissionLevel> = {
      "domesticOrders.view": "NONE",
      "domesticOrders.edit": "WRITE",
      "domesticOrders.lifecycle": "NONE",
      "domesticOrders.approval": "READ",
      quotes: "READ",
    };
    const areaLevel = areaLevelFromLeaves("domesticOrders", (key) => leafLevels[key] ?? "NONE");
    assert.ok(meetsPermissionLevel(areaLevel, "READ"), "조회를 닫았더니 화면에 들어오지도 못한다");
    assert.equal(isDomesticOrderDetailTabOpen("purchaseOrders", levels(leafLevels)), false, "[발주서]가 안 닫혔다");
    assert.equal(isDomesticOrderDetailTabOpen("approval", levels(leafLevels)), true, "[승인]까지 닫혔다");
    assert.equal(isDomesticOrderDetailTabOpen("quotes", levels(leafLevels)), true, "[견적서]까지 닫혔다");
  });

  test("🔴 승인만 닫은 사람도 마찬가지다 — 들어오고 [승인]만 못 본다", () => {
    const leafLevels: Record<string, PermissionLevel> = {
      "domesticOrders.view": "READ",
      "domesticOrders.edit": "NONE",
      "domesticOrders.lifecycle": "NONE",
      "domesticOrders.approval": "NONE",
      quotes: "READ",
    };
    const areaLevel = areaLevelFromLeaves("domesticOrders", (key) => leafLevels[key] ?? "NONE");
    assert.ok(meetsPermissionLevel(areaLevel, "READ"), "승인을 닫았더니 화면에 들어오지도 못한다");
    assert.equal(isDomesticOrderDetailTabOpen("approval", levels(leafLevels)), false, "[승인]이 안 닫혔다");
    assert.equal(isDomesticOrderDetailTabOpen("purchaseOrders", levels(leafLevels)), true, "[발주서]까지 닫혔다");
  });

  test("🔴 기본 정책에서는 세 탭이 열린다 — 내자를 볼 수 있는 네 역할에게", () => {
    for (const role of ROLE_CODES) {
      const levelOf = baselineOf(role);
      for (const tab of DOMESTIC_ORDER_DETAIL_TAB_KEYS) {
        const expected = canViewDomesticOrders(role);
        assert.equal(
          isDomesticOrderDetailTabOpen(tab, levelOf),
          expected,
          `${role} / ${tab}: 기본 상태의 탭 가시성이 지금과 다르다`
        );
      }
    }
  });

  test("🔵 자재 담당자는 애초에 이 화면에 못 들어온다 — 탭이 닫힌 것이 아니다", () => {
    assert.equal(areaLevelFromLeaves("domesticOrders", baselineOf("INVENTORY_MANAGER")), "NONE");
  });
});

/**
 * ============================================================================
 * ⑥ 🔴 마이그레이션 — 저장된 행을 **동작이 안 바뀌게** 옮긴다 (drizzle/0127)
 * ============================================================================
 * 운영 실측(2026-11-12)으로는 옮길 행이 **0건**이고, 개발 DB 에 1건 있다. 0건이어도
 * 조용히 통과해야 하고(INSERT ... SELECT), 1건 이상이면 올바로 옮겨야 한다.
 *
 * 🔴 **글자로 재는 까닭**: 이 판은 아직 적용하지 않았고(적용은 사용자), 시험에서
 * 돌려 볼 수도 없다. 그래서 「무엇을 적었는가」를 재고, 「그 매핑이 옳은가」는 위
 * ①이 값으로 잰다 — 둘이 같은 표를 말하고 있다.
 * ============================================================================
 */
describe("⑥ 🔴 마이그레이션이 지우지 않고 옮긴다", () => {
  const sql = readFileSync("drizzle/0127_domestic_order_permission_leaves.sql", "utf8");

  test("표본 확인 — 판 파일을 실제로 읽었다", () => {
    assert.ok(sql.length > 500, "마이그레이션 파일이 비었거나 못 읽었다");
    assert.ok(sql.includes("role_permissions"), "다른 표를 건드리는 판이다");
  });

  test("🔴 네 잎을 **전부** 넣는다 — 빠뜨리면 그 잎만 기본값으로 되살아난다", () => {
    for (const leafKey of DOMESTIC_ORDER_LEAF_KEYS) {
      assert.ok(sql.includes(`'${leafKey}'`), `${leafKey} 를 안 넣는다 — 좁혀 둔 설정이 풀린다`);
    }
    assert.equal((sql.match(/INSERT INTO "role_permissions"/g) ?? []).length, 4, "INSERT 가 넷이 아니다");
  });

  test("🔴 지우거나 덮어쓰는 문장이 없다 — 되돌릴 수 있게 둔다", () => {
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    assert.ok(statements.includes("INSERT INTO"), "주석을 걷었더니 문장이 남지 않았다 — 거르는 식이 깨졌다");
    for (const forbidden of ["DELETE", "DROP", "UPDATE", "TRUNCATE", "ALTER"]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`).test(statements),
        false,
        `지우거나 바꾸는 문장이 있다: ${forbidden}`
      );
    }
    // 🔴 다시 돌려도 안전하다 — 사람이 나중에 정한 값을 이사가 덮지 않는다.
    assert.equal((sql.match(/ON CONFLICT \("role", "area_key"\) DO NOTHING/g) ?? []).length, 4);
  });

  test("🔴 옮기는 매핑이 **위 ①의 표와 같다** — 사다리를 그대로 펼친다", () => {
    // view · approval 은 「NONE 이 아니면 READ」, edit 는 「WRITE 이상이면 WRITE」,
    // lifecycle 은 「MANAGE 면 MANAGE」. 값으로 검증한 결과는 ①이 들고 있다.
    assert.equal((sql.match(/CASE WHEN "level" = 'NONE' THEN 'NONE' ELSE 'READ' END/g) ?? []).length, 2);
    assert.ok(sql.includes(`CASE WHEN "level" IN ('WRITE', 'MANAGE') THEN 'WRITE' ELSE 'NONE' END`));
    assert.ok(sql.includes(`CASE WHEN "level" = 'MANAGE' THEN 'MANAGE' ELSE 'NONE' END`));
    // 🔴 원본은 옛 메뉴 키 행 하나뿐이다 — 다른 키를 긁어 오면 엉뚱한 설정이 복제된다.
    assert.equal((sql.match(/WHERE "area_key" = 'domesticOrders'/g) ?? []).length, 4);
  });

  test("🔴 되돌리는 법이 판 안에 적혀 있다", () => {
    assert.ok(sql.includes("되돌리는 법"), "되돌리는 방법이 안 적혀 있다");
    assert.ok(sql.includes('DELETE FROM "role_permissions"'), "되돌리는 문장이 안 적혀 있다");
  });

  test("🔴 판이 시험 목록·journal 에 올라 있다 — 안 적으면 적용 때 건너뛴다", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find((row) => row.tag === "0127_domestic_order_permission_leaves");
    assert.ok(entry, "journal 에 이 판이 없다 — drizzle 이 그냥 지나간다");
    assert.equal(entry.idx, 127);
  });
});

// 🔵 타입이 결정을 지킨다는 것을 눈으로도 보이게 둔다 — `root` 는 키에 없다.
const _tabKeyIsNarrow: DomesticOrderDetailTabKey[] = ["quotes", "purchaseOrders", "approval"];
void _tabKeyIsNarrow;
