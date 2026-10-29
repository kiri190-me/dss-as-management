import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ISSUED_PART_LOOKUP_CASE_LIMIT,
  ISSUED_PART_LOOKUP_CONCURRENCY,
  fetchIssuedFaultPartRows,
} from "./product-model-issued-parts";

/**
 * ============================================================================
 * [고장 부품] 그래프의 셋째 입력 — **안전장치 셋이 실제로 도는가** (2026-10-29)
 * ============================================================================
 * 이 모듈은 수리 건마다 재고 관리를 한 번씩 두드린다. 그래서 세 가지가 반드시 참이어야
 * 한다. 셋 다 **안 지켜도 오류가 안 나는** 종류라 시험이 유일한 울타리다:
 *
 *   ① **건수가 상한을 넘으면 아예 안 부른다.** 안 지키면 수리 건이 많은 모델에서 화면이
 *      몇 분 동안 안 뜬다 — 「느리다」는 신고로 오지 결함으로는 안 온다.
 *   ② **한 건이 실패해도 그 건만 빠진다.** 안 지키면 한 건의 시간 초과로 그래프가
 *      통째로 빈다.
 *   ③ **못 센 건 수가 밖으로 나온다.** 안 지키면 화면이 적은 수를 조용히 보여 주고,
 *      사람은 「이 모델은 이 부품이 적게 고장난다」는 **틀린 결론**을 낸다.
 *
 * 🔴 **동시 호출 수**도 여기서 잰다. 넘쳐도 아무 증상이 없다 — 재고 관리 쪽에 부하가
 *    몰릴 뿐이고 그것은 저쪽 로그에만 남는다.
 *
 * 망을 타지 않는다 — `globalThis.fetch` 를 갈아 끼운다(이웃 `inventory-gateway.test.ts`
 * 와 같은 방법). 🔴 **인수번호·품번은 전부 가짜다**(`D1000xx`·`AA0001xx`).
 * ============================================================================
 */

const BASE = "http://inventory.test";
const READ_TOKEN = "지어낸-읽기-토큰-0123456789abcdef";

const realFetch = globalThis.fetch;
const realEnv = {
  base: process.env.INVENTORY_API_BASE_URL,
  read: process.env.INVENTORY_API_TOKEN,
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  process.env.INVENTORY_API_BASE_URL = BASE;
  process.env.INVENTORY_API_TOKEN = READ_TOKEN;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.INVENTORY_API_BASE_URL = realEnv.base ?? "";
  process.env.INVENTORY_API_TOKEN = realEnv.read ?? "";
});

/** 🔴 모양은 `^D\d{6}$` 다(`EXTERNAL_INTAKE_NUMBER_RE`). 안 맞으면 두드리지도 않는다. */
function fakeCase(n: number): { id: string; intakeNumber: string } {
  return { id: `case-${n}`, intakeNumber: `D1000${String(n).padStart(2, "0")}` };
}

/** 그 건에 반출 신청 한 건이 있고, 줄 하나가 실제로 나갔다. */
function issuedOnce(drawingNo: string): unknown {
  return {
    requests: [
      {
        id: `req-${drawingNo}`,
        status: { code: "CONFIRMED", label: "확인됨" },
        lines: [{ no: 11, name: "FUSE 1A", drawingNo, quantity: 1, issued: 1 }],
      },
    ],
  };
}

/**
 * 응답을 주소별로 고르는 가짜 통로. `delayMs` 로 **끝나는 차례를 뒤집어** 볼 수 있다.
 * 🔵 `inFlight` 를 함께 세어 동시 호출 수를 잰다.
 */
function stubFetch(
  responder: (url: string) => { status: number; json: unknown; delayMs?: number }
): { maxInFlight: () => number } {
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const answer = responder(url);
    await new Promise((resolve) => setTimeout(resolve, answer.delayMs ?? 1));
    inFlight -= 1;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.json,
    } as unknown as Response;
  }) as typeof fetch;
  return { maxInFlight: () => maxInFlight };
}

describe("상수 자체 — 짝으로 읽어야 하는 수다", () => {
  test("🔴 상한이 동시 호출 수보다 크고 둘 다 1 이상이다", () => {
    assert.ok(ISSUED_PART_LOOKUP_CONCURRENCY >= 1, "동시 호출 수가 0 이면 한 건도 안 돈다");
    assert.ok(
      ISSUED_PART_LOOKUP_CASE_LIMIT >= ISSUED_PART_LOOKUP_CONCURRENCY,
      "상한이 동시 호출 수보다 작으면 일꾼이 놀기만 한다"
    );
    /**
     * 🔴 **최악이 몇 초인지로 상한을 정했다**(그 파일 머리말). 한 호출의 시간 제한이
     * 5초이므로 `ceil(상한/동시) × 5초` 가 최악이다. 그 값이 30초를 넘으면 상한만
     * 올리고 동시 호출 수를 안 올린 것이다 — 그때 화면은 「느리다」로만 신고된다.
     */
    const worstSeconds = Math.ceil(ISSUED_PART_LOOKUP_CASE_LIMIT / ISSUED_PART_LOOKUP_CONCURRENCY) * 5;
    assert.ok(worstSeconds <= 30, `최악 ${worstSeconds}초 — 상한과 동시 호출 수를 함께 보라`);
  });
});

