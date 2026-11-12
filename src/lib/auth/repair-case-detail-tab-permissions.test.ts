import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baselineLeafLevel } from "./permission-baseline";
import {
  PERMISSION_LEAF_KEYS,
  featuresOfArea,
  findPermissionFeature,
  isPermissionLeafKey,
  isSettingsEnforced,
  selectableLevelsOfLeaf,
} from "./permission-features";
import {
  REPAIR_CASE_DETAIL_TAB_KEYS,
  REPAIR_CASE_DETAIL_TAB_PERMISSIONS,
  isRepairCaseDetailTabOpen,
  requiredKeysOfRepairCaseDetailTab,
  type RepairCaseDetailTabKey,
} from "./repair-case-detail-tab-permissions";
import type { PermissionLevel } from "./permission-areas";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 수리 건 상세의 탭마다 권한 (2026-11-12)
 * ============================================================================
 * 사용자 요구: 「수리건 상세처럼 안에 탭이 있는 화면의 탭들도 세세하게 설정할 수
 * 있게」. 그 전까지 탭 단위 검사가 있던 것은 [견적서] · [발주서] 둘뿐이었고
 * 나머지 일곱은 로그인만 하면 보였다.
 *
 * 이 파일이 못 박는 것:
 *  ① 🔴 **기본값이 지금과 같다** — 새 잎 셋이 다섯 역할 전부에게 열려 있다.
 *     닫아 두고 시작하면 배포 즉시 아무도 그 탭을 못 본다.
 *  ② 🔴 **권한 키가 하나도 안 사라졌다** — 있던 일곱이 글자 그대로 남아 있고,
 *     셋이 **더해졌을** 뿐이다. 키가 바뀌면 운영 role_permissions 의 행이 가리킬
 *     곳을 잃고 오류 없이 조용히 기본값으로 되돌아간다.
 *  ③ 🔴 **[기본 정보]는 가리지 않는다** — 표에 그 칸이 없다(결정 그 자체다).
 *  ④ 🔴 **[견적서]·[발주서]는 지금 열쇠 그대로다** — 탭 전용 키를 만들지 않았다.
 *  ⑤ 새 셋은 「들어갈 수 있는가」 하나만 답한다(읽기 말고 고를 것이 없다).
 *  ⑥ 이름표가 화면의 탭 이름과 같다.
 *
 * 🔵 「막히는 사람」이 아니라 **「지금 보이는 사람이 계속 보이는가」**를 잰다 —
 * 이 조각의 위험은 권한이 새는 쪽이 아니라 **조용히 닫히는 쪽**이다.
 * ============================================================================
 */

/** 전체 A/S 현황의 잎 — 🔴 차례까지 글자 그대로. 일곱이 남고 셋이 더해졌다. */
const REPAIR_CASE_LEAF_KEYS = [
  "repairCases.view",
  "repairCases.edit",
  "repairCases.workRecords",
  "repairCases.usedParts",
  "repairCases.lifecycle",
  "repairCases.files",
  "repairCases.procedureExecution",
  // ── 2026-11-12 에 더해진 셋 ──
  "repairCases.workHistory",
  "repairCases.serviceReports",
  "repairCases.approval",
] as const;

/** 2026-11-12 **이전부터** 있던 일곱. 이 목록에서 하나라도 빠지면 저장된 설정이 죽는다. */
const PRE_EXISTING_REPAIR_CASE_LEAVES = REPAIR_CASE_LEAF_KEYS.slice(0, 7);

const NEW_TAB_LEAVES = ["repairCases.workHistory", "repairCases.serviceReports", "repairCases.approval"] as const;

/**
 * 🔴 **바꾸기 전에 실측한 상한 표**(2026-11-12). 새 잎 셋을 더하면서 **기존 일곱 중
 * 한 칸도 달라지지 않았는가**를 여기서 본다 — 권한을 건드린 조각에서 가장 조용히
 * 깨지는 것이 이쪽이다(열린 것은 금방 드러나지만 닫힌 것은 아무도 신고하지 않는다).
 */
