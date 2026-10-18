import "server-only";

import {
  setDomesticOrderCompletion,
  type DomesticOrderMutationResultCode,
} from "@/lib/db/mutations/domestic-orders";
import { revertShipmentCompletion } from "@/lib/db/mutations/workflow-transitions";
import { getDomesticOrderShipmentLink } from "@/lib/db/queries/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 [완료 해제] — 붙어 있는 수리 건의 출하 완료도 함께 되돌린다 (2026-10-18)
 * ============================================================================
 * 바로 앞 조각이 만든 complete-domestic-order.ts 의 **거울**이다. 그쪽이
 * [완료 처리] 한 번으로 수리 건을 출하 완료까지 넘기므로, 푸는 쪽도 한 번에
 * 되돌아가야 한다 — 그러지 않으면 사람이 푼 줄에 출하 완료된 수리 건이 그대로
 * 남고, 두 곳이 다시 어긋난다. 사용자 결정(2026-10-18)이다.
 *
 * 🔴 **되돌리는 일은 transitionWorkflow 가 하지 못한다.** 출하 완료는
 * `is_locked = true` 를 찍고 그 잠금이 모든 전이를 막는다(CASE_LOCKED). 그래서
 * 전용 mutation 을 따로 쓴다(mutations/workflow-transitions.ts 의
 * revertShipmentCompletion — 그 함수 머리말에 되돌아갈 단계를 어떻게 찾는지와
 * 역할을 무엇으로 보는지가 있다).
 *
 * ── 왜 서비스 계층인가 ──────────────────────────────────────────────────
 * [완료 처리] 쪽과 같은 까닭이다 — 여기서 하는 일은 「두 mutation 을 어떤
 * 차례로 부를지」이고, 그 차례 자체가 규칙이다. 서버 액션(인증·형식 검증·오류
 * 가리기)도, mutation(한 트랜잭션 안의 업무 규칙)도 아니다.
 *
 * 이 함수는 **권한을 보지 않는다.** domesticOrders WRITE 는 서버 액션이
 * (actions/domestic-orders.ts), 그 전이를 되돌릴 수 있는 역할인가는
 * revertShipmentCompletion 이 트랜잭션 안에서 본다.
 *
 * ── 네 갈래 ─────────────────────────────────────────────────────────────
 *  1. 붙은 수리 건이 없다(연결 없음 · 휴지통) → 내자 줄만 해제한다(예전과 같다).
 *  2. 그 건이 출하 완료 상태가 아니다          → 건너뛰고 내자 줄만 해제한다.
 *  3. 그 밖                                    → 수리 건을 **먼저** 되돌리고,
 *                                                 성공했을 때만 내자 줄을 해제한다.
 *  4. 되돌리지 못했다                          → 🔴 **내자 줄도 해제하지 않는다.**
 *                                                 막힌 까닭을 그대로 올려 보낸다.
 *
 * ── 🔴 왜 수리 건을 먼저 하는가 ─────────────────────────────────────────
 * [완료 처리] 쪽과 **같은 논리**다. 두 작업은 서로 다른 트랜잭션이라(각자 제
 * 트랜잭션을 열고 닫는다) 둘 사이에서 서버가 죽으면 반쪽이 남는다. 어느 반쪽이
 * 남느냐를 고르는 것이 이 차례다.
 *
 *  · 수리 건 먼저 → 「수리 건은 되돌아갔고, 내자 줄은 아직 완료 표시」가 남는다.
 *    그 줄에는 여전히 [완료 해제] 단추가 있으므로 사람이 **다시 누르면** 위
 *    2번으로 들어가 건너뛰고 내자 줄만 풀린다. 스스로 복구된다.
 *  · 내자 줄 먼저 → 「내자 줄은 풀렸고, 수리 건은 출하 완료인 채」가 남는다.
 *    풀린 줄의 단추는 [완료 처리]라 다시 눌러도 이 경로로 돌아오지 못한다.
 *    **복구할 길이 없다.**
 *
 * 그래서 2번 갈래는 쓸데없는 호출을 아끼는 최적화가 아니라 **재시도가 성립하게
 * 만드는 장치**다. 지우지 마라.
 *
 * ── expectedVersion 은 두 곳에서 뜻이 다르다 ────────────────────────────
 * 🔴 수리 건 쪽에 넘기는 값은 **서버가 방금 읽은 값**이다. 누르는 사람은 수리
 * 건 화면이 아니라 내자 줄을 보고 있어 「내가 본 수리 건이 그 사이 바뀌었나」라는
 * 질문 자체가 성립하지 않는다. 즉 그 검사는 이 경로에서 통과만 한다 —
 * [완료 처리] 쪽과 똑같고, 조용히 넘기면 다음 사람이 여기에도 잠금이 걸려 있다고
 * 믿게 되므로 분명히 적어 둔다.
 *
 * 🔵 **내자 줄 자체의 expectedVersion 은 다르다.** 그쪽은 사람이 보고 있던 줄의
 * version 을 화면이 보내 온 것이라 검사가 그대로 유효하다.
 *
 * ── 🔴 되돌린 뒤 다시 출하 완료하려면 승인을 다시 받아야 한다 ───────────
 * 되돌리기는 수리 건의 version 을 올린다. 최종 출하 승인은 요청 시점의 version
 * 에 묶여 있으므로(mutations/workflow-transitions.ts 의 승인 검사), 되돌린
 * 건을 다시 내보낼 때는 **수리 검수 승인부터 다시** 받아야 한다. 이 서비스가
 * 만들어 낸 규칙이 아니라 원래 있던 「승인은 한 번 쓰면 소모된다」가 그대로
 * 작용하는 것이다.
 *
 * ── 메모는 자동으로 적는다 ──────────────────────────────────────────────
 * 사람에게 또 적게 할 이유가 없으므로 아래 고정 문구를 넘긴다. 문구에 **어디서
 * 비롯된 일인지**가 들어 있어야 한다 — 나중에 이력을 보는 사람이 「사람이 수리
 * 건 화면에서 되돌렸나, 내자에서 따라온 것인가」를 그 한 줄로 가른다.
 * ============================================================================
 */

