import "server-only";

import { cache } from "react";
import { getAuthSource } from "@/lib/config/auth-source";
import { loadStoredRolePermissions } from "@/lib/db/queries/role-permissions";
import type { Role } from "@/lib/domain/types";
import { PERMISSION_AREAS, meetsPermissionLevel, type PermissionLevel } from "./permission-areas";
import { PERMISSION_LEAF_KEYS, areaLevelFromLeaves } from "./permission-features";
import { baselineLeafLevel } from "./permission-baseline";

/**
 * ============================================================================
 * 실효 권한 — 이 앱에서 "무엇을 할 수 있는가"를 답하는 유일한 지점
 * ============================================================================
 *
 *     실효 권한 = 관리자가 설정한 수준 (없으면 기본 정책)
 *
 * 설정이 없으면(표에 행이 없으면) 기본 정책이 그대로 실효 권한이 된다 — 즉
 * 아무도 설정을 만지지 않은 상태에서는 이 기능을 넣기 전과 동작이 완전히 같다.
 *
 * ── 왜 더 이상 min()이 아닌가 ───────────────────────────────────────────
 * 처음에는 min(기존 정책, 설정값)이었다. 그러면 설정으로 좁힐 수만 있고, 화면에서
 * 수준을 올려도 아무 일도 일어나지 않는다. 넓히기를 요구받으면서 이 구조로는
 * 답이 나오지 않았다 — 판정 권한이 설정 쪽으로 넘어와야 한다.
 *
 * 그 대신 두 가지로 막는다. 첫째, 권한 단위를 하위 기능까지 쪼개서 4단계 사다리가
 * 지금 정책만큼 잘게 표현되게 했다(permission-features.ts). 둘째, 기본 정책보다
 * 높은 값은 최고관리자만 저장할 수 있다 — 관리자가 자기 역할에 없던 권한을 스스로
 * 만들어 낼 수 없다는 뜻이다(mutations/role-permissions.ts).
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
  /**
   * 메뉴 키 → 실효 수준. PERMISSION_AREAS의 모든 메뉴가 반드시 들어 있다.
   *
   * 하위 기능이 있는 메뉴는 **저장된 값이 아니라 하위 기능의 최대값**이다.
   * 메뉴와 하위를 따로 저장하면 "메뉴는 읽기인데 하위는 쓰기"가 만들어지고,
   * 그때 무엇이 이기는지 화면에서 설명할 방법이 없다. 사이드바와 페이지 가드는
   * 이 값이 NONE인지만 본다.
   */
  levels: Record<string, PermissionLevel>;
  /** 잎 키 → 실효 수준. 실제로 저장·판정되는 단위다. */
  leafLevels: Record<string, PermissionLevel>;
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

  // 잎: 저장된 값이 있으면 그것이 답이다. 상한으로 깎지 않는다 — 설정이 최종
  // 권위라는 것이 넓히기를 가능하게 하는 유일한 방법이고, 상한을 넘는 값은
  // 애초에 최고관리자만 저장할 수 있다(mutations/role-permissions.ts).
  const leafLevels: Record<string, PermissionLevel> = {};
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    leafLevels[leafKey] = configured[leafKey] ?? baselineLeafLevel(leafKey, role);
  }

  // 메뉴: 하위 기능이 있으면 그 최대값, 없으면 자기 값.
  const levels: Record<string, PermissionLevel> = {};
  for (const area of PERMISSION_AREAS) {
    levels[area.key] = areaLevelFromLeaves(area.key, (leafKey) => leafLevels[leafKey] ?? "NONE");
  }

  return { role, levels, leafLevels };
}

/**
 * 메뉴 또는 하위 기능의 실효 수준. 둘 다 같은 함수로 묻는다 — 부르는 쪽이
 * "inventory"인지 "inventory.parts"인지만 정하면 된다.
 */
export async function getPermissionLevel(role: Role, key: string): Promise<PermissionLevel> {
  const resolved = await resolveEffectivePermissions(role);
  return resolved.leafLevels[key] ?? resolved.levels[key] ?? "NONE";
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
