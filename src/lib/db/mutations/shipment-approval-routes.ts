import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { shipmentApprovalRouteSteps, shipmentApprovalRoutes, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { validateShipmentApprovalRouteInput } from "@/lib/validation/shipment-approval-route-input";
import {
  isSameRouteStepList,
  stepOrderFromIndex,
  type ShipmentApprovalRouteScope,
} from "@/lib/domain/shipment-approval-route";

/**
 * ============================================================================
 * 승인 절차(결재선) 저장 — 그 용도에 판(version)을 하나 얹는다
 * ============================================================================
 * saveUiThemeTokens 를 본보기로 삼았고, 거기서 이미 내려진 판단들을 그대로
 * 가져왔다. 화면이 보낸 값을 그대로 믿지 않는다 — 화면을 거치지 않고 이 함수를
 * 부를 수 있기 때문이다.
 *
 * ── 🔴 용도(scope)가 가르는 것 셋 ───────────────────────────────────────
 * 판을 얹는 자리에서 용도가 하는 일은 칸 하나를 채우는 것으로 끝나지 않는다.
 * 아래 셋이 **전부 그 용도 안에서** 이뤄져야 한다:
 *  1. **지금 판을 읽는 자리** — 다른 용도의 판을 현재로 잡으면 엉뚱한 절차를
 *     고친 것이 된다.
 *  2. **판 번호 매기기** — 전체에서 max + 1 을 하면 「출하 3판 다음 불출이 4판」이
 *     되어 사람이 읽는 번호가 망가진다.
 *  3. **「바뀐 게 없으면 새 판을 만들지 않는다」** — 다른 용도의 판과 견주면,
 *     같은 사람들을 두 절차에 세운 순간 한쪽 저장이 조용히 삼켜진다.
 * 셋 다 아래의 `currentRoute` 하나에서 나온다 — 그 조회에 걸린 `scope` 조건이
 * 이 파일의 핵심이다.
 *
 * ── 🔴 거절은 반드시 던진다 ─────────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 `return` 하면 **커밋된다.** 그래서 검증도 자격 확인도
 * **트랜잭션 안**에서 하고, 막히면 SaveRejected 를 던져 통째로 되돌린다
 * (saveUiThemeTokens · saveRolePermissions 와 같은 신호). 판 하나와 단계 여럿을
 * 함께 넣는 자리라, 반쯤 저장되면 순서가 비어 있는 결재선이 남는다.
 *
 * ── 🔴 잠금을 먼저 건다 ─────────────────────────────────────────────────
 * 판 번호를 `max + 1` 로 매기므로, 두 관리자가 동시에 저장하면 같은 번호를
 * 계산해 shipment_approval_routes_scope_version_unique 가 터진다 — 사람에게는
 * 「알 수 없는 오류」로 보인다. 위임 생성(shipment-delegations.ts)이 겹치는 기간을
 * 볼 때 쓰는 것과 같은 방식의 advisory 트랜잭션 잠금이고, 트랜잭션이 끝나면
 * 저절로 풀린다.
 *
 * 🔴 **열쇠를 용도별로 쪼개지 않는다.** 고정된 문자열 하나로 전체를 잠근다 —
 * 저장은 사람이 관리 화면에서 어쩌다 한 번 누르는 일이라 두 용도의 저장이
 * 부딪혀 기다리는 비용이 사실상 0 이고, 열쇠를 용도로 나누면 「용도별 열쇠를
 * 만드는 규칙」이 하나 더 생겨 새 용도를 더할 때 빠뜨릴 자리가 늘어난다.
 * 전체 잠금은 용도가 몇 개로 늘어도 그대로 안전하다.
 *
 * ── 🔴 인가는 「출하 대표」와 같은 열쇠·같은 수준이다 ───────────────────
 * `users.shipmentRepresentatives` 영역의 `MANAGE` 수준으로 판정한다.
 *
 * 🔴 그 판정을 **여기 주석에 호출 모양으로 적지 않는다.** 같은 열쇠를 쓰는
 * 자리의 개수를 세는 회귀 가드(auth/developer-flag.test.ts)의 정규식이 주석과
 * 코드를 구별하지 못해서, 호출 모양으로 적어 두면 이 문장이 「판정 자리」로 한 번
 * 더 세어진다. 그러면 **주석을 고치거나 지우기만 해도 그 가드가 깨져** 덫이
 * 진짜 신호가 아니라 잡음이 된다.
 *
 * **새 권한 영역을 만들지 않는다.** 절차가 대표를 대신하는 것이므로 같은 사람이
 * 다루는 것이 맞고, 영역을 새로 만들면 이미 저장된 역할별 권한 설정이 그 영역만
 * 비어 있는 채로 남는다. mutations/shipment-representatives.ts 가 같은 식으로
 * 판정하고, 화면이 쓰는 canManageRepresentatives 도 같은 식에서 나온다.
 *
 * ── 🔴 승인자 자격을 DB 에서 다시 확인한다 ──────────────────────────────
 * 화면이 받아 간 후보 목록(queries/listSelectableApproverCandidates)은 낡을 수
 * 있다 — 고르는 사이에 계정이 잠기거나 비활성이 될 수 있다. 조건 넷은 「출하
 * 대표」로 지정할 수 있는 조건과 글자 그대로 같다. 그리고 막힐 때는 **누가 왜**
 * 안 되는지 이름과 함께 말한다: 「저장할 수 없습니다」만 돌려주면 관리자는 10명
 * 중 누구를 빼야 하는지 알 수 없어 같은 값을 몇 번 더 눌러 보다가 포기한다.
 *
 * ── 🔴 바뀐 게 없으면 새 판을 만들지 않는다 ─────────────────────────────
 * 판은 지우지 않으므로(append-only), 저장 단추를 두 번 누르면 똑같은 판이 둘
 * 쌓여 「누가 언제 결재선을 바꿨나」가 잡음에 묻힌다. 판정은 도메인의
 * isSameRouteStepList 로 한다 — 화면의 「저장할 것이 있는가」와 같은 함수다.
 * 순서만 달라도 다른 절차다.
 *
 * 감사 기록은 audit_logs 에 한 줄 남긴다(대표 지정과 달리 전용 이력 표를 두지
 * 않는다 — 판 자체가 이미 이력이라 두 곳에 같은 사실이 적히면 갈라진다).
 * 🔴 그 한 줄에 **용도를 적는다** — 로그만 읽고도 어느 절차가 바뀌었는지 알아야
 * 한다. 대상 표 이름(shipment_approval_routes)은 이제 용도를 말해 주지 못한다.
 *
 * ── 안쪽 함수와 바깥 함수 (2026-09-14) ──────────────────────────────────
 * 사용자 계정 삭제가 **자기 트랜잭션 안에서** 「지울 사람의 자리를 이어받을 사람으로
 * 바꾼 새 판」을 얹어야 해서, 판을 얹는 부분(입력 검증 → 승인자 자격 → 그 용도의
 * 지금 판 → 그대로인가 → 새 판 → 감사)을 saveShipmentApprovalRouteInTx 로 떼어
 * 냈다. 저장의 동작은 한 줄도 바뀌지 않았다.
 *
 * 잠금 · 행위자 재조회 · 인가는 바깥 함수(saveShipmentApprovalRoute)에 그대로 남는다.
 * 🔴 인가 판정 호출을 안쪽으로 옮기지 않는다 — 위 「인가」 절의 회귀 가드가 이
 * 파일에서 그 호출을 센다. 그래서 안쪽 함수를 부르는 쪽은 **먼저
 * acquireShipmentApprovalRouteLock 으로 잠그고, 행위자를 스스로 판정해야 한다**
 * (계정 삭제는 진짜 최고관리자 판정으로 한다).
 * ============================================================================
 */

export type SaveShipmentApprovalRouteResult =
  | { ok: true; changed: boolean; version: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * advisory 잠금의 고정 열쇠. 용도로 나누지 않는다(머리말 참조) — 저장이 동시에
 * 들어오면 용도가 무엇이든 한 줄로 세운다.
 */
const ROUTE_LOCK_KEY = "shipment_approval_routes:current";

/**
 * 결재선 잠금을 건다 — 트랜잭션 안에서 부르고, 트랜잭션이 끝나면 저절로 풀린다.
 *
 * 🔴 열쇠를 이 파일 밖에 적지 않기 위해 도우미로 내보낸다. 결재선 저장과 사용자
 * 계정 삭제가 **같은 열쇠**를 써야 서로 줄을 선다 — 한쪽이 문자열을 따로 적으면
 * 글자 하나만 달라도 두 잠금이 서로를 보지 못하고, 그 어긋남은 아무 오류도 내지
 * 않는다.
 */
export async function acquireShipmentApprovalRouteLock(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${ROUTE_LOCK_KEY}, 0))`);
}

/**
 * 같은 열쇠의 **공유** 잠금 — 결재선을 **읽어** 결재 행을 만드는 쪽(승인 요청 ·
 * 결재 결정)이 트랜잭션의 첫 잠금으로 건다.
 *
 * 공유 잠금끼리는 서로 막지 않으므로 요청 · 결정끼리는 예전처럼 동시에 돈다. 막는
 * 상대는 배타 잠금(acquireShipmentApprovalRouteLock)을 쥔 둘 — 결재선 저장과 사용자
 * 계정 삭제 — 뿐이다. 이것이 없으면 「결재선을 읽은 뒤 삭제가 커밋되고, 그다음에
 * 지워진 사람에게 지정된 행을 넣는」 틈이 생긴다. 삭제의 재지정은 커밋되지 않은 행을
 * 볼 수 없으므로 그 행은 최고관리자 비상구로만 풀린다.
 *
 * 🔴 트랜잭션의 **첫 잠금**이어야 한다 — 다른 행을 먼저 잠근 채로 이것을 기다리면,
 * 배타 잠금을 쥔 삭제가 그 행을 기다리는 순간 교착이 된다.
 */
export async function acquireShipmentApprovalRouteSharedLock(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ROUTE_LOCK_KEY}, 0))`);
}

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(saveUiThemeTokens 의 SaveRejected 와 같은 이유).
 *
 * 안쪽 함수(saveShipmentApprovalRouteInTx)를 자기 트랜잭션에서 부르는 쪽도 이것을
 * 받아 자기 결과로 바꿔야 하므로 내보낸다. 받은 뒤에도 **다시 던져** 그 트랜잭션을
 * 되돌려야 한다 — 잡고 끝내면 앞에서 쓴 것들이 커밋된다.
 */
