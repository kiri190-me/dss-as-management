import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import { readSession } from "./session";
import { resolveActingUserForSession } from "./acting-user";
import { getPermissionLevel } from "./permission-resolver";
import { meetsPermissionLevel, type PermissionLevel } from "./permission-areas";

/**
 * ============================================================================
 * 메뉴 진입 가드
 * ============================================================================
 * 사이드바에서 항목을 감추는 것은 막은 것이 아니다 — 주소를 직접 입력하거나
 * 예전 링크를 누르면 그대로 들어와진다. 그래서 14개 메뉴 페이지마다 이 함수를
 * 한 줄 부른다.
 *
 * 미들웨어로 한 곳에서 처리하는 방법도 있지만 고르지 않았다. 이 앱에는
 * 미들웨어가 없고, 권한 판정에 DB 조회가 필요해 실행 환경(Edge/Node) 문제를
 * 새로 떠안게 된다. 페이지마다 한 줄씩 적어 두면 grep 한 번으로 "어느 화면이
 * 무엇을 요구하는지"가 다 보인다 — 권한처럼 빠뜨리면 조용히 뚫리는 것은
 * 눈에 보이는 편이 낫다.
 *
 * 막힐 때 대시보드로 조용히 보내지 않고 안내 화면(/no-access)으로 보낸다.
 * 이유를 모른 채 튕기면 사용자는 고장으로 여기고, 관리자는 무엇을 풀어 줘야
 * 하는지 알 수 없다.
 */
export async function requireAreaAccess(
  areaKey: string,
  role: Role,
  required: PermissionLevel = "READ"
): Promise<void> {
  const level = await getPermissionLevel(role, areaKey);
  if (!meetsPermissionLevel(level, required)) {
    redirect(`/no-access?area=${encodeURIComponent(areaKey)}`);
  }
}

/** 리다이렉트 없이 가부만 묻는다 — 한 화면 안에서 일부만 감출 때 쓴다. */
export async function hasAreaAccess(
  areaKey: string,
  role: Role,
  required: PermissionLevel = "READ"
): Promise<boolean> {
  return meetsPermissionLevel(await getPermissionLevel(role, areaKey), required);
}

/**
 * 지금 요청의 사용자 역할. 요청 한 번에 한 번만 실제로 조회한다(cache).
 *
 * 페이지마다 role을 인자로 넘기게 하지 않은 이유: 넘기는 방식이면 어떤 페이지는
 * 세션의 role(발급 시점 값)을, 어떤 페이지는 다시 읽은 값을 쓰게 된다.
 * 강등된 계정이 토큰 만료 전까지 예전 권한으로 다니는 구멍이 그렇게 생긴다.
 * 여기서는 언제나 살아 있는 계정을 다시 읽는다.
 */
const currentRole = cache(async (): Promise<Role | null> => {
  const session = await readSession();
  if (!session) return null;
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || actingUser.approvalStatus !== "APPROVED") return null;
  return actingUser.role;
});

/**
 * 페이지 한 줄짜리 가드. 세션이 없으면 로그인으로, 권한이 모자라면 안내
 * 화면으로 보낸다.
 */
export async function requireAreaAccessForCurrentUser(
  areaKey: string,
  required: PermissionLevel = "READ"
): Promise<void> {
  const role = await currentRole();
  if (!role) redirect("/login");
  await requireAreaAccess(areaKey, role, required);
}
