"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  markRequestConverted,
  rejectRequest,
} from "@/lib/db/mutations/customer-repair-request-conversion";

/**
 * 수리 의뢰 처리 — 반려.
 *
 * **접수로 만드는 것은 이 파일에 없다.** 그 일은 기존 A/S 접수 화면과
 * create-repair-case 액션이 그대로 한다. 여기에 또 하나를 두면 접수를 만드는
 * 길이 둘이 되고, 검증과 idempotency 를 한 벌 더 갖게 된다. 이 파일이 하는
 * 일은 "접수로 만들지 않기로 했다"를 남기는 것뿐이다.
 *
 * 의뢰를 접수로 옮길 때의 자리 선점(CONVERTING)은
 * mutations/customer-repair-request-conversion.ts 가 맡는다.
 */

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * 접수가 만들어졌다 — 그 의뢰를 이 접수에 묶고 목록에서 내린다.
 *
 * 접수 화면이 저장에 성공한 직후에 부른다. 접수 만들기와 한 트랜잭션으로
 * 묶지 않은 이유는 부르는 쪽 주석에 있다.
 *
 * **이미 처리된 의뢰는 덮어쓰지 않는다.** 그사이 다른 사람이 접수로 만들었거나
 * 반려했다면 그 결정이 이긴다 — 여기서 덮으면 먼저 만든 접수와의 연결이 조용히
 * 끊긴다.
 */
export async function linkRequestToRepairCaseAction(input: {
  requestId: string;
  repairCaseId: string;
}): Promise<ActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (!(await hasPermission(actingUser.role, "customerPortal", "WRITE"))) {
    return { ok: false, message: "수리 의뢰를 처리할 권한이 없습니다." };
  }

  const result = await markRequestConverted({
    requestId: input.requestId,
    repairCaseId: input.repairCaseId,
    actorUserId: actingUser.id,
  });

  if (!result.ok) {
    return { ok: false, message: result.message ?? "의뢰를 연결하지 못했습니다." };
  }

  revalidatePath("/customer-portal/requests");
  revalidatePath("/customer-portal");
  return { ok: true, message: "수리 의뢰를 이 접수에 연결했습니다." };
}

export async function rejectRequestAction(input: {
  requestId: string;
  reason: string;
}): Promise<ActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await hasPermission(actingUser.role, "customerPortal", "WRITE"))) {
    return { ok: false, message: "수리 의뢰를 처리할 권한이 없습니다." };
  }

  const reason = input.reason?.trim();
  // 사유 없는 반려를 막는다. 고객은 자기가 보낸 것이 어떻게 됐는지 볼 수
  // 없으므로, 사내에 이유가 없으면 나중에 아무도 설명할 수 없다.
  if (!reason) return { ok: false, message: "반려 사유를 적어 주세요." };
  if (reason.length > 1000) {
    return { ok: false, message: "반려 사유는 1000자까지 적을 수 있습니다." };
  }

  const result = await rejectRequest({
    requestId: input.requestId,
    reason,
    actorUserId: actingUser.id,
  });

  if (!result.ok) {
    return { ok: false, message: result.message ?? "반려하지 못했습니다." };
  }

  revalidatePath("/customer-portal/requests");
  return { ok: true, message: "반려했습니다." };
}
