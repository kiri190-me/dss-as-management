import "server-only";

import { cache } from "react";
import { getAuthSource } from "@/lib/config/auth-source";
import { loadStoredRolePermissions } from "@/lib/db/queries/role-permissions";
import type { Role } from "@/lib/domain/types";
import {
  PERMISSION_AREAS,
  lowerPermissionLevel,
  meetsPermissionLevel,
  type PermissionLevel,
} from "./permission-areas";
import { baselinePermissionLevel } from "./permission-baseline";

/**
 * ============================================================================
 * 실효 권한 — 이 앱에서 "무엇을 할 수 있는가"를 답하는 유일한 지점
 * ============================================================================
 *
 *     실효 권한 = min(기존 코드가 허용하는 것, 관리자가 설정한 수준)
 *
 * 설정이 없으면(표에 행이 없으면) 상한이 그대로 실효 권한이 된다 — 즉 아무도
 * 설정을 만지지 않은 상태에서는 이 기능을 넣기 전과 동작이 완전히 같다.
 *
 * ── 요청 한 번에 조회 한 번 ─────────────────────────────────────────────
 * React의 cache()로 감쌌다. 한 페이지를 그리는 동안 레이아웃·페이지·여러
 * 서버 액션이 각각 물어봐도 DB는 한 번만 읽는다. 요청이 끝나면 캐시도 사라지므로
 * 설정을 바꾼 직후 다음 요청부터 바로 반영된다 — 프로세스 수명 동안 남는
 * 캐시를 두면 "저장했는데 안 바뀐다"가 되고, 그건 권한에서 가장 나쁜 종류의
 * 버그다.
 *
 * ── mock 모드 ───────────────────────────────────────────────────────────
 * AUTH_SOURCE가 database가 아니면 DB를 읽지 않고 상한을 그대로 쓴다. 로컬
 * 데모 모드에는 role_permissions 표가 없을 수 있고, 없다고 해서 화면이 잠기면
 * 안 된다.
 * ============================================================================
 */

export type EffectivePermissions = {
  role: Role;
  /** 영역 키 → 실효 수준. PERMISSION_AREAS의 모든 영역이 반드시 들어 있다. */
  levels: Record<string, PermissionLevel>;
};

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

const loadOnce = cache(async (): Promise<Record<string, Record<string, PermissionLevel>> | null> => {
  if (getAuthSource() !== "database") return null;
  try {
    return await loadStoredRolePermissions();
  } catch (err) {
    // 마이그레이션 0042를 아직 적용하지 않은 DB. 이때 예외를 그대로 던지면
    // 레이아웃이 권한을 읽는 구조상 **모든 화면이 한꺼번에 죽는다**. 아직
    // 설정이 존재할 수 없는 상태이므로, 기존 정책(상한)을 그대로 쓰는 것이
    // 정확히 이 기능을 넣기 전의 동작이다 — 권한이 넓어지지 않는다.
    //
    // 이 예외는 "표 없음" 하나만 삼킨다. 연결 실패·권한 오류 같은 다른 사고까지
    // 조용히 넘기면, 설정을 저장해 둔 운영 환경에서 제한이 슬그머니 풀린 채로
    // 돌아가게 된다.
    if (isUndefinedTableError(err)) {
      console.warn("role_permissions 테이블이 없습니다 — 마이그레이션 0042 적용 전까지 기본 정책으로 동작합니다.");
      return null;
    }
    throw err;
  }
});

function isUndefinedTableError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === UNDEFINED_TABLE;
}

export async function resolveEffectivePermissions(role: Role): Promise<EffectivePermissions> {
  const stored = await loadOnce();
  const configured = stored?.[role] ?? {};

  const levels: Record<string, PermissionLevel> = {};
  for (const area of PERMISSION_AREAS) {
    const ceiling = baselinePermissionLevel(area.key, role);
    const chosen = configured[area.key];
    levels[area.key] = chosen ? lowerPermissionLevel(ceiling, chosen) : ceiling;
  }
  return { role, levels };
}

export async function getPermissionLevel(role: Role, areaKey: string): Promise<PermissionLevel> {
  const resolved = await resolveEffectivePermissions(role);
  return resolved.levels[areaKey] ?? "NONE";
}

/** 이 역할이 그 영역에서 required 이상인가. 서버 액션·페이지 가드가 부른다. */
export async function hasPermission(role: Role, areaKey: string, required: PermissionLevel): Promise<boolean> {
  return meetsPermissionLevel(await getPermissionLevel(role, areaKey), required);
}

/** 메뉴에 들어갈 수 있는 영역 키. 사이드바가 이 목록으로 항목을 거른다. */
export async function listAccessibleAreaKeys(role: Role): Promise<string[]> {
  const resolved = await resolveEffectivePermissions(role);
  return PERMISSION_AREAS.filter((area) => resolved.levels[area.key] !== "NONE").map((area) => area.key);
}
