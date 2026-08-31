import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { repairCaseIntakeSequences } from "../schema";
import { getNextIntakeNumberPreview } from "./intake-number-preview";

/**
 * ============================================================================
 * 접수 폼이 흐리게 보여 주는 "다음 인수번호" — 읽기만 하는가
 * ============================================================================
 * 확인하는 것은 다섯 가지다.
 *
 *  1. 그달에 접수가 하나도 없으면 01 부터다.
 *  2. 이미 쓴 만큼 다음 칸을 가리킨다(7 까지 썼으면 08).
 *  3. **🔴 불러도 채번되지 않는다.** 미리보기를 여는 것만으로 번호가 소모되면
 *     아무도 접수하지 않은 달에 구멍이 뚫린다 — 이 파일에서 가장 중요한 시험이다.
 *  4. 99 를 다 쓴 달은 null 이다. 제출할 수 없는 번호를 약속하지 않는다.
 *  5. 아직 날짜가 아닌 입력은 null 이다(사람이 타이핑하는 중).
 *
 * 격리 규약: 접수 월 "9610" 만 쓴다(실제 데이터가 닿을 수 없는 2096년 10월). 다른
 * 통합 시험이 쓰는 달과 겹치지 않는다 — 이 파일은 그 달의 시퀀스 행을 지우므로
 * 겹치면 남의 접수 번호를 되감는다.
 * ============================================================================
 */

const TEST_YEAR_MONTH = "9610";
const TEST_RECEIVED_AT = "2096-10-17";

async function setLastSequence(value: number) {
  await db
    .insert(repairCaseIntakeSequences)
    .values({ yearMonth: TEST_YEAR_MONTH, lastSequence: value })
    .onConflictDoUpdate({
      target: repairCaseIntakeSequences.yearMonth,
      set: { lastSequence: value },
    });
}

async function readSequenceRow() {
  const [row] = await db
    .select({ lastSequence: repairCaseIntakeSequences.lastSequence })
    .from(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  return row ?? null;
}

async function clearSequenceRow() {
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
}

before(async () => {
  await clearSequenceRow();
});

after(async () => {
  await clearSequenceRow();
  await pgClient.end({ timeout: 5 });
});

describe("getNextIntakeNumberPreview", () => {
  test("그달에 접수가 하나도 없으면 01 부터다", async () => {
    await clearSequenceRow();
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961001");
  });

  test("이미 쓴 만큼 다음 칸을 가리킨다", async () => {
    await setLastSequence(7);
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961008");
  });

  test("🔴 미리보기를 불러도 채번되지 않는다 — 행이 생기지도, 늘지도 않는다", async () => {
    await clearSequenceRow();

    // 행이 없는 달을 세 번 들여다본다. 조회가 채번을 겸했다면 여기서 행이
    // 생기고 값이 01 → 02 → 03 으로 밀린다.
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961001");
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961001");
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961001");
    assert.equal(await readSequenceRow(), null, "미리보기가 시퀀스 행을 만들었다");

    // 이미 있는 행도 건드리지 않는다.
    await setLastSequence(12);
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961013");
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), "D961013");
    assert.equal((await readSequenceRow())?.lastSequence, 12, "미리보기가 시퀀스를 올렸다");
  });

  test("99 를 다 쓴 달은 null — 제출할 수 없는 번호를 약속하지 않는다", async () => {
    await setLastSequence(99);
    assert.equal(await getNextIntakeNumberPreview(TEST_RECEIVED_AT), null);
  });

  test("아직 날짜가 아닌 입력은 null 이다", async () => {
    assert.equal(await getNextIntakeNumberPreview(""), null);
    assert.equal(await getNextIntakeNumberPreview("2096-1"), null);
    assert.equal(await getNextIntakeNumberPreview("2096-13-01"), null);
    assert.equal(await getNextIntakeNumberPreview("2096-10-32"), null);
  });
});
