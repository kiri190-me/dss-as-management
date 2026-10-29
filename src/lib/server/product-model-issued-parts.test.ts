import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ISSUED_PART_LOOKUP_BUDGET_MS,
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
 *   ① **건수는 안 보고 시간으로 끊는다**(2026-10-29 사용자 결정으로 바뀐 자리 — 아래
 *      「①」 묶음의 머리말). 몇 건이든 다 묻되 전체 시간 예산이 다 되면 거기서 멈춘다.
 *      안 지키면 둘 중 하나다: 수리 건이 많은 모델에서 화면이 몇 분 동안 안 뜨거나,
 *      (옛 상한처럼) 저쪽이 멀쩡한 날에도 큰 모델의 반출을 통째로 버린다.
 *   ② **한 건이 실패해도 그 건만 빠진다.** 안 지키면 한 건의 시간 초과로 그래프가
 *      통째로 빈다.
 *   ③ **못 센 건 수가 밖으로 나온다.** 안 지키면 화면이 적은 수를 조용히 보여 주고,
 *      사람은 「이 모델은 이 부품이 적게 고장난다」는 **틀린 결론**을 낸다. 🔴 그 수는
 *      **둘**이다 — 시간이 모자라 못 물어본 건과, 물어봤는데 못 받아 온 건.
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
  /**
   * 🔴 **설계가 뒤집힌 자리다**(2026-10-29). 이 시험은 처음에 「🔴 상한이 동시 호출 수보다
   * 크고 둘 다 1 이상이다」였고, 거기서 재던 것은 `ceil(상한/동시) × 5초 ≤ 30초` 였다.
   * 사용자가 **건수 상한을 없애기로** 정하면서(「상한 없이 불러올 수 있도록 해줘」) 그
   * 식에 들어가던 수 자체가 사라졌다 — 지우지 않고 **새 설계를 지키도록** 고쳐 적는다.
   */
  test("🔴 예산은 **최악의 벽시계**이고, 보통 때는 절대 안 걸린다", () => {
    assert.ok(ISSUED_PART_LOOKUP_CONCURRENCY >= 1, "동시 호출 수가 0 이면 한 건도 안 돈다");
    /**
     * 🔴 **예산이 곧 최악의 벽시계다**(그 파일 머리말 ②) — 예산이 끝나면 날아가 있는
     * 호출을 기다리지 않고 바로 돌아가므로, 「저쪽이 죽어도 페이지가 이 시간 안에 뜬다」가
     * 그대로 이 값이다. 10초를 넘으면 사람은 화면이 멈춘 줄 안다.
     */
    assert.ok(
      ISSUED_PART_LOOKUP_BUDGET_MS <= 10_000,
      `예산 ${ISSUED_PART_LOOKUP_BUDGET_MS}ms — 저쪽이 죽은 날 페이지가 그만큼 늦게 뜬다`
    );
    /**
     * 🔴 **보통 때는 절대 안 걸려야 한다.** 재고 관리가 한 건에 0.2초쯤에 답한다는 전제로
     * (2026-10-29) 예산 안에 다 묻는 건수가 `(예산/200ms) × 동시 호출 수`다. 운영에서 본
     * 가장 큰 모델이 69건이었고 🔴 **그보다 큰 모델이 있을 수 있어**(재 본 적이 없다) 세
     * 배를 여유로 잡는다. 🔵 넘쳐도 화면이 눈에 보이게 말하므로 조용히 묻히지는 않는다.
     */
    const normallyAsked =
      Math.floor(ISSUED_PART_LOOKUP_BUDGET_MS / 200) * ISSUED_PART_LOOKUP_CONCURRENCY;
    assert.ok(
      normallyAsked >= 69 * 3,
      `보통 때 ${normallyAsked}건까지만 묻는다 — 운영 최대 69건의 세 배는 되어야 한다`
    );
  });
});

