import type { PromotableActor } from "@/lib/auth/developer-promotion";
import { actorMay } from "@/lib/auth/developer-promotion";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 실행 노드 카드가 **어느 단추를 그릴지** 정하는 판정. 화면 편의일 뿐이고,
 * 서버(db/mutations/procedure-case-execution.ts)가 같은 모양으로 독립해서 다시
 * 판정한다 — 숨긴 단추는 enforcement 가 아니다.
 *
 * 🔴 이 파일이 생긴 까닭: 같은 세 판정이 ExecutionNodeCard 안에 지역 함수로
 * 있었는데, 「지금 할 일」 큰 카드(CurrentTaskCard)가 **같은 노드를 같은 규칙
 * 으로** 그려야 한다. 두 벌로 두면 한쪽만 고치는 날이 오고, 타입이 같아서
 * 컴파일러는 아무 말도 하지 않는다. 그래서 한 곳에 둔다.
 *
 * 역할을 `Role` 로 좁히지 않는 까닭은 developer-promotion.ts 의 PromotableActor
 * 와 같다 — 이 카드들은 서버에서 내려온 역할을 `string` 으로 받는다.
 */

export type ExecutionActor = PromotableActor<string> & { id: string };

function canActOrdinary(role: string, actorId: string, effectiveAssigneeId: string | null): boolean {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return effectiveAssigneeId === actorId;
  return false;
}

function canReopenCompletedOrSkipped(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

function canReopenBlocked(role: string, actorId: string, effectiveAssigneeId: string | null): boolean {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return effectiveAssigneeId === actorId;
  return false;
}

/**
 * 시작·완료·건너뛰기·차단·메모 — Phase 5A 의 「보통 변이」 묶음.
 *
 * ⚠️ 승격(개발자 표시)은 **역할 축에만** 더한다(developer-promotion.ts).
 * 배정 인자는 그대로다 — 개발자라고 해서 그 사람이 이 건에 배정된 것이 되지는
 * 않는다.
 */
export function isOrdinaryActionEligible(actor: ExecutionActor, effectiveAssigneeId: string | null): boolean {
  return actorMay(actor, (role) => canActOrdinary(role, actor.id, effectiveAssigneeId));
}

/**
 * 재개(되돌림). 차단됨은 담당 엔지니어도 풀 수 있지만, 이미 끝난(완료·건너뜀)
 * 것을 되돌리는 것은 관리자 이상이다 — 「끝났다는 판단」을 뒤집는 일이라 문턱이
 * 더 높다(Phase 5A 계획 §8).
 */
export function isReopenEligible(
  actor: ExecutionActor,
  status: ProcedureCaseExecutionNodeStatus,
  effectiveAssigneeId: string | null
): boolean {
  return status === "BLOCKED"
    ? actorMay(actor, (role) => canReopenBlocked(role, actor.id, effectiveAssigneeId))
    : actorMay(actor, canReopenCompletedOrSkipped);
}