export class ShipmentApprovalRouteSaveRejected extends Error {
  constructor(readonly result: Extract<SaveShipmentApprovalRouteResult, { ok: false }>) {
    super(result.message);
    this.name = "ShipmentApprovalRouteSaveRejected";
  }
}

/** 감사 기록에 싣는 단계 한 줄. */
type AuditStep = { stepOrder: number; approverUserId: string; approverName: string };

/**
 * 이 사람을 결재선에 올릴 수 없는 이유. 올릴 수 있으면 null.
 *
 * 조건 넷은 setShipmentRepresentative 가 강제하는 것과 같다 — 절차가 대표를
 * 대신하므로 자격을 넓히거나 좁히면 그 순간 두 축이 다른 말을 하게 된다.
 * 삭제를 먼저 보는 이유는, 지워진 계정에 「비활성입니다」라고 말하면 관리자가
 * 되살릴 수 있는 것으로 오해하기 때문이다.
 *
 * 내보내는 이유: 사용자 계정 삭제의 「결재 이어받을 사람」 자격과 영향 미리보기가
 * **같은 판정**을 봐야 한다(queries/user-deletion-impact.ts). 조건을 한 벌 더 적으면
 * 미리보기가 고르게 둔 사람을 새 판 저장이 거절하는 어긋남이 생긴다.
 */
