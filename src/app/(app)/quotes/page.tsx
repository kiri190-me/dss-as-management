import type { Metadata } from "next";
import QuoteListSlots, { NewQuoteControl } from "@/components/quotes/QuoteListSlots";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { listDeletedQuotes, listQuotes } from "@/lib/db/queries/quotes";
import {
  deleteQuoteAction,
  permanentlyDeleteQuoteAction,
  restoreQuoteAction,
} from "@/lib/server/actions/quotes";

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
 *
 * ── 🔴 화면은 공용 묶음의 것이다 — 이 저장소에 복사본을 두지 않는다 (2026-10-07) ──
 * `@dss/core/ui/quotes/QuoteListScreen` 은 PO/내자 사이트의 [견적서] 목록과 **한 벌**
 * 이다(설계서 F절 5번 · G절 조각 4). 여기 있던 868줄짜리 복사본은 지웠다 — 두면
 * 「금액 · 요약 줄이 갈라지는 날」이 오고, 그날 사람은 같은 견적서의 다른 금액을 두
 * 화면에서 보게 된다.
 *
 * 🔴 **화면을 곧바로 부르지 않는다.** 얇은 클라이언트 조각 `QuoteListSlots` 를 거친다 —
 * 이 파일은 **서버 컴포넌트**이고 목록 화면은 `"use client"` 라, 그 경계를 넘는 값은
 * 직렬화되어야 한다. **평범한 함수는 안 된다**(화면이 통째로 죽는다 — 그 오류와 까닭은
 * QuoteListSlots.tsx 머리말에 있다). 🔴 `tsc` 도 `lint` 도 잡지 못한다.
 *
 * 여기서 넘기는 것은 **경계를 넘을 수 있는 것**뿐이다: 휴지통 액션 셋(서버 액션이라
 * 넘어간다)과 [새 견적서] 자리(ReactNode). 함수 슬롯 넷은 QuoteListSlots 가 건다.
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
    <QuoteListSlots
      rows={rows}
      trashRows={trashRows}
      canEdit={canEdit}
      canDelete={canDelete}
      /**
       * 🔴 [새 견적서] 를 누르면 팝업이 뜬다(견적서 ⑤). 이 슬롯은 **ReactNode 라 서버에서
       * 넘어간다** — 함수 슬롯 넷과 갈리는 자리다. 창을 여닫는 상태만 클라이언트 조각이
       * 든다(QuoteListSlots 의 `NewQuoteControl`). 🔴 주소(`/quotes/new`)를 아는 곳은
       * 여기 한 곳이다.
       *
       * 🔴 **`key` 를 빼지 마라** — 없으면 목록을 열 때마다 개발 오버레이에 「Each child
       * in a list should have a unique "key" prop.」 가 뜬다(까닭은 NewQuoteControl 머리말).
       *
       * 그릴지 말지는 화면이 정한다(`{canEdit && newQuoteControl}`) — 여기서 다시 검사하면
       * 같은 판정이 두 곳에 놓이고, 어긋나는 날 어느 쪽이 맞는지 모른다.
       */
      newQuoteControl={<NewQuoteControl key="new-quote" baseHref="/quotes/new" />}
      /**
       * 🔴 휴지통의 세 조작은 **부르는 쪽의 서버 액션**이다. 공용 화면은 DB 에 접속하지
       * 않는다 — 세션을 다시 읽고 권한을 다시 보고 트랜잭션을 여는 일은 이 사이트의
       * 몫이고, 화면은 그 결과(ok / message)만 안다. 🔴 화면이 감춘 것은 경계가 아니다.
       */
      trashActions={{
        deleteQuote: deleteQuoteAction,
        restoreQuote: restoreQuoteAction,
        permanentlyDeleteQuote: permanentlyDeleteQuoteAction,
      }}
    />
  );
}
