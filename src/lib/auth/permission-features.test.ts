import { test } from "node:test";
import assert from "node:assert/strict";

import { PERMISSION_AREAS, permissionLevelRank, type PermissionLevel } from "./permission-areas";
import {
  PERMISSION_LEAF_KEYS,
  areaKeyOfLeaf,
  areaLevelFromLeaves,
  featuresOfArea,
  findPermissionFeature,
  hasFeatures,
  isPermissionLeafKey,
  isSettingsEnforced,
  levelHintOfLeaf,
  maxMeaningfulLevelOfLeaf,
  minMeaningfulLevelOfLeaf,
  selectableLevelsOfLeaf,
} from "./permission-features";
import { baselineLeafLevel, baselinePermissionLevel } from "./permission-baseline";
import {
  canBulkDeleteRepairCases,
  canRestoreRepairCases,
  canPermanentlyDeleteRepairCases,
  canEditSection,
} from "./repair-case-edit-authorization";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

function featureMax(areaKey: string, role: Role): PermissionLevel {
  return featuresOfArea(areaKey).reduce<PermissionLevel>((acc, feature) => {
    const level = baselineLeafLevel(feature.key, role);
    return permissionLevelRank(level) > permissionLevelRank(acc) ? level : acc;
  }, "NONE");
}

// ───────────────────────────────────────────────────── 트리 자체의 무결성

test("잎 키는 중복되지 않는다", () => {
  assert.equal(new Set(PERMISSION_LEAF_KEYS).size, PERMISSION_LEAF_KEYS.length);
});

test("하위 기능이 있는 메뉴는 자기 키를 잎으로 갖지 않는다", () => {
  // 메뉴와 하위 기능을 둘 다 저장하면 "메뉴는 읽기인데 하위는 쓰기"라는 설명
  // 불가능한 상태가 만들어진다. 메뉴 수준은 언제나 하위에서 계산된다.
  for (const area of PERMISSION_AREAS) {
    if (!hasFeatures(area.key)) continue;
    assert.ok(
      !PERMISSION_LEAF_KEYS.includes(area.key),
      `${area.key}는 하위 기능이 있는데 자기 키도 잎으로 들어가 있다`
    );
  }
});

test("모든 잎은 실재하는 메뉴에 속한다", () => {
  const areaKeys = new Set(PERMISSION_AREAS.map((area) => area.key));
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    assert.ok(areaKeys.has(areaKeyOfLeaf(leafKey)), `${leafKey}의 메뉴를 찾을 수 없다`);
  }
});

test("하위 기능 키는 '<메뉴>.<기능>' 경로 형태다", () => {
  for (const area of PERMISSION_AREAS) {
    for (const feature of featuresOfArea(area.key)) {
      assert.equal(feature.key, `${area.key}.${feature.key.split(".")[1]}`);
      assert.equal(feature.areaKey, area.key);
    }
  }
});

// ───────────────────────────────────── 트리에 넣고 상한을 빠뜨리는 사고 방지

test("하위 기능 노드 중 상한 계산이 빠진 것이 없다", () => {
  // permission-features.ts에 노드만 추가하고 permission-baseline.ts의 switch를
  // 빠뜨리면 default로 떨어져 조용히 NONE이 된다. 하위 기능은 전부 최고관리자에게
  // 열려 있으므로, 여기서 NONE이 나오면 그건 빠뜨린 것이다.
  //
  // 하위 기능이 없는 메뉴(점이 없는 키)는 기존 baselinePermissionLevel을 그대로
  // 타므로 여기서 보지 않는다 — '내 담당 제품'처럼 최고관리자에게도 닫혀 있는
  // 메뉴가 실제로 있어서(엔지니어 전용 설계) 같은 잣대를 댈 수 없다.
  for (const leafKey of PERMISSION_LEAF_KEYS.filter((key) => key.includes("."))) {
    assert.notEqual(
      baselineLeafLevel(leafKey, "SUPER_ADMIN"),
      "NONE",
      `${leafKey}의 상한 계산이 permission-baseline.ts에 없다`
    );
  }
});

test("상한은 그 잎에서 의미 있는 최고 수준을 넘지 않는다", () => {
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    for (const role of ROLE_CODES) {
      const level = baselineLeafLevel(leafKey, role);
      assert.ok(
        permissionLevelRank(level) <= permissionLevelRank(maxMeaningfulLevelOfLeaf(leafKey)),
        `${leafKey} / ${role}: ${level}이 의미 있는 최고 수준을 넘는다`
      );
    }
  }
});

test("트리에 없는 키는 열리지 않는다", () => {
  assert.equal(isPermissionLeafKey("inventory.nonexistent"), false);
  assert.equal(baselineLeafLevel("inventory.nonexistent", "SUPER_ADMIN"), "NONE");
  assert.equal(baselineLeafLevel("아무거나", "SUPER_ADMIN"), "NONE");
});

