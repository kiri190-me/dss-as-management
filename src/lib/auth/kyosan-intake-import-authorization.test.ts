import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import { findPermissionArea, type PermissionLevel } from "./permission-areas";
import { baselineLeafLevel, baselinePermissionLevel } from "./permission-baseline";
import {
  hasFeatures,
  isPermissionLeafKey,
  isSettingsEnforced,
  selectableLevelsOfLeaf,
} from "./permission-features";
import { canImportKyosanIntakeList } from "./kyosan-intake-import-authorization";

const AREA = "kyosanIntakeImport";

test("과거 인수품 가져오기는 최고관리자·관리자만 할 수 있다", () => {
  const expected: Record<Role, boolean> = {
    SUPER_ADMIN: true,
    ADMIN: true,
    AS_ENGINEER: false,
    SALES: false,
    INVENTORY_MANAGER: false,
  };
  for (const role of ROLE_CODES) {
    assert.equal(canImportKyosanIntakeList(role), expected[role], role);
  }
});

test("알 수 없는 역할 값에는 거짓을 답한다 — 세션이 망가졌을 때 열어 주지 않는다", () => {
  assert.equal(canImportKyosanIntakeList("UNKNOWN_ROLE" as Role), false);
});

test("기본값: 최고관리자·관리자는 관리, 나머지는 접근 불가 — 영역과 잎이 같다", () => {
  // 🔴 permission-baseline.ts 의 case 가 빠지면 다섯 줄 전부 NONE 으로 떨어져 최고관리자까지
  // 막힌다(mailSettings 와 같은 함정) — 그것을 여기서 잡는다.
  const expected: Record<Role, PermissionLevel> = {
    SUPER_ADMIN: "MANAGE",
    ADMIN: "MANAGE",
    AS_ENGINEER: "NONE",
    SALES: "NONE",
    INVENTORY_MANAGER: "NONE",
  };
  for (const role of ROLE_CODES) {
    assert.equal(baselinePermissionLevel(AREA, role), expected[role], role);
    assert.equal(baselineLeafLevel(AREA, role), expected[role], `${role} (잎)`);
  }
});

test("관리가 상한인 하위 기능 없는 잎이고, 설정이 최종 판정이다", () => {
  assert.equal(findPermissionArea(AREA)?.maxMeaningfulLevel, "MANAGE");
  assert.equal(hasFeatures(AREA), false);
  assert.equal(isPermissionLeafKey(AREA), true);
  assert.equal(isSettingsEnforced(AREA), true);
  assert.deepEqual(selectableLevelsOfLeaf(AREA), ["NONE", "READ", "WRITE", "MANAGE"]);
});