const BASELINE_BEFORE: Record<string, Record<Role, string>> = {
  "repairCases.view": { SUPER_ADMIN: "READ", ADMIN: "READ", AS_ENGINEER: "READ", SALES: "READ", INVENTORY_MANAGER: "READ" },
  "repairCases.edit": { SUPER_ADMIN: "WRITE", ADMIN: "WRITE", AS_ENGINEER: "WRITE", SALES: "WRITE", INVENTORY_MANAGER: "NONE" },
  "repairCases.workRecords": { SUPER_ADMIN: "MANAGE", ADMIN: "MANAGE", AS_ENGINEER: "WRITE", SALES: "READ", INVENTORY_MANAGER: "READ" },
  "repairCases.usedParts": { SUPER_ADMIN: "WRITE", ADMIN: "WRITE", AS_ENGINEER: "WRITE", SALES: "NONE", INVENTORY_MANAGER: "NONE" },
  "repairCases.lifecycle": { SUPER_ADMIN: "MANAGE", ADMIN: "MANAGE", AS_ENGINEER: "NONE", SALES: "NONE", INVENTORY_MANAGER: "NONE" },
  "repairCases.files": { SUPER_ADMIN: "WRITE", ADMIN: "WRITE", AS_ENGINEER: "WRITE", SALES: "WRITE", INVENTORY_MANAGER: "WRITE" },
  "repairCases.procedureExecution": { SUPER_ADMIN: "MANAGE", ADMIN: "MANAGE", AS_ENGINEER: "WRITE", SALES: "READ", INVENTORY_MANAGER: "READ" },
  // 탭 열쇠로 쓰이는 이웃 메뉴의 잎 · 메뉴들도 함께 못 박는다 — 이 조각이 그것들을
  // 건드리지 않았다는 사실 자체가 「[견적서]·[발주서]는 그대로」의 근거다.
  "diagnosisFlowcharts.view": { SUPER_ADMIN: "READ", ADMIN: "READ", AS_ENGINEER: "READ", SALES: "READ", INVENTORY_MANAGER: "READ" },
  quotes: { SUPER_ADMIN: "MANAGE", ADMIN: "MANAGE", AS_ENGINEER: "WRITE", SALES: "WRITE", INVENTORY_MANAGER: "NONE" },
  /**
   * 🔴 2026-11-12(**같은 날 둘째**): `domesticOrders`(메뉴 키)가 여기 있었다. 그날
   * 오후 그 메뉴가 잎 넷으로 쪼개지면서 메뉴 키는 저장되는 잎이 아니게 됐고
   * (`baselineLeafLevel` 이 NONE 을 돌려준다), [발주서] 탭의 열쇠가 조회 잎으로
   * 내려왔다. 그래서 **같은 질문을 새 열쇠에 한다** — 줄을 지운 것이 아니다.
   *
   * 🔵 **가리키는 사람 집합이 그대로임이 여기서 보인다**: 쪼개기 전 메뉴 값이
   * MANAGE/MANAGE/WRITE/WRITE/NONE 이었고 탭은 그중 READ 이상을 물었다 — 넘던 넷이
   * 그대로 아래 READ 를 넘고, 자재 담당자는 전과 같이 못 넘는다.
   * 🔵 메뉴 수준 자체가 그대로라는 사실은 이 파일이 아니라
   * `domestic-order-permission-leaves.test.ts` 가 다섯 역할 × 영역 수준으로 잰다.
   */
  "domesticOrders.view": { SUPER_ADMIN: "READ", ADMIN: "READ", AS_ENGINEER: "READ", SALES: "READ", INVENTORY_MANAGER: "NONE" },
};

