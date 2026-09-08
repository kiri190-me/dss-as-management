import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUiTextGroup,
  findUiTextItem,
  hasForbiddenUiTextCharacter,
  normalizeUiTextValue,
  resolveUiText,
  UI_TEXT_GROUPS,
  UI_TEXT_MAX_LENGTH,
} from "./ui-text-overrides";
import { DEFAULT_UI_TEXT } from "./ui-text";
import {
  accountApprovalStatusLabels,
  billingTypeLabels,
  exceptionStatusLabels,
  priorityLabels,
  productCategoryLabels,
  repairStatusLabels,
  roleLabels,
  workHistoryTypeLabels,
  workRecordKindLabels,
  workflowTypeLabels,
} from "./types";

/**
 * ============================================================================
 * 화면 문구 등록부 — 자기 정합성과 병합
 * ============================================================================
 * 여기서 지키려는 것 다섯:
 *  1. 등록부가 types.ts 의 표와 **정확히 같다** — 문구 하나가 빠지면 그것만 영영
 *     못 바꾸는 값이 되고, 편집 화면에서는 "원래 없는 것"으로 보여 아무도 눈치채지
 *     못한다.
 *  2. 🔴 **일부러 뺀 세 표가 들어와 있지 않다.** 값으로 단언한다 — 나중에 누가
 *     "빠졌네" 하며 넣으면 이 시험이 먼저 걸린다.
 *  3. 🔴 **등록부의 묶음과 화면이 읽는 한 벌(DEFAULT_UI_TEXT)의 묶음이 같다.**
 *     이 둘이 갈라지면 "등록부에 있다 = 편집할 수 있다"가 조용히 깨진다 — 저장은
 *     되는데 아무 화면에도 안 나타나는 죽은 행이 쌓이고, 오류는 한 줄도 나지 않는다.
 *  4. 등록부의 기본 문구가 **자기 검증기를 통과한다.** 통과하지 못하는 기본값이
 *     하나라도 있으면 "되돌리기"가 그 자리에서만 실패한다.
 *  5. 병합은 **너그럽다** — 등록부에 없는 키의 남은 행 하나 때문에 화면이 죽으면
 *     안 된다.
 * ============================================================================
 */

/** 묶음 키 → types.ts 의 대응하는 표. 이 짝이 이 시험의 전제다. */
const EXPECTED_TABLES: Record<string, Record<string, string>> = {
  role: roleLabels,
  accountApprovalStatus: accountApprovalStatusLabels,
  workflowType: workflowTypeLabels,
  repairStatus: repairStatusLabels,
  priority: priorityLabels,
  workHistoryType: workHistoryTypeLabels,
  workRecordKind: workRecordKindLabels,
};

// ─────────────────────────────────────────────── 등록부 자기 정합성

test("묶음 키는 고유하고, 항목 키도 묶음 안에서 고유하다", () => {
  const groupKeys = UI_TEXT_GROUPS.map((group) => group.key);
  assert.equal(new Set(groupKeys).size, groupKeys.length, `묶음 키가 겹친다: ${groupKeys.join(", ")}`);

  for (const group of UI_TEXT_GROUPS) {
    const itemKeys = group.items.map((item) => item.key);
    assert.equal(
      new Set(itemKeys).size,
      itemKeys.length,
      `${group.key} 안에서 항목 키가 겹친다: ${itemKeys.join(", ")}`
    );
  }
});

test("묶음마다 관리자가 읽을 한글 이름과 쓰임새가 있다", () => {
  for (const group of UI_TEXT_GROUPS) {
    assert.ok(group.label.trim().length > 0, `${group.key}: label 이 비었다`);
    // "역할"만 적으면 무엇을 바꾸는지 모른다 — 어느 화면에서 보게 되는지가 있어야 한다.
    assert.ok(group.usage.trim().length >= 10, `${group.key}: usage 가 너무 짧다`);
  }
});

