/**
 * ============================================================================
 * 접속하지 못했을 때 사람에게 할 말 — 오류 하나를 안내 문구 하나로
 * ============================================================================
 *
 * 이 파일에는 **DB도 콘솔도 없다.** 오류 객체 하나를 받아 문자열 하나를 돌려준다.
 * 그래서 DB를 끄지 않고도 각 갈래를 단위 테스트로 못박을 수 있다
 * (db-connection-failure.test.ts). 실제로 접속을 시도하고 이 문구를 찍는 일은
 * scripts/check-pending-migrations.ts가 한다.
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────────────────
 * 2026-09-02에 `npm run db:preflight`가 "이 DB에는 마이그레이션 기록이 없습니다
 * — 처음 적용하는 DB로 보입니다 / 적용 대기 80건"이라고 보고했다. 실제로는
 * 80건이 전부 적용된 DB였고, 개발 DB 컨테이너가 꺼져 있었을 뿐이다. 적용 기록을
 * 읽는 질의를 `try/catch`로 감싸 두고 **"표가 없다"와 "접속조차 못 했다"를 같은
 * 답(null)으로 뭉갠** 탓이다. 그 말을 곧이곧대로 믿고 마이그레이션을 다시 부으면
 * 운영 자료가 위험하다. 그래서 이제 접속 실패는 접속 실패라고 분명히 말하고
 * 멈춘다 — 그때 할 말이 이 파일에 있다.
 *
 * ── 🔴 접속 문자열은 한 글자도 새 나가면 안 된다 ─────────────────────────
 * DATABASE_URL에는 DB 비밀번호가 들어 있다. 그런데 접속 실패 오류의 message는
 * 그 값을 물고 있을 수 있다 — postgres.js는 "write ECONNREFUSED host:port"처럼
 * 접속 대상을 message에 적어 넣고, 드라이버나 래퍼에 따라 접속 문자열 전체가
 * 실리는 경로도 있다. 그래서 여기서 돌려주는 문구는 **오류의 message를 절대
 * 옮겨 담지 않는다.** 미리 적어 둔 안내문과, 안전한 값(오류 이름·오류 코드)만
 * 쓴다. 이 약속은 테스트로도 못박혀 있다.
 * ============================================================================
 */

/**
 * 접속이 어긋난 갈래. 사람이 다음에 할 일이 서로 다르기 때문에 나눈다 —
 * 컨테이너를 켤 것인가(REFUSED), 주소를 고칠 것인가(UNREACHABLE),
 * 계정을 볼 것인가(AUTH), DB 이름을 볼 것인가(NO_DATABASE).
 */
export type DbConnectionFailureKind =
  | "REFUSED"
  | "UNREACHABLE"
  | "AUTH"
  | "NO_DATABASE"
  | "UNKNOWN";

/** 개발 DB 컨테이너 이름. 안내에 그대로 실어 사람이 복사해 붙일 수 있게 한다. */
const DEV_DB_CONTAINER = "dss-as-postgres-dev";

/** 그 주소에서 아무도 듣고 있지 않다 — 거의 언제나 "컨테이너가 꺼져 있다". */
const REFUSED_CODES = new Set(["ECONNREFUSED"]);

/**
 * 주소까지 닿지 못했다 — 이름이 안 풀리거나(ENOTFOUND·EAI_AGAIN), 응답이
 * 없거나(ETIMEDOUT·CONNECT_TIMEOUT), 길이 막혀 있다(EHOSTUNREACH·ENETUNREACH).
 * CONNECT_TIMEOUT은 postgres.js가 스스로 만드는 코드다(Node의 것이 아니다).
 */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "CONNECT_TIMEOUT",
]);

/** PostgreSQL SQLSTATE 28P01 — invalid_password. 사용자/비밀번호가 틀렸다. */
const AUTH_CODES = new Set(["28P01", "28000"]);

/** PostgreSQL SQLSTATE 3D000 — invalid_catalog_name. 그 이름의 DB가 없다. */
const NO_DATABASE_CODES = new Set(["3D000"]);

