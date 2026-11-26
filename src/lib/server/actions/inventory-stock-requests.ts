"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  getIntakeAndWorkflowKindForRepairCase,
  getReturnRequestCaseContext,
} from "@/lib/db/queries/repair-cases";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
import { isRepairCaseShipmentFinished } from "@/lib/domain/shipment-finished";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import {
  NO_PORTAL_ID_MESSAGE,
  STOCK_REQUEST_NOT_IN_CASE_MESSAGE,
  inventoryUnreachableMessage,
  isValidRequestKey,
  parseStockRequestLines,
  stockRequestKeyBelongsToCase,
} from "@/lib/domain/inventory-gateway";
import {
  RETURN_AFTER_SHIPMENT_MESSAGE,
  parseReturnRequestLines,
  type InventoryReturnCandidate,
} from "@/lib/domain/inventory-return";
import {
  cancelInventoryStockRequest,
  createInventoryReturnRequest,
  createInventoryStockRequest,
  fetchInventoryReturnCandidates,
  fetchInventoryStockRequestsByIntake,
  fillInventoryPartCustomerName,
} from "@/lib/server/inventory-gateway";

/**
 * ============================================================================
 * 재고 관리에 부품 반출 신청을 올린다 (2026-10-15)
 * ============================================================================
 * 🔴 **A/S 표에는 아무것도 쓰지 않는다.** 이 액션이 하는 일은 「누가·어느 건에서 올렸는가」를
 * 서버에서 확정해 재고 관리 통로를 부르는 것뿐이다. A/S 의 재고 표(`inventory_part_requests`
 * 등)는 2026-10-15 사용자 결정으로 운영에서 쓰이지 않고 있고, 다음 조각에서 통째로 걷어낸다.
 *
 * ── 🔴 화면이 보낸 값 가운데 믿는 것과 믿지 않는 것 ───────────────────────
 *  믿지 않는다 — **인수번호**(건 id 로 DB 에서 다시 읽는다) · **신청자**(세션에서 읽는다).
 *    브라우저가 적어 보내게 두면 남의 건에, 남의 이름으로 부품을 달아 놓을 수 있다.
 *  믿는다 — **요청 번호(`requestKey`)** 와 **담은 줄**. 요청 번호는 「같은 누름인가」를
 *    가리키는 값이라 **누른 쪽만 알 수 있고**(API.md 4-4절), 담은 줄은 사람이 고른 것이다.
 *    대신 줄의 모양은 화면과 **같은 함수**(`parseStockRequestLines`)로 여기서 다시 잰다 —
 *    화면 검사는 편의이지 울타리가 아니다.
 *
 * ── 🔴 권한을 여기서 직접 본다 ───────────────────────────────────────────
 * 옛 액션(`inventory-part-requests.ts`)은 인가를 전부 mutation 층에 맡겼다. 그 층이 이제
 * 없으므로(저장할 표가 없다) **이 파일이 마지막 울타리다.** 칸을 그릴지 정하는 자리와 같은
 * 축(`hasPermission(… "inventory.requests", "WRITE")`)으로 묻는다 — 역할 이름을 비교하지
 * 않는다(설정이 최종 판정인 메뉴다).
 *
 * ── 🔴 포털 번호가 없는 사람은 올리지 못한다 ─────────────────────────────
 * 저쪽은 **포털 번호(`sub`)로 사람을 잇는다**(API.md 4-5절). 포털로 한 번도 들어온 적 없는
 * 사람(A/S 로컬 계정)은 그 번호가 없어서, 올려 봐야 저쪽 화면에 「누구인지 모르는 신청」으로
 * 남는다. 조용히 보내지 않고 **까닭을 말하고 막는다.**
 *
 * ── 🔴 거두기(2026-10-16) — 울타리가 둘 더 있다 ─────────────────────────
 * 저쪽에 거두는 통로가 열려 [요청 취소]가 생겼다(`cancelInventoryStockRequestAction`).
 * 올리는 쪽과 같은 권한 축을 보고, 그 위에 **이 액션만 세울 수 있는 울타리 둘**을 더 세운다:
 *  ㉠ **포털 번호를 세션에서 꺼낸다.** 저쪽은 그 번호로 「올린 사람 본인인가」를 가리므로,
 *     화면이 적어 보낸 번호를 실어 주면 **남의 신청을 거둘 수 있다.** 그래서 거두기 액션은
 *     신청자를 **아예 받지 않는다**(받는 칸이 없으면 실수로 믿을 수도 없다).
 *  ㉡ **그 열쇠가 이 수리 건의 것인지 본다.** 거두는 통로는 `requestKey` 하나로 신청을 찾고
 *     수리 건을 받지 않는다 — 다른 건의 열쇠를 적어 보내면 저쪽은 (본인 것이고 대기라면)
 *     거둬 준다. 막을 수 있는 자리가 여기뿐이라, 이 건의 **인수번호로 신청 목록을 다시
 *     받아** 그 안에 있는 열쇠일 때만 거두러 간다. 🔴 목록을 **못 받아 왔으면 거두지 않는다** —
 *     확인하지 못한 것을 통과시키면 울타리가 없는 것과 같다.
 * ============================================================================
 */