test("🔴 묶음이 7개이고 문구가 모두 42개다", () => {
  assert.equal(UI_TEXT_GROUPS.length, 7);
  const total = UI_TEXT_GROUPS.reduce((sum, group) => sum + group.items.length, 0);
  assert.equal(total, 42);
});

test("🔴 묶음마다 types.ts 의 표와 항목 키·기본 문구가 정확히 같다 — 빠진 문구가 없다", () => {
  assert.deepEqual(
    UI_TEXT_GROUPS.map((group) => group.key).sort(),
    Object.keys(EXPECTED_TABLES).sort(),
    "등록부의 묶음과 시험이 아는 표가 다르다 — 한쪽만 늘었다"
  );

  for (const group of UI_TEXT_GROUPS) {
    const table = EXPECTED_TABLES[group.key];
    assert.ok(table, `${group.key}: 대응하는 types.ts 표를 모른다`);

    assert.deepEqual(
      group.items.map((item) => item.key).sort(),
      Object.keys(table).sort(),
      `${group.key}: 항목 키가 types.ts 의 표와 다르다`
    );

    for (const item of group.items) {
      // 🔴 문구를 손으로 다시 적으면 두 벌이 된다. 이 단언이 그것을 막는다.
      assert.equal(
        item.defaultText,
        table[item.key],
        `${group.key}.${item.key}: 기본 문구가 types.ts 와 다르다`
      );
    }
  }
});

test("🔴 일부러 뺀 세 표는 등록부에 없다 — 문구 값으로 단언한다", () => {
  // 묶음 키로도 확인하지만(이름을 바꿔 넣는 길을 막는다), 진짜 방어선은 값이다.
  const groupKeys = new Set(UI_TEXT_GROUPS.map((group) => group.key));
  assert.ok(!groupKeys.has("productCategory"), "productCategoryLabels 를 등록부에 넣었다");
  assert.ok(!groupKeys.has("exceptionStatus"), "exceptionStatusLabels 를 등록부에 넣었다");
  assert.ok(!groupKeys.has("billingType"), "billingTypeLabels 를 등록부에 넣었다");

  const registered = new Set(
    UI_TEXT_GROUPS.flatMap((group) => group.items.map((item) => item.defaultText))
  );

  for (const [table, labels] of [
    // 문구 값이 곧 비교값이다(PRODUCT_CATEGORY_OPTIONS · my-active-work-filter.ts).
    // 바꾸면 기존 필터가 아무것도 못 찾는데 오류는 나지 않는다.
    ["productCategoryLabels", productCategoryLabels],
    // exception_statuses 표에 code·label 로 이미 들어 있다. 여기 또 담으면 진실이 셋.
    ["exceptionStatusLabels", exceptionStatusLabels],
    // 접수 알림 메일 본문에도 나가는 문구다(intake-mail-body.ts). 화면만 바꿀 수
    // 있게 열면 화면과 메일이 다른 말을 하고, 그 어긋남은 고객에게 먼저 보인다.
    ["billingTypeLabels", billingTypeLabels],
  ] as const) {
    for (const label of Object.values(labels)) {
      assert.ok(
        !registered.has(label),
        `${table} 의 문구가 등록부에 들어와 있다: "${label}" — 뺀 이유는 ui-text-overrides.ts 머리말에 있다`
      );
    }
  }
});

/**
 * 등록부에만 있고 화면 한 벌(DEFAULT_UI_TEXT)에는 없어도 되는 묶음 — **없다.**
 *
 * 등록부에 담긴 묶음은 전부 화면이 읽어야 한다. 하나라도 여기 남으면 "저장은
 * 되는데 아무 화면에도 안 나타나는" 죽은 행이 그 묶음에 쌓인다.
 */
const REGISTRY_ONLY_GROUPS: readonly string[] = [];

