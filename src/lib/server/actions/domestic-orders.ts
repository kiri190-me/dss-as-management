"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidDomesticOrderId,
  isValidExpectedVersion,
  validateDomesticOrderFields,
} from "@/lib/validation/domestic-order-input";
import {
  createDomesticOrder,
  setDomesticOrderCompletion,
  updateDomesticOrder,
} from "@/lib/db/mutations/domestic-orders";
import {
  permanentlyDeleteDomesticOrder,
  restoreDomesticOrder,
  softDeleteDomesticOrder,
  type DomesticOrderTrashResult,
} from "@/lib/db/mutations/domestic-orders-trash";

/**
 * ============================================================================
 * 내자 정리 — 행 추가·수정 서버 액션 (정책 계층)
 * ============================================================================
 * end-users.ts 와 같은 형식이다: 세션 확인 → 인가 확인 → 입력 검증 →
 * mutation 호출. 순서가 곧 규칙이다 — 검증을 먼저 하면 로그인하지 않은 요청이
 * 어떤 값이 유효한지를 알아낼 수 있게 된다.
 *
 * ── 관문이 둘인 이유 ────────────────────────────────────────────────────
 * canEditDomesticOrders(역할 정책)와 hasPermission("domesticOrders", "WRITE")
 * (관리자가 설정한 수준)를 **둘 다** 통과해야 저장된다.
 *
 * 내자 정리는 아직 permission-features.ts 의 '설정이 최종 판정' 목록에 없다.
 * 그 목록에 없는 메뉴는 기존 역할 함수가 여전히 최종 관문이고, 설정으로는
 * 좁힐 수만 있다 — 여기 두 검사를 AND 로 두는 것이 정확히 그 뜻이다. 설정
 * 화면도 이 사실을 그대로 표시하므로, 관리자가 "열어 줬다고 믿는데 막혀 있는"
 * 상태가 생기지 않는다.
 *
 * ── 화면이 감춘 것은 경계가 아니다 ──────────────────────────────────────
 * 목록 화면은 고칠 수 없는 역할에게 '행 추가' 버튼과 편집 폼을 그리지 않는다.
 * 그것은 편의일 뿐이고, 이 액션은 화면이 무엇을 보여 줬든 상관없이 매번 처음부터
 * 다시 검사한다.
 * ============================================================================
 */

export type DomesticOrderActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type DomesticOrderActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: DomesticOrderActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

async function resolveAuthorizedActingUser() {
  if (getAuthSource() !== "database") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  // 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다** —
  // 강등된 계정이 토큰 만료 전까지 예전 권한으로 저장하는 구멍을 막는다
  // (area-guard.ts 의 currentRole 과 같은 이유).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  // 관문은 하나다 — 관리자가 설정한 수준(2026-08-31 전환). 예전에는
  // canEditDomesticOrders(역할)와 AND 였고, 그래서 넓혀 줘도 열리지 않았다.
  // 기본값은 그대로다 — permission-baseline.ts 의 domesticOrders 기본값이
  // 바로 그 역할 함수라, 설정을 건드리지 않으면 같은 답을 낸다.
  if (!(await hasPermission(actingUser, "domesticOrders", "WRITE"))) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "이 작업을 수행할 권한이 없습니다." };
  }
  return { ok: true as const, actingUser };
}

