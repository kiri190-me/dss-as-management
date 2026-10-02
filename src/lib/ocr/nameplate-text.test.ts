import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LOT_CANDIDATE_LIMIT,
  MODEL_FRAGMENT_LENGTH,
  MODEL_MATCH_MAX_RATIO,
  NAMEPLATE_TEXT_ALL_TAKEN_MESSAGE,
  NAMEPLATE_TEXT_EMPTY_MESSAGE,
  collectLotNumbers,
  collectModelTokens,
  collectSerialNumbers,
  decideByVote,
  decideModelByFragment,
  decideModelName,
  editDistance,
  fieldsFromRegisteredProduct,
  foldModelLetters,
  planNameplateTextFill,
  rankRegisteredProducts,
  readNameplateFromTexts,
  repairLotShape,
  suggestLotNumbers,
  summarizeNameplateTextFill,
  type RegisteredProduct,
} from "./nameplate-text";

/**
 * ============================================================================
 * 글자로 읽은 명판에서 세 칸 뽑기 — **틀린 값을 채우지 않는지**를 본다
 * ============================================================================
 * 여기 적힌 날것의 글은 **전부 실측에서 실제로 나온 것**이다(2026-10-02, 구
 * 양식 명판 4장 × 18조합). 지어낸 글로는 이 모듈이 무엇을 막고 있는지 알 수
 * 없다 — 막아야 하는 것이 하나같이 「그럴듯한데 한 글자 틀린 값」이기 때문이다.
 * ============================================================================
 */

/** 시험에 쓰는 등록 모델 목록. 🔴 붙임표만 다른 중복이 실제로 들어 있다. */
const MODELS = [
  "CFK150FH-IC1",
  "CFK150FHIC1",
  "CFK150JFH-IC1",
  "CMK150M-IC2",
  "CMK300M-IC2",
  "CMK600M-IC2",
  "RFK150FH-IC1",
  "RFK150FHIC1",
  "RFK300FH-IC1",
  "TG-100",
  "TG-150",
  "TG-200",
  "T2RCONT-AD1",
];

describe("혼동 글자 접기", () => {
  test("실측에서 뒤바뀐 짝이 전부 같은 글이 된다", () => {
    assert.equal(foldModelLetters("CMK150M-IC2"), foldModelLetters("CWKI50M-1C2"));
    assert.equal(foldModelLetters("RFK150FHIC1"), foldModelLetters("REKT50FHICT"));
    assert.equal(foldModelLetters("WZ6243"), foldModelLetters("W76243"));
  });

  test("🔴 붙임표와 공백은 아예 지운다 — 구 양식과 신 양식이 같아진다", () => {
    assert.equal(foldModelLetters("RFK150FH-IC1"), foldModelLetters("RFK150FHIC1"));
    assert.equal(foldModelLetters(" cfk150fh-ic1 "), foldModelLetters("CFK150FHIC1"));
  });

  test("접은 글은 비교용일 뿐 — 원래 글자를 되돌리지 않는다", () => {
    // 접으면 1·I·L·T 가 모두 1 이 되므로, 접은 글을 칸에 넣으면 안 된다는 뜻이다.
    assert.equal(foldModelLetters("TG-100"), "1C100");
  });
});

describe("편집거리", () => {
  test("빈 글과 같은 글", () => {
    assert.equal(editDistance("", "ABC"), 3);
    assert.equal(editDistance("ABC", ""), 3);
    assert.equal(editDistance("ABC", "ABC"), 0);
  });

  test("바꾸기·끼우기·빼기를 한 번씩", () => {
    assert.equal(editDistance("ABC", "ABD"), 1);
    assert.equal(editDistance("ABC", "ABXC"), 1);
    assert.equal(editDistance("ABXC", "ABC"), 1);
  });
});

