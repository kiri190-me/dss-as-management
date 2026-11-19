/**
 * ============================================================================
 * 🔴 **완료된 줄에서 고치는 길을 그릴 것인가** (2026-11-19)
 * ============================================================================
 * 사용자 지시 원문: 「[완료시 수정]권한이 없으면 [완료]건에 대해서 [수정],
 * [완료해제]버튼이 **보이지 않도록** 해줘.」
 *
 * 🔴 **흐리게가 아니라 아예 안 그린다.** 흐린 단추는 「언젠가 눌릴 수도 있는 단추」로
 * 읽혀 사람이 계속 누르게 만든다 — 이 권한은 역할 설정으로만 열리는 값이라, 그 자리에
 * 서는 사람이 아무리 눌러도 열리지 않는다.
 *
 * ── 🔴 **여기는 관문이 아니다** ─────────────────────────────────────────
 * 진짜 울타리는 저장 경로 안에 있다(db/mutations/domestic-orders.ts 의
 * canEditCompletedDomesticOrder 와 그것을 부르는 네 자리 · services/release-domestic-order.ts).
 * 화면을 안 거치는 길(PO 통로 · API)이 있으므로 **이 파일을 고쳐도 저장은 막히는
 * 그대로**다. 이 파일이 하는 일은 **그 거절을 미리 보여 주는 것**뿐이다.
 *
 * ── 🔴 **서버와 같은 판정을 쓰되, 두 잎을 접는 일은 페이지가 한다** ──────
 * 서버의 판정은 잎 **둘의 AND** 다 — `domesticOrders.edit` WRITE **그리고**
 * `domesticOrders.completedEdit` WRITE(그 함수 머리말에 AND 인 까닭의 전문이 있다).
 * 그 함수는 `server-only` 사슬 안에 있어 클라이언트가 못 부르므로, 페이지가 한 번
 * 재서 `canEditCompleted` 한 칸으로 접어 내려보낸다(app/(app)/domestic-orders/page.tsx).
 * 🔴 그래서 아래 `canEditCompleted` 는 **이미 AND 가 끝난 값**이다 — 여기서 `canEdit`
 * 과 또 겹쳐 묻지 않는다.
 *
 * ── 🔴 **완료 안 된 줄은 한 글자도 달라지지 않는다** ────────────────────
 * 이 파일에서 가장 중요한 규칙이다. 새 권한이 **평소 일**(완료 전의 수정 · 완료 처리)을
 * 막으면, 그날부터 영업·엔지니어는 내자 정리를 못 쓴다. 서버도 같은 차례다 — 관문이
 * 「완료되었는가」 안에만 서 있고, [완료 처리] 쪽에는 아예 서지 않는다.
 *
 * ── 🔵 **값은 그대로 보인다** ───────────────────────────────────────────
 * 사라지는 것은 **고치는 길**뿐이다. 완료된 줄의 글자·날짜·금액은 전과 같이 보이고,
 * [삭제]도 그대로다 — 그것은 `domesticOrders.lifecycle` 이 정하는 다른 권한이다.
 * ============================================================================
 */

/**
 * 지금 세션이 이 화면에서 가진 것 둘.
 *
 * 🔴 **둘 다 서버가 재서 내려보낸 값**이다(page.tsx). 화면이 역할을 보고 스스로
 * 판단하는 길을 두지 않는다 — 관리자가 설정 화면에서 바꾼 값이 역할 정책을 이기므로
 * (auth/permission-resolver.ts), 역할만 보면 설정과 어긋난다.
 */
export type DomesticOrderEditAccess = {
  /** `domesticOrders.edit` WRITE — 줄을 추가하고 고치고 완료 처리할 수 있는가. */
  canEdit: boolean;
  /**
   * 🔴 **완료된 줄도 고칠 수 있는가** — `edit` **AND** `completedEdit` 이 이미 접힌
   * 값이다(파일 머리말). 서버의 canEditCompletedDomesticOrder 와 같은 답이어야 한다.
   */
  canEditCompleted: boolean;
};

/**
 * 완료 여부를 가진 것. 🔵 **줄에도 회차에도 같은 모양**이라 한 타입이다
 * (queries/domestic-orders.ts 의 DomesticOrderDueDate 에도 `completedAt` 이 있다).
 */
type Completable = { completedAt: string | null };