export type CreateStockRequestActionResult =
  | {
      ok: true;
      /** 🔴 거짓이면 **같은 요청이 이미 올라가 있었다**(두 번 선 것이 아니다). 화면이 그렇게 말한다. */
      created: boolean;
      statusLabel: string;
    }
  | { ok: false; message: string };

/**
 * 🔴 `"use server"` 파일은 **async 함수 말고는 내보낼 수 없다.** 그래서 밖에서도 쓰는 글자
 * (`NO_PORTAL_ID_MESSAGE`)는 순수 모듈에 두고 여기서 불러 쓴다. 아래 둘은 이 파일 안에서만
 * 쓰이므로 내보내지 않는다.
 */
const NOT_LOGGED_IN = "로그인이 필요합니다.";
const NO_PERMISSION = "부품 요청을 올릴 권한이 없습니다.";
const NO_CANCEL_PERMISSION = "부품 요청을 거둘 권한이 없습니다.";
const NO_FILL_PERMISSION = "고객사 품명을 채울 권한이 없습니다.";
/** 🔴 **같은 권한 축**이다(`inventory.requests` 쓰기) — 말만 그 일에 맞게 갈아 적는다. */
const NO_RETURN_PERMISSION = "부품 반환을 요청할 권한이 없습니다.";
const CASE_NOT_FOUND = "이 수리 건을 찾을 수 없습니다.";

export async function createInventoryStockRequestAction(input: {
  repairCaseId: string;
  requestKey: string;
  lines: unknown;
  note?: string | null;
}): Promise<CreateStockRequestActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: NOT_LOGGED_IN };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: NOT_LOGGED_IN };
  if (!(await hasPermission(actingUser, "inventory.requests", "WRITE"))) {
    return { ok: false, message: NO_PERMISSION };
  }

  if (!isValidUuid(input.repairCaseId)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!isValidRequestKey(input.requestKey)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  /**
   * 🔴 인수번호**와 종류**는 **여기서 읽는다**(머리말). 화면이 보낸 값을 쓰지 않는다.
   * 🔵 둘을 **한 질의로** 받는다 — 종류를 따로 물으면 신청 한 번에 왕복이 둘이 된다
   *    (`getIntakeAndWorkflowKindForRepairCase` 머리말).
   */
  const repairCase = await getIntakeAndWorkflowKindForRepairCase(input.repairCaseId);
  if (!repairCase) {
    return { ok: false, message: CASE_NOT_FOUND };
  }

  // 🔴 화면과 **같은 함수**로 다시 잰다 — 유상/무상이 빠진 줄은 여기서도 막힌다.
  const parsed = parseStockRequestLines(input.lines);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const sub = await getSsoSubjectForUser(actingUser.id);
  if (!sub) return { ok: false, message: NO_PORTAL_ID_MESSAGE };

  return createInventoryStockRequest({
    requestKey: input.requestKey.trim(),
    intakeNumber: repairCase.intakeNumber,
    /**
     * 🔴 **종류 그대로** 싣는다(`MATCHER`·`GENERATOR`·`TOTAL_CONTROLLER`). 저쪽이 이 값으로
     * 승인 절차를 고른다(2026-10-22) — 절차 이름으로 바꿔 보내면 저쪽이 짝을 바꾸는 날
     * 이미 보낸 자료가 틀린 절차를 가리킨다.
     * 🔵 수리 건을 못 읽었으면 여기까지 오지 않는다(위에서 돌아갔다) — 「모르는데 보내는」
     *    길이 없다.
     */
    workflowKind: repairCase.workflowKind,
    requester: { sub, name: actingUser.name },
    lines: parsed.lines,
    note: input.note?.trim() ? input.note.trim() : undefined,
  });
}