describe("모델명 후보 토막 고르기", () => {
  test("붙임표를 품은 채로 자른다 — 가르면 대조가 무너진다", () => {
    assert.ok(collectModelTokens("AUTOMATCHINGBOX CMK150M-1C2 S/N").includes("CMK150M-1C2"));
  });

  test("🔴 숫자만 있는 토막은 모델명 후보가 아니다", () => {
    // 🔴 `S/N` 이 `S` 와 `N` 으로 갈려도 뒤 숫자에 이어 붙이지 않는다.
    assert.deepEqual(collectModelTokens("S/N 1307009"), []);
  });

  test("🔴 글자만 있는 토막도 아니다 — MADEINJAPAN 을 모델명으로 끌고 가지 않는다", () => {
    assert.deepEqual(collectModelTokens("MADEINJAPAN AUTOMATCHINGBOX"), []);
  });

  test("너무 짧은 토막은 보지 않는다", () => {
    assert.deepEqual(collectModelTokens("TG-10"), []);
  });

  test("양 끝의 붙임표는 떼어 낸다", () => {
    assert.deepEqual(collectModelTokens("--CMK150M-1C2--"), ["CMK150M-1C2"]);
  });
});

describe("모델명 대조", () => {
  test("실측 날것의 글이 등록 모델로 바로잡힌다", () => {
    // 2026-10-02 구 양식 1번 사진에서 실제로 나온 토막들.
    const match = decideModelName(["JCMK150M-1C2", "CMK150M-1C2"], MODELS);
    assert.deepEqual(match, {
      state: "MATCHED",
      name: "CMK150M-IC2",
      distance: 0,
      by: "DISTANCE",
    });
  });

  test("🔴 붙임표만 다른 중복은 **비김**으로 남는다 — 하나를 집지 않는다", () => {
    const match = decideModelName(["TCFKT50FHICT", "CFRIB0PHICT"], MODELS);
    assert.equal(match.state, "AMBIGUOUS");
    if (match.state !== "AMBIGUOUS") return;
    assert.deepEqual(match.names, ["CFK150FH-IC1", "CFK150FHIC1"]);
  });

  test("🔴 너무 먼 토막은 버린다 — 아무 모델이나 끌어오지 않는다", () => {
    // 전부 실측에서 나온 쓰레기 토막이다. 가장 가까운 모델까지 0.44 이상이다.
    assert.deepEqual(decideModelName(["WA176204", "TR26ISEW", "TRGE2013"], MODELS), {
      state: "NONE",
    });
  });

  test("🔴 0.44 짜리 오답이 들어오지 않는다 — 이 숫자가 안전선이다", () => {
    // GFRISOFHIGTSRIRF50 은 RFK 사진에서 나왔는데 CFK 가 0.44 로 가장 가깝다.
    assert.ok(MODEL_MATCH_MAX_RATIO < 0.44, "기준을 0.44 이상으로 올리면 틀린 모델이 들어온다");
    assert.deepEqual(decideModelName(["GFRISOFHIGTSRIRF50"], MODELS), { state: "NONE" });
  });

  test("많이 나온 쪽이 이긴다", () => {
    const match = decideModelName(
      ["CMK150M-1C2", "CMK150M-1C2", "CMK150M-1C2", "TCFKT50FHICT"],
      MODELS
    );
    assert.equal(match.state, "MATCHED");
    if (match.state !== "MATCHED") return;
    assert.equal(match.name, "CMK150M-IC2");
  });

  test("등록 목록이 비어 있으면 아무것도 고르지 않는다", () => {
    assert.deepEqual(decideModelName(["CMK150M-1C2"], []), { state: "NONE" });
  });
});