// ─────────────────────────── 세분화가 메뉴 접근을 바꾸지 않는다 (핵심 불변식)

test("하위 기능으로 쪼개도 메뉴에 들어갈 수 있는 역할은 그대로다", () => {
  // 이 기능의 전제다 — 트리를 도입한 것만으로 없던 메뉴가 열리거나 있던 메뉴가
  // 닫히면 안 된다. 수준(읽기/쓰기/관리)은 달라질 수 있다: 메뉴 하나에 수준
  // 하나를 붙이던 기존 상한이 근사치였고, 하위 기능 쪽이 실제 정책에 더 가깝다.
  for (const area of PERMISSION_AREAS) {
    if (!hasFeatures(area.key)) continue;
    for (const role of ROLE_CODES) {
      const areaOpen = baselinePermissionLevel(area.key, role) !== "NONE";
      const featureOpen = featureMax(area.key, role) !== "NONE";
      assert.equal(
        featureOpen,
        areaOpen,
        `${area.key} / ${role}: 메뉴 접근 여부가 달라졌다 (메뉴=${areaOpen}, 하위=${featureOpen})`
      );
    }
  }
});

// ─────────────────────────────────── 지금 정책이 그대로 남아 있는지 (구체 사례)

test("영업은 End-User를 만들 수 있지만 이름은 못 고친다", () => {
  // 메뉴 단위 권한만으로는 표현할 수 없던 구분이다. 한 칸에 접으면 영업이
  // 이름까지 고치게 된다 — 이 트리를 만든 이유가 이것이다.
  assert.equal(baselineLeafLevel("customers.endUsers", "SALES"), "WRITE");
  assert.equal(baselineLeafLevel("customers.endUsers", "ADMIN"), "MANAGE");
});

test("영업은 담당자를 추가·수정할 수 있지만 삭제는 못 한다", () => {
  assert.equal(baselineLeafLevel("customers.contacts", "SALES"), "WRITE");
  assert.equal(baselineLeafLevel("customers.contacts", "ADMIN"), "MANAGE");
});

test("엔지니어는 부품을 요청할 수 있지만 요청을 처리하지는 못한다", () => {
  assert.equal(baselineLeafLevel("inventory.requests", "AS_ENGINEER"), "WRITE");
  assert.equal(baselineLeafLevel("inventory.requestProcessing", "AS_ENGINEER"), "NONE");
  assert.equal(baselineLeafLevel("inventory.requestProcessing", "INVENTORY_MANAGER"), "MANAGE");
});

test("엔지니어는 작업 기록을 남길 수 있지만 무효화는 못 한다", () => {
  assert.equal(baselineLeafLevel("repairCases.workRecords", "AS_ENGINEER"), "WRITE");
  assert.equal(baselineLeafLevel("repairCases.workRecords", "ADMIN"), "MANAGE");
});

test("영업·재고 담당자는 진단 흐름도를 편집할 수 없다", () => {
  // 기존 메뉴 상한은 '볼 수 있으면 쓰기까지' 열어 두는 근사치였다. 실제
  // canMutateRepairCaseFlowchart는 엔지니어까지만 통과시킨다.
  assert.equal(baselineLeafLevel("diagnosisFlowcharts.edit", "SALES"), "NONE");
  assert.equal(baselineLeafLevel("diagnosisFlowcharts.edit", "INVENTORY_MANAGER"), "NONE");
  assert.equal(baselineLeafLevel("diagnosisFlowcharts.edit", "AS_ENGINEER"), "WRITE");
});

test("삭제·복원 세 조작은 역할 집합이 같아서 한 노드로 접어도 된다", () => {
  // repairCases.lifecycle이 일괄 삭제·복원·영구 삭제를 한 칸에 담는 근거다.
  // 셋 중 하나라도 정책이 갈리면 진단 흐름도에서 났던 것과 같은 누수가 되므로,
  // 갈리는 순간 여기서 잡힌다.
  for (const role of ROLE_CODES) {
    const bulk = canBulkDeleteRepairCases(role);
    assert.equal(canRestoreRepairCases(role), bulk, `${role}: 복원이 일괄 삭제와 갈렸다`);
    assert.equal(canPermanentlyDeleteRepairCases(role), bulk, `${role}: 영구 삭제가 갈렸다`);
  }
});

