import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for Product Model Management
 * (/product-models, /product-models/[id]) — pure functions of `Role`, used
 * both by the nav item / page gate and independently re-checked by
 * updateProductModelAction regardless of what the UI happened to render.
 *
 * Policy (approved scope):
 *  - View: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES, same role set as
 *    canViewCustomers. INVENTORY_MANAGER cannot access at all.
 *  - Edit (model_name/kind/manufacturer/description on the master row):
 *    SUPER_ADMIN/ADMIN only, mirroring canEditCustomers' "admin-narrow"
 *    shape for master/catalog data.
 */
export function canViewProductModels(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES";
}

export function canEditProductModels(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * 제품 모델을 휴지통으로 보내고, 되살리고, 즉시 완전삭제하는 권한.
 *
 * canDeleteCustomers와 같은 판단이다 — 삭제·복원·완전삭제를 하나로 묶고
 * (셋을 나누면 "지울 수는 있는데 되돌릴 수는 없는" 역할이 생긴다), 수정
 * 권한과는 별도 함수로 둔다(권한 트리에서 productModels.edit와
 * productModels.lifecycle이 따로 여닫히기 때문).
 */
export function canDeleteProductModels(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * 제품 모델에 붙는 외형 사진·회로도를 올리고, 휴지통으로 보내고, 되살리는 권한.
 *
 * 돌려주는 역할은 SUPER_ADMIN·ADMIN·**AS_ENGINEER**다. 이름의 '관리'는 권한
 * 수준 MANAGE와 무관하다 — 이 잎(productModels.files)에서 의미 있는 수준은
 * 쓰기(WRITE) 하나뿐이고, 보는 일은 productModels.view가 이미 덮는다.
 *
 * ── 왜 canEditProductModels를 빌려 쓰지 않는가 ──────────────────────────
 * 그 함수는 관리자 전용이다. 엔지니어에게 파일을 올리게 하려고 그것을 넓히면
 * 모델명·제조사·설명까지 함께 열린다 — 파일 한 장을 붙이게 하려다 마스터
 * 자료를 여는 셈이다. 그래서 별도 함수로 둔다. 이 둘이 갈라져 있는 한
 * "사진은 올리는데 모델명은 못 고치는" 엔지니어가 표현된다.
 *
 * ── 왜 올리기·지우기·되살리기를 한 함수로 묶는가 ────────────────────────
 * 나누면 "올릴 수는 있는데 잘못 올린 것을 못 지우는" 역할이 생긴다. 그러면
 * 초점 나간 사진 한 장을 치우려고 매번 관리자를 불러야 하고, 실제로는 아무도
 * 부르지 않아 쓰레기 파일이 쌓인다. 접수 건 첨부가 이미 같은 판단이다 —
 * repairCases.files의 WRITE 하나가 업로드와 소프트 삭제·복원을 함께 덮는다
 * (src/lib/server/actions/attachments.ts).
 */
export function canManageProductModelFiles(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER";
}
