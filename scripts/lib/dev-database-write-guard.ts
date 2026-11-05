/**
 * ============================================================================
 * 스크립트가 **쓰기 전에** 「여기가 개발 DB 가 맞나」를 가리는 자리
 * ============================================================================
 * 순수 함수다 — DB 에 붙지 않고 `DATABASE_URL` 글자와 (선택으로) 서버가 말한
 * DB 이름만 본다. 그래서 시험이 가짜 접속 정보를 넣어 **막히는지 통과하는지를
 * 값으로 잴 수 있다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 DB 이름으로는 개발과 운영을 **가를 수 없다**
 * ──────────────────────────────────────────────────────────────────────
 * 처음에 `current_database()` 가 `dss_as_dev` 인지 보는 장치를 달았다가 2026-11-05
 * 에 틀린 것이 드러났다. 실측:
 *   - 개발: `127.0.0.1:5442` / DB 이름 **`dss_as`** (컨테이너 dss-pg-app)
 *   - 운영: NAS / DB 이름 **`dss_as`** (배포 덤프 파일 이름이 `dss_as-…dump` 다)
 *
 * 🔴 **이름이 양쪽 다 `dss_as` 다.** 그래서 「이름이 dss_as 면 통과」로 고치면
 * **운영에 붙었을 때도 똑같이 통과한다** — 막는 척만 하는 장치가 되고, 그쪽이
 * 원래의 틀린 기대값보다 훨씬 위험하다(틀린 기대값은 멈춰서 눈에 띄기라도 했다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 그래서 **접속한 곳**을 본다 — 호스트와 포트
 * ──────────────────────────────────────────────────────────────────────
 * 운영 DB 는 NAS 안에서 돌고, 이 스크립트는 개발 PC 에서만 돌린다. 개발 접속은
 * 루프백의 비표준 포트 하나로 고정돼 있다. 둘을 함께 봐야 뜻이 선다:
 *   - 호스트만 보면 — NAS 위에서 돌릴 때 운영도 루프백이 된다.
 *   - 포트만 보면 — 다른 기계의 5442 가 통과한다.
 *
 * 🔵 **「개발이면 통과」가 아니라 「개발이라고 확신할 수 없으면 멈춤」이다.** 아는
 * 모양이 아니면 전부 막는다. 그래서 개발 포트가 바뀌는 날 이 스크립트는 **조용히
 * 운영에 쓰는 대신 멈추고**, 막은 메시지에 제가 본 값을 적어 준다 — 그걸 보고
 * 아래 상수 한 줄을 고치면 된다.
 *
 * 🔴 **남는 구멍 하나**: 누군가 운영 DB 를 `localhost:5442` 로 터널링해 두면 통과한다.
 * 그것은 실수로 되는 일이 아니라 작정하고 해야 하는 일이라 여기서 막지 않는다 —
 * 막을 수 있다고 적어 두는 쪽이 더 위험하다.
 *
 * 🔴 **비밀번호는 어떤 경로로도 안 나간다.** 돌려주는 것도 찍는 것도 호스트·포트·
 * DB 이름 셋뿐이다(`formatDatabaseTarget`).
 */

/**
 * 개발 PC 의 app DB 호스트 포트. 2026-11-05 실측값이고, `.env.local` 의
 * `DATABASE_URL` 과 `dss-pg-app` 컨테이너의 공개 포트가 이 값이다.
 * 🔵 바뀌면 여기만 고치면 된다 — 그전까지는 게이트가 멈춰서 알려 준다.
 */
export const DEVELOPMENT_DATABASE_PORTS: ReadonlySet<string> = new Set(["5442"]);

/**
 * 같은 기계에 붙었다는 뜻의 호스트들.
 *
 * 🔴 `[::1]` 을 **꺾쇠째** 담는다 — `new URL(...).hostname` 은 IPv6 주소의 꺾쇠를
 * 떼지 않는다(실측: `"[::1]"`). 꺾쇠 없는 `::1` 만 적어 두면 IPv6 로 붙은 개발
 * 접속이 「모르는 호스트」로 막힌다. 처음에 그렇게 적었다가 시험이 잡았다.
 * 🔵 대소문자는 `describeDatabaseTarget` 이 미리 내린다(URL 파서는 비특수 스킴의
 * 호스트를 소문자로 안 바꾼다 — `LocalHost` 가 그대로 나온다).
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** 시험용 DB 는 이름으로 가린다 — 운영 DB 가 이 꼬리를 달 일은 없다. */
const TEST_DATABASE_SUFFIX = "_test";

/** 포트를 안 적은 postgres URL 의 기본 포트. */
const DEFAULT_POSTGRES_PORT = "5432";

/** 🔴 비밀번호도 사용자명도 담지 않는다 — 그대로 찍어도 되는 것만 담는다. */
export type DatabaseTargetIdentity = {
  host: string;
  port: string;
  database: string;
};