describe("① 🔴 기본값이 지금과 같다 — 새 잎 셋은 다섯 역할 전부에게 열려 있다", () => {
  test("표본이 비어 있지 않다 — 역할 다섯을 실제로 훑는다", () => {
    assert.equal(ROLE_CODES.length, 5, "역할 수가 달라졌다 — 이 파일의 표를 다시 잴 것");
  });

  for (const leafKey of NEW_TAB_LEAVES) {
    test(`${leafKey} 는 다섯 역할 전부 READ 다`, () => {
      for (const role of ROLE_CODES) {
        assert.equal(
          baselineLeafLevel(leafKey, role),
          "READ",
          `${leafKey} / ${role}: 기본값이 닫혔다 — 배포 즉시 그 역할이 탭을 못 본다`
        );
      }
    });
  }

  test("🔴 상한 계산을 빠뜨리지 않았다 — permission-baseline 의 default 로 떨어지면 NONE 이다", () => {
    for (const leafKey of NEW_TAB_LEAVES) {
      assert.notEqual(baselineLeafLevel(leafKey, "SUPER_ADMIN"), "NONE", `${leafKey} 의 case 가 없다`);
    }
  });
});

describe("② 🔴 권한 키가 하나도 안 사라졌다 — 수를 센다", () => {
  test("전체 A/S 현황의 잎은 **있던 일곱 + 더한 셋**이고 차례도 그대로다", () => {
    assert.deepEqual(
      featuresOfArea("repairCases").map((feature) => feature.key),
      [...REPAIR_CASE_LEAF_KEYS]
    );
  });

  test("있던 일곱이 전부 살아 있다 — 저장된 role_permissions 행이 가리킬 곳을 잃지 않았다", () => {
    for (const leafKey of PRE_EXISTING_REPAIR_CASE_LEAVES) {
      assert.ok(isPermissionLeafKey(leafKey), `${leafKey} 가 사라졌다 — 운영에 저장된 설정이 조용히 죽는다`);
    }
    assert.equal(PRE_EXISTING_REPAIR_CASE_LEAVES.length, 7);
  });

  test("🔴 저장되는 잎의 총수는 51 — 45 → 48(탭 셋) → 51(내자 쪼개기)", () => {
    // 수가 달라지면 사람이 한 번 더 보게 한다. 줄어든 쪽은 특히 조용하다.
    //
    // 🔴 2026-11-12 **같은 날 두 번**이 움직였다:
    //   · 오전 45 → 48 — 수리 건 상세의 탭 잎 셋이 더해졌다.
    //   · 오후 48 → 51 — `domesticOrders` 하나가 빠지고 그 아래 넷이 들어왔다(순증 +3).
    // 🔵 **빠진 하나가 죽지 않았다는 증거**는 아래 ④ 와 마이그레이션(drizzle/0127)이다.
    assert.equal(PERMISSION_LEAF_KEYS.length, 51);
    assert.equal(new Set(PERMISSION_LEAF_KEYS).size, PERMISSION_LEAF_KEYS.length, "키가 겹친다");
  });

  test("🔴 있던 일곱의 상한이 한 칸도 안 달라졌다", () => {
    for (const [leafKey, expected] of Object.entries(BASELINE_BEFORE)) {
      for (const role of ROLE_CODES) {
        assert.equal(
          baselineLeafLevel(leafKey, role),
          expected[role],
          `${leafKey} / ${role}: 기본 정책이 달라졌다`
        );
      }
    }
  });
});

describe("③ 🔴 [기본 정보]는 가리지 않는다", () => {
  test("탭 표에 [기본 정보]를 가리킬 칸이 없다", () => {
    // 🔴 `repairCases.view` 가 [접근 불가]면 목록도 상세도 통째로 막힌다 — 탭 하나를
    // 가리는 문제가 아니다. 그 탭에 따로 검사를 붙이면 「들어왔는데 첫 탭이 없는」
    // 상태가 생긴다(2026-11-12 사용자 결정).
    const covered = Object.values(REPAIR_CASE_DETAIL_TAB_PERMISSIONS).flatMap((entry) =>
      entry.anyOf.map((requirement) => requirement.key)
    );
    assert.equal(covered.includes("repairCases.view"), false, "[기본 정보]를 가리는 열쇠가 표에 들어왔다");
    assert.equal(
      REPAIR_CASE_DETAIL_TAB_KEYS.some((key) => (key as string) === "root"),
      false,
      "표에 root 칸이 생겼다 — [기본 정보]를 가릴 수 있게 됐다"
    );
  });

  test("가릴 수 있는 탭은 여덟이다 — 아홉 중 [기본 정보] 하나만 빠진다", () => {
    assert.equal(REPAIR_CASE_DETAIL_TAB_KEYS.length, 8);
    assert.deepEqual([...REPAIR_CASE_DETAIL_TAB_KEYS].sort(), [
      "approval",
      "diagnosis",
      "execution",
      "files",
      "purchaseOrders",
      "quotes",
      "report",
      "workHistory",
    ]);
  });
});

