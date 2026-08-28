import type { Metadata } from "next";
import { redirect } from "next/navigation";
import InventoryTabs from "@/components/inventory/InventoryTabs";
import OhTemplateScreen from "@/components/inventory/OhTemplateScreen";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getPartList } from "@/lib/db/queries/inventory";
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
  //
  // 품명 칸이 검색할 재고 부품도 같은 결이다. 편집 폼 자체가 canEdit 일 때만
  // 열리므로 못 고치는 세션에는 빈 배열이면 충분하고, **넘기는 칸도 줄인다** —
  // getPartList 는 재고 수량·삭제 가능 여부까지 실어 주는데 OhTemplateScreen 은
  // "use client" 라 넘긴 값이 그대로 브라우저까지 간다. 품명 검색에 필요한
  // `{id, partName}` 에 품명2(partSpec)만 더한다: parts 에는 품명 유니크 제약이
  // 없어(schema/inventory.ts) 같은 이름이 여럿일 수 있고, 그때 사람이 어느
  // 재고인지 고르려면 단서가 하나는 있어야 한다.
  const [templates, unlinkedModels, partOptions] = await Promise.all([
    listOhPartTemplates(),
    canEdit ? listUnlinkedProductModels() : Promise.resolve([]),
    canEdit
      ? getPartList().then((rows) =>
          rows.map((row) => ({ id: row.id, partName: row.partName, partSpec: row.partSpec }))
        )
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">재고 관리</h1>
      <InventoryTabs active="OH_TEMPLATES" />
      <OhTemplateScreen
        templates={templates}
        unlinkedModels={unlinkedModels}
        partOptions={partOptions}
        canEdit={canEdit}
      />
    </div>
  );
}