test("접수 건 수정은 구간마다 역할이 달라서 한 노드로 접을 수 없다", () => {
  // 영업은 접수·고장 정보는 고치지만 제품 정보는 못 고친다. repairCases.edit을
  // 설정으로 옮기지 않은 이유이고(EDITABLE_FIELDS_BY_ROLE는 필드 단위라 4단계
  // 사다리보다 잘다), 이 차이가 사라지면 접어도 되는지 다시 판단해야 한다.
  assert.equal(canEditSection("SALES", "INTAKE"), true);
  assert.equal(canEditSection("SALES", "FAULT_SERVICE"), true);
  assert.equal(canEditSection("SALES", "PRODUCT"), false);
  assert.equal(
    isSettingsEnforced("repairCases.edit"),
    false,
    "구간별 차이가 남아 있는 한 이 노드는 설정이 최종 판정일 수 없다"
  );
  assert.equal(isSettingsEnforced("repairCases.lifecycle"), true);
});

test("엔지니어는 흐름도를 고칠 수 있지만 영구 삭제는 못 한다", () => {
  // 이 둘을 한 노드에 접었다가 엔지니어에게 영구 삭제가 열린 적이 있다.
  // canManageRepairCaseFlowchartsGlobally가 canMutateRepairCaseFlowchart와
  // 같은 역할 집합(엔지니어 포함)인데, 더 좁은 영구 삭제와 함께 묶었던 탓이다.
  assert.equal(baselineLeafLevel("diagnosisFlowcharts.edit", "AS_ENGINEER"), "WRITE");
  assert.equal(baselineLeafLevel("diagnosisFlowcharts.permanentDelete", "AS_ENGINEER"), "NONE");
  assert.equal(baselineLeafLevel("diagnosisFlowcharts.permanentDelete", "ADMIN"), "MANAGE");
});

test("출하 대표자 지정은 최고관리자만이다", () => {
  assert.equal(baselineLeafLevel("users.shipmentRepresentatives", "SUPER_ADMIN"), "MANAGE");
  for (const role of ROLE_CODES.filter((candidate) => candidate !== "SUPER_ADMIN")) {
    assert.equal(baselineLeafLevel("users.shipmentRepresentatives", role), "NONE");
  }
});

test("절차 수행은 기술 작업 절차가 아니라 접수 건 아래에 있다", () => {
  // 절차 '문서'를 못 보는 역할도 접수 건에서는 절차를 밟는다. 문서 쪽에 달면
  // 그 역할에게 기술 작업 절차 메뉴가 통째로 열린다.
  assert.ok(isPermissionLeafKey("repairCases.procedureExecution"));
  assert.equal(findPermissionFeature("technicalProcedures.execution"), undefined);
  assert.equal(baselineLeafLevel("technicalProcedures.view", "SALES"), "NONE");
  assert.notEqual(baselineLeafLevel("repairCases.procedureExecution", "SALES"), "NONE");
});

// ───────────────────────────────────── 메뉴 수준 계산 (resolver·저장·화면 공용)

test("메뉴 수준은 하위 기능 중 가장 높은 값이다", () => {
  const levels: Record<string, PermissionLevel> = {
    "inventory.view": "READ",
    "inventory.parts": "NONE",
    "inventory.stock": "WRITE",
    "inventory.history": "READ",
    "inventory.requests": "NONE",
    "inventory.requestProcessing": "NONE",
  };
  assert.equal(areaLevelFromLeaves("inventory", (key) => levels[key] ?? "NONE"), "WRITE");
});

test("하위 기능이 하나도 열려 있지 않으면 메뉴가 닫힌다", () => {
  // 사이드바에서 감추고 페이지 가드가 막는 판단이 이 값 하나에 달려 있다.
  assert.equal(areaLevelFromLeaves("inventory", () => "NONE"), "NONE");
});

test("하위 기능이 없는 메뉴는 자기 값이 그대로 메뉴 수준이다", () => {
  assert.equal(areaLevelFromLeaves("dashboard", (key) => (key === "dashboard" ? "READ" : "NONE")), "READ");
  assert.equal(areaLevelFromLeaves("dashboard", () => "NONE"), "NONE");
});

// ──────────────────────────────────────────────── 화면에 나가는 설명의 품질

test("모든 하위 기능에 한 줄 설명이 있다", () => {
  // 권한을 정하는 사람은 코드를 읽지 않는다. 여기 적힌 말이 그 사람이 가진
  // 정보의 전부라, 비어 있으면 화면에 빈 칸이 나간다.
  for (const area of PERMISSION_AREAS) {
    for (const feature of featuresOfArea(area.key)) {
      assert.ok(feature.description.trim().length > 0, `${feature.key}에 설명이 없다`);
      assert.ok(feature.label.trim().length > 0, `${feature.key}에 이름이 없다`);
    }
  }
});

