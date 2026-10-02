import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";

import { readNameplateRegion, type NameplateRecognizer } from "./nameplate-ocr";
import { NAMEPLATE_OCR_WHITELIST } from "./nameplate-ocr";
import type { CropRegion, RgbaImage } from "./pass-slip-preprocess";

/**
 * ============================================================================
 * 실물 구 양식 명판 5장 — **글자로 읽어 얼마나 나오는가**
 * ============================================================================
 * QR 이 인쇄돼 있지 않은 2013년 구 양식이 과녁이다. 성적이 낮은 것이 정상이고
 * (표본 다섯 중 넷은 카카오톡이 줄여 보낸 사진이다), 이 시험은 **그
 * 낮은 성적이 더 낮아지지 않게** 지키는 바닥값이다.
 *
 * 🔴 **가장 중요한 단언은 성적이 아니다** — 「틀린 값을 조용히 채우지 않는다」
 * 쪽이다. 꼴 검사(S/N 숫자 일곱 · L/N 영문둘+숫자넷)나 모델명 대조 기준을
 * 느슨하게 만들면 성적표의 숫자는 올라가도 **빈칸이 틀린 값으로 바뀐다.**
 * 그 순간 이 기능은 쓸모가 아니라 사고가 된다.
 *
 * ── 실제로 나온 성적 (2026-10-02, 다섯 장 한 바퀴 42초) ────────────────
 *
 *   사진                      Model                  L/N(자동)   S/N
 *   092806579 (3024x1702)   CMK150M-IC2 ○          빈칸        1307009 ○
 *   092949573 (1440x1080)   빈칸                    빈칸        빈칸
 *   092832456 (1411x1058)   RFK150FH-IC1|…IC1 △    빈칸        1307006 ○
 *   092949573_01            CFK150FH-IC1|…IC1 △    WZ6216 ○    1307006 ○
 *   130951985 ( 648x1404)   MBK150M-IC1 ○ (조각)    빈칸        1309015 ○
 *                           ──────────────────────────────────────────
 *                           하나로 2 · 비김 2       1장         4장
 *                           🔴 **자동으로 채운** 값은 틀린 것이 하나도 없다
 *
 *   △ = 붙임표만 다른 쌍둥이라 **원리상 하나로 좁힐 수 없다**(마스터에
 *       `CFK150FH-IC1` 과 `CFK150FHIC1` 이 둘 다 등록돼 있다). 사람이 고른다.
 *
 * ── 🔴 L/N 후보 — **고르세요**지 **채웠습니다**가 아니다 ───────────────
 * 자동 채우기가 거절한 네 장에서 날것을 여섯 글자씩 훑어 자리를 고치고
 * 투표한 결과다. 다섯 장이 **서로 다른 다섯 경우**라는 것이 핵심이다:
 *
 *   092949573_01  WZ6216 ○ 자동    후보 없음(이미 채웠다)
 *   092832456     자동 없음        [WZ6204 ← 1위 정답 | WA1762 | WA5010 | WT3070 | WI3070]
 *   092806579     자동 없음        [WK1150 | WA1307 | WA2013 | WZ6243 ← 4위 정답 | WZ7624]
 *   092949573     자동 없음        [WZ6241 | WW2624 | WZ0241]  🔴 **정답(WZ6247)이 없다**
 *   130951985     자동 없음        [WI3090 | WA1762 | WE1415 | WR1415 | WT4150]  🔴 **없다**
 *
 * 🔴 **1등을 자동으로 넣으면 안 된다.** 틀린 `WZ6241`(4표)이 맞는 `WZ6204`(4표)·
 * `WZ6216`(4표)와 **똑같은 표**다 — 표 수로는 둘을 못 가른다.
 *
 * 🔴 092806579 의 정답은 **1표짜리 4위**다. 같은 1표가 넷이고 가나다순으로
 * 갈려 간신히 다섯 안에 든다. 창 수나 차례를 손대면 가장 먼저 밀려날 줄이다.
 *
 * 🔴 **L/N 은 지시서가 적은 바닥값(2장)에 못 미친다.** 숫자를 맞추려고 기준을
 * 풀지 않았다 — 정답 글자가 사진 안에서 이미 깨져 있기 때문이다:
 * `W76243`(정답 WZ6243, Z→7) · `UA50SWIYZ6204`(정답 WZ6204, W→Y) ·
 * `WWZ6241`(정답 WZ6247, 7→1). 받아들이면 그 자리에 **틀린 로트번호**가 적힌다.
 * (지시서의 바닥값은 「정답 문자열이 날것 어딘가에 들어 있는가」로 잰 것으로
 * 보인다. 그것과 「안전하게 뽑아낼 수 있는가」는 다른 숫자다.)
 *
 * ── 🔴 왜 1단계를 2000px 한 바퀴로 두는가 ──────────────────────────────
 * 「네모 크기에 맞춰 배율을 정하고 기울기도 쓸면 낫지 않겠나」를 다섯 가지
 * 설정으로 끝까지 돌려 봤다. 날것만 보면 더 잘 읽히는데, **칸에 들어가는 값**
 * 으로 재면 정반대였다 — `nameplate-ocr.ts` 의 `stage1NameplateSettings` 주석에
 * 표를 적어 두었다. 바퀴를 더 돌수록 비슷한 오답이 같이 늘어 투표를 뒤집고,
 * 틀린 값이 0건에서 5건으로 늘었다(모델명이 `DEMO-GENERATOR-016` 이 된 적도
 * 있다). 그래서 쓸어 보는 길은 2단계 단추로 옮기고, 거기서 나온 값은
 * **자동으로 채우지 않는다.**
 *
 * ── 🔴 명판 표의 자리는 손으로 잰 것이다 ───────────────────────────────
 * 실제 화면에서는 **사람이 드래그로 네모를 친다**(NameplateRegionPicker).
 * 자동으로 찾는 것은 실측에서 되지 않았다. 아래 상자들은 사용자가 사진을
 * 보고 손으로 잰 비율로, 그 「네모 치기」를 시험에서 대신한다.
 *
 * ── 🔴 사진과 정답은 저장소에 넣지 않는다(고객 자료다) ─────────────────
 * 측정 폴더와 글자 인식기가 이 PC 에 있을 때만 돌고, 없으면 **건너뛴다는
 * 사실이 보이게** 넘어간다.
 *
 * 글자 인식기(tesseract.js)는 저장소의 의존성이 **아니다** — 브라우저에는
 * `public/ocr/` 의 파일로 들어가고, Node 시험에서는 측정 때 쓴 실험 폴더의
 * 것을 끼운다(`NAMEPLATE_TESSERACT_DIR`). 시험 하나 때문에 운영 꾸러미에
 * 7MB 짜리 엔진을 더하지 않기 위해서다.
 *
 * `.lum` 은 **EXIF 회전을 적용한 뒤** 밝기값을 한 바이트씩 담은 날것이다.
 * 전처리는 RGBA 를 받으므로 세 칸에 같은 값을 펴서 넣는다 — 회색조 단계가
 * 그대로 되돌리므로 밝기는 바뀌지 않는다.
 * ============================================================================
 */

