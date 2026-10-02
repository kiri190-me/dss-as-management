import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { parseNameplateCode } from "./nameplate-code";
import { createZxingNameplateDecoder, scanNameplateLuminance } from "./nameplate-scan";

/**
 * ============================================================================
 * 실물 명판 사진 14장 — **기대 성적 5/14 를 그대로 지킨다**
 * ============================================================================
 * 훑는 차례를 「조금 더 꼼꼼하게」 손보고 싶어지는 자리가 많다. 이 시험은 그
 * 손질이 **무엇을 잃게 하는지**를 바로 알려 주려고 있다.
 *
 *   신양식-원본화질  4장 → 4/4  (전부 1차에서)
 *   신양식-저화질    4장 → 1/4  (…093005331 만, 2차에서)
 *   구양식-QR없음    5장 → 0/5  🔴 QR 이 인쇄돼 있지 않다
 *   명판아님         1장 → 0/1  🔴 작업장 전경 사진이다
 *
 * 🔴 **읽히는 수 5 는 표본이 늘어도 그대로다.** 2026-10-02 에 구 양식 한 장
 * (…130951985, 모델명이 두 칸에 나뉘어 인쇄된 명판)이 표본에 들어와 합계가
 * `5/13` 에서 `5/14` 가 됐다 — 분모만 늘었다. 그 장에도 QR 은 없다.
 *
 * 🔴 **`expect` 가 null 인 장은 「못 읽는 것」이 통과다.** 2013년 구 양식
 * 명판에는 QR 이 아예 없고(표 생김새부터 다르다), 저화질 석 장은 QR 이
 * 눈으로는 보여도 타일·배율·이진화를 바꿔 가며 **1557번을 시도해도** 안
 * 풀렸다. 읽히게 만들려고 차례를 바꾸지 말 것 — 구 양식 다섯 장은 글자 인식
 * 쪽(`src/lib/ocr/nameplate-ocr-fixture.test.ts`)이 메우고 있다.
 *
 * 🔴 함께 단언하는 것: **못 읽은 장에서 엉뚱한 값이 나오지 않는다.** 같은
 * 장비에 ROM TYPE 딱지 QR 이 따로 붙어 있어, 꼴 검사가 느슨해지면 「0/5」가
 * 「5/5 인데 전부 틀린 값」으로 조용히 바뀐다.
 *
 * ── 🔴 사진과 정답은 저장소에 넣지 않는다(고객 자료다) ─────────────────
 * 측정 폴더가 이 PC 에 있을 때만 돌고, 없으면 **건너뛴다는 사실이 보이게**
 * 넘어간다(다른 PC 에서 시험이 깨지면 안 된다).
 *
 * `.lum` 은 **EXIF 회전을 적용한 뒤** 밝기값을 한 바이트씩 담은 날것이다.
 * 밝기는 `(R + 2G + B) >> 2` — zxing 의 `RGBLuminanceSource` 와 같은 식이고
 * 화면 쪽 `luminanceFromBlob()` 과도 같다. 🔴 다른 식으로 다시 만들지 말 것.
 * (JPEG 를 직접 풀지 않는 까닭은 이 저장소에 JPEG 해독기가 없기 때문이다.)
 * ============================================================================
 */

/** 측정 자료가 있는 자리. 다른 PC 에서는 환경변수로 가리킬 수 있다. */
const FIXTURE_DIR = process.env.NAMEPLATE_FIXTURE_DIR ?? "C:/DSS-AS-DATA/명판-시험/fixture";
const MANIFEST = path.join(FIXTURE_DIR, "manifest.json");

