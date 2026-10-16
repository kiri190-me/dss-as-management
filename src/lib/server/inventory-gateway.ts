import "server-only";
import { EXTERNAL_INTAKE_NUMBER_RE } from "@/lib/api/intake-lookup";
import {
  inventoryUnreachableMessage,
  parseInventoryOhTemplateResponse,
  parseInventoryPartsResponse,
  parseInventoryStockRequestsResponse,
  type ChargeType,
  type InventoryOhTemplate,
  type InventoryPart,
  type InventoryResult,
  type InventoryStockRequest,
  type InventoryUnreachableReason,
} from "@/lib/domain/inventory-gateway";

/**
 * ============================================================================
 * 재고 관리를 부르는 자리 — `{INVENTORY_API_BASE_URL}/api/v1/…`
 * ============================================================================
 * 2026-10-15. 수리 건 상세의 「부품 요청」 칸이 쓰는 통로 전부가 여기 모인다.
 * 저쪽 저장소의 `src/lib/stock/intake-lookup.ts` · `src/lib/approval/as-users.ts` 와
 * **같은 모양**이다 — **시간 제한을 걸고, 실패를 삼켜 뜻 있는 결과로 바꾸고, 응답 모양을
 * 맞추는 자리를 한 곳으로 모은다.** 받아 온 것을 어떻게 읽는가는 전부
 * `src/lib/domain/inventory-gateway.ts`(순수)에 있고, 여기는 망과 설정만 다룬다.
 *
 * ── 🔴 실패는 전부 unreachable 이다 — 빈 목록으로 바꾸지 않는다 ───────────
 * 주소가 없든, 늦든, 401 이든, 본문을 못 읽든 전부 「못 받아 왔다」다. 어느 하나라도
 * `{ status: "ok", value: [] }` 로 바꾸면 화면이 **「재고에 부품이 하나도 없다」**고
 * 거짓말하고, 사람은 그 말을 믿고 같은 부품을 또 올리거나 전화를 건다. 그 갈림의 까닭은
 * 순수 쪽 머리말에 있다.
 *
 * ── 🔴 A/S 표에는 아무것도 쓰지 않는다 ───────────────────────────────────
 * 이 모듈은 A/S DB 를 한 줄도 건드리지 않는다. 올린 요청 번호(`requestKey`)도 저장하지
 * 않는다 — 그래서 되읽을 때는 **인수번호로** 묻는다(API.md 4-7절이 그 길을 낸 까닭이다).
 *
 * ── 🔴 읽기 토큰과 쓰기 토큰이 다르다 ────────────────────────────────────
 * 가르는 것은 주소가 아니라 **하는 일**이다. 같은 `/stock-requests` 라도 신청을 **만드는**
 * `POST` 는 쓰기 토큰, 상태를 **읽는** `GET` 은 읽기 토큰이다(API.md 1절). 섞으면 401 이다.
 * 그래서 토큰을 고르는 자리를 **아래 `tokenFor` 한 곳**에 두고, 통로마다 `token:` 을
 * 적어 넘긴다 — 두 벌로 적으면 언젠가 섞인다.
 * ============================================================================
 */

/**
 * 🔴 **환경변수를 읽는 자리는 이 파일뿐이다.** 이 저장소는 중앙 `env` 객체를 두지 않고
 * 설정마다 읽는 함수를 둔다(`src/lib/api/shared-token.ts` 와 같은 방식) — 부를 때마다
 * 읽으므로 시험이 `process.env` 를 갈아 끼울 수 있다.
 */
