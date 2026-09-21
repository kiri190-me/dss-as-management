import { NextResponse, type NextRequest } from "next/server";
import {
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalServiceToken,
  type PortalTokenPurpose,
  type PortalTokenResult,
} from "@/lib/auth/portal-service-token";
import { getAuthSource } from "@/lib/config/auth-source";
import { getLoginMode } from "@/lib/config/login-mode";
import { getUserBySsoSubject } from "@/lib/db/queries/users";
import { buildNotificationSettingsView } from "@/lib/db/queries/notification-settings";
import { saveNotificationSettings } from "@/lib/db/mutations/notification-settings";
import {
  parseNotificationSettingsChanges,
  readPortalNotificationSettings,
  writePortalNotificationSettings,
} from "@/lib/server/integration/portal-notifications";

/**
 * ============================================================================
 * 알림 설정을 밖에서 읽고 쓰는 통로
 * ============================================================================
 * 설계 결정(2026-09-21, 설계서 D-5): **화면만 포털로 옮기고 자료는 A/S 가 계속
 * 갖는다.** 알림 종류 8가지도 역할 5가지도 A/S 고유의 것이라, 포털이 그것을
 * 가지면 시스템이 늘 때마다 포털을 고쳐 배포해야 한다.
 *
 * 그래서 이 통로는 **포털이 그대로 그릴 수 있는 만큼**을 내준다 — 종류의 사람이
 * 읽는 이름·설명, 켜짐 여부, 역할별 수신 여부, 그리고 🔴 **역할 목록까지**
 * (설계서 F-4). 포털은 그 안에 무엇이 들었는지 알 필요가 없다.
 *
 * 🔴 사람별 설정은 만들지 않는다(2026-09-21 사용자 결정 — 역할 단위면 충분).
 * 지금 있는 두 표를 읽고 쓰기만 하고, 스키마는 건드리지 않는다.
 *
 * 쓰기는 PUT 이다 — 보낸 종류들의 값을 그 상태로 맞추는 조작이라(같은 요청을 두
 * 번 보내도 결과가 같다) POST 보다 PUT 이 맞다.
 * ============================================================================
 */

const NO_STORE = { "cache-control": "no-store" };

function notEnabled() {
  return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: NO_STORE });
}

function invalidToken() {
  return NextResponse.json(
    { error: "invalid_token" },
    { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } }
  );
}

/** 두 메서드가 같은 순서로 같은 것을 확인한다 — 한쪽만 느슨해지지 않게 묶어 둔다. */
async function authenticate(
  request: NextRequest,
  purpose: PortalTokenPurpose
): Promise<PortalTokenResult> {
  return verifyPortalServiceToken(
    readBearerToken(request.headers.get("authorization")),
    purpose
  );
}

export async function GET(request: NextRequest) {
  if (getLoginMode() !== "sso") return notEnabled();

  const verified = await authenticate(request, PORTAL_TOKEN_PURPOSES.notificationSettingsRead);
  if (!verified.ok) return invalidToken();

  // 설정 표는 데이터베이스 인증 모드에만 있다(서버 액션과 같은 줄).
  if (getAuthSource() !== "database") return notEnabled();

  const result = await readPortalNotificationSettings({
    subject: verified.subject,
    findActor: getUserBySsoSubject,
    loadView: buildNotificationSettingsView,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "forbidden", message: result.message },
      { status: result.status, headers: NO_STORE }
    );
  }
  return NextResponse.json(result.value, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  if (getLoginMode() !== "sso") return notEnabled();

  const verified = await authenticate(request, PORTAL_TOKEN_PURPOSES.notificationSettingsWrite);
  if (!verified.ok) return invalidToken();

  if (getAuthSource() !== "database") return notEnabled();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "요청 본문을 읽을 수 없습니다." },
      { status: 400, headers: NO_STORE }
    );
  }

  const parsed = parseNotificationSettingsChanges(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.message },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const result = await writePortalNotificationSettings({
      subject: verified.subject,
      changes: parsed.changes,
      findActor: getUserBySsoSubject,
      save: saveNotificationSettings,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.status === 403 ? "forbidden" : "invalid_request", message: result.message },
        { status: result.status, headers: NO_STORE }
      );
    }
    return NextResponse.json({ ok: true, ...result.value }, { headers: NO_STORE });
  } catch (error) {
    // 서버 액션과 같은 처리 — 안쪽 사정은 밖으로 내보내지 않는다.
    console.error("[integration] 알림 설정 저장 실패:", error);
    return NextResponse.json(
      { error: "server_error", message: "일시적으로 처리할 수 없습니다." },
      { status: 500, headers: NO_STORE }
    );
  }
}