/** 수리 건 이력에 남는 메모. 이 글자가 곧 「내자에서 따라온 것」의 표시다. */
export const DOMESTIC_ORDER_SHIPMENT_REVERT_REASON =
  "내자 정리에서 [완료 해제]를 눌러 출하 완료가 자동으로 취소되었습니다.";

export type ReleaseDomesticOrderResultCode =
  | DomesticOrderMutationResultCode
  /**
   * 붙어 있는 수리 건의 출하 완료를 되돌리지 못했다 — 그래서 내자 줄의 완료
   * 표시도 그대로다. 코드 이름은 [완료 처리] 쪽과 **일부러 같다**: 화면이
   * 보는 것은 「수리 건 때문에 아무것도 저장되지 않았다」는 한 가지 사실이고,
   * 어느 방향인지는 화면이 이미 안다(지금 누른 단추가 무엇인지). 메시지 글자를
   * 비교하지 않는다 — 막힌 까닭마다 서버가 돌려주는 문장이 다르다.
   */
  | "SHIPMENT_COMPLETION_BLOCKED";

export type ReleaseDomesticOrderResult =
  | {
      ok: true;
      id: string;
      version: number;
      /** 이번에 수리 건의 출하 완료까지 되돌렸는가. 화면의 성공 문구가 갈린다. */
      repairCaseShipmentReverted: boolean;
    }
  | { ok: false; code: ReleaseDomesticOrderResultCode; message: string };

export async function releaseDomesticOrderWithShipment(params: {
  id: string;
  /** 🔵 **내자 줄**의 version. 화면이 보고 있던 줄의 값 그대로다. */
  expectedVersion: number;
  actorUserId: string;
}): Promise<ReleaseDomesticOrderResult> {
  // ── 1 · 내자 줄에 지금 무엇이 붙어 있는지 읽는다 ────────────────────────
  //    [완료 처리] 쪽과 **같은 조회**를 쓴다 — 「출하 완료인가」를 두 곳에서
  //    서로 다르게 판정하면 한쪽이 건너뛰는 사이 다른 쪽이 손을 댄다.
  const link = await getDomesticOrderShipmentLink(params.id);

  // ── 2 · 붙은 수리 건이 없거나(1번) 출하 완료가 아니면(2번) 줄만 푼다 ────
  //    줄 자체가 없을 때도 여기로 온다 — 그 판정은 아래 mutation 이 트랜잭션
  //    안에서 다시 읽어 NOT_FOUND 로 돌려준다(두 곳에서 같은 판정을 하지 않는다).
  if (!link || !link.isShipmentCompleted) {
    return releaseDomesticOrderOnly(params, false);
  }

  // ── 3 · 수리 건을 **먼저** 되돌린다 ─────────────────────────────────────
  const reverted = await revertShipmentCompletion(
    link.repairCaseId,
    // 🔴 방금 읽은 값이다 — 위 'expectedVersion 은 두 곳에서 뜻이 다르다'.
    link.repairCaseVersion,
    params.actorUserId,
    DOMESTIC_ORDER_SHIPMENT_REVERT_REASON
  );
  if (!reverted.ok) {
    // 🔴 여기서 멈춘다. 내자 줄은 손대지 않는다 — 완료 표시만 먼저 풀리면
    // 사람은 되돌아간 줄 알고, 수리 건은 출하 완료인 채로 남는다.
    return { ok: false, code: "SHIPMENT_COMPLETION_BLOCKED", message: reverted.message };
  }

  return releaseDomesticOrderOnly(params, true);
}

/**
 * 내자 줄의 완료 표시만 푼다. 세 갈래(연결 없음 · 출하 완료 아님 · 되돌리기
 * 성공)가 모두 **같은 마지막 한 걸음**을 밟도록 한 곳에 모아 둔다 — 나눠 적으면
 * version 대조가 갈래마다 달라지는 날이 온다([완료 처리] 쪽과 같은 모양).
 */
async function releaseDomesticOrderOnly(
  params: { id: string; expectedVersion: number; actorUserId: string },
  repairCaseShipmentReverted: boolean
): Promise<ReleaseDomesticOrderResult> {
  const result = await setDomesticOrderCompletion({
    id: params.id,
    expectedVersion: params.expectedVersion,
    completed: false,
    actorUserId: params.actorUserId,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return { ok: true, id: result.id, version: result.version, repairCaseShipmentReverted };
}
