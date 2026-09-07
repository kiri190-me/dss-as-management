import type { Metadata } from "next";
import DomesticOrderListScreen from "@/components/domestic-orders/DomesticOrderListScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  listCustomerOptions,
  listDomesticOrders,
  listRepairCaseLinkOptions,
} from "@/lib/db/queries/domestic-orders";
import { listQuoteOptions } from "@/lib/db/queries/quotes";
import { toKstDateOnly } from "@/lib/domain/date-only";

export const metadata: Metadata = {
  title: "내자 정리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 내자 정리(국내 수주 진행 상황표) — 2단계, 목록 + 행 추가·수정.
 *
 * 이 화면에는 거래 금액과 입금 여부가 있다. 그래서 가드가 사이드바보다 먼저
 * 온다 — 메뉴에서 감추는 것은 막은 것이 아니고, 주소를 직접 입력하거나 예전
 * 링크를 누르면 그대로 들어와진다.
 *
 * canEdit 은 **화면을 그리기 위한 값일 뿐 관문이 아니다.** 실제 저장은
 * server/actions/domestic-orders.ts 가 세션부터 다시 확인한다 — 버튼을 감추는
 * 것으로 막았다고 여기면, 액션을 직접 부르는 요청 앞에서 아무것도 막지 못한다.
 */
export default async function DomesticOrdersPage() {
  await requireAreaAccessForCurrentUser("domesticOrders");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="내자 정리"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  // 역할 정책과 관리자 설정을 둘 다 본다 — 서버 액션이 쓰는 것과 같은 두 관문
  // 이라 화면과 저장 가부가 어긋나지 않는다. 세션이 없으면 위 가드가 이미
  // 로그인으로 보냈으므로 여기서는 못 고치는 것으로만 취급한다.
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  // 고치는 권한은 관리자가 정한 수준 하나로 정해진다(2026-08-31 전환) —
  // 예전에는 canEditDomesticOrders(역할)를 AND 로 겹쳐 넓혀도 열리지 않았다.
  const canEdit =
    actingUser !== null && (await hasPermission(actingUser, "domesticOrders", "WRITE"));

  // 고칠 수 없는 사람에게는 폼의 드롭다운 목록을 읽지 않는다 — 쓰지 않을 값을
  // 클라이언트로 내려보내지 않는다(고객사 화면이 휴지통을 다루는 방식과 같다).
  // 고객사 목록도 같은 규칙이다: 이 화면을 볼 수만 있는 사람에게 전체 고객사
  // 명단을 실어 보낼 이유가 없다.
  const [rows, repairCaseOptions, customerOptions, quoteOptions] = await Promise.all([
    listDomesticOrders(),
    canEdit ? listRepairCaseLinkOptions() : Promise.resolve([]),
    canEdit ? listCustomerOptions() : Promise.resolve([]),
    // 견적서 목록도 폼에서만 쓴다 — 고칠 수 없는 사람에게 실어 보내지 않는다.
    canEdit ? listQuoteOptions() : Promise.resolve([]),
  ]);

  // 머리말의 "{날짜}자 진행 상황입니다"에 들어갈 날짜. 클라이언트에서 만들면
  // 서버가 그린 것과 달라져 hydration이 어긋나므로 여기서 정해 내려보낸다.
  // 표준시를 못 박는 것도 같은 이유다 — 서버가 어디서 돌든 같은 날짜가 나와야
  // 한다.
  const asOfDate = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // 발주 년도 칸의 기본값이 되는 "올해". 이것도 서버가 정한다 — 클라이언트에서
  // new Date().getFullYear() 를 부르면 서버가 그린 것과 달라져 hydration 이
  // 어긋나고, 한국 표준시 대신 브라우저의 시간대로 해가 정해진다(연초·연말
  // 하루가 실제로 다르게 나온다). toKstDateOnly 는 그 판단이 이미 적혀 있는
  // 곳이다(domain/date-only.ts).
  const currentYear = toKstDateOnly(new Date()).slice(0, 4);

  return (
    <DomesticOrderListScreen
      rows={rows}
      asOfDate={asOfDate}
      currentYear={currentYear}
      canEdit={canEdit}
      repairCaseOptions={repairCaseOptions}
      customerOptions={customerOptions}
      quoteOptions={quoteOptions}
    />
  );
}
