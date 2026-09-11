import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { domesticOrderSheetSettings, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
  isDefaultDomesticOrderSheetHeading,
  validateDomesticOrderSheetHeadingInput,
  type DomesticOrderSheetHeadingFieldErrors,
  type DomesticOrderSheetHeadingText,
} from "@/lib/domain/domestic-order-sheet-heading";

/**
 * ============================================================================
 * 내자 정리 머리말 저장 (2026-09-11)
 * ============================================================================
 * 본보기는 접수 알림 메일 설정 저장(saveIntakeMailSettings)이다 — 행 하나짜리 설정을
 * **한 트랜잭션**에서 "없으면 INSERT, 있으면 UPDATE" 한다. 거기에 셋을 더했다:
 *
 *  1) **기본 문구로 저장하면 행을 지운다.** 메일 설정에는 [기본값으로]가 없어 따를
 *     관례가 없었고, 같은 모양의 「행이 없다 = 코드 기본값」 표인 ui_text_overrides
 *     의 규칙을 가져왔다: 기본 문구와 같은 값을 굳이 행으로 남기면, 나중에 코드의
 *     기본 문구를 손볼 때 옛 문구가 설정으로 굳어 화면이 따라 바뀌지 않는다. 판정은
 *     정규화 뒤의 값으로 하고, 인사문과 메모가 **둘 다** 기본일 때만 지운다(한 행에
 *     두 칸이 함께 있다).
 *  2) **동시 저장 경합.** 메일 설정은 SELECT 뒤 INSERT 라, 두 사람이 처음 저장을
 *     동시에 누르면 뒤엣것이 유니크 위반으로 터진다. 여기서는 있는 행을
 *     `FOR UPDATE` 로 잠그고, 없으면 `ON CONFLICT DO NOTHING` 으로 넣어 본 뒤 졌으면
 *     (남이 먼저 넣었으면) 그 행을 다시 잠가 UPDATE 로 간다. 결과는 **나중에 저장한
 *     쪽이 이긴다** — 메일 설정과 같은 뜻이고, 감사 로그의 "이전 값"은 언제나 실제로
 *     덮어쓴 값이다(잠근 뒤에 읽으므로).
 *  3) **트랜잭션 안에서 행위자를 다시 읽고 권한을 다시 본다.** 서버 액션이 이미
 *     보지만, 이 함수를 액션을 거치지 않고 부를 수 있다(ui-text-overrides.ts 와 같은
 *     판단). 관문은 행 추가·수정과 같다 — hasPermission("domesticOrders", "WRITE").
 *
 * ── 🔴 거절은 던진다 ────────────────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 return 하면 **커밋된다.** 막히는 자리에서는 SaveRejected 를
 * 던져 통째로 되돌린다(ui-text-overrides.ts 와 같은 신호).
 *
 * ── 감사 로그에는 문구 전문을 남긴다 ─────────────────────────────────────
 * 메일 설정은 "길고 읽기 어렵다"며 문구를 뺐지만, 여기서 바뀌는 것은 **문구뿐**이라
 * 빼면 기록이 "누가 언제 뭔가 바꿨다"만 남아 되돌릴 방법이 없다. 화면 문구
 * (ui_text_overrides)가 값을 담는 것과 같은 판단이다. 상한이 2000 + 500자라 한
 * 기록이 무한히 커지지도 않는다. 인사문에 담당자 이름이 들어 있지만 사람이 직접
 * 적어 고객사에 보내는 공지 문구이고, audit_logs 는 이미 내자 정리 줄의 스냅숏을
 * 담는 곳이다. 서버 로그(console)에는 싣지 않는다(액션 쪽 주석).
 *
 *  - 처음 저장: CREATE. 이전 값은 코드의 기본 문구다 — 그때 실제로 통하던 글이다.
 *  - 다시 저장: UPDATE. 바뀐 것이 없으면 기록도 남기지 않는다.
 *  - 기본 문구로: 행을 지우지만 **UPDATE** 로 남기고 revertedToDefault: true 를 단다.
 *    SOFT_DELETE/PURGE 는 자료가 없어졌다는 뜻이라 로그를 읽는 사람을 속인다
 *    (ui-text-overrides.ts 와 같은 판단).
 * ============================================================================
 */

export const DOMESTIC_ORDER_SHEET_SETTINGS_AUDIT_ENTITY = "domestic_order_sheet_settings";

export type SaveDomesticOrderSheetHeadingResult =
  | {
      ok: true;
      /** 저장된 값이 실제로 바뀌었는가. 같은 글을 다시 저장하면 거짓이다. */
      changed: boolean;
      /** 기본 문구로 돌아가 행이 없는 상태가 됐는가. */
      revertedToDefault: boolean;
    }
  | {
      ok: false;
      code: "FORBIDDEN" | "INVALID_INPUT";
      message: string;
      fieldErrors?: DomesticOrderSheetHeadingFieldErrors;
    };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveDomesticOrderSheetHeadingResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