describe("④ 🔴 [견적서]·[발주서]는 **탭 전용 키를 만들지 않았다** — 이웃 메뉴의 것을 쓴다", () => {
  test("두 탭의 열쇠가 하나씩이고, 둘 다 **이웃 메뉴 쪽**이다", () => {
    assert.deepEqual(REPAIR_CASE_DETAIL_TAB_PERMISSIONS.quotes, {
      anyOf: [{ key: "quotes", level: "READ" }],
    });
    // 🔴 2026-11-12(둘째)에 `domesticOrders` → `domesticOrders.view` 로 **내려왔다.**
    //    탭 전용 키를 만든 것이 아니다 — 내자 메뉴가 잎 넷으로 쪼개지면서 그중
    //    「조회」 잎이 이 탭의 제자리가 됐다(기타건 상세의 같은 탭과 한 열쇠다).
    assert.deepEqual(REPAIR_CASE_DETAIL_TAB_PERMISSIONS.purchaseOrders, {
      anyOf: [{ key: "domesticOrders.view", level: "READ" }],
    });
  });

  /**
   * 🔴 **이 시험은 2026-11-12(둘째)에 `quotes` 하나로 좁아졌다 — 지운 것이 아니다.**
   *
   * 원래 둘(`quotes` · `domesticOrders`)을 봤고, 이 울타리가 그날 **실제로 우리를
   * 살렸다**: 내자 메뉴에 잎을 하나 넣어 보는 순간 이 줄이 터지면서 「메뉴 키가 잎
   * 목록에서 빠지고 메뉴 수준이 잎들의 최대값이 된다」가 드러났다(그대로 갔으면 내자
   * 정리의 쓰기·삭제가 전원에게 조용히 막혔다). `domesticOrders` 를 **일부러** 뺀 것은
   * 그 메뉴를 **넷으로 한꺼번에** 쪼개 메뉴 수준을 그대로 지켰기 때문이고, 그 사실은
   * `domestic-order-permission-leaves.test.ts` 가 다섯 역할로 잰다.
   *
   * 🔴 `quotes` 에는 그 울타리가 **그대로 필요하다.** 저쪽은 아직 하위 기능이 없어
   * 메뉴 키가 곧 저장되는 잎이고, 거기에 잎을 하나만 더하면 **견적서 메뉴가 바로 그
   * 함정에 빠진다**(쓰기·삭제가 전원에게 막힌다). 그때 이 줄이 다시 터져야 한다.
   */
  test("🔴 `quotes` 에는 하위 기능이 없다 — 그래서 메뉴 키가 곧 저장되는 잎이다", () => {
    assert.ok(isPermissionLeafKey("quotes"), "quotes 가 더 이상 잎이 아니다 — 탭의 열쇠를 다시 볼 것");
    assert.equal(featuresOfArea("quotes").length, 0, "quotes 에 하위 기능이 생겼다");
  });

  test("🔴 거꾸로, `domesticOrders` 는 이제 메뉴 키로 저장되지 않는다", () => {
    // 🔵 「쪼갰다」를 값으로 못 박는다 — 메뉴 키가 아직 잎이면 마이그레이션(0127)이
    //    옮긴 행과 옛 행이 **둘 다 살아** 서로 다른 답을 낼 수 있다.
    assert.equal(isPermissionLeafKey("domesticOrders"), false, "메뉴 키가 아직 잎이다 — 쪼개기가 안 됐다");
    assert.equal(featuresOfArea("domesticOrders").length, 4, "내자 잎이 넷이 아니다");
  });
});

