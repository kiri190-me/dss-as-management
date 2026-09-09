import {
  stepOrderFromIndex,
  validateShipmentApprovalRouteSteps,
  type ShipmentApprovalRouteStepsIssueCode,
} from "@/lib/domain/shipment-approval-route";
import { isValidUuid } from "./procedure-validation-resolution-input";

/**
 * ============================================================================
 * 출하 승인 절차(결재선) 입력 검증 — 형식만 본다
 * ============================================================================
 * ui-theme-token-input.ts · shipment-delegation-input.ts 와 같은 자리다.
 * **DB 도 세션도 여기서 만지지 않는다** — 순수 함수만 두어야 단위 시험이 붙고,
 * 그래야 「어떤 값을 받아들이는가」라는 규칙이 실제로 검증된다. 누가 적을 수
 * 있는가(인가)와 그 사람이 지금도 결재선에 올릴 수 있는 계정인가(자격)는 자료를
 * 봐야 알 수 있으므로 mutation 이 자기 트랜잭션 안에서 맡는다.
 *
 * ── 🔴 규칙을 여기 다시 적지 않는다 ─────────────────────────────────────
 * 개수 상한·중복 인물·빈 자리는 domain/shipment-approval-route.ts 의
 * validateShipmentApprovalRouteSteps 가 정한다. 화면도 그 함수를 보고, 저장도
 * 이 함수를 지나 그 함수를 본다 — 규칙이 적힌 곳이 하나여야 「화면은 받아 주는데
 * 저장이 거절한다」가 생기지 않는다. 여기가 더하는 것은 **바깥에서 들어온 값의
 * 모양**뿐이다: 객체인가, 배열인가, 원소가 문자열인가, uuid 형식인가.
 *
 * ── 🔴 uuid 정규식을 새로 적지 않는다 ───────────────────────────────────
 * `isValidUuid` 를 procedure-validation-resolution-input.ts 에서 가져다 쓴다.
 * 도메인 층이 형식을 일부러 안 보는 이유(두 벌이 되는 것을 막는다)가 그쪽
 * 머리말에 있고, 그 「저장 경로」가 바로 여기다.
 *
 * ── 빈 자리는 여기서 말하지 않는다 ──────────────────────────────────────
 * 화면에서 「단계 추가」만 누르고 사람을 아직 고르지 않은 줄은 빈 문자열로
 * 넘어온다. 그것을 「uuid 형식이 아닙니다」로 거절하면 관리자는 무엇을 고쳐야
 * 하는지 알 수 없다 — 도메인 규칙이 그 자리에 할 말(MISSING_APPROVER,
 * 「N번째 단계의 승인자를 선택해 주세요」)을 이미 갖고 있으므로 그쪽으로 넘긴다.
 * 값이 들어 있는데 형식이 아닌 경우만 여기서 걸린다(손으로 만든 요청이다).
 * ============================================================================
 */

export type ShipmentApprovalRouteInputIssueCode =
  /** 요청 자체의 모양이 아니다 — 배열이 아니거나, 원소가 문자열/uuid 가 아니다. */
  | "INVALID_INPUT"
  | ShipmentApprovalRouteStepsIssueCode;

export type ValidateShipmentApprovalRouteInputResult =
  | { ok: true; approverUserIds: string[] }
  | { ok: false; code: ShipmentApprovalRouteInputIssueCode; message: string };

/**
 * 서버 액션과 mutation 이 화면에서 받은 값을 그대로 믿지 않기 위해 부른다.
 *
 * 받는 모양은 `{ approverUserIds: string[] }` 하나다. 순서 번호를 받지 않는
 * 이유(배열의 자리가 곧 순서다)는 domain/shipment-approval-route.ts 머리말에
 * 있다 — 번호를 받으면 빠진 번호·겹친 번호·배열과 어긋난 번호를 전부 검사해야
 * 하고, 그 검사가 하나라도 틀리면 표의 유니크가 저장 시점에 터진다.
 *
 * 🔴 **빈 배열은 정상이다.** 「절차를 쓰지 않겠다」는 뜻이고, 그때 앱은 지금까지처럼
 * 「출하 대표」 방식으로 최종 출하 승인을 처리한다.
 */
export function validateShipmentApprovalRouteInput(
  input: unknown
): ValidateShipmentApprovalRouteInputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "승인 절차 입력을 확인할 수 없습니다." };
  }

  const { approverUserIds } = input as { approverUserIds?: unknown };
  if (!Array.isArray(approverUserIds)) {
    return { ok: false, code: "INVALID_INPUT", message: "승인 단계 목록을 확인할 수 없습니다." };
  }

  for (let index = 0; index < approverUserIds.length; index += 1) {
    const raw: unknown = approverUserIds[index];
    if (typeof raw !== "string") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `${stepOrderFromIndex(index)}번째 단계의 승인자 정보를 확인할 수 없습니다.`,
      };
    }
    // 아직 안 고른 자리는 도메인 규칙이 말하게 둔다(위 머리말 참조).
    if (raw.trim().length === 0) continue;
    if (!isValidUuid(raw)) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `${stepOrderFromIndex(index)}번째 단계의 승인자 정보를 확인할 수 없습니다.`,
      };
    }
  }

  const checked = validateShipmentApprovalRouteSteps(approverUserIds as string[]);
  if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };

  // 새 배열로 돌려준다 — 부르는 쪽이 받은 배열을 그대로 트랜잭션에 실어 보내므로,
  // 요청 객체와 자리를 나눠 쓰지 않는 편이 안전하다.
  return { ok: true, approverUserIds: [...(approverUserIds as string[])] };
}
