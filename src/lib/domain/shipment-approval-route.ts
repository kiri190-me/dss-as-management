/**
 * ============================================================================
 * 출하 승인 절차(결재선) — 순수 규칙
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. 나중 조각의 **저장 경로와 편집 화면이 같은
 * 함수 하나**를 보게 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적어 두면 화면은
 * 받아 주는데 저장이 거절하거나(사람이 무엇을 고쳐야 할지 모른다), 반대로
 * 화면만 막고 저장은 열려 있는(손으로 만든 요청이 통과한다) 상태가 된다.
 * validation/ui-text-override-input.ts · domain/ui-theme-tokens.ts 와 같은 자리다.
 *
 * 표 구조와 「판(version)으로 쌓는 이유」는 db/schema/shipment-approval-routes.ts
 * 머리말에 있다.
 *
 * ── 🔴 순서는 배열의 자리(index)가 정한다 ───────────────────────────────
 * 이 층은 **순서 번호를 입력으로 받지 않는다.** 승인자 id 를 담은 배열 하나만
 * 받고, 저장할 때 `step_order = index + 1` 로 매긴다
 * (stepOrderFromIndex — 그 규칙이 적힌 곳은 여기 하나뿐이다).
 *
 * 번호를 받으면 「빠진 번호(1,2,4)」·「겹친 번호(1,2,2)」·「0 이나 음수」·
 * 「번호와 배열 순서가 어긋남」을 전부 검사해야 하고, 그 검사가 하나라도 틀리면
 * 표의 유니크(route_id, step_order)가 저장 시점에 터진다 — 사람에게는 「알 수 없는
 * 오류」로 보인다. 배열의 자리를 그대로 쓰면 그 네 가지 실패가 **존재할 수 없다.**
 * 화면의 「위로/아래로」 단추도 배열 원소를 옮기기만 하면 끝난다.
 *
 * ── 🔴 uuid 형식은 여기서 보지 않는다 ───────────────────────────────────
 * 이 저장소에는 이미 `isValidUuid` 가 있다
 * (src/lib/validation/procedure-validation-resolution-input.ts). 형식 검사는
 * **저장 경로가** 그 함수로 한다 — 서버 액션들이 이미 그렇게 하고 있고, 같은
 * 정규식을 여기서 또 쓰면 두 벌이 된다. 여기서 보는 것은 「사람이 화면에서
 * 고칠 수 있는 것」뿐이다: 몇 명인가, 같은 사람이 두 번 들어갔는가, 빈 자리가
 * 남았는가.
 * ============================================================================
 */

/**
 * 한 절차에 둘 수 있는 단계의 최대 개수.
 *
 * 10 인 이유: 순차 승인이 10단계면 그 자체로 이미 병목이고(한 사람이 자리를
 * 비우면 그만큼 출하가 멈춘다), 편집 화면도 그보다 길어지면 한눈에 다루지
 * 못한다. 무엇보다 **상한이 없으면 실수 한 번으로 결재가 영영 끝나지 않는
 * 절차가 만들어진다** — 붙여넣기 한 번에 수십 줄이 들어가도 표는 그대로 받는다.
 *
 * 0 개는 상한과 무관하게 정상이다(아래 참조).
 */
export const MAX_SHIPMENT_APPROVAL_ROUTE_STEPS = 10;

export type ShipmentApprovalRouteStepsIssueCode =
  /** 상한을 넘었다. */
  | "TOO_MANY_STEPS"
  /** 같은 사람이 두 번 들어 있다. */
  | "DUPLICATE_APPROVER"
  /** 승인자를 고르지 않은 자리가 있다. */
  | "MISSING_APPROVER";

export type ShipmentApprovalRouteStepsValidationResult =
  | { ok: true }
  | { ok: false; code: ShipmentApprovalRouteStepsIssueCode; message: string };

/**
 * 배열의 자리(0부터)를 표에 적을 순서 번호(1부터)로 옮긴다.
 *
 * 규칙이 적힌 곳을 하나로 묶어 두기 위한 함수다 — 저장 경로가 `index + 1` 을
 * 직접 쓰기 시작하면, 나중에 이 규칙이 바뀔 때(예: 0부터) 한쪽만 고쳐진다.
 * 표의 CHECK (step_order >= 1) 가 이것과 짝이다.
 */
export function stepOrderFromIndex(index: number): number {
  return index + 1;
}

/**
 * 절차 단계 목록이 저장할 수 있는 모양인가.
 *
 * **0개는 허용한다.** 「절차를 쓰지 않겠다」는 정상적인 뜻이고, 그때 앱은 지금까지처럼
 * 「출하 대표」(users.is_shipment_representative)·위임 방식으로 최종 출하 승인을
 * 처리한다. 여기서 0개를 막으면 관리자는 한 번 만든 절차를 되돌릴 방법이 없어진다
 * — 판은 지우지 않기 때문이다(append-only).
 *
 * 메시지는 무엇을 고쳐야 하는지까지 적는다. 「저장할 수 없습니다」만 돌려주면
 * 관리자는 같은 값을 몇 번 더 눌러 보다가 포기한다.
 */
export function validateShipmentApprovalRouteSteps(
  approverUserIds: readonly string[]
): ShipmentApprovalRouteStepsValidationResult {
  if (approverUserIds.length > MAX_SHIPMENT_APPROVAL_ROUTE_STEPS) {
    return {
      ok: false,
      code: "TOO_MANY_STEPS",
      message: `승인 단계는 최대 ${MAX_SHIPMENT_APPROVAL_ROUTE_STEPS}개까지 둘 수 있습니다. 지금 ${approverUserIds.length}개입니다.`,
    };
  }

  const seen = new Set<string>();
  for (let index = 0; index < approverUserIds.length; index += 1) {
    const raw = approverUserIds[index];
    // 화면에서 「단계 추가」만 누르고 사람을 아직 고르지 않은 빈 줄이 그대로
    // 넘어오는 길이 실제로 있다. 공백만 든 값도 같은 것으로 본다.
    const approverUserId = typeof raw === "string" ? raw.trim() : "";
    if (approverUserId.length === 0) {
      return {
        ok: false,
        code: "MISSING_APPROVER",
        message: `${stepOrderFromIndex(index)}번째 단계의 승인자를 선택해 주세요.`,
      };
    }

    if (seen.has(approverUserId)) {
      return {
        ok: false,
        code: "DUPLICATE_APPROVER",
        message: `같은 사람이 승인 단계에 두 번 들어 있습니다 (${stepOrderFromIndex(index)}번째 단계). 한 사람은 한 번만 지정할 수 있습니다.`,
      };
    }
    seen.add(approverUserId);
  }

  return { ok: true };
}