export function approverBlockReason(row: {
  approvalStatus: string;
  isActive: boolean;
  lockedAt: Date | null;
  isDeleted: boolean;
}): string | null {
  if (row.isDeleted) return "삭제된 계정입니다";
  if (row.approvalStatus !== "APPROVED") return "승인되지 않은 계정입니다";
  if (!row.isActive) return "비활성화된 계정입니다";
  if (row.lockedAt !== null) return "잠긴 계정입니다";
  return null;
}

/** 안쪽 함수의 결과. 판 id 를 함께 돌려준다 — 부르는 쪽이 방금 얹은(또는 그대로인) 판을 가리켜야 할 때가 있다. */
export type SaveShipmentApprovalRouteInTxResult = {
  changed: boolean;
  version: number;
  /** 새로 얹었으면 새 판, 그대로였으면 지금 판의 id. */
  routeId: string;
};

/**
 * 그 용도에 판을 하나 얹는다 — **부르는 쪽의 트랜잭션 안에서.**
 *
 * 🔴 부르기 전에 두 가지가 끝나 있어야 한다(이 함수는 둘 다 하지 않는다):
 *  1. acquireShipmentApprovalRouteLock 으로 잠갔다 — 아래 「max + 1」 이 그 잠금에
 *     기댄다.
 *  2. 행위자를 판정했다 — 누가 결재선을 바꿀 수 있는가는 부르는 자리마다 다르다
 *     (저장 화면은 대표 지정과 같은 권한, 계정 삭제는 진짜 최고관리자).
 *
 * 막히면 ShipmentApprovalRouteSaveRejected 를 던진다. 부르는 쪽은 그것을 자기
 * 결과로 바꾸되 트랜잭션은 되돌려야 한다(클래스 주석).
 *
 * @param params.auditCause 감사 기록의 새 값에 `cause` 로 함께 적을 것. 주지 않으면
 *   감사 기록은 예전과 글자 그대로 같다(`cause` 칸 자체가 없다).
 */
