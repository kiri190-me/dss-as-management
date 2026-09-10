"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { validateShipmentApprovalRouteInput } from "@/lib/validation/shipment-approval-route-input";
import { saveShipmentApprovalRoute } from "@/lib/db/mutations/shipment-approval-routes";
import type { ShipmentApprovalRouteScope } from "@/lib/domain/shipment-approval-route";

export type SaveShipmentApprovalRouteActionInput = {
  /**
   * 어느 절차를 저장하는가. 🔴 **화면이 보낸 값을 그대로 믿지 않는다** —
   * validateShipmentApprovalRouteInput 이 허용된 값인지 확인하고, 기본값으로
   * 채워 주지 않는다. 여기서 「없으면 출하」로 채우면 용도를 빠뜨린 요청이 조용히
   * 출하 절차를 덮어쓴다.
   *
   * 타입이 이미 좁지만 이 함수는 Server Action 이라 **네트워크 경계 너머**에서
   * 불린다 — 타입은 그 경계에서 아무것도 막지 못한다.
   */
  scope: ShipmentApprovalRouteScope;
  /**
   * 결재 순서대로 담은 승인자 id. **자리가 곧 순서다** — 순서 번호를 따로 받지
   * 않는다(그 이유는 domain/shipment-approval-route.ts 머리말).
   *
   * 🔴 빈 배열은 「절차를 쓰지 않겠다」는 뜻이고, 그때 최종 출하 승인은 지금까지처럼
   * 「출하 대표」·위임 방식으로 처리된다.
   */
  approverUserIds: string[];
};

export type SaveShipmentApprovalRouteActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Server Action: 승인 절차(결재선) 저장.
 *
 * 다른 Server Action 과 같은 층위의 일만 한다 — 모드 확인, 세션, 행위자 해석,
 * 인가, 입력 형식 검증(용도 포함), 예상 못한 오류 은닉. 승인자 자격 재확인·「바뀐
 * 게 없으면 새 판을 만들지 않는다」·판 번호 매기기·감사 기록은
 * saveShipmentApprovalRoute()가 자기 트랜잭션 안에서 DB 를 다시 읽어 수행한다.
 *
 * ⚠️ 아래 문구 둘은 아직 **출하 절차만을 말한다**(「출하 승인 절차를 변경할 권한이
 * 없습니다」·「출하 대표로 지정된 사용자가…」). 지금은 부르는 곳이 출하 하나뿐이라
 * 틀린 말이 아니지만, 부품 불출이 이 절차를 타는 조각에서 용도에 맞게 갈라야 한다.
 *
 * 🔴 인가를 여기서 한 번, mutation 에서 또 한 번 한다. 중복이지만 겹쳐 두는 것이
 * 이 저장소의 관례다 — 한쪽이 무너져도 다른 쪽이 남는다(ui-theme-tokens.ts ·
 * role-permissions.ts 와 같은 판단). 식은 **셋이 같아야 한다**: 화면이 쓰는
 * canManageRepresentatives(app/(app)/users/page.tsx)도 같은 영역 열쇠·같은
 * 수준에서 나온다. 갈리면 「단추는 보이는데 누르면 거절」이나 그 반대가 된다.
 *
 * 🔴 revalidatePath 를 부르지 않는다. 이 값은 /users 화면 하나가 읽는 것이고,
 * 편집 화면이 저장 뒤 router.refresh() 로 자기 화면만 다시 그린다(이 저장소의
 * 다른 설정 화면과 같다).
 */
export async function saveShipmentApprovalRouteAction(
  input: SaveShipmentApprovalRouteActionInput
): Promise<SaveShipmentApprovalRouteActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 인증 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await hasPermission(actingUser, "users.shipmentRepresentatives", "MANAGE"))) {
    return { ok: false, message: "출하 승인 절차를 변경할 권한이 없습니다." };
  }

  const validated = validateShipmentApprovalRouteInput(input);
  if (!validated.ok) return { ok: false, message: validated.message };

  try {
    const result = await saveShipmentApprovalRoute(
      validated.approverUserIds,
      actingUser.id,
      // 🔴 검증을 지난 값을 넘긴다 — input.scope 를 그대로 넘기면 위에서 확인한
      // 것과 아래에서 쓰는 것이 다른 값이 될 수 있다.
      validated.scope
    );
    if (!result.ok) return { ok: false, message: result.message };
    if (!result.changed) {
      // 🔴 「저장됐다」와 구별해 말해 준다. 같은 값을 다시 저장하면 판을 늘리지
      // 않으므로, 성공 문구만 보이면 관리자는 이력이 쌓였다고 오해한다.
      return { ok: true, message: "변경된 내용이 없습니다." };
    }
    return {
      ok: true,
      message:
        validated.approverUserIds.length === 0
          ? "승인 절차를 비웠습니다. 지금은 출하 대표로 지정된 사용자가 최종 출하 승인을 처리합니다."
          : `${validated.approverUserIds.length}단계 승인 절차를 저장했습니다.`,
    };
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("saveShipmentApprovalRouteAction: unexpected DB error", { code });
    return { ok: false, message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
