"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { getIntakeNumberForRepairCase } from "@/lib/db/queries/repair-cases";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
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
  cancelInventoryStockRequest,
  createInventoryStockRequest,
  fetchInventoryStockRequestsByIntake,
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

  // 🔴 인수번호는 **여기서 읽는다**(머리말). 화면이 보낸 값을 쓰지 않는다.
  const intakeNumber = await getIntakeNumberForRepairCase(input.repairCaseId);
  if (!intakeNumber) {
    return { ok: false, message: CASE_NOT_FOUND };
  }

  // 🔴 화면과 **같은 함수**로 다시 잰다 — 유상/무상이 빠진 줄은 여기서도 막힌다.
  const parsed = parseStockRequestLines(input.lines);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const sub = await getSsoSubjectForUser(actingUser.id);
  if (!sub) return { ok: false, message: NO_PORTAL_ID_MESSAGE };

  return createInventoryStockRequest({
    requestKey: input.requestKey.trim(),
    intakeNumber,
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

  const intakeNumber = await getIntakeNumberForRepairCase(input.repairCaseId);
  if (!intakeNumber) {
    return { ok: false, message: CASE_NOT_FOUND };
  }

  // 🔴 포털 번호는 **세션의 사람**으로 읽는다(머리말 ㉠). 화면은 이 값을 보내지도 않는다.
  const sub = await getSsoSubjectForUser(actingUser.id);
  if (!sub) return { ok: false, message: NO_PORTAL_ID_MESSAGE };

  // 🔴 이 건의 신청인가(머리말 ㉡). 못 받아 왔으면 **거두지 않는다** — 확인하지 못한 것을
  //    통과시키면 다른 건의 열쇠가 그대로 지나간다.
  const requests = await fetchInventoryStockRequestsByIntake(intakeNumber);
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