/**
 * 🔴 **그것을 지금 고칠 수 있는가** — 줄에도 회차에도 같은 물음이다.
 *
 * 쓰이는 자리 셋(전부 DomesticOrderListScreen):
 *  · **줄** → [수정] 단추 · 눌러 고치는 칸 열하나 · 납기요청일 칸 · 납품 칸.
 *  · **줄** → [완료 해제]. 아직 완료가 아닌 줄에서는 그 단추가 [완료 처리]이고,
 *    그쪽은 이 판정이 **참**을 돌려주어 예전 그대로 그려진다.
 *  · **회차** → [N차 해제]. 마찬가지로 아직인 회차의 [N차 완료]는 그대로다.
 *
 * 🔴 **회차를 줄과 같은 함수로 재는 까닭**은 서버가 그렇게 막기 때문이다 — 회차 해제도
 * 줄 해제와 **같은 열쇠**를 쓴다(mutations/domestic-orders.ts 의 「줄 단위 해제와 같은
 * 열쇠다」). 여기서 갈라 적으면 「줄은 못 푸는데 회차는 푸는」 화면이 되고, 회차를 다
 * 풀면 줄의 완료까지 함께 거둬지므로 **회차 단추가 줄 해제의 뒷문**이 된다.
 *
 * 🔴 **회차는 줄의 완료 여부로 재지 않는다.** 회차가 둘 이상인 기타건은 1차만 끝나고
 * 줄은 아직 완료가 아닌 상태가 흔하다 — 그때 줄로 재면 완료된 1차의 [1차 해제]가
 * 그려지고, 눌러 봐야 서버가 거절한다(그 관문은 `!params.completed` 에만 선다).
 */
export function canEditDomesticOrderWhenCompleted(
  target: Completable,
  access: DomesticOrderEditAccess
): boolean {
  // 🔴 고칠 권한 자체가 없으면 완료 여부를 볼 것도 없다 — 그 사람의 화면은 이 변경
  //    전과 한 픽셀도 다르지 않아야 한다(칸도 단추도 원래 없었다).
  if (!access.canEdit) return false;
  // 🔴 완료 전에는 예전 열쇠 하나가 전부다. 새 권한이 평소 일을 막으면 안 된다.
  if (target.completedAt === null) return true;
  return access.canEditCompleted;
}

/**
 * 🔴 **읽기 전용이 된 까닭을 그 줄에 적을 것인가**(2026-11-19).
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * [수정]과 [완료 해제]가 **말없이 사라지면** 사람은 권한이 아니라 **고장**으로 읽는다.
 * 어제까지 있던 단추가 오늘 없어지는 변경이라 더 그렇다(배포 즉시 영업·엔지니어의
 * 완료된 줄에서 함께 사라진다 — 기본값이 최고관리자·관리자다).
 *
 * ── 🔴 **고칠 수 없는 사람에게는 안 적는다** ────────────────────────────
 * `canEdit` 이 거짓인 세션에는 완료 여부와 상관없이 원래부터 단추가 없었다. 그 화면에
 * 「읽기 전용」을 새로 적으면 **아무것도 안 바뀐 자리에 글자만 늘어난다.**
 *
 * 🔵 완료 안 된 줄에도 당연히 안 적는다 — 그 줄은 고칠 수 있다.
 */
export function showDomesticOrderCompletedReadOnlyNote(
  row: Completable,
  access: DomesticOrderEditAccess
): boolean {
  if (!access.canEdit) return false;
  if (row.completedAt === null) return false;
  return !access.canEditCompleted;
}

/**
 * 그 줄에 적는 글자. **짧다** — 22칼럼을 옆으로 밀어 보는 표의 순번 칸에 서고,
 * 줄마다 하나씩이라 한 문장을 적으면 표가 가로로 밀린다.
 */
export const DOMESTIC_ORDER_COMPLETED_READ_ONLY_LABEL = "읽기 전용";

/**
 * 마우스를 올렸을 때 뜨는 **까닭 한 줄**.
 *
 * 🔴 **권한 화면의 칸 이름을 그대로 적는다**(「완료 시 수정」 —
 * auth/permission-features.ts 의 그 잎 label). 「권한이 없습니다」만 적으면 사람은
 * 무엇을 받아야 하는지 모른 채 같은 자리를 계속 들여다본다.
 *
 * 🔴 **서버가 거절할 때 돌려주는 문장과 같은 말을 한다**
 * (mutations/domestic-orders.ts 의 COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE).
 * 🔵 그 상수를 **불러다 쓰지 않는 까닭**은 그것이 `server-only` 사슬 안에 있어서다 —
 * 이 파일을 쓰는 쪽은 `"use client"` 화면이라 그 모듈을 부르는 순간 import 가 던진다.
 * 글자가 두 벌이 되는 것을 아는 채로 둔 것이고, 둘이 **같은 낱말**을 말하는지는
 * 시험이 두 파일을 함께 읽어 본다(domestic-order-completed-row-readonly.test.ts).
 */
export const DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT =
  "완료 처리된 줄입니다. 고치거나 완료를 해제하려면 「완료 시 수정」 권한이 있어야 합니다.";