export async function saveShipmentApprovalRouteInTx(
  tx: Tx,
  params: {
    approverUserIds: readonly string[];
    actorUserId: string;
    scope: ShipmentApprovalRouteScope;
    auditCause?: Record<string, unknown>;
  }
): Promise<SaveShipmentApprovalRouteInTxResult> {
  // 4. 입력 검증. 화면이 보낸 값을 그대로 믿지 않는다 — 용도도 함께 본다.
  //    타입이 막아 줄 것 같지만, 이 함수는 화면을 거치지 않고도 불릴 수 있고
  //    그때 엉뚱한 용도는 표의 enum 에서 「알 수 없는 오류」로 터진다.
  const validated = validateShipmentApprovalRouteInput({
    approverUserIds: [...params.approverUserIds],
    scope: params.scope,
  });
  if (!validated.ok) {
    throw new ShipmentApprovalRouteSaveRejected({
      ok: false,
      code: "INVALID_INPUT",
      message: validated.message,
    });
  }
  const nextApproverIds = validated.approverUserIds;

  // 5. 🔴 각 승인자의 자격을 지금 다시 확인한다. 화면이 받아 간 후보 목록은
  //    낡았을 수 있다.
  const approverRows = nextApproverIds.length
    ? await tx
        .select({
          id: users.id,
          name: users.name,
          approvalStatus: users.approvalStatus,
          isActive: users.isActive,
          lockedAt: users.lockedAt,
          isDeleted: users.isDeleted,
        })
        .from(users)
        .where(inArray(users.id, nextApproverIds))
    : [];
  const approverById = new Map(approverRows.map((row) => [row.id, row]));

  const nextSteps: AuditStep[] = [];
  for (let index = 0; index < nextApproverIds.length; index += 1) {
    const stepOrder = stepOrderFromIndex(index);
    const row = approverById.get(nextApproverIds[index]);
    if (!row) {
      throw new ShipmentApprovalRouteSaveRejected({
        ok: false,
        code: "INVALID_INPUT",
        message: `${stepOrder}번째 단계의 승인자를 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 지정해 주세요.`,
      });
    }
    const blockReason = approverBlockReason(row);
    if (blockReason) {
      throw new ShipmentApprovalRouteSaveRejected({
        ok: false,
        code: "INVALID_INPUT",
        message: `${stepOrder}번째 단계의 ${row.name} 님은 ${blockReason}. 승인 단계에서 빼거나 계정 상태를 먼저 되돌린 뒤 저장해 주세요.`,
      });
    }
    nextSteps.push({ stepOrder, approverUserId: row.id, approverName: row.name });
  }

  // 6. 🔴 **그 용도의** 지금 판을 읽는다. 「현재 절차」의 정의(그 용도 안에서
  //    version 이 가장 큰 판)는 queries/shipment-approval-routes.ts 와 같다.
  //    아래 세 가지 — 판 번호 매기기·「그대로인가」 판정·감사 기록의 이전 값
  //    — 가 전부 이 한 줄에서 나온다. scope 조건이 빠지면 셋이 한꺼번에
  //    다른 절차를 가리킨다.
  const [currentRoute] = await tx
    .select({ id: shipmentApprovalRoutes.id, version: shipmentApprovalRoutes.version })
    .from(shipmentApprovalRoutes)
    .where(eq(shipmentApprovalRoutes.scope, validated.scope))
    .orderBy(desc(shipmentApprovalRoutes.version))
    .limit(1);

  const currentSteps: AuditStep[] = currentRoute
    ? await tx
        .select({
          stepOrder: shipmentApprovalRouteSteps.stepOrder,
          approverUserId: shipmentApprovalRouteSteps.approverUserId,
          approverName: users.name,
        })
        .from(shipmentApprovalRouteSteps)
        .innerJoin(users, eq(users.id, shipmentApprovalRouteSteps.approverUserId))
        .where(eq(shipmentApprovalRouteSteps.routeId, currentRoute.id))
        .orderBy(asc(shipmentApprovalRouteSteps.stepOrder))
    : [];

  // 🔴 판이 **있을 때만** 「그대로다」로 끊는다. 판이 하나도 없는 상태에서
  // 0개짜리를 저장하는 것은 「절차를 쓰지 않기로 했다」를 처음으로 기록하는
  // 일이라, 남길 판도 감사 기록도 있어야 한다.
  if (
    currentRoute &&
    isSameRouteStepList(
      currentSteps.map((step) => step.approverUserId),
      nextApproverIds
    )
  ) {
    return { changed: false, version: currentRoute.version, routeId: currentRoute.id };
  }

  // 7. 새 판. 단계가 0개면 판만 만들고 단계는 넣지 않는다(정상이다).
  //    🔴 판 번호는 **그 용도 안에서** 이어진다 — 출하가 3판까지 갔어도 불출의
  //    첫 판은 1판이다. 사람이 읽는 번호는 「이 절차의 몇 번째 판인가」다.
  const nextVersion = (currentRoute?.version ?? 0) + 1;
  const [insertedRoute] = await tx
    .insert(shipmentApprovalRoutes)
    .values({ scope: validated.scope, version: nextVersion, createdByUserId: params.actorUserId })
    .returning({ id: shipmentApprovalRoutes.id });

  if (nextSteps.length > 0) {
    await tx.insert(shipmentApprovalRouteSteps).values(
      nextSteps.map((step) => ({
        routeId: insertedRoute.id,
        stepOrder: step.stepOrder,
        approverUserId: step.approverUserId,
      }))
    );
  }

  // 8. 감사 기록.
  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    // 🔴 CREATE 가 아니라 UPDATE 다. 표로는 판이 하나 새로 생기지만, 로그를
    // 읽는 사람이 찾는 것은 「결재선이 이렇게 바뀌었다」이고 그것을 보여
    // 주는 것은 previousValue/newValue 한 쌍이다. CREATE 로 남기면 이전 값이
    // 비어, 무엇에서 무엇으로 바뀌었는지 로그만 읽고 알 수 없다
    // (role-permissions.ts 가 「기본값으로 되돌림」을 UPDATE 로 남기는 것과
    // 같은 판단이다).
    actionType: "UPDATE",
    targetEntity: "shipment_approval_routes",
    targetRecordId: insertedRoute.id,
    // 🔴 id 만이 아니라 이름도 함께 적는다. 나중에 그 사용자가 소프트삭제돼도
    // 로그만 읽고 **누구였는지** 알 수 있어야 한다 — id 만 남기면 로그가
    // 스스로를 설명하지 못한다.
    //
    // 🔴 용도도 양쪽에 적는다. 대상 표 이름은 이제 어느 절차인지 말해 주지
    // 못하고(이름은 옛것이다), 판 번호는 용도마다 따로 세므로 「2판 → 3판」만
    // 보고는 무엇이 바뀌었는지 알 수 없다. 이전 값이 없는 첫 판일 때도
    // newValue 만 읽으면 용도를 알 수 있다.
    previousValue: currentRoute
      ? { scope: validated.scope, version: currentRoute.version, steps: currentSteps }
      : null,
    // `cause` 는 부르는 쪽이 줄 때만 붙는다 — 화면 저장의 감사 기록은 예전 그대로다.
    newValue: {
      scope: validated.scope,
      version: nextVersion,
      steps: nextSteps,
      ...(params.auditCause ? { cause: params.auditCause } : {}),
    },
  });

  return { changed: true, version: nextVersion, routeId: insertedRoute.id };
}

