import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { uiThemeTokens, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { mayEditUiTheme } from "@/lib/auth/ui-theme-authorization";
import {
  checkUiThemeTokenChange,
  findDuplicateUiThemeChange,
  uiThemeDefaultFor,
  type CheckedUiThemeTokenChange,
  type UiThemeTokenChange,
} from "@/lib/validation/ui-theme-token-input";
import {
  contrastRatio,
  resolveUiTheme,
  UI_THEME_CONTRAST_BLOCKING,
  UI_THEME_CONTRAST_FLOOR,
  type UiThemeOverrideRow,
  type UiThemeScope,
} from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 저장
 * ============================================================================
 * saveNotificationSettings 를 본보기로 삼았고, 거기서 이미 내려진 판단들을 그대로
 * 가져왔다. 화면이 보낸 값을 그대로 믿지 않는다 — 화면을 거치지 않고 이 함수를
 * 부를 수 있기 때문이다.
 *
 *  1) **한 트랜잭션.** 한 화면에서 여러 값을 함께 편집하므로, 뒤엣것에서 막혔는데
 *     앞엣것만 저장되는 일은 없어야 한다. 색이 반쯤 적용된 화면은 관리자가 무엇을
 *     되돌려야 하는지 알 수 없는 상태다.
 *  2) **같은 (토큰, 스코프)가 두 번 오면 거절한다.** 어느 쪽이 뜻인지 알 수 없고,
 *     뒤엣것으로 덮어쓰면 화면에서 본 것과 다른 색이 저장될 수 있다.
 *  3) **트랜잭션 안에서 행위자를 다시 읽는다.** 세션이 만들어진 뒤 역할이
 *     내려갔거나 계정이 지워졌을 수 있다.
 *  4) **기본값과 같은 값은 저장하지 않고 지운다.** "기본으로 되돌림"과 "기본과
 *     같은 값을 굳이 적어 둠"이 구별되어야, 나중에 기본 팔레트를 손볼 때 옛 값이
 *     오버라이드로 굳어 아무 화면도 따라 바뀌지 않는 일이 생기지 않는다.
 *  5) 🔴 **모르는 키·안 맞는 스코프·형식이 틀린 값은 무시하지 않고 거절한다.**
 *     알림 설정과 반대로 가는 자리이고, 까닭은 validation/ui-theme-token-input.ts
 *     머리말에 있다.
 *
 * ── 🔴 거절은 반드시 던진다 ─────────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 `return` 하면 **커밋된다.** 그래서 검증을 한 줄씩
 * **트랜잭션 안에서** 하고, 막히면 SaveRejected 를 던져 앞줄까지 통째로
 * 되돌린다(saveRolePermissions · saveNotificationSettings 와 같은 신호).
 *
 * ── 🔴 대비 하한은 「합쳐진 결과」로 잰다 ───────────────────────────────
 * 대비의 짝은 (글자색, 바탕색)인데 사람은 대개 한쪽만 바꾼다. 들어온 값만 재면
 * "글자만 흰색으로 바꿨더니 흰 바탕에 안 보이는" 조합이 그대로 통과한다. 그래서
 * 저장된 행 전부를 읽어 들어온 변경을 얹은 **저장 후의 모습**을 만들고, 그 위에서
 * UI_THEME_CONTRAST_BLOCKING 의 네 짝을 잰다.
 *
 * 경고선(UI_THEME_CONTRAST_WARN, 4.5)은 여기서 막지 않는다 — 그것은 편집 화면이
 * 보여줄 몫이다. 3:1 은 "읽기 불편"과 "아예 안 보임"을 가르는 선이고, 되돌릴 편집
 * 화면 자체를 못 읽게 되는 것만 서버가 막는다.
 *
 * ── .for("update") 를 쓰지 않는 이유 ────────────────────────────────────
 * 없는 행은 잠글 수 없다. 이 표의 기본 상태는 "행이 없음"이므로 잠글 대상이 아예
 * 없는 경우가 대부분이다. 유일성은 (token_key, scope) 유니크 인덱스와
 * onConflictDoUpdate 가 지킨다 — notification_*_settings 와 같다.
 *
 * 감사 기록은 audit_logs 에 남긴다. 행이 (토큰, 스코프) 하나이므로
 * target_record_id 가 "다크의 zinc-900" 하나를 정확히 가리키고, 값 객체에
 * { tokenKey, scope, value } 를 담아 로그만 읽고도 어느 스코프의 어느 토큰이
 * 움직였는지 알 수 있게 한다.
 * ============================================================================
 */

