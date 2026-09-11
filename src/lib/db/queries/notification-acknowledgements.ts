import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { notificationAcknowledgements } from "../schema";

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/**
 * 「표 없음」 오류인가. Drizzle 은 드라이버 오류를 "Failed query: …" 로 한 겹 감싸
 * 코드를 `.cause` 에 싣는다 — 겉 오류만 보면 코드가 없어 언제나 거짓이 된다. 그래서
 * 사슬을 몇 겹 따라 내려가며 본다(queries/inventory-part-issue-requests.integration
 * .test.ts 의 findPgError 와 같은 방법이다). 이 파일 밖에서는 통합 시험만 부른다.
 */
export function isUndefinedTableError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === UNDEFINED_TABLE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * ============================================================================
 * 알림 확인 — 「이 알림들 중 이 사람이 이미 확인한 것」
 * ============================================================================
 * 정보성 알림을 종에 띄우기 직전에 부른다(db/queries/notifications.ts 의
 * withoutAcknowledged). 파생된 알림들의 id 를 넘기면
 * 그중 **이 사람이** 이미 눌러 확인한 것만 Set 으로 돌려준다 — 부르는 쪽은 그 Set
 * 에 든 것을 빼고 그린다.
 *
 * ── 🔴 반드시 userId 로 좁힌다 ──────────────────────────────────────────
 * 알림 키는 사람마다 따로 만들어지지 않는다 — 같은 결재의 「승인 완료」는 누구의
 * 종에서든 같은 키일 수 있다. 그래서 키로만 물으면 **남이 확인한 기록 때문에 내
 * 알림이 사라진다.** 이 함수의 WHERE 는 언제나 `user_id = ? AND notification_key IN
 * (…)` 이고, userId 를 빼는 변형을 두지 않는다.
 *
 * ── 넘긴 키로만 묻는다 ──────────────────────────────────────────────────
 * 그 사람의 확인 기록 전부를 읽지 않는다. 확인 기록은 지우지 않고 쌓이므로(스키마
 * 머리말) 전부 읽으면 쓸수록 느려진다. 「지금 띄우려는 알림」의 키로만 물으면 읽는
 * 양이 종에 뜰 알림 수를 넘지 않고, 7일 창 밖의 오래된 행은 읽히지도 않는다.
 * (user_id, notification_key) 유니크 인덱스가 이 조회를 그대로 받는다.
 *
 * ── 표가 아직 없으면 「확인한 것 없음」으로 답한다 ─────────────────────────
 * 이 조회는 (app)/layout.tsx 가 모든 화면을 그릴 때마다 종 알림을 만들며 부른다.
 * 코드가 마이그레이션(0091)보다 먼저 올라간 DB 에서 여기서 예외를 그대로 던지면
 * **모든 화면이 한꺼번에 죽는다.** 표가 없다는 것은 확인 기록이 존재할 수 없다는
 * 뜻이므로 빈 Set 이 사실 그대로의 답이다 — 결재 결과 알림이 확인해도 사라지지
 * 않을 뿐(확인 액션이 저장에 실패해 알림이 남는다) 화면은 산다.
 * notification-settings.ts · ui-text-overrides.ts 가 자기 표에 하는 것과 같은 관례다.
 *
 * 「표 없음」 하나만 삼킨다. 연결 실패·권한 오류·형식 오류까지 조용히 넘기면 확인한
 * 알림이 이유 없이 되살아나고, 그 원인을 로그에서 찾을 길이 없다.
 * ============================================================================
 */
export async function listAcknowledgedNotificationKeys(
  userId: string,
  keys: readonly string[]
): Promise<Set<string>> {
  // 물을 것이 없으면 DB 를 부르지 않는다 — 정보성 알림이 하나도 없는 사람(대부분의
  // 요청)에게 매 페이지마다 빈 IN 조회를 돌리지 않는다. 빈 배열로 inArray 를 만들지
  // 않는 것이기도 하다.
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return new Set();

  try {
    const rows = await db
      .select({ notificationKey: notificationAcknowledgements.notificationKey })
      .from(notificationAcknowledgements)
      .where(
        and(
          eq(notificationAcknowledgements.userId, userId),
          inArray(notificationAcknowledgements.notificationKey, uniqueKeys)
        )
      );

    return new Set(rows.map((row) => row.notificationKey));
  } catch (err) {
    if (isUndefinedTableError(err)) {
      console.warn(
        "notification_acknowledgements 테이블이 없습니다 — 마이그레이션 적용 전까지 확인 기록 없이 동작합니다."
      );
      return new Set();
    }
    throw err;
  }
}