describe("🔴 모델명이 두 칸에 나뉘어 인쇄된 명판", () => {
  const SPLIT_MODELS = [...MODELS, "MBK150M-AD1", "MBK150M-IC1", "MBK200M-IC1", "MBK600M-IC1"];

  test("한 줄 안에서 이웃 토막을 이어 붙인 것도 후보로 본다", () => {
    // 표의 세로 테두리 때문에 `MBK │ 150M-IC1` 이 두 토막으로 읽힌다.
    assert.ok(collectModelTokens("MBK 150M-IC1 S/N 1309015").includes("MBK150M-IC1"));
  });

  test("🔴 **줄을 넘어** 붙이지 않는다 — 아래 줄의 Wt 22 kg 이 딸려 오면 안 된다", () => {
    const tokens = collectModelTokens("MBK 150M-IC1\nWT 22 KG");
    assert.ok(tokens.includes("MBK150M-IC1"));
    assert.ok(
      !tokens.some((t) => t.includes("IC1WT")),
      `줄을 넘어 이어 붙였다 — ${tokens.join(" ")}`
    );
  });

  test("한 칸짜리 후보는 그대로 남는다 — 멀쩡히 되던 장이 깨지면 안 된다", () => {
    assert.ok(collectModelTokens("AUTOMATCHINGBOX CMK150M-1C2").includes("CMK150M-1C2"));
  });

  test("🔴 조각 하나로도 집는다 — `150M-IC1` 로 끝나는 등록 모델은 하나뿐이다", () => {
    const match = decideModelByFragment(["150M-IC1"], SPLIT_MODELS);
    assert.deepEqual(match, {
      state: "MATCHED",
      name: "MBK150M-IC1",
      distance: 0,
      by: "FRAGMENT",
    });
  });

  test("🔴 짧은 꼬리는 버린다 — `IC1` 은 등록 모델 열다섯 개에 걸린다", () => {
    assert.deepEqual(decideModelByFragment(["IC1"], SPLIT_MODELS), { state: "NONE" });
    // 접어서 다섯 자인 `0M-IC1` 도 여럿에 걸리므로 아무 말도 하지 않는다.
    assert.deepEqual(decideModelByFragment(["0M-IC1"], SPLIT_MODELS), { state: "NONE" });
    assert.equal(MODEL_FRAGMENT_LENGTH, 6);
  });

  test("🔴 여럿에 걸리는 조각은 쓰지 않는다 — `M-IC1` 은 네 모델에 걸린다", () => {
    assert.deepEqual(decideModelByFragment(["M-IC1"], SPLIT_MODELS), { state: "NONE" });
  });

  test("🔴 조각 집기는 **온전한 토막이 아무 말도 못 했을 때만** 쓴다", () => {
    // `CMK150M-1C2` 는 편집거리로 깔끔히 집힌다 — 조각 쪽으로 넘어가지 않는다.
    const match = decideModelName(["CMK150M-1C2"], SPLIT_MODELS);
    assert.equal(match.state, "MATCHED");
    if (match.state !== "MATCHED") return;
    assert.equal(match.name, "CMK150M-IC2");
    assert.equal(match.by, "DISTANCE");
  });

  test("조각이 짧게 떨어지면 편집거리만으로도 집힌다 — 조각 길까지 안 간다", () => {
    const match = decideModelName(["150M-IC1"], SPLIT_MODELS);
    assert.equal(match.state, "MATCHED");
    if (match.state !== "MATCHED") return;
    assert.equal(match.name, "MBK150M-IC1");
    assert.equal(match.by, "DISTANCE");
  });

  test("🔴 길게 들러붙어 편집거리가 못 미칠 때 조각이 집는다", () => {
    // 실측에서 모델명은 늘 S/N 과 들러붙어 나온다. 그러면 길이가 길어져
    // 편집거리 비율이 0.34 를 넘고(여기서는 0.44), 거리 쪽은 아무 말도 못 한다.
    const glued = "150M-1C1IJ4N1309015";
    const match = decideModelName([glued], SPLIT_MODELS);
    assert.equal(match.state, "MATCHED");
    if (match.state !== "MATCHED") return;
    assert.equal(match.name, "MBK150M-IC1", "쌍둥이(CMK150M-IC2)를 집었다");
    assert.equal(match.by, "FRAGMENT", "편집거리로 집혔다면 이 시험이 조각 길을 못 본다");
  });

  test("🔴 두 모델에 다 걸리는 조각(`150M1C`)은 아무것도 정하지 않는다", () => {
    // CMK150M-IC2 와 MBK150M-IC1 이 둘 다 품고 있는 조각이다. 이것만으로
    // 하나를 고르면 절반은 틀린다 — 그래서 유일할 때만 쓴다.
    assert.deepEqual(decideModelByFragment(["X150M1CX"], SPLIT_MODELS), { state: "NONE" });
  });

  test("🔴 실측 쓰레기 토막은 조각으로도 아무 모델을 집지 않는다", () => {
    const garbage = ["WA176204", "TRGE2013", "60HZIEEIA", "AUTOMATCHINGBOX", "TITRR440"];
    assert.deepEqual(decideModelByFragment(garbage, SPLIT_MODELS), { state: "NONE" });
  });
});

