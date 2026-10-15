import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  createInventoryStockRequest,
  fetchInventoryOhTemplate,
  fetchInventoryParts,
  fetchInventoryStockRequestsByIntake,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 재고 관리를 부르는 자리 — 🔴 **실패를 삼키지 않는가** (2026-10-15)
 * ============================================================================
 * 이 파일이 지키는 것이 이 조각의 가장 큰 울타리다.
 *
 * 🔴 **못 받아 온 것을 빈 목록으로 바꾸면 화면이 거짓말을 한다.** 「재고에 부품이 하나도
 *    없다」 · 「이 건에 나간 부품이 없다」는 말은 사람이 그대로 믿고 행동하는 말이라, 주소가
 *    없든 늦든 401 이든 본문을 못 읽든 전부 **「못 받아 왔다」**로 와야 한다. 다섯 갈래를
 *    하나씩 재고, **어느 갈래도 `status: "ok"` 가 아니라는 것**을 확인한다.
 *
 * 🔴 **읽기 토큰과 쓰기 토큰을 섞으면 401 이다.** 주소가 같아도 하는 일이 다르므로, 실제로
 *    나간 `Authorization` 머리글을 붙잡아 GET 은 읽기 토큰, POST 는 쓰기 토큰인지 잰다.
 *
 * 망을 타지 않는다 — `globalThis.fetch` 를 갈아 끼운다. 환경변수도 이 파일 안에서만 바꾸고
 * 되돌린다(부를 때마다 읽으므로 갈아 끼울 수 있다).
 * ============================================================================
 */

const BASE = "http://inventory.test";
const READ_TOKEN = "지어낸-읽기-토큰-0123456789abcdef";
const WRITE_TOKEN = "지어낸-쓰기-토큰-fedcba9876543210";

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown; hasSignal: boolean };

let calls: FetchCall[] = [];
const realFetch = globalThis.fetch;
const realEnv = {
  base: process.env.INVENTORY_API_BASE_URL,
  read: process.env.INVENTORY_API_TOKEN,
  write: process.env.INVENTORY_WRITE_TOKEN,
};

/** 응답 하나를 돌려주는 가짜 통로. 본문이 글자면 JSON 으로 못 읽는 응답을 흉내 낸다. */
function stubFetch(responder: (call: FetchCall) => { status: number; json: unknown } | Promise<never>) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      hasSignal: init?.signal instanceof AbortSignal,
    };
    calls.push(call);
    const answer = responder(call);
    if (answer instanceof Promise) return answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => {
        if (typeof answer.json === "string") throw new SyntaxError("Unexpected token < in JSON");
        return answer.json;
      },
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  process.env.INVENTORY_API_BASE_URL = BASE;
  process.env.INVENTORY_API_TOKEN = READ_TOKEN;
  process.env.INVENTORY_WRITE_TOKEN = WRITE_TOKEN;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.INVENTORY_API_BASE_URL = realEnv.base ?? "";
  process.env.INVENTORY_API_TOKEN = realEnv.read ?? "";
  process.env.INVENTORY_WRITE_TOKEN = realEnv.write ?? "";
});

const PARTS_OK = { count: 1, parts: [{ no: 11, name: "AMP-TEST-A1", owner: { code: "DSS", label: "DSS" }, quantity: 3 }] };

