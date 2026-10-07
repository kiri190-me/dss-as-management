"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  setCustomerStatuses,
  type CustomerStatusRow,
} from "@/lib/db/mutations/customer-portal";
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
 * 번도 돌지 않았고 화면 쪽은 앞 조각에서 이미 없어졌다. 남은 것은 화면의
 * [저장] 하나가 쓰는 saveCustomerStatusesAction 과 설정 화면의 상태 목록 둘이다.
 *
 * ── 🔴 저장은 **여러 줄을 한 번에**다 (사용자 지시 2026-10-07) ──────────────
 * 표의 줄마다 있던 [저장]이 화면에 하나가 되면서, 줄 하나를 받던
 * `setCustomerStatusAction` 을 줄 묶음을 받는 `saveCustomerStatusesAction` 으로
 * 바꿨다. 줄 하나짜리 통로는 **남기지 않았다** — 부르는 데가 한 곳도 없었고,
 * 쓰이지 않는 쓰기 통로를 열어 두면 아무 시험도 지나지 않는 채 남는다. 줄이
 * 하나인 저장은 이 통로에 줄 하나를 넘기는 것과 정확히 같다.
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

/** 화면이 보내는 줄 하나. 표의 한 줄이 그대로 이 꼴이 된다. */
export type CustomerStatusInputRow = {
  repairCaseId: string;
  statusOptionId: string | null;
  note: string | null;
  formValues?: Record<string, string>;
  expectedVersion: number | null;
};

/** 어긋난 줄 하나 — **어느 줄인지**와 **왜인지**를 화면이 사람에게 그대로 보인다. */
export type CustomerStatusFailedRow = { repairCaseId: string; message: string };

export type SaveCustomerStatusesResult =
  | { ok: true; message: string }
  | { ok: false; message: string; failedRows: CustomerStatusFailedRow[] };

/**
 * 한 번에 보낼 수 있는 줄 수. 화면의 표가 이보다 길어질 수는 있어도, 사람이 그
 * 많은 줄을 **손으로 고친 뒤** 한 번에 저장하는 일은 없다. 쓰기 통로에 상한이
 * 없으면 몸통 하나로 트랜잭션을 한없이 길게 잡을 수 있다.
 */
const MAX_ROWS_PER_SAVE = 500;

/**
 * 고객에게 보이는 상태·비고를 **여러 줄 한 번에** 정한다.
 *
 * ■ 🔴 고친 줄만 온다 · 전부 아니면 아무것도
 *
 * 화면이 고치지 않은 줄까지 실어 보내면, 내 화면의 옛 값으로 **그사이 남이 고친
 * 값을 덮는다.** 그래서 화면은 고친 줄만 모아 보내고(CustomerPortalScreen 의
 * collectEditedRows), 이 통로는 그 줄들을 **한 트랜잭션**으로 넘긴다. 한 줄이라도
 * 어긋나면 아무것도 저장되지 않고, 어긋난 줄이 어느 줄인지 전부 돌려준다.
 *
 * ■ 고객사 양식의 손으로 적는 칸도 **같은 저장 한 번**으로 간다
 *
 * `formValues` 를 따로 저장하는 액션으로 나누지 않았다. 나누면 한 줄을 고치는
 * 데 저장이 둘이 되고, 그 둘이 각각 version 을 올린다 — 첫 저장이 올린 version
 * 때문에 둘째 저장이 "다른 사람이 먼저 고쳤습니다"로 막힌다. 한 번에 보내면
 * 낙관적 잠금은 줄마다 한 번씩만 돈다.
 *
 * 🔴 `formValues` 를 **안 보내면 있던 값을 그대로 둔다**(mutation 주석 참조).
 */
export async function saveCustomerStatusesAction(input: {
  rows: CustomerStatusInputRow[];
}): Promise<SaveCustomerStatusesResult> {
  const gate = await requireActor();
  if (!gate.ok) return { ok: false, message: gate.message, failedRows: [] };
  if (!(await hasPermission(gate.actingUser, "customerPortal", "WRITE"))) {
    return {
      ok: false,
      message: "고객 안내 상태를 정할 권한이 없습니다.",
      failedRows: [],
    };
  }

  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (rows.length === 0) {
    return { ok: false, message: "저장할 변경이 없습니다.", failedRows: [] };
  }
  if (rows.length > MAX_ROWS_PER_SAVE) {
    return {
      ok: false,
      message: `한 번에 ${MAX_ROWS_PER_SAVE}줄까지 저장할 수 있습니다.`,
      failedRows: [],
    };
  }
  for (const row of rows) {
    if (typeof row?.repairCaseId !== "string" || !row.repairCaseId) {
      return { ok: false, message: "접수 건을 확인할 수 없습니다.", failedRows: [] };
    }
  }

  /*
   * 손으로 적는 칸을 거른다.
   *
   * 🔴 양식은 **서버가 접수에서 거슬러 올라가 찾은 고객사 이름**으로 고른다.
   * 화면이 "나는 ICD 양식이다"라고 말하게 두면 그 말이 곧 허가가 된다.
   *
   * 🔴 줄마다 한 번씩 묻되 **함께 쏜다.** 차례로 기다리면 줄 수만큼 왕복이
   * 쌓이고, 그 시간 동안 사람은 저장이 멈춘 줄 안다. `formValues` 를 안 보낸
   * 줄은 양식을 알 필요가 없으므로 묻지도 않는다.
   */
  const customerNames = await Promise.all(
    rows.map((row) =>
      row.formValues === undefined
        ? Promise.resolve(null)
        : getCustomerNameForRepairCase(row.repairCaseId)
    )
  );

  const prepared: CustomerStatusRow[] = [];
  for (const [index, row] of rows.entries()) {
    // 비고는 고객 화면에 그대로 나간다. 길이를 막지 않으면 한 번의 저장으로
    // 고객 화면이 글로 뒤덮인다.
    const note = row.note?.trim() || null;
    if (note && note.length > 1000) {
      return {
        ok: false,
        message: "비고는 1000자까지 적을 수 있습니다.",
        failedRows: [{ repairCaseId: row.repairCaseId, message: "비고가 1000자를 넘습니다." }],
      };
    }

    /*
     * 양식이 없는 고객사면 적을 칸 자체가 없으므로 `undefined` 로 둔다 — `{}` 로
     * 두면 "다 지워라"가 되어, 양식이 잠깐 빠진 사이의 저장 한 번이 그 고객사의
     * 적어 둔 값을 전부 날린다.
     */
    let formValues: Record<string, string> | undefined;
    if (row.formValues !== undefined) {
      const form = findPortalFormForCustomerName(customerNames[index]);
      if (form) {
        const sanitized = sanitizeManualValues(form, row.formValues);
        if (!sanitized.ok) {
          return {
            ok: false,
            message: sanitized.message,
            failedRows: [{ repairCaseId: row.repairCaseId, message: sanitized.message }],
          };
        }
        formValues = sanitized.values;
      }
    }

    prepared.push({
      repairCaseId: row.repairCaseId,
      statusOptionId: row.statusOptionId || null,
      note,
      formValues,
      expectedVersion: row.expectedVersion,
    });
  }

  const result = await setCustomerStatuses({
    rows: prepared,
    actorUserId: gate.actingUser.id,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      failedRows: result.failures.map((failure) => ({
        repairCaseId: failure.repairCaseId,
        message: failure.message,
      })),
    };
  }

  revalidatePath(PORTAL_PATH);
  return {
    ok: true,
    message: result.saved === 1 ? "저장했습니다." : `${result.saved}건을 저장했습니다.`,
  };
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
