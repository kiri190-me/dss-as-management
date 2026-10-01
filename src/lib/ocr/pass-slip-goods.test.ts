import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { before, describe, test } from "node:test";

import {
  checkSerialAgainstDocument,
  decidePrvNumber,
  decideQCode,
  parseGoodsPass,
  serialsMatch,
  toKnownQCodeSet,
  type GoodsPassReading,
} from "./pass-slip-goods";
import {
  PASS_SLIP_GOODS_PAGE_SEG_MODE,
  PASS_SLIP_GOODS_PASSES,
  PASS_SLIP_GOODS_REGION,
  encodeGrayPNG,
  prepare,
  type RgbaImage,
} from "./pass-slip-preprocess";

/**
 * ============================================================================
 * 통문증 물품정보 — **PRV No. 와 Q코드를 제대로 가려내는가**
 * ============================================================================
 * 두 겹이다. 이웃 pass-slip-preprocess.test.ts 와 같은 방식이다.
 *
 *  1. **어디서나 도는 시험** — 글자를 직접 지어 넣어 판정 규칙을 못 박는다.
 *     🔴 그중에서도 **「서류에 없음(ABSENT)」과 「못 읽음(UNREAD)」이 뒤바뀌지
 *     않는가**가 이 파일의 핵심이다(아래 전용 묶음).
 *  2. **측정 자료가 있을 때만 도는 시험** — 실제 통문증 14장을 사진부터 읽어
 *     Q코드 14/14 · PRV 14/14(읽음 11 + 없음 3) · S/N 짝맞추기 2건을 확인한다.
 *
 * 🔴 **사진은 저장소에 넣지 않는다**(고객 자료다). 측정 폴더가 없으면 2번을
 * 건너뛰되, **건너뛴다는 사실이 보이게** 넘어간다.
 * ============================================================================
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * 1. 어디서나 도는 시험 — 글자를 지어 넣는다
 * ────────────────────────────────────────────────────────────────────────── */

/** 파주 양식 한 줄을 읽었을 때 나오는 모양. */
function parjuLine(options: {
  prv?: string | null;
  code?: string | null;
  serial?: string;
  partName?: string;
}): string {
  const { prv = "R2601-2795429", code = "QDAC27037", serial = "1706124" } = options;
  const partName = options.partName ?? "P51902055";
  return [
    `1 ${prv ?? ""} 30069`,
    `${code ?? ""} ${partName}`,
    `S/N : ${serial}`,
  ].join("\n");
}

/** 표를 읽기는 했다는 머리글. 증거 판정이 이것을 본다. */
const TABLE_HEAD = "항번 Part No./모델명 품명 및 규격 수량\n1 EA\n";

function pass(text: string): GoodsPassReading {
  return parseGoodsPass(text);
}

describe("🔴 설정값 — 바꾸면 14/14 가 깨진다", () => {
  test("물품정보 표의 자리", () => {
    assert.deepEqual(PASS_SLIP_GOODS_REGION, { l: 0.035, t: 0.385, w: 0.65, h: 0.15 });
  });

  test("🔴 쪽 나눔 방식은 4 다 — 6 으로 읽으면 Q코드가 7/14 로 떨어졌다", () => {
    assert.equal(PASS_SLIP_GOODS_PAGE_SEG_MODE, "4");
    for (const goodsPass of PASS_SLIP_GOODS_PASSES) {
      assert.equal(goodsPass.pageSegMode, "4", `${goodsPass.name} 의 psm 이 4 가 아니다`);
    }
  });

  test("🔴 설정이 서로 다른 세 패스다 — 같은 설정을 세 번 돌리면 투표가 뜻을 잃는다", () => {
    assert.equal(PASS_SLIP_GOODS_PASSES.length, 3);
    assert.deepEqual(
      PASS_SLIP_GOODS_PASSES.map((goodsPass) => goodsPass.options.width),
      [1800, 3000, 2400]
    );
    assert.deepEqual(
      PASS_SLIP_GOODS_PASSES.map((goodsPass) => goodsPass.options.sharpen),
      [{ sigma: 1.2 }, null, { sigma: 1.2 }]
    );
    for (const goodsPass of PASS_SLIP_GOODS_PASSES) {
      // 🔴 통문번호 띠({min, max})와 다르다. 측정에 쓴 그대로다.
      assert.deepEqual(goodsPass.options.normalise, { lower: 1, upper: "max" });
      assert.equal(goodsPass.options.region, PASS_SLIP_GOODS_REGION);
    }
  });
});

