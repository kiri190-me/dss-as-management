import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import PlaceholderPage from "@/components/layout/PlaceholderPage";
import QuoteArchiveFolderSection from "@/components/quotes/QuoteArchiveFolderSection";
import QuoteArchiveProductFolderSection from "@/components/quotes/QuoteArchiveProductFolderSection";
import { groupQuotesByArchiveBaseNumber } from "@/components/quotes/quote-archive-folder-groups";
/**
 * 🔴 판정은 **구역 파일이 아니라 중립 파일**에서 가져온다. 구역 파일은 `"use client"` 라
 * 거기서 내보낸 함수를 이 서버 컴포넌트가 부르면 그 자리에서 터진다("Attempted to call …
 * from the server"). 까닭은 quote-archive-product-keys.ts 머리말에 적었다.
 */
import { hasQuoteArchiveProductKeys } from "@/components/quotes/quote-archive-product-keys";
import QuoteListScreen from "@/components/quotes/QuoteListScreen";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { listQuotesForRepairCase } from "@/lib/db/queries/quotes";
import { newQuoteHrefForRepairCase } from "@/lib/domain/quote-new-link";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";

/**
 * ============================================================================
 * /repair-cases/{id}/quotes — 「견적서」 탭: 이 접수 건에 붙은 견적서
 * ============================================================================
 * 양방향은 **새로 이어 붙인 것이 아니다.** 견적서 표에는 접수 건을 가리키는
 * 칸이 처음부터 있었고(`quotes.repair_case_id`), PO/내자 목록은 지운 장만
 * 걸러 전부 보여 준다. 그래서 이 탭에서 만든 견적서는 그쪽 목록에 **그냥
 * 나온다** — 여기서 더한 것은 "이 건의 것만 뽑는 조회"와 그것을 보여 줄 자리
 * 하나다(queries/quotes.ts 의 listQuotesForRepairCase).
 *
 * ── 🔴 인가를 화면에 맡기지 않는다 ──────────────────────────────────────
 * 상위 레이아웃이 견적서를 못 보는 사람에게 이 탭을 그리지 않지만, **감추는
 * 것은 막은 것이 아니다** — 주소를 직접 치면 그대로 들어와진다. 견적서에는
 * 우리가 고객사에 부른 값이 통째로 있어서, 그 구멍은 곧 금액이 새는 구멍이다.
 * 그래서 여기서 `quotes` READ 를 **다시** 확인한다(`quotes/new/page.tsx` 가
 * 같은 이유로 같은 일을 한다).
 *
 * 목록 화면은 PO/내자와 **같은 것을 쓴다**(QuoteListScreen). 한 벌 더 만들면
 * 같은 견적서의 금액·요약 줄이 두 화면에서 갈라지는 날이 온다. 다른 것은 둘
 * 뿐이다: `새 견적서` 단추가 **이 건의 인수번호를 싣고** 가는 것과, 한 장도
 * 없을 때의 안내 문장.
 *
 * 휴지통은 넘기지 않는다(`canDelete={false}`, `trashRows={[]}`). 지운 장을
 * 되살리는 자리는 PO/내자 목록 하나이고, 이 탭이 두 번째 자리가 되면 "어디서
 * 지웠는지"에 따라 되살릴 수 있는 곳이 달라진다.
 *
 * ── 🔴 공유폴더 구역 (2026-10-06 사용자 결정) ──────────────────────────────
 * 목록 **바로 아래**에 그 견적서들의 사내 공유폴더 안을 보여 준다(줄마다 [열기]로
 * 그 파일을 PC 의 프로그램으로 연다). 자리가 여기인 까닭은 사용자가 그렇게 짚었기
 * 때문이다 — 「공유 폴더 목록이 견적서 목록 아래에 뜨도록」.
 *  · 🔴 목록 화면 **안**이 아니라 이 페이지에 붙인다. QuoteListScreen 은 PO/내자와
 *    함께 쓰는 한 벌이고 `vendor/dss-core` 에 쌍둥이가 있어 건드리지 않는다.
 *  · 🔴 구역 수는 **장 수가 아니라 폴더 수**다 — 아래 묶기 참고.
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "견적서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseQuotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 상위 (app) 레이아웃이 이미 세션을 확인했다. 형제 탭들과 같은 모양으로
  // 방어적으로 한 번 더 본다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  /**
   * 🔴 살아 있는 계정을 다시 읽어 판정한다 — 강등된 계정이 옛 토큰으로 금액을
   * 들여다보지 못하게. 영역 열쇠는 `quotes` 다(새 열쇠를 만들지 않는다):
   * "견적서를 볼 수 있는가"는 이미 그 하나가 답하고 있고, 두 번째 열쇠를 만들면
   * 관리자가 한쪽만 풀어 둔 상태가 생긴다.
   */
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const canView = await hasPermission(actingUser, "quotes", "READ");
  if (!canView) {
    return (
      <PlaceholderPage
        title="견적서"
        description="견적서를 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  /**
   * 접수 건이 실제로 있는지는 `[id]/layout.tsx` 가 이미 본다. 그래도 여기서 한
   * 번 더 부르는 까닭은 **그 id 로 조회를 하기 때문**이다. 요청마다 캐시되므로
   * (`cache()`) 조회가 한 번 더 도는 것이 아니다.
   */
  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  /**
   * 고칠 수 있는 사람에게만 `새 견적서` 단추를 그린다 — PO/내자 목록이 하는
   * 그대로다(`quotes` WRITE). **이것도 관문이 아니다**: `/quotes/new` 가 다시
   * 확인하고, 저장은 서버 액션이 처음부터 또 검사한다.
   */
  const canEdit = await hasPermission(actingUser, "quotes", "WRITE");

  const rows = await listQuotesForRepairCase(resolved.id);

  /**
   * 공유폴더 구역을 몇 개 그릴까 — 🔴 **장 수가 아니라 폴더 수**다. 한 수리 건의 견적서
   * `DSS 2026-078` · `-1` · `-3` 은 본 번호가 하나라 **폴더도 하나**다(가르는 규칙은
   * quote-archive-folder-groups.ts 가 저장 쪽과 같은 함수로 뽑는다). 장 수만큼 그리면 같은
   * 폴더를 세 번 보여 주고 NAS 도 세 번 때린다. 견적서가 없으면 빈 배열이고, 구역도 없다.
   *
   * 🔴 여기서 하는 일은 **번호를 묶는 것뿐**이다 — 공유폴더는 보지 않는다. 서버 컴포넌트가
   * 공유폴더를 읽으면 NAS 가 느리거나 꺼진 날 이 탭 자체가 안 뜬다. 읽기는 화면이 뜬 뒤
   * 구역이 스스로 통로를 불러서 한다.
   */
  const archiveFolderGroups = groupQuotesByArchiveBaseNumber(rows);

  return (
    <>
      <QuoteListScreen
        rows={rows}
        trashRows={[]}
        canEdit={canEdit}
        canDelete={false}
        /**
         * 🔴 인수번호를 실어 보낸다. 폼이 그것으로 **기존 「인수번호로 불러오기」
         * 길을 그대로 탄다** — 여기서 값을 따로 채우면 두 입구가 서로 다른 값을
         * 채우게 되고, 그 차이는 한참 뒤에 금액으로 드러난다.
         */
        newQuoteHref={newQuoteHrefForRepairCase({
          repairCaseId: resolved.id,
          intakeNumber: resolved.intakeNumber,
        })}
        emptyMessage="이 접수 건에 등록된 견적서가 없습니다. 「새 견적서」로 만들면 이 건에 붙습니다."
        /**
         * 줄을 눌러 여는 수정 화면에 이 건의 id 를 싣는다 — [취소]가 PO/내자 목록이
         * 아니라 **이 탭으로** 돌아오게. 돌아갈지는 수정 화면이 그 견적서의 건과
         * 맞춰 보고 정한다(domain/quote-new-link.ts 의 returnHrefForEditQuote).
         */
        quoteLinkRepairCaseId={resolved.id}
      />

      {/*
        🔴 **공유폴더 구역은 목록 바로 아래**다(사용자 결정 2026-10-06 — 「공유 폴더 목록이
        견적서 목록 아래에 뜨도록」). 목록 화면(QuoteListScreen)은 PO/내자와 함께 쓰는 한 벌이고
        vendor/dss-core 에 쌍둥이가 있어 **건드리지 않는다** — 그래서 그 화면 안이 아니라 이
        페이지에서 그 아래에 붙인다.

        감싸는 상자를 따로 두지 않고 조각(fragment)으로 둔다 — 바깥 레이아웃이 이미
        세로로 쌓고 사이를 띄우는 상자다(repair-cases/[id]/layout.tsx).

        🔴 본 번호마다 하나씩이고, 머리에 그 번호를 적어 어느 폴더인지 가른다. 설정이 꺼져
        있으면 각 구역이 스스로 아무것도 그리지 않는다.
      */}
      {archiveFolderGroups.map((group) => (
        <QuoteArchiveFolderSection key={group.baseNumber} quoteId={group.quoteId} label={group.baseNumber} />
      ))}

      {/*
        🔴 **「같은 장비의 지난 견적서」는 그 아래**다 — 위는 이 건의 폴더, 여기는 **같은
        장비가 예전에 받은** 폴더들이다(지금 수리 건과 무관한 옛날 건이 섞인다. 사용자 결정
        2026-10-06 — 구역을 나눠 따로 보여 준다). 겹치는 폴더는 통로가 뺀다.

        🔴 L/N 이나 S/N 이 없는 건에서는 **구역을 아예 그리지 않는다** — 둘 다 있어야 장비가
        확정된다(같은 S/N 에 모델이 여럿인 사례가 실제로 있다). 그래야 통로를 부르지도 않는다.

        🔴 여기서도 공유폴더를 읽지 않는다 — 읽기는 화면이 뜬 뒤 구역이 스스로 한다.
      */}
      {hasQuoteArchiveProductKeys(resolved.lotNumber, resolved.serialNumber) && (
        <QuoteArchiveProductFolderSection repairCaseId={resolved.id} />
      )}
    </>
  );
}
