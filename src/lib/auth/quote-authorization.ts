import type { Role } from "@/lib/domain/types";
import { canViewDomesticOrders } from "./domestic-order-authorization";

/**
 * 견적서(/quotes) 화면의 서버 측 인가.
 *
 * domestic-order-authorization.ts 와 같은 관례다: Role 하나만 보는 순수 함수이고,
 * 사이드바 항목(navigation.ts)과 화면이 무엇을 그릴지 정할 때 쓴다. **막는 곳은
 * 여기가 아니다** — 페이지는 requireAreaAccessForCurrentUser("quotes")로 독립적으로
 * 다시 검사한다. 메뉴에서 감추는 것은 편의일 뿐이고, 주소를 직접 입력하는 사람은
 * 그 가드에서 막힌다.
 *
 * ── 내자 정리와 같은 세 역할이다. 그것도 베끼지 않고 불러서 쓴다 ────────
 * 견적서에는 **우리가 부른 값**이 통째로 들어 있다 — 부품 단가, 작업비, 합계.
 * 금액이 이유가 되어 AS_ENGINEER 와 INVENTORY_MANAGER 가 빠지는 것은 내자 정리와
 * 정확히 같은 판단이라(그 파일의 '금액(VAT별도)과 입금완료 여부가 있다'),
 * 역할 목록을 여기에 다시 적지 않고 canViewDomesticOrders 를 **호출한다.**
 * 같은 목록을 두 벌 적어 두면 한쪽만 고쳐지는 날이 오고, 그때 두 화면 중 어느
 * 쪽이 옳은지 답할 방법이 없다.
 *
 * 두 화면이 갈라져야 할 이유가 생기면 그때 여기에 자기 목록을 적는다. 지금은
 * 갈라질 이유가 없다 — 견적을 내는 사람과 내자 진행 상황을 적는 사람이 같다.
 *
 * ── 삭제는 관리자 이상이다 ────────────────────────────────────────────
 * 보기·고치기보다 좁다. 견적서는 **고객사에 실제로 나간 문서**라, 지우면
 * "무엇을 얼마에 불렀는가"의 기록이 목록에서 사라진다 — 되살릴 수 있긴 하지만
 * 그 판단을 영업 담당자 각자에게 맡기지 않는다. 제품 모델·고객사의 삭제가
 * 같은 이유로 관리자 이상인 것과 같은 자리다.
 *
 * 영구 삭제는 없다(mutations/quote-trash.ts 의 같은 항목). 그래서
 * canPermanentlyDelete... 류의 함수도 만들지 않는다.
 */
export function canViewQuotes(role: Role): boolean {
  return canViewDomesticOrders(role);
}

/**
 * 견적서를 만들거나 고칠 수 있는가. 조회와 같은 집합이다 — 견적을 내는 일은
 * 영업의 일이고, 볼 수만 있고 못 고치면 그 사람은 다시 Excel 을 열게 된다.
 * 그러면 시스템의 견적서와 실제로 보낸 견적서가 서로 다른 상태로 돌아간다.
 *
 * 이 함수만으로 막지는 않는다. 서버 액션은 이 판정에 더해 관리자가 설정한
 * 수준(role_permissions)도 함께 본다 — 두 관문 다 통과해야 저장된다.
 */
export function canEditQuotes(role: Role): boolean {
  return canViewQuotes(role);
}

export function canDeleteQuotes(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