describe("글자에서 뽑기", () => {
  test("PRV · Q코드 · S/N 을 뽑는다", () => {
    const reading = pass(parjuLine({}));
    assert.deepEqual(reading.prv, ["R2601-2795429"]);
    assert.deepEqual(reading.q, ["QDAC27037"]);
    assert.deepEqual(reading.sn, ["1706124"]);
  });

  test("🔴 구미 Part No. 는 Q코드가 아니다 — 「영문4+숫자5」로 넓히면 구미 건마다 엉뚱한 값이 찬다", () => {
    for (const partNo of ["RDAC01543", "RDAD05022"]) {
      const reading = pass(`1 ${partNo} RFK200FH-JS1\nS/N : 1605006`);
      assert.deepEqual(reading.q, [], `${partNo} 가 Q코드로 잡혔다`);
    }
  });

  test("🔴 항번을 **새 PRV 가 나올 때마다** 끊는다 — 그 사이의 S/N 이 그 항번의 것이다", () => {
    const reading = pass(
      `${parjuLine({ prv: "R2603-2876362", serial: "1802127" })}\n` +
        parjuLine({ prv: "R2604-2901549", serial: "1507048" })
    );
    assert.equal(reading.items.length, 2);
    assert.deepEqual(reading.items[0], { prvs: ["R2603-2876362"], sns: ["1802127"] });
    assert.deepEqual(reading.items[1], { prvs: ["R2604-2901549"], sns: ["1507048"] });
  });

  test("같은 PRV 가 한 줄에 두 번 보여도 항번은 하나다", () => {
    const reading = pass("1 R2601-2795429 30069\nR2601-2795429 QDAC27037\nS/N : 1706124");
    assert.equal(reading.items.length, 1);
  });

  test("S/N 은 앞뒤 글자 하나쯤 달라붙어도 같은 것으로 본다", () => {
    assert.equal(serialsMatch("1706124", "1706124"), true);
    assert.equal(serialsMatch("E1706124", "1706124"), true);
    assert.equal(serialsMatch("1706124", "1706125"), false);
    assert.equal(serialsMatch("", "1706124"), false);
  });
});