describe("🔴 실패를 삼키지 않는다 — 다섯 갈래 전부 「못 받아 왔다」다", () => {
  test("주소가 없으면 부르지도 않는다 (not_configured)", async () => {
    process.env.INVENTORY_API_BASE_URL = "";
    stubFetch(() => ({ status: 200, json: PARTS_OK }));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "unreachable");
    assert.equal(result.status === "unreachable" ? result.reason : null, "not_configured");
    assert.equal(calls.length, 0, "주소도 없이 통로를 두드렸다");
  });

  test("토큰이 없으면 부르지도 않는다 (not_configured)", async () => {
    process.env.INVENTORY_API_TOKEN = "";
    stubFetch(() => ({ status: 200, json: PARTS_OK }));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "unreachable");
    assert.equal(calls.length, 0);
  });

  test("끊기면 (timeout)", async () => {
    // 시간 제한이 걸리면 `AbortError` 로 떨어진다. 5초를 실제로 기다리지 않고 그 갈래만 잰다 —
    // 제한이 **걸려 있는지**는 바로 아래 「신호를 함께 보낸다」가 본다.
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    stubFetch(() => Promise.reject(aborted));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "unreachable");
    assert.equal(result.status === "unreachable" ? result.reason : null, "timeout");
  });

  test("시간 제한을 끊을 신호를 함께 보낸다", async () => {
    stubFetch(() => ({ status: 200, json: PARTS_OK }));
    await fetchInventoryParts();
    assert.equal(calls[0].hasSignal, true, "신호가 없으면 시간 제한이 아무것도 끊지 못한다");
  });

  test("토큰이 틀리면 (unauthorized)", async () => {
    stubFetch(() => ({ status: 401, json: { error: "unauthorized" } }));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "unreachable");
    assert.equal(result.status === "unreachable" ? result.reason : null, "unauthorized");
  });

  test("저쪽이 통로를 닫았으면 (api_closed)", async () => {
    stubFetch(() => ({ status: 503, json: { error: "api_closed" } }));

    const result = await fetchInventoryParts();

    assert.equal(result.status === "unreachable" ? result.reason : null, "api_closed");
  });

  test("🔴 본문을 못 읽으면 (error) — 빈 목록이 아니다", async () => {
    // 오류 페이지(HTML)가 200 으로 돌아오는 일이 실제로 있다.
    stubFetch(() => ({ status: 200, json: "<html>오류</html>" }));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "unreachable");
    assert.equal(result.status === "unreachable" ? result.reason : null, "error");
  });

  test("🔴 모양이 아닌 JSON 도 (error) — 「하나도 없다」로 바꾸지 않는다", async () => {
    stubFetch(() => ({ status: 200, json: { 부품: [] } }));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "unreachable");
  });

  test("🔵 200 에 빈 목록이 온 것은 **사실**이다 — 이것만 ok 다", async () => {
    stubFetch(() => ({ status: 200, json: { count: 0, parts: [] } }));

    const result = await fetchInventoryParts();

    assert.equal(result.status, "ok");
    assert.deepEqual(result.status === "ok" ? result.value : null, []);
  });

  test("신청 목록도 같은 잣대다 — 못 받아 온 것을 「요청이 없다」로 바꾸지 않는다", async () => {
    stubFetch(() => ({ status: 500, json: {} }));

    const result = await fetchInventoryStockRequestsByIntake("D260701");

    assert.equal(result.status, "unreachable");
  });

  test("인수번호 모양이 틀리면 두드리지 않고, 그래도 「없다」로 바꾸지 않는다", async () => {
    stubFetch(() => ({ status: 200, json: { requests: [] } }));

    const result = await fetchInventoryStockRequestsByIntake("X26070");

    assert.equal(result.status, "unreachable");
    assert.equal(calls.length, 0);
  });
});

describe("O/H 템플릿 — 「없다」와 「못 받아 왔다」를 가른다", () => {
  test("🔵 이어 둔 템플릿이 없으면 value: null 이고 오류가 아니다", async () => {
    stubFetch(() => ({ status: 200, json: { modelId: "m", template: null } }));

    const result = await fetchInventoryOhTemplate("3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");

    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" ? result.value : undefined, null);
  });

  test("🔴 못 받아 온 것은 「템플릿이 없는 기종」이 아니다", async () => {
    stubFetch(() => ({ status: 401, json: { error: "unauthorized" } }));

    const result = await fetchInventoryOhTemplate("3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");

    assert.equal(result.status, "unreachable");
  });

  test("모델 id 로 묻는다", async () => {
    stubFetch(() => ({ status: 200, json: { template: null } }));
    await fetchInventoryOhTemplate("3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");
    assert.match(calls[0].url, /\/api\/v1\/oh-templates\?modelId=3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d$/);
  });
});

