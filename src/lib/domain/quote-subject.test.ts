import assert from "node:assert/strict";
import { test } from "node:test";

import { OVERHAUL_SUFFIX, buildQuoteSubject } from "./quote-subject";

test("모델명 + 신고증상 + 수리 件", () => {
  assert.equal(
    buildQuoteSubject({
      modelName: "RFK300FH-AD1",
      faultDescription: "Bias Fwd Drop",
      kind: "DOMESTIC",
    }),
    "RFK300FH-AD1 Bias Fwd Drop 수리 件"
  );
});

test("OH 견적서면 뒤에 ' + OH' 가 붙는다 — 양식 수식과 글자까지 같다", () => {
  const subject = buildQuoteSubject({
    modelName: "RFK300FH-AD1",
    faultDescription: "Bias Fwd Drop",
    kind: "OVERHAUL",
  });
  assert.equal(subject, "RFK300FH-AD1 Bias Fwd Drop 수리 件 + OH");
  assert.ok(subject.endsWith(OVERHAUL_SUFFIX));
});

test("없는 조각은 통째로 빠진다 — 두 칸 띄어쓰기가 남지 않는다", () => {
  assert.equal(
    buildQuoteSubject({ modelName: "RFK300FH-AD1", faultDescription: null, kind: "DOMESTIC" }),
    "RFK300FH-AD1 수리 件"
  );
  assert.equal(
    buildQuoteSubject({ modelName: "  ", faultDescription: "전원 안 들어옴", kind: "DOMESTIC" }),
    "전원 안 들어옴 수리 件"
  );
  for (const subject of [
    buildQuoteSubject({ modelName: null, faultDescription: null, kind: "DOMESTIC" }),
    buildQuoteSubject({ modelName: "", faultDescription: "   ", kind: "OVERHAUL" }),
  ]) {
    assert.ok(!subject.includes("  "), `두 칸 띄어쓰기: ${JSON.stringify(subject)}`);
  }
});

test("🔴 둘 다 없으면 빈 문자열이다 — '수리 件' 만 지어 주지 않는다", () => {
  // 무엇에 대한 견적인지 말해 주지 않는 품명을 만들어 주면, 사람이 그대로
  // 저장해 버린다.
  assert.equal(buildQuoteSubject({ modelName: null, faultDescription: null, kind: "DOMESTIC" }), "");
  assert.equal(buildQuoteSubject({ modelName: "", faultDescription: "", kind: "OVERHAUL" }), "");
  assert.equal(
    buildQuoteSubject({ modelName: undefined, faultDescription: undefined, kind: "DOMESTIC" }),
    ""
  );
});

test("신고증상의 줄바꿈은 한 줄로 편다 — 품명은 한 칸에 들어간다", () => {
  assert.equal(
    buildQuoteSubject({
      modelName: "TG-200",
      faultDescription: "전원 이상\n  재현 안 됨",
      kind: "DOMESTIC",
    }),
    "TG-200 전원 이상 재현 안 됨 수리 件"
  );
});

test("200자를 넘으면 신고증상만 줄이고 잘린 티를 남긴다", () => {
  const subject = buildQuoteSubject({
    modelName: "RFK300FH-AD1",
    faultDescription: "가".repeat(400),
    kind: "OVERHAUL",
  });
  assert.ok(subject.length <= 200, `길이 ${subject.length}`);
  // 모델명과 꼬리말은 남는다 — 무엇에 대한 견적인지 말해 주는 부분이다.
  assert.ok(subject.startsWith("RFK300FH-AD1 "));
  assert.ok(subject.endsWith("수리 件 + OH"));
  assert.ok(subject.includes("…"), "잘린 자리를 알아볼 수 있어야 한다");
});

test("딱 맞는 길이는 자르지 않는다", () => {
  const fault = "가".repeat(180);
  const subject = buildQuoteSubject({ modelName: "", faultDescription: fault, kind: "DOMESTIC" });
  assert.equal(subject, `${fault} 수리 件`);
  assert.ok(!subject.includes("…"));
});
