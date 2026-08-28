"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidExpectedVersion,
  isValidOhTemplateId,
  validateOhTemplateFields,
} from "@/lib/validation/oh-part-template-input";
import {
  createOhTemplate,
  linkProductModel,
  unlinkProductModel,
  updateOhTemplate,
  type OhLinkResult,
  type OhTemplateResult,
} from "@/lib/db/mutations/oh-part-templates";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 서버 액션 (정책 계층)
 * ============================================================================
 * 세션 확인 → 인가 확인 → 입력 검증 → mutation. 순서가 곧 규칙이다.
 *
 * **권한은 부품 마스터를 고치는 것과 같다** — `inventory.parts` WRITE.
 * 템플릿은 "이 기종을 오버홀하면 무엇을 쓰는가"라는 부품 쪽 설정값이라,
 * 품명·도번을 고칠 수 있는 사람과 같은 판정이 맞다(한계수량·단가와 같은 자리).
 * ============================================================================
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

const DB_UNAVAILABLE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";

async function resolveActor(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  const deny = (message: string) => ({ ok: false as const, result: { ok: false as const, code: "FORBIDDEN" as const, message } });

  if (getAuthSource() !== "database") return deny("데이터베이스 저장 모드가 아닙니다.");
  const session = await readSession();
  if (!session) return deny("로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") return deny("계정이 아직 승인되지 않았습니다.");

  // 세션의 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된 계정이 토큰
  // 만료 전까지 예전 권한으로 저장하는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return deny("로그인이 필요합니다.");
  if (!(await hasPermission(actingUser.role, "inventory.parts", "WRITE"))) {
    return deny("O/H 템플릿을 고칠 권한이 없습니다.");
  }
  return { ok: true, userId: actingUser.id };
}

export async function saveOhTemplateAction(input: {
  id: string | null;
  expectedVersion: number | null;
  fields: Record<string, unknown>;
}): Promise<OhTemplateResult | Forbidden> {
  const actor = await resolveActor();
  if (!actor.ok) return actor.result;

  const validation = validateOhTemplateFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }

  try {
    if (input.id === null) {
      return await createOhTemplate({ fields: validation.data, actorUserId: actor.userId });
    }
    if (!isValidOhTemplateId(input.id)) {
      return { ok: false, code: "NOT_FOUND", message: "해당 템플릿을 찾을 수 없습니다." };
    }
    if (!isValidExpectedVersion(input.expectedVersion)) {
      return { ok: false, code: "CONFLICT", message: "최신 정보를 다시 불러온 뒤 시도해 주세요." };
    }
    return await updateOhTemplate({
      id: input.id,
      expectedVersion: input.expectedVersion,
      fields: validation.data,
      actorUserId: actor.userId,
    });
  } catch (err) {
    console.error("saveOhTemplateAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: DB_UNAVAILABLE };
  }
}

export async function linkProductModelAction(input: {
  templateId: string;
  productModelId: string;
}): Promise<OhLinkResult | Forbidden> {
  const actor = await resolveActor();
  if (!actor.ok) return actor.result;
  if (!isValidOhTemplateId(input.templateId) || !isValidOhTemplateId(input.productModelId)) {
    return { ok: false, code: "NOT_FOUND", message: "요청 정보를 확인할 수 없습니다." };
  }
  try {
    return await linkProductModel({ ...input, actorUserId: actor.userId });
  } catch (err) {
    console.error("linkProductModelAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: DB_UNAVAILABLE };
  }
}

export async function unlinkProductModelAction(input: {
  linkId: string;
}): Promise<OhLinkResult | Forbidden> {
  const actor = await resolveActor();
  if (!actor.ok) return actor.result;
  if (!isValidOhTemplateId(input.linkId)) {
    return { ok: false, code: "NOT_FOUND", message: "요청 정보를 확인할 수 없습니다." };
  }
  try {
    return await unlinkProductModel({ linkId: input.linkId, actorUserId: actor.userId });
  } catch (err) {
    console.error("unlinkProductModelAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: DB_UNAVAILABLE };
  }
}