export type CancelStockRequestActionResult =
  | {
      ok: true;
      /** 🔵 거짓이면 **이미 거둬져 있었다** — 오류가 아니다. 화면이 그렇게 말한다. */
      cancelled: boolean;
      statusLabel: string;
    }
  | { ok: false; message: string };

/**
 * 올린 반출 신청을 거둔다.
 *
 * 🔴 **신청자를 받지 않는다**(머리말 ㉠). 받는 칸 자체를 두지 않아야 언젠가 실수로 믿는 일이
 *    없다 — 포털 번호는 세션에서 꺼낸 것 하나뿐이다.
 * 🔴 **실패를 성공처럼 보이게 하지 않는다.** 저쪽이 거절한 까닭(없는 신청 · 본인 아님 ·
 *    대기 아님)은 **그 글자 그대로** 올라간다. 여기서 「취소하지 못했습니다」로 덮어쓰면
 *    사람은 무엇을 고쳐야 하는지 알 수 없다.
 */
export async function cancelInventoryStockRequestAction(input: {
  repairCaseId: string;
  requestKey: string;
}): Promise<CancelStockRequestActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: NOT_LOGGED_IN };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: NOT_LOGGED_IN };
  // 🔴 올리는 액션과 **같은 울타리**다(설정이 최종 판정인 메뉴다 — 역할 이름을 비교하지 않는다).
  if (!(await hasPermission(actingUser, "inventory.requests", "WRITE"))) {
    return { ok: false, message: NO_CANCEL_PERMISSION };
  }

  if (!isValidUuid(input.repairCaseId)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!isValidRequestKey(input.requestKey)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  // 🔵 올리는 쪽과 **같은 조회**다. 거두는 데 쓰는 것은 인수번호뿐이고(종류는 올릴 때만
  //    싣는다), 질의는 어차피 하나라 따로 두지 않는다.
  const repairCase = await getIntakeAndWorkflowKindForRepairCase(input.repairCaseId);
  if (!repairCase) {
    return { ok: false, message: CASE_NOT_FOUND };
  }

  // 🔴 포털 번호는 **세션의 사람**으로 읽는다(머리말 ㉠). 화면은 이 값을 보내지도 않는다.
  const sub = await getSsoSubjectForUser(actingUser.id);
  if (!sub) return { ok: false, message: NO_PORTAL_ID_MESSAGE };

  // 🔴 이 건의 신청인가(머리말 ㉡). 못 받아 왔으면 **거두지 않는다** — 확인하지 못한 것을
  //    통과시키면 다른 건의 열쇠가 그대로 지나간다.
  const requests = await fetchInventoryStockRequestsByIntake(repairCase.intakeNumber);
  if (requests.status !== "ok") {
    return {
      ok: false,
      message: `${inventoryUnreachableMessage(requests.reason)} 확인하지 못해 요청을 거두지 않았습니다 — 잠시 뒤 다시 눌러 주세요.`,
    };
  }
  if (!stockRequestKeyBelongsToCase(requests.value, input.requestKey)) {
    return { ok: false, message: STOCK_REQUEST_NOT_IN_CASE_MESSAGE };
  }

  return cancelInventoryStockRequest({ requestKey: input.requestKey.trim(), requesterSub: sub });
}

export type FillPartCustomerNameActionResult =
  | {
      ok: true;
      /** 🔴 거짓이면 **이미 적혀 있어서 안 바꿨다**(오류가 아니다). 화면이 다른 말로 말한다. */
      filled: boolean;
      no: number;
      partName: string;
      /** 🔴 **그 부품의 지금 값.** 화면은 이 값을 그 자리에 그린다 — 보낸 값이 아니다. */
      customerName: string;
    }
  | { ok: false; message: string };

