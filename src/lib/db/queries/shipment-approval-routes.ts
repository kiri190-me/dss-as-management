import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../client";
import { shipmentApprovalRouteSteps, shipmentApprovalRoutes, users } from "../schema";
import type { AccountApprovalStatus, Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 출하 승인 절차(결재선) 읽기
 * ============================================================================
 * 읽기만 한다. 저장은 다음 조각이다.
 *
 * 「현재 절차」는 **version 이 가장 큰 판** 하나다 — is_current 같은 깃발 칸이
 * 없는 이유는 db/schema/shipment-approval-routes.ts 머리말에 있다(같은 사실이
 * 두 곳에 적히면 갈라진다). 그래서 여기서도 `ORDER BY version DESC LIMIT 1`
 * 하나로 정한다. 이 정의가 적힌 곳은 저장소 전체에서 이 파일 하나여야 한다.
 *
 * 판이 하나도 없으면 null 이다. 그때 앱은 이 기능이 없던 때와 똑같이 — 「출하
 * 대표」(users.is_shipment_representative)·위임 방식으로 — 최종 출하 승인을
 * 처리한다.
 * ============================================================================
 */

/**
 * 절차 한 단계 + **그 승인자의 지금 상태**.
 *
 * 🔴 상태를 함께 싣는 이유: 화면이 「이 사람은 지금 비활성입니다」·「삭제된
 * 계정입니다」를 말해 줘야 하기 때문이다. 결재선에 올라간 뒤에 계정이 잠기거나
 * 지워지는 일은 실제로 일어나고, 그때 결재는 그 단계에서 멈춘다. 화면이 이유를
 * 보여 주지 못하면 「왜 결재가 안 넘어가지」를 아무도 답할 수 없다.
 */
export type ShipmentApprovalRouteStepView = {
  /** 1부터. 이 순서대로 결재한다. */
  stepOrder: number;
  approverUserId: string;
  approverName: string;
  approverRole: Role;
  approverIsActive: boolean;
  approverApprovalStatus: AccountApprovalStatus;
  /** null 이 아니면 잠긴 계정이다. */
  approverLockedAt: Date | null;
  approverIsDeleted: boolean;
};

export type ShipmentApprovalRouteView = {
  id: string;
  /** 판 번호. 가장 큰 것이 현재 절차다. */
  version: number;
  createdAt: Date;
  /** 이 판을 만든 사람의 이름. 「누가 언제 결재선을 바꿨나」가 화면에 그대로 보인다. */
  createdByName: string;
  /** step_order 순. **빈 배열도 정상이다** — 「절차를 쓰지 않겠다」는 뜻이다. */
  steps: ShipmentApprovalRouteStepView[];
};

/**
 * 지금 쓰이는 절차 한 판과 그 단계들. 판이 하나도 없으면 null.
 *
 * 🔴 **소프트삭제된 사용자의 단계도 빼지 않는다.** 조용히 빼면 절차가 짧아진
 * 것처럼 보이고, 결재가 왜 그 자리에서 멈췄는지 화면에서 알 방법이 없어진다.
 * 그 대신 approverIsDeleted 를 그대로 실어 보내 화면이 「삭제된 계정입니다」를
 * 보여 주고 고치게 한다. 비활성·잠김·미승인도 같은 이유로 거르지 않는다.
 *
 * users 조인은 innerJoin 이어도 행을 잃지 않는다 — 사람 참조가 RESTRICT 이고
 * 이 저장소의 사용자는 소프트삭제만 하므로, 참조된 users 행은 언제나 실재한다.
 */
export async function getCurrentShipmentApprovalRoute(): Promise<ShipmentApprovalRouteView | null> {
  const [route] = await db
    .select({
      id: shipmentApprovalRoutes.id,
      version: shipmentApprovalRoutes.version,
      createdAt: shipmentApprovalRoutes.createdAt,
      createdByName: users.name,
    })
    .from(shipmentApprovalRoutes)
    .innerJoin(users, eq(users.id, shipmentApprovalRoutes.createdByUserId))
    .orderBy(desc(shipmentApprovalRoutes.version))
    .limit(1);

  if (!route) return null;

  const steps = await db
    .select({
      stepOrder: shipmentApprovalRouteSteps.stepOrder,
      approverUserId: shipmentApprovalRouteSteps.approverUserId,
      approverName: users.name,
      approverRole: users.role,
      approverIsActive: users.isActive,
      approverApprovalStatus: users.approvalStatus,
      approverLockedAt: users.lockedAt,
      approverIsDeleted: users.isDeleted,
    })
    .from(shipmentApprovalRouteSteps)
    .innerJoin(users, eq(users.id, shipmentApprovalRouteSteps.approverUserId))
    .where(eq(shipmentApprovalRouteSteps.routeId, route.id))
    .orderBy(asc(shipmentApprovalRouteSteps.stepOrder));

  return { ...route, steps };
}

/** 결재선에 올릴 수 있는 사람 한 줄. */
export type SelectableApproverCandidate = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

/**
 * 절차 단계에 올릴 수 있는 사용자 목록. 이름 순.
 *
 * 🔴 **자격 규칙을 새로 만들지 않는다.** 지금 「출하 대표」로 지정할 수 있는
 * 조건과 글자 그대로 같다 — mutations/shipment-representatives.ts 의
 * setShipmentRepresentative 가 강제하는 넷:
 *   · approval_status = 'APPROVED'  (승인되지 않은 계정은 대표로 지정할 수 없다)
 *   · is_active = true              (비활성화된 계정은 지정할 수 없다)
 *   · locked_at IS NULL             (잠긴 계정은 지정할 수 없다)
 *   · is_deleted = false            (삭제된 계정은 애초에 대상이 아니다)
 * 절차가 대표를 **대신하는** 것이므로 자격을 넓히거나 좁히면 그 순간 두 축이
 * 다른 말을 하게 된다. 여기서 골라 둔 사람이 저장 시점에 대표로는 못 세울
 * 사람이면, 관리자는 화면에서 보이는데 저장이 거절되는 상황을 만나게 된다.
 *
 * **역할 제한은 없다** — 대표 지정도 역할을 보지 않는다(위 함수에 역할 검사가
 * 없다). 여기서 역할로 좁히면 대표로는 세울 수 있는 사람을 결재선에는 못 올리는
 * 어긋남이 생긴다.
 *
 * 이 목록은 화면이 고를 후보일 뿐 최종 판정이 아니다 — 실제 저장은 다음 조각의
 * mutation 이 자기 트랜잭션 안에서 같은 조건을 다시 확인한다(고르는 사이에
 * 계정이 잠길 수 있다).
 *
 * 이미 결재선에 올라간 사람을 여기서 빼지 않는다. 중복은 편집 화면과
 * validateShipmentApprovalRouteSteps 가 걸러 낸다 — 이 조회가 「지금 판」을 알아야
 * 하는 관계를 만들면, 새 판을 짜는 화면(옛 판과 무관하다)이 쓸 수 없게 된다.
 */
export async function listSelectableApproverCandidates(): Promise<SelectableApproverCandidate[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        isNull(users.lockedAt),
        eq(users.isDeleted, false)
      )
    )
    // 이름이 같은 사람이 있어도 목록 순서가 실행마다 흔들리지 않도록 id 로
    // 동점을 깬다(ORDER BY 가 완전하지 않은 조회는 순서를 보장하지 않는다).
    .orderBy(asc(users.name), asc(users.id));
}