describe("Q코드 판정", () => {
  test("두 패스가 같으면 읽은 것이다", () => {
    const decision = decideQCode([pass(parjuLine({})), pass(parjuLine({})), pass("")]);
    assert.equal(decision.state, "READ");
    assert.equal(decision.value, "QDAC27037");
  });

  test("한 패스만 읽었으면 채우지 않는다 — 혼자서는 투표가 아니다", () => {
    const decision = decideQCode([pass(parjuLine({})), pass(""), pass("")]);
    assert.equal(decision.state, "UNREAD");
    assert.equal(decision.value, null);
  });

  test("갈리면 채우지 않는다", () => {
    const decision = decideQCode([
      pass(parjuLine({ code: "QDAC27037" })),
      pass(parjuLine({ code: "QDAG27037" })),
      pass(parjuLine({ code: "QDAH27037" })),
    ]);
    assert.equal(decision.state, "UNREAD");
  });

  describe("🔴 아는 Q코드 목록 — 거절이 아니라 표시만", () => {
    const passes = [pass(parjuLine({})), pass(parjuLine({})), pass(parjuLine({}))];

    test("목록에 있으면 아는 값이다", () => {
      const decision = decideQCode(passes, toKnownQCodeSet(["QDAC27037", "QDAD47455"]));
      assert.equal(decision.state, "READ");
      assert.equal(decision.inKnownList, true);
    });

    test("🔴 목록에 없어도 **채운다** — 「처음 보는 값」으로 표시만 다르다", () => {
      const decision = decideQCode(passes, toKnownQCodeSet(["QDAD47455"]));
      assert.equal(decision.state, "READ");
      assert.equal(decision.value, "QDAC27037");
      assert.equal(decision.inKnownList, false);
    });

    test("🔴 목록이 **비어 있어도** 기능이 선다 — 개발 DB 는 건이 3개다", () => {
      for (const known of [toKnownQCodeSet([]), null, undefined]) {
        const decision = decideQCode(passes, known);
        assert.equal(decision.state, "READ");
        assert.equal(decision.value, "QDAC27037");
        assert.equal(decision.inKnownList, false);
      }
    });

    test("꼴에 안 맞는 값은 목록에 넣지 않는다", () => {
      assert.deepEqual([...toKnownQCodeSet(["QDAC27037", "QDA", "", "RDAC01543", "qdad47455"])], [
        "QDAC27037",
        "QDAD47455",
      ]);
    });
  });

  test("🔴 Q코드는 「서류에 없음」을 말하지 않는다 — 14장 전부에 인쇄돼 있었다", () => {
    const decision = decideQCode([pass(TABLE_HEAD), pass(TABLE_HEAD), pass(TABLE_HEAD)]);
    assert.equal(decision.state, "UNREAD");
    assert.notEqual(decision.state, "ABSENT");
  });
});