describe("S/N — 숫자 일곱 자리", () => {
  test("글자가 붙어 있어도 받는다 — 숫자가 어디서 시작하는지 분명하다", () => {
    assert.deepEqual(
      collectSerialNumbers("RFGENERATORC RERTS0FHIGTJA1307006 A50F:").map((h) => h.value),
      ["1307006"]
    );
  });

  test("🔴 숫자가 더 붙으면 아니다 — 여덟 자리를 일곱으로 잘라 쓰지 않는다", () => {
    assert.deepEqual(collectSerialNumbers("TCMK150M-1C2IRY4N11307009").map((h) => h.value), []);
    assert.deepEqual(collectSerialNumbers("S/ NW762413").map((h) => h.value), []);
  });

  test("여섯 자리는 S/N 이 아니다", () => {
    assert.deepEqual(collectSerialNumbers("RF GENERATOR C 2 307005 W1").map((h) => h.value), []);
  });

  test("말머리 바로 뒤에서 나온 것인지 함께 적는다", () => {
    const hits = collectSerialNumbers("AUTOMATCHINGBOX S/N 1307009 WEEZ3KL");
    assert.deepEqual(hits, [{ value: "1307009", nearMarker: true }]);
  });
});

describe("L/N — 영문 둘 + 숫자 넷", () => {
  test("앞뒤가 깨끗하면 받는다", () => {
    assert.deepEqual(
      collectLotNumbers("TCFKT50FHICT Y4T130/006 H453L WZ6216 TITRR440").map((h) => h.value),
      ["WZ6216"]
    );
  });

  test("🔴 글자가 앞에 붙어 있으면 버린다 — 실측에서 **틀린 값**이 나왔다", () => {
    // 정답은 WZ6204 인데 W 를 Y 로 읽었다. 받으면 YZ6204 가 칸에 적힌다.
    assert.deepEqual(collectLotNumbers("UA50SWIYZ6204 INPUT:").map((h) => h.value), []);
    // 정답은 WZ6247 인데 7 을 1 로 읽었다. 받으면 WZ6241 이 칸에 적힌다.
    assert.deepEqual(collectLotNumbers("YTR26A WWZ6241 NPUT.").map((h) => h.value), []);
  });

  test("🔴 글자가 뒤에 붙어 있어도 버린다", () => {
    assert.deepEqual(collectLotNumbers("WZ0241U").map((h) => h.value), []);
  });

  test("숫자가 더 붙으면 아니다", () => {
    assert.deepEqual(collectLotNumbers("WWZ26204").map((h) => h.value), []);
    assert.deepEqual(collectLotNumbers("ITE26TTWAWZ762431").map((h) => h.value), []);
  });

  test("🔴 첫 글자가 W 가 아니면 버린다 — 제조년이 로트번호로 들어온 적이 있다", () => {
    // 실측(다섯째 표본): 날짜 칸 `…NE 2013.7` 이 `NE2013` 으로 잡혀 **틀린
    // 로트번호가 자동으로 채워졌다.** 알려진 L/N 열셋은 전부 W 로 시작한다.
    assert.deepEqual(collectLotNumbers("MSCL14 NE2013 1405").map((h) => h.value), []);
    assert.deepEqual(collectLotNumbers("AB1234").map((h) => h.value), []);
    assert.deepEqual(collectLotNumbers("WZ6293").map((h) => h.value), ["WZ6293"]);
  });
});

