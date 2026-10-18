import "server-only";

import {
  setDomesticOrderCompletion,
  type DomesticOrderMutationResultCode,
} from "@/lib/db/mutations/domestic-orders";
import { transitionWorkflow } from "@/lib/db/mutations/workflow-transitions";
import { getDomesticOrderShipmentLink } from "@/lib/db/queries/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 [완료 처리] — 붙어 있는 수리 건도 함께 출하 완료로 넘긴다 (2026-10-18)
 * ============================================================================
 * 내자 정리에서 완료 처리된 줄은 **이미 물건이 나갔다는 뜻**이다
 * (queries/domestic-orders.ts 의 완료 주석). 그런데 지금까지는 수리 건 쪽
 * 워크플로를 사람이 따로 또 눌러야 했고, 그래서 두 곳이 어긋났다. 사용자
 * 결정(2026-10-18)으로 [완료 처리] 한 번이 둘을 함께 움직인다.
 *
 * 🔴 **[완료 해제]는 이 파일을 거치지 않는다.** 완료를 푸는 쪽은 예전 그대로
 * 내자 줄만 푼다 — 액션이 completed === false 를 이 함수로 보내지 않는다.
 *
 * ── 왜 서비스 계층인가 ──────────────────────────────────────────────────
 * 이 저장소는 「서버 액션 = 인증 + 형식 검증 + 오류 가리기」, 「mutation = 한
 * 트랜잭션 안의 업무 규칙」으로 층을 나눈다. 여기서 하는 일은 그 둘 중 어느
 * 쪽도 아니다 — **두 mutation 을 어떤 차례로 부를지**를 정하는 일이고, 그
 * 차례 자체가 지켜야 할 규칙(아래 '수리건을 먼저')을 품고 있다. 같은 모양의
 * 조율이 이 폴더에 이미 있다(create-repair-case.ts 가 접수 생성과 멱등 키를,
 * quote-issue.ts 가 만들기·공유폴더·첨부를 차례로 엮는다). 그래서 여기 둔다.
 *
 * 이 함수는 **권한을 보지 않는다.** domesticOrders WRITE 는 서버 액션이
 * (actions/domestic-orders.ts), 그 전이를 누를 수 있는 역할인가는
 * transitionWorkflow 가 트랜잭션 안에서 본다.
 *
 * ── 네 갈래 ─────────────────────────────────────────────────────────────
 *  1. 붙은 수리 건이 없다            → 내자 줄만 완료한다(예전과 같다).
 *  2. 그 건이 이미 출하 완료 단계다  → 건너뛰고 내자 줄만 완료한다.
 *  3. 그 밖                          → 수리 건을 **먼저** 출하 완료로 넘기고,
 *                                       성공했을 때만 내자 줄을 완료한다.
 *  4. 넘기지 못했다                  → 🔴 **내자 줄도 완료하지 않는다.**
 *                                       막힌 까닭을 그대로 올려 보낸다.
 *
 * ── 🔴 왜 수리 건을 먼저 하는가 ─────────────────────────────────────────
 * 두 작업은 **서로 다른 트랜잭션**이다. transitionWorkflow 가 제 트랜잭션을
 * 열고 닫으므로, 한 트랜잭션으로 묶을 방법이 없다. 그래서 둘 사이에서 서버가
 * 죽거나 DB 가 끊기면 반쪽만 남는다. 어느 반쪽이 남느냐를 고르는 것이 이
 * 차례다.
 *
 *  · 수리 건 먼저 → 「수리 건은 출하 완료, 내자 줄은 아직」이 남는다. 사람이
 *    **다시 [완료 처리]를 누르면** 위 2번으로 들어가 건너뛰고 내자 줄만
 *    완료된다. 스스로 복구된다.
 *  · 내자 줄 먼저 → 「내자 줄은 완료, 수리 건은 아직」이 남는다. 완료된 줄에는
 *    [완료 처리] 단추가 없다(그 자리는 [완료 해제]다). **복구할 길이 없다.**
 *
 * 그래서 2번 갈래는 "쓸데없는 호출을 아끼는 최적화"가 아니라 **재시도가
 * 성립하게 만드는 장치**다. 지우지 마라. (출하 완료된 건은 is_locked 가 되어
 * transitionWorkflow 가 CASE_LOCKED 로 거절한다 — 2번이 없으면 재시도는
 * 「이미 끝난 일」 때문에 영영 막힌다.)
 *
 * ── 🔴 expectedVersion 은 여기서 **검사 구실을 하지 못한다** ─────────────
 * transitionWorkflow 는 낙관적 잠금용 expectedVersion 을 받는다. 그 값의 뜻은
 * 「내가 화면에서 본 수리 건이 그 사이 바뀌었는가」인데, 여기서 누르는 사람은
 * 수리 건 화면이 아니라 **내자 줄**을 보고 있어 그 질문 자체가 성립하지 않는다.
 * 그래서 서버가 **방금 읽은 값을 그대로** 넘긴다. 즉 이 경로에서 그 검사는
 * 사실상 통과만 한다. 조용히 넘기면 다음 사람이 여기에도 잠금이 걸려 있다고
 * 믿게 되므로 분명히 적어 둔다.
 *
 * 🔵 **내자 줄 자체의 expectedVersion 은 다르다.** 그쪽은 사람이 보고 있던 줄의
 * version 을 화면이 보내 온 것이라 검사가 그대로 유효하고, 예전과 똑같이
 * setDomesticOrderCompletion 으로 넘어간다.
 *
 * ── 메모는 자동으로 적는다 ──────────────────────────────────────────────
 * 출하 완료 전이는 requiresReason = true 라 메모 없이는 REASON_REQUIRED 로
 * 거절된다. 내자에서 따라오는 길에서까지 사람에게 또 적게 할 이유가 없으므로
 * 아래 고정 문구를 넘긴다. 문구에 **어디서 비롯된 일인지**가 들어 있어야
 * 한다 — 나중에 이력(status_change_histories.reason)을 보는 사람이 「사람이
 * 직접 눌렀나, 내자에서 따라온 것인가」를 그 한 줄로 갈라야 하기 때문이다.
 * ============================================================================
 */

