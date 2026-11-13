import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { badgeVisibilitySettings, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { mayManageBadgeVisibility } from "@/lib/auth/badge-visibility-authorization";
import { isBadgePlacementAllowed } from "@/lib/domain/badge-visibility";

/**
 * ============================================================================
 * 배지 표시 설정 저장 (2026-11-13, 조각 2)
 * ============================================================================
 * 본보기는 saveUiThemeTokens 다. 거기서 이미 내려진 판단을 그대로 가져왔다 —
 * 화면이 보낸 값을 믿지 않고, 한 트랜잭션으로 묶고, 거절은 **던져서** 되돌린다.
 *
 * ── 🔴 저장 규칙: **끈 것만 행을 남긴다** ───────────────────────────────
 *   · 체크를 **푼** 쌍  → `is_visible = false` 행을 쓴다(없으면 넣고 있으면 고친다)
 *   · 체크가 **된** 쌍  → 🔴 **그 행을 지운다.** true 행을 남기지 않는다.
 *
 * 까닭은 이 기능의 초기 상태가 **빈 표**이기 때문이다. 빈 표 = 전부 보임이라야
 * 「아무것도 안 건드린 시스템」과 「전부 켜 둔 시스템」이 같아진다. true 행을 남기면
 * 둘이 갈라지고, 그때 배지가 하나 늘거나 뜨는 자리가 바뀌면 **아무도 만진 적 없는
 * 옛 행**이 "사람이 켜 둔 값"처럼 남는다(스키마 머리말의 '행을 미리 심지 않는다').
 * ui_theme_tokens 가 기본값과 같은 값을 저장하지 않고 지우는 것과 같은 모양이다.
 *
 * 🔵 그래서 「되돌리기」가 곧 「행 삭제」다. 감사 기록은 그래도 **UPDATE** 로 남긴다 —
 * 자료가 없어진 것이 아니라 기본값(보임)으로 돌아간 것이고, SOFT_DELETE/PURGE 는
 * 로그를 읽는 사람에게 다른 뜻으로 읽힌다(ui-theme-tokens.ts 와 같은 판단).
 *
 * ── 🔴 등록부에 없는 쌍은 **무시가 아니라 거절**이다 ────────────────────
 * 화면은 29쌍만 보내지만, 이 함수는 화면을 거치지 않고도 불릴 수 있다. 모르는 쌍을
 * 조용히 버리면 "저장했다는데 아무 일도 안 일어난" 상태가 되고, 그 행이 들어가면
 * 판정(isBadgeVisible)이 영영 안 보는 쓰레기 행이 쌓인다. ui-theme 쪽이 모르는
 * 토큰을 거절하는 것과 같은 선이다.
 *
 * ── 🔴 한 트랜잭션 ──────────────────────────────────────────────────────
 * 29개 중 몇 개만 반영된 상태를 만들지 않는다. 관리자는 무엇이 들어가고 무엇이
 * 안 들어갔는지 화면에서 알 수 없고, 반쯤 적용된 배지 설정은 되돌릴 기준도 없다.
 * 🔴 트랜잭션 콜백에서 그냥 `return` 하면 **커밋된다** — 그래서 막히는 자리에서는
 * SaveRejected 를 던진다(saveUiThemeTokens · saveRolePermissions 와 같은 신호).
 *
 * ── 🔴 트랜잭션 안에서 행위자를 다시 읽고 권한을 다시 본다 ──────────────
 * 세션이 만들어진 뒤 역할이 내려갔거나 계정이 지워졌을 수 있다. 서버 액션이 이미
 * 같은 질문을 했지만 겹쳐 둔다 — 액션을 거치지 않고 이 함수를 부를 수 있다.
 *
 * ── .for("update") 를 쓰지 않는 이유 ────────────────────────────────────
 * 없는 행은 잠글 수 없고, 이 표의 기본 상태가 바로 "행이 없음"이다. 유일성은
 * (badge_key, place_key) 유니크 인덱스와 onConflictDoUpdate 가 지킨다
 * (ui_theme_tokens · notification_*_settings 와 같다).
 * ============================================================================
 */

/** 감사 기록의 대상 이름. 시험과 저장이 같은 글자를 쓴다. */
export const BADGE_VISIBILITY_AUDIT_ENTITY = "badge_visibility_settings";

/** 화면이 보내는 한 줄. 🔴 **바뀐 쌍만** 보낸다(액션 주석). */
export type BadgeVisibilityPlacementInput = {
  badgeKey: string;
  placeKey: string;
  /** 참 = 보임(행을 지운다) · 거짓 = 숨김(행을 쓴다). */
  isVisible: boolean;
};

export type SaveBadgeVisibilitySettingsResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(saveUiThemeTokens 의 SaveRejected 와 같은 이유).
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveBadgeVisibilitySettingsResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

/** 같은 쌍이 두 번 왔으면 그 사실을 알리는 문장, 없으면 null. */
function findDuplicatePlacement(
  placements: readonly BadgeVisibilityPlacementInput[]
): string | null {
  const seen = new Set<string>();
  for (const placement of placements) {
    // 배지 키도 자리 키도 공백 없는 영문 식별자라 이어 붙인 글자가 다른 쌍의 것과
    // 겹칠 수 없다(domain/badge-visibility.ts 의 같은 판단).
    const key = `${placement.badgeKey} ${placement.placeKey}`;
    if (seen.has(key)) {
      return `같은 배지·자리가 두 번 들어왔습니다 — ${placement.badgeKey} / ${placement.placeKey}`;
    }
    seen.add(key);
  }
  return null;
}

export async function saveBadgeVisibilitySettings(params: {
  placements: BadgeVisibilityPlacementInput[];
  actorUserId: string;
}): Promise<SaveBadgeVisibilitySettingsResult> {
  // 값 판정은 DB 와 무관하므로 트랜잭션을 열기 전에 끝낸다. 어느 쪽이 뜻인지 알 수
  // 없는 입력을 뒤엣것으로 덮어쓰면, 화면에서 본 것과 다른 값이 저장될 수 있다.
  const duplicate = findDuplicatePlacement(params.placements);
  if (duplicate) return { ok: false, code: "INVALID_INPUT", message: duplicate };

  for (const placement of params.placements) {
    if (!isBadgePlacementAllowed(placement.badgeKey, placement.placeKey)) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `이 배지는 그 자리에 뜨지 않습니다 — ${placement.badgeKey} / ${placement.placeKey}`,
      };
    }
  }

  // 🔴 여기서 일찍 돌아가도 권한 검사를 건너뛰지 않는다 — 바꿀 것이 없으면 쓰지도
  //    않으므로 막을 것이 없고, 권한 없는 사람에게 "무엇이 저장돼 있는가"를 알려
  //    주지도 않는다(빈 입력에 대한 답은 언제나 "바뀐 것 없음" 하나다).
  if (params.placements.length === 0) return { ok: true, changedCount: 0 };

  try {
    return await db.transaction(async (tx): Promise<SaveBadgeVisibilitySettingsResult> => {
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
      if (!(await mayManageBadgeVisibility(actor))) {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "시스템 설정을 관리할 수 있는 사람만 배지 표시를 바꿀 수 있습니다.",
        });
      }

      let changedCount = 0;
      for (const placement of params.placements) {
        changedCount += await applyOnePlacement(tx, { placement, actorUserId: actor.id });
      }
      return { ok: true, changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/** (배지, 자리) 한 쌍분의 저장. 실제로 바뀐 것이 있으면 1, 없으면 0. */
async function applyOnePlacement(
  tx: Tx,
  params: { placement: BadgeVisibilityPlacementInput; actorUserId: string }
): Promise<number> {
  const { badgeKey, placeKey, isVisible } = params.placement;

  const [previous] = await tx
    .select({ id: badgeVisibilitySettings.id, isVisible: badgeVisibilitySettings.isVisible })
    .from(badgeVisibilitySettings)
    .where(
      and(
        eq(badgeVisibilitySettings.badgeKey, badgeKey),
        eq(badgeVisibilitySettings.placeKey, placeKey)
      )
    );

  // ── 보임: 행을 지운다 ──────────────────────────────────────────────────
  if (isVisible) {
    if (!previous) return 0;
    await tx.delete(badgeVisibilitySettings).where(eq(badgeVisibilitySettings.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      // 행은 지우지만 설정이 없어진 것이 아니라 기본값(보임)으로 돌아간 것이다
      // (머리말). SOFT_DELETE/PURGE 는 자료가 사라졌다는 뜻이라 오해를 만든다.
      actionType: "UPDATE",
      targetEntity: BADGE_VISIBILITY_AUDIT_ENTITY,
      targetRecordId: previous.id,
      previousValue: { badgeKey, placeKey, isVisible: previous.isVisible },
      newValue: { badgeKey, placeKey, isVisible: true, revertedToDefault: true },
    });
    return 1;
  }

  // ── 숨김: 행을 쓴다 ────────────────────────────────────────────────────
  // 이미 숨김이면 아무것도 하지 않는다 — 같은 값을 다시 적으면 updated_at 과 감사
  // 기록만 늘어나고, 그 기록을 읽는 사람은 누군가 무언가 바꿨다고 읽는다.
  if (previous && previous.isVisible === false) return 0;

  const [saved] = await tx
    .insert(badgeVisibilitySettings)
    .values({ badgeKey, placeKey, isVisible: false, updatedBy: params.actorUserId })
    .onConflictDoUpdate({
      target: [badgeVisibilitySettings.badgeKey, badgeVisibilitySettings.placeKey],
      set: { isVisible: false, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: badgeVisibilitySettings.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: BADGE_VISIBILITY_AUDIT_ENTITY,
    targetRecordId: saved.id,
    // 행이 없던 자리의 "이전 값"은 보임이다 — 그때 실제로 화면에 뜨던 모습이
    // 그것이므로, 로그만 읽고도 무엇에서 무엇으로 바뀌었는지 알 수 있다.
    previousValue: { badgeKey, placeKey, isVisible: previous?.isVisible ?? true },
    newValue: { badgeKey, placeKey, isVisible: false },
  });
  return 1;
}
