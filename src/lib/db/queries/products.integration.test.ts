import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { products } from "../schema";
import { findProductsBySerialNumber } from "./products";

/**
 * ============================================================================
 * S/N 으로 등록된 장비 찾기 — **한 대라고 가정하지 않는가**
 * ============================================================================
 * 이 조회는 명판을 글자로 읽을 때 쓴다. 세 칸 가운데 S/N 이 제일 잘 읽히니
 * 그 한 칸으로 장비를 찾아 Model·L/N 을 **보여 준다**(채우지는 않는다).
 *
 * 🔴 **S/N 은 고유키가 아니다.** 같은 S/N 에 다른 모델·다른 L/N 인 장비가
 * 실제로 있다(2026-10-02 개발 DB 확인):
 *
 *     2210294 → CFK200FH-IC3 / WV0097 · MBK200-JS2 / wv7615 · MBK300M-IC2 / WN4809
 *     2210149 → MBK200-JS2 / WV0097 · MBK200-JS2 / WN4040
 *
 * 그래서 이 함수는 **반드시 배열**을 돌려준다. `limit(1)` 을 걸거나 한 대로
 * 가정하면, 부르는 쪽이 둘 중 아무거나 집어 **남의 장비 값을 적게 된다.**
 *
 * 격리 규약: S/N 을 `ZZTEST` 로 시작하는 값만 쓰고, 끝나면 그 행만 지운다 —
 * 실제 자료의 S/N 과 겹칠 수 없는 모양이다.
 * ============================================================================
 */

const SERIAL_SHARED = "ZZTEST-9610001";
const SERIAL_ALONE = "ZZTEST-9610002";
const SERIAL_SPACED = "  ZZTEST-9610003  ";
const SERIAL_CASE = "zztest-9610004";
const SERIAL_DELETED = "ZZTEST-9610005";

const MADE_IDS: string[] = [];

async function insertProduct(values: {
  modelName: string;
  serialNumber: string;
  lotNumber: string | null;
  isDeleted?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      modelName: values.modelName,
      serialNumber: values.serialNumber,
      lotNumber: values.lotNumber,
      isDeleted: values.isDeleted ?? false,
    })
    .returning({ id: products.id });
  MADE_IDS.push(row.id);
  return row.id;
}

before(async () => {
  // 🔴 같은 S/N, 다른 모델, 다른 L/N — 우리 시험 표본에 실제로 있는 모양이다
  //    (1307006 → RFK150FHIC1/WZ6204 와 CFK150FHIC1/WZ6216).
  await insertProduct({
    modelName: "ZZTEST-RFK150FHIC1",
    serialNumber: SERIAL_SHARED,
    lotNumber: "WZ6204",
  });
  await insertProduct({
    modelName: "ZZTEST-CFK150FHIC1",
    serialNumber: SERIAL_SHARED,
    lotNumber: "WZ6216",
  });
  await insertProduct({
    modelName: "ZZTEST-CMK150M-IC2",
    serialNumber: SERIAL_ALONE,
    lotNumber: "WZ6243",
  });
  await insertProduct({
    modelName: "ZZTEST-SPACED",
    serialNumber: SERIAL_SPACED.trim(),
    lotNumber: null,
  });
  await insertProduct({
    modelName: "ZZTEST-CASE",
    serialNumber: SERIAL_CASE.toUpperCase(),
    lotNumber: "WN0001",
  });
  await insertProduct({
    modelName: "ZZTEST-DELETED",
    serialNumber: SERIAL_DELETED,
    lotNumber: "WN0002",
    isDeleted: true,
  });
});

after(async () => {
  if (MADE_IDS.length > 0) {
    await db.delete(products).where(inArray(products.id, MADE_IDS));
  }
  await pgClient.end();
});

describe("S/N 으로 등록된 장비 찾기", () => {
  test("🔴 같은 S/N 에 장비가 둘이면 **둘 다** 돌려준다 — 하나로 가정하지 않는다", async () => {
    const rows = await findProductsBySerialNumber(SERIAL_SHARED);
    assert.equal(rows.length, 2, "한 대로 줄여 버렸다 — 둘 중 하나는 남의 장비가 된다");
    assert.deepEqual(
      rows.map((row) => `${row.modelName}/${row.lotNumber}`).sort(),
      ["ZZTEST-CFK150FHIC1/WZ6216", "ZZTEST-RFK150FHIC1/WZ6204"]
    );
  });

  test("🔴 Model 과 L/N 이 **짝으로** 온다 — 섞이면 안 된다", async () => {
    const rows = await findProductsBySerialNumber(SERIAL_SHARED);
    const rfk = rows.find((row) => row.modelName === "ZZTEST-RFK150FHIC1");
    const cfk = rows.find((row) => row.modelName === "ZZTEST-CFK150FHIC1");
    assert.equal(rfk?.lotNumber, "WZ6204");
    assert.equal(cfk?.lotNumber, "WZ6216");
  });

  test("한 대뿐이면 한 줄만 온다", async () => {
    const rows = await findProductsBySerialNumber(SERIAL_ALONE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lotNumber, "WZ6243");
  });

  test("🔴 S/N 이 안 맞으면 **아무것도 안 가져온다**", async () => {
    assert.deepEqual(await findProductsBySerialNumber("ZZTEST-NO-SUCH-SERIAL"), []);
  });

  test("앞뒤 공백을 떼고 찾는다 — 글자 인식이 공백을 붙여 온다", async () => {
    const rows = await findProductsBySerialNumber(SERIAL_SPACED);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].modelName, "ZZTEST-SPACED");
  });

  test("대소문자를 가리지 않는다", async () => {
    const rows = await findProductsBySerialNumber(SERIAL_CASE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].modelName, "ZZTEST-CASE");
  });

  test("🔴 지워진 장비는 안 가져온다", async () => {
    assert.deepEqual(await findProductsBySerialNumber(SERIAL_DELETED), []);
  });

  test("🔴 빈 S/N 으로는 찾지 않는다 — S/N 없는 장비가 통째로 걸려 나온다", async () => {
    assert.deepEqual(await findProductsBySerialNumber(""), []);
    assert.deepEqual(await findProductsBySerialNumber("   "), []);
  });

  test("같은 입력이면 늘 같은 차례다", async () => {
    const once = (await findProductsBySerialNumber(SERIAL_SHARED)).map((row) => row.id);
    const twice = (await findProductsBySerialNumber(SERIAL_SHARED)).map((row) => row.id);
    assert.deepEqual(once, twice);
  });
});