describe("⑤ 표의 모든 열쇠가 실재하고, 수준은 전부 읽기다", () => {
  test("표의 모든 열쇠가 저장되는 키다 — 오타는 조용히 전원 허용이 아니라 전원 차단이 된다", () => {
    let counted = 0;
    for (const tab of REPAIR_CASE_DETAIL_TAB_KEYS) {
      const entry = REPAIR_CASE_DETAIL_TAB_PERMISSIONS[tab];
      assert.ok(entry.anyOf.length > 0, `${tab}: 요구사항이 비었다 — 아무에게도 안 열리는 탭이 된다`);
      for (const requirement of entry.anyOf) {
        assert.ok(isPermissionLeafKey(requirement.key), `${tab}: 트리에 없는 키 ${requirement.key}`);
        assert.equal(requirement.level, "READ", `${tab}: 탭에 들어가는 문턱이 읽기가 아니다`);
        counted += 1;
      }
    }
    // 여덟 탭에 열쇠 아홉 — [작업내용]만 둘이다.
    assert.equal(counted, 9, "표의 열쇠 수가 달라졌다 — 사람이 한 번 더 볼 것");
  });

  test("새 잎 셋은 고를 것이 「접근 불가 / 읽기」 둘뿐이다", () => {
    for (const leafKey of NEW_TAB_LEAVES) {
      assert.deepEqual(
        selectableLevelsOfLeaf(leafKey),
        ["NONE", "READ"],
        `${leafKey}: 골라도 아무것도 달라지지 않는 칸이 생겼다`
      );
      assert.equal(
        findPermissionFeature(leafKey)?.levelHints,
        undefined,
        `${leafKey}: 고를 것이 하나인데 수준별 설명이 달려 있다`
      );
    }
  });
});

describe("⑥ 🔴 설정이 실제 판정을 지배한다고 화면이 말해도 되는가", () => {
  test("새 잎 셋이 SETTINGS_ENFORCED 다 — 레이아웃과 페이지가 이 설정만 본다", () => {
    for (const leafKey of NEW_TAB_LEAVES) {
      assert.equal(isSettingsEnforced(leafKey), true, `${leafKey}: 넓혀도 안 열린다고 화면이 말하게 된다`);
    }
  });

  test("탭을 여닫게 된 **기존** 열쇠들도 그대로 SETTINGS_ENFORCED 다", () => {
    // 🔴 `domesticOrders` → `domesticOrders.view`(2026-11-12 둘째). 이 탭을 여는 열쇠
    //    그 자체를 봐야 한다 — 메뉴 키를 보면 쪼갠 뒤에도 참이라 아무것도 재지 않는다.
    for (const key of ["repairCases.workRecords", "repairCases.files", "diagnosisFlowcharts.view", "quotes", "domesticOrders.view"]) {
      assert.equal(isSettingsEnforced(key), true, `${key}: 탭을 가리게 됐는데 설정이 최종 판정이 아니다`);
    }
  });

  test("🔴 `repairCases.edit` 은 여전히 예외다 — 메뉴가 통째로 전환된 것처럼 말하지 않는다", () => {
    // 역할별 편집 가능 필드 목록이 4단계 사다리보다 잘다(permission-features.ts).
    // 잎을 셋 더했다고 이 사실이 달라지면 안 된다.
    assert.equal(isSettingsEnforced("repairCases.edit"), false);
    assert.equal(isSettingsEnforced("repairCases"), false, "메뉴가 통째로 전환된 것으로 보인다");
  });
});

