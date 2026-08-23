import "server-only";

import type { Role } from "@/lib/domain/types";
import { hasPermission } from "./permission-resolver";

/**
 * ============================================================================
 * 재고 화면이 쓰는 능력 — 서버에서 한 번 해석해 내려보낸다
 * ============================================================================
 * 재고 화면들은 지금까지 역할(actingUserRole)을 그대로 받아 화면 안에서
 * can*()를 불러 버튼을 감췄다. 권한 판정이 role_permissions 설정으로 넘어간
 * 이상 그 방식은 쓸 수 없다 — 설정은 서버에서만 읽을 수 있고, 화면이 역할만
 * 보고 판단하면 **관리자가 열어 준 권한이 버튼에는 반영되지 않는다**(또는 그
 * 반대로 없는 버튼이 보인다).
 *
 * 그래서 서버 컴포넌트가 이 함수로 한 번 해석해 참/거짓 세 개만 내려보낸다.
 * 화면은 판단하지 않고 받은 대로 그린다.
 *
 * ── 이것이 최종 관문은 아니다 ───────────────────────────────────────────
 * 버튼을 감추는 것은 안내이지 차단이 아니다. 실제 차단은 종전대로 mutation이
 * 각자 다시 검사한다(inventory.ts, inventory-part-requests.ts). 화면이 뚫려도
 * 서버가 막는 구조는 그대로다.
 * ============================================================================
 */
export type InventoryCapabilities = {
  /** 부품 마스터를 만들고 고칠 수 있는가. */
  parts: boolean;
  /** 입고·반품·사용으로 실제 수량을 움직일 수 있는가. */
  stock: boolean;
  /** 올라온 부품 요청을 출고·거부·부분 마감할 수 있는가. */
  requestProcessing: boolean;
  /**
   * 부품 마스터를 휴지통으로 보내고 되살릴 수 있는가.
   *
   * parts(등록·수정)와 따로 내려보낸다 — 기본값은 더 좁고(관리자 이상),
   * 설정으로도 따로 여닫히기 때문이다. 하나로 접으면 재고 담당자에게 삭제가
   * 함께 열린다.
   */
  lifecycle: boolean;
};

export async function resolveInventoryCapabilities(role: Role): Promise<InventoryCapabilities> {
  const [parts, stock, requestProcessing, lifecycle] = await Promise.all([
    hasPermission(role, "inventory.parts", "WRITE"),
    hasPermission(role, "inventory.stock", "WRITE"),
    hasPermission(role, "inventory.requestProcessing", "MANAGE"),
    hasPermission(role, "inventory.lifecycle", "MANAGE"),
  ]);
  return { parts, stock, requestProcessing, lifecycle };
}
