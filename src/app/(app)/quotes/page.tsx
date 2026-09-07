import type { Metadata } from "next";
import QuoteListScreen from "@/components/quotes/QuoteListScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { listDeletedQuotes, listQuotes } from "@/lib/db/queries/quotes";

export const metadata: Metadata = {
  title: "견적서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 견적서 — 3단계, 목록까지.
 *
 * 이 화면에는 우리가 고객사에 부른 값이 통째로 있다(부품 단가·작업비·합계).
 * 그래서 가드가 사이드바보다 먼저 온다 — 메뉴에서 감추는 것은 막은 것이 아니고,
 * 주소를 직접 입력하거나 예전 링크를 누르면 그대로 들어와진다. 내자 정리 화면이
 * 같은 이유로 같은 순서를 쓴다.
 *
 * canEdit 은 **화면을 그리기 위한 값일 뿐 관문이 아니다.** 지금은 `새 견적서`
 * 단추를 보일지만 정하고, 실제 저장은 4단계의 서버 액션이 세션부터 다시
 * 확인한다 — 단추를 감추는 것으로 막았다고 여기면, 액션을 직접 부르는 요청 앞에서
 * 아무것도 막지 못한다.
 */
export default async function QuotesPage() {
  await requireAreaAccessForCurrentUser("quotes");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="견적서"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  // 역할 정책과 관리자 설정을 둘 다 본다 — 4단계의 서버 액션이 쓸 것과 같은 두
  // 관문이라 화면과 저장 가부가 어긋나지 않는다. 세션이 없으면 위 가드가 이미
  // 로그인으로 보냈으므로 여기서는 못 고치는 것으로만 취급한다.
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canEdit =
    actingUser !== null &&
    (await hasPermission(actingUser, "quotes", "WRITE"));

  const canDelete =
    actingUser !== null &&
    (await hasPermission(actingUser, "quotes", "MANAGE"));

  // 휴지통을 못 여는 사람에게는 그 내용을 읽지도 내려보내지도 않는다 — 쓰지 않을
  // 값을 클라이언트로 실어 보내지 않는다(내자 정리 화면과 같은 규칙).
  const [rows, trashRows] = await Promise.all([
    listQuotes(),
    canDelete ? listDeletedQuotes() : Promise.resolve([]),
  ]);

  return (
    <QuoteListScreen rows={rows} trashRows={trashRows} canEdit={canEdit} canDelete={canDelete} />
  );
}