/**
 * ============================================================================
 * 비어 있는 **고객사 품명을 그 자리에서 채운다** (2026-10-16 사용자 요청 E)
 * ============================================================================
 * 🔴 **이것은 A/S 가 재고 관리의 자료를 고치는 첫 자리다.** 위 둘은 신청 표에 줄을 세우고
 * 거둘 뿐이지만, 여기서는 **정본인 부품 표의 칸 하나**가 바뀐다. 그래서 세 가지를 지킨다 —
 *
 *  ㉠ **포털 번호는 세션에서 꺼낸다.** 저쪽 변경 이력에 「누가 채웠나」로 남는 값이라
 *     (API.md 7-5절) 화면이 적어 보낸 번호를 실어 주면 남의 이름으로 자료가 고쳐진다.
 *     그래서 이 액션도 거두기와 같이 **신청자를 받는 칸 자체가 없다.**
 *  ㉡ **내용 규칙을 여기서 다시 적지 않는다.** 빈 값 · 공백만 · `-` 만 · 200자 초과를 저쪽이
 *     **각각 다른 말**로 거절하고, 우리는 그 글자를 **그대로** 올린다. 여기서 미리 재어 우리
 *     말로 바꾸면 자가 두 벌이 되고, 저쪽이 상한을 고치는 날 화면만 옛 규칙으로 막는다.
 *     🔵 여기서 재는 것은 **모양**뿐이다 — 번호가 정수인가(주소에 박힌다), 글자가 글자인가.
 *  ㉢ **권한은 이 칸을 그리는 울타리와 같다**(`inventory.requests` 쓰기). 부품 요청 칸에
 *     들어올 수 있는 사람이 거기서 발견한 빈칸을 채우는 일이라 축이 같다.
 *
 * 🔵 **수리 건 id 를 받지 않는다.** 위 둘은 「이 건의 신청인가」를 재야 해서 받았지만, 부품은
 *    건에 매이지 않은 **공용 자료**다 — 받아 봐야 아무것도 가릴 수 없고, 받는 칸이 있으면
 *    언젠가 그것으로 뭔가를 가린다고 **착각**하게 된다.
 * ============================================================================
 */
export async function fillInventoryPartCustomerNameAction(input: {
  /** 재고 관리의 부품 번호. 🔴 주소에 박히므로 **정수인지 여기서 잰다.** */
  no: number;
  /** 🔴 사람이 친 글자 **그대로** 저쪽으로 간다(머리말 ㉡). */
  customerName: string;
}): Promise<FillPartCustomerNameActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: NOT_LOGGED_IN };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: NOT_LOGGED_IN };
  // 🔴 올리는 액션과 **같은 울타리**다(머리말 ㉢).
  if (!(await hasPermission(actingUser, "inventory.requests", "WRITE"))) {
    return { ok: false, message: NO_FILL_PERMISSION };
  }

  if (!Number.isInteger(input.no) || input.no < 1) {
    return { ok: false, message: "재고 관리의 부품 번호를 확인할 수 없습니다." };
  }
  if (typeof input.customerName !== "string") {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  // 🔴 포털 번호는 **세션의 사람**으로 읽는다(머리말 ㉠).
  const sub = await getSsoSubjectForUser(actingUser.id);
  if (!sub) return { ok: false, message: NO_PORTAL_ID_MESSAGE };

  return fillInventoryPartCustomerName({
    no: input.no,
    customerName: input.customerName,
    filledBy: { sub, name: actingUser.name },
  });
}

