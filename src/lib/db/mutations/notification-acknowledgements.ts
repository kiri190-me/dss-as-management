import "server-only";

import { db } from "../client";
import { notificationAcknowledgements } from "../schema";
import { checkNotificationAcknowledgementKey } from "@/lib/domain/notification-acknowledgement";

/**
 * ============================================================================
 * 알림 확인 — 「이 사람이 이 알림을 눌러 확인했다」를 적는다
 * ============================================================================
 * 표의 뜻과 칸 구성은 schema/notification-acknowledgements.ts 머리말에 있다.
 *
 * ── 🔴 userId 는 믿을 수 있는 쪽에서만 온다 ──────────────────────────────
 * 이 함수는 받은 userId 를 그대로 적는다 — 「이 사람이 누구인가」를 여기서 다시
 * 판정하지 않는다. 부르는 쪽(server/actions/notification-acknowledgements.ts)이
 * **세션에서** 푼 살아 있는 계정의 id 만 넘긴다. 화면이 보낸 사용자 id 를 여기로
 * 흘려보내는 길을 만들면, 남의 종에서 알림을 대신 지우는 입구가 된다.
 *
 * ── 두 번 눌러도 한 줄, 두 번째도 성공 ──────────────────────────────────
 * `INSERT … ON CONFLICT (user_id, notification_key) DO NOTHING`. 두 기기에서 거의
 * 동시에 누르거나, 느린 화면에서 두 번 눌러도 유니크 인덱스가 한 줄로 막고 둘 다
 * 성공으로 끝난다. 사람이 원한 것은 「사라져라」이고, 이미 사라져 있으면 그것으로
 * 이룬 것이다 — 두 번째를 오류로 돌려주면 화면이 없는 문제를 사람에게 보여 준다.
 * 처음 확인한 시각(acknowledged_at)도 덮어쓰지 않는다.
 *
 * ── 감사 로그를 남기지 않는다 ───────────────────────────────────────────
 * 알림을 눌러 본 일은 업무 자료를 한 칸도 움직이지 않는다. 결재·재고·접수 어느
 * 것도 바뀌지 않고, 바뀌는 것은 한 사람의 종 화면뿐이다. audit_logs 는 3년 보존
 * 대상인 업무 변경의 흔적이라, 여기서 남기면 사람당 하루 몇 줄씩 의미 없는 행이
 * 감사 기록 사이에 쌓인다. (이 저장소에는 mutation 이 감사 로그를 남기는지 검사하는
 * 가드가 없다 — test-cleanup-static-safety 는 시험의 뒷정리만 본다.)
 *
 * 트랜잭션도 쓰지 않는다 — 문장이 하나뿐이다.
 * ============================================================================
 */

export type AcknowledgeNotificationResult =
  | {
      ok: true;
      /** 이번에 새로 적었으면 true, 이미 확인한 것이었으면 false. 둘 다 성공이다. */
      newlyAcknowledged: boolean;
    }
  | { ok: false; code: "INVALID_INPUT"; message: string };

export async function acknowledgeNotification(params: {
  userId: string;
  notificationKey: string;
}): Promise<AcknowledgeNotificationResult> {
  // 입구(서버 액션)가 이미 본 형식·종류를 여기서 한 번 더 본다 — 이 함수를 액션을
  // 거치지 않고 부르는 길이 생겨도 표에 아무 글이나, 할 일 알림의 키가 적히지
  // 않도록(눌러서 확인하는 종류만 통과한다). 같은 함수라 두 곳의 판정이 갈라질 수
  // 없다.
  const checked = checkNotificationAcknowledgementKey(params.notificationKey);
  if (!checked.ok) return { ok: false, code: "INVALID_INPUT", message: checked.message };

  const inserted = await db
    .insert(notificationAcknowledgements)
    .values({ userId: params.userId, notificationKey: checked.key })
    .onConflictDoNothing({
      target: [notificationAcknowledgements.userId, notificationAcknowledgements.notificationKey],
    })
    .returning({ id: notificationAcknowledgements.id });

  return { ok: true, newlyAcknowledged: inserted.length > 0 };
}