/**
 * 오류에서 코드를 꺼낸다. Node의 시스템 오류도, postgres.js가 만든 오류도,
 * 서버가 돌려준 SQLSTATE도 모두 `code`에 담겨 온다.
 *
 * `cause`를 한 겹씩 따라 들어가는 이유: Node 20 이후로 접속 오류가
 * AggregateError나 래퍼 오류로 한 번 싸여 오는 경우가 있어서, 겉만 보면
 * 코드가 없는 것처럼 보인다. 스스로를 cause로 가리키는 오류에 걸려 돌지
 * 않도록 깊이를 막아 둔다.
 */
function readErrorCode(error: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof error !== "object" || error === null) return null;

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.trim() !== "") return code.trim();
  if (typeof code === "number") return String(code);

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null && cause !== error) {
    return readErrorCode(cause, depth + 1);
  }
  return null;
}

/**
 * 오류의 이름. message와 달리 이름은 접속 문자열을 물고 있지 않아 안전하다.
 * (Error가 아닌 것이 던져졌다면 그 값의 종류라도 알려 준다.)
 */
function readErrorName(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.trim() !== "") return name.trim();
    return "Error가 아닌 객체";
  }
  return typeof error;
}

/** 이 오류가 어느 갈래인가. 코드를 알아보지 못하면 UNKNOWN. */
export function classifyDbConnectionFailure(error: unknown): DbConnectionFailureKind {
  const code = readErrorCode(error);
  if (code === null) return "UNKNOWN";
  if (REFUSED_CODES.has(code)) return "REFUSED";
  if (UNREACHABLE_CODES.has(code)) return "UNREACHABLE";
  if (AUTH_CODES.has(code)) return "AUTH";
  if (NO_DATABASE_CODES.has(code)) return "NO_DATABASE";
  return "UNKNOWN";
}

/**
 * 사람에게 그대로 보여 줄 안내 문구.
 *
 * 🔴 오류의 message는 절대 담지 않는다(파일 머리말 참조). 담는 것은 미리 적어
 * 둔 문장과, 갈래를 가르는 데 쓴 코드·이름뿐이다.
 */
export function describeDbConnectionFailure(error: unknown): string {
  const code = readErrorCode(error);
  const kind = classifyDbConnectionFailure(error);

  switch (kind) {
    case "REFUSED":
      return [
        `DB에 접속하지 못했습니다 (${code}) — 그 주소에서 아무도 듣고 있지 않습니다.`,
        `DB 컨테이너가 꺼져 있지 않은지 확인하세요:  docker start ${DEV_DB_CONTAINER}`,
        "포트가 맞는지도 함께 보세요(접속 정보는 .env.local의 DATABASE_URL이 정합니다).",
      ].join("\n");

    case "UNREACHABLE":
      return [
        `DB에 접속하지 못했습니다 (${code}) — 주소까지 닿지 못했습니다.`,
        "DATABASE_URL의 호스트 이름과 포트가 맞는지 확인하세요.",
        "방화벽·VPN·컨테이너 네트워크가 길을 막고 있을 수도 있습니다.",
      ].join("\n");

    case "AUTH":
      return [
        `DB가 접속을 거부했습니다 (${code}) — 인증에 실패했습니다.`,
        "DATABASE_URL의 사용자 이름과 비밀번호를 확인하세요.",
        "(값은 여기에 출력하지 않습니다 — .env.local에서 직접 보세요.)",
      ].join("\n");

    case "NO_DATABASE":
      return [
        `DB에 접속하지 못했습니다 (${code}) — 그 이름의 데이터베이스가 없습니다.`,
        "DATABASE_URL 끝에 적힌 데이터베이스 이름을 확인하세요.",
      ].join("\n");

    case "UNKNOWN":
    default:
      return [
        "DB에 접속하지 못했습니다.",
        `오류 종류: ${readErrorName(error)}${code === null ? "" : ` / 코드: ${code}`}`,
        "DATABASE_URL이 가리키는 DB가 살아 있는지 확인하세요.",
        "(접속 문자열이 섞여 나올 수 있어 오류 내용은 출력하지 않습니다.)",
      ].join("\n");
  }
}