const FIXTURE_DIR = process.env.NAMEPLATE_FIXTURE_DIR ?? "C:/DSS-AS-DATA/명판-시험/fixture";
const MANIFEST = path.join(FIXTURE_DIR, "manifest.json");
const MODELS_FILE = path.join(FIXTURE_DIR, "registered-models.txt");
/** 측정에 쓴 실험 폴더의 node_modules. 저장소 의존성이 아니다. */
const TESSERACT_DIR =
  process.env.NAMEPLATE_TESSERACT_DIR ?? "C:/DSS-AS-DATA/통문증-시험/node_modules";
/** 언어 데이터가 이미 풀려 있는 자리(인터넷 없이 돈다). */
const TESSDATA_DIR = process.env.NAMEPLATE_TESSDATA_DIR ?? "C:/DSS-AS-DATA/통문증-시험/tessdata";

/**
 * 🔴 사용자가 사진을 보고 손으로 잰 명판 표의 자리 — 「네모 치기」 대신이다.
 *
 * 나중에 들어온 표본은 `manifest.json` 의 `tableBox` 에 적혀 온다. 그쪽이
 * 있으면 그것을 쓴다 — 표본을 더하는 사람이 이 파일을 고치지 않아도 되게.
 */
const BOXES: Record<string, CropRegion> = {
  "KakaoTalk_20261002_092806579.jpg": { l: 0.46, t: 0.28, w: 0.25, h: 0.18 },
  "KakaoTalk_20261002_092949573.jpg": { l: 0.55, t: 0.38, w: 0.25, h: 0.22 },
  "KakaoTalk_20261002_092832456.jpg": { l: 0.4, t: 0.49, w: 0.22, h: 0.22 },
  "KakaoTalk_20261002_092949573_01.jpg": { l: 0.43, t: 0.53, w: 0.24, h: 0.22 },
};

