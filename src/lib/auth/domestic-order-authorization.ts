import type { Role } from "@/lib/domain/types";

/**
 * 내자 정리(/domestic-orders) 화면의 서버 측 인가.
 *
 * customer-authorization.ts 와 같은 관례다: Role 하나만 보는 순수 함수이고,
 * 사이드바 항목(navigation.ts)과 화면이 무엇을 그릴지 정할 때 쓴다. 다만
 * **막는 곳은 여기가 아니다** — 페이지는 requireAreaAccessForCurrentUser
 * ("domesticOrders")로 독립적으로 다시 검사한다. 메뉴에서 감추는 것은 편의일
 * 뿐이고, 주소를 직접 입력하는 사람은 그 가드에서 막힌다.
 *
 * 정책(승인된 범위):
 *  - 조회: SUPER_ADMIN / ADMIN / SALES.
 *
 *    이 화면에는 **금액(VAT별도)과 입금완료 여부**가 있다. 거래 금액과 수금
 *    상황은 수리 작업에 필요한 정보가 아니라 영업·경영의 정보라서, 고객사
 *    관리(canViewCustomers)와 달리 AS_ENGINEER 를 넣지 않았다 — 엔지니어가
 *    맡은 장비의 고객사와 고장 내역은 접수 건 화면에서 이미 다 볼 수 있고,
 *    그 건이 얼마에 팔렸고 돈이 들어왔는지는 그 일에 필요하지 않다.
 *    INVENTORY_MANAGER 가 빠지는 것은 고객사 관리와 같은 이유다.
 *
 *  - 추가·수정(2단계): 조회와 **같은 세 역할**이다.
 *
 *    보기보다 좁히지 않은 이유는 이 표가 무엇인지에 있다. 내자 정리는 영업이
 *    고객사에 보내는 진행 상황표이고, 발주서번호·견적서번호·납품일·입금 여부를
 *    실제로 아는 사람이 영업이다. 볼 수만 있고 못 고치면 그 사람은 다시 Excel
 *    에 적게 되고, 그러면 표와 시트가 서로 다른 값을 갖는 원래 상태로 돌아간다.
 *
 *    반대로 넓히지도 않았다 — 볼 수 없는 역할(AS_ENGINEER / INVENTORY_MANAGER)
 *    에게 쓰기가 열리면 "못 보는 화면에 저장은 되는" 조합이 만들어진다.
 *
 *  - 삭제·휴지통: **아직 없다.** 화면도 서버 액션도 만들지 않았으므로
 *    canDelete... 류의 함수를 미리 만들어 두지 않는다. 쓰이지 않는 권한 함수는
 *    "이미 정해진 정책"처럼 읽혀서, 다음 단계에서 실제로 판단해야 할 것을
 *    판단하지 않고 지나가게 만든다.
 */
export function canViewDomesticOrders(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "SALES";
}

/**
 * 행을 추가하거나 고칠 수 있는가. 조회와 같은 집합이라 canViewDomesticOrders 를
 * 그대로 부른다 — 같은 목록을 두 번 적어 두면 한쪽만 고쳐지는 날이 오고, 그때
 * "보이는데 저장은 안 되는" 또는 그 반대의 어긋남이 생긴다.
 *
 * 이 함수만으로 막지는 않는다. 서버 액션은 이 판정에 더해 관리자가 설정한
 * 수준(role_permissions)도 함께 본다 — 두 관문 다 통과해야 저장된다.
 */
export function canEditDomesticOrders(role: Role): boolean {
  return canViewDomesticOrders(role);
}