/** 수리 건 이력에 남는 메모. 이 글자가 곧 「내자에서 따라온 것」의 표시다. */
export const DOMESTIC_ORDER_SHIPMENT_COMPLETION_REASON =
  "내자 정리에서 [완료 처리]를 눌러 자동으로 출하 완료 처리되었습니다.";

export type CompleteDomesticOrderResultCode =
  | DomesticOrderMutationResultCode
  /**
   * 붙어 있는 수리 건을 출하 완료로 넘기지 못했다 — 그래서 내자 줄도 완료되지
   * 않았다. NOT_FOUND·CONFLICT·VALIDATION_ERROR 어느 것도 아니라 코드를 따로
   * 둔다. 화면은 **이 코드로** 팝업을 띄울지 가른다(메시지 글자를 비교하지
   * 않는다 — 전이가 돌려주는 문장은 막힌 까닭마다 다르다).
   */
  | "SHIPMENT_COMPLETION_BLOCKED";

export type CompleteDomesticOrderResult =
  | {
      ok: true;
      id: string;
      version: number;
      /** 이번에 수리 건까지 함께 출하 완료로 넘어갔는가. 화면의 성공 문구가 갈린다. */
      repairCaseShipmentCompleted: boolean;
    }
  | { ok: false; code: CompleteDomesticOrderResultCode; message: string };

export async function completeDomesticOrderWithShipment(params: {
  id: string;
  /** 🔵 **내자 줄**의 version. 화면이 보고 있던 줄의 값 그대로다. */
  expectedVersion: number;
  actorUserId: string;
}): Promise<CompleteDomesticOrderResult> {
  // ── 2 · 내자 줄에서 repair_case_id 를 읽는다 ────────────────────────────
  const link = await getDomesticOrderShipmentLink(params.id);

  // ── 3 · 붙은 수리 건이 없으면 예전 그대로 완료 처리만 한다 ──────────────
  //    줄 자체가 없을 때도 여기로 온다 — 그 판정은 아래 mutation 이 트랜잭션
  //    안에서 다시 읽어 NOT_FOUND 로 돌려준다(두 곳에서 같은 판정을 하지 않는다).
  //
  // ── 4 · 이미 출하 완료된 건이면 건너뛴다(위 머리말의 재시도 복구 경로) ──
  if (!link || link.isShipmentCompleted) {
    return finishDomesticOrderOnly(params, false);
  }

  // ── 5 · 수리 건을 **먼저** 넘긴다 ───────────────────────────────────────
  const transition = await transitionWorkflow(
    link.repairCaseId,
    // 🔴 방금 읽은 값이다 — 위 'expectedVersion 은 검사 구실을 하지 못한다'.
    link.repairCaseVersion,
    "SHIPMENT_COMPLETED",
    params.actorUserId,
    DOMESTIC_ORDER_SHIPMENT_COMPLETION_REASON
  );
  if (!transition.ok) {
    // 🔴 여기서 멈춘다. 내자 줄은 손대지 않는다 — 완료 표시만 먼저 붙으면
    // 사람은 출하가 끝난 줄 알고, 수리 건은 그대로 남는다.
    return { ok: false, code: "SHIPMENT_COMPLETION_BLOCKED", message: transition.message };
  }

  return finishDomesticOrderOnly(params, true);
}

/**
 * 내자 줄만 완료로 표시한다. 세 갈래(연결 없음 · 이미 출하 완료 · 전이 성공)가
 * 모두 **같은 마지막 한 걸음**을 밟도록 한 곳에 모아 둔다 — 나눠 적으면
 * version 대조나 completed_by 기록이 갈래마다 달라지는 날이 온다.
 */
async function finishDomesticOrderOnly(
  params: { id: string; expectedVersion: number; actorUserId: string },
  repairCaseShipmentCompleted: boolean
): Promise<CompleteDomesticOrderResult> {
  const result = await setDomesticOrderCompletion({
    id: params.id,
    expectedVersion: params.expectedVersion,
    completed: true,
    actorUserId: params.actorUserId,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return { ok: true, id: result.id, version: result.version, repairCaseShipmentCompleted };
}