describe("PRV No. 판정", () => {
  test("항번이 하나면 두 패스만 맞아도 채운다", () => {
    const decision = decidePrvNumber(
      [pass(parjuLine({})), pass(parjuLine({})), pass("")],
      "1706124"
    );
    assert.equal(decision.state, "READ");
    assert.equal(decision.value, "R2601-2795429");
  });

  test("🔴 항번이 둘이면 그 건의 S/N 이 있는 줄의 값을 고른다", () => {
    const text =
      `${parjuLine({ prv: "R2603-2876362", serial: "1802127" })}\n` +
      parjuLine({ prv: "R2604-2901549", serial: "1507048" });
    assert.equal(decidePrvNumber([pass(text), pass(text), pass(text)], "1507048").value, "R2604-2901549");
    assert.equal(decidePrvNumber([pass(text), pass(text), pass(text)], "1802127").value, "R2603-2876362");
  });

  test("🔴 항번이 둘인데 **한 패스라도** 다른 줄을 가리키면 채우지 않는다 — 기울어진 사진이 묶기를 깬다", () => {
    const good =
      `${parjuLine({ prv: "R2603-2876362", serial: "1802127" })}\n` +
      parjuLine({ prv: "R2604-2901549", serial: "1507048" });
    // 기울어져 S/N 이 한 줄 밀려 읽힌 패스
    const skewed =
      `${parjuLine({ prv: "R2603-2876362", serial: "1507048" })}\n` +
      parjuLine({ prv: "R2604-2901549", serial: "1802127" });
    const decision = decidePrvNumber([pass(good), pass(good), pass(skewed)], "1507048");
    assert.equal(decision.state, "UNREAD");
    assert.equal(decision.value, null);
    assert.equal(decision.rows, 2);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 🔴 이 파일의 핵심 — 「서류에 없음」과 「못 읽음」이 뒤바뀌지 않는가
 * ────────────────────────────────────────────────────────────────────────── */

describe("🔴 「서류에 없음(ABSENT)」과 「못 읽음(UNREAD)」을 가른다", () => {
  /** 구미 통문증 — PRV 칸이 비어 있고 Q코드와 S/N 은 또렷하다. */
  const gumiText = `${TABLE_HEAD}1 RDAC01543 RFK200FH-JS1 QDAC28594\nS/N : 1605006`;

  test("PRV 가 **정말 없을 때**만 「서류에 없음」이다", () => {
    const decision = decidePrvNumber(
      [pass(gumiText), pass(gumiText), pass(gumiText)],
      "1605006"
    );
    assert.equal(decision.state, "ABSENT");
    assert.equal(decision.value, null);
  });

  test("🔴 아무것도 못 읽은 사진은 「못 읽음」이다 — 이것을 「없음」으로 내면 사람이 빈칸으로 두고 넘어간다", () => {
    const decision = decidePrvNumber([pass(""), pass(""), pass("")], "1605006");
    assert.equal(decision.state, "UNREAD");
    assert.notEqual(decision.state, "ABSENT");
  });

  test("🔴 그 건의 S/N 을 못 찾았으면 「없음」이라고 말할 자격이 없다", () => {
    // 글자는 읽혔지만 S/N 이 다른 건의 것이다 — 우리 줄을 읽었다는 증거가 아니다.
    const decision = decidePrvNumber(
      [pass(gumiText), pass(gumiText), pass(gumiText)],
      "9999999"
    );
    assert.equal(decision.state, "UNREAD");
  });

  test("🔴 같은 줄의 Q코드를 못 읽었으면 「없음」이라고 말할 자격이 없다", () => {
    const noQ = `${TABLE_HEAD}1 RDAC01543 RFK200FH-JS1\nS/N : 1605006`;
    const decision = decidePrvNumber([pass(noQ), pass(noQ), pass(noQ)], "1605006");
    assert.equal(decision.state, "UNREAD");
  });

  test("🔴 PRV 꼴에 **가까운 것**이라도 보이면 「없음」이 아니다", () => {
    // `R` 이 `B` 로, `0·1` 이 `O·I` 로 읽힌 모양 — 꼴에는 못 미치지만 그 자리에
    // 무언가 인쇄돼 있었다는 뜻이다.
    const blurred = `${TABLE_HEAD}1 B26OI-2795429 QDAC28594 RFK200FH-JS1\nS/N : 1605006`;
    const decision = decidePrvNumber(
      [pass(blurred), pass(blurred), pass(blurred)],
      "1605006"
    );
    assert.equal(decision.state, "UNREAD");
    assert.ok(decision.why.includes("비슷한"), decision.why);
  });

  test("「있음 · 없음 · 못 읽음」 셋이 서로 다른 상태다", () => {
    const states = new Set([
      decidePrvNumber([pass(parjuLine({})), pass(parjuLine({})), pass("")], "1706124").state,
      decidePrvNumber([pass(gumiText), pass(gumiText), pass(gumiText)], "1605006").state,
      decidePrvNumber([pass(""), pass(""), pass("")], "1605006").state,
    ]);
    assert.deepEqual([...states].sort(), ["ABSENT", "READ", "UNREAD"]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 🔴 이 통문증이 **정말 이 건의 것인가** — S/N 맞춰보기
 * ────────────────────────────────────────────────────────────────────────── */

describe("🔴 서류의 S/N 과 그 건의 S/N 을 맞춰본다", () => {
  const passes = [
    pass(parjuLine({ serial: "1703071" })),
    pass(parjuLine({ serial: "1703071" })),
    pass(parjuLine({ serial: "1703071" })),
  ];

  test("같으면 「맞음」이다", () => {
    const check = checkSerialAgainstDocument(passes, "1703071");
    assert.equal(check.state, "MATCH");
    assert.equal(check.documentSerial, "1703071");
  });

  test("앞뒤 공백·대소문자는 정리하고 견준다", () => {
    const mixed = [
      pass(parjuLine({ serial: "NPG2K13K098" })),
      pass(parjuLine({ serial: "NPG2K13K098" })),
      pass(parjuLine({ serial: "NPG2K13K098" })),
    ];
    assert.equal(checkSerialAgainstDocument(mixed, " npg2k13k098 ").state, "MATCH");
  });

  test("🔴 다르면 「다름」이고 **서류에 적힌 S/N 을 알려 준다**", () => {
    const check = checkSerialAgainstDocument(passes, "1708075");
    assert.equal(check.state, "MISMATCH");
    assert.equal(check.documentSerial, "1703071");
    assert.ok(check.why.includes("1708075"), check.why);
  });

  test("🔴 서류의 S/N 을 못 읽었으면 「맞춰보지 못함」이다 — 「다름」이 아니다", () => {
    const blank = [pass(TABLE_HEAD), pass(TABLE_HEAD), pass(TABLE_HEAD)];
    const check = checkSerialAgainstDocument(blank, "1708075");
    assert.equal(check.state, "UNREAD");
    assert.equal(check.documentSerial, null);
  });

  test("그 건에 S/N 이 없으면 맞춰볼 수가 없다", () => {
    for (const key of [null, "", "   "]) {
      assert.equal(checkSerialAgainstDocument(passes, key).state, "UNREAD");
    }
  });

  test("🔴 맞춰보기는 **판정을 건드리지 않는다** — 값은 그대로 채운다", () => {
    // 서류의 S/N 이 이 건의 것과 달라도 PRV · Q코드는 예전 그대로 READ 다.
    const prv = decidePrvNumber(passes, "1708075");
    const q = decideQCode(passes, null);
    assert.equal(prv.state, "READ");
    assert.equal(prv.value, "R2601-2795429");
    assert.equal(q.state, "READ");
    assert.equal(checkSerialAgainstDocument(passes, "1708075").state, "MISMATCH");
  });

  test("세 갈래가 서로 다르다", () => {
    const states = new Set([
      checkSerialAgainstDocument(passes, "1703071").state,
      checkSerialAgainstDocument(passes, "1708075").state,
      checkSerialAgainstDocument([pass(TABLE_HEAD)], "1708075").state,
    ]);
    assert.deepEqual([...states].sort(), ["MATCH", "MISMATCH", "UNREAD"]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 2. 실제 통문증 14장 — 측정 폴더가 있을 때만
 * ────────────────────────────────────────────────────────────────────────── */

const FIXTURE_DIR = process.env.PASS_SLIP_FIXTURE_DIR ?? "C:/DSS-AS-DATA/통문증-시험";
const TRUTH_FILE = path.join(FIXTURE_DIR, "out", "eye-truth.json");
const IMAGE_DIR = path.join(FIXTURE_DIR, "browser", "images");

type TruthCase = {
  caseNo: string;
  site: string;
  /** 우리 시스템이 아는 그 건의 S/N(폴더명). 운영에서 쓰는 것과 같은 열쇠다. */
  folderSn: string;
  rows: { q: string; prv: string | null; sn: string }[];
  expectQ: string | null;
  expectPrv: string | null;
};

type SharpLike = (
  input: string,
  options: { failOn: string }
) => {
  rotate(): {
    ensureAlpha(): {
      raw(): {
        toBuffer(options: { resolveWithObject: true }): Promise<{
          data: Buffer;
          info: { width: number; height: number };
        }>;
      };
    };
  };
};

type TesseractLike = {
  createWorker(
    languages: string[],
    oem: number,
    options: Record<string, unknown>
  ): Promise<{
    setParameters(parameters: Record<string, string>): Promise<unknown>;
    recognize(image: Buffer): Promise<{ data: { text: string } }>;
    terminate(): Promise<unknown>;
  }>;
};

function loadFixture():
  | { cases: TruthCase[]; sharp: SharpLike; tesseract: TesseractLike }
  | string {
  if (!fs.existsSync(TRUTH_FILE) || !fs.existsSync(IMAGE_DIR)) {
    return `측정 자료가 없어 건너뜁니다: ${TRUTH_FILE} (PASS_SLIP_FIXTURE_DIR 로 가리킬 수 있습니다)`;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(TRUTH_FILE, "utf8")) as { cases: TruthCase[] };
    // 저장소에 sharp · tesseract.js 를 들이지 않는다 — 측정 폴더의 것을 빌려 쓴다.
    // (브라우저에서는 둘 다 쓰지 않는다: 사진은 createImageBitmap 이 펼치고,
    //  글자 인식기는 public/ocr/ 의 파일이다.)
    const requireFromFixture = createRequire(path.join(FIXTURE_DIR, "package.json"));
    return {
      cases: parsed.cases,
      sharp: requireFromFixture("sharp") as SharpLike,
      tesseract: requireFromFixture("tesseract.js") as TesseractLike,
    };
  } catch (error) {
    return `측정 자료를 읽지 못해 건너뜁니다: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const fixture = loadFixture();
const fixtureSkip = typeof fixture === "string" ? fixture : false;

/** 한 건을 읽은 결과 — 아래 시험들이 나눠 본다. */
type MeasuredCase = {
  truth: TruthCase;
  q: ReturnType<typeof decideQCode>;
  prv: ReturnType<typeof decidePrvNumber>;
  serial: ReturnType<typeof checkSerialAgainstDocument>;
  ms: number;
};

const measured: MeasuredCase[] = [];
let msPerDoc = 0;

describe("실제 통문증 14장 — 사진부터 읽어 재는가", { skip: fixtureSkip }, () => {
  before(async () => {
    const { cases, sharp, tesseract } = fixture as {
      cases: TruthCase[];
      sharp: SharpLike;
      tesseract: TesseractLike;
    };
    // 🔴 「아는 Q코드 목록」은 **정답표가 아니라** 그 고객사에 이미 있는 값들로
    //    만든다 — 운영에서는 저장된 손 입력값이 그 자리에 온다.
    const known = toKnownQCodeSet(cases.flatMap((item) => item.rows.map((row) => row.q)));

    const worker = await tesseract.createWorker(["eng"], 1, {
      cachePath: path.join(FIXTURE_DIR, "tessdata"),
      logger: () => {},
      errorHandler: () => {},
    });
    try {
      let total = 0;
      for (const truth of cases) {
        const file = path.join(IMAGE_DIR, `${truth.caseNo}.jpg`);
        const { data, info } = await sharp(file, { failOn: "none" })
          .rotate()
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const rgba: RgbaImage = {
          data: new Uint8Array(data.buffer, data.byteOffset, data.length),
          width: info.width,
          height: info.height,
        };
        const startedAt = Date.now();
        const readings: GoodsPassReading[] = [];
        for (const goodsPass of PASS_SLIP_GOODS_PASSES) {
          await worker.setParameters({ tessedit_pageseg_mode: goodsPass.pageSegMode });
          const gray = prepare(rgba, goodsPass.options);
          const png = encodeGrayPNG(gray.data, gray.width, gray.height);
          const recognized = await worker.recognize(Buffer.from(png));
          readings.push(parseGoodsPass(recognized.data.text));
        }
        const ms = Date.now() - startedAt;
        total += ms;
        measured.push({
          truth,
          q: decideQCode(readings, known),
          // 🔴 운영과 같은 열쇠 — 우리 시스템이 아는 그 건의 S/N.
          prv: decidePrvNumber(readings, truth.folderSn),
          serial: checkSerialAgainstDocument(readings, truth.folderSn),
          ms,
        });
      }
      msPerDoc = Math.round(total / cases.length);
    } finally {
      await worker.terminate();
    }
  });

  test("14장을 읽었다", () => {
    assert.equal(measured.length, 14);
  });

  test("🔴 Q코드 14/14 — 틀린 값도, 못 읽은 것도 없다", () => {
    const wrong = measured
      .filter((item) => item.q.state !== "READ" || item.q.value !== item.truth.expectQ)
      .map((item) => `${item.truth.caseNo}: ${item.q.state} ${item.q.value} ≠ ${item.truth.expectQ}`);
    assert.deepEqual(wrong, []);
  });

  test("🔴 PRV No. 14/14 — 읽음 11 · 서류에 없음 3", () => {
    const wrong: string[] = [];
    let read = 0;
    let absent = 0;
    for (const item of measured) {
      const expected = item.truth.expectPrv;
      if (expected === null) {
        // 🔴 「못 읽음」이 아니라 「서류에 없음」이어야 한다.
        if (item.prv.state === "ABSENT") absent += 1;
        else wrong.push(`${item.truth.caseNo}: ${item.prv.state} (없는 것을 못 알아봤다)`);
      } else if (item.prv.state === "READ" && item.prv.value === expected) {
        read += 1;
      } else {
        wrong.push(`${item.truth.caseNo}: ${item.prv.state} ${item.prv.value} ≠ ${expected}`);
      }
    }
    assert.deepEqual(wrong, []);
    assert.equal(read, 11, "읽어서 맞힌 건수");
    assert.equal(absent, 3, "「서류에 없음」으로 가려낸 건수");
  });

  test("🔴 S/N 짝맞추기 2건 — 항번이 둘인 통문증에서 그 건의 줄을 골랐다", () => {
    const multi = measured.filter((item) => item.truth.rows.length >= 2);
    assert.equal(multi.length, 2, "항번이 둘인 표본이 2건이 아니다");
    for (const item of multi) {
      // 같은 통문증(항번 2줄)인데 건마다 답이 달라야 한다 — 줄을 잘못 고르면 여기서 걸린다.
      assert.equal(item.prv.state, "READ", `${item.truth.caseNo}`);
      assert.equal(item.prv.value, item.truth.expectPrv, `${item.truth.caseNo}`);
      assert.ok(item.prv.rows >= 2, `${item.truth.caseNo}: 항번을 둘로 못 셌다`);
    }
    assert.notEqual(multi[0].prv.value, multi[1].prv.value, "두 건이 같은 값을 받았다");
  });

  test("🔴 「서류에 없음」은 구미 셋뿐이다 — 사업장으로 굳히지 않고 읽은 결과로 가른다", () => {
    const absent = measured.filter((item) => item.prv.state === "ABSENT").map((i) => i.truth.caseNo);
    const truthAbsent = measured
      .filter((item) => item.truth.expectPrv === null)
      .map((i) => i.truth.caseNo);
    assert.deepEqual(absent, truthAbsent);
  });

  test("🔴 서류의 S/N 이 그 건의 것과 다른 D260105 에서 경고가 뜬다", () => {
    // 이 한 장만 서류 S/N(NPG2K13K098)과 우리 쪽 S/N(1910107)이 실제로 다르다.
    const odd = measured.find((item) => item.truth.caseNo === "D260105");
    assert.ok(Boolean(odd), "D260105 가 측정 자료에서 사라졌다");
    assert.equal(odd?.serial.state, "MISMATCH");
    assert.equal(odd?.serial.documentSerial, "NPG2K13K098");
    // 🔴 그런데도 값은 그대로 채워진다 — 경고는 표시일 뿐 판정이 아니다.
    assert.equal(odd?.prv.state, "READ");
    assert.equal(odd?.prv.value, odd?.truth.expectPrv);
  });

  test("🔴 나머지 13장은 「다름」이 뜨지 않는다 — 경고가 늘 뜨면 아무도 안 본다", () => {
    const mismatched = measured
      .filter((item) => item.serial.state === "MISMATCH")
      .map((item) => item.truth.caseNo);
    assert.deepEqual(mismatched, ["D260105"]);
    const unread = measured
      .filter((item) => item.serial.state === "UNREAD")
      .map((item) => item.truth.caseNo);
    assert.deepEqual(unread, [], "S/N 을 못 읽은 장이 생겼다");
  });

  test("한 장에 걸리는 시간(물품정보 3패스)", () => {
    // 성적이 아니라 기록이다. 측정 당시 1,228ms 였다.
    console.log(`        물품정보 3패스: ${msPerDoc}ms/장`);
    assert.ok(msPerDoc > 0);
  });
});