/**
 * ============================================================================
 * ① **건수 상한이 없다 — 대신 시간 예산으로 끊는다** (2026-10-29 사용자 결정)
 * ============================================================================
 * 🔴 **이 묶음의 설계가 통째로 뒤집혔다.** 전에는 `ISSUED_PART_LOOKUP_CASE_LIMIT = 40`
 * 이 있어 「🔴 상한을 넘으면 통로를 **한 번도** 두드리지 않고, 그 사실이 밖으로 나온다」·
 * 「🔴 상한에 **딱 맞으면 부른다** — 경계에서 조용히 꺼지면 안 된다」 둘을 재고 있었다.
 * 그 40은 운영에서 모델별 수리 건 수를 재 보지 못한 채 짐작으로 잡은 수였고, 2026-10-29
 * 운영에서 **69건짜리 모델**이 그 안내를 띄웠다. 사용자 말: 「상한 없이 불러올 수 있도록
 * 해줘.」 🔴 **옛 시험 이름을 위에 인용으로 남겨 둔다** — 지워 버리면 다음 사람이 「왜
 * 상한이 없지」에서 되돌린다.
 *
 * 🔵 예산 가지를 밟는 시험은 진짜 5초를 기다릴 수 없으므로 `budgetMs` 를 넘겨 쓴다(그
 *    문은 시험을 위해 열어 둔 것이다 — 운영 코드는 안 넘긴다).
 * ============================================================================
 */