/**
 * 화면 한 벌에만 있고 등록부에는 없는 묶음 — 예외 하나뿐이다.
 *
 * 🔴 `exceptionStatus` 는 **출처가 다르다.** 그 문구의 주인은 ui_text_overrides 가
 * 아니라 DB 의 `exception_statuses` 표(code·label)이고, ui-text.ts 의
 * buildUiText 가 그 표에서 읽어 채운다. 그래서 화면은 읽지만 이 등록부에는
 * 들어오지 않는 것이 맞다 — 여기 담으면 같은 문구의 주인이 둘이 된다.
 */
const UI_TEXT_ONLY_GROUPS: readonly string[] = ["exceptionStatus"];

test("🔴 등록부의 묶음과 DEFAULT_UI_TEXT 의 묶음이 정확히 같다 — 예외는 exceptionStatus 하나뿐이다", () => {
  // 이번 어긋남(billingType 이 등록부에만 남아 있던 것)이 생긴 근본 원인이
  // "두 곳의 목록이 갈라져도 아무도 모른다"였다. 어느 쪽을 건드려도 여기서 걸린다.
  const registryKeys = UI_TEXT_GROUPS.map((group) => group.key);
  const uiTextKeys = Object.keys(DEFAULT_UI_TEXT);

  assert.deepEqual(
    registryKeys.filter((key) => !uiTextKeys.includes(key)).sort(),
    [...REGISTRY_ONLY_GROUPS].sort(),
    "등록부에 있는데 화면(DEFAULT_UI_TEXT)이 읽지 않는 묶음이다 — 저장돼도 아무 화면에 안 나타나는 죽은 행이 쌓인다"
  );

  assert.deepEqual(
    uiTextKeys.filter((key) => !registryKeys.includes(key)).sort(),
    [...UI_TEXT_ONLY_GROUPS].sort(),
    "화면은 읽는데 등록부에 없는 묶음이다 — 출처가 다른 exceptionStatus 말고는 있으면 안 된다"
  );

  // 예외를 값으로 못 박는다. 위 두 단언만으로는 exceptionStatus 가 양쪽에서
  // 함께 사라져도 통과한다 — 그때 화면은 예외 상태 이름표를 잃는다.
  assert.ok(
    uiTextKeys.includes("exceptionStatus"),
    "DEFAULT_UI_TEXT 에서 exceptionStatus 가 사라졌다 — 예외 상태 배지가 이름표를 잃는다"
  );

  // 검증기가 보는 문(findUiTextGroup)에서도 확인한다. 등록부에 없다는 것은 곧
  // 그 묶음으로는 저장 요청 자체가 통과하지 못한다는 뜻이어야 한다.
  for (const key of UI_TEXT_ONLY_GROUPS) {
    assert.equal(findUiTextGroup(key), undefined, `${key}: 등록부에서 찾을 수 있으면 안 된다`);
  }
});

// ────────────────────────────────────────────────────────── 검증기

test("🔴 모든 기본 문구가 자기 검증기를 그대로 통과한다", () => {
  for (const group of UI_TEXT_GROUPS) {
    for (const item of group.items) {
      // 정규화가 문자열을 바꿔 놓으면 "기본값으로 되돌렸는데 행이 안 지워지는"
      // 자리가 그 항목에만 생긴다 — 통과만이 아니라 **그대로** 나와야 한다.
      assert.equal(
        normalizeUiTextValue(item.defaultText),
        item.defaultText,
        `${group.key}.${item.key}: 기본 문구가 정규화를 지나며 바뀐다`
      );
    }
  }
});

test("길이 상한의 근거 — 지금 가장 긴 문구는 23자이고 상한 아래에 있다", () => {
  const longest = UI_TEXT_GROUPS.flatMap((group) => group.items)
    .map((item) => ({ text: item.defaultText, length: Array.from(item.defaultText).length }))
    .sort((a, b) => b.length - a.length)[0];

  assert.equal(longest.text, workflowTypeLabels.WARRANTY_TOTAL_CONTROLLER);
  assert.equal(longest.length, 23, "가장 긴 문구의 길이가 바뀌었다 — 상한의 근거를 다시 적을 것");
  assert.ok(
    longest.length < UI_TEXT_MAX_LENGTH,
    "지금 있는 문구조차 상한에 걸린다 — 상한이 너무 좁다"
  );
});

