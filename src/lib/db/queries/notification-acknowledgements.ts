import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { notificationAcknowledgements } from "../schema";

/**
 * ============================================================================
 * 알림 확인 — 「이 알림들 중 이 사람이 이미 확인한 것」
 * ============================================================================
 * 정보성 알림을 종에 띄우기 직전에 부른다(다음 조각). 파생된 알림들의 id 를 넘기면
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
}
