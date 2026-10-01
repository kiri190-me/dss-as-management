import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  extractPassNumberCandidates,
  extractWrittenDates,
  readPassSlipNumber,
  writtenDateToYyMmDd,
} from "./pass-slip-number";

/**
 * ============================================================================
 * 통문번호 뽑기와 **날짜 검산**
 * ============================================================================
 * 못 박는 것 —
 *  1. 🔴 날짜가 맞아야만 `dateVerified` 가 참이다. 이 검산이 실제로 「글자 하나가
 *     끼어든」 오독을 잡아냈다(2026-10-01 측정). 숫자 열 개는 형식만으로 늘 통문
 *     번호처럼 보이기 때문에, 이것이 빠지면 틀린 값이 자신 있게 칸에 적힌다.
 *  2. 🔴 여러 개가 걸리면 **첫 번째**를 쓴다. 「날짜가 맞는 것을 고른다」로 바꾸면
 *     검산이 고르는 장치가 되어 더 이상 아무것도 걸러내지 못한다.
 *  3. 인식기가 끼워 넣는 공백(보통 공백 · 줄바꿈 없는 공백)에 걸려 넘어지지 않는다.
 *
 * ── 실제 통문증 14장 ────────────────────────────────────────────────────
 * 🔴 **사진과 정답은 저장소에 넣지 않는다**(고객 자료다). 측정 폴더가 이 PC 에
 * 있을 때만 그 글자를 읽어 14/14 를 다시 확인하고, 없으면 **건너뛴다는 사실이
 * 보이게** 넘어간다(다른 PC 에서 시험이 깨지면 안 된다).
 * ============================================================================
 */

/** 측정 자료가 있는 자리. 다른 PC 에서는 환경변수로 가리킬 수 있다. */
const FIXTURE_DIR = process.env.PASS_SLIP_FIXTURE_DIR ?? "C:/DSS-AS-DATA/통문증-시험";
const NODE_REF = path.join(FIXTURE_DIR, "browser", "node-ref.json");

type NodeRefItem = { caseNo: string; truePass: string; trueDate: string; text: string };

function readNodeRef(): NodeRefItem[] | null {
  try {
    if (!fs.existsSync(NODE_REF)) return null;
    const parsed = JSON.parse(fs.readFileSync(NODE_REF, "utf8")) as { items: NodeRefItem[] };
    return Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : null;
  } catch {
    return null;
  }
}

const nodeRef = readNodeRef();
const fixtureSkip = nodeRef
  ? false
  : `측정 자료가 없어 건너뜁니다: ${NODE_REF} (PASS_SLIP_FIXTURE_DIR 로 가리킬 수 있습니다)`;

describe("통문번호 뽑기", () => {
  test("영문 두 글자 + 숫자 열 개를 찾는다", () => {
    const reading = readPassSlipNumber("통문번호 : EP2601050152 작성일: 05-JAN-26");
    assert.equal(reading.passNumber, "EP2601050152");
  });

  test("글자와 숫자 사이의 공백 하나는 붙여 읽는다", () => {
    assert.deepEqual(extractPassNumberCandidates("S2HE : EP 2601050152 BE"), ["EP2601050152"]);
  });

  test("🔴 여러 개가 걸리면 첫 번째를 쓴다", () => {
    const reading = readPassSlipNumber("AB1234567890 그리고 EP2601050152");
    assert.equal(reading.passNumber, "AB1234567890");
  });

  test("없으면 null — 지어내지 않는다", () => {
    const reading = readPassSlipNumber("아무 번호도 없는 글자");
    assert.equal(reading.passNumber, null);
    assert.equal(reading.dateInNumber, null);
    assert.equal(reading.dateVerified, false);
  });

  test("숫자가 아홉 개나 열한 개면 통문번호가 아니다", () => {
    assert.deepEqual(extractPassNumberCandidates("EP260105015 EP26010501523"), []);
  });

  test("줄바꿈 없는 공백(U+00A0)이 끼어도 읽는다", () => {
    const reading = readPassSlipNumber("EP\u00a02601050152 · 05-JAN-26");
    assert.equal(reading.passNumber, "EP2601050152");
    assert.equal(reading.dateVerified, true);
  });
});

describe("통문작성일 읽기", () => {
  test("18-SEP-26 을 260918 로 바꾼다", () => {
    assert.equal(writtenDateToYyMmDd("18-SEP-26"), "260918");
  });

  test("달 이름이 아니면 null", () => {
    assert.equal(writtenDateToYyMmDd("18-XXX-26"), null);
  });

  test("구분자가 달라도(또는 없어도) 읽어 같은 꼴로 눕힌다", () => {
    assert.deepEqual(extractWrittenDates("05.JAN.26"), ["05-JAN-26"]);
    assert.deepEqual(extractWrittenDates("5 JAN 26"), ["05-JAN-26"]);
    assert.deepEqual(extractWrittenDates("05/JAN/26"), ["05-JAN-26"]);
  });

  test("같은 날짜가 여러 번 나와도 한 번만 담는다", () => {
    assert.deepEqual(extractWrittenDates("05-JAN-26 ... 05-JAN-26"), ["05-JAN-26"]);
  });
});

describe("🔴 날짜 검산", () => {
  test("통문번호 안의 YYMMDD 와 작성일이 같으면 통과", () => {
    const reading = readPassSlipNumber("EP2601050152 05-JAN-26");
    assert.equal(reading.dateInNumber, "260105");
    assert.equal(reading.dateVerified, true);
  });

  test("🔴 하루라도 다르면 통과하지 않는다 — 이것이 오독을 잡는 자리다", () => {
    const reading = readPassSlipNumber("EK2609110029 18-SEP-26");
    assert.equal(reading.passNumber, "EK2609110029");
    assert.equal(reading.dateVerified, false);
  });

  test("작성일을 아예 못 읽었으면 통과하지 않는다", () => {
    const reading = readPassSlipNumber("EP2601050152");
    assert.equal(reading.writtenDates.length, 0);
    assert.equal(reading.dateVerified, false);
  });

  test("작성일이 여러 개면 하나만 맞아도 통과한다", () => {
    const reading = readPassSlipNumber("EP2601050152 · 05-JAN-26 · 09-JAN-26");
    assert.equal(reading.dateVerified, true);
  });
});

describe("실제 통문증 14장 — 인식기가 읽은 글자로 다시 확인", () => {
  test(
    "🔴 통문번호 14/14 · 날짜 검산 14/14",
    { skip: fixtureSkip },
    () => {
      const items = nodeRef as NodeRefItem[];
      assert.equal(items.length, 14, "측정 자료의 장수가 14가 아니다");
      const wrong: string[] = [];
      const unverified: string[] = [];
      for (const item of items) {
        const reading = readPassSlipNumber(item.text);
        if (reading.passNumber !== item.truePass) {
          wrong.push(`${item.caseNo}: 읽음=${reading.passNumber} 정답=${item.truePass}`);
        }
        if (!reading.dateVerified) unverified.push(item.caseNo);
      }
      assert.deepEqual(wrong, [], "통문번호를 잘못 읽은 건이 있다");
      assert.deepEqual(unverified, [], "날짜 검산을 통과하지 못한 건이 있다");
    }
  );
});