export async function createDomesticOrderAction(input: {
  fields: Record<string, unknown>;
}): Promise<DomesticOrderActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validation = validateDomesticOrderFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await createDomesticOrder({ fields: validation.data, actorUserId: auth.actingUser.id });
  } catch (err) {
    // 값 자체는 절대 로그에 담지 않는다 — 현황·이력·기타·납품자에 사람 이름이
    // 섞일 수 있다(schema/domestic-orders.ts 의 PII 항목).
    console.error("createDomesticOrderAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function updateDomesticOrderAction(input: {
  id: string;
  expectedVersion: number;
  fields: Record<string, unknown>;
}): Promise<DomesticOrderActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidDomesticOrderId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "항목을 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "수정 시점 정보를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }

  const validation = validateDomesticOrderFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await updateDomesticOrder({
      id: input.id,
      expectedVersion: input.expectedVersion,
      fields: validation.data,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("updateDomesticOrderAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 완료 처리 · 완료 해제.
 *
 * 관문은 위 둘과 **똑같다** — canEditDomesticOrders AND
 * hasPermission("domesticOrders", "WRITE"). 권한 상한을 따로 올리지 않는다:
 * 완료는 누른 그 자리에서 다시 눌러 되돌릴 수 있는 조작이고, 값이 사라지지도
 * 않는다. 되돌릴 수 없는 조작(삭제 등)이 생기면 그때 별도의 수준을 논한다.
 */
export async function setDomesticOrderCompletionAction(input: {
  id: string;
  expectedVersion: number;
  completed: boolean;
}): Promise<DomesticOrderActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidDomesticOrderId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "항목을 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "수정 시점 정보를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  // 불리언이 아닌 값을 받아 두면 undefined 가 "해제"로 조용히 읽힌다.
  if (typeof input.completed !== "boolean") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { completed: "완료 여부를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await setDomesticOrderCompletion({
      id: input.id,
      expectedVersion: input.expectedVersion,
      completed: input.completed,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("setDomesticOrderCompletionAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * ============================================================================
 * 휴지통 — 보내기 · 되살리기 · 완전 삭제 (2026-09-11)
 * ============================================================================
 * 관문이 한 칸 좁다. 추가·수정·완료는 `domesticOrders` WRITE 지만, 이 셋은
 * `domesticOrders` MANAGE 다 — 15일이 지나면 세금계산서·입금 기록이 영구히
 * 사라지는 조작이라 지우는 판단을 담당자 각자에게 맡기지 않는다
 * (domestic-order-authorization.ts 의 canDeleteDomesticOrders). 판정 방식은
 * 견적서 휴지통(actions/quotes.ts 의 resolveDeletingUser)과 같다.
 *
 * ── 모양은 다른 휴지통 액션과 같다 ──────────────────────────────────────
 * 여러 건을 받아 **한 건씩 제 트랜잭션에서** 처리하고 건마다 결과를 돌려준다
 * (actions/inventory-trash.ts · customer-trash.ts). 그래서 화면은 고객사·부품이
 * 쓰는 훅(useMasterDataTrash)과 확인 창을 그대로 쓴다. 지금 화면은 한 번에 한
 * 줄만 보내지만, 모양을 맞춰 두면 창과 오류 요약이 화면마다 달라지지 않는다.
 *
 * ── 예기치 못한 오류는 그 한 건의 실패로 적는다 ─────────────────────────
 * Postgres 오류를 그대로 브라우저로 넘기지 않고, 로그에는 오류 코드만 남긴다 —
 * 이 표의 자유 입력 칸(현황·이력·기타·납품자)에 사람 이름이 섞일 수 있어
 * 값이 로그로 새지 않게 한다(inventory.ts 의 withErrorRedaction 과 같은 판단).
 *
 * ── 성공하면 목록 화면을 다시 그리게 한다 ───────────────────────────────
 * 한 건이라도 바뀌었으면 revalidatePath("/domestic-orders"). 화면도 훅이
 * router.refresh() 를 부르지만, 다른 탭에 열린 같은 화면이 낡은 캐시를 보지
 * 않게 서버 쪽에서도 무효화한다. 아무것도 안 바뀐 요청(관문·검증에서 막힘,
 * 전부 실패)에는 부르지 않는다.
 * ============================================================================
 */

const MAX_TRASH_ITEMS = 200;
const MAX_TRASH_REASON_LENGTH = 2000;
const DOMESTIC_ORDERS_PATH = "/domestic-orders";

/** 한 건. 수정·완료와 같은 version 대조를 쓴다(mutations/domestic-orders-trash.ts). */
export type DomesticOrderTrashItem = { id: string; expectedVersion: number };

export type DomesticOrderTrashItemResult = {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
};

export type DomesticOrderTrashActionResult =
  | { ok: true; results: DomesticOrderTrashItemResult[] }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR"; message: string };

async function resolveManagingActingUser() {
  if (getAuthSource() !== "database") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  // 살아 있는 계정을 다시 읽는다 — 위 resolveAuthorizedActingUser 와 같은 이유.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (!(await hasPermission(actingUser, "domesticOrders", "MANAGE"))) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "내자 정리 항목을 지울 권한이 없습니다." };
  }
  return { ok: true as const, actingUser };
}

function validateTrashItems(
  items: unknown,
  emptyMessage: string
): { ok: true; items: DomesticOrderTrashItem[] } | { ok: false; result: DomesticOrderTrashActionResult } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: emptyMessage } };
  }
  if (items.length > MAX_TRASH_ITEMS) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `한 번에 최대 ${MAX_TRASH_ITEMS}건까지 처리할 수 있습니다.`,
      },
    };
  }
  const checked: DomesticOrderTrashItem[] = [];
  for (const item of items as { id?: unknown; expectedVersion?: unknown }[]) {
    if (!isValidDomesticOrderId(item?.id) || !isValidExpectedVersion(item?.expectedVersion)) {
      return {
        ok: false,
        result: { ok: false, code: "VALIDATION_ERROR", message: "선택한 항목 정보를 확인할 수 없습니다." },
      };
    }
    // 받은 객체를 그대로 넘기지 않고 두 칸만 옮겨 담는다 — 화면이 덧붙인 다른
    // 값이 mutation 까지 흘러가지 않게 한다.
    checked.push({ id: item.id, expectedVersion: item.expectedVersion });
  }
  return { ok: true, items: checked };
}