type FixtureItem = {
  file: string;
  lum: string;
  width: number;
  height: number;
  group: string;
  expect: string | null;
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

const items = readManifest();
const fixtureSkip = items
  ? false
  : `측정 자료가 없어 건너뜁니다: ${MANIFEST} (NAMEPLATE_FIXTURE_DIR 로 가리킬 수 있습니다)`;

/** 기대 성적 — 묶음마다 몇 장이 읽혀야 하는가. */
const EXPECTED_BY_GROUP: Record<string, { total: number; read: number }> = {
  "신양식-원본화질": { total: 4, read: 4 },
  "신양식-저화질": { total: 4, read: 1 },
  "구양식-QR없음": { total: 5, read: 0 },
  명판아님: { total: 1, read: 0 },
};

type Outcome = {
  item: FixtureItem;
  text: string | null;
  pass: 1 | 2 | null;
};

/** 열네 장을 한 번만 훑고 그 결과를 여러 시험이 나눠 본다(한 바퀴에 10초쯤). */
let outcomesPromise: Promise<Outcome[]> | null = null;

function readAll(): Promise<Outcome[]> {
  if (outcomesPromise) return outcomesPromise;
  outcomesPromise = (async () => {
    const decode = await createZxingNameplateDecoder();
    return (items as FixtureItem[]).map((item) => {
      const raw = fs.readFileSync(path.join(FIXTURE_DIR, item.lum));
      assert.equal(
        raw.byteLength,
        item.width * item.height,
        `${item.file}: .lum 의 크기가 manifest 의 가로×세로와 다르다`
      );
      const image = {
        data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength),
        width: item.width,
        height: item.height,
      };
      const found = scanNameplateLuminance(image, decode);
      return { item, text: found?.text ?? null, pass: found?.tile.pass ?? null };
    });
  })();
  return outcomesPromise;
}

describe("실물 명판 14장", () => {
  test("🔴 묶음별 성적이 기대 그대로다 — 합계 5/14", { skip: fixtureSkip }, async () => {
    const outcomes = await readAll();
    assert.equal(outcomes.length, 14, "측정 자료의 장수가 14가 아니다");

    const tally: Record<string, { total: number; read: number }> = {};
    for (const { item, text } of outcomes) {
      const bucket = (tally[item.group] ??= { total: 0, read: 0 });
      bucket.total += 1;
      if (text !== null) bucket.read += 1;
    }
    assert.deepEqual(tally, EXPECTED_BY_GROUP);
    assert.equal(outcomes.filter((o) => o.text !== null).length, 5);
  });

  test("🔴 읽은 장은 manifest 의 정답과 글자까지 같다", { skip: fixtureSkip }, async () => {
    const outcomes = await readAll();
    const wrong: string[] = [];
    for (const { item, text } of outcomes) {
      if (text !== item.expect) wrong.push(`${item.file}: 읽음=${text} 정답=${item.expect}`);
    }
    assert.deepEqual(wrong, []);
  });

  test("🔴 읽은 값이 세 칸으로 제대로 갈린다", { skip: fixtureSkip }, async () => {
    const outcomes = await readAll();
    for (const { item, text } of outcomes) {
      if (text === null) continue;
      assert.deepEqual(parseNameplateCode(text), {
        modelName: item.modelName,
        lotNumber: item.lotNumber,
        serialNumber: item.serialNumber,
      });
    }
  });

  test(
    "🔴 못 읽은 아홉 장에서 **엉뚱한 값이 나오지 않는다**",
    { skip: fixtureSkip },
    async () => {
      const outcomes = await readAll();
      const unreadable = outcomes.filter((o) => o.item.expect === null);
      assert.equal(unreadable.length, 9);
      const invented = unreadable.filter((o) => o.text !== null).map((o) => `${o.item.file}: ${o.text}`);
      assert.deepEqual(invented, [], "QR 이 없는(또는 못 읽는) 사진에서 값이 나왔다");
    }
  );

  test("원본 화질 넉 장은 전부 1차에서 풀린다", { skip: fixtureSkip }, async () => {
    const outcomes = await readAll();
    const original = outcomes.filter((o) => o.item.group === "신양식-원본화질");
    assert.deepEqual(
      original.map((o) => o.pass),
      [1, 1, 1, 1]
    );
  });

  test("🔴 저화질에서 읽히는 한 장은 2차(2배 확대)에서만 풀린다", { skip: fixtureSkip }, async () => {
    const outcomes = await readAll();
    const read = outcomes.filter((o) => o.item.group === "신양식-저화질" && o.text !== null);
    assert.equal(read.length, 1);
    assert.match(read[0].item.file, /093005331/);
    assert.equal(read[0].pass, 2, "2차를 걷어내면 이 장이 죽는다 — QR 이 65px 이다");
  });
});
