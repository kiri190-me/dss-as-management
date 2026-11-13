import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SETTINGS_TAB_KEYS,
  SETTINGS_TAB_LABELS,
  initialSettingsTab,
  type SettingsTabKey,
} from "./settings-tab-access";

/**
 * ============================================================================
 * [시스템 설정]이 탭 둘이 됐다 (2026-11-13, 조각 2)
 * ============================================================================
 * 🔴 여기서 지키는 것은 **지금까지 이 화면에 들어오던 사람이 보던 것이 그대로
 * 보이는가**다. 탭을 세우면서 첫 탭을 새것으로 두면, 늘 하던 일을 하러 온 사람이
 * 처음 보는 화면에서 제 카드를 못 찾는다 — 오류가 아니라 「없어졌다」로 읽힌다.
 *
 * 화면 본체(SettingsTabs)는 서버 액션 사슬을 물어 이 환경에서 그려 볼 수 없다.
 * 값으로 볼 수 있는 것(차례·이름·첫 탭)은 순수 모듈에서 재고, 나머지(무엇을 그리는가)는
 * **원본 글자**로 읽는다 — components 목록의 badge-visibility-panel.test.tsx 가
 * 탭 **안**을 실제로 그려서 잰다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

describe("① 탭 둘 — 차례와 이름", () => {
  test("표본이 비어 있지 않다 — 탭이 정확히 둘이다", () => {
    assert.equal(SETTINGS_TAB_KEYS.length, 2);
  });

  test("🔴 차례가 [고객 안내 상태 목록] → [배지 표시] 다", () => {
    assert.deepEqual([...SETTINGS_TAB_KEYS], ["customerStatusOptions", "badgeVisibility"]);
  });

  test("이름표가 둘 다 있고 서로 다르다", () => {
    const labels = SETTINGS_TAB_KEYS.map((key) => SETTINGS_TAB_LABELS[key]);
    assert.deepEqual(labels, ["고객 안내 상태 목록", "배지 표시"]);
    assert.equal(new Set(labels).size, 2);
  });

  test("🔴 처음 보여 줄 탭이 **첫째**다 — 예전에 보던 화면 그대로", () => {
    assert.equal(initialSettingsTab(), "customerStatusOptions");
    assert.equal(initialSettingsTab(), SETTINGS_TAB_KEYS[0]);
  });

  test("🔵 탭 키를 늘리면 이 시험이 먼저 멈춘다", () => {
    // 늘리는 것 자체는 좋은 일이지만, 차례와 첫 탭은 **사람의 판단**이어야 한다.
    const keys: readonly SettingsTabKey[] = SETTINGS_TAB_KEYS;
    assert.equal(new Set(keys).size, keys.length, "같은 탭 키가 두 번 적혔다");
  });
});

describe("② 화면이 그 모듈을 쓰는가 — 원본 글자", () => {
  const SCREEN = "src/components/settings/SettingsTabs.tsx";

  test("🔴 탭 줄을 **등록부에서** 그린다 — 이름을 JSX 에 적지 않는다", () => {
    const source = stripComments(read(SCREEN));
    assert.match(source, /SETTINGS_TAB_KEYS\.map/);
    assert.match(source, /SETTINGS_TAB_LABELS\[key\]/);
    // 탭 이름을 화면에 손으로 적으면 모듈과 두 벌이 되고, 둘 다 문자열이라 tsc 가 침묵한다.
    assert.equal(
      source.includes('"고객 안내 상태 목록"'),
      false,
      "탭 이름이 화면에도 적혀 있다 — 한쪽만 고쳐지는 날이 온다"
    );
  });

  test("🔴 첫 탭을 모듈에서 받는다", () => {
    assert.match(stripComments(read(SCREEN)), /useState<SettingsTabKey>\(\(\) => initialSettingsTab\(\)\)/);
  });

  test("🔴 **마지막 갈래가 예전 카드**다 — 알 수 없는 탭 값이 와도 빈 화면이 안 된다", () => {
    const source = stripComments(read(SCREEN));
    const badgeBranchAt = source.indexOf('activeTab === "badgeVisibility"');
    const statusCardAt = source.indexOf("<CustomerStatusOptionSettings");
    assert.ok(badgeBranchAt >= 0, "배지 탭 갈래를 못 찾았다");
    assert.ok(statusCardAt > badgeBranchAt, "예전 카드가 바닥 갈래가 아니다");
  });

  test("🔴 예전 카드의 권한이 그대로다 — `customerPortal` 의 관리", () => {
    // 🔴 배지 쪽 권한(`settings` 의 관리)과 **섞지 않는다.** 섞으면 시스템 설정을
    //    관리로 연 사람에게 고객 안내 상태 목록이 함께 열린다(또는 그 반대).
    const page = stripComments(read("src/app/(app)/settings/page.tsx"));
    assert.match(page, /hasPermission\(actingUser, "customerPortal", "MANAGE"\)/);
    assert.match(page, /canManageStatusOptions=\{canManageStatusOptions\}/);
    assert.match(page, /canManageBadges=\{canManageBadges\}/);
    const screen = stripComments(read(SCREEN));
    assert.match(screen, /canManage=\{canManageStatusOptions\}/);
    assert.match(screen, /canManage=\{canManageBadges\}/);
  });

  test("🔴 페이지 관문이 그대로다 — 주소를 직접 쳐도 막힌다", () => {
    assert.match(
      stripComments(read("src/app/(app)/settings/page.tsx")),
      /requireAreaAccessForCurrentUser\("settings"\)/
    );
  });
});