describe("① 건수 상한 — 넘으면 아예 안 부른다", () => {
  test("🔴 상한을 넘으면 통로를 **한 번도** 두드리지 않고, 그 사실이 밖으로 나온다", async () => {
    const stub = stubFetch(() => ({ status: 200, json: issuedOnce("AA000111") }));
    const over = ISSUED_PART_LOOKUP_CASE_LIMIT + 1;

    const result = await fetchIssuedFaultPartRows(
      Array.from({ length: over }, (_, i) => fakeCase(i))
    );

    assert.equal(calls.length, 0, "🔴 상한을 넘었는데 통로를 두드렸다");
    assert.equal(stub.maxInFlight(), 0);
    assert.deepEqual(result.rows, []);
    assert.equal(result.skippedCaseCount, over, "몇 건이라 못 셌는지가 안 나온다");
    assert.equal(result.uncountedCaseCount, 0, "안 물어본 것은 「못 받아 온」 것이 아니다");
    assert.equal(result.caseLimit, ISSUED_PART_LOOKUP_CASE_LIMIT);
  });

  test("🔴 상한에 **딱 맞으면 부른다** — 경계에서 조용히 꺼지면 안 된다", async () => {
    stubFetch(() => ({ status: 200, json: issuedOnce("AA000111") }));

    const result = await fetchIssuedFaultPartRows(
      Array.from({ length: ISSUED_PART_LOOKUP_CASE_LIMIT }, (_, i) => fakeCase(i))
    );

    assert.equal(calls.length, ISSUED_PART_LOOKUP_CASE_LIMIT);
    assert.equal(result.skippedCaseCount, 0);
    assert.equal(result.rows.length, ISSUED_PART_LOOKUP_CASE_LIMIT);
  });

  test("접수 건이 하나도 없으면 두드리지 않고, 할 말도 없다", async () => {
    stubFetch(() => ({ status: 200, json: issuedOnce("AA000111") }));

    const result = await fetchIssuedFaultPartRows([]);

    assert.equal(calls.length, 0);
    assert.deepEqual(result, {
      rows: [],
      uncountedCaseCount: 0,
      skippedCaseCount: 0,
      caseLimit: ISSUED_PART_LOOKUP_CASE_LIMIT,
    });
  });
});

describe("② 한 건이 실패해도 그 건만 빠진다", () => {
  test("🔴 가운데 한 건이 못 받아 와도 나머지는 세고, 못 센 수가 1 늘어난다", async () => {
    stubFetch((url) =>
      url.includes("D100001")
        ? { status: 503, json: {} } // 저쪽 통로가 닫혀 있다 → unreachable
        : { status: 200, json: issuedOnce(url.includes("D100000") ? "AA000111" : "AA000333") }
    );

    const result = await fetchIssuedFaultPartRows([fakeCase(0), fakeCase(1), fakeCase(2)]);

    assert.equal(calls.length, 3, "실패한 건 때문에 나머지를 안 물어봤다");
    assert.equal(result.uncountedCaseCount, 1, "🔴 못 센 건이 1 로 안 세어졌다");
    assert.equal(result.skippedCaseCount, 0);
    assert.deepEqual(
      result.rows.map((row) => [row.repairCaseId, row.drawingNo]),
      [
        ["case-0", "AA000111"],
        ["case-2", "AA000333"],
      ],
      "🔴 실패한 건만 빠져야 한다"
    );
  });

  test("🔴 전부 못 받아 와도 그래프가 터지지 않는다 — 빈 줄 + 못 센 수 전부", async () => {
    stubFetch(() => ({ status: 500, json: {} }));

    const result = await fetchIssuedFaultPartRows([fakeCase(0), fakeCase(1)]);

    assert.deepEqual(result.rows, []);
    assert.equal(result.uncountedCaseCount, 2, "🔴 「없다」로 눕히면 여기가 0 이 된다");
  });

  test("🔴 응답 모양을 못 읽어도 「없다」가 아니라 「못 받아 왔다」다", async () => {
    // 200 인데 `requests` 가 없다 — 통로가 바뀌었거나 404 HTML 이 온 경우다.
    stubFetch(() => ({ status: 200, json: { ok: true } }));

    const result = await fetchIssuedFaultPartRows([fakeCase(0)]);

    assert.deepEqual(result.rows, []);
    assert.equal(result.uncountedCaseCount, 1);
  });

  test("🔵 빈 목록은 **「없다」**다 — 못 센 건으로 세지 않는다", async () => {
    stubFetch(() => ({ status: 200, json: { requests: [] } }));

    const result = await fetchIssuedFaultPartRows([fakeCase(0), fakeCase(1)]);

    assert.deepEqual(result.rows, []);
    assert.equal(result.uncountedCaseCount, 0, "🔴 「없다」를 「못 받아 왔다」로 세면 안 된다");
  });
});

