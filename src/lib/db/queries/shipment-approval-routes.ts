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
 * 트랜잭션 핸들과 최상위 db 양쪽을 받는다 — 승인 요청 mutation 은 자기
 * 트랜잭션 안에서, 서버 컴포넌트(페이지)는 트랜잭션 없이 읽기 때문이다. 읽기
 * 전용이라 둘 중 무엇으로 실행하든 의미가 같다(queries/workflow-rules.ts 의
 * loadWorkflowRules 가 같은 모양이다).
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * 🔴 **「현재 절차」의 정의가 적힌 유일한 곳.** version 이 가장 큰 판 하나다.
 * 이 파일의 공개 함수들은 전부 여기를 거친다 — 같은 정렬을 한 벌 더 적으면
 * 언젠가 한쪽만 고쳐지고 그때 「현재」가 둘이 된다.
 */
async function selectCurrentRouteHeader(tx: Tx) {
  const [route] = await tx
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
  return route ?? null;
}

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
  const route = await selectCurrentRouteHeader(db);

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

/**
 * 승인 사슬을 잇는 데 필요한 최소한의 단계 한 줄 — 몇 번째이고 누구인가.
 *
 * 화면용 ShipmentApprovalRouteStepView 와 달리 승인자의 계정 상태를 싣지
 * 않는다. 🔴 **다음 단계 승인자의 자격을 다시 검사하지 않기 때문이다** —
 * 검사하면 뒷사람 사정 때문에 앞사람이 결재를 못 하게 된다. 그 사람이 자리를
 * 비웠으면 그 단계에서 멈추고 최고관리자가 대신 처리하는 것이 설계다.
 */
export type ShipmentApprovalRouteChainStep = {
  /** 1부터. */
  stepOrder: number;
  approverUserId: string;
};

/** 승인 요청이 붙잡아 둘 판 하나 — id 와 단계들뿐이다. */
export type ShipmentApprovalRouteChain = {
  routeId: string;
  /** 판 번호. 요청 행에는 적지 않는다(판 id 가 그것을 이미 가리킨다). */
  version: number;
  /** step_order 순. **빈 배열도 정상이다** — 「절차를 쓰지 않겠다」는 뜻이다. */
  steps: ShipmentApprovalRouteChainStep[];
};

/**
 * 최종 출하 승인을 요청할 때 붙잡아 둘 **지금 판**. 판이 하나도 없으면 null.
 *
 * getCurrentShipmentApprovalRoute() 와 「현재 절차」의 정의를 공유한다
 * (selectCurrentRouteHeader) — 승인 요청 mutation 은 자기 트랜잭션 안에서
 * 읽어야 하는데 그쪽은 db 를 직접 쓰기 때문에 이 함수가 따로 있다.
 *
 * 단계가 0개인 판은 `steps: []` 로 돌아온다. 부르는 쪽은 그때 「결재선을 쓰지
 * 않는다」로 다뤄야 한다 — 판이 아예 없을 때와 같다.
 */
export async function getCurrentShipmentApprovalRouteChain(
  tx: Tx
): Promise<ShipmentApprovalRouteChain | null> {
  const route = await selectCurrentRouteHeader(tx);
  if (!route) return null;

  const steps = await tx
    .select({
      stepOrder: shipmentApprovalRouteSteps.stepOrder,
      approverUserId: shipmentApprovalRouteSteps.approverUserId,
    })
    .from(shipmentApprovalRouteSteps)
    .where(eq(shipmentApprovalRouteSteps.routeId, route.id))
    .orderBy(asc(shipmentApprovalRouteSteps.stepOrder));

  return { routeId: route.id, version: route.version, steps };
}

/**
 * **그 판의** 특정 단계 하나. 없으면 null(= 마지막 단계였다는 뜻이다).
 *
 * 🔴 「현재 판」이 아니라 **행에 적힌 판**으로 찾는다. 진행 중인 건은 관리자가
 * 절차를 바꿔도 요청 시점의 옛 판을 끝까지 따라가야 하기 때문이다.
 */
export async function getShipmentApprovalRouteStep(
  tx: Tx,
  routeId: string,
  stepOrder: number
): Promise<ShipmentApprovalRouteChainStep | null> {
  const [step] = await tx
    .select({
      stepOrder: shipmentApprovalRouteSteps.stepOrder,
      approverUserId: shipmentApprovalRouteSteps.approverUserId,
    })
    .from(shipmentApprovalRouteSteps)
    .where(
      and(
        eq(shipmentApprovalRouteSteps.routeId, routeId),
        eq(shipmentApprovalRouteSteps.stepOrder, stepOrder)
      )
    );
  return step ?? null;
}

/**
 * **그 판의** 전체 단계 수. 승인 카드가 「2/3단계」의 뒷자리를 그리는 데 쓴다.
 *
 * 🔴 「현재 판」이 아니라 **요청 행에 적힌 판(`repair_case_approvals.route_id`)**
 * 으로 센다. 진행 중인 건은 옛 판을 끝까지 따라가므로, 현재 판을 세면 이미
 * 끝나 가는 건이 「2/2단계」가 아니라 「2/4단계」로 보인다 — 사람은 아직 두
 * 사람이 더 남았다고 읽는다.
 *
 * 판이 없거나 단계가 0개면 0이다(부르는 쪽은 그때 진행 표시를 그리지 않는다).
 * 단계 수가 한 자릿수라 전량을 읽어 세는 비용은 문제되지 않는다.
 */
export async function countShipmentApprovalRouteSteps(routeId: string): Promise<number> {
  const steps = await db
    .select({ stepOrder: shipmentApprovalRouteSteps.stepOrder })
    .from(shipmentApprovalRouteSteps)
    .where(eq(shipmentApprovalRouteSteps.routeId, routeId));
  return steps.length;
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
