import type { Metadata } from "next";
import { redirect } from "next/navigation";
import InventoryTabs from "@/components/inventory/InventoryTabs";
import OhTemplateScreen from "@/components/inventory/OhTemplateScreen";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  listOhPartTemplates,
  listUnlinkedProductModels,
} from "@/lib/db/queries/oh-part-templates";

export const metadata: Metadata = {
  title: "O/H 부품 템플릿 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 재고 관리 안쪽 화면이다 — 사이드바에 새 항목을 만들지 않는다(InventoryTabs 의
 * 같은 판단). 권한도 재고와 같은 영역을 쓴다.
 *
 * 고칠 수 없는 사람에게는 **값은 보이고 입력칸만 없다** — 어떤 기종에 어떤 O/H
 * 부품이 들어가는지는 엔지니어도 알아야 하는 정보이고, 감추는 것은 안내이지
 * 차단이 아니다(차단은 mutation 이 다시 한다).
 */
export default async function OhTemplatesPage() {
  await requireAreaAccessForCurrentUser("inventory");

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const canEdit = await hasPermission(actingUser.role, "inventory.parts", "WRITE");

  // 연결 드롭다운 목록은 고칠 수 있는 사람에게만 읽어 내려보낸다 — 쓰지 않을
  // 값을 클라이언트로 실어 보내지 않는다.
  const [templates, unlinkedModels] = await Promise.all([
    listOhPartTemplates(),
    canEdit ? listUnlinkedProductModels() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">재고 관리</h1>
      <InventoryTabs active="OH_TEMPLATES" />
      <OhTemplateScreen templates={templates} unlinkedModels={unlinkedModels} canEdit={canEdit} />
    </div>
  );
}