describe("L/N 후보 — 🔴 사람이 고르게 내놓는다", () => {
  test("자리에 맞게 고친다 — 앞 둘은 글자, 뒤 넷은 숫자", () => {
    // 실측: 정답 WZ6243 을 `W76243` 으로 읽었다(Z → 7).
    assert.equal(repairLotShape("W76243"), "WZ6243");
    // 실측: 정답 WZ6216 을 `WKI150` 처럼 섞어 읽기도 한다(I → 1).
    assert.equal(repairLotShape("WKI150"), "WK1150");
    // 이미 꼴에 맞으면 그대로.
    assert.equal(repairLotShape("WZ6204"), "WZ6204");
  });

  test("🔴 첫 글자는 W 로 좁힌다 — 알려진 L/N 열둘이 전부 W 로 시작한다", () => {
    // 실측: 정답 WZ6204 를 `…SWIYZ6204` 로 읽어 창이 `YZ6204` 로 잡혔다.
    assert.equal(repairLotShape("YZ6204"), "WZ6204");
    assert.equal(repairLotShape("VZ6204"), "WZ6204");
    // W 로 볼 수 없는 글자로 시작하면 버린다 — 열어 두면 후보가 수십 개가 된다.
    assert.equal(repairLotShape("AZ6204"), null);
    assert.equal(repairLotShape("1Z6204"), null);
  });

  test("되돌릴 짝이 없는 글자는 버린다", () => {
    // 세 번째 자리에 Y 가 왔는데 Y 를 숫자로 되돌리는 짝이 없다.
    assert.equal(repairLotShape("WAYZ62"), null);
    // 두 번째 자리에 3 이 왔는데 3 을 글자로 되돌리는 짝이 없다.
    assert.equal(repairLotShape("W36204"), null);
  });

  test("여섯 글자가 아니면 보지 않는다", () => {
    assert.equal(repairLotShape("WZ620"), null);
    assert.equal(repairLotShape("WZ62045"), null);
  });

  test("🔴 표 많은 순으로 모은다 — 같으면 가나다순(차례가 늘 같아야 한다)", () => {
    const texts = ["WZ6204 WZ6204", "WA1762", "WZ6204 WA1762", "WB1111"];
    assert.deepEqual(suggestLotNumbers(texts), ["WZ6204", "WA1762", "WB1111"]);
  });

  test("다섯 개까지만 내놓는다 — 사람이 눈으로 맞출 수 있는 수다", () => {
    const texts = ["WA1111 WB2222 WC3333 WD4444 WE5555 WF6666 WG7777"];
    assert.equal(suggestLotNumbers(texts).length, LOT_CANDIDATE_LIMIT);
    assert.equal(LOT_CANDIDATE_LIMIT, 5);
  });

  test("붙임표로 끊긴 자리를 건너뛰지 않는다", () => {
    // `CMK150M-1C2` 와 `WZ6204` 가 한 줄에 있어도 창이 둘을 이어 붙이지 않는다.
    assert.deepEqual(suggestLotNumbers(["CMK150M-1C2 WZ6204"]), ["WZ6204"]);
  });

  test("🔴 **자동으로 채운 사진에는 후보를 내놓지 않는다**", () => {
    const reading = readNameplateFromTexts(["H453L WZ6216 TITRR440"], MODELS);
    assert.equal(reading.lotNumber, "WZ6216");
    assert.deepEqual(reading.lotCandidates, [], "이미 채웠는데 후보를 또 늘어놓는다");
  });

  test("🔴 자동으로 못 채웠을 때만 후보가 나온다 — 그래도 칸은 비어 있다", () => {
    // 실측 그대로: 토막 전체가 영문2+숫자4 가 아니라 자동 채우기는 거절한다.
    const reading = readNameplateFromTexts(["UA50SWIYZ6204 INPUT:"], MODELS);
    assert.equal(reading.lotNumber, null, "🔴 후보를 칸에 채웠다 — 자동 채우기 기준이 풀렸다");
    assert.deepEqual(reading.lotCandidates, ["WZ6204"]);
  });
});

