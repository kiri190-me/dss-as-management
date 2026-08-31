"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  decryptCustomerLinkToken,
  encryptCustomerLinkToken,
  isCustomerLinkTokenKeyConfigured,
} from "@/lib/server/customer-link-token-cipher";
import {
  issueCustomerLink,
  revokeCustomerLink,
  setCustomerStatus,
} from "@/lib/db/mutations/customer-portal";
import { getActiveLinkCipher } from "@/lib/db/queries/customer-portal";
import {
  createStatusOption,
  updateStatusOption,
} from "@/lib/db/mutations/customer-status-options";
import {
  pushCustomerLink,
  pushLinkRevocation,
  pushSnapshotForLink,
} from "@/lib/server/services/customer-portal-sync";

/**
 * ============================================================================
 * 고객 안내 창구 — 서버 액션
 * ============================================================================
 *
 * 다른 서버 액션과 같은 층위의 일만 한다: 모드 확인, 세션, 권한, 입력 형식
 * 검증, 오류 은닉. 실제 판정과 기록은 mutation 이 DB 를 다시 읽어 수행한다.
 *
 * 권한을 여기서 한 번, mutation 에서 또 한 번 본다. 겹치지만 "고객 화면에
 * 무엇이 나가는가"를 바꾸는 조작이라 그 편이 맞다 — 한쪽이 무너져도 다른
 * 쪽이 남는다.
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

/** 고객에게 보이는 상태·비고를 정한다. */
export async function setCustomerStatusAction(input: {
  repairCaseId: string;
  statusOptionId: string | null;
  note: string | null;
  expectedVersion: number | null;
}): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "WRITE"))) {
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

  const result = await setCustomerStatus({
    repairCaseId: input.repairCaseId,
    statusOptionId: input.statusOptionId || null,
    note,
    expectedVersion: input.expectedVersion,
    actorUserId: gate.actingUser.id,
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(PORTAL_PATH);
  return { ok: true, message: "저장했습니다. 「지금 내보내기」를 눌러야 고객 화면에 반영됩니다." };
}

/**
 * 고객사 전용 주소를 발급한다.
 *
 * 평문 토큰은 여기서 딱 한 번 만들어진다. DB 에는 sha256(인증용)과 **키로
 * 암호화한 사본**(다시 보여 주기용, token_cipher)이 들어가고, 평문 자체는
 * 남기지 않는다. 발급 직후 화면에 보여 주는 것은 그대로 두되 — 전달까지가
 * 한 흐름이라 그 자리에서 복사하는 것이 가장 자연스럽다 — 나중에 잊어도
 * revealCustomerLinkUrlAction 으로 다시 볼 수 있다.
 */
export async function issueCustomerLinkAction(input: {
  customerId: string;
  label: string | null;
  customerName: string;
}): Promise<ActionResult & { url?: string }> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 주소를 발급할 수 있습니다." };
  }
  if (typeof input.customerId !== "string" || !input.customerId) {
    return { ok: false, message: "고객사를 확인할 수 없습니다." };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const { linkId, revokedPreviousId } = await issueCustomerLink({
    customerId: input.customerId,
    tokenHash,
    // 주소를 나중에 다시 볼 수 있게 암호화해 함께 넣는다. 키가 없는 환경이면
    // null 이 되고, 발급은 그대로 되며 그 주소만 나중에 확인할 수 없다.
    tokenCipher: encryptCustomerLinkToken(token, input.customerId),
    label: input.label?.trim() || null,
    actorUserId: gate.actingUser.id,
  });

  /*
   * 재발급이면 **옛 주소를 먼저 끊는다.**
   *
   * 우리 쪽에서는 issueCustomerLink 가 이미 회수했지만, 공개 사이트는 그걸
   * 모른다. 알려주지 않으면 옛 주소가 계속 열려 있고, 그러면 재발급이
   * "새 주소를 하나 더 만드는 일"이 되어 버린다 — 유출 때문에 재발급하는
   * 상황에서 정확히 반대로 동작한다.
   *
   * 새 주소를 심기 **전에** 한다. 순서를 바꿨다가 중간에 실패하면 두 주소가
   * 동시에 열려 있는 창이 생긴다.
   */
  if (revokedPreviousId) {
    try {
      await pushLinkRevocation(revokedPreviousId);
    } catch (error) {
      return {
        ok: false,
        message: `옛 주소를 끊지 못했습니다(${
          (error as Error).message
        }). 새 주소를 만들지 않았습니다 — 다시 시도해 주세요.`,
      };
    }
  }

  try {
    await pushCustomerLink({
      nasLinkId: linkId,
      token,
      customerDisplayName: input.customerName,
    });
  } catch (error) {
    // 우리 쪽에는 만들어졌는데 밖에 못 심었다. 주소를 알려주면 안 된다 —
    // 고객이 그 주소로 들어가면 "사용할 수 없는 주소"가 뜬다.
    return {
      ok: false,
      message: `주소는 만들어졌지만 공개 사이트에 전달하지 못했습니다(${
        (error as Error).message
      }). 다시 발급해 주세요.`,
    };
  }

  /*
   * 새 주소에 현황을 곧바로 채운다.
   *
   * 이걸 빼면 **발급 직후의 주소는 빈 화면**이다 — 다음 동기화(5분 주기)나
   * 「지금 내보내기」를 누르기 전까지. 발급하자마자 고객에게 전달하는 것이
   * 정상적인 흐름이므로, 그 사이의 빈 화면은 곧바로 "안 되는데요" 전화가 된다.
   *
   * 여기서 실패해도 주소 발급 자체는 성공으로 알린다 — 주소는 이미 살아
   * 있고, 현황은 다음 동기화가 채운다. 대신 그 사실을 문구로 말한다.
   */
  let filled = true;
  try {
    await pushSnapshotForLink(linkId);
  } catch {
    filled = false;
  }

  const base = process.env.DSS_HOME_URL ?? "";
  revalidatePath(PORTAL_PATH);
  return {
    ok: true,
    message: filled
      ? "주소를 발급했습니다. 복사해서 고객사에 전달하세요."
      : "주소는 발급했지만 현황을 채우지 못했습니다. 「지금 내보내기」를 눌러 주세요.",
    url: `${base.replace(/\/+$/, "")}/repair/${token}`,
  };
}


/**
 * 지금 살아 있는 그 고객사의 전용 주소를 꺼내 보여 준다.
 *
 * ■ 관리자 이상만
 *
 * 주소 하나가 그 회사의 A/S 현황 전체를 여는 열쇠다. 꺼내 보는 것은 발급과
 * 같은 무게의 조작이라(꺼낸 뒤 어디로 전달되는지 우리가 알 수 없다는 점까지
 * 똑같다) 발급·회수와 같은 선에 둔다 — canManageCustomerLinks.
 *
 * ■ 못 보여 주는 경우를 이유별로 갈라 돌려준다
 *
 * 화면이 "재발급하면 됩니다"와 "관리자에게 키 설정을 요청하세요"를 구분해
 * 안내해야 해서다. 뭉뚱그려 실패로 만들면 담당자가 키 문제를 재발급으로
 * 해결하려 들고, 그때마다 고객이 쓰던 주소가 하나씩 끊긴다.
 */
export async function revealCustomerLinkUrlAction(input: {
  linkId: string;
}): Promise<
  | { ok: true; url: string }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" | "NO_KEY" | "NOT_STORED"; message: string }
> {
  const gate = await requireActor();
  if (!gate.ok) {
    return { ok: false, reason: "FORBIDDEN", message: gate.message };
  }
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "MANAGE"))) {
    return {
      ok: false,
      reason: "FORBIDDEN",
      message: "관리자 이상만 주소를 확인할 수 있습니다.",
    };
  }
  if (typeof input.linkId !== "string" || !input.linkId) {
    return { ok: false, reason: "NOT_FOUND", message: "주소를 확인할 수 없습니다." };
  }

  const link = await getActiveLinkCipher(input.linkId);
  if (!link) {
    return {
      ok: false,
      reason: "NOT_FOUND",
      message: "회수되었거나 없는 주소입니다.",
    };
  }

  // 키가 없는 것과 사본이 없는 것은 고쳐야 할 사람이 다르다. 키는 서버를
  // 만지는 사람이, 사본은 담당자가 재발급으로 해결한다.
  if (!isCustomerLinkTokenKeyConfigured()) {
    return {
      ok: false,
      reason: "NO_KEY",
      message:
        "서버에 주소 보관 키(CUSTOMER_LINK_TOKEN_KEY)가 설정되어 있지 않아 주소를 꺼낼 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const token = decryptCustomerLinkToken(link.tokenCipher, link.customerId);
  if (!token) {
    return {
      ok: false,
      reason: "NOT_STORED",
      message:
        "이 주소는 보관되기 전에 발급되어 다시 볼 수 없습니다. 「주소 재발급」을 누르면 새 주소가 나오고 옛 주소는 자동으로 회수됩니다.",
    };
  }

  const base = (process.env.DSS_HOME_URL ?? "").replace(/\/+$/, "");
  return { ok: true, url: `${base}/repair/${token}` };
}

export async function revokeCustomerLinkAction(input: {
  linkId: string;
}): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 주소를 회수할 수 있습니다." };
  }

  // 밖을 먼저 막는다. 우리 쪽만 회수하고 밖이 남으면 고객은 여전히 옛
  // 현황을 볼 수 있다 — 회수의 목적이 그것을 끊는 것이다.
  try {
    await pushLinkRevocation(input.linkId);
  } catch (error) {
    return {
      ok: false,
      message: `공개 사이트에서 주소를 끊지 못했습니다(${
        (error as Error).message
      }). 회수하지 않았습니다.`,
    };
  }

  const result = await revokeCustomerLink({
    linkId: input.linkId,
    actorUserId: gate.actingUser.id,
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(PORTAL_PATH);
  return { ok: true, message: "주소를 회수했습니다. 그 주소로는 더 이상 들어갈 수 없습니다." };
}

/** 「지금 내보내기」 — 5분 주기를 기다리지 않고 곧바로 반영한다. */
export async function syncNowAction(input: { linkId: string }): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "WRITE"))) {
    return { ok: false, message: "내보낼 권한이 없습니다." };
  }

  try {
    const count = await pushSnapshotForLink(input.linkId);
    revalidatePath(PORTAL_PATH);
    return { ok: true, message: `${count}건을 내보냈습니다.` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

// ───── 설정: 고객 안내 상태 목록 ─────

export async function createStatusOptionAction(input: {
  label: string;
}): Promise<ActionResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "MANAGE"))) {
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
  if (!(await hasPermission(gate.actingUser.role, "customerPortal", "MANAGE"))) {
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
