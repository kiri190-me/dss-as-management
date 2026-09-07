import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getSignatureImageContent } from "@/lib/db/queries/intake-mail-settings";

/**
 * ============================================================================
 * GET /api/mail-signature-images/{id} — 설정 화면 미리보기가 그림을 불러 가는 곳
 * ============================================================================
 * 실제 메일에서는 이 주소를 쓰지 않는다. 메일은 이미지를 **동봉해서** 보내고
 * 본문이 `cid:` 로 가리킨다 — NAS 는 인터넷에서 보이지 않으므로 받는 사람의
 * 메일 클라이언트가 이 주소로 올 수 없다. 이 라우트는 **우리 설정 화면의
 * 미리보기 전용**이다.
 *
 * ── 그래도 권한을 건다 ──────────────────────────────────────────────────
 * 로고 그림 하나가 대단한 비밀은 아니다. 그렇지만 첨부 다운로드 라우트가
 * 세운 규칙(SECURITY_POLICY.md 10번 — 파일 접근은 반드시 애플리케이션을
 * 통해서)에 예외를 하나 만들면, 다음 사람이 그 예외를 근거로 삼는다.
 * 서명을 다룰 수 있는 사람과 같은 선(관리자 이상)에 둔다.
 *
 * ── 헤더는 응답에 직접 붙인다 ───────────────────────────────────────────
 * next.config.ts 가 `/:path*` 로 전역 보안 헤더를 씌우는데, 같은 이름을 여기서
 * 또 정하면 조용히 한쪽이 버려진다. 여기서는 그 목록에 **없는** 것만 붙인다
 * (Content-Type · Cache-Control · Content-Disposition).
 * ============================================================================
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || actingUser.approvalStatus !== "APPROVED") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }
  if (!(await hasPermission(actingUser, "mailSettings", "MANAGE"))) {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await context.params;
  const image = await getSignatureImageContent(id);
  if (!image) {
    return NextResponse.json({ message: "없는 이미지입니다." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.content), {
    status: 200,
    headers: {
      "Content-Type": image.mimeType,
      // 미리보기는 화면 안에서만 그린다 — 브라우저가 내려받기로 처리하지 않게.
      "Content-Disposition": "inline",
      // 로그인한 사람에게만 보이는 값이라 공용 캐시에 남으면 안 된다.
      "Cache-Control": "private, max-age=60",
    },
  });
}
