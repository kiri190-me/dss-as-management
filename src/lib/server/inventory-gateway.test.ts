import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  cancelInventoryStockRequest,
  createInventoryStockRequest,
  fetchInventoryOhTemplate,
  fetchInventoryParts,
  fetchInventoryStockRequestsByIntake,
  fillInventoryPartCustomerName,
  inventorySiteUrl,
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

/**
 * 사람을 저쪽으로 보낼 주소(2026-10-16). 🔴 **없으면 `null` 이다** — 부르는 쪽(재고 화면의
 * 안내 띠)이 그것을 보고 **링크 없이 글만** 그린다. 빈 글자를 돌려주면 `href=""` 가 되어
 * 눌렀을 때 같은 화면이 다시 뜬다(「고장났다」로 읽힌다).
 */
describe("사람이 여는 주소", () => {
  test("설정이 있으면 그 주소다 — 끝의 / 는 통로와 같은 규칙으로 떼어 낸다", () => {
    assert.equal(inventorySiteUrl(), BASE);

    process.env.INVENTORY_API_BASE_URL = `${BASE}/`;
    assert.equal(inventorySiteUrl(), BASE);

    process.env.INVENTORY_API_BASE_URL = `  ${BASE}///  `;
    assert.equal(inventorySiteUrl(), BASE);
  });

  test("🔴 설정이 비어 있으면 null — 없는 주소로 보내지 않는다", () => {
    process.env.INVENTORY_API_BASE_URL = "";
    assert.equal(inventorySiteUrl(), null);

    process.env.INVENTORY_API_BASE_URL = "   ";
    assert.equal(inventorySiteUrl(), null);
  });

  test("토큰과는 상관없다 — 통로가 막혀 있어도 사람은 저쪽 화면으로 갈 수 있다", () => {
    process.env.INVENTORY_API_TOKEN = "";
    process.env.INVENTORY_WRITE_TOKEN = "";
    assert.equal(inventorySiteUrl(), BASE);
  });
});

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

  /**
   * ==========================================================================
   * 🔴 **수리 건의 종류를 함께 싣는다** (2026-10-22)
   * ==========================================================================
   * 저쪽이 승인 절차를 **매쳐용·제너레이터용**으로 갈랐고, 어느 쪽을 붙일지는 이 값이
   * 정한다. 그래서 이 시험이 보는 것은 셋이다 —
   *  ㉠ **셋이 각각 제 글자로** 나간다(절차 이름으로 바꿔 보내지 않는다 — 짝 짓는 일은
   *     저쪽 몫이고, 저쪽이 짝을 바꾸는 날 이미 보낸 자료가 틀린 절차를 가리키면 안 된다).
   *  ㉡ **모르면 칸을 아예 안 보낸다.** `null` 이나 빈 글자를 보내면 저쪽은 「모름」이
   *     아니라 「값이 왔는데 이상하다」로 읽는다. 칸이 없어야 기존 「부품 불출」 절차로
   *     조용히 떨어진다.
   *  ㉢ 종류가 **본문 최상위**에 있다 — `requester` 안이나 줄 안이 아니다.
   * ==========================================================================
   */
  describe("🔴 수리 건의 종류", () => {
    const OK = { status: 201, json: { created: true, request: { id: "r1", status: { code: "PENDING", label: "대기" } } } };

    for (const kind of ["MATCHER", "GENERATOR", "TOTAL_CONTROLLER"] as const) {
      test(`㉠ ${kind} 는 **제 글자 그대로** 본문 최상위로 간다`, async () => {
        stubFetch(() => OK);

        await createInventoryStockRequest({ ...INPUT, workflowKind: kind });

        const body = calls[0].body as Record<string, unknown>;
        assert.equal(body.workflowKind, kind);
        // 🔴 절차 이름으로 둔갑하지 않았다.
        assert.doesNotMatch(JSON.stringify(body), /PART_ISSUE/);
      });
    }

    test("㉡ 🔴 모르면 **칸을 아예 안 보낸다** — `null` 도 빈 글자도 아니다", async () => {
      stubFetch(() => OK);

      await createInventoryStockRequest(INPUT);

      const body = calls[0].body as Record<string, unknown>;
      assert.ok(!("workflowKind" in body), "모르는데 칸을 보내고 있다");
      assert.deepEqual(body, {
        requestKey: "지어낸-요청번호",
        intakeNumber: "D260701",
        requester: { sub: "지어낸-포털번호", name: "홍길동" },
        lines: [{ no: 11, quantity: 2, chargeType: "PAID" }],
        note: "오후에 가져갑니다",
      });
    });

    test("㉢ 나머지 칸은 종류가 붙어도 그대로다", async () => {
      stubFetch(() => OK);

      await createInventoryStockRequest({ ...INPUT, workflowKind: "MATCHER" });

      assert.deepEqual(calls[0].body, {
        requestKey: "지어낸-요청번호",
        intakeNumber: "D260701",
        workflowKind: "MATCHER",
        requester: { sub: "지어낸-포털번호", name: "홍길동" },
        lines: [{ no: 11, quantity: 2, chargeType: "PAID" }],
        note: "오후에 가져갑니다",
      });
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

/**
 * ============================================================================
 * 거두기 — 🔴 **거절 셋을 뭉개지 않는다** (2026-10-16)
 * ============================================================================
 * 저쪽은 거절을 셋으로 갈라 **각각 다른 말**로 돌려준다 — 그런 신청이 없다 · 올린 사람이
 * 아니다 · 이미 대기가 아니다. 그 셋이 400 으로만 온다는 보장이 없어서(404·403·409 가
 * 자연스럽다) 이 시험이 **여러 4xx 에서** 문구가 살아 오는지를 잰다. 뭉개면 사람은 세 경우에
 * 똑같이 「불러오지 못했습니다」만 보고, 무엇을 고쳐야 하는지 알 수 없다.
 *
 * 🔵 **통로가 아직 안 열렸을 수도 있다**(받는 쪽을 지금 만들고 있다). 그때는 까닭 없는 404 나
 *    오류 페이지가 오고, 그 갈래는 **「못 받아 왔다」**로 정직하게 보여야 한다.
 * ============================================================================
 */
describe("거두기", () => {
  const CANCEL_INPUT = { requestKey: "지어낸-요청번호", requesterSub: "지어낸-포털번호" };
  const CANCELLED_BODY = {
    cancelled: true,
    request: { id: "r1", requestKey: "지어낸-요청번호", status: { code: "CANCELLED", label: "취소" }, closed: false },
  };

  test("🔴 쓰기 토큰으로 거두기 주소를 POST 한다 — 보내는 것은 열쇠와 포털 번호뿐", async () => {
    stubFetch(() => ({ status: 200, json: CANCELLED_BODY }));

    await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /\/api\/v1\/stock-requests\/cancel$/);
    assert.equal(calls[0].headers.Authorization, `Bearer ${WRITE_TOKEN}`);
    assert.notEqual(calls[0].headers.Authorization, `Bearer ${READ_TOKEN}`);
    assert.deepEqual(calls[0].body, {
      requestKey: "지어낸-요청번호",
      requester: { sub: "지어낸-포털번호" },
    });
  });

  test("거둬졌으면 저쪽이 준 상태 글자를 그대로 들고 온다", async () => {
    stubFetch(() => ({ status: 200, json: CANCELLED_BODY }));

    const result = await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.cancelled : null, true);
    assert.equal(result.ok ? result.statusLabel : null, "취소");
  });

  test("🔵 이미 거둬져 있던 것은 **오류가 아니다** — 두 번 보내도 안전하다", async () => {
    stubFetch(() => ({ status: 200, json: { ...CANCELLED_BODY, cancelled: false } }));

    const result = await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.cancelled : null, false);
  });

  for (const [status, message] of [
    [404, "그런 신청이 없습니다."],
    [403, "본인이 올린 신청만 거둘 수 있습니다."],
    [409, "이미 처리가 시작된 신청은 거둘 수 없습니다."],
    [400, "요청 번호를 확인할 수 없습니다."],
  ] as const) {
    test(`🔴 ${status} 로 거절당하면 저쪽 문구를 **그대로** 전한다 — 뭉개지 않는다`, async () => {
      stubFetch(() => ({ status, json: { error: "rejected", message } }));

      const result = await cancelInventoryStockRequest(CANCEL_INPUT);

      assert.equal(result.ok, false);
      assert.equal(result.ok ? null : result.message, message);
    });
  }

  test("🔵 까닭 없는 404(통로가 아직 안 열렸다)는 「못 받아 왔다」다 — 거절로 읽지 않는다", async () => {
    stubFetch(() => ({ status: 404, json: "<html>Not Found</html>" }));

    const result = await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.message, "재고 관리에서 불러오지 못했습니다.");
  });

  test("🔴 저쪽이 꺼져 있어도 거둬진 것처럼 보이지 않는다", async () => {
    stubFetch(() => ({ status: 500, json: {} }));

    const result = await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(result.ok, false);
    assert.ok((result.ok ? "" : result.message).length > 0);
  });

  test("🔴 응답 모양을 못 읽으면 성공으로 접지 않는다", async () => {
    stubFetch(() => ({ status: 200, json: "<html>오류</html>" }));

    const result = await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(result.ok, false);
  });

  test("쓰기 토큰이 없으면 두드리지도 않는다", async () => {
    process.env.INVENTORY_WRITE_TOKEN = "";
    stubFetch(() => ({ status: 200, json: CANCELLED_BODY }));

    const result = await cancelInventoryStockRequest(CANCEL_INPUT);

    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  test("시간 제한을 끊을 신호를 함께 보낸다", async () => {
    stubFetch(() => ({ status: 200, json: CANCELLED_BODY }));
    await cancelInventoryStockRequest(CANCEL_INPUT);
    assert.equal(calls[0].hasSignal, true);
  });
});

/**
 * ============================================================================
 * 🔴 고객사 품명 채우기 — **바깥이 재고 자료를 고치는 유일한 통로** (2026-10-16)
 * ============================================================================
 * 위 셋과 무게가 다르다. 신청을 세우고 거두는 것은 신청 표에 줄을 더하는 일이지만, 여기서는
 * **정본인 부품 표의 칸 하나**가 A/S 에서 들어온 글자로 바뀐다 — 그 값은 그대로 **고객사에
 * 나가는 서류**에 찍힌다. 그래서 여기서 재는 것이 넷이다:
 *
 *  ㉠ 🔴 **쓰기 토큰**이다(읽기 토큰으로 두드리면 저쪽이 401 이다).
 *  ㉡ 🔴 **보낸 글자를 다듬지도 자르지도 않는다** — 빈 값 · `-` 만 · 200자 초과를 저쪽이
 *     **각각 다른 말**로 거절하고, 우리는 그 문구를 **그대로** 전한다. 여기서 미리 재어 우리
 *     말로 바꾸면 자가 두 벌이 되고, 저쪽이 상한을 고치는 날 화면만 옛 규칙으로 막는다.
 *  ㉢ 🔴 **덮어쓰지 않는다** — 이미 있으면 오류가 아니라 `filled: false` 와 **지금 값**이 온다.
 *     그 값은 **우리가 보낸 값이 아니다**(저쪽 API.md 7-3절).
 *  ㉣ 🔴 **지금 값을 못 읽으면 「채웠습니다」라고 말하지 않는다** — 그 말은 정본을 바꿨다는
 *     주장이다. 화면은 그 값을 그 자리에 그려야 하는데, 없으면 「고객사 품명 없음」을 그린 채
 *     「채웠습니다」만 띄우게 된다.
 * ============================================================================
 */
describe("🔴 고객사 품명 채우기", () => {
  const FILL_INPUT = {
    no: 165,
    customerName: "지어낸 조립품",
    filledBy: { sub: "지어낸-포털번호", name: "홍길동" },
  };
  const FILLED_BODY = {
    filled: true,
    part: { no: 165, name: "지어낸-모델-A1", customerName: "지어낸 조립품" },
  };

  test("㉠ 🔴 **쓰기 토큰**으로 그 부품의 주소를 POST 한다 — 읽기 토큰이 아니다", async () => {
    stubFetch(() => ({ status: 200, json: FILLED_BODY }));

    await fillInventoryPartCustomerName(FILL_INPUT);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /\/api\/v1\/parts\/165\/customer-name$/);
    assert.equal(calls[0].headers.Authorization, `Bearer ${WRITE_TOKEN}`);
    assert.notEqual(calls[0].headers.Authorization, `Bearer ${READ_TOKEN}`);
    assert.equal(calls[0].hasSignal, true);
  });

  test("㉡ 저쪽이 받는 모양 그대로 보낸다 — 채울 이름과 **채운 사람** 둘뿐", async () => {
    stubFetch(() => ({ status: 200, json: FILLED_BODY }));

    await fillInventoryPartCustomerName(FILL_INPUT);

    assert.deepEqual(calls[0].body, {
      customerName: "지어낸 조립품",
      filledBy: { sub: "지어낸-포털번호", name: "홍길동" },
    });
  });

  test("㉡ 🔴 **다듬지도 자르지도 않는다** — 거르는 일은 저쪽 몫이다", async () => {
    stubFetch(() => ({ status: 400, json: { error: "bad_request", message: "customerName 이 비어 있습니다." } }));

    // 공백만 · `-` 만 · 아주 긴 글자 — 셋 다 **그대로** 나가야 한다.
    for (const raw of ["   ", "-", "가".repeat(250)]) {
      calls = [];
      await fillInventoryPartCustomerName({ ...FILL_INPUT, customerName: raw });
      assert.equal(
        (calls[0].body as { customerName: string }).customerName,
        raw,
        `'${raw.slice(0, 12)}' 를 손봐서 보냈다`
      );
    }
  });

  test("㉢ 채웠으면 **지금 값**과 부품 이름을 들고 온다", async () => {
    stubFetch(() => ({ status: 200, json: FILLED_BODY }));

    const result = await fillInventoryPartCustomerName(FILL_INPUT);

    assert.deepEqual(result, {
      ok: true,
      filled: true,
      no: 165,
      partName: "지어낸-모델-A1",
      customerName: "지어낸 조립품",
    });
  });

  test("㉢ 🔴 이미 있었으면 **오류가 아니고**, 돌려받는 것은 **먼저 적혀 있던 값**이다", async () => {
    // 🔴 우리가 보낸 값이 아니다 — 둘을 뒤섞으면 화면이 「채웠다」고 그려 놓고 다른 이름이 남는다.
    stubFetch(() => ({
      status: 200,
      json: { filled: false, part: { no: 165, name: "지어낸-모델-A1", customerName: "먼저 적혀 있던 이름" } },
    }));

    const result = await fillInventoryPartCustomerName(FILL_INPUT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.filled : null, false);
    assert.equal(result.ok ? result.customerName : null, "먼저 적혀 있던 이름");
  });

  test("㉣ 🔴 `filled` 가 빠져 있으면 **「채웠다」고 말하지 않는다**", async () => {
    // 거두기(`cancelled`)와 기본값이 반대다 — 거기서는 어느 쪽이든 거둬진 상태라 말투만
    // 갈렸지만, 여기서 「채웠습니다」는 **정본을 바꿨다는 주장**이다.
    stubFetch(() => ({ status: 200, json: { part: { no: 165, name: "지어낸-모델-A1", customerName: "어떤 이름" } } }));

    const result = await fillInventoryPartCustomerName(FILL_INPUT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.filled : null, false);
  });

  test("㉣ 🔴 지금 값을 못 읽으면 **성공으로 접지 않는다**", async () => {
    for (const json of [{ filled: true }, { filled: true, part: { no: 165, name: "x" } }, "<html>", null]) {
      stubFetch(() => ({ status: 200, json }));
      const result = await fillInventoryPartCustomerName(FILL_INPUT);
      assert.equal(result.ok, false, JSON.stringify(json));
    }
  });

  for (const [status, message] of [
    [400, "customerName 이 「-」 뿐입니다. 재고 관리에서 「-」 는 **없음**을 뜻하므로 값으로 받지 않습니다."],
    [400, "customerName 은 200자 이하여야 합니다 (받은 길이: 250). 잘라서 받지 않습니다 — 고객사에 나가는 이름입니다."],
    [404, "No. 999 부품이 없습니다. GET /api/v1/parts 의 no 를 보내십시오."],
    [410, "No. 86 는 숨긴(지운) 부품이라 고객사 품명을 채우지 않습니다. 재고 담당자에게 확인하십시오."],
  ] as const) {
    test(`㉡ 🔴 ${status} 로 거절당하면 저쪽 문구를 **그대로** 전한다 — 뭉개지 않는다`, async () => {
      // 🔴 없는 번호(404)와 숨긴 부품(410)은 **고치는 길이 다르다** — 앞은 번호를 고쳐 보내면
      //    되고 뒤는 재고 담당자에게 물어야 한다. 한 문장으로 접으면 가릴 길이 없다.
      stubFetch(() => ({ status, json: { error: "x", message } }));

      const result = await fillInventoryPartCustomerName({ ...FILL_INPUT, no: 999 });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? null : result.message, message);
    });
  }

  test("저쪽 통로가 닫혀 있으면(503) 「못 받아 왔다」 말투로 말한다", async () => {
    stubFetch(() => ({ status: 503, json: { error: "api_closed" } }));

    const result = await fillInventoryPartCustomerName(FILL_INPUT);

    assert.equal(result.ok, false);
    assert.equal(
      result.ok ? null : result.message,
      "재고 관리 쪽에서 통로가 닫혀 있습니다(저쪽 토큰이 설정되지 않았습니다)."
    );
  });

  test("🔴 저쪽이 꺼져 있어도 채워진 것처럼 보이지 않는다", async () => {
    stubFetch(() => ({ status: 500, json: {} }));

    const result = await fillInventoryPartCustomerName(FILL_INPUT);

    assert.equal(result.ok, false);
  });

  test("쓰기 토큰이 없으면 두드리지도 않는다", async () => {
    process.env.INVENTORY_WRITE_TOKEN = "";
    stubFetch(() => ({ status: 200, json: FILLED_BODY }));

    const result = await fillInventoryPartCustomerName(FILL_INPUT);

    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });
});