export type DevDatabaseWriteVerdict =
  | { allowed: true; identity: DatabaseTargetIdentity; reason: string }
  | { allowed: false; identity: DatabaseTargetIdentity | null; reason: string };

/**
 * 접속 URL 에서 **찍어도 되는 세 가지**만 뽑는다. 못 읽으면 null —
 * 「모르겠다」와 「괜찮다」를 섞지 않으려고 빈 값이 아니라 null 로 가른다.
 */
export function describeDatabaseTarget(databaseUrl: string | undefined | null): DatabaseTargetIdentity | null {
  if (!databaseUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (!parsed.hostname || !database) return null;
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || DEFAULT_POSTGRES_PORT,
      database,
    };
  } catch {
    return null;
  }
}

/** 사람에게 보여 줄 한 줄. 🔴 비밀번호·사용자명은 들어가지 않는다. */
export function formatDatabaseTarget(identity: DatabaseTargetIdentity | null): string {
  return identity ? `${identity.host}:${identity.port}/${identity.database}` : "(접속 정보를 못 읽음)";
}

/**
 * 여기에 써도 되는가.
 *
 * `actualDatabaseName` 은 **서버가 스스로 말한** 이름(`current_database()`)이다.
 * 넘기면 URL 에 적힌 이름과 같은지까지 본다 — 적힌 곳과 실제로 붙은 곳이 다른
 * 경우(프록시·오타·환경변수 뒤바뀜)를 잡는다. 🔵 **안 넘기면 그 갈래를 안 본다**
 * (붙기 전에 미리 한 번 거르는 용도다).
 */
export function checkDevelopmentWriteTarget(input: {
  databaseUrl: string | undefined | null;
  actualDatabaseName?: string | null;
}): DevDatabaseWriteVerdict {
  const identity = describeDatabaseTarget(input.databaseUrl);
  if (!identity) {
    return {
      allowed: false,
      identity: null,
      reason: "DATABASE_URL 이 없거나 읽을 수 없는 모양입니다.",
    };
  }

  if (!LOOPBACK_HOSTS.has(identity.host)) {
    return {
      allowed: false,
      identity,
      reason: `접속 호스트가 이 PC(루프백)가 아닙니다 — "${identity.host}". 운영 DB 는 다른 기계에 있습니다.`,
    };
  }

  const isTestDatabase = identity.database.toLowerCase().endsWith(TEST_DATABASE_SUFFIX);
  if (!DEVELOPMENT_DATABASE_PORTS.has(identity.port) && !isTestDatabase) {
    return {
      allowed: false,
      identity,
      reason:
        `포트 ${identity.port} 는 아는 개발 포트(${[...DEVELOPMENT_DATABASE_PORTS].join(", ")})가 아니고, ` +
        `DB 이름 "${identity.database}" 도 "${TEST_DATABASE_SUFFIX}" 로 끝나지 않습니다.`,
    };
  }

  if (input.actualDatabaseName != null && input.actualDatabaseName !== identity.database) {
    return {
      allowed: false,
      identity,
      reason:
        `붙은 곳이 적힌 곳과 다릅니다 — DATABASE_URL 은 "${identity.database}" 인데 ` +
        `서버는 "${input.actualDatabaseName}" 이라고 답했습니다.`,
    };
  }

  return {
    allowed: true,
    identity,
    reason: isTestDatabase
      ? `루프백의 시험 DB 입니다(이름이 "${TEST_DATABASE_SUFFIX}" 로 끝납니다).`
      : `루프백의 개발 포트 ${identity.port} 입니다.`,
  };
}

/**
 * 막혔을 때 사람에게 보여 줄 글.
 *
 * 🔴 **무엇을 보고 막았는지**가 반드시 들어간다. 2026-11-05 에 이 게이트가 틀린
 * 기대값으로 막았을 때, 기대값과 실제값을 둘 다 보여 준 덕에 **틀린 쪽이 게이트라는
 * 것이 그 자리에서 드러났다.** 그 성질을 잃지 않는다.
 */
export function formatWriteGuardBlockMessage(verdict: DevDatabaseWriteVerdict): string {
  return [
    "안전 게이트: 개발 DB 라고 확신할 수 없어 멈췄습니다 (쓰기 안 함).",
    `  본 것     : ${formatDatabaseTarget(verdict.identity)}   ← 호스트:포트/DB 이름 (비밀번호는 안 찍습니다)`,
    `  막은 까닭 : ${verdict.reason}`,
    `  🔴 DB **이름**으로는 가르지 않습니다 — 개발도 운영도 "dss_as" 입니다.`,
    `     그래서 이 게이트는 **접속 호스트와 포트**를 봅니다 (dev-database-write-guard.ts).`,
  ].join("\n");
}