describe("⑦ 🔴 이름표가 화면의 탭 이름과 같다", () => {
  const LABEL_BY_LEAF: Record<string, string> = {
    "repairCases.workRecords": "작업내용",
    "repairCases.files": "파일 관리",
    "repairCases.workHistory": "작업 이력",
    "repairCases.serviceReports": "보고서",
    "repairCases.approval": "검수/승인",
  };

  test("탭을 여닫는 잎의 이름표가 그 탭의 글자다", () => {
    for (const [leafKey, label] of Object.entries(LABEL_BY_LEAF)) {
      assert.equal(findPermissionFeature(leafKey)?.label, label, `${leafKey} 의 이름표가 탭 이름과 다르다`);
    }
  });

  test("🔴 이름표를 바꿨어도 **키는 그대로**다 — 저장된 설정이 가리킬 곳을 잃지 않는다", () => {
    // 「작업 기록」 → 「작업내용」 은 2026-11-12 의 이름표 변경이다. 키가 함께
    // 바뀌면 운영의 role_permissions 행이 **오류 없이 조용히** 무효가 된다.
    assert.ok(isPermissionLeafKey("repairCases.workRecords"));
    assert.equal(isPermissionLeafKey("repairCases.workContent"), false, "키까지 바꿨다");
  });

  test("새 잎 셋에 설명이 있고, 그 설명이 어느 탭인지 말한다", () => {
    for (const leafKey of NEW_TAB_LEAVES) {
      const feature = findPermissionFeature(leafKey);
      assert.ok(feature, `${leafKey} 를 못 찾았다`);
      assert.ok(feature.description.includes("탭"), `${leafKey}: 설명이 어느 탭인지 말하지 않는다`);
      assert.ok(feature.description.includes(feature.label), `${leafKey}: 설명에 탭 이름이 없다`);
    }
  });
});

describe("⑧ 🔴 탭이 하나도 없는 사람은 생기지 않는다", () => {
  test("여덟을 전부 닫아도 [기본 정보]는 남는다 — 표가 그 탭을 모르기 때문이다", () => {
    // 🔵 이 성질은 값이 아니라 **타입**이 지킨다(표에 root 칸이 없다). 그 사실이
    // 깨졌는지를 위 ③ 이 보고, 여기서는 「그래서 빈 화면이 안 생긴다」를 적어 둔다.
    const allClosed: Record<RepairCaseDetailTabKey, boolean> = Object.fromEntries(
      REPAIR_CASE_DETAIL_TAB_KEYS.map((tab) => [tab, false])
    ) as Record<RepairCaseDetailTabKey, boolean>;
    assert.equal(Object.values(allClosed).some(Boolean), false, "표본이 비었다 — 전부 닫힌 상태가 아니다");
    assert.equal(Object.keys(allClosed).includes("root"), false);
  });

  test("상세 화면에 들어올 수 있는 사람은 [기본 정보]를 본다 — 둘이 같은 열쇠다", () => {
    for (const role of ROLE_CODES) {
      assert.equal(baselineLeafLevel("repairCases.view", role), "READ");
    }
  });
});

/**
 * ============================================================================
 * ⑨ 🔴 [작업내용] 탭은 열쇠가 **둘**이고 OR 다 (2026-11-12, 같은 날 두 번째)
 * ============================================================================
 * 처음에는 `repairCases.workRecords` 하나로 이 탭을 닫았다. 그러면 관리자가
 * 「작업 기록을 못 쓰게 하겠다」고 닫는 순간 **같은 탭에 사는 「작업 절차 수행」과
 * 워크플로 단계 변경까지 통째로 사라진다** — 절차 수행으로 가는 입구는 저장소에
 * 그 탭 하나뿐이라, 그 역할은 그 기능으로 **가는 길 자체를 잃는다.** 닫은 사람은
 * 자기가 무엇을 껐는지 모른다.
 *
 * 그래서 **둘 중 하나라도 읽기 이상이면 탭을 보여 준다.**
 *
 * 🔵 판정 함수가 순수해서 **값으로 잰다** — 화면(레이아웃)도 서버(각 page.tsx)도
 * 결국 이 함수 하나에 닿으므로(`auth/repair-case-detail-tab-access.ts`), 여기서
 * 거짓이면 **주소를 직접 쳐도 막힌다**는 뜻이다.
 * ============================================================================
 */