describe("투표", () => {
  test("많이 나온 값이 이긴다", () => {
    assert.equal(
      decideByVote([
        { value: "1307006", nearMarker: false },
        { value: "1307005", nearMarker: false },
        { value: "1307006", nearMarker: false },
      ]),
      "1307006"
    );
  });

  test("말머리 뒤에서 나온 쪽을 먼저 본다", () => {
    assert.equal(
      decideByVote([
        { value: "4202450", nearMarker: false },
        { value: "4202450", nearMarker: false },
        { value: "1307006", nearMarker: true },
      ]),
      "1307006"
    );
  });

  test("🔴 둘 다 비기면 고르지 않는다 — 찍으면 절반은 틀린 값이다", () => {
    assert.equal(
      decideByVote([
        { value: "1307006", nearMarker: false },
        { value: "1307005", nearMarker: false },
      ]),
      null
    );
  });

  test("하나도 없으면 null", () => {
    assert.equal(decideByVote([]), null);
  });
});

describe("한 사진의 결론", () => {
  /** 🔴 2026-10-02 구 양식 4번 사진(CFK150FHIC1 / WZ6216 / 1307006)의 날것 일부. */
  const REAL_TEXTS = [
    "RFGENERATORCE TCFKT50FHICT Y4T130/006 H453L WZ6216 TITRR440/480NK ELY46 50/60HZIEEIA",
    "RF GENERATOR C S/N TT 126216 INPUT: SBKEEEY3 E06 50/60HZIETINA 5 WSH DAT K0S C1E MF.C..L.",
    "REGENERATORC CFRIG0FAICTJEIA30/906 T53CIRRLYW26216 TETEE440/480PE3L ER31E SME 151Y",
    "RFGENERATORC CFRIB0PHICT YZT1307006 IEAK:L/NEEBEE TIIT440/430LI E106 0/60H7IEFIA",
  ];

  test("🔴 실물 날것에서 세 칸이 나온다 — 모델명은 비김으로", () => {
    const reading = readNameplateFromTexts(REAL_TEXTS, MODELS);
    assert.equal(reading.serialNumber, "1307006");
    assert.equal(reading.lotNumber, "WZ6216");
    // 붙임표 쌍둥이라 하나로 좁혀지지 않는다 — 그래서 modelName 은 비어 있다.
    assert.equal(reading.model.state, "AMBIGUOUS");
    assert.equal(reading.modelName, null);
  });

  test("아무 글도 없으면 세 칸 모두 비어 있다", () => {
    const reading = readNameplateFromTexts(["", "   "], MODELS);
    assert.deepEqual(
      { m: reading.modelName, l: reading.lotNumber, s: reading.serialNumber },
      { m: null, l: null, s: null }
    );
  });
});

