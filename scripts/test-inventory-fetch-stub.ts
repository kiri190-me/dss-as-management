/**
 * ============================================================================
 * 🔴 시험이 **진짜 재고 관리를 부르지 않게** 막는 자리 (2026-10-28)
 * ============================================================================
 * 2026-10-28 부터 연락서 이식이 저장 직전에 재고 관리에 묻는다 — 「이 건에 부품 요청(반출)
 * 흔적이 있나」. 있으면 사용 부품을 한 줄도 안 넣고, **못 물어보면 이식 자체를 막는다**
 * (`src/lib/server/services/kyosan-report-import.ts`).
 *
 * ── 🔴 **왜 이 자리가 필요한가 — 실측으로 드러난 것** ─────────────────────
 * DB 시험은 `scripts/load-env` 로 `.env.local` 을 읽으므로 **재고 관리 주소와 토큰이 들어
 * 있다.** 그래서 막지 않으면 시험이 **옆 저장소의 개발 서버(3800)를 실제로 두드린다.**
 * 2026-10-28 실측에서 그 서버가 떠 있어서 모든 시험이 그냥 통과했는데, 그것은 **시험이
 * 맞아서가 아니라 옆집 서버가 켜져 있어서**였다 — 꺼 두면 전부 `INVENTORY_UNREACHABLE` 로
 * 떨어진다. 🔴 「남의 서버가 켜져 있으면 통과」하는 시험은 통과도 실패도 믿을 수 없다.
 *
 * ── 🔴 **무엇을 흉내 내고 무엇을 흉내 내지 않는가** ───────────────────────
 * 흉내 내는 것은 **통로의 응답 한 겹**뿐이다. 주소·토큰을 고르고 응답을 읽는 일은 그대로
 * 진짜 코드(`src/lib/server/inventory-gateway.ts`)가 한다 — 그래야 「읽기 토큰으로 묻는가」
 * 「못 받아 온 것을 빈 목록으로 바꾸지 않는가」가 시험에서도 **같은 길**로 지켜진다.
 *
 * 🔵 **재고 관리 주소가 아닌 요청은 진짜 `fetch` 로 보낸다.** 이 자리는 「바깥을 전부 막는
 *    덮개」가 아니다 — 다른 통로(포털 알림 따위)를 함께 막으면, 그 통로가 끊어진 날 이 덮개
 *    때문인지 코드 때문인지 가릴 수 없게 된다.
 * 🔴 **환경변수도 여기서 세운다.** `.env.local` 에 값이 없는 PC 에서도 같은 길로 돌아야
 *    하기 때문이다(값이 없으면 통로가 두드리지도 않고 「모른다」가 되어 시험이 갈린다).
 * ============================================================================
 */

/** 재고 관리가 이번에 무엇으로 답하는가. 🔴 셋 다 **실제로 일어나는 일**이다. */
export type InventoryStubAnswer =
  /** 200 + 신청 `count` 건. 🔵 0 이면 「이 건에 올라간 신청이 없다」는 **사실**이다. */
  | { kind: "requests"; count: number; statusCode?: string; statusLabel?: string }
  /** 저쪽이 멈췄거나 토큰이 안 맞는다 — 🔴 「없다」가 아니라 **「모른다」**로 와야 한다. */
  | { kind: "down"; httpStatus: number };

/** 🔵 기본값은 **「신청이 없다」**다 — 이식이 평소대로 도는 자리가 시험의 대부분이다. */
export const INVENTORY_STUB_NO_REQUESTS: InventoryStubAnswer = { kind: "requests", count: 0 };

const STUB_BASE_URL = "http://inventory.test.invalid";
const STUB_READ_TOKEN = "지어낸-읽기-토큰-시험용-0123456789";
const STUB_WRITE_TOKEN = "지어낸-쓰기-토큰-시험용-fedcba9876";

let answer: InventoryStubAnswer = INVENTORY_STUB_NO_REQUESTS;
/** 재고 관리로 나간 주소들(들어온 차례). 시험이 「인수번호로 물었는가」를 잰다. */
let stockRequestUrls: string[] = [];

export function setInventoryStubAnswer(next: InventoryStubAnswer): void {
  answer = next;
}

export function inventoryStubUrls(): readonly string[] {
  return stockRequestUrls;
}

function bodyFor(count: number, statusCode: string, statusLabel: string): unknown {
  return {
    count,
    requests: Array.from({ length: count }, (_value, index) => ({
      requestKey: `AS-TEST-STUB-${index + 1}`,
      id: `stub-request-${index + 1}`,
      intakeNumber: "D960901",
      status: { code: statusCode, label: statusLabel },
      closed: false,
      requestedAt: "2096-09-10T01:00:00.000Z",
      lines: [],
      decision: null,
      hold: null,
    })),
    notFound: [],
  };
}

/**
 * 덮개를 씌운다. 🔴 돌려주는 함수를 `after()` 에서 **반드시** 불러야 한다 — 안 그러면 같은
 * 프로세스에서 뒤에 도는 다른 시험 파일까지 가짜 `fetch` 를 쓴다.
 */
export function installInventoryFetchStub(): () => void {
  const realFetch = globalThis.fetch;
  const realEnv = {
    base: process.env.INVENTORY_API_BASE_URL,
    read: process.env.INVENTORY_API_TOKEN,
    write: process.env.INVENTORY_WRITE_TOKEN,
  };

  answer = INVENTORY_STUB_NO_REQUESTS;
  stockRequestUrls = [];
  process.env.INVENTORY_API_BASE_URL = STUB_BASE_URL;
  process.env.INVENTORY_API_TOKEN = STUB_READ_TOKEN;
  process.env.INVENTORY_WRITE_TOKEN = STUB_WRITE_TOKEN;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    // 🔵 재고 관리가 아닌 주소는 진짜로 보낸다(위 머리말).
    if (!url.startsWith(STUB_BASE_URL)) return realFetch(input as RequestInfo, init);
    stockRequestUrls.push(url);

    if (answer.kind === "down") {
      return {
        ok: false,
        status: answer.httpStatus,
        json: async () => ({}),
      } as unknown as Response;
    }
    const json = bodyFor(answer.count, answer.statusCode ?? "PENDING", answer.statusLabel ?? "확인 대기");
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = realFetch;
    process.env.INVENTORY_API_BASE_URL = realEnv.base ?? "";
    process.env.INVENTORY_API_TOKEN = realEnv.read ?? "";
    process.env.INVENTORY_WRITE_TOKEN = realEnv.write ?? "";
    answer = INVENTORY_STUB_NO_REQUESTS;
    stockRequestUrls = [];
  };
}