describe("⑨ 🔴 [작업내용] — 작업 기록만 닫아도 탭은 남는다", () => {
  const WORK_RECORDS = "repairCases.workRecords";
  const PROCEDURE = "repairCases.procedureExecution";

  /** 적힌 잎만 그 수준이고 나머지는 접근 불가인 세계. */
  function levels(map: Record<string, PermissionLevel>) {
    return (key: string): PermissionLevel => map[key] ?? "NONE";
  }

  test("표본 확인 — 이 탭의 열쇠가 정말 둘이다(나머지 일곱은 하나씩)", () => {
    assert.deepEqual([...requiredKeysOfRepairCaseDetailTab("execution")], [WORK_RECORDS, PROCEDURE]);
    for (const tab of REPAIR_CASE_DETAIL_TAB_KEYS) {
      if (tab === "execution") continue;
      assert.equal(requiredKeysOfRepairCaseDetailTab(tab).length, 1, `${tab}: 열쇠가 하나가 아니다`);
    }
  });

  test("🔴 작업 기록을 닫아도 — 절차 수행이 열려 있으면 **탭이 그대로 보인다**", () => {
    assert.equal(
      isRepairCaseDetailTabOpen("execution", levels({ [PROCEDURE]: "READ" })),
      true,
      "작업 기록 하나를 닫았더니 절차 수행이 길을 잃었다"
    );
  });

  test("거꾸로도 같다 — 절차 수행을 닫아도 작업 기록이 열려 있으면 탭이 보인다", () => {
    assert.equal(isRepairCaseDetailTabOpen("execution", levels({ [WORK_RECORDS]: "READ" })), true);
  });

  test("🔴 **둘 다** [접근 불가]일 때만 탭이 숨는다 — 그때는 주소를 직접 쳐도 막힌다", () => {
    // 🔴 화면도 서버도 이 함수 하나에 닿는다(repair-case-detail-tab-access.ts) —
    // 거짓이면 탭이 안 그려지고, 같은 답으로 page.tsx 가 되돌려보낸다.
    assert.equal(isRepairCaseDetailTabOpen("execution", levels({})), false);
    assert.equal(
      isRepairCaseDetailTabOpen("execution", levels({ [WORK_RECORDS]: "NONE", [PROCEDURE]: "NONE" })),
      false
    );
  });

  test("더 높은 수준도 당연히 연다 — 읽기 이상이면 된다", () => {
    assert.equal(isRepairCaseDetailTabOpen("execution", levels({ [WORK_RECORDS]: "MANAGE" })), true);
    assert.equal(isRepairCaseDetailTabOpen("execution", levels({ [PROCEDURE]: "WRITE" })), true);
  });

  test("🔴 OR 가 다른 탭으로 새지 않는다 — 열쇠 하나짜리 일곱은 그 하나를 닫으면 숨는다", () => {
    for (const tab of REPAIR_CASE_DETAIL_TAB_KEYS) {
      if (tab === "execution") continue;
      const [key] = requiredKeysOfRepairCaseDetailTab(tab);
      assert.equal(isRepairCaseDetailTabOpen(tab, levels({ [key]: "READ" })), true, `${tab}: 열어도 안 열린다`);
      assert.equal(isRepairCaseDetailTabOpen(tab, levels({})), false, `${tab}: 닫아도 안 닫힌다`);
    }
  });

  test("🔴 기본 정책에서는 여덟 탭이 전부 열린다 — 역할 다섯 모두", () => {
    for (const role of ROLE_CODES) {
      const levelOf = (key: string) => baselineLeafLevel(key, role);
      for (const tab of REPAIR_CASE_DETAIL_TAB_KEYS) {
        // 🔵 [견적서]·[발주서]는 자재 담당자에게 **원래부터** 닫혀 있다(이 조각이
        //    만든 것이 아니다 — `quotes`/`domesticOrders.view` 의 기본값이 NONE 이다).
        const expected =
          role === "INVENTORY_MANAGER" && (tab === "quotes" || tab === "purchaseOrders") ? false : true;
        assert.equal(
          isRepairCaseDetailTabOpen(tab, levelOf),
          expected,
          `${role} / ${tab}: 기본 상태의 탭 가시성이 달라졌다`
        );
      }
    }
  });
});