describe("🔴 S/N 으로 찾은 등록 장비 — 보여 주기만 한다", () => {
  /** 🔴 우리 시험 표본 안에 실제로 있는 경우 — 같은 S/N, 다른 모델, 다른 L/N. */
  const SAME_SERIAL: RegisteredProduct[] = [
    { id: "p1", modelName: "RFK150FHIC1", serialNumber: "1307006", lotNumber: "WZ6204" },
    { id: "p2", modelName: "CFK150FHIC1", serialNumber: "1307006", lotNumber: "WZ6216" },
  ];
  const ONE: RegisteredProduct[] = [
    { id: "p9", modelName: "CMK150M-IC2", serialNumber: "1307009", lotNumber: "WZ6243" },
  ];
  const nothingRead = { modelName: null, lotNumber: null, serialNumber: "1307006" };

  test("🔴 **한 대뿐이어도 칸을 자동으로 채우지 않는다** — 고르는 것은 사람이다", () => {
    // 이 모듈에는 「찾았으니 채운다」로 가는 길이 아예 없다. 줄 세우기만 한다.
    const choices = rankRegisteredProducts(ONE, {
      modelName: null,
      lotNumber: null,
      serialNumber: "1307009",
    });
    assert.equal(choices.length, 1);
    assert.equal(choices[0].product.modelName, "CMK150M-IC2");
    // 🔴 채우려면 `fieldsFromRegisteredProduct` 를 **사람이 고른 뒤에** 불러야 한다.
    assert.equal(typeof fieldsFromRegisteredProduct, "function");
  });

  test("🔴 S/N 1307006 은 두 장비가 나오고 **어느 쪽도 고르지 않는다**", () => {
    const choices = rankRegisteredProducts(SAME_SERIAL, nothingRead);
    assert.equal(choices.length, 2);
    assert.deepEqual(
      choices.map((c) => c.matchesReadModel),
      [false, false],
      "사진에서 모델을 못 읽었는데 한쪽을 일치로 표시했다"
    );
  });

  test("사진에서 읽은 모델과 **정확히 하나만** 맞으면 그 줄을 맨 위에 둔다", () => {
    const choices = rankRegisteredProducts(SAME_SERIAL, {
      modelName: "CFK150FHIC1",
      lotNumber: null,
      serialNumber: "1307006",
    });
    assert.equal(choices[0].product.modelName, "CFK150FHIC1");
    assert.equal(choices[0].matchesReadModel, true);
    assert.equal(choices[1].matchesReadModel, false);
  });

  test("🔴 둘 이상 맞으면 「일치」라고 적지 않는다 — 맨 위 줄을 믿게만 만든다", () => {
    const twins: RegisteredProduct[] = [
      { id: "a", modelName: "MBK200-JS2", serialNumber: "2210149", lotNumber: "WV0097" },
      { id: "b", modelName: "MBK200-JS2", serialNumber: "2210149", lotNumber: "WN4040" },
    ];
    const choices = rankRegisteredProducts(twins, {
      modelName: "MBK200-JS2",
      lotNumber: null,
      serialNumber: "2210149",
    });
    assert.deepEqual(
      choices.map((c) => c.matchesReadModel),
      [false, false]
    );
  });

  test("🔴 고르면 Model 과 L/N 이 **짝으로** 들어간다", () => {
    const fields = fieldsFromRegisteredProduct(SAME_SERIAL[0]);
    assert.deepEqual(fields, {
      modelName: "RFK150FHIC1",
      lotNumber: "WZ6204",
      serialNumber: null,
    });
    // 🔴 짝이 깨지면 모델은 이 장비 것, L/N 은 저 장비 것이 된다.
    assert.notEqual(fields.lotNumber, SAME_SERIAL[1].lotNumber);
  });

  test("L/N 이 비어 있는 장비를 골라도 모델은 들어간다", () => {
    const fields = fieldsFromRegisteredProduct({
      id: "x",
      modelName: "TG-100",
      serialNumber: "1",
      lotNumber: "   ",
    });
    assert.deepEqual(fields, { modelName: "TG-100", lotNumber: null, serialNumber: null });
  });

  test("찾은 것이 없으면 줄도 없다 — 글자 인식 결과가 그대로 남는다", () => {
    assert.deepEqual(rankRegisteredProducts([], nothingRead), []);
  });

  test("같은 입력이면 늘 같은 차례다", () => {
    const once = rankRegisteredProducts(SAME_SERIAL, nothingRead).map((c) => c.product.id);
    const twice = rankRegisteredProducts([...SAME_SERIAL].reverse(), nothingRead).map(
      (c) => c.product.id
    );
    assert.deepEqual(once, twice);
  });
});