type LockedRow = { id: string } & DomesticOrderSheetHeadingText;

/** 지금 있는 행을 잠가 읽는다. 없으면 null(없는 행은 잠글 수 없다 — 아래 INSERT 가 맡는다). */
async function lockCurrentRow(tx: Tx): Promise<LockedRow | null> {
  const [row] = await tx
    .select({
      id: domesticOrderSheetSettings.id,
      greetingText: domesticOrderSheetSettings.greetingText,
      internalMemo: domesticOrderSheetSettings.internalMemo,
    })
    .from(domesticOrderSheetSettings)
    .where(eq(domesticOrderSheetSettings.singleton, true))
    .for("update");
  return row ?? null;
}

function snapshot(value: DomesticOrderSheetHeadingText): DomesticOrderSheetHeadingText {
  return { greetingText: value.greetingText, internalMemo: value.internalMemo };
}

export async function saveDomesticOrderSheetHeading(params: {
  greetingText: string;
  internalMemo: string;
  actorUserId: string;
}): Promise<SaveDomesticOrderSheetHeadingResult> {
  // 값 판정은 DB 와 무관하므로 트랜잭션을 열기 전에 한다. 액션이 이미 봤어도 다시
  // 본다 — 이 함수가 받는 값은 정규화 전일 수 있고, 저장되는 값은 언제나 정규화된
  // 것이어야 한다.
  const validation = validateDomesticOrderSheetHeadingInput({
    greetingText: params.greetingText,
    internalMemo: params.internalMemo,
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "입력값을 확인해 주세요.",
      fieldErrors: validation.fieldErrors,
    };
  }
  const desired = validation.data;
  const wantsDefault = isDefaultDomesticOrderSheetHeading(desired);

  try {
    return await db.transaction(async (tx): Promise<SaveDomesticOrderSheetHeadingResult> => {
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
      if (!(await hasPermission(actor, "domesticOrders", "WRITE"))) {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "내자 정리를 고칠 수 있는 사람만 머리말을 바꿀 수 있습니다.",
        });
      }

      let current = await lockCurrentRow(tx);

      // ── 기본 문구로: 행이 있으면 지운다 ──────────────────────────────────
      if (wantsDefault) {
        if (!current) return { ok: true, changed: false, revertedToDefault: true };
        await tx.delete(domesticOrderSheetSettings).where(eq(domesticOrderSheetSettings.id, current.id));
        await insertAuditLog(tx, {
          actorUserId: actor.id,
          actionType: "UPDATE",
          targetEntity: DOMESTIC_ORDER_SHEET_SETTINGS_AUDIT_ENTITY,
          targetRecordId: current.id,
          previousValue: snapshot(current),
          newValue: { ...snapshot(DEFAULT_DOMESTIC_ORDER_SHEET_HEADING), revertedToDefault: true },
        });
        return { ok: true, changed: true, revertedToDefault: true };
      }

      // ── 처음 저장: INSERT. 남이 먼저 넣었으면 UPDATE 로 간다 ──────────────
      if (!current) {
        const [created] = await tx
          .insert(domesticOrderSheetSettings)
          .values({ ...desired, singleton: true, updatedBy: actor.id })
          .onConflictDoNothing({ target: domesticOrderSheetSettings.singleton })
          .returning({ id: domesticOrderSheetSettings.id });
        if (created) {
          await insertAuditLog(tx, {
            actorUserId: actor.id,
            actionType: "CREATE",
            targetEntity: DOMESTIC_ORDER_SHEET_SETTINGS_AUDIT_ENTITY,
            targetRecordId: created.id,
            // 행이 없던 때 실제로 화면에 나가던 글은 코드의 기본 문구다.
            previousValue: snapshot(DEFAULT_DOMESTIC_ORDER_SHEET_HEADING),
            newValue: snapshot(desired),
          });
          return { ok: true, changed: true, revertedToDefault: false };
        }
        // 충돌 = 다른 세션이 방금 행을 넣고 커밋했다. 새 문장이라 그 행이 보인다.
        current = await lockCurrentRow(tx);
        if (!current) {
          throw new Error("domestic_order_sheet_settings: 충돌 뒤 행을 찾지 못했습니다.");
        }
      }

      // ── 다시 저장: UPDATE ────────────────────────────────────────────────
      if (current.greetingText === desired.greetingText && current.internalMemo === desired.internalMemo) {
        return { ok: true, changed: false, revertedToDefault: false };
      }
      await tx
        .update(domesticOrderSheetSettings)
        .set({ ...desired, updatedBy: actor.id, updatedAt: new Date() })
        .where(eq(domesticOrderSheetSettings.id, current.id));
      await insertAuditLog(tx, {
        actorUserId: actor.id,
        actionType: "UPDATE",
        targetEntity: DOMESTIC_ORDER_SHEET_SETTINGS_AUDIT_ENTITY,
        targetRecordId: current.id,
        previousValue: snapshot(current),
        newValue: snapshot(desired),
      });
      return { ok: true, changed: true, revertedToDefault: false };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}