describe("③ 인수번호로 묻고 건 id 를 붙인다", () => {
  test("🔴 주소에 그 건의 인수번호가 실린다 — 건마다 하나씩", async () => {
    stubFetch(() => ({ status: 200, json: { requests: [] } }));

    await fetchIssuedFaultPartRows([fakeCase(0), fakeCase(1)]);

    assert.deepEqual([...calls].sort(), [
      `${BASE}/api/v1/stock-requests?intake=D100000`,
      `${BASE}/api/v1/stock-requests?intake=D100001`,
    ]);
  });

  test("🔴 응답에 없는 repairCaseId 를 **부르는 쪽이** 붙인다", async () => {
    stubFetch((url) => ({
      status: 200,
      json: issuedOnce(url.includes("D100000") ? "AA000111" : "AA000222"),
    }));

    const result = await fetchIssuedFaultPartRows([fakeCase(0), fakeCase(1)]);

    assert.deepEqual(
      result.rows.map((row) => [row.repairCaseId, row.drawingNo]),
      [
        ["case-0", "AA000111"],
        ["case-1", "AA000222"],
      ]
    );
  });

  test("🔵 인수번호가 빈 건은 묻지 않고, **못 센 건으로도 안 센다**", async () => {
    stubFetch(() => ({ status: 200, json: issuedOnce("AA000111") }));

    const result = await fetchIssuedFaultPartRows([
      { id: "case-없음", intakeNumber: "   " },
      fakeCase(0),
    ]);

    assert.deepEqual(calls, [`${BASE}/api/v1/stock-requests?intake=D100000`]);
    assert.equal(result.uncountedCaseCount, 0, "물어볼 열쇠가 없는 것은 재고 관리의 잘못이 아니다");
    assert.deepEqual(
      result.rows.map((row) => row.repairCaseId),
      ["case-0"]
    );
  });

  test("🔴 인수번호 **모양이 틀린** 건은 다르다 — 두드리지 않지만 못 센 건으로 센다", async () => {
    stubFetch(() => ({ status: 200, json: issuedOnce("AA000111") }));

    const result = await fetchIssuedFaultPartRows([{ id: "case-옛", intakeNumber: "AS-2019-7" }]);

    assert.equal(calls.length, 0, "모양이 틀린 번호로 저쪽을 두드렸다");
    assert.equal(result.uncountedCaseCount, 1, "🔴 「그 건엔 반출이 없다」고 말할 근거가 없다");
    assert.deepEqual(result.rows, []);
  });

  test("줄이 여럿인 건은 여럿으로 — issued 가 0 인 줄은 여기까지 오지 않는다", async () => {
    stubFetch(() => ({
      status: 200,
      json: {
        requests: [
          {
            id: "req-1",
            status: { code: "PARTIAL", label: "일부 나감" },
            lines: [
              { no: 11, name: "FUSE 1A", drawingNo: "AA000111", quantity: 2, issued: 2 },
              { no: 12, name: "FUSE 2A", drawingNo: "AA000222", quantity: 3, issued: 0 },
            ],
          },
        ],
      },
    }));

    const result = await fetchIssuedFaultPartRows([fakeCase(0)]);

    assert.deepEqual(
      result.rows.map((row) => row.drawingNo),
      ["AA000111"]
    );
  });
});

describe("④ 동시에 쏟지 않는다 · 차례가 결정적이다", () => {
  test("🔴 같은 순간에 열리는 호출이 정해 둔 수를 넘지 않는다", async () => {
    const targetCount = ISSUED_PART_LOOKUP_CONCURRENCY * 2 + 3;
    assert.ok(
      targetCount <= ISSUED_PART_LOOKUP_CASE_LIMIT,
      "상한보다 적은 수로 재야 ① 때문에 공짜로 통과하지 않는다"
    );
    const stub = stubFetch(() => ({ status: 200, json: { requests: [] }, delayMs: 10 }));

    await fetchIssuedFaultPartRows(Array.from({ length: targetCount }, (_, i) => fakeCase(i)));

    assert.equal(calls.length, targetCount, "표본이 비면 아래가 공짜로 통과한다");
    assert.equal(
      stub.maxInFlight(),
      ISSUED_PART_LOOKUP_CONCURRENCY,
      `동시에 ${stub.maxInFlight()}개가 열렸다 — 한꺼번에 쏟거나 일꾼이 놀고 있다`
    );
  });

  test("🔴 늦게 물은 건이 먼저 돌아와도 줄 차례는 **건 차례**다", async () => {
    // 뒤 건일수록 빨리 돌아오게 한다 — 받은 차례로 이어 붙였다면 뒤집힌 배열이 나온다.
    stubFetch((url) => {
      const n = Number(url.slice(-2));
      return { status: 200, json: issuedOnce(`AA0001${String(n).padStart(2, "0")}`), delayMs: 30 - n * 10 };
    });

    const result = await fetchIssuedFaultPartRows([fakeCase(0), fakeCase(1), fakeCase(2)]);

    assert.deepEqual(
      result.rows.map((row) => row.repairCaseId),
      ["case-0", "case-1", "case-2"]
    );
    assert.deepEqual(
      result.rows.map((row) => row.drawingNo),
      ["AA000100", "AA000101", "AA000102"]
    );
  });
});
