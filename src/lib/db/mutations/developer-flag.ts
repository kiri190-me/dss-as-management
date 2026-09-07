import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";

/**
 * users.is_developer 표시 관리 — 출하 승인 대표 표시(shipment-representatives.ts)와
 * 같은 모양이다: 트랜잭션 안에서 행위자를 다시 읽어 판정하고, 대상을 잠그고
 * (FOR UPDATE), 이미 같은 값이면 CONFLICT, 켤 때만 대상 자격(승인됨·활성·잠기지
 * 않음)을 보고, fail() 로 던져 트랜잭션째 되돌린다. 대표와 다른 점은 넷이다:
 *
 *  1. 🔴 판정은 **진짜 최고관리자만** — actorMay / hasPermission 을 쓰지 않는다.
 *     이 칸이 권한을 최고관리자급으로 올리는 스위치 그 자체라서, 승격된 개발자가
 *     통과하면 개발자가 개발자를 만든다. 「동급」 규칙의 유일하고 의도된 예외다
 *     (auth/developer-flag-authorization.ts — 화면도 **같은 함수**로 판정한다).
 *  2. 마지막 개발자 보호가 없다 — 개발자 모드는 최고관리자에게도 열려 있으므로
 *     개발자가 0명이어도 아무것도 멈추지 않는다.
 *  3. 기록은 audit_logs 에 남긴다 — 전용 이력 표를 만들지 않는다. targetEntity
 *     "users" 는 이 저장소에서 여기가 처음 쓰는 값이다(자유 문자열 칸).
 *  4. 이유(reason)를 받지 않는다 — 켜는 일이 드물고, 감사 기록의 행위자·시각이
 *     곧 이유다.
 *
 * 켠 뒤의 효과는 저절로 난다 — 세션 관문(acting-user.ts)이 요청마다 살아 있는
 * 행을 다시 읽으므로, 그 사람의 **다음 요청부터** 권한과 메뉴가 바뀐다. 세션을
 * 갱신하거나 로그아웃시킬 필요가 없다.
 */

export type DeveloperFlagResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_USER"
  | "DATABASE_UNAVAILABLE";

export type DeveloperFlagResult =
  | { ok: true }
  | { ok: false; code: DeveloperFlagResultCode; message: string };

class DeveloperFlagMutationError extends Error {
  result: DeveloperFlagResult & { ok: false };
  constructor(result: DeveloperFlagResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: DeveloperFlagResultCode, message: string): never {
  throw new DeveloperFlagMutationError({ ok: false, code, message });
}

export async function setDeveloperFlag(
  targetUserId: string,
  flag: boolean,
  actorUserId: string
): Promise<DeveloperFlagResult> {
  try {
    return await db.transaction(async (tx) => {
      // 행위자를 살아 있는 행에서 다시 읽는다 — 토큰의 역할이 아니다. 화면
      // (users/page.tsx)도 살아 있는 행(resolveActingUserForSession)으로 같은
      // 함수를 부르므로, 두 답이 같은 자료에서 나온다.
      const [actor] = await tx
        .select({ role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      // 🔴 행위자의 개발자 표시는 읽지도 않는다 — 읽지 않으면 볼 수도 없다.
      if (!mayManageDeveloperFlag(actor)) {
        fail("FORBIDDEN", "개발자 표시를 변경할 권한이 없습니다.");
      }

      // 대상을 잠그고 다시 읽는다 — 같은 사람에게 동시에 두 번 누른 요청이
      // 정확히 하나의 결과로 끝나게 하는 트랜잭션 뒷받침(두 번째는 여기서
      // 기다렸다가, 커밋된 뒤의 상태를 다시 읽는다).
      const [target] = await tx
        .select({
          id: users.id,
          isDeveloper: users.isDeveloper,
          approvalStatus: users.approvalStatus,
          isActive: users.isActive,
          lockedAt: users.lockedAt,
          isDeleted: users.isDeleted,
        })
        .from(users)
        .where(eq(users.id, targetUserId))
        .for("update");
      if (!target || target.isDeleted) {
        fail("NOT_FOUND", "대상 사용자를 찾을 수 없습니다.");
      }
      if (target.isDeveloper === flag) {
        fail("CONFLICT", flag ? "이미 개발자로 표시되어 있습니다." : "이미 개발자 표시가 꺼져 있습니다.");
      }

      // 켤 때만 대상 자격을 본다. 끄는 것은 누구든 된다 — 승인이 내려가거나
      // 잠긴 계정의 승격을 걷어내는 길이 막혀서는 안 된다.
      if (flag) {
        if (target.approvalStatus !== "APPROVED") {
          fail("INVALID_USER", "승인되지 않은 계정은 개발자로 표시할 수 없습니다.");
        }
        if (!target.isActive) {
          fail("INVALID_USER", "비활성화된 계정은 개발자로 표시할 수 없습니다.");
        }
        if (target.lockedAt !== null) {
          fail("INVALID_USER", "잠긴 계정은 개발자로 표시할 수 없습니다.");
        }
      }

      await tx
        .update(users)
        .set({ isDeveloper: flag, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));

      // 같은 트랜잭션 안에서 남긴다 — 거절되면 위에서 던져져 이 줄에 오지
      // 않고, 여기서 실패하면 위의 갱신도 함께 되돌아간다.
      await insertAuditLog(tx, {
        actorUserId,
        actionType: "UPDATE",
        targetEntity: "users",
        targetRecordId: targetUserId,
        previousValue: { isDeveloper: target.isDeveloper },
        newValue: { isDeveloper: flag },
      });

      return { ok: true };
    });
  } catch (err) {
    if (err instanceof DeveloperFlagMutationError) return err.result;
    throw err;
  }
}
