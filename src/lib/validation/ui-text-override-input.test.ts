import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkUiTextOverrideChange,
  findDuplicateUiTextChange,
  validateUiTextOverrideChanges,
} from "./ui-text-override-input";
import { UI_TEXT_MAX_LENGTH } from "@/lib/domain/ui-text-overrides";
import { roleLabels } from "@/lib/domain/types";

/**
 * ============================================================================
 * 화면 문구 입력 검증 — 순수 판정만
 * ============================================================================
 * 여기서 지키려는 것 둘:
 *  1. **모르는 것은 조용히 버리지 않고 거절한다.** 이 판정이 무너지면 "저장했는데
 *     화면이 안 바뀐다"가 고장과 구별되지 않게 된다(모듈 머리말).
 *  2. **한 줄 자리라는 전제를 지킨다.** 빈 문구·줄바꿈·탭·보이지 않는 문자·너무
 *     긴 문구는 표와 배지를 무너뜨리거나, 눈에 안 보이는 채로 비교만 어긋나게
 *     만든다.
 *
 * DB 도 세션도 여기 들어오지 않는다 — 인가는 mutation 이 본다.
 * ============================================================================
 */

/** 제어문자를 소스에 그대로 적지 않는다 — 편집기·도구를 지나며 조용히 사라진다. */
function withChar(code: number, text = "역할"): string {
  return `${text}${String.fromCharCode(code)}이름`;
}

// ─────────────────────────────────────────────────────── 정상 입력

