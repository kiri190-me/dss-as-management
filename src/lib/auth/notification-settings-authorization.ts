import type { Role } from "@/lib/domain/types";
import { canManageRolePermissions } from "./role-permission-authorization";

/**
 * 알림 설정 화면 자체에 대한 접근 권한 — 관리자 이상.
 *
 * ── 왜 이름을 따로 두면서 답은 빌려 오는가 ──────────────────────────────
 * 이것은 역할별 접근 권한 설정과 **다른 질문**이다. 저쪽은 "누가 권한 경계를
 * 정하는가"이고 이쪽은 "누가 끼어들어 알릴 대상을 정하는가"다. 같은 저장소가
 * canReceivePartRequestNotifications를 canProcessPartRequests와 일부러 갈라
 * 둔 것과 같은 구분이라, 질문마다 이름이 있어야 나중에 한쪽만 바뀔 때 그
 * 자리가 어디인지 알 수 있다.
 *
 * 그렇다고 역할 명단을 여기에 다시 적지는 않는다. 지금 두 답은 같아야 하고
 * (두 화면이 `사용자 관리`의 탭 둘이다), 같아야 하는 값을 두 곳에 적어 두면
 * 한쪽만 고쳐지는 날이 온다 — 이 저장소가 이미 여러 번 겪은 어긋남이다
 * (permission-baseline.ts 머리말). 그래서 답은 한 곳에서 가져온다. 두 답이
 * 갈라져야 할 때 고칠 자리는 바로 이 함수 한 줄이다.
 *
 * 다른 *-authorization.ts와 같은 관례를 따른다: Role만 보는 순수 함수이고,
 * 페이지와 서버 액션과 mutation이 각자 독립적으로 다시 검사한다.
 *
 * 이 검사도 role_permissions 설정을 거치지 않는다. 다만 그 까닭은 저쪽과 다르다
 * — 알림 설정은 잘못 저장해도 스스로를 잠그지 못하므로(알림이 안 올 뿐 화면은
 * 그대로 열린다) 자기잠금 때문이 아니라, 이 화면이 속한 `사용자 관리` 영역
 * 자체가 이미 설정의 통제를 받기 때문이다. 같은 문을 두 번 잠글 필요는 없다.
 */
export function canManageNotificationSettings(role: Role): boolean {
  return canManageRolePermissions(role);
}