describe("① 건수는 안 보고 시간으로 끊는다", () => {
  test("🔴 **옛 상한(40)의 곱절**을 줘도 한 건도 안 버린다", async () => {
    const total = 50;
    stubFetch((url) => ({ status: 200, json: issuedOnce(`AA0001${url.slice(-2)}`) }));

    const result = await fetchIssuedFaultPartRows(
      Array.from({ length: total }, (_, i) => fakeCase(i))
    );

    assert.equal(calls.length, total, "🔴 묻지 않고 버린 건이 있다");
    assert.equal(result.rows.length, total, "받은 줄을 다 안 담았다");
    assert.equal(result.timedOutCaseCount, 0, "보통 때(저쪽이 곧바로 답한다) 예산에 걸리면 안 된다");
    assert.equal(result.uncountedCaseCount, 0);
    assert.equal(result.timeBudgetMs, ISSUED_PART_LOOKUP_BUDGET_MS, "운영 예산이 아닌 값으로 돌았다");
  });

  test("🔴 예산이 다 되면 **거기서 멈춘다** — 새로 묻지도, 날아간 것을 기다리지도 않는다", async () => {
    const total = ISSUED_PART_LOOKUP_CONCURRENCY + 10;
    // 🔵 한 건도 예산 안에 못 돌아오게 한다 — 그래야 「멈춘 자리」가 첫 바퀴로 못 박힌다.
    const stub = stubFetch(() => ({ status: 200, json: issuedOnce("AA000111"), delayMs: 400 }));

    const startedAt = Date.now();
    const result = await fetchIssuedFaultPartRows(
      Array.from({ length: total }, (_, i) => fakeCase(i)),
      { budgetMs: 30 }
    );
    const elapsed = Date.now() - startedAt;

    assert.equal(
      calls.length,
      ISSUED_PART_LOOKUP_CONCURRENCY,
      `🔴 예산이 끝났는데 새 호출을 더 열었다(${calls.length}개)`
    );
    assert.equal(stub.maxInFlight(), ISSUED_PART_LOOKUP_CONCURRENCY);
    assert.ok(elapsed < 300, `🔴 날아간 호출이 돌아오기를 기다렸다 — ${elapsed}ms`);
    assert.deepEqual(result.rows, []);
    assert.equal(result.timedOutCaseCount, total, "못 물어본 건이 전부로 안 세어졌다");
    assert.equal(result.uncountedCaseCount, 0, "시간이 모자란 것은 「못 받아 왔다」가 아니다");
    assert.equal(result.timeBudgetMs, 30);

    /**
     * 🔴 **돌아간 뒤에도 더 묻지 않는다.** 위 `calls.length` 만 재면 이 울타리가 **공짜로
     * 통과한다** — 날아가 있는 호출이 돌아오기 전에는 다음 건을 집을 수가 없어서, 깃발을
     * 안 보더라도 그 순간의 수는 똑같다(2026-10-29 에 일부러 깨뜨려 확인했다). 포기한 뒤에도
     * 계속 두드리면 **아무도 안 읽는 답**을 받으려고 저쪽에 부하만 남긴다. 그래서 날아가
     * 있던 호출이 전부 끝난 뒤에 다시 센다.
     */
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      calls.length,
      ISSUED_PART_LOOKUP_CONCURRENCY,
      `🔴 돌아간 뒤에도 남은 건을 계속 두드렸다(${calls.length}개)`
    );
  });

  test("🔴 예산 전에 받은 것은 **그대로 세고**, 못 물어본 수가 맞는다", async () => {
    const slow = 5;
    const total = ISSUED_PART_LOOKUP_CONCURRENCY + slow;
    // 첫 바퀴(동시 호출 수만큼)만 곧바로 답하고, 그 뒤 건들은 예산보다 한참 늦다.
    stubFetch((url) => {
      const n = Number(url.slice(-2));
      return n < ISSUED_PART_LOOKUP_CONCURRENCY
        ? { status: 200, json: issuedOnce(`AA0001${String(n).padStart(2, "0")}`), delayMs: 1 }
        : { status: 200, json: issuedOnce("AA000999"), delayMs: 400 };
    });

    const result = await fetchIssuedFaultPartRows(
      Array.from({ length: total }, (_, i) => fakeCase(i)),
      { budgetMs: 60 }
    );

    assert.equal(
      result.rows.length,
      ISSUED_PART_LOOKUP_CONCURRENCY,
      "🔴 예산 전에 받아 둔 줄까지 버렸다"
    );
    assert.equal(result.timedOutCaseCount, slow, "못 물어본 수가 받은 수와 안 맞는다");
    assert.equal(result.uncountedCaseCount, 0);
    // 🔵 예산이 끼어들어도 담기는 차례는 **건 차례** 그대로다(④ 묶음과 같은 못).
    assert.deepEqual(
      result.rows.map((row) => row.repairCaseId),
      Array.from({ length: ISSUED_PART_LOOKUP_CONCURRENCY }, (_, i) => `case-${i}`)
    );
  });

  test("🔴 **못 받아 온 건과 못 물어본 건은 따로 센다** — 셋을 더하면 전체가 된다", async () => {
    const slow = 5;
    const total = ISSUED_PART_LOOKUP_CONCURRENCY + slow;
    stubFetch((url) => {
      const n = Number(url.slice(-2));
      if (n === 0) return { status: 503, json: {}, delayMs: 1 }; // 저쪽 통로가 닫혀 있다
      return n < ISSUED_PART_LOOKUP_CONCURRENCY
        ? { status: 200, json: issuedOnce(`AA0001${String(n).padStart(2, "0")}`), delayMs: 1 }
        : { status: 200, json: issuedOnce("AA000999"), delayMs: 400 };
    });

    const result = await fetchIssuedFaultPartRows(
      Array.from({ length: total }, (_, i) => fakeCase(i)),
      { budgetMs: 60 }
    );

    assert.equal(result.uncountedCaseCount, 1, "실패한 건이 「못 받아 왔다」로 안 세어졌다");
    assert.equal(
      result.timedOutCaseCount,
      slow,
      "🔴 실패한 건을 「못 물어봤다」로도 세면 같은 건이 두 번 세어진다"
    );
    // 🔴 센 건 + 못 받아 온 건 + 못 물어본 건 = 전체. 어느 하나가 새면 여기서 드러난다.
    assert.equal(
      new Set(result.rows.map((row) => row.repairCaseId)).size +
        result.uncountedCaseCount +
        result.timedOutCaseCount,
      total
    );
  });

  test("접수 건이 하나도 없으면 두드리지 않고, 할 말도 없다", async () => {
    stubFetch(() => ({ status: 200, json: issuedOnce("AA000111") }));

    const result = await fetchIssuedFaultPartRows([]);

    assert.equal(calls.length, 0);
    assert.deepEqual(result, {
      rows: [],
      uncountedCaseCount: 0,
      timedOutCaseCount: 0,
      timeBudgetMs: ISSUED_PART_LOOKUP_BUDGET_MS,
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
    assert.equal(result.timedOutCaseCount, 0, "예산 안에 다 물었는데 「못 물어봤다」가 섰다");
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
    // 🔵 한 바퀴가 10ms 라 세 바퀴를 돌아도 예산(5초) 근처에도 안 간다 — ① 때문에 일찍
    //    멈춰 버리면 아래 「다 두드렸나」가 먼저 깨져 그 사실이 드러난다.
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