function baseUrl(): string {
  return (process.env.INVENTORY_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

type TokenKind = "read" | "write";

/** 🔴 읽기와 쓰기를 가르는 **유일한 자리**(머리말). */
function tokenFor(kind: TokenKind): string {
  return kind === "write"
    ? (process.env.INVENTORY_WRITE_TOKEN ?? "").trim()
    : (process.env.INVENTORY_API_TOKEN ?? "").trim();
}

/** 읽기는 화면을 여는 길목이라 짧게 끊는다. */
const READ_TIMEOUT_MS = 5000;
/**
 * 쓰기는 조금 더 기다린다. 🔵 끊겨도 **같은 `requestKey` 로 다시 보내면 두 번 서지 않으므로**
 * (API.md 4-4절) 기다리는 쪽의 위험이 작고, 여기서 끊기면 사람이 다시 눌러야 한다.
 */
const WRITE_TIMEOUT_MS = 10000;

type InventoryCall =
  | { ok: true; json: unknown }
  /** 못 받아 왔다 — 화면은 「없다」가 아니라 「모른다」로 그린다. */
  | { ok: false; kind: "unreachable"; reason: InventoryUnreachableReason }
  /** 보낸 값이 틀렸다(400). 사람에게 저쪽이 적어 준 까닭을 그대로 전한다. */
  | { ok: false; kind: "rejected"; message: string };

function errorMessageFrom(json: unknown): string {
  if (json && typeof json === "object") {
    const message = (json as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message.trim();
  }
  return "";
}

/**
 * 통로 하나를 두드린다. **부르는 통로 전부가 이 함수를 지난다.**
 *
 * 🔴 토큰이 없으면 **부르지 않는다**(`not_configured`). 토큰 없이 두드려 401 을 받는 것과
 *    설정이 빠진 것은 고치는 길이 다르다 — 앞은 값을 맞추는 일이고, 뒤는 값을 넣는 일이다.
 */
async function callInventory(
  path: string,
  options: { token: TokenKind; method?: "GET" | "POST"; body?: unknown; timeoutMs?: number }
): Promise<InventoryCall> {
  const base = baseUrl();
  const token = tokenFor(options.token);
  if (base === "" || token === "") return { ok: false, kind: "unreachable", reason: "not_configured" };

  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? READ_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: ctrl.signal,
      cache: "no-store",
    });

    if (res.status === 401) {
      console.error("[inventory] 토큰이 맞지 않습니다", { path, token: options.token });
      return { ok: false, kind: "unreachable", reason: "unauthorized" };
    }
    if (res.status === 503) {
      console.error("[inventory] 저쪽 통로가 닫혀 있습니다", { path });
      return { ok: false, kind: "unreachable", reason: "api_closed" };
    }
    if (res.status === 400) {
      const message = errorMessageFrom(await res.json().catch(() => null));
      console.error("[inventory] 보낸 값을 거절했습니다", { path, message });
      return { ok: false, kind: "rejected", message: message || "재고 관리가 요청을 받지 않았습니다." };
    }
    /**
     * 🔴 **그 밖의 4xx 도 까닭이 적혀 있으면 그 글자를 살린다**(2026-10-16). 거두는 통로는
     * 거절을 **셋으로 갈라** 각각 다른 말을 돌려준다 — 그런 신청이 없다 · 올린 사람이
     * 아니다 · 이미 대기가 아니다. 그 셋이 400 으로만 온다는 보장이 없고(404·403·409 가
     * 자연스럽다), 여기서 뭉개면 사람은 세 경우에 똑같이 「불러오지 못했습니다」만 본다.
     * 🔵 까닭이 없는 4xx(통로가 아직 안 열려 404 HTML 이 오는 경우가 그렇다)는 거절이 아니라
     *    **「못 받아 왔다」**로 접는다 — 고치는 길이 값을 맞추는 일이 아니라 통로를 여는 일이다.
     */
    if (res.status > 400 && res.status < 500) {
      const message = errorMessageFrom(await res.json().catch(() => null));
      console.error("[inventory] 응답", res.status, { path, message });
      if (message !== "") return { ok: false, kind: "rejected", message };
      return { ok: false, kind: "unreachable", reason: "error" };
    }
    if (!res.ok) {
      console.error("[inventory] 응답", res.status, { path });
      return { ok: false, kind: "unreachable", reason: "error" };
    }

    return { ok: true, json: await res.json() };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("[inventory] 실패:", path, aborted ? "시간 초과" : e instanceof Error ? e.message : e);
    return { ok: false, kind: "unreachable", reason: aborted ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 읽는 통로의 공통 마무리. 🔴 **못 읽은 본문도 「못 받아 왔다」**다 — 빈 목록으로 바꾸면
 * 화면이 「하나도 없다」고 거짓말한다(머리말). 읽기에서 400 이 오는 것은 우리 쪽 결함이라
 * 로그를 남기고 역시 「못 받아 왔다」로 접는다(사람에게 「없다」고 말하지 않는다).
 *
 * `parse` 는 **모양이 아니면 `null`** 을 돌려준다. 🔵 「없음」을 정상으로 돌려줘야 하는
 * 통로(O/H 템플릿)는 `null` 을 한 겹 싸서 넘긴다 — 그래야 「못 읽었다」와 섞이지 않는다.
 */
function finishRead<T>(call: InventoryCall, parse: (json: unknown) => T | null, label: string): InventoryResult<T> {
  if (!call.ok) {
    if (call.kind === "rejected") {
      console.error(`[inventory] ${label}: 읽기 요청이 거절되었습니다 —`, call.message);
      return { status: "unreachable", reason: "error" };
    }
    return { status: "unreachable", reason: call.reason };
  }
  const value = parse(call.json);
  if (value === null) {
    console.error(`[inventory] ${label}: 응답 모양을 읽지 못했습니다.`);
    return { status: "unreachable", reason: "error" };
  }
  return { status: "ok", value };
}

/**
 * 부품 목록 — `GET /api/v1/parts`
 *
 * 🔵 **통째로 받아 화면에서 거른다.** `q` 를 붙여 서버에서 찾는 길도 있지만(API.md 2절),
 *    쓰지 않는다:
 *     ① 부품이 **수백 개**라 한 번에 받아도 작다(저쪽이 쪽 나누기를 두지 않은 까닭이 그것이다).
 *     ② 글자를 칠 때마다 통로를 부르면 **한 글자에 왕복 한 번**이다 — 사내망이라도 느리고,
 *        지우고 다시 치는 동안 응답이 뒤섞여 **방금 지운 글자의 결과**가 떠 있는 일이 생긴다.
 *     ③ 거르는 규칙을 순수 함수로 두면(`filterInventoryParts`) 시험이 망 없이 덮는다.
 *    🔴 거르는 규칙은 저쪽 `q` 와 **같은 잣대**로 적어 두었다 — 언젠가 서버에서 찾는 쪽으로
 *    갈아타도 나오는 줄이 달라지지 않는다. 부품이 수천 개가 되는 날 그때 갈아타면 된다.
 */
export async function fetchInventoryParts(): Promise<InventoryResult<InventoryPart[]>> {
  const call = await callInventory("/api/v1/parts", { token: "read" });
  return finishRead(call, parseInventoryPartsResponse, "부품 목록");
}

/**
 * 이 장비의 O/H 부품 템플릿 — `GET /api/v1/oh-templates?modelId=…`
 *
 * 🔴 열쇠는 **A/S 의 `product_models.id`** 다(API.md 6-1절). 모델 이름으로는 찾지 않는다.
 * 🔴 **이어 둔 템플릿이 없으면 `value: null` 이고 오류가 아니다.** 「없다」와 「못 받아 왔다」를
 *    가르는 자리가 바로 여기다 — 뭉개면 저쪽이 꺼진 동안 화면이 「O/H 템플릿이 없는 기종」인
 *    척한다. 그래서 파서의 답을 `{ template }` 로 **싸서** `finishRead` 에 넘긴다.
 */
export async function fetchInventoryOhTemplate(
  modelId: string
): Promise<InventoryResult<InventoryOhTemplate | null>> {
  const call = await callInventory(`/api/v1/oh-templates?modelId=${encodeURIComponent(modelId)}`, { token: "read" });
  const boxed = finishRead(call, parseInventoryOhTemplateResponse, "O/H 템플릿");
  return boxed.status === "ok" ? { status: "ok", value: boxed.value.template } : boxed;
}

/**
 * 이 수리 건에 올라간 반출 신청 — `GET /api/v1/stock-requests?intake=…`
 *
 * 🔴 **인수번호로 묻는다.** A/S 는 재고에 관한 것을 제 표에 저장하지 않기로 했으므로
 *    요청 번호(`requestKey`)가 어디에도 남지 않는다 — 언제나 아는 값은 인수번호뿐이다
 *    (API.md 4-7절). 🔵 그 대신 **누가 올렸든** 그 건의 신청이 전부 온다(재고 관리 화면에서
 *    직접 올린 것까지). 그것이 「이 건에 무엇이 나갔나」를 보는 이 화면의 뜻이다.
 * 🔴 **읽기 토큰이다.** 올리는 `POST` 와 주소가 같아도 하는 일이 다르다.
 */
export async function fetchInventoryStockRequestsByIntake(
  intakeNumber: string
): Promise<InventoryResult<InventoryStockRequest[]>> {
  const n = intakeNumber.trim().toUpperCase();
  if (!EXTERNAL_INTAKE_NUMBER_RE.test(n)) {
    // 모양이 틀리면 저쪽이 400 으로 돌려보낸다. 두드리기 전에 가른다 — 🔴 그래도 「없다」로
    // 바꾸지는 않는다(모양이 틀린 건에 신청이 없다고 말할 근거가 없다).
    console.error("[inventory] 인수번호 모양이 아닙니다:", n);
    return { status: "unreachable", reason: "error" };
  }
  const call = await callInventory(`/api/v1/stock-requests?intake=${encodeURIComponent(n)}`, { token: "read" });
  return finishRead(call, parseInventoryStockRequestsResponse, "반출 신청 목록");
}

// ---------------------------------------------------------------------------
// 올리기 — `POST /api/v1/stock-requests` (🔴 여기만 쓰기 토큰이다)
// ---------------------------------------------------------------------------

export type CreateStockRequestInput = {
  /** 🔴 같은 값으로 두 번 부르면 신청이 두 번 서지 않는다(API.md 4-4절). 화면이 만들어 보낸다. */
  requestKey: string;
  intakeNumber: string;
  /** 🔴 `sub` 은 **포털 번호**다. 저쪽이 그 번호로 사람을 잇는다(API.md 4-5절). */
  requester: { sub: string; name: string };
  lines: { no: number; quantity: number; chargeType: ChargeType }[];
  reason?: string;
  note?: string;
};

export type CreateStockRequestOutcome =
  | {
      ok: true;
      /** 🔴 거짓이면 **같은 요청이 이미 올라가 있었다**. 사람에게 그렇게 말해 준다(두 번 선 것이 아니다). */
      created: boolean;
      id: string;
      statusLabel: string;
    }
  | { ok: false; message: string };

/**
 * 반출 신청을 올린다. 🔴 **실패를 성공처럼 보이게 하지 않는다** — 못 올렸으면 그 까닭을
 * 그대로 돌려준다. 수량은 한 개도 움직이지 않고 「확인 대기」 신청이 한 줄 설 뿐이며,
 * 재고 담당자가 [확인]을 눌러야 원장에 떨어진다(API.md 4절).
 */
export async function createInventoryStockRequest(
  input: CreateStockRequestInput
): Promise<CreateStockRequestOutcome> {
  const call = await callInventory("/api/v1/stock-requests", {
    token: "write",
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: {
      requestKey: input.requestKey,
      intakeNumber: input.intakeNumber,
      requester: { sub: input.requester.sub, name: input.requester.name },
      lines: input.lines,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.note ? { note: input.note } : {}),
    },
  });

  if (!call.ok) {
    return {
      ok: false,
      // 🔵 거절(400)은 저쪽이 한국어로 적어 준 까닭을 그대로, 못 받아 온 것은 순수 쪽의
      //    같은 말투로. 올리기 실패와 읽기 실패가 다른 말을 하면 같은 사고가 다른 일로 보인다.
      message: call.kind === "rejected" ? call.message : inventoryUnreachableMessage(call.reason),
    };
  }

  const json = call.json;
  if (!json || typeof json !== "object") {
    console.error("[inventory] 올리기 응답 모양을 읽지 못했습니다.");
    return { ok: false, message: "재고 관리의 응답을 읽지 못했습니다. 잠시 뒤 같은 화면에서 다시 눌러 주세요." };
  }
  const o = json as { created?: unknown; request?: unknown };
  const request = (o.request && typeof o.request === "object" ? o.request : {}) as { id?: unknown; status?: unknown };
  const status = (request.status && typeof request.status === "object" ? request.status : {}) as { label?: unknown };

  return {
    ok: true,
    created: o.created === true,
    id: typeof request.id === "string" ? request.id : "",
    statusLabel: typeof status.label === "string" ? status.label : "",
  };
}

// ---------------------------------------------------------------------------
// 거두기 — `POST /api/v1/stock-requests/cancel` (🔴 여기도 쓰기 토큰이다)
// ---------------------------------------------------------------------------

export type CancelStockRequestOutcome =
  | {
      ok: true;
      /** 🔵 거짓이면 **이미 거둬져 있었다** — 오류가 아니다(아래 머리말). */
      cancelled: boolean;
      /** 저쪽이 준 지금 상태 글자. 돌려주는 줄 모양은 상태 통로와 같다. */
      statusLabel: string;
    }
  | { ok: false; message: string };

/**
 * 올린 반출 신청을 거둔다.
 *
 * 🔴 **보내는 포털 번호는 부르는 쪽(서버 액션)이 세션에서 꺼낸 값이어야 한다.** 저쪽은 이
 *    번호로 「올린 사람 본인인가」를 가린다 — 화면이 적어 보낸 값을 그대로 실어 주면 남의
 *    신청을 거둘 수 있다. 이 함수는 받은 값을 그대로 보내므로, 그 울타리는 액션에 있다.
 *
 * 🔴 **거절 셋을 뭉개지 않는다.** 그런 신청이 없다 · 올린 사람이 아니다 · 이미 대기가
 *    아니다 — 저쪽이 각각 다른 말로 적어 보내고, 우리는 그 글자를 **그대로** 사람에게
 *    전한다(`callInventory` 의 4xx 갈래). 셋을 한 문장으로 접으면 「왜 안 되는지」가 사라져
 *    사람이 같은 단추를 계속 누른다.
 *
 * 🔵 **두 번 보내도 안전하다.** 이미 거둔 신청에 다시 보내면 오류가 아니라 「거둬져 있다」가
 *    온다(`cancelled: false`). 그래서 끊겼을 때 사람이 다시 눌러도 잃는 것이 없다.
 */
export async function cancelInventoryStockRequest(input: {
  requestKey: string;
  /** 🔴 **포털 번호**. 저쪽이 이 값으로 본인 여부를 가린다. */
  requesterSub: string;
}): Promise<CancelStockRequestOutcome> {
  const call = await callInventory("/api/v1/stock-requests/cancel", {
    token: "write",
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: { requestKey: input.requestKey, requester: { sub: input.requesterSub } },
  });

  if (!call.ok) {
    return {
      ok: false,
      message: call.kind === "rejected" ? call.message : inventoryUnreachableMessage(call.reason),
    };
  }

  const json = call.json;
  if (!json || typeof json !== "object") {
    console.error("[inventory] 거두기 응답 모양을 읽지 못했습니다.");
    return { ok: false, message: "재고 관리의 응답을 읽지 못했습니다. 목록을 새로고침해 지금 상태를 확인해 주세요." };
  }
  const o = json as { cancelled?: unknown; request?: unknown };
  const request = (o.request && typeof o.request === "object" ? o.request : {}) as { status?: unknown };
  const status = (request.status && typeof request.status === "object" ? request.status : {}) as { label?: unknown };

  return {
    ok: true,
    /**
     * 🔵 **빠져 있으면 「방금 거뒀다」로 본다.** 이 칸이 가르는 것은 말투 하나뿐이고(방금
     * 거뒀습니다 / 이미 거둬져 있었습니다), 둘 다 **거둬진 상태**라는 점은 같다. 올리는 쪽
     * (`created`)과 기본값이 반대인 까닭이 그것이다 — 거기서는 「이미 있었다」가 안전한 쪽,
     * 여기서는 흔한 쪽이 「방금 거뒀다」다. 어느 쪽이든 화면이 목록을 다시 읽어 **저쪽이
     * 적어 둔 지금 상태**를 보여 준다.
     */
    cancelled: o.cancelled !== false,
    statusLabel: typeof status.label === "string" ? status.label : "",
  };
}