test("정상 입력은 정규화된 문구와 함께 통과한다", () => {
  const result = checkUiTextOverrideChange({
    groupKey: "role",
    itemKey: "SUPER_ADMIN",
    value: "시스템 관리자",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.change.group.key, "role");
  assert.equal(result.change.item.key, "SUPER_ADMIN");
  assert.equal(result.change.value, "시스템 관리자");
});

test("앞뒤 공백은 다듬는다", () => {
  const result = checkUiTextOverrideChange({
    groupKey: "priority",
    itemKey: "URGENT",
    value: "   아주 급함   ",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.change.value, "아주 급함");
});

test("🔴 문자열 안의 연속 공백은 하나로 줄인다 — 같은 문구인데 문자열만 다른 상태를 막는다", () => {
  // "승인  대기"(공백 둘)는 눈으로 "승인 대기"와 구별되지 않는데 문자열은 다르다.
  // 그대로 저장하면 기본값과 같은 문구인데 행이 남는다.
  const result = checkUiTextOverrideChange({
    groupKey: "accountApprovalStatus",
    itemKey: "PENDING",
    value: "승인   대기   중",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.change.value, "승인 대기 중");
});

test("상한과 정확히 같은 길이는 통과한다", () => {
  const exact = "가".repeat(UI_TEXT_MAX_LENGTH);
  const result = checkUiTextOverrideChange({ groupKey: "role", itemKey: "ADMIN", value: exact });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.change.value, exact);
});

test("value: null 은 기본 문구로 되돌리라는 뜻이라 통과한다", () => {
  const result = checkUiTextOverrideChange({
    groupKey: "workRecordKind",
    itemKey: "GENERAL",
    value: null,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.change.value, null);
});

test("기본 문구와 같은 값도 검증은 통과한다 — 행을 지우는 판단은 mutation 의 몫이다", () => {
  const result = checkUiTextOverrideChange({
    groupKey: "role",
    itemKey: "ADMIN",
    value: roleLabels.ADMIN,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.change.value, roleLabels.ADMIN);
});

// ─────────────────────────────────────────────────────────── 거절

test("🔴 등록부에 없는 묶음 키는 거절한다 — 조용히 버리지 않는다", () => {
  for (const groupKey of ["nope", "productCategory", "exceptionStatus", "Role", ""]) {
    const result = checkUiTextOverrideChange({ groupKey, itemKey: "ADMIN", value: "관리자님" });
    assert.equal(result.ok, false, `통과했다: ${groupKey}`);
  }
});

test("🔴 묶음 안에 없는 항목 키는 거절한다 — 다른 묶음의 항목이어도 마찬가지다", () => {
  for (const itemKey of ["NOPE", "IN_REPAIR", "super_admin", ""]) {
    const result = checkUiTextOverrideChange({ groupKey: "role", itemKey, value: "관리자님" });
    assert.equal(result.ok, false, `통과했다: ${itemKey}`);
  }
});

test("🔴 빈 문구는 거절한다 — 빈 이름표는 화면에서 그 칸이 사라진 것으로 보인다", () => {
  for (const value of ["", " ", "   ", "　"]) {
    const result = checkUiTextOverrideChange({ groupKey: "role", itemKey: "ADMIN", value });
    assert.equal(result.ok, false, `통과했다: ${JSON.stringify(value)}`);
    if (!result.ok) assert.match(result.message, /빈 문구/);
  }
});

test("🔴 줄바꿈·탭·제어문자는 거절한다 — 다듬어서 통과시키지 않는다", () => {
  // trim() 은 줄바꿈과 탭까지 지워 버린다. 다듬기보다 먼저 검사하지 않으면
  // "역할(줄바꿈)" 같은 값이 조용히 통과하고, 보낸 쪽은 자기 값이 바뀐 줄 모른다.
  for (const code of [10, 13, 9, 0, 0x0b, 0x1f, 0x7f, 0x9f, 0x2028, 0x2029]) {
    const result = checkUiTextOverrideChange({
      groupKey: "role",
      itemKey: "ADMIN",
      value: withChar(code),
    });
    assert.equal(result.ok, false, `U+${code.toString(16)} 가 통과했다`);
    if (!result.ok) assert.match(result.message, /줄바꿈/);
  }

  // 앞뒤에 붙어 있어도(= trim 이 지웠을 자리) 거절이다.
  const trailing = checkUiTextOverrideChange({
    groupKey: "role",
    itemKey: "ADMIN",
    value: `관리자${String.fromCharCode(10)}`,
  });
  assert.equal(trailing.ok, false, "끝에 붙은 줄바꿈이 조용히 다듬어졌다");
});

test("🔴 길이 상한을 넘으면 거절한다", () => {
  const tooLong = "가".repeat(UI_TEXT_MAX_LENGTH + 1);
  const result = checkUiTextOverrideChange({ groupKey: "role", itemKey: "ADMIN", value: tooLong });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, new RegExp(`${UI_TEXT_MAX_LENGTH}자`));
});

test("길이는 코드 유닛이 아니라 문자로 센다", () => {
  // 이모지 하나는 코드 유닛 둘이다. .length 로 재면 같은 길이의 문구가 어떤 글자를
  // 썼느냐에 따라 통과와 거절로 갈린다.
  const emoji = "🙂".repeat(UI_TEXT_MAX_LENGTH);
  assert.equal(emoji.length, UI_TEXT_MAX_LENGTH * 2);
  const result = checkUiTextOverrideChange({ groupKey: "role", itemKey: "ADMIN", value: emoji });
  assert.equal(result.ok, true, "코드 유닛으로 재고 있다");
});

test("문자열이 아닌 값은 거절한다 — undefined 도 마찬가지다", () => {
  for (const value of [undefined, 12, true, {}, [], Symbol("x")]) {
    const result = checkUiTextOverrideChange({ groupKey: "role", itemKey: "ADMIN", value });
    assert.equal(result.ok, false, `통과했다: ${String(value)}`);
  }
});

test("객체가 아닌 입력은 거절한다", () => {
  for (const raw of [null, undefined, "role", 3, [], [{ groupKey: "role" }]]) {
    assert.equal(checkUiTextOverrideChange(raw).ok, false, `통과했다: ${JSON.stringify(raw)}`);
  }
});

// ───────────────────────────────────────────────────────────── 중복

test("🔴 같은 (묶음, 항목)이 두 번 오면 거절한다", () => {
  const duplicate = findDuplicateUiTextChange([
    { groupKey: "role", itemKey: "ADMIN", value: "관리자님" },
    { groupKey: "role", itemKey: "ADMIN", value: "매니저" },
  ]);
  assert.ok(duplicate);
});

test("묶음이 다르면 같은 항목 키라도 중복이 아니다", () => {
  // billingType.WARRANTY 와 role 의 어느 항목도 서로 다른 자리다.
  // 🔴 billingType 은 **등록부에 없는 묶음**이다(유·무상 구분은 접수 알림 메일
  // 본문에도 나가서 2026-09-08 사용자 결정으로 뺐다). 그런데도 여기서 쓰는 것이
  // 이 시험의 뜻이다 — findDuplicateUiTextChange 는 등록부를 보지 않고 (묶음, 항목)
  // 문자열만 견준다. 등록부 판정은 checkUiTextOverrideChange 의 몫이라 이 함수까지
  // 등록부를 알면 같은 판정이 두 벌이 된다.
  const notDuplicate = findDuplicateUiTextChange([
    { groupKey: "role", itemKey: "ADMIN", value: "관리자님" },
    { groupKey: "billingType", itemKey: "WARRANTY", value: "보증" },
  ]);
  assert.equal(notDuplicate, null);
});

// ──────────────────────────────────────────────────── 배열 단위 검증

test("배열 단위 검증은 하나라도 막히면 전부 거절한다", () => {
  const result = validateUiTextOverrideChanges([
    { groupKey: "role", itemKey: "ADMIN", value: "관리자님" },
    { groupKey: "role", itemKey: "NOPE", value: "없는 코드" },
  ]);
  assert.equal(result.ok, false);
});

test("배열이 아니면 거절한다", () => {
  for (const raw of [null, undefined, {}, "role"]) {
    assert.equal(validateUiTextOverrideChanges(raw).ok, false);
  }
});

test("빈 배열은 통과한다 — 바꾼 것이 없다는 뜻이다", () => {
  const result = validateUiTextOverrideChanges([]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, []);
});

test("여러 묶음을 한 번에 보낼 수 있다", () => {
  const result = validateUiTextOverrideChanges([
    { groupKey: "role", itemKey: "ADMIN", value: "관리자님" },
    { groupKey: "repairStatus", itemKey: "IN_REPAIR", value: "수리 진행 중" },
    { groupKey: "priority", itemKey: "URGENT", value: null },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.length, 3);
  assert.equal(result.data[2].value, null);
});