/**
 * @param scope 어느 절차를 저장하는가. 🔴 **기본값을 두지 않는다** — 부르는 쪽이
 *   언제나 적어야 새 용도를 더할 때 고쳐야 할 자리가 컴파일러에 보인다.
 */
export async function saveShipmentApprovalRoute(
  approverUserIds: readonly string[],
  actorUserId: string,
  scope: ShipmentApprovalRouteScope
): Promise<SaveShipmentApprovalRouteResult> {
  try {
    return await db.transaction(async (tx): Promise<SaveShipmentApprovalRouteResult> => {
      // 1. 🔴 잠금이 먼저다. 안쪽 함수가 읽는 「지금 최대 판 번호」가 이 잠금 밖에서는
      //    다른 트랜잭션과 같은 값으로 읽힐 수 있다.
      await acquireShipmentApprovalRouteLock(tx);

      // 2. 행위자를 트랜잭션 안에서 다시 읽는다 — 세션이 만들어진 뒤 역할이
      //    내려갔거나 계정이 지워졌을 수 있다.
      const [actor] = await tx
        .select({
          id: users.id,
          role: users.role,
          approvalStatus: users.approvalStatus,
          isDeveloper: users.isDeveloper,
        })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor || actor.approvalStatus !== "APPROVED") {
        throw new ShipmentApprovalRouteSaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "사용자 정보를 확인할 수 없습니다.",
        });
      }

      // 3. 인가 — 「출하 대표」 지정과 같은 열쇠·같은 수준이다.
      if (!(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))) {
        throw new ShipmentApprovalRouteSaveRejected({
          ok: false,
          code: "FORBIDDEN",
          // 🔴 용도를 말하지 않는다. 이 판정은 입력 검증(4)보다 **먼저**라
          // 그 시점의 `scope` 는 아직 확인되지 않은 값이고, 무엇보다 권한은
          // 용도마다 갈리지 않는다 — 열쇠도 수준도 하나다(머리말 참조).
          message: "승인 절차를 변경할 권한이 없습니다.",
        });
      }

      // 4~8. 판을 얹는다 — 안쪽 함수가 한다(머리말 「안쪽 함수와 바깥 함수」).
      const saved = await saveShipmentApprovalRouteInTx(tx, {
        approverUserIds,
        actorUserId: actor.id,
        scope,
      });

      // 결과 모양은 예전 그대로 — 판 id 는 바깥으로 내보내지 않는다.
      return { ok: true, changed: saved.changed, version: saved.version };
    });
  } catch (err) {
    if (err instanceof ShipmentApprovalRouteSaveRejected) return err.result;
    throw err;
  }
}
