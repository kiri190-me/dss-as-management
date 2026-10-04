import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CustomerPortalScreen from "@/components/customer-portal/CustomerPortalScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  listActiveStatusOptions,
  listPortalFormGroups,
  listPortalItemsForForm,
  type CustomerPortalItem,
} from "@/lib/db/queries/customer-portal";

export const metadata: Metadata = {
  title: "고객 안내 현황 | DSS A/S 관리 시스템",
};

// 고객에게 나갈 값을 다루는 화면이라 캐시된 값을 보여주면 안 된다 —
// 방금 고친 상태가 화면에 안 보이면 담당자가 두 번 저장한다.
export const dynamic = "force-dynamic";

/**
 * 고객 안내 현황 — **고객사별 양식 표** 한 장씩.
 *
 * 담당자가 그 회사와 주고받는 현황표를 그대로 보고, 거기서 상태 · 비고 · 손으로
 * 적는 칸을 정한 뒤 엑셀로 내보낸다. 🔴 단추의 근거는 **양식**이다 — 2026-10-04
 * 에 전용 주소를 걷어내면서 「주소가 발급된 고객사」에서 옮겨 왔다.
 */
export default async function CustomerPortalPage() {
  // 역할별 접근 권한에서 이 메뉴가 꺼져 있으면 주소를 직접 입력해도 들어올 수
  // 없다 — 사이드바에서 감추는 것만으로는 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("customerPortal");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="고객 안내 현황"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!(await hasPermission(actingUser, "customerPortal", "READ"))) {
    return (
      <PlaceholderPage
        title="고객 안내 현황"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const [formGroups, statusOptions] = await Promise.all([
    listPortalFormGroups(),
    listActiveStatusOptions(),
  ]);

  // 양식마다 목록을 미리 읽어 둔다. 화면에서 양식을 바꿀 때마다 서버를 다시
  // 부르지 않게 하려는 것인데, 양식이 셋이라 감당된다. 양식이 수십 개로 늘면
  // 고른 양식만 읽도록 바꿔야 한다.
  const itemsByForm: Record<string, CustomerPortalItem[]> = {};
  for (const group of formGroups) {
    itemsByForm[group.formId] = await listPortalItemsForForm(group.formId);
  }

  return (
    <CustomerPortalScreen
      formIds={formGroups.map((group) => group.formId)}
      itemsByForm={itemsByForm}
      statusOptions={statusOptions}
      canEdit={await hasPermission(actingUser, "customerPortal", "WRITE")}
    />
  );
}