test("고를 수 있는 수준이 둘 이상이면 수준별 설명이 있다", () => {
  // '읽기'와 '읽기+쓰기' 중 하나를 고르라고 하면서 둘이 무엇이 다른지 적어
  // 두지 않으면, 고르는 사람은 짐작할 수밖에 없다.
  for (const area of PERMISSION_AREAS) {
    for (const feature of featuresOfArea(area.key)) {
      if (feature.fixed) continue; // 고정 노드는 고를 것이 없다
      const choices = selectableLevelsOfLeaf(feature.key).filter((level) => level !== "NONE");
      if (choices.length < 2) continue;
      for (const level of choices) {
        assert.ok(
          levelHintOfLeaf(feature.key, level),
          `${feature.key}의 '${level}' 수준에 설명이 없다`
        );
      }
    }
  }
});

test("고를 수 없는 수준에는 설명을 달지 않는다", () => {
  // 고를 수 없는 수준에 설명이 달려 있으면, 그 수준이 존재한다고 오해하게 된다.
  for (const area of PERMISSION_AREAS) {
    for (const feature of featuresOfArea(area.key)) {
      const selectable = new Set(selectableLevelsOfLeaf(feature.key));
      for (const level of Object.keys(feature.levelHints ?? {}) as PermissionLevel[]) {
        assert.notEqual(level, "NONE", `${feature.key}: '접근 불가'는 공통 설명을 쓴다`);
        assert.ok(
          selectable.has(level),
          `${feature.key}: 고를 수 없는 '${level}'에 설명이 달려 있다`
        );
      }
    }
  }
});

test("선택지는 접근 불가와 [최소, 최대] 구간뿐이다", () => {
  // '삭제·복원'처럼 조작 하나만 있는 노드에 읽기·쓰기를 내밀면, 고른 사람이
  // 무언가 달라졌다고 믿게 된다.
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    const levels = selectableLevelsOfLeaf(leafKey);
    assert.equal(levels[0], "NONE", `${leafKey}: 접근 불가가 빠졌다`);
    for (const level of levels.slice(1)) {
      assert.ok(
        permissionLevelRank(level) >= permissionLevelRank(minMeaningfulLevelOfLeaf(leafKey)) &&
          permissionLevelRank(level) <= permissionLevelRank(maxMeaningfulLevelOfLeaf(leafKey)),
        `${leafKey}: '${level}'은 의미 있는 구간 밖이다`
      );
    }
  }
  assert.deepEqual(selectableLevelsOfLeaf("repairCases.lifecycle"), ["NONE", "MANAGE"]);
  assert.deepEqual(selectableLevelsOfLeaf("customers.endUsers"), ["NONE", "WRITE", "MANAGE"]);
  assert.deepEqual(selectableLevelsOfLeaf("repairCases.view"), ["NONE", "READ"]);
});

test("상한도 고를 수 있는 값이어야 한다", () => {
  // 화면은 상한을 '기본값'으로 보여 준다. 그 값이 선택지에 없으면 드롭다운이
  // 빈 칸으로 뜬다.
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    const selectable = new Set(selectableLevelsOfLeaf(leafKey));
    for (const role of ROLE_CODES) {
      const level = baselineLeafLevel(leafKey, role);
      assert.ok(selectable.has(level), `${leafKey} / ${role}: 상한 '${level}'을 고를 수 없다`);
    }
  }
});

// ────────────────────────────────────────────────────────────── 고정 노드

test("고정 노드는 설정이 최종 판정일 수 없고, 그 때문에 메뉴가 미전환으로 남지도 않는다", () => {
  // '역할별 접근 권한 설정'은 영원히 설정 밖에 있다 — 설정으로 닫을 수 있게
  // 하면 잘못 저장한 순간 되돌릴 사람이 없어진다. 그렇다고 그것 때문에
  // '사용자 관리'가 영원히 전환 중으로 보이면 화면이 거짓말을 하는 셈이다.
  assert.equal(isSettingsEnforced("users.rolePermissions"), false);
  assert.equal(isSettingsEnforced("users.view"), true);
  assert.equal(isSettingsEnforced("users.shipmentRepresentatives"), true);
  assert.equal(isSettingsEnforced("users"), true);
});

test("접수 건 수정이 남아 있는 한 '전체 A/S 현황'은 전환 완료가 아니다", () => {
  // 노드 하나만 남아도 메뉴 단위로는 '설정이 최종 판정'이라고 말할 수 없다.
  assert.equal(isSettingsEnforced("repairCases"), false);
});

test("설정으로 건드릴 수 없는 노드는 권한 설정 화면 하나뿐이다", () => {
  const fixed = PERMISSION_AREAS.flatMap((area) => featuresOfArea(area.key)).filter(
    (feature) => feature.fixed
  );
  assert.deepEqual(
    fixed.map((feature) => feature.key),
    ["users.rolePermissions"]
  );
});
