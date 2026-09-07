import "server-only";
import { mockUsers } from "@/lib/domain/mock-data";
import { getUserById } from "@/lib/db/queries/users";
import { getAuthSource } from "@/lib/config/auth-source";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { SessionPayload } from "./session";

/**
 * Single source of truth for turning a verified session into the
 * ActingUser shape every repair-case page/action needs — source-aware
 * (AUTH_SOURCE), replacing what used to be 6 duplicated
 * mockUsers.find(session.userId) call sites.
 *
 * In "database" mode this re-reads the DB on every call (never cached off
 * the session token) so a deactivated/demoted/deleted account loses access
 * immediately rather than waiting out the token's 8-hour expiry. In "mock"
 * mode this preserves the exact prior lookup — local/mock behavior is
 * unchanged.
 */
export async function resolveActingUserForSession(
  session: SessionPayload
): Promise<ActingUser | null> {
  if (getAuthSource() === "database") {
    const row = await getUserById(session.userId);
    if (!row) {
      return null;
    }

    // 통합 로그인이 이 사람의 세션을 끊었는가.
    //
    // 이 시스템의 세션은 서명된 토큰이라 발급된 뒤에는 스스로 유효하다.
    // 포털이 로그아웃이나 정지를 알려오면 기준선이 올라가고, 그보다 먼저
    // 발급된 토큰은 여기서 전부 무효가 된다
    // (api/auth/sso/backchannel-logout).
    //
    // 조회를 더 하지 않는다 — 위에서 이미 읽은 행에 들어 있다. 검사를
    // 여기 둔 이유이기도 하다: 매 요청 도는 자리에 공짜로 얹을 수 있다.
    //
    // issuedAt은 초 단위이고 기준선은 밀리초까지 있다. 같은 초에 걸린
    // 토큰은 무효 쪽으로 기운다 — 끊긴 세션을 살려두는 것보다 살아 있는
    // 세션을 한 번 더 끊는 편이 안전하다.
    if (
      row.sessionsValidFrom &&
      session.issuedAt * 1000 < row.sessionsValidFrom.getTime()
    ) {
      return null;
    }

    // isDeveloper는 매 요청 살아 있는 행에서 읽는다 — 세션 토큰에 담지 않는다.
    // 담으면 표시를 끈 뒤에도 토큰이 만료될 때까지 승격이 남는다.
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      approvalStatus: row.approvalStatus,
      isDeveloper: row.isDeveloper,
    };
  }

  // mock 사용자에는 is_developer 칸이 없다. 데모에 개발자를 만들 이유도 없으므로
  // 언제나 false — mock 모드의 동작은 이 기능을 넣기 전과 완전히 같다.
  const user = mockUsers.find((candidate) => candidate.id === session.userId);
  return user
    ? { id: user.id, name: user.name, role: user.role, approvalStatus: user.approvalStatus, isDeveloper: false }
    : null;
}

/**
 * 세션의 역할에 **개발자 표시만** 덧붙인 행위자.
 *
 * 서버 액션의 빠른 되돌림(fast pre-check)들이 쓴다. 그 검사들은 예전부터
 * session.role 로 판정해 왔고, 이 함수는 그 성질을 바꾸지 않는다 — **역할은
 * 여전히 토큰 값이다.** 세션의 역할 대신 살아 있는 역할까지 읽도록 옮기는 것은
 * 별도의 보안 변경이라 여기서 하지 않는다.
 *
 * 개발자 표시는 토큰에 담기지 않으므로(위 주석) 살아 있는 행에서만 읽을 수 있고,
 * 읽지 못하면 false 로 떨어진다 — 닫히는 쪽으로 실패한다. 어차피 그다음의 실제
 * 판정(mutation)이 DB 에서 행위자를 다시 읽어 확정한다.
 */
export async function sessionActorWithDeveloperFlag(
  session: SessionPayload
): Promise<{ role: SessionPayload["role"]; isDeveloper: boolean }> {
  const actingUser = await resolveActingUserForSession(session);
  return { role: session.role, isDeveloper: actingUser?.isDeveloper ?? false };
}
