import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUnitPriceValue, validatePartUnitPriceEntries } from "./part-unit-price-input";

// ── 아래 O/H 단가 describe 블록이 쓰는 것들. 위의 기존 시험은 건드리지 않는다.
import { describe } from "node:test";
import { randomUUID } from "node:crypto";
import {
  parseOverhaulUnitPriceValue,
  validatePartOverhaulUnitPriceEntries,
} from "./part-overhaul-unit-price-input";

test("빈 칸은 0 이 아니라 '정하지 않음'이다 — 저장 쪽이 그 줄을 지운다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = parseUnitPriceValue(empty);
    assert.ok(result.ok);
    assert.equal(result.value, null, `${JSON.stringify(empty)} 는 null 이어야 한다`);
  }
});

test("0 은 '무상 부품'이라는 뜻으로 저장된다 — 빈 칸과 다르다", () => {
  const result = parseUnitPriceValue("0");
  assert.ok(result.ok);
  assert.equal(result.value, "0");
});

test("금액은 문자열 그대로 간다 — Number 를 거치면 오차가 쌓인다", () => {
  for (const [input, expected] of [
    ["125000", "125000"],
    ["1,250,000", "1250000"],
    ["1250.50", "1250.50"],
    [125000, "125000"],
  ] as const) {
    const result = parseUnitPriceValue(input);
    assert.ok(result.ok, `${input} 가 거절됐다`);
    assert.equal(result.value, expected);
  }
});

test("numeric(15,2) 폭과 형식을 벗어나면 거절한다", () => {
  for (const bad of ["-1", "1.234", "12345678901234", "abc", "1e3", "１２３", "1..2"]) {
    const result = parseUnitPriceValue(bad);
    assert.equal(result.ok, false, `${bad} 가 통과했다`);
  }
});

test("정수부 13자리·소수 2자리까지는 통과한다 — 견적서 칸과 같은 폭", () => {
  const result = parseUnitPriceValue("1234567890123.45");
  assert.ok(result.ok);
  assert.equal(result.value, "1234567890123.45");
});

