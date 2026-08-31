import "server-only";

/**
 * ============================================================================
 * 사내 메일 서버(SMTP) 설정 — .env 에서 읽는다
 * ============================================================================
 * 값을 읽어 모양만 확인한다. 실제 연결도, 발송도 여기서 하지 않는다.
 *
 * ── 설정이 없으면 "꺼진 것"이다 ──────────────────────────────────────────
 * 던지지 않고 `missing` 목록을 담아 돌려준다. 접수 알림 메일은 접수를 좌우하는
 * 기능이 아니라 곁다리라, 메일 설정이 빠졌다고 접수가 안 되면 그건 더 나쁜
 * 고장이다. 대신 **어느 칸이 비었는지 이름으로 말해 준다** — 조용히 아무 일도
 * 안 하면 넣어 뒀다고 믿는 사람이 아무도 확인하지 않는다.
 *
 * ── 🔴 비밀번호는 절대 밖으로 내지 않는다 ────────────────────────────────
 * 이 모듈이 비밀번호를 담아 돌려주는 곳은 `password` 한 자리뿐이고, 그 값을
 * 쓰는 곳은 transport 를 만드는 자리뿐이다. 로그·오류 메시지·화면 어디에도
 * 실어 보내지 않는다. 진단용으로 만든 `describeMailConfig()` 도 비밀번호 자리에
 * 길이만 적는다.
 * ============================================================================
 */

/** 587 은 STARTTLS, 465 는 처음부터 SSL, 사내 릴레이는 암호화 없이 25 를 쓰기도 한다. */
export const MAIL_SECURE_MODES = ["starttls", "ssl", "none"] as const;
export type MailSecureMode = (typeof MAIL_SECURE_MODES)[number];

export type MailConfig = {
  host: string;
  port: number;
  secure: MailSecureMode;
  /**
   * 로그인 계정. 비워 두면 **인증 없이** 붙는다 — 사내망에서만 받아 주는
   * 릴레이 서버가 실제로 그렇다.
   */
  user: string | null;
  password: string | null;
  /** "DSS A/S 시스템 <as@example.com>" 형태. 수신자 메일함에 이렇게 뜬다. */
  from: string;
  /**
   * 옛 TLS 를 쓰는 서버에 붙기 위한 완화. **기본은 꺼져 있다.**
   *
   * 카페24 메일 서버(smtp.cafe24.com)가 실제로 이렇다 — TLS 1.0/1.1 만 받고,
   * 안전한 재협상(RFC 5746)을 지원하지 않는다. Node 24 의 OpenSSL 3 은 둘 다
   * 기본으로 거부하므로 이걸 켜지 않으면 아예 붙지 못한다(2026-08-31 실측).
   *
   * 🔴 무엇을 푸는지 정확히 알고 켜야 한다:
   *   · 낮추는 것  — 받아들이는 TLS **버전**(1.2 이상 → 1.0 이상)과 암호 모음
   *   · 그대로인 것 — **인증서 검증**(rejectUnauthorized). 끄지 않는다.
   *
   * 즉 통신은 여전히 암호화되고 서버 신원도 확인한다. 옛 프로토콜을 받아 준
   * 것뿐이며, 이 완화가 없으면 대안은 **평문 연결**이라 그쪽이 훨씬 나쁘다
   * (비밀번호와 고객사·S/N·증상이 그대로 흘러간다).
   */
  legacyTls: boolean;
};

export type LoadMailConfigResult =
  | { ok: true; config: MailConfig }
  | { ok: false; missing: string[]; message: string };

const HOST_ENV = "MAIL_SMTP_HOST";
const PORT_ENV = "MAIL_SMTP_PORT";
const SECURE_ENV = "MAIL_SMTP_SECURE";
const USER_ENV = "MAIL_SMTP_USER";
const PASSWORD_ENV = "MAIL_SMTP_PASSWORD";
const FROM_ENV = "MAIL_FROM";
const LEGACY_TLS_ENV = "MAIL_SMTP_LEGACY_TLS";

function read(name: string): string | null {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

export function loadMailConfig(): LoadMailConfigResult {
  const host = read(HOST_ENV);
  const portRaw = read(PORT_ENV);
  const from = read(FROM_ENV);

  const missing: string[] = [];
  if (!host) missing.push(HOST_ENV);
  if (!portRaw) missing.push(PORT_ENV);
  if (!from) missing.push(FROM_ENV);

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `메일 설정이 비어 있습니다: ${missing.join(", ")}. .env.local 을 확인하세요(.env.example 참고).`,
    };
  }

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return {
      ok: false,
      missing: [PORT_ENV],
      // 값 자체는 비밀이 아니므로 그대로 보여 준다 — 오타를 눈으로 찾게.
      message: `${PORT_ENV} 가 올바른 포트 번호가 아닙니다: "${portRaw}"`,
    };
  }

  /*
   * 보안 방식을 안 적었으면 포트에서 추론한다. 틀린 기본값 하나로 조용히
   * 평문 연결이 되는 것보다, 흔한 관례(465=SSL, 그 외=STARTTLS)를 따르고
   * 그 사실을 문서에 적어 두는 편이 낫다.
   */
  const secureRaw = read(SECURE_ENV)?.toLowerCase() ?? (port === 465 ? "ssl" : "starttls");
  if (!(MAIL_SECURE_MODES as readonly string[]).includes(secureRaw)) {
    return {
      ok: false,
      missing: [SECURE_ENV],
      message: `${SECURE_ENV} 는 ${MAIL_SECURE_MODES.join(" | ")} 중 하나여야 합니다. 지금 값: "${secureRaw}"`,
    };
  }

  const user = read(USER_ENV);
  const password = read(PASSWORD_ENV);

  // 계정만 있고 비밀번호가 없으면 인증이 반드시 실패한다. 붙어 보고 나서
  // 알기보다 여기서 잡는 편이 원인이 분명하다.
  if (user && !password) {
    return {
      ok: false,
      missing: [PASSWORD_ENV],
      message: `${USER_ENV} 를 적었으면 ${PASSWORD_ENV} 도 있어야 합니다.`,
    };
  }

  return {
    ok: true,
    config: {
      host: host!,
      port,
      secure: secureRaw as MailSecureMode,
      user,
      password,
      // 정확히 "true" 일 때만 켠다 — 오타가 조용히 완화로 이어지지 않게.
      legacyTls: read(LEGACY_TLS_ENV)?.toLowerCase() === "true",
      from: from!,
    },
  };
}

/**
 * 진단용 한 줄. **비밀번호는 길이만 적는다** — 화면·로그 어디에 실려도
 * 안전해야 한다.
 */
export function describeMailConfig(config: MailConfig): string {
  const auth = config.user
    ? `${config.user} / 비밀번호 ${config.password?.length ?? 0}자`
    : "인증 없음";
  const tls = config.legacyTls ? " · 옛 TLS 허용" : "";
  return `${config.host}:${config.port} (${config.secure}${tls}) · ${auth} · 발신 ${config.from}`;
}
