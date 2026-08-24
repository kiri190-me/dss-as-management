import { test } from "node:test";
import assert from "node:assert/strict";

import { EDIT_DRAFT_LABELS, buildDraftText } from "./edit-draft-text";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — "적어 둔 글은 잃지 않는다, 대신 읽을 수 없는 것은
 * 보여 주지 않는다"
 * ============================================================================
 * 저장 충돌이 나면 폼이 언마운트되면서 손으로 친 글이 통째로 사라진다. 그것을
 * 마지막으로 보여 주는 상자가 이 계산 위에 서 있다.
 *
 * 두 방향으로 고장 날 수 있다.
 *  - 너무 넓으면: UUID(customerId 등)나 날짜가 상자에 섞여 나온다. 사람이 읽을
 *    수 없는 글자가 실제 내용을 밀어낸다.
 *  - 너무 좁으면: 정작 잃은 글이 안 보인다. 그러면 상자가 있으나 마나다.
 *
 * 그리고 "보여 줄 것이 없으면 빈 문자열"은 화면이 상자를 아예 그리지 않는
 * 근거다 — 여기가 깨지면 빈 상자가 뜬다.
 * ============================================================================
 */

// ─────────────────────────────────────────── 무엇을 보여 주는가

test("이름표가 있는 항목만 보여 준다 — id·날짜·고르는 값은 새어 나가지 않는다", () => {
  const text = buildDraftText({
    // 아래 넷은 이름표가 없다 — 새 항목이 섹션에 추가되어도 마찬가지다.
    customerId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    endUserId: "8a1b2c3d-4e5f-6789-abcd-ef0123456789",
    receivedAt: "2026-08-24",
    priority: "HIGH",
    // 이것만 자유 입력이다.
    reportedSymptom: "전원이 들어오지 않음",
  });

  assert.equal(text, "신고 증상\n전원이 들어오지 않음");
  assert.ok(!text.includes("3f2504e0"), "UUID가 섞여 나오면 안 된다");
  assert.ok(!text.includes("2026-08-24"), "날짜가 섞여 나오면 안 된다");
  assert.ok(!text.includes("HIGH"), "고르는 값이 섞여 나오면 안 된다");
});

test("이름표는 있지만 값이 없는 항목은 빠진다 — null·빈 문자열·공백뿐", () => {
  const text = buildDraftText({
    reportedSymptom: null,
    notes: "",
    accessoryList: "   \n\t  ",
    reasonForRemoval: "커넥터 파손",
  });

  assert.equal(text, "탈거 사유\n커넥터 파손");
});

test("★ 보여 줄 것이 하나도 없으면 빈 문자열이다 — 화면이 빈 상자를 그리지 않는 근거", () => {
  assert.equal(buildDraftText({}), "");
  assert.equal(buildDraftText({ reportedSymptom: "", notes: null }), "");
  // 고르는 값과 날짜만 바꾼 저장이었다면 잃을 글이 없다.
  assert.equal(buildDraftText({ priority: "URGENT", receivedAt: "2026-08-24" }), "");
});

// ─────────────────────────────────────────── 어떻게 보여 주는가

test("여러 줄로 적은 글은 줄바꿈이 그대로 남는다", () => {
  const symptom = "1. 전원 인가 시 팬만 돈다\n2. 출력 없음\n\n3. 재현율 100%";
  const text = buildDraftText({ reportedSymptom: symptom });

  assert.equal(text, `신고 증상\n${symptom}`);
  assert.ok(text.includes("\n\n3. 재현율 100%"), "빈 줄까지 그대로 남는다");
});

test("항목이 여럿이면 이름표 순서로 나오고, 담겨 온 순서에 흔들리지 않는다", () => {
  // 폼마다 fields를 담는 순서가 다르다 — 그래도 화면 순서는 항상 같아야 한다.
  const forward = buildDraftText({
    contactName: "홍길동",
    lotNumber: "L2408",
    reportedSymptom: "출력 없음",
  });
  const reversed = buildDraftText({
    reportedSymptom: "출력 없음",
    lotNumber: "L2408",
    contactName: "홍길동",
  });

  assert.equal(forward, reversed);
  assert.equal(forward, "담당자 성함\n홍길동\n\nL/N\nL2408\n\n신고 증상\n출력 없음");
});

test("값의 앞뒤 공백은 다듬되 내용은 건드리지 않는다", () => {
  assert.equal(buildDraftText({ notes: "  확인 필요  " }), "비고\n확인 필요");
});

// ─────────────────────────────────────────── 이상한 입력

test("문자열이 아닌 값이 들어와도 터지지 않고 그 항목만 빠진다", () => {
  const text = buildDraftText({
    reportedSymptom: 123,
    notes: true,
    lotNumber: { unexpected: "object" },
    serialNumber: ["array"],
    accessoryList: "케이블 2개",
  });

  assert.equal(text, "동봉 액세서리\n케이블 2개");
});

test("이름표 맵이 비어 있어도 터지지 않는다 — 빈 문자열이다", () => {
  assert.equal(buildDraftText({ reportedSymptom: "출력 없음" }, {}), "");
});

test("이름표를 직접 주면 그것만 쓴다 — 기본 맵에 기대지 않는다", () => {
  assert.equal(
    buildDraftText({ reportedSymptom: "출력 없음", notes: "확인 필요" }, { notes: "메모" }),
    "메모\n확인 필요"
  );
});

// ─────────────────────────────────────────── 이름표 맵 자체

test("이름표 맵에 사람이 읽을 수 없는 항목이 들어 있지 않다", () => {
  // 이름표를 새로 적을 때 실수로 id/날짜/고르는 값을 넣는 것을 막는다.
  const forbidden = [
    "customerId",
    "endUserId",
    "productModelId",
    "assignedEngineerId",
    "receivedAt",
    "billingType",
    "priority",
    "workflowKind",
    "customerRequestedDueDate",
    "internalTargetShipmentDate",
    "internalTargetInspectionCompletionDate",
  ];
  for (const key of forbidden) {
    assert.ok(!(key in EDIT_DRAFT_LABELS), `${key}는 사람이 읽을 수 있는 자유 입력이 아니다`);
  }
});
