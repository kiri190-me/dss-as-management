"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { setCustomerStatus } from "@/lib/db/mutations/customer-portal";
import { getCustomerNameForRepairCase } from "@/lib/db/queries/customer-portal";
import {
  findPortalFormForCustomerName,
  sanitizeManualValues,
} from "@/lib/domain/customer-portal-forms";
import {
  createStatusOption,
  updateStatusOption,
} from "@/lib/db/mutations/customer-status-options";

/**
 * ============================================================================
 * 고객 안내 창구 — 서버 액션
 * ============================================================================
 *
 * 다른 서버 액션과 같은 층위의 일만 한다: 모드 확인, 세션, 권한, 입력 형식
 * 검증, 오류 은닉. 실제 판정과 기록은 mutation 이 DB 를 다시 읽어 수행한다.
 *
 * 권한을 여기서 한 번, mutation 에서 또 한 번 본다. 겹치지만 "고객사에 보내는
 * 엑셀에 무엇이 적히는가"를 바꾸는 조작이라 그 편이 맞다 — 한쪽이 무너져도
 * 다른 쪽이 남는다.
 *
 * ── 남은 것은 셋뿐이다 (2026-10-04) ────────────────────────────────────────
 * 고객사 전용 주소를 발급·회수하고 밖으로 내보내던 액션 넷
 * (issueCustomerLinkAction · revealCustomerLinkUrlAction ·
 * revokeCustomerLinkAction · syncNowAction)을 걷어냈다. 그 기능은 운영에서 한
 * 번도 돌지 않았고 화면 쪽은 앞 조각에서 이미 없어졌다. 남은 것은 줄마다
 * [저장]이 쓰는 setCustomerStatusAction 과 설정 화면의 상태 목록 둘이다.
 * ============================================================================
 */

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const PORTAL_PATH = "/customer-portal";

/** 모든 액션이 먼저 지나는 문. 통과하면 행위자를 돌려준다. */
async function requireActor() {
  if (getAuthSource() !== "database") {
    return { ok: false as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false as const, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false as const, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  return { ok: true as const, actingUser };
}

/**
 * 고객에게 보이는 상태·비고를 정한다.
 *
 * ■ 고객사 양식의 손으로 적는 칸도 **같은 저장 한 번**으로 간다
 *
 * `formValues` 를 따로 저장하는 액션으로 나누지 않았다. 나누면 한 줄을 고치는
 * 데 저장이 둘이 되고, 그 둘이 각각 version 을 올린다 — 첫 저장이 올린 version
 * 때문에 둘째 저장이 "다른 사람이 먼저 고쳤습니다"로 막힌다. 한 번에 보내면
 * 낙관적 잠금은 예전과 똑같이 한 번만 돈다.
 *
 * 🔴 `formValues` 를 **안 보내면 있던 값을 그대로 둔다**(mutation 주석 참조).
 * 기본 9열 표의 저장은 이 값을 모르는 채로 온다.
 */
export async function setCustomerStatusAction(input: {
  repairCaseId: string;
  statusOptionId: string | null;
  note: string | null;
  formValues?: Record<string, string>;
  expectedVersion: number | null;
}): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser, "customerPortal", "WRITE"))) {
    return { ok: false, message: "고객 안내 상태를 정할 권한이 없습니다." };
  }

  if (typeof input.repairCaseId !== "string" || !input.repairCaseId) {
    return { ok: false, message: "접수 건을 확인할 수 없습니다." };
  }
  // 비고는 고객 화면에 그대로 나간다. 길이를 막지 않으면 한 번의 저장으로
  // 고객 화면이 글로 뒤덮인다.
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) {
    return { ok: false, message: "비고는 1000자까지 적을 수 있습니다." };
  }

  /*
   * 손으로 적는 칸을 거른다.
   *
   * 🔴 양식은 **서버가 접수에서 거슬러 올라가 찾은 고객사 이름**으로 고른다.
   * 화면이 "나는 ICD 양식이다"라고 말하게 두면 그 말이 곧 허가가 된다.
   *
   * 양식이 없는 고객사면 적을 칸 자체가 없으므로 `undefined` 로 둔다 — `{}` 로
   * 두면 "다 지워라"가 되어, 양식이 잠깐 빠진 사이의 저장 한 번이 그 고객사의
   * 적어 둔 값을 전부 날린다.
   */
  let formValues: Record<string, string> | undefined;
  if (input.formValues !== undefined) {
    const customerName = await getCustomerNameForRepairCase(input.repairCaseId);
    const form = findPortalFormForCustomerName(customerName);
    if (form) {
      const sanitized = sanitizeManualValues(form, input.formValues);
      if (!sanitized.ok) return { ok: false, message: sanitized.message };
      formValues = sanitized.values;
    }
  }

  const result = await setCustomerStatus({
    repairCaseId: input.repairCaseId,
    statusOptionId: input.statusOptionId || null,
    note,
    formValues,
    expectedVersion: input.expectedVersion,
    actorUserId: gate.actingUser.id,
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(PORTAL_PATH);
  return { ok: true, message: "저장했습니다." };
}

// ───── 설정: 고객 안내 상태 목록 ─────

export async function createStatusOptionAction(input: {
  label: string;
}): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser, "customerPortal", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 상태 목록을 바꿀 수 있습니다." };
  }

  const label = input.label?.trim();
  if (!label) return { ok: false, message: "상태 이름을 적어 주세요." };
  if (label.length > 50) {
    return { ok: false, message: "상태 이름은 50자까지 적을 수 있습니다." };
  }

  const result = await createStatusOption({
    label,
    actorUserId: gate.actingUser.id,
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/settings");
  return { ok: true, message: `「${label}」을(를) 더했습니다.` };
}

export async function updateStatusOptionAction(input: {
  id: string;
  label?: string;
  isActive?: boolean;
  displayOrder?: number;
}): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser, "customerPortal", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 상태 목록을 바꿀 수 있습니다." };
  }

  const label = input.label?.trim();
  if (label !== undefined && (!label || label.length > 50)) {
    return { ok: false, message: "상태 이름은 1~50자여야 합니다." };
  }

  const result = await updateStatusOption({
    id: input.id,
    label,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
    actorUserId: gate.actingUser.id,
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/settings");
  return { ok: true, message: "저장했습니다." };
}