/**
 * ============================================================================
 * 부품 **반환** — 돌려줄 수 있는 것 묻기 · 반환 신청 올리기 (2026-11-26)
 * ============================================================================
 * 쓰는 분의 말: 「이미 불출된 적 있는 부품에 한해 반환 요청을 할 수 있도록 … **출하 완료**
 * 처리되면 [반환 요청] 버튼을 누를 수 없도록.」
 *
 * ── 🔴 울타리가 위 셋과 같고, **하나 더 있다** ───────────────────────────
 *  ㉠ **권한 축이 같다**(`inventory.requests` 쓰기). 🔴 **새 권한 이름을 만들지 않았다** —
 *     만들면 운영 DB 에 등록해야 하고, 등록 전까지는 아무도 못 쓴다. 부품을 받아 간 사람이
 *     그것을 돌려주는 일이라 축이 같은 것이 뜻으로도 맞다.
 *  ㉡ **인수번호를 서버가 읽는다.** 반환은 「이 인수번호로 나간 줄」을 찾아 되돌려 붙이므로
 *     (저쪽 API.md 4-11절), 브라우저가 적어 보내게 두면 **남의 건에서 나간 부품을 이 건으로
 *     돌려주는** 신청이 선다.
 *  ㉢ **포털 번호를 세션에서 꺼낸다.** 그래서 이 액션들도 신청자를 **받는 칸이 없다.**
 *  ㉣ 🔴 **출하 완료면 거절한다 — 화면만이 아니라 여기서도.** 화면은 단추를 잠그지만 그것은
 *     편의이고, 서버 액션은 브라우저가 부르는 통로라 잠긴 단추를 지나쳐 들어올 수 있다.
 *     🔴 **판정을 여기 다시 적지 않는다** — 경보 넷과 같은 함수(`isRepairCaseShipmentFinished`)
 *     를 그대로 부른다. 두 벌로 적으면 어느 날 화면과 서버가 다른 건을 「끝난 건」이라 부른다.
 *     🔵 **반출 신청은 막지 않는다**(위 `createInventoryStockRequestAction` 에는 이 울타리가
 *     없다) — 나간 뒤에 부품이 더 필요한 일은 실제로 있고, 막아 달라고 한 것은 반환뿐이다.
 *
 * ── 🔴 「돌려줄 수 있는 수」를 서버가 세지 않는다 ─────────────────────────
 * 그 수(`remaining`)는 **재고 관리에만 있다** — 이미 얼마가 돌아왔는지는 저쪽 원장의 일이다.
 * 여기서 `taken − returned` 를 다시 빼면 **올려 둔 신청(`pending`)이 빠지지 않아** 같은 부품을
 * 한 번 더 돌려주는 신청이 선다(API.md 8-4절). 그래서 묻는 통로를 그대로 지나 보내고, 넘치는
 * 줄은 저쪽이 **「N개까지 돌려줄 수 있습니다」**로 거절한다 — 🔴 그 문구를 **그대로** 올린다.
 * ============================================================================
 */

export type ReturnCandidatesActionResult =
  | { ok: true; candidates: InventoryReturnCandidate[] }
  | {
      ok: false;
      /**
       * 🔴 **참이면 「없다」가 아니라 「확인하지 못했다」**다. 화면이 그 둘을 다른 말로 그려야
       * 한다 — 빈 목록으로 뭉개면 「이 건에서 돌려줄 부품이 없다」고 거짓말하고, 사람은 그
       * 말을 믿고 부품을 그냥 들고 있는다(이 저장소가 재고 통로 전부에 거는 그 규율).
       */
      unreachable: boolean;
      message: string;
    };

/**
 * 이 수리 건에서 **무엇을 얼마나 돌려줄 수 있나** — 창을 열 때 한 번 묻는다.
 *
 * 🔵 **화면을 그릴 때가 아니라 창을 열 때 묻는 까닭** 둘: ① 수리 건 상세를 여는 모든 사람에게
 *    통로를 한 번 더 두드리게 할 까닭이 없다(이 창을 여는 일은 드물다) ② 🔴 **`remaining` 은
 *    금방 낡는다** — 올리기 직전에 받은 수일수록 헛걸음이 적다.
 * 🔴 **읽기인데도 권한을 묻는 까닭**: 이 응답에는 그 건에서 **무엇이 얼마나 나갔는지**가 들어
 *    있다. 부품 요청 칸을 볼 수 없는 사람에게 같은 사실을 다른 문으로 내주지 않는다.
 */