describe("어느 칸을 채울 것인가", () => {
  const reading = { modelName: "CMK150M-IC2", lotNumber: "WZ6243", serialNumber: "1307009" };
  const EMPTY = { modelName: "", lotNumber: "", serialNumber: "" };

  test("빈칸만 채운다", () => {
    assert.deepEqual(planNameplateTextFill(reading, EMPTY), {
      patch: reading,
      overwritten: [],
      keptFromQr: [],
    });
  });

  test("🔴 첫 판은 이미 적힌 칸을 **칸마다 따로** 비켜 간다", () => {
    assert.deepEqual(
      planNameplateTextFill(reading, {
        modelName: "손으로 적은 것",
        lotNumber: "   ",
        serialNumber: "9999999",
      }),
      { patch: { lotNumber: "WZ6243" }, overwritten: [], keptFromQr: [] }
    );
  });

  test("못 뽑은 칸은 건드리지 않는다", () => {
    assert.deepEqual(
      planNameplateTextFill({ modelName: null, lotNumber: null, serialNumber: "1307009" }, EMPTY),
      { patch: { serialNumber: "1307009" }, overwritten: [], keptFromQr: [] }
    );
  });

  test("🔴 다시 읽으면(overwrite) 이미 적힌 칸을 덮는다 — 사용자 요청", () => {
    const plan = planNameplateTextFill(
      reading,
      { modelName: "손으로 적은 것", lotNumber: "", serialNumber: "9999999" },
      { overwrite: true }
    );
    assert.deepEqual(plan.patch, reading);
    assert.deepEqual(plan.overwritten, ["modelName", "serialNumber"]);
  });

  test("🔴 QR 로 들어온 칸은 **다시 읽어도 안 덮는다**", () => {
    const plan = planNameplateTextFill(
      reading,
      { modelName: "MBK600M-AD1", lotNumber: "WN6445", serialNumber: "" },
      { overwrite: true, lockedByQr: ["modelName", "lotNumber"] }
    );
    assert.deepEqual(plan.patch, { serialNumber: "1307009" });
    assert.deepEqual(plan.keptFromQr, ["modelName", "lotNumber"]);
    assert.deepEqual(plan.overwritten, []);
  });

  test("같은 값이면 덮었다고 떠들지 않는다", () => {
    const plan = planNameplateTextFill(
      reading,
      { modelName: "CMK150M-IC2", lotNumber: "WZ6243", serialNumber: "1307009" },
      { overwrite: true }
    );
    assert.deepEqual(plan, { patch: {}, overwritten: [], keptFromQr: [] });
  });
});

describe("한 줄 알림", () => {
  const plan = (
    patch: Record<string, string>,
    overwritten: ("modelName" | "lotNumber" | "serialNumber")[] = [],
    keptFromQr: ("modelName" | "lotNumber" | "serialNumber")[] = []
  ) => ({ patch, overwritten, keptFromQr });

  test("🔴 반드시 「확인 필요」라고 말한다", () => {
    const line = summarizeNameplateTextFill(plan({ serialNumber: "1307009" }));
    assert.match(line, /확인 필요/);
    assert.match(line, /S\/N 1307009/);
  });

  test("🔴 덮어썼으면 **덮어썼다고 말한다** — 값이 조용히 바뀌면 안 된다", () => {
    const line = summarizeNameplateTextFill(
      plan({ modelName: "CMK150M-IC2" }, ["modelName"])
    );
    assert.match(line, /다시 읽어/);
    assert.match(line, /덮어썼습니다/);
    assert.match(line, /Model/);
  });

  test("QR 값을 비켜 간 것도 알린다 — 「왜 이 칸만 안 바뀌지」를 막는다", () => {
    const line = summarizeNameplateTextFill(plan({}, [], ["lotNumber"]));
    assert.match(line, /L\/N 은 QR 로 읽은 값이라 그대로 두었습니다/);
  });

  test("하나도 못 뽑았으면 직접 입력하라고 한다", () => {
    assert.equal(summarizeNameplateTextFill(plan({})), NAMEPLATE_TEXT_EMPTY_MESSAGE);
    assert.equal(
      summarizeNameplateTextFill(plan({}), {
        modelName: null,
        lotNumber: null,
        serialNumber: null,
      }),
      NAMEPLATE_TEXT_EMPTY_MESSAGE
    );
    assert.match(NAMEPLATE_TEXT_EMPTY_MESSAGE, /직접 입력/);
  });

  test("🔴 읽었는데 칸이 이미 차 있던 것은 **다른 말**로 알린다", () => {
    const line = summarizeNameplateTextFill(plan({}), {
      modelName: null,
      lotNumber: null,
      serialNumber: "1307009",
    });
    assert.equal(line, NAMEPLATE_TEXT_ALL_TAKEN_MESSAGE);
    assert.notEqual(line, NAMEPLATE_TEXT_EMPTY_MESSAGE);
  });
});
