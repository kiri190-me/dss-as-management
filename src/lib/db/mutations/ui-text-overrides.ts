import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { uiTextOverrides, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { mayEditUiText } from "@/lib/auth/ui-text-authorization";
import {
  checkUiTextOverrideChange,
  findDuplicateUiTextChange,
  type CheckedUiTextOverrideChange,
  type UiTextOverrideChange,
} from "@/lib/validation/ui-text-override-input";

/**
 * ============================================================================
 * 화면 문구 저장
 * ============================================================================
 * saveUiThemeTokens 를 본보기로 삼았고, 거기서 이미 내려진 판단들을 그대로
 * 가져왔다. 화면이 보낸 값을 그대로 믿지 않는다 — 화면을 거치지 않고 이 함수를
 * 부를 수 있기 때문이다.
 *
 *  1) **한 트랜잭션.** 한 화면에서 여러 문구를 함께 편집하므로, 뒤엣것에서
 *     막혔는데 앞엣것만 저장되는 일은 없어야 한다. 절반만 바뀐 말투는 관리자가
 *     무엇을 되돌려야 하는지 알 수 없는 상태다.
 *  2) **같은 (묶음, 항목)이 두 번 오면 거절한다.** 어느 쪽이 뜻인지 알 수 없고,
 *     뒤엣것으로 덮어쓰면 화면에서 본 것과 다른 문구가 저장될 수 있다.
 *  3) **트랜잭션 안에서 행위자를 다시 읽는다.** 세션이 만들어진 뒤 역할이
 *     내려갔거나 계정이 지워졌을 수 있다.
 *  4) **기본 문구와 같은 값은 저장하지 않고 지운다.** "기본으로 되돌림"과 "기본과
 *     같은 문구를 굳이 적어 둠"이 구별되어야, 나중에 types.ts 의 기본 문구를
 *     손볼 때 옛 문구가 오버라이드로 굳어 아무 화면도 따라 바뀌지 않는 일이
 *     생기지 않는다.
 *  5) 🔴 **모르는 키·형식이 틀린 문구는 무시하지 않고 거절한다.** 알림 설정과
 *     반대로 가는 자리이고, 까닭은 validation/ui-text-override-input.ts
 *     머리말에 있다.
 *
 * ── 🔴 거절은 반드시 던진다 ─────────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 `return` 하면 **커밋된다.** 그래서 검증을 한 줄씩
 * **트랜잭션 안에서** 하고, 막히면 SaveRejected 를 던져 앞줄까지 통째로
 * 되돌린다(saveUiThemeTokens · saveNotificationSettings 와 같은 신호).
 *
 * ── 색과 달리 대비 같은 「합쳐진 결과」 판정이 없다 ──────────────────────
 * 색은 (글자색, 바탕색)이 짝을 이뤄서 한쪽만 바꿔도 다른 쪽과 합쳐 재야 했다.
 * 문구는 서로 짝을 이루지 않는다 — "관리자"를 바꾼다고 "최고관리자"가 읽히지
 * 않게 되지는 않는다. 그래서 판정은 한 줄 안에서 끝나고, 저장된 다른 행을 읽어
 * 볼 이유가 없다.
 *
 * ── .for("update") 를 쓰지 않는 이유 ────────────────────────────────────
 * 없는 행은 잠글 수 없다. 이 표의 기본 상태는 "행이 없음"이므로 잠글 대상이 아예
 * 없는 경우가 대부분이다. 유일성은 (group_key, item_key) 유니크 인덱스와
 * onConflictDoUpdate 가 지킨다 — ui_theme_tokens · notification_*_settings 와 같다.
 *
 * 감사 기록은 audit_logs 에 남긴다. 행이 (묶음, 항목) 하나이므로
 * target_record_id 가 "역할의 SUPER_ADMIN" 하나를 정확히 가리키고, 값 객체에
 * { groupKey, itemKey, value } 를 담아 로그만 읽고도 어느 문구가 움직였는지 알
 * 수 있게 한다.
 * ============================================================================
 */

export type SaveUiTextOverridesResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(saveUiThemeTokens 의 SaveRejected 와 같은 이유).
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveUiTextOverridesResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

export async function saveUiTextOverrides(params: {
  changes: UiTextOverrideChange[];
  actorUserId: string;
}): Promise<SaveUiTextOverridesResult> {
  // 중복은 값이 유효한지와 무관한 판정이라 배열을 한 번 훑는 이 자리에서 본다.
  const duplicate = findDuplicateUiTextChange(params.changes);
  if (duplicate) return { ok: false, code: "INVALID_INPUT", message: duplicate };
  if (params.changes.length === 0) return { ok: true, changedCount: 0 };

  try {
    return await db.transaction(async (tx): Promise<SaveUiTextOverridesResult> => {
      const [actor] = await tx
        .select({
          id: users.id,
          role: users.role,
          approvalStatus: users.approvalStatus,
          isDeveloper: users.isDeveloper,
        })
        .from(users)
        .where(and(eq(users.id, params.actorUserId), eq(users.isDeleted, false)));
      if (!actor || actor.approvalStatus !== "APPROVED") {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "사용자 정보를 확인할 수 없습니다.",
        });
      }
      if (!mayEditUiText(actor)) {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "개발자 모드에 들어갈 수 있는 사람만 화면 문구를 바꿀 수 있습니다.",
        });
      }

      let changedCount = 0;
      for (const raw of params.changes) {
        // 🔴 한 줄씩 검증하고 곧바로 적용한다. 뒷줄이 막히면 앞줄까지 함께
        // 되돌아가는 것이 이 구조의 요점이다 — 여기서 던지지 않고 반환하면
        // 앞줄이 커밋된 채 남는다.
        const checked = checkUiTextOverrideChange(raw);
        if (!checked.ok) {
          throw new SaveRejected({ ok: false, code: "INVALID_INPUT", message: checked.message });
        }
        changedCount += await applyOneChange(tx, {
          change: checked.change,
          actorUserId: actor.id,
        });
      }

      return { ok: true, changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/** (묶음, 항목) 한 자리분의 저장. 바뀐 것이 있으면 1, 없으면 0. */
async function applyOneChange(
  tx: Tx,
  params: { change: CheckedUiTextOverrideChange; actorUserId: string }
): Promise<number> {
  const { group, item } = params.change;
  const fallback = item.defaultText;

  // 🔴 기본 문구와 같은 값은 "되돌림"과 같은 길로 보낸다. 굳이 저장해 두면
  // 나중에 types.ts 의 기본 문구를 손볼 때 옛 문구가 오버라이드로 굳어, 아무
  // 화면도 따라 바뀌지 않는다.
  const desired =
    params.change.value === null || params.change.value === fallback ? null : params.change.value;

  const [previous] = await tx
    .select({ id: uiTextOverrides.id, value: uiTextOverrides.value })
    .from(uiTextOverrides)
    .where(and(eq(uiTextOverrides.groupKey, group.key), eq(uiTextOverrides.itemKey, item.key)));

  if (desired === null) {
    if (!previous) return 0;
    await tx.delete(uiTextOverrides).where(eq(uiTextOverrides.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      // 🔴 행은 지우지만 문구가 없어진 것이 아니라 기본값으로 돌아간 것이므로
      // UPDATE 로 남긴다. SOFT_DELETE/PURGE 는 자료가 없어졌다는 뜻이라 로그를
      // 읽는 사람에게 오해를 만든다 — ui-theme-tokens.ts 와 같은 판단이다.
      actionType: "UPDATE",
      targetEntity: "ui_text_overrides",
      targetRecordId: previous.id,
      previousValue: { groupKey: group.key, itemKey: item.key, value: previous.value },
      newValue: {
        groupKey: group.key,
        itemKey: item.key,
        value: fallback,
        revertedToDefault: true,
      },
    });
    return 1;
  }

  if (previous?.value === desired) return 0;

  const [saved] = await tx
    .insert(uiTextOverrides)
    .values({
      groupKey: group.key,
      itemKey: item.key,
      value: desired,
      updatedBy: params.actorUserId,
    })
    .onConflictDoUpdate({
      target: [uiTextOverrides.groupKey, uiTextOverrides.itemKey],
      set: { value: desired, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: uiTextOverrides.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "ui_text_overrides",
    targetRecordId: saved.id,
    // 행이 없던 자리의 "이전 값"은 코드의 기본 문구다 — 그때 실제로 통하던 말이
    // 그것이므로, 로그를 읽는 사람이 무엇에서 무엇으로 바뀌었는지 알 수 있다.
    previousValue: { groupKey: group.key, itemKey: item.key, value: previous?.value ?? fallback },
    newValue: { groupKey: group.key, itemKey: item.key, value: desired },
  });
  return 1;
}
