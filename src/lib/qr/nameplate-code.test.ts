import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  parseNameplateCode,
  planNameplateFill,
  summarizeNameplateFill,
  type NameplateFields,
} from "./nameplate-code";

/**
 * ============================================================================
 * 명판 QR 의 글을 셋으로 가르는 규칙과, 채울 칸을 고르는 규칙
 * ============================================================================
 * 이 두 가지가 이 기능에서 **틀린 값이 칸에 적히는 것을 막는 유일한 장치**다.
 * 훑기는 사진의 여러 자리를 차례로 보기 때문에, 꼴을 보지 않으면 같은 장비에
 * 붙은 **ROM TYPE 딱지 QR(`M5259`)** 이 먼저 풀려 그 값이 들어온다 — 실제
 * 측정에서 일어난 일이다(jsQR 로 훑었을 때).
 *
 * 못 박는 것 —
 *  1. 🔴 쉼표로 **정확히 셋**이 아니면 버린다(둘도 넷도 아니다).
 *  2. 🔴 조각 하나라도 비면(공백뿐이어도) 버린다.
 *  3. 던지지 않는다 — 「못 읽음」은 결과의 한 갈래라 훑기가 다음 자리로 가야 한다.
 *  4. 🔴 **이미 적힌 칸은 칸마다 따로** 판단해 건드리지 않는다.
 * ============================================================================
 */

const EMPTY: NameplateFields = { modelName: "", lotNumber: "", serialNumber: "" };

describe("명판 QR 글 가르기", () => {
  test("실측값 — MATCH BOX", () => {
    assert.deepEqual(parseNameplateCode("MBK600M-AD1,WN6445,1808012"), {
      modelName: "MBK600M-AD1",
      lotNumber: "WN6445",
      serialNumber: "1808012",
    });
  });

  test("실측값 — RF GENERATOR 도 같은 꼴이다", () => {
    assert.deepEqual(parseNameplateCode("RFK300FH-IC1,WN8532,1902119"), {
      modelName: "RFK300FH-IC1",
      lotNumber: "WN8532",
      serialNumber: "1902119",
    });
  });

  test("앞뒤 공백·줄바꿈은 떼고 읽는다", () => {
    assert.deepEqual(parseNameplateCode(" CMK300M-IC2 , WT9844 ,\n2207085\r\n"), {
      modelName: "CMK300M-IC2",
      lotNumber: "WT9844",
      serialNumber: "2207085",
    });
  });

  test("🔴 같은 장비의 ROM TYPE 딱지 QR(M5259)은 버린다", () => {
    assert.equal(parseNameplateCode("M5259"), null);
  });

  test("🔴 쉼표가 둘이 아니면 버린다", () => {
    assert.equal(parseNameplateCode("MBK600M-AD1,WN6445"), null);
    assert.equal(parseNameplateCode("MBK600M-AD1,WN6445,1808012,추가"), null);
  });

  test("🔴 조각 하나라도 비면 버린다 — 공백뿐인 것도 빈 것이다", () => {
    assert.equal(parseNameplateCode(",WN6445,1808012"), null);
    assert.equal(parseNameplateCode("MBK600M-AD1,,1808012"), null);
    assert.equal(parseNameplateCode("MBK600M-AD1,WN6445,"), null);
    assert.equal(parseNameplateCode("MBK600M-AD1,   ,1808012"), null);
  });

  test("글이 아니면(없음·빈 글) 버린다 — 던지지 않는다", () => {
    assert.equal(parseNameplateCode(null), null);
    assert.equal(parseNameplateCode(undefined), null);
    assert.equal(parseNameplateCode(""), null);
    assert.equal(parseNameplateCode(",,"), null);
    assert.equal(parseNameplateCode(123 as unknown as string), null);
  });

  test("구 양식 명판의 글(한 줄에 둘씩)은 꼴이 아예 다르다 — 버린다", () => {
    assert.equal(parseNameplateCode("CMK150M-IC2  S/N 1307009"), null);
  });
});

describe("🔴 채울 칸 고르기 — 이미 적힌 칸은 칸마다 따로 둔다", () => {
  const code = {
    modelName: "MBK600M-AD1",
    lotNumber: "WN6445",
    serialNumber: "1808012",
  };

  test("세 칸이 다 비어 있으면 셋 다 채운다", () => {
    assert.deepEqual(planNameplateFill(code, EMPTY), code);
  });

  test("🔴 한 칸만 적혀 있으면 그 칸만 두고 나머지를 채운다", () => {
    assert.deepEqual(planNameplateFill(code, { ...EMPTY, serialNumber: "9999999" }), {
      modelName: "MBK600M-AD1",
      lotNumber: "WN6445",
    });
    assert.deepEqual(planNameplateFill(code, { ...EMPTY, modelName: "손으로 적은 모델" }), {
      lotNumber: "WN6445",
      serialNumber: "1808012",
    });
  });

  test("🔴 세 칸이 다 적혀 있으면 아무것도 채우지 않는다", () => {
    assert.deepEqual(
      planNameplateFill(code, { modelName: "A", lotNumber: "B", serialNumber: "C" }),
      {}
    );
  });

  test("공백만 들어 있는 칸은 비어 있는 것으로 본다", () => {
    assert.deepEqual(planNameplateFill(code, { ...EMPTY, lotNumber: "   " }), code);
  });

  test("🔴 QR 값이 같아도 적힌 칸은 조각에 넣지 않는다 — 덮어쓰기 자체가 없다", () => {
    const plan = planNameplateFill(code, { ...EMPTY, lotNumber: "WN6445" });
    assert.equal("lotNumber" in plan, false);
  });
});

describe("무엇이 들어왔는지 한 줄", () => {
  test("채운 칸만 칸 차례대로 적는다", () => {
    assert.equal(
      summarizeNameplateFill({ modelName: "MBK600M-AD1", serialNumber: "1808012" }),
      "QR 에서 읽어 채웠습니다 — Model MBK600M-AD1 · S/N 1808012"
    );
  });

  test("채운 것이 없으면 그 사실을 말한다 — 조용히 아무 일도 없으면 고장으로 보인다", () => {
    assert.match(summarizeNameplateFill({}), /이미 모두 채워져/);
  });
});
