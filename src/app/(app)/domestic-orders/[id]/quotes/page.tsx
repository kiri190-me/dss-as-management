import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import DomesticOrderDetailNotice from "@/components/domestic-orders/detail/DomesticOrderDetailNotice";
import DomesticOrderQuoteArchiveFolderSection from "@/components/domestic-orders/detail/DomesticOrderQuoteArchiveFolderSection";
import QuoteArchiveFolderSection from "@/components/quotes/QuoteArchiveFolderSection";
import { groupQuotesByArchiveBaseNumber } from "@/components/quotes/quote-archive-folder-groups";
import QuoteListSlots from "@/components/quotes/QuoteListSlots";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";
import { listQuotesForDomesticOrder } from "@/lib/db/queries/quotes";
import {
  DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT,
  domesticOrderQuoteArchiveNoDateText,
  domesticOrderQuoteArchiveOnlyText,
  resolveDomesticOrderQuoteArchiveLookup,
} from "@/lib/domain/domestic-order-quote-archive";
import {
  deleteQuoteAction,
  permanentlyDeleteQuoteAction,
  restoreQuoteAction,
} from "@/lib/server/actions/quotes";

/**
 * ============================================================================
 * /domestic-orders/{id}/quotes — 「견적서」 탭 (2026-11-06)
 * ============================================================================
 * 기타건 = **내자 정리의 한 줄**이다. 그 줄의 견적서를 보여 주는데, 🔴 **한 탭에 갈래가
 * 둘**이다(사용자 결정 2026-11-06 — 「수리건에 있는 [견적서]탭처럼 만들어줘」 · 「시스템에서
 * 견적서를 만든 적이 없는 … 건은 내자정리에 적힌 견적서 번호로 [견적서]탭의 공유폴더를
 * 찾아서 띄워줘」):
 *
 *   ① **시스템 견적서가 있다** → 수리 건 상세의 「견적서」 탭과 **똑같다**: 공용 목록 화면 +
 *      그 견적서 id 로 부르는 공유폴더 구역. 쓰는 조각도 그 탭이 쓰는 것 그대로다.
 *   ② **없다** → 내자 정리에 적힌 **견적서번호**로 공유폴더만 찾아 띄운다(아래 구역).
 *      목록은 그릴 것이 없으니 세우지 않고, **왜 비었는지**를 한 줄로 적는다.
 *
 * ── 🔴 갈래를 가르는 것은 「연결이 있는가」가 아니라 「볼 장이 있는가」다 ───
 * `domestic_orders.quote_id` 가 있어도 그 장이 **휴지통에 들어가면** 목록은 빈다
 * (listQuotesForDomesticOrder 가 `is_deleted = false` 로 좁힌다). 그때 연결만 보고 ①로
 * 가면 **빈 목록과 빈 폴더 구역**이 서고 사람은 「견적서가 사라졌다」로 읽는다. 그래서
 * **실제로 읽어 온 줄 수**로 가른다 — 그 줄의 화면 번호(displayQuoteNumber)도 같은 사정일
 * 때 손으로 적은 번호로 되돌아와 있어(queries/domestic-orders.ts 의 매퍼) ②가 그대로 맞는다.
 *
 * ── 🔴 [새 견적서] 단추를 넣지 않는다 (사용자 결정) ─────────────────────
 * 기타건은 **견적서에서 태어난 줄**이라(견적서를 만들면 내자 정리에 줄이 선다 — 커밋
 * 137ad2d6) 거꾸로 이 탭에서 견적서를 만들 일이 없다. 그래서 `newQuoteControl` 슬롯을
 * 넘기지 않고(넘기지 않으면 공용 화면이 그 자리를 아예 그리지 않는다), `canEdit={false}`
 * 로 **두 겹**으로 막는다. 🔴 그 단추를 드는 조각(NewQuoteControl)을 들여오지도 않는다.
 *
 * ── 🔴 제품 단위 폴더 구역은 없다 ───────────────────────────────────────
 * 수리 건 탭 맨 아래의 「같은 장비의 지난 견적서」(QuoteArchiveProductFolderSection)는
 * **수리 건 id** 를 받아 그 장비(L/N · S/N)로 찾는 구역이다. 기타건에는 그 건이 없다.
 *
 * ── 🔴 열쇠가 둘이다 ────────────────────────────────────────────────────
 *  · `domesticOrders` READ — 이 화면(기타건 상세)에 들어올 수 있는가. 레이아웃이 같은
 *    열쇠로 막지만 여기서 한 번 더 건다(형제 탭들과 같은 모양).
 *  · `quotes` READ — **견적서를 볼 수 있는가.** 견적서에는 우리가 고객사에 부른 값이
 *    통째로 있어서, 내자는 볼 수 있지만 견적서는 못 보는 사람에게 이 탭이 열리면 그것이
 *    곧 금액이 새는 구멍이다. 수리 건 상세의 같은 탭이 쓰는 열쇠 그대로이고, 새 영역을
 *    만들지 않는다. 🔴 **공유폴더를 읽는 통로도 같은 둘을 스스로 다시 본다**
 *    (api/domestic-orders/[id]/quote-archive-folder/entries).
 *
 * 🔴 **레이아웃이 탭을 감추는 것은 관문이 아니다** — 주소를 직접 치면 그대로 들어와지므로
 * 여기서 같은 판정을 다시 한다. 살아 있는 계정을 다시 읽는 것도 그쪽과 같다(강등된 계정이
 * 옛 토큰으로 금액을 들여다보지 못하게).
 *
 * ── 🔴 서버에서 공유폴더를 읽지 않는다 ──────────────────────────────────
 * 이 파일은 **번호를 묶는 일**까지만 한다(groupQuotesByArchiveBaseNumber). 서버 컴포넌트가
 * 공유폴더를 읽으면 NAS 가 느리거나 꺼진 날 이 탭 자체가 안 뜬다 — 읽기는 화면이 뜬 뒤
 * 각 구역이 스스로 통로를 불러서 한다(수리 건 탭과 같은 규율).
 *
 * ── 알고도 고치지 않은 것 ───────────────────────────────────────────────
 * 공용 목록 화면이 제 `<h1>견적서</h1>` 를 갖고 있어, ① 갈래에서는 레이아웃 머리 카드의
 * `<h1>` 과 둘이 된다. **수리 건 상세의 「견적서」 탭이 이미 그렇고**, 그 화면은 서브모듈
 * (vendor/dss-core)이라 이 조각에서 고칠 수 있는 자리가 아니다.
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "견적서 | 기타건 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function DomesticOrderQuotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  await requireAreaAccessForCurrentUser("domesticOrders");

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const canViewQuotes = await hasPermission(actingUser, "quotes", "READ");
  if (!canViewQuotes) {
    return (
      <DomesticOrderDetailNotice
        title="견적서"
        description="견적서를 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  // 없는 줄 · 휴지통에 든 줄의 탭 주소로 들어오면 404 다. 레이아웃이 이미 같은
  // 판정을 하지만 cache() 덕에 질의가 한 번 더 돌지 않고, 이 페이지만 따로 보더라도
  // "어떤 줄이 있어야 한다"는 전제가 코드에 적혀 있게 된다.
  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  /**
   * 이 줄이 가리키는 견적서. 많아야 한 장이고(내자 줄의 `quote_id`), 그 장이 휴지통에
   * 있으면 빈 배열이다 — 아래에서 ②로 간다(머리말 「갈래를 가르는 것은…」).
   */
  const rows = await listQuotesForDomesticOrder(row.quoteId);

  // ── ① 시스템 견적서가 있다 — 수리 건 탭과 똑같이 ─────────────────────
  if (rows.length > 0) {
    /**
     * 공유폴더 구역을 몇 개 그릴까 — 🔴 **장 수가 아니라 폴더 수**다. 가지 번호
     * (`DSS 2026-089-1`)는 본 번호와 한 폴더를 쓴다. 기타건은 한 장뿐이라 묶음도 하나지만,
     * **묶는 규칙을 여기서 다시 적지 않는다** — 수리 건 탭이 쓰는 그 함수를 그대로 부른다
     * (번호가 비어 있는 장은 그 함수가 묶음에서 빼므로 구역이 서지 않는다).
     */
    const archiveFolderGroups = groupQuotesByArchiveBaseNumber(rows);

    return (
      <>
        <QuoteListSlots
          rows={rows}
          trashRows={[]}
          /**
           * 🔴 **[새 견적서]를 그리지 않는다**(사용자 결정 — 머리말). `newQuoteControl`
           * 슬롯을 넘기지 않는 것만으로도 그 자리는 비지만, 공용 화면이 그 자리를 그릴지
           * 정하는 값도 거짓으로 둔다. 그래서 이 탭은 `quotes` WRITE 를 묻지도 않는다.
           */
          canEdit={false}
          /**
           * 휴지통은 이 탭에 없다 — 지운 장을 되살리는 자리는 견적서 목록 하나다(수리 건
           * 탭과 같은 판단). 🔴 아래 액션 셋은 **공용 화면이 받아야 하는 값**이라 넘기지만
           * `canDelete={false}` 라 줄의 [삭제]도 휴지통 탭도 그려지지 않는다.
           */
          canDelete={false}
          trashActions={{
            deleteQuote: deleteQuoteAction,
            restoreQuote: restoreQuoteAction,
            permanentlyDeleteQuote: permanentlyDeleteQuoteAction,
          }}
        />

        {/*
          🔴 **공유폴더 구역은 목록 바로 아래**다 — 수리 건 탭의 자리 그대로다(사용자 결정
          2026-10-06). 목록 화면은 PO/내자와 함께 쓰는 한 벌이라 그 안이 아니라 여기에 붙인다.
          감싸는 상자를 두지 않고 조각(fragment)으로 둔다 — 레이아웃이 이미 세로로 쌓고
          사이를 띄우는 상자다([id]/layout.tsx).
        */}
        {archiveFolderGroups.map((group) => (
          <QuoteArchiveFolderSection key={group.baseNumber} quoteId={group.quoteId} label={group.baseNumber} />
        ))}
      </>
    );
  }

  // ── ② 시스템 견적서가 없다 — 내자에 적힌 번호로 공유폴더만 ────────────
  //    🔴 번호도 날짜도 **서버가 이 줄에서 꺼낸다**(순수 함수 한 벌). 화면이 정한 번호로
  //    폴더를 찾게 만들면 아무 번호나 넣어 남의 폴더를 들여다볼 수 있다.
  const lookup = resolveDomesticOrderQuoteArchiveLookup(row);

  // 🔴 조용한 빈 화면으로 두지 않는다 — **무엇이 없어서** 못 찾는지를 적는다. 글자는
  //    구역이 같은 상황에서 쓰는 것과 한 벌이다(domain/domestic-order-quote-archive.ts).
  if (lookup.status === "no-quote-number") {
    return <DomesticOrderDetailNotice title="견적서" description={DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT} />;
  }
  if (lookup.status === "no-quote-date") {
    return (
      <DomesticOrderDetailNotice
        title="견적서"
        description={domesticOrderQuoteArchiveNoDateText(lookup.quoteNumber)}
      />
    );
  }

  return (
    <>
      {/* 목록이 없는 까닭을 먼저 적는다 — 없으면 「견적서가 사라졌다」로 읽힌다. */}
      <DomesticOrderDetailNotice
        title="견적서"
        description={domesticOrderQuoteArchiveOnlyText(lookup.quoteNumber)}
      />
      {/*
        🔴 통로에 넘기는 것은 **이 줄의 id** 하나다. `label` 은 머리에 적는 글자일 뿐이고
        찾기에 쓰이지 않는다 — 번호는 서버가 그 줄에서 다시 꺼낸다.
      */}
      <DomesticOrderQuoteArchiveFolderSection domesticOrderId={row.id} label={lookup.quoteNumber} />
    </>
  );
}