export async function loadInventoryReturnCandidatesAction(input: {
  repairCaseId: string;
}): Promise<ReturnCandidatesActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, unreachable: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, unreachable: false, message: NOT_LOGGED_IN };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, unreachable: false, message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, unreachable: false, message: NOT_LOGGED_IN };
  // 🔴 올리는 액션과 **같은 울타리**다(머리말 ㉠).
  if (!(await hasPermission(actingUser, "inventory.requests", "WRITE"))) {
    return { ok: false, unreachable: false, message: NO_RETURN_PERMISSION };
  }

  if (!isValidUuid(input.repairCaseId)) {
    return { ok: false, unreachable: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  // 🔴 인수번호와 출하 사실을 **여기서 읽는다**(머리말 ㉡㉣). 화면이 보낸 값을 쓰지 않는다.
  const repairCase = await getReturnRequestCaseContext(input.repairCaseId);
  if (!repairCase) {
    return { ok: false, unreachable: false, message: CASE_NOT_FOUND };
  }
  /* 🔵 **읽는 길에도 같은 울타리를 세운다** — 단추가 잠겨 있어 여기까지 올 일이 없지만, 막는
     까닭을 묻는 쪽마다 다르게 적어 두면 어느 날 한쪽만 고쳐진다(그 글자도 한 곳에 있다). */
  if (isRepairCaseShipmentFinished(repairCase)) {
    return { ok: false, unreachable: false, message: RETURN_AFTER_SHIPMENT_MESSAGE };
  }

  const candidates = await fetchInventoryReturnCandidates(repairCase.intakeNumber);
  if (candidates.status !== "ok") {
    // 🔴 「없다」로 접지 않는다 — 화면이 「확인하지 못했다」로 그린다(위 타입 주석).
    return { ok: false, unreachable: true, message: inventoryUnreachableMessage(candidates.reason) };
  }
  return { ok: true, candidates: candidates.value };
}

export type CreateReturnRequestActionResult =
  | {
      ok: true;
      /** 🔴 거짓이면 **같은 요청이 이미 올라가 있었다**(두 번 선 것이 아니다). */
      created: boolean;
      statusLabel: string;
    }
  | { ok: false; message: string };

/**
 * 부품 **반환**을 신청한다 — 창에서 수량을 적고 누른 뒤에만 여기 온다.
 *
 * 🔴 **줄의 모양을 화면과 같은 함수로 다시 잰다**(`parseReturnRequestLines`). 화면 검사는
 *    편의이지 울타리가 아니다 — 🔵 다만 「남은 수를 넘겼는가」는 **그 함수가 보지 않는다**:
 *    서버는 그 수를 모르고, 아는 체하면 통로를 한 번 더 두드려야 하며 그렇게 받은 수도 보내는
 *    순간 이미 옛것이다(머리말). 넘치는 줄은 저쪽이 거절하고 그 문구가 그대로 올라간다.
 * 🔴 **유상/무상도 사유도 싣지 않는다** — 받는 칸 자체가 없다(순수 쪽 `ReturnRequestLine`).
 */
export async function createInventoryReturnRequestAction(input: {
  repairCaseId: string;
  requestKey: string;
  lines: unknown;
  note?: string | null;
}): Promise<CreateReturnRequestActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: NOT_LOGGED_IN };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: NOT_LOGGED_IN };
  // 🔴 올리는 액션과 **같은 울타리**다(머리말 ㉠ — 새 권한 이름을 만들지 않았다).
  if (!(await hasPermission(actingUser, "inventory.requests", "WRITE"))) {
    return { ok: false, message: NO_RETURN_PERMISSION };
  }

  if (!isValidUuid(input.repairCaseId)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!isValidRequestKey(input.requestKey)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  // 🔴 인수번호와 출하 사실을 **여기서 읽는다**(머리말 ㉡㉣).
  const repairCase = await getReturnRequestCaseContext(input.repairCaseId);
  if (!repairCase) {
    return { ok: false, message: CASE_NOT_FOUND };
  }
  /* 🔴 **여기가 「출하 완료면 못 올린다」가 지켜지는 자리다.** 화면의 잠긴 단추는 편의이고,
     이 액션은 브라우저가 부르는 통로라 그 단추를 지나쳐 들어올 수 있다. 판정은 경보 넷과
     **같은 함수**이고, 거절 문구도 화면이 단추 밑에 적는 그 글자 그대로다(한 곳에 있다). */
  if (isRepairCaseShipmentFinished(repairCase)) {
    return { ok: false, message: RETURN_AFTER_SHIPMENT_MESSAGE };
  }

  // 🔴 화면과 **같은 함수**로 다시 잰다 — 0 인 줄을 걸러 보내는 일은 화면이 하고(저쪽은 0 을
  //    400 으로 거절한다), 여기서는 남은 줄의 모양만 본다.
  const parsed = parseReturnRequestLines(input.lines);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  // 🔴 포털 번호는 **세션의 사람**으로 읽는다(머리말 ㉢). 화면은 이 값을 보내지도 않는다.
  const sub = await getSsoSubjectForUser(actingUser.id);
  if (!sub) return { ok: false, message: NO_PORTAL_ID_MESSAGE };

  return createInventoryReturnRequest({
    requestKey: input.requestKey.trim(),
    intakeNumber: repairCase.intakeNumber,
    requester: { sub, name: actingUser.name },
    lines: parsed.lines,
    note: input.note?.trim() ? input.note.trim() : undefined,
  });
}