export type SaveUiThemeTokensResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(saveNotificationSettings 의 SaveRejected 와 같은 이유).
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveUiThemeTokensResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

/** 지금 저장돼 있는 행 한 줄 — 대비를 합쳐진 결과로 재기 위한 바탕이다. */
type StoredRow = { tokenKey: string; scope: string; value: string };

export async function saveUiThemeTokens(params: {
  changes: UiThemeTokenChange[];
  actorUserId: string;
}): Promise<SaveUiThemeTokensResult> {
  // 중복은 값이 유효한지와 무관한 판정이라 배열을 한 번 훑는 이 자리에서 본다.
  const duplicate = findDuplicateUiThemeChange(params.changes);
  if (duplicate) return { ok: false, code: "INVALID_INPUT", message: duplicate };
  if (params.changes.length === 0) return { ok: true, changedCount: 0 };

  try {
    return await db.transaction(async (tx): Promise<SaveUiThemeTokensResult> => {
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
      if (!mayEditUiTheme(actor)) {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "개발자 모드에 들어갈 수 있는 사람만 화면 토큰을 바꿀 수 있습니다.",
        });
      }

      // 저장 전의 모습. 아래에서 변경을 얹어 "저장했다면 이렇게 될 목록"을 만든다.
      const stored: StoredRow[] = await tx
        .select({
          tokenKey: uiThemeTokens.tokenKey,
          scope: uiThemeTokens.scope,
          value: uiThemeTokens.value,
        })
        .from(uiThemeTokens);

      let changedCount = 0;
      const checkedChanges: CheckedUiThemeTokenChange[] = [];
      for (const raw of params.changes) {
        // 🔴 한 줄씩 검증하고 곧바로 적용한다. 뒷줄이 막히면 앞줄까지 함께
        // 되돌아가는 것이 이 구조의 요점이다 — 여기서 던지지 않고 반환하면
        // 앞줄이 커밋된 채 남는다.
        const checked = checkUiThemeTokenChange(raw);
        if (!checked.ok) {
          throw new SaveRejected({ ok: false, code: "INVALID_INPUT", message: checked.message });
        }
        checkedChanges.push(checked.change);
        changedCount += await applyOneChange(tx, {
          change: checked.change,
          actorUserId: actor.id,
        });
      }

      // 대비는 마지막에 한 번, 합쳐진 결과로 잰다. 막히면 위에서 적은 것이
      // 전부 되돌아간다.
      const violation = findContrastViolation(stored, checkedChanges);
      if (violation) {
        throw new SaveRejected({ ok: false, code: "INVALID_INPUT", message: violation });
      }

      return { ok: true, changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/** (토큰, 스코프) 한 자리분의 저장. 바뀐 것이 있으면 1, 없으면 0. */
async function applyOneChange(
  tx: Tx,
  params: { change: CheckedUiThemeTokenChange; actorUserId: string }
): Promise<number> {
  const { token, scope } = params.change;
  const fallback = uiThemeDefaultFor(token, scope);

  // 🔴 기본값과 같은 값은 "되돌림"과 같은 길로 보낸다. 굳이 저장해 두면 나중에
  // 기본 팔레트를 손볼 때 옛 값이 오버라이드로 굳어, 아무 화면도 따라 바뀌지 않는다.
  const desired =
    params.change.value === null || params.change.value === fallback ? null : params.change.value;

  const [previous] = await tx
    .select({ id: uiThemeTokens.id, value: uiThemeTokens.value })
    .from(uiThemeTokens)
    .where(and(eq(uiThemeTokens.tokenKey, token.key), eq(uiThemeTokens.scope, scope)));

  if (desired === null) {
    if (!previous) return 0;
    await tx.delete(uiThemeTokens).where(eq(uiThemeTokens.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      // 🔴 행은 지우지만 색이 없어진 것이 아니라 기본값으로 돌아간 것이므로
      // UPDATE 로 남긴다. SOFT_DELETE/PURGE 는 자료가 없어졌다는 뜻이라
      // 로그를 읽는 사람에게 오해를 만든다 — notification-settings.ts 와 같은 판단이다.
      actionType: "UPDATE",
      targetEntity: "ui_theme_tokens",
      targetRecordId: previous.id,
      previousValue: { tokenKey: token.key, scope, value: previous.value },
      newValue: { tokenKey: token.key, scope, value: fallback, revertedToDefault: true },
    });
    return 1;
  }

  if (previous?.value === desired) return 0;

  const [saved] = await tx
    .insert(uiThemeTokens)
    .values({ tokenKey: token.key, scope, value: desired, updatedBy: params.actorUserId })
    .onConflictDoUpdate({
      target: [uiThemeTokens.tokenKey, uiThemeTokens.scope],
      set: { value: desired, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: uiThemeTokens.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "ui_theme_tokens",
    targetRecordId: saved.id,
    // 행이 없던 자리의 "이전 값"은 코드의 기본값이다 — 그때 실제로 통하던 값이
    // 그것이므로, 로그를 읽는 사람이 무엇에서 무엇으로 바뀌었는지 알 수 있다.
    previousValue: { tokenKey: token.key, scope, value: previous?.value ?? fallback },
    newValue: { tokenKey: token.key, scope, value: desired },
  });
  return 1;
}

/**
 * 저장 전의 행 목록 위에 이번 변경을 얹어, "저장했다면 이렇게 될" 행 목록을
 * 만든다. 기본값으로 돌아가는 자리는 목록에서 빠진다 — 행이 지워지기 때문이다.
 */
function buildProspectiveRows(
  stored: readonly StoredRow[],
  changes: readonly CheckedUiThemeTokenChange[]
): UiThemeOverrideRow[] {
  const rows = new Map<string, UiThemeOverrideRow>();
  for (const row of stored) {
    rows.set(`${row.tokenKey}:${row.scope}`, {
      tokenKey: row.tokenKey,
      scope: row.scope as UiThemeScope,
      value: row.value,
    });
  }

  for (const change of changes) {
    const key = `${change.token.key}:${change.scope}`;
    const fallback = uiThemeDefaultFor(change.token, change.scope);
    if (change.value === null || change.value === fallback) {
      rows.delete(key);
      continue;
    }
    rows.set(key, { tokenKey: change.token.key, scope: change.scope, value: change.value });
  }

  return [...rows.values()];
}

/** 하한을 깬 짝이 있으면 그 사실을 알리는 문장, 없으면 null. */
function findContrastViolation(
  stored: readonly StoredRow[],
  changes: readonly CheckedUiThemeTokenChange[]
): string | null {
  const resolved = resolveUiTheme(buildProspectiveRows(stored, changes));

  for (const pair of UI_THEME_CONTRAST_BLOCKING) {
    const ratio = contrastRatio(resolved[pair.scope][pair.fgKey], resolved[pair.scope][pair.bgKey]);
    if (ratio < UI_THEME_CONTRAST_FLOOR) {
      return (
        `${pair.label} 대비가 ${ratio}:1 입니다. ` +
        `${UI_THEME_CONTRAST_FLOOR}:1 미만이면 그 화면을 되돌릴 수조차 없게 되므로 저장하지 않습니다.`
      );
    }
  }

  return null;
}