type FixtureItem = {
  file: string;
  lum: string;
  width: number;
  height: number;
  group: string;
  /** 표본을 더한 사람이 재서 적어 둔 명판 표의 자리(있으면 이것을 쓴다). */
  tableBox?: CropRegion;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  note: string;
};

function readManifest(): FixtureItem[] | null {
  try {
    if (!fs.existsSync(MANIFEST)) return null;
    const parsed = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { items: FixtureItem[] };
    return Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : null;
  } catch {
    return null;
  }
}

function readModels(): string[] | null {
  try {
    if (!fs.existsSync(MODELS_FILE)) return null;
    const lines = fs
      .readFileSync(MODELS_FILE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

const items = readManifest();
const models = readModels();
const oldForm = (items ?? []).filter((item) => item.group === "구양식-QR없음");

function tesseractAvailable(): boolean {
  try {
    return (
      fs.existsSync(path.join(TESSERACT_DIR, "tesseract.js", "package.json")) &&
      fs.existsSync(path.join(TESSDATA_DIR, "eng.traineddata"))
    );
  } catch {
    return false;
  }
}

const skip = !items
  ? `측정 자료가 없어 건너뜁니다: ${MANIFEST} (NAMEPLATE_FIXTURE_DIR 로 가리킬 수 있습니다)`
  : !models
    ? `등록 모델 목록이 없어 건너뜁니다: ${MODELS_FILE}`
    : !tesseractAvailable()
      ? `글자 인식기가 없어 건너뜁니다: ${TESSERACT_DIR}/tesseract.js (NAMEPLATE_TESSERACT_DIR)`
      : false;

/* ────────────────────────────────────────────────────────────────────────── *
 * Node 쪽 글자 인식기 — 브라우저와 **같은 엔진·같은 설정**을 끼운다.
 * ────────────────────────────────────────────────────────────────────────── */

type TesseractWorkerLike = {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(image: unknown): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

async function createNodeRecognizer(): Promise<{
  recognize: NameplateRecognizer;
  dispose(): Promise<void>;
}> {
  const require = createRequire(import.meta.url);
  const Tesseract = require(path.join(TESSERACT_DIR, "tesseract.js")) as {
    createWorker(
      languages: string,
      oem: number,
      options: Record<string, unknown>
    ): Promise<TesseractWorkerLike>;
  };
  const worker = await Tesseract.createWorker("eng", 1, {
    cachePath: TESSDATA_DIR,
    logger: () => {},
  });
  return {
    recognize: async (png, pageSegMode) => {
      await worker.setParameters({
        tessedit_pageseg_mode: pageSegMode,
        tessedit_char_whitelist: NAMEPLATE_OCR_WHITELIST,
      });
      const result = await worker.recognize(Buffer.from(png));
      return result.data.text ?? "";
    },
    dispose: async () => {
      await worker.terminate();
    },
  };
}

/** `.lum`(밝기 한 바이트) → RGBA. 회색조 단계가 그대로 되돌린다. */
function rgbaFromLum(item: FixtureItem): RgbaImage {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, item.lum));
  assert.equal(
    raw.byteLength,
    item.width * item.height,
    `${item.file}: .lum 의 크기가 manifest 의 가로×세로와 다르다`
  );
  const data = new Uint8Array(raw.byteLength * 4);
  for (let p = 0, i = 0; p < raw.byteLength; p += 1, i += 4) {
    const v = raw[p];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { data, width: item.width, height: item.height };
}

type Scored = {
  item: FixtureItem;
  modelName: string | null;
  modelState: string;
  modelBy: string | undefined;
  modelNames: string[];
  lotNumber: string | null;
  /** 🔴 자동으로 못 채웠을 때 사람에게 보일 후보들. **칸에 들어간 값이 아니다.** */
  lotCandidates: string[];
  serialNumber: string | null;
  tokens: string[];
  ms: number;
};

let scoredPromise: Promise<Scored[]> | null = null;

function readAll(): Promise<Scored[]> {
  if (scoredPromise) return scoredPromise;
  scoredPromise = (async () => {
    const engine = await createNodeRecognizer();
    const dump: Record<string, string[]> = {};
    try {
      const out: Scored[] = [];
      for (const item of oldForm) {
        const region = item.tableBox ?? BOXES[item.file];
        assert.ok(region, `${item.file}: 명판 표의 자리를 모른다`);
        const outcome = await readNameplateRegion(
          rgbaFromLum(item),
          region,
          engine.recognize,
          models as string[]
        );
        dump[item.file] = outcome.passes.map((pass) => pass.text);
        const { reading } = outcome;
        out.push({
          item,
          modelName: reading.modelName,
          modelState: reading.model.state,
          modelBy: reading.model.state === "NONE" ? undefined : reading.model.by,
          modelNames: reading.model.state === "AMBIGUOUS" ? reading.model.names : [],
          lotNumber: reading.lotNumber,
          lotCandidates: reading.lotCandidates,
          serialNumber: reading.serialNumber,
          tokens: [...new Set(reading.rawTokens)],
          ms: outcome.ms,
        });
      }
      return out;
    } finally {
      await engine.dispose();
      // 날것의 글을 파일로 빼 두면 글자 인식을 다시 돌리지 않고(한 바퀴 75초)
      // 꼴 검사·대조 기준만 바꿔 가며 잴 수 있다. 평소에는 꺼져 있다.
      if (process.env.NAMEPLATE_OCR_DUMP) {
        fs.writeFileSync(process.env.NAMEPLATE_OCR_DUMP, JSON.stringify(dump, null, 1), "utf8");
      }
    }
  })();
  return scoredPromise;
}

describe("실물 구 양식 명판 5장 — 글자로 읽기", () => {
  test("🔴 사진별 결과를 사람이 읽을 수 있게 적는다", { skip }, async () => {
    const scored = await readAll();
    assert.equal(scored.length, 5, "구 양식 표본이 다섯이 아니다");
    for (const row of scored) {
      const mark = (got: string | null, want: string | null) =>
        got === null ? "빈칸" : got === want ? `맞음 ${got}` : `🔴틀림 ${got}`;
      console.log(
        [
          `\n──── ${row.item.file} (${row.ms}ms)`,
          `     정답  ${row.item.modelName} / ${row.item.lotNumber} / ${row.item.serialNumber}`,
          `     Model ${row.modelState}` +
            (row.modelNames.length > 0 ? ` [${row.modelNames.join(" | ")}]` : "") +
            ` → ${mark(row.modelName, row.item.modelName)}`,
          `     L/N   ${mark(row.lotNumber, row.item.lotNumber)}` +
            (row.lotCandidates.length > 0
              ? `   후보 [${row.lotCandidates.join(" | ")}] ${
                  row.lotCandidates.includes(row.item.lotNumber as string)
                    ? `← 정답 ${row.lotCandidates.indexOf(row.item.lotNumber as string) + 1}위`
                    : "← 🔴 정답 없음"
                }`
              : ""),
          `     S/N   ${mark(row.serialNumber, row.item.serialNumber)}`,
          `     날것  ${row.tokens.slice(0, 24).join(" ")}`,
        ].join("\n")
      );
    }
  });

  test("🔴 **자동으로 채운** 값이 틀린 장이 하나도 없다 — 이 단언이 가장 중요하다", { skip }, async () => {
    const scored = await readAll();
    const wrong: string[] = [];
    for (const row of scored) {
      if (row.modelName !== null && row.modelName !== row.item.modelName) {
        wrong.push(`${row.item.file}: Model ${row.modelName} ≠ ${row.item.modelName}`);
      }
      if (row.lotNumber !== null && row.lotNumber !== row.item.lotNumber) {
        wrong.push(`${row.item.file}: L/N ${row.lotNumber} ≠ ${row.item.lotNumber}`);
      }
      if (row.serialNumber !== null && row.serialNumber !== row.item.serialNumber) {
        wrong.push(`${row.item.file}: S/N ${row.serialNumber} ≠ ${row.item.serialNumber}`);
      }
    }
    assert.deepEqual(wrong, [], "틀린 값을 조용히 채웠다 — 꼴 검사나 대조 기준이 느슨해졌다");
  });

  test("🔴 S/N 을 최소 네 장에서 맞힌다", { skip }, async () => {
    const scored = await readAll();
    const hit = scored.filter((row) => row.serialNumber === row.item.serialNumber).length;
    assert.ok(hit >= 4, `S/N ${hit}/5 — 바닥값 4 보다 낮다`);
  });

  /**
   * 🔴 **모델명이 두 칸에 나뉘어 인쇄된 명판**(2026-10-02 다섯째 표본).
   *
   *     MBK        ← 검은 바탕에 **흰** 글자
   *     150M-IC1   ← 흰 바탕에 **검은** 글자
   *
   * 바탕색이 반대라 **한 패스에서는 둘이 같이 안 읽힌다.** 그래서 온전한
   * `MBK150M-IC1` 은 어떤 조합으로도 나오지 않는다 — 그런데도 맞힌다.
   * 꼬리 `150M-IC1` 하나로 등록 목록이 **한 개로 좁혀지기** 때문이다.
   */
  describe("🔴 두 칸에 나뉘어 인쇄된 모델명 — 조각으로 집는다", () => {
    test("Model 을 **조각으로** 맞힌다", { skip }, async () => {
      const scored = await readAll();
      const row = scored.find((r) => /130951985/.test(r.item.file));
      assert.ok(row, "다섯째 표본이 없다");
      assert.equal(row.modelName, "MBK150M-IC1");
      assert.equal(row.modelBy, "FRAGMENT", "온전한 토막으로 집혔다면 조각 길이 안 돌고 있다");
    });

    test("S/N 도 맞힌다", { skip }, async () => {
      const scored = await readAll();
      const row = scored.find((r) => /130951985/.test(r.item.file));
      assert.equal(row?.serialNumber, "1309015");
    });

    test(
      "🔴 L/N 은 자동으로도 후보로도 못 읽는다 — 나오게 만들려 하지 말 것",
      { skip },
      async () => {
        const scored = await readAll();
        const row = scored.find((r) => /130951985/.test(r.item.file));
        assert.ok(row);
        assert.equal(row.lotNumber, null, "🔴 틀린 L/N 이 자동으로 들어갔다");
        // 사진이 648x1404 로 줄어 표 한 칸이 너무 작다. 기준을 풀면 날짜 칸의
        // `…NE 2013.7` 같은 것이 로트번호로 들어온다(실제로 들어왔었다).
        assert.ok(
          !row.lotCandidates.includes("WZ6293"),
          `정답이 후보에 들어왔다 — 반가운 일이지만 기준이 바뀐 것이니 다시 잴 것 [${row.lotCandidates.join(" | ")}]`
        );
      }
    );
  });

  test("🔴 L/N 을 최소 한 장에서 **자동으로** 맞힌다", { skip }, async () => {
    const scored = await readAll();
    const hit = scored.filter((row) => row.lotNumber === row.item.lotNumber).length;
    assert.ok(hit >= 1, `L/N ${hit}/5 — 바닥값 1 보다 낮다`);
  });

  /**
   * 🔴 **L/N 후보는 「고르세요」지 「채웠습니다」가 아니다.**
   *
   * 자동 채우기(토막 **전체**가 영문2+숫자4)가 거절한 세 장에서, 날것을 여섯
   * 글자씩 훑어 자리를 고치고 투표한 결과다. 성적이 아니라 **네 장이 서로 다른
   * 네 가지 경우**라는 것이 이 묶음의 값어치다 — 자동 · 1위 정답 · 다섯 안에
   * 정답 · **정답이 아예 없음**. 넷째가 가장 중요하다.
   */
  describe("L/N 후보 — 🔴 네 장이 서로 다른 네 경우다", () => {
    function rowOf(scored: Scored[], pattern: RegExp): Scored {
      const found = scored.find((row) => pattern.test(row.item.file));
      assert.ok(found, `${pattern} 에 맞는 사진이 없다`);
      return found;
    }

    test("092949573_01 — **자동으로 채워진다**(후보를 내놓지 않는다)", { skip }, async () => {
      const row = rowOf(await readAll(), /092949573_01\.jpg/);
      assert.equal(row.lotNumber, "WZ6216");
      assert.deepEqual(row.lotCandidates, [], "자동으로 채웠는데 후보까지 늘어놓는다");
    });

    test("092832456 — 자동 없음 · **후보 1위가 정답**", { skip }, async () => {
      const row = rowOf(await readAll(), /092832456\.jpg/);
      assert.equal(row.lotNumber, null, "🔴 자동 채우기 기준이 풀렸다");
      assert.equal(row.lotCandidates[0], "WZ6204", `후보 [${row.lotCandidates.join(" | ")}]`);
    });

    test("092806579 — 자동 없음 · **후보 다섯 안에 정답이 있다**", { skip }, async () => {
      const row = rowOf(await readAll(), /092806579\.jpg/);
      assert.equal(row.lotNumber, null, "🔴 자동 채우기 기준이 풀렸다");
      assert.ok(
        row.lotCandidates.includes("WZ6243"),
        `후보 다섯에서 정답이 밀려났다 — [${row.lotCandidates.join(" | ")}]`
      );
    });

    test(
      "🔴 092949573 — **후보 안에 정답이 없다.** 나오게 만들려 하지 말 것",
      { skip },
      async () => {
        const row = rowOf(await readAll(), /092949573\.jpg$/);
        assert.equal(row.lotNumber, null, "🔴 자동 채우기 기준이 풀렸다");
        assert.ok(row.lotCandidates.length > 0, "후보가 하나도 안 나왔다");
        // 🔴 정답 WZ6247 은 사진 어디에도 없다 — 7 을 1 로 읽어 WZ6241 뿐이고,
        //    그 틀린 값이 다른 사진의 **맞는 값들과 똑같이 4표**다. 「정답이
        //    나오게」 기준을 풀면 여기에 WZ6241 이 1위로 들어앉는다.
        assert.ok(
          !row.lotCandidates.includes("WZ6247"),
          "정답이 후보에 들어왔다 — 반가운 일이지만 기준이 바뀐 것이니 이 시험부터 다시 잴 것"
        );
        assert.ok(
          row.lotCandidates.includes("WZ6241"),
          `틀린 값이 1위로 남아 있는 것이 이 사진의 사실이다 — [${row.lotCandidates.join(" | ")}]`
        );
      }
    );

    test("🔴 후보는 어느 장에서도 **칸을 채우지 않는다**", { skip }, async () => {
      const scored = await readAll();
      for (const row of scored) {
        if (row.lotCandidates.length === 0) continue;
        assert.equal(
          row.lotNumber,
          null,
          `${row.item.file}: 후보를 내놓으면서 칸도 채웠다 — 사람이 누르기 전에는 비어 있어야 한다`
        );
      }
    });
  });

  test("🔴 모델명을 대조를 거쳐 최소 두 장에서 **하나로** 좁힌다", { skip }, async () => {
    const scored = await readAll();
    const hit = scored.filter((row) => row.modelName === row.item.modelName).length;
    assert.ok(hit >= 2, `Model ${hit}/5 — 바닥값 2 보다 낮다 (날것으로는 0장이었다)`);
  });

  test("🔴 모델명을 최소 네 장에서 **정답을 품은 후보**까지 좁힌다", { skip }, async () => {
    const scored = await readAll();
    const narrowed = scored.filter(
      (row) =>
        row.modelName === row.item.modelName ||
        (row.modelNames.length > 0 && row.modelNames.includes(row.item.modelName as string))
    ).length;
    assert.ok(narrowed >= 4, `Model(후보 포함) ${narrowed}/5 — 바닥값 4 보다 낮다`);
  });

  test(
    "🔴 붙임표만 다른 중복은 **비김**으로 남는다 — 마음대로 하나를 집지 않는다",
    { skip },
    async () => {
      const scored = await readAll();
      // RFK150FHIC1 · CFK150FHIC1 두 장은 접으면 붙임표 있는 쌍둥이와 완전히
      // 같아진다(RFK150FH-IC1 · CFK150FH-IC1). 대조로는 절대 가를 수 없다.
      const twins = scored.filter((row) => /092832456\.jpg|092949573_01\.jpg/.test(row.item.file));
      assert.equal(twins.length, 2);
      for (const row of twins) {
        assert.notEqual(
          row.modelState,
          "MATCHED",
          `${row.item.file}: 가를 수 없는 쌍을 하나로 골랐다 (${row.modelName})`
        );
        if (row.modelState === "AMBIGUOUS") {
          assert.ok(
            row.modelNames.includes(row.item.modelName as string),
            `${row.item.file}: 비긴 후보에 정답이 없다 — ${row.modelNames.join(" | ")}`
          );
        }
      }
    }
  );
});
