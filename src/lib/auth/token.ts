import { createHmac, timingSafeEqual } from "node:crypto";

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string | null {
  try {
    return Buffer.from(input, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function sign(payloadBase64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

export function signPayload(payload: unknown, secret: string): string {
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadBase64, secret);
  return `${payloadBase64}.${signature}`;
}

/**
 * 서명/구조/만료 여부와 무관하게 실패 시 항상 null을 반환한다(예외를 던지지 않음).
 * 페이로드 필드의 도메인 유효성 검증(Role/AccountApprovalStatus 등)은 이 함수의
 * 책임이 아니며 session.ts에서 수행한다.
 */
export function verifyToken(token: string, secret: string): unknown | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expectedSignature = sign(payloadBase64, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature);

  // timingSafeEqual throws on length mismatch — check first so a forged
  // signature of a different length can't cause an unhandled exception.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null;
  }

  const decoded = base64UrlDecode(payloadBase64);
  if (decoded === null) {
    return null;
  }

  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
