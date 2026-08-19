import "server-only";

import type { Role } from "@/lib/domain/types";
import { hasPermission } from "./permission-resolver";

/**
 * ============================================================================
 * 고객사 화면이 쓰는 능력 — 서버에서 한 번 해석해 내려보낸다
 * ============================================================================
 * 이 영역은 하위 기능 권한을 만든 계기 그 자체다. 등록은 영업까지 되지만 이름
 * 변경은 관리자만이고, 담당자 추가·수정은 영업까지 되지만 삭제는 관리자만이다.
 * 메뉴 하나에 수준 하나만 붙이던 시절에는 이 구분을 표현할 수 없어서 "고객사 =
 * 읽기+쓰기"로 접으면 영업이 이름까지 고칠 수 있게 됐다.
 *
 * 그래서 두 노드가 노드 안에서 수준으로 갈린다:
 *   customers.endUsers  쓰기 = 등록,        관리 = 이름 변경
 *   customers.contacts  쓰기 = 추가·수정,   관리 = 삭제
 *
 * 화면은 이미 서버가 판단한 참/거짓을 받는 구조였다(customers/[id]/page.tsx).
 * 바뀐 것은 그 참/거짓을 역할표가 아니라 설정에서 구한다는 점뿐이다.
 *
 * 버튼을 감추는 것은 안내이지 차단이 아니다 — 실제 차단은 종전대로 서버 액션이
 * 각자 다시 검사한다(server/actions/end-users.ts, update-customer.ts).
 * ============================================================================
 */
export type CustomerCapabilities = {
  /** 고객사 자체의 정보를 고칠 수 있는가. */
  edit: boolean;
  /** 새 End-User를 등록할 수 있는가. */
  createEndUser: boolean;
  /** 기존 End-User의 이름을 고칠 수 있는가 — 등록보다 한 단계 위다. */
  renameEndUser: boolean;
  /** 담당자를 추가·수정할 수 있는가. */
  editContact: boolean;
  /** 담당자를 삭제할 수 있는가 — 추가·수정보다 한 단계 위다. */
  removeContact: boolean;
};

export async function resolveCustomerCapabilities(role: Role): Promise<CustomerCapabilities> {
  const [edit, createEndUser, renameEndUser, editContact, removeContact] = await Promise.all([
    hasPermission(role, "customers.edit", "WRITE"),
    hasPermission(role, "customers.endUsers", "WRITE"),
    hasPermission(role, "customers.endUsers", "MANAGE"),
    hasPermission(role, "customers.contacts", "WRITE"),
    hasPermission(role, "customers.contacts", "MANAGE"),
  ]);
  return { edit, createEndUser, renameEndUser, editContact, removeContact };
}
