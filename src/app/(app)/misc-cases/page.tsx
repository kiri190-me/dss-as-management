import type { Metadata } from "next";

import PlaceholderPage from "@/components/layout/PlaceholderPage";
import MiscCaseListScreen from "@/components/misc-cases/MiscCaseListScreen";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getAuthSource } from "@/lib/config/auth-source";
import { loadDomesticOrderApprovalStates } from "@/lib/db/queries/domestic-order-approvals";
import { listMiscDomesticOrders } from "@/lib/db/queries/domestic-orders";
import { resolveMiscCaseStatus } from "@/lib/domain/misc-case-status";

/**
 * ============================================================================
 * /misc-cases — 「기타건 현황」 (2026-11-06)
 * ============================================================================
 * 기타건 = **수리 건이 붙지 않은 내자 정리의 한 줄**이고, 이 화면은 그 줄들만 모아
 * 보는 목록이다(사용자 요구: 「[PO/내자] … 에 [기타건 현황]이라고 만들고 [전체 a/s
 * 현황]처럼 기타건들을 모아서 볼 수 있도록 해줘」).
 *
 * ── 🔴 주소가 `/domestic-orders/...` 아래가 **아닌** 까닭 ────────────────
 * 그 아래에 두면 `/domestic-orders/{id}`(기타건 상세)와 한 자리를 다툰다 — 정적
 * 마디가 동적 마디를 이기므로 동작은 하지만, 주소만 보고 「줄 하나인지 목록인지」를
 * 알 수 없고 상세의 레이아웃(머리 카드 · 탭 줄)이 걸리지 않는 예외가 하나 생긴다.
 * 이 화면은 **다른 목록**이지 그 줄의 하위 화면이 아니다 — 전체 A/S 현황이
 * `/repair-cases` 인 것과 같은 자리다.
 *
 * ── 🔴 열쇠를 새로 만들었다(`miscCases`) ────────────────────────────────
 * 같은 자료를 보는 화면이니 `domesticOrders` 를 그대로 쓰는 쪽이 단순하지만, **그
 * 길이 없다.** 이 저장소는 「메뉴 열쇠 = 권한 영역 열쇠」를 불변식으로 못 박아 두었고
 * (auth/permission-areas.test.ts 의 「권한 영역과 메뉴가 1:1이다」, navigation.ts 의
 * filterNavItemsForAccess 가 `item.key` 로 거른다), 메뉴 항목을 하나 더하는 순간
 * 같은 글자의 영역이 하나 더 있어야 한다. 열쇠가 없는 항목은 **아무에게도 안 보인다.**
 *
 * 🔵 그래서 **기본 노출은 내자 정리와 한 사람도 다르지 않게** 맞춰 두었다 —
 * 기본값이 같은 술어(canViewDomesticOrders)를 부르고, 상한은 READ 다
 * (auth/permission-baseline.ts · permission-areas.ts). 달라지는 것은 관리자가 설정에서
 * **둘 중 하나만 끌 때**뿐이고, 그것이 열쇠를 가른 값어치다.
 *
 * 🔴 **줄에서 가는 기타건 상세는 `domesticOrders` 가 지킨다**(그 레이아웃의 가드).
 * 그러니 설정에서 이 메뉴만 열고 내자 정리를 닫아 두면 **목록은 보이는데 줄을 누르면
 * 막히는** 상태가 된다. 닫히는 쪽으로 어긋나는 것이고(자료가 새지 않는다), 두 열쇠를
 * 여기서 겹쳐 묻지 않는 까닭은 그러면 설정 화면이 「열어 주면 열립니다」라고 거짓말을
 * 하기 때문이다 — 이 저장소가 2026-08-31 에 겪고 걷어낸 구조다(navigation.ts 머리말).
 *
 * 🔴 가드가 **질의보다 먼저**다. 사이드바에서 감추는 것은 막은 것이 아니고, 이 표에는
 * 거래 금액과 입금 여부가 있다 — 주소를 직접 친 요청 앞에 이 한 줄이 선다.
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "기타건 현황 | DSS A/S 관리 시스템",
};

// DB 에서 읽는 줄이라 정적으로 캐시되면 안 된다 — 요청마다 다시 묻는다.
export const dynamic = "force-dynamic";

export default async function MiscCasesPage() {
  await requireAreaAccessForCurrentUser("miscCases");

  // 내자 정리 · 기타건 상세와 같은 갈래다 — 이 화면의 자료는 전부 데이터베이스에
  // 있고, mock 소스에는 내자 정리라는 표 자체가 없다.
  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="기타건 현황"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const rows = await listMiscDomesticOrders();

  /**
   * 🔴 **상태 배지의 근거**(2026-11-06 사용자 요구 — 「[기타건 최종 출하 승인]요청을
   * 누르면 [출하 승인 대기] 베찌가 … 승인이 모두 완료되면 [출하 대기]로」).
   *
   * 화면이 스스로 판정할 수 없다: 승인 상태는 이 줄의 칸이 아니라 **다른 표의 최신
   * 결재 행 + 이 줄의 판 번호**로 나오는 파생값이다. 전체 A/S 현황이 「장기 PO
   * 미발행」· 「납기 임박」을 서버에서 계산해 내려보내는 것과 같은 모양이다.
   *
   * 🔵 **질의는 한 번뿐**이다 — 줄마다 묻지 않는다(그 함수의 머리말, N+1).
   */
  const approvalStates = await loadDomesticOrderApprovalStates(rows);

  // 🔴 접는 규칙은 여기 적지 않는다 — 기타건 상세의 머리 카드가 쓰는 **그 함수**
  //    하나다(domain/misc-case-status.ts). 두 곳에 적으면 같은 줄이 목록과 상세에서
  //    다른 상태로 보이는 날이 온다.
  const rowsWithStatus = rows.map((row) => ({
    ...row,
    status: resolveMiscCaseStatus({
      completedAt: row.completedAt,
      approvalState: approvalStates.get(row.id) ?? null,
    }),
  }));

  return <MiscCaseListScreen rows={rowsWithStatus} />;
}