test("소유자 넷을 한 번에 — 정상", () => {
  const result = validatePartUnitPriceEntries([
    { owner: "DSS", unitPrice: "125000" },
    { owner: "KYOSAN", unitPrice: "" },
    { owner: "SERVICE_SPARE", unitPrice: "0" },
    { owner: "TEST", unitPrice: "1,000.50" },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(result.data, [
    { owner: "DSS", unitPrice: "125000" },
    { owner: "KYOSAN", unitPrice: null },
    { owner: "SERVICE_SPARE", unitPrice: "0" },
    { owner: "TEST", unitPrice: "1000.50" },
  ]);
});

test("하나라도 틀리면 전부 거절한다 — 반쯤 저장되면 화면과 DB 가 달라진다", () => {
  const result = validatePartUnitPriceEntries([
    { owner: "DSS", unitPrice: "125000" },
    { owner: "KYOSAN", unitPrice: "-5" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(!result.fieldErrors.DSS, "정상인 칸에는 오류가 붙지 않는다");
  assert.match(result.fieldErrors.KYOSAN, /단가/);
});

test("같은 소유자가 두 번 오면 거절한다 — 어느 쪽이 뜻인지 알 수 없다", () => {
  const result = validatePartUnitPriceEntries([
    { owner: "DSS", unitPrice: "1" },
    { owner: "DSS", unitPrice: "2" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.fieldErrors.DSS, /두 번/);
});

test("알 수 없는 소유자는 조용히 버리지 않는다 — 버리면 저장된 줄 알게 된다", () => {
  const result = validatePartUnitPriceEntries([{ owner: "NOPE", unitPrice: "1" }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.owner);
});

test("배열이 아니면 거절한다", () => {
  assert.equal(validatePartUnitPriceEntries({ owner: "DSS" }).ok, false);
  assert.equal(validatePartUnitPriceEntries(null).ok, false);
});

/**
 * ============================================================================
 * O/H(오버홀) 단가 검증 — 같은 금액 규칙, 다른 축
 * ============================================================================
 * 여기서 못 박는 것은 둘이다.
 *
 *  1. **금액 규칙이 일반 단가와 한 벌이다.** 쉼표·자릿수·지수 표기 처리가 두
 *     파일에 갈라지면, 한쪽만 고쳐지는 날 견적서 금액이 조용히 어긋난다. 두
 *     함수가 같은 입력에 같은 답을 내는지를 시험으로 묶어 둔다.
 *  2. **줄을 가리키는 것이 부품 id 다.** O/H 단가에는 소유구분 축이 없다. 오류
 *     키도 부품 id 여야 화면이 그 줄 밑에 문장을 붙일 수 있다.
 *
 * 위쪽 기존 시험은 한 줄도 고치지 않았다 — 그것이 "금액 규칙을 함수로 뽑아낸 것이
 * 동작을 바꾸지 않았다"는 증거다.
 * ============================================================================
 */
describe("O/H 단가 검증", () => {
  const partA = randomUUID();
  const partB = randomUUID();

  test("빈 칸은 0 이 아니라 '정하지 않음'이다 — 저장 쪽이 그 줄을 지운다", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const result = parseOverhaulUnitPriceValue(empty);
      assert.ok(result.ok);
      assert.equal(result.value, null, `${JSON.stringify(empty)} 는 null 이어야 한다`);
    }
  });

  test("0 은 '오버홀 때 무상'이라는 뜻으로 저장된다 — 빈 칸과 다르다", () => {
    const result = parseOverhaulUnitPriceValue("0");
    assert.ok(result.ok);
    assert.equal(result.value, "0");
  });

  test("쉼표를 친 금액과 소수 두 자리를 받아들인다 — 사람이 그렇게 친다", () => {
    for (const [input, expected] of [
      ["125000", "125000"],
      ["1,250,000", "1250000"],
      ["1250.50", "1250.50"],
      ["1,000.50", "1000.50"],
      [125000, "125000"],
    ] as const) {
      const result = parseOverhaulUnitPriceValue(input);
      assert.ok(result.ok, `${input} 가 거절됐다`);
      assert.equal(result.value, expected);
    }
  });

  test("음수는 거절한다 — DB CHECK 에 닿기 전에 사람에게 이유를 보인다", () => {
    assert.equal(parseOverhaulUnitPriceValue("-1").ok, false);
  });

  test("소수 세 자리는 거절한다 — numeric(15,2) 가 담지 못한다", () => {
    assert.equal(parseOverhaulUnitPriceValue("1.234").ok, false);
  });

  test("정수부 14자리는 거절한다 — 견적서 칸과 같은 폭이다", () => {
    assert.equal(parseOverhaulUnitPriceValue("12345678901234").ok, false);
    // 13자리 + 소수 2자리까지는 통과한다(경계값).
    const ok = parseOverhaulUnitPriceValue("1234567890123.45");
    assert.ok(ok.ok);
    assert.equal(ok.value, "1234567890123.45");
  });

  test("지수 표기 '1e3' 은 거절한다 — Number() 에 맡기면 1000 으로 조용히 통과한다", () => {
    assert.equal(parseOverhaulUnitPriceValue("1e3").ok, false);
  });

  test("🔴 금액 규칙이 일반 단가와 한 벌이다 — 두 벌이면 한쪽만 고쳐지는 날이 온다", () => {
    for (const input of [
      "",
      "   ",
      null,
      undefined,
      "0",
      "125000",
      "1,250,000",
      "1250.50",
      125000,
      "1234567890123.45",
      "-1",
      "1.234",
      "12345678901234",
      "abc",
      "1e3",
      "１２３",
      "1..2",
    ]) {
      assert.deepEqual(
        parseOverhaulUnitPriceValue(input),
        parseUnitPriceValue(input),
        `${JSON.stringify(input)} 에 대해 두 검증이 다른 답을 냈다`
      );
    }
  });

  test("부품 여럿을 한 번에 — 정상", () => {
    const result = validatePartOverhaulUnitPriceEntries([
      { partId: partA, unitPrice: "1,250,000" },
      { partId: partB, unitPrice: "" },
    ]);
    assert.ok(result.ok);
    assert.deepEqual(result.data, [
      { partId: partA, unitPrice: "1250000" },
      { partId: partB, unitPrice: null },
    ]);
  });

  test("🔴 오류 키는 부품 id 다 — 화면이 그 줄 밑에 문장을 붙인다", () => {
    const result = validatePartOverhaulUnitPriceEntries([
      { partId: partA, unitPrice: "125000" },
      { partId: partB, unitPrice: "-5" },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(!result.fieldErrors[partA], "정상인 줄에는 오류가 붙지 않는다");
    assert.match(result.fieldErrors[partB], /단가/);
  });

  test("하나라도 틀리면 전부 거절한다 — 반쯤 저장되면 화면과 DB 가 달라진다", () => {
    const result = validatePartOverhaulUnitPriceEntries([
      { partId: partA, unitPrice: "125000" },
      { partId: partB, unitPrice: "1.234" },
    ]);
    assert.equal(result.ok, false);
  });

  test("같은 부품이 두 번 오면 거절한다 — 부품마다 한 줄이라 하나는 반드시 사라진다", () => {
    const result = validatePartOverhaulUnitPriceEntries([
      { partId: partA, unitPrice: "1" },
      { partId: partA, unitPrice: "2" },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.fieldErrors[partA], /두 번/);
  });

  test("부품 id 가 uuid 가 아니면 조용히 버리지 않는다 — 버리면 저장된 줄 알게 된다", () => {
    const result = validatePartOverhaulUnitPriceEntries([{ partId: "NOPE", unitPrice: "1" }]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.fieldErrors.partId);
  });

  test("배열이 아니면 거절한다", () => {
    assert.equal(validatePartOverhaulUnitPriceEntries({ partId: partA }).ok, false);
    assert.equal(validatePartOverhaulUnitPriceEntries(null).ok, false);
  });
});
