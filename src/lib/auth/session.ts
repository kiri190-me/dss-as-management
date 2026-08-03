import { cookies } from "next/headers";
import {
  ACCOUNT_APPROVAL_STATUS_CODES,
  ROLE_CODES,
  type AccountApprovalStatus,
  type Role,
} from "@/lib/domain/types";
import { signPayload, verifyToken } from "./token";

export const SESSION_COOKIE_NAME = "dss_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8시간. 실제 서비스에서는
// 관리자 설정 가능한 세션 타임아웃으로 대체될 예정이다(SECURITY_POLICY.md 1번).

export type SessionPayload = {
  userId: string;
  role: Role;
  approvalStatus: AccountApprovalStatus;
  issuedAt: number;
  expiresAt: number;
};

function getAuthSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SESSION_SECRET이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return secret;
}

function isValidSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;

  // 서명이 유효하더라도 role/approvalStatus 값 자체는 현재 허용된 값 목록과
  // 대조 검증한다(서명만 믿고 임의 값을 신뢰하지 않는다).
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.role === "string" &&
    (ROLE_CODES as readonly string[]).includes(candidate.role) &&
    typeof candidate.approvalStatus === "string" &&
    (ACCOUNT_APPROVAL_STATUS_CODES as readonly string[]).includes(
      candidate.approvalStatus
    ) &&
    typeof candidate.issuedAt === "number" &&
    typeof candidate.expiresAt === "number"
  );
}

export function createSessionToken(user: {
  id: string;
  role: Role;
  approvalStatus: AccountApprovalStatus;
}): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    userId: user.id,
    role: user.role,
    approvalStatus: user.approvalStatus,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
  };
  return signPayload(payload, getAuthSecret());
}

/**
 * 변조/위조/만료된 토큰은 모두 null로 취급한다. 어떤 경로로도 예외를
 * 호출자에게 그대로 노출하지 않는다.
 */
export function parseSessionToken(token: string): SessionPayload | null {
  let decoded: unknown;
  try {
    decoded = verifyToken(token, getAuthSecret());
  } catch {
    return null;
  }
  if (decoded === null || !isValidSessionPayload(decoded)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (decoded.expiresAt <= nowSeconds) {
    return null;
  }

  return decoded;
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return parseSessionToken(token);
}
