import { NextResponse, type NextRequest } from "next/server";

import { NO_STORE, checkSharedApiToken } from "@/lib/api/shared-token";
import { listSelectableApproverCandidates } from "@/lib/db/queries/shipment-approval-routes";

/**
 * ============================================================================
 * GET /api/v1/users — 결재자가 될 수 있는 사람 (읽기 전용)
 * ============================================================================
 * 부르는 쪽: 재고 관리로 옮긴 승인 절차(결재선) 화면의 고르개. 재고 관리에는
 * 사람이 한 명뿐이라 A/S 의 명부를 읽어 간다. 자격은 공유 토큰 하나다 —
 * `lib/api/shared-token.ts` 의 머리 주석.
 *
 *   200  { generatedAt, count, users: [{ id, name, email, role }] }  이름 순
 *   401  { error: "unauthorized" }
 *   503  { error: "api_closed" }
 *
 * 🔴 **자격 규칙을 새로 쓰지 않는다.** `listSelectableApproverCandidates` 를 그대로
 * 부른다. 그 함수가 거는 넷(`approval_status = 'APPROVED'` · `is_active = true` ·
 * `locked_at IS NULL` · `is_deleted = false`)은 출하 대표 지정이 강제하는 조건과
 * 글자 그대로 같고, 그 까닭이 그 함수 주석에 길게 적혀 있다. 여기서 베껴 쓰면
 * 두 곳이 언젠가 갈라지고, 그날 A/S 화면과 재고 화면이 다른 사람을 보여 준다.
 *
 * 🔴 **나가는 칸은 넷뿐이다** — id · 이름 · 메일 · 역할. 자격 판정과 달리 칸은
 * 여기서 **한 줄씩 다시 고른다.** 지금 그 함수가 고르는 칸이 마침 이 넷이지만,
 * 언젠가 화면이 전화번호 한 칸을 더 쓰려고 그 함수에 칸을 더하는 날 행을 그대로
 * 넘기고 있으면 **그 칸이 조용히 밖으로 나간다.** 개인정보가 나가는 자리는
 * 늘어날 수 있는 목록이 아니라 적어 둔 목록이어야 한다.
 *
 * 설명서: `API_FOR_INTERNAL_SYSTEMS.md`.
 * ============================================================================
 */
export async function GET(request: NextRequest) {
  const denied = checkSharedApiToken(request);
  if (denied) return denied;

  const candidates = await listSelectableApproverCandidates();
  const users = candidates.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  }));

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), count: users.length, users },
    { headers: NO_STORE }
  );
}
