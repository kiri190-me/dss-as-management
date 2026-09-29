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
 *  - 조회: SUPER_ADMIN / ADMIN / SALES / AS_ENGINEER.
 *
 *    🔴 **2026-09-29 에 AS_ENGINEER 가 더해졌다 — 사용자가 정했다.**
 *    원문: 「엔지니어도 PO/내자에 모두 읽기/쓰기 할 수 있어야 해.」
 *
 *    이 화면에는 **금액(VAT별도)과 입금완료 여부**가 있다. 그 금액과 입금
 *    사실이 엔지니어에게 보이고 엔지니어가 고칠 수 있게 된다는 것을 **미리
 *    짚어 확인받고 내린 결정이다** — 「그대로 간다, 다 열어도 된다」.
 *    그러니 나중에 이 줄을 보고 "엔지니어가 실수로 들어갔다"거나 "금액이
 *    열리는 줄은 몰랐을 것"이라고 판단해 **되돌리지 말 것.** 되돌리려면
 *    사용자에게 다시 물어야 한다.
 *
 *    ── 2026-09-29 이전의 정책과 그 까닭(기록으로 남긴다) ────────────────
 *    그전에는 SUPER_ADMIN / ADMIN / SALES 셋뿐이었다. 까닭에도 근거가 있었다:
 *    거래 금액과 수금 상황은 수리 작업에 필요한 정보가 아니라 영업·경영의
 *    정보이고, 엔지니어가 맡은 장비의 고객사와 고장 내역은 접수 건 화면에서
 *    이미 다 볼 수 있으니 그 건이 얼마에 팔렸고 돈이 들어왔는지까지는 그 일에
 *    필요하지 않다 — 그래서 고객사 관리(canViewCustomers)와 달리 엔지니어를
 *    넣지 않았다. 뒤집힌 것은 「필요 없는 정보는 감춘다」는 원칙이 아니라
 *    **엔지니어의 일에 이 표가 필요한가**라는 사실 판단 쪽이다.
 *
 *    INVENTORY_MANAGER 는 이번 결정에 없다 — 그대로 빠져 있고, 빠지는 이유도
 *    종전과 같다(고객사 관리와 같은 자리).
 *
 *  - 추가·수정(2단계): 조회와 **같은 네 역할**이다.
 *
 *    보기보다 좁히지 않은 이유는 이 표가 무엇인지에 있다. 내자 정리는 영업이
 *    고객사에 보내는 진행 상황표이고, 발주서번호·견적서번호·납품일·입금 여부를
 *    실제로 아는 사람이 영업이다. 볼 수만 있고 못 고치면 그 사람은 다시 Excel
 *    에 적게 되고, 그러면 표와 시트가 서로 다른 값을 갖는 원래 상태로 돌아간다.
 *    2026-09-29 의 결정이 「읽기/쓰기 모두」였으므로 엔지니어도 같은 자리에
 *    들어온다 — 보기만 열고 쓰기를 막는 선택지는 애초에 없었다.
 *
 *    보기와 쓰기를 같은 집합으로 묶는 규칙 자체는 그대로다 — 볼 수 없는
 *    역할에게 쓰기가 열리면 "못 보는 화면에 저장은 되는" 조합이 만들어진다.
 *    지금 볼 수 없는 역할은 INVENTORY_MANAGER 하나이고, 그 역할에는 쓰기도 없다.
 *
 *  - 삭제·휴지통(2026-09-11): **관리자 이상**(SUPER_ADMIN / ADMIN)이다.
 *    🔴 2026-09-29 의 결정은 「읽기/쓰기」까지라 **여기는 바뀌지 않았다** —
 *    엔지니어는 줄을 지우지도 되살리지도 못한다. 아래 canDeleteDomesticOrders
 *    참조.
 */
export function canViewDomesticOrders(role: Role): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "SALES" ||
    role === "AS_ENGINEER"
  );
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

/**
 * 줄을 휴지통으로 보내고, 되살리고, 휴지통에서 바로 완전 삭제할 수 있는가.
 * 셋이 한 함수다 — 나누면 "지울 수는 있는데 되살릴 수는 없는" 역할이 만들어진다
 * (customer-authorization.ts 의 canDeleteCustomers 와 같은 판단).
 *
 * ── 보기·고치기보다 좁다 ────────────────────────────────────────────────
 * 🔴 2026-09-29 에 보기·고치기가 AS_ENGINEER 까지 넓어지면서 그 간격이 더
 * 벌어졌다. **이 함수는 그때 손대지 않았다** — 사용자가 정한 것은 「읽기/쓰기」
 * 까지이고, 삭제·휴지통은 관리자 이상 그대로다. 위 canViewDomesticOrders 에
 * 엔지니어가 있다는 이유로 여기에도 넣지 말 것.
 *
 * 이 표에는 **세금계산서 발행일과 입금 사실**이 들어 있다. 휴지통에 있는 동안은
 * 되살릴 수 있지만, 15일이 지나면 정리 스크립트가 영구히 지운다 — 그 판단을
 * 영업 담당자 각자에게 맡기지 않는다. 견적서(canDeleteQuotes)·고객사·제품
 * 모델의 삭제가 같은 이유로 관리자 이상인 것과 같은 자리다.
 *
 * ── 견적서와 같은 집합이지만 불러 쓰지 않는다 ───────────────────────────
 * quote-authorization.ts 가 이미 이 파일을 import 한다(canViewQuotes 가
 * canViewDomesticOrders 를 부른다). 여기서 canDeleteQuotes 를 부르면 두 파일이
 * 서로를 import 하게 된다. 두 집합이 같다는 사실은 시험이 역할마다 대조해
 * 지킨다(domestic-order-authorization.test.ts).
 *
 * 이 함수만으로 막지는 않는다. 실제 판정은 서버 액션이 관리자가 설정한
 * 수준(hasPermission("domesticOrders", "MANAGE"))으로 한다 — 이 함수는
 * permission-baseline.ts 가 그 기본값을 계산할 때 쓰인다.
 */
export function canDeleteDomesticOrders(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
