import "server-only";
import { constants } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { loadMailConfig, type MailConfig } from "./config";

/**
 * SMTP 연결 하나를 만든다. **메일을 보내지는 않는다.**
 *
 * 설정 읽기(config.ts)와 나눠 둔 이유: 연결 시험은 "설정이 맞는가"를 묻고,
 * 발송은 "무엇을 보내는가"를 묻는다. 둘을 한 파일에 두면 시험 도구가 발송
 * 코드를 끌고 들어온다.
 */

/**
 * 옛 TLS 서버에 붙기 위한 완화. `MAIL_SMTP_LEGACY_TLS=true` 일 때만 쓴다.
 *
 * 세 가지가 필요했다(카페24 실측, 2026-08-31) — 하나만 빠져도 못 붙는다:
 *   minVersion       TLS 1.0 까지 받아들인다
 *   ciphers          OpenSSL 3 의 보안 레벨이 옛 프로토콜을 아예 막는다.
 *                    SECLEVEL=0 으로 낮춰야 minVersion 이 의미를 갖는다.
 *   secureOptions    이 서버는 안전한 재협상(RFC 5746)을 지원하지 않는다.
 *                    이것만 빠지면 "unsafe legacy renegotiation disabled" 로 막힌다.
 *
 * 🔴 `rejectUnauthorized` 는 건드리지 않는다 — 인증서 검증은 그대로다.
 * 낮춘 것은 프로토콜 버전이지 "서버가 진짜인지 확인하는 일"이 아니다.
 */
const LEGACY_TLS_OPTIONS = {
  minVersion: "TLSv1" as const,
  ciphers: "DEFAULT@SECLEVEL=0",
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
};

export function createMailTransport(config: MailConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // nodemailer 의 `secure` 는 "처음부터 TLS 로 붙는가"다(465). STARTTLS 는
    // 평문으로 붙었다가 승격하는 방식이라 여기서는 false 이고, 승격을
    // **강제**하는 것은 requireTLS 다 — 이걸 빼면 서버가 STARTTLS 를 제안하지
    // 않을 때 조용히 평문으로 로그인해 버린다.
    secure: config.secure === "ssl",
    requireTLS: config.secure === "starttls",
    // "none" 은 암호화를 아예 쓰지 않는 사내 릴레이용이다. 명시적으로 골라야만
    // 그렇게 되고, 그 외에는 nodemailer 가 STARTTLS 를 시도한다.
    ignoreTLS: config.secure === "none",
    auth: config.user && config.password
      ? { user: config.user, pass: config.password }
      : undefined,
    tls: config.legacyTls ? LEGACY_TLS_OPTIONS : undefined,
    // 서버가 응답하지 않을 때 영원히 매달려 있지 않게 한다. 접수 흐름에
    // 붙었을 때 이 값이 곧 사용자가 기다리는 시간의 상한이 된다.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

export type MailConnectionCheck =
  | { ok: true; description: string }
  | { ok: false; stage: "CONFIG" | "CONNECT"; message: string; hint?: string };

/**
 * 로그인까지만 해 보고 끊는다(SMTP 로는 EHLO → STARTTLS → AUTH → QUIT).
 * **메일은 한 통도 나가지 않는다.**
 *
 * `overrideUser` 는 .env 를 고치지 않고 다른 계정 이름을 시험해 보기 위한
 * 것이다 — 카페24 같은 호스팅은 아이디가 `chm` 인지 `chm@도메인` 인지가
 * 화면만 봐서는 갈리지 않는다.
 */
export async function checkMailConnection(options?: {
  overrideUser?: string;
}): Promise<MailConnectionCheck> {
  const loaded = loadMailConfig();
  if (!loaded.ok) {
    return { ok: false, stage: "CONFIG", message: loaded.message };
  }

  const config = options?.overrideUser
    ? { ...loaded.config, user: options.overrideUser }
    : loaded.config;

  const transport = createMailTransport(config);
  try {
    await transport.verify();
    const auth = config.user ? `계정 ${config.user}` : "인증 없음";
    const tls = config.legacyTls ? ", 옛 TLS 허용" : "";
    return { ok: true, description: `${config.host}:${config.port} (${config.secure}${tls}) · ${auth}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, stage: "CONNECT", message, hint: hintFor(message, config) };
  } finally {
    // 열어 둔 연결을 반드시 닫는다 — 안 닫으면 스크립트가 끝나지 않는다.
    transport.close();
  }
}

/**
 * 흔한 실패를 사람 말로 옮긴다.
 *
 * SMTP 오류는 대개 서버가 준 코드 한 줄이라, 그대로 보여 주면 무엇을 고쳐야
 * 하는지 알 수 없다. 여기서 하는 것은 **추측을 덧붙이는 것**이고, 원문은 늘
 * 함께 보여 준다.
 */
function hintFor(message: string, config: MailConfig): string | undefined {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login") || lower.includes("authentication failed") || lower.includes("535")) {
    // 카페24는 보통 전체 주소로 로그인한다. 화면에는 앞부분만 보이는 경우가 많다.
    if (config.user && !config.user.includes("@")) {
      return `계정 "${config.user}" 로 로그인이 거부됐습니다. 전체 메일 주소(예: ${config.user}@도메인)로 다시 시험해 보세요.`;
    }
    const localPart = config.user?.split("@")[0];
    return localPart
      ? `계정 "${config.user}" 로 로그인이 거부됐습니다. 비밀번호를 확인하시고, 아이디만("${localPart}") 쓰는 서버일 수도 있으니 그것도 시험해 보세요.`
      : "로그인이 거부됐습니다. 계정과 비밀번호를 확인해 주세요.";
  }

  if (lower.includes("etimedout") || lower.includes("timeout")) {
    return `${config.host}:${config.port} 에 시간 안에 닿지 못했습니다. 방화벽에서 그 포트로 나가는 통신이 막혀 있을 수 있습니다.`;
  }

  if (lower.includes("enotfound") || lower.includes("eai_again")) {
    return `${config.host} 주소를 찾지 못했습니다. 호스트 이름의 오타를 확인해 주세요.`;
  }

  if (lower.includes("econnrefused")) {
    return `${config.host}:${config.port} 가 연결을 거부했습니다. 포트 번호를 확인해 주세요(587=STARTTLS, 465=SSL).`;
  }

  // 이 둘은 "설정이 틀렸다"가 아니라 **서버가 옛 TLS 만 쓴다**는 뜻이다.
  // MAIL_SMTP_SECURE 를 아무리 바꿔도 안 되므로 따로 짚어 준다 — 실제로
  // 카페24에서 이 두 오류를 차례로 만났다(2026-08-31).
  if (lower.includes("unsupported protocol") || lower.includes("legacy renegotiation")) {
    return config.legacyTls
      ? `옛 TLS 를 허용했는데도 협상이 안 됩니다. 포트를 587(starttls) ↔ 465(ssl) 로 바꿔 보세요 — 지금은 ${config.port}(${config.secure}) 입니다.`
      : `이 서버는 옛 TLS(1.0/1.1)만 지원합니다. .env.local 에 MAIL_SMTP_LEGACY_TLS=true 를 넣어 주세요. (암호화와 인증서 검증은 그대로 유지되고, 받아들이는 프로토콜 버전만 낮춥니다.)`;
  }

  if (lower.includes("wrong version number") || lower.includes("ssl")) {
    return `TLS 방식이 어긋난 것 같습니다. MAIL_SMTP_SECURE 를 바꿔 보세요 — 지금은 "${config.secure}" 입니다(587이면 starttls, 465면 ssl).`;
  }

  return undefined;
}