describe("🔴 읽기 토큰과 쓰기 토큰을 가른다", () => {
  test("읽는 통로 셋은 전부 **읽기 토큰**으로 간다", async () => {
    stubFetch((call) =>
      call.url.includes("oh-templates")
        ? { status: 200, json: { template: null } }
        : call.url.includes("stock-requests")
          ? { status: 200, json: { requests: [], notFound: [] } }
          : { status: 200, json: PARTS_OK }
    );

    await fetchInventoryParts();
    await fetchInventoryOhTemplate("3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");
    await fetchInventoryStockRequestsByIntake("D260701");

    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.method, "GET", call.url);
      assert.equal(call.headers.Authorization, `Bearer ${READ_TOKEN}`, call.url);
    }
  });

  test("올리는 통로 하나만 **쓰기 토큰**으로 간다", async () => {
    stubFetch(() => ({ status: 201, json: { created: true, request: { id: "r1", status: { code: "PENDING", label: "대기" } } } }));

    await createInventoryStockRequest({
      requestKey: "지어낸-요청번호",
      intakeNumber: "D260701",
      requester: { sub: "지어낸-포털번호", name: "홍길동" },
      lines: [{ no: 11, quantity: 2, chargeType: "PAID" }],
    });

    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.Authorization, `Bearer ${WRITE_TOKEN}`);
    assert.notEqual(calls[0].headers.Authorization, `Bearer ${READ_TOKEN}`);
  });

  test("🔴 올린 신청을 **읽는** GET 은 주소가 같아도 읽기 토큰이다", async () => {
    stubFetch(() => ({ status: 200, json: { requests: [], notFound: [] } }));

    await fetchInventoryStockRequestsByIntake("D260701");

    assert.match(calls[0].url, /\/api\/v1\/stock-requests\?intake=D260701$/);
    assert.equal(calls[0].headers.Authorization, `Bearer ${READ_TOKEN}`);
  });

  test("쓰기 토큰만 비어 있으면 올리기만 막힌다 — 읽기는 그대로 돈다", async () => {
    process.env.INVENTORY_WRITE_TOKEN = "";
    stubFetch(() => ({ status: 200, json: PARTS_OK }));

    const read = await fetchInventoryParts();
    const write = await createInventoryStockRequest({
      requestKey: "지어낸-요청번호",
      intakeNumber: "D260701",
      requester: { sub: "지어낸-포털번호", name: "홍길동" },
      lines: [{ no: 11, quantity: 1, chargeType: "FREE" }],
    });

    assert.equal(read.status, "ok");
    assert.equal(write.ok, false);
  });
});

describe("올리기", () => {
  const INPUT = {
    requestKey: "지어낸-요청번호",
    intakeNumber: "D260701",
    requester: { sub: "지어낸-포털번호", name: "홍길동" },
    lines: [{ no: 11, quantity: 2, chargeType: "PAID" as const }],
    note: "오후에 가져갑니다",
  };

  test("저쪽이 받는 모양 그대로 보낸다", async () => {
    stubFetch(() => ({ status: 201, json: { created: true, request: { id: "r1", status: { code: "PENDING", label: "대기" } } } }));

    await createInventoryStockRequest(INPUT);

    assert.deepEqual(calls[0].body, {
      requestKey: "지어낸-요청번호",
      intakeNumber: "D260701",
      requester: { sub: "지어낸-포털번호", name: "홍길동" },
      lines: [{ no: 11, quantity: 2, chargeType: "PAID" }],
      note: "오후에 가져갑니다",
    });
  });

  test("새로 섰으면 created: true", async () => {
    stubFetch(() => ({ status: 201, json: { created: true, request: { id: "r1", status: { code: "PENDING", label: "대기" } } } }));

    const result = await createInventoryStockRequest(INPUT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.created : null, true);
    assert.equal(result.ok ? result.statusLabel : null, "대기");
  });

  test("🔵 같은 요청 번호로 두 번 보내면 created: false — 오류가 아니다", async () => {
    stubFetch(() => ({ status: 200, json: { created: false, request: { id: "r1", status: { code: "PENDING", label: "대기" } } } }));

    const result = await createInventoryStockRequest(INPUT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.created : null, false);
  });

  test("🔴 거절당하면 저쪽이 적어 준 까닭을 그대로 전한다 — 올린 것처럼 보이지 않는다", async () => {
    stubFetch(() => ({ status: 400, json: { error: "bad_request", message: "숨긴 부품은 신청할 수 없습니다." } }));

    const result = await createInventoryStockRequest(INPUT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.message, "숨긴 부품은 신청할 수 없습니다.");
  });

  test("🔴 못 받아 와도 성공으로 보이지 않는다", async () => {
    stubFetch(() => ({ status: 500, json: {} }));

    const result = await createInventoryStockRequest(INPUT);

    assert.equal(result.ok, false);
    assert.ok((result.ok ? "" : result.message).length > 0);
  });
});