/**
 * 건마다 실행하고 건마다 결과를 담는다. 한 건이라도 성공했으면 목록 화면을
 * 무효화한다(위 머리말).
 */
async function runEachTrashItem(
  items: DomesticOrderTrashItem[],
  label: string,
  run: (item: DomesticOrderTrashItem) => Promise<DomesticOrderTrashResult>
): Promise<DomesticOrderTrashItemResult[]> {
  const results: DomesticOrderTrashItemResult[] = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push(
        result.ok ? { id: item.id, ok: true } : { id: item.id, ok: false, code: result.code, message: result.message }
      );
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
      console.error(`${label}: unexpected DB error`, { id: item.id, code });
      results.push({ id: item.id, ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE });
    }
  }
  if (results.some((result) => result.ok)) revalidatePath(DOMESTIC_ORDERS_PATH);
  return results;
}

/** 휴지통으로 보낸다. 되돌릴 수 있는 조작이라 사유는 선택이다. */
export async function deleteDomesticOrdersAction(input: {
  items: DomesticOrderTrashItem[];
  reason: string | null;
}): Promise<DomesticOrderTrashActionResult> {
  const auth = await resolveManagingActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validated = validateTrashItems(input?.items, "휴지통으로 보낼 항목을 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_TRASH_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제 사유가 너무 깁니다." };
  }

  const results = await runEachTrashItem(validated.items, "deleteDomesticOrdersAction", (item) =>
    softDeleteDomesticOrder({
      id: item.id,
      expectedVersion: item.expectedVersion,
      actorUserId: auth.actingUser.id,
      reason: reason || null,
    })
  );
  return { ok: true, results };
}

/** 휴지통에서 되살린다. */
export async function restoreDomesticOrdersAction(input: {
  items: DomesticOrderTrashItem[];
}): Promise<DomesticOrderTrashActionResult> {
  const auth = await resolveManagingActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validated = validateTrashItems(input?.items, "복원할 항목을 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const results = await runEachTrashItem(validated.items, "restoreDomesticOrdersAction", (item) =>
    restoreDomesticOrder({ id: item.id, expectedVersion: item.expectedVersion, actorUserId: auth.actingUser.id })
  );
  return { ok: true, results };
}

/** 15일을 기다리지 않고 휴지통의 줄을 완전히 지운다. 되돌릴 수 없으므로 사유가 필수다. */
export async function permanentlyDeleteDomesticOrdersAction(input: {
  items: DomesticOrderTrashItem[];
  reason: string;
}): Promise<DomesticOrderTrashActionResult> {
  const auth = await resolveManagingActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validated = validateTrashItems(input?.items, "완전 삭제할 항목을 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유를 입력해 주세요." };
  }
  if (reason.length > MAX_TRASH_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유가 너무 깁니다." };
  }

  const results = await runEachTrashItem(validated.items, "permanentlyDeleteDomesticOrdersAction", (item) =>
    permanentlyDeleteDomesticOrder({
      id: item.id,
      expectedVersion: item.expectedVersion,
      actorUserId: auth.actingUser.id,
      reason,
    })
  );
  return { ok: true, results };
}