test("등록부 조회는 묶음 안에서만 찾는다", () => {
  assert.ok(findUiTextItem("role", "SUPER_ADMIN"));
  assert.equal(findUiTextItem("role", "IN_REPAIR"), undefined, "다른 묶음의 항목이 통과했다");
  assert.equal(findUiTextItem("nope", "SUPER_ADMIN"), undefined);
});

// ──────────────────────────────────────────────────────────── 병합

test("오버라이드가 없으면 전부 코드의 기본 문구다", () => {
  const resolved = resolveUiText([]);
  for (const group of UI_TEXT_GROUPS) {
    for (const item of group.items) {
      assert.equal(resolved[group.key][item.key], item.defaultText);
    }
  }
});

test("저장된 행이 기본 문구를 덮는다 — 건드리지 않은 문구는 그대로다", () => {
  const resolved = resolveUiText([
    { groupKey: "role", itemKey: "SUPER_ADMIN", value: "시스템 관리자" },
  ]);

  assert.equal(resolved.role.SUPER_ADMIN, "시스템 관리자");
  assert.equal(resolved.role.ADMIN, roleLabels.ADMIN);
  assert.equal(resolved.repairStatus.IN_REPAIR, repairStatusLabels.IN_REPAIR);
});

test("🔴 등록부에 없는 키의 남은 행은 무시한다 — 읽기는 너그럽다", () => {
  // 문구를 등록부에서 빼는 날, DB 에 남은 옛 행 하나 때문에 그 문구를 쓰는 모든
  // 화면이 죽으면 안 된다.
  const resolved = resolveUiText([
    { groupKey: "nope", itemKey: "SUPER_ADMIN", value: "몰라도 되는 값" },
    { groupKey: "role", itemKey: "GONE_CODE", value: "사라진 코드" },
    { groupKey: "role", itemKey: "ADMIN", value: "매니저" },
  ]);

  assert.equal(resolved.role.ADMIN, "매니저", "정상적인 줄까지 함께 버렸다");
  assert.equal(resolved.nope, undefined);
  assert.equal(resolved.role.GONE_CODE, undefined);
});

test("검증을 통과하지 못하는 값도 병합이 조용히 버린다", () => {
  const resolved = resolveUiText([
    { groupKey: "role", itemKey: "ADMIN", value: "   " },
    { groupKey: "role", itemKey: "SALES", value: `줄바꿈${String.fromCharCode(10)}섞임` },
    { groupKey: "role", itemKey: "AS_ENGINEER", value: "가".repeat(UI_TEXT_MAX_LENGTH + 1) },
  ]);

  assert.equal(resolved.role.ADMIN, roleLabels.ADMIN);
  assert.equal(resolved.role.SALES, roleLabels.SALES);
  assert.equal(resolved.role.AS_ENGINEER, roleLabels.AS_ENGINEER);
});

test("병합도 정규화를 지난 값을 얹는다 — 저장 경로가 뚫려도 여기서 한 번 더 막는다", () => {
  const resolved = resolveUiText([
    { groupKey: "role", itemKey: "ADMIN", value: "  매니저   담당  " },
  ]);
  assert.equal(resolved.role.ADMIN, "매니저 담당");
});

test("금지 문자 술어는 검증기와 같은 판정을 한다", () => {
  // 정규식이 두 곳에 있으면 "거절은 되는데 이유가 다른 것으로 나오는" 상태가 된다.
  for (const code of [0, 9, 10, 13, 0x1f, 0x7f, 0x9f, 0x2028, 0x2029]) {
    const value = `역할${String.fromCharCode(code)}이름`;
    assert.ok(hasForbiddenUiTextCharacter(value), `U+${code.toString(16)} 를 못 잡았다`);
    assert.equal(normalizeUiTextValue(value), null, `U+${code.toString(16)} 가 통과했다`);
  }
  assert.ok(!hasForbiddenUiTextCharacter("최고관리자"));
});
